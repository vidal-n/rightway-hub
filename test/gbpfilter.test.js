import test from 'node:test';
import assert from 'node:assert/strict';
import { filterLeads, gbpState, likelyOwner } from '../public/js/leadfilter.js';

const L = (o) => ({ id: o.id || 'x', business: 'Joe Plumbing', phone: '(305) 555-0101', stage: 'new', ...o });

test('gbpState: facts from Google mean yes, a research check with nothing means none, else unknown', () => {
  assert.equal(gbpState(L({ has_place: 1 })), 'yes');
  assert.equal(gbpState(L({ reviews: 12 })), 'yes');
  assert.equal(gbpState(L({ map_rank: 7 })), 'yes');
  assert.equal(gbpState(L({ researched: true })), 'none');
  assert.equal(gbpState(L({})), 'unknown');
});

test('likelyOwner drops big brands, institutions, toll free and huge review counts', () => {
  assert.equal(likelyOwner(L({})), true);
  assert.equal(likelyOwner(L({ business: 'Roto-Rooter Plumbing of Miami' })), false);
  assert.equal(likelyOwner(L({ business: 'Broward Health Medical Center' })), false);
  assert.equal(likelyOwner(L({ phone: '(800) 555-0100' })), false);
  assert.equal(likelyOwner(L({ reviews: 900 })), false);
  assert.equal(likelyOwner(L({ business: 'Targeted Pest Control' })), true);
});

test('filterLeads gbp and small filters', () => {
  const rows = [L({ id: 'a', has_place: 1 }), L({ id: 'b', researched: true }), L({ id: 'c' }), L({ id: 'd', business: 'Home Depot', researched: true })];
  assert.deepEqual(filterLeads(rows, { f: { gbp: 'none' } }).map((l) => l.id), ['b', 'd']);
  assert.deepEqual(filterLeads(rows, { f: { gbp: 'none', small: true } }).map((l) => l.id), ['b']);
  assert.deepEqual(filterLeads(rows, { f: { gbp: 'unknown' } }).map((l) => l.id), ['c']);
});
