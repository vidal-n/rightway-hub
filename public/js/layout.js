// Screen layouts that follow the person (pure, shared by the Worker and the browser, tests in test/layout.test.js).
// A layout is { order: [ids], hidden: [ids], size: { id: 'c6' } } per page (dashboard, dialer, pipeline). Saved in the person's
// `ui` prefs (users.nav_prefs.ui) next to the small switches such as `callScript`. Modeled on how iPhone and Android edit the
// Home Screen: reorder by dragging, remove with a badge, add back from a gallery, and some widgets can be made wider or narrower.
export const LAYOUT_PAGES = ['dashboard', 'dialer', 'pipeline'];
// Column spans on the 12 column dashboard grid, with plain names.
export const SPANS = [[3, 'Quarter'], [4, 'Third'], [6, 'Half'], [8, 'Two thirds'], [12, 'Full width']];
export const spanName = (n) => (SPANS.find(([v]) => v === n) || [0, `${n} columns`])[1];
const ID = /^[a-z0-9_-]{1,32}$/;
const SIZE = /^c(3|4|6|8|12)$/;

// Clean one saved layout: slugs only, no repeats, a sane number of each.
export function cleanLayout(v) {
  if (!v || typeof v !== 'object') return null;
  const ids = (a) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === 'string' && ID.test(x)))].slice(0, 60) : []);
  const size = {};
  for (const [k, z] of Object.entries(v.size && typeof v.size === 'object' ? v.size : {})) if (ID.test(k) && SIZE.test(z) && Object.keys(size).length < 60) size[k] = z;
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
export const spanOf = (className = '') => { const m = /(?:^|\s)w-(3|4|6|8|12)(?:\s|$)/.exec(className); return m ? Number(m[1]) : null; };
export const sizeSpan = (z) => (SIZE.test(z || '') ? Number(z.slice(1)) : null);
// The next width when a person taps the size button. Goes narrower to wider and around.
export function nextSpan(cur, allowed = SPANS.map(([v]) => v)) {
  const list = allowed.length ? allowed : [cur];
  const i = list.indexOf(cur);
  return list[(i + 1) % list.length];
}
export const withSpan = (className = '', n) => `${className.replace(/(?:^|\s)w-(3|4|6|8|12)(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim()} w-${n}`.trim();

// Which ids are hidden, and which are not on screen at all (their element is missing, for example owner only cards).
export const hiddenIds = (layout, present) => (layout.hidden || []).filter((id) => present.includes(id));
export const isDefault = (layout) => !layout || (!layout.order?.length && !layout.hidden?.length && !Object.keys(layout.size || {}).length);
