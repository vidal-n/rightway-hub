// The Hub behaves like an app: no pinch zoom, no double tap zoom, no Ctrl + scroll or Ctrl +/- page zoom.
// Photos are the one exception: tap any photo and it opens in a viewer you can pinch, scroll or double tap to zoom and drag.
const inZoom = (t) => Boolean(t && t.closest && t.closest('.zoomable'));

// Safari (iPhone and iPad) pinch gestures.
['gesturestart', 'gesturechange', 'gestureend'].forEach((n) => document.addEventListener(n, (e) => { if (!inZoom(e.target)) e.preventDefault(); }, { passive: false }));
// Two finger touches that would pinch the page.
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 && !inZoom(e.target)) e.preventDefault(); }, { passive: false });
// Double tap zoom is off through touch-action in hub.css (pan only), so quick taps on buttons are never swallowed.
// Computers: Ctrl or Cmd + scroll wheel, trackpad pinch, and Ctrl +, -, 0.
window.addEventListener('wheel', (e) => { if ((e.ctrlKey || e.metaKey) && !inZoom(e.target)) e.preventDefault(); }, { passive: false });
window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && ['+', '=', '-', '_', '0'].includes(e.key) && !inZoom(e.target)) e.preventDefault(); });

// ---------- photo viewer ----------
let open = null;
export function openPhoto(src, alt = '') {
  if (open) return;
  const bg = document.createElement('div');
  bg.className = 'pview zoomable';
  bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-label', 'Photo');
  bg.innerHTML = `<button type="button" class="pview-x" aria-label="Close photo">&times;</button><img alt="${String(alt).replace(/"/g, '&quot;')}" src="${src}" draggable="false"><div class="pview-hint">Pinch or scroll to zoom. Double tap to zoom in or out. Esc to close.</div>`;
  document.body.appendChild(bg);
  open = bg;
  const img = bg.querySelector('img');
  let s = 1, x = 0, y = 0;
  const pts = new Map();
  let startDist = 0, startS = 1;
  const apply = () => { img.style.transform = `translate(${x}px, ${y}px) scale(${s})`; img.style.cursor = s > 1 ? 'grab' : 'zoom-in'; };
  const fit = () => { const w = img.clientWidth, h = img.clientHeight; x = (innerWidth - w) / 2; y = (innerHeight - h) / 2; s = 1; apply(); };
  img.addEventListener('load', fit); if (img.complete) fit();
  const zoomAt = (cx, cy, ns) => { ns = Math.min(6, Math.max(1, ns)); const k = ns / s; x = cx - (cx - x) * k; y = cy - (cy - y) * k; s = ns; if (s === 1) fit(); else apply(); };
  bg.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
  bg.addEventListener('pointerdown', (e) => { if (e.target.closest('.pview-x')) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); bg.setPointerCapture?.(e.pointerId); if (pts.size === 2) { const [a, b] = [...pts.values()]; startDist = Math.hypot(a.x - b.x, a.y - b.y); startS = s; } });
  bg.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId); if (!p) return;
    if (pts.size === 2) { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (startDist) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, startS * (d / startDist)); return; }
    if (pts.size === 1 && s > 1) { x += e.clientX - p.x; y += e.clientY - p.y; apply(); }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  const up = (e) => { pts.delete(e.pointerId); startDist = 0; };
  bg.addEventListener('pointerup', up); bg.addEventListener('pointercancel', up);
  let tapAt = 0;
  img.addEventListener('click', (e) => { const n = Date.now(); if (n - tapAt < 320) zoomAt(e.clientX, e.clientY, s > 1 ? 1 : 2.5); tapAt = n; });
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  const key = (e) => { if (e.key === 'Escape') close(); };
  function close() { document.removeEventListener('keydown', key); window.removeEventListener('hashchange', close); bg.remove(); open = null; }
  document.addEventListener('keydown', key);
  window.addEventListener('hashchange', close, { once: true });
  bg.querySelector('.pview-x').addEventListener('click', close);
}

// Tap a photo anywhere in the Hub (client photos, post pictures, uploads) to open the viewer. Add data-nozoom to an image to skip it.
document.addEventListener('click', (e) => {
  const img = e.target.closest && e.target.closest('img');
  if (!img || img.hasAttribute('data-nozoom') || img.closest('.pview, a[href], button, .logo, .pbub, .rail, .avatar, .phone-frame')) return;
  const src = img.currentSrc || img.src || '';
  if (!/\/photos\/|\/media\/|\/api\/public\/m\/|\/files\/|data-lightbox/.test(src) && !img.closest('[data-lightbox]')) return;
  e.preventDefault();
  openPhoto(src, img.alt || '');
});
