// Agents: status (available, break, lunch, training, meeting, admin, offline), presence from the open Hub, login and status time,
// who is on a call right now (owners can listen, whisper or barge from the Agents page), and call analytics for the team and lead quality.
import { HttpError, json } from './util.js';
import { all, first, run, newId, now } from './db.js';
import { requireStaff, requireAdmin } from './auth.js';
import { route } from './router.js';
import { getDispos } from './dispo.js';
import { STATUS_KEYS, callStats, statusTime } from '../public/js/callstats.js';
import { dayStart, TZ } from './day.js';
import { dtf } from '../public/js/fmtcache.js';

const STALE = 150e3; // no heartbeat for 2.5 minutes = not in the Hub
const LIVE = ['ready', 'connecting', 'ringing', 'in-progress', 'ringing_you'];

export { dayStart };
const hourIn = (t, tz = TZ) => Number(dtf('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)));

// The primary owner: the first owner account (the one that set the Hub up).
export async function isPrimary(env, user) {
  if (!user || user.role !== 'admin') return false;
  const p = await first(env, "SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1");
  return p?.id === user.id;
}

export async function setStatus(env, userId, status, at = now()) {
  await run(env, 'UPDATE agent_log SET end_at = ? WHERE user_id = ? AND end_at IS NULL', at, userId);
  if (status !== 'offline') await run(env, 'INSERT INTO agent_log (id, user_id, status, start_at) VALUES (?, ?, ?, ?)', newId('al_'), userId, status, at);
  await run(env, 'UPDATE users SET status = ?, status_at = ? WHERE id = ?', status, at, userId);
}

route('POST', '/api/me/status', async ({ env, user, body }) => {
  requireStaff(user);
  const s = String((await body()).status || '');
  if (!STATUS_KEYS.includes(s)) throw new HttpError('Pick a status.');
  if (s === 'maintenance' && !(await isPrimary(env, user))) throw new HttpError('Only the primary owner can use the maintenance status.', 403);
  await setStatus(env, user.id, s);
  if (s !== 'offline') await run(env, 'UPDATE users SET last_seen = ? WHERE id = ?', now(), user.id);
  return json({ ok: true, status: s, since: now() });
});

// The open Hub calls this every 45 seconds. First sign of life after being offline = logged in (Available).
// A gap (laptop closed) ends the last stretch where it stopped, so login time only counts time the Hub was really open.
route('POST', '/api/me/presence', async ({ env, user }) => {
  requireStaff(user);
  const u = await first(env, 'SELECT status, status_at, last_seen FROM users WHERE id = ?', user.id);
  const t = now();
  if (!u?.status || u.status === 'offline') await setStatus(env, user.id, 'available', t);
  else if (u.last_seen && t - u.last_seen > STALE) {
    await run(env, 'UPDATE agent_log SET end_at = ? WHERE user_id = ? AND end_at IS NULL', u.last_seen + 45e3, user.id);
    await run(env, 'INSERT INTO agent_log (id, user_id, status, start_at) VALUES (?, ?, ?, ?)', newId('al_'), user.id, u.status, t);
    await run(env, 'UPDATE users SET status_at = ? WHERE id = ?', t, user.id);
  }
  await run(env, 'UPDATE users SET last_seen = ? WHERE id = ?', t, user.id);
  const me = await first(env, 'SELECT status, status_at FROM users WHERE id = ?', user.id);
  return json({ status: me.status, since: me.status_at });
});

async function callRows(env, from, to, rep) {
  const rows = await all(env, `SELECT a.id, a.at, a.answered_at, a.duration, a.ended_at, a.dispo_at, a.status, a.outcome, a.dispo, a.by,
      l.source, l.grade, l.industry, l.timezone
    FROM activities a LEFT JOIN leads l ON l.id = a.lead_id
    WHERE a.type IN ('call','manual_call') AND a.at >= ? AND a.at < ?${rep ? ' AND a.by = ?' : ''} ORDER BY a.at LIMIT 20000`, from, to, ...(rep ? [rep] : []));
  // A disposition logged on its own right after a browser call is the same call: skip the empty "ready" shells nobody dialed.
  return rows.filter((r) => !(r.status === 'ready' && !r.outcome)).map((r) => ({ ...r, hour: hourIn(r.at) }));
}

// Can this viewer listen, whisper or barge on this call? Always answers, with a plain reason when not, so the buttons never just vanish.
// Owners and agents can listen, whisper and barge on each other's calls from the list (Nov 2026, V: like Convoso's live monitoring), except on a personal line.
// Nov 2026, V: no matter what, owners included, any line (personal lines and incoming calls too), because it is how the team is trained.
// The only calls you cannot join are your own, and a call that has not opened yet.
export function joinState(viewer, call) {
  if (!viewer || !['admin', 'team'].includes(viewer.role)) return { ok: false, why: '' };
  if (call.by === viewer.id || call.taker === viewer.id) return { ok: false, why: 'This is your own call.' };
  if (call.status === 'ringing_you') return { ok: false, why: 'This call is still ringing them.', wait: true };
  // An answered incoming call: joining moves it into a room first (src/voice.js), so it can always be joined.
  if (call.status === 'inbound' && call.answered_at) return { ok: true, why: '' };
  // A "Use my phone" call the lead answered: joining moves it into a room the same way.
  if (!call.conf_sid && call.status === 'in-progress' && String(call.cust_sid || '').startsWith('CA')) return { ok: true, why: '' };
  if (!call.conf_sid) {
    if (call.status === 'in-progress') return { ok: false, why: 'Starting up. The buttons turn on as soon as the line is open.', wait: true };
    return { ok: false, why: 'Starting up. The buttons turn on as soon as the line is open.', wait: true };
  }
  return { ok: true, why: '' };
}

route('GET', '/api/agents', async ({ env, user }) => {
  requireStaff(user);
  const t = now();
  const day = dayStart(t);
  const users = await all(env, "SELECT id, name, email, role, status, status_at, last_seen, avatar_at FROM users WHERE role IN ('admin','team') ORDER BY name");
  const live = await all(env, `SELECT a.id, a.at, a.status, a.answered_at, a.to_num, a.from_num, a.by, a.taker, a.conf_sid, a.cust_sid, a.in_conf, a.mon_by, a.mon_mode, l.business, l.id AS lead_id
    FROM activities a LEFT JOIN leads l ON l.id = a.lead_id
    WHERE a.type IN ('call','manual_call') AND (a.status IN (${LIVE.map(() => '?').join(',')}) OR (a.status = 'inbound' AND a.answered_at IS NOT NULL AND a.ended_at IS NULL)) AND a.at > ? ORDER BY a.at DESC`, ...LIVE, t - 3 * 3600e3);
  const logs = await all(env, 'SELECT user_id, status, start_at, end_at FROM agent_log WHERE start_at < ? AND (end_at IS NULL OR end_at > ?)', t, day);
  const calls = await callRows(env, day, t + 1);
  const stats = callStats(calls, { users });
  const out = users.map((u) => {
    const online = u.last_seen && t - u.last_seen < STALE && u.status && u.status !== 'offline';
    const call = live.find((c) => (c.by === u.id || c.taker === u.id) && (c.status !== 'ready' || t - c.at < 120e3));
    const mine = logs.filter((l) => l.user_id === u.id);
    const st = statusTime(mine, day, t, online ? t : Math.min(t, (u.last_seen || t) + 45e3));
    const s = stats.agents.find((a) => a.key === u.id);
    return {
      id: u.id, name: u.name || u.email, email: u.email, role: u.role, avatar: u.avatar_at || null, online: Boolean(online),
      status: call ? 'on_call' : online ? u.status : 'offline', picked: u.status || 'offline', since: call ? call.answered_at || call.at : u.status_at, lastSeen: u.last_seen,
      call: call ? { id: call.id, business: call.business, leadId: call.lead_id, number: call.status === 'inbound' ? call.from_num : call.to_num, inbound: call.status === 'inbound', status: call.status === 'inbound' ? 'in-progress' : call.status, answeredAt: call.answered_at, at: call.at, join: joinState(user, call), canJoin: joinState(user, call).ok, monitoredBy: call.mon_by, mode: call.mon_mode, mine: call.mon_by === user.id } : null,
      today: { login: st.login, per: st.per, dials: s?.dials || 0, connects: s?.connects || 0, booked: s?.booked || 0, talk: s?.talk || 0, avgHandle: s?.avgHandle || 0, avgTalk: s?.avgTalk || 0 },
    };
  });
  const order = { on_call: 0, available: 1, meeting: 2, training: 2, admin: 2, maintenance: 2, break: 3, lunch: 3, offline: 9 };
  out.sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5) || String(a.name).localeCompare(String(b.name)));
  return json({ agents: out, canMonitor: true, me: user.id, team: stats.total });
});

// Call analytics. Owners see everyone (or one rep); a teammate sees their own numbers.
route('GET', '/api/analytics/calls', async ({ env, user, url }) => {
  requireStaff(user);
  const t = now();
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 7));
  const from = days === 1 ? dayStart(t) : dayStart(t) - (days - 1) * 864e5;
  const rep = user.role === 'admin' ? (url.searchParams.get('rep') || '') : user.id;
  const users = await all(env, "SELECT id, name, email FROM users WHERE role IN ('admin','team') ORDER BY name");
  const rows = await callRows(env, from, t + 1, rep);
  const stats = callStats(rows, { users, dispos: await getDispos(env) });
  const logs = await all(env, `SELECT user_id, status, start_at, end_at FROM agent_log WHERE start_at < ? AND (end_at IS NULL OR end_at > ?)${rep ? ' AND user_id = ?' : ''}`, t, from, ...(rep ? [rep] : []));
  const seen = Object.fromEntries((await all(env, 'SELECT id, last_seen, status FROM users')).map((u) => [u.id, u]));
  stats.agents = stats.agents.map((a) => {
    const u = seen[a.key];
    const open = u && u.status !== 'offline' && u.last_seen && t - u.last_seen < STALE ? t : Math.min(t, (u?.last_seen || t) + 45e3);
    const st = statusTime(logs.filter((l) => l.user_id === a.key), from, t, open);
    return { ...a, login: st.login, per: st.per, dialsPerHour: st.login > 600 ? a.dials / (st.login / 3600) : 0 };
  });
  // Agents with login time but no calls still show up.
  for (const u of users) {
    if (rep && u.id !== rep) continue;
    if (stats.agents.some((a) => a.key === u.id)) continue;
    const st = statusTime(logs.filter((l) => l.user_id === u.id), from, t, Math.min(t, (seen[u.id]?.last_seen || t) + 45e3));
    if (st.login) stats.agents.push({ key: u.id, label: u.name || u.email, dials: 0, connects: 0, decision: 0, booked: 0, talk: 0, handle: 0, longest: 0, connectRate: 0, bookRate: 0, avgTalk: 0, avgHandle: 0, login: st.login, per: st.per, dialsPerHour: 0 });
  }
  // Lead inventory: what is left to call, by source and grade.
  const inv = await all(env, `SELECT COALESCE(source, 'Unknown') AS source, COALESCE(grade, 'Not scored') AS grade,
      COUNT(*) AS total, SUM(CASE WHEN attempts = 0 AND dnc = 0 THEN 1 ELSE 0 END) AS fresh,
      SUM(CASE WHEN stage IN ('won','lost') OR dnc = 1 THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN stage = 'audit_booked' THEN 1 ELSE 0 END) AS booked, ROUND(AVG(score)) AS score
    FROM leads GROUP BY 1, 2 ORDER BY total DESC LIMIT 200`);
  // Day by day trend and the full funnel: dials to contacts to conversations to booked to signed to paid.
  const dayKey = (t) => dtf('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
  const daily = new Map();
  for (let d = from; d <= t; d += 864e5) daily.set(dayKey(d), { day: dayKey(d), dials: 0, contacts: 0, booked: 0, talk: 0 });
  const { isOutbound, isConnect, isBooked, talkSecs } = await import('../public/js/callstats.js');
  for (const r of rows) {
    if (!isOutbound(r)) continue;
    const x = daily.get(dayKey(r.at)) || daily.set(dayKey(r.at), { day: dayKey(r.at), dials: 0, contacts: 0, booked: 0, talk: 0 }).get(dayKey(r.at));
    x.dials++; if (isConnect(r)) x.contacts++; if (isBooked(r)) x.booked++; x.talk += talkSecs(r);
  }
  const wo = await first(env, `SELECT SUM(CASE WHEN signed_at >= ? THEN 1 ELSE 0 END) AS signed, SUM(CASE WHEN paid_at >= ? THEN 1 ELSE 0 END) AS paid,
      SUM(CASE WHEN paid_at >= ? THEN monthly_cents ELSE 0 END) AS mrr FROM work_orders WHERE (signed_at >= ? OR paid_at >= ?)${rep ? ' AND lead_id IN (SELECT id FROM leads WHERE owner_id = ? OR meet_by = ?)' : ''}`,
  from, from, from, from, from, ...(rep ? [rep, rep] : [])).catch(() => null);
  const held = await first(env, `SELECT COUNT(*) AS n FROM leads WHERE meet_at >= ? AND meet_at < ? AND stage NOT IN ('audit_booked','no_show')${rep ? ' AND meet_by = ?' : ''}`, from, t, ...(rep ? [rep] : []));
  const funnel = [
    ['Dials', stats.total.dials], ['Contacts', stats.total.connects], ['Conversations', stats.total.decision], ['Audits booked', stats.total.booked],
    ['Audits held', held?.n || 0], ['Signed', wo?.signed || 0], ['Paid', wo?.paid || 0],
  ].map(([label, n]) => ({ label, n }));
  return json({ days, from, rep, users: user.role === 'admin' ? users : users.filter((u) => u.id === user.id), ...stats, inventory: inv, daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)), funnel, newMrr: (wo?.mrr || 0) / 100 });
});

// Training progress: which scripts, drills, playbooks and setup steps this person has ticked off.
route('GET', '/api/me/training', async ({ env, user }) => {
  requireStaff(user);
  const r = await first(env, 'SELECT training FROM users WHERE id = ?', user.id);
  let done = [];
  try { done = JSON.parse(r?.training || '[]'); } catch { done = []; }
  return json({ done: Array.isArray(done) ? done : [] });
});
route('PUT', '/api/me/training', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const done = (Array.isArray(b.done) ? b.done : []).filter((x) => typeof x === 'string' && /^[a-z]{2,12}:[a-z_]{2,20}$/.test(x)).slice(0, 100);
  await run(env, 'UPDATE users SET training = ? WHERE id = ?', JSON.stringify([...new Set(done)]), user.id);
  return json({ done });
});

// Master sheet: every lead with every detail and its call history rolled up, for sorting, filtering and export.
route('GET', '/api/analytics/master', async ({ env, user }) => {
  requireAdmin(user); // the whole lead list: owners only
  const leads = await all(env, `SELECT id, business, contact_name, phone, email, website, city, state, zip, timezone, industry, category, source, tags, stage, grade, score,
      rating, reviews, map_rank, problems, attempts, last_call_at, next_action_at, next_action, meet_at, meet_by, owner_id, scrub, created_at, intel_at, quote, dnc
    FROM leads ORDER BY updated_at DESC LIMIT 5000`);
  const calls = await all(env, `SELECT lead_id, COUNT(*) AS dials, SUM(CASE WHEN outcome IN ('conversation','booked','callback','not_interested','gatekeeper','dnc','won','hung_up') THEN 1 ELSE 0 END) AS contacts,
      SUM(CASE WHEN answered_at IS NOT NULL THEN COALESCE(duration, 0) ELSE 0 END) AS talk, MAX(at) AS last_at
    FROM activities WHERE type IN ('call','manual_call') AND lead_id IS NOT NULL AND (status IS NULL OR status NOT IN ('inbound','missed','voicemail','inbound_answered','ready')) GROUP BY lead_id`);
  const last = await all(env, `SELECT a.lead_id, COALESCE(a.dispo, a.outcome) AS dispo FROM activities a JOIN (SELECT lead_id, MAX(at) AS at FROM activities WHERE type IN ('call','manual_call') AND outcome IS NOT NULL GROUP BY lead_id) m ON m.lead_id = a.lead_id AND m.at = a.at`);
  const users = Object.fromEntries((await all(env, 'SELECT id, name, email FROM users')).map((u) => [u.id, u.name || u.email]));
  const cm = new Map(calls.map((c) => [c.lead_id, c])), lm = new Map(last.map((x) => [x.lead_id, x.dispo]));
  const rows = leads.map((l) => {
    const c = cm.get(l.id) || {};
    let q = null; try { q = l.quote ? JSON.parse(l.quote) : null; } catch { q = null; }
    const showMeet = user.role === 'admin' || l.meet_by === user.id || (!l.meet_by && l.owner_id === user.id);
    return { ...l, quote: undefined, monthly: q?.monthly ?? null, setup: q?.setup ?? null, dials: c.dials || 0, contacts: c.contacts || 0, talk: c.talk || 0, last_dispo: lm.get(l.id) || null,
      owner: users[l.owner_id] || '', booked_by: users[l.meet_by] || '', meet_at: showMeet ? l.meet_at : null, researched: Boolean(l.intel_at) };
  });
  return json({ rows });
});
