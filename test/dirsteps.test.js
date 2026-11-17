// Long directory check in steps, and the sample prospect (Nov 2026). Modeled on BrightLocal's Citation Tracker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';

function setup() {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' }; if (cookie) h.cookie = cookie;
    let payload; if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { env, call };
}

test('sample prospect opens with a scan, and its directory check runs in steps for free', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const a = await t.call('POST', '/api/sample-lead');
  assert.equal(a.status, 200); assert.equal(a.data.existed, false);
  assert.equal((await t.call('POST', '/api/sample-lead')).data.existed, true, 'one sample only');
  const lead = (await t.call('GET', `/api/leads/${a.data.id}`)).data.lead || (await t.call('GET', `/api/leads/${a.data.id}`)).data;
  assert.ok(JSON.parse(lead.deep_scan).scans.length >= 1);
  const plan = await t.call('GET', `/api/leads/${a.data.id}/listings/plan`);
  assert.ok(plan.data.sites.length > 15, 'more than the old 15 directories');
  assert.ok(plan.data.rival, 'the competitor is compared');
  const first6 = plan.data.sites.slice(0, 6).map((x) => x.id);
  const s1 = await t.call('POST', `/api/leads/${a.data.id}/listings/step`, { ids: first6, reset: true });
  assert.equal(s1.status, 200); assert.equal(s1.data.results.length, 6);
  const none = await t.call('POST', `/api/leads/${a.data.id}/listings/step`, { ids: [] });
  assert.equal(none.status, 400);
  const s2 = await t.call('POST', `/api/leads/${a.data.id}/listings/step`, { ids: plan.data.rival.ids.slice(0, 4), rival: true });
  assert.equal(s2.status, 200);
  assert.equal((await t.call('DELETE', '/api/sample-lead')).data.removed, 1);
});
