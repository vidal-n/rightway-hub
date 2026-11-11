import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, setSetting, getSettings } from '../src/db.js';
import { logCost } from '../src/costs.js';
import { researchTick } from '../src/autoresearch.js';
import { bgOk, daySpendCap } from '../src/spend.js';
import { priceText, money } from '../public/js/pricing.js';
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

test('automatic research is off by default, and stays as the owner sets it', async () => {
  const t = setup();
  await owner(t);
  let r = await t.call('GET', '/api/research/status');
  assert.equal(r.data.on, false);
  // An old install that had it switched on (or never touched) is switched off once.
  await setSetting(t.env, 'spend_v', '');
  await setSetting(t.env, 'auto_research', '1');
  r = await t.call('GET', '/api/research/status');
  assert.equal(r.data.on, false);
  // From then on the owner's choice holds.
  await t.call('PUT', '/api/research/settings', { on: true });
  r = await t.call('GET', '/api/research/status');
  assert.equal(r.data.on, true);
});

test('daily limit: default 5 dollars, 0 means none, and background jobs stop at it', async () => {
  const t = setup();
  await owner(t);
  assert.equal(await daySpendCap(t.env), 5);
  assert.equal((await bgOk(t.env)).ok, true);
  await logCost(t.env, 'dataforseo', 'grid (maps)', 4.99);
  assert.equal((await bgOk(t.env)).ok, true);
  await logCost(t.env, 'leads', 'lead finder (maps)', 0.02);
  const s = (await t.call('GET', '/api/spend')).data;
  assert.equal(s.paused, true);
  assert.equal(Math.round(s.today * 100), 501);
  assert.equal((await bgOk(t.env)).ok, false);
  // Automatic research does nothing while paused.
  await t.call('PUT', '/api/research/settings', { on: true });
  await t.env.DB.prepare("INSERT INTO leads (id, business, phone, phone_digits, stage, created_at, updated_at) VALUES ('ld_x', 'X Plumbing', '(305) 555-0100', '3055550100', 'new', 1, 1)").run();
  assert.equal(await researchTick(t.env, 1), 0);
  // Raising the limit, or setting it to 0, lets it run again.
  await t.call('PUT', '/api/spend', { cap: 20 });
  assert.equal((await bgOk(t.env)).ok, true);
  await t.call('PUT', '/api/spend', { cap: 0 });
  assert.equal((await bgOk(t.env)).ok, true);
  assert.equal((await t.call('PUT', '/api/spend', { cap: -1 })).status, 400);
});

test('the prices table formats', () => {
  assert.equal(money(0.003), '$0.003');
  assert.equal(money(0.02), '$0.02');
  assert.equal(money(12.5), '$12.50');
  assert.equal(money(250), '$250');
  assert.equal(priceText('listing_check'), 'about $0.03 per business');
  assert.equal(priceText('free'), 'Free');
  assert.equal(priceText('research_standard', 50), 'about $1.00 ($0.02 each)');
});
