// Work schedule blocks: each person's own week (what they do and when), editable by them, viewable and editable by owners.
// The owner's week starts filled in once; everyone else starts blank (or loads a starter on purpose).
import { HttpError, json } from './util.js';
import { all, first, batch, newId, now, setSetting } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { validateBlocks, STARTERS, KINDS } from '../public/js/schedule.js';

async function target(env, user, id) {
  if (!id || id === user.id) return { id: user.id, name: user.name || user.email, role: user.role };
  if (user.role !== 'admin') throw new HttpError('You can only see your own schedule.', 403);
  const u = await first(env, "SELECT id, name, email, role FROM users WHERE id = ? AND role IN ('admin','team')", id);
  if (!u) throw new HttpError('That person was not found.', 404);
  return { id: u.id, name: u.name || u.email, role: u.role };
}

const rows = (env, uid) => all(env, 'SELECT id, dow, start_min, end_min, title, kind, goal, note FROM schedule_blocks WHERE user_id = ? ORDER BY dow, start_min', uid);

async function saveBlocks(env, uid, blocks) {
  const t = now();
  await batch(env, [
    ['DELETE FROM schedule_blocks WHERE user_id = ?', uid],
    ...blocks.map((b) => ['INSERT INTO schedule_blocks (id, user_id, dow, start_min, end_min, title, kind, goal, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId('sb_'), uid, b.dow, b.start_min, b.end_min, b.title, b.kind, b.goal, b.note || null, t]),
  ]);
}

route('GET', '/api/schedule', async ({ env, user, url }) => {
  requireStaff(user);
  const who = await target(env, user, url.searchParams.get('user'));
  let blocks = await rows(env, who.id);
  // The primary owner's week is written once, the first time it is opened. After that it is theirs to change or clear.
  if (!blocks.length && who.role === 'admin') {
    const primary = await import('./agents.js').then((m) => m.isPrimary(env, { id: who.id, role: who.role }));
    const seeded = (await first(env, 'SELECT v FROM settings WHERE k = ?', `sched_seeded:${who.id}`))?.v;
    if (primary && !seeded) {
      await saveBlocks(env, who.id, validateBlocks(STARTERS.owner()).blocks);
      await setSetting(env, `sched_seeded:${who.id}`, '1');
      blocks = await rows(env, who.id);
    }
  }
  const people = user.role === 'admin'
    ? await all(env, `SELECT u.id, u.name, u.email, u.role, u.job, (SELECT COUNT(*) FROM schedule_blocks s WHERE s.user_id = u.id) AS n FROM users u WHERE u.role IN ('admin','team') ORDER BY u.name`)
    : [];
  return json({ person: who, isMe: who.id === user.id, blocks, people: people.map((p) => ({ id: p.id, name: p.name || p.email, role: p.role, job: p.job || null, blocks: p.n })), kinds: Object.keys(KINDS), owner: user.role === 'admin' });
});

route('PUT', '/api/schedule/:userId', async ({ env, user, params, body }) => {
  requireStaff(user);
  const who = await target(env, user, params.userId);
  const v = validateBlocks((await body()).blocks);
  if (!v.ok) throw new HttpError(v.error, 400);
  await saveBlocks(env, who.id, v.blocks);
  await setSetting(env, `sched_seeded:${who.id}`, '1');
  return json({ ok: true, blocks: await rows(env, who.id) });
});

// Load a starter week on purpose (replaces what is there). The owner's own week is only offered to owners.
route('POST', '/api/schedule/:userId/starter', async ({ env, user, params, body }) => {
  requireStaff(user);
  const who = await target(env, user, params.userId);
  const key = String((await body()).starter || '');
  if (!STARTERS[key]) throw new HttpError('Pick a starter: blank, owner or setter.');
  if (key === 'owner' && user.role !== 'admin') throw new HttpError('Only an owner can load the owner week.', 403);
  const v = validateBlocks(STARTERS[key]());
  await saveBlocks(env, who.id, v.blocks);
  await setSetting(env, `sched_seeded:${who.id}`, '1');
  return json({ ok: true, blocks: await rows(env, who.id) });
});
