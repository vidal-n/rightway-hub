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
    if (main) { main.style.transform = ''; main.style.opacity = ''; main.style.transition = ''; }
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
  // Page swipe like iOS: the page follows the finger with a hint of the tab it is heading to, then flies off and the next tab
  // slides in, or springs back when the swipe is too short. Vertical drags stay normal scrolling (axis lock after 10px).
  let s = null;
  const main = () => document.getElementById('view');
  const neighbor = (dir) => { const links = tabRows(); const i = Math.max(0, links.findIndex((a) => a.classList.contains('is-active'))); return links[i + (dir === 'next' ? 1 : -1)] || null; };
  const hint = (dir, on) => {
    let h = document.getElementById('swhint');
    if (!on) { h?.remove(); return; }
    const n = neighbor(dir);
    if (!h) { h = document.createElement('div'); h.id = 'swhint'; h.className = 'swhint'; document.body.appendChild(h); }
    h.dataset.side = dir === 'next' ? 'right' : 'left';
    h.textContent = n ? n.textContent.trim() : dir === 'next' ? 'Last tab' : 'First tab';
    h.classList.toggle('none', !n);
    return Boolean(n);
  };
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !e.target.closest?.('#vscroll') || e.target.closest(SKIP) || scrollsSideways(e.target)) { s = null; return; }
    s = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId, axis: null, ok: false };
  }, { passive: true });
  document.addEventListener('pointermove', (e) => {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.axis && Math.hypot(dx, dy) > 10) s.axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'y';
    if (s.axis !== 'x' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dir = dx < 0 ? 'next' : 'back';
    s.ok = hint(dir, true);
    const pull = s.ok ? dx * 0.85 : dx * 0.22; // rubber band at the first and last tab
    const m = main();
    if (m) { m.style.transition = 'none'; m.style.transform = `translateX(${pull}px)`; m.style.opacity = String(1 - Math.min(0.4, Math.abs(pull) / innerWidth)); }
    const h = document.getElementById('swhint');
    if (h) h.style.opacity = String(Math.min(1, Math.abs(dx) / 90));
  }, { passive: true });
  const springBack = () => { const m = main(); if (m) { m.style.transition = 'transform .38s cubic-bezier(.32,.72,0,1), opacity .25s'; m.style.transform = ''; m.style.opacity = ''; setTimeout(() => { if (m) m.style.transition = ''; }, 400); } hint('', false); };
  document.addEventListener('pointerup', (e) => {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x, dt = Date.now() - s.t;
    const fast = Math.abs(dx) / Math.max(1, dt) > 0.45;
    const go = s.axis === 'x' && s.ok && (Math.abs(dx) > innerWidth * 0.28 || (fast && Math.abs(dx) > 50));
    s = null;
    if (!go) { springBack(); return; }
    const dir = dx < 0 ? 'next' : 'back';
    const m = main();
    hint('', false);
    if (m && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      m.style.transition = 'transform .2s cubic-bezier(.32,.72,0,1), opacity .2s';
      m.style.transform = `translateX(${dir === 'next' ? -innerWidth * 0.6 : innerWidth * 0.6}px)`; m.style.opacity = '0';
      import('./sound.js').then((x) => x.play('swipe')).catch(() => {});
      setTimeout(() => stepTab(dir), 160);
    } else stepTab(dir);
  });
  document.addEventListener('pointercancel', () => { if (s) springBack(); s = null; });
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
