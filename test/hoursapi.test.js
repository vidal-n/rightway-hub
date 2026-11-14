// Business hours on leads end to end (Nov 2026, V: hours of operation in the scrubber, Saturday lists).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
import { unpack, liveLead } from '../public/js/leadlive.js';
import { hoursText } from '../public/js/hours.js';

test('hours: CSV and finder imports, typed hours, Google hours (demo), and the Pipeline download', async () => {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' }; if (cookie) h.cookie = cookie;
    let payload; if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const imp = await call('POST', '/api/leads/import', { merge: false, rows: [
    { business: 'Sunny Pressure Wash', phone: '305-555-0101', city: 'Miami', state: 'FL', industry: 'pressure washing', working_hours: 'Monday-Saturday: 8 AM-5 PM, Sunday: Closed' },
    { business: 'Delta Plumbing', phone: '305-555-0102', city: 'Miami', state: 'FL', industry: 'plumber', hrs: '1:480-1020;2:480-1020;3:480-1020;4:480-1020;5:480-1020', hrs_src: 'google' },
    { business: 'No Hours Pools', phone: '305-555-0103', city: 'Miami', state: 'FL', industry: 'pool service' },
  ] });
  assert.equal(imp.status, 200, JSON.stringify(imp.data));
  let leads = unpack((await call('GET', '/api/leads?pack=1')).data).map((l) => liveLead(l));
  const by = Object.fromEntries(leads.map((l) => [l.business, l]));
  assert.equal(hoursText(by['Sunny Pressure Wash'].hrs), 'Mon to Sat 8am to 5pm, Sun closed');
  assert.equal(by['Sunny Pressure Wash'].open_sat, true);
  assert.equal(by['Delta Plumbing'].open_sat, false);
  assert.equal(by['No Hours Pools'].hours_known, false);
  // Typed hours win over Google and show in the lead's hours card with the state rule.
  const id = by['Delta Plumbing'].id;
  let h = (await call('PUT', `/api/leads/${id}/hours`, { text: 'Mon-Fri 7am-4pm, Sat 8am-noon' })).data;
  assert.equal(h.text, 'Mon to Fri 7am to 4pm, Sat 8am to noon, Sun closed');
  assert.equal(h.src, 'hand');
  assert.equal(h.rule, '8am to 8pm their time, every day');
  const bad = await call('PUT', `/api/leads/${id}/hours`, { text: 'whenever' });
  assert.equal(bad.status, 400);
  // Google hours in demo mode (no DataForSEO): a week is saved for a lead without hours, but never over typed hours.
  const g = (await call('POST', '/api/leads/hours/google', { ids: [by['No Hours Pools'].id, id] })).data;
  assert.equal(g.results[by['No Hours Pools'].id].ok, true);
  h = (await call('GET', `/api/leads/${id}/hours`)).data;
  assert.equal(h.src, 'hand', 'typed hours are kept');
  // The Pipeline's change sync sees hours updates.
  const since = Date.now() - 60e3;
  leads = unpack((await call('GET', `/api/leads?pack=1&since=${since}`)).data);
  assert.ok(leads.some((l) => l.id === by['No Hours Pools'].id && l.hrs), 'hours change reaches the Pipeline');
});
