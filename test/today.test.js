import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayStart, dayFrom, dayKey } from '../src/day.js';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { logActivity } from '../src/crm.js';
import { d1, r2 } from './shims.mjs';

test('the team day is a New York day, not a UTC day', () => {
  // 7:22 pm in New York on Nov 12 2026 is 00:22 UTC on Nov 13.
  const t = Date.parse('2026-11-13T00:22:00Z');
  assert.equal(dayStart(t), Date.parse('2026-11-12T05:00:00Z'), 'midnight New York, EST');
  assert.equal(dayKey(t), '2026-11-12');
  // Summer (EDT): midnight is 04:00 UTC.
  assert.equal(dayStart(Date.parse('2026-07-01T02:00:00Z')), Date.parse('2026-06-30T04:00:00Z'));
  // A browser start of day is used when it is sane, ignored when it is not.
  const mine = Date.parse('2026-11-12T05:00:00Z');
  assert.equal(dayFrom(String(mine), t), mine);
  assert.equal(dayFrom('', t), mine, 'blank falls back to New York');
  assert.equal(dayFrom(String(t + 1e6), t), mine, 'a time in the future is ignored');
  assert.equal(dayFrom(String(t - 3 * 864e5), t), mine, 'a time days ago is ignored');
});

test('evening dials still count today after 7 pm New York', async () => {
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
  const real = Date.now;
  try {
    let r = await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
    assert.equal(r.status, 200);
    const me = (await call('GET', '/api/me')).data;
    const uid = me.user?.id || me.id;
    // Three dials at 10 am, 3 pm and 6 pm New York on Nov 12, plus one yesterday at 8 pm.
    for (const iso of ['2026-11-12T15:00:00Z', '2026-11-12T20:00:00Z', '2026-11-12T23:00:00Z', '2026-11-12T01:00:00Z']) {
      await logActivity(env, { type: 'call', outcome: 'no_answer', by: uid, at: Date.parse(iso) });
    }
    // Now it is 7:22 pm in New York (00:22 UTC the next day).
    Date.now = () => Date.parse('2026-11-13T00:22:00Z');
    r = await call('GET', '/api/dialer/queue');
    assert.equal(r.data.stats.dials, 3, 'dialer counts the whole New York day');
    r = await call('GET', `/api/dashboard`);
    assert.equal(r.data.me.dials, 3, 'dashboard agrees without the browser hint');
  } finally { Date.now = real; }
});
