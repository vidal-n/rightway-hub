// Crash reports. When something breaks in the browser, the person is asked "Report it?" and the report lands here.
// Owners read them in Settings, Bug reports, and copy one to paste to Claude. Nothing is sent without the person pressing Send.
import { HttpError, json } from './util.js';
import { all, first, run, newId, now } from './db.js';
import { requireAdmin } from './auth.js';
import { route } from './router.js';

const KEEP = 300;
const cut = (v, n) => String(v == null ? '' : v).slice(0, n);

// Public on purpose: the "Hub did not load" screen has no session. Small bodies, deduped, and the table is trimmed to the newest 300.
route('POST', '/api/crash', async ({ env, user, body }) => {
  const b = (await body()) || {};
  const message = cut(b.message, 500);
  if (!message) throw new HttpError('Nothing to report.');
  const where = cut(b.where, 300);
  const dup = await first(env, 'SELECT id, count FROM crash_reports WHERE message = ? AND where_at = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1', message, where, now() - 10 * 60e3);
  if (dup) { await run(env, 'UPDATE crash_reports SET count = count + 1 WHERE id = ?', dup.id); return json({ ok: true, id: dup.id }); }
  const id = newId('cr_');
  await run(env, 'INSERT INTO crash_reports (id, created_at, user_id, who, role, message, stack, where_at, ua, build, extra, status, count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
    id, now(), user?.id || null, cut(user ? `${user.name || ''} ${user.email || ''}`.trim() : 'not logged in', 120), user?.role || '', message, cut(b.stack, 3000), where, cut(b.ua, 200), cut(b.build, 40), cut(JSON.stringify(b.extra || {}), 1500), 'new');
  await run(env, 'DELETE FROM crash_reports WHERE id NOT IN (SELECT id FROM crash_reports ORDER BY created_at DESC LIMIT ?)', KEEP).catch(() => {});
  return json({ ok: true, id });
}, { public: true });

route('GET', '/api/crash', async ({ env, user }) => {
  requireAdmin(user);
  const rows = await all(env, 'SELECT * FROM crash_reports ORDER BY created_at DESC LIMIT 100');
  return json({ reports: rows, open: rows.filter((r) => r.status === 'new').length });
});

route('PUT', '/api/crash/:id', async ({ env, user, params, body }) => {
  requireAdmin(user);
  const b = (await body()) || {};
  const status = b.status === 'fixed' ? 'fixed' : 'new';
  await run(env, 'UPDATE crash_reports SET status = ? WHERE id = ?', status, params.id);
  return json({ ok: true });
});

route('DELETE', '/api/crash', async ({ env, user }) => {
  requireAdmin(user);
  await run(env, "DELETE FROM crash_reports WHERE status = 'fixed'");
  return json({ ok: true });
});
