import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { citations } from '../public/js/fulfill.js';
import { gridPoints, gridStats } from '../public/js/grid.js';
import { sampleScan } from '../src/sample.js';
import { d1, r2 } from './shims.mjs';

function setup() {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const h = { 'x-rw': '1', ...headers };
    if (cookie) h.cookie = cookie;
    let payload;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  return { env, call };
}
const owner = (t) => t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', name: 'Vidal Newton', email: 'v@x.com', password: 'correct horse battery' });

test('sample client: realistic data, stays out of revenue, removable', async () => {
  const t = setup(); await owner(t);
  let r = await t.call('POST', '/api/sample-client');
  assert.equal(r.status, 200);
  const id = r.data.id;
  r = await t.call('POST', '/api/sample-client');
  assert.equal(r.data.id, id, 'only one sample');
  r = await t.call('GET', `/api/clients/${id}`);
  assert.equal(r.data.client.sample, 1);
  assert.ok(r.data.overview.tasks.total > 5 && r.data.overview.tasks.done > 0);
  assert.ok(r.data.overview.reviews.sent >= 10);
  assert.ok(r.data.overview.lastScan);
  r = await t.call('GET', `/api/clients/${id}/scans`);
  assert.equal(r.data.scans.length, 6);
  const now = r.data.scans.find((x) => x.keyword === 'roof repair');
  r = await t.call('GET', `/api/clients/${id}/onboarding`);
  assert.equal(r.status, 200);
  assert.ok(r.data.citations.some((c) => c.status === 'fixed'));
  r = await t.call('GET', '/api/dashboard');
  assert.equal(r.data.clients.active, 0, 'sample is not counted');
  assert.equal(r.data.clients.mrr, 0);
  assert.equal(r.data.clients.sample, id);
  assert.ok(now.top3Pct >= 0);
  r = await t.call('DELETE', '/api/sample-client');
  assert.equal(r.data.removed, 1);
  r = await t.call('GET', `/api/clients/${id}`);
  assert.equal(r.status, 404);
});

test('client view: team sees exactly the client side, read only', async () => {
  const t = setup(); await owner(t);
  const id = (await t.call('POST', '/api/sample-client')).data.id;
  let r = await t.call('GET', '/api/auth/state', undefined, { 'x-view-as': id });
  assert.equal(r.data.user.role, 'client');
  assert.equal(r.data.user.client_id, id);
  r = await t.call('GET', `/api/clients/${id}`, undefined, { 'x-view-as': id });
  assert.equal(r.data.client.notes, undefined, 'team notes hidden like a client login');
  r = await t.call('GET', '/api/clients', undefined, { 'x-view-as': id });
  assert.equal(r.status, 403, 'team pages are off in client view');
  r = await t.call('PUT', `/api/clients/${id}/intake`, { services: 'x' }, { 'x-view-as': id });
  assert.equal(r.status, 403);
  assert.match(r.data.error, /read only/);
  r = await t.call('GET', '/api/clients');
  assert.equal(r.status, 200, 'normal requests unaffected');
});

test('dashboard counts today, meetings, and callable leads', async () => {
  const t = setup(); await owner(t);
  await t.call('POST', '/api/leads', { business: 'Bay Roofing', phone: '9545550123', state: 'FL' });
  const r = await t.call('GET', `/api/dashboard?since=${Date.now() - 3600e3}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.pipeline.open, 1);
  assert.deepEqual(Object.keys(r.data.me), ['dials', 'talks', 'booked', 'goal']);
});

test('citations: real sign up links, cost, and trade lists by industry', () => {
  const roof = citations({ name: 'Bay Roofing', city: 'Hollywood', state: 'FL', category: 'Roofing contractor' });
  const names = roof.map((c) => c.name);
  for (const n of ['Apple Business Connect', 'Bing Places', 'Yelp', 'Data Axle', 'Angi', 'GAF contractor locator']) assert.ok(names.includes(n), n);
  assert.ok(roof.every((c) => /^https:\/\//.test(c.url) && c.cost && c.why));
  assert.ok(!names.includes('Avvo'));
  const law = citations({ name: 'Lee Law', category: 'Law firm', state: 'FL' }).map((c) => c.name);
  assert.ok(law.includes('Avvo') && law.includes('Justia') && !law.includes('Angi'));
  const cpa = citations({ name: 'Ace CPA', industry: 'CPA firm' }).map((c) => c.name);
  assert.ok(cpa.includes('IRS directory of tax preparers'));
  assert.equal(new Set(names).size, names.length, 'no duplicate names');
});

test('bigger grids and radius; sample scans have real structure', () => {
  assert.equal(gridPoints(26, -80, 13, 30).length, 169);
  assert.throws(() => gridPoints(26, -80, 15, 5));
  assert.throws(() => gridPoints(26, -80, 7, 31));
  const s = sampleScan('roof repair', { boost: 6 });
  const st = gridStats(s.points);
  assert.equal(st.done, 49);
  assert.ok(st.top3 > 0 && st.top3 < 49);
  assert.ok(s.points.every((p) => p.top.length >= 5));
});
