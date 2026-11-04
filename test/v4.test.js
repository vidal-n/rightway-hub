import test from 'node:test';
import assert from 'node:assert/strict';
import { dueFor, fillTemplate, DEFAULT_AUTOMATIONS, AUTOMATION_SETS, cleanAutomation, emailHtml } from '../src/automations.js';
import { scrubReason } from '../src/autoresearch.js';
import { compactScan, tierOf } from '../src/crm.js';
import { lineChart, barChart } from '../public/js/charts.js';

test('automations: the sets, confirmation right away, morning of, 3 hours, 10 minutes, once per appointment', () => {
  const t = Date.UTC(2026, 10, 4, 15);
  // A 2pm New York appointment two days out.
  const lead = { id: 'l1', meet_at: Date.UTC(2026, 10, 6, 19), stage: 'audit_booked', timezone: 'America/New_York' };
  const ids = (list, at, sent) => dueFor(list, lead, at, sent).map((a) => a.id).sort();
  assert.deepEqual(ids(DEFAULT_AUTOMATIONS, t), ['confirm_email']);
  assert.deepEqual(ids(AUTOMATION_SETS.both.list, t), ['confirm_email', 'confirm_text_short']);
  assert.deepEqual(ids(AUTOMATION_SETS.sms.list, t), ['confirm_text']);
  const sent = new Set(['confirm_email:' + lead.meet_at]);
  assert.deepEqual(ids(DEFAULT_AUTOMATIONS, t, sent), []);
  // 8:30am their time the morning of (13:30 UTC in November).
  assert.deepEqual(ids(DEFAULT_AUTOMATIONS, Date.UTC(2026, 10, 6, 13, 31), sent), ['morning_email']);
  assert.deepEqual(ids(DEFAULT_AUTOMATIONS, Date.UTC(2026, 10, 6, 13, 20), sent), [], 'not before 8:30');
  // A 10am meeting skips the morning message: the 3 hour reminder covers it.
  const early = { ...lead, meet_at: Date.UTC(2026, 10, 6, 15) };
  assert.ok(!dueFor(DEFAULT_AUTOMATIONS, early, Date.UTC(2026, 10, 6, 13, 31), sent).some((a) => a.trigger === 'morning'));
  assert.deepEqual(ids(DEFAULT_AUTOMATIONS, lead.meet_at - 179 * 60e3, sent), ['three_hour_email']);
  assert.deepEqual(ids(DEFAULT_AUTOMATIONS, lead.meet_at - 9 * 60e3, sent), ['ten_min_email']);
  assert.deepEqual(ids(AUTOMATION_SETS.both.list, lead.meet_at - 179 * 60e3, new Set()).filter((x) => /three/.test(x)), ['three_hour_email', 'three_hour_text_short']);
  // Booked 30 minutes out: only the confirmation and the 10 minute link, nothing stale.
  const late = { id: 'l2', meet_at: t + 30 * 60e3, timezone: 'America/New_York' };
  assert.deepEqual(dueFor(DEFAULT_AUTOMATIONS, late, t).map((a) => a.id), ['confirm_email']);
  const ctx = { lead: { contact_name: 'Mike Diaz', business: 'Sunrise', meet_link: 'https://meet.google.com/x', timezone: 'America/New_York' }, start: lead.meet_at, rep: 'Vidal, RightWay Growth', repFirst: 'Vidal' };
  assert.match(fillTemplate('Hi {first}, {business} on {date} at {time}. {link}', ctx), /Hi Mike, Sunrise on Friday, November 6 at 2:00 PM Eastern\. Join here: https:\/\/meet/);
  assert.match(fillTemplate(DEFAULT_AUTOMATIONS[0].body, ctx), /It's Vidal from RightWay Growth[\s\S]*\nhttps:\/\/meet\.google\.com\/x\n/);
  assert.match(fillTemplate(AUTOMATION_SETS.sms.list[3].body, ctx), /here's the Google Meet, super excited to chat with you\. https:\/\/meet/);
  assert.match(fillTemplate('{meet_or_call}', { lead: {} }), /call you/);
  assert.ok(!/[–—]/.test(JSON.stringify(AUTOMATION_SETS)), 'no dashes');
  assert.throws(() => cleanAutomation({ name: 'X', channel: 'email', body: 'hi' }), /subject/);
  assert.equal(cleanAutomation({ name: 'X', channel: 'sms', trigger: 'booked', body: 'hi', offset: 99 }).offset, 0);
  assert.equal(cleanAutomation({ name: 'X', channel: 'sms', trigger: 'morning', body: 'hi', offset: 9999 }).offset, 720);
  assert.equal(cleanAutomation({ ...AUTOMATION_SETS.both.list[2] }).fallback, true);
  // The Meet link line becomes a Join button.
  assert.match(emailHtml('Hi\nhttps://meet.google.com/abc-defg-hij\nbye https://x.test/b'), /Join the Google Meet<\/a>[\s\S]*<a href="https:\/\/x\.test\/b"/);
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
