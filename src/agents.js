// Agents: status (available, break, lunch, training, meeting, admin, offline), presence from the open Hub, login and status time,
// who is on a call right now (owners can listen, whisper or barge from the Agents page), and call analytics for the team and lead quality.
import { HttpError, json } from './util.js';
import { all, first, run, newId, now } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { getDispos } from './dispo.js';
import { STATUS_KEYS, callStats, statusTime } from '../public/js/callstats.js';

const TZ = 'America/New_York';
const STALE = 150e3; // no heartbeat for 2.5 minutes = not in the Hub
const LIVE = ['ready', 'connecting', 'ringing', 'in-progress', 'ringing_you'];

// Midnight in New York, as a timestamp.
export function dayStart(t = now(), tz = TZ) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const sinceMidnight = ((+p.hour * 60 + +p.minute) * 60 + +p.second) * 1000 + (t % 1000);
  return t - sinceMidnight;
}
const hourIn = (t, tz = TZ) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)));

export async function setStatus(env, userId, status, at = now()) {
  await run(env, 'UPDATE agent_log SET end_at = ? WHERE user_id = ? AND end_at IS NULL', at, userId);
  if (status !== 'offline') await run(env, 'INSERT INTO agent_log (id, user_id, status, start_at) VALUES (?, ?, ?, ?)', newId('al_'), userId, status, at);
  await run(env, 'UPDATE users SET status = ?, status_at = ? WHERE id = ?', status, at, userId);
}

route('POST', '/api/me/status', async ({ env, user, body }) => {
  requireStaff(user);
  const s = String((await body()).status || '');
  if (!STATUS_KEYS.includes(s)) throw new HttpError('Pick a status.');
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

route('GET', '/api/agents', async ({ env, user }) => {
  requireStaff(user);
  const t = now();
  const day = dayStart(t);
  const users = await all(env, "SELECT id, name, email, role, status, status_at, last_seen FROM users WHERE role IN ('admin','team') ORDER BY name");
  const live = await all(env, `SELECT a.id, a.at, a.status, a.answered_at, a.to_num, a.from_num, a.by, a.conf_sid, a.mon_by, a.mon_mode, l.business, l.id AS lead_id
    FROM activities a LEFT JOIN leads l ON l.id = a.lead_id
    WHERE a.type IN ('call','manual_call') AND a.status IN (${LIVE.map(() => '?').join(',')}) AND a.at > ? ORDER BY a.at DESC`, ...LIVE, t - 3 * 3600e3);
  const logs = await all(env, 'SELECT user_id, status, start_at, end_at FROM agent_log WHERE start_at < ? AND (end_at IS NULL OR end_at > ?)', t, day);
  const calls = await callRows(env, day, t + 1);
  const stats = callStats(calls, { users });
  const out = users.map((u) => {
    const online = u.last_seen && t - u.last_seen < STALE && u.status && u.status !== 'offline';
    const call = live.find((c) => c.by === u.id && (c.status !== 'ready' || t - c.at < 120e3));
    const mine = logs.filter((l) => l.user_id === u.id);
    const st = statusTime(mine, day, t, online ? t : Math.min(t, (u.last_seen || t) + 45e3));
    const s = stats.agents.find((a) => a.key === u.id);
    return {
      id: u.id, name: u.name || u.email, email: u.email, role: u.role, online: Boolean(online),
      status: call ? 'on_call' : online ? u.status : 'offline', picked: u.status || 'offline', since: call ? call.answered_at || call.at : u.status_at, lastSeen: u.last_seen,
      call: call ? { id: call.id, business: call.business, leadId: call.lead_id, number: call.to_num, status: call.status, answeredAt: call.answered_at, at: call.at, canJoin: Boolean(call.conf_sid) && call.by !== user.id, monitoredBy: call.mon_by, mode: call.mon_mode, mine: call.mon_by === user.id } : null,
      today: { login: st.login, per: st.per, dials: s?.dials || 0, connects: s?.connects || 0, booked: s?.booked || 0, talk: s?.talk || 0, avgHandle: s?.avgHandle || 0, avgTalk: s?.avgTalk || 0 },
    };
  });
  const order = { on_call: 0, available: 1, meeting: 2, training: 2, admin: 2, break: 3, lunch: 3, offline: 9 };
  out.sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5) || String(a.name).localeCompare(String(b.name)));
  return json({ agents: out, canMonitor: user.role === 'admin', me: user.id, team: stats.total });
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
  return json({ days, from, rep, users: user.role === 'admin' ? users : users.filter((u) => u.id === user.id), ...stats, inventory: inv });
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
