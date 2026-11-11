// Slack: the Rightway Hub Slack app.
// - Alerts go to the channel picked for each kind (leads, voicemails, client updates...) and to a client's own channel when it has one.
// - Personal alerts (tasks assigned, meeting reminders, anything the person turns on) go to that person as a direct message.
// - Buttons act in the Hub: Start timer, Claim lead, Mark heard, Reply to a text (a Slack form that sends the text through the Hub).
// - /hub answers from Slack: my work, a client's numbers, find a lead, agency stats.
// - A morning team summary goes to a channel.
// The app is made from a manifest with the Hub's addresses filled in. The bot token and signing secret are pasted in the Hub and
// stored sealed. Every request from Slack is checked with the signing secret. A plain incoming webhook still works without the app.
import { HttpError, json } from './util.js';
import { all, first, run, now, getSettings, setSetting } from './db.js';
import { requireStaff, requireAdmin } from './auth.js';
import { route } from './router.js';
import { seal, unseal } from './seal.js';
import { KINDS } from './notify.js';
import { startTimer } from './work.js';
import { sendText } from './sms.js';
import { monthKey, workloadOf } from './plans.js';

export const SCOPES = ['chat:write', 'chat:write.public', 'chat:write.customize', 'channels:read', 'channels:history', 'groups:read', 'groups:history', 'groups:write',
  'users:read', 'users:read.email', 'im:write', 'files:read', 'files:write', 'commands'];
const DM_DEFAULT = ['task', 'meeting'];
// Calls, tasks and meeting reminders are personal (direct messages only), so channels are offered for the rest.
const PERSONAL = ['call', 'task', 'meeting', 'slack'];
const routeKinds = () => ({ ...Object.fromEntries(Object.entries(KINDS).filter(([k]) => !PERSONAL.includes(k) && k !== 'slack')), digest: 'Morning team summary (8am)' });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const day = (t) => new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// Each person's own Slack inside the Hub (src/slackuser.js) uses these user scopes: they read and post as themselves.
export const USER_SCOPES = ['channels:history', 'channels:read', 'channels:write', 'groups:history', 'groups:read', 'groups:write', 'im:history', 'im:read', 'im:write',
  'mpim:history', 'mpim:read', 'mpim:write', 'chat:write', 'users:read', 'users:read.email', 'reactions:read', 'reactions:write', 'files:read', 'files:write',
  'search:read', 'pins:read', 'pins:write', 'reminders:write', 'users.profile:read', 'users.profile:write', 'users:write', 'dnd:read', 'dnd:write', 'emoji:read'];
// What the first version asked for. People who connected before the rest was added get a "Reconnect your Slack" banner.
export const FIRST_USER_SCOPES = USER_SCOPES.slice(0, 19);
export function manifestFor(origin) {
  return {
    display_information: { name: 'Rightway Hub', description: 'Slack inside Rightway Hub, plus alerts, tasks and quick actions', background_color: '#0F1B17' },
    features: {
      bot_user: { display_name: 'Rightway Hub', always_online: true },
      slash_commands: [{ command: '/hub', url: `${origin}/api/slack/command`, description: 'Your work, clients and leads from the Hub', usage_hint: 'work | client <name> | lead <name or phone> | stats', should_escape: false }],
    },
    oauth_config: { redirect_urls: [`${origin}/api/slack/oauth/callback`], scopes: { bot: SCOPES, user: USER_SCOPES } },
    settings: {
      event_subscriptions: { request_url: `${origin}/api/slack/events`, user_events: ['message.channels', 'message.groups', 'message.im', 'message.mpim'], bot_events: ['message.channels', 'message.groups'] },
      interactivity: { is_enabled: true, request_url: `${origin}/api/slack/interact` }, org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false,
    },
  };
}

// ---------- state ----------
export async function slackState(env) {
  const s = await getSettings(env);
  return {
    bot: s.slack_bot || null, signing: s.slack_signing || null, team: parse(s.slack_team, null), routes: parse(s.slack_routes, {}),
    hook: s.slack_hook || null, kinds: parse(s.slack_kinds, ['lead', 'money', 'voicemail', 'client']), origin: s.hub_origin || s.autoscan_origin || '',
  };
}

export async function slackApi(token, method, body = {}, { get = false, form = false } = {}) {
  const url = `https://slack.com/api/${method}${get ? `?${new URLSearchParams(body)}` : ''}`;
  const res = await fetch(url, get ? { headers: { authorization: `Bearer ${token}` } }
    : form ? { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() }
    : { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (data.error === 'missing_scope') throw new HttpError(`Slack needs one more permission for this (${data.needed || 'scope'}). Reconnect Slack to allow it.`, 403);
  if (!data.ok) throw new HttpError(`Slack: ${data.error || `HTTP ${res.status}`}${data.needed ? ` (needs ${data.needed})` : ''}`, 502);
  return data;
}
async function token(env, st) {
  const s = st || await slackState(env);
  if (!s.bot) throw new HttpError('Connect the Slack app first.', 400);
  return unseal(env, s.bot);
}

// Slack signs every request: v0=HMAC_SHA256(signing secret, "v0:<timestamp>:<raw body>"). Older than 5 minutes is refused.
export async function slackSignature(secret, ts, raw) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${ts}:${raw}`)));
  return `v0=${[...mac].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
export async function verified(env, request) {
  const st = await slackState(env);
  if (!st.signing) throw new HttpError('Slack is not connected.', 401);
  const ts = Number(request.headers.get('x-slack-request-timestamp') || 0);
  const sig = request.headers.get('x-slack-signature') || '';
  const raw = await request.text();
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) throw new HttpError('Old request.', 401);
  const want = await slackSignature(await unseal(env, st.signing), ts, raw);
  let diff = want.length ^ sig.length;
  for (let i = 0; i < Math.min(want.length, sig.length); i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff) throw new HttpError('Bad signature.', 401);
  return { st, raw };
}

// ---------- messages ----------
const hubLink = (origin, url) => (origin && url ? `${origin}${url.startsWith('/') ? '' : '/'}${url}` : null);
export function blocksFor({ title, body, url, actions = [], origin }) {
  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: `*${esc(title)}*${body ? `\n${esc(body)}` : ''}` } }];
  const buttons = actions.slice(0, 4).map((a) => ({ type: 'button', text: { type: 'plain_text', text: a.text.slice(0, 70) }, action_id: a.action_id, value: String(a.value || '').slice(0, 1900), ...(a.style ? { style: a.style } : {}) }));
  const link = hubLink(origin, url);
  if (link) buttons.push({ type: 'button', text: { type: 'plain_text', text: 'Open in the Hub' }, action_id: 'open_hub', url: link });
  if (buttons.length) blocks.push({ type: 'actions', elements: buttons });
  return blocks;
}
const wantsDm = (u, kind) => { if (kind === 'slack') return false; const p = parse(u.slack_prefs, {}); return p[kind] ?? DM_DEFAULT.includes(kind); };

// Called by notify() for every alert. channel: false = personal only (no channel posts).
export async function postToSlack(env, { kind, title, body, url, actions = [], clientId = null, users = [], channel = true }) {
  const st = await slackState(env);
  if (st.bot) {
    const t = await unseal(env, st.bot);
    const blocks = blocksFor({ title, body, url, actions, origin: st.origin });
    const done = new Set();
    let n = 0;
    const post = async (ch) => {
      if (!ch || done.has(ch)) return;
      done.add(ch);
      try { await slackApi(t, 'chat.postMessage', { channel: ch, text: String(title).slice(0, 300), blocks, unfurl_links: false }); n += 1; } catch (e) { console.error('slack post', ch, e.message); }
    };
    if (channel && st.routes[kind]?.id) await post(st.routes[kind].id);
    if (channel && clientId) {
      const c = await first(env, 'SELECT slack_channel FROM clients WHERE id = ?', clientId);
      if (c?.slack_channel) await post(c.slack_channel);
    }
    for (const u of users) if (u.slack_id && wantsDm(u, kind)) await post(u.slack_id);
    return n;
  }
  if (channel && st.hook && st.kinds.includes(kind)) {
    const hook = await unseal(env, st.hook);
    const link = hubLink(st.origin, url);
    const res = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `*${esc(title)}*${body ? `\n${esc(body)}` : ''}${link ? `\n<${link}|Open in the Hub>` : ''}` }) });
    return res.ok ? 1 : 0;
  }
  return 0;
}

// Morning team summary to the channel picked for "digest".
export async function teamSummary(env, today) {
  const st = await slackState(env);
  if (!st.bot || !st.routes.digest?.id) return false;
  const [open, late, dueToday, meetings, leads] = await Promise.all([
    first(env, "SELECT COUNT(*) AS n FROM tasks t JOIN clients c ON c.id = t.client_id WHERE t.status IN ('todo','doing') AND c.status = 'active'"),
    first(env, "SELECT COUNT(*) AS n FROM tasks t JOIN clients c ON c.id = t.client_id WHERE t.status IN ('todo','doing') AND c.status = 'active' AND t.due < ?", today),
    first(env, "SELECT COUNT(*) AS n FROM tasks t JOIN clients c ON c.id = t.client_id WHERE t.status IN ('todo','doing') AND c.status = 'active' AND t.due = ?", today),
    all(env, "SELECT m.start_at, m.title, c.name FROM meetings m JOIN clients c ON c.id = m.client_id WHERE m.status = 'scheduled' AND m.start_at >= ? AND m.start_at < ? ORDER BY m.start_at", now(), now() + 18 * 3600e3).catch(() => []),
    first(env, 'SELECT COUNT(*) AS n FROM leads WHERE created_at > ?', now() - 864e5),
  ]);
  const lines = [`Open tasks: *${open?.n || 0}*${late?.n ? `, *${late.n} overdue*` : ''}. Due today: *${dueToday?.n || 0}*.`, `New leads in the last day: *${leads?.n || 0}*.`];
  if (meetings.length) lines.push(`Client meetings today:\n${meetings.map((m) => `• ${day(m.start_at)}: ${esc(m.name)}`).join('\n')}`);
  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: `*Good morning. Here is today.*\n${lines.join('\n')}` } }];
  const link = hubLink(st.origin, '/#/work');
  if (link) blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open My work' }, action_id: 'open_hub', url: link }] });
  await slackApi(await unseal(env, st.bot), 'chat.postMessage', { channel: st.routes.digest.id, text: 'Good morning. Here is today.', blocks });
  return true;
}

// ---------- people ----------
// The Hub user behind a Slack user: linked already, or matched by email (Slack profile email = Hub login or Google email).
export async function hubUser(env, slackId, st) {
  let u = await first(env, "SELECT * FROM users WHERE slack_id = ? AND role IN ('admin','team')", slackId);
  if (u) return u;
  const info = await slackApi(await token(env, st), 'users.info', { user: slackId }, { get: true }).catch(() => null);
  const email = String(info?.user?.profile?.email || '').toLowerCase();
  if (!email) return null;
  u = await first(env, "SELECT * FROM users WHERE (lower(email) = ? OR lower(google_email) = ?) AND role IN ('admin','team')", email, email);
  if (u) await run(env, 'UPDATE users SET slack_id = ? WHERE id = ?', slackId, u.id);
  return u;
}

// ---------- /hub ----------
const ephemeral = (text, blocks) => json({ response_type: 'ephemeral', text, ...(blocks ? { blocks } : {}) });
const section = (text, accessory) => ({ type: 'section', text: { type: 'mrkdwn', text }, ...(accessory ? { accessory } : {}) });
const btn = (text, action_id, value, style) => ({ type: 'button', text: { type: 'plain_text', text }, action_id, value: String(value), ...(style ? { style } : {}) });
const linkBtn = (text, url) => ({ type: 'button', text: { type: 'plain_text', text }, action_id: 'open_hub', url });

export async function commandReply(env, u, text, origin) {
  const [cmd, ...rest] = String(text || '').trim().split(/\s+/);
  const q = rest.join(' ').trim();
  const c = (cmd || 'work').toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  if (c === 'help') {
    return ephemeral('Rightway Hub commands', [section('*/hub* or */hub work*: your open tasks, overdue first\n*/hub client sunrise*: a client\'s numbers\n*/hub lead joe* or */hub lead 954555*: find a lead\n*/hub stats*: agency numbers (owners)')]);
  }
  if (c === 'work' || c === 'tasks' || c === 'my') {
    const rows = await all(env, `SELECT t.id, t.title, t.due, t.status, c.name FROM tasks t JOIN clients c ON c.id = t.client_id
      WHERE t.owner = ? AND t.status IN ('todo','doing') AND c.status = 'active' ORDER BY COALESCE(t.due, '9999'), c.name LIMIT 8`, u.id);
    const total = await first(env, "SELECT COUNT(*) AS n, SUM(CASE WHEN t.due < ? THEN 1 ELSE 0 END) AS late FROM tasks t JOIN clients c ON c.id = t.client_id WHERE t.owner = ? AND t.status IN ('todo','doing') AND c.status = 'active'", today, u.id);
    if (!rows.length) return ephemeral('Nothing open for you.', [section('*Nothing open for you.* Grab work from "Nobody assigned" on My work.')]);
    const blocks = [section(`*Your work:* ${total.n} open${total.late ? `, *${total.late} overdue*` : ''}`)];
    for (const r of rows) blocks.push(section(`${r.due && r.due < today ? ':red_circle: ' : ''}*${esc(r.title)}*\n${esc(r.name)}${r.due ? ` · due ${r.due}` : ''}${r.status === 'doing' ? ' · in progress' : ''}`, btn('Start timer', 'task_start', r.id)));
    if (origin) blocks.push({ type: 'actions', elements: [linkBtn('Open My work', `${origin}/#/work`)] });
    return ephemeral(`You have ${total.n} open tasks`, blocks);
  }
  if (c === 'client') {
    if (!q) return ephemeral('Add a name: /hub client sunrise');
    const cl = await first(env, "SELECT * FROM clients WHERE lower(name) LIKE ? AND parent_id IS NULL ORDER BY status = 'active' DESC, name LIMIT 1", `%${q.toLowerCase()}%`);
    if (!cl) return ephemeral(`No client matches "${q}".`);
    const m = monthKey();
    const [scan, tasks, meet, rep, owner, late] = await Promise.all([
      first(env, 'SELECT keyword, summary FROM scans WHERE client_id = ? ORDER BY created_at DESC LIMIT 1', cl.id),
      first(env, "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done FROM tasks WHERE client_id = ? AND month = ?", cl.id, m),
      first(env, "SELECT start_at, meet_link FROM meetings WHERE client_id = ? AND status = 'scheduled' AND start_at > ? ORDER BY start_at LIMIT 1", cl.id, now()).catch(() => null),
      first(env, "SELECT month, token FROM reports WHERE client_id = ? AND status = 'sent' ORDER BY month DESC LIMIT 1", cl.id).catch(() => null),
      cl.owner_id ? first(env, 'SELECT name, email FROM users WHERE id = ?', cl.owner_id) : null,
      first(env, "SELECT COUNT(*) AS n FROM tasks WHERE client_id = ? AND status IN ('todo','doing') AND due < ?", cl.id, today),
    ]);
    const s = parse(scan?.summary, null);
    const fields = [
      `*Services*\n${workloadOf(cl).scope.length} in scope · ${esc(cl.status)}`,
      `*Account manager*\n${esc(owner?.name || owner?.email || 'Nobody')}`,
      `*First page (top 10)*\n${s ? `${s.top10Pct ?? 0}% for "${esc(scan.keyword)}"` : 'No scan yet'}`,
      `*This month*\n${tasks?.done || 0} of ${tasks?.total || 0} tasks done${late?.n ? `, ${late.n} overdue` : ''}`,
      `*Next meeting*\n${meet ? day(meet.start_at) : 'None booked'}`,
      `*Last report*\n${rep ? rep.month : 'None sent'}`,
    ].map((t) => ({ type: 'mrkdwn', text: t }));
    const blocks = [section(`*${esc(cl.name)}*${cl.address ? `\n${esc(cl.address)}` : ''}`), { type: 'section', fields }];
    const btns = [];
    if (origin) btns.push(linkBtn('Open client', `${origin}/#/client/${cl.id}/overview`));
    if (origin && rep) btns.push(linkBtn('Report', `${origin}/report.html#${rep.token}`));
    if (meet?.meet_link) btns.push(linkBtn('Meet link', meet.meet_link));
    if (btns.length) blocks.push({ type: 'actions', elements: btns });
    return ephemeral(cl.name, blocks);
  }
  if (c === 'lead' || c === 'find') {
    if (!q) return ephemeral('Add a name or phone: /hub lead joe');
    const digits = q.replace(/\D/g, '');
    const rows = await all(env, `SELECT l.id, l.business, l.contact_name, l.phone, l.stage, l.next_action, l.owner_id, u.name AS owner FROM leads l LEFT JOIN users u ON u.id = l.owner_id
      WHERE lower(l.business) LIKE ? OR lower(COALESCE(l.contact_name, '')) LIKE ?${digits.length >= 4 ? ' OR l.phone_digits LIKE ?' : ''} ORDER BY l.updated_at DESC LIMIT 5`,
    `%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`, ...(digits.length >= 4 ? [`%${digits}%`] : []));
    if (!rows.length) return ephemeral(`No lead matches "${q}".`);
    const blocks = rows.map((l) => section(`*${esc(l.business)}*${l.contact_name ? ` (${esc(l.contact_name)})` : ''}\n${esc(l.phone || 'No phone')} · ${esc(l.stage)}${l.owner ? ` · ${esc(l.owner)}` : ''}${l.next_action ? `\nNext: ${esc(l.next_action)}` : ''}`,
      l.owner_id ? (origin ? linkBtn('Open', `${origin}/#/pipeline`) : undefined) : btn('Claim', 'lead_claim', l.id, 'primary')));
    return ephemeral(`${rows.length} lead${rows.length === 1 ? '' : 's'}`, blocks);
  }
  if (c === 'stats') {
    if (u.role !== 'admin') return ephemeral('Agency numbers are for owners.');
    const [clients, open, leads, meets] = await Promise.all([
      all(env, "SELECT plan, mrr_cents, billing_status FROM clients WHERE status = 'active' AND sample = 0 AND parent_id IS NULL"),
      first(env, "SELECT COUNT(*) AS n, SUM(CASE WHEN t.due < ? THEN 1 ELSE 0 END) AS late FROM tasks t JOIN clients c ON c.id = t.client_id WHERE t.status IN ('todo','doing') AND c.status = 'active'", today),
      first(env, 'SELECT COUNT(*) AS n FROM leads WHERE created_at > ?', now() - 7 * 864e5),
      first(env, "SELECT COUNT(*) AS n FROM meetings WHERE status = 'scheduled' AND start_at >= ? AND start_at < ?", now(), now() + 7 * 864e5).catch(() => null),
    ]);
    const mrr = clients.reduce((s, x) => s + ((x.mrr_cents || 0) / 100), 0);
    const fields = [`*Active clients*\n${clients.length}`, `*Monthly revenue*\n$${Math.round(mrr).toLocaleString('en-US')}`, `*Open tasks*\n${open?.n || 0}${open?.late ? ` (${open.late} overdue)` : ''}`,
      `*New leads, 7 days*\n${leads?.n || 0}`, `*Client meetings, 7 days*\n${meets?.n || 0}`].map((t) => ({ type: 'mrkdwn', text: t }));
    return ephemeral('Agency numbers', [section('*Rightway Growth today*'), { type: 'section', fields }]);
  }
  return commandReply(env, u, 'help', origin);
}

route('POST', '/api/slack/command', async ({ env, request, url }) => {
  const { st, raw } = await verified(env, request);
  const p = new URLSearchParams(raw);
  const u = await hubUser(env, p.get('user_id'), st);
  if (!u) return ephemeral('Your Slack is not linked to a Hub login. Use the same email in both, or press "Link my Slack" on the Hub\'s Alerts page.');
  return commandReply(env, u, p.get('text'), st.origin || url.origin);
}, { public: true });

// ---------- buttons and forms ----------
async function respond(responseUrl, body) {
  if (!responseUrl) return;
  await fetch(responseUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
}
// Replace the buttons on the original message with a line saying who did what.
function doneBlocks(message, line) {
  const keep = (message?.blocks || []).filter((b) => b.type !== 'actions');
  return [...keep, { type: 'context', elements: [{ type: 'mrkdwn', text: line }] }];
}

route('POST', '/api/slack/interact', async ({ env, request, url, defer }) => {
  const { st, raw } = await verified(env, request);
  const payload = parse(new URLSearchParams(raw).get('payload'), {});
  const ok = () => new Response('', { status: 200 });
  const u = payload.user?.id ? await hubUser(env, payload.user.id, st) : null;
  const later = (p) => (defer ? defer(p) : p);

  if (payload.type === 'view_submission' && payload.view?.callback_id === 'text_reply') {
    const leadId = payload.view.private_metadata;
    const msg = payload.view.state?.values?.b?.msg?.value || '';
    const lead = await first(env, 'SELECT * FROM leads WHERE id = ?', leadId);
    if (!u) return json({ response_action: 'errors', errors: { b: 'Your Slack is not linked to a Hub login.' } });
    if (!lead) return json({ response_action: 'errors', errors: { b: 'That lead is gone.' } });
    try { await sendText(env, lead, msg, u, st.origin || url.origin); } catch (e) { return json({ response_action: 'errors', errors: { b: String(e.message).slice(0, 150) } }); }
    return json({ response_action: 'clear' });
  }
  if (payload.type !== 'block_actions') return ok();
  const a = payload.actions?.[0] || {};
  if (a.action_id === 'open_hub') return ok();
  if (!u) { await later(respond(payload.response_url, { response_type: 'ephemeral', replace_original: false, text: 'Your Slack is not linked to a Hub login. Use the same email in both, or press "Link my Slack" on the Hub\'s Alerts page.' })); return ok(); }
  const who = u.name || u.email;

  if (a.action_id === 'task_start') {
    const t = await first(env, 'SELECT * FROM tasks WHERE id = ?', a.value);
    if (t) await startTimer(env, t, u.id);
    await later(respond(payload.response_url, { response_type: 'ephemeral', replace_original: false, text: t ? `Timer started on "${t.title}". Stop it from the Hub when you finish.` : 'That task is gone.' }));
  } else if (a.action_id === 'lead_claim') {
    const l = await first(env, 'SELECT id, business, owner_id FROM leads WHERE id = ?', a.value);
    if (l && !l.owner_id) await run(env, 'UPDATE leads SET owner_id = ?, updated_at = ? WHERE id = ?', u.id, now(), l.id);
    const line = !l ? 'That lead is gone.' : l.owner_id && l.owner_id !== u.id ? 'Someone already claimed this lead.' : `Claimed by ${esc(who)}`;
    await later(respond(payload.response_url, payload.message && payload.container?.type === 'message' && !payload.container?.is_ephemeral
      ? { replace_original: true, text: line, blocks: doneBlocks(payload.message, line) } : { response_type: 'ephemeral', replace_original: false, text: line }));
  } else if (a.action_id === 'call_heard') {
    await run(env, "UPDATE activities SET seen_at = COALESCE(seen_at, ?) WHERE id = ? AND type = 'call'", now(), a.value);
    await later(respond(payload.response_url, { replace_original: true, text: `Heard by ${who}`, blocks: doneBlocks(payload.message, `Heard by ${esc(who)}`) }));
  } else if (a.action_id === 'text_reply') {
    const lead = await first(env, 'SELECT id, business, contact_name FROM leads WHERE id = ?', a.value);
    const msgs = lead ? await all(env, 'SELECT direction, body FROM messages WHERE lead_id = ? ORDER BY at DESC LIMIT 4', lead.id) : [];
    // The form must open within 3 seconds of the click, so this runs before answering.
    await slackApi(await token(env, st), 'views.open', {
      trigger_id: payload.trigger_id,
      view: {
        type: 'modal', callback_id: 'text_reply', private_metadata: a.value,
        title: { type: 'plain_text', text: 'Reply by text' }, submit: { type: 'plain_text', text: 'Send' }, close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          { type: 'context', elements: [{ type: 'mrkdwn', text: `To *${esc(lead?.business || 'this lead')}*. Sent from the Hub, so the opt out and calling hours rules apply.` }] },
          ...msgs.reverse().map((m) => ({ type: 'context', elements: [{ type: 'mrkdwn', text: `${m.direction === 'in' ? '*Them:*' : '*Us:*'} ${esc(m.body).slice(0, 280)}` }] })),
          { type: 'input', block_id: 'b', label: { type: 'plain_text', text: 'Message' }, element: { type: 'plain_text_input', action_id: 'msg', multiline: true, max_length: 600 } },
        ],
      },
    }).catch((e) => console.error('views.open', e.message));
  }
  return ok();
}, { public: true });

// ---------- settings ----------
async function linkedTeam(env) {
  return all(env, "SELECT id, name, email, role, slack_id FROM users WHERE role IN ('admin','team') ORDER BY name");
}

route('GET', '/api/slack', async ({ env, user, url }) => {
  requireStaff(user);
  const st = await slackState(env);
  const me = await first(env, 'SELECT slack_id, slack_prefs FROM users WHERE id = ?', user.id);
  const dmKinds = Object.fromEntries(Object.entries(KINDS).filter(([k]) => k !== 'slack'));
  const mine = { linked: Boolean(me?.slack_id), prefs: Object.fromEntries(Object.keys(dmKinds).map((k) => [k, wantsDm(me || {}, k)])), kinds: dmKinds };
  if (user.role !== 'admin') return json({ connected: Boolean(st.bot), team: st.team, mine });
  const manifest = manifestFor(url.origin);
  const clients = await all(env, "SELECT id, name, slack_channel, slack_channel_name, chat_channel, chat_channel_name FROM clients WHERE status = 'active' AND COALESCE(sample, 0) = 0 AND parent_id IS NULL ORDER BY name");
  const sets = await getSettings(env);
  return json({ chatAuto: sets.chat_auto !== '0',
    connected: Boolean(st.bot), team: st.team, routes: st.routes, kinds: routeKinds(), mine, webhook: Boolean(st.hook), webhookKinds: st.kinds,
    manifest, createUrl: `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(manifest))}`,
    clients, people: await linkedTeam(env), origin: url.origin, userApp: Boolean((await getSettings(env)).slack_client_id),
  });
});

route('POST', '/api/slack/connect', async ({ env, user, body, url }) => {
  requireAdmin(user);
  const b = await body();
  const tok = String(b.token || '').trim();
  const secret = String(b.signing || '').trim();
  if (!/^xoxb-[\w-]+$/.test(tok)) throw new HttpError('Paste the Bot User OAuth Token. It starts with xoxb-');
  if (!/^[a-f0-9]{24,64}$/i.test(secret)) throw new HttpError('Paste the Signing Secret from Basic Information (letters and numbers).');
  const who = await slackApi(tok, 'auth.test');
  await setSetting(env, 'slack_bot', await seal(env, tok));
  await setSetting(env, 'slack_signing', await seal(env, secret));
  await setSetting(env, 'slack_team', JSON.stringify({ id: who.team_id, name: who.team, url: who.url, bot: who.user_id }));
  if (!/localhost|127\./.test(url.origin)) await setSetting(env, 'hub_origin', url.origin);
  // Link teammates by email right away.
  let linked = 0;
  for (const p of await linkedTeam(env)) {
    if (p.slack_id) continue;
    const r = await slackApi(tok, 'users.lookupByEmail', { email: p.email }, { get: true }).catch(() => null);
    if (r?.user?.id) { await run(env, 'UPDATE users SET slack_id = ? WHERE id = ?', r.user.id, p.id); linked += 1; }
  }
  return json({ connected: true, team: who.team, linked });
});

route('GET', '/api/slack/channels', async ({ env, user }) => {
  requireStaff(user);
  const t = await token(env);
  const out = [];
  let cursor = '';
  for (let i = 0; i < 5; i++) {
    const r = await slackApi(t, 'conversations.list', { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '500', ...(cursor ? { cursor } : {}) }, { get: true });
    for (const c of r.channels || []) out.push({ id: c.id, name: c.name, private: Boolean(c.is_private), member: Boolean(c.is_member) });
    cursor = r.response_metadata?.next_cursor || '';
    if (!cursor) break;
  }
  return json({ channels: out.sort((a, b) => a.name.localeCompare(b.name)) });
});

const channelOk = (c) => !c || (/^[CGD][A-Z0-9]{6,}$/.test(c.id || '') && typeof c.name === 'string');
route('PUT', '/api/slack/routes', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  const kinds = routeKinds();
  const routes = {};
  for (const [k, c] of Object.entries(b.routes || {})) {
    if (!kinds[k] || !c) continue;
    if (!channelOk(c)) throw new HttpError('Pick a channel from the list.');
    routes[k] = { id: c.id, name: String(c.name).slice(0, 80) };
  }
  await setSetting(env, 'slack_routes', JSON.stringify(routes));
  return json({ routes });
});

route('PUT', '/api/clients/:id/slack', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = (await body()).channel || null;
  if (!channelOk(c)) throw new HttpError('Pick a channel from the list.');
  await run(env, 'UPDATE clients SET slack_channel = ?, slack_channel_name = ? WHERE id = ?', c?.id || null, c ? String(c.name).slice(0, 80) : null, params.id);
  return json({ ok: true });
});

route('POST', '/api/slack/link', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const target = b.user && user.role === 'admin' ? await first(env, "SELECT id, email FROM users WHERE id = ? AND role IN ('admin','team')", b.user) : { id: user.id, email: user.email };
  if (!target) throw new HttpError('Teammate not found.', 404);
  if (b.unlink) { await run(env, 'UPDATE users SET slack_id = NULL WHERE id = ?', target.id); return json({ linked: false }); }
  const email = String(b.email || target.email).trim().toLowerCase();
  const r = await slackApi(await token(env), 'users.lookupByEmail', { email }, { get: true }).catch(() => null);
  if (!r?.user?.id) throw new HttpError(`No one in Slack uses ${email}. Type the email you use in Slack.`, 404);
  await run(env, 'UPDATE users SET slack_id = ? WHERE id = ?', r.user.id, target.id);
  return json({ linked: true, name: r.user.real_name || r.user.name });
});

route('PUT', '/api/slack/prefs', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const prefs = Object.fromEntries(Object.keys(KINDS).filter((k) => k !== 'slack').map((k) => [k, b[k] === true]));
  await run(env, 'UPDATE users SET slack_prefs = ? WHERE id = ?', JSON.stringify(prefs), user.id);
  return json({ prefs });
});

route('PUT', '/api/slack/webhook', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  if (b.webhook) {
    const hook = String(b.webhook).trim();
    if (!/^https:\/\/hooks\.slack\.com\/services\/[\w/-]+$/.test(hook)) throw new HttpError('Paste the Slack webhook address. It starts with https://hooks.slack.com/services/');
    await setSetting(env, 'slack_hook', await seal(env, hook));
  }
  if (Array.isArray(b.kinds)) await setSetting(env, 'slack_kinds', JSON.stringify(b.kinds.filter((k) => KINDS[k])));
  return json({ ok: true });
});

route('POST', '/api/slack/test', async ({ env, user }) => {
  requireAdmin(user);
  const st = await slackState(env);
  if (st.bot) {
    const t = await unseal(env, st.bot);
    const targets = [...new Set(Object.values(st.routes).map((r) => r.id))];
    const me = await first(env, 'SELECT slack_id FROM users WHERE id = ?', user.id);
    if (me?.slack_id) targets.push(me.slack_id);
    if (!targets.length) throw new HttpError('Pick at least one channel, or link your Slack, then test.');
    const blocks = blocksFor({ title: 'Rightway Hub is connected', body: 'Alerts for this channel will show up here.', url: '/#/alerts', origin: st.origin });
    const errors = [];
    for (const ch of targets) await slackApi(t, 'chat.postMessage', { channel: ch, text: 'Rightway Hub is connected', blocks }).catch((e) => errors.push(e.message));
    if (errors.length === targets.length) throw new HttpError(errors[0], 502);
    return json({ ok: true, sent: targets.length - errors.length, errors });
  }
  if (!st.hook) throw new HttpError('Connect the Slack app first.');
  await postToSlack(env, { kind: st.kinds[0] || 'lead', title: 'Rightway Hub is connected', body: 'Alerts you picked will show up in this channel.', url: '/#/alerts', channel: true });
  return json({ ok: true, sent: 1 });
});

route('DELETE', '/api/slack', async ({ env, user, url }) => {
  requireAdmin(user);
  if (url.searchParams.get('what') === 'webhook') await run(env, "DELETE FROM settings WHERE k IN ('slack_hook','slack_kinds')");
  else await run(env, "DELETE FROM settings WHERE k IN ('slack_bot','slack_signing','slack_team','slack_routes')");
  return json({ ok: true });
});
