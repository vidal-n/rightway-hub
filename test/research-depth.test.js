import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, all, run } from '../src/db.js';
import { researchLead } from '../src/intel.js';
import { researchTick } from '../src/autoresearch.js';
import { resetSchemaCache as _rsc } from '../src/db.js';
import { adSignals, adsLine, adLibraryLinks, mergeAds, RESEARCH_DEPTHS, cleanDepth, extractProfile } from '../public/js/freedata.js';
import { d1, r2 } from './shims.mjs';

const env = (extra = {}) => ({ DATAFORSEO_LOGIN: 'l', DATAFORSEO_PASSWORD: 'p', DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', ...extra });

// A DataForSEO stand-in that counts every paid search and what it cost.
function dfs() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body)[0] : {};
    const local = String(url).includes('local_finder');
    const cost = local ? 0.004 : 0.002;
    calls.push({ url: String(url), local, cost, kw: body.keyword });
    const items = [
      { type: 'maps_search', rank_group: 1, title: 'Rival Roofing', cid: 'c-rival', rating: { value: 4.9, votes_count: 300 }, latitude: 25.77, longitude: -80.19 },
      { type: 'maps_search', rank_group: 2, title: 'Bayside Roofing', cid: 'c-me', place_id: 'p-me', rating: { value: 4.4, votes_count: 20 }, latitude: 25.77, longitude: -80.19, url: 'https://baysideroofing.test' },
    ];
    return Response.json({ status_code: 20000, cost, tasks: [{ status_code: 20000, cost, result: [{ items, item_types: ['maps_search'] }] }] });
  };
  return { calls, fetchImpl, spent: () => calls.reduce((s, c) => s + c.cost, 0) };
}
const finderLead = { id: 'L1', business: 'Bayside Roofing', city: 'Miami', state: 'FL', industry: 'roofing', cid: 'c-me', place_id: 'p-me', lat: 25.77, lng: -80.19, rating: 4.4, reviews: 20, category: 'Roofing contractor', website: 'baysideroofing.test' };
const siteFetch = (inner) => async (url, init) => (String(url).includes('dataforseo') ? inner(url, init) : new Response('<html><title>Bayside Roofing Miami</title><h1>Roofing</h1></html>', { headers: { 'content-type': 'text/html' } }));

test('depth costs: lite is one Maps search, standard nine Maps searches, full nine Local Finder searches', async () => {
  const out = {};
  for (const depth of ['lite', 'standard', 'full']) {
    const d = dfs();
    const intel = await researchLead(env(), finderLead, { depth, fetchImpl: siteFetch(d.fetchImpl) });
    out[depth] = { n: d.calls.filter((c) => c.url.includes('dataforseo')).length, spent: Math.round(d.spent() * 1000) / 1000, intel };
  }
  assert.equal(out.lite.n, 1); assert.equal(out.lite.spent, 0.002);
  assert.equal(out.standard.n, 9); assert.equal(out.standard.spent, 0.018);
  assert.equal(out.full.n, 10, 'full also does the profile lookup, like before');
  assert.ok(out.full.spent >= 0.036, 'full still uses Local Finder');
  assert.ok(out.lite.spent < out.standard.spent && out.standard.spent < out.full.spent);
  // Lite claims a rank and competitors, never a grid.
  assert.equal(out.lite.intel.depth, 'lite'); assert.equal(out.lite.intel.rank, 2); assert.equal(out.lite.intel.grid, null);
  assert.equal(out.lite.intel.competitors[0].title, 'Rival Roofing');
  assert.equal(out.standard.intel.grid.points, 9);
  // A finder lead already has its Google facts: no profile lookup, so the free parts really are free.
  assert.equal(out.lite.intel.listing.reviews, 20);
});

test('free depth: no paid search at all, and it refuses to guess when Google facts are missing', async () => {
  const d = dfs();
  const intel = await researchLead(env(), finderLead, { depth: 'free', fetchImpl: siteFetch(d.fetchImpl) });
  assert.equal(d.calls.filter((c) => c.url.includes('dataforseo')).length, 0);
  assert.equal(intel.rank, null); assert.equal(intel.grid, null); assert.equal(intel.found, true);
  assert.ok(intel.website.ok);
  const nofacts = await researchLead(env(), { id: 'L2', business: 'No Facts Inc', city: 'Miami', state: 'FL' }, { depth: 'free', fetchImpl: siteFetch(d.fetchImpl) });
  assert.equal(nofacts.found, false); assert.equal(nofacts.rank_checked, false); assert.equal(nofacts.free, true);
  assert.equal(d.calls.filter((c) => c.url.includes('dataforseo')).length, 0);
});

test('automatic research uses the owner depth, and free depth only touches finder leads', async () => {
  resetSchemaCache();
  const e = env();
  let cookie = '';
  const call = async (m, p, b) => { const h = { 'x-rw': '1' }; if (cookie) h.cookie = cookie; if (b) h['content-type'] = 'application/json'; const r = await worker.fetch(new Request(`https://hub.test${p}`, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }), e); const s = r.headers.get('set-cookie'); if (s) cookie = s.split(';')[0]; return { status: r.status, data: await r.json().catch(() => ({})) }; };
  await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  assert.equal((await call('GET', '/api/research/status')).data.depth, 'lite', 'lite is the default');
  assert.equal((await call('PUT', '/api/research/settings', { depth: 'huge' })).status, 400);
  await call('PUT', '/api/research/settings', { depth: 'free', callDepth: 'lite' });
  const st = (await call('GET', '/api/research/status')).data;
  assert.equal(st.depth, 'free'); assert.equal(st.callDepth, 'lite'); assert.equal(st.depths.lite.cost, 0.002);
  await call('POST', '/api/leads/import', { rows: [{ business: 'Plain Plumbing', phone: '305-555-0111', city: 'Miami', state: 'FL' }] });
  const real = globalThis.fetch; let net = 0; globalThis.fetch = async () => { net++; return Response.json({}); };
  try { assert.equal(await researchTick(e, 3), 1, 'free depth researches it with no paid call'); } finally { globalThis.fetch = real; }
  assert.equal(net, 0);
});

test('ad signals: pixels, ids, call tracking, and the honest sentence', () => {
  const html = `<script async src="https://www.googletagmanager.com/gtag/js?id=AW-123456789"></script><script>gtag('config','AW-123456789');fbq('init','1234567890123');</script>
    <script src="https://connect.facebook.net/en_US/fbevents.js"></script><script src="//cdn.callrail.com/companies/1/swap.js"></script>`;
  const a = adSignals(html);
  assert.equal(a.google, true); assert.deepEqual(a.googleIds, ['AW-123456789']); assert.equal(a.meta, true); assert.deepEqual(a.metaIds, ['1234567890123']);
  assert.deepEqual(a.callTracking, ['CallRail']); assert.equal(a.any, true); assert.deepEqual(a.platforms, ['Google Ads', 'Meta (Facebook, Instagram)']);
  assert.match(adsLine(a), /pay for ads or did/); assert.doesNotMatch(adsLine(a), /running ads/);
  const none = adSignals('<script src="https://www.googletagmanager.com/gtag/js?id=G-ABCDEF1234"></script>');
  assert.equal(none.any, false); assert.equal(none.analytics, true); assert.match(adsLine(none), /only analytics/);
  assert.equal(adSignals('').any, false); assert.equal(adsLine(null), '');
  assert.equal(adSignals('<p>gclid is mentioned in a blog about SEO</p>').google, false, 'plain words are not tracking code');
  const m = mergeAds(adSignals('<script src="//bat.bing.com/bat.js"></script>'), a);
  assert.ok(m.bing && m.google && m.meta); assert.deepEqual(m.callTracking, ['CallRail']);
  assert.equal(extractProfile(html).ads.google, true);
  const links = adLibraryLinks({ website: 'https://www.baysideroofing.test/about', business: "Bob's Roofing" });
  assert.equal(links[0].url, 'https://adstransparency.google.com/?region=US&domain=baysideroofing.test');
  assert.match(links[1].url, /facebook\.com\/ads\/library\/.*q=Bob's%20Roofing|q=Bob'?s/);
  assert.deepEqual(adLibraryLinks({}), []);
});

test('research depth table is consistent and has no dashes', () => {
  assert.deepEqual(Object.keys(RESEARCH_DEPTHS), ['free', 'lite', 'standard', 'full']);
  assert.equal(cleanDepth('x'), 'lite'); assert.equal(cleanDepth('x', 'full'), 'full'); assert.equal(cleanDepth('free'), 'free');
  for (const d of Object.values(RESEARCH_DEPTHS)) assert.doesNotMatch(`${d.label}${d.what}`, /[–—]/);
});

import { directoryLinks, cleanManual, MANUAL_FIELDS } from '../public/js/freedata.js';

test('free lookup links and typed-in listing details', async () => {
  const links = directoryLinks({ business: "Bob's Roofing", city: 'Miami', state: 'FL', website: 'https://bobsroofing.test' });
  assert.deepEqual(links.map((l) => l.key), ['google', 'maps', 'yelp', 'bbb', 'owner', 'site']);
  assert.match(links[0].url, /google\.com\/search\?q=Bob's%20Roofing%20Miami%20FL/);
  assert.deepEqual(directoryLinks({}), []);
  const m = cleanManual({ rating: '4.8', reviews: '112', phone: ' 305 555 0111 ', owner_name: 'Maria Lopez', google_url: 'javascript:alert(1)' });
  assert.equal(m.rating, 4.8); assert.equal(m.reviews, 112); assert.equal(m.phone, '305 555 0111'); assert.equal(m.google_url, '');
  assert.equal(cleanManual({ rating: '9' }).rating, null, 'ratings above 5 are rejected');
  assert.deepEqual(MANUAL_FIELDS.length, 6);
});

test('typed-in details let free research show a listing, and the route saves them', async () => {
  resetSchemaCache();
  const e = env({ DATAFORSEO_LOGIN: '', DATAFORSEO_PASSWORD: '' });
  let cookie = '';
  const call = async (m, p, b) => { const h = { 'x-rw': '1' }; if (cookie) h.cookie = cookie; if (b) h['content-type'] = 'application/json'; const r = await worker.fetch(new Request(`https://hub.test${p}`, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }), e); const s = r.headers.get('set-cookie'); if (s) cookie = s.split(';')[0]; return { status: r.status, data: await r.json().catch(() => ({})) }; };
  await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  await call('POST', '/api/leads/import', { rows: [{ business: 'Hand Typed Roofing', phone: '305-555-0150', city: 'Miami', state: 'FL' }] });
  const id = (await call('GET', '/api/leads')).data.leads.find((l) => l.business === 'Hand Typed Roofing').id;
  const saved = await call('PUT', `/api/leads/${id}/listing-by-hand`, { rating: '4.6', reviews: '38', owner_name: 'Ana Ruiz', hours: 'Mon to Fri 8am to 5pm' });
  assert.equal(saved.status, 200); assert.equal(saved.data.manual.reviews, 38);
  const lead = (await call('GET', `/api/leads/${id}`)).data.lead;
  assert.equal(lead.owner_name, 'Ana Ruiz'); assert.equal(lead.rating, 4.6);
  assert.equal((await call('PUT', `/api/leads/nope/listing-by-hand`, {})).status, 404);
  const intel = await researchLead(e, lead, { depth: 'free', fetchImpl: async () => { throw new Error('no network in this test'); } });
  assert.equal(intel.found, true); assert.equal(intel.by_hand, true); assert.equal(intel.rank_checked, false); assert.equal(intel.listing.reviews, 38);
  assert.equal(intel.free, true);
});
