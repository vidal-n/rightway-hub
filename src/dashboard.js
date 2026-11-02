// Home dashboard for the team: today's calling, meetings, pipeline, clients, and what needs attention.
import { json } from './util.js';
import { all, first } from './db.js';
import { requireStaff } from './auth.js';
import { MONTHLY_CENTS, monthKey } from './plans.js';
import { inCallingHours } from './crm.js';
import { route } from './router.js';

const OPEN = ['new', 'attempting', 'callback', 'audit_requested', 'audit_booked', 'no_show', 'follow_up'];

route('GET', '/api/dashboard', async ({ env, user, url }) => {
  requireStaff(user);
  const t = Date.now();
  // The browser sends the start of its own day and week, so "today" means the rep's today.
  const day = Number(url.searchParams.get('since')) || t - (t % 864e5);
  const week = Number(url.searchParams.get('week')) || day - 6 * 864e5;
  const end = day + 864e5;
  const month = monthKey();
  const [mine, team, stages, leads, due, meetings, clients, tasks, posts, unread, orders, recent] = await Promise.all([
    first(env, `SELECT COUNT(*) AS dials, SUM(outcome IN ('conversation','booked','callback','not_interested','won')) AS talks, SUM(outcome = 'booked') AS booked
      FROM activities WHERE type = 'call' AND by = ? AND at >= ?`, user.id, day),
    first(env, `SELECT COUNT(*) AS dials, SUM(outcome IN ('conversation','booked','callback','not_interested','won')) AS talks, SUM(outcome = 'booked') AS booked
      FROM activities WHERE type = 'call' AND at >= ?`, week),
    all(env, 'SELECT stage, COUNT(*) AS n FROM leads GROUP BY stage'),
    all(env, `SELECT timezone, grade FROM leads WHERE dnc = 0 AND stage IN (${OPEN.map(() => '?').join(',')})`, ...OPEN),
    all(env, `SELECT id, business, contact_name, next_action, next_action_at, stage, grade FROM leads WHERE dnc = 0 AND next_action_at IS NOT NULL AND next_action_at < ?
      AND stage IN ('callback','follow_up','no_show','audit_requested') ORDER BY next_action_at LIMIT 8`, end),
    all(env, 'SELECT id, business, contact_name, meet_at, meet_link FROM leads WHERE meet_at IS NOT NULL AND meet_at > ? ORDER BY meet_at LIMIT 6', t - 3600e3),
    all(env, "SELECT id, name, plan, status, mrr_cents, billing_status, sample FROM clients WHERE status = 'active'"),
    first(env, `SELECT COUNT(*) AS total, SUM(tasks.status = 'done') AS done FROM tasks JOIN clients c ON c.id = tasks.client_id WHERE tasks.month = ? AND c.sample = 0 AND c.status = 'active'`, month),
    first(env, "SELECT COUNT(*) AS n FROM posts p JOIN clients c ON c.id = p.client_id WHERE p.status IN ('draft','approved') AND c.sample = 0"),
    first(env, "SELECT COUNT(*) AS n FROM messages WHERE direction = 'in' AND read = 0").catch(() => ({ n: 0 })),
    first(env, `SELECT SUM(status = 'sent') AS sent, SUM(status = 'signed') AS signed, SUM(status = 'paid') AS paid FROM work_orders WHERE created_at >= ?`, Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), 1)),
    all(env, `SELECT a.type, a.outcome, a.status, a.body, a.at, l.business, l.id AS lead_id FROM activities a LEFT JOIN leads l ON l.id = a.lead_id
      WHERE a.at >= ? ORDER BY a.at DESC LIMIT 10`, week),
  ]);
  const real = clients.filter((c) => !c.sample);
  const mrr = real.reduce((s, c) => s + (c.billing_status && c.mrr_cents != null ? c.mrr_cents : MONTHLY_CENTS[c.plan] || 0), 0) / 100;
  const byStage = Object.fromEntries(stages.map((r) => [r.stage, r.n]));
  return json({
    me: { dials: mine?.dials || 0, talks: mine?.talks || 0, booked: mine?.booked || 0 },
    week: { dials: team?.dials || 0, talks: team?.talks || 0, booked: team?.booked || 0 },
    pipeline: { byStage, open: leads.length, callableNow: leads.filter((l) => inCallingHours(l.timezone)).length, aLeads: leads.filter((l) => l.grade === 'A').length },
    due, meetings,
    clients: { active: real.length, mrr, sample: clients.find((c) => c.sample)?.id || null },
    work: { tasksDone: tasks?.done || 0, tasksTotal: tasks?.total || 0, postsWaiting: posts?.n || 0 },
    unread: unread?.n || 0,
    orders: { sent: orders?.sent || 0, signed: orders?.signed || 0, paid: orders?.paid || 0 },
    recent,
  });
});
