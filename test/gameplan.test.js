import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScript, SCRIPT_GROUPS } from '../public/js/leadintel.js';
import { scriptSteps, PRINT_VARS } from '../public/js/scriptprint.js';

test('Game Plan script: own group, filled with rep, company and business', () => {
  assert.ok(SCRIPT_GROUPS.find((g) => g[0] === 'plan'));
  const s = buildScript({ business: 'Joe Plumbing', contact_name: 'Joe Smith' }, null, { rep: 'Sam', voice: 'I' });
  const call = s.steps.find((x) => x.id === 'g_call').lines.join(' ');
  assert.match(call, /Hi Joe\? It's Sam with Rightway Growth\./);
  assert.match(call, /Joe Plumbing/);
  assert.match(call, /website audit/);
  assert.doesNotMatch(call, /Josh|Wavepoint/i);
  assert.equal(scriptSteps('plan').length, 3);
  assert.ok(PRINT_VARS.company && PRINT_VARS.rep);
});

import { applyOutcome } from '../src/crm.js';
test('phone menu outcome takes the lead off the list and tags it', () => {
  const set = applyOutcome({ stage: 'new', tags: 'roofing', attempts: 0 }, 'phone_menu');
  assert.equal(set.stage, 'lost');
  assert.equal(set.tags, 'roofing, phone menu');
  assert.equal(set.next_action_at, null);
  assert.equal(applyOutcome({ stage: 'new', tags: 'phone menu' }, 'phone_menu').tags, 'phone menu');
});

import worker from '../src/worker.js';
import { resetSchemaCache, setSetting } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
test('an older saved disposition list gets Phone menu added once', async () => {
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
  await setSetting(env, 'dispositions', JSON.stringify([{ id: 'no_answer', label: 'No answer', acts: 'no_answer' }]));
  await setSetting(env, 'dispo_pm', '');
  let r = await call('GET', '/api/dispositions');
  assert.ok(r.dispositions.some((d) => d.acts === 'phone_menu'));
  // Remove it: it stays removed.
  await call('PUT', '/api/dispositions', { dispositions: [{ id: 'no_answer', label: 'No answer', acts: 'no_answer' }] });
  r = await call('GET', '/api/dispositions');
  assert.equal(r.dispositions.some((d) => d.acts === 'phone_menu'), false);
});
