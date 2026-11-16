// The script beside the call window: while a call is up on a computer or iPad, the script for that lead sits next to the call
// window and follows it when it is dragged. One paper style page per script (every step in order, scroll to read), prompts on or off. It can be
// switched off for good (Dialer, Customize layout, or the Script button in the call window); the choice is saved on the
// person's account. Modeled on the script panel next to the dial pad in Close.com and Orum style power dialers.
import { scriptKeyFor } from './scriptpick.js';
import { $, $$, esc, isPhone } from './core.js';
import { buildScript, COLD_GROUPS } from '/js/leadintel.js';
import { scriptSettings } from './prep.js';
import { paperPage } from '/js/scriptprint.js';
import { uiNow, saveUi } from './uiprefs.js';

export const scriptOn = () => uiNow().callScript !== false;
let pane = null;
let raf = 0;
let cur = null; // what to show next time the setting is turned on during the same call

const GAP = 10;
function place() {
  if (!pane) return;
  const bar = document.querySelector('.callbar');
  if (!bar || bar.dataset.state === 'wrap' || bar.dataset.state === 'ended' || document.body.classList.contains('pdx')) return closeScript();
  const r = bar.getBoundingClientRect();
  const leftRoom = r.left - 12, rightRoom = window.innerWidth - r.right - 12;
  let width, left;
  if (leftRoom >= 300) { width = Math.min(480, leftRoom - GAP); left = r.left - width - GAP; }
  else if (rightRoom >= 300) { width = Math.min(480, rightRoom - GAP); left = r.right + GAP; }
  else { pane.style.display = 'none'; pane.__k = ''; raf = requestAnimationFrame(place); return; }
  const top = Math.max(8, r.top);
  const h = Math.round(Math.max(380, Math.min(r.height, window.innerHeight - top - 12)));
  const key = `${Math.round(left)}|${Math.round(width)}|${Math.round(top)}|${h}`;
  // Only touch the page when the call window moved (writing styles every frame forced a layout 60 times a second).
  if (pane.__k !== key) {
    pane.__k = key;
    pane.style.display = '';
    pane.style.left = `${Math.round(left)}px`;
    pane.style.width = `${Math.round(width)}px`;
    pane.style.top = `${Math.round(top)}px`;
    pane.style.height = `${h}px`;
  }
  raf = requestAnimationFrame(place);
}

export function closeScript() {
  cancelAnimationFrame(raf); raf = 0;
  pane?.remove(); pane = null;
}

// The call window is made a moment after the Call tap (the call is prepared first), so wait for it instead of giving up: the
// script used to stay hidden on every call after the first because the window did not exist yet when we looked.
const waitForBar = async (token) => {
  for (let i = 0; i < 75; i++) {
    if (token !== shown) return false;
    const bar = document.querySelector('.callbar');
    if (bar && bar.dataset.state !== 'wrap' && bar.dataset.state !== 'ended') return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};
let shown = 0; // newest request wins: a slow earlier call can never paint its lead's script over the current lead's

// Show the script for this lead. `intel` is the research if there is any, `rep` and `voice` are the same as call prep uses.
// It follows the saved on or off choice: open stays open for every call until the person hides it.
export async function showCallScript(opts) {
  cur = opts;
  const token = ++shown;
  closeScript();
  if (!scriptOn() || isPhone() || window.innerWidth < 720) return;
  const { lead, intel, rep = '', voice = 'I' } = opts;
  const custom = await scriptSettings();
  if (token !== shown || !(await waitForBar(token))) return;
  closeScript();
  const s = buildScript(lead, intel || null, { rep, voice }, custom);
  // Cold call scripts only: the meeting script is never shown beside a call.
  const picked = scriptKeyFor(lead);
  const startGroup = COLD_GROUPS.includes(picked) ? picked : 'analysis';
  // Only the script picked for the campaign (or assigned by the split test) can be read here; with no pick every cold script shows.
  const only = COLD_GROUPS.includes(picked) ? picked : null;
  const groups = s.groups.filter((g) => g.kind === 'cold' && (!only || g.key === only));
  const cold = s.steps.filter((st) => st.kind === 'cold' && (!only || st.group === only));
  const el = document.createElement('aside');
  el.className = 'callscript';
  el.setAttribute('aria-label', 'Call script');
  el.innerHTML = `
    <div class="cs-head"><b>Script</b><span class="cs-who">${esc(lead.business || '')}</span>
      <label class="small cs-notes"><input type="checkbox" id="csn"> Prompts</label>
      <button type="button" class="cs-x" aria-label="Hide the script" title="Hide the script. Turn it back on with the Script button or in Customize layout.">×</button></div>
    <div class="seg cs-groups" role="tablist"${groups.length < 2 ? ' hidden' : ''}>${groups.map((g) => `<button type="button" class="${g.key === startGroup ? 'is-on' : ''}" data-group="${esc(g.key)}">${esc(g.name)}</button>`).join('')}</div>
    <div class="cs-body script-body script-read doc paper">${groups.map((g) => `<div class="script-page" data-page="${esc(g.key)}"${g.key === startGroup || groups.length < 2 ? '' : ' hidden'}>${paperPage(cold.filter((st) => st.group === g.key))}</div>`).join('')}</div>`;
  document.body.appendChild(el);
  pane = el;
  const notes = $('#csn', el);
  try { notes.checked = localStorage.getItem('rw-script-notes') !== '0'; } catch { notes.checked = true; }
  const paintNotes = () => { $('.script-body', el).classList.toggle('hide-notes', !notes.checked); try { localStorage.setItem('rw-script-notes', notes.checked ? '1' : '0'); } catch { /* ignore */ } };
  notes.addEventListener('change', paintNotes); paintNotes();
  $$('[data-group]', el).forEach((b) => b.addEventListener('click', () => {
    $$('[data-group]', el).forEach((x) => x.classList.toggle('is-on', x === b));
    $$('[data-page]', el).forEach((x) => { x.hidden = x.dataset.page !== b.dataset.group; });
    $('.cs-body', el).scrollTop = 0;
  }));
  $('.cs-x', el).addEventListener('click', () => setScriptOn(false));
  place();
}

// Turn the script beside the call window on or off for this person. On during a call shows it at once.
export function setScriptOn(on) {
  saveUi({ callScript: Boolean(on) });
  if (!on) closeScript(); else if (cur && document.querySelector('.callbar')) showCallScript(cur);
  window.dispatchEvent(new CustomEvent('rw-callscript', { detail: Boolean(on) }));
}
