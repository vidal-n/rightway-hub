import test from 'node:test';
import assert from 'node:assert/strict';
import { testLeads, testIntel, testTextReply } from '../public/js/testleads.js';

test('test power dial leads are pretend, never real numbers, and never use dashes', () => {
  const l = testLeads(Date.UTC(2026, 10, 12, 15));
  assert.equal(l.length, 7);
  for (const x of l) {
    assert.match(x.id, /^test-/);
    assert.match(x.phone, /555-01\d\d$/);
    assert.ok(x.test);
    assert.doesNotMatch(JSON.stringify(x), /[–—]/);
  }
  assert.ok(l.some((x) => x.test_outcome === 'no-answer'));
  assert.ok(l.some((x) => x.test_outcome === 'answer'));
});

test('the pretend dialer covers answers, rings out, voicemail, a gatekeeper, and has made up research and text replies', () => {
  const l = testLeads();
  assert.ok(l.some((x) => x.test_outcome === 'voicemail'));
  assert.ok(l.some((x) => x.persona === 'gatekeeper'));
  const i = testIntel(l[0]);
  assert.equal(i.test, true); assert.equal(i.cost, 0); assert.equal(i.grid.cells.length, 9);
  assert.doesNotMatch(JSON.stringify(i), /[–—]/);
  assert.match(testTextReply(l[0], 'Does 12pm or 4pm work?'), /works|Talk then/);
  assert.equal(testTextReply(l[0], 'STOP'), '');
});
