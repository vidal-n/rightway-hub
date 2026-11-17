// Deal desk component: find a client, type the price and fields, make the work order and payment link, and send them.
// Modeled on the quote and send step in PandaDoc and the Stripe Payment Links dashboard: one screen, a few fields, one send.
// Used in three places: the Hub tab "Deal desk" (#/deals), the Proposal page of the audit report, and My notes during a presentation.
// All money rules live on the server (work order and payment link routes): amounts are typed, never defaulted, and a missing Stripe key says so.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (c) => `$${((c || 0) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const STATUS = { sent: ['warn', 'Sent, not signed'], signed: ['good', 'Signed, waiting on payment'], paid: ['good', 'Paid'], void: ['gray', 'Void'] };

async function call(path, method = 'GET', body) {
  const res = await fetch(path, { method, headers: { 'x-rw': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Something went wrong (${res.status})`); e.status = res.status; throw e; }
  return data;
}
const copyText = async (t) => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };

// host: element to fill. opts: { leadId, compact, onLead(id) }
export function mountDealDesk(host, opts = {}) {
  const S = { lead: null, quote: {}, orders: [], kind: 'seo', msg: '', err: '', busy: false, link: '', results: null };
  const say = (m, bad) => { S.msg = bad ? '' : m; S.err = bad ? m : ''; paintMsg(); };
  const paintMsg = () => { const el = host.querySelector('.dd-msg'); if (el) { el.className = `dd-msg ${S.err ? 'bad' : S.msg ? 'good' : ''}`; el.textContent = S.err || S.msg || ''; } };

  async function load(id) {
    try {
      const d = await call(`/api/leads/${encodeURIComponent(id)}/deal`);
      S.lead = d.lead; S.quote = d.quote || {}; S.orders = d.orders || []; S.link = ''; S.err = ''; S.msg = '';
      opts.onLead?.(id);
    } catch (e) { S.lead = null; S.err = e.message; }
    draw();
  }

  function drawFind() {
    host.innerHTML = `<div class="dd ${opts.compact ? 'compact' : ''}">
      <h3 class="dd-h">Find the client</h3>
      <input class="input dd-q" type="search" placeholder="Business, owner, phone or email" autocomplete="off" aria-label="Search clients">
      <div class="dd-results">${S.results == null ? '<p class="muted small">Type at least 2 letters or 4 digits.</p>' : S.results.length ? S.results.map((l) => `<button type="button" class="dd-row" data-id="${esc(l.id)}"><b>${esc(l.business)}</b><span>${esc([l.contact_name || l.owner_name, l.phone, l.city].filter(Boolean).join(' · '))}</span></button>`).join('') : '<p class="muted small">No match. Add them below.</p>'}</div>
      <details class="dd-new"><summary>Add someone new</summary>
        <div class="dd-grid"><label>Business<input class="input" data-n="business"></label><label>Contact name<input class="input" data-n="contact_name"></label>
          <label>Phone<input class="input" data-n="phone" inputmode="tel"></label><label>Email<input class="input" data-n="email" type="email"></label></div>
        <button type="button" class="btn btn-primary btn-sm" id="dd-add">Add and open</button></details>
      <div class="dd-msg ${S.err ? 'bad' : ''}">${esc(S.err)}</div></div>`;
    const q = host.querySelector('.dd-q');
    let t = null;
    q.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const v = q.value.trim();
        if (v.length < 2) { S.results = null; host.querySelector('.dd-results').innerHTML = '<p class="muted small">Type at least 2 letters or 4 digits.</p>'; return; }
        try { S.results = (await call(`/api/deals/search?q=${encodeURIComponent(v)}`)).leads; } catch (e) { S.results = []; say(e.message, true); }
        const box = host.querySelector('.dd-results');
        box.innerHTML = S.results.length ? S.results.map((l) => `<button type="button" class="dd-row" data-id="${esc(l.id)}"><b>${esc(l.business)}</b><span>${esc([l.contact_name || l.owner_name, l.phone, l.city].filter(Boolean).join(' · '))}</span></button>`).join('') : '<p class="muted small">No match. Add them below.</p>';
      }, 250);
    });
    host.addEventListener('click', onFindClick);
    q.focus();
  }
  function onFindClick(e) {
    const row = e.target.closest('.dd-row');
    if (row && host.contains(row)) { host.removeEventListener('click', onFindClick); load(row.dataset.id); return; }
    if (e.target.id === 'dd-add') {
      const v = Object.fromEntries([...host.querySelectorAll('[data-n]')].map((i) => [i.dataset.n, i.value.trim()]));
      call('/api/deals/lead', 'POST', v).then((r) => { host.removeEventListener('click', onFindClick); load(r.id); }).catch((er) => say(er.message, true));
    }
  }

  function orderRow(o) {
    const [tone, label] = STATUS[o.status] || ['gray', o.status];
    return `<div class="dd-order"><div><b>${o.kind === 'website' ? 'Website' : 'Local marketing'}</b> <span class="dd-tag ${tone}">${esc(label)}</span>
      <div class="muted small">${esc(money(o.setup_cents))} ${o.kind === 'website' ? 'build' : 'buildout'}${o.monthly_cents ? `, ${esc(money(o.monthly_cents))} a month` : ''}${o.emailed ? ` · emailed to ${esc(o.emailed)}` : ''}</div></div>
      <div class="dd-acts"><button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(o.url)}">Copy link</button>
        <a class="btn btn-ghost btn-sm" href="sms:${esc((S.lead.phone || '').replace(/\D/g, ''))}?&body=${encodeURIComponent(`Here is your work order from Rightway Growth: ${o.url}`)}">Text it</a>
        ${o.status !== 'paid' ? `<button type="button" class="btn btn-ghost btn-sm" data-email="${esc(o.id)}">Email</button>` : ''}
        ${o.pay_url && o.status !== 'paid' ? `<button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(o.pay_url)}">Copy pay link</button>` : ''}
        <a class="btn btn-ghost btn-sm" href="${esc(o.url)}" target="_blank" rel="noopener">Open</a></div></div>`;
  }

  function draw() {
    if (!S.lead) { drawFind(); return; }
    const l = S.lead, q = S.quote || {};
    const web = S.kind === 'website';
    host.innerHTML = `<div class="dd ${opts.compact ? 'compact' : ''}">
      <div class="dd-head"><div><h3 class="dd-h">${esc(l.business)}</h3><div class="muted small">${esc([l.city, l.state].filter(Boolean).join(', '))}</div></div>
        ${opts.leadId ? '' : '<button type="button" class="btn btn-ghost btn-sm" id="dd-change">Change client</button>'}</div>
      <div class="dd-grid"><label>Contact name<input class="input" data-c="contact_name" value="${esc(l.contact_name)}"></label><label>Email (for the work order)<input class="input" data-c="email" type="email" value="${esc(l.email)}"></label>
        <label>Phone<input class="input" data-c="phone" inputmode="tel" value="${esc(l.phone)}"></label></div>
      <div class="dd-seg" role="tablist"><button type="button" class="${web ? '' : 'on'}" data-kind="seo">Local marketing</button><button type="button" class="${web ? 'on' : ''}" data-kind="website">Website</button></div>
      <div class="dd-grid"><label>${web ? 'Build fee' : 'Buildout'} ($)<input class="input" id="dd-setup" inputmode="decimal" value="${q.setup != null && !web ? esc(q.setup) : ''}" placeholder="Type it"></label>
        <label>${web ? 'Monthly care ($, optional)' : 'Monthly ($)'}<input class="input" id="dd-monthly" inputmode="decimal" value="${q.monthly != null && !web ? esc(q.monthly) : ''}" placeholder="Type it"></label></div>
      ${web ? '<label>What the website includes (one per line)<textarea class="input" id="dd-scope" rows="4" placeholder="5 pages&#10;Mobile friendly design&#10;Contact form"></textarea></label>' : `<p class="muted small">${(q.services || []).length ? `${(q.services || []).length} services saved on this quote.` : 'No services saved yet. The work order uses what the research recommends.'} Amounts are always typed, never filled in for you.</p>`}
      <div class="dd-btns"><button type="button" class="btn btn-primary" id="dd-wo">Create and send work order</button><button type="button" class="btn btn-ghost" id="dd-pay">Make payment link</button></div>
      ${S.link ? `<div class="dd-link"><input class="input mono" readonly value="${esc(S.link)}"><button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(S.link)}">Copy</button></div>` : ''}
      <div class="dd-msg ${S.err ? 'bad' : S.msg ? 'good' : ''}">${esc(S.err || S.msg)}</div>
      ${S.orders.length ? `<h4 class="dd-sub">Work orders</h4>${S.orders.map(orderRow).join('')}` : ''}
    </div>`;
  }

  const val = (id) => host.querySelector(id)?.value.trim() || '';
  async function saveContact() {
    const patch = {};
    host.querySelectorAll('[data-c]').forEach((i) => { if ((S.lead[i.dataset.c] || '') !== i.value.trim()) patch[i.dataset.c] = i.value.trim(); });
    if (!Object.keys(patch).length) return;
    await call(`/api/leads/${encodeURIComponent(S.lead.id)}`, 'PATCH', patch);
    Object.assign(S.lead, patch);
  }
  async function busy(btn, fn) {
    if (S.busy) return; S.busy = true; const t = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = 'Working'; }
    try { await fn(); } catch (e) { say(e.message, true); } finally { S.busy = false; if (btn) { btn.disabled = false; btn.textContent = t; } }
  }

  host.addEventListener('click', async (e) => {
    const t = e.target;
    const cp = t.closest('[data-copy]');
    if (cp) { say((await copyText(cp.dataset.copy)) ? 'Link copied.' : 'Could not copy. Select the link and copy it.', false); return; }
    if (t.closest('#dd-change')) { S.lead = null; S.results = null; draw(); return; }
    const kind = t.closest('[data-kind]');
    if (kind) { S.kind = kind.dataset.kind; draw(); return; }
    const em = t.closest('[data-email]');
    if (em) {
      const to = (S.lead.email || '').trim();
      if (!to) { say('Add the client email above first.', true); return; }
      busy(em, async () => { await saveContact(); const r = await call(`/api/work-orders/${em.dataset.email}/send`, 'POST', { to }); say(`Emailed to ${r.to}.`); await load(S.lead.id); say(`Emailed to ${r.to}.`); });
      return;
    }
    if (t.closest('#dd-wo')) {
      busy(t.closest('#dd-wo'), async () => {
        await saveContact();
        const body = { kind: S.kind, setup: val('#dd-setup'), monthly: val('#dd-monthly') };
        if (S.kind === 'website') body.scope = host.querySelector('#dd-scope')?.value || '';
        const wo = await call(`/api/leads/${encodeURIComponent(S.lead.id)}/work-order`, 'POST', body);
        let sent = '';
        const to = (S.lead.email || '').trim();
        if (to) {
          const d = await call(`/api/leads/${encodeURIComponent(S.lead.id)}/deal`);
          const o = d.orders[0];
          if (o) { try { const r = await call(`/api/work-orders/${o.id}/send`, 'POST', { to }); sent = ` Emailed to ${r.to}.`; } catch (er) { sent = ` Not emailed: ${er.message}`; } }
        } else sent = ' No email on file, so copy the link or text it.';
        await load(S.lead.id);
        S.link = wo.url; say(`Work order created.${sent}${wo.hasPayLink ? '' : ' No Stripe payment link was made (check the Stripe key).'}`); draw();
      });
      return;
    }
    if (t.closest('#dd-pay')) {
      busy(t.closest('#dd-pay'), async () => {
        const r = await call(`/api/leads/${encodeURIComponent(S.lead.id)}/payment-link`, 'POST', { setup: val('#dd-setup'), monthly: val('#dd-monthly') });
        S.link = r.link; draw(); say('Payment link ready. Copy it or text it.');
      });
    }
  });
  host.addEventListener('change', (e) => { if (e.target.matches('[data-c]')) saveContact().catch((er) => say(er.message, true)); });

  if (opts.leadId) load(opts.leadId); else draw();
  return { load, get lead() { return S.lead; } };
}
