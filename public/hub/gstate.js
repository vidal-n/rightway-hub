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
