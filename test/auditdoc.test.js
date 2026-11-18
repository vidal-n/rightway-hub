import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAudit, sectionsOf, jobCalc, solutionFor, passPlan, reportCard, gradeOf } from '../public/js/auditdoc.js';

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
  assert.deepEqual(sectionsOf(a).map((s) => s[0]), ['summary', 'scan', 'citations', 'ahead', 'passing', 'profile', 'fixes', 'plan', 'roadmap', 'method']);
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

test('report card: letters from our scale, an overall, honest about what was not run', () => {
  assert.deepEqual([95, 85, 84, 70, 69, 55, 54, 40, 39, 0].map(gradeOf), ['A', 'A', 'B', 'B', 'C', 'C', 'D', 'D', 'F', 'F']);
  assert.equal(gradeOf(null), '');
  const a = buildAudit(lead, { intel, listings });
  const rc = reportCard(a);
  assert.deepEqual(rc.rows.map((r) => r.key), ['visibility', 'reviews', 'citations', 'consistency', 'profile']);
  assert.ok(rc.rows.every((r) => r.score == null || (r.score >= 0 && r.score <= 100)));
  const vis = rc.rows.find((r) => r.key === 'visibility');
  assert.equal(vis.score, 50, 'three top 3 spots (100 each) and six at 11 to 20 (25 each) over nine');
  assert.match(vis.why, /of 9 searched spots on page one/);
  assert.equal(rc.rows.find((r) => r.key === 'reviews').grade, 'F', '12 reviews against 210 at 4.1 stars');
  assert.ok(rc.overall != null && rc.grade);
  assert.equal(reportCard(buildAudit(lead, { intel, listings: null })).rows.find((r) => r.key === 'citations').score, null);
  assert.equal(reportCard({ ready: false }), null);
});
test('report card has no dashes and no promises', () => {
  const rc = reportCard(buildAudit(lead, { intel, listings }));
  assert.doesNotMatch(JSON.stringify(rc), /[–—]/);
});
