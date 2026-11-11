import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, all } from '../src/db.js';
import { finderTick } from '../src/leadfinder.js';
import { researchTick } from '../src/autoresearch.js';
import { scrubTick } from '../src/scrub.js';
import { sunbizLookup, osmSearch, leadMode } from '../src/freedata.js';
import { estimate, taskList, MAX_OSM_REQUESTS } from '../public/js/finder.js';
import { d1, r2 } from './shims.mjs';

function setup(extra = {}) {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', FINDER_GEOCODE_GAP: '0', FINDER_OSM_GAP: '0', ...extra };
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
  return { env, call };
}
const owner = (t) => t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });

const overpass = (calls) => async (url, init) => {
  calls.push({ url, body: decodeURIComponent(String(init.body).replace(/^data=/, '')) });
  return Response.json({ elements: [
    { type: 'node', id: 1, lat: 25.77, lon: -80.19, tags: { name: 'Bayside Roofing', craft: 'roofer', phone: '+1 305-555-0111', website: 'https://baysideroofing.test', 'contact:email': 'info@baysideroofing.test', 'addr:city': 'Miami', 'addr:state': 'FL' } },
    { type: 'way', id: 2, center: { lat: 25.78, lon: -80.2 }, tags: { name: 'No Phone Roofers', craft: 'roofer' } },
    { type: 'node', id: 3, lat: 25.79, lon: -80.21, tags: { craft: 'roofer' } },
  ] });
};

test('free finder: OpenStreetMap search costs nothing, keeps emails and hours, and adds to the pipeline', async () => {
  const t = setup({ DATAFORSEO_LOGIN: 'login', DATAFORSEO_PASSWORD: 'pass' });
  await owner(t);
  assert.equal(estimate({ areas: 2, size: 3, keywords: 2, source: 'osm' }).cost, 0);
  assert.ok(MAX_OSM_REQUESTS < 1000);
  assert.equal(estimate({ areas: 12, size: 5, keywords: 10, source: 'osm' }).tooBig, true);
  const big = await t.call('POST', '/api/finder/jobs', { keywords: 'roofer, plumber, hvac', areas: 'Miami, FL\nHialeah, FL\nDoral, FL\nKendall, FL', size: 5, source: 'osm' });
  assert.equal(big.status, 400);
  assert.match(big.data.error, /free searches/);
  const r = await t.call('POST', '/api/finder/jobs', { keywords: 'roofing contractor', areas: '25.77,-80.19', size: 1, radius: 3, source: 'osm' });
  assert.equal(r.status, 200);
  assert.equal(r.data.job.source, 'osm');
  assert.equal(r.data.job.demo, false, 'OpenStreetMap needs no DataForSEO, so it is never demo');
  assert.equal(r.data.job.total, 1);
  const calls = [];
  assert.equal(await finderTick(t.env, 12, { fetchImpl: overpass(calls) }), 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /overpass/);
  assert.match(calls[0].body, /craft=roofer/);
  assert.match(calls[0].body, /around:482\d/);
  const id = r.data.job.id;
  const job = (await t.call('GET', `/api/finder/jobs/${id}`)).data.job;
  assert.equal(job.status, 'done');
  assert.equal(job.cost, 0);
  assert.equal(job.found, 2, 'an element without a name is not a business');
  assert.equal((await all(t.env, 'SELECT * FROM cost_daily')).length, 0, 'nothing was spent');
  const res = (await t.call('GET', `/api/finder/jobs/${id}/results`)).data.results;
  const a = res.find((x) => x.title === 'Bayside Roofing');
  assert.equal(a.email, 'info@baysideroofing.test');
  assert.equal(a.rating, null);
  const add = await t.call('POST', `/api/finder/jobs/${id}/add`, { filters: { phone: 'has' } });
  assert.equal(add.data.imported, 1, 'only the one with a phone');
  const lead = (await t.call('GET', '/api/leads')).data.leads.find((l) => l.business === 'Bayside Roofing');
  assert.equal(lead.email, 'info@baysideroofing.test');
  assert.equal(lead.source, 'Lead finder');
});

test('osm search: tries the next server, and says so plainly when all are busy or the keyword has no category', async () => {
  let n = 0;
  const flaky = async () => { n++; return n === 1 ? new Response('busy', { status: 429 }) : Response.json({ elements: [{ type: 'node', id: 9, lat: 1, lon: 2, tags: { name: 'A' } }] }); };
  const ok = await osmSearch({}, { keyword: 'roofer', lat: 25, lng: -80, radius: 3 }, flaky);
  assert.equal(ok.results.length, 1); assert.equal(n, 2);
  await assert.rejects(() => osmSearch({}, { keyword: 'roofer', lat: 25, lng: -80, radius: 3 }, async () => new Response('x', { status: 504 })), /busy/);
  await assert.rejects(() => osmSearch({}, { keyword: '', lat: 25, lng: -80 }, async () => null), /no category/);
});

test('free mode: Google Maps searches and automatic research stay off, the switch is owners only', async () => {
  const t = setup({ DATAFORSEO_LOGIN: 'login', DATAFORSEO_PASSWORD: 'pass' });
  assert.equal((await t.call('GET', '/api/lead-mode')).status, 401);
  await owner(t);
  assert.equal((await t.call('GET', '/api/lead-mode')).data.mode, 'paid');
  assert.equal((await t.call('PUT', '/api/lead-mode', { mode: 'nonsense' })).status, 400);
  const on = await t.call('PUT', '/api/lead-mode', { mode: 'free' });
  assert.equal(on.data.mode, 'free');
  assert.equal((await leadMode(t.env)).mode, 'free');
  const g = await t.call('POST', '/api/finder/jobs', { keywords: 'roofer', areas: '25.77,-80.19', size: 3, radius: 3 });
  assert.equal(g.status, 400);
  assert.match(g.data.error, /Free lead data mode/);
  assert.equal((await t.call('POST', '/api/finder/jobs', { keywords: 'roofer', areas: '25.77,-80.19', size: 1, radius: 3, source: 'osm' })).status, 200);
  await t.call('POST', '/api/leads/import', { rows: [{ business: 'Test Roofing', phone: '305-555-0188', city: 'Miami', state: 'FL' }] });
  let called = 0;
  const spy = async () => { called++; return Response.json({}); };
  await t.call('PUT', '/api/research/settings', { on: true });
  const realFetch = globalThis.fetch; globalThis.fetch = spy;
  try { assert.equal(await researchTick(t.env, 3), 1, 'free research runs on the lead without any paid call'); } finally { globalThis.fetch = realFetch; }
  assert.equal(called, 0, 'no paid research call went out');
  assert.equal((await t.call('GET', '/api/research/status')).data.free, true);
  await t.call('PUT', '/api/lead-mode', { mode: 'paid' });
  assert.equal((await t.call('GET', '/api/lead-mode')).data.mode, 'paid');
});

const SB_SEARCH = '<table><tr><td><a href="/Inquiry/CorporationSearch/SearchResultDetail?aggregateId=domp-l1-x">BAYSIDE ROOFING LLC</a></td><td>L1</td><td>Active</td></tr></table>';
const SB_DETAIL = '<div>Detail by Entity Name</div><div>Florida Limited Liability Company</div><div>BAYSIDE ROOFING LLC</div><div>Document Number</div><div>L12000012345</div><div>Date Filed</div><div>02/14/2012</div><div>Status</div><div>ACTIVE</div><div>Authorized Person(s) Detail</div><div>Title MGR</div><div>LOPEZ, MARIA R</div><div>12 NW 5TH ST</div><div>Annual Reports</div>';
const sunbizFetch = (log = []) => async (u) => {
  log.push(String(u));
  if (String(u).includes('search.sunbiz.org') && String(u).includes('SearchResults')) return new Response(SB_SEARCH, { headers: { 'content-type': 'text/html' } });
  if (String(u).includes('SearchResultDetail')) return new Response(SB_DETAIL, { headers: { 'content-type': 'text/html' } });
  return new Response('<html><body><h1>Bayside</h1><p>Serving Miami and Doral. 12 years of experience. Free estimates.</p></body></html>', { headers: { 'content-type': 'text/html' } });
};

test('sunbiz: finds the owner on the Florida registry and skips other states', async () => {
  const log = [];
  const r = await sunbizLookup({ business: 'Bayside Roofing', state: 'FL' }, sunbizFetch(log));
  assert.equal(r.found, true);
  assert.equal(r.owner, 'Maria R Lopez');
  assert.equal(r.ownerTitle, 'Manager');
  assert.equal(r.active, true);
  assert.ok(r.years >= 14);
  assert.match(log[0], /EntityName\/bayside%20roofing\/Page1/);
  assert.match(log[1], /^https:\/\/search\.sunbiz\.org\/Inquiry/);
  assert.deepEqual(await sunbizLookup({ business: 'Bayside Roofing', state: 'TX' }, sunbizFetch()), { skipped: 'not Florida' });
  assert.equal((await sunbizLookup({ business: 'Nobody Special', state: 'FL' }, sunbizFetch())).found, false);
  const down = await sunbizLookup({ business: 'Bayside Roofing', state: 'FL' }, async () => new Response('no', { status: 503 }));
  assert.equal(down.found, false); assert.match(down.error, /503/);
});

test('scrub in free mode fills owner (registry), services and areas (website) without spending anything', async () => {
  const t = setup();
  await owner(t);
  await t.call('POST', '/api/leads/import', { rows: [{ business: 'Bayside Roofing LLC', phone: '(305) 555-0144', website: 'baysideroofing.test', city: 'Miami', state: 'FL' }] });
  assert.ok((await scrubTick(t.env, 3, sunbizFetch())) >= 1);
  const lead = (await t.call('GET', '/api/leads')).data.leads.find((l) => l.phone_digits === '3055550144');
  const r = (await t.call('GET', `/api/leads/${lead.id}`)).data;
  assert.equal(r.lead.owner_name, 'Maria R Lopez');
  const sd = r.scrub;
  assert.equal(sd.sunbiz.found, true);
  assert.deepEqual(sd.profile.areas, ['Miami', 'Doral']);
  assert.equal(sd.profile.years, 12);
  assert.equal(sd.profile.freeEstimate, true);
  // The registry can be switched off.
  await t.call('PUT', '/api/lead-mode', { sunbiz: false });
  await t.call('POST', `/api/leads/${lead.id}/scrub`);
  assert.equal((await t.call('GET', `/api/leads/${lead.id}`)).data.scrub.sunbiz, undefined);
  assert.equal(taskList([{ label: 'a', lat: 25, lng: -80, radius: 6, size: 1 }], ['x'])[0].radius, 6);
});

test('scrub saves the state registry result: open data state, link only state, and Florida still sets the owner', async () => {
  const t = setup();
  await owner(t);
  await t.call('POST', '/api/leads/import', { rows: [
    { business: 'Mile High Roofing', phone: '(303) 555-0101', state: 'CO', city: 'Denver' },
    { business: 'Lone Star Roofing', phone: '(512) 555-0102', state: 'TX', city: 'Austin' },
  ] });
  const stub = async (u) => String(u).includes('data.colorado.gov')
    ? Response.json([{ entityname: 'MILE HIGH ROOFING LLC', entitystatus: 'Good Standing', entityformdate: '2012-02-14T00:00:00.000', agentorganizationname: 'REGISTERED AGENTS INC' }])
    : new Response('', { status: 404 });
  await scrubTick(t.env, 5, stub);
  const leads = (await t.call('GET', '/api/leads')).data.leads;
  const co = (await t.call('GET', `/api/leads/${leads.find((l) => l.state === 'CO').id}`)).data;
  assert.equal(co.scrub.registry.found, true);
  assert.equal(co.scrub.registry.agent, 'Registered Agents Inc');
  assert.equal(co.lead.owner_name, null, 'a registered agent is never the owner');
  const tx = (await t.call('GET', `/api/leads/${leads.find((l) => l.state === 'TX').id}`)).data;
  assert.equal(tx.scrub.registry.linkOnly, true);
  assert.equal(tx.scrub.sunbiz, undefined);
});
