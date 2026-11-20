// Which Google apps the signed in person has connected, so buttons use Google when it is there and the Hub's own version when not.
import { api } from './core.js';

let cache = null, at = 0;
export async function googleApps() {
  if (cache && Date.now() - at < 60e3) return cache;
  try { const g = await api('/api/google/status'); cache = new Set(g.connected ? g.apps || [] : []); } catch { cache = new Set(); }
  at = Date.now();
  return cache;
}
export const hasGoogle = async (app) => (await googleApps()).has(app);

// Writing a new email: the Hub composer sends through Resend from info@rightwaygrowth.com whenever email is set up, so every
// outgoing email carries the company address. The person's own Gmail composer is only the backup when Resend is not set up.
// (Reading mail, the Gmail page and the recent mail lists still use Google.)
export async function composeViaGmail() {
  let on = false;
  try { on = Boolean((await api('/api/auth/state')).email); } catch { on = false; }
  return !on && (await hasGoogle('mail'));
}
