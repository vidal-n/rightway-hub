import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, all, run } from '../src/db.js';
import { d1, r2 } from './shims.mjs';

function setup() {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' }; if (cookie) h.cookie = cookie; if (body !== undefined) h['content-type'] = 'application/json';
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }), env);
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  return { env, call };
}

test('csv import merges name variants and repeats, and never removes a client', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const a = await t.call('POST', '/api/leads/import', { rows: [{ business: 'Bayside Roofing', phone: '305-555-0111', city: 'Miami', state: 'FL' }] });
  assert.equal(a.data.imported, 1);
  // Same business, different phone, legal name and SEO tail: merged into the existing lead, not added.
  const b = await t.call('POST', '/api/leads/import', { rows: [{ business: 'Bayside Roofing LLC | Miami Roofer', phone: '305-555-0999', city: 'Miami', state: 'FL' }] });
  assert.equal(b.data.imported, 0, 'the variant is recognised as the same business at import');
  assert.equal(b.data.skippedBy.name, 1);
  let leads = (await t.call('GET', '/api/leads')).data.leads.filter((l) => /bayside/i.test(l.business));
  assert.equal(leads.length, 1, 'one Bayside left');
  // Within one file: two copies of the same business collapse.
  await t.call('POST', '/api/leads/import', { rows: [
    { business: 'Oak Plumbing Inc', phone: '305-555-0201', city: 'Hialeah', state: 'FL' },
    { business: 'Oak Plumbing', phone: '305-555-0202', city: 'Hialeah', state: 'FL' },
  ] });
  leads = (await t.call('GET', '/api/leads')).data.leads.filter((l) => /oak plumbing/i.test(l.business));
  assert.equal(leads.length, 1);
  // A lead that is a client is kept even when a new copy matches it.
  await run(t.env, "UPDATE leads SET client_id = 'cl_test' WHERE id = ?", leads[0].id);
  const c = await t.call('POST', '/api/leads/import', { rows: [{ business: 'Oak Plumbing LLC', phone: '305-555-0203', city: 'Hialeah', state: 'FL' }] });
  const after = (await t.call('GET', '/api/leads')).data.leads.filter((l) => /oak plumbing/i.test(l.business));
  assert.ok(after.some((l) => l.client_id === 'cl_test'), 'the client lead survives');
  assert.equal(c.data.imported, 0);
});
