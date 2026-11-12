// Menu and dots: one call for every notification dot in the Hub (menu, Phone sub-tabs, app icon), and each person's
// own menu order and hidden items.
import { HttpError, json } from './util.js';
import { first, run, now } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { personalPart } from '../public/js/audiocfg.js';

const today = () => new Date().toISOString().slice(0, 10);

export async function badges(env, user) {
  const safe = (p) => p.catch(() => null);
  const [texts, calls, slack, alerts, work, leads] = await Promise.all([
    safe(first(env, "SELECT COUNT(*) AS n FROM messages WHERE direction = 'in' AND read = 0")),
    safe(first(env, "SELECT COUNT(*) AS n FROM activities WHERE type = 'call' AND status IN ('voicemail','missed') AND seen_at IS NULL AND at > ?", now() - 30 * 864e5)),
    safe(first(env, 'SELECT COALESCE(SUM(count), 0) AS n, COALESCE(SUM(mentions), 0) AS m FROM slack_unread WHERE user_id = ?', user.id)),
    safe(first(env, 'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', user.id)),
    safe(first(env, "SELECT COUNT(*) AS n FROM tasks t JOIN clients c ON c.id = t.client_id WHERE t.owner = ? AND t.status IN ('todo','doing') AND c.status = 'active' AND t.due <= ?", user.id, today())),
    safe(first(env, "SELECT COUNT(*) AS n FROM leads WHERE stage = 'audit_requested' AND attempts = 0")),
  ]);
  const b = {
    texts: texts?.n || 0, calls: calls?.n || 0, slack: slack?.n || 0, slackMentions: slack?.m || 0,
    alerts: alerts?.n || 0, work: work?.n || 0, pipeline: leads?.n || 0,
  };
  b.phone = b.texts + b.calls;
  b.total = b.phone + b.slackMentions + b.work + b.pipeline;
  return b;
}

route('GET', '/api/badges', async ({ env, user }) => {
  requireStaff(user);
  return json(await badges(env, user));
});

route('GET', '/api/me/nav', async ({ env, user }) => {
  requireStaff(user);
  const r = await first(env, 'SELECT nav_prefs FROM users WHERE id = ?', user.id);
  let prefs = null;
  try { prefs = r?.nav_prefs ? JSON.parse(r.nav_prefs) : null; } catch { prefs = null; }
  return json({ prefs });
});

route('PUT', '/api/me/nav', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const clean = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && /^[a-z]{2,20}$/.test(x)).slice(0, 30) : []);
  if (b.reset) { await run(env, 'UPDATE users SET nav_prefs = NULL WHERE id = ?', user.id); return json({ prefs: null }); }
  const cleanQ = (a) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === 'string' && /^(#\/|\/)[A-Za-z0-9\/_.-]{0,60}$/.test(x)))].slice(0, 14) : []);
  const cur = await first(env, 'SELECT nav_prefs FROM users WHERE id = ?', user.id);
  let old = {}; try { old = cur?.nav_prefs ? JSON.parse(cur.nav_prefs) : {}; } catch { old = {}; }
  // The top bar's quick links are saved on their own: sending only `quick` leaves the menu order alone.
  const prefs = b.order ? { order: clean(b.order), hidden: clean(b.hidden) } : { order: old.order || [], hidden: old.hidden || [] };
  if (b.order && !prefs.order.length) throw new HttpError('Nothing to save.');
  if (b.quick !== undefined) prefs.quick = cleanQ(b.quick); else if (old.quick) prefs.quick = old.quick;
  if (!prefs.order.length && !prefs.quick?.length) throw new HttpError('Nothing to save.');
  await run(env, 'UPDATE users SET nav_prefs = ? WHERE id = ?', JSON.stringify(prefs), user.id);
  return json({ prefs });
});

// Mic and audio settings that follow the person (not the device's mic or speaker ids).
route('GET', '/api/me/audio', async ({ env, user }) => {
  requireStaff(user);
  const r = await first(env, 'SELECT audio_cfg FROM users WHERE id = ?', user.id);
  let cfg = null;
  try { cfg = r?.audio_cfg ? JSON.parse(r.audio_cfg) : null; } catch { cfg = null; }
  return json({ cfg });
});

route('PUT', '/api/me/audio', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const cfg = personalPart(b?.cfg);
  await run(env, 'UPDATE users SET audio_cfg = ? WHERE id = ?', JSON.stringify(cfg), user.id);
  return json({ cfg });
});
