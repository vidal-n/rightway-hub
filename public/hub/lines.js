// My line: your own number, and whether its calls and texts also go to your mobile. Owners give each person their line here.
import { $, $$, esc, api, toast, busy } from './core.js';
import { staffShell } from './shell.js';
import { dialTabs } from './dialout.js';

const pretty = (n) => { const d = String(n || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : n || ''; };

export async function linesPage(app, user) {
  const view = staffShell(app, user, 'dialer');
  let d, nums = { numbers: [] };
  try { [d, nums] = await Promise.all([api('/api/lines'), user.role === 'admin' ? api('/api/voice/setup').then((r) => ({ numbers: (r.numbers || []).map((n) => n.number || n.phone_number || n) })).catch(() => api('/api/dialer/numbers')) : Promise.resolve({ numbers: [] })]); }
  catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const list = [...new Set([...(nums.numbers || []).map((n) => (typeof n === 'string' ? n : n.number)), ...Object.keys(d.lines)])].filter(Boolean);
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Phone</p><h1>My line</h1></div></div>${dialTabs('line', user)}
    <div class="ana-grid">
      <div class="card"><div class="card-head"><h3>Your line</h3>${d.me.line ? `<span class="badge mono">${esc(pretty(d.me.line))}</span>` : '<span class="badge gray">No line yet</span>'}</div>
        <p class="small">${d.me.line ? 'Calls to your line ring only you: your open Hub, and your mobile if you turn it on below. Texts to it alert only you. Nobody else on the team (owners included) sees its texts, calls, voicemails or recordings. It is also your caller ID when you dial out.' : 'An owner gives you a line below. Until then, calls to the main number ring the whole team.'}</p>
        <form id="fwd" class="form-grid" style="grid-template-columns:1fr">
          <label class="field"><span>Your mobile</span><input name="phone" type="tel" inputmode="tel" value="${esc(pretty(d.me.phone))}" placeholder="(305) 555-0100"></label>
          <label class="row" style="gap:8px"><input type="checkbox" name="fwd_calls"${d.me.fwd_calls ? ' checked' : ''}> Ring my mobile too when my line gets a call</label>
          <label class="row" style="gap:8px"><input type="checkbox" name="fwd_texts"${d.me.fwd_texts ? ' checked' : ''}> Forward texts to my line to my mobile</label>
          <div class="row end"><button class="btn btn-primary" type="submit">Save</button></div></form></div>
      ${user.role === 'admin' ? `<div class="card"><div class="card-head"><h3>Who owns which number</h3><span class="small muted">Owners only</span></div>
        <p class="small">Give each person their own number. A number with nobody on it stays a team line and rings everyone. Client tracking numbers are not listed here.</p>
        ${list.length ? `<form id="own">${list.map((n) => `<div class="row" style="flex-wrap:nowrap;gap:10px;padding:8px 0;border-top:1px solid var(--line)"><span class="mono" style="flex:1">${esc(pretty(n))}</span>
          <select name="${esc(n)}" style="width:auto"><option value="">Team line (everyone)</option>${d.users.map((u) => `<option value="${esc(u.id)}"${d.lines[n] === u.id ? ' selected' : ''}>${esc(u.name)}${u.role === 'admin' ? ' (owner)' : ''}</option>`).join('')}</select></div>`).join('')}
          <div class="row end" style="margin-top:10px"><button class="btn btn-primary" type="submit">Save lines</button></div></form>` : '<p class="small muted">No Twilio numbers found. Buy one in Twilio, then connect it in Phone setup.</p>'}</div>` : ''}
    </div>`;
  $('#fwd', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; const btn = f.querySelector('button'); busy(btn, true);
    try { await api('/api/me/forwarding', { method: 'PUT', body: { phone: f.phone.value, fwd_calls: f.fwd_calls.checked, fwd_texts: f.fwd_texts.checked } }); toast('Saved'); }
    catch (err) { toast(err.message, true); }
    busy(btn, false);
  });
  $('#own', view)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const lines = Object.fromEntries($$('select', e.target).filter((s) => s.value).map((s) => [s.name, s.value]));
    try { await api('/api/lines', { method: 'PUT', body: { lines } }); toast('Lines saved'); } catch (err) { toast(err.message, true); }
  });
}
