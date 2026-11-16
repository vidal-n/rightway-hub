import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYS, BUDGETS, planFor, weakness, readFilters, readIndustries, cleanMine, southFloridaAreas, TOOLS } from '../public/js/plays.js';
import { TARGET_INDUSTRIES } from '../public/js/leadintel.js';
import { cleanFilters, MAX_REQUESTS, MAX_OSM_REQUESTS } from '../public/js/finder.js';

const known = new Set(TARGET_INDUSTRIES.map((x) => x.keyword));

test('every play uses known industries, valid filters and a source', () => {
  assert.ok(PLAYS.length >= 8);
  for (const p of PLAYS) {
    assert.ok(p.industries.length > 0 && p.industries.length <= 10, p.id);
    for (const k of p.industries) assert.ok(known.has(k), `${p.id}: unknown industry ${k}`);
    assert.deepEqual(cleanFilters(p.filters), cleanFilters(cleanFilters(p.filters)));
    assert.ok(['google', 'osm'].includes(p.source));
    assert.ok(p.who && p.why && p.expect && p.open, `${p.id} needs its guide text`);
    for (const r of p.refs) assert.ok(TOOLS.some((t) => t.name === r), `${p.id}: unknown reference ${r}`);
  }
});

test('no dashes in play copy', () => {
  const text = JSON.stringify(PLAYS) + JSON.stringify(TOOLS);
  assert.ok(!/[–—]/.test(text));
});

test('budgets grow and every play fits one job at every level', () => {
  for (const p of PLAYS) {
    const costs = BUDGETS.map((b) => planFor(p, b.id));
    for (let i = 1; i < costs.length; i++) assert.ok(costs[i].requests >= costs[i - 1].requests);
    for (const c of costs) {
      // Jobs are chunked by the page, so a play needs to fit when split into areas of up to 12 per job.
      const per = c.requests / c.places;
      assert.ok(per <= (p.source === 'osm' ? MAX_OSM_REQUESTS : MAX_REQUESTS), `${p.id} one area too big`);
    }
  }
  assert.equal(planFor(PLAYS.find((p) => p.source === 'osm'), 'standard').cost, 0);
  assert.ok(planFor(PLAYS[0], 'lean').cost > 0);
});

test('weakness ranks the weakest profile highest', () => {
  const weak = weakness({ website: '', claimed: false, reviews: 3, rating: 3.5, photos: 2 });
  const strong = weakness({ website: 'https://x.com', claimed: true, reviews: 300, rating: 4.8, photos: 90 });
  assert.ok(weak.score > strong.score);
  assert.ok(weak.why.includes('no website'));
  assert.equal(strong.score, 0);
  assert.ok(weakness({ website: '', source: 'osm' }).score === 30);
});

test('guide lines explain filters and trades', () => {
  assert.match(readFilters({ website: 'none' }).join(' '), /No website/);
  assert.match(readFilters({}, 'osm').join(' '), /OpenStreetMap/);
  assert.match(readFilters({ minReviews: 15, maxReviews: 100 }).join(' '), /established/);
  assert.match(readIndustries(['roofing contractor', 'plumber']).join(' '), /High ticket/);
  assert.match(readIndustries([]).join(' '), /Pick the trades/);
});

test('my plays are cleaned and south florida comes first', () => {
  const m = cleanMine({ name: '  Roofers ', industries: ['plumber'], areas: ['Miami, FL'], size: 4, source: 'x' });
  assert.equal(m.name, 'Roofers'); assert.equal(m.source, 'google'); assert.equal(m.size, 5); assert.equal(m.mine, true);
  assert.deepEqual(southFloridaAreas(2), ['Miami, FL', 'Fort Lauderdale, FL']);
});

test('plays can run in any time zone or all states', async () => {
  const { SCOPES, areasFor, PER_STATE } = await import('../public/js/plays.js');
  const { CITIES } = await import('../public/js/cities.js');
  const { allZoneStates, zoneStates } = await import('../public/js/timezone.js');
  assert.deepEqual(SCOPES.map((s) => s.id), ['home', 'ET', 'CT', 'MT', 'AZ', 'PT', 'AK', 'HI', 'ALL']);
  const p = PLAYS.find((x) => x.id === 'storm');
  // Home keeps working exactly as before.
  assert.equal(planFor(p, 'standard').places, 5);
  assert.deepEqual(planFor(p, 'standard', { scope: 'home' }).areas, southFloridaAreas(5));
  // A zone is each of its states' biggest cities, a few per state by budget.
  for (const z of ['ET', 'CT', 'MT', 'AZ', 'PT', 'AK', 'HI']) {
    for (const b of BUDGETS) {
      const pl = planFor(p, b.id, { scope: z });
      assert.equal(pl.places, zoneStates(z).reduce((t, st) => t + Math.min(PER_STATE[b.id], (CITIES[st] || []).length), 0), `${z} ${b.id}`);
      for (const a of pl.areas) assert.ok(zoneStates(z).includes(a.split(', ').pop()), `${a} is not in ${z}`);
    }
  }
  const all = planFor(p, 'lean', { scope: 'ALL' });
  assert.equal(all.places, allZoneStates().reduce((t, st) => t + Math.min(1, (CITIES[st] || []).length), 0));
  assert.ok(all.cost > 0 && all.requests > 0);
  assert.ok(areasFor('MT', 'lean').includes('Denver, CO'));
  assert.ok(areasFor('HI', 'lean').includes('Honolulu, HI'));
  // Every budget still fits one search per area.
  for (const pl of PLAYS) for (const b of BUDGETS) assert.ok(planFor(pl, b.id, { scope: 'ALL' }).requests / planFor(pl, b.id, { scope: 'ALL' }).places <= (pl.source === 'osm' ? MAX_OSM_REQUESTS : MAX_REQUESTS));
});

test('plays take several places at once', async () => {
  const { areasFor, scopeList, PER_STATE } = await import('../public/js/plays.js');
  const { CITIES } = await import('../public/js/cities.js');
  const { zoneStates } = await import('../public/js/timezone.js');
  const p = PLAYS.find((x) => x.id === 'storm');
  assert.deepEqual(scopeList(['ET', 'PT', 'ET', 'bogus']), ['ET', 'PT']);
  assert.deepEqual(scopeList([]), ['home']);
  assert.deepEqual(scopeList(['MT', 'ALL']), ['ALL']);
  assert.deepEqual(scopeList('CT'), ['CT']);
  // Two zones are the union of each, with no repeats, and cost the sum of the parts.
  const a = planFor(p, 'standard', { scope: ['MT', 'PT'] });
  const mt = planFor(p, 'standard', { scope: 'MT' }), pt = planFor(p, 'standard', { scope: 'PT' });
  assert.equal(a.places, mt.places + pt.places);
  assert.equal(a.requests, mt.requests + pt.requests);
  assert.equal(new Set(a.areas).size, a.areas.length);
  // Home plus a zone: South Florida's own cities, then the zone.
  const h = planFor(p, 'lean', { scope: ['home', 'MT'] });
  assert.deepEqual(h.areas.slice(0, 3), southFloridaAreas(3));
  assert.ok(h.areas.includes('Denver, CO'));
  assert.equal(h.places, 3 + planFor(p, 'lean', { scope: 'MT' }).places);
  // Florida is Eastern, so Home plus Eastern repeats Miami once, not twice.
  const e = areasFor(['home', 'ET'], 'standard');
  assert.equal(new Set(e).size, e.length);
  assert.equal(e.filter((x) => x === 'Miami, FL').length, 1);
  // A single id and a one item list give the same plan.
  assert.deepEqual(planFor(p, 'deep', { scope: 'AZ' }).areas, planFor(p, 'deep', { scope: ['AZ'] }).areas);
  assert.equal(planFor(p, 'deep', { scope: ['AZ'] }).scope, 'AZ');
  assert.equal(zoneStates('AZ').reduce((t, st) => t + Math.min(PER_STATE.deep, (CITIES[st] || []).length), 0), planFor(p, 'deep', { scope: ['AZ'] }).places);
});

test('the new plays are there and the new niche templates match their trades', async () => {
  for (const id of ['storm', 'recurring', 'projects', 'shops']) assert.ok(PLAYS.some((p) => p.id === id), id);
  const { nicheOf } = await import('../public/js/niches.js');
  const cases = { 'roofing contractor': 'roof', electrician: 'electric', 'house painter': 'paint', 'junk removal': 'junk', 'carpet cleaning': 'carpet', 'pest control': 'pest', 'concrete contractor': 'concrete', 'paver installation': 'concrete', 'paver sealing': 'pressure', 'epoxy flooring': 'floor', 'kitchen remodeling': 'remodel', 'impact windows': 'windows', 'septic service': 'septic', 'tree service': 'tree' };
  for (const [industry, id] of Object.entries(cases)) assert.equal(nicheOf({ industry })?.id, id, industry);
  assert.equal(nicheOf({ business: 'Main Street Plumbing' })?.id, 'plumb');
});
