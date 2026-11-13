// Swipe left for the next step, right for the previous one (touch and pen; a mouse uses the buttons). Used by the call prep script,
// the Training reader, the script beside the call window and the Inbox thread. Modeled on iOS page swipes: the content follows the
// finger as you drag (with rubber band resistance), then either flies off and the next page slides in, or springs back.
import { swipeDir } from '../js/swipe.js';

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPRING = 'cubic-bezier(.32,.72,0,1)';

// onSwipe(el, (dir) => ...) where dir is 'next' or 'back'. Returns a function that removes it.
export function onSwipe(el, fn, { skip = 'input, textarea, select, table, .seg, [data-noswipe]', follow = true } = {}) {
  let s = null;
  const down = (e) => {
    if (e.pointerType === 'mouse' || e.target.closest?.(skip)) { s = null; return; }
    s = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId, axis: null, dx: 0 };
  };
  const moveEv = (e) => {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.axis && Math.hypot(dx, dy) > 10) s.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
    if (s.axis !== 'x' || !follow || reduce()) return;
    s.dx = dx;
    el.style.transition = 'none';
    el.style.transform = `translateX(${dx * 0.45}px)`;
    el.style.opacity = String(1 - Math.min(0.35, Math.abs(dx) / 900));
  };
  const settle = () => { el.style.transition = `transform .35s ${SPRING}, opacity .25s`; el.style.transform = ''; el.style.opacity = ''; setTimeout(() => { el.style.transition = ''; }, 380); };
  const up = (e) => {
    if (!s || e.pointerId !== s.id) return;
    const d = s.axis === 'y' ? null : swipeDir({ dx: e.clientX - s.x, dy: e.clientY - s.y, dt: Date.now() - s.t });
    s = null;
    if (d) { el.style.transition = 'none'; el.style.transform = ''; el.style.opacity = ''; fn(d); } else settle();
  };
  const cancel = () => { if (s) settle(); s = null; };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', moveEv);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  el.classList.add('swipeable');
  return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', moveEv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', cancel); };
}
// The new step comes in from the side the finger moved toward, with the iOS sheet curve.
export function slideIn(el, dir) {
  if (!el || reduce()) return;
  el.animate([{ transform: `translateX(${dir === 'next' ? 60 : -60}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 340, easing: SPRING });
}
