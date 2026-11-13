// Swipe left for the next step, right for the previous one (touch and pen; a mouse uses the buttons). Used by the call prep
// script, the Training reader's script and the script beside the call window. Modeled on paging through cards on a phone.
import { swipeDir } from '../js/swipe.js';

// onSwipe(el, (dir) => ...) where dir is 'next' or 'back'. Returns a function that removes it.
export function onSwipe(el, fn, { skip = 'input, textarea, select, table, .seg, [data-noswipe]' } = {}) {
  let s = null;
  const down = (e) => {
    if (e.pointerType === 'mouse' || e.target.closest?.(skip)) { s = null; return; }
    s = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
  };
  const up = (e) => {
    if (!s || e.pointerId !== s.id) return;
    const d = swipeDir({ dx: e.clientX - s.x, dy: e.clientY - s.y, dt: Date.now() - s.t });
    s = null;
    if (d) fn(d);
  };
  const cancel = () => { s = null; };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  el.classList.add('swipeable');
  return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', cancel); };
}
// A short slide so the change of step is felt: the new step comes in from the side the finger moved toward.
export function slideIn(el, dir) {
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.animate([{ transform: `translateX(${dir === 'next' ? 28 : -28}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'cubic-bezier(.32,.72,0,1)' });
}
