// Swipe reading for scripts (pure, tests in test/swipe.test.js). A swipe is a quick, mostly sideways drag: far enough, fast
// enough, and not a vertical scroll. Left means "next", right means "back", like turning pages on a phone.
export const SWIPE = { minX: 56, maxY: 48, maxMs: 700, ratio: 1.6 };
export function swipeDir({ dx = 0, dy = 0, dt = 0 } = {}, o = SWIPE) {
  if (dt > o.maxMs || Math.abs(dx) < o.minX || Math.abs(dy) > o.maxY || Math.abs(dx) < Math.abs(dy) * o.ratio) return null;
  return dx < 0 ? 'next' : 'back';
}
