// Client Messages: each client chats with the team from their own app, without a Slack account. Every client gets a private
// Slack channel (made by the Hub, "chat-<client>"), separate from the internal client update channel. What the client writes
// is posted there by the Rightway Hub app under the client's name; what the team writes in that channel (in Slack, or from the
// client's Messages tab in the Hub) shows in the client's app, with an unread dot and a notification.
// Everything in the chat channel is visible to the client, so internal talk belongs in the other channels.
// Every active client gets this chat automatically once the Slack app is connected (on sign up, or by the cron for older clients),
// and the Hub's client updates (reports, pages to approve, meetings, plans) are posted into it too, so the whole history is in one place.
import { HttpError, json } from './util.js';
import { all, first, run, now, getSettings, setSetting } from './db.js';
import { requireStaff, requireClientAccess, isStaff } from './auth.js';
import { route } from './router.js';
import { unseal } from './seal.js';
import { slackApi, slackState } from './slack.js';
import { notify } from './notify.js';

const MAX_FILE = 20 * 1024 * 1024;
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'client';

async function bot(env) {
  const st = await slackState(env);
  if (!st.bot) throw new HttpError('Messages need the Slack app. An owner connects it on the Alerts page.', 409);
  return { token: await unseal(env, st.bot), st };
}
async function clientOr404(env, id) {
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', id);
  if (!c) throw new HttpError('Client not found.', 404);
  return c;
}
const remember = (env, channel, ts, by) => run(env, 'INSERT OR IGNORE INTO chat_posts (ts, channel, by, at) VALUES (?, ?, ?, ?)', ts, channel, by, now());

// Names and photos of team members, cached.
async function team(env, token, ids) {
  const want = [...new Set(ids.filter((x) => /^[UW][A-Z0-9]+$/.test(x || '')))];
  const out = {};
  for (const id of want) {
    let p = await first(env, 'SELECT * FROM slack_people WHERE id = ?', id);
    if (!p || now() - (p.updated_at || 0) > 7 * 864e5) {
      const r = await slackApi(token, 'users.info', { user: id }, { get: true }).catch(() => null);
      if (r?.user) {
        p = { id, name: r.user.profile?.display_name || r.user.name, real_name: r.user.real_name || '', image: r.user.profile?.image_72 || null };
        await run(env, `INSERT INTO slack_people (id, name, real_name, image, is_bot, updated_at) VALUES (?, ?, ?, ?, 0, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, real_name = excluded.real_name, image = excluded.image, updated_at = excluded.updated_at`, id, p.name, p.real_name, p.image, now());
      }
    }
    if (p) out[id] = { name: p.real_name || p.name, image: p.image };
  }
  return out;
}

function slim(m, people) {
  const meta = m.metadata?.event_type;
  const hub = m.metadata?.event_payload?.hub_user || null;
  const from = meta === 'rw_client_msg' ? 'client' : 'team';
  const name = meta ? String(m.username || '').replace(/\s*\((Rightway Growth|[^)]*)\)\s*$/, '') || (from === 'client' ? 'You' : 'Rightway Growth') : people[m.user]?.name || m.username || 'Rightway Growth';
  return {
    ts: m.ts, from, hubUser: hub, name, note: meta === 'rw_hub_note', image: from === 'team' ? people[m.user]?.image || null : null, text: m.text || '',
    files: (m.files || []).filter((f) => f.id && f.mode !== 'tombstone').map((f) => ({ id: f.id, name: f.name || 'file', image: /^image\//.test(f.mimetype || ''), size: f.size || 0 })),
  };
}

const autoOn = (s) => s.chat_auto !== '0';
const chatEligible = (c) => c && c.status === 'active' && !c.parent_id && !Number(c.sample || 0);

// Make the client's private chat channel, invite the account manager and owners, and say hello to the client.
export async function openClientChat(env, c, { by = null, channel = null } = {}) {
  const { token } = await bot(env);
  let ch = channel;
  if (!ch) {
    const base = `chat-${slug(c.name)}`.slice(0, 70);
    for (const name of [base, `${base}-2`, `${base}-${Date.now().toString(36).slice(-4)}`]) {
      const r = await slackApi(token, 'conversations.create', { name, is_private: true }).catch((e) => ({ error: e.message }));
      if (r.channel?.id) { ch = { id: r.channel.id, name: r.channel.name }; break; }
      if (!/name_taken/.test(r.error || '')) throw new HttpError(r.error || 'Slack would not make the channel.', 502);
    }
    if (!ch) throw new HttpError('Could not find a free channel name. Pick an existing channel instead.');
    const ids = (await all(env, "SELECT slack_id FROM users WHERE slack_id IS NOT NULL AND (role = 'admin' OR id = ?)", c.owner_id || '')).map((u) => u.slack_id);
    if (ids.length) await slackApi(token, 'conversations.invite', { channel: ch.id, users: [...new Set(ids)].join(',') }).catch(() => {});
    // The description is for the team (the client never sees channel notices). The welcome is for the client.
    await slackApi(token, 'conversations.setPurpose', { channel: ch.id, purpose: `Client Messages for ${c.name}. Everything here shows in their Rightway app. Keep internal talk in other channels.`.slice(0, 250) }).catch(() => {});
    const am = c.owner_id ? await first(env, 'SELECT name FROM users WHERE id = ?', c.owner_id) : null;
    const first1 = String(c.contact_name || '').split(/\s+/)[0];
    await chatNote(env, { ...c, chat_channel: ch.id }, `Welcome to Rightway Growth${first1 ? `, ${first1}` : ''}! This is your direct line to your team. Ask anything, send photos of new jobs, and get updates here: your monthly reports, pages to approve and meeting invites all land in this chat.${am?.name ? ` Your account manager is ${am.name}.` : ''}`, { unread: false });
  }
  await run(env, 'UPDATE clients SET chat_channel = ?, chat_channel_name = ? WHERE id = ?', ch.id, ch.name, c.id);
  await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', `l_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`, c.id, 'Messages turned on', now(), by);
  return ch;
}

// A note from the Hub in the client's chat (report ready, page to check, meeting booked). Posted as "Rightway Growth".
export async function chatNote(env, clientOrId, text, { unread = true } = {}) {
  const c = typeof clientOrId === 'string' ? await first(env, 'SELECT id, chat_channel FROM clients WHERE id = ?', clientOrId) : clientOrId;
  if (!c?.chat_channel) return null;
  const st = await slackState(env);
  if (!st.bot) return null;
  const token = await unseal(env, st.bot);
  const r = await slackApi(token, 'chat.postMessage', { channel: c.chat_channel, text: String(text).slice(0, 3000), username: 'Rightway Growth', unfurl_links: false, metadata: { event_type: 'rw_hub_note', event_payload: { hub_user: 'hub' } } }).catch((e) => { console.error('chat note', e); return null; });
  if (!r?.ts) return null;
  await remember(env, c.chat_channel, r.ts, 'hub');
  if (unread) {
    await run(env, `INSERT INTO slack_unread (user_id, channel_id, count, mentions, last_ts)
      SELECT id, ?, 1, 1, NULL FROM users WHERE role = 'client' AND client_id = ? ON CONFLICT(user_id, channel_id) DO UPDATE SET count = count + 1, mentions = mentions + 1`, c.chat_channel, c.id);
  }
  return r.ts;
}

// The account manager changed: add them to the chat so they see the client's messages.
export async function inviteToChat(env, clientId, userIds) {
  const c = await first(env, 'SELECT chat_channel FROM clients WHERE id = ?', clientId);
  if (!c?.chat_channel || !userIds.length) return 0;
  const st = await slackState(env);
  if (!st.bot) return 0;
  const ids = (await all(env, `SELECT slack_id FROM users WHERE slack_id IS NOT NULL AND id IN (${userIds.map(() => '?').join(',')})`, ...userIds)).map((u) => u.slack_id);
  if (!ids.length) return 0;
  await slackApi(await unseal(env, st.bot), 'conversations.invite', { channel: c.chat_channel, users: ids.join(',') }).catch((e) => { if (!/already_in_channel/.test(e.message)) console.error('chat invite', e); });
  return ids.length;
}

// New clients get their chat right away; this also catches clients from before, a couple per run, once the Slack app is connected.
export async function ensureClientChats(env, limit = 2) {
  const s = await getSettings(env);
  if (!autoOn(s)) return 0;
  const st = await slackState(env);
  if (!st.bot) return 0;
  const list = await all(env, `SELECT * FROM clients WHERE chat_channel IS NULL AND status = 'active' AND parent_id IS NULL AND COALESCE(sample, 0) = 0
    AND (chat_tried IS NULL OR chat_tried < ?) ORDER BY created_at DESC LIMIT ?`, now() - 6 * 3600e3, limit);
  let n = 0;
  for (const c of list) {
    await run(env, 'UPDATE clients SET chat_tried = ? WHERE id = ?', now(), c.id);
    try { await openClientChat(env, c); n += 1; } catch (e) { console.error('client chat setup', c.id, e.message); }
  }
  return n;
}
export async function autoChatFor(env, clientId) {
  const s = await getSettings(env);
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', clientId);
  if (!autoOn(s) || !chatEligible(c) || c.chat_channel) return null;
  const st = await slackState(env);
  if (!st.bot) return null;
  await run(env, 'UPDATE clients SET chat_tried = ? WHERE id = ?', now(), c.id);
  return openClientChat(env, c).catch((e) => { console.error('client chat setup', e.message); return null; });
}

route('GET', '/api/clients/:id/chat', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  let c = await clientOr404(env, params.id);
  const staff = isStaff(user);
  const st = await slackState(env);
  if (st.bot && !c.chat_channel && !user.viewAs && await autoChatFor(env, c.id)) c = await clientOr404(env, params.id);
  if (!st.bot || !c.chat_channel) return json({ ready: false, connected: Boolean(st.bot), staff, channelName: c.chat_channel_name || null });
  const { token } = await bot(env);
  const r = await slackApi(token, 'conversations.history', { channel: c.chat_channel, limit: '60', include_all_metadata: 'true' }, { get: true });
  let msgs = (r.messages || []).filter((m) => !['channel_join', 'channel_leave', 'channel_purpose', 'channel_topic', 'channel_name'].includes(m.subtype));
  // Replies the team wrote in a thread show inline, so the client never misses an answer.
  for (const m of msgs.filter((x) => x.reply_count).slice(0, 6)) {
    const rr = await slackApi(token, 'conversations.replies', { channel: c.chat_channel, ts: m.ts, limit: '50', include_all_metadata: 'true' }, { get: true }).catch(() => null);
    msgs = msgs.concat((rr?.messages || []).filter((x) => x.ts !== m.ts));
  }
  const seen = new Set();
  msgs = msgs.filter((m) => (seen.has(m.ts) ? false : seen.add(m.ts))).sort((a, b) => Number(a.ts) - Number(b.ts));
  const people = await team(env, token, msgs.map((m) => m.user));
  await run(env, `INSERT INTO slack_unread (user_id, channel_id, count, mentions, last_ts) VALUES (?, ?, 0, 0, ?)
    ON CONFLICT(user_id, channel_id) DO UPDATE SET count = 0, mentions = 0, last_ts = excluded.last_ts`, user.id, c.chat_channel, msgs.length ? msgs[msgs.length - 1].ts : null);
  return json({ ready: true, staff, channelName: c.chat_channel_name, me: user.id, messages: msgs.map((m) => slim(m, people)) });
});

async function postAs(env, user, c, text) {
  const { token } = await bot(env);
  const staff = isStaff(user);
  if (staff) {
    // Team members with their own Slack connected post as themselves; others post through the app under their name.
    const me = await first(env, 'SELECT slack_token FROM users WHERE id = ?', user.id);
    if (me?.slack_token) {
      const r = await slackApi(await unseal(env, me.slack_token), 'chat.postMessage', { channel: c.chat_channel, text }).catch(() => null);
      if (r?.ts) return r.ts;
    }
    const r = await slackApi(token, 'chat.postMessage', { channel: c.chat_channel, text, username: `${user.name || 'Rightway'} (Rightway Growth)`, metadata: { event_type: 'rw_staff_msg', event_payload: { hub_user: user.id } } });
    return r.ts;
  }
  const r = await slackApi(token, 'chat.postMessage', { channel: c.chat_channel, text, username: `${user.name || c.contact_name || 'Client'} (${c.name})`, metadata: { event_type: 'rw_client_msg', event_payload: { hub_user: user.id } } });
  return r.ts;
}

async function tellOtherSide(env, user, c, text) {
  const plain = String(text || '').slice(0, 140);
  if (isStaff(user)) {
    await notify(env, { to: { clientUsers: c.id }, kind: 'update', title: 'New message from Rightway Growth', body: plain, url: '/#/messages', tag: `chat-${c.id}`, slack: false, list: false }).catch(() => {});
    await run(env, `INSERT INTO slack_unread (user_id, channel_id, count, mentions, last_ts)
      SELECT id, ?, 1, 1, NULL FROM users WHERE role = 'client' AND client_id = ? ON CONFLICT(user_id, channel_id) DO UPDATE SET count = count + 1, mentions = mentions + 1`, c.chat_channel, c.id);
  } else {
    await notify(env, { to: { client: c.id }, kind: 'client', title: `${user.name || 'Client'} (${c.name}) sent a message`, body: plain, url: `/#/client/${c.id}/chat`, tag: `chat-${c.id}`, slack: false }).catch(() => {});
  }
}

route('POST', '/api/clients/:id/chat', async ({ env, user, params, body }) => {
  requireClientAccess(user, params.id);
  if (user.viewAs) throw new HttpError('Client view is read only.', 403);
  const c = await clientOr404(env, params.id);
  if (!c.chat_channel) throw new HttpError('Messages are not turned on for this client yet.', 409);
  const text = String((await body()).text || '').trim().slice(0, 4000);
  if (!text) throw new HttpError('Type a message first.');
  const ts = await postAs(env, user, c, text);
  await remember(env, c.chat_channel, ts, user.id);
  await tellOtherSide(env, user, c, text);
  return json({ ts });
});

route('POST', '/api/clients/:id/chat/upload', async ({ env, user, params, request }) => {
  requireClientAccess(user, params.id);
  if (user.viewAs) throw new HttpError('Client view is read only.', 403);
  const c = await clientOr404(env, params.id);
  if (!c.chat_channel) throw new HttpError('Messages are not turned on for this client yet.', 409);
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') throw new HttpError('Pick a photo or file.');
  if (file.size > MAX_FILE) throw new HttpError('Files up to 20 MB.');
  const { token } = await bot(env);
  const bytes = await file.arrayBuffer();
  const up = await slackApi(token, 'files.getUploadURLExternal', { filename: file.name || 'file', length: String(bytes.byteLength) }, { form: true });
  const put = await fetch(up.upload_url, { method: 'POST', body: bytes, headers: { 'content-type': file.type || 'application/octet-stream' } });
  if (!put.ok) throw new HttpError('Slack did not take the file.', 502);
  const note = String(form.get('comment') || '').slice(0, 2000);
  const who = isStaff(user) ? `${user.name || 'Rightway'} (Rightway Growth)` : `${user.name || 'Client'} (${c.name})`;
  await slackApi(token, 'files.completeUploadExternal', { files: [{ id: up.file_id, title: file.name || 'file' }], channel_id: c.chat_channel, initial_comment: `From ${who}${note ? `: ${note}` : ''}` });
  await tellOtherSide(env, user, c, note || `Sent ${file.name || 'a file'}`);
  return json({ ok: true });
});

// Files in the chat, for the client and the team. Only files shared in that client's chat channel.
route('GET', '/api/clients/:id/chat/file/:fileId', async ({ env, user, params, url }) => {
  requireClientAccess(user, params.id);
  const c = await clientOr404(env, params.id);
  if (!c.chat_channel || !/^F[A-Z0-9]+$/.test(params.fileId)) throw new HttpError('Not found.', 404);
  const { token } = await bot(env);
  const info = await slackApi(token, 'files.info', { file: params.fileId }, { get: true });
  const f = info.file || {};
  const inChannel = [...(f.channels || []), ...(f.groups || []), ...Object.keys(f.shares?.private || {}), ...Object.keys(f.shares?.public || {})].includes(c.chat_channel);
  if (!inChannel) throw new HttpError('Not found.', 404);
  const src = url.searchParams.get('thumb') && (f.thumb_480 || f.thumb_360) ? (f.thumb_480 || f.thumb_360) : f.url_private;
  if (!/^https:\/\/files\.slack\.com\//.test(src || '')) throw new HttpError('Not found.', 404);
  const res = await fetch(src, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new HttpError('Slack did not return the file.', 502);
  return new Response(res.body, { headers: { 'content-type': res.headers.get('content-type') || f.mimetype || 'application/octet-stream', 'cache-control': 'private, max-age=3600', ...(url.searchParams.get('dl') ? { 'content-disposition': `attachment; filename="${String(f.name || 'file').replace(/["\r\n]/g, '')}"` } : {}) } });
});

// Turn Messages on by hand: make a private channel for this client (or use one you pick).
route('POST', '/api/clients/:id/chat/setup', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  const b = await body();
  let channel = null;
  if (b.channel?.id) {
    if (!/^[CG][A-Z0-9]{6,}$/.test(b.channel.id)) throw new HttpError('Pick a channel from the list.');
    channel = { id: b.channel.id, name: String(b.channel.name || '').slice(0, 80) };
  }
  return json({ channel: await openClientChat(env, c, { by: user.id, channel }) });
});

route('PUT', '/api/chat/auto', async ({ env, user, body }) => {
  requireStaff(user);
  if (user.role !== 'admin') throw new HttpError('Owners only.', 403);
  const on = Boolean((await body()).on);
  await setSetting(env, 'chat_auto', on ? '1' : '0');
  return json({ on });
});

route('DELETE', '/api/clients/:id/chat', async ({ env, user, params }) => {
  requireStaff(user);
  await run(env, 'UPDATE clients SET chat_channel = NULL, chat_channel_name = NULL WHERE id = ?', params.id);
  return json({ ok: true });
});

route('GET', '/api/client-badges', async ({ env, user }) => {
  if (!user || user.role !== 'client') return json({ messages: 0 });
  const c = await first(env, 'SELECT chat_channel FROM clients WHERE id = ?', user.client_id);
  const r = c?.chat_channel ? await first(env, 'SELECT count FROM slack_unread WHERE user_id = ? AND channel_id = ?', user.id, c.chat_channel) : null;
  return json({ messages: r?.count || 0 });
});

// From the Events API: a team member wrote in a client's chat channel (in Slack itself). Light the client's dot and buzz them.
export async function onClientChat(env, ev) {
  const c = await first(env, 'SELECT id, name FROM clients WHERE chat_channel = ?', ev.channel);
  if (!c) return false;
  if (ev.bot_id || ev.subtype === 'bot_message') return true; // the Hub's own posts are announced when they are made
  if (ev.ts && await first(env, 'SELECT ts FROM chat_posts WHERE channel = ? AND ts = ?', ev.channel, ev.ts)) return true;
  if (ev.subtype && !['file_share', 'thread_broadcast'].includes(ev.subtype)) return true;
  await run(env, `INSERT INTO slack_unread (user_id, channel_id, count, mentions, last_ts)
    SELECT id, ?, 1, 1, ? FROM users WHERE role = 'client' AND client_id = ? ON CONFLICT(user_id, channel_id) DO UPDATE SET count = count + 1, mentions = mentions + 1, last_ts = excluded.last_ts`, ev.channel, ev.ts || null, c.id);
  const plain = String(ev.text || (ev.files?.length ? 'Sent a file' : '')).replace(/<@[A-Z0-9]+(\|[^>]+)?>/g, '').replace(/<([^|>]+)\|([^>]+)>/g, '$2').replace(/<([^>]+)>/g, '$1').slice(0, 140);
  await notify(env, { to: { clientUsers: c.id }, kind: 'update', title: 'New message from Rightway Growth', body: plain, url: '/#/messages', tag: `chat-${c.id}`, slack: false, list: false }).catch(() => {});
  return true;
}
