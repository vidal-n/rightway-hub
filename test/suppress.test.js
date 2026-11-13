import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
import { rowsFor, scanText, scanChunk, numberOfLine, reasonForAct, registryAge, REASONS, tenDigits } from '../public/js/suppress.js';

test('rows: phone only reasons block just the phone, all reasons block every key, deleted blocks nothing', () => {
  const lead = { business: 'Alpha Roofing LLC', phone: '(305) 555-0121', website: 'https://alpharoofing.com', city: 'Miami' };
  const phoneOnly = rowsFor(lead, 'bad_number');
  assert.deepEqual(phoneOnly.filter((r) => r.blocks).map((r) => r.key), ['p:3055550121']);
  assert.ok(phoneOnly.length >= 3, 'the website and the name are kept for dedupe');
  assert.ok(rowsFor(lead, 'dnc').every((r) => r.blocks === 1));
  assert.ok(rowsFor(lead, 'dead').every((r) => r.blocks === 1));
  assert.ok(rowsFor(lead, 'deleted').every((r) => r.blocks === 0));
  assert.deepEqual(rowsFor(lead, 'nonsense'), []);
});

test('which call results go on the list', () => {
  for (const a of ['dnc', 'bad_number', 'phone_menu', 'dead']) assert.ok(reasonForAct(a), a);
  assert.equal(reasonForAct('not_interested'), null, 'recycles by default');
  assert.equal(reasonForAct('not_interested', ['not_interested']), 'dead', 'unless an owner switches it on');
  assert.equal(reasonForAct('no_answer'), null);
  assert.ok(REASONS.dnc.legal && REASONS.registry.legal && !REASONS.dead.legal);
});

test('registry files: FTC style lines, plain digits, chunks split mid line', () => {
  assert.equal(numberOfLine('305,5550121'), '3055550121');
  assert.equal(numberOfLine('1-305-555-0122'), '3055550122');
  assert.equal(numberOfLine('12345'), '');
  const wanted = new Set(['3055550121', '3055550122', '9545550199']);
  const found = scanText('305,5550121\n212,5550000\n1 (305) 555-0122\r\n954,5550199', wanted);
  assert.deepEqual([...found].sort(), ['3055550121', '3055550122', '9545550199']);
  const f2 = new Set();
  let carry = scanChunk('305,5550121\n954,55', wanted, f2);
  assert.equal(carry, '954,55');
  carry = scanChunk(`${carry}50199\n`, wanted, f2);
  assert.deepEqual([...f2].sort(), ['3055550121', '9545550199']);
  assert.equal(tenDigits('+1 305 555 0121'), '3055550121');
});

test('registry age: stale after 31 days or never', () => {
  const t = Date.now();
  assert.equal(registryAge(0, t).stale, true);
  assert.equal(registryAge(t - 5 * 864e5, t).stale, false);
  assert.equal(registryAge(t - 31 * 864e5, t).stale, true);
});

test('do not call list end to end: results, delete, re-import, lift, registry', async () => {
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
  const rows = [
    { business: 'Alpha Roofing', phone: '305-555-0121', website: 'https://alpharoofing.com', state: 'FL', city: 'Miami' },
    { business: 'Bravo HVAC', phone: '305-555-0122', state: 'FL', city: 'Miami' },
    { business: 'Charlie Plumbing', phone: '305-555-0123', state: 'FL', city: 'Miami' },
    { business: 'Delta Electric', phone: '305-555-0124', state: 'FL', city: 'Miami' },
    { business: 'Echo Painting', phone: '305-555-0125', state: 'FL', city: 'Miami' },
  ];
  r = await call('POST', '/api/leads/import', { rows });
  assert.equal(r.data.imported, 5);
  const list = (await call('GET', '/api/leads')).data.leads;
  const id = (n) => list.find((l) => l.business === n).id;

  // A bad number result: the lead stays, the list has it, a re-import of the same business is skipped.
  r = await call('POST', `/api/leads/${id('Alpha Roofing')}/outcome`, { dispo: 'bad_number' });
  assert.equal(r.status, 200);
  r = await call('GET', '/api/suppress');
  const alpha = r.data.items.find((i) => i.business === 'Alpha Roofing');
  assert.equal(alpha.reason, 'bad_number');
  assert.equal(alpha.source, 'call');
  r = await call('GET', `/api/leads/${id('Alpha Roofing')}`);
  assert.equal(r.data.suppression.reason, 'bad_number');
  assert.equal(r.data.lead.stage, 'lost', 'the lead stays in the database');

  // Delete it: the entry survives, and importing the same business again is kept out.
  assert.equal((await call('DELETE', `/api/leads/${id('Alpha Roofing')}`)).status, 200);
  r = await call('POST', '/api/leads/import', { rows: [rows[0], { business: 'Foxtrot Gutters', phone: '305-555-0126', state: 'FL', city: 'Miami' }] });
  assert.equal(r.data.imported, 1);
  assert.equal(r.data.skippedBy.suppressed, 1);
  r = await call('GET', '/api/suppress/stats');
  assert.ok(r.data.kept_out >= 1, 'the re-scrape is counted');

  // A deleted lead that was not on the list is remembered too (no calls blocked, just no second copy).
  assert.equal((await call('DELETE', `/api/leads/${id('Echo Painting')}`)).status, 200);
  r = await call('POST', '/api/leads/import', { rows: [rows[4]] });
  assert.equal(r.data.imported, 0);
  assert.equal(r.data.skippedBy.suppressed, 1);
  r = await call('GET', '/api/suppress?reason=deleted');
  assert.equal(r.data.items.length, 1);
  const grp = r.data.items[0].grp;
  r = await call('POST', '/api/suppress/lift', { grp });
  assert.equal(r.status, 200);
  r = await call('POST', '/api/leads/import', { rows: [rows[4]] });
  assert.equal(r.data.imported, 1, 'lifted, so it can be added again');

  // Dead lead: lost, tagged, on the list, and liftable.
  r = await call('POST', `/api/leads/${id('Bravo HVAC')}/outcome`, { dispo: 'dead' });
  assert.equal(r.status, 200);
  assert.equal(r.data.lead.stage, 'lost');
  r = await call('GET', '/api/suppress?reason=dead');
  assert.equal(r.data.items[0].business, 'Bravo HVAC');
  r = await call('POST', '/api/suppress/lift', { grp: r.data.items[0].grp });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', `/api/leads/${id('Bravo HVAC')}`)).data.lead.stage, 'new');

  // Do not call: permanent, even when the lead is deleted or the list is searched for a lift.
  r = await call('POST', `/api/leads/${id('Charlie Plumbing')}/outcome`, { dispo: 'dnc' });
  assert.equal(r.status, 200);
  r = await call('GET', '/api/suppress?reason=dnc');
  assert.equal(r.data.items[0].legal, true);
  r = await call('POST', '/api/suppress/lift', { grp: r.data.items[0].grp });
  assert.equal(r.status, 409);

  // Add by hand with a stage move (the old DNC stage path also lands on the list).
  r = await call('PATCH', `/api/leads/${id('Delta Electric')}`, { stage: 'dnc' });
  assert.equal(r.status, 200);
  r = await call('GET', '/api/suppress?q=delta');
  assert.equal(r.data.items[0].reason, 'dnc');

  // Registry upload: matching numbers become do not call.
  r = await call('GET', '/api/suppress/phones');
  assert.ok(r.data.phones.includes('3055550126'));
  r = await call('POST', '/api/suppress/registry', { label: 'National DNC test', phones: ['3055550126'], checked: 1, final: true });
  assert.equal(r.data.matched, 1);
  r = await call('GET', '/api/suppress/stats');
  assert.equal(r.data.registry.stale, false);
  assert.equal(r.data.registry.log[0].matched, 1);
  assert.ok(r.data.by.registry >= 1);
  const fox = (await call('GET', '/api/leads')).data.leads.find((l) => l.business === 'Foxtrot Gutters');
  assert.equal(fox.stage, 'dnc');

  // Typing a listed number into the dialer is refused (no Twilio keys here, so check the guard directly).
  const { blockedPhone } = await import('../src/suppress.js');
  assert.ok(await blockedPhone(env, '305-555-0126'));
  assert.equal(await blockedPhone(env, '305-555-0199'), null);

  // Optional: not interested goes on the list only when an owner switches it on.
  const echo = (await call('GET', '/api/leads')).data.leads.find((l) => l.business === 'Echo Painting');
  r = await call('POST', `/api/leads/${echo.id}/outcome`, { dispo: 'not_interested' });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/api/suppress?q=echo')).data.items.length, 0);
  assert.equal((await call('PUT', '/api/suppress/settings', { optional: ['not_interested', 'bogus'] })).data.optional.join(), 'not_interested');
});
