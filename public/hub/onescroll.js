// One scroll rule (Nov 2026, V: "I hate the double scroll ... permanently removed and prevented moving forward").
// The Hub frame scrolls in ONE place, #vscroll. No page content may carry its own vertical scroll box:
//   - CSS: no max-height or vh height with overflow auto on page content (test/onescroll.test.js fails on it; popovers, modals,
//     floating windows and the app panes that fill the screen are the only allowlisted ones).
//   - Text areas grow with what is typed, so a long script or note never gets an inner scrollbar (this file).
// Modeled on field-sizing: content (CSS), which Safari on iPad does not have yet, so it is done by hand.
import { $$ } from './core.js';

const fit = (ta) => {
  if (!ta.isConnected || ta.hasAttribute('data-keep') || ta.offsetParent === null) return;
  ta.style.overflowY = 'hidden';
  ta.style.height = 'auto';
  ta.style.height = (ta.scrollHeight + 2) + 'px';
};
let queued = false;
function all() { queued = false; $$('textarea:not([data-keep])').forEach(fit); }
function later() { if (queued) return; queued = true; requestAnimationFrame(all); }

let wired = false;
export function wireOneScroll() {
  if (wired) return; wired = true;
  document.addEventListener('input', (e) => { if (e.target?.matches?.('textarea')) fit(e.target); }, true);
  window.addEventListener('resize', later);
  // New pages and windows add text areas all the time. Throttled and only reads, so it cannot loop.
  new MutationObserver((list) => { if (list.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches?.('textarea') || n.querySelector?.('textarea'))))) later(); })
    .observe(document.body, { childList: true, subtree: true });
  later();
}
