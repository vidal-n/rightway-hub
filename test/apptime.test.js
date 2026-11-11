import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedToUtc, fromInputs, inputsIn, clockIn, bothTimes, validZone } from '../public/js/apptime.js';

test('12:45 typed in Eastern is the same moment everywhere, and shows the right time in each zone', () => {
  const t = fromInputs('2026-11-11', '12:45', 'America/New_York');
  assert.equal(new Date(t).toISOString(), '2026-11-11T17:45:00.000Z');
  assert.equal(inputsIn(t, 'America/Los_Angeles').time, '09:45');
  assert.equal(inputsIn(t, 'America/New_York').time, '12:45');
  assert.match(clockIn(t, 'America/New_York'), /12:45 PM EST/);
  assert.match(bothTimes(t, 'America/Los_Angeles', 'America/New_York'), /12:45 PM EST \(your time\) · .*9:45 AM PST \(their time\)/);
});

test('the lead zone is used when the rep books in it, so their 9:45 am is 9:45 am', () => {
  const t = fromInputs('2026-11-11', '09:45', 'America/Los_Angeles');
  assert.equal(new Date(t).toISOString(), '2026-11-11T17:45:00.000Z');
});

test('daylight saving: the same wall clock time after the clocks change', () => {
  // Pacific is UTC-7 in March after DST starts, UTC-8 in November.
  assert.equal(new Date(fromInputs('2026-03-20', '10:00', 'America/Los_Angeles')).toISOString(), '2026-03-20T17:00:00.000Z');
  assert.equal(new Date(fromInputs('2026-11-20', '10:00', 'America/Los_Angeles')).toISOString(), '2026-11-20T18:00:00.000Z');
});

test('Hawaii and no-DST Arizona are fixed offsets, not guesses', () => {
  assert.equal(new Date(fromInputs('2026-11-11', '12:45', 'Pacific/Honolulu')).toISOString(), '2026-11-11T22:45:00.000Z');
  assert.equal(new Date(fromInputs('2026-11-11', '12:45', 'America/Phoenix')).toISOString(), '2026-11-11T19:45:00.000Z');
});

test('a time that does not exist or is not a time is refused', () => {
  assert.equal(fromInputs('2026-03-08', '02:30', 'America/New_York'), null); // clocks jump 2 to 3 am
  assert.equal(fromInputs('2026-13-01', '10:00', 'America/New_York'), null);
  assert.equal(fromInputs('2026-11-11', '25:00', 'America/New_York'), null);
  assert.equal(fromInputs('', '10:00', 'America/New_York'), null);
  assert.equal(validZone('Mars/Olympus'), null);
  assert.equal(validZone('America/Chicago'), 'America/Chicago');
});

test('zonedToUtc agrees with a known fixed zone', () => {
  assert.equal(zonedToUtc(2026, 11, 11, 0, 0, 'Etc/UTC'), Date.UTC(2026, 10, 11));
});
