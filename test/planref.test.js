import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_REF, PLAN_KEYS, INCLUDED_ALL, refFor, refLines, photosFor, adds } from '../public/js/planref.js';
import { urgencyFor, LF8 } from '../public/js/lifeforce.js';
import { quoteFor } from '../public/js/leadintel.js';
import { ninetyDayPlan } from '../public/js/fulfill.js';

test('the plan guide holds the chart prices under our own names', () => {
  assert.deepEqual(PLAN_KEYS.map((k) => [PLAN_REF[k].name, PLAN_REF[k].monthly]), [['Starter', 399], ['Growth', 549], ['Authority', 749], ['Market Leader', 998]]);
  assert.deepEqual([4, 6, 8, 12].map(photosFor), [20, 30, 40, 50]);
  assert.deepEqual(INCLUDED_ALL.map((x) => x.id), ['competitor_analysis', 'branding_call', 'hub_app']);
  assert.ok(!JSON.stringify(PLAN_REF).includes('Essentials') && !JSON.stringify(PLAN_REF).includes('Premier') && !JSON.stringify(PLAN_REF).toLowerCase().includes('save $'));
});

test('a scope lands on the plan its numbers need', () => {
  assert.equal(refFor([{ id: 'profile' }, { id: 'cleanup' }, { id: 'posts', qty: 4 }, { id: 'reviews' }]).key, 'starter');
  assert.equal(refFor([{ id: 'posts', qty: 6 }]).key, 'growth');
  assert.equal(refFor([{ id: 'posts', qty: 4 }, { id: 'pages', qty: 3 }]).key, 'growth');
  const a = refFor([{ id: 'posts', qty: 4 }, { id: 'links', qty: 6 }]);
  assert.equal(a.key, 'authority');
  assert.match(a.why.join(' '), /6 local links/);
  assert.equal(refFor([{ id: 'posts', qty: 12 }]).key, 'leader');
  assert.equal(refFor([{ id: 'locations' }]).key, 'leader');
  assert.equal(refFor([]).key, 'starter');
});

test('the guide gives the entry plan and the upsell, and says it is internal', () => {
  const r = refFor([{ id: 'posts', qty: 8 }]);
  assert.equal(r.entry.name, 'Starter');
  assert.equal(r.next.name, 'Market Leader');
  assert.ok(r.adds.some((x) => /Website overhaul/.test(x)));
  const lines = refLines([{ id: 'posts', qty: 4 }, { id: 'links', qty: 4 }]).join(' ');
  assert.match(lines, /Authority/);
  assert.match(lines, /loss leader/);
  assert.match(lines, /never this guide/i);
  assert.doesNotMatch(lines, /[–—]/);
  assert.ok(adds(PLAN_REF.starter, PLAN_REF.growth).some((x) => /Social media/.test(x)));
});

test('the quote carries the guide but never a default price', () => {
  const Q = quoteFor({ business: 'Joe', industry: 'plumber' }, null, null);
  assert.ok(Q.ref.name);
  assert.equal(Q.monthly, null);
  assert.equal(Q.setup, null);
});

test('life force 8: only real numbers become lines, unfit desires are skipped', () => {
  const u = urgencyFor({ business: 'Joe Plumbing', industry: 'Plumbing', grid: { points: 9, top10: 3, top3: 1 }, you: { reviews: 12, rating: 4.1 }, top: { name: 'Big Pipes', reviews: 210, rating: 4.9, wins: 6 } });
  const ids = u.lines.map((x) => x.id);
  assert.deepEqual(ids, ['survive', 'fear', 'superior', 'approval']);
  assert.match(u.lines[0].line, /6 of the 9 spots/);
  assert.match(u.lines[2].line, /198 more Google reviews/);
  assert.ok(u.skipped.find((x) => x.id === 'sex'));
  assert.ok(u.skipped.find((x) => x.id === 'food'));
  assert.ok(u.asks.length >= 6);
  assert.equal(LF8.length, 8);
  for (const l of u.lines) assert.doesNotMatch(l.line, /guarantee|only \d+ (spots|slots) left|today only|limited time|[–—]/i);
  const none = urgencyFor({ business: 'X', grid: null, you: {}, top: null });
  assert.equal(none.lines.length, 0);
  assert.ok(urgencyFor({ business: 'Taco Place', industry: 'Restaurant' }).lines.some((x) => x.id === 'food'));
});

test('the 90 day plan uses the deal\'s own numbers when given', () => {
  const nd = ninetyDayPlan('starter', null, {}, { posts: 6, pages: 3, links: 5 });
  const m2 = nd.months[1].items.join(' | ');
  assert.match(m2, /6 Google posts/);
  assert.match(m2, /3 new service or city pages/);
  assert.match(m2, /5 local links/);
  assert.ok(nd.fixes.every((f) => 'key' in f));
});
