// A lead on one agent's call list cannot be on another agent's list until the first closes the campaign out (Nov 2026, V).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';

test('list claims: held leads stay off other lists, calls and queues until the holder closes out', async () => {
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
  const owner = cookie;
  const inv = await call('POST', '/api/team/invite', { email: 'kiron@rightwaygrowth.com', name: 'Kiron', role: 'team' });
  const acc = await call('POST', '/api/auth/invite/accept', { token: inv.data.inviteUrl.split('/#/invite/')[1], password: 'another long password' }, '');
  const kiron = acc.set.split(';')[0];
  await call('POST', '/api/leads/import', { rows: ['Alpha', 'Bravo', 'Charlie'].map((n, i) => ({ business: `${n} Roofing`, phone: `305-555-02${30 + i}`, state: 'FL', city: 'Miami', industry: 'roofing' })), merge: false }, owner);
  const list = (await call('GET', '/api/leads', undefined, owner)).data.leads;
  const id = (n) => list.find((l) => l.business === `${n} Roofing`).id;
  // Nothing loaded yet: the dialer's own request says it needs a list.
  const none0 = await call('GET', '/api/dialer/queue?campaign=1', undefined, kiron);
  assert.equal(none0.data.campaign, null);
  assert.equal(none0.data.needList, true);
  assert.deepEqual(none0.data.queue, []);
  const real = Date.now; const at = new Date(real()); at.setUTCHours(16, 0, 0, 0); Date.now = () => at.getTime();
  try {
    // V loads Alpha and Bravo.
    assert.equal((await call('PUT', '/api/dialer/campaign', { ids: [id('Alpha'), id('Bravo')], label: 'Roofers' }, owner)).data.total, 2);
    // Kiron asks for all three: only Charlie is his.
    const k = await call('PUT', '/api/dialer/campaign', { ids: [id('Alpha'), id('Bravo'), id('Charlie')], label: 'Kiron list' }, kiron);
    assert.equal(k.status, 200);
    assert.equal(k.data.total, 1);
    assert.equal(k.data.taken, 2);
    assert.equal(k.data.takenBy[0].name, 'V');
    // Asking for only held leads is refused.
    const none = await call('PUT', '/api/dialer/campaign', { ids: [id('Alpha')], label: 'x' }, kiron);
    assert.equal(none.status, 409);
    assert.match(none.data.error, /close out/);
    // Kiron's list is still just Charlie after the refusal, and his queue shows only Charlie.
    let q = await call('GET', '/api/dialer/queue?campaign=1', undefined, kiron);
    assert.deepEqual(q.data.queue.map((l) => l.business), ['Charlie Roofing']);
    // Even the plain queue (no list) never serves V's leads to Kiron.
    q = await call('GET', '/api/dialer/queue', undefined, kiron);
    assert.ok(!q.data.queue.some((l) => ['Alpha Roofing', 'Bravo Roofing'].includes(l.business)));
    // Direct calls: refused with who holds it; V can call his own; nobody holds Charlie from V's side.
    const chk = await call('GET', `/api/leads/${id('Alpha')}/call-check`, undefined, kiron);
    assert.equal(chk.data.ok, false);
    assert.match(chk.data.reason, /V has this lead on a call list/);
    assert.equal((await call('GET', `/api/leads/${id('Alpha')}/call-check`, undefined, owner)).data.ok, true);
    assert.equal((await call('GET', `/api/leads/${id('Charlie')}/call-check`, undefined, owner)).data.ok, false, 'Kiron holds Charlie now');
    // The Pipeline's view of who holds what.
    const cl = await call('GET', '/api/dialer/claims', undefined, kiron);
    assert.equal(cl.data.lists.length, 1);
    assert.equal(cl.data.lists[0].name, 'V');
    assert.equal(cl.data.held[id('Alpha')], 0);
    assert.equal(cl.data.mine.total, 1);
    // Only owners close someone else's campaign.
    assert.equal((await call('DELETE', `/api/dialer/campaign?user=${cl.data.lists[0].userId}`, undefined, kiron)).status, 403);
    // V closes out his own: Alpha and Bravo are free.
    const out = await call('DELETE', '/api/dialer/campaign', undefined, owner);
    assert.equal(out.data.freed, 2);
    assert.equal((await call('GET', `/api/leads/${id('Alpha')}/call-check`, undefined, kiron)).data.ok, true);
    const again = await call('PUT', '/api/dialer/campaign', { ids: [id('Alpha'), id('Bravo'), id('Charlie')], label: 'all' }, kiron);
    assert.equal(again.data.total, 3);
    assert.equal(again.data.taken, 0);
    // An owner can release a teammate's campaign.
    const kid = (await call('GET', '/api/dialer/claims', undefined, owner)).data.lists[0].userId;
    const rel = await call('DELETE', `/api/dialer/campaign?user=${kid}`, undefined, owner);
    assert.equal(rel.status, 200);
    assert.equal(rel.data.freed, 3);
  } finally { Date.now = real; }
});
