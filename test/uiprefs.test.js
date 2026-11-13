import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';

const boot = async () => {
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
  return call;
};

test('screen layouts and the call script switch are saved on the account and survive menu saves', async () => {
  const call = await boot();
  let r = await call('PUT', '/api/me/nav', { ui: { callScript: false, layouts: { dashboard: { order: ['goal', 'dials'], hidden: ['funnel'], size: { pipeline: 'c6', bad: 'x' } } } } });
  assert.equal(r.status, 200);
  assert.equal(r.data.prefs.ui.callScript, false);
  assert.deepEqual(r.data.prefs.ui.layouts.dashboard, { order: ['goal', 'dials'], hidden: ['funnel'], size: { pipeline: 'c6' } });
  // Saving the menu order keeps the layouts.
  r = await call('PUT', '/api/me/nav', { order: ['phone', 'home'], hidden: [] });
  assert.equal(r.data.prefs.ui.callScript, false);
  assert.ok(r.data.prefs.ui.layouts.dashboard);
  // A second page does not disturb the first; null clears a page.
  r = await call('PUT', '/api/me/nav', { ui: { layouts: { dialer: { order: ['queue', 'lead', 'prep'], hidden: [], size: {} } } } });
  assert.deepEqual(Object.keys(r.data.prefs.ui.layouts).sort(), ['dashboard', 'dialer']);
  r = await call('PUT', '/api/me/nav', { ui: { layouts: { dashboard: null } } });
  assert.deepEqual(Object.keys(r.data.prefs.ui.layouts), ['dialer']);
  // Resetting the menu does not wipe the screen layouts.
  r = await call('PUT', '/api/me/nav', { reset: true });
  assert.ok(r.data.prefs.ui.layouts.dialer);
  const got = await call('GET', '/api/me/nav');
  assert.ok(got.data.prefs.ui.layouts.dialer);
});

test('resume route: last call and calls in the last 12 hours, from the server', async () => {
  const call = await boot();
  let r = await call('GET', '/api/dialer/resume');
  assert.equal(r.status, 200);
  assert.equal(r.data.last, null);
  assert.equal(r.data.calls, 0);
  const lead = await call('POST', '/api/leads', { business: 'Shore Plumbing', phone: '305-555-0188', state: 'FL' });
  const id = lead.data.lead?.id || lead.data.id;
  assert.ok(id);
  await call('POST', `/api/leads/${id}/outcome`, { outcome: 'no_answer' });
  r = await call('GET', '/api/dialer/resume');
  assert.equal(r.data.last.business, 'Shore Plumbing');
  assert.equal(r.data.calls, 1);
});
