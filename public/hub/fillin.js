// "Fill in missing info": shows what the scrubber can look up, how many leads in this view lack each piece,
// where it looks and what it costs. Nothing runs until the person presses Start.
import { $, $$, esc, api, toast, modal } from './core.js';
import { money } from '/js/pricing.js';
import { fillItems, fillPlan } from '/js/fillin.js';
export { fillItems, fillPlan };
const OPEN = (l) => !['won', 'lost', 'dnc'].includes(l.stage) && !l.dnc;

export async function fillInPanel(leads, { scrubMany, onDone, owner }) {
  const { cleanName } = await import('/js/scrub.js');
  const st = await api('/api/scrub/status').catch(() => ({}));
  const items = fillItems(leads, { cleanName, twilio: Boolean(st.twilio), owner });
  const ticked = new Set(items.filter((i) => i.leads.length && !i.off && i.free).map((i) => i.id));
  const m = modal('<div id="fi"></div>', { onClose: () => {} });
  const draw = () => {
    const plan = fillPlan(items, ticked);
    const n = plan.leads.length;
    $('#fi', m.el).innerHTML = `<div class="card-head"><h2>Fill in missing info</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
      <p class="muted">${leads.filter(OPEN).length} open leads in this view. Pick what to look up. Nothing runs until you press Start.</p>
      <ul class="list" style="margin:10px 0">${items.map((i) => `<li class="item" style="align-items:flex-start;gap:12px">
        <input type="checkbox" data-it="${i.id}" ${ticked.has(i.id) ? 'checked' : ''} ${!i.leads.length || i.off ? 'disabled' : ''} style="margin-top:4px">
        <div style="flex:1;min-width:0"><div><strong>${esc(i.title)}</strong> <span class="badge ${i.free ? '' : 'gray'}">${i.free ? 'Free' : `${money(i.usd)} each`}</span></div>
          <div class="small">${i.leads.length ? `<strong>${i.leads.length}</strong> missing it` : 'None missing'}${i.off ? ` · ${esc(i.off)}` : ''}</div>
          <div class="small muted">${esc(i.where)}</div></div></li>`).join('')}</ul>
      <p class="small muted">Owner, email, social pages and names are found in one pass, so each website is read once.</p>
      <div class="card" style="margin:10px 0;padding:12px"><strong>This run:</strong>
        ${plan.tz ? '<div class="small">Set time zones for every lead missing one (free).</div>' : ''}
        ${n ? `<div class="small">Scrub ${n} lead${n === 1 ? '' : 's'}: read their websites${plan.lookup ? `, check ${plan.lookups} phone type${plan.lookups === 1 ? '' : 's'} with Twilio` : ''}.</div>` : ''}
        ${!plan.tz && !n ? '<div class="small muted">Nothing ticked.</div>' : ''}
        <div class="small">Cost: <strong>${plan.usd ? money(plan.usd) : 'Free'}</strong>${plan.usd ? ' (Twilio, at most; leads already checked are skipped)' : ''}</div></div>
      <div class="row end"><button class="btn btn-ghost btn-sm" data-close>Cancel</button><button class="btn btn-primary" id="fistart" ${!plan.tz && !n ? 'disabled' : ''}>Start${n ? `: ${n} lead${n === 1 ? '' : 's'}` : ''}${plan.usd ? ` (${money(plan.usd)})` : ''}</button></div>`;
    $$('[data-it]', m.el).forEach((c) => c.addEventListener('change', () => { c.checked ? ticked.add(c.dataset.it) : ticked.delete(c.dataset.it); draw(); }));
    $('#fistart', m.el).addEventListener('click', async () => {
      const p = fillPlan(items, ticked);
      m.close();
      if (p.tz) await fixZones();
      if (p.leads.length) scrubMany(p.leads, onDone, { lookup: p.lookup });
      else onDone?.();
    });
  };
  draw();
}

async function fixZones() {
  let after = '', fixed = 0, unknown = 0;
  try {
    for (;;) {
      const r = await api('/api/leads/fix-timezones', { method: 'POST', body: { after } });
      fixed += r.fixed; unknown += r.unknown;
      if (!r.next) break;
      after = r.next;
    }
    toast(unknown ? `${fixed} time zones set. ${unknown} have no state, ZIP or address, so they stay in the 11am to 8pm Eastern window.` : `${fixed} time zones set.`);
  } catch (e) { toast(e.message, true); }
}
