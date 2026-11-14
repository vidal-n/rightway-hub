// Callbacks stay with the teammate who set them; no answer or voicemail waits 24 hours (Nov 2026, V: so we do not get sued).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
import { callRule, factsFrom, RETRY_MS } from '../public/js/callrules.js';

test('callRule: callbacks are the setter\'s, no answer waits 24 hours, owners can still take a callback', () => {
  const t = 1e12;
  const cb = { stage: 'callback', owner_id: 'u_creator' };
  const facts = { last: { outcome: 'callback', by: 'u_kiron', at: t - 3600e3 }, callbackBy: 'u_kiron' };
  assert.equal(callRule(cb, facts, { id: 'u_kiron', role: 'team' }, t), null);
  assert.equal(callRule(cb, facts, { id: 'u_other', role: 'team' }, t)?.code, 'callback');
  assert.equal(callRule(cb, facts, { id: 'u_v', role: 'admin' }, t), null);
  const na = { last: { outcome: 'voicemail', by: 'u_kiron', at: t - 3600e3 } };
  assert.equal(callRule({ stage: 'attempting' }, na, { id: 'u_other', role: 'team' }, t)?.code, 'wait24');
  assert.equal(callRule({ stage: 'attempting' }, na, { id: 'u_v', role: 'admin' }, t)?.code, 'wait24', 'owners wait too');
  assert.equal(callRule({ stage: 'attempting' }, na, { id: 'u_other', role: 'team' }, t + RETRY_MS), null, 'after 24 hours it is open');
  assert.equal(callRule({ stage: 'new' }, {}, { id: 'u_other', role: 'team' }, t), null);
  const m = factsFrom([{ lead_id: 'a', outcome: 'glitch', by: 'x', at: 3 }, { lead_id: 'a', outcome: 'no_answer', by: 'y', at: 2 }, { lead_id: 'a', outcome: 'callback', by: 'z', at: 1 }]);
  assert.equal(m.get('a').last.outcome, 'no_answer', 'a bad connection does not count');
  assert.equal(m.get('a').callbackBy, 'z');
});

test('the dialer queue and prepare keep another agent off a callback and off a lead that did not answer', async () => {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body, ck) => {
    const h = { 'x-rw': '1' };
    if (ck ?? cookie) h.cookie = ck ?? cookie;
    let payload;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set && ck === undefined) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})), set };
  };
  assert.equal((await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' })).status, 200);
  const ownerCookie = cookie;
  const inv = await call('POST', '/api/team/invite', { email: 'kiron@rightwaygrowth.com', name: 'Kiron', role: 'team' });
  const acc = await call('POST', '/api/auth/invite/accept', { token: inv.data.inviteUrl.split('/#/invite/')[1], password: 'another long password' }, '');
  const kiron = acc.set.split(';')[0];
  const imp = await call('POST', '/api/leads/import', { rows: ['Alpha', 'Bravo', 'Charlie'].map((n, i) => ({ business: `${n} Roofing`, phone: `305-555-01${30 + i}`, state: 'FL', city: 'Miami', industry: 'roofing' })), merge: false }, ownerCookie);
  assert.equal(imp.data.imported, 3);
  const list = (await call('GET', '/api/leads', undefined, ownerCookie)).data.leads;
  const id = (n) => list.find((l) => l.business === `${n} Roofing`).id;
  const real = Date.now; const at = new Date(real()); at.setUTCHours(16, 0, 0, 0); Date.now = () => at.getTime();
  try {
    // V (owner) sets a callback on Alpha and gets no answer on Bravo.
    const when = Date.now() + 6 * 3600e3;
    assert.equal((await call('POST', `/api/leads/${id('Alpha')}/outcome`, { dispo: 'callback', callbackAt: when }, ownerCookie)).status, 200);
    assert.equal((await call('POST', `/api/leads/${id('Bravo')}/outcome`, { dispo: 'no_answer' }, ownerCookie)).status, 200);
    await env.DB.prepare('UPDATE leads SET last_call_at = ? WHERE id IN (?, ?)').bind(Date.now() - 5 * 3600e3, id('Alpha'), id('Bravo')).run();
    await env.DB.prepare('UPDATE activities SET at = ? WHERE lead_id IN (?, ?)').bind(Date.now() - 5 * 3600e3, id('Alpha'), id('Bravo')).run();
    await call('PUT', '/api/dialer/campaign', { ids: [id('Alpha'), id('Bravo'), id('Charlie')] }, ownerCookie);
    let q = await call('GET', '/api/dialer/queue?campaign=1', undefined, ownerCookie);
    assert.deepEqual(q.data.queue.map((l) => l.business).sort(), ['Alpha Roofing', 'Charlie Roofing'], 'V keeps his own callback, Bravo waits 24 hours');
    await call('DELETE', '/api/dialer/campaign', undefined, ownerCookie); // V closes out, so the leads are free for Kiron's list
    // Kiron saves the same list: Alpha (V's callback) and Bravo (no answer) stay out, only the new lead is his.
    await call('PUT', '/api/dialer/campaign', { ids: [id('Alpha'), id('Bravo'), id('Charlie')] }, kiron);
    q = await call('GET', '/api/dialer/queue?campaign=1', undefined, kiron);
    assert.deepEqual(q.data.queue.map((l) => l.business), ['Charlie Roofing']);
    // And a direct call is refused the same way.
    const chk = await call('GET', `/api/leads/${id('Alpha')}/call-check`, undefined, kiron);
    assert.equal(chk.data.ok, false);
    assert.match(chk.data.reason, /set this callback/);
    assert.equal((await call('GET', `/api/leads/${id('Bravo')}/call-check`, undefined, kiron)).data.ok, false);
    assert.equal((await call('GET', `/api/leads/${id('Charlie')}/call-check`, undefined, kiron)).data.ok, true);
    // 25 hours later Bravo is open to everyone.
    await env.DB.prepare('UPDATE activities SET at = ? WHERE lead_id = ?').bind(Date.now() - 25 * 3600e3, id('Bravo')).run();
    await env.DB.prepare('UPDATE leads SET last_call_at = ? WHERE id = ?').bind(Date.now() - 25 * 3600e3, id('Bravo')).run();
    await env.DB.prepare("UPDATE leads SET next_action_at = ? WHERE id = ?").bind(Date.now() - 3600e3, id('Bravo')).run();
    assert.equal((await call('GET', `/api/leads/${id('Bravo')}/call-check`, undefined, kiron)).data.ok, true);
  } finally { Date.now = real; }
});
