import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';

function setup() {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', DATAFORSEO_LOGIN: 'x', DATAFORSEO_PASSWORD: 'y' };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' };
    if (cookie) h.cookie = cookie;
    let payload;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
  return { env, call };
}
const owner = (t) => t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });

test('big selections stay under the D1 limit of 100 bound values', async () => {
  const t = setup();
  await owner(t);
  const ids = [];
  for (let i = 0; i < 230; i++) {
    const r = await t.call('POST', '/api/leads', { business: `Biz ${i}`, phone: `305555${String(1000 + i)}` });
    ids.push(r.data.lead?.id || r.data.id);
  }
  assert.ok(ids.every(Boolean));
  const q = await t.call('POST', '/api/scrub/queue', { ids, lookup: true });
  assert.equal(q.status, 200);
  const b = await t.call('POST', '/api/leads/bulk', { ids, action: 'tag', value: 'big' });
  assert.equal(b.status, 200);
  const d = await t.call('POST', '/api/leads/bulk', { ids, action: 'stage', value: 'attempting' });
  assert.equal(d.status, 200);
});
