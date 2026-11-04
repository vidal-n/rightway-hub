// Personal lines: a Twilio number can belong to one person. Calls to it ring only that person (their open Hub, plus their mobile if
// they turned on forwarding), texts to it alert only them (and can be forwarded to their mobile), and nobody else (owners included)
// sees that line's texts, calls, voicemails or recordings. Owners also never see or monitor each other's calls and recordings.
import { HttpError, json } from './util.js';
import { all, first, run, getSettings, setSetting } from './db.js';
import { requireStaff, requireAdmin } from './auth.js';
import { route } from './router.js';

const e164 = (n) => { const d = String(n || '').replace(/\D/g, ''); return d.length === 10 ? `+1${d}` : d.length === 11 && d[0] === '1' ? `+${d}` : null; };

export async function lineOwners(env) {
  try { return JSON.parse((await getSettings(env)).num_owner || '{}') || {}; } catch { return {}; }
}
export async function ownerOfLine(env, num) {
  const map = await lineOwners(env);
  const id = map[e164(num)];
  return id ? first(env, "SELECT id, name, email, role, phone, fwd_calls, fwd_texts FROM users WHERE id = ? AND role IN ('admin','team')", id) : null;
}
// Numbers this person must not see activity for: every line that belongs to someone else.
export async function hiddenLines(env, user) {
  const map = await lineOwners(env);
  return new Set(Object.entries(map).filter(([, id]) => id !== user.id).map(([n]) => n));
}
export async function myLine(env, user) {
  const map = await lineOwners(env);
  return Object.entries(map).find(([, id]) => id === user.id)?.[0] || null;
}
// Can this person hear or see a call made or taken by `by`? Your own: yes. A teammate's: owners yes. Another owner's: no.
export async function canSeeCallBy(env, user, by) {
  if (!by || by === user.id) return true;
  if (user.role !== 'admin') return false;
  const u = await first(env, 'SELECT role FROM users WHERE id = ?', by);
  return u?.role !== 'admin';
}

route('GET', '/api/lines', async ({ env, user }) => {
  requireStaff(user);
  const map = await lineOwners(env);
  const users = await all(env, "SELECT id, name, email, role, phone, fwd_calls, fwd_texts FROM users WHERE role IN ('admin','team') ORDER BY name");
  const me = users.find((u) => u.id === user.id);
  return json({
    lines: user.role === 'admin' ? map : Object.fromEntries(Object.entries(map).filter(([, id]) => id === user.id)),
    users: user.role === 'admin' ? users.map((u) => ({ id: u.id, name: u.name || u.email, role: u.role })) : [],
    me: { phone: me?.phone || '', fwd_calls: Boolean(me?.fwd_calls), fwd_texts: Boolean(me?.fwd_texts), line: await myLine(env, user) },
  });
});

route('PUT', '/api/lines', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  const out = {};
  for (const [n, id] of Object.entries(b.lines || {})) { const k = e164(n); if (k && id) out[k] = String(id).slice(0, 60); }
  await setSetting(env, 'num_owner', JSON.stringify(out));
  return json({ lines: out });
});

// Each person sets their own mobile and whether their line forwards calls and texts to it.
route('PUT', '/api/me/forwarding', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const phone = b.phone ? e164(b.phone) : null;
  if (b.phone && !phone) throw new HttpError('Type a 10 digit US mobile number.');
  await run(env, 'UPDATE users SET phone = ?, fwd_calls = ?, fwd_texts = ? WHERE id = ?', phone, b.fwd_calls ? 1 : 0, b.fwd_texts ? 1 : 0, user.id);
  return json({ ok: true, phone });
});
