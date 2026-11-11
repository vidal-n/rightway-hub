import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { newFilingsUrl, NEW_FILING_STATES } from '../public/js/registries.js';
import { TARGET_INDUSTRIES } from '../public/js/leadintel.js';
import { d1, r2 } from './shims.mjs';

test('new filings: the date window, the industry words and the state domain', () => {
  const now = Date.UTC(2026, 10, 11);
  const u = newFilingsUrl('CO', { days: 90, stems: ['roof', 'plumb'], nowMs: now });
  assert.match(u, /^https:\/\/data\.colorado\.gov\/resource\/4ykn-tg5h\.json\?/);
  const where = decodeURIComponent(u.split('$where=')[1].split('&')[0]);
  assert.match(where, /^entityformdate >= '2026-08-13T/);
  assert.match(where, /upper\(entityname\) like '%ROOF%' OR upper\(entityname\) like '%PLUMB%'/);
  assert.equal(newFilingsUrl('TX', { days: 90, nowMs: now }), '', 'Texas has no free query');
  assert.deepEqual(NEW_FILING_STATES, ['CO', 'OR', 'CT', 'NY', 'PA']);
  const quote = newFilingsUrl('NY', { days: 30, stems: ["o'brien"], nowMs: now });
  assert.doesNotMatch(decodeURIComponent(quote), /o'brien'\)/i, 'quotes are escaped');
});

test('industry picker list: every industry has a keyword and a tier, no dashes', () => {
  assert.ok(TARGET_INDUSTRIES.length >= 20);
  for (const x of TARGET_INDUSTRIES) {
    assert.ok(x.label && x.keyword, x.label);
    assert.ok(['low', 'mid', 'high'].includes(x.tier));
    assert.doesNotMatch(`${x.label}${x.keyword}`, /[–—]/);
  }
});

test('the new filings route: owners only, states checked, rows normalised, failures reported per state', async () => {
  resetSchemaCache();
  const e = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (path) => { const h = { 'x-rw': '1' }; if (cookie) h.cookie = cookie; const r = await worker.fetch(new Request(`https://hub.test${path}`, { headers: h }), e); const s = r.headers.get('set-cookie'); if (s) cookie = s.split(';')[0]; return { status: r.status, data: await r.json().catch(() => ({})) }; };
  assert.equal((await call('/api/finder/new-filings?states=CO')).status, 401);
  await worker.fetch(new Request('https://hub.test/api/auth/setup', { method: 'POST', headers: { 'x-rw': '1', 'content-type': 'application/json' }, body: JSON.stringify({ accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' }) }), e).then((r) => { cookie = (r.headers.get('set-cookie') || '').split(';')[0]; });
  assert.equal((await call('/api/finder/new-filings?states=TX')).status, 400);
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => String(u).includes('data.colorado.gov')
    ? Response.json([{ entityname: 'ROOF PRO LLC', entityformdate: '2026-10-01T00:00:00.000', principalcity: 'DENVER', entitystatus: 'Good Standing' }])
    : new Response('x', { status: 503 });
  try {
    const r = await call('/api/finder/new-filings?states=CO,OR&days=60&industries=' + encodeURIComponent('roofing contractor|plumber'));
    assert.equal(r.status, 200);
    assert.equal(r.data.count, 1); assert.equal(r.data.filings[0].name, 'ROOF PRO LLC'); assert.equal(r.data.filings[0].state, 'CO');
    assert.equal(r.data.errors[0].state, 'OR');
  } finally { globalThis.fetch = real; }
});
