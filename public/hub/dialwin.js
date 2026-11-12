// One window, many screens (Nov 2026, V: dialer pop ups should switch from one screen to the next, not close and open the next).
// The countdown box, the call window, the result picker and the Book or Text screens all sit in the same place on screen. When one gives way to another,
// the new one grows or shrinks out of the old one's size with Apple's sheet curve while the old one fades away, instead of blinking out and in.
import { isPhone } from './core.js';

export const EASE = 'cubic-bezier(.32,.72,0,1)';
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let last = null;                                   // the box that just went away: { rect, at }
const fresh = () => last && performance.now() - last.at < 3000 ? last.rect : null;

// A snapshot of an element that fades away where it was.
function ghost(el, rect) {
  if (calm()) return;
  const g = el.cloneNode(true);
  g.removeAttribute('id');
  Object.assign(g.style, { position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px', right: 'auto', bottom: 'auto', margin: '0', translate: 'none', pointerEvents: 'none', zIndex: '121', overflow: 'hidden', display: '' });
  g.classList.remove('under'); g.classList.add('dw-ghost');
  document.body.appendChild(g);
  const a = g.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.97)' }], { duration: 240, easing: EASE, fill: 'forwards' });
  a.onfinish = a.oncancel = () => g.remove();
}

// Call this when a window is about to disappear (before it is removed or hidden).
export function leaving(el) {
  if (!el || isPhone()) return;
  const r = el.getBoundingClientRect();
  if (!r.width) return;
  last = { rect: r, at: performance.now() };
  ghost(el, r);
}

// Call this right after a window appears. It grows out of the box that just left, or springs in when nothing did.
export function arriving(el) {
  if (!el || isPhone() || calm()) return;
  const to = el.getBoundingClientRect();
  if (!to.width) return;
  const from = fresh(); last = null;
  if (from) {
    const keep = el.style.overflow;
    el.style.overflow = 'hidden';
    const a = el.animate([{ width: from.width + 'px', height: from.height + 'px' }, { width: to.width + 'px', height: to.height + 'px' }], { duration: 520, easing: EASE });
    a.onfinish = a.oncancel = () => { el.style.overflow = keep; };
    for (const c of el.children) c.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 90, easing: EASE, fill: 'backwards' });
  } else {
    el.animate([{ opacity: 0, transform: 'translateY(16px) scale(.95)' }, { opacity: 1, transform: 'none' }], { duration: 460, easing: EASE });
  }
}

// The same window changes what it shows (call window turns into the result picker): it resizes smoothly and the new content settles in.
// Take `from` (getBoundingClientRect) before the change, then call this once the new content is in.
export function morphFrom(el, from) {
  if (!el || !from || isPhone() || calm()) return;
  const to = el.getBoundingClientRect();
  if (!from.width || !to.width) return;
  const keep = el.style.overflow;
  el.style.overflow = 'hidden';
  const a = el.animate([{ width: from.width + 'px', height: from.height + 'px' }, { width: to.width + 'px', height: to.height + 'px' }], { duration: 520, easing: EASE });
  a.onfinish = a.oncancel = () => { el.style.overflow = keep; };
  for (const c of el.children) c.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 60, easing: EASE, fill: 'backwards' });
}

// Which window is showing right now (the call window or the countdown box).
export const liveWindow = () => document.querySelector('.callbar:not(.under), .pd:not(.under)');
