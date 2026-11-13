// Home Screen style screen editing for the Dashboard, Dialer and Pipeline. Modeled on how iPhone and Android edit the Home
// Screen and widgets: press and hold (or tap "Edit screen") and the pieces jiggle, drag one to move it, tap the badge to
// remove it, tap the size pill to make it wider or narrower, "Add widget" brings removed pieces back, Done saves.
// The layout is saved on the person's account (uiprefs.js), so it follows them to every device. The pure parts are in
// public/js/layout.js. A page calls mountLayout(view, { page, items }) after each draw; pieces are found by selector.
import { $, $$, esc, toast, modal, REDUCED } from './core.js';
import { loadUi, uiNow, saveUi, flush } from './uiprefs.js';
import { layoutFor, mergeOrder, spanOf, sizeSpan, nextSpan, withSpan, spanName, SPANS, isDefault } from '../js/layout.js';

const HOLD = 520; // ms to hold before edit mode starts
const SIZES_ALL = SPANS.map(([v]) => v);

export function mountLayout(view, { page, items, btnHost = '.page-head .row', onApply = null }) {
  view.__lw?.destroy();
  const ids = items.map((i) => i.id);
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const find = (it) => $(it.sel, view);
  const present = () => items.filter((i) => find(i));
  let L = structuredClone(layoutFor(uiNow(), page));
  let editing = false;
  let bar = null;
  let dead = false;
  const openState = new Map();

  const orderNow = () => mergeOrder(ids, L.order);
  const save = () => saveUi({ layouts: { [page]: isDefault(L) ? null : L } });

  // Put every piece where the saved layout says: order inside its own container, hidden, and width.
  function apply() {
    const order = orderNow();
    const groups = new Map();
    for (const id of order) {
      const el = find(byId[id]); if (!el) continue;
      const p = el.parentElement;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(el);
    }
    for (const [parent, sorted] of groups) {
      const kids = [...parent.children];
      const mine = new Set(sorted);
      const slots = kids.map((k, i) => (mine.has(k) ? i : -1)).filter((i) => i >= 0);
      const want = kids.slice();
      slots.forEach((slot, n) => { want[slot] = sorted[n]; });
      if (want.some((k, i) => k !== kids[i])) want.forEach((k) => parent.appendChild(k));
    }
    const hidden = new Set(L.hidden);
    for (const it of items) {
      const el = find(it); if (!el) continue;
      el.classList.toggle('lw-hide', hidden.has(it.id));
      if (it.spans) {
        if (el.dataset.lwSpan === undefined) el.dataset.lwSpan = String(spanOf(el.className) || '');
        const want = sizeSpan(L.size[it.id]) || Number(el.dataset.lwSpan) || null;
        if (want && spanOf(el.className) !== want) el.className = withSpan(el.className, want);
      }
    }
    onApply?.({ order, hidden: L.hidden.filter((id) => byId[id]) });
    if (editing) paintTiles();
  }

  // ---------- edit mode ----------
  function paintTiles() {
    for (const it of present()) {
      const el = find(it);
      const gone = L.hidden.includes(it.id);
      el.classList.toggle('lw-tile', !gone);
      $$(':scope > .lw-x, :scope > summary > .lw-x, :scope > .lw-sz, :scope > summary > .lw-sz', el).forEach((n) => n.remove());
      if (gone) continue;
      const host = el.matches('details') ? $('summary', el) : el;
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'lw-x'; x.dataset.lw = 'x'; x.setAttribute('aria-label', `Remove ${it.label}`); x.title = `Remove ${it.label}`; x.textContent = '×';
      host.appendChild(x);
      if (it.spans) {
        const z = document.createElement('button');
        z.type = 'button'; z.className = 'lw-sz'; z.dataset.lw = 'size'; z.setAttribute('aria-label', `Change the width of ${it.label}`);
        z.textContent = spanName(spanOf(el.className) || 12);
        host.appendChild(z);
      }
    }
  }
  const hiddenItems = () => present().filter((i) => L.hidden.includes(i.id));
  function paintBar() {
    if (!bar) return;
    const n = hiddenItems().length;
    bar.innerHTML = `<button type="button" class="lw-b" data-lw="add">Add widget${n ? ` <b>${n}</b>` : ''}</button><button type="button" class="lw-b" data-lw="reset">Reset</button><button type="button" class="lw-b lw-done" data-lw="done">Done</button>`;
  }
  function enter() {
    if (editing || dead) return;
    editing = true;
    view.classList.add('lw-editing'); document.body.classList.add('lw-on');
    // Folded sections close while editing so every piece is small enough to drag.
    for (const d of $$('details.fold', view)) { openState.set(d, d.open); d.open = false; }
    bar = document.createElement('div'); bar.className = 'lw-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Edit this screen');
    document.body.appendChild(bar);
    paintBar(); paintTiles();
    $('.lw-editbtn', view)?.setAttribute('aria-pressed', 'true');
    try { navigator.vibrate?.(12); } catch { /* ignore */ }
  }
  function leave() {
    if (!editing) return;
    editing = false;
    view.classList.remove('lw-editing'); document.body.classList.remove('lw-on');
    for (const [d, o] of openState) if (document.body.contains(d)) d.open = o;
    openState.clear();
    $$('.lw-tile', view).forEach((e) => e.classList.remove('lw-tile'));
    $$('.lw-x, .lw-sz', view).forEach((n) => n.remove());
    bar?.remove(); bar = null;
    $('.lw-editbtn', view)?.setAttribute('aria-pressed', 'false');
    flush();
  }

  const remove = (id) => { if (!L.hidden.includes(id)) L.hidden.push(id); apply(); paintBar(); save(); toast(`${byId[id].label} removed. Tap Add widget to bring it back.`); };
  const gallery = () => {
    const hid = hiddenItems();
    const m = modal(`<div class="card-head"><h2>Add widget</h2></div>${hid.length
      ? `<p class="small muted" style="margin:0 0 10px">Pieces you removed from this screen.</p><div class="lw-gal">${hid.map((i) => `<div class="lw-gi"><span>${esc(i.label)}</span><button type="button" class="btn btn-primary btn-sm" data-add="${esc(i.id)}">Add</button></div>`).join('')}</div>`
      : '<p class="muted">Nothing removed yet. Tap the × on a piece to take it off this screen.</p>'}`);
    $$('[data-add]', m.el).forEach((b) => b.addEventListener('click', () => {
      L.hidden = L.hidden.filter((x) => x !== b.dataset.add); apply(); paintBar(); save();
      b.closest('.lw-gi')?.remove();
      if (!$('.lw-gi', m.el)) m.close();
    }));
  };
  const reset = () => { L = { order: [], hidden: [], size: {} }; apply(); paintBar(); save(); toast('Back to the standard layout.'); };

  // ---------- drag ----------
  let drag = null;
  const rectOf = (el) => { const t = el.style.transform; el.style.transform = 'none'; const r = el.getBoundingClientRect(); el.style.transform = t; return r; };
  function flip(parent, before) {
    if (REDUCED) return;
    for (const k of parent.children) {
      const b = before.get(k); if (!b || k === drag?.el) continue;
      const a = k.getBoundingClientRect(); const dx = b.left - a.left, dy = b.top - a.top;
      if (dx || dy) k.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.32,.72,0,1)' });
    }
  }
  function startDrag(el, id, e) {
    const parent = el.parentElement;
    const r = el.getBoundingClientRect();
    drag = { el, id, parent, gx: e.clientX - r.left, gy: e.clientY - r.top, px: e.clientX, py: e.clientY, raf: 0 };
    el.classList.add('lw-lift');
    try { navigator.vibrate?.(8); } catch { /* ignore */ }
    follow();
    tick();
  }
  const sibs = () => [...drag.parent.children].filter((k) => k !== drag.el && k.classList.contains('lw-tile') && !k.classList.contains('lw-hide'));
  function follow() {
    const { el, gx, gy, px, py } = drag;
    el.style.transform = 'none';
    const n = el.getBoundingClientRect();
    el.style.transform = `translate(${px - gx - n.left}px, ${py - gy - n.top}px) scale(1.02)`;
  }
  function tick() {
    if (!drag) return;
    const sc = $('#vscroll');
    if (sc) {
      const r = sc.getBoundingClientRect();
      const zone = 80;
      const v = drag.py < r.top + zone ? -(r.top + zone - drag.py) / 4 : drag.py > r.bottom - zone ? (drag.py - (r.bottom - zone)) / 4 : 0;
      if (v) { sc.scrollTop += Math.max(-24, Math.min(24, v)); follow(); }
    }
    // The piece under the finger: if the finger is past the middle of it, move in front of or behind it.
    const t = sibs().find((k) => { const r = rectOf(k); return drag.px >= r.left && drag.px <= r.right && drag.py >= r.top && drag.py <= r.bottom; });
    if (t) {
      const r = rectOf(t);
      const dy = (drag.py - (r.top + r.height / 2)) / Math.max(1, r.height), dx = (drag.px - (r.left + r.width / 2)) / Math.max(1, r.width);
      const after = Math.abs(dy) > Math.abs(dx) ? dy > 0 : dx > 0;
      const wantNext = after ? t.nextElementSibling : t;
      if (wantNext !== drag.el && wantNext !== drag.el.nextElementSibling) {
        const before = new Map([...drag.parent.children].map((k) => [k, k.getBoundingClientRect()]));
        drag.parent.insertBefore(drag.el, wantNext);
        flip(drag.parent, before);
        follow();
      }
    }
    drag.raf = requestAnimationFrame(tick);
  }
  function endDrag() {
    if (!drag) return;
    cancelAnimationFrame(drag.raf);
    const { el, parent } = drag; drag = null;
    const from = el.getBoundingClientRect();
    el.style.transform = 'none';
    const to = el.getBoundingClientRect();
    const finish = () => { el.classList.remove('lw-lift'); el.style.transform = ''; };
    if (REDUCED) finish();
    else { const a = el.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(1.02)` }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.32,.72,0,1)' }); a.onfinish = finish; a.oncancel = finish; }
    // The new order: this container's pieces in screen order, filling the places they held in the saved order.
    const seen = [];
    for (const k of parent.children) { const it = items.find((i) => find(i) === k); if (it) seen.push(it.id); }
    const cur = orderNow();
    const slots = cur.map((id, i) => (seen.includes(id) ? i : -1)).filter((i) => i >= 0);
    const next = cur.slice();
    slots.forEach((slot, n) => { next[slot] = seen[n]; });
    L.order = next;
    save(); apply();
  }

  // ---------- events ----------
  let hold = null; let suppress = 0;
  const tileOf = (target) => { const el = target.closest?.('.lw-tile'); return el && view.contains(el) ? el : null; };
  const idOf = (el) => items.find((i) => find(i) === el)?.id;
  const onDown = (e) => {
    if (dead || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target.closest('.lw-bar')) return;
    if (editing) {
      if (e.target.closest('[data-lw]')) return;
      const el = tileOf(e.target); if (!el) return;
      const id = idOf(el); if (!id) return;
      const sx = e.clientX, sy = e.clientY, touch = e.pointerType !== 'mouse';
      const begin = (ev) => { cleanup(); startDrag(el, id, { clientX: ev.clientX ?? sx, clientY: ev.clientY ?? sy }); };
      const mv = (ev) => { if (!touch && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 4) begin(ev); else if (touch && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) cleanup(); };
      const up = () => cleanup();
      const t = touch ? setTimeout(() => begin({ clientX: sx, clientY: sy }), 170) : 0;
      function cleanup() { clearTimeout(t); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); }
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
      return;
    }
    // Press and hold a piece (anything but a text field) to start editing, like the Home Screen. A mouse uses the Edit screen button.
    if (e.pointerType === 'mouse') return;
    if (document.querySelector('.callbar, .modal-bg') || e.target.closest('input, textarea, select, [contenteditable]')) return;
    const hit = items.find((i) => { const el = find(i); return el && el.contains(e.target) && !el.classList.contains('lw-hide'); });
    if (!hit) return;
    const sx = e.clientX, sy = e.clientY;
    const cancel = () => { clearTimeout(hold); hold = null; window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', cancel); window.removeEventListener('pointercancel', cancel); };
    const mv = (ev) => { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) cancel(); };
    hold = setTimeout(() => { cancel(); suppress = Date.now() + 600; enter(); }, HOLD);
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', cancel); window.addEventListener('pointercancel', cancel);
  };
  const onMove = (e) => { if (drag) { drag.px = e.clientX; drag.py = e.clientY; follow(); } };
  const onUp = () => { if (drag) endDrag(); };
  const onTouchMove = (e) => { if (drag) e.preventDefault(); };
  const onClick = (e) => {
    if (suppress > Date.now()) { e.preventDefault(); e.stopPropagation(); return; }
    const b = e.target.closest?.('[data-lw]');
    if (!b) { if (editing && tileOf(e.target)) { e.preventDefault(); e.stopPropagation(); } return; }
    e.preventDefault(); e.stopPropagation();
    const k = b.dataset.lw;
    if (k === 'done') return leave();
    if (k === 'add') return gallery();
    if (k === 'reset') return reset();
    const el = tileOf(b); const id = el && idOf(el);
    if (!id) return;
    if (k === 'x') return remove(id);
    if (k === 'size') {
      const it = byId[id];
      const allowed = Array.isArray(it.spans) ? it.spans : SIZES_ALL;
      const cur = spanOf(el.className) || 12;
      const to = nextSpan(cur, allowed);
      L.size[id] = `c${to}`; apply(); save();
    }
  };
  const onKey = (e) => { if (e.key === 'Escape' && editing && !document.querySelector('.modal-bg')) leave(); };
  const onRefresh = () => { if (!dead && document.body.contains(view)) apply(); };
  const onHash = () => destroy();
  const onCtx = (e) => { if (editing && tileOf(e.target)) e.preventDefault(); };

  view.addEventListener('pointerdown', onDown);
  view.addEventListener('contextmenu', onCtx);
  document.addEventListener('click', onClick, true);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('keydown', onKey);
  document.addEventListener('rw-layout-refresh', onRefresh);
  window.addEventListener('hashchange', onHash, { once: true });

  // The Edit screen button, next to the page's other buttons.
  const host = $(btnHost, view);
  if (host && !$('.lw-editbtn', host)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-ghost btn-sm lw-editbtn'; b.textContent = 'Edit screen'; b.title = 'Move, resize, remove or add the pieces of this screen. You can also press and hold any piece.';
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => (editing ? leave() : enter()));
    host.prepend(b);
  }

  function destroy() {
    if (dead) return;
    dead = true;
    clearTimeout(hold);
    if (drag) { cancelAnimationFrame(drag.raf); drag = null; }
    leave();
    view.removeEventListener('pointerdown', onDown);
    view.removeEventListener('contextmenu', onCtx);
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('rw-layout-refresh', onRefresh);
    window.removeEventListener('hashchange', onHash);
    document.body.classList.remove('lw-on');
    if (view.__lw === api) view.__lw = null;
  }
  const api = { destroy, apply, enter, leave, get editing() { return editing; } };
  view.__lw = api;

  apply();
  // The server copy can differ from this device's copy (another computer saved a change): draw that once it arrives.
  loadUi().then((u) => {
    if (dead || editing) return;
    const next = layoutFor(u, page);
    if (JSON.stringify(next) !== JSON.stringify(L)) { L = structuredClone(next); apply(); }
  });
  return api;
}
