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
