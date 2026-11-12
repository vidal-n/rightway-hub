import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
import { buildPack, whyThey } from '../public/js/pack.js';
import { packHtml, packParts } from '../public/js/packview.js';

const lead = { business: 'Joe Plumbing', city: 'Miami', state: 'FL', industry: 'plumbing', score: 88, notes: 'SECRET NOTE', quote: '{"monthly":999}' };
const intel = { found: true, keyword: 'plumber', rank: 7, listing: { rating: 4.1, reviews: 12, category: 'Plumber', url: '', photos: 5 },
  competitors: [{ title: 'Big Pipes', rating: 4.9, reviews: 210, category: 'Plumbing contractor', domain: 'bigpipes.com', wins: 6, best: 1 }],
  grid: { size: 3, radiusMiles: 3, points: 9, top3: 1, top10: 3, avg: 12, cells: Array.from({ length: 9 }, (_, i) => ({ row: 0, col: i, rank: i % 3 ? 15 : 2, error: false, top: [] })) } };

test('pack says exactly why a competitor is ahead, from numbers we have', () => {
  const p = buildPack(lead, { intel });
  assert.equal(p.ready, true);
  const why = p.competitors[0].why.join(' | ');
  assert.match(why, /198 more Google reviews/);
  assert.match(why, /Higher rating/);
  assert.match(why, /Top 3 in 6 of the 9/);
  assert.match(p.headline, /3 of 9 spots/);
  assert.ok(p.foundation.length > 0);
  assert.ok(p.growth.find((g) => g.id === 'website').fit === 'high');
  assert.equal(p.cadence.length, 3);
});

test('pack carries nothing internal and no dashes', () => {
  const p = buildPack(lead, { intel });
  const text = JSON.stringify(p) + packHtml(p);
  assert.doesNotMatch(text, /SECRET NOTE|999|score|\$\d/);
  assert.doesNotMatch(text, /[–—]/);
  assert.deepEqual(Object.keys(packParts(p)), ['overview', 'competitors', 'compare', 'cost', 'why', 'plan']);
});

test('the client view never mentions a website, the closer view keeps the data', () => {
  const p = buildPack(lead, { intel });
  const client = packHtml(p) + Object.values(packParts(p)).join('');
  assert.doesNotMatch(client, /website|Website/);
  assert.ok(p.reasons.some((r) => r.site), 'website problems stay in the data');
  const closer = Object.values(packParts(p, { closer: true })).join('');
  assert.match(closer, /Website build or rebuild/);
  assert.match(closer, /closer only/);
});

test('the analysis shows the side by side, the review math and what waiting costs from real numbers', () => {
  const p = buildPack(lead, { intel });
  assert.ok(p.compare.find((r) => r.label === 'Google reviews' && r.you === 12 && r.them === 210));
  assert.equal(p.reviewMath.gap, 199);
  assert.ok(p.urgency.length >= 3);
  assert.match(p.urgency[0].line, /6 of the 9 spots/);
});

test('no research means not ready, with a reason', () => {
  const p = buildPack(lead, {});
  assert.equal(p.ready, false);
  assert.match(p.reason, /research/);
  assert.match(packHtml(p), /research/);
});

test('whyThey skips gaps that are not real', () => {
  assert.deepEqual(whyThey({ reviews: 14, rating: 4.2 }, { reviews: 12, rating: 4.1, hasSite: true }, null), []);
});

test('pack routes: build, save a private link, public page, send needs email', async () => {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body, pub) => {
    const h = {}; if (!pub) h['x-rw'] = '1'; if (cookie && !pub) h.cookie = cookie;
    let payload; if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'Vidal Newton', password: 'correct horse battery' });
  const id = (await call('POST', '/api/leads', { business: 'Joe Plumbing', phone: '3055550999', city: 'Miami', state: 'FL', industry: 'plumbing' })).data.lead.id;
  const g0 = await call('GET', `/api/leads/${id}/pack`);
  assert.equal(g0.status, 200);
  assert.equal(g0.data.pack.ready, false);
  assert.equal((await call('POST', `/api/leads/${id}/pack`, {})).status, 400);
  await env.DB.prepare('UPDATE leads SET intel = ? WHERE id = ?').bind(JSON.stringify(intel), id).run();
  const saved = await call('POST', `/api/leads/${id}/pack`, {});
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const t = saved.data.link.split('#')[1];
  const pub = await call('GET', `/api/public/analysis/${t}`, undefined, true);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.pack.business, 'Joe Plumbing');
  assert.doesNotMatch(JSON.stringify(pub.data), /3055550999|"notes"|"email"|"quote"|"score"/);
  assert.equal((await call('GET', '/api/public/analysis/nope', undefined, true)).status, 404);
  assert.equal((await call('GET', `/api/leads/${id}/pack`)).data.saved.views, 1);
  assert.equal((await call('POST', `/api/leads/${id}/pack/send`, {})).status, 400);
});
