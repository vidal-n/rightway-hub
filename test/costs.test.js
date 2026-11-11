import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { logCost, costSummary, VENDORS } from '../src/costs.js';
import { d1, r2 } from './shims.mjs';

test('lead data is its own cost line: finder and research spend, hand entries, and budget caps', async () => {
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
  assert.ok(VENDORS.some(([k]) => k === 'leads'));
  // Spend logged the way the Finder and research log it: under DataForSEO, but the kind says lead.
  let r = await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  assert.equal(r.status, 200);
  await logCost(env, 'dataforseo', 'lead finder (maps)', 0.002, 1);
  await logCost(env, 'dataforseo', 'lead research (maps)', 0.04, 1);
  await logCost(env, 'dataforseo', 'grid (local finder)', 0.01, 1);
  r = await call('POST', '/api/costs/entry', { name: 'Florida HVAC list', dollars: 49 });
  assert.equal(r.status, 200);
  assert.ok(Math.abs(r.data.month.by.leads - 49.04) < 0.005, `lead data total was ${r.data.month.by.leads}`);
  assert.ok(Math.abs(r.data.month.by.dataforseo - 0.01) < 0.001, 'client scans stay on DataForSEO');
  assert.ok(r.data.kinds.some((k) => k.vendor === 'leads' && /bought: Florida HVAC list/.test(k.kind)));
  r = await call('POST', '/api/costs/entry', { name: '', dollars: 5 });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/costs/entry', { name: 'x', dollars: -3 });
  assert.equal(r.status, 400);
  r = await call('PUT', '/api/costs/budget', { monthly: 200, vendors: { leads: 60 } });
  assert.equal(r.data.budget.vendors.leads, 60);
  assert.equal(r.data.budget.vendors.dataforseo, 0);
  const sum = await costSummary(env, 30);
  assert.ok(sum.series.at(-1).leads > 49, 'the daily series carries the Lead data line');
});
