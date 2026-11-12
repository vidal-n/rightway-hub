import test from 'node:test';
import assert from 'node:assert/strict';
import { testLeads } from '../public/js/testleads.js';

test('test power dial leads are pretend, never real numbers, and never use dashes', () => {
  const l = testLeads(Date.UTC(2026, 10, 12, 15));
  assert.equal(l.length, 3);
  for (const x of l) {
    assert.match(x.id, /^test-/);
    assert.match(x.phone, /555-01\d\d$/);
    assert.ok(x.test);
    assert.doesNotMatch(JSON.stringify(x), /[–—]/);
  }
  assert.ok(l.some((x) => x.test_outcome === 'no-answer'));
  assert.ok(l.some((x) => x.test_outcome === 'answer'));
});
