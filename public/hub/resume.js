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
const pref = (k) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const flag = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k) === '1'; sessionStorage.setItem(k, v ? '1' : '0'); } catch { /* ignore */ } return false; };

// How many are callable right now for this list. Cached a minute so three pages in a row cost one lookup.
let cache = null;
async function leftNow(rec) {
  const key = JSON.stringify(rec.filter || {});
  if (cache && cache.key === key && Date.now() - cache.at < 60e3) return cache.n;
  const qs = new URLSearchParams(Object.entries(rec.filter || {}).filter(([, v]) => v && v !== 'tier' && v !== 'cat').map(([k, v]) => [k, v])).toString();
  try { const r = await api(`/api/dialer/queue?count=1${qs ? `&${qs}` : ''}`); cache = { key, at: Date.now(), n: r.count }; return r.count; } catch { return null; }
}

// Restore the list, warm the phone inside this tap, open the dialer and start. The dialer starts itself (rw-autostart).
export async function resumeNow() {
  const rec = read() || {};
  try { localStorage.setItem('rw-dial-filter', JSON.stringify(rec.filter || {})); sessionStorage.setItem('rw-autostart', '1'); } catch { /* ignore */ }
  try { const a = await import('./audioset.js'); a.warmAudio(); a.holdMic(); } catch { /* the dialer asks again if it has to */ }
  if (/^#\/(phone|dialer)\/?$/.test(location.hash)) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = '#/phone';
}

// The popup, once per browser session, only when there is something to pick up and nobody is mid dial.
export async function maybeResume() {
  if (pref('rw-resume-off') || flag('rw-resume-seen')) return;
  const rec = offered();
  if (!rec || /^#\/(phone|dialer)/.test(location.hash) || window.__rwPowerPause) return;
  flag('rw-resume-seen', true);
  await new Promise((r) => setTimeout(r, 1400));
  if (document.querySelector('.tour, .intro, .splash') || document.querySelector('.modal-bg')) return;
  const n = await leftNow(rec);
  if (n === 0) return;
  const last = lastLine(rec);
  const m = modal(`<div class="card-head"><h2>Pick up where you left off</h2></div>
    <p class="muted" style="margin:4px 0 12px">Power dial${rec.label ? `, ${esc(rec.label)}` : ''}</p>
    <div class="rs-facts">
      <div><i>Last call</i><b>${esc(last || 'None yet')}</b></div>
      <div><i>Calls last session</i><b>${Number(rec.calls) || 0}</b></div>
      ${n == null ? '' : `<div><i>Callable now</i><b>${n}</b></div>`}
    </div>
    <div class="row" style="gap:8px;margin-top:16px;flex-wrap:wrap"><button class="btn btn-primary" id="rsgo">Resume power dial</button><button class="btn btn-ghost" id="rsopen">Just open the dialer</button><button class="btn btn-ghost" id="rsno">Not now</button></div>
    <label class="row small" style="gap:8px;margin-top:14px"><input type="checkbox" id="rsoff"> Do not show this when I open the Hub</label>
    <div class="small muted" style="margin-top:4px">The Resume button is also on the Dashboard, Phone and Pipeline pages.</div>`);
  m.el.classList.add('resume-modal');
  const done = () => { if ($('#rsoff', m.el)?.checked) try { localStorage.setItem('rw-resume-off', '1'); } catch { /* ignore */ } };
  $('#rsgo', m.el).addEventListener('click', () => { done(); m.close(); resumeNow(); });
  $('#rsopen', m.el).addEventListener('click', () => { done(); m.close(); location.hash = '#/phone'; });
  $('#rsno', m.el).addEventListener('click', () => { done(); m.close(); });
  $('#rsgo', m.el).focus();
}

// The strip at the top of Dashboard, Phone and Pipeline (staffShell calls this). It leaves when power dialing starts.
export async function mountStrip(app, active) {
  if (!['home', 'phone', 'dialer', 'pipeline'].includes(active)) return;
  const host = $('#vscroll', app) || $('#view', app)?.parentElement;
  if (!host || $('#resume-strip', host)) return;
  const rec = offered();
  if (!rec || flag('rw-resume-hide') || window.__rwPowerPause) return;
  const n = await leftNow(rec);
  if (!document.body.contains(host) || $('#resume-strip', host) || n === 0) return;
  const last = lastLine(rec);
  const el = document.createElement('div');
  el.id = 'resume-strip'; el.className = 'resume-strip';
  el.innerHTML = `<div class="rs-text"><b>Pick up where you left off</b><span>Power dial${rec.label ? `, ${esc(rec.label)}` : ''}${n == null ? '' : `, ${esc(leftText(n).replace(' in this list', ''))}`}${last ? `, last call ${esc(last)}` : ''}</span></div>
    <button class="btn btn-primary btn-sm" id="rsgo2">Resume power dial</button><button class="linkbtn small" id="rshide" title="Hide for this visit">Hide</button>`;
  host.prepend(el);
  $('#rsgo2', el).addEventListener('click', () => { el.remove(); resumeNow(); });
  $('#rshide', el).addEventListener('click', () => { flag('rw-resume-hide', true); el.remove(); });
  window.addEventListener('rw-power', () => el.remove(), { once: true });
}
