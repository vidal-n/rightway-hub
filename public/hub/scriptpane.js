// The script beside the call window: while a call is up on a computer or iPad, the script for that lead sits next to the call
// window and follows it when it is dragged. Groups and steps, coaching notes on or off, Back and Next, and swipe. It can be
// switched off for good (Dialer, Customize layout, or the Script button in the call window); the choice is saved on the
// person's account. Modeled on the script panel next to the dial pad in Close.com and Orum style power dialers.
import { $, $$, esc, isPhone } from './core.js';
import { buildScript } from '/js/leadintel.js';
import { scriptLine, scriptSettings } from './prep.js';
import { onSwipe, slideIn } from './swipe.js';
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
  else { pane.style.display = 'none'; raf = requestAnimationFrame(place); return; }
  pane.style.display = '';
  const top = Math.max(8, r.top);
  pane.style.left = `${Math.round(left)}px`;
  pane.style.width = `${Math.round(width)}px`;
  pane.style.top = `${Math.round(top)}px`;
  pane.style.height = `${Math.round(Math.max(380, Math.min(r.height, window.innerHeight - top - 12)))}px`;
  raf = requestAnimationFrame(place);
}

export function closeScript() {
  cancelAnimationFrame(raf); raf = 0;
  pane?.remove(); pane = null;
}

// Show the script for this lead. `intel` is the research if there is any, `rep` and `voice` are the same as call prep uses.
export async function showCallScript(opts) {
  cur = opts;
  closeScript();
  if (!scriptOn() || isPhone() || window.innerWidth < 720) return;
  const { lead, intel, rep = '', voice = 'I' } = opts;
  const custom = await scriptSettings();
  if (!document.querySelector('.callbar') || pane) return;
  const s = buildScript(lead, intel || null, { rep, voice }, custom);
  const startGroup = lead.stage === 'audit_booked' || (lead.meet_at && lead.meet_at > Date.now() - 3 * 3600e3) ? 'clarity' : 'analysis';
  const firstStep = Math.max(0, s.steps.findIndex((x) => x.group === startGroup));
  const el = document.createElement('aside');
  el.className = 'callscript';
  el.setAttribute('aria-label', 'Call script');
  el.innerHTML = `
    <div class="cs-head"><b>Script</b><span class="cs-who">${esc(lead.business || '')}</span>
      <label class="small cs-notes"><input type="checkbox" id="csn"> Coaching notes</label>
      <button type="button" class="cs-x" aria-label="Hide the script" title="Hide the script. Turn it back on with the Script button or in Customize layout.">×</button></div>
    <div class="seg cs-groups" role="tablist">${s.groups.map((g) => `<button type="button" class="${g.key === startGroup ? 'is-on' : ''}" data-group="${esc(g.key)}">${esc(g.name)}</button>`).join('')}</div>
    <div class="seg cs-tabs" role="tablist">${s.steps.map((st, i) => `<button type="button" role="tab" class="${i === firstStep ? 'is-on' : ''}" data-step="${i}" data-g="${esc(st.group)}"${st.group === startGroup ? '' : ' hidden'}>${esc(st.title)}</button>`).join('')}</div>
    <div class="cs-body script-body hide-notes">${s.steps.map((st, i) => {
      const sib = s.steps.map((x, j) => [x, j]).filter(([x]) => x.group === st.group), at = sib.findIndex(([, j]) => j === i);
      const back = sib[at - 1], next = sib[at + 1];
      return `<div class="script-step" data-body="${i}"${i === firstStep ? '' : ' hidden'}>${st.lines.map(scriptLine).join('')}<div class="script-nav">${back ? `<button type="button" class="btn btn-ghost btn-sm" data-go="${back[1]}">Back</button>` : '<span></span>'}<span class="script-pos small muted">${at + 1} of ${sib.length}</span>${next ? `<button type="button" class="btn btn-primary btn-sm" data-go="${next[1]}">Next: ${esc(next[0].title)}</button>` : '<span></span>'}</div></div>`;
    }).join('')}</div>
    <p class="cs-foot small muted">Swipe left for the next step, right for back.</p>`;
  document.body.appendChild(el);
  pane = el;
  const notes = $('#csn', el);
  try { notes.checked = localStorage.getItem('rw-script-notes') === '1'; } catch { /* ignore */ }
  const paintNotes = () => { $('.script-body', el).classList.toggle('hide-notes', !notes.checked); try { localStorage.setItem('rw-script-notes', notes.checked ? '1' : '0'); } catch { /* ignore */ } };
  notes.addEventListener('change', paintNotes); paintNotes();
  const go = (i) => $(`[data-step="${i}"]`, el)?.click();
  $$('[data-group]', el).forEach((b) => b.addEventListener('click', () => {
    $$('[data-group]', el).forEach((x) => x.classList.toggle('is-on', x === b));
    const tabs = $$('[data-step]', el);
    tabs.forEach((t) => { t.hidden = t.dataset.g !== b.dataset.group; });
    tabs.find((t) => !t.hidden)?.click();
  }));
  $$('[data-step]', el).forEach((b) => b.addEventListener('click', () => {
    $$('[data-step]', el).forEach((x) => x.classList.toggle('is-on', x === b));
    $$('[data-body]', el).forEach((x) => { x.hidden = x.dataset.body !== b.dataset.step; });
    $('.cs-body', el).scrollTop = 0;
  }));
  $$('[data-go]', el).forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  onSwipe($('.cs-body', el), (dir) => {
    const step = $('.script-step:not([hidden])', el);
    const btn = step && $(dir === 'next' ? '[data-go].btn-primary' : '[data-go].btn-ghost', step);
    if (btn) { btn.click(); slideIn($('.script-step:not([hidden])', el), dir); }
  });
  $('.cs-x', el).addEventListener('click', () => setScriptOn(false));
  place();
}

// Turn the script beside the call window on or off for this person. On during a call shows it at once.
export function setScriptOn(on) {
  saveUi({ callScript: Boolean(on) });
  if (!on) closeScript(); else if (cur && document.querySelector('.callbar')) showCallScript(cur);
  window.dispatchEvent(new CustomEvent('rw-callscript', { detail: Boolean(on) }));
}
