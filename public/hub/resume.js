// "Pick up where you left off" for the power dialer: a popup when the Hub opens, and a Resume strip on Dashboard, Phone and
// Pipeline. The record (public/js/resumestate.js) lives on this device. Resume restores the same call list, then starts power
// dialing; the mic and audio are warmed inside the tap so iPad and iPhone allow it. Modeled on the resume prompts in Close.com
// and Outreach dialers (reopen the same list at the next lead).
import { $, esc, api, modal } from './core.js';
import { KEY, merge, usable, lastLine, leftText } from '../js/resumestate.js';

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
export function saveDial(patch) {
  try { localStorage.setItem(KEY, JSON.stringify(merge(read(), patch))); } catch { /* ignore */ }
}
export const offered = () => { const r = read(); return usable(r) ? r : null; };

// What we know about where this person left off. This device's own record wins (it has the list and the count); with none,
// the server's last call fills in, so the strip works on a new device, after clearing the browser, or before any dial on this build.
let srv = null;
async function fromServer() {
  if (srv && Date.now() - srv.at < 60e3) return srv.v;
  let v = null;
  try { v = await api('/api/dialer/resume'); } catch { /* offline: show the plain start state */ }
  srv = { at: Date.now(), v };
  return v;
}
export async function where() {
  const local = offered();
  const rec = local || {};
  if (local) return { rec, history: true };
  const s = await fromServer();
  if (s?.last) return { rec: { label: '', filter: {}, calls: s.calls || 0, last: { business: s.last.business, at: s.last.at } }, history: true };
  return { rec, history: false };
}
const pref = (k) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const flag = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k) === '1'; sessionStorage.setItem(k, v ? '1' : '0'); } catch { /* ignore */ } return false; };

// The count of callable leads used to be fetched here on every page, which loads and scores up to 1000 leads and slowed the Hub.
// It is not fetched any more; the strip and popup say "ready" without a number. The dialer itself shows the real queue.
async function leftNow() { return null; }

// Restore the list, warm the phone inside this tap, open the dialer and start. The dialer starts itself (rw-autostart).
export async function resumeNow() {
  const rec = read() || {};
  try { localStorage.setItem('rw-dial-filter', JSON.stringify(rec.filter || {})); sessionStorage.setItem('rw-autostart', '1'); } catch { /* ignore */ }
  try { const a = await import('./audioset.js'); a.warmAudio(); a.holdMic(); } catch { /* the dialer asks again if it has to */ }
  if (/^#\/(phone|dialer)\/?$/.test(location.hash)) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = '#/phone';
}

// Words for the strip and popup, whatever the state: ready to resume, nobody callable, or a first dial.
export function stateText(rec, n, history) {
  const last = lastLine(rec);
  const list = rec.label ? `, ${rec.label}` : '';
  if (n === 0) return { head: history ? 'Pick up where you left off' : 'Power dial', line: `No one is callable right now${list}. Calling hours are 8am to 8pm in their time zone.${last ? ` Last call ${last}.` : ''}`, btn: 'Open the dialer', go: false };
  if (!history) return { head: 'Ready to dial', line: `${n == null ? 'Your call list is ready.' : `${n} ${n === 1 ? 'lead is' : 'leads are'} callable right now.`}`, btn: 'Start power dial', go: true };
  return { head: 'Pick up where you left off', line: `Power dial${list}${n == null ? '' : `, ${leftText(n).replace(' in this list', '')}`}${last ? `, last call ${last}` : ''}`, btn: 'Resume power dial', go: true };
}

// The popup, once per browser session. It waits for the intro, tour or any other window to finish instead of giving up.
export async function maybeResume() {
  if (pref('rw-resume-off') || flag('rw-resume-seen')) return;
  if (/^#\/(phone|dialer)/.test(location.hash) || window.__rwPowerPause) return;
  flag('rw-resume-seen', true);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 900));
    if (!document.querySelector('.tour, .intro, .splash, .modal-bg')) break;
    if (i === 19) { flag('rw-resume-seen', false); return; }
  }
  if (/^#\/(phone|dialer)/.test(location.hash) || window.__rwPowerPause) return;
  const { rec, history } = await where();
  const n = await leftNow(rec);
  if (n === 0 && !history) return;
  const st = stateText(rec, n, history);
  const m = modal(`<div class="card-head"><h2>${esc(st.head)}</h2></div>
    <p class="muted" style="margin:4px 0 12px">Power dial${rec.label ? `, ${esc(rec.label)}` : ''}</p>
    <div class="rs-facts">
      <div><i>Last call</i><b>${esc(lastLine(rec) || 'None yet')}</b></div>
      <div><i>Calls last session</i><b>${Number(rec.calls) || 0}</b></div>
      ${n == null ? '' : `<div><i>Callable now</i><b>${n}</b></div>`}
    </div>
    ${n === 0 ? `<p class="small muted" style="margin-top:10px">${esc(st.line)}</p>` : ''}
    <div class="row" style="gap:8px;margin-top:16px;flex-wrap:wrap">${st.go ? `<button class="btn btn-primary" id="rsgo">${esc(st.btn)}</button><button class="btn btn-ghost" id="rsopen">Just open the dialer</button>` : `<button class="btn btn-primary" id="rsopen">${esc(st.btn)}</button>`}<button class="btn btn-ghost" id="rsno">Not now</button></div>
    <label class="row small" style="gap:8px;margin-top:14px"><input type="checkbox" id="rsoff"> Do not show this when I open the Hub</label>
    <div class="small muted" style="margin-top:4px">The Resume bar is also at the top of the Dashboard, Phone and Pipeline pages.</div>`);
  m.el.classList.add('resume-modal');
  const done = () => { if ($('#rsoff', m.el)?.checked) try { localStorage.setItem('rw-resume-off', '1'); } catch { /* ignore */ } };
  $('#rsgo', m.el)?.addEventListener('click', () => { done(); m.close(); resumeNow(); });
  $('#rsopen', m.el).addEventListener('click', () => { done(); m.close(); location.hash = '#/phone'; });
  $('#rsno', m.el).addEventListener('click', () => { done(); m.close(); });
  ($('#rsgo', m.el) || $('#rsopen', m.el)).focus();
}

// The strip at the top of Dashboard, Phone and Pipeline (staffShell calls this). It is always there, in every state, until
// power dialing starts or it is hidden for this visit.
export async function mountStrip(app, active) {
  if (!['home', 'phone', 'dialer', 'pipeline'].includes(active)) return;
  const host = $('#vscroll', app) || $('#view', app)?.parentElement;
  if (!host || $('#resume-strip', host) || flag('rw-resume-hide') || window.__rwPowerPause) return;
  const el = document.createElement('div');
  el.id = 'resume-strip'; el.className = 'resume-strip';
  el.innerHTML = '<div class="rs-text"><b>Power dial</b><span>Checking where you left off</span></div>';
  host.prepend(el);
  const { rec, history } = await where();
  const n = await leftNow(rec);
  if (!document.body.contains(el)) return;
  const st = stateText(rec, n, history);
  el.innerHTML = `<div class="rs-text"><b>${esc(st.head)}</b><span>${esc(st.line)}</span></div>
    <button class="btn btn-primary btn-sm" id="rsgo2">${esc(st.btn)}</button><button class="linkbtn small" id="rshide" title="Hide for this visit">Hide</button>`;
  $('#rsgo2', el).addEventListener('click', () => { if (st.go) { el.remove(); resumeNow(); } else location.hash = '#/phone'; });
  $('#rshide', el).addEventListener('click', () => { flag('rw-resume-hide', true); el.remove(); });
  window.addEventListener('rw-power', () => el.remove(), { once: true });
}
