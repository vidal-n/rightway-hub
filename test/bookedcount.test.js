import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';

test('dialer and dashboard count a booked callback and a booked audit', async () => {
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
  const a = (await call('POST', '/api/leads', { business: 'Cb Co', phone: '3055550401', city: 'Miami', state: 'FL' })).data.lead.id;
  const b = (await call('POST', '/api/leads', { business: 'Audit Co', phone: '3055550402', city: 'Miami', state: 'FL' })).data.lead.id;
  assert.equal((await call('GET', '/api/dialer/queue')).data.stats.booked, 0);

  // A callback booked on a call.
  const cbAt = Date.now() + 86400e3;
  assert.equal((await call('POST', `/api/leads/${a}/outcome`, { dispo: 'callback', callbackAt: cbAt })).status, 200);
  assert.equal((await call('GET', '/api/dialer/queue')).data.stats.booked, 1);

  // An audit booked from the lead (the meeting route), which logs a meeting activity rather than a call outcome.
  const when = new Date(Date.now() + 2 * 86400e3); when.setHours(15, 0, 0, 0);
  const m = await call('POST', `/api/leads/${b}/meeting`, { start: when.toISOString(), minutes: 30 });
  assert.ok(m.status < 300, JSON.stringify(m.data));
  assert.equal((await call('GET', '/api/dialer/queue')).data.stats.booked, 2);
  assert.equal((await call('GET', '/api/dashboard')).data.me.booked, 2);
  assert.equal((await call('GET', '/api/dashboard')).data.week.booked, 2);
});
