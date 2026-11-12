import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
import { fromInputs, inputsIn } from '../public/js/apptime.js';
import { wall } from '../public/js/avail.js';

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
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  return { call };
}
// The next Monday (Eastern) at least 3 days out, and the next Saturday after it.
function days() {
  let t = Date.now() + 3 * 864e5;
  while (wall(t, 'America/New_York').dow !== 1) t += 864e5;
  const mon = inputsIn(t, 'America/New_York').date;
  const sat = inputsIn(t + 5 * 864e5, 'America/New_York').date;
  return { mon, sat };
}
const at = (date, time) => new Date(fromInputs(date, time, 'America/New_York')).toISOString();

test('available slots: booking outside hours, past the daily limit or too close is refused, force overrides', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'Vidal Newton', password: 'correct horse battery' });
  const me = (await t.call('GET', '/api/auth/state')).data.user;
  const { mon, sat } = days();
  const mk = async (n) => (await t.call('POST', '/api/leads', { business: `Canyon Construction ${n}`, phone: `30555501${String(10 + n)}`, email: `c${n}@canyon.test`, state: 'FL' })).data.lead;
  const [l1, l2, l3, l4] = [await mk(1), await mk(2), await mk(3), await mk(4)];
  const book = (lead, date, time, extra = {}) => t.call('POST', `/api/leads/${lead.id}/meeting`, { start: at(date, time), minutes: 30, closer_id: me.id, ...extra });

  // Nothing saved: any time works.
  assert.equal((await t.call('GET', '/api/me/availability')).data.avail, null);
  let r = await book(l1, sat, '10:00');
  assert.equal(r.status, 200, 'no hours saved, Saturday books');

  // Save Monday to Friday 9 to 5 Eastern, 2 calls a day, 15 minutes between.
  const days5 = Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, [[540, 1020]]]));
  r = await t.call('PUT', '/api/me/availability', { avail: { tz: 'America/New_York', days: days5, max: 2, gap: 15 } });
  assert.equal(r.status, 200);
  assert.match(r.data.text, /Mon 9 AM to 5 PM/);

  r = await book(l2, sat, '10:00');
  assert.equal(r.status, 409);
  assert.match(r.data.error, /Vidal is not available then\. Saturday is not one of their days/);
  r = await book(l2, mon, '07:30');
  assert.equal(r.status, 409);
  assert.match(r.data.error, /Monday they take calls 9 AM to 5 PM/);

  r = await book(l2, mon, '12:45');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await book(l3, mon, '13:00');
  assert.equal(r.status, 409);
  assert.match(r.data.error, /closer than 15 minutes/);
  r = await book(l3, mon, '15:00');
  assert.equal(r.status, 200);
  r = await book(l4, mon, '10:00');
  assert.equal(r.status, 409);
  assert.match(r.data.error, /already have 2 calls that day \(limit 2\)/);

  // The picker marks the same thing, and "book it anyway" still works.
  const free = (await t.call('GET', `/api/closers/free?start=${Date.parse(at(mon, '10:00'))}`)).data.closers.find((c) => c.id === me.id);
  assert.match(free.clash, /limit 2/);
  r = await book(l4, mon, '10:00', { force: true });
  assert.equal(r.status, 200);

  // Turning it off puts everything back.
  assert.equal((await t.call('PUT', '/api/me/availability', { clear: true })).data.avail, null);
  assert.equal((await book(l2, sat, '11:00')).status, 200);
});
