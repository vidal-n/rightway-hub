import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskList, estimate, customSize, MAX_VIEWS } from '../public/js/finder.js';

const area = { label: 'Miami, FL', lat: 25.77, lng: -80.19, radius: 5, size: 5 };

test('one custom view searches only the middle of the place', () => {
  const pts = taskList([{ ...area, views: 1 }], ['roofer']);
  assert.equal(pts.length, 1);
  assert.equal(pts[0].lat, 25.77);
  assert.equal(pts[0].lng, -80.19);
});

test('a custom count gives exactly that many views, nearest the middle first', () => {
  const pts = taskList([{ ...area, views: 4 }], ['roofer']);
  assert.equal(pts.length, 4);
  for (const p of pts) assert.ok(Math.abs(p.lat - 25.77) + Math.abs(p.lng + 80.19) < 0.1, 'stays close to the middle');
});

test('no custom count keeps the full grid', () => {
  assert.equal(taskList([area], ['roofer']).length, 25);
});

test('estimate and cost follow the view count', () => {
  const e = estimate({ areas: 2, size: 3, keywords: 1, views: 4 });
  assert.equal(e.requests, 8);
  assert.equal(e.cost, 0.016);
  assert.equal(estimate({ areas: 1, size: 5, keywords: 1 }).requests, 25);
});

test('custom grid size fits the views, and the cap is 81', () => {
  assert.equal(customSize(1), 3);
  assert.equal(customSize(10), 5);
  assert.equal(customSize(50), 9);
  assert.equal(customSize(MAX_VIEWS), 9);
});
