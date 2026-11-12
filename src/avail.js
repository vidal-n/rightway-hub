// Available slots: when each person takes calls. Bookings outside them (or over their daily limit) are flagged before they are made.
import { json } from './util.js';
import { first, run } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { cleanAvail, availText } from '../public/js/avail.js';

export const DEFAULT_GOAL = 60;
// Each person's own daily dial goal (1 to 1000). Default 60 until they set one.
export const dialGoalOf = async (env, userId) => { const r = await first(env, 'SELECT dial_goal FROM users WHERE id = ?', userId); const g = Number(r?.dial_goal); return g >= 1 ? Math.min(1000, Math.round(g)) : DEFAULT_GOAL; };
route('GET', '/api/me/dial-goal', async ({ env, user }) => { requireStaff(user); return json({ goal: await dialGoalOf(env, user.id) }); });
route('PUT', '/api/me/dial-goal', async ({ env, user, body }) => {
  requireStaff(user);
  const g = Math.round(Number((await body()).goal));
  if (!(g >= 1 && g <= 1000)) return json({ error: 'Pick a goal from 1 to 1000 dials a day.' }, 400);
  await run(env, 'UPDATE users SET dial_goal = ? WHERE id = ?', g, user.id);
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
