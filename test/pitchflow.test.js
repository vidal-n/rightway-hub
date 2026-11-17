import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOW, ORDER, inFlow, pace, titleOf, QUESTIONS, EXIT_TERMS, CONTRACT } from '../public/js/pitchflow.js';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';

test('the clarity audit runs in one fixed order: contract, discovery, map, competitors, plan, trial close, price, sign, next', () => {
  const must = ['welcome', 'verify', 'read', 'grid', 'ahead', 'listings', 'worth', 'fixes', 'plan', 'days', 'app', 'trial', 'price', 'sign', 'next'];
  assert.deepEqual(ORDER.filter((k) => must.includes(k)), must);
  // Price sits about three quarters of the way into a 45 minute meeting (Gong: minutes 38 to 46 in won demos), never earlier.
  const at = Object.fromEntries(FLOW.map(([k, , m]) => [k, m]));
  assert.ok(at.price >= 30 && at.price <= 38);
  assert.ok(at.trial < at.price && at.price < at.sign && at.sign < at.next);
  assert.ok(at.grid < 12, 'the map reveal comes early, as the pace change');
  // Minutes never go backwards.
  for (let i = 1; i < FLOW.length; i++) assert.ok(FLOW[i][2] >= FLOW[i - 1][2], FLOW[i][0]);
});

test('inFlow sorts deck slides into the pitch order and keeps unknown ones at the end', () => {
  const out = inFlow([{ key: 'price' }, { key: 'zzz' }, { key: 'grid' }, { key: 'welcome' }, { key: 'sign' }]);
  assert.deepEqual(out.map((x) => x.key), ['welcome', 'grid', 'price', 'sign', 'zzz']);
  assert.equal(titleOf('ahead'), 'Who holds your spots');
});

test('pace says on time, ahead or behind against the 45 minute plan', () => {
  assert.equal(pace('price', 35).text, 'On time');
  assert.equal(pace('price', 40).text, '6 min behind');
  assert.equal(pace('grid', 3.5).text, '6 min ahead');
  assert.equal(pace('nope', 3), null);
});

test('copy rules: no dashes, no ranking promises, exit terms and the contract say how to leave', () => {
  const all = [...FLOW.flat().map(String), ...QUESTIONS, ...EXIT_TERMS, CONTRACT].join(' ');
  assert.ok(!/[–—]/.test(all));
  assert.ok(!/guarantee(d)? (a )?(#1|first|top)/i.test(all));
  assert.ok(EXIT_TERMS.some((t) => /month to month/.test(t)) && EXIT_TERMS.some((t) => /No ranking guarantees/.test(t)));
  assert.match(CONTRACT, /tell me no/);
  assert.ok(QUESTIONS.length >= 10 && QUESTIONS.length <= 14, 'Gong: 11 to 14 discovery questions');
});

test('the notes relay keeps the screen number and counts Back and Next commands from another device', async () => {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-321' };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' }; if (cookie) h.cookie = cookie;
    let payload; if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  await call('POST', '/api/auth/setup', { accessKey: 'owner-key-321', email: 'v@rightwaygrowth.com', name: 'Vidal Newton', password: 'correct horse battery' });
  assert.deepEqual((await call('GET', '/api/present/ld_1/sync')).data, {});
  await call('PUT', '/api/present/ld_1/sync', { i: 3, n: 15 });
  let r = (await call('GET', '/api/present/ld_1/sync')).data;
  assert.equal(r.i, 3); assert.equal(r.n, 15); assert.equal(r.cseq, undefined);
  await call('PUT', '/api/present/ld_1/sync', { cmd: 4 });
  await call('PUT', '/api/present/ld_1/sync', { cmd: 5 });
  r = (await call('GET', '/api/present/ld_1/sync')).data;
  assert.equal(r.cmd, 5); assert.equal(r.cseq, 2); assert.equal(r.i, 3);
  await call('PUT', '/api/present/ld_1/sync', { i: 'x', cmd: -2 });
  assert.equal((await call('GET', '/api/present/ld_1/sync')).data.cseq, 2, 'bad values are ignored');
  // Only logged in staff.
  cookie = '';
  assert.equal((await call('GET', '/api/present/ld_1/sync')).status, 401);
});
