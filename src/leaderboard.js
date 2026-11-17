// Leaderboard (Nov 2026, V: Coming up showed Kiron's and online bookings next to his own, so the team numbers moved to their own widget on the
// Dialer and the Dashboard). Modeled on the rep leaderboards in Close.com Reports and the Orum and Nooks team boards.
// Per person: dials, owner talks, booked, booked per owner talk (the conversion rate), and upcoming appointments they run. Online bookings
// and anything with no rep behind it sit on their own "Online and unassigned" row so nobody is credited for them.
// Counts use the same rules as the dialer strip (`BOOKED_SQL`, owner talk = a conversation, booked, callback, not interested or won result).
import { json } from './util.js';
import { all, first } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { BOOKED_SQL } from './crm.js';
import { dayFrom } from './day.js';

export const PERIODS = [1, 7, 30];

route('GET', '/api/leaderboard', async ({ env, user, url }) => {
  requireStaff(user);
  const t = Date.now();
  const days = PERIODS.includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 1;
  const today = dayFrom(url.searchParams.get('since'), t);
  const from = today - (days - 1) * 864e5;
  const [people, rows, appts, handed] = await Promise.all([
    all(env, "SELECT id, name, email, role, avatar_at FROM users WHERE role IN ('admin','team') ORDER BY name"),
    all(env, `SELECT by, SUM(type = 'call' AND COALESCE(outcome, '') != 'glitch') AS dials, SUM(type = 'call' AND outcome IN ('conversation','booked','callback','not_interested','won')) AS talks, SUM(${BOOKED_SQL}) AS booked
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
    return { id: p.id, name: p.name || p.email, role: p.role, avatar: p.avatar_at || null, dials, talks, booked, rate: rate(booked, talks), upcoming: run.get(p.id) || 0 };
  });
  // Everything booked or run by nobody on the team: online bookings, deleted users, old rows.
  let otherBooked = 0, otherUpcoming = 0;
  for (const [k, r] of by) if (!ids.has(k)) otherBooked += r.booked || 0;
  for (const [k, n] of run) if (!ids.has(k)) otherUpcoming += n;
  agents.sort((a, b) => b.booked - a.booked || (b.rate ?? -1) - (a.rate ?? -1) || b.talks - a.talks || b.dials - a.dials || String(a.name).localeCompare(String(b.name)));
  const sum = (k) => agents.reduce((s, a) => s + a[k], 0);
  const talks = sum('talks'), booked = sum('booked');
  return json({
    days, from, agents,
    other: { booked: otherBooked, upcoming: otherUpcoming },
    handedOff: handed?.n || 0,
    team: { dials: sum('dials'), talks, booked, rate: rate(booked, talks) },
    me: user.id,
  });
});
