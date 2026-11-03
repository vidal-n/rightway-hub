import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridPoints, gridStats, rankBand, rankLabel, estimateCost } from '../public/js/grid.js';
import { topCompetitors, profileChecklist, categoryGap, planMath } from '../public/js/analysis.js';
import { project, fitZoom } from '../public/js/map.js';

test('gridPoints builds an n x n grid centered on the business', () => {
  const pts = gridPoints(26.0112, -80.1495, 7, 5);
  assert.equal(pts.length, 49);
  const center = pts[24];
  assert.equal(center.lat, 26.0112);
  assert.equal(center.lng, -80.1495);
  // Corners are about 5 miles north/south and east/west of center.
  const nw = pts[0];
  assert.ok(Math.abs((nw.lat - center.lat) * 69 - 5) < 0.01);
  const milesWest = (center.lng - nw.lng) * 69.172 * Math.cos((26.0112 * Math.PI) / 180);
  assert.ok(Math.abs(milesWest - 5) < 0.01);
  assert.throws(() => gridPoints(0, 0, 4, 5));
  assert.throws(() => gridPoints(0, 0, 7, 0));
});

test('rank bands and labels', () => {
  assert.equal(rankBand({ status: 'done', rank: 2 }), 'top3');
  assert.equal(rankBand({ status: 'done', rank: 7 }), 'top10');
  assert.equal(rankBand({ status: 'done', rank: 15 }), 'top20');
  assert.equal(rankBand({ status: 'done', rank: null }), 'none');
  assert.equal(rankBand({ status: 'error' }), 'error');
  assert.equal(rankLabel({ status: 'done', rank: null }), '20+');
  assert.equal(rankLabel({ status: 'pending' }), '');
});

test('gridStats counts coverage and averages with unranked as 21', () => {
  const pts = gridPoints(26, -80, 3, 1);
  const ranks = [1, 2, 5, 12, 3, null, null, 9, 4];
  pts.forEach((p, i) => { p.status = 'done'; p.rank = ranks[i]; });
  const s = gridStats(pts);
  assert.equal(s.top3, 3);
  assert.equal(s.top10, 6);
  assert.equal(s.found, 7);
  assert.equal(s.top3Pct, 33);
  assert.equal(s.avgRank, Math.round(((1 + 2 + 5 + 12 + 3 + 21 + 21 + 9 + 4) / 9) * 10) / 10);
  assert.equal(s.centerRank, 3);
  assert.equal(estimateCost(7, 'maps').toFixed(3), '0.098');
  assert.equal(estimateCost(5).toFixed(2), '0.10');
});

const A = { cid: 'a', title: 'Alpha', rank: 1, reviews: 200, rating: 4.8, photos: 100, category: 'Roofing contractor', additional_categories: ['Gutter service', 'Siding contractor'] };
const B = { cid: 'b', title: 'Bravo', rank: 2, reviews: 120, rating: 4.6, photos: 60, category: 'Roofing contractor', additional_categories: ['Gutter service'] };
const C = { cid: 'c', title: 'Charlie', rank: 3, reviews: 50, rating: 4.9, photos: 20, category: 'Roof repair service', additional_categories: [] };
const T = { cid: 't', title: 'Target', rank: 4, reviews: 30, rating: 4.5, photos: 10, category: 'Roofing contractor', additional_categories: [], claimed: true, url: '', phone: '555', hours: true };

test('topCompetitors ranks by top 3 appearances and excludes the target', () => {
  const pts = [
    { status: 'done', top: [A, B, T, C] },
    { status: 'done', top: [{ ...B, rank: 1 }, { ...A, rank: 2 }, { ...C, rank: 3 }] },
    { status: 'done', top: [{ ...A, rank: 1 }, { ...T, rank: 2 }, { ...C, rank: 5 }] },
    { status: 'error', top: [] },
  ];
  const comps = topCompetitors(pts, T, 3);
  assert.deepEqual(comps.map((c) => c.cid), ['a', 'c', 'b']); // c ties b on top 3 spots but shows up at more points
  assert.equal(comps[0].top3Points, 3);
  assert.ok(!comps.some((c) => c.cid === 't'));
});

test('profileChecklist flags real gaps', () => {
  const checks = profileChecklist(T, [A, B, C]);
  const byKey = Object.fromEntries(checks.map((c) => [c.key, c]));
  assert.equal(byKey.claimed.status, 'good');
  assert.equal(byKey.website.status, 'gap');
  assert.equal(byKey.reviews.status, 'gap');
  assert.match(byKey.reviews.detail, /170 more/);
  assert.equal(byKey.photos.status, 'gap');
  assert.equal(byKey.primary.status, 'good');
  assert.equal(byKey.categories.status, 'gap');
});

test('categoryGap lists competitor categories the target lacks', () => {
  const gap = categoryGap(T, [A, B, C]);
  assert.deepEqual(gap[0], { category: 'Gutter service', count: 2 });
  assert.ok(gap.some((g) => g.category === 'Roof repair service'));
  assert.ok(!gap.some((g) => g.category === 'Roofing contractor'));
});

test('planMath matches the playbook formula', () => {
  const m = planMath({ jobValue: 8000, closeRatePct: 30, extraCalls: 10, planPrice: 997 });
  assert.equal(m.jobs, 3);
  assert.equal(m.revenue, 24000);
  assert.equal(m.jobsToCover, 1);
  assert.equal(planMath({ jobValue: 0, closeRatePct: 30, extraCalls: 10, planPrice: 997 }).jobsToCover, null);
});

test('map projection and zoom fit', () => {
  const p0 = project(0, 0, 0);
  assert.ok(Math.abs(p0.x - 128) < 1e-9 && Math.abs(p0.y - 128) < 1e-9);
  const pts = gridPoints(26.0112, -80.1495, 7, 5);
  const z = fitZoom(pts, 480, 480);
  assert.ok(z > 10 && z < 13, `zoom ${z}`);
  const a = project(pts[0].lat, pts[0].lng, z);
  const b = project(pts[48].lat, pts[48].lng, z);
  assert.ok(b.x - a.x <= 480 - 72 + 1e-6);
});

import { leaderboard, reach, sides, findings, fixFirst, rankAt, ladder, bands } from '../public/js/analysis.js';

function scanGrid(rankFn, compFn) {
  const pts = gridPoints(26, -80, 5, 2);
  pts.forEach((p) => {
    p.status = 'done';
    p.rank = rankFn(p);
    const comp = { cid: 'c1', title: 'Leader Co', reviews: 500, rating: 4.8, rank: compFn(p) };
    const other = { cid: 'c2', title: 'Other Co', reviews: 50, rating: 4.1, rank: 5 };
    p.top = [comp, other].filter((b) => b.rank != null);
  });
  return pts;
}

test('leaderboard scores share of local voice', () => {
  const pts = scanGrid((p) => (p.row === 2 && p.col === 2 ? 2 : 12), () => 1);
  const T = { cid: 't', title: 'Target', reviews: 450 };
  const b = leaderboard(pts, T, 5);
  assert.equal(b.rows[0].cid, 'c1');
  assert.equal(b.rows[0].sov, 100);
  assert.equal(b.target.top3Points, 1);
  assert.ok(b.position >= 2);
  // The top 10 ladder orders by average spot and says what separates the target from each business above it.
  const lad = ladder(pts, T, 10);
  assert.equal(lad.rows[0].cid === undefined ? lad.rows[0].position : lad.rows[0].position, 1);
  assert.ok(lad.position > 1);
  assert.ok(lad.next.length >= 1 && lad.next[0].position === lad.position - 1);
  const bb = bands(pts);
  assert.equal(bb.top3 + bb.page1 + bb.page2 + bb.none, 100);
  assert.equal(rankAt(pts[0], { cid: 'c2' }), 5);
  assert.equal(rankAt(pts[0], { cid: 'nobody' }), null);
});

test('reach and sides describe the shape of visibility', () => {
  const pts = scanGrid((p) => {
    const ring = Math.max(Math.abs(p.row - 2), Math.abs(p.col - 2));
    return ring === 0 ? 1 : ring === 1 ? (p.col >= 2 ? 3 : 8) : null;
  }, () => 1);
  assert.equal(reach(pts, 5, 2, 3), 1); // 5 of 8 ring-1 points are top 3
  assert.equal(reach(pts, 5, 2, 10), 1); // ring 1 all top 10, ring 2 none
  const s = sides(pts, 5);
  assert.equal(s.strongest.side, 'east');
  assert.equal(s.weakest.side, 'west');
});

test('findings and fix list are plain and grounded', () => {
  const pts = scanGrid(() => null, () => 1);
  const T = { cid: 't', title: 'Target', reviews: 480 };
  const board = leaderboard(pts, T, 3);
  const facts = findings({ target: T, points: pts, size: 5, radius: 2, keyword: 'roofer', board, comps: board.rows, checks: [], gaps: [] });
  assert.match(facts[0], /isn't on the first page \(top 10\)/);
  assert.ok(facts.some((f) => /Review count is not the gap/.test(f)));
  const fixes = fixFirst([{ key: 'photos', status: 'gap' }, { key: 'primary', status: 'gap' }, { key: 'phone', status: 'good' }]);
  assert.deepEqual(fixes.map((f) => f.key), ['primary', 'photos']);
});
