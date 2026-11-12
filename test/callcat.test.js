import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callCategory, whoIs, CALL_CATS } from '../public/js/leadintel.js';

test('call category follows the strongest thing we know', () => {
  const base = { business: 'A', website: 'https://a.com', reviews: 80, rating: 4.8, stage: 'new', industry: 'roofing' };
  assert.equal(callCategory({ ...base, website: '' }).id, 'no_site');
  assert.equal(callCategory({ ...base, reviews: 9 }).id, 'reviews');
  assert.equal(callCategory({ ...base, rating: 3.9 }).id, 'rating');
  assert.equal(callCategory(base).id, 'general', 'unresearched with a fine profile has no clear angle');
  // Stage beats business facts.
  assert.equal(callCategory({ ...base, website: '', stage: 'audit_requested' }).id, 'asked');
  assert.equal(callCategory({ ...base, source: 'website' }).id, 'asked');
  assert.equal(callCategory({ ...base, stage: 'callback' }).id, 'followup');
  // Rank only counts once researched.
  assert.equal(callCategory({ ...base, map_rank: 14 }).id, 'general');
  assert.equal(callCategory({ ...base, map_rank: 14, intel_at: 1 }).id, 'off_page_one');
  assert.equal(callCategory({ ...base, map_rank: 21, intel_at: 1 }).id, 'off_page_one');
  assert.equal(callCategory({ ...base, map_rank: 6, intel_at: 1 }).id, 'close');
  assert.equal(callCategory({ ...base, map_rank: 2, intel_at: 1 }).id, 'strong');
  assert.equal(callCategory({ ...base, map_rank: 2, reviews: 10, intel_at: 1 }).id, 'reviews', 'top 3 but thin reviews is not strong');
  assert.equal(callCategory({ ...base, map_rank: null, intel_at: 1 }).id, 'not_found');
});

test('call category facts, tags and copy', () => {
  const c = callCategory({ website: '', reviews: 12, rating: 4.1, industry: 'roofing', phone_type: 'mobile', map_rank: 17, intel_at: 1 });
  assert.equal(c.id, 'no_site');
  assert.ok(c.facts.includes('12 reviews, 4.1 stars'));
  assert.ok(c.facts.includes('#17 on the map'));
  const tags = c.tags.map((t) => t.id);
  for (const id of ['off_page_one', 'reviews', 'rating', 'high_value', 'mobile']) assert.ok(tags.includes(id), id);
  assert.ok(!tags.includes('no_site'), 'the main category is not repeated as a tag');
  for (const x of CALL_CATS) assert.ok(!/[\u2013\u2014]/.test(x.label + x.lead), 'no dashes in copy');
  assert.equal(callCategory({}).id, 'no_site');
});

test('who to ask for', () => {
  // A label like "Front desk" is not a person, so it is never shown as a second name.
  assert.deepEqual(whoIs({ owner_name: 'Maria Lopez', contact_name: 'Front desk' }), { name: 'Maria Lopez', role: 'Owner', also: '', line: 'Ask for Maria Lopez', known: true });
  assert.equal(whoIs({ owner_name: 'Maria Lopez', contact_name: 'Sam Lee' }).also, 'Sam Lee');
  assert.equal(whoIs({ owner_name: 'Maria Lopez', contact_name: 'maria lopez' }).also, '');
  assert.equal(whoIs({ contact_name: 'Sam' }).role, 'Contact');
  assert.equal(whoIs({}).line, 'Ask for the owner');
  assert.equal(whoIs({}).known, false);
});

// ---- dialer queue: category filter and counts ----
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';

test('dialer queue counts call types, filters by one, and keeps names for the call bar', async () => {
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
    { business: 'No Site Roofing', phone: '305-555-0111', state: 'FL', city: 'Miami', industry: 'roofing', reviews: 40, rating: 4.7 },
    { business: 'Thin Reviews AC', phone: '305-555-0112', state: 'FL', city: 'Miami', industry: 'hvac', website: 'thinac.com', reviews: 6, rating: 4.9, contact_name: 'Maria Lopez' },
    { business: 'Fine Plumbing', phone: '305-555-0113', state: 'FL', city: 'Miami', industry: 'plumbing', website: 'fineplumbing.com', reviews: 90, rating: 4.8 },
  ] });
  assert.equal(r.data.imported, 3);
  // Today at 16:00 UTC: 11am or noon Eastern, inside calling hours, and the login session is still valid.
  const real = Date.now;
  const at = new Date(real()); at.setUTCHours(16, 0, 0, 0);
  Date.now = () => at.getTime();
  try {
    r = await call('GET', '/api/dialer/queue');
    assert.equal(r.data.cats.no_site, 1);
    assert.equal(r.data.cats.reviews, 1);
    assert.equal(r.data.cats.general, 1);
    r = await call('GET', '/api/dialer/queue?cat=reviews');
    assert.deepEqual(r.data.queue.map((l) => l.business), ['Thin Reviews AC']);
    assert.equal(r.data.queue[0].contact_name, 'Maria Lopez', 'the name needed on the call bar comes with the row');
    assert.equal(r.data.cats.no_site, 1, 'counts ignore the filter so the chips keep their size');
    r = await call('GET', '/api/dialer/queue?cat=nope');
    assert.equal(r.data.queue.length, 0);
  } finally { Date.now = real; }
});
