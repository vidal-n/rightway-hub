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

// The rep's choice: a script key, or 'test' (follow the owner's split test). Kept until changed; asked again each new day, with the last
// choice already highlighted, so every dialing day starts with a deliberate pick. Changeable any time from the dialer's Script button.
const today = () => new Date().toDateString();
function readPick() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
const validPick = (k) => k === 'test' || DIAL_SCRIPTS.includes(k);
export function pickedScript({ anyDay = false } = {}) {
  const r = readPick();
  return r && validPick(r.key) && (anyDay || r.day === today()) ? r.key : null;
}
export function setPicked(key) {
  try { localStorage.setItem(KEY, JSON.stringify({ key, day: today() })); } catch {}
  window.dispatchEvent(new CustomEvent('rw-script', { detail: key }));
}

// The script for this lead and how it was chosen. The split test decides when the rep follows it (or reps may not pick their own);
// otherwise the rep's own pick. how: 'split' or 'pick'.
export function scriptChoice(lead) {
  const pick = pickedScript({ anyDay: true });
  const follow = test.on && (pick === 'test' || !pick || !test.allowPick);
  if (follow && lead?.id && !lead.test) return { key: assign(test.id, lead.id, test.variants), how: 'split' };
  if (pick && pick !== 'test') return { key: pick, how: 'pick' };
  return { key: null, how: null };
}
export const scriptKeyFor = (lead) => scriptChoice(lead).key;
// What the call is logged with: the script, the version of its words (any edit in Settings makes a new version) and how it was chosen.
export function scriptTag(lead) {
  const { key, how } = scriptChoice(lead);
  if (!key) return null;
  const g = SCRIPT_GROUPS.find((x) => x[0] === key);
  const S = { ...DEFAULT_SCRIPT, ...(custom.script || {}) };
  return { key, how, v: g ? versionOf(g[2].map((id) => S[id] || '')) : null };
}

// Before the first call of the day: make sure a choice is made. Resolves with the choice, or null when the rep closes the picker.
export async function ensureScript({ force = false } = {}) {
  await loadScriptTest();
  if (!force && pickedScript()) return pickedScript();
  if (!force && test.on && !test.allowPick) return 'test';
  return new Promise((resolve) => {
    let done = false;
    const cur = pickedScript({ anyDay: true }) || (test.on ? 'test' : null);
    const card = (k, name, about) => `<button type="button" class="sp-card${k === cur ? ' on' : ''}" data-k="${k}"><b>${esc(name)}</b><span>${esc(about)}</span></button>`;
    const testCard = test.on ? card('test', `Follow the split test: ${test.variants.map((k) => scriptName(k)).join(' vs ')}`, 'The Hub picks the script for each lead, so the comparison stays fair. Recommended while the test runs.') : '';
    const mine = !test.on || test.allowPick;
    const m = modal(`<div class="modal-head"><h3>Pick your script</h3></div>
      <p class="small muted">Every call is saved with the script you used, so we can see which one books the most meetings. You can change it any time from the Script button in the dialer.</p>
      <div class="sp-list">${testCard}${mine ? `${test.on ? '<p class="small muted sp-or">Or use your own script (your calls still count in the analytics, but not in the split test):</p>' : ''}${DIAL_SCRIPTS.map((k) => card(k, scriptName(k), ABOUT[k] || '')).join('')}` : '<p class="small muted">Your owner has the split test set so the Hub picks for everyone.</p>'}</div>`,
    { onClose: () => { if (!done) resolve(null); } });
    m.el.querySelectorAll('.sp-card').forEach((b) => b.addEventListener('click', () => { done = true; setPicked(b.dataset.k); m.close(); resolve(b.dataset.k); }));
  });
}

// The button in the dialer header: shows what this rep is dialing with and opens the picker.
export function scriptChip() {
  const pick = pickedScript({ anyDay: true });
  const following = test.on && (pick === 'test' || !pick || !test.allowPick);
  if (following) return `<button type="button" class="btn btn-ghost btn-sm sp-chip" id="dscript" title="Split test running: the Hub picks the script per lead. Tap to change.">Script: split test (${test.variants.map((k) => esc(scriptName(k))).join(' vs ')})</button>`;
  const k = pickedScript();
  const shown = k && k !== 'test' ? k : (pick && pick !== 'test' ? pick : null);
  return `<button type="button" class="btn ${k ? 'btn-ghost' : 'btn-primary'} btn-sm sp-chip" id="dscript" title="Tap to change your script">${shown ? `Script: ${esc(scriptName(shown))}${test.on ? ' (own pick)' : ''}` : 'Pick a script'}</button>`;
}
