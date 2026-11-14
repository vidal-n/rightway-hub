// Dropdowns never run past the screen (Nov 2026, V: make drop downs not cut off past the screen).
// Every custom dropdown (the Customize layout menu, tick box menus, folded chip lists) is nudged sideways until it fits, capped to the room
// left on screen (it scrolls inside), and flipped above its button when there is more room there. Modeled on the collision handling in
// Floating UI and Radix popovers. Pure DOM, no layout of its own: it only reads the box and writes translate, max-height and top/bottom.
const MARGIN = 8;
const POPS = '.dlayout-body, .ms-pop';

// A popover positioned by its own CSS under an anchor (absolute). Call it right after it is shown.
export function fitPop(el) {
  if (!el || el.hidden) return;
  el.style.translate = ''; el.style.maxHeight = ''; el.style.top = ''; el.style.bottom = ''; el.style.maxWidth = `${innerWidth - MARGIN * 2}px`;
  let b = el.getBoundingClientRect();
  let dx = 0;
  if (b.right > innerWidth - MARGIN) dx = innerWidth - MARGIN - b.right;
  if (b.left + dx < MARGIN) dx = MARGIN - b.left;
  if (dx) el.style.translate = `${Math.round(dx)}px 0`;
  b = el.getBoundingClientRect();
  if (b.bottom <= innerHeight - MARGIN) return;
  const host = (el.offsetParent || el.parentElement)?.getBoundingClientRect();
  const below = innerHeight - MARGIN - b.top;
  const above = host ? host.top - MARGIN - 6 : 0;
  if (above > below && above > 160) { el.style.top = 'auto'; el.style.bottom = 'calc(100% + 6px)'; el.style.maxHeight = `${Math.floor(above)}px`; }
  else el.style.maxHeight = `${Math.max(140, Math.floor(below))}px`;
  el.style.overflowY = 'auto';
}

// A popover that is position: fixed under a button (the folded chip lists). `row` must already be showing.
export function fitFixed(row, btn) {
  const r = btn.getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight;
  row.style.maxWidth = `${Math.min(360, vw - MARGIN * 2)}px`; row.style.maxHeight = ''; row.style.overflowY = 'auto';
  const w = Math.min(row.offsetWidth || 360, vw - MARGIN * 2);
  row.style.left = `${Math.max(MARGIN, Math.min(r.left, vw - w - MARGIN))}px`;
  const below = vh - r.bottom - MARGIN - 6, above = r.top - MARGIN - 6;
  const need = row.scrollHeight;
  if (need <= below || below >= above) { row.style.bottom = ''; row.style.top = `${Math.round(r.bottom + 6)}px`; row.style.maxHeight = `${Math.max(120, Math.floor(below))}px`; }
  else { row.style.top = ''; row.style.bottom = `${Math.round(vh - r.top + 6)}px`; row.style.maxHeight = `${Math.max(120, Math.floor(above))}px`; }
}

// Watch for these menus being opened (their `hidden` flips off) and fit them. Only the hidden attribute is observed, so writing styles
// here can never trigger another pass.
let wired = false;
export function watchPops() {
  if (wired) return; wired = true;
  new MutationObserver((list) => {
    for (const m of list) { const el = m.target; if (el.nodeType === 1 && el.matches?.(POPS) && !el.hidden) requestAnimationFrame(() => fitPop(el)); }
  }).observe(document.body, { attributes: true, attributeFilter: ['hidden'], subtree: true });
  let t;
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => document.querySelectorAll(POPS).forEach((el) => { if (!el.hidden) fitPop(el); }), 120); });
}
