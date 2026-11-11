// Scope of work editor for a client (no packages). Switch services on or off, set how much of each a month, see the delivery time.
// Saving changes this month's tasks too: new ones are added, ones nobody started are dropped.
import { $, $$, esc, api, toast, busy, modal, fmt } from './core.js';
import { SERVICE_LIST } from '/js/plancopy.js';
import { SCOPE, effort, hoursOf } from '/js/scope.js';

export const scopeName = (id) => SERVICE_LIST.find((s) => s.id === id)?.name || id;

// A short line per service for lists: the name, with the amount when it has one.
export const scopeRows = (items) => (items || []).map((s) => `<li class="item"><span class="badge gray">${SCOPE[s.id]?.unit ? `${s.qty}x` : 'on'}</span><div><div class="item-title">${esc(scopeName(s.id))}</div>${SCOPE[s.id]?.unit ? `<div class="item-sub">${esc(SCOPE[s.id].unit)}</div>` : ''}</div><span></span></li>`).join('');

export function scopeEditor(client, current, onSaved) {
  const have = new Map((current || []).map((s) => [s.id, s.qty]));
  const m = modal(`<div class="card-head"><h2>Scope of work</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <p class="small muted" style="margin:0 0 10px">${esc(client.name)}. Switch services on or off and set how much of each a month. This sets their monthly tasks. The price is set on the deal and is not changed here.</p>
    <div class="scope-pick">${SERVICE_LIST.map((s) => {
      const c = SCOPE[s.id] || {};
      return `<div class="scope-row" data-id="${esc(s.id)}"><label class="row small" style="gap:6px;align-items:flex-start;flex:1 1 220px;flex-wrap:nowrap"><input type="checkbox" value="${esc(s.id)}"${have.has(s.id) ? ' checked' : ''}> <span><b>${esc(s.name)}</b><br><span class="muted">${esc(s.what)}</span></span></label>
        ${c.unit ? `<label class="scope-qty small"><input type="number" data-qty="${esc(s.id)}" min="${c.min}" max="${c.max}" value="${have.get(s.id) ?? c.def}" inputmode="numeric"> <span class="muted">${esc(c.unit)}</span></label>` : ''}</div>`;
    }).join('')}</div>
    <div class="scope-fx small" id="sfx"></div>
    <div class="row end" style="margin-top:14px;gap:8px"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="ssave">Save scope</button></div>`);
  const read = () => $$('.scope-row', m.el).filter((r) => $('input[type=checkbox]', r).checked).map((r) => ({ id: r.dataset.id, qty: Number($('[data-qty]', r)?.value) || undefined }));
  const fx = () => { const e = effort(read()); $('#sfx', m.el).innerHTML = `Delivery time: about <b>${hoursOf(e.monthly)} h a month</b>, plus about ${hoursOf(e.setup)} h to set up.`; };
  $('.scope-pick', m.el).addEventListener('input', fx);
  fx();
  $('#ssave', m.el).addEventListener('click', async (e) => {
    busy(e.currentTarget, true, 'Saving');
    try {
      const r = await api(`/api/clients/${client.id}/scope`, { method: 'PUT', body: { services: read() } });
      m.close();
      toast(r.synced?.added || r.synced?.removed ? `Scope saved. This month: ${r.synced.added} task${r.synced.added === 1 ? '' : 's'} added, ${r.synced.removed} removed.` : 'Scope saved');
      onSaved?.(r);
    } catch (err) { busy(e.currentTarget, false); toast(err.message, true); }
  });
  return m;
}
