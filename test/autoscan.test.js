import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, run, first, all } from '../src/db.js';
import { runTick, autoScanTick, enqueueDue, parseKeywords, cleanConfig, monthlyCost, POINTS_PER_TICK } from '../src/autoscan.js';
import { d1, r2 } from './shims.mjs';

function setup(extra = {}) {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', ...extra };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' };
    if (cookie) h.cookie = cookie;
    let payload;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { env, call, logout: () => { cookie = ''; } };
}
async function ownerWithClient(t, fields = {}) {
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const r = await t.call('POST', '/api/clients', { name: 'Demo Roofing', plan: 'growth', lat: 26.0112, lng: -80.1495, cid: 'demo-target', keywords: 'roof repair, roofer, roof replacement, roof leak', ...fields });
  return r.data.client;
}

test('keywords, config and cost helpers', () => {
  assert.deepEqual(parseKeywords('roof repair, Roof Repair,roofer\nroof leak; tile roof, a, b', 4), ['roof repair', 'roofer', 'roof leak', 'tile roof']);
  assert.deepEqual(cleanConfig({ size: 8, radius: 99, keywords: 9, everyDays: 1 }), { enabled: false, size: 7, radius: 30, keywords: 5, everyDays: 7, autoSend: false });
  assert.equal(monthlyCost(10, { size: 7, keywords: 3, everyDays: 30 }), 5.88);
});

test('run now: a client scan is queued, worked in chunks, and saved as normal scans', async () => {
  const t = setup();
  const c = await ownerWithClient(t);
  let r = await t.call('POST', `/api/clients/${c.id}/autoscan`, {});
  assert.equal(r.status, 200);
  assert.equal(r.data.queued, 3); // default 3 keywords per client
  r = await t.call('POST', `/api/clients/${c.id}/autoscan`, {});
  assert.equal(r.data.queued, 0, 'no duplicates while waiting');
  // 3 keywords x 49 points = 147 points, 40 per tick
  let ticks = 0;
  while ((await first(t.env, "SELECT COUNT(*) AS n FROM scan_jobs WHERE status IN ('queued','running')")).n && ticks < 10) { await runTick(t.env); ticks++; }
  assert.equal(ticks, Math.ceil(147 / POINTS_PER_TICK));
  const jobs = await all(t.env, 'SELECT * FROM scan_jobs');
  assert.ok(jobs.every((j) => j.status === 'done' && j.scan_id && j.data === null), JSON.stringify(jobs.map((j) => [j.status, j.error])));
  r = await t.call('GET', `/api/clients/${c.id}/scans`);
  assert.equal(r.data.scans.length, 3);
  assert.equal(r.data.scans[0].auto, true);
  const one = await t.call('GET', `/api/scans/${r.data.scans[0].id}`);
  assert.equal(one.data.scan.points.length, 49);
  assert.ok(one.data.scan.points.every((p) => p.status === 'done'));
  assert.equal(one.data.scan.target.cid, 'demo-target');
  assert.ok(one.data.scan.points.some((p) => p.rank != null));
  const log = await all(t.env, 'SELECT text FROM log WHERE client_id = ?', c.id);
  assert.ok(log.some((l) => /Monthly ranking scan/.test(l.text)));
  // status endpoints
  r = await t.call('GET', '/api/autoscan');
  assert.equal(r.data.config.enabled, false);
  assert.equal(r.data.jobs.length, 3);
  assert.equal(r.data.jobs[0].done, 49);
});

test('a client missing an address or keywords is told what to add', async () => {
  const t = setup();
  const c = await ownerWithClient(t, { lat: null, lng: null });
  const r = await t.call('POST', `/api/clients/${c.id}/autoscan`, {});
  assert.equal(r.status, 400);
  assert.match(r.data.error, /address/);
});

test('monthly schedule: off by default, owner turns it on, due clients are queued once per period', async () => {
  const t = setup();
  const c = await ownerWithClient(t);
  const sample = (await t.call('POST', '/api/clients', { name: 'Sample', plan: 'growth', lat: 26, lng: -80, cid: 'x', keywords: 'a' })).data.client;
  await run(t.env, 'UPDATE clients SET sample = 1 WHERE id = ?', sample.id);
  assert.equal(await enqueueDue(t.env), 0, 'off by default');
  let r = await t.call('PUT', '/api/autoscan', { enabled: true, size: 5, radius: 2, keywords: 2, everyDays: 30 });
  assert.equal(r.data.config.enabled, true);
  await autoScanTick(t.env, { budget: 0 });
  let jobs = await all(t.env, 'SELECT * FROM scan_jobs');
  assert.equal(jobs.length, 2);
  assert.ok(jobs.every((j) => j.size === 5 && j.radius === 2 && j.client_id === c.id));
  // finish them, then the next check inside 30 days adds nothing
  for (let i = 0; i < 5; i++) await runTick(t.env);
  assert.equal(await enqueueDue(t.env), 0);
  // 31 days later they are due again
  assert.equal(await enqueueDue(t.env, Date.now() + 31 * 86400e3), 2);
  // teammates cannot change the schedule
  await t.call('POST', '/api/team/invite', { email: 'rep@x.com', name: 'Rep', role: 'team' });
  t.logout();
  r = await t.call('PUT', '/api/autoscan', { enabled: false });
  assert.ok([401, 403].includes(r.status));
});

test('google failures: too many missing spots fails the job instead of saving a bad scan', async () => {
  const t = setup({ DATAFORSEO_LOGIN: 'x', DATAFORSEO_PASSWORD: 'y' });
  const c = await ownerWithClient(t);
  await t.call('POST', `/api/clients/${c.id}/autoscan`, { keywords: ['roof repair'] });
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ status_code: 50000, status_message: 'Internal error' }), { status: 500 });
  try { for (let i = 0; i < 4; i++) await runTick(t.env); } finally { globalThis.fetch = real; }
  const j = await first(t.env, 'SELECT * FROM scan_jobs');
  assert.equal(j.status, 'failed');
  assert.match(j.error, /spots came back|refused/);
  assert.equal((await all(t.env, 'SELECT id FROM scans')).length, 0);
});

test('the cron handler runs the queue', async () => {
  const t = setup();
  const c = await ownerWithClient(t);
  await t.call('POST', `/api/clients/${c.id}/autoscan`, { keywords: ['roofer'] });
  const waits = [];
  await worker.scheduled({}, t.env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  const j = await first(t.env, 'SELECT * FROM scan_jobs');
  assert.equal(j.cursor, 40);
  assert.equal(j.status, 'running');
});
