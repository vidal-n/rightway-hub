import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { claudeCost, logCost, costTick, dayOf } from '../src/costs.js';
import { searchBusinesses } from '../src/dataforseo.js';
import { donut, ring, spark, stackBars } from '../public/js/charts.js';
import { d1, r2 } from './shims.mjs';

function setup() {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', DATAFORSEO_LOGIN: 'a', DATAFORSEO_PASSWORD: 'b' };
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const h = { 'x-rw': '1', ...headers };
    if (cookie) h.cookie = cookie;
    let payload;
    if (typeof body === 'string' || body instanceof Uint8Array) payload = body;
    else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text(), res };
  };
  return { env, call };
}

test('Claude cost follows the model tier and counts cache tokens', () => {
  assert.equal(claudeCost('claude-haiku-4-5-20251001', { input_tokens: 1000, output_tokens: 1000 }), 0.006);
  assert.equal(claudeCost('claude-sonnet-4-5', { input_tokens: 1e6, output_tokens: 0 }), 3);
  assert.ok(Math.abs(claudeCost('claude-opus-5-5', { input_tokens: 0, output_tokens: 1e6, cache_read_input_tokens: 1e6 }) - 25.5) < 1e-9);
  assert.equal(claudeCost('unknown-model', { input_tokens: 1e6 }), 1);
});

test('cost ledger, budget, notifications and profile photo', async () => {
  const t = setup();
  assert.equal((await t.call('GET', '/api/costs')).status, 401);
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  let r = await t.call('GET', '/api/costs?days=14');
  assert.equal(r.status, 200);
  assert.equal(r.data.series.length, 14);
  assert.equal(r.data.month.total, 0);
  assert.equal(r.data.budget.pct, null);

  // The DataForSEO call site writes the ledger: cost comes from the task, one line per search.
  const fetchImpl = async () => Response.json({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.0035, result: [{ items: [] }] }] });
  await searchBusinesses(t.env, { name: 'Summit Roofing', location: 'Hollywood, FL' }, fetchImpl);
  await searchBusinesses(t.env, { name: 'Summit Roofing', location: 'Hollywood, FL' }, fetchImpl);
  await logCost(t.env, 'claude', 'Ask Claude', 1.5);
  await logCost(t.env, 'claude', 'Ask Claude', 0, 1); // zero is ignored
  r = await t.call('GET', '/api/costs?days=7');
  assert.equal(r.data.month.by.dataforseo, 0.01);
  assert.equal(r.data.month.by.claude, 1.5);
  assert.equal(r.data.unit.searches, 2);
  assert.equal(r.data.unit.search, 0.0035);
  assert.equal(r.data.series.at(-1).day, dayOf());
  assert.equal(r.data.series.at(-1).claude, 1.5);
  assert.equal(r.data.kinds[0].kind, 'Ask Claude');

  // Budget and subscriptions
  r = await t.call('PUT', '/api/costs/budget', { monthly: 'abc' });
  assert.equal(r.status, 400);
  r = await t.call('PUT', '/api/costs/budget', { monthly: 2, vendors: { claude: 1 }, fixed: [{ name: 'Resend', monthly: 0.5 }, { name: '', monthly: 9 }] });
  assert.equal(r.status, 200);
  assert.equal(r.data.month.fixed, 0.5);
  assert.equal(r.data.month.total, 2.01);
  assert.equal(r.data.budget.monthly, 2);
  assert.equal(r.data.budget.vendors.claude, 1);
  assert.equal(r.data.budget.pct, 101);
  assert.equal(r.data.fixedList.length, 1);

  // Over budget: owners get one notification, not one per run.
  await costTick(t.env);
  await costTick(t.env);
  r = await t.call('GET', '/api/notifications');
  const money = r.data.notifications.filter((n) => n.kind === 'money');
  assert.equal(money.length, 1);
  assert.match(money[0].title, /budget reached/i);

  // Profile photo
  const st = await t.call('GET', '/api/auth/state');
  const id = st.data.user.id;
  assert.equal((await t.call('PUT', '/api/me/avatar', 'x', { 'content-type': 'image/gif' })).status, 400);
  r = await t.call('PUT', '/api/me/avatar', new Uint8Array([255, 216, 255, 224, 1, 2, 3]), { 'content-type': 'image/jpeg' });
  assert.equal(r.status, 200);
  assert.ok(r.data.avatar_at);
  r = await t.call('GET', `/api/avatar/${id}`);
  assert.equal(r.status, 200);
  assert.equal(r.res.headers.get('content-type'), 'image/jpeg');
  r = await t.call('GET', '/api/agents');
  assert.ok(r.data.agents[0].avatar);
  r = await t.call('DELETE', '/api/me/avatar');
  assert.equal(r.data.avatar_at, null);
  assert.equal((await t.call('GET', `/api/avatar/${id}`)).status, 404);
});

test('dashboard charts return markup', () => {
  assert.match(donut([{ label: 'New', value: 3, color: 'red' }, { label: 'Won', value: 1, color: 'green' }], { center: '4' }), /<circle[^>]+stroke-dasharray/);
  assert.match(ring(120, { center: '100%' }), /stroke-dasharray="\d/);
  assert.match(spark([1, 3, 2, 5]), /<polyline/);
  assert.equal(spark([1]), '');
  assert.match(stackBars(['a', 'b'], [{ name: 'x', color: 'red', values: [1, 2] }, { name: 'y', color: 'blue', values: [0, 1] }], { cap: 2 }), /capline/);
});
