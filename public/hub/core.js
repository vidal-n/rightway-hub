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

export function modal(html, { onClose } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  let closed = false;
  const close = () => { if (closed) return; closed = true; bg.remove(); onClose?.(); };
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } });
  document.body.appendChild(bg);
  return { el: bg.firstElementChild, close };
}

export function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${label ? ` ${esc(label)}` : ''}`; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

export const PLAN_NAMES = { starter: 'Starter', growth: 'Growth', authority: 'Authority', leader: 'Market Leader' };
export const PLAN_PRICE = { starter: 597, growth: 997, authority: 1497, leader: 2497 };
export const KIND_LABEL = {
  setup: 'Setup', post: 'Google posts', photos: 'Photos', replies: 'Review replies', qa: 'Q&A', page: 'Local pages', content: 'Content',
  link: 'Links and citations', onpage: 'On-page', technical: 'Technical and schema', competitors: 'Competitors', calls: 'Calls and leads',
  monitor: 'Review monitoring', reputation: 'Reputation', reviews: 'Reviews', report: 'Report', meeting: 'Meeting', planning: 'Quarterly plan', custom: 'Other',
};

const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icon = {
  home: P('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
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
  reply: P('<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 016 6v1"/>'),
  stop: P('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  bell: P('<path d="M6 16V11a6 6 0 0112 0v5l2 2H4z"/><path d="M10 20a2 2 0 004 0"/>'),
  meet: P('<rect x="3" y="6" width="12" height="12" rx="2"/><path d="M15 10l6-3v10l-6-3"/>'),
  key: P('<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>'),
  apps: P('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
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
