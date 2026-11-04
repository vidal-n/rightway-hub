// Lead research, scoring, dedupe, merge, Google booking math, onboarding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
import { scoreLead, findProblems, recommendPlan, buildScript, dupKeys, normDomain, normName, industryInfo, fill, roi } from '../public/js/leadintel.js';
import { openSlots, zoned } from '../public/js/slots.js';
import { citations, gbpChecklist, reviewTarget, ninetyDayPlan, compareIntel } from '../public/js/fulfill.js';
import { matchListing, parseSite } from '../src/intel.js';
import { seal, unseal } from '../src/google.js';
import { filterLeads } from '../public/js/leadfilter.js';

function setup(extra = {}) {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', ...extra };
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const h = { 'x-rw': '1', ...headers };
    if (cookie) h.cookie = cookie;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (typeof body === 'string') payload = body;
    else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload, redirect: 'manual' }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text(), res };
  };
  return { env, call, clearCookie: () => { cookie = ''; } };
}
async function owner(t) {
  const r = await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'Vidal Newton', password: 'correct horse battery' });
  assert.equal(r.status, 200);
}

const INTEL = {
  at: Date.now(), found: true, keyword: 'roofing contractor', rank: 7,
  listing: { title: 'Summit Roofing', reviews: 18, rating: 4.1, category: 'Roofing contractor', claimed: false, hours: false, photos: 6, url: 'https://summit.example', additional_categories: [] },
  grid: { size: 3, radiusMiles: 2, points: 9, top3: 1, avg: 9.4, cells: Array.from({ length: 9 }, (_, i) => ({ row: Math.floor(i / 3), col: i % 3, rank: i === 4 ? 7 : i < 3 ? i + 2 : null })) },
  competitors: [{ title: 'Coastal Roof Pros', reviews: 240, rating: 4.8 }, { title: 'Bayside Roofing', reviews: 97, rating: 4.5 }],
  website: { ok: true, https: false, title: 'Home', titleHasCity: false, titleHasService: false, schema: false, tel: false, viewport: true },
  speed: { score: 28, lcp: '7.1 s' },
};

test('industry, dedupe keys, and name cleanup', () => {
  assert.equal(industryInfo('Roofing').tier, 'high');
  assert.equal(industryInfo('', 'Plumber').keyword, 'plumber');
  assert.equal(normDomain('https://www.Summit-Roofing.com/contact'), 'summit-roofing.com');
  assert.equal(normDomain('https://facebook.com/summit'), null);
  assert.equal(normName('The Summit Roofing, LLC'), 'summit roofing');
  assert.deepEqual(dupKeys({ phone: '+1 (954) 555-0101', website: 'summit-roofing.com', business: 'Summit Roofing Inc', city: 'Hollywood' }),
    ['p:9545550101', 'd:summit-roofing.com', 'n:summit roofing|hollywood']);
});

test('problems, score, plan, and script come from the research', () => {
  const lead = { business: 'Summit Roofing', contact_name: 'Bob Smith', phone: '9545550101', industry: 'Roofing', city: 'Hollywood', state: 'FL', stage: 'new' };
  const probs = findProblems(INTEL, lead);
  const keys = probs.map((p) => p.key);
  for (const k of ['unclaimed', 'not_top3', 'grid_weak', 'review_gap', 'low_rating', 'no_hours', 'slow_site', 'no_click_to_call']) assert.ok(keys.includes(k), k);
  assert.equal(probs[0].severity, 'high');
  const sc = scoreLead(lead, INTEL);
  assert.ok(sc.score >= 75, `score ${sc.score}`);
  assert.equal(sc.grade, 'A');
  assert.equal(scoreLead({ ...lead, dnc: 1 }, INTEL).score, 0);
  const strong = { ...INTEL, rank: 1, grid: { ...INTEL.grid, top3: 9 }, listing: { ...INTEL.listing, reviews: 400, rating: 4.9, claimed: true, hours: true, photos: 80 }, competitors: [{ title: 'X', reviews: 100 }], speed: { score: 90 }, website: { ok: true, https: true, titleHasCity: true, titleHasService: true, schema: true, tel: true } };
  assert.ok(scoreLead(lead, strong).score < sc.score, 'a business already winning scores lower');
  assert.equal(recommendPlan(lead, INTEL).plan, 'authority');
  assert.equal(recommendPlan({ ...lead, industry: 'Salon' }, { ...INTEL, competitors: [{ title: 'Y', reviews: 30 }], listing: { ...INTEL.listing, claimed: true, rating: 4.6 }, grid: { ...INTEL.grid, top3: 6 }, rank: 2, speed: null, website: null }).plan, 'starter');
  const s = buildScript(lead, INTEL, { rep: 'Vidal' });
  assert.match(s.steps[0].lines[0], /Hey Bob, this is Vidal with Rightway Growth/);
  assert.match(s.steps[0].lines[0], /Google clarity check on Summit Roofing/);
  const step = (sc, id) => sc.steps.find((x) => x.id === id).lines.join('\n');
  assert.match(step(s, 'c_scan'), /from \d+ spots around Summit Roofing/);
  assert.match(step(s, 'c_scan'), /Same search/);
  // Drop close: Market Leader first, then the recommended plan with setup + first month today.
  assert.match(step(s, 'c_price'), /Market Leader program.*\$599 to build out and \$599 a month/);
  assert.match(step(s, 'c_price'), /Authority.*\$499 for the buildout and \$499 a month\. Total today is \$998/s);
  assert.match(s.objections.find((o) => o.q === "I can't afford it (drop)").a, /Growth.*\$449/);
  assert.ok(s.objections.find((o) => o.q === "It's too expensive").a.includes('extra job'));
  assert.ok(s.playbook.length >= 10);
  // Without research the script never claims a scan was run.
  const cold = buildScript(lead, null, { rep: 'Vidal' });
  for (const id of ['c_open', 'c_frame', 'c_scan', 'voicemail', 'gatekeeper']) assert.ok(!/\bran\b|scan I|scanner/i.test(step(cold, id)), id);
  assert.match(step(buildScript(lead, INTEL, { rep: 'Vidal', plan: 'starter' }), 'c_price'), /Starter/);
  assert.match(buildScript(lead, INTEL, { rep: 'Vidal', plan: 'starter' }).objections.find((o) => /drop/.test(o.q)).a, /smallest plan/);
  assert.ok(!/\[\w/.test(JSON.stringify(s.objections)), 'every objection placeholder fills in');
  assert.equal(fill('Hi {first} {missing}', { first: 'Ana' }), 'Hi Ana [missing]');
  assert.equal(roi({ ticket: 200, jobs: 4, plan: 'growth' }).breakeven, 3);
  // No dashes that read as em or en dashes in generated copy.
  assert.ok(!/[–—]/.test(JSON.stringify(s) + JSON.stringify(probs)));
});

test('research helpers: listing match and website parsing', () => {
  const results = [{ title: 'Summit Roofing & Gutters', phone: '(954) 555-0101', cid: '1' }, { title: 'Summit Pools', phone: '', cid: '2' }];
  assert.equal(matchListing(results, { business: 'Other name', phone: '954-555-0101' }).cid, '1');
  assert.equal(matchListing(results, { business: 'Summit Roofing and Gutters LLC' }).cid, '1');
  assert.equal(matchListing(results, { business: 'Totally Different Co' }), null);
  const w = parseSite('<html><head><title>Roof Repair in Hollywood FL | Summit</title><meta name="viewport" content="width=device-width"><script type="application/ld+json">{"@type":"RoofingContractor"}</script></head><body><h1>Roofers</h1><a href="tel:+19545550101">Call</a><form></form></body></html>',
    { finalUrl: 'https://summit.example/', city: 'Hollywood', keyword: 'roofing contractor' });
  assert.equal(w.https, true); assert.equal(w.titleHasCity, true); assert.equal(w.titleHasService, true); assert.equal(w.schema, true); assert.equal(w.tel, true);
});

test('booking slots respect hours, weekdays, busy times, buffer, notice, and daylight saving', () => {
  const tz = 'America/New_York';
  assert.equal(new Date(zoned(2026, 11, 2, 9, 0, tz)).toISOString(), '2026-11-02T14:00:00.000Z'); // EST
  assert.equal(new Date(zoned(2026, 7, 1, 9, 0, tz)).toISOString(), '2026-07-01T13:00:00.000Z'); // EDT
  const from = Date.parse('2026-11-01T12:00:00Z'); // Sunday
  const busy = [[Date.parse('2026-11-02T15:00:00Z'), Date.parse('2026-11-02T16:00:00Z')]]; // Mon 10 to 11am ET
  const slots = openSlots({ from, days: 2, tz, startHour: 9, endHour: 12, minutes: 30, buffer: 15, noticeHours: 4, busy });
  const iso = slots.map((s) => new Date(s).toISOString());
  assert.ok(iso.includes('2026-11-02T14:00:00.000Z')); // 9:00
  assert.ok(!iso.includes('2026-11-02T14:30:00.000Z')); // 9:30 ends 10:00, inside buffer
  assert.ok(!iso.includes('2026-11-02T15:30:00.000Z')); // busy
  assert.ok(iso.includes('2026-11-02T16:30:00.000Z')); // 11:30 ends noon, buffer ok after 11:00 + 15
  assert.ok(!iso.some((s) => s.startsWith('2026-11-01'))); // Sunday off
});

test('Google token sealing round trips and needs the right secret', async () => {
  const s = await seal({ GOOGLE_CLIENT_SECRET: 'abc' }, 'refresh-token-1');
  assert.equal(await unseal({ GOOGLE_CLIENT_SECRET: 'abc' }, s), 'refresh-token-1');
  await assert.rejects(unseal({ GOOGLE_CLIENT_SECRET: 'other' }, s));
});

test('fulfillment helpers: citations, profile checklist, review target, 90 days, before vs now', () => {
  const c = citations({ name: 'Summit Roofing', city: 'Hollywood', state: 'FL', category: 'Roofing contractor' });
  assert.ok(c.find((x) => x.name === 'Apple Business Connect'));
  assert.ok(c.find((x) => x.name === 'Angi'), 'home services sites for roofers');
  assert.ok(!citations({ name: 'Smile', category: 'Dentist' }).find((x) => x.name === 'Angi'));
  assert.equal(gbpChecklist(INTEL).find((i) => i.key === 'claimed').state, false);
  const rt = reviewTarget(INTEL);
  assert.equal(rt.gap, 223); assert.equal(rt.perMonth, 38);
  const p = ninetyDayPlan('growth', INTEL, {});
  assert.equal(p.months.length, 3);
  assert.equal(p.fixes[0].week, 1);
  const after = { ...INTEL, rank: 3, grid: { ...INTEL.grid, top3: 5 }, listing: { ...INTEL.listing, reviews: 60 }, speed: { score: 70 } };
  const cmp = compareIntel(INTEL, after);
  assert.equal(cmp.rank.better, true); assert.equal(cmp.top3.change, 4); assert.equal(cmp.reviews.change, 42);
});

test('pipeline filters: time zone, grade, reviews, not in top 3, callable', () => {
  const leads = [
    { id: 1, business: 'A', tz_short: 'ET', grade: 'A', reviews: 10, map_rank: 8, callable_now: true, stage: 'new' },
    { id: 2, business: 'B', tz_short: 'PT', grade: 'B', reviews: 300, map_rank: 2, callable_now: false, stage: 'new' },
    { id: 3, business: 'C', tz_short: null, grade: 'D', reviews: null, map_rank: null, callable_now: false, stage: 'new' },
  ];
  assert.deepEqual(filterLeads(leads, { tz: 'ET', f: {} }).map((l) => l.id), [1]);
  assert.deepEqual(filterLeads(leads, { tz: '?', f: {} }).map((l) => l.id), [3]);
  assert.deepEqual(filterLeads(leads, { f: { grades: ['A', 'B'] } }).map((l) => l.id), [1, 2]);
  assert.deepEqual(filterLeads(leads, { f: { maxReviews: 50 } }).map((l) => l.id), [1]);
  assert.deepEqual(filterLeads(leads, { f: { notTop3: true } }).map((l) => l.id), [1, 3]);
  assert.deepEqual(filterLeads(leads, { f: { callable: true } }).map((l) => l.id), [1]);
});

test('API: import dedupes by phone, website, and name; scores; research in demo; merge; bulk; queue filters', async () => {
  const t = setup();
  await owner(t);
  let r = await t.call('POST', '/api/leads/import', { tags: 'Broward Nov', rows: [
    { business: 'Summit Roofing', phone: '954-555-0101', website: 'summitroof.com', city: 'Hollywood', state: 'FL', industry: 'Roofing', reviews: '18', rating: '4.1' },
    { business: 'Summit Roof Co', phone: '954-555-0199', website: 'https://www.summitroof.com/', city: 'Hollywood', state: 'FL' },
    { business: 'Summit Roofing LLC', phone: '954-555-0177', city: 'Hollywood', state: 'FL' },
    { business: 'Lone Star HVAC', phone: '512-555-0103', city: 'Austin', state: 'TX', industry: 'HVAC' },
    { business: 'No contact', city: 'Miami', state: 'FL' },
  ] });
  assert.equal(r.data.imported, 2);
  assert.deepEqual(r.data.skippedBy, { phone: 0, website: 1, name: 1, invalid: 1, dnc: 0 });
  r = await t.call('GET', '/api/leads');
  const summit = r.data.leads.find((l) => l.business === 'Summit Roofing');
  assert.ok(summit.score > 0 && summit.grade);
  assert.equal(summit.tags, 'Broward Nov');
  assert.equal(summit.tz_short, 'ET');
  assert.equal(summit.reviews, 18);
  assert.equal(summit.intel, undefined, 'list view does not ship the research blob');

  r = await t.call('POST', `/api/leads/${summit.id}/research`, {});
  assert.equal(r.status, 200);
  assert.equal(r.data.intel.demo, true);
  assert.equal(r.data.intel.found, true);
  assert.equal(r.data.intel.grid.points, 9);
  assert.ok(r.data.intel.competitors.length >= 1);
  assert.ok(r.data.grade);
  r = await t.call('POST', `/api/leads/${summit.id}/research`, {});
  assert.equal(r.data.cached, true);
  r = await t.call('GET', `/api/leads/${summit.id}`);
  assert.ok(r.data.intel && r.data.lead.researched && r.data.lead.map_rank != null);

  // Duplicates already in the Hub: add one directly (different phone, same site) then merge.
  r = await t.call('POST', '/api/leads', { business: 'Summit', phone: '954-555-0144', website: 'summitroof.com', state: 'FL' });
  assert.equal(r.status, 409, 'single add is blocked as a duplicate too');
  r = await t.call('GET', '/api/leads/duplicates');
  assert.equal(r.data.groups.length, 0);

  const hvac = (await t.call('GET', '/api/leads?q=hvac')).data.leads[0];
  r = await t.call('GET', '/api/dialer/queue?tz=CT');
  assert.ok(r.data.queue.every((l) => l.tz_short === 'CT'));
  r = await t.call('POST', '/api/leads/bulk', { ids: [hvac.id], action: 'tag', value: 'Texas' });
  assert.equal(r.data.count, 1);
  r = await t.call('POST', '/api/leads/bulk', { ids: [hvac.id], action: 'stage', value: 'dnc' });
  r = await t.call('GET', `/api/leads/${hvac.id}`);
  assert.equal(r.data.lead.dnc, 1);
  assert.equal(r.data.lead.tags, 'Broward Nov, Texas');
  r = await t.call('POST', '/api/leads/import', { rows: [{ business: 'Lone Star HVAC', phone: '512-555-0103', state: 'TX' }] });
  assert.equal(r.data.skippedBy.dnc, 1, 'do not call leads stay out on re-import');

  // Convert carries the research over as the client baseline.
  r = await t.call('POST', `/api/leads/${summit.id}/convert`, { plan: 'growth' });
  const cid = r.data.clientId;
  r = await t.call('GET', `/api/clients/${cid}/onboarding`);
  assert.equal(r.status, 200);
  assert.ok(r.data.baseline && r.data.baseline.found);
  assert.ok(r.data.citations.length > 10);
  assert.ok(r.data.gbp.length > 10);
  assert.equal(r.data.plan90.months.length, 3);
  r = await t.call('PUT', `/api/clients/${cid}/onboarding/mark`, { key: 'cit:Yelp', value: 'fixed' });
  r = await t.call('PUT', `/api/clients/${cid}/onboarding/mark`, { key: 'gbp:hours', value: true });
  r = await t.call('GET', `/api/clients/${cid}/onboarding`);
  assert.equal(r.data.citations.find((c) => c.name === 'Yelp').status, 'fixed');
  assert.equal(r.data.gbp.find((g) => g.key === 'hours').done, true);
  r = await t.call('POST', `/api/clients/${cid}/research`);
  assert.equal(r.data.baseline, false, 'second run is a progress check');
  r = await t.call('GET', `/api/clients/${cid}/onboarding`);
  assert.ok(r.data.compare);

  // Intake and uploads.
  r = await t.call('PUT', `/api/clients/${cid}/intake`, { services: 'Roof repair\nRoof replacement', cities: 'Hollywood\nDavie', gbp_access: true, description: 'Family owned' });
  assert.equal(r.status, 200);
  const fd = new FormData();
  fd.append('kind', 'logo');
  fd.append('file', new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' }));
  r = await t.call('POST', `/api/clients/${cid}/assets`, fd);
  assert.equal(r.status, 200);
  const assetId = r.data.ids[0];
  r = await t.call('GET', `/api/assets/${assetId}`);
  assert.equal(r.status, 200);
  r = await t.call('GET', `/api/clients/${cid}/onboarding`);
  assert.ok(r.data.intakeAt);
  assert.equal(r.data.assets.length, 1);
  assert.equal(r.data.intake.gbp_access, true);
});

test('API: merge fills blanks and moves history', async () => {
  const t = setup();
  await owner(t);
  // Insert two near-duplicates that the add check allows (different phones, no site), then make them match by name and city.
  let a = (await t.call('POST', '/api/leads', { business: 'Bayside Roofing', phone: '954-555-0201', city: 'Davie', state: 'FL' })).data.lead;
  let b = (await t.call('POST', '/api/leads', { business: 'Bayside Roofing Co', phone: '954-555-0202', state: 'FL', email: 'owner@bayside.com' })).data.lead;
  await t.call('PATCH', `/api/leads/${b.id}`, { city: 'Davie' });
  await t.call('POST', `/api/leads/${b.id}/note`, { text: 'Talked to owner' });
  let r = await t.call('GET', '/api/leads/duplicates');
  assert.equal(r.data.groups.length, 1);
  r = await t.call('POST', '/api/leads/merge', { keep: a.id, remove: [b.id] });
  assert.equal(r.data.merged, 1);
  r = await t.call('GET', `/api/leads/${a.id}`);
  assert.equal(r.data.lead.email, 'owner@bayside.com');
  assert.ok(r.data.activities.some((x) => x.body === 'Talked to owner'));
  r = await t.call('GET', `/api/leads/${b.id}`);
  assert.equal(r.status, 404);
});

test('API: Google booking reports not ready without keys; settings save the script', async () => {
  const t = setup();
  let r = await t.call('GET', '/api/public/book');
  assert.equal(r.data.ready, false);
  r = await t.call('POST', '/api/public/book', { name: 'X', email: 'x@y.com', start: Date.now() + 864e5 });
  assert.equal(r.status, 503);
  await owner(t);
  r = await t.call('GET', '/api/google/status');
  assert.equal(r.data.ready, false);
  r = await t.call('GET', '/api/google/connect');
  assert.equal(r.status, 503);
  // A script saved for the old pitch is ignored, so everyone gets the new default.
  await t.env.DB.prepare("INSERT INTO settings (k, v) VALUES ('script', ?), ('objections', ?)").bind(JSON.stringify({ opener: 'old' }), JSON.stringify([['Old', 'old']])).run();
  r = await t.call('GET', '/api/settings');
  assert.equal(r.data.script, null);
  assert.equal(r.data.objections, null);
  r = await t.call('PUT', '/api/settings', { script: { c_open: 'Hi {first}, {rep} here.', opener: 'dropped' }, objections: [['Busy', 'Call back at {slot1}?']], research_radius: 3 });
  assert.equal(r.status, 200);
  r = await t.call('GET', '/api/settings');
  assert.equal(r.data.script.c_open, 'Hi {first}, {rep} here.');
  assert.equal(r.data.script.opener, undefined);
  assert.equal(r.data.objections[0][0], 'Busy');
  assert.equal(r.data.research_radius, 3);
  const lead = (await t.call('POST', '/api/leads', { business: 'Coastal', phone: '9545550300', state: 'FL' })).data.lead;
  r = await t.call('POST', `/api/leads/${lead.id}/meeting`, { start: new Date(Date.now() + 864e5).toISOString(), email: 'a@b.com' });
  assert.equal(r.status, 400);
});

test('API: Google connect redirects to consent and booking creates a Meet event', async () => {
  const t = setup({ GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'sec' });
  await owner(t);
  let r = await t.call('GET', '/api/google/connect');
  assert.equal(r.status, 302);
  const loc = new URL(r.res.headers.get('location'));
  assert.equal(loc.hostname, 'accounts.google.com');
  assert.equal(loc.searchParams.get('access_type'), 'offline');
  assert.match(loc.searchParams.get('scope'), /calendar\.events/);
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://hub.test/api/google/callback');
  // Simulate a stored connection and stub Google's APIs.
  await t.env.DB.prepare("UPDATE users SET google_token = ?, google_email = 'v@gmail.com'").bind(await seal(t.env, 'refresh-1')).run();
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    seen.push([u, init]);
    if (u.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { headers: { 'content-type': 'application/json' } });
    if (u.includes('/calendars/primary/events?conferenceDataVersion=1')) return new Response(JSON.stringify({ id: 'ev1', htmlLink: 'https://calendar.google.com/x', hangoutLink: 'https://meet.google.com/abc-defg-hij' }), { headers: { 'content-type': 'application/json' } });
    if (u.includes('/calendars/primary/events?')) return new Response(JSON.stringify({ items: [] }), { headers: { 'content-type': 'application/json' } });
    return realFetch(url, init);
  };
  try {
    const lead = (await t.call('POST', '/api/leads', { business: 'Coastal Roof Pros', phone: '9545550300', state: 'FL' })).data.lead;
    r = await t.call('POST', `/api/leads/${lead.id}/meeting`, { start: new Date(Date.now() + 864e5).toISOString(), minutes: 30, email: 'ana@coastal.com' });
    assert.equal(r.status, 200);
    assert.equal(r.data.meet, 'https://meet.google.com/abc-defg-hij');
    const ev = JSON.parse(seen.find(([u]) => u.includes('conferenceDataVersion=1'))[1].body);
    assert.equal(ev.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
    assert.equal(ev.attendees[0].email, 'ana@coastal.com');
    r = await t.call('GET', `/api/leads/${lead.id}`);
    assert.equal(r.data.lead.stage, 'audit_booked');
    assert.equal(r.data.lead.meet_link, 'https://meet.google.com/abc-defg-hij');
    assert.equal(r.data.lead.email, 'ana@coastal.com');
    // Public booking: slots come back and booking creates a lead.
    t.clearCookie();
    r = await t.call('GET', '/api/public/book');
    assert.equal(r.data.ready, true);
    assert.ok(r.data.slots.length > 10);
    r = await t.call('POST', '/api/public/book', { name: 'Maria Lopez', business: 'Orale Mexican', email: 'maria@orale.com', phone: '9545550999', city: 'Hollywood', state: 'FL', start: r.data.slots[0] });
    assert.equal(r.status, 200);
    assert.equal(r.data.meet, 'https://meet.google.com/abc-defg-hij');
  } finally { globalThis.fetch = realFetch; }
});
