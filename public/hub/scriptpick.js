// Pick a script before dialing (Nov 2026, V: we pick a script before we start dialing, and every call is tracked under it).
// The rep picks once a day per device; when an owner runs a split test, the Hub picks per lead instead (same lead, same script).
// Modeled on Orum's and Nooks' script selector next to the dialer and Outreach's even per prospect split.
import { api, modal, esc } from './core.js';
import { DIAL_SCRIPTS, assign, versionOf } from '/js/scripttest.js';
import { SCRIPT_GROUPS, DEFAULT_SCRIPT } from '/js/leadintel.js';

const KEY = 'rw-dial-script';
const ABOUT = {
  analysis: 'Offer the free competitor analysis, then book the walk through.',
  question: 'Open with a question about their business, get them talking, label it, then ask for time.',
  cold: 'Pattern interrupt, the free tailored plan, then book on the call.',
  plan: 'For leads who asked for the Game Plan or a website audit.',
};
export const scriptName = (k) => SCRIPT_GROUPS.find((g) => g[0] === k)?.[1] || k || 'No script';

let testP = null, testAt = 0, test = { on: false, variants: [] };
let customP = null, custom = { script: {} };

export function loadScriptTest(force = false) {
  if (force || !testP || Date.now() - testAt > 60e3) {
    testAt = Date.now();
    testP = api('/api/scripts/test').then((r) => (test = r.test || test)).catch(() => test);
    customP = customP || api('/api/settings').then((s) => (custom = { script: s.script || {} })).catch(() => custom);
  }
  return Promise.all([testP, customP]).then(() => test);
}
export const currentTest = () => test;

const today = () => new Date().toDateString();
export function pickedScript() {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (r && r.day === today() && DIAL_SCRIPTS.includes(r.key)) return r.key;
  } catch {}
  return null;
}
export function setPicked(key) {
  try { localStorage.setItem(KEY, JSON.stringify({ key, day: today() })); } catch {}
  window.dispatchEvent(new CustomEvent('rw-script', { detail: key }));
}

// The script for this lead: the running split test decides, otherwise the rep's pick for today.
export function scriptKeyFor(lead) {
  if (test.on && lead?.id && !lead.test) return assign(test.id, lead.id, test.variants);
  return pickedScript();
}
// What the call is logged with: the script and the version of its words (any edit in Settings makes a new version).
export function scriptTag(lead) {
  const key = scriptKeyFor(lead);
  if (!key) return null;
  const g = SCRIPT_GROUPS.find((x) => x[0] === key);
  const S = { ...DEFAULT_SCRIPT, ...(custom.script || {}) };
  return { key, v: g ? versionOf(g[2].map((id) => S[id] || '')) : null };
}

// Before the first call: make sure a script is chosen. Resolves with the key (or 'test'), or null when the rep closes the picker.
export async function ensureScript({ force = false } = {}) {
  await loadScriptTest();
  if (!force && (test.on || pickedScript())) return test.on ? 'test' : pickedScript();
  return new Promise((resolve) => {
    let done = false;
    const cur = pickedScript();
    const m = modal(`<div class="modal-head"><h3>Pick your script</h3></div>
      ${test.on ? `<p class="small sp-test"><b>Split test running:</b> ${test.variants.map((k) => esc(scriptName(k))).join(' vs ')}. The Hub picks the script for each lead, so the comparison stays fair. Your pick below is used only outside the test.</p>` : '<p class="small muted">Every call you make today is tracked under this script, so we can see which one books the most meetings.</p>'}
      <div class="sp-list">${DIAL_SCRIPTS.map((k) => `<button type="button" class="sp-card${k === cur ? ' on' : ''}" data-k="${k}"><b>${esc(scriptName(k))}</b><span>${esc(ABOUT[k] || '')}</span></button>`).join('')}</div>`,
    { onClose: () => { if (!done) resolve(null); } });
    m.el.querySelectorAll('.sp-card').forEach((b) => b.addEventListener('click', () => { done = true; setPicked(b.dataset.k); m.close(); resolve(b.dataset.k); }));
  });
}

// The chip in the dialer header: shows the script (or the running test) and opens the picker.
export function scriptChip() {
  if (test.on) return `<button type="button" class="btn btn-ghost btn-sm sp-chip" id="dscript" title="An owner is running a split test. The Hub picks the script per lead.">Split test: ${test.variants.map((k) => esc(scriptName(k))).join(' vs ')}</button>`;
  const k = pickedScript();
  return `<button type="button" class="btn ${k ? 'btn-ghost' : 'btn-primary'} btn-sm sp-chip" id="dscript">${k ? `Script: ${esc(scriptName(k))}` : 'Pick a script'}</button>`;
}
