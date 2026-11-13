// Workspace navigation helpers (Nov 2026 overhaul). Modeled on swipeable tab pages in iOS and Android apps (Material tabs with
// swipe, iOS page views) and on the hide on scroll toolbars of Safari and Chrome:
// - Swipe left or right on a page (touch, pen, or a two finger trackpad swipe on a computer) to open the next or previous tab.
//   The page's own tab row wins; without one, the workspace tabs at the top. Ctrl or Alt with [ and ] does the same from the keyboard.
// - The workspace tab strip slides away while scrolling down and comes back when scrolling up or at the top.
// - A page tab row whose every link is already in the workspace tabs is hidden, so the same tabs never show twice.
// - The open tab is scrolled into view (snap) in the strip.
import { swipeDir } from '../js/swipe.js';
import { WORKSPACES } from '../js/workspaces.js';

const ALL_TABS = new Set(WORKSPACES.flatMap((w) => w[3].map((t) => t[1])));
const SKIP = 'input, textarea, select, [contenteditable], .swipeable, .board, .cols, table, .table-wrap, .ws-tabs, .tabs, .map, canvas, .zoomable, .callbar, .modal, [data-noswipe], .sl-main, .gm-wrap, iframe';
let wired = false;

function tabRows() {
  const view = document.getElementById('view');
  const page = view && [...view.querySelectorAll('.tabs')].find((t) => !t.hidden && t.offsetParent && t.querySelector('a.is-active[href]'));
  if (page) return [...page.querySelectorAll('a[href]')];
  return [...document.querySelectorAll('#wstabs a[href]')];
}
export function stepTab(dir) {
  const links = tabRows();
  if (links.length < 2) return false;
  let i = links.findIndex((a) => a.classList.contains('is-active'));
  if (i < 0) i = 0;
  const next = links[i + (dir === 'next' ? 1 : -1)];
  if (!next) return false;
  sessionStorage.setItem('rw-swipe', dir);
  next.click();
  return true;
}

// Horizontal space that already scrolls on its own keeps the gesture.
const scrollsSideways = (el) => {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 4) { const o = getComputedStyle(n).overflowX; if (o === 'auto' || o === 'scroll') return true; }
  }
  return false;
};

export function wireWsNav() {
  // Every shell draw: mark the strip, hide duplicate page tabs, play the slide in for a swipe that opened this page.
  const strip = document.getElementById('wstabs');
  const swiped = sessionStorage.getItem('rw-swipe');
  if (swiped) {
    sessionStorage.removeItem('rw-swipe');
    const main = document.getElementById('view');
    main?.classList.add(swiped === 'next' ? 'swipe-l' : 'swipe-r');
    setTimeout(() => main?.classList.remove('swipe-l', 'swipe-r'), 400);
  }
  dedupeTabs();
  fades();
  const vs = document.getElementById('vscroll');
  if (vs && !vs.__rwHide) {
    vs.__rwHide = true;
    let lastY = 0;
    vs.addEventListener('scroll', () => {
      const bar = document.getElementById('wsbar');
      if (!bar) return;
      const y = vs.scrollTop;
      if (y < 40 || y < lastY - 6) bar.classList.remove('ws-hide');
      else if (y > lastY + 6 && y > 120) bar.classList.add('ws-hide');
      lastY = y;
    }, { passive: true });
  }
  if (wired) return;
  wired = true;
  // A page drawn after the shell (most pages fetch, then draw) gets its tab rows checked too.
  let dt = null;
  new MutationObserver(() => { if (!dt) dt = setTimeout(() => { dt = null; dedupeTabs(); fades(); }, 80); }).observe(document.body, { childList: true, subtree: true });
  let s = null;
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !e.target.closest?.('#vscroll') || e.target.closest(SKIP) || scrollsSideways(e.target)) { s = null; return; }
    s = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
  }, { passive: true });
  document.addEventListener('pointerup', (e) => {
    if (!s || e.pointerId !== s.id) return;
    const d = swipeDir({ dx: e.clientX - s.x, dy: e.clientY - s.y, dt: Date.now() - s.t }, { minX: 70, maxY: 40, maxMs: 600, ratio: 2 });
    s = null;
    if (d) stepTab(d);
  });
  document.addEventListener('pointercancel', () => { s = null; });
  // Two finger swipe on a trackpad: sideways wheel movement with nothing that scrolls sideways under the pointer.
  let acc = 0, accT = 0, lock = 0;
  document.addEventListener('wheel', (e) => {
    if (e.ctrlKey || Math.abs(e.deltaX) < Math.abs(e.deltaY) * 2 || !e.target.closest?.('#vscroll') || e.target.closest(SKIP) || scrollsSideways(e.target)) return;
    const now = Date.now();
    if (now < lock) return;
    if (now - accT > 300) acc = 0;
    acc += e.deltaX; accT = now;
    if (Math.abs(acc) > 140) { const dir = acc > 0 ? 'next' : 'back'; acc = 0; lock = now + 700; stepTab(dir); }
  }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.altKey) || !['[', ']'].includes(e.key)) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
    if (stepTab(e.key === ']' ? 'next' : 'back')) e.preventDefault();
  });
}

// The fade at the end of a tab row only shows while more tabs wait to the right.
function fades() {
  document.querySelectorAll('.ws-tabs, #view .tabs').forEach((row) => {
    const set = () => row.classList.toggle('at-end', row.scrollLeft + row.clientWidth >= row.scrollWidth - 4);
    if (!row.__rwFade) {
      row.__rwFade = true;
      row.addEventListener('scroll', set, { passive: true });
      // Bring the open tab into the row without moving the page up or down.
      const a = row.querySelector('.is-active, .is-on');
      if (a && (a.offsetLeft + a.offsetWidth > row.scrollLeft + row.clientWidth || a.offsetLeft < row.scrollLeft)) row.scrollLeft = Math.max(0, a.offsetLeft - 16);
    }
    set();
  });
}

function dedupeTabs() {
  const view = document.getElementById('view');
  if (!view) return;
  view.querySelectorAll('.tabs').forEach((t) => {
    if (t.dataset.dd) return;
    t.dataset.dd = '1';
    const links = [...t.querySelectorAll(':scope > a[href]')];
    if (links.length >= 2 && links.length === t.children.length && links.every((a) => ALL_TABS.has(a.getAttribute('href')))) t.hidden = true;
  });
}
