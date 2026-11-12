import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAS, systemPrompt, cleanTurns, fallbackReply, localCoach, asksTimes, personaOf } from '../public/js/practice.js';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';

test('practice personas read cleanly and have no dashes', () => {
  assert.ok(PERSONAS.length >= 4);
  for (const p of PERSONAS) { assert.ok(p.objections.length >= (p.id === 'voicemail' ? 2 : 3)); assert.doesNotMatch(JSON.stringify(p), /[–—]/); }
  const sp = systemPrompt('skeptical', { business: 'Joe Roofing', city: 'Miami' });
  assert.match(sp, /Dana/); assert.match(sp, /Joe Roofing/); assert.match(sp, /Never use dashes/);
  assert.equal(personaOf('nope').id, PERSONAS[0].id);
});

test('turns become alternating messages that start and end with the rep side', () => {
  const m = cleanTurns([{ role: 'lead', text: 'Hello?' }, { role: 'rep', text: 'Hi, is this Mike?' }, { role: 'rep', text: 'Quick one.' }]);
  assert.deepEqual(m.map((x) => x.role), ['user', 'assistant', 'user']);
  assert.match(m[2].content, /Mike\? Quick one\./);
  assert.equal(cleanTurns([]).length, 1);
});

test('basic owner and basic coach work without an AI key', () => {
  assert.equal(fallbackReply('friendly', []), 'Hello?');
  const turns = [{ role: 'lead', text: 'Hello?' }, { role: 'rep', text: 'Hi Mike, quick one.' }];
  assert.match(fallbackReply('friendly', turns), /job right now/);
  const closing = [...turns, { role: 'lead', text: 'x' }, { role: 'rep', text: 'We built a free competitor analysis.' }, { role: 'lead', text: 'y' }, { role: 'rep', text: 'Does 12pm or 4pm work?' }];
  assert.equal(fallbackReply('friendly', closing), personaOf('friendly').yes);
  assert.ok(asksTimes('12pm or 4pm?')); assert.ok(!asksTimes('12pm works'));
  const c = localCoach(closing);
  assert.match(c, /Score: \d+ of 10/);
  assert.doesNotMatch(c, /[–—]/);
});

test('practice routes answer for staff, in basic mode without a key', async () => {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1', ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) };
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env);
    const c = res.headers.get('set-cookie'); if (c) cookie = c.split(';')[0];
    return res.json();
  };
  await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  let r = await call('POST', '/api/practice/turn', { persona: 'friendly', turns: [] });
  assert.equal(r.reply, 'Hello?'); assert.equal(r.ai, false);
  r = await call('POST', '/api/practice/turn', { persona: 'friendly', turns: [{ role: 'lead', text: 'Hello?' }, { role: 'rep', text: 'Hi Mike' }] });
  assert.match(r.reply, /job right now/);
  r = await call('POST', '/api/practice/coach', { persona: 'friendly', turns: [{ role: 'rep', text: 'Hi Mike, we have a free competitor analysis. 12pm or 4pm?' }] });
  assert.match(r.feedback, /Score/);
  const st = await call('GET', '/api/practice/status');
  assert.equal(st.ai, false);
});

test('practice is free unless an owner switches on real AI', async () => {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', ANTHROPIC_API_KEY: 'sk-test' };
  let cookie = '';
  const real = globalThis.fetch;
  let outside = 0;
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1', ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) };
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env);
    const c = res.headers.get('set-cookie'); if (c) cookie = c.split(';')[0];
    return res.json();
  };
  await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  globalThis.fetch = async (...a) => { outside++; return real(...a); };
  try {
    const turns = [{ role: 'lead', text: 'Hello?' }, { role: 'rep', text: 'Hi Mike' }];
    let r = await call('POST', '/api/practice/turn', { persona: 'friendly', turns });
    assert.equal(r.ai, false);
    r = await call('POST', '/api/practice/turn', { persona: 'friendly', turns, useAi: false });
    assert.equal(r.ai, false);
    r = await call('POST', '/api/practice/coach', { persona: 'friendly', turns });
    assert.equal(r.ai, false);
    assert.equal(outside, 0);
    const st = await call('GET', '/api/practice/status');
    assert.equal(st.ai, true);
  } finally { globalThis.fetch = real; }
});
