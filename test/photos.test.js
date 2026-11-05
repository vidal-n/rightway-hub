import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';

function setup() {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body, form) => {
    const h = { 'x-rw': '1' };
    if (cookie) h.cookie = cookie;
    let payload = form;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.clone().json().catch(() => null), res };
  };
  return { env, call };
}
const jpg = (n) => new File([new Uint8Array([0xff, 0xd8, 0xff, n, 1, 2, 3])], `p${n}.jpg`, { type: 'image/jpeg' });

test('a client sends many photos at once; staff make posts from them in the Photos tab', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const c = (await t.call('POST', '/api/clients', { name: 'Sunrise Roofing', plan: 'growth', services: 'Roof repair', cities: 'Miami' })).data.client;
  const fd = new FormData();
  for (let i = 0; i < 7; i++) fd.append('photo', jpg(i));
  fd.append('note', 'Roofs this week');
  let r = await t.call('POST', `/api/clients/${c.id}/photos`, undefined, fd);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.saved, 7);
  const list = (await t.call('GET', `/api/clients/${c.id}/photos`)).data.photos;
  assert.equal(list.length, 7);
  assert.ok(list.every((p) => p.note === 'Roofs this week' && !p.post_id));
  const file = await t.call('GET', `/api/clients/${c.id}/photos/${list[0].id}/file`);
  assert.equal(file.res.headers.get('content-type'), 'image/jpeg');
  // Too many in one request, and non photos, are refused.
  const big = new FormData();
  for (let i = 0; i < 21; i++) big.append('photo', jpg(i));
  assert.equal((await t.call('POST', `/api/clients/${c.id}/photos`, undefined, big)).status, 400);
  const txt = new FormData();
  txt.append('photo', new File(['hi'], 'a.txt', { type: 'text/plain' }));
  assert.equal((await t.call('POST', `/api/clients/${c.id}/photos`, undefined, txt)).status, 400);
  // Make a post from one: it shows in Posts as a draft using the same file, and the photo is marked.
  r = await t.call('POST', `/api/clients/${c.id}/photos/${list[0].id}/post`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.post.status, 'draft');
  const posts = (await t.call('GET', `/api/clients/${c.id}/posts`)).data.posts;
  assert.equal(posts.length, 1);
  assert.equal((await t.call('POST', `/api/clients/${c.id}/photos/${list[0].id}/post`)).status, 400, 'one post per photo');
  // Deleting a photo that a post uses keeps the file for the post.
  assert.equal((await t.call('DELETE', `/api/clients/${c.id}/photos/${list[0].id}`)).status, 200);
  assert.ok(await t.env.MEDIA.get(posts[0].media_key), 'the post still has its photo');
  assert.equal((await t.call('GET', `/api/clients/${c.id}/photos`)).data.photos.length, 6);
});
