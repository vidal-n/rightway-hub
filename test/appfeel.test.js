import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { filterLeads } from '../public/js/leadfilter.js';
import { d1, r2 } from './shims.mjs';

test('pipeline time zones: one, several, unknown, and none', () => {
  const leads = [{ id: 1, tz_short: 'ET' }, { id: 2, tz_short: 'CT' }, { id: 3, tz_short: null }, { id: 4, tz_short: 'PT' }];
  const ids = (tz) => filterLeads(leads, { tz, f: {} }).map((l) => l.id);
  assert.deepEqual(ids(''), [1, 2, 3, 4]);
  assert.deepEqual(ids('ET'), [1]);
  assert.deepEqual(ids('ET,CT'), [1, 2]);
  assert.deepEqual(ids('CT,?'), [2, 3]);
  assert.deepEqual(ids('?'), [3]);
});

test('crash reports: anyone can send one, owners read them, repeats count once, fixed ones clear', async () => {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body, noCsrf = false) => {
    const h = noCsrf ? {} : { 'x-rw': '1' }; if (cookie) h.cookie = cookie;
    let payload; if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  // Not logged in (the "Hub did not load" screen): still accepted.
  const first = await call('POST', '/api/crash', { message: 'The Hub did not load', stack: 'x', where: '#/ /' }, true);
  assert.equal(first.status, 200);
  assert.equal((await call('POST', '/api/crash', { message: '' }, true)).status, 400);
  await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'Vidal Newton', password: 'correct horse battery' });
  // Owner sends the same thing again: counted, not duplicated. A long message is cut.
  await call('POST', '/api/crash', { message: 'The Hub did not load', where: '#/ /' });
  const long = await call('POST', '/api/crash', { message: 'x'.repeat(2000), stack: 'y'.repeat(9000), where: '#/phone' });
  assert.equal(long.status, 200);
  const list = (await call('GET', '/api/crash')).data;
  assert.equal(list.reports.length, 2);
  const dup = list.reports.find((r) => r.message === 'The Hub did not load');
  assert.equal(dup.count, 2);
  const big = list.reports.find((r) => r.where_at === '#/phone');
  assert.equal(big.message.length, 500);
  assert.equal(big.stack.length, 3000);
  assert.equal(big.who.includes('Vidal'), true);
  assert.equal((await call('PUT', `/api/crash/${big.id}`, { status: 'fixed' })).status, 200);
  assert.equal((await call('GET', '/api/crash')).data.open, 1);
  await call('DELETE', '/api/crash');
  assert.equal((await call('GET', '/api/crash')).data.reports.length, 1);
  // Only owners read them.
  cookie = '';
  assert.notEqual((await call('GET', '/api/crash')).status, 200);
});

test('quick links save on their own and never wipe the menu order', async () => {
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
  await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'Vidal Newton', password: 'correct horse battery' });
  await call('PUT', '/api/me/nav', { order: ['phone', 'home'], hidden: ['vault'] });
  const q = await call('PUT', '/api/me/nav', { quick: ['#/phone', '#/pipeline', '#/phone', '<script>', 'javascript:alert(1)'] });
  assert.deepEqual(q.data.prefs.quick, ['#/phone', '#/pipeline']);
  assert.deepEqual(q.data.prefs.order, ['phone', 'home']);
  // Saving the menu later keeps the quick links.
  const m = await call('PUT', '/api/me/nav', { order: ['home', 'phone'], hidden: [] });
  assert.deepEqual(m.data.prefs.quick, ['#/phone', '#/pipeline']);
  assert.deepEqual((await call('GET', '/api/me/nav')).data.prefs.quick, ['#/phone', '#/pipeline']);
});
