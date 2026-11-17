import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { callbackReminders } from '../src/notify.js';
import { d1, r2 } from './shims.mjs';

test('a callback reminds the person who set it once, when it is due', async () => {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-456' };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' }; if (cookie) h.cookie = cookie;
    let payload; if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  await call('POST', '/api/auth/setup', { accessKey: 'owner-key-456', email: 'v@rightwaygrowth.com', name: 'Vidal Newton', password: 'correct horse battery' });
  const id = (await call('POST', '/api/leads', { business: 'Later Co', phone: '3055550501', city: 'Miami', state: 'FL' })).data.lead.id;

  // Callback set 2 minutes from now: nothing is sent yet, the reminder comes 5 minutes ahead of the time.
  const cbAt = Date.now() + 2 * 60e3;
  assert.equal((await call('POST', `/api/leads/${id}/outcome`, { dispo: 'callback', callbackAt: cbAt })).status, 200);
  assert.equal(await callbackReminders(env), 1);
  assert.equal(await callbackReminders(env), 0, 'the same callback time does not remind twice');

  const list = (await call('GET', '/api/notifications')).data.notifications;
  const cb = list.filter((n) => n.kind === 'callback');
  assert.equal(cb.length, 1);
  assert.match(cb[0].title, /Callback due: Later Co/);
  assert.equal(cb[0].url, `/#/pipeline/${id}`);

  // Moving the callback to a new time reminds again for the new time.
  const later = Date.now() + 3 * 60e3;
  assert.equal((await call('POST', `/api/leads/${id}/outcome`, { dispo: 'callback', callbackAt: later })).status, 200);
  assert.equal(await callbackReminders(env), 1);
});
