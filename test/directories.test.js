import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRECTORIES, directoriesFor, tradeOf, citationScore, gapsVsRival, queryFor, byName, listingScore } from '../public/js/directories.js';

test('home services get 40 or more searchable directories', () => {
  const n = directoriesFor('Plumber', { kind: 'site' }).length;
  assert.ok(n >= 40, `got ${n}`);
  assert.ok(directoriesFor('Roofing contractor', { kind: 'site' }).length >= 40);
});
test('industry sets only apply to the right trade', () => {
  const home = directoriesFor('Plumber').map((d) => d.id);
  assert.ok(home.includes('angi') && home.includes('bestplumbers') && !home.includes('healthgrades') && !home.includes('avvo'));
  const dent = directoriesFor('Dentist').map((d) => d.id);
  assert.ok(dent.includes('healthgrades') && dent.includes('zocdoc') && !dent.includes('angi'));
  assert.ok(directoriesFor('Roofing').map((d) => d.id).every((id) => id !== 'bestplumbers'));
  assert.ok(directoriesFor('Something odd').length >= 25);
});
test('unique ids and names, valid tiers, every searchable one has a domain', () => {
  assert.equal(new Set(DIRECTORIES.map((d) => d.id)).size, DIRECTORIES.length);
  assert.equal(new Set(DIRECTORIES.map((d) => d.name)).size, DIRECTORIES.length);
  for (const d of DIRECTORIES) { assert.ok([1, 2, 3].includes(d.tier)); assert.ok(d.domain && !/\s/.test(d.domain)); }
});
test('hand checks never go to search and no dash characters are used', () => {
  assert.ok(directoriesFor('Plumber', { kind: 'hand' }).length >= 8);
  assert.ok(directoriesFor('Plumber', { kind: 'site' }).every((d) => d.check === 'site'));
  assert.ok(!/[–—]/.test(JSON.stringify(DIRECTORIES)));
});
test('trade detection', () => {
  assert.deepEqual(tradeOf('Plumber').sort(), ['home', 'plumbing']);
  assert.ok(tradeOf('Cosmetic dentist').includes('health'));
  assert.ok(tradeOf('Personal injury attorney').includes('legal'));
});
test('citation score weights tiers and clamps', () => {
  const ok = { status: 'match', phoneOk: true, zipOk: true };
  assert.equal(citationScore([]), null);
  assert.equal(citationScore([{ ...ok, tier: 1 }, { ...ok, tier: 3 }]), 100);
  assert.equal(citationScore([{ status: 'missing', tier: 1 }, { ...ok, tier: 3 }]), 25);
  assert.equal(citationScore([{ status: 'error', tier: 1 }, { ...ok, tier: 2 }, { check: 'hand', tier: 1 }]), 100);
  assert.equal(listingScore({ status: 'found' }), 0.8);
  assert.ok(Math.abs(listingScore({ status: 'mismatch', phoneBad: true }) - 0.7) < 1e-9);
  assert.ok(Math.abs(listingScore({ status: 'mismatch', phoneBad: true, zipBad: true }) - 0.6) < 1e-9);
});
test('rival gaps and the query', () => {
  assert.deepEqual(gapsVsRival([{ name: 'Yelp', status: 'missing' }, { name: 'BBB', status: 'missing' }], [{ name: 'Yelp', status: 'found' }, { name: 'BBB', status: 'missing' }]), ['Yelp']);
  assert.equal(queryFor(byName('yelp'), 'Acme Plumbing', 'Miami'), 'site:yelp.com/biz "Acme Plumbing" Miami');
});
