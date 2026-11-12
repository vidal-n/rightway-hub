import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanAvail, outsideHours, overLimit, tooClose, availText, wall } from '../public/js/avail.js';

const week = { tz: 'America/New_York', max: 3, gap: 15, days: { 1: [[540, 1020]], 2: [[540, 1020]], 3: [[540, 720], [780, 1020]] } };
const et = (iso) => Date.parse(`${iso}-05:00`);          // November: Eastern is UTC-5

test('no hours saved means nothing is blocked', () => {
  assert.equal(outsideHours(null, Date.now()), null);
  assert.equal(outsideHours(cleanAvail({ days: {} }), Date.now()), null);
});

test('a call inside the open hours is fine, outside is explained in plain words', () => {
  const av = cleanAvail(week);
  assert.equal(outsideHours(av, et('2026-11-09T12:45:00')), null);               // Monday 12:45 pm
  assert.match(outsideHours(av, et('2026-11-09T08:00:00')), /Monday they take calls 9 AM to 5 PM/);
  assert.match(outsideHours(av, et('2026-11-14T10:00:00')), /Saturday is not one of their days/);
  assert.match(outsideHours(av, et('2026-11-09T16:45:00'), 30), /Monday/);        // runs past 5
  assert.equal(outsideHours(av, et('2026-11-09T16:30:00'), 30), null);            // ends exactly at 5
});

test('a lunch break splits the day', () => {
  const av = cleanAvail(week);
  assert.match(outsideHours(av, et('2026-11-11T12:15:00')), /Wednesday/);
  assert.equal(outsideHours(av, et('2026-11-11T13:30:00')), null);
});

test('hours are checked on their own clock, not the booker\'s', () => {
  const west = cleanAvail({ ...week, tz: 'America/Los_Angeles' });
  // 12:45 pm Eastern is 9:45 am Pacific: inside 9 to 5 Pacific
  assert.equal(outsideHours(west, et('2026-11-09T12:45:00')), null);
  // 11:45 am Eastern is 8:45 am Pacific: too early for them
  assert.match(outsideHours(west, et('2026-11-09T11:45:00')), /9 AM to 5 PM/);
});

test('daily limit and the gap between calls', () => {
  const av = cleanAvail(week);
  const day = [et('2026-11-09T10:00:00'), et('2026-11-09T11:00:00'), et('2026-11-09T14:00:00')];
  assert.match(overLimit(av, et('2026-11-09T15:00:00'), day), /limit 3/);
  assert.equal(overLimit(av, et('2026-11-10T15:00:00'), day), null);              // other day
  assert.match(tooClose(av, et('2026-11-09T10:35:00'), 30, [et('2026-11-09T10:00:00')]), /15 minutes/);
  assert.equal(tooClose(av, et('2026-11-09T10:45:00'), 30, [et('2026-11-09T10:00:00')]), null);
});

test('saved hours are cleaned and summarised', () => {
  const bad = cleanAvail({ tz: 'Nope/Zone', max: 999, gap: -4, days: { 1: [[600, 500], [540, 1020]], 9: [[0, 60]] } });
  assert.equal(bad.tz, 'America/New_York');
  assert.equal(bad.max, 30);
  assert.equal(bad.gap, 0);
  assert.deepEqual(bad.days, { 1: [[540, 1020]] });
  assert.equal(availText(null), 'No hours set. Any time can be booked.');
  assert.match(availText(cleanAvail(week)), /Mon 9 AM to 5 PM · Tue .* up to 3 a day · 15 min between calls/);
  assert.equal(wall(et('2026-11-09T09:00:00'), 'America/New_York').dow, 1);
});
