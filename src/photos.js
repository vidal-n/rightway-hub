// Client photos: a client sends many photos at once from the client app. They land in the client's Photos tab
// (table client_photos, files in R2 photos/<clientId>/<id>). Staff turn a photo into a draft post (captions written
// the same way as a post sent from the Posts tab) or delete it. Photos used by a post keep their file.
import { HttpError, json } from './util.js';
import { all, first, run, newId, now } from './db.js';
import { route } from './router.js';
import { requireClientAccess, requireStaff } from './auth.js';
import { generateCaptions } from './captions.js';
import { notify } from './notify.js';

const MAX_FILE = 8 * 1024 * 1024;
const MAX_BATCH = 20;
const MAX_INLINE = 4.5 * 1024 * 1024;
const text = (v, max = 1000) => (v == null ? null : String(v).replace(/\u0000/g, '').trim().slice(0, max) || null);

function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function clientPhoto(env, clientId, pid) {
  const p = await first(env, 'SELECT * FROM client_photos WHERE id = ? AND client_id = ?', pid, clientId);
  if (!p) throw new HttpError('Photo not found.', 404);
  return p;
}

route('GET', '/api/clients/:id/photos', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  const photos = await all(env, 'SELECT id, client_id, media_type, size, note, post_id, created_at FROM client_photos WHERE client_id = ? ORDER BY created_at DESC LIMIT 300', params.id);
  return json({ photos });
});

route('POST', '/api/clients/:id/photos', async ({ env, user, params, request, defer }) => {
  requireClientAccess(user, params.id);
  const c = await first(env, 'SELECT id, name FROM clients WHERE id = ?', params.id);
  if (!c) throw new HttpError('Client not found.', 404);
  if (!env.MEDIA) throw new HttpError('Photo storage is not connected yet. Create the R2 bucket in Cloudflare.', 503);
  let form;
  try { form = await request.formData(); } catch { throw new HttpError('Choose at least one photo.'); }
  const files = form.getAll('photo').filter((f) => f && typeof f === 'object' && f.size);
  if (!files.length) throw new HttpError('Choose at least one photo.');
  if (files.length > MAX_BATCH) throw new HttpError(`Send up to ${MAX_BATCH} photos at a time.`);
  const note = text(form.get('note'));
  const saved = [];
  for (const f of files) {
    const type = f.type || 'image/jpeg';
    if (!/^image\//.test(type)) throw new HttpError('Only photos for now.');
    if (f.size > MAX_FILE) throw new HttpError('One of those photos is too big (8 MB max).');
  }
  for (const f of files) {
    const type = f.type || 'image/jpeg';
    const id = newId('ph_');
    const key = `photos/${c.id}/${id}.${type.split('/')[1].replace('jpeg', 'jpg')}`;
    await env.MEDIA.put(key, new Uint8Array(await f.arrayBuffer()), { httpMetadata: { contentType: type } });
    await run(env, 'INSERT INTO client_photos (id, client_id, media_key, media_type, size, note, post_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)',
      id, c.id, key, type, f.size, note, user.id, now());
    saved.push(id);
  }
  // Staff hear about it, so the photos get turned into posts while the client is still on the phone.
  defer?.(notify(env, { to: { client: c.id }, kind: 'client', title: `${c.name} sent ${saved.length} photo${saved.length === 1 ? '' : 's'}`, body: note || 'Make posts from them in the Photos tab.', url: `/#/client/${c.id}/photos`, tag: `photos-${c.id}` }).catch(() => {}));
  return json({ saved: saved.length, ids: saved });
});

route('GET', '/api/clients/:id/photos/:pid/file', async ({ env, user, params, url }) => {
  requireClientAccess(user, params.id);
  const p = await clientPhoto(env, params.id, params.pid);
  const obj = await env.MEDIA.get(p.media_key);
  if (!obj) throw new HttpError('Photo not found.', 404);
  const headers = { 'content-type': p.media_type || 'image/jpeg', 'cache-control': 'private, max-age=3600' };
  if (url.searchParams.get('download')) headers['content-disposition'] = `attachment; filename="${p.id}.${(p.media_type || 'image/jpeg').split('/')[1]}"`;
  return new Response(obj.body, { headers });
});

// Staff only: a photo becomes a draft post in the Posts tab, with captions written from the photo and its note.
route('POST', '/api/clients/:id/photos/:pid/post', async ({ env, user, params }) => {
  requireStaff(user);
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', params.id);
  if (!c) throw new HttpError('Client not found.', 404);
  const p = await clientPhoto(env, c.id, params.pid);
  if (p.post_id) throw new HttpError('This photo already has a post.');
  const obj = await env.MEDIA.get(p.media_key);
  if (!obj) throw new HttpError('Photo not found.', 404);
  const bytes = new Uint8Array(await obj.arrayBuffer());
  const image = bytes.length <= MAX_INLINE ? { base64: base64(bytes), mediaType: p.media_type || 'image/jpeg' } : null;
  const cap = await generateCaptions(env, c, p.note || '', image);
  const id = newId('p_');
  await run(env, `INSERT INTO posts (id, client_id, media_key, media_type, note, google_text, facebook_text, instagram_text, hashtags, keywords, alt_text, status, ai, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
  id, c.id, p.media_key, p.media_type, p.note, cap.google, cap.facebook, cap.instagram, JSON.stringify(cap.hashtags), JSON.stringify(cap.keywords), cap.alt_text, cap.ai ? 1 : 0, user.id, now());
  await run(env, 'UPDATE client_photos SET post_id = ? WHERE id = ?', id, p.id);
  return json({ post: await first(env, 'SELECT * FROM posts WHERE id = ?', id) });
});

route('DELETE', '/api/clients/:id/photos/:pid', async ({ env, user, params }) => {
  requireStaff(user);
  const p = await clientPhoto(env, params.id, params.pid);
  await run(env, 'DELETE FROM client_photos WHERE id = ?', p.id);
  // A photo that a post still uses keeps its file.
  if (!p.post_id) await env.MEDIA.delete(p.media_key).catch(() => {});
  return json({ ok: true });
});
