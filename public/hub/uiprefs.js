// The person's own screen settings: layouts for Dashboard, Dialer and Pipeline, and small switches like the script beside the
// call window. Saved on their account (PUT /api/me/nav { ui }), so they follow them to any computer, iPad or phone. A copy in
// localStorage paints the saved layout at once while the server copy loads.
import { api } from './core.js';
import { cleanUi } from '../js/layout.js';

const LS = 'rw-ui';
let ui = null;
try { ui = JSON.parse(localStorage.getItem(LS) || 'null'); } catch { ui = null; }
let loading = null;
const keep = () => { try { if (ui) localStorage.setItem(LS, JSON.stringify(ui)); else localStorage.removeItem(LS); } catch { /* ignore */ } };

export const uiNow = () => ui || {};
export function loadUi() {
  if (!loading) loading = api('/api/me/nav').then((r) => { if (r.prefs?.ui) { ui = r.prefs.ui; keep(); } return uiNow(); }).catch(() => uiNow());
  return loading;
}
// Save a patch ({ callScript } or { layouts: { page: layout | null } }). The screen changes first; the server follows.
let timer = null; let pending = null;
export function saveUi(patch) {
  ui = cleanUi(ui, patch) || {};
  keep();
  pending = pending ? { ...pending, ...patch, layouts: { ...(pending.layouts || {}), ...(patch.layouts || {}) } } : patch;
  clearTimeout(timer);
  timer = setTimeout(flush, 350);
}
export async function flush() {
  clearTimeout(timer);
  const p = pending; pending = null;
  if (!p) return;
  try { await api('/api/me/nav', { method: 'PUT', body: { ui: p } }); } catch { /* the local copy stays; the next change tries again */ }
}
window.addEventListener('pagehide', () => { if (pending) flush(); });
