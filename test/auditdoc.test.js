import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAudit, sectionsOf, jobCalc, solutionFor, passPlan } from '../public/js/auditdoc.js';

const lead = { business: 'Joe Plumbing', city: 'Miami', state: 'FL', industry: 'plumbing', contact_name: 'Joe', notes: 'SECRET NOTE' };
const intel = { found: true, keyword: 'plumber', rank: 7, listing: { rating: 4.1, reviews: 12, category: 'Plumber', url: '', photos: 5 },
  competitors: [{ title: 'Big Pipes', rating: 4.9, reviews: 210, category: 'Plumbing contractor', domain: 'bigpipes.com', wins: 6, best: 1 }, { title: 'Pipe Pros', rating: 4.5, reviews: 90, category: 'Plumber', domain: '', wins: 2, best: 3 }],
  grid: { size: 3, radiusMiles: 3, points: 9, top3: 1, top10: 3, avg: 12, cells: Array.from({ length: 9 }, (_, i) => ({ row: 0, col: i, rank: i % 3 ? 15 : 2, error: false, top: [] })) } };
const listings = { counts: { mismatch: 1, missing: 1, match: 1 }, results: [{ name: 'Yelp', status: 'mismatch', notes: ['Different phone 305'] }, { name: 'Bing', status: 'missing' }, { name: 'Apple', status: 'match' }] };

test('audit has every section with exact numbers from the research', () => {
  const a = buildAudit(lead, { intel, listings });
  assert.equal(a.ready, true);
  assert.equal(a.scans.length, 1);
  assert.equal(a.scans[0].top10, 3);
  assert.equal(a.citations.rows.length, 3, 'the full table, not only the bad rows');
  assert.equal(a.citations.rows[0].status, 'mismatch');
  assert.match(a.competitors[0].pass.join(' '), /199 more reviews/);
  assert.match(a.competitors[0].pass.join(' '), /bigpipes\.com/);
  assert.ok(a.fixes.every((f) => f.steps.length > 0));
  assert.ok(a.fixes.some((f) => f.key === 'citations'));
  assert.equal(a.ninety.length, 3);
  assert.deepEqual(sectionsOf(a).map((s) => s[0]), ['summary', 'scan', 'ahead', 'passing', 'profile', 'citations', 'fixes', 'plan', 'roadmap']);
});
test('the report has no notes, no prices, no dashes, no promised spots', () => {
  const a = buildAudit(lead, { intel, listings, quote: { setup: 1500, monthly: 777 } });
  const text = JSON.stringify({ ...a, quote: undefined });
  assert.doesNotMatch(text, /SECRET NOTE|\$\d|1500|777/);
  assert.doesNotMatch(text, /[–—]/);
  assert.doesNotMatch(text, /(?<!cannot )guarantee(d)? (a )?(top|spot|rank)/i);
});
test('no research means nothing to show and a plain reason', () => {
  const a = buildAudit(lead, {});
  assert.equal(a.ready, false);
  assert.ok(a.reason);
  assert.deepEqual(sectionsOf(a), []);
});
test('job calculator: revenue, cost per job, jobs to cover, return', () => {
  const c = jobCalc({ ticket: 500, jobs: 4, monthly: 1000 });
  assert.equal(c.revenue, 2000);
  assert.equal(c.yearly, 24000);
  assert.equal(c.costPerJob, 250);
  assert.equal(c.jobsToCover, 2);
  assert.equal(c.multiple, 2);
  const blank = jobCalc({ ticket: 500, jobs: 4, monthly: '' });
  assert.equal(blank.costPerJob, null, 'no monthly typed means no made up price');
  assert.equal(blank.multiple, null);
});
test('solutions fall back to the research fix text and use the numbers', () => {
  const s = solutionFor({ key: 'review_gap', severity: 'medium', title: 't', detail: 'd' }, { gap: 100, perMonth: 10, leader: 'Big Pipes' });
  assert.match(s.steps[0], /100 reviews to pass Big Pipes/);
  assert.match(s.steps[0], /10 months/);
  assert.deepEqual(solutionFor({ key: 'unknown_key', severity: 'low', title: 't', detail: 'd', fix: 'Do the thing' }).steps, ['Do the thing']);
});
test('passPlan says when you already lead on reviews', () => {
  const p = passPlan({ name: 'X', reviews: 5, rating: 4, category: 'Plumber', wins: 0, domain: '' }, { reviews: 20, rating: 4.5, category: 'Plumber' }, null, null);
  assert.match(p[0], /already have more/);
});
