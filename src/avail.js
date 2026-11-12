// Available slots: when each person takes calls. Bookings outside them (or over their daily limit) are flagged before they are made.
import { json } from './util.js';
import { first, run } from './db.js';
import { requireStaff, requireAdmin } from './auth.js';
import { route } from './router.js';
import { cleanAvail, availText } from '../public/js/avail.js';

export const DEFAULT_GOAL = 60;
// Each person's own daily dial goal (1 to 1000). Default 60 until they set one.
export const dialGoalOf = async (env, userId) => { const r = await first(env, 'SELECT dial_goal FROM users WHERE id = ?', userId); const g = Number(r?.dial_goal); return g >= 1 ? Math.min(1000, Math.round(g)) : DEFAULT_GOAL; };
route('GET', '/api/me/dial-goal', async ({ env, user }) => { requireStaff(user); return json({ goal: await dialGoalOf(env, user.id) }); });
const goalOk = (v) => { const g = Math.round(Number(v)); return g >= 1 && g <= 1000 ? g : null; };
// Everyone has their own goal. Owners set theirs here; an agent's goal is set by an owner (PUT /api/users/:id/dial-goal).
route('PUT', '/api/me/dial-goal', async ({ env, user, body }) => {
  requireStaff(user);
  if (user.role !== 'admin') return json({ error: 'Your owner sets your daily dial goal.' }, 403);
  const g = goalOk((await body()).goal);
  if (!g) return json({ error: 'Pick a goal from 1 to 1000 dials a day.' }, 400);
  await run(env, 'UPDATE users SET dial_goal = ? WHERE id = ?', g, user.id);
  return json({ goal: g });
});
route('PUT', '/api/users/:id/dial-goal', async ({ env, user, params, body }) => {
  requireAdmin(user);
  const g = goalOk((await body()).goal);
  if (!g) return json({ error: 'Pick a goal from 1 to 1000 dials a day.' }, 400);
  const target = await first(env, 'SELECT id, role FROM users WHERE id = ?', params.id);
  if (!target || !['admin', 'team'].includes(target.role)) return json({ error: 'Teammate not found.' }, 404);
  if (target.role === 'admin' && target.id !== user.id) return json({ error: 'Owners set their own goal.' }, 403);
  await run(env, 'UPDATE users SET dial_goal = ? WHERE id = ?', g, target.id);
  return json({ goal: g });
});

export const availOf = (row) => { try { return cleanAvail(row?.avail ? JSON.parse(row.avail) : null); } catch { return null; } };

route('GET', '/api/me/availability', async ({ env, user }) => {
  requireStaff(user);
  const av = availOf(await first(env, 'SELECT avail FROM users WHERE id = ?', user.id));
  return json({ avail: av, text: availText(av) });
});

route('PUT', '/api/me/availability', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  if (b.clear) { await run(env, 'UPDATE users SET avail = NULL WHERE id = ?', user.id); return json({ avail: null, text: availText(null) }); }
  const av = cleanAvail(b.avail);
  await run(env, 'UPDATE users SET avail = ? WHERE id = ?', av ? JSON.stringify(av) : null, user.id);
  return json({ avail: av, text: availText(av) });
});
