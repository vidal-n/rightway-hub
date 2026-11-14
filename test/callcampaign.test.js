import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';

// Call campaign (Pipeline Call setup) and the redial result.
test('the saved campaign is what the dialer runs: any stage but won and do not call, and a bad connection costs the lead nothing', async () => {
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
  let r = await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  assert.equal(r.status, 200);
  r = await call('POST', '/api/leads/import', { rows: ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((n, i) => ({ business: `${n} Roofing`, phone: `305-555-01${20 + i}`, state: 'FL', city: 'Miami', industry: 'roofing' })) });
  assert.equal(r.data.imported, 4);
  const list = (await call('GET', '/api/leads')).data.leads;
  const id = (n) => list.find((l) => l.business === `${n} Roofing`).id;
  await call('PATCH', `/api/leads/${id('Bravo')}`, { stage: 'not_now' });
  await call('PATCH', `/api/leads/${id('Charlie')}`, { stage: 'won' });
  await call('PATCH', `/api/leads/${id('Delta')}`, { stage: 'lost' });
  const real = Date.now;
  const at = new Date(real()); at.setUTCHours(16, 0, 0, 0);
  Date.now = () => at.getTime();
  try {
    r = await call('GET', '/api/dialer/campaign');
    assert.equal(r.data.total, 0);
    r = await call('PUT', '/api/dialer/campaign', { ids: [] });
    assert.equal(r.status, 400, 'an empty list is refused');
    r = await call('GET', '/api/dialer/queue?campaign=1');
    assert.equal(r.data.queue.length, 0, 'no saved list, nothing to dial');
    r = await call('PUT', '/api/dialer/campaign', { ids: [id('Alpha'), id('Bravo'), id('Charlie'), id('Delta')], label: '4 leads' });
    assert.equal(r.data.total, 4);
    r = await call('GET', '/api/dialer/queue?campaign=1');
    assert.deepEqual(r.data.queue.map((l) => l.business).sort(), ['Alpha Roofing', 'Bravo Roofing', 'Delta Roofing'], 'not now and lost leads can be picked, won clients cannot');
    assert.equal(r.data.campaign.total, 4);
    assert.equal(r.data.campaign.label, '4 leads');
    // a lead on the Do Not Call list never dials, even when it is in the saved list
    await call('PATCH', `/api/leads/${id('Alpha')}`, { stage: 'dnc' });
    r = await call('GET', '/api/dialer/queue?campaign=1');
    assert.ok(!r.data.queue.some((l) => l.business === 'Alpha Roofing'));
    // bad connection: nothing changes on the lead and no attempt is counted
    const before = (await call('GET', `/api/leads/${id('Bravo')}`)).data.lead;
    r = await call('POST', `/api/leads/${id('Bravo')}/outcome`, { dispo: 'glitch', note: 'Bad connection, redialed.' });
    assert.equal(r.status, 200);
    const after = (await call('GET', `/api/leads/${id('Bravo')}`)).data.lead;
    assert.equal(after.stage, before.stage);
    assert.equal(after.attempts || 0, before.attempts || 0, 'no attempt counted');
    assert.equal(after.last_call_at || null, before.last_call_at || null, 'no 3 hour wait');
    // the leads list tells the Pipeline who was already called, and what the last result was
    await call('POST', `/api/leads/${id('Delta')}/outcome`, { dispo: 'voicemail' });
    const rows = (await call('GET', '/api/leads')).data.leads;
    assert.equal(rows.find((l) => l.id === id('Delta')).attempts, 1);
    r = await call('DELETE', '/api/dialer/campaign');
    assert.equal(r.status, 200);
  } finally { Date.now = real; }
});

// V: a teammate called a lead already put on Do Not Call. The whole company shares one list, so copies of that business and tel: calls are covered too.
test('a Do Not Call business stays out of every list, copies with another phone included, and the phone link check says no', async () => {
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
  let r = await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  assert.equal(r.status, 200);
  r = await call('POST', '/api/leads/import', { rows: [
    { business: 'Alpha Roofing', phone: '305-555-0101', state: 'FL', city: 'Miami', industry: 'roofing' },
    { business: 'Bravo Plumbing', phone: '305-555-0102', state: 'FL', city: 'Miami', industry: 'plumbing' },
  ] });
  assert.equal(r.data.imported, 2);
  const list = (await call('GET', '/api/leads')).data.leads;
  const alpha = list.find((l) => l.business === 'Alpha Roofing').id, bravo = list.find((l) => l.business === 'Bravo Plumbing').id;
  // a second copy of Alpha with another number, added by hand after the import check (the copy path the importer cannot see)
  await env.DB.prepare("INSERT INTO leads (id, business, phone, phone_digits, state, city, stage, dnc, created_at, updated_at) VALUES ('copy-alpha', 'Alpha Roofing', '305-555-0199', '3055550199', 'FL', 'Miami', 'new', 0, 1, 1)").run();
  const real = Date.now;
  const at = new Date(real()); at.setUTCHours(16, 0, 0, 0);
  Date.now = () => at.getTime();
  try {
    r = await call('GET', `/api/leads/${alpha}/call-check`);
    assert.equal(r.data.ok, true, 'a clean lead can be called');
    r = await call('POST', `/api/leads/${alpha}/outcome`, { dispo: 'dnc' });
    assert.equal(r.status, 200);
    r = await call('GET', `/api/leads/${alpha}/call-check`);
    assert.equal(r.data.ok, false, 'the lead itself is refused');
    r = await call('GET', '/api/leads/copy-alpha/call-check');
    assert.equal(r.data.ok, false, 'a copy with another phone is refused too');
    assert.match(r.data.reason, /do not call/i);
    r = await call('PUT', '/api/dialer/campaign', { ids: [alpha, 'copy-alpha', bravo], label: 'mixed' });
    assert.equal(r.status, 200);
    assert.equal(r.data.total, 1, 'the saved list drops both Alpha rows');
    assert.equal(r.data.removed, 2);
    r = await call('PUT', '/api/dialer/campaign', { ids: [alpha, 'copy-alpha'] });
    assert.equal(r.status, 409, 'a list of only Do Not Call leads is refused');
    r = await call('GET', '/api/dialer/queue');
    assert.ok(!r.data.queue.some((l) => /Alpha/.test(l.business)), 'the normal queue never shows the business or its copy');
    assert.ok(r.data.queue.some((l) => l.business === 'Bravo Plumbing'));
  } finally { Date.now = real; }
});

test('a lead flagged Do Not Call before the list existed is put on it, and its copies are blocked', async () => {
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
  await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  await env.DB.prepare("INSERT INTO leads (id, business, phone, phone_digits, state, city, stage, dnc, created_at, updated_at) VALUES ('old-dnc', 'Delta Roofing', '305-555-0150', '3055550150', 'FL', 'Miami', 'dnc', 1, 1, 1), ('copy-delta', 'Delta Roofing', '305-555-0151', '3055550151', 'FL', 'Miami', 'new', 0, 1, 1)").run();
  const r = await call('GET', '/api/leads/copy-delta/call-check');
  assert.equal(r.data.ok, false);
  await env.DB.prepare("DELETE FROM settings WHERE k = 'supp_backfill'").run();
});
