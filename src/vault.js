// Password vault. Everything is encrypted in the browser before it reaches the Hub (AES-GCM with a key from the person's own master
// password, PBKDF2 SHA-256). The server only stores ciphertext: no owner, teammate or Claude can read someone else's vault.
// Sharing: each person has a P-256 key pair (private half encrypted with their master key); an item's key is wrapped for each person
// it is shared with, so only they can open it.
import { HttpError, json } from './util.js';
import { all, first, run, newId, now } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';

const B64 = /^[A-Za-z0-9+/=_-]{8,200000}$/;
const need = (v, name) => { if (typeof v !== 'string' || !B64.test(v)) throw new HttpError(`Bad ${name}.`); return v; };

route('GET', '/api/vault/me', async ({ env, user }) => {
  requireStaff(user);
  const k = await first(env, 'SELECT salt, iters, check_iv, check_ct, priv_iv, priv_ct, pub FROM vault_keys WHERE user_id = ?', user.id);
  return json({ setup: Boolean(k), keys: k || null });
});

// First time: the browser sends its salt, a check value and the key pair, all encrypted except the public key.
route('POST', '/api/vault/setup', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const have = await first(env, 'SELECT 1 AS x FROM vault_keys WHERE user_id = ?', user.id);
  if (have && !b.reset) throw new HttpError('Your vault is already set up.', 409);
  const iters = Math.max(200000, Math.min(2000000, Number(b.iters) || 310000));
  const pub = JSON.stringify(b.pub || {});
  if (!/"kty":"EC"/.test(pub) || pub.length > 1000) throw new HttpError('Bad public key.');
  if (b.reset) {
    // A forgotten master password cannot be recovered: starting over deletes this person's own items and shares to them.
    const mine = await all(env, 'SELECT id FROM vault_items WHERE owner_id = ?', user.id);
    for (const i of mine) { await run(env, 'DELETE FROM vault_access WHERE item_id = ?', i.id); await run(env, 'DELETE FROM vault_items WHERE id = ?', i.id); }
    await run(env, 'DELETE FROM vault_access WHERE user_id = ?', user.id);
    await run(env, 'DELETE FROM vault_keys WHERE user_id = ?', user.id);
  }
  await run(env, 'INSERT INTO vault_keys (user_id, salt, iters, check_iv, check_ct, priv_iv, priv_ct, pub, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    user.id, need(b.salt, 'salt'), iters, need(b.check_iv, 'check'), need(b.check_ct, 'check'), need(b.priv_iv, 'key'), need(b.priv_ct, 'key'), pub, now());
  return json({ ok: true });
});

// Teammates who have a vault (public keys only), for sharing.
route('GET', '/api/vault/people', async ({ env, user }) => {
  requireStaff(user);
  const rows = await all(env, "SELECT u.id, u.name, u.email, v.pub FROM vault_keys v JOIN users u ON u.id = v.user_id WHERE u.role IN ('admin','team') AND u.id != ?", user.id);
  return json({ people: rows.map((r) => ({ id: r.id, name: r.name || r.email, pub: JSON.parse(r.pub) })) });
});

route('GET', '/api/vault/items', async ({ env, user }) => {
  requireStaff(user);
  const rows = await all(env, `SELECT i.id, i.owner_id, i.iv, i.ct, i.updated_at, a.eph, a.wiv, a.wkey, u.name AS owner_name
    FROM vault_access a JOIN vault_items i ON i.id = a.item_id LEFT JOIN users u ON u.id = i.owner_id WHERE a.user_id = ? ORDER BY i.updated_at DESC LIMIT 2000`, user.id);
  const shares = await all(env, `SELECT a.item_id, a.user_id FROM vault_access a JOIN vault_items i ON i.id = a.item_id WHERE i.owner_id = ? AND a.user_id != ?`, user.id, user.id);
  return json({ items: rows.map((r) => ({ ...r, mine: r.owner_id === user.id, sharedWith: shares.filter((s) => s.item_id === r.id).map((s) => s.user_id) })) });
});

// Save an item: ciphertext plus the item key wrapped for each person who may open it (always including the owner).
route('POST', '/api/vault/items', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const id = b.id || newId('vi_');
  const ex = b.id ? await first(env, 'SELECT owner_id FROM vault_items WHERE id = ?', b.id) : null;
  if (b.id && !ex) throw new HttpError('Item not found.', 404);
  if (ex && ex.owner_id !== user.id) throw new HttpError('Only the person who saved it can change it.', 403);
  const access = Array.isArray(b.access) ? b.access.slice(0, 20) : [];
  if (!access.some((a) => a.user_id === user.id)) throw new HttpError('Missing your own key.');
  const t = now();
  if (ex) await run(env, 'UPDATE vault_items SET iv = ?, ct = ?, updated_at = ? WHERE id = ?', need(b.iv, 'data'), need(b.ct, 'data'), t, id);
  else await run(env, 'INSERT INTO vault_items (id, owner_id, iv, ct, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', id, user.id, need(b.iv, 'data'), need(b.ct, 'data'), t, t);
  await run(env, 'DELETE FROM vault_access WHERE item_id = ?', id);
  for (const a of access) {
    const ok = a.user_id === user.id || await first(env, 'SELECT 1 AS x FROM vault_keys WHERE user_id = ?', a.user_id);
    if (!ok) continue;
    await run(env, 'INSERT INTO vault_access (item_id, user_id, eph, wiv, wkey) VALUES (?, ?, ?, ?, ?)', id, a.user_id, String(JSON.stringify(a.eph || {})).slice(0, 1000), need(a.wiv, 'key'), need(a.wkey, 'key'));
  }
  return json({ ok: true, id });
});

route('DELETE', '/api/vault/items/:id', async ({ env, user, params }) => {
  requireStaff(user);
  const ex = await first(env, 'SELECT owner_id FROM vault_items WHERE id = ?', params.id);
  if (!ex) throw new HttpError('Item not found.', 404);
  if (ex.owner_id !== user.id) { await run(env, 'DELETE FROM vault_access WHERE item_id = ? AND user_id = ?', params.id, user.id); return json({ ok: true, left: true }); }
  await run(env, 'DELETE FROM vault_access WHERE item_id = ?', params.id);
  await run(env, 'DELETE FROM vault_items WHERE id = ?', params.id);
  return json({ ok: true });
});
