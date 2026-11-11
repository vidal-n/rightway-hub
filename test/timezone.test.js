import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, all } from '../src/db.js';
import { resolveZone, stateFromZip, stateFromAddress, zoneFromLatLng, canCallNow, ZONES } from '../public/js/timezone.js';
import { cleanLead, inCallingHours, stateCode } from '../src/crm.js';
import { d1, r2 } from './shims.mjs';

const ET = ZONES.ET, CT = ZONES.CT, MT = ZONES.MT, PT = ZONES.PT;

test('full state names resolve like codes (the Lead finder sends names)', () => {
  assert.equal(resolveZone({ state: 'Alabama' }).tz, CT);
  assert.equal(resolveZone({ state: 'Washington' }).tz, PT);
  assert.equal(resolveZone({ state: 'district of columbia' }).tz, ET);
  assert.equal(resolveZone({ state: 'New Mexico' }).tz, MT);
  assert.equal(resolveZone({ state: 'Arizona' }).tz, ZONES.AZ);
  assert.equal(resolveZone({ state: 'ZZ' }).tz, null);
  assert.equal(stateCode('Mississippi'), 'MS');
});

test('state from an address or a ZIP when the state field is empty', () => {
  assert.equal(stateFromAddress('123 Main St, Tupelo, MS 38801'), 'MS');
  assert.equal(stateFromAddress('55 Oak Ave, Birmingham, Alabama 35203, USA'), 'AL');
  assert.equal(stateFromAddress('Tampa, FL'), 'FL');
  assert.equal(stateFromAddress('no state here'), '');
  assert.equal(stateFromZip('33602'), 'FL');
  assert.equal(stateFromZip('90210'), 'CA');
  assert.equal(stateFromZip('60601'), 'IL');
  assert.equal(stateFromZip('98101-1234'), 'WA');
  assert.equal(stateFromZip('06103'), 'CT');
  assert.equal(stateFromZip('20166'), 'VA');
  assert.equal(stateFromZip('abc'), '');
  let r = resolveZone({ address: '12 Elm St, Covington, LA 70433' });
  assert.deepEqual([r.tz, r.state, r.how], [CT, 'LA', 'address']);
  r = resolveZone({ zip: '97201' });
  assert.deepEqual([r.tz, r.state, r.how], [PT, 'OR', 'zip']);
});

test('split states use ZIP, then city, then a second possible zone', () => {
  assert.deepEqual(pick(resolveZone({ state: 'FL', zip: '32501' })), [CT, null]);       // Pensacola
  assert.deepEqual(pick(resolveZone({ state: 'FL', zip: '33139' })), [ET, null]);       // Miami Beach
  assert.deepEqual(pick(resolveZone({ state: 'Florida', city: 'Panama City Beach' })), [CT, null]);
  assert.deepEqual(pick(resolveZone({ state: 'FL', city: 'Miami' })), [ET, null]);
  assert.deepEqual(pick(resolveZone({ state: 'FL', city: 'Small Town' })), [ET, CT]);   // unsure: both must be inside hours
  assert.deepEqual(pick(resolveZone({ state: 'TN', zip: '37203' })), [CT, null]);       // Nashville
  assert.deepEqual(pick(resolveZone({ state: 'TN', zip: '37902' })), [ET, null]);       // Knoxville
  assert.deepEqual(pick(resolveZone({ state: 'TX', zip: '79901' })), [MT, null]);       // El Paso
  assert.deepEqual(pick(resolveZone({ state: 'TX', zip: '75201' })), [CT, null]);       // Dallas
  assert.deepEqual(pick(resolveZone({ state: 'ID', zip: '83814' })), [PT, null]);       // Coeur d'Alene
  assert.deepEqual(pick(resolveZone({ state: 'ID', zip: '83702' })), [MT, null]);       // Boise
  assert.deepEqual(pick(resolveZone({ state: 'IN', zip: '46320' })), [CT, null]);       // Hammond
  assert.deepEqual(pick(resolveZone({ state: 'IN', zip: '46204' })), [ET, null]);       // Indianapolis
  assert.deepEqual(pick(resolveZone({ state: 'KY', zip: '42101' })), [CT, null]);       // Bowling Green
  assert.deepEqual(pick(resolveZone({ state: 'MI', zip: '49801' })), [ET, CT]);         // Iron Mountain: on the line
  assert.deepEqual(pick(resolveZone({ state: 'OR', zip: '97914' })), [MT, null]);       // Ontario
});

test('a ZIP in another state than the typed one keeps both zones', () => {
  const r = resolveZone({ state: 'FL', zip: '75201' }); // Dallas ZIP typed with Florida
  assert.equal(r.tz, ET);
  assert.equal(r.alt, CT);
});

test('map spot only decides when nothing else is known', () => {
  assert.deepEqual(zoneFromLatLng(25.76, -80.19), { tz: ET, alt: null });
  assert.deepEqual(zoneFromLatLng(34.05, -118.24), { tz: PT, alt: null });
  assert.deepEqual(zoneFromLatLng(32.78, -96.8), { tz: CT, alt: null });
  assert.equal(zoneFromLatLng(52, 5), null);
  assert.equal(zoneFromLatLng(null, null), null);
  assert.equal(resolveZone({ lat: 41.88, lng: -87.63 }).how, 'map');
  assert.equal(resolveZone({ state: 'IL', lat: 25, lng: -80 }).tz, CT, 'state wins over the map');
});

test('calling hours: two zones need both inside, no zone needs the all-US window', () => {
  const at = (h, m = 0) => Date.UTC(2026, 10, 2, h, m); // 2 Nov 2026, standard time: ET = UTC-5, CT = UTC-6, PT = UTC-8
  // 9:00 ET is 8:00 CT: both inside.
  assert.equal(canCallNow(ET, CT, at(14)), true);
  // 8:30 ET is 7:30 CT: Central not open yet.
  assert.equal(canCallNow(ET, CT, at(13, 30)), false);
  assert.equal(canCallNow(ET, null, at(13, 30)), true);
  // 7:30 pm CT is 8:30 pm ET: Eastern closed.
  assert.equal(canCallNow(ET, CT, at(1, 30) + 864e5), false);
  // Unknown: 10:59 ET no, 11:00 ET yes (8am PT), 7:59 pm ET yes, 8pm ET no.
  assert.equal(canCallNow(null, null, at(15, 59)), false);
  assert.equal(canCallNow(null, null, at(16, 0)), true);
  assert.equal(canCallNow(null, null, at(0, 59) + 864e5), true);
  assert.equal(canCallNow(null, null, at(1, 0) + 864e5), false);
  assert.equal(inCallingHours(null, at(16, 0)), true);
  assert.equal(inCallingHours(ET, at(16, 0), CT), true);
});

test('cleanLead sets the zone from state, ZIP or address and keeps it on a partial edit', () => {
  let c = cleanLead({ business: 'A', state: 'Alabama', zip: '35203' });
  assert.equal(c.state, 'AL'); assert.equal(c.timezone, CT); assert.equal(c.tz_how, 'state');
  c = cleanLead({ business: 'A', address: '9 Pine Rd, Seattle, WA 98101' });
  assert.equal(c.timezone, PT); assert.equal(c.tz_how, 'address');
  c = cleanLead({ city: 'Somewhere' }, true);
  assert.equal('timezone' in c, false, 'no place found: leave the saved zone alone');
  c = cleanLead({ state: '' }, true);
  assert.equal(c.timezone, null, 'state cleared: zone cleared');
});

const pick = (r) => [r.tz, r.alt];

function setup() {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' };
    if (cookie) h.cookie = cookie;
    let payload;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
  return { env, call };
}

test('fix-timezones repairs leads in slices and leaves booking zones alone', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const ins = (id, f) => t.env.DB.prepare(`INSERT INTO leads (id, business, stage, state, zip, address, city, lat, lng, timezone, tz_how, created_at, updated_at)
    VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`).bind(id, `Biz ${id}`, f.state ?? null, f.zip ?? null, f.address ?? null, f.city ?? null, f.lat ?? null, f.lng ?? null, f.timezone ?? null, f.tz_how ?? null).run();
  await ins('ld_a', { state: 'Alabama' });
  await ins('ld_b', { state: '', address: '5 Bay St, Pensacola, FL 32501' });
  await ins('ld_c', { state: 'Florida', city: 'Miami', timezone: ET });                       // old row, right already
  await ins('ld_d', { state: 'Florida', zip: '32401', timezone: ET });                         // old row, panhandle was wrong
  await ins('ld_e', { timezone: PT, tz_how: 'booking' });                                      // visitor's own zone
  await ins('ld_f', {});                                                                       // nothing to go on
  const r = await t.call('POST', '/api/leads/fix-timezones', {});
  assert.equal(r.status, 200);
  assert.equal(r.data.next, null);
  assert.equal(r.data.unknown, 1);
  const rows = Object.fromEntries((await all(t.env, 'SELECT id, state, timezone, tz_alt, tz_how FROM leads')).map((x) => [x.id, x]));
  assert.deepEqual([rows.ld_a.state, rows.ld_a.timezone], ['AL', CT]);
  assert.deepEqual([rows.ld_b.state, rows.ld_b.timezone, rows.ld_b.tz_how], ['FL', CT, 'address']);
  assert.equal(rows.ld_c.timezone, ET);
  assert.equal(rows.ld_d.timezone, CT);
  assert.equal(rows.ld_e.timezone, PT);
  assert.equal(rows.ld_f.timezone, null);
  // The list shows the zone and whether it can be called.
  const list = (await t.call('GET', '/api/leads')).data.leads;
  assert.equal(list.find((l) => l.id === 'ld_a').tz_short, 'CT');
  assert.equal(list.find((l) => l.id === 'ld_f').tz_known, false);
  // A second run has nothing left to change.
  const again = await t.call('POST', '/api/leads/fix-timezones', {});
  assert.equal(again.data.fixed, 0);
});
