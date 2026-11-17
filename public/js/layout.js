// Screen layouts that follow the person (pure, shared by the Worker and the browser, tests in test/layout.test.js).
// A layout is { order: [ids], hidden: [ids], size: { id: 'c6' } } per page (dashboard, dialer, pipeline). Saved in the person's
// `ui` prefs (users.nav_prefs.ui) next to the small switches such as `callScript`. Modeled on how iPhone and Android edit the
// Home Screen: reorder by dragging, remove with a badge, add back from a gallery, and some widgets can be made wider or narrower.
export const LAYOUT_PAGES = ['dashboard', 'dialer', 'pipeline', 'leaddb'];
// Column spans on the 12 column dashboard grid, with plain names.
export const SPANS = [[3, 'Quarter'], [4, 'Third'], [6, 'Half'], [8, 'Two thirds'], [12, 'Full width']];
export const spanName = (n) => (SPANS.find(([v]) => v === n) || [0, `${n} of 12 columns`])[1];
const ID = /^[a-z0-9_-]{1,32}$/;
// A saved size (Nov 2026, V: every widget resizable to any size): width in columns of 12 and/or a height in pixels, "c6", "h320" or "c6h320".
const SIZE = /^(?:c([1-9]|1[0-2]))?(?:h(\d{2,4}))?$/;
export const MIN_H = 60, MAX_H = 2400;
export function parseSize(z) {
  const m = SIZE.exec(String(z || ''));
  if (!m || (!m[1] && !m[2])) return { w: null, h: null };
  const h = m[2] ? Number(m[2]) : null;
  return { w: m[1] ? Number(m[1]) : null, h: h != null && h >= MIN_H && h <= MAX_H ? h : null };
}
export function sizeStr({ w = null, h = null } = {}) {
  const ww = Number.isInteger(w) && w >= 1 && w <= 12 ? w : null;
  const hh = Number.isFinite(h) ? Math.round(Math.min(MAX_H, Math.max(MIN_H, h))) : null;
  return `${ww ? `c${ww}` : ''}${hh ? `h${hh}` : ''}` || null;
}

// Clean one saved layout: slugs only, no repeats, a sane number of each.
export function cleanLayout(v) {
  if (!v || typeof v !== 'object') return null;
  const ids = (a) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === 'string' && ID.test(x)))].slice(0, 60) : []);
  const size = {};
  for (const [k, z] of Object.entries(v.size && typeof v.size === 'object' ? v.size : {})) {
    if (!ID.test(k) || Object.keys(size).length >= 60) continue;
    const c = sizeStr(parseSize(z));
    if (c) size[k] = c;
  }
  return { order: ids(v.order), hidden: ids(v.hidden), size };
}

// Merge a patch into the saved `ui` prefs. A patch changes only what it names; a page set to null goes back to the default layout.
export function cleanUi(old, patch) {
  const base = old && typeof old === 'object' ? old : {};
  if (!patch || typeof patch !== 'object') return Object.keys(base).length ? base : null;
  const out = { ...base, layouts: { ...(base.layouts || {}) } };
  if (typeof patch.callScript === 'boolean') out.callScript = patch.callScript;
  if (patch.layouts && typeof patch.layouts === 'object') {
    for (const page of LAYOUT_PAGES) {
      if (!(page in patch.layouts)) continue;
      const v = patch.layouts[page];
      if (v === null) { delete out.layouts[page]; continue; }
      const c = cleanLayout(v);
      if (c) out.layouts[page] = c;
    }
  }
  if (!Object.keys(out.layouts).length) delete out.layouts;
  return out;
}

export const layoutFor = (ui, page) => cleanLayout(ui?.layouts?.[page]) || { order: [], hidden: [], size: {} };

// The order to show: saved ids that still exist, then any new ones where they were by default.
export function mergeOrder(defaults, saved = []) {
  const known = new Set(defaults);
  const out = saved.filter((id) => known.has(id));
  const have = new Set(out);
  const rest = defaults.filter((id) => !have.has(id));
  // New widgets keep their default neighbour: place each right after the id that preceded it by default.
  for (const id of rest) {
    const at = defaults.indexOf(id);
    const prev = at > 0 ? defaults[at - 1] : null;
    const pos = prev && have.has(prev) ? out.indexOf(prev) + 1 : out.length;
    out.splice(pos, 0, id); have.add(id);
  }
  return out;
}

// Move `id` so it sits right before `beforeId` (null = the end). Returns a new array.
export function moveId(order, id, beforeId = null) {
  const rest = order.filter((x) => x !== id);
  const at = beforeId == null ? rest.length : rest.indexOf(beforeId);
  rest.splice(at < 0 ? rest.length : at, 0, id);
  return rest;
}

// The span a card has now, read from its w-N class (null when it has none).
export const spanOf = (className = '') => { const m = /(?:^|\s)w-([1-9]|1[0-2])(?:\s|$)/.exec(className); return m ? Number(m[1]) : null; };
// Columns for a pointer position while resizing: the share of the row from the widget's left edge, snapped to twelfths.
export function colsFor(px, rowWidth, gap = 14, min = 2) {
  const n = Math.round((12 * (px + gap)) / Math.max(1, rowWidth + gap));
  return Math.max(min, Math.min(12, n));
}
export const sizeSpan = (z) => parseSize(z).w;
// The next width when a person taps the size button. Goes narrower to wider and around.
export function nextSpan(cur, allowed = SPANS.map(([v]) => v)) {
  const list = allowed.length ? allowed : [cur];
  const i = list.indexOf(cur);
  return list[(i + 1) % list.length];
}
export const withSpan = (className = '', n) => `${className.replace(/(?:^|\s)w-([1-9]|1[0-2])(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim()} w-${n}`.trim();

// Which ids are hidden, and which are not on screen at all (their element is missing, for example owner only cards).
export const hiddenIds = (layout, present) => (layout.hidden || []).filter((id) => present.includes(id));
export const isDefault = (layout) => !layout || (!layout.order?.length && !layout.hidden?.length && !Object.keys(layout.size || {}).length);
