import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, all } from '../src/db.js';
import { finderTick, geocode } from '../src/leadfinder.js';
import {
  parseKeywords, parseAreas, estimate, taskList, zoomFor, radiusFromBox, keyOf, passes, cleanFilters, leadRow, csvText, MAX_REQUESTS,
} from '../public/js/finder.js';
import { d1, r2 } from './shims.mjs';

function setup(extra = {}) {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', FINDER_GEOCODE_GAP: '0', ...extra };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' };
    if (cookie) h.cookie = cookie;
    let payload;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload, redirect: 'manual' }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
  };
  return { env, call, logout: () => { cookie = ''; } };
}
const owner = (t) => t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
async function finish(t, id, max = 40) {
  let job;
  for (let i = 0; i < max; i++) {
    const r = await t.call('POST', '/api/finder/tick');
    job = r.data.jobs.find((j) => j.id === id);
    if (!job || job.status === 'done' || job.status === 'failed') break;
  }
  return (await t.call('GET', `/api/finder/jobs/${id}`)).data.job;
}

test('finder maths: lists, cost, grid tasks, zoom, filters, lead rows, csv', () => {
  assert.deepEqual(parseKeywords('roofing contractor, roofer\nRoofer; gutter service'), ['roofing contractor', 'roofer', 'gutter service']);
  assert.deepEqual(parseAreas('Miami, FL\nFort Lauderdale, FL; 33139'), ['Miami, FL', 'Fort Lauderdale, FL', '33139'], 'a comma inside a place name is kept');
  const e = estimate({ areas: 3, size: 5, keywords: 2 });
  assert.equal(e.requests, 150);
  assert.equal(e.cost, 0.3);
  assert.equal(estimate({ areas: 12, size: 9, keywords: 10 }).tooBig, true);
  assert.ok(MAX_REQUESTS >= 1000);
  const area = { label: 'Miami, FL', lat: 25.77, lng: -80.19, radius: 6, size: 5 };
  const tasks = taskList([area, { ...area, label: 'Hialeah, FL', lat: 25.86, lng: -80.28 }], ['roofer', 'roofing contractor']);
  assert.equal(tasks.length, 2 * 25 * 2);
  assert.equal(tasks[0].label, 'Miami, FL');
  assert.equal(tasks.at(-1).label, 'Hialeah, FL');
  assert.deepEqual(tasks.map((t) => t.keyword).slice(0, 2), ['roofer', 'roofing contractor'], 'every keyword at each view before the next view');
  assert.ok(tasks.every((t) => t.zoom >= 10 && t.zoom <= 17));
  assert.ok(zoomFor(0.5) > zoomFor(8), 'smaller steps zoom in');
  assert.equal(radiusFromBox([25.7, 25.86, -80.31, -80.13], 25.77) <= 12, true);
  assert.equal(radiusFromBox(null), 5);
  assert.equal(keyOf({ place_id: 'p1', cid: 'c1' }), 'p1');
  assert.equal(keyOf({ title: 'A & B Roofing', phone: '(305) 555-0101' }), keyOf({ title: 'A and B roofing', phone: '+1 305 555 0101' }));
  const r = { title: 'Sunrise Roofing', phone: '(305) 555-0101', website: 'https://sunrise.test', rating: 4.6, reviews: 40, claimed: true, category: 'Roofing contractor', cats: ['Gutter service'] };
  assert.equal(passes(r, {}), true);
  assert.equal(passes(r, { minReviews: 50 }), false);
  assert.equal(passes(r, { maxReviews: 50, minRating: 4.5 }), true);
  assert.equal(passes(r, { website: 'none' }), false);
  assert.equal(passes({ ...r, website: '' }, { website: 'none' }), true);
  assert.equal(passes({ ...r, phone: '' }, {}), false, 'a phone is required by default');
  assert.equal(passes({ ...r, phone: '' }, { phone: 'any' }), true);
  assert.equal(passes(r, { claimed: 'unclaimed' }), false);
  assert.equal(passes(r, { category: 'gutter' }), true, 'other categories count');
  assert.equal(passes(r, { category: 'plumber' }), false);
  assert.equal(passes(r, { exclude: 'home depot, sunrise' }), false);
  assert.equal(cleanFilters({ website: 'bogus', minReviews: 'x' }).website, 'any');
  const row = leadRow({ ...r, kw: 'roofer', city: 'Miami', state: 'Florida', zip: '33101', place_id: 'p1', cid: 'c1', lat: 25.7, lng: -80.2 });
  assert.equal(row.business, 'Sunrise Roofing');
  assert.equal(row.industry, 'roofer');
  assert.equal(row.source, 'Lead finder');
  const csv = csvText([{ ...r, title: 'Say "hi", Roofing', kw: 'roofer', area: 'Miami, FL' }]).split('\r\n');
  assert.match(csv[0], /^name,category,other_categories,phone,website,email/);
  assert.match(csv[1], /^"Say ""hi"", Roofing",Roofing contractor,Gutter service,/);
});

test('geocode: city or ZIP through OpenStreetMap, plain errors, lat/lng accepted as is', async () => {
  const env = { DATAFORSEO_LOGIN: 'x', DATAFORSEO_PASSWORD: 'y' };
  const seen = [];
  const ok = async (u, init) => { seen.push([u, init]); return Response.json([{ lat: '25.7742658', lon: '-80.1936589', name: 'Miami', boundingbox: ['25.70', '25.86', '-80.31', '-80.13'], address: { 'ISO3166-2-lvl4': 'US-FL' } }]); };
  const p = await geocode(env, 'Miami', ok);
  assert.equal(p.state, 'FL');
  assert.equal(p.label, 'Miami, FL');
  assert.ok(Math.abs(p.lat - 25.774) < 0.001 && p.radius > 1 && p.radius <= 12);
  assert.match(seen[0][0], /nominatim\.openstreetmap\.org\/search\?.*q=Miami/);
  assert.match(seen[0][1].headers['user-agent'], /RightwayHub/);
  await assert.rejects(() => geocode(env, 'zzzz nowhere', async () => Response.json([])), /Could not find "zzzz nowhere"/);
  await assert.rejects(() => geocode(env, 'Miami', async () => new Response('nope', { status: 503 })), /place lookup failed/);
  assert.deepEqual((await geocode(env, '25.77, -80.19', async () => { throw new Error('no network needed'); })).lat, 25.77);
});

test('finder: search, grid coverage, filters, add to the pipeline, no repeats, csv columns', async () => {
  const t = setup();
  await owner(t);
  let r = await t.call('POST', '/api/finder/jobs', { keywords: '', areas: 'Miami, FL' });
  assert.equal(r.status, 400);
  r = await t.call('POST', '/api/finder/jobs', { keywords: 'roofer', areas: '' });
  assert.equal(r.status, 400);
  r = await t.call('POST', '/api/finder/jobs', { keywords: 'a,b,c,d,e,f,g,h,i,j', areas: 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl', size: 9 });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /searches/);
  r = await t.call('POST', '/api/finder/jobs', { keywords: 'roofing contractor\nroofer', areas: 'Miami, FL', size: 3, tag: 'roofers nov', filters: { minReviews: 20 } });
  assert.equal(r.status, 200);
  const job = r.data.job;
  assert.equal(job.total, 18);
  assert.equal(job.demo, true);
  assert.equal(job.status, 'queued');
  assert.equal(job.areas[0].radius, 4);
  const done = await finish(t, job.id);
  assert.equal(done.status, 'done');
  assert.equal(done.done, 18);
  assert.ok(done.found >= 20, 'the demo world has many businesses');
  r = await t.call('GET', `/api/finder/jobs/${job.id}/results`);
  assert.equal(r.data.results.length, done.found);
  assert.ok(r.data.results.every((x) => x.st === 'new' && x.key && x.title));
  assert.equal(new Set(r.data.results.map((x) => x.key)).size, r.data.results.length, 'overlapping map views never make repeats');
  const f = { minReviews: 100, website: 'has' };
  const want = r.data.results.filter((x) => passes(x, f));
  assert.ok(want.length > 3);
  // Add everything that passes the filters.
  r = await t.call('POST', `/api/finder/jobs/${job.id}/add`, { filters: f });
  assert.equal(r.status, 200);
  assert.equal(r.data.imported + r.data.skipped, want.length);
  assert.ok(r.data.imported > 0);
  const leads = (await t.call('GET', '/api/leads')).data.leads.filter((l) => l.source === 'Lead finder');
  assert.equal(leads.length, r.data.imported);
  assert.ok(leads.every((l) => /roofers nov/.test(l.tags || '') && l.stage !== undefined));
  const one = leads[0];
  const full = (await t.call('GET', `/api/leads/${one.id}`)).data.lead;
  assert.ok(full.place_id && full.cid && full.lat != null && full.category, 'the Google listing travels with the lead, so research skips the lookup');
  // Same filters again: nothing left to add.
  r = await t.call('POST', `/api/finder/jobs/${job.id}/add`, { filters: f });
  assert.equal(r.status, 400);
  // Pick one by hand.
  const rest = (await t.call('GET', `/api/finder/jobs/${job.id}/results`)).data.results;
  assert.ok(rest.filter((x) => x.st === 'added').length === leads.length);
  const pick = rest.find((x) => x.st === 'new' && passes(x, {}));
  r = await t.call('POST', `/api/finder/jobs/${job.id}/add`, { keys: [pick.key] });
  assert.equal(r.data.imported, 1);
  // A second search over the same place finds the same businesses: they show as already in the Hub.
  r = await t.call('POST', '/api/finder/jobs', { keywords: 'roofing contractor', areas: 'Miami, FL', size: 3 });
  const again = await finish(t, r.data.job.id);
  const res2 = (await t.call('GET', `/api/finder/jobs/${again.id}/results`)).data.results;
  assert.ok(res2.some((x) => x.st === 'inhub' && x.lead_id), 'repeats are marked so they are never added twice');
  assert.ok(res2.some((x) => x.st === 'new'));
});

test('finder: automatic add, stop and resume, delete, and agents are kept out', async () => {
  const t = setup();
  await owner(t);
  let r = await t.call('POST', '/api/finder/jobs', { keywords: 'plumber', areas: 'Hialeah, FL', size: 3, autoAdd: true, filters: { minReviews: 50 }, tag: 'auto plumbers' });
  const id = r.data.job.id;
  const done = await finish(t, id);
  assert.equal(done.status, 'done');
  assert.ok(done.added > 0, 'matching businesses went into the Pipeline on their own');
  assert.equal((await t.call('GET', '/api/leads')).data.leads.filter((l) => l.source === 'Lead finder').length, done.added);
  const n = (await t.call('GET', '/api/notifications')).data;
  assert.ok(JSON.stringify(n).includes('Lead search finished'));
  // Stop and resume.
  r = await t.call('POST', '/api/finder/jobs', { keywords: 'electrician', areas: 'Doral, FL', size: 3 });
  const j2 = r.data.job.id;
  r = await t.call('POST', `/api/finder/jobs/${j2}/stop`);
  assert.equal(r.data.job.status, 'stopped');
  r = await t.call('POST', '/api/finder/tick');
  assert.equal(r.data.used, 0, 'a stopped search is left alone');
  r = await t.call('POST', `/api/finder/jobs/${j2}/resume`);
  assert.equal(r.data.job.status, 'queued');
  assert.equal((await finish(t, j2)).status, 'done');
  r = await t.call('DELETE', `/api/finder/jobs/${j2}`);
  assert.equal(r.status, 200);
  assert.equal((await t.call('GET', `/api/finder/jobs/${j2}`)).status, 404);
  assert.equal((await all(t.env, 'SELECT * FROM finder_results WHERE job_id = ?', j2)).length, 0);
  // An agent never reaches it.
  const inv = await t.call('POST', '/api/team/invite', { email: 'rep@x.com', name: 'Rep', role: 'team', job: 'closer' });
  t.logout();
  await t.call('POST', '/api/auth/invite/accept', { token: inv.data.inviteUrl.split('/#/invite/')[1], password: 'another long password' });
  for (const [m, p] of [['GET', '/api/finder'], ['POST', '/api/finder/jobs'], ['POST', '/api/finder/tick'], ['GET', `/api/finder/jobs/${id}/results`], ['POST', `/api/finder/jobs/${id}/add`]]) {
    assert.equal((await t.call(m, p, m === 'POST' ? {} : undefined)).status, 403, `${m} ${p}`);
  }
});

test('finder with DataForSEO: real shape, cost counted, empty balance stops the job and resume carries on', async () => {
  const t = setup({ DATAFORSEO_LOGIN: 'login', DATAFORSEO_PASSWORD: 'pass' });
  await owner(t);
  const r = await t.call('POST', '/api/finder/jobs', { keywords: 'roofer', areas: '25.77,-80.19', size: 3, radius: 3 });
  assert.equal(r.status, 200);
  const id = r.data.job.id;
  assert.equal(r.data.job.demo, false);
  const calls = [];
  const item = (n) => ({ type: 'maps_search', rank_group: n, title: `Roofer ${n}`, cid: `c${n}`, place_id: `p${n}`, category: 'Roofing contractor', additional_categories: ['Gutter service'],
    phone: `(305) 555-01${String(n).padStart(2, '0')}`, url: `https://roofer${n}.test/`, domain: `roofer${n}.test`, rating: { value: 4.5, votes_count: 10 + n }, address: `${n} Main St, Miami, FL 33101`,
    address_info: { city: 'Miami', region: 'Florida', zip: '33101' }, latitude: 25.77, longitude: -80.19, is_claimed: n % 2 === 0, total_photos: 5 });
  const broke = async () => Response.json({ status_code: 20000, tasks: [{ status_code: 40200, status_message: 'Payment Required.' }] });
  const good = async (u, init) => { calls.push(JSON.parse(init.body)[0]); const n = calls.length; return Response.json({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.002, result: [{ items: [item(1), item(2), item(n + 2)] }] }] }); };
  assert.equal(await finderTick(t.env, 12, { fetchImpl: broke }), 6, 'the first batch ran and failed');
  let job = (await t.call('GET', `/api/finder/jobs/${id}`)).data.job;
  assert.equal(job.status, 'failed');
  assert.match(job.error, /balance is empty/);
  assert.equal(job.done, 0, 'nothing is skipped when the balance runs out');
  await t.call('POST', `/api/finder/jobs/${id}/resume`);
  while ((await t.call('GET', `/api/finder/jobs/${id}`)).data.job.status !== 'done') await finderTick(t.env, 12, { fetchImpl: good });
  job = (await t.call('GET', `/api/finder/jobs/${id}`)).data.job;
  assert.equal(job.done, 9);
  assert.equal(job.cost, 0.018);
  assert.ok(job.found >= 3 && job.found <= 11);
  assert.match(calls[0].location_coordinate, /^25\.\d{7},-80\.\d{7},\d{2}z$/);
  assert.equal(calls[0].depth, 100);
  assert.equal(calls[0].keyword, 'roofer');
  const res = (await t.call('GET', `/api/finder/jobs/${id}/results`)).data.results;
  const a = res.find((x) => x.key === 'p1');
  assert.equal(a.category, 'Roofing contractor');
  assert.equal(a.state, 'Florida');
  assert.equal(a.website, 'https://roofer1.test/');
  assert.equal(a.reviews, 11);
  assert.equal(a.claimed, false);
  const spend = await all(t.env, "SELECT kind, n FROM cost_daily WHERE vendor = 'dataforseo'");
  assert.ok(spend.some((s) => s.kind === 'lead finder (maps)' && s.n >= 9), 'finder spend shows up in the budget on its own line');
});
