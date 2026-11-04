// Dial out: a dial pad that calls through the computer (mic and speakers), with a choice of caller ID.
// Also the caller ID picker and tabs shared with the call queue.
import { $, $$, esc, api, toast, busy } from './core.js';
import { staffShell } from './staff.js';
import { placeCall, startPhone, phoneState, onPhoneState, picon, pretty } from './phone.js';
import { dispositionModal } from './dispo.js';

const KEY = 'rw-caller-id';
export const savedCaller = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const saveCaller = (v) => { try { localStorage.setItem(KEY, v); } catch { /* ignore */ } };

export const numberLabel = (n) => (n.label && n.label !== n.number && !/^[(+\d]/.test(n.label) ? `${pretty(n.number)} · ${n.label}` : pretty(n.number));

export function callerSelect(numbers, id = 'dfrom') {
  if (!numbers?.length) return '';
  const cur = numbers.some((n) => n.number === savedCaller()) ? savedCaller() : numbers[0].number;
  return `<label class="field callerid"><span>Call from</span><select id="${id}">${numbers.map((n) => `<option value="${esc(n.number)}"${n.number === cur ? ' selected' : ''}>${esc(numberLabel(n))}</option>`).join('')}</select></label>`;
}
export function bindCaller(root, id = 'dfrom') {
  const el = $(`#${id}`, root);
  el?.addEventListener('change', () => saveCaller(el.value));
  return () => el?.value || undefined;
}

// Phone: the dialer, texts, calls and voicemail, recordings and (owners) live calls and setup, in one place.
export const dialTabs = (active, user) => {
  const tabs = [['queue', '#/phone', 'Dialer'], ['out', '#/phone/out', 'Dial out'], ['texts', '#/phone/texts', 'Texts', 'texts'], ['calls', '#/phone/calls', 'Calls and voicemail', 'calls'], ['recordings', '#/phone/recordings', 'Recordings']];
  tabs.push(['agents', '#/agents', 'Agents']);
  if (user?.role === 'admin') tabs.push(['setup', '#/phone/setup', 'Phone setup']);
  setTimeout(() => import('./nav.js').then((m) => m.refreshBadges()), 0);
  return `<div class="tabs" style="margin-bottom:14px">${tabs.map(([k, h, n, b]) => `<a class="${active === k ? 'is-active' : ''}" href="${h}">${n}${b ? ` <b class="nbadge" data-badge="${b}" hidden></b>` : ''}</a>`).join('')}</div>`;
};

export function phoneBadge(s = phoneState()) {
  const map = { ready: ['good', 'Phone ready'], loading: ['wait', 'Starting the phone...'], error: ['bad', s.reason || 'Phone not ready'], off: ['wait', 'Starting the phone...'] };
  const [cls, text] = s.onCall ? ['live', 'On a call'] : map[s.status] || map.off;
  return `<span class="phone-badge ${cls}"><i></i>${esc(text)}</span>`;
}

const KEYS = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']];
const fmtTyped = (v) => {
  const d = v.replace(/[^\d]/g, '');
  if (/[^\d\s()+-]/.test(v) || v.startsWith('+')) return v;
  const x = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  if (x.length <= 3) return x;
  if (x.length <= 6) return `(${x.slice(0, 3)}) ${x.slice(3)}`;
  if (x.length <= 10) return `(${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6)}`;
  return d;
};

export async function dialOutPage(app, user) {
  const view = staffShell(app, user, 'dialer');
  let me, nums, recent;
  try { [me, nums, recent] = await Promise.all([api('/api/me'), api('/api/dialer/numbers'), api('/api/dialer/recent')]); }
  catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  if (me.twilio) startPhone().catch(() => {});
  const recentHtml = () => (recent.calls.length ? recent.calls.map((c) => {
    const num = (c.body || '').replace('Manual dial to ', '').split(' from ')[0];
    return `<button type="button" class="recent-row" data-redial="${esc(num)}"><span><b>${esc(c.business || pretty(num))}</b><small>${esc(c.business ? pretty(num) : '')}</small></span><span class="muted small">${c.dispo ? `<span class="badge gray">${esc(c.dispo)}</span> ` : ''}${esc(new Date(c.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}${c.duration ? ` · ${Math.floor(c.duration / 60)}m ${c.duration % 60}s` : ''}</span></button>`;
  }).join('') : '<p class="small muted">Numbers you dial show up here.</p>');

  view.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">Power dialer</p><h1>Dial out</h1></div><div id="pbadge">${me.twilio ? phoneBadge() : ''}</div></div>
    ${dialTabs('out', user)}
    ${!me.twilio ? '<div class="card" style="margin-bottom:14px"><p>Calling through the Hub needs the Twilio keys in Cloudflare first.</p></div>' : ''}
    <div class="dialout-grid">
      <form class="card dialpad" id="dform" autocomplete="off">
        <input id="dto" class="dp-display" type="tel" inputmode="tel" placeholder="Enter a number" aria-label="Number to call">
        <div class="dp-keys">${KEYS.map(([k, l]) => `<button type="button" class="dp-key" data-k="${k}"><b>${k}</b><small>${l || '&nbsp;'}</small></button>`).join('')}</div>
        ${me.twilio ? callerSelect(nums.numbers) : ''}
        <div class="dp-row">
          <span></span>
          <button class="dp-call" id="dgo" aria-label="Call"${me.twilio ? '' : ' disabled'}>${picon.phone}</button>
          <button type="button" class="dp-back" id="dback" aria-label="Delete last digit">${picon.back}</button>
        </div>
        <p class="small muted" style="text-align:center;margin:12px 0 0">Calls use your computer's mic and speakers. A headset sounds best. Not recorded.</p>
      </form>
      <div class="card"><h3>Recent dial outs</h3><div id="drecent">${recentHtml()}</div></div>
    </div>`;

  const input = $('#dto', view);
  const from = bindCaller(view);
  const off = onPhoneState((s) => { const b = $('#pbadge', view); if (!document.body.contains(view)) return off(); if (b && me.twilio) b.innerHTML = phoneBadge(s); });
  input.addEventListener('input', () => { const pos = input.value.length; input.value = fmtTyped(input.value); if (pos === input.value.length) input.setSelectionRange(pos, pos); });
  $$('.dp-key', view).forEach((b) => b.addEventListener('click', () => { input.value = fmtTyped(input.value + b.dataset.k); input.focus(); }));
  $('#dback', view).addEventListener('click', () => { input.value = fmtTyped(input.value.replace(/[\d*#](?=[^\d*#]*$)/, '')); input.focus(); });
  $('#drecent', view).addEventListener('click', (e) => { const r = e.target.closest('[data-redial]'); if (r) { input.value = fmtTyped(r.dataset.redial); input.focus(); } });
  $('#dform', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!me.twilio) return;
    if (!input.value.trim()) return toast('Type a number first.', true);
    const btn = $('#dgo', view);
    busy(btn, true);
    try {
      const refresh = async () => { try { recent = await api('/api/dialer/recent'); const el = $('#drecent', view); if (el) el.innerHTML = recentHtml(); } catch { /* ignore */ } };
      await placeCall({ to: input.value.trim(), from: from(), onEnd: (r) => {
        refresh();
        dispositionModal({ title: r.name || pretty(r.to), sub: r.leadId ? 'This number is a lead. The result moves it to the right next step.' : '', answered: r.answered,
          askLead: !r.leadId, number: pretty(r.to),
          onSave: async (d) => { const res = await api(`/api/voice/calls/${r.activityId}/disposition`, { method: 'POST', body: d }); toast(res.leadId && !r.leadId ? 'Saved and added as a lead' : 'Saved'); refresh(); } });
      } });
    } catch (err) { toast(err.message, true); } finally { busy(btn, false); }
  });
  const pre = new URLSearchParams(location.hash.split('?')[1] || '').get('n');
  if (pre) input.value = fmtTyped(pre);
  input.focus();
}
