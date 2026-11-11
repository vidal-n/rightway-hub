import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, all } from '../src/db.js';
import { finderTick } from '../src/leadfinder.js';
import { d1, r2 } from './shims.mjs';

// Big searches are read and added a slice at a time, so no single request runs past the Worker's time limit.
function setup() {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', FINDER_GEOCODE_GAP: '0' };
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

async function bigJob(t, { n, autoAdd = 0, status = 'done', id = 'fj_big', at = Date.now() }) {
  await t.env.DB.prepare(`INSERT INTO finder_jobs (id, name, keywords, areas, filters, auto_add, status, total, done, found, created_by, created_at, updated_at, finished_at)
    VALUES (?, 'big', '["ac repair"]', '[]', '{}', ?, ?, 10, 10, ?, NULL, ?, ?, ?)`).bind(id, autoAdd, status, n, at, at, status === 'done' ? at : null).run();
  const ins = [];
  for (let i = 0; i < n; i++) {
    const rec = { title: `Cool Air ${i}`, phone: `(786) 55${String(i).padStart(5, '0')}`, website: `https://coolair${i}.test`, city: 'Tampa', zip: '33602', category: 'HVAC contractor', rating: 4.5, reviews: i % 90 };
    ins.push(t.env.DB.prepare("INSERT INTO finder_results (job_id, rkey, data, state) VALUES (?, ?, ?, 'new')").bind(id, `k${String(i).padStart(5, '0')}`, JSON.stringify(rec)));
  }
  for (let i = 0; i < ins.length; i += 100) await t.env.DB.batch(ins.slice(i, i + 100));
}

test('finder results come a page at a time and add answers row by row', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  await bigJob(t, { n: 950 });
  // Pages of 400: 400, 400, 150, then no next.
  const seen = [];
  let after = '', pages = 0, total = null;
  for (;;) {
    const r = await t.call('GET', `/api/finder/jobs/fj_big/results?after=${encodeURIComponent(after)}`);
    assert.equal(r.status, 200);
    if (total == null) total = r.data.total;
    seen.push(...r.data.results.map((x) => x.key));
    pages++;
    if (!r.data.next) break;
    after = r.data.next;
  }
  assert.equal(pages, 3);
  assert.equal(total, 950);
  assert.equal(seen.length, 950);
  assert.equal(new Set(seen).size, 950, 'no row is sent twice');
  // Add a batch by key: each key comes back with what happened to it.
  const keys = seen.slice(0, 25);
  let r = await t.call('POST', '/api/finder/jobs/fj_big/add', { keys });
  assert.equal(r.status, 200);
  assert.equal(r.data.imported, 25);
  assert.deepEqual(Object.keys(r.data.results).sort(), [...keys].sort());
  assert.ok(Object.values(r.data.results).every((x) => x.st === 'added' && x.lead_id));
  // The same keys again: nothing new, and no error, so a retried batch is harmless.
  r = await t.call('POST', '/api/finder/jobs/fj_big/add', { keys });
  assert.equal(r.status, 200);
  assert.equal(r.data.imported, 0);
  // Too many at once is refused with a plain message.
  r = await t.call('POST', '/api/finder/jobs/fj_big/add', { keys: seen.slice(0, 101) });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /up to 100/);
  // Adding by filters looks at a slice and says where to carry on.
  r = await t.call('POST', '/api/finder/jobs/fj_big/add', { filters: {} });
  assert.equal(r.status, 200);
  assert.ok(r.data.next, 'there is more to look at');
  assert.equal(r.data.imported, 300 - 25);
  assert.equal((await all(t.env, "SELECT * FROM leads WHERE source = 'Lead finder'")).length, 300);
});

test('auto add works through a big finished search over several runs', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  await bigJob(t, { n: 700, autoAdd: 1 });
  const count = async () => (await all(t.env, "SELECT id FROM leads WHERE source = 'Lead finder'")).length;
  await finderTick(t.env, 12);
  assert.equal(await count(), 300, 'one slice per run');
  await finderTick(t.env, 12);
  assert.equal(await count(), 600);
  await finderTick(t.env, 12);
  assert.equal(await count(), 700);
  const job = (await all(t.env, "SELECT auto_add, added FROM finder_jobs WHERE id = 'fj_big'"))[0];
  assert.equal(job.auto_add, 2, 'finished');
  assert.equal(job.added, 700);
  await finderTick(t.env, 12);
  assert.equal(await count(), 700, 'nothing more once it is finished');
});

test('only the oldest active search shows as searching, the rest wait their turn', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  await bigJob(t, { n: 1, status: 'running', id: 'fj_a', at: 1000 });
  await bigJob(t, { n: 1, status: 'running', id: 'fj_b', at: 2000 });
  const jobs = (await t.call('GET', '/api/finder')).data.jobs;
  assert.equal(jobs.find((j) => j.id === 'fj_a').status, 'running');
  assert.equal(jobs.find((j) => j.id === 'fj_b').status, 'queued');
});
