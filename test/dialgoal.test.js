import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';

test('daily dial goal: default 60, saved per person, limits, shown by the dialer and dashboard', async () => {
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
  assert.equal((await call('GET', '/api/me/dial-goal')).data.goal, 60);
  assert.equal((await call('GET', '/api/dialer/queue')).data.stats.goal, 60);
  assert.equal((await call('PUT', '/api/me/dial-goal', { goal: 150 })).data.goal, 150);
  assert.equal((await call('GET', '/api/dialer/queue')).data.stats.goal, 150);
  assert.equal((await call('GET', '/api/dashboard')).data.me.goal, 150);
  for (const bad of [0, -5, 5000, 'abc', null]) assert.equal((await call('PUT', '/api/me/dial-goal', { goal: bad })).status, 400);
  assert.equal((await call('GET', '/api/me/dial-goal')).data.goal, 150);

  // Agents cannot set their own goal. An owner sets it for them, and each person has their own number.
  const inv = await call('POST', '/api/team/invite', { email: 'rep@x.com', name: 'Rep', role: 'team' });
  const repId = (await call('GET', '/api/team')).data.users.find((u) => u.email === 'rep@x.com').id;
  const ownerCookie = cookie;
  assert.equal((await call('PUT', `/api/users/${repId}/dial-goal`, { goal: 90 })).data.goal, 90);
  assert.equal((await call('PUT', `/api/users/${repId}/dial-goal`, { goal: 0 })).status, 400);
  assert.equal((await call('PUT', `/api/users/${repId}/dial-goal`, { goal: 5000 })).status, 400);
  assert.equal((await call('PUT', '/api/users/nope/dial-goal', { goal: 50 })).status, 404);
  const list = (await call('GET', '/api/team')).data.users;
  assert.equal(list.find((u) => u.id === repId).dial_goal, 90);
  assert.equal(list.find((u) => u.email === 'v@rightwaygrowth.com').dial_goal, 150);
  cookie = '';
  await call('POST', '/api/auth/invite/accept', { token: inv.data.inviteUrl.split('/#/invite/')[1], password: 'another long password' });
  assert.equal((await call('GET', '/api/dialer/queue')).data.stats.goal, 90);
  assert.equal((await call('GET', '/api/dashboard')).data.me.goal, 90);
  assert.equal((await call('PUT', '/api/me/dial-goal', { goal: 500 })).status, 403);
  assert.equal((await call('PUT', `/api/users/${repId}/dial-goal`, { goal: 500 })).status, 403);
  assert.equal((await call('GET', '/api/me/dial-goal')).data.goal, 90);
  cookie = ownerCookie;
  assert.equal((await call('GET', '/api/dialer/queue')).data.stats.goal, 150);
});
