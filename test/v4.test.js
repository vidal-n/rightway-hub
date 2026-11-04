import test from 'node:test';
import assert from 'node:assert/strict';
import { dueFor, fillTemplate, DEFAULT_AUTOMATIONS, cleanAutomation } from '../src/automations.js';
import { scrubReason } from '../src/autoresearch.js';
import { compactScan, tierOf } from '../src/crm.js';
import { lineChart, barChart } from '../public/js/charts.js';

test('automations: confirmation right away, reminders inside their window, once per appointment', () => {
  const t = Date.UTC(2026, 10, 4, 15);
  const lead = { id: 'l1', meet_at: t + 2 * 864e5, stage: 'audit_booked' };
  let due = dueFor(DEFAULT_AUTOMATIONS, lead, t).map((a) => a.id);
  assert.deepEqual(due.sort(), ['confirm_email', 'confirm_text']);
  due = dueFor(DEFAULT_AUTOMATIONS, lead, t, new Set(['confirm_email:' + lead.meet_at, 'confirm_text:' + lead.meet_at])).map((a) => a.id);
  assert.deepEqual(due, []);
  due = dueFor(DEFAULT_AUTOMATIONS, lead, lead.meet_at - 1440 * 60e3 + 60e3, new Set(['confirm_email:' + lead.meet_at, 'confirm_text:' + lead.meet_at])).map((a) => a.id);
  assert.deepEqual(due, ['remind_day']);
  due = dueFor(DEFAULT_AUTOMATIONS, lead, lead.meet_at - 50 * 60e3, new Set(['confirm_email:' + lead.meet_at, 'confirm_text:' + lead.meet_at, 'remind_day:' + lead.meet_at])).map((a) => a.id);
  assert.deepEqual(due, ['remind_hour']);
  // Booked 30 minutes out: the day before reminder is stale and never sends.
  const late = { id: 'l2', meet_at: t + 30 * 60e3 };
  assert.ok(!dueFor(DEFAULT_AUTOMATIONS, late, t).some((a) => a.id === 'remind_day'));
  const msg = fillTemplate('Hi {first}, {business} on {date} at {time}. {link}', { lead: { contact_name: 'Mike Diaz', business: 'Sunrise', meet_link: 'https://meet.google.com/x', timezone: 'America/New_York' }, start: lead.meet_at });
  assert.match(msg, /Hi Mike, Sunrise on Friday, November 6 at 10:00 AM Eastern\. Join here: https:\/\/meet/);
  assert.throws(() => cleanAutomation({ name: 'X', channel: 'email', body: 'hi' }), /subject/);
  assert.equal(cleanAutomation({ name: 'X', channel: 'sms', trigger: 'booked', body: 'hi', offset: 99 }).offset, 0);
});

test('scrub, tiers, deep scan compaction and charts', () => {
  assert.match(scrubReason({ phone_digits: '8005551234' }), /Toll free/);
  assert.equal(scrubReason({ phone_digits: '9545550201' }), null);
  assert.match(scrubReason({ phone_digits: '95455' }), /No valid/);
  assert.match(scrubReason({ phone_digits: '9545550201' }, { listing: { status: 'CLOSED_PERMANENTLY' } }), /Closed/);
  assert.equal(tierOf({ stage: 'callback' }), 'hot');
  assert.equal(tierOf({ stage: 'new' }), 'fresh');
  assert.equal(tierOf({ stage: 'new', intel_at: 1, grade: 'B' }), 'good');
  const sc = compactScan({ keyword: 'plumber', size: 3, radius: 2, points: Array.from({ length: 9 }, (_, i) => ({ rank: i < 3 ? 2 : i < 6 ? 8 : null, top: [{ title: 'A', rank: 1 }], status: 'done' })) });
  assert.equal(sc.top3, 3); assert.equal(sc.top10, 6); assert.equal(sc.cells[4].row, 1); assert.equal(sc.center, 8);
  assert.match(lineChart(['a', 'b'], [{ name: 'Dials', color: '#000', values: [1, 4] }]), /<polyline/);
  assert.match(barChart(['a'], [{ name: 'X', color: '#000', values: [3] }]), /<rect/);
});
