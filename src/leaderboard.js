// Leaderboard (Nov 2026, V: Coming up showed Kiron's and online bookings next to his own, so the team numbers moved to their own widget on the
// Dialer and the Dashboard). Modeled on the rep leaderboards in Close.com Reports and the Orum and Nooks team boards.
// Per person: dials, owner talks, booked, booked per owner talk (the conversion rate), and upcoming appointments they run. Online bookings
// and anything with no rep behind it sit on their own "Online and unassigned" row so nobody is credited for them.
// Counts use the same rules as the dialer strip (`BOOKED_SQL`, owner talk = a conversation, booked, callback, not interested or won result).
// Outside competitors (Nov 2026, V: Josh and Grace compete for fun against the team). Their numbers are typed in by an owner, live in
// `rivals` and `rival_days` only, and are never read by any report, analytics, booking or dial count. Shown as "Outside the team"
// with a Rightway team total to compare against.
import { json, HttpError } from './util.js';
import { all, first, run, batch, newId, now } from './db.js';
import { requireStaff, requireAdmin } from './auth.js';
import { route } from './router.js';
import { BOOKED_SQL, CALLBACK_SQL } from './crm.js';
import { dayFrom, dayStart } from './day.js';

export const PERIODS = [1, 7, 30];

route('GET', '/api/leaderboard', async ({ env, user, url }) => {
  requireStaff(user);
  const t = Date.now();
  const days = PERIODS.includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 1;
  const today = dayFrom(url.searchParams.get('since'), t);
  const from = today - (days - 1) * 864e5;
  const [people, rows, appts, handed] = await Promise.all([
    all(env, "SELECT id, name, email, role, avatar_at FROM users WHERE role IN ('admin','team') ORDER BY name"),
    all(env, `SELECT by, SUM(type = 'call' AND COALESCE(outcome, '') != 'glitch') AS dials, SUM(type = 'call' AND outcome IN ('conversation','booked','callback','not_interested','won')) AS talks, SUM(${BOOKED_SQL}) AS booked, SUM(${CALLBACK_SQL}) AS callbacks
      FROM activities WHERE type IN ('call','meeting') AND at >= ? AND at <= ? GROUP BY by`, from, t),
    // Who runs each upcoming appointment: the closer, else the person who booked it. No one = an online booking nobody has claimed.
    all(env, 'SELECT COALESCE(closer_id, meet_by) AS who, COUNT(*) AS n FROM leads WHERE meet_at > ? GROUP BY COALESCE(closer_id, meet_by)', t - 3600e3),
    first(env, 'SELECT COUNT(*) AS n FROM leads WHERE meet_at > ? AND meet_by IS NOT NULL AND closer_id IS NOT NULL AND meet_by != closer_id', t - 3600e3),
  ]);
  const by = new Map(rows.map((r) => [r.by || '', r]));
  const run = new Map(appts.map((r) => [r.who || '', r.n]));
  const ids = new Set(people.map((p) => p.id));
  const rate = (booked, talks) => (talks ? Math.round((1000 * booked) / talks) / 10 : null);
  const agents = people.map((p) => {
    const r = by.get(p.id) || {};
    const dials = r.dials || 0, talks = r.talks || 0, booked = r.booked || 0;
    return { id: p.id, name: p.name || p.email, role: p.role, avatar: p.avatar_at || null, dials, talks, booked, callbacks: r.callbacks || 0, rate: rate(booked, talks), upcoming: run.get(p.id) || 0 };
  });
  // Everything booked or run by nobody on the team: online bookings, deleted users, old rows.
  let otherBooked = 0, otherUpcoming = 0;
  for (const [k, r] of by) if (!ids.has(k)) otherBooked += r.booked || 0;
  for (const [k, n] of run) if (!ids.has(k)) otherUpcoming += n;
  agents.sort((a, b) => b.booked - a.booked || (b.rate ?? -1) - (a.rate ?? -1) || b.talks - a.talks || b.dials - a.dials || String(a.name).localeCompare(String(b.name)));
  const sum = (k) => agents.reduce((s, a) => s + a[k], 0);
  const talks = sum('talks'), booked = sum('booked');
  // Callbacks: the rep's own, set on a call. Booked audits stay separate (a callback is not a booking).
  let otherCallbacks = 0;
  for (const [k, r] of by) if (!ids.has(k)) otherCallbacks += r.callbacks || 0;
  // Outside competitors: summed from their own typed-in days over the same period.
  const rivalRows = await all(env, `SELECT r.id, r.name, COALESCE(SUM(d.dials), 0) AS dials, COALESCE(SUM(d.talks), 0) AS talks,
    COALESCE(SUM(d.booked), 0) AS booked, COALESCE(SUM(d.callbacks), 0) AS callbacks
    FROM rivals r LEFT JOIN rival_days d ON d.rival_id = r.id AND d.day >= ? AND d.day <= ? GROUP BY r.id, r.name`, from, today).catch(() => []);
  const outside = rivalRows.map((r) => ({ id: r.id, name: r.name, dials: r.dials, talks: r.talks, booked: r.booked, callbacks: r.callbacks, rate: rate(r.booked, r.talks) }))
    .sort((a, b) => b.booked - a.booked || (b.rate ?? -1) - (a.rate ?? -1) || b.talks - a.talks || a.name.localeCompare(b.name));
  const outTotal = outside.reduce((s, r) => ({ dials: s.dials + r.dials, talks: s.talks + r.talks, booked: s.booked + r.booked, callbacks: s.callbacks + r.callbacks }), { dials: 0, talks: 0, booked: 0, callbacks: 0 });
  return json({
    days, from, agents,
    other: { booked: otherBooked, upcoming: otherUpcoming, callbacks: otherCallbacks },
    handedOff: handed?.n || 0,
    team: { dials: sum('dials'), talks, booked, callbacks: sum('callbacks'), rate: rate(booked, talks) },
    outside: { list: outside, total: { ...outTotal, rate: rate(outTotal.booked, outTotal.talks) } },
    canEdit: user.role === 'admin',
    me: user.id,
  });
});

// ---------- outside competitors: owners add names and type each day's numbers ----------
const dayMs = (date) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new HttpError('Pick a date.');
  const t = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(t)) throw new HttpError('Pick a date.');
  return dayStart(t, 'America/New_York');
};
const count = (v) => Math.max(0, Math.min(100000, Math.round(Number(v) || 0)));

route('POST', '/api/rivals', async ({ env, user, body }) => {
  requireAdmin(user);
  const name = String((await body()).name || '').trim().slice(0, 80);
  if (!name) throw new HttpError('Type a name.');
  const id = newId('rv_');
  await run(env, 'INSERT INTO rivals (id, name, created_at) VALUES (?, ?, ?)', id, name, now());
  return json({ id, name });
});

route('DELETE', '/api/rivals/:id', async ({ env, user, params }) => {
  requireAdmin(user);
  await batch(env, [['DELETE FROM rival_days WHERE rival_id = ?', params.id], ['DELETE FROM rivals WHERE id = ?', params.id]]);
  return json({ ok: true });
});

route('GET', '/api/rivals/:id/day', async ({ env, user, params, url }) => {
  requireAdmin(user);
  const day = dayMs(url.searchParams.get('date'));
  const r = await first(env, 'SELECT dials, talks, booked, callbacks FROM rival_days WHERE rival_id = ? AND day = ?', params.id, day);
  return json({ dials: r?.dials || 0, talks: r?.talks || 0, booked: r?.booked || 0, callbacks: r?.callbacks || 0 });
});

// Inline edit on the leaderboard (Nov 2026, V: edit the table itself, no form): the number typed is the total for the period on screen.
// The difference goes on today's row; a lower number takes the rest off earlier days in the period, newest first. Never below 0.
const FIELDS = ['dials', 'talks', 'booked', 'callbacks'];
route('PUT', '/api/rivals/:id/totals', async ({ env, user, params, body, url }) => {
  requireAdmin(user);
  const b = await body();
  if (!await first(env, 'SELECT id FROM rivals WHERE id = ?', params.id)) throw new HttpError('Not found.', 404);
  const t = Date.now();
  const days = PERIODS.includes(Number(b.days)) ? Number(b.days) : 1;
  const today = dayFrom(b.since ?? url.searchParams.get('since'), t);
  const from = today - (days - 1) * 864e5;
  const rows = await all(env, 'SELECT day, dials, talks, booked, callbacks FROM rival_days WHERE rival_id = ? AND day >= ? AND day <= ? ORDER BY day DESC', params.id, from, today);
  const byDay = new Map(rows.map((r) => [r.day, { ...r }]));
  if (!byDay.has(today)) byDay.set(today, { day: today, dials: 0, talks: 0, booked: 0, callbacks: 0 });
  for (const f of FIELDS) {
    if (b[f] === undefined || b[f] === null || b[f] === '') continue;
    const want = count(b[f]);
    const have = [...byDay.values()].reduce((s, r) => s + (r[f] || 0), 0);
    let delta = want - have;
    if (delta >= 0) { byDay.get(today)[f] += delta; continue; }
    for (const r of [...byDay.values()].sort((x, y) => y.day - x.day)) {
      if (!delta) break;
      const take = Math.min(r[f] || 0, -delta);
      r[f] -= take; delta += take;
    }
  }
  await batch(env, [...byDay.values()].map((r) => [`INSERT INTO rival_days (rival_id, day, dials, talks, booked, callbacks) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(rival_id, day) DO UPDATE SET dials = excluded.dials, talks = excluded.talks, booked = excluded.booked, callbacks = excluded.callbacks`,
  params.id, r.day, r.dials, r.talks, r.booked, r.callbacks]));
  const sum = (f) => [...byDay.values()].reduce((s, r) => s + (r[f] || 0), 0);
  return json({ ok: true, dials: sum('dials'), talks: sum('talks'), booked: sum('booked'), callbacks: sum('callbacks') });
});

route('PUT', '/api/rivals/:id/day', async ({ env, user, params, body }) => {
  requireAdmin(user);
  const b = await body();
  if (!await first(env, 'SELECT id FROM rivals WHERE id = ?', params.id)) throw new HttpError('Not found.', 404);
  const day = dayMs(b.date);
  const v = { dials: count(b.dials), talks: count(b.talks), booked: count(b.booked), callbacks: count(b.callbacks) };
  await run(env, `INSERT INTO rival_days (rival_id, day, dials, talks, booked, callbacks) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(rival_id, day) DO UPDATE SET dials = excluded.dials, talks = excluded.talks, booked = excluded.booked, callbacks = excluded.callbacks`,
  params.id, day, v.dials, v.talks, v.booked, v.callbacks);
  return json({ ok: true, day });
});
