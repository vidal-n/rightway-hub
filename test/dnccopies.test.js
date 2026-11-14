// A business on Do Not Call covers every copy of it in the Hub (Nov 2026, V: a partner called a lead already on Do Not Call).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
import { blockKeys, rowsFor } from '../public/js/suppress.js';

test('blockKeys meets across ZIP and city, so a copy with no ZIP is the same business', () => {
  const a = { business: 'ABC Roofing LLC', phone: '305-555-0150', city: 'Miami', zip: '33139' };
  const b = { business: 'ABC Roofing', phone: '786-555-0199', city: 'Miami' };
  assert.ok(blockKeys(a).some((k) => blockKeys(b).includes(k)), 'shared name and city key');
  assert.ok(rowsFor(a, 'dnc').every((r) => r.blocks === 1));
  const c = { business: 'ABC Roofing', phone: '786-555-0198', city: 'Tampa' };
  assert.ok(!blockKeys(a).some((k) => blockKeys(c).includes(k)), 'another city is another business');
});

test('Do Not Call on one lead flags its copies, blocks the dial, and the sweep catches any that slip through', async () => {
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
  assert.equal((await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' })).status, 200);
  const imp = await call('POST', '/api/leads/import', { rows: [
    { business: 'ABC Roofing', phone: '305-555-0150', state: 'FL', city: 'Miami', zip: '33139' },
    { business: 'ABC Roofing LLC', phone: '786-555-0199', state: 'FL', city: 'Miami' },
    { business: 'Zed Plumbing', phone: '305-555-0160', state: 'FL', city: 'Miami' },
  ], merge: false });
  assert.equal(imp.data.imported, 3);
  const leads = () => call('GET', '/api/leads').then((r) => r.data.leads);
  const find = async (n) => (await leads()).find((l) => String(l.phone).replace(/\D/g, '').endsWith(n));
  const a = await find('3055550150'), b = await find('7865550199'), z = await find('3055550160');

  // V puts A on Do Not Call: the copy B (other phone, no ZIP) goes with it, an unrelated lead does not.
  assert.equal((await call('POST', `/api/leads/${a.id}/outcome`, { dispo: 'dnc' })).status, 200);
  const b2 = await find('7865550199');
  assert.equal(b2.dnc, 1);
  assert.equal(b2.stage, 'dnc');
  assert.equal((await find('3055550160')).dnc, 0);
  // Kiron cannot place a call to the copy, and it is not in a saved call list.
  const prep = await call('POST', '/api/voice/prepare', { leadId: b.id });
  assert.ok([409, 503].includes(prep.status), `refused (${prep.status})`);
  assert.equal((await call('GET', `/api/leads/${b.id}/call-check`)).data.ok, false);
  const camp = await call('PUT', '/api/dialer/campaign', { ids: [b.id, z.id] });
  assert.equal(camp.data.total, 1);

  // A copy that slipped through (flag removed behind our back) is found by the sweep.
  await env.DB.prepare("UPDATE leads SET dnc = 0, stage = 'new' WHERE id = ?").bind(b.id).run();
  assert.equal((await find('7865550199')).dnc, 0);
  const sw = await call('POST', '/api/suppress/sweep', { after: '' });
  assert.equal(sw.status, 200);
  assert.equal(sw.data.marked, 1);
  assert.equal((await find('7865550199')).stage, 'dnc');
  assert.equal((await find('3055550160')).dnc, 0);
  assert.equal(sw.data.next, null);
});
