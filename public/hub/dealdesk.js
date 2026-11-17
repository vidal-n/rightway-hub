// Deal desk tab (Money workspace): find a client, type the price and fields, send the work order and payment link.
// Modeled on the quote and send step in PandaDoc and the Stripe Payment Links dashboard. The form is the shared component in /js/dealdesk.js,
// which also runs inside the audit report's Proposal page and My notes.
import { staffShell } from './staff.js';
import { mountDealDesk } from '/js/dealdesk.js';

export function dealDeskPage(app, user, leadId = '') {
  const view = staffShell(app, user, 'payments');
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Money</p><h1>Deal desk</h1><p class="muted">Search a client, type the price, send the work order and the payment link.</p></div></div>
    <div class="card dd-card" id="ddhost"></div>`;
  mountDealDesk(view.querySelector('#ddhost'), { leadId: leadId || '', onLead: (id) => { if (!leadId) { try { history.replaceState(null, '', `#/deals/${id}`); } catch { /* fine */ } } } });
}
