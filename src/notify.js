// Notifications: in-app alerts, Web Push to phones, tablets and computers (VAPID with encrypted payloads, RFC 8291 and 8292,
// no outside service), and Slack (src/slack.js: channels per kind, client channels, direct messages, buttons). notify() fans out to all of them.
// iPhone and iPad get pushes only when the Hub is added to the Home Screen (iOS 16.4 or newer).
import { HttpError, json } from './util.js';
import { all, first, run, batch, newId, now, getSettings, setSetting } from './db.js';
import { requireUser, requireAdmin, requireStaff, isStaff } from './auth.js';
import { route } from './router.js';
import { seal, unseal, b64u, unb64u } from './seal.js';
import { postToSlack, teamSummary } from './slack.js';
import { chatNote } from './chat.js';

export const KINDS = {
  call: 'Incoming calls', voicemail: 'Voicemails and missed calls', text: 'Texts', task: 'Tasks assigned to me and due today',
  client: 'Client updates (approvals, uploads, intake, report views)', lead: 'New leads and bookings', money: 'Payments and new clients', meeting: 'Meeting reminders',
  slack: 'Slack direct messages and mentions',
};
export const CLIENT_KINDS = { update: 'Reports, things to approve, and meetings' };

const enc = new TextEncoder();
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

// ---------- VAPID ----------
export async function vapidKeys(env) {
  const s = await getSettings(env);
  if (s.vapid) {
    try { const v = JSON.parse(s.vapid); return { pub: v.pub, jwk: JSON.parse(await unseal(env, v.priv)) }; } catch { /* make new keys below */ }
  }
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  await setSetting(env, 'vapid', JSON.stringify({ pub, priv: await seal(env, JSON.stringify(jwk)) }));
  return { pub, jwk };
}

export async function vapidHeader(env, endpoint, keys) {
  const k = keys || await vapidKeys(env);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:hello@rightwaygrowth.com' })));
  const key = await crypto.subtle.importKey('jwk', k.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${k.pub}`;
}

// ---------- payload encryption (aes128gcm) ----------
async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}
export async function encryptPayload(payload, p256dh, authSecret, { salt = crypto.getRandomValues(new Uint8Array(16)), local } = {}) {
  const uaPub = unb64u(p256dh);
  const auth = unb64u(authSecret);
  const kp = local || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, kp.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

export async function sendPush(env, sub, data, { urgent = false, ttl = 3600, keys } = {}) {
  const body = await encryptPayload(JSON.stringify(data), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST', body,
    headers: { Authorization: await vapidHeader(env, sub.endpoint, keys), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(urgent ? 60 : ttl), Urgency: urgent ? 'high' : 'normal' },
  });
  if (res.status === 404 || res.status === 410) await run(env, 'DELETE FROM push_subs WHERE id = ?', sub.id); // the device turned notifications off
  else if (res.ok) await run(env, 'UPDATE push_subs SET last_ok = ?, fails = 0 WHERE id = ?', now(), sub.id);
  else await run(env, 'UPDATE push_subs SET fails = fails + 1 WHERE id = ?', sub.id);
  return res.status;
}

// ---------- the one entry point ----------
const prefsOf = (u) => { try { return JSON.parse(u.notify_prefs || '{}') || {}; } catch { return {}; } };
const wants = (u, kind) => prefsOf(u)[kind] !== false;

async function resolveUsers(env, to) {
  if (Array.isArray(to)) return to.length ? all(env, `SELECT * FROM users WHERE id IN (${to.map(() => '?').join(',')})`, ...to) : [];
  if (to === 'staff') return all(env, "SELECT * FROM users WHERE role IN ('admin','team')");
  if (to === 'admins') return all(env, "SELECT * FROM users WHERE role = 'admin'");
  if (to?.client) { // the client's account manager, or the owners when nobody is assigned
    const c = await first(env, 'SELECT owner_id FROM clients WHERE id = ?', to.client);
    const owner = c?.owner_id ? await first(env, "SELECT * FROM users WHERE id = ? AND role IN ('admin','team')", c.owner_id) : null;
    return owner ? [owner] : all(env, "SELECT * FROM users WHERE role = 'admin'");
  }
  if (to?.clientUsers) return all(env, "SELECT * FROM users WHERE role = 'client' AND client_id = ?", to.clientUsers);
  return [];
}

// to: user ids, 'staff', 'admins', { client: id } (its account manager) or { clientUsers: id } (the client's own logins).
// skip: a user id that should not be told (the person who did the thing).
// slack: false keeps it out of Slack channels (personal Slack direct messages still go out). actions: Slack buttons.
// clientId: also posts to that client's Slack channel when it has one.
// list: false skips the in-app alert list (Slack messages have their own unread dots).
export async function notify(env, { to, kind, title, body = '', url = '/', tag = null, urgent = false, skip = null, slack = true, actions = [], clientId = null, list = true }) {
  const users = (await resolveUsers(env, to)).filter((u) => u.id !== skip);
  const at = now();
  if (users.length && list) {
    await batch(env, users.map((u) => ['INSERT INTO notifications (id, user_id, kind, title, body, url, tag, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      newId('n_'), u.id, kind, String(title).slice(0, 160), String(body || '').slice(0, 400), url, tag, at]));
  }
  const pushTo = users.filter((u) => wants(u, kind));
  let sent = 0;
  if (pushTo.length) {
    const subs = await all(env, `SELECT * FROM push_subs WHERE user_id IN (${pushTo.map(() => '?').join(',')})`, ...pushTo.map((u) => u.id));
    if (subs.length) {
      const keys = await vapidKeys(env);
      const data = { title, body, url, tag: tag || `${kind}-${at}`, kind, urgent };
      const results = await Promise.allSettled(subs.map((s) => sendPush(env, s, data, { urgent, keys })));
      sent = results.filter((r) => r.status === 'fulfilled' && r.value >= 200 && r.value < 300).length;
    }
  }
  // Updates for a client also go into the client's chat, so every message to them is in one place.
  if (to?.clientUsers && kind === 'update' && !String(tag || '').startsWith('chat-')) {
    const s = await getSettings(env);
    const link = /^https?:/.test(url) ? url : s.hub_origin ? `${s.hub_origin}${url}` : '';
    await chatNote(env, to.clientUsers, `*${String(title).replace(/[*_~]/g, '')}*${body ? `\n${body}` : ''}${link && url !== '/' && url !== '/#/' ? `\n<${link}|Open it here>` : ''}`).catch((e) => console.error('chat note', e));
  }
  const team = typeof to === 'string' || Boolean(to?.client);
  const slacked = await postToSlack(env, { kind, title, body, url, actions, clientId: clientId || to?.client || null, users, channel: slack && team })
    .catch((e) => { console.error('slack', e); return 0; });
  return { users: users.length, pushed: sent, slack: slacked };
}

// Runs after the response when the platform allows it, so a webhook answers Twilio or Stripe right away.
export function notifyLater(ctx, payload) {
  const p = notify(ctx.env, payload).catch((e) => console.error('notify', e));
  return ctx.defer ? ctx.defer(p) : p;
}

// ---------- scheduled: due today digest (8am New York) and meeting reminders ----------
const nyParts = (t) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
  .formatToParts(new Date(t)).map((p) => [p.type, p.value]));

export async function digestTick(env, t = now()) {
  const p = nyParts(t);
  const today = `${p.year}-${p.month}-${p.day}`;
  if (Number(p.hour) < 8) return 0;
  const s = await getSettings(env);
  if (s.digest_day === today) return 0;
  await setSetting(env, 'digest_day', today);
  await teamSummary(env, today).catch((e) => console.error('slack summary', e));
  const rows = await all(env, `SELECT t.owner, SUM(CASE WHEN t.due = ? THEN 1 ELSE 0 END) AS today, SUM(CASE WHEN t.due < ? THEN 1 ELSE 0 END) AS late
    FROM tasks t JOIN clients c ON c.id = t.client_id WHERE t.status IN ('todo','doing') AND c.status = 'active' AND t.owner IS NOT NULL AND t.due IS NOT NULL AND t.due <= ? GROUP BY t.owner`, today, today, today);
  let n = 0;
  for (const r of rows) {
    if (!r.today && !r.late) continue;
    const parts = [r.today ? `${r.today} due today` : '', r.late ? `${r.late} overdue` : ''].filter(Boolean).join(', ');
    await notify(env, { to: [r.owner], kind: 'task', title: 'Your work today', body: `${parts}. Open My work to start.`, url: '/#/work', tag: `digest-${today}`, slack: false });
    n += 1;
  }
  return n;
}

export async function meetingReminders(env, t = now()) {
  const rows = await all(env, `SELECT m.*, c.name AS client_name, c.owner_id FROM meetings m JOIN clients c ON c.id = m.client_id
    WHERE m.status = 'scheduled' AND m.reminded_at IS NULL AND m.start_at > ? AND m.start_at <= ?`, t, t + 16 * 60e3).catch(() => []);
  for (const m of rows) {
    await run(env, 'UPDATE meetings SET reminded_at = ? WHERE id = ?', t, m.id);
    const who = [...new Set([m.created_by, m.owner_id].filter(Boolean))];
    const mins = Math.max(1, Math.round((m.start_at - t) / 60e3));
    await notify(env, { to: who, kind: 'meeting', title: `${m.client_name} meeting in ${mins} min`, body: m.meet_link ? 'Tap to open the meeting page. The Meet link is there.' : m.title, url: `/#/client/${m.client_id}/meetings`, tag: `meet-${m.id}`, urgent: true, slack: false });
  }
  return rows.length;
}

// ---------- routes ----------
route('GET', '/api/notify/config', async ({ env, user, url }) => {
  requireUser(user);
  const keys = await vapidKeys(env);
  if (isStaff(user)) {
    const s = await getSettings(env);
    if (s.hub_origin !== url.origin && !/localhost|127\./.test(url.origin)) await setSetting(env, 'hub_origin', url.origin);
  }
  const me = await first(env, 'SELECT notify_prefs FROM users WHERE id = ?', user.id);
  return json({
    publicKey: keys.pub, kinds: isStaff(user) ? KINDS : CLIENT_KINDS, prefs: prefsOf(me || {}),
    devices: (await first(env, 'SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?', user.id))?.n || 0,
  });
});

route('POST', '/api/notify/subscribe', async ({ env, user, body, request }) => {
  requireUser(user);
  if (user.viewAs) throw new HttpError('Client view is read only.', 403);
  const b = await body();
  const endpoint = String(b.endpoint || '');
  if (!/^https:\/\/[^\s]+$/.test(endpoint) || endpoint.length > 1000) throw new HttpError('That device did not give a push address.');
  const p256dh = String(b.keys?.p256dh || ''), auth = String(b.keys?.auth || '');
  if (unb64u(p256dh).length !== 65 || unb64u(auth).length !== 16) throw new HttpError('That device sent keys the Hub cannot use.');
  const ua = String(request.headers.get('user-agent') || '').slice(0, 200);
  await run(env, `INSERT INTO push_subs (id, user_id, endpoint, p256dh, auth, ua, created_at, fails) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, fails = 0`, newId('ps_'), user.id, endpoint, p256dh, auth, ua, now());
  return json({ ok: true });
});

route('POST', '/api/notify/unsubscribe', async ({ env, user, body }) => {
  requireUser(user);
  await run(env, 'DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?', String((await body()).endpoint || ''), user.id);
  return json({ ok: true });
});

route('PUT', '/api/notify/prefs', async ({ env, user, body }) => {
  requireUser(user);
  const b = await body();
  const allowed = isStaff(user) ? KINDS : CLIENT_KINDS;
  const prefs = Object.fromEntries(Object.keys(allowed).map((k) => [k, b[k] !== false]));
  await run(env, 'UPDATE users SET notify_prefs = ? WHERE id = ?', JSON.stringify(prefs), user.id);
  return json({ prefs });
});

route('POST', '/api/notify/test', async ({ env, user }) => {
  requireUser(user);
  const r = await notify(env, { to: [user.id], kind: isStaff(user) ? 'task' : 'update', title: 'Notifications are on', body: 'This is how Rightway Hub alerts will look on this device.', url: '/#/', slack: false });
  return json(r);
});

route('GET', '/api/notifications', async ({ env, user }) => {
  requireUser(user);
  const rows = await all(env, 'SELECT id, kind, title, body, url, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 60', user.id);
  return json({ notifications: rows, unread: rows.filter((r) => !r.read_at).length });
});

route('GET', '/api/notifications/unread', async ({ env, user }) => {
  requireUser(user);
  const r = await first(env, 'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', user.id);
  return json({ unread: r?.n || 0 });
});

route('POST', '/api/notifications/read', async ({ env, user, body }) => {
  requireUser(user);
  const b = await body();
  if (Array.isArray(b.ids) && b.ids.length) {
    const ids = b.ids.slice(0, 100).map(String);
    await run(env, `UPDATE notifications SET read_at = ? WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`, now(), user.id, ...ids);
  } else await run(env, 'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', now(), user.id);
  return json({ ok: true });
});

// Staff can ping a teammate from a task or client ("Kiron, can you take this?").
route('POST', '/api/notify/ping', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const to = await first(env, "SELECT id FROM users WHERE id = ? AND role IN ('admin','team')", b.user);
  if (!to) throw new HttpError('Pick someone on the team.');
  await notify(env, { to: [to.id], kind: 'task', title: `${user.name || 'A teammate'}: ${String(b.title || 'Check this').slice(0, 100)}`, body: String(b.body || '').slice(0, 300), url: String(b.url || '/#/work').slice(0, 300), slack: false });
  return json({ ok: true });
});
