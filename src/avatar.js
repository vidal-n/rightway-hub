// Profile pictures for the team. The browser shrinks the photo to a 256 pixel square first, so the file is small.
// Stored in R2 (avatars/<userId>); users.avatar_at is the version used to bust the cache when the picture changes.
import { json, HttpError } from './util.js';
import { run, now } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX = 600 * 1024;

route('PUT', '/api/me/avatar', async ({ env, user, request }) => {
  requireStaff(user);
  if (user.viewAs) throw new HttpError('Client view is read only.', 403);
  if (!env.MEDIA) throw new HttpError('Photo storage is not connected yet. Create the R2 bucket in Cloudflare.', 503);
  const type = (request.headers.get('content-type') || '').split(';')[0].trim();
  if (!TYPES[type]) throw new HttpError('Use a JPG, PNG or WebP photo.');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) throw new HttpError('That photo is empty.');
  if (bytes.length > MAX) throw new HttpError('That photo is too big. Pick a smaller one.');
  await env.MEDIA.put(`avatars/${user.id}`, bytes, { httpMetadata: { contentType: type } });
  const at = now();
  await run(env, 'UPDATE users SET avatar_at = ? WHERE id = ?', at, user.id);
  return json({ avatar_at: at });
});

route('DELETE', '/api/me/avatar', async ({ env, user }) => {
  requireStaff(user);
  if (env.MEDIA) await env.MEDIA.delete(`avatars/${user.id}`).catch(() => {});
  await run(env, 'UPDATE users SET avatar_at = NULL WHERE id = ?', user.id);
  return json({ avatar_at: null });
});

// Anyone on the team can see a teammate's picture. Clients never can.
route('GET', '/api/avatar/:id', async ({ env, user, params }) => {
  requireStaff(user);
  if (!env.MEDIA) throw new HttpError('No photo.', 404);
  const obj = await env.MEDIA.get(`avatars/${params.id}`);
  if (!obj) throw new HttpError('No photo.', 404);
  return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'private, max-age=86400' } });
});
