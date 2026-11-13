import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';

test('dialer queue can be narrowed to one Pipeline column', async () => {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' };
    if (cookie) h.cookie = cookie;
    let payload;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  let r = await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  assert.equal(r.status, 200);
  r = await call('POST', '/api/leads/import', { rows: [
    { business: 'Alpha Roofing', phone: '305-555-0121', state: 'FL', city: 'Miami', industry: 'roofing' },
    { business: 'Bravo HVAC', phone: '305-555-0122', state: 'FL', city: 'Miami', industry: 'hvac' },
    { business: 'Charlie Plumbing', phone: '305-555-0123', state: 'FL', city: 'Miami', industry: 'plumbing' },
  ] });
  assert.equal(r.data.imported, 3);
  const list = (await call('GET', '/api/leads')).data.leads;
  const id = (name) => list.find((l) => l.business === name).id;
  r = await call('PATCH', `/api/leads/${id('Bravo HVAC')}`, { stage: 'follow_up' });
  assert.equal(r.status, 200);
  r = await call('PATCH', `/api/leads/${id('Charlie Plumbing')}`, { stage: 'won' });
  assert.equal(r.status, 200);
  const real = Date.now;
  const at = new Date(real()); at.setUTCHours(16, 0, 0, 0);
  Date.now = () => at.getTime();
  try {
    r = await call('GET', '/api/dialer/queue');
    assert.deepEqual(r.data.queue.map((l) => l.business).sort(), ['Alpha Roofing', 'Bravo HVAC'], 'won leads are never dialed');
    r = await call('GET', '/api/dialer/queue?stage=follow_up');
    assert.deepEqual(r.data.queue.map((l) => l.business), ['Bravo HVAC']);
    r = await call('GET', '/api/dialer/queue?stage=new');
    assert.deepEqual(r.data.queue.map((l) => l.business), ['Alpha Roofing']);
    r = await call('GET', '/api/dialer/queue?stage=new,follow_up');
    assert.equal(r.data.queue.length, 2, 'several columns at once');
    r = await call('GET', '/api/dialer/queue?stage=won');
    assert.equal(r.data.queue.length, 2, 'a stage that cannot be called is ignored, so the normal queue shows');
  } finally { Date.now = real; }
});
