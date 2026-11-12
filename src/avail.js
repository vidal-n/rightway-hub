// Available slots: when each person takes calls. Bookings outside them (or over their daily limit) are flagged before they are made.
import { json } from './util.js';
import { first, run } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { cleanAvail, availText } from '../public/js/avail.js';

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
