// Each person's own Slack inside the Hub. Everyone connects their own Slack account (Slack sign in with user scopes), so they see
// only their own channels and direct messages and post as themselves. Nobody, owners included, can read someone else's Slack:
// every call here uses the token of the person asking. Tokens are sealed. New messages arrive through Slack's Events API
// (/api/slack/events), which feeds the unread dots and phone notifications for direct messages and mentions.
import { HttpError, json } from './util.js';
import { all, first, run, batch, now, getSettings, setSetting, token as randomToken } from './db.js';
import { requireStaff, requireAdmin } from './auth.js';
import { route } from './router.js';
import { seal, unseal } from './seal.js';
import { slackApi, verified, USER_SCOPES, FIRST_USER_SCOPES } from './slack.js';
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

// Text from Block Kit, for messages (mostly apps) that send blocks with no plain text.
export function blocksText(blocks) {
  const out = [];
  const walk = (els) => (els || []).forEach((e) => {
    if (e.type === 'text') out.push(e.text || '');
    else if (e.type === 'link') out.push(e.url ? `<${e.url}${e.text ? `|${e.text}` : ''}>` : '');
    else if (e.type === 'user') out.push(`<@${e.user_id}>`);
    else if (e.type === 'channel') out.push(`<#${e.channel_id}>`);
    else if (e.type === 'emoji') out.push(`:${e.name}:`);
    else if (e.elements) { walk(e.elements); if (/^rich_text_(section|preformatted|quote|list)$/.test(e.type)) out.push('\n'); }
  });
  for (const b of blocks || []) {
    if (b.type === 'section') { if (b.text?.text) out.push(b.text.text, '\n'); (b.fields || []).forEach((f) => out.push(f.text || '', '\n')); }
    else if (b.type === 'header' && b.text?.text) out.push(`*${b.text.text}*`, '\n');
    else if (b.type === 'context') (b.elements || []).forEach((e) => { if (e.text) out.push(e.text, ' '); });
    else if (b.type === 'rich_text') walk(b.elements);
  }
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

export function slimMsg(m) {
  return {
    ts: m.ts, user: m.user || m.bot_id || null, botName: m.username || m.bot_profile?.name || null, botImage: m.icons?.image_48 || m.bot_profile?.icons?.image_48 || null,
    text: m.text || blocksText(m.blocks) || '', subtype: m.subtype || null,
    thread_ts: m.thread_ts || null, replies: m.reply_count || 0, replyUsers: (m.reply_users || []).slice(0, 4), lastReply: m.latest_reply || null,
    edited: Boolean(m.edited), pinned: Boolean(m.pinned_to?.length),
    reactions: (m.reactions || []).map((r) => ({ name: r.name, count: r.count, users: r.users || [] })),
    files: (m.files || []).filter((f) => f.id && f.mode !== 'tombstone').map((f) => ({ id: f.id, name: f.name || f.title || 'file', mimetype: f.mimetype || '', size: f.size || 0, url: f.url_private || null, thumb: f.thumb_360 || f.thumb_480 || null, permalink: f.permalink || null })),
    // Link previews (Slack's unfurls) and app attachments.
    attachments: (m.attachments || []).slice(0, 4).map((a) => ({
      service: a.service_name || a.author_name || null, icon: a.service_icon || a.author_icon || null, title: a.title || null,
      link: a.title_link || a.from_url || a.original_url || null, text: String(a.text || (a.title ? '' : a.fallback) || '').slice(0, 700),
      image: a.image_url || a.thumb_url || null, color: a.color || null, msg: Boolean(a.is_msg_unfurl), footer: a.footer || null,
    })).filter((a) => a.title || a.text || a.image),
  };
}
const chanOk = (c) => /^[CGD][A-Z0-9]+$/.test(String(c || ''));
const tsOk = (t) => !t || /^\d+\.\d+$/.test(String(t));
const userOk = (x) => /^[UW][A-Z0-9]+$/.test(String(x || ''));
const mentionIds = (msgs) => msgs.flatMap((m) => [...String(m.text || '').matchAll(/<@([UW][A-Z0-9]+)/g)].map((x) => x[1]));

// ---------- connect ----------
route('GET', '/api/slack/me', async ({ env, user }) => {
  requireStaff(user);
  const u = await first(env, 'SELECT slack_token, slack_uid, slack_scopes FROM users WHERE id = ?', user.id);
  const creds = await appCreds(env);
  const s = await getSettings(env);
  let team = null;
  if (u?.slack_token) team = parse(s.slack_team, null);
  const granted = u?.slack_scopes ? u.slack_scopes.split(',') : FIRST_USER_SCOPES;
  const missing = u?.slack_token ? USER_SCOPES.filter((x) => !granted.includes(x)) : [];
  return json({ ready: Boolean(creds), connected: Boolean(u?.slack_token), slackUser: u?.slack_uid || null, team, admin: user.role === 'admin', missing });
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
  await run(env, 'UPDATE users SET slack_token = ?, slack_uid = ?, slack_scopes = ?, slack_id = COALESCE(slack_id, ?) WHERE id = ?', await seal(env, tok), d.authed_user.id, String(d.authed_user.scope || '').slice(0, 2000) || null, d.authed_user.id, user.id);
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
  await batch(env, [['UPDATE users SET slack_token = NULL, slack_uid = NULL, slack_scopes = NULL WHERE id = ?', user.id], ['DELETE FROM slack_members WHERE user_id = ?', user.id], ['DELETE FROM slack_unread WHERE user_id = ?', user.id]]);
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
  // Client Messages channels show as their own section, under the client's name.
  const chats = Object.fromEntries((await all(env, 'SELECT id, name, chat_channel FROM clients WHERE chat_channel IS NOT NULL')).map((c) => [c.chat_channel, c]));
  const out = list.filter((c) => !(c.is_im && c.is_user_deleted)).map((c) => ({
    id: c.id, kind: chats[c.id] ? 'client' : c.is_im ? 'dm' : c.is_mpim ? 'group' : c.is_private ? 'private' : 'channel', clientId: chats[c.id]?.id || null, private: Boolean(c.is_private),
    name: chats[c.id] ? chats[c.id].name : c.is_im ? (ppl[c.user]?.name || 'Direct message') : c.is_mpim ? String(c.name || '').replace(/^mpdm-/, '').replace(/-\d+$/, '').split('--').join(', ') : c.name,
    slackName: c.name || null, user: c.user || null, image: c.is_im ? ppl[c.user]?.image || null : null, topic: c.topic?.value || c.purpose?.value || '',
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
  const sp = url.searchParams;
  const latest = tsOk(sp.get('latest')) ? sp.get('latest') : '';
  const q = { channel, limit: '40', ...(sp.get('cursor') ? { cursor: sp.get('cursor') } : {}), ...(sp.get('oldest') ? { oldest: sp.get('oldest') } : {}), ...(latest ? { latest, inclusive: 'true' } : {}) };
  const r = await slackApi(u.token, 'conversations.history', q, { get: true });
  const msgs = (r.messages || []).map(slimMsg);
  const ppl = await people(env, u.token, [...msgs.map((m) => m.user), ...mentionIds(msgs)].filter((x) => /^[UW]/.test(x || '')));
  if (!sp.get('cursor') && !latest && !sp.get('nomark') && msgs[0]) await markRead(env, u, channel, msgs[0].ts);
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
  // The whole list fills the name cache, so member lists and messages do not look people up one by one.
  const at = now();
  await batch(env, (r.members || []).filter((m) => m.id).slice(0, 500).map((m) => [`INSERT INTO slack_people (id, name, real_name, image, is_bot, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, real_name = excluded.real_name, image = excluded.image, is_bot = excluded.is_bot, updated_at = excluded.updated_at`,
  m.id, m.profile?.display_name || m.name || m.id, m.real_name || m.profile?.real_name || '', m.profile?.image_72 || null, m.is_bot ? 1 : 0, at])).catch(() => {});
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
  const act = await first(env, 'SELECT COUNT(*) AS n FROM slack_activity WHERE user_id = ? AND seen = 0', user.id);
  return json({ unreads: Object.fromEntries(rows.map((r) => [r.channel_id, { count: r.count, mentions: r.mentions }])), activity: act?.n || 0 });
});

route('GET', '/api/slack/me/unread', async ({ env, user }) => {
  requireStaff(user);
  const r = await first(env, 'SELECT COALESCE(SUM(count), 0) AS n, COALESCE(SUM(mentions), 0) AS m FROM slack_unread WHERE user_id = ?', user.id);
  return json({ unread: r?.n || 0, mentions: r?.m || 0 });
});

// ---------- writing ----------

route('POST', '/api/slack/me/send', async ({ env, user, body }) => {
  const u = await me(env, user);
  const b = await body();
  const text = String(b.text || '').slice(0, 8000);
  if (!chanOk(b.channel) || !tsOk(b.thread_ts)) throw new HttpError('Pick a conversation.');
  if (!text.trim()) throw new HttpError('Type a message first.');
  const r = await slackApi(u.token, 'chat.postMessage', { channel: b.channel, text, ...(b.thread_ts ? { thread_ts: b.thread_ts, ...(b.broadcast ? { reply_broadcast: true } : {}) } : {}), unfurl_links: true });
  if (!b.thread_ts) await markRead(env, u, b.channel, r.ts);
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

// ---------- search, activity, emoji ----------
const threadOf = (link) => { const m = String(link || '').match(/[?&]thread_ts=(\d+\.\d+)/); return m ? m[1] : null; };

route('GET', '/api/slack/me/search', async ({ env, user, url }) => {
  const u = await me(env, user);
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 200);
  if (!q) return json({ matches: [], total: 0, page: 1, pages: 1, people: {} });
  const page = Math.max(1, Math.min(50, Number(url.searchParams.get('page')) || 1));
  const r = await slackApi(u.token, 'search.messages', { query: q, count: '30', page: String(page), sort: url.searchParams.get('sort') === 'score' ? 'score' : 'timestamp', sort_dir: 'desc' }, { get: true });
  const matches = (r.messages?.matches || []).map((m) => ({
    ts: m.ts, user: m.user || null, username: m.username || null, text: m.text || blocksText(m.blocks) || '', permalink: m.permalink || null, thread_ts: threadOf(m.permalink),
    channel: { id: m.channel?.id || null, name: m.channel?.is_im ? null : m.channel?.name || null, kind: m.channel?.is_im ? 'dm' : m.channel?.is_mpim ? 'group' : m.channel?.is_private ? 'private' : 'channel' },
  }));
  const ppl = await people(env, u.token, [...matches.map((m) => m.user), ...mentionIds(matches)].filter(userOk));
  return json({ matches, total: r.messages?.total || 0, page, pages: r.messages?.paging?.pages || 1, people: ppl });
});

// Activity: mentions of you and replies to your threads, saved as they arrive from Slack.
route('GET', '/api/slack/me/activity', async ({ env, user }) => {
  const u = await me(env, user);
  const rows = await all(env, 'SELECT * FROM slack_activity WHERE user_id = ? ORDER BY at DESC LIMIT 80', u.id);
  const items = rows.map((r) => ({ id: r.id, kind: r.kind, channel: r.channel_id, ts: r.ts, thread_ts: r.thread_ts, user: r.from_id, text: r.text || '', at: r.at, seen: Boolean(r.seen) }));
  return json({ items, people: await people(env, u.token, [...items.map((i) => i.user), ...mentionIds(items)].filter(userOk)), unseen: items.filter((i) => !i.seen).length });
});
route('POST', '/api/slack/me/activity/seen', async ({ env, user }) => {
  requireStaff(user);
  await run(env, 'UPDATE slack_activity SET seen = 1 WHERE user_id = ? AND seen = 0', user.id);
  return json({ ok: true });
});

// The workspace's own emoji, cached for six hours (one list for everyone).
route('GET', '/api/slack/me/emoji', async ({ env, user }) => {
  const u = await me(env, user);
  const s = await getSettings(env);
  const cache = parse(s.slack_emoji, null);
  if (cache && now() - cache.at < 6 * 3600e3) return json({ emoji: cache.emoji });
  const r = await slackApi(u.token, 'emoji.list', {}, { get: true }).catch(() => null);
  if (!r) return json({ emoji: cache?.emoji || {} });
  const raw = r.emoji || {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    let val = String(v || '');
    for (let i = 0; i < 3 && val.startsWith('alias:'); i++) val = raw[val.slice(6)] ? String(raw[val.slice(6)]) : `std:${val.slice(6)}`;
    if (/^https:\/\//.test(val) || /^std:[a-z0-9_+-]+$/.test(val)) out[k] = val;
    if (Object.keys(out).length >= 800) break;
  }
  await setSetting(env, 'slack_emoji', JSON.stringify({ at: now(), emoji: out }));
  return json({ emoji: out });
});

// ---------- channels ----------
route('GET', '/api/slack/me/browse', async ({ env, user }) => {
  const u = await me(env, user);
  const list = [];
  let cursor = '';
  for (let i = 0; i < 5; i++) {
    const r = await slackApi(u.token, 'conversations.list', { types: 'public_channel', exclude_archived: 'true', limit: '200', ...(cursor ? { cursor } : {}) }, { get: true });
    list.push(...(r.channels || []));
    cursor = r.response_metadata?.next_cursor || '';
    if (!cursor) break;
  }
  return json({ channels: list.map((c) => ({ id: c.id, name: c.name, topic: c.topic?.value || '', purpose: c.purpose?.value || '', members: c.num_members || 0, member: Boolean(c.is_member) })).sort((a, b) => b.members - a.members || a.name.localeCompare(b.name)) });
});

export const channelName = (s) => String(s || '').toLowerCase().trim().replace(/^#/, '').replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const nice = (e, map) => { const k = Object.keys(map).find((x) => e.message.includes(x)); return k ? new HttpError(map[k]) : e; };

route('POST', '/api/slack/me/channel', async ({ env, user, body }) => {
  const u = await me(env, user);
  const b = await body();
  const a = String(b.action || '');
  const users = (Array.isArray(b.users) ? b.users : []).filter(userOk).slice(0, 30);
  if (a === 'create') {
    const name = channelName(b.name);
    if (!name) throw new HttpError('Give the channel a name.');
    const r = await slackApi(u.token, 'conversations.create', { name, is_private: Boolean(b.private) }).catch((e) => { throw nice(e, { name_taken: 'That name is taken. Try another.', invalid_name: 'Use letters, numbers and dashes.' }); });
    const id = r.channel.id;
    if (b.purpose) await slackApi(u.token, 'conversations.setPurpose', { channel: id, purpose: String(b.purpose).slice(0, 250) }).catch(() => {});
    if (users.length) await slackApi(u.token, 'conversations.invite', { channel: id, users: users.join(',') }).catch(() => {});
    await run(env, 'INSERT OR IGNORE INTO slack_members (user_id, channel_id) VALUES (?, ?)', u.id, id);
    return json({ channel: { id, name: r.channel.name, private: Boolean(b.private) } });
  }
  if (!chanOk(b.channel)) throw new HttpError('Pick a channel.');
  const channel = b.channel;
  if (a === 'join') {
    await slackApi(u.token, 'conversations.join', { channel });
    await run(env, 'INSERT OR IGNORE INTO slack_members (user_id, channel_id) VALUES (?, ?)', u.id, channel);
  } else if (a === 'leave') {
    await slackApi(u.token, 'conversations.leave', { channel }).catch((e) => { throw nice(e, { cant_leave_general: 'Nobody can leave the main channel.', last_member: 'You are the last person here.' }); });
    await batch(env, [['DELETE FROM slack_members WHERE user_id = ? AND channel_id = ?', u.id, channel], ['DELETE FROM slack_unread WHERE user_id = ? AND channel_id = ?', u.id, channel]]);
  } else if (a === 'invite') {
    if (!users.length) throw new HttpError('Pick people to add.');
    await slackApi(u.token, 'conversations.invite', { channel, users: users.join(',') }).catch((e) => { if (!/already_in_channel/.test(e.message)) throw e; });
  } else if (a === 'topic') {
    await slackApi(u.token, 'conversations.setTopic', { channel, topic: String(b.text || '').slice(0, 250) });
  } else if (a === 'purpose') {
    await slackApi(u.token, 'conversations.setPurpose', { channel, purpose: String(b.text || '').slice(0, 250) });
  } else if (a === 'rename') {
    const name = channelName(b.name);
    if (!name) throw new HttpError('Give the channel a name.');
    await slackApi(u.token, 'conversations.rename', { channel, name }).catch((e) => { throw nice(e, { name_taken: 'That name is taken.', not_authorized: 'Only the channel maker or an admin can rename it.' }); });
  } else throw new HttpError('Unknown action.');
  return json({ ok: true });
});

// About, members, pins and files for the details panel. Each part is fetched on its own so one missing permission blanks one part.
route('GET', '/api/slack/me/details', async ({ env, user, url }) => {
  const u = await me(env, user);
  const channel = url.searchParams.get('channel') || '';
  if (!chanOk(channel)) throw new HttpError('Pick a conversation.');
  const [info, mem, pins, files] = await Promise.all([
    slackApi(u.token, 'conversations.info', { channel, include_num_members: 'true' }, { get: true }).catch(() => null),
    slackApi(u.token, 'conversations.members', { channel, limit: '200' }, { get: true }).catch(() => null),
    slackApi(u.token, 'pins.list', { channel }, { get: true }).catch(() => null),
    slackApi(u.token, 'files.list', { channel, count: '30' }, { get: true }).catch(() => null),
  ]);
  const c = info?.channel || {};
  const members = mem?.members || [];
  const pinned = (pins?.items || []).filter((p) => p.message).map((p) => slimMsg(p.message));
  const fl = (files?.files || []).map((f) => ({ id: f.id, name: f.name || f.title || 'file', mimetype: f.mimetype || '', size: f.size || 0, url: f.url_private || null, thumb: f.thumb_360 || null, permalink: f.permalink || null, created: f.created || 0, user: f.user || null }));
  const ppl = await people(env, u.token, [...members.slice(0, 80), ...pinned.map((m) => m.user), ...mentionIds(pinned), ...fl.map((f) => f.user), c.creator, c.user].filter(userOk));
  return json({
    info: { id: channel, name: c.name || null, topic: c.topic?.value || '', purpose: c.purpose?.value || '', created: c.created || null, creator: c.creator || null, count: c.num_members || members.length,
      private: Boolean(c.is_private), im: Boolean(c.is_im), mpim: Boolean(c.is_mpim), general: Boolean(c.is_general), user: c.user || null },
    members, pins: pinned, files: fl, people: ppl, me: u.slack_uid, parts: { info: Boolean(info), members: Boolean(mem), pins: Boolean(pins), files: Boolean(files) },
  });
});

// ---------- message actions ----------
route('POST', '/api/slack/me/pin', async ({ env, user, body }) => {
  const u = await me(env, user);
  const b = await body();
  if (!chanOk(b.channel) || !b.ts || !tsOk(b.ts)) throw new HttpError('Pick a message.');
  await slackApi(u.token, b.remove ? 'pins.remove' : 'pins.add', { channel: b.channel, timestamp: b.ts }).catch((e) => { if (!/already_pinned|no_pin/.test(e.message)) throw e; });
  return json({ ok: true });
});

route('GET', '/api/slack/me/permalink', async ({ env, user, url }) => {
  const u = await me(env, user);
  const channel = url.searchParams.get('channel') || '';
  const ts = url.searchParams.get('ts') || '';
  if (!chanOk(channel) || !ts || !tsOk(ts)) throw new HttpError('Pick a message.');
  const r = await slackApi(u.token, 'chat.getPermalink', { channel, message_ts: ts }, { get: true });
  return json({ link: r.permalink });
});

route('POST', '/api/slack/me/forward', async ({ env, user, body }) => {
  const u = await me(env, user);
  const b = await body();
  if (!chanOk(b.from) || !b.ts || !tsOk(b.ts) || !chanOk(b.to)) throw new HttpError('Pick a message and where to send it.');
  const { permalink } = await slackApi(u.token, 'chat.getPermalink', { channel: b.from, message_ts: b.ts }, { get: true });
  const note = String(b.note || '').trim().slice(0, 3000);
  const r = await slackApi(u.token, 'chat.postMessage', { channel: b.to, text: note ? `${note}\n${permalink}` : permalink, unfurl_links: true });
  return json({ ts: r.ts });
});

// Remind me about a message (or anything) at a time. Slackbot sends the reminder, like in Slack.
route('POST', '/api/slack/me/remind', async ({ env, user, body }) => {
  const u = await me(env, user);
  const b = await body();
  const time = Math.floor(Number(b.time) || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (time < nowSec + 30 || time > nowSec + 366 * 86400) throw new HttpError('Pick a time in the future.');
  let text = String(b.text || '').trim().slice(0, 500);
  if (b.channel && b.ts) {
    if (!chanOk(b.channel) || !tsOk(b.ts)) throw new HttpError('Pick a message.');
    const { permalink } = await slackApi(u.token, 'chat.getPermalink', { channel: b.channel, message_ts: b.ts }, { get: true });
    text = `${text || 'Look at this message'}: ${permalink}`;
  }
  if (!text) throw new HttpError('What should the reminder say?');
  await slackApi(u.token, 'reminders.add', { text, time: String(time) }, { form: true });
  return json({ ok: true });
});

// One microsecond before a message: where the read line goes when you mark it unread.
export function beforeTs(ts) {
  const [sec, micro = '0'] = String(ts).split('.');
  const m = Number(micro.padEnd(6, '0'));
  return m > 0 ? `${sec}.${String(m - 1).padStart(6, '0')}` : `${Number(sec) - 1}.999999`;
}
route('POST', '/api/slack/me/unread', async ({ env, user, body }) => {
  const u = await me(env, user);
  const b = await body();
  if (!chanOk(b.channel) || !b.ts || !tsOk(b.ts)) throw new HttpError('Pick a message.');
  const at = beforeTs(b.ts);
  const count = Math.max(1, Math.min(999, Math.floor(Number(b.count) || 1)));
  await slackApi(u.token, 'conversations.mark', { channel: b.channel, ts: at }, { form: true }).catch(() => {});
  await run(env, `INSERT INTO slack_unread (user_id, channel_id, count, mentions, last_ts) VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(user_id, channel_id) DO UPDATE SET count = excluded.count, mentions = 0, last_ts = excluded.last_ts`, u.id, b.channel, count, at);
  return json({ ok: true });
});

// ---------- scheduled messages ----------
route('POST', '/api/slack/me/schedule', async ({ env, user, body }) => {
  const u = await me(env, user);
  const b = await body();
  const text = String(b.text || '').slice(0, 8000);
  const at = Math.floor(Number(b.post_at) || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!chanOk(b.channel) || !tsOk(b.thread_ts)) throw new HttpError('Pick a conversation.');
  if (!text.trim()) throw new HttpError('Type a message first.');
  if (at < nowSec + 60 || at > nowSec + 119 * 86400) throw new HttpError('Pick a time at least a minute from now and within 4 months.');
  const r = await slackApi(u.token, 'chat.scheduleMessage', { channel: b.channel, text, post_at: at, ...(b.thread_ts ? { thread_ts: b.thread_ts } : {}), unfurl_links: true });
  return json({ id: r.scheduled_message_id, post_at: r.post_at || at });
});
route('GET', '/api/slack/me/scheduled', async ({ env, user, url }) => {
  const u = await me(env, user);
  const channel = url.searchParams.get('channel') || '';
  const r = await slackApi(u.token, 'chat.scheduledMessages.list', { ...(chanOk(channel) ? { channel } : {}), limit: '100' });
  return json({ messages: (r.scheduled_messages || []).map((m) => ({ id: m.id, channel: m.channel_id, post_at: m.post_at, text: m.text || '' })).sort((a, b) => a.post_at - b.post_at) });
});
route('POST', '/api/slack/me/scheduled/delete', async ({ env, user, body }) => {
  const u = await me(env, user);
  const b = await body();
  if (!chanOk(b.channel) || !/^Q[A-Z0-9]+$/.test(String(b.id || ''))) throw new HttpError('Pick a scheduled message.');
  await slackApi(u.token, 'chat.deleteScheduledMessage', { channel: b.channel, scheduled_message_id: b.id });
  return json({ ok: true });
});

// ---------- you: status, away, pause notifications, profiles ----------
route('GET', '/api/slack/me/status', async ({ env, user }) => {
  const u = await me(env, user);
  const [p, pres, dnd] = await Promise.all([
    slackApi(u.token, 'users.profile.get', {}, { get: true }).catch(() => null),
    slackApi(u.token, 'users.getPresence', {}, { get: true }).catch(() => null),
    slackApi(u.token, 'dnd.info', {}, { get: true }).catch(() => null),
  ]);
  const pr = p?.profile || {};
  return json({
    me: u.slack_uid, name: pr.real_name || pr.display_name || u.name || '', image: pr.image_72 || null,
    status: { text: pr.status_text || '', emoji: pr.status_emoji || '', expires: pr.status_expiration || 0 },
    presence: pres?.presence || null, away: Boolean(pres?.manual_away), snooze: dnd?.snooze_enabled ? (dnd.snooze_endtime || 0) : 0,
  });
});
route('POST', '/api/slack/me/status', async ({ env, user, body }) => {
  const u = await me(env, user);
  const b = await body();
  const emojiName = String(b.emoji || '').replace(/[^a-z0-9_+:-]/gi, '').slice(0, 60);
  const exp = Math.max(0, Math.floor(Number(b.expires) || 0));
  await slackApi(u.token, 'users.profile.set', { profile: { status_text: String(b.text || '').slice(0, 100), status_emoji: emojiName ? `:${emojiName.replace(/:/g, '')}:` : '', status_expiration: exp } });
  return json({ ok: true });
});
route('POST', '/api/slack/me/presence', async ({ env, user, body }) => {
  const u = await me(env, user);
  const b = await body();
  await slackApi(u.token, 'users.setPresence', { presence: b.away ? 'away' : 'auto' }, { form: true });
  return json({ ok: true });
});
route('POST', '/api/slack/me/snooze', async ({ env, user, body }) => {
  const u = await me(env, user);
  const minutes = Math.floor(Number((await body()).minutes) || 0);
  if (minutes <= 0) await slackApi(u.token, 'dnd.endSnooze', {}, { form: true }).catch((e) => { if (!/snooze_not_active/.test(e.message)) throw e; });
  else await slackApi(u.token, 'dnd.setSnooze', { num_minutes: String(Math.min(minutes, 7 * 1440)) }, { form: true });
  // The Hub's own Slack pushes stay quiet for the same time.
  const until = minutes > 0 ? now() + Math.min(minutes, 7 * 1440) * 60e3 : null;
  await run(env, 'UPDATE users SET slack_snooze = ? WHERE id = ?', until, u.id);
  return json({ ok: true, until });
});
route('GET', '/api/slack/me/profile', async ({ env, user, url }) => {
  const u = await me(env, user);
  const id = url.searchParams.get('user') || '';
  if (!userOk(id)) throw new HttpError('Pick a person.');
  const [info, pres] = await Promise.all([
    slackApi(u.token, 'users.info', { user: id }, { get: true }),
    slackApi(u.token, 'users.getPresence', { user: id }, { get: true }).catch(() => null),
  ]);
  const x = info.user || {};
  const p = x.profile || {};
  return json({
    id, name: x.real_name || p.real_name || x.name || 'Someone', handle: p.display_name || x.name || '', title: p.title || '', image: p.image_192 || p.image_72 || null,
    email: p.email || null, phone: p.phone || null, tz: x.tz || null, tzLabel: x.tz_label || '', status: { text: p.status_text || '', emoji: p.status_emoji || '' },
    presence: pres?.presence || null, bot: Boolean(x.is_bot), me: id === u.slack_uid,
  });
});

// ---------- new messages from Slack (Events API) ----------
// For each new message: everyone in the Hub who is in that conversation (except the sender) gets an unread count. Direct messages
// and @mentions also buzz their phone (alert kind "slack", not added to the Alerts list).
export async function onSlackMessage(env, ev) {
  if (!ev || ev.type !== 'message' || !ev.channel) return 0;
  await onClientChat(env, ev).catch((e) => console.error('client chat', e));
  if (ev.subtype && !['file_share', 'thread_broadcast', 'bot_message'].includes(ev.subtype)) return 0;
  const reply = Boolean(ev.thread_ts && ev.thread_ts !== ev.ts && ev.subtype !== 'thread_broadcast'); // thread replies stay in the thread
  const members = await all(env, 'SELECT u.id, u.slack_uid, u.slack_snooze FROM slack_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? AND u.slack_token IS NOT NULL', ev.channel);
  const plain = String(ev.text || (ev.files?.length ? 'Sent a file' : '')).replace(/<@[A-Z0-9]+(\|[^>]+)?>/g, '@someone').replace(/<([^|>]+)\|([^>]+)>/g, '$2').replace(/<([^>]+)>/g, '$1').slice(0, 140);
  let n = 0;
  for (const m of members) {
    if (m.slack_uid && m.slack_uid === ev.user) continue;
    const dm = ev.channel_type === 'im';
    const text = String(ev.text || '');
    const mention = Boolean(m.slack_uid && (text.includes(`<@${m.slack_uid}>`) || (!dm && /<!(here|channel|everyone)/.test(text))));
    const myThread = reply && ev.parent_user_id && ev.parent_user_id === m.slack_uid;
    if (mention || myThread) {
      await run(env, `INSERT OR IGNORE INTO slack_activity (id, user_id, kind, channel_id, ts, thread_ts, from_id, text, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `${m.id}:${ev.channel}:${ev.ts}`, m.id, mention ? 'mention' : 'reply', ev.channel, ev.ts || '', reply ? ev.thread_ts : null, ev.user || null, String(ev.text || (ev.files?.length ? 'Sent a file' : '')).slice(0, 1000), now());
    }
    if (!reply) {
      await run(env, `INSERT INTO slack_unread (user_id, channel_id, count, mentions, last_ts) VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(user_id, channel_id) DO UPDATE SET count = count + 1, mentions = mentions + excluded.mentions, last_ts = excluded.last_ts`, m.id, ev.channel, mention || dm ? 1 : 0, ev.ts || null);
    }
    if ((dm || mention || myThread) && !(m.slack_snooze && m.slack_snooze > now())) {
      const who = ev.user ? (await first(env, 'SELECT real_name, name FROM slack_people WHERE id = ?', ev.user)) : null;
      const name = who?.real_name || who?.name || 'Slack';
      await notify(env, { to: [m.id], kind: 'slack', title: `${name}${dm && !reply ? '' : mention ? ' mentioned you' : ' replied to your thread'}`, body: plain, url: `/#/slack/${ev.channel}${reply ? `/t/${ev.thread_ts}` : ''}`, tag: `slack-${ev.channel}`, slack: false, list: false }).catch(() => {});
    }
    n += 1;
  }
  if (Math.random() < 0.02) await run(env, 'DELETE FROM slack_activity WHERE at < ?', now() - 45 * 864e5).catch(() => {});
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
