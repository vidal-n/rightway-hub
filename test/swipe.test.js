import test from 'node:test';
import assert from 'node:assert/strict';
import { swipeDir } from '../public/js/swipe.js';

test('a quick sideways drag is a swipe, left is next and right is back', () => {
  assert.equal(swipeDir({ dx: -120, dy: 10, dt: 200 }), 'next');
  assert.equal(swipeDir({ dx: 120, dy: -8, dt: 250 }), 'back');
});
test('short, slow, tilted or vertical drags are not swipes', () => {
  assert.equal(swipeDir({ dx: -30, dy: 0, dt: 100 }), null);
  assert.equal(swipeDir({ dx: -140, dy: 5, dt: 1200 }), null);
  assert.equal(swipeDir({ dx: -100, dy: 70, dt: 200 }), null);
  assert.equal(swipeDir({ dx: -70, dy: 45, dt: 200 }), null);
  assert.equal(swipeDir({ dx: 10, dy: 200, dt: 200 }), null);
  assert.equal(swipeDir(), null);
});
