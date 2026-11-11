// Scope of work per client (no packages). The scope decides the client's monthly tasks and the delivery time estimate.
// Staff with the deliver ability edit it on the client page; the lead's quote carries it over when the deal is won.
import { HttpError, json } from './util.js';
import { all, first, run, batch, newId, now } from './db.js';
import { requireStaff, requireClientAccess } from './auth.js';
import { route } from './router.js';
import { monthKey, workloadOf, tasksForMonth } from './plans.js';
import { cleanScope, tierOf, SCOPE } from '../public/js/scope.js';
import { SERVICE_LIST } from '../public/js/plancopy.js';
import { dueDate } from '../public/js/guides.js';
import { savedGuides } from './work.js';

// Kinds the scope manages. Anything else on a client's task list (custom tasks, setup, planning) is never touched here.
const MANAGED = ['qa', 'post', 'photos', 'replies', 'onpage', 'technical', 'page', 'link', 'competitors', 'content', 'calls', 'monitor', 'reputation', 'report', 'meeting'];

// Bring this month's tasks in line with the scope: add what is missing, drop what no longer applies (only tasks nobody touched: still to do, no timer).
export async function syncScopeTasks(env, c, month = monthKey()) {
  if (c.parent_id) return { added: 0, removed: 0 };
  const rows = await all(env, 'SELECT id, kind, title, status, due FROM tasks WHERE client_id = ? AND month = ? ORDER BY sort, created_at', c.id, month);
  if (!rows.length) return { added: 0, removed: 0 }; // the engine makes the whole month when it is empty
  const want = tasksForMonth({ ...c, has_setup: true }, month).filter((t) => MANAGED.includes(t.kind));
  const wantBy = {};
  for (const t of want) (wantBy[t.kind] = wantBy[t.kind] || []).push(t);
  const ops = [];
  let added = 0, removed = 0;
  const at = now();
  const startedIds = new Set((await all(env, 'SELECT DISTINCT task_id FROM time_entries WHERE client_id = ? AND task_id IS NOT NULL', c.id).catch(() => [])).map((r) => r.task_id));
  for (const kind of MANAGED) {
    const have = rows.filter((r) => r.kind === kind);
    const need = wantBy[kind] || [];
    // New titles for the tasks nobody has finished, so "1 of 4" becomes "1 of 6" when the amount changes.
    have.filter((r) => r.status !== 'done').slice(0, need.length).forEach((r, i) => { if (kind !== 'meeting' && need[i] && r.title !== need[i].title) ops.push(['UPDATE tasks SET title = ? WHERE id = ?', need[i].title, r.id]); });
    for (let i = have.length; i < need.length; i++) {
      ops.push(['INSERT INTO tasks (id, client_id, month, kind, title, sort, created_at, owner, due) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        newId('t_'), c.id, month, kind, need[i].title, 900 + added, at, c.owner_id || null, dueDate(kind, month, i + 1, need.length, c.start_date)]);
      added += 1;
    }
    if (have.length > need.length) {
      const drop = have.filter((r) => r.status === 'todo' && !startedIds.has(r.id)).reverse().slice(0, have.length - need.length);
      for (const r of drop) { ops.push(['DELETE FROM tasks WHERE id = ?', r.id]); removed += 1; }
    }
  }
  if (ops.length) await batch(env, ops);
  return { added, removed };
}

export async function scopeView(env, c) {
  const saved = await savedGuides(env).catch(() => ({}));
  const w = workloadOf(c, saved);
  return {
    custom: w.custom, scope: w.scope, monthly: w.monthly, keywords: w.keywords, meetingMinutes: w.meetingMinutes, effort: w.effort,
    services: SERVICE_LIST.map((s) => ({ id: s.id, name: s.name, what: s.what, core: Boolean(s.core), unit: SCOPE[s.id]?.unit || '', def: SCOPE[s.id]?.def || 1, min: SCOPE[s.id]?.min || 1, max: SCOPE[s.id]?.max || 1 })),
  };
}

route('GET', '/api/clients/:id/scope', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  requireStaff(user);
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', params.id);
  if (!c) throw new HttpError('Client not found.', 404);
  return json(await scopeView(env, c));
});

route('PUT', '/api/clients/:id/scope', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', params.id);
  if (!c) throw new HttpError('Client not found.', 404);
  const b = (await body()) || {};
  const scope = cleanScope(b.services);
  if (!scope.length) throw new HttpError('Pick at least one service.');
  const tier = tierOf(scope);
  await run(env, 'UPDATE clients SET scope = ?, plan = ? WHERE id = ?', JSON.stringify(scope), tier, c.id);
  const next = { ...c, scope: JSON.stringify(scope), plan: tier };
  const synced = await syncScopeTasks(env, next);
  return json({ ...(await scopeView(env, next)), synced });
});
