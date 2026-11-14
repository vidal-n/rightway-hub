import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAny, packHours, unpackHours, hoursText, openAt, fromDataForSeo, fromOsm, fromSchema, hoursFromPage, nowText, statusFromDataForSeo } from '../public/js/hours.js';
import { canCallNow, callBlock, stateWindow, federalHoliday, stateRuleText } from '../public/js/timezone.js';
import { nicheOf, saturdayOk, NICHES } from '../public/js/niches.js';
import { filterLeads, hoursMatch } from '../public/js/leadfilter.js';
import { liveLead } from '../public/js/leadlive.js';
import { passes, leadRow } from '../public/js/finder.js';
import { TARGET_INDUSTRIES } from '../public/js/leadintel.js';

const ET = 'America/New_York';
// Saturday Nov 14 2026 10am Eastern = 15:00 UTC.
const SAT_10AM_ET = Date.parse('2026-11-14T15:00:00Z');
const SUN_11AM_CT = Date.parse('2026-11-15T17:00:00Z');

test('hours: the common ways people write hours all read the same week', () => {
  const want = 'Mon to Fri 8am to 5pm, Sat 9am to 1pm, Sun closed';
  for (const t of ['Monday - Friday: 8:00 AM - 5:00 PM, Saturday: 9:00 AM - 1:00 PM, Sunday: Closed', 'Mon-Fri 8am-5pm, Sat 9am-1pm, Sun closed',
    'Mo-Fr 08:00-17:00; Sa 09:00-13:00; Su off', 'Weekdays 8 - 5, Saturday 9am-1pm']) assert.equal(hoursText(parseAny(t)), want, t);
  assert.equal(hoursText(parseAny('Open 24 hours')), 'Open 24 hours');
  assert.equal(hoursText(parseAny('24/7')), 'Open 24 hours');
  assert.equal(hoursText(parseAny('Monday: 8 AM–5 PM | Saturday: Closed')), 'Mon 8am to 5pm, Tue to Sun closed');
  // Outscraper working_hours as JSON or "Day,hours|Day,hours".
  assert.equal(hoursText(parseAny('{"Monday": "8AM-5PM", "Tuesday": "8AM-5PM", "Saturday": "Closed"}')), 'Mon to Tue 8am to 5pm, Wed to Sun closed');
  assert.equal(hoursText(parseAny('Monday,8AM-5PM|Saturday,9AM-1PM')), 'Mon 8am to 5pm, Tue to Fri closed, Sat 9am to 1pm, Sun closed');
});

test('hours: overnight hours split at midnight and packing round trips', () => {
  const w = parseAny('Fri-Sat 6pm-2am');
  assert.deepEqual(w[5], [[1080, 1440]]);
  assert.deepEqual(w[6], [[0, 120], [1080, 1440]]);
  assert.deepEqual(w[7], [[0, 120]]);
  assert.deepEqual(unpackHours(packHours(w)), w);
  assert.equal(packHours(null), '');
});

test('hours: DataForSEO timetable, closed status, schema and page text', () => {
  const wh = { timetable: { monday: [{ open: { hour: 8, minute: 30 }, close: { hour: 17, minute: 0 } }], saturday: [{ open: { hour: 9, minute: 0 }, close: { hour: 12, minute: 0 } }], sunday: null }, current_status: 'closed_forever' };
  assert.equal(hoursText(fromDataForSeo(wh)), 'Mon 8:30am to 5pm, Tue to Fri closed, Sat 9am to noon, Sun closed');
  assert.equal(statusFromDataForSeo(wh), 'closed_forever');
  assert.equal(statusFromDataForSeo({ current_status: 'opened' }), '');
  const html = '<script type="application/ld+json">{"@type":"Plumber","openingHoursSpecification":[{"dayOfWeek":["Monday","Friday"],"opens":"07:00","closes":"16:00"}]}</script>';
  assert.equal(hoursText(fromSchema(html)), 'Mon 7am to 4pm, Tue to Thu closed, Fri 7am to 4pm, Sat to Sun closed');
  const page = hoursFromPage('<p>Free estimates $99-150. Call 305-555-1234.</p><h3>Hours of operation</h3><p>Monday to Friday 7am - 6pm<br>Saturday 8am - 2pm</p>');
  assert.equal(page.how, 'text');
  assert.equal(hoursText(page.week), 'Mon to Fri 7am to 6pm, Sat 8am to 2pm, Sun closed');
  assert.equal(hoursFromPage('<p>Prices from $99 to $150</p>').week, null);
  assert.equal(fromOsm('PH off'), null);
});

test('hours: open now in the lead\'s own time zone', () => {
  const w = parseAny('Mon-Fri 8am-5pm, Sat 9am-1pm');
  assert.equal(openAt(w, ET, SAT_10AM_ET), true);
  assert.equal(openAt(w, 'America/Los_Angeles', SAT_10AM_ET), false); // 7am Pacific
  assert.equal(openAt(w, null, SAT_10AM_ET), null);
  assert.equal(openAt(null, ET, SAT_10AM_ET), null);
  assert.equal(nowText(w, ET, SAT_10AM_ET), 'Open until 1pm');
  assert.equal(nowText(w, 'America/Los_Angeles', SAT_10AM_ET), 'Opens 9am');
});

test('calling rules by state: Sunday bans, Texas noon, Rhode Island Saturday, Kentucky 10am, holidays, Mississippi on Central time', () => {
  // Saturday 10am Eastern: fine in Florida, fine in Rhode Island (10 to 5), but 9am in Chicago is too early for Texas (9am start is OK) and Kentucky ET.
  assert.equal(canCallNow(ET, null, SAT_10AM_ET, 'FL'), true);
  assert.equal(canCallNow(ET, null, SAT_10AM_ET, 'RI'), true);
  assert.equal(canCallNow(ET, null, Date.parse('2026-11-14T14:30:00Z'), 'RI'), false); // 9:30am Saturday
  assert.equal(canCallNow(ET, null, Date.parse('2026-11-14T22:30:00Z'), 'RI'), false); // 5:30pm Saturday
  assert.equal(canCallNow(ET, null, Date.parse('2026-11-16T14:30:00Z'), 'KY'), false); // 9:30am Monday
  assert.equal(canCallNow(ET, null, Date.parse('2026-11-16T15:30:00Z'), 'KY'), true);
  // Sunday 11am Central.
  assert.equal(canCallNow('America/Chicago', null, SUN_11AM_CT, 'TX'), false);
  assert.equal(canCallNow('America/Chicago', null, Date.parse('2026-11-15T18:30:00Z'), 'TX'), true); // 12:30pm
  assert.equal(canCallNow('America/Chicago', null, SUN_11AM_CT, 'LA'), false);
  assert.equal(canCallNow('America/Chicago', null, SUN_11AM_CT, 'IL'), true);
  assert.match(callBlock('America/Chicago', null, SUN_11AM_CT, 'AL'), /Sunday/);
  // Pennsylvania ends at 7pm and skips Thanksgiving (Nov 26 2026).
  assert.equal(canCallNow(ET, null, Date.parse('2026-11-16T00:30:00Z'), 'PA'), false); // Sunday 7:30pm anyway
  assert.equal(canCallNow(ET, null, Date.parse('2026-11-17T00:30:00Z'), 'PA'), false); // Monday 7:30pm
  assert.equal(canCallNow(ET, null, Date.parse('2026-11-17T00:30:00Z'), 'NY'), true);
  assert.equal(federalHoliday(2026, 11, 26), 'Thanksgiving');
  assert.equal(federalHoliday(2026, 5, 25), 'Memorial Day');
  assert.equal(federalHoliday(2026, 7, 3), 'Independence Day (observed)');
  assert.equal(canCallNow(ET, null, Date.parse('2026-11-26T16:00:00Z'), 'PA'), false);
  assert.equal(canCallNow(ET, null, Date.parse('2026-11-26T16:00:00Z'), 'FL'), true);
  // Mississippi uses Central time even when a lead's zone says Eastern.
  assert.equal(canCallNow(ET, null, Date.parse('2026-11-16T13:30:00Z'), 'MS'), false); // 8:30am ET is 7:30am CT
  assert.deepEqual(stateWindow('RI', 6), [10, 17]);
  assert.equal(stateWindow('UT', 7), null);
  assert.equal(stateRuleText('TX'), '9am to 8pm, Sunday from noon');
  assert.equal(stateRuleText('FL'), '8am to 8pm their time, every day');
});

test('niches and the Saturday list', () => {
  assert.equal(nicheOf({ industry: 'pool screen repair' }).id, 'screen');
  assert.equal(nicheOf({ category: 'Garage door supplier' }).id, 'garage');
  assert.equal(nicheOf({ industry: 'dentist' }), null);
  for (const n of NICHES) for (const k of n.industries) assert.ok(TARGET_INDUSTRIES.some((t) => t.keyword === k), `${n.id}: ${k}`);
  assert.ok(!/[–—]/.test(JSON.stringify(NICHES.map(({ match, ...n }) => n))));
  // Saturday: hours win; no hours means the trade decides; salons and offices never.
  assert.equal(saturdayOk(liveLead({ industry: 'pressure washing', timezone: ET })), true);
  assert.equal(saturdayOk(liveLead({ industry: 'garage door repair', timezone: ET })), false);
  assert.equal(saturdayOk(liveLead({ industry: 'garage door repair', timezone: ET, hrs: packHours(parseAny('Mon-Sat 8am-5pm')) })), true);
  assert.equal(saturdayOk(liveLead({ industry: 'pressure washing', timezone: ET, hrs: packHours(parseAny('Mon-Fri 8am-5pm')) })), false);
  assert.equal(saturdayOk(liveLead({ industry: 'barber shop', timezone: ET, hrs: packHours(parseAny('Mon-Sat 9am-7pm')) })), false);
});

test('Pipeline filters: open now, Saturday, niche', () => {
  const at = SAT_10AM_ET;
  const leads = [
    { id: 'a', industry: 'pressure washing', timezone: ET, hrs: packHours(parseAny('Mon-Sat 8am-5pm')) },
    { id: 'b', industry: 'plumber', timezone: ET, hrs: packHours(parseAny('Mon-Fri 8am-5pm')) },
    { id: 'c', industry: 'pool service', timezone: ET },
    { id: 'd', industry: 'hair salon', timezone: ET, hrs: packHours(parseAny('Tue-Sat 9am-7pm')) },
    { id: 'e', industry: 'plumber', timezone: ET, hrs: packHours(parseAny('Mon-Fri 8am-5pm')), biz_status: 'closed_forever' },
  ].map((l) => liveLead(l, at));
  const ids = (f) => filterLeads(leads, { f }).map((l) => l.id).join('');
  assert.equal(ids({ hours: 'open' }), 'ad');
  assert.equal(ids({ hours: 'closed' }), 'be');
  assert.equal(ids({ hours: 'sat' }), 'ad');
  assert.equal(ids({ hours: 'satok' }), 'ac');
  assert.equal(ids({ hours: 'unknown' }), 'c');
  assert.equal(ids({ hours: 'gone' }), 'e');
  assert.equal(ids({ niche: 'owner' }), 'abce');
  assert.equal(ids({ niche: 'plumb' }), 'be');
  assert.equal(ids({ niche: 'satskip' }), 'd');
  assert.equal(hoursMatch(leads[0], ''), true);
});

test('Lead finder: Saturday and closed filters, hours carried onto the lead', () => {
  const sat = { title: 'A', phone: '3055551234', reviews: 10, hrs: packHours(parseAny('Mon-Sat 8am-5pm')) };
  const wk = { title: 'B', phone: '3055551235', reviews: 10, hrs: packHours(parseAny('Mon-Fri 8am-5pm')) };
  const none = { title: 'C', phone: '3055551236', reviews: 10 };
  const gone = { title: 'D', phone: '3055551237', reviews: 10, status: 'temporarily_closed' };
  assert.deepEqual([sat, wk, none, gone].filter((r) => passes(r, { sat: 'maybe' })).map((r) => r.title), ['A', 'C']);
  assert.deepEqual([sat, wk, none, gone].filter((r) => passes(r, { sat: 'open' })).map((r) => r.title), ['A']);
  assert.deepEqual([sat, wk, none, gone].filter((r) => passes(r, {})).map((r) => r.title), ['A', 'B', 'C']);
  assert.equal(leadRow(sat).hrs, sat.hrs);
  assert.equal(leadRow(sat).hrs_src, 'google');
  assert.equal(leadRow({ title: 'O', source: 'osm', hours_text: 'Mo-Fr 08:00-17:00' }).hrs_src, 'osm');
  assert.equal(hoursText(leadRow({ title: 'O', source: 'osm', hours_text: 'Mo-Fr 08:00-17:00' }).hrs), 'Mon to Fri 8am to 5pm, Sat to Sun closed');
});
