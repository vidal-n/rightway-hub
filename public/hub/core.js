// Shared helpers for the Hub app.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const REDUCED = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// Client view: when set, every request is made as that client sees it (read only on the server).
export const VIEW = { as: null };
export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = { 'x-rw': '1' };
  if (VIEW.as) headers['x-view-as'] = VIEW.as;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Something went wrong (HTTP ${res.status}).`, res.status);
  return data;
}

export function toast(msg, isError = false) {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = `toast${isError ? ' err' : ''}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), isError ? 6000 : 3200);
}

export async function copy(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(label); } catch { prompt('Copy this:', text); }
}

export const fmt = {
  int: (n) => (n == null ? '-' : Number(n).toLocaleString('en-US')),
  money: (n) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
  date: (ms) => (ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'),
  ago(ms) {
    if (!ms) return '';
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
    return fmt.date(ms);
  },
  month(m) { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }); },
};

export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return monthKey(d);
}

export function countUp(el, to, { decimals = 0, suffix = '', prefix = '' } = {}) {
  if (!el) return;
  const final = `${prefix}${Number(to).toFixed(decimals)}${suffix}`;
  if (REDUCED || !Number.isFinite(Number(to))) { el.textContent = final; return; }
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / 900);
    el.textContent = `${prefix}${(Number(to) * (1 - (1 - k) ** 3)).toFixed(decimals)}${suffix}`;
    if (k < 1) requestAnimationFrame(step); else el.textContent = final;
  };
  requestAnimationFrame(step);
}
export function animateNumbers(root) {
  $$('[data-count]', root).forEach((el) => countUp(el, Number(el.dataset.count), { decimals: Number(el.dataset.dec || 0), suffix: el.dataset.suffix || '', prefix: el.dataset.prefix || '' }));
  requestAnimationFrame(() => $$('.progress > span[data-w]', root).forEach((s) => { s.style.width = `${s.dataset.w}%`; }));
}

// Shrink phone photos before upload: faster, cheaper, and within the AI image limit.
export async function resizeImage(file, max = 1600, quality = 0.85) {
  if (!file || !/^image\//.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    return blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

// Move a window by its title area. `grab(e)` says whether the press started on a handle. The window is nudged with the CSS `translate`
// property, so it keeps its own layout, and it can never be dragged fully off screen. With `key` the spot is remembered on this computer.
export function makeDraggable(el, { grab, key = '', off = () => false, onMove } = {}) {
  const KEY = key ? `rw-pos-${key}` : '';
  const put = (x, y) => { el.style.translate = x || y ? `${x}px ${y}px` : ''; };
  let x = 0, y = 0;
  if (KEY) { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) { x = Number(v.x) || 0; y = Number(v.y) || 0; } } catch { /* ignore */ } put(x, y); keepOnScreen(); }
  function keepOnScreen() {
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const m = 60;                              // always leave this much of the window on screen
    let dx = 0, dy = 0;
    if (r.right < m) dx = m - r.right; else if (r.left > innerWidth - m) dx = innerWidth - m - r.left;
    if (r.top < 0) dy = -r.top; else if (r.top > innerHeight - m) dy = innerHeight - m - r.top;
    if (dx || dy) { x += dx; y += dy; put(x, y); }
  }
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (off() || e.button > 0 || !grab || !grab(e) || e.target.closest('button, a, input, select, textarea, label, [contenteditable], [data-nodrag]')) return;
    drag = { sx: e.clientX, sy: e.clientY, x, y, id: e.pointerId, moved: false };
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    drag.moved = true;
    x = drag.x + dx; y = drag.y + dy; put(x, y); keepOnScreen(); onMove?.(true);
  });
  const end = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const moved = drag.moved;
    drag = null; el.classList.remove('dragging');
    try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (moved) { if (KEY) { try { localStorage.setItem(KEY, JSON.stringify({ x, y })); } catch { /* ignore */ } } setTimeout(() => onMove?.(false), 0); }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  window.addEventListener('resize', keepOnScreen);
  return { reset() { x = 0; y = 0; put(0, 0); if (KEY) { try { localStorage.removeItem(KEY); } catch { /* ignore */ } } } };
}

// Daily dial goal: click the number, type a new one (1 to 1000) or pick a common one, Enter saves. Saved on the person, shown everywhere.
export function editGoal(btn, current, onSaved) {
  const inp = document.createElement('input');
  inp.type = 'number'; inp.min = '1'; inp.max = '1000'; inp.value = String(current); inp.className = 'goal-in'; inp.setAttribute('list', 'goal-presets'); inp.setAttribute('aria-label', 'Daily dial goal');
  if (!document.getElementById('goal-presets')) { const dl = document.createElement('datalist'); dl.id = 'goal-presets'; dl.innerHTML = [25, 40, 60, 80, 100, 120, 150, 200, 250, 300].map((n) => `<option value="${n}">`).join(''); document.body.appendChild(dl); }
  btn.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = async (save) => {
    if (done) return; done = true;
    const v = Math.round(Number(inp.value));
    if (save && v >= 1 && v <= 1000 && v !== Number(current)) { try { const r = await api('/api/me/dial-goal', { method: 'PUT', body: { goal: v } }); toast(`Goal is ${r.goal} dials a day`); onSaved(r.goal); return; } catch (e) { toast(e.message, true); } }
    else if (save && !(v >= 1 && v <= 1000)) toast('Pick a goal from 1 to 1000.', true);
    inp.replaceWith(btn);
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
}

// ---------- the tray ----------
// Pop ups can be minimized into a tray along the bottom of the Hub. It stays through every page, so a half finished lead, booking or result
// waits while you go and do something else. Click a chip to pick it back up, X to throw it away.
const tray = new Map();
let trayEl = null;
function paintTray() {
  if (!tray.size) { trayEl?.remove(); trayEl = null; return; }
  if (!trayEl) { trayEl = document.createElement('div'); trayEl.className = 'tray'; trayEl.setAttribute('aria-label', 'Minimized windows'); document.body.appendChild(trayEl); }
  trayEl.innerHTML = [...tray.entries()].map(([id, t]) => `<div class="tray-chip${t.hot ? ' hot' : ''}" data-id="${esc(id)}"><button type="button" class="tray-main" data-resume title="Pick this back up"><i></i><span><b>${esc(t.title)}</b>${t.sub ? `<small>${esc(t.sub)}</small>` : ''}</span></button><button type="button" class="tray-x" data-drop aria-label="Close ${esc(t.title)}" title="Close it">×</button></div>`).join('');
  trayEl.onclick = (e) => {
    const chip = e.target.closest('.tray-chip'); if (!chip) return;
    const t = tray.get(chip.dataset.id); if (!t) return;
    if (e.target.closest('[data-drop]')) { tray.delete(chip.dataset.id); paintTray(); t.onDrop?.(); return; }
    if (e.target.closest('[data-resume]')) { tray.delete(chip.dataset.id); paintTray(); t.onResume?.(); }
  };
}
export const trayAdd = (id, t) => { tray.set(id, t); paintTray(); };
export const trayHas = (id) => tray.has(id);
export const trayRemove = (id) => { if (tray.delete(id)) paintTray(); };

let modalSeq = 0;
// Modes: "modal" (centered, page behind is dimmed), "float" (small window over the page, the page stays usable and it follows you to every page),
// "docked" (minimized into the tray). Leaving the page parks a modal in the tray instead of throwing its work away.
export function modal(html, { onClose, title: wantTitle } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const id = `m${++modalSeq}`;
  let closed = false;
  let dragging = false;
  let mode = 'modal';
  const box = bg.firstElementChild;
  const close = () => { if (closed) return; closed = true; trayRemove(id); document.removeEventListener('keydown', onKey); window.removeEventListener('hashchange', away); bg.remove(); onClose?.(); };
  // A drag that ends over the dark backdrop must not count as a click on it.
  bg.addEventListener('click', (e) => { if (dragging) return; if (mode === 'modal' && e.target === bg) return close(); if (e.target.closest('[data-close]')) close(); });
  // Every pop up can be moved by its title bar (or its top edge when it has no title bar).
  const drag = makeDraggable(box, {
    grab: (e) => {
      const r = box.getBoundingClientRect();
      const head = box.querySelector('.card-head, .modal-head, .aud-head, h2');
      const top = head && head.getBoundingClientRect().top - r.top < 140;
      return (top && head.contains(e.target)) || e.clientY - r.top < 28;
    },
    off: () => innerWidth < 700, onMove: (v) => { dragging = v; },
  });
  box.classList.add('movable');
  const nameOf = () => (wantTitle || box.querySelector('.dp-who h2, h2, h3, .item-title')?.textContent || 'Window').replace(/\s+/g, ' ').trim().slice(0, 40);
  const subOf = () => (box.querySelector('.pd-biz, .muted, .small')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);
  const setMode = (m) => {
    mode = m;
    bg.classList.toggle('float', m === 'float');
    bg.classList.toggle('docked', m === 'docked');
    box.classList.toggle('floating', m === 'float');
    drag.reset();
    const fb = box.querySelector('.mdl-float'); if (fb) { fb.textContent = m === 'float' ? 'Full size' : 'Float'; fb.setAttribute('aria-pressed', String(m === 'float')); }
    if (m === 'docked') trayAdd(id, { title: nameOf(), sub: subOf(), onResume: () => { setMode('modal'); document.body.appendChild(bg); }, onDrop: close });
    else trayRemove(id);
  };
  const tools = document.createElement('div');
  tools.className = 'mdl-tools';
  tools.setAttribute('data-nodrag', '');
  tools.innerHTML = '<button type="button" class="mdl-float" data-nodrag aria-pressed="false" title="Keep this window on top while you use the rest of the Hub. It follows you to every page.">Float</button><button type="button" class="mdl-min" data-nodrag title="Minimize. It waits in the tray at the bottom until you pick it back up.">Minimize</button>';
  tools.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; e.stopPropagation(); if (b.classList.contains('mdl-min')) setMode('docked'); else setMode(mode === 'float' ? 'modal' : 'float'); });
  box.prepend(tools);
  // Many windows redraw their whole body; keep the buttons through that.
  new MutationObserver(() => { if (tools.parentNode !== box) box.prepend(tools); }).observe(box, { childList: true });
  function onKey(e) { if (e.key === 'Escape' && mode === 'modal' && document.body.lastElementChild === bg) close(); }
  document.addEventListener('keydown', onKey);
  // Going to another page does not lose the work: a centered window parks itself in the tray, a floating one simply stays.
  function away() { if (!closed && mode === 'modal') setMode('docked'); }
  window.addEventListener('hashchange', away);
  document.body.appendChild(bg);
  return { el: box, close, dock: () => setMode('docked'), float: () => setMode('float') };
}

export function busy(btn, on, label) {
  if (!btn) return;
  if (on) { if (!btn.disabled || !btn.dataset.label) btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${label ? ` ${esc(label)}` : ''}`; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; delete btn.dataset.label; }
}

export const KIND_LABEL = {
  setup: 'Setup', post: 'Google posts', photos: 'Photos', replies: 'Review replies', qa: 'Q&A', page: 'Local pages', content: 'Content',
  link: 'Links and citations', onpage: 'On-page', technical: 'Technical and schema', competitors: 'Competitors', calls: 'Calls and leads',
  monitor: 'Review monitoring', reputation: 'Reputation', reviews: 'Reviews', report: 'Report', meeting: 'Meeting', planning: 'Quarterly plan', custom: 'Other',
};

const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icon = {
  home: P('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  folder: P('<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>'),
  doc: P('<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>'),
  down: P('<path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>'),
  edit: P('<path d="M4 20h4l10-10a2.8 2.8 0 10-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  users: P('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 4.5a3.5 3.5 0 010 7"/><path d="M18 14a6 6 0 013.5 6"/>'),
  grid: P('<circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>'),
  star: P('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
  camera: P('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  chart: P('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  check: P('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  eye: P('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  trash: P('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  msg: P('<path d="M4 5h16v11H8l-4 4z"/>'),
  phone: P('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2"/>'),
  mail: P('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
  share: P('<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/>'),
  note: P('<path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h6"/>'),
  upload: P('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>'),
  scan: P('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5"/>'),
  dash: P('<rect x="3" y="3" width="8" height="10" rx="2"/><rect x="13" y="3" width="8" height="6" rx="2"/><rect x="13" y="11" width="8" height="10" rx="2"/><rect x="3" y="15" width="8" height="6" rx="2"/>'),
  device: P('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>'),
  menu: P('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  close: P('<path d="M6 6l12 12M18 6L6 18"/>'),
  money: P('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/>'),
  play: P('<path d="M7 4.5v15l12.5-7.5z"/>'),
  slack: P('<path d="M9 3a2 2 0 100 4h2V5a2 2 0 00-2-2zM3 9a2 2 0 002 2h4V9a2 2 0 00-4 0H3zM15 21a2 2 0 100-4h-2v2a2 2 0 002 2zM21 15a2 2 0 00-2-2h-4v2a2 2 0 004 0h2zM13 3v6h2a2 2 0 000-4 2 2 0 00-2-2zM11 21v-6H9a2 2 0 000 4 2 2 0 002 2z"/>'),
  send: P('<path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4"/>'),
  clip: P('<path d="M20 11.5l-8 8a5 5 0 01-7-7l8.5-8.5a3.5 3.5 0 015 5L10 17.5a2 2 0 01-3-3l7.5-7.5"/>'),
  smile: P('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4 4 0 007 0M9 9.5h.01M15 9.5h.01"/>'),
  back: P('<path d="M15 5l-7 7 7 7"/>'),
  next: P('<path d="M9 5l7 7-7 7"/>'),
  reply: P('<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 016 6v1"/>'),
  stop: P('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  cal: P('<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13.5h3M13.5 13.5h3M7.5 17h3"/>'),
  spark: P('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
  headset: P('<path d="M4 14v-2a8 8 0 0116 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/><path d="M19 20a4 4 0 01-4 3h-2"/>'),
  book: P('<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 21V5"/><path d="M8 7h7M8 11h5"/>'),
  cog: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
  bell: P('<path d="M6 16V11a6 6 0 0112 0v5l2 2H4z"/><path d="M10 20a2 2 0 004 0"/>'),
  meet: P('<rect x="3" y="6" width="12" height="12" rx="2"/><path d="M15 10l6-3v10l-6-3"/>'),
  key: P('<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>'),
  apps: P('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  refresh: P('<path d="M20 11a8 8 0 10-2.3 6.3"/><path d="M20 5v6h-6"/>'),
  search: P('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  info: P('<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.5"/>'),
  dots: P('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  pin: P('<path d="M9 4h6l-1 6 4 4H6l4-4z"/><path d="M12 14v7"/>'),
  clock: P('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  at: P('<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-4 8"/>'),
  fwd: P('<path d="M14 5l7 7-7 7"/><path d="M21 12H9a6 6 0 00-6 6v1"/>'),
  copy: P('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>'),
  chevron: P('<path d="M6 9l6 6 6-6"/>'),
  chain: P('<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>'),
  hash: P('<path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16"/>'),
};
