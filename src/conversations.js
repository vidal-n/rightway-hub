// One inbox for every channel (Nov 2026). Modeled on GoHighLevel Conversations (one list of people, every channel in one thread, reply
// by text, email or internal note from the same box) and Front/Intercom's views (All, Unread, Mine, by channel).
// A conversation is a lead: texts (messages), calls coming in, missed calls and voicemails (activities), emails sent from the Hub
// (mail_log and email activities), website form requests and online bookings. Replies go through the existing senders, so the texting
// rules (consent, STOP, 8am to 8pm) and email logging stay the same. Personal lines stay private (lines.js), like the Texts tab.
// Client team chats are Slack channels and stay on each client's Messages tab; Gmail replies stay in Gmail (Google page).
import { HttpError, json } from './util.js';
import { all, first, run, now } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { e164, logActivity } from './crm.js';

const DAYS = 90;
const ACT = `type = 'email' OR (type = 'call' AND status IN ('inbound','inbound_answered','missed','voicemail')) OR (type = 'stage' AND body LIKE 'Website audit request%')
  OR (type = 'meeting' AND body LIKE 'Booked online%') OR (type = 'note' AND body LIKE 'Replied STOP%')`;
export const VIEWS = ['all', 'unread', 'mine', 'texts', 'calls', 'email', 'forms'];

const chunk = (ids, n = 90) => { const out = []; for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n)); return out; };
async function inIds(env, sql, ids, ...pre) {
  const rows = [];
  for (const part of chunk(ids)) rows.push(...await all(env, sql.replace('@IDS', part.map(() => '?').join(',')), ...pre, ...part));
  return rows;
}

route('GET', '/api/conversations', async ({ env, user, url }) => {
  requireStaff(user);
  const view = VIEWS.includes(url.searchParams.get('view')) ? url.searchParams.get('view') : 'all';
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 60);
  const since = now() - DAYS * 864e5;
  const hide = await import('./lines.js').then((m) => m.hiddenLines(env, user)).catch(() => new Set());
  const src = {
    texts: `SELECT lead_id, at FROM messages WHERE at > ?${hide.size ? ` AND COALESCE(CASE WHEN direction = 'in' THEN to_num ELSE from_num END, '') NOT IN (${[...hide].map(() => '?').join(',')})` : ''}`,
    acts: `SELECT lead_id, at FROM activities WHERE lead_id IS NOT NULL AND at > ? AND (${ACT})`,
  };
  const hv = [...hide];
  const top = await all(env, `SELECT lead_id, MAX(at) AS at FROM (${src.texts} UNION ALL ${src.acts}) GROUP BY lead_id ORDER BY at DESC LIMIT 300`, since, ...hv, since);
  const ids = top.map((r) => r.lead_id).filter(Boolean);
  if (!ids.length) return json({ conversations: [], view });
  const [leads, lastMsg, unread, missed, emails, forms] = await Promise.all([
    inIds(env, 'SELECT id, business, contact_name, owner_name, phone, email, stage, owner_id, sms_stop, dnc, tags, source FROM leads WHERE id IN (@IDS)', ids),
    inIds(env, `SELECT m.lead_id, m.body, m.direction, m.at, m.status FROM messages m WHERE m.lead_id IN (@IDS) AND m.at = (SELECT MAX(at) FROM messages x WHERE x.lead_id = m.lead_id)`, ids),
    inIds(env, "SELECT lead_id, COUNT(*) AS n FROM messages WHERE direction = 'in' AND read = 0 AND lead_id IN (@IDS) GROUP BY lead_id", ids),
    inIds(env, "SELECT lead_id, COUNT(*) AS n, MAX(at) AS at FROM activities WHERE type = 'call' AND status IN ('missed','voicemail') AND seen_at IS NULL AND at > ? AND lead_id IN (@IDS) GROUP BY lead_id", ids, since),
    inIds(env, "SELECT lead_id, MAX(at) AS at, COUNT(*) AS n FROM activities WHERE type = 'email' AND lead_id IN (@IDS) GROUP BY lead_id", ids),
    inIds(env, "SELECT lead_id, MAX(at) AS at FROM activities WHERE ((type = 'stage' AND body LIKE 'Website audit request%') OR (type = 'meeting' AND body LIKE 'Booked online%')) AND lead_id IN (@IDS) GROUP BY lead_id", ids),
  ]);
  const by = (list) => Object.fromEntries(list.map((r) => [r.lead_id, r]));
  const L = Object.fromEntries(leads.map((l) => [l.id, l])), M = by(lastMsg), U = by(unread), X = by(missed), E = by(emails), F = by(forms);
  let rows = top.map((t) => {
    const l = L[t.lead_id];
    if (!l) return null;
    const m = M[l.id];
    const channels = [m ? 'text' : null, X[l.id] ? 'call' : null, E[l.id] ? 'email' : null, F[l.id] ? 'form' : null].filter(Boolean);
    const lastKind = [[m?.at, 'text'], [X[l.id]?.at, 'call'], [E[l.id]?.at, 'email'], [F[l.id]?.at, 'form']].filter((x) => x[0]).sort((a, b) => b[0] - a[0])[0]?.[1] || 'call';
    const preview = lastKind === 'text' && m ? `${m.direction === 'out' ? 'You: ' : ''}${m.body}` : lastKind === 'call' ? `Missed call${X[l.id]?.n > 1 ? ` (${X[l.id].n})` : ''}` : lastKind === 'email' ? 'Email sent' : lastKind === 'form' ? 'Asked for an audit or booked online' : '';
    return { id: l.id, business: l.business, person: l.owner_name || l.contact_name || '', phone: l.phone, email: l.email, stage: l.stage, owner_id: l.owner_id, stop: Boolean(l.sms_stop), dnc: Boolean(l.dnc),
      at: t.at, unread: (U[l.id]?.n || 0) + (X[l.id]?.n || 0), unreadTexts: U[l.id]?.n || 0, missed: X[l.id]?.n || 0, channels, last: lastKind, preview: String(preview).slice(0, 140), awaiting: m?.direction === 'in' };
  }).filter(Boolean);
  const counts = { all: rows.length, unread: rows.filter((r) => r.unread).length, mine: rows.filter((r) => r.owner_id === user.id).length,
    texts: rows.filter((r) => r.channels.includes('text')).length, calls: rows.filter((r) => r.channels.includes('call')).length, email: rows.filter((r) => r.channels.includes('email')).length, forms: rows.filter((r) => r.channels.includes('form')).length };
  if (view === 'unread') rows = rows.filter((r) => r.unread);
  else if (view === 'mine') rows = rows.filter((r) => r.owner_id === user.id);
  else if (view === 'texts') rows = rows.filter((r) => r.channels.includes('text'));
  else if (view === 'calls') rows = rows.filter((r) => r.channels.includes('call'));
  else if (view === 'email') rows = rows.filter((r) => r.channels.includes('email'));
  else if (view === 'forms') rows = rows.filter((r) => r.channels.includes('form'));
  if (q) rows = rows.filter((r) => `${r.business} ${r.person} ${r.phone} ${r.email}`.toLowerCase().includes(q) || String(r.phone || '').replace(/\D/g, '').includes(q.replace(/\D/g, '') || '@@'));
  return json({ conversations: rows.slice(0, 200), counts, view });
});

// Everything with one person, oldest first: texts, calls, voicemails, emails (with the body we sent), notes, stage moves and meetings.
route('GET', '/api/conversations/:leadId', async ({ env, user, params }) => {
  requireStaff(user);
  const l = await first(env, 'SELECT id, business, contact_name, owner_name, phone, email, website, city, state, stage, owner_id, tags, source, sms_consent, sms_stop, dnc, meet_at, next_action, next_action_at, timezone FROM leads WHERE id = ?', params.leadId);
  if (!l) throw new HttpError('Lead not found.', 404);
  const hide = await import('./lines.js').then((m) => m.hiddenLines(env, user)).catch(() => new Set());
  const [msgs, acts, mails] = await Promise.all([
    all(env, 'SELECT id, direction, body, status, error, at, from_num, to_num, by FROM messages WHERE lead_id = ? ORDER BY at DESC LIMIT 200', l.id),
    all(env, "SELECT id, type, status, outcome, dispo, body, duration, at, by, vm_secs FROM activities WHERE lead_id = ? AND type != 'sms' ORDER BY at DESC LIMIT 200", l.id).catch(() => all(env, "SELECT id, type, status, outcome, body, duration, at, by FROM activities WHERE lead_id = ? AND type != 'sms' ORDER BY at DESC LIMIT 200", l.id)),
    all(env, 'SELECT id, subject, body, to_email, status, at, user_id FROM mail_log WHERE lead_id = ? ORDER BY at DESC LIMIT 50', l.id),
  ]);
  const names = Object.fromEntries((await all(env, 'SELECT id, name, email FROM users')).map((u) => [u.id, u.name || u.email]));
  const items = [
    ...msgs.filter((m) => !hide.has(e164(m.direction === 'in' ? m.to_num : m.from_num))).map((m) => ({ id: m.id, kind: 'text', dir: m.direction, body: m.body, status: m.status, error: m.error, at: m.at, who: m.by ? names[m.by] : null })),
    ...acts.filter((a) => a.type !== 'email' || !mails.length).map((a) => ({ id: a.id, kind: a.type === 'call' || a.type === 'manual_call' ? 'call' : a.type, status: a.status, outcome: a.dispo || a.outcome, body: a.body, secs: a.duration, vm: a.vm_secs || null, at: a.at, who: a.by ? names[a.by] : null })),
    ...mails.map((m) => ({ id: m.id, kind: 'email', dir: 'out', subject: m.subject, body: m.body, status: m.status, to: m.to_email, at: m.at, who: m.user_id ? names[m.user_id] : null })),
  ].sort((a, b) => a.at - b.at);
  return json({ lead: l, items, rep: l.owner_id ? names[l.owner_id] || null : null });
});

route('POST', '/api/conversations/:leadId/read', async ({ env, user, params }) => {
  requireStaff(user);
  await run(env, "UPDATE messages SET read = 1 WHERE lead_id = ? AND direction = 'in' AND read = 0", params.leadId);
  await run(env, "UPDATE activities SET seen_at = ? WHERE lead_id = ? AND type = 'call' AND status IN ('missed','voicemail') AND seen_at IS NULL", now(), params.leadId).catch(() => {});
  return json({ ok: true });
});
route('POST', '/api/conversations/:leadId/note', async ({ env, user, params, body }) => {
  requireStaff(user);
  const text = String((await body()).text || '').trim().slice(0, 2000);
  if (!text) throw new HttpError('Write the note first.');
  const l = await first(env, 'SELECT id FROM leads WHERE id = ?', params.leadId);
  if (!l) throw new HttpError('Lead not found.', 404);
  await logActivity(env, { lead_id: l.id, type: 'note', body: text, by: user.id });
  return json({ ok: true });
});
