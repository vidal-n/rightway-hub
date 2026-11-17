import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, all } from '../src/db.js';
import { d1, r2 } from './shims.mjs';

test('outside competitors show on the leaderboard and never reach the team numbers or analytics', async () => {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-789' };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' }; if (cookie) h.cookie = cookie;
    let payload; if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  await call('POST', '/api/auth/setup', { accessKey: 'owner-key-789', email: 'v@rightwaygrowth.com', name: 'Vidal Newton', password: 'correct horse battery' });
  // Today in New York (the Hub's team day), not UTC.
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const josh = (await call('POST', '/api/rivals', { name: 'Josh' })).data.id;
  const grace = (await call('POST', '/api/rivals', { name: 'Grace' })).data.id;
  assert.equal((await call('POST', '/api/rivals', { name: '  ' })).status, 400);

  assert.equal((await call('PUT', `/api/rivals/${josh}/day`, { date: day, dials: 40, talks: 10, booked: 3, callbacks: 2 })).status, 200);
  assert.equal((await call('PUT', `/api/rivals/${grace}/day`, { date: day, dials: 30, talks: 6, booked: 1, callbacks: 0 })).status, 200);
  assert.equal((await call('PUT', `/api/rivals/${josh}/day`, { date: day, dials: 50, talks: 12, booked: 4, callbacks: 2 })).status, 200, 'a second save replaces the day');
  assert.equal((await call('PUT', `/api/rivals/${josh}/day`, { date: 'nope', dials: 1 })).status, 400);

  const prefill = (await call('GET', `/api/rivals/${josh}/day?date=${day}`)).data;
  assert.deepEqual(prefill, { dials: 50, talks: 12, booked: 4, callbacks: 2 });

  const lb = (await call('GET', '/api/leaderboard?days=1')).data;
  assert.equal(lb.canEdit, true);
  assert.equal(lb.outside.list.length, 2);
  assert.equal(lb.outside.list[0].name, 'Josh');
  assert.deepEqual(lb.outside.total, { dials: 80, talks: 18, booked: 5, callbacks: 2, rate: 27.8 });

  // Nothing typed in for outside players reaches the team, the dialer or the dashboard.
  assert.equal(lb.team.booked, 0);
  assert.equal(lb.team.dials, 0);
  assert.equal(lb.other.booked, 0);
  assert.equal((await call('GET', '/api/dialer/queue')).data.stats.booked, 0);
  assert.equal((await call('GET', '/api/dashboard')).data.me.booked, 0);
  const acts = await all(env, 'SELECT id FROM activities');
  assert.equal(acts.length, 0, 'outside numbers are not written as activities');

  // Removing a name removes their days too.
  assert.equal((await call('DELETE', `/api/rivals/${grace}`)).status, 200);
  const after = (await call('GET', '/api/leaderboard?days=1')).data;
  assert.equal(after.outside.list.length, 1);
  assert.equal(after.outside.total.booked, 4);
});
