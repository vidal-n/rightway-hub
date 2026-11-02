// Dial out: type any number and pick which of your numbers shows as caller ID. Also the caller ID picker for the queue.
import { $, esc, api, toast, busy, icon } from './core.js';
import { staffShell } from './staff.js';

const KEY = 'rw-caller-id';
export const savedCaller = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const saveCaller = (v) => { try { localStorage.setItem(KEY, v); } catch { /* ignore */ } };

const pretty = (n) => { const d = String(n || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : n; };
export const numberLabel = (n) => (n.label && n.label !== n.number && !/^\(?\d/.test(n.label) ? `${pretty(n.number)} · ${n.label}` : pretty(n.number));

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

export const dialTabs = (active) => `<div class="tabs" style="margin-bottom:14px"><a class="${active === 'queue' ? 'is-active' : ''}" href="#/dialer">Call queue</a><a class="${active === 'out' ? 'is-active' : ''}" href="#/dialer/out">Dial out</a></div>`;

export async function dialOutPage(app, user) {
  const view = staffShell(app, user, 'dialer');
  let me, nums, recent;
  try { [me, nums, recent] = await Promise.all([api('/api/me'), api('/api/dialer/numbers'), api('/api/dialer/recent')]); }
  catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const render = () => {
    view.innerHTML = `
      <div class="page-head"><div><p class="eyebrow">Power dialer</p><h1>Dial out</h1></div></div>
      ${dialTabs('out')}
      ${!me.twilio ? '<div class="card"><p>Calling through the Hub needs the Twilio keys in Cloudflare first. Until then, type a number and use your own phone.</p></div>' : ''}
      <div class="card" style="max-width:560px">
        <form id="dform">
          <label class="field"><span>Number to call</span><input name="to" id="dto" type="tel" inputmode="tel" autocomplete="off" placeholder="(954) 555-0123" style="font-size:22px"></label>
          ${me.twilio ? callerSelect(nums.numbers) : ''}
          <div class="row" style="margin-top:14px">
            ${me.twilio ? `<button class="btn btn-primary btn-xl" style="flex:1 1 200px;width:auto" id="dgo">${icon.phone}Call through the Hub</button>` : ''}
            <a class="btn btn-mint btn-xl" style="flex:1 1 200px;width:auto" id="dtel" href="#">Call from my phone</a>
          </div>
        </form>
        ${me.twilio && !me.user.phone ? '<form id="dphone" class="row" style="margin-top:12px"><input name="phone" placeholder="Your mobile, so the Hub can ring you" style="flex:1 1 200px"><button class="btn btn-ghost btn-sm">Save</button></form>' : ''}
        <p class="small" style="margin-top:12px">The Hub rings your mobile first. Answer, and it connects you to the number from the caller ID you picked. Calls are not recorded. Numbers on your Do Not Call list are blocked.</p>
      </div>
      ${recent.calls.length ? `<div class="card" style="max-width:560px;margin-top:14px"><h3>Recent dial outs</h3>${recent.calls.map((c) => `<div class="row small" style="justify-content:space-between;padding:6px 0;border-top:1px solid var(--line)"><span>${esc((c.body || '').replace('Manual dial to ', ''))}${c.business ? ` · ${esc(c.business)}` : ''}</span><span class="muted">${esc(new Date(c.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}${c.duration ? ` · ${Math.floor(c.duration / 60)}m ${c.duration % 60}s` : ''}</span></div>`).join('')}</div>` : ''}`;
    const from = bindCaller(view);
    const to = () => $('#dto', view).value.trim();
    $('#dtel', view).addEventListener('click', (e) => { const n = to().replace(/[^\d+]/g, ''); if (!n) { e.preventDefault(); return toast('Type a number first.', true); } e.currentTarget.href = `tel:${n}`; });
    $('#dform', view).addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!me.twilio) return;
      const btn = $('#dgo', view);
      if (!to()) return toast('Type a number first.', true);
      busy(btn, true, 'Ringing you...');
      try {
        const r = await api('/api/dialer/dial', { method: 'POST', body: { to: to(), from: from() } });
        toast(r.lead ? `Your phone is ringing. Calling ${r.lead.business}.` : 'Your phone is ringing. Answer to connect.');
        recent = await api('/api/dialer/recent');
        setTimeout(() => { if (document.body.contains(view)) { const v = $('#dto', view)?.value; render(); const i = $('#dto', view); if (i) i.value = v; } }, 3500);
      } catch (err) { toast(err.message, true); busy(btn, false); }
    });
    $('#dphone', view)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const r = await api('/api/me/phone', { method: 'PUT', body: { phone: e.target.phone.value } }); me.user.phone = r.phone; toast('Saved'); render(); } catch (err) { toast(err.message, true); }
    });
  };
  render();
}
