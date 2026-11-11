import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CITIES, citiesFor, expandAreas, isStateLine, chunkAreas, DEFAULT_TOP } from '../public/js/cities.js';
import { STATES } from '../public/js/registries.js';

test('every state and DC has its cities, with no duplicates or empty names', () => {
  for (const [code] of STATES) {
    const list = CITIES[code];
    assert.ok(Array.isArray(list) && list.length >= (code === 'DC' ? 1 : 10), `${code} has its cities`);
    assert.equal(new Set(list).size, list.length, `${code} has no repeats`);
    assert.ok(list.every((c) => c && c.trim() === c), `${code} names are clean`);
  }
  assert.equal(Object.keys(CITIES).length, 51);
});

test('a state expands to its top cities as "City, ST" lines', () => {
  assert.deepEqual(citiesFor('FL', 3), ['Jacksonville, FL', 'Miami, FL', 'Tampa, FL']);
  assert.deepEqual(citiesFor('florida', 2), ['Jacksonville, FL', 'Miami, FL']);
  assert.equal(citiesFor('FL').length, DEFAULT_TOP);
  assert.deepEqual(citiesFor('ZZ'), []);
});

test('state-only lines expand, city lines and ZIPs stay, duplicates are dropped', () => {
  assert.equal(isStateLine('FL'), true); assert.equal(isStateLine('georgia'), true); assert.equal(isStateLine('Miami, FL'), false);
  assert.equal(isStateLine('33139'), false); assert.equal(isStateLine('Miami'), false);
  const out = expandAreas('FL\nMiami, FL\nGeorgia\n33139\nfl', 2);
  assert.deepEqual(out, ['Jacksonville, FL', 'Miami, FL', 'Atlanta, GA', 'Columbus, GA', '33139']);
  assert.deepEqual(expandAreas(''), []);
});

test('long lists split into jobs that each fit the cap', () => {
  const list = Array.from({ length: 30 }, (_, i) => `City ${i}, FL`);
  const chunks = chunkAreas(list, 12);
  assert.deepEqual(chunks.map((c) => c.length), [12, 12, 6]);
  assert.equal(chunks.flat().length, 30);
  assert.deepEqual(chunkAreas(['a'], 0), [['a']]);
});

import { geocode } from '../src/leadfinder.js';
test('a city the map places in another state is skipped; demo places take the state asked for', async () => {
  const demo = await geocode({ DATAFORSEO_LOGIN: '', DATAFORSEO_PASSWORD: '' }, 'Atlanta, GA');
  assert.equal(demo.state, 'GA');
});
