// Each person's own Slack inside the Hub. Everyone connects their own Slack account (Slack sign in with user scopes), so they see
// only their own channels and direct messages and post as themselves. Nobody, owners included, can read someone else's Slack:
// every call here uses the token of the person asking. Tokens are sealed. New messages arrive through Slack's Events API
// (/api/slack/events), which feeds the unread dots and phone notifications for direct messages and mentions.
import { HttpError, json } from './util.js';
import { all, first, run, batch, now, getSettings, setSetting, token as randomToken } from './db.js';
import { requireStaff, requireAdmin } from './auth.js';
import { route } from './router.js';
import { seal, unseal } from './seal.js';
import { slackApi, verified, USER_SCOPES } from './slack.js';
import { notify } from './notify.js';
import { onClientChat } from './chat.js';

const MAX_FILE = 20 * 1024 * 1024;
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

async function appCreds(env) {
  const s = await getSettings(env);
  if (!s.slack_client_id || !s.slack_client_secret) return null;
  return { id: s.slack_client_id, secret: await unseal(env, s.slack_client_secret) };
}

async function me(env, user) {
  requireStaff(user);
  const u = await first(env, 'SELECT id, email, name, slack_token, slack_uid FROM users WHERE id = ?', user.id);
  if (!u?.slack_token) throw new HttpError('Connect your Slack first.', 409);
  return { ...u, token: await unseal(env, u.slack_token) };
}

// People in the workspace, cached for names and photos.
async function people(env, tok, ids) {
  const want = [...new Set(ids.filter(Boolean))];
  if (!want.length) return {};
  const rows = await all(env, `SELECT * FROM slack_people WHERE id IN (${want.map(() => '?').join(',')})`, ...want);
  const out = Object.fromEntries(rows.map((r) => [r.id, r]));
  const stale = want.filter((id) => !out[id] || now() - (out[id].updated_at || 0) > 7 * 864e5).slice(0, 25);
  for (const id of stale) {
    const r = await slackApi(tok, 'users.info', { user: id }, { get: true }).catch(() => null);
    if (!r?.user) continue;
    const p = { id, name: r.user.profile?.display_name || r.user.name || id, real_name: r.user.real_name || r.user.profile?.real_name || '', image: r.user.profile?.image_72 || null, is_bot: r.user.is_bot ? 1 : 0, updated_at: now() };
    await run(env, `INSERT INTO slack_people (id, name, real_name, image, is_bot, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, real_name = excluded.real_name, image = excluded.image, is_bot = excluded.is_bot, updated_at = excluded.updated_at`, p.id, p.name, p.real_name, p.image, p.is_bot, p.updated_at);
    out[id] = p;
  }
  return Object.fromEntries(Object.entries(out).map(([id, p]) => [id, { name: p.real_name || p.name, handle: p.name, image: p.image, bot: Boolean(p.is_bot) }]));
}

function slimMsg(m) {
  return {
    ts: m.ts, user: m.user || m.bot_id || null, botName: m.username || m.bot_profile?.name || null, text: m.text || '', subtype: m.subtype || null,
    thread_ts: m.thread_ts || null, replies: m.reply_count || 0, edited: Boolean(m.edited),
    reactions: (m.reactions || []).map((r) => ({ name: r.name, count: r.count, users: r.users || [] })),
    files: (m.files || []).filter((f) => f.id && f.mode !== 'tombstone').map((f) => ({ id: f.id, name: f.name || f.title || 'file', mimetype: f.mimetype || '', size: f.size || 0, url: f.url_private || null, thumb: f.thumb_360 || f.thumb_480 || null, permalink: f.permalink || null })),
  };
}
const mentionIds = (msgs) => msgs.flatMap((m) => [...String(m.text || '').matchAll(/<@([UW][A-Z0-9]+)/g)].map((x) => x[1]));

// ---------- connect ----------
route('GET', '/api/slack/me', async ({ env, user }) => {
  requireStaff(user);
  const u = await first(env, 'SELECT slack_token, slack_uid FROM users WHERE id = ?', user.id);
  const creds = await appCreds(env);
  const s = await getSettings(env);
  let team = null;
  if (u?.slack_token) team = parse(s.slack_team, null);
  return json({ ready: Boolean(creds), connected: Boolean(u?.slack_token), slackUser: u?.slack_uid || null, team, admin: user.role === 'admin' });
});

route('PUT', '/api/slack/app', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  const id = String(b.clientId || '').trim();
  const secret = String(b.clientSecret || '').trim();
  if (!/^\d+\.\d+$/.test(id)) throw new HttpError('Paste the Client ID from Basic Information (numbers with a dot).');
  if (!/^[a-f0-9]{20,64}$/i.test(secret)) throw new HttpError('Paste the Client Secret from Basic Information.');
  await setSetting(env, 'slack_client_id', id);
  await setSetting(env, 'slack_client_secret', await seal(env, secret));
  return json({ ok: true });
});

route('GET', '/api/slack/oauth/start', async ({ env, user, url }) => {
  requireStaff(user);
  const creds = await appCreds(env);
  if (!creds) throw new HttpError('An owner has to finish the Slack app setup first (Client ID and Secret).', 409);
  const state = `sl_${randomToken(18)}`;
  await run(env, 'DELETE FROM oauth_states WHERE at < ?', now() - 600e3);
  await run(env, 'INSERT INTO oauth_states (state, user_id, at) VALUES (?, ?, ?)', state, user.id, now());
  const q = new URLSearchParams({ client_id: creds.id, user_scope: USER_SCOPES.join(','), redirect_uri: `${url.origin}/api/slack/oauth/callback`, state });
  return Response.redirect(`https://slack.com/oauth/v2/authorize?${q}`, 302);
});

route('GET', '/api/slack/oauth/callback', async ({ env, user, url }) => {
  const back = (msg) => Response.redirect(`${url.origin}/?slack=${encodeURIComponent(msg)}#/slack`, 302);
  if (!user) return back('Log in to the Hub first, then connect Slack.');
  const st = await first(env, 'SELECT * FROM oauth_states WHERE state = ?', url.searchParams.get('state') || '');
  if (st) await run(env, 'DELETE FROM oauth_states WHERE state = ?', st.state);
  if (!st || st.user_id !== user.id || now() - st.at > 600e3) return back('That link expired. Try Connect my Slack again.');
  if (url.searchParams.get('error')) return back('Slack connection was cancelled.');
  const creds = await appCreds(env);
  if (!creds) return back('The Slack app setup is not finished.');
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: creds.id, client_secret: creds.secret, code: url.searchParams.get('code') || '', redirect_uri: `${url.origin}/api/slack/oauth/callback` }),
  });
  const d = await res.json().catch(() => ({}));
  const tok = d.authed_user?.access_token;
  if (!d.ok || !tok) return back(`Slack said: ${d.error || 'no token came back'}`);
  await run(env, 'UPDATE users SET slack_token = ?, slack_uid = ?, slack_id = COALESCE(slack_id, ?) WHERE id = ?', await seal(env, tok), d.authed_user.id, d.authed_user.id, user.id);
  if (d.team?.id) {
    const s = await getSettings(env);
    if (!s.slack_team) await setSetting(env, 'slack_team', JSON.stringify({ id: d.team.id, name: d.team.name }));
  }
  return back('ok');
});

route('POST', '/api/slack/me/disconnect', async ({ env, user }) => {
  requireStaff(user);
  const u = await first(env, 'SELECT slack_token FROM users WHERE id = ?', user.id);
  if (u?.slack_token) await slackApi(await unseal(env, u.slack_token), 'auth.revoke', {}, { form: true }).catch(() => {});
  await batch(env, [['UPDATE users SET slack_token = NULL, slack_uid = NULL WHERE id = ?', user.id], ['DELETE FROM slack_members WHERE user_id = ?', user.id], ['DELETE FROM slack_unread WHERE user_id = ?', user.id]]);
  return json({ ok: true });
});

// ---------- reading ----------
route('GET', '/api/slack/me/conversations', async ({ env, user }) => {
  const u = await me(env, user);
  const list = [];
  let cursor = '';
  for (let i = 0; i < 4; i++) {
    const r = await slackApi(u.token, 'users.conversations', { types: 'public_channel,private_channel,mpim,im', exclude_archived: 'true', limit: '200', ...(cursor ? { cursor } : {}) }, { get: true });
    list.push(...(r.channels || []));
    cursor = r.response_metadata?.next_cursor || '';
    if (!cursor) break;
  }
  // Remember who is in what, so new message events can light up the right people's dots.
  await batch(env, [['DELETE FROM slack_members WHERE user_id = ?', u.id], ...list.map((c) => ['INSERT OR IGNORE INTO slack_members (user_id, channel_id) VALUES (?, ?)', u.id, c.id])]);
  const unread = Object.fromEntries((await all(env, 'SELECT channel_id, count, mentions FROM slack_unread WHERE user_id = ?', u.id)).map((r) => [r.channel_id, r]));
  const ppl = await people(env, u.token, list.filter((c) => c.is_im).map((c) => c.user));
  const out = list.filter((c) => !(c.is_im && c.is_user_deleted)).map((c) => ({
    id: c.id, kind: c.is_im ? 'dm' : c.is_mpim ? 'group' : c.is_private ? 'private' : 'channel',
    name: c.is_im ? (ppl[c.user]?.name || 'Direct message') : c.is_mpim ? String(c.name || '').replace(/^mpdm-/, '').replace(/-\d+$/, '').split('--').join(', ') : c.name,
    user: c.user || null, image: c.is_im ? ppl[c.user]?.image || null : null, topic: c.topic?.value || c.purpose?.value || '',
    unread: unread[c.id]?.count || 0, mentions: unread[c.id]?.mentions || 0, updated: c.updated || 0,
  }));
  return json({ me: u.slack_uid, conversations: out });
});

async function markRead(env, u, channel, ts) {
  await run(env, `INSERT INTO slack_unread (user_id, channel_id, count, mentions, last_ts) VALUES (?, ?, 0, 0, ?)
    ON CONFLICT(user_id, channel_id) DO UPDATE SET count = 0, mentions = 0, last_ts = excluded.last_ts`, u.id, channel, ts || null);
  if (ts) await slackApi(u.token, 'conversations.mark', { channel, ts }, { form: true }).catch(() => {});
}

route('GET', '/api/slack/me/history', async ({ env, user, url }) => {
  const u = await me(env, user);
  const channel = url.searchParams.get('channel') || '';
  if (!/^[CGD][A-Z0-9]+$/.test(channel)) throw new HttpError('Pick a conversation.');
  const q = { channel, limit: '40', ...(url.searchParams.get('cursor') ? { cursor: url.searchParams.get('cursor') } : {}), ...(url.searchParams.get('oldest') ? { oldest: url.searchParams.get('oldest') } : {}) };
  const r = await slackApi(u.token, 'conversations.history', q, { get: true });
  const msgs = (r.messages || []).map(slimMsg);
  const ppl = await people(env, u.token, [...msgs.map((m) => m.user), ...mentionIds(msgs)].filter((x) => /^[UW]/.test(x || '')));
  if (!url.searchParams.get('cursor') && msgs[0]) await markRead(env, u, channel, msgs[0].ts);
  return json({ messages: msgs.reverse(), people: ppl, more: Boolean(r.has_more), cursor: r.response_metadata?.next_cursor || null, me: u.slack_uid });
});

route('GET', '/api/slack/me/replies', async ({ env, user, url }) => {
  const u = await me(env, user);
  const channel = url.searchParams.get('channel') || '';
  const ts = url.searchParams.get('ts') || '';
  if (!/^[CGD][A-Z0-9]+$/.test(channel) || !/^\d+\.\d+$/.test(ts)) throw new HttpError('Pick a thread.');
  const r = await slackApi(u.token, 'conversations.replies', { channel, ts, limit: '100' }, { get: true });
  const msgs = (r.messages || []).map(slimMsg);
  return json({ messages: msgs, people: await people(env, u.token, [...msgs.map((m) => m.user), ...mentionIds(msgs)].filter((x) => /^[UW]/.test(x || ''))), me: u.slack_uid });
});

route('GET', '/api/slack/me/people', async ({ env, user }) => {
  const u = await me(env, user);
  const r = await slackApi(u.token, 'users.list', { limit: '500' }, { get: true });
  const list = (r.members || []).filter((m) => !m.deleted && !m.is_bot && m.id !== 'USLACKBOT').map((m) => ({ id: m.id, name: m.real_name || m.profile?.real_name || m.name, handle: m.profile?.display_name || m.name, image: m.profile?.image_72 || null }));
  return json({ people: list.sort((a, b) => a.name.localeCompare(b.name)), me: u.slack_uid });
});

route('GET', '/api/slack/me/file', async ({ env, user, url }) => {
  const u = await me(env, user);
  const target = url.searchParams.get('u') || '';
  if (!/^https:\/\/files\.slack\.com\//.test(target)) throw new HttpError('Not a Slack file.', 400);
  const res = await fetch(target, { headers: { authorization: `Bearer ${u.token}` } });
  if (!res.ok) throw new HttpError('Slack did not return the file.', 502);
  return new Response(res.body, { headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'private, max-age=3600' } });
});

route('GET', '/api/slack/me/unreads', async ({ env, user }) => {
  requireStaff(user);
  const rows = await all(env, 'SELECT channel_id, count, mentions FROM slack_unread WHERE user_id = ? AND count > 0', user.id);
  return json({ unreads: Object.fromEntries(rows.map((r) => [r.channel_id, { count: r.count, mentions: r.mentions }])) });
});

route('GET', '/api/slack/me/unread', async ({ env, user }) => {
  requireStaff(user);
  const r = await first(env, 'SELECT COALESCE(SUM(count), 0) AS n, COALESCE(SUM(mentions), 0) AS m FROM slack_unread WHERE user_id = ?', user.id);
  return json({ unread: r?.n || 0, mentions: r?.m || 0 });
});

// ---------- writing ----------
const chanOk = (c) => /^[CGD][A-Z0-9]+$/.test(String(c || ''));
const tsOk = (t) => !t || /^\d+\.\d+$/.test(String(t));

route('POST', '/api/slack/me/send', async ({ env, user, body }) => {
  const u = await me(env, user);
  const b = await body();
  const text = String(b.text || '').slice(0, 8000);
  if (!chanOk(b.channel) || !tsOk(b.thread_ts)) throw new HttpError('Pick a conversation.');
  if (!text.trim()) throw new HttpError('Type a message first.');
  const r = await slackApi(u.token, 'chat.postMessage', { channel: b.channel, text, ...(b.thread_ts ? { thread_ts: b.thread_ts } : {}), unfurl_links: true });
  await markRead(env, u, b.channel, r.ts);
  return json({ ts: r.ts });
});

route('POST', '/api/slack/me/edit', async ({ env, user, body }) => {
  const u = await me(env, user);
  const b = await body();
  if (!chanOk(b.channel) || !tsOk(b.ts) || !b.ts) throw new HttpError('Pick a message.');
  if (b.remove) await slackApi(u.token, 'chat.delete', { channel: b.channel, ts: b.ts });
  else await slackApi(u.token, 'chat.update', { channel: b.channel, ts: b.ts, text: String(b.text || '').slice(0, 8000) });
  return json({ ok: true });
});

route('POST', '/api/slack/me/react', async ({ env, user, body }) => {
  const u = await me(env, user);
  const b = await body();
  const name = String(b.name || '').replace(/:/g, '').toLowerCase();
  if (!chanOk(b.channel) || !tsOk(b.ts) || !/^[a-z0-9_+-]{1,60}$/.test(name)) throw new HttpError('Pick a reaction.');
  await slackApi(u.token, b.remove ? 'reactions.remove' : 'reactions.add', { channel: b.channel, timestamp: b.ts, name }).catch((e) => { if (!/already_reacted|no_reaction/.test(e.message)) throw e; });
  return json({ ok: true });
});

route('POST', '/api/slack/me/open', async ({ env, user, body }) => {
  const u = await me(env, user);
  const b = await body();
  const users = (Array.isArray(b.users) ? b.users : []).filter((x) => /^[UW][A-Z0-9]+$/.test(x)).slice(0, 8);
  if (!users.length) throw new HttpError('Pick someone.');
  const r = await slackApi(u.token, 'conversations.open', { users: users.join(',') }, { form: true });
  return json({ channel: r.channel?.id });
});

// Files go up with Slack's upload flow: ask for an upload address, send the bytes, then finish into the conversation.
route('POST', '/api/slack/me/upload', async ({ env, user, request }) => {
  const u = await me(env, user);
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const channel = String(form?.get('channel') || '');
  const thread = String(form?.get('thread_ts') || '');
  if (!file || typeof file === 'string') throw new HttpError('Pick a file.');
  if (!chanOk(channel) || !tsOk(thread)) throw new HttpError('Pick a conversation.');
  if (file.size > MAX_FILE) throw new HttpError('Files up to 20 MB from the Hub.');
  const bytes = await file.arrayBuffer();
  const up = await slackApi(u.token, 'files.getUploadURLExternal', { filename: file.name || 'file', length: String(bytes.byteLength) }, { form: true });
  const put = await fetch(up.upload_url, { method: 'POST', body: bytes, headers: { 'content-type': file.type || 'application/octet-stream' } });
  if (!put.ok) throw new HttpError('Slack did not take the file.', 502);
  const comment = String(form.get('comment') || '').slice(0, 4000);
  await slackApi(u.token, 'files.completeUploadExternal', { files: [{ id: up.file_id, title: file.name || 'file' }], channel_id: channel, ...(comment ? { initial_comment: comment } : {}), ...(thread ? { thread_ts: thread } : {}) });
  return json({ ok: true });
});

// Share a Hub item (client, lead, task, report) into a conversation as a message with a link back.
export async function itemMessage(env, type, id, origin) {
  if (type === 'client') {
    const c = await first(env, 'SELECT id, name, plan, address FROM clients WHERE id = ?', id);
    if (!c) return null;
    const s = await first(env, 'SELECT keyword, summary FROM scans WHERE client_id = ? ORDER BY created_at DESC LIMIT 1', c.id);
    const sm = parse(s?.summary, null);
    return `*Client: ${c.name}*${c.address ? `\n${c.address}` : ''}${sm ? `\nFirst page (top 10): ${sm.top10Pct ?? 0}% for "${s.keyword}"` : ''}\n<${origin}/#/client/${c.id}/overview|Open in the Hub>`;
  }
  if (type === 'lead') {
    const l = await first(env, 'SELECT id, business, contact_name, phone, stage, next_action FROM leads WHERE id = ?', id);
    if (!l) return null;
    return `*Lead: ${l.business}*${l.contact_name ? ` (${l.contact_name})` : ''}\n${[l.phone, l.stage].filter(Boolean).join(' · ')}${l.next_action ? `\nNext: ${l.next_action}` : ''}\n<${origin}/#/pipeline|Open the pipeline>`;
  }
  if (type === 'task') {
    const t = await first(env, 'SELECT t.id, t.title, t.due, t.status, c.name FROM tasks t JOIN clients c ON c.id = t.client_id WHERE t.id = ?', id);
    if (!t) return null;
    return `*Task: ${t.title}*\n${t.name}${t.due ? ` · due ${t.due}` : ''} · ${t.status === 'doing' ? 'in progress' : t.status}\n<${origin}/#/work/task/${t.id}|Open the task>`;
  }
  if (type === 'report') {
    const r = await first(env, 'SELECT r.month, r.token, c.name FROM reports r JOIN clients c ON c.id = r.client_id WHERE r.id = ?', id);
    if (!r) return null;
    return `*${r.name}: ${r.month} report*\n<${origin}/report.html#${r.token}|Open the report>`;
  }
  return null;
}

route('GET', '/api/slack/me/items', async ({ env, user, url }) => {
  requireStaff(user);
  const q = `%${String(url.searchParams.get('q') || '').toLowerCase().slice(0, 60)}%`;
  const [clients, leads, tasks, reports] = await Promise.all([
    all(env, "SELECT id, name AS label, 'client' AS type FROM clients WHERE lower(name) LIKE ? AND status != 'cancelled' ORDER BY name LIMIT 6", q),
    all(env, "SELECT id, business AS label, 'lead' AS type FROM leads WHERE lower(business) LIKE ? ORDER BY updated_at DESC LIMIT 6", q),
    all(env, "SELECT t.id, t.title || ' (' || c.name || ')' AS label, 'task' AS type FROM tasks t JOIN clients c ON c.id = t.client_id WHERE t.status IN ('todo','doing') AND (lower(t.title) LIKE ? OR lower(c.name) LIKE ?) ORDER BY t.due LIMIT 6", q, q),
    all(env, "SELECT r.id, c.name || ' ' || r.month || ' report' AS label, 'report' AS type FROM reports r JOIN clients c ON c.id = r.client_id WHERE lower(c.name) LIKE ? ORDER BY r.month DESC LIMIT 4", q),
  ]);
  return json({ items: [...clients, ...leads, ...tasks, ...reports] });
});

route('POST', '/api/slack/me/share', async ({ env, user, body, url }) => {
  const u = await me(env, user);
  const b = await body();
  if (!chanOk(b.channel) || !tsOk(b.thread_ts)) throw new HttpError('Pick a conversation.');
  const msg = await itemMessage(env, b.type, String(b.id || ''), url.origin);
  if (!msg) throw new HttpError('That item is gone.', 404);
  const note = String(b.note || '').trim().slice(0, 2000);
  const r = await slackApi(u.token, 'chat.postMessage', { channel: b.channel, text: note ? `${note}\n${msg}` : msg, ...(b.thread_ts ? { thread_ts: b.thread_ts } : {}), unfurl_links: false });
  return json({ ts: r.ts });
});

// ---------- new messages from Slack (Events API) ----------
// For each new message: everyone in the Hub who is in that conversation (except the sender) gets an unread count. Direct messages
// and @mentions also buzz their phone (alert kind "slack", not added to the Alerts list).
export async function onSlackMessage(env, ev) {
  if (!ev || ev.type !== 'message' || !ev.channel) return 0;
  await onClientChat(env, ev).catch((e) => console.error('client chat', e));
  if (ev.subtype && !['file_share', 'thread_broadcast', 'bot_message'].includes(ev.subtype)) return 0;
  if (ev.thread_ts && ev.thread_ts !== ev.ts && ev.subtype !== 'thread_broadcast') return 0; // thread replies stay in the thread
  const members = await all(env, 'SELECT u.id, u.slack_uid FROM slack_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? AND u.slack_token IS NOT NULL', ev.channel);
  let n = 0;
  for (const m of members) {
    if (m.slack_uid && m.slack_uid === ev.user) continue;
    const mention = Boolean(m.slack_uid && String(ev.text || '').includes(`<@${m.slack_uid}>`));
    const dm = ev.channel_type === 'im';
    await run(env, `INSERT INTO slack_unread (user_id, channel_id, count, mentions, last_ts) VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(user_id, channel_id) DO UPDATE SET count = count + 1, mentions = mentions + excluded.mentions, last_ts = excluded.last_ts`, m.id, ev.channel, mention || dm ? 1 : 0, ev.ts || null);
    if (dm || mention) {
      const who = ev.user ? (await first(env, 'SELECT real_name, name FROM slack_people WHERE id = ?', ev.user)) : null;
      const plain = String(ev.text || (ev.files?.length ? 'Sent a file' : '')).replace(/<@[A-Z0-9]+(\|[^>]+)?>/g, '@someone').replace(/<([^|>]+)\|([^>]+)>/g, '$2').replace(/<([^>]+)>/g, '$1').slice(0, 140);
      await notify(env, { to: [m.id], kind: 'slack', title: `${who?.real_name || who?.name || 'Slack'}${dm ? '' : ' mentioned you'}`, body: plain, url: `/#/slack/${ev.channel}`, tag: `slack-${ev.channel}`, slack: false, list: false }).catch(() => {});
    }
    n += 1;
  }
  return n;
}

route('POST', '/api/slack/events', async ({ env, request, defer }) => {
  const { raw } = await verified(env, request);
  const p = parse(raw, {});
  if (p.type === 'url_verification') return json({ challenge: p.challenge });
  if (p.type !== 'event_callback') return json({ ok: true });
  if (p.event_id) {
    if (await first(env, 'SELECT id FROM slack_events WHERE id = ?', p.event_id)) return json({ ok: true }); // Slack retries
    await run(env, 'INSERT INTO slack_events (id, at) VALUES (?, ?)', p.event_id, now());
    await run(env, 'DELETE FROM slack_events WHERE at < ?', now() - 864e5);
  }
  const work = onSlackMessage(env, p.event).catch((e) => console.error('slack event', e));
  if (defer) defer(work); else await work;
  return json({ ok: true });
}, { public: true });
