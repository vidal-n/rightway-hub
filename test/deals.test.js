import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';

function setup(extra = {}) {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', ...extra };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' };
    if (cookie) h.cookie = cookie;
    let payload;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
  };
  return { env, call };
}
const owner = (t) => t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });

test('deal desk: search, quick add, work order from typed amounts, email send needs an address and an email service', async () => {
  const t = setup();
  await owner(t);
  const lead = (await t.call('POST', '/api/leads', { business: 'Barajas Roofing', phone: '7865550166', city: 'Miami', state: 'FL' })).data;
  const id = lead.id || lead.lead?.id;
  let r = await t.call('GET', '/api/deals/search?q=baraj');
  assert.equal(r.data.leads.length, 1);
  assert.equal((await t.call('GET', '/api/deals/search?q=5550166')).data.leads.length, 1, 'finds by phone digits');
  assert.equal((await t.call('GET', '/api/deals/search?q=b')).data.leads.length, 0, 'one letter is not a search');

  r = await t.call('POST', '/api/deals/lead', { business: 'New Roof Co', phone: '(305) 555-0199', email: 'a@b.com' });
  assert.equal(r.status, 200);
  assert.equal(r.data.existing, false);
  assert.equal((await t.call('POST', '/api/deals/lead', { business: 'Again', phone: '3055550199' })).data.existing, true, 'same phone is the same business');
  assert.equal((await t.call('POST', '/api/deals/lead', { business: '' })).status, 400);
  assert.equal((await t.call('POST', '/api/deals/lead', { business: 'X Co', email: 'nope' })).status, 400);

  // No typed amounts, no work order.
  r = await t.call('POST', `/api/leads/${id}/work-order`, { kind: 'seo' });
  assert.equal(r.status, 400);
  r = await t.call('POST', `/api/leads/${id}/work-order`, { kind: 'seo', setup: '1500', monthly: '750' });
  assert.equal(r.status, 200);
  assert.match(r.data.url, /\/sign\.html#/);

  const d = (await t.call('GET', `/api/leads/${id}/deal`)).data;
  assert.equal(d.lead.business, 'Barajas Roofing');
  assert.equal(d.orders.length, 1);
  assert.equal(d.orders[0].setup_cents, 150000);
  assert.equal(d.orders[0].token, undefined, 'the raw token is not sent, only the link');
  assert.match(d.orders[0].url, /sign\.html#/);

  assert.equal((await t.call('POST', `/api/work-orders/${d.orders[0].id}/send`, { to: 'not an email' })).status, 400);
  r = await t.call('POST', `/api/work-orders/${d.orders[0].id}/send`, { to: 'owner@barajas.com' });
  assert.equal(r.status, 409, 'no Resend key and no Gmail: say so plainly');
  assert.match(r.data.error, /Copy the link/);
});

test('deal desk: sends the work order through Resend and logs it', async () => {
  const t = setup({ RESEND_API_KEY: 're_test' });
  await owner(t);
  const lead = (await t.call('POST', '/api/leads', { business: 'Barajas Roofing', phone: '7865550166', city: 'Miami', state: 'FL' })).data;
  const id = lead.id || lead.lead?.id;
  await t.call('POST', `/api/leads/${id}/work-order`, { kind: 'seo', setup: '1500', monthly: '750' });
  const o = (await t.call('GET', `/api/leads/${id}/deal`)).data.orders[0];
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (u, init = {}) => { if (String(u).includes('api.resend.com')) { sent.push(JSON.parse(init.body)); return Response.json({ id: 'em1' }); } return real(u, init); };
  try {
    const r = await t.call('POST', `/api/work-orders/${o.id}/send`, { to: 'Owner@Barajas.com', message: 'Great talking today.' });
    assert.equal(r.status, 200);
    assert.equal(r.data.via, 'email');
  } finally { globalThis.fetch = real; }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to[0] || sent[0].to, 'owner@barajas.com');
  assert.match(sent[0].html, /sign\.html#/);
  assert.match(sent[0].html, /Great talking today/);
  assert.doesNotMatch(sent[0].html + sent[0].text, /[–—]/);
});

test('deal desk is for closers and owners: a setter is refused', async () => {
  const t = setup();
  await owner(t);
  const inv = await t.call('POST', '/api/team/invite', { email: 'sam@rightwaygrowth.com', name: 'Sam', role: 'team' });
  const tok = inv.data.inviteUrl.split('/#/invite/')[1];
  await t.call('POST', '/api/auth/logout', {});
  await t.call('POST', '/api/auth/invite/accept', { token: tok, password: 'another long password' });
  assert.equal((await t.call('GET', '/api/leads/x/deal')).status, 403);
  assert.equal((await t.call('POST', '/api/work-orders/x/send', { to: 'a@b.com' })).status, 403);
  assert.equal((await t.call('POST', '/api/deals/lead', { business: 'Nope Co' })).status, 403);
});

test('report sync keeps section keys and ignores junk', async () => {
  const t = setup();
  await owner(t);
  let r = await t.call('PUT', '/api/present/ld_1/sync', { k: 'scan' });
  assert.equal(r.data.k, 'scan');
  r = await t.call('PUT', '/api/present/ld_1/sync', { ck: 'citations' });
  assert.equal(r.data.ck, 'citations');
  assert.equal(r.data.cseq, 1);
  r = await t.call('PUT', '/api/present/ld_1/sync', { k: '<script>', ck: 'a b' });
  assert.equal(r.data.k, 'scan');
  assert.equal(r.data.cseq, 1);
});
