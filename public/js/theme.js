// Light and dark mode switch (Nov 2026, V: "create a light and dark mode"; modeled on the Auto, Light, Dark picker in Linear, Slack and macOS).
// The stylesheets already carry their dark rules inside `@media (prefers-color-scheme: dark)` blocks. Instead of copying 500 rules, the choice
// rewrites those media rules in place (CSSOM): Dark makes them always apply, Light switches them off, Auto restores the originals so the device decides.
// Stored per device (localStorage rw-theme). Safe to import from any page: Hub, client app, scan tool, report pages.
const KEY = 'rw-theme';
export const MODES = ['auto', 'light', 'dark'];
export const MODE_LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };
const DARK = /\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi;
const LIGHT = /\(\s*prefers-color-scheme\s*:\s*light\s*\)/gi;
const ANY = '(min-width: 0px)';

// Pure: the media text a rule should carry for a mode (original when auto). Tested in Node.
export function mediaFor(original, mode) {
  const t = String(original || '');
  const hasDark = DARK.test(t); DARK.lastIndex = 0;
  const hasLight = LIGHT.test(t); LIGHT.lastIndex = 0;
  if (!hasDark && !hasLight) return t;
  if (mode === 'dark') return hasLight && !hasDark ? 'not all' : t.replace(DARK, ANY).replace(LIGHT, 'not all');
  if (mode === 'light') return hasDark && !hasLight ? 'not all' : t.replace(LIGHT, ANY).replace(DARK, 'not all');
  return t;
}
export const cleanMode = (m) => (MODES.includes(m) ? m : 'auto');
export function getMode() { try { return cleanMode(localStorage.getItem(KEY)); } catch { return 'auto'; } }

const orig = new WeakMap();
function walk(rules, mode) {
  for (const r of Array.from(rules || [])) {
    if (r.media && r.media.mediaText !== undefined) {
      if (!orig.has(r)) orig.set(r, r.media.mediaText);
      const want = mediaFor(orig.get(r), mode);
      if (r.media.mediaText !== want) { try { r.media.mediaText = want; } catch { /* leave it */ } }
    }
    if (r.cssRules && r.cssRules.length) walk(r.cssRules, mode);
  }
}
export function applyMode(mode = getMode()) {
  if (typeof document === 'undefined') return;
  mode = cleanMode(mode);
  const de = document.documentElement;
  if (mode === 'auto') { de.removeAttribute('data-theme'); de.style.removeProperty('color-scheme'); } else { de.setAttribute('data-theme', mode); de.style.colorScheme = mode; }
  for (const s of Array.from(document.styleSheets)) { try { walk(s.cssRules, mode); } catch { /* cross origin sheet (fonts) */ } }
  const dark = mode === 'dark' || (mode === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  de.classList.toggle('is-dark', dark);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.setAttribute('content', dark ? '#08110E' : '#0F1B17'); });
  try { window.dispatchEvent(new CustomEvent('rw-theme', { detail: { mode, dark } })); } catch { /* old browser */ }
}
export function setMode(mode) {
  mode = cleanMode(mode);
  try { if (mode === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, mode); } catch { /* private mode */ }
  applyMode(mode);
  return mode;
}
export const nextMode = (m) => MODES[(MODES.indexOf(cleanMode(m)) + 1) % MODES.length];

// Sheets that load after the first run (the Hub adds hub5.css and others) get the same treatment.
if (typeof document !== 'undefined') {
  const go = () => applyMode();
  go();
  document.addEventListener('DOMContentLoaded', go);
  window.addEventListener('load', go);
  document.querySelectorAll('link[rel="stylesheet"]').forEach((l) => l.addEventListener('load', go));
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', go); } catch { /* old browser */ }
  window.addEventListener('storage', (e) => { if (e.key === KEY) go(); });
}
