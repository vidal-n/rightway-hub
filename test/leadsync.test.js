// The Pipeline keeps every lead on the device and only downloads changes (Nov 2026, V: tens of thousands of leads, load everything).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
import { unpack, liveLead } from '../public/js/leadlive.js';

test('packed pages, no cap, changes since a moment, and deleted leads', async () => {
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
  const rows = Array.from({ length: 2600 }, (_, i) => ({ business: `Biz ${i}`, phone: `${300 + (i % 600)}-${String(200 + Math.floor(i / 600))}-${String(1000 + i).slice(-4)}`, state: ['FL', 'CA'][i % 2], city: 'X' }));
  for (let i = 0; i < rows.length; i += 500) await call('POST', '/api/leads/import', { rows: rows.slice(i, i + 500), merge: false });
  // Full download: more than one page, every lead, packed.
  let d = (await call('GET', '/api/leads?pack=1')).data;
  assert.ok(Array.isArray(d.cols) && d.cols.includes('business'));
  const total = d.total; assert.ok(total > 2500, `imported ${total}`);
  let got = unpack(d).length;
  while (d.next) { d = (await call('GET', `/api/leads?pack=1&after=${d.next}`)).data; got += unpack(d).length; }
  assert.equal(got, total, 'no cap: every lead comes down');
  // Nothing changed since now: an empty update.
  const mark = Date.now() + 1;
  await new Promise((r) => setTimeout(r, 5));
  d = (await call('GET', `/api/leads?pack=1&since=${mark}`)).data;
  assert.equal(unpack(d).length, 0);
  // One lead changes, one is deleted: only those come back.
  const first = unpack((await call('GET', '/api/leads?pack=1&limit=2')).data);
  await call('PATCH', `/api/leads/${first[0].id}`, { notes: 'changed' });
  await call('POST', '/api/leads/bulk', { ids: [first[1].id], action: 'delete' });
  d = (await call('GET', `/api/leads?pack=1&since=${mark}`)).data;
  const changed = unpack(d);
  assert.deepEqual(changed.map((l) => l.id), [first[0].id]);
  assert.deepEqual(d.gone, [first[1].id]);
  assert.equal(d.total, total - 1);
  // Time fields are worked out on the device.
  const l = liveLead({ ...changed[0], timezone: 'America/Los_Angeles' }, Date.UTC(2026, 10, 13, 20));
  assert.equal(l.tz_short, 'PT'); assert.equal(l.callable_now, true); assert.match(l.local_time, /12:00/);
});
