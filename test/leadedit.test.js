// Edit lead (Nov 2026): fixing wrong information on a lead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';

async function boot() {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body) => {
    const headers = { 'x-rw': '1' };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, data: (res.headers.get('content-type') || '').includes('json') ? await res.json() : null };
  };
  const r = await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  assert.equal(r.status, 200);
  return { env, call };
}

test('editing a lead fixes the fields, clears stale checks, re-works the time zone and logs it', async () => {
  const { env, call } = await boot();
  const a = (await call('POST', '/api/leads', { business: 'ABC Roofing', phone: '305-555-0101', email: 'old@abc.com', city: 'Miami', state: 'FL' })).data.lead;
  await env.DB.prepare("UPDATE leads SET phone_type = 'mobile', email_status = 'ok' WHERE id = ?").bind(a.id).run();
  const r = await call('PATCH', `/api/leads/${a.id}`, { business: 'ABC Roofing LLC', owner_name: 'Mike Torres', phone: '(786) 555-0199', email: 'mike@abc.com', city: 'Denver', state: 'CO', zip: '80202', reviews: '41', rating: '4.6' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const l = r.data.lead;
  assert.equal(l.business, 'ABC Roofing LLC');
  assert.equal(l.owner_name, 'Mike Torres');
  assert.equal(l.phone_digits, '7865550199');
  assert.equal(l.phone_type, null);
  assert.equal(l.email_status, null);
  assert.equal(l.reviews, 41);
  assert.equal(l.timezone, 'America/Denver');
  const d = (await call('GET', `/api/leads/${a.id}`)).data;
  assert.ok(d.activities.some((x) => /^Edited .*phone: 305-555-0101 to \(786\) 555-0199/.test(x.body || '')));
});

test('editing rejects bad input and asks before a duplicate number', async () => {
  const { call } = await boot();
  const a = (await call('POST', '/api/leads', { business: 'One Plumbing', phone: '305-555-0111', state: 'FL' })).data.lead;
  const b = (await call('POST', '/api/leads', { business: 'Two Plumbing', phone: '305-555-0122', state: 'FL' })).data.lead;
  assert.equal((await call('PATCH', `/api/leads/${a.id}`, { business: '' })).status, 400);
  assert.equal((await call('PATCH', `/api/leads/${a.id}`, { phone: '555' })).status, 400);
  assert.equal((await call('PATCH', `/api/leads/${a.id}`, { email: 'nope' })).status, 400);
  const dup = await call('PATCH', `/api/leads/${a.id}`, { phone: '305-555-0122' });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.duplicate.id, b.id);
  assert.equal((await call('PATCH', `/api/leads/${a.id}`, { phone: '305-555-0122', force: true })).status, 200);
});

test('editing a phone to one on the do not call list is refused', async () => {
  const { call } = await boot();
  const a = (await call('POST', '/api/leads', { business: 'Nope Co', phone: '305-555-0133', state: 'FL' })).data.lead;
  const b = (await call('POST', '/api/leads', { business: 'Fine Co', phone: '305-555-0144', state: 'FL' })).data.lead;
  assert.equal((await call('PATCH', `/api/leads/${a.id}`, { stage: 'dnc' })).status, 200);
  const r = await call('PATCH', `/api/leads/${b.id}`, { phone: '305-555-0133' });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /do not call/i);
});
