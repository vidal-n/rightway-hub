import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge, usable, lastLine, leftText } from '../public/js/resumestate.js';

test('resume record: new session, same session, expiry', () => {
  const t = Date.UTC(2026, 10, 12, 20, 0);
  let r = merge(null, { start: true, filter: { stage: 'new', junk: 'x', tz: '' }, label: 'Column: New lead' }, t);
  assert.deepEqual(r.filter, { stage: 'new' });
  assert.equal(r.calls, 0);
  assert.equal(usable(r, t), false);
  r = merge(r, { calls: 3, last: { id: 'ld_1', business: 'Shore Plumbing', at: t } }, t + 1000);
  assert.equal(usable(r, t + 2000), true);
  // Starting again within 12 hours keeps the count and the start time.
  r = merge(r, { start: true, running: true }, t + 3600e3);
  assert.equal(r.calls, 3);
  assert.equal(r.startedAt, t);
  // Starting after 12 hours is a fresh session.
  const r2 = merge(r, { start: true, running: true }, t + 14 * 3600e3);
  assert.equal(r2.calls, 0);
  assert.equal(usable(r2, t + 14 * 3600e3), false);
  // 48 hours later the offer is gone.
  assert.equal(usable(r, r.at + 49 * 3600e3), false);
  assert.equal(usable(null), false);
});

test('resume lines', () => {
  const t = Date.UTC(2026, 10, 12, 23, 42);
  assert.equal(lastLine({ last: { business: 'Shore Plumbing', at: t } }, t, 'America/New_York'), 'Shore Plumbing, 6:42 PM');
  assert.equal(lastLine({}), '');
  assert.equal(leftText(0), 'No one left in this list right now');
  assert.equal(leftText(41), '41 left to call in this list');
  assert.equal(leftText(null), '');
});
