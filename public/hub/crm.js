// CRM screens: pipeline board, lead details, CSV import, power dialer, settings.
import { $, $$, esc, api, toast, copy, fmt, icon, busy, modal, PLAN_NAMES, PLAN_PRICE } from './core.js';
import { staffShell } from './staff.js';

export const STAGE_LABEL = {
  new: 'New lead', attempting: 'Attempting', callback: 'Callback set', audit_requested: 'Audit requested', audit_booked: 'Audit booked',
  no_show: 'No-show', follow_up: 'Following up', won: 'Won', not_now: 'Not now', lost: 'Lost', dnc: 'Do not call',
};
const BOARD = ['new', 'attempting', 'callback', 'audit_requested', 'audit_booked', 'no_show', 'follow_up', 'won'];
const CLOSED = ['not_now', 'lost', 'dnc'];
const OUTCOMES = [
  ['no_answer', 'No answer', '1'], ['voicemail', 'Voicemail', '2'], ['gatekeeper', 'Gatekeeper', '3'], ['conversation', 'Talked, follow up', '4'],
  ['booked', 'Booked audit', '5'], ['callback', 'Callback', '6'], ['not_interested', 'Not interested', '7'], ['bad_number', 'Bad number', '8'], ['dnc', 'Do not call', '9'],
];
const dueText = (ms) => {
  if (!ms) return '';
  const d = ms - Date.now();
  if (d <= 0) return 'due now';
  const h = Math.round(d / 3600e3);
  return h < 24 ? `in ${h} h` : `in ${Math.round(h / 24)} d`;
};
const telHref = (p) => `tel:${String(p || '').replace(/[^\d+]/g, '')}`;

// ---------- pipeline ----------
export async function pipelinePage(app, user, q = '') {
  const view = staffShell(app, user, 'pipeline');
  let data;
  try { data = await api(`/api/leads${q ? `?q=${encodeURIComponent(q)}` : ''}`); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const by = {};
  data.leads.forEach((l) => { (by[l.stage] ||= []).push(l); });
  const total = data.leads.length;
  const open = data.leads.filter((l) => !['won', 'lost', 'dnc'].includes(l.stage)).length;
  view.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">CRM</p><h1>Pipeline</h1></div>
      <div class="row"><a class="btn btn-mint" href="#/dialer">${icon.phone}Start dialing</a><button class="btn btn-ghost" id="imp">${icon.upload}Import CSV</button><button class="btn btn-primary" id="addl">${icon.plus}Add lead</button></div></div>
    <div class="stats">
      <div class="stat hero"><div class="stat-num" data-count="${open}">0</div><div class="stat-label">open leads (${total} total)</div></div>
      <div class="stat"><div class="stat-num" data-count="${(by.audit_booked || []).length}">0</div><div class="stat-label">audits booked</div></div>
      <div class="stat"><div class="stat-num" data-count="${(by.audit_requested || []).length}">0</div><div class="stat-label">website audit requests</div></div>
      <div class="stat"><div class="stat-num" data-count="${(by.won || []).length}">0</div><div class="stat-label">won</div></div>
    </div>
    <form id="lsearch" class="row" style="margin-bottom:16px"><input name="q" value="${esc(q)}" placeholder="Search business, name, phone, city, industry" style="flex:1 1 260px"><button class="btn btn-ghost" type="submit">${icon.scan}Search</button></form>
    <div class="board">${BOARD.map((s) => column(s, by[s] || [])).join('')}</div>
    <details class="card" style="margin-top:18px"><summary style="cursor:pointer;font-weight:600">Closed: not now, lost, do not call (${CLOSED.reduce((n, s) => n + (by[s] || []).length, 0)})</summary>
      <div class="board" style="margin-top:14px">${CLOSED.map((s) => column(s, by[s] || [])).join('')}</div></details>`;
  const { animateNumbers } = await import('./core.js');
  animateNumbers(view);
  $('#lsearch', view).addEventListener('submit', (e) => { e.preventDefault(); pipelinePage(app, user, e.target.q.value.trim()); });
  $('#addl', view).addEventListener('click', () => leadForm(null, () => pipelinePage(app, user, q)));
  $('#imp', view).addEventListener('click', () => importModal(() => pipelinePage(app, user, q)));
  $$('.lead-card', view).forEach((c) => {
    c.addEventListener('click', () => leadModal(c.dataset.id, () => pipelinePage(app, user, q)));
    c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', c.dataset.id); c.classList.add('dragging'); });
    c.addEventListener('dragend', () => c.classList.remove('dragging'));
  });
  $$('.col', view).forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop-on'); });
    col.addEventListener('dragleave', () => col.classList.remove('drop-on'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drop-on');
      const id = e.dataTransfer.getData('text/plain');
      const card = $(`.lead-card[data-id="${CSS.escape(id)}"]`, view);
      if (!card || card.closest('.col') === col) return;
      $('.col-body', col).prepend(card);
      try { await api(`/api/leads/${id}`, { method: 'PATCH', body: { stage: col.dataset.stage } }); toast(`Moved to ${STAGE_LABEL[col.dataset.stage]}`); }
      catch (err) { toast(err.message, true); pipelinePage(app, user, q); }
    });
  });
}

function column(stage, leads) {
  return `<section class="col" data-stage="${stage}"><header class="col-head"><b>${STAGE_LABEL[stage]}</b><span class="badge gray">${leads.length}</span></header>
    <div class="col-body">${leads.slice(0, 200).map(card).join('')}</div></section>`;
}
function card(l) {
  return `<article class="lead-card" draggable="true" data-id="${esc(l.id)}">
    <div class="item-title">${esc(l.business)}</div>
    <div class="item-sub">${esc([l.contact_name, [l.city, l.state].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</div>
    <div class="row small" style="margin-top:6px">${l.next_action_at ? `<span class="badge ${l.next_action_at <= Date.now() ? 'warn' : 'gray'}">${esc(dueText(l.next_action_at))}</span>` : ''}
      ${l.plan ? `<span class="badge">${esc(PLAN_NAMES[l.plan] || l.plan)}</span>` : ''}${l.tz_known ? `<span>${esc(l.local_time)}</span>` : ''}</div></article>`;
}

// ---------- lead form ----------
const LF = [['business', 'Business name', true], ['contact_name', 'Contact name'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'],
  ['city', 'City'], ['state', 'State (2 letters)'], ['industry', 'Industry'], ['source', 'Source']];

export function leadForm(lead, onSaved) {
  const m = modal(`<div class="card-head"><h2>${lead ? 'Edit lead' : 'Add a lead'}</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <form id="lform" class="form-grid">${LF.map(([k, label, req]) => `<label class="field"><span>${label}</span><input name="${k}" value="${esc(lead?.[k] || '')}"${req ? ' required' : ''}></label>`).join('')}
      <label class="field span-all"><span>Notes</span><textarea name="notes">${esc(lead?.notes || '')}</textarea></label>
      <div class="span-all row end"><button class="btn btn-primary" type="submit">${lead ? 'Save' : 'Add lead'}</button></div></form>`);
  $('#lform', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try {
      const r = lead ? await api(`/api/leads/${lead.id}`, { method: 'PATCH', body }) : await api('/api/leads', { method: 'POST', body });
      toast('Saved'); m.close(); onSaved?.(r.lead);
    } catch (err) { toast(err.message, true); }
  });
}

// ---------- lead details ----------
export async function leadModal(id, onChange) {
  const m = modal('<div class="skeleton"></div>');
  let data;
  try { data = await api(`/api/leads/${id}`); } catch (e) { m.el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const l = data.lead;
  m.el.innerHTML = `
    <div class="card-head"><div><p class="eyebrow">${esc(STAGE_LABEL[l.stage])}${l.attempts ? ` · ${l.attempts} attempts` : ''}</p><h2>${esc(l.business)}</h2>
      <div class="small">${esc([l.contact_name, l.city, l.state].filter(Boolean).join(' · '))}${l.tz_known ? ` · their time ${esc(l.local_time)}` : ''}</div></div>
      <button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <div class="row" style="margin-bottom:14px">
      ${l.phone ? `<a class="btn btn-mint" href="${telHref(l.phone)}">${icon.phone}${esc(l.phone)}</a>` : ''}
      ${l.email ? `<a class="btn btn-ghost" href="mailto:${esc(l.email)}">${icon.mail}Email</a>` : ''}
      ${l.website ? `<a class="btn btn-ghost" href="${esc(/^https?:/.test(l.website) ? l.website : `https://${l.website}`)}" target="_blank" rel="noopener">Website</a>` : ''}
      <a class="btn btn-ghost" href="https://www.google.com/maps/search/${encodeURIComponent(`${l.business} ${l.city || ''} ${l.state || ''}`)}" target="_blank" rel="noopener">Google Maps</a>
      <button class="btn btn-ghost" id="ledit">Edit</button>
    </div>
    ${l.dnc ? '<p class="badge bad" style="margin-bottom:12px">Do not call</p>' : ''}
    <div class="split" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
      <div>
        <h3>Log a call</h3>
        <div class="outcomes">${OUTCOMES.map(([k, n]) => `<button class="btn btn-ghost btn-sm" data-out="${k}">${n}</button>`).join('')}</div>
        <label class="field" style="margin-top:10px"><span>Callback or audit time (for Callback and Booked)</span><input type="datetime-local" id="lwhen"></label>
        <label class="field" style="margin-top:10px"><span>Note</span><textarea id="lnote" rows="3" placeholder="What happened on the call"></textarea></label>
        <div class="row" style="margin-top:10px"><button class="btn btn-ghost btn-sm" id="lnotebtn">Save note only</button>
          <label class="field" style="flex:1 1 160px"><select id="lstage">${Object.entries(STAGE_LABEL).map(([k, n]) => `<option value="${k}"${k === l.stage ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div>
        <h3 style="margin-top:22px">Close the deal</h3>
        <div class="row"><select id="lplan" style="flex:1 1 180px">${Object.entries(PLAN_NAMES).map(([k, n]) => `<option value="${k}"${(l.plan || 'growth') === k ? ' selected' : ''}>${n} (${fmt.money(PLAN_PRICE[k])}/mo)</option>`).join('')}</select>
          <label class="row small" style="gap:6px"><input type="checkbox" id="lreduced"> Starter setup $297</label></div>
        <div class="row" style="margin-top:10px">
          <button class="btn btn-primary btn-sm" id="lwo">Send work order</button>
          <button class="btn btn-ghost btn-sm" id="lpay">Payment link only</button>
          ${l.client_id ? `<a class="btn btn-ghost btn-sm" href="#/client/${esc(l.client_id)}/overview">Open client</a>` : '<button class="btn btn-ghost btn-sm" id="lwon">Won: create client</button>'}
        </div>
        <div id="lout"></div>
        ${data.orders.length ? `<h3 style="margin-top:22px">Work orders</h3><ul class="list">${data.orders.map((o) => `<li class="item"><span class="badge ${o.status === 'paid' ? '' : o.status === 'signed' ? 'warn' : 'gray'}">${esc(o.status)}</span>
          <div><div class="item-title">${esc(PLAN_NAMES[o.plan] || o.plan)}</div><div class="item-sub">${o.signed_name ? `Signed by ${esc(o.signed_name)} ${esc(fmt.ago(o.signed_at))}` : `Sent ${esc(fmt.ago(o.created_at))}`}</div></div>
          <button class="btn btn-ghost btn-sm" data-wo="${esc(o.token)}">Copy link</button></li>`).join('')}</ul>` : ''}
      </div>
      <div>
        <h3>Next step</h3>
        <p>${l.next_action ? `${esc(l.next_action)} <span class="badge gray">${esc(dueText(l.next_action_at))}</span>` : '<span class="muted">None set</span>'}</p>
        ${l.notes ? `<h3>Notes</h3><div class="caption">${esc(l.notes)}</div>` : ''}
        <h3 style="margin-top:18px">History</h3>
        <ul class="feed">${data.activities.map((a) => `<li><span class="dot">${a.type === 'call' ? icon.msg : a.type === 'payment' ? icon.star : icon.note}</span>
          <div><div>${esc(activityText(a))}</div>${a.body && a.type !== 'stage' ? `<div class="small">${esc(a.body)}</div>` : ''}</div><span class="small">${esc(fmt.ago(a.at))}</span></li>`).join('') || '<li class="muted">Nothing yet.</li>'}</ul>
        <button class="btn btn-danger btn-sm" id="ldel" style="margin-top:16px">Delete lead</button>
      </div>
    </div>`;
  const done = () => { m.close(); onChange?.(); };
  $('#ledit', m.el).addEventListener('click', () => { m.close(); leadForm(l, () => onChange?.()); });
  $$('[data-out]', m.el).forEach((b) => b.addEventListener('click', async () => {
    const outcome = b.dataset.out;
    const when = $('#lwhen', m.el).value;
    if ((outcome === 'callback' || outcome === 'booked') && !when) return toast('Pick the date and time first.', true);
    busy(b, true);
    try { await api(`/api/leads/${l.id}/outcome`, { method: 'POST', body: { outcome, note: $('#lnote', m.el).value, callbackAt: when || null } }); toast('Logged'); done(); }
    catch (err) { toast(err.message, true); busy(b, false); }
  }));
  $('#lnotebtn', m.el).addEventListener('click', async () => {
    const t = $('#lnote', m.el).value.trim();
    if (!t) return;
    try { await api(`/api/leads/${l.id}/note`, { method: 'POST', body: { text: t } }); toast('Note saved'); m.close(); leadModal(id, onChange); } catch (err) { toast(err.message, true); }
  });
  $('#lstage', m.el).addEventListener('change', async (e) => {
    try { await api(`/api/leads/${l.id}`, { method: 'PATCH', body: { stage: e.target.value } }); toast('Stage updated'); onChange?.(); } catch (err) { toast(err.message, true); }
  });
  const out = $('#lout', m.el);
  const share = (url, label, msg) => {
    out.innerHTML = `<div class="card" style="box-shadow:none;background:var(--mint-soft);margin-top:12px"><h3>${esc(label)}</h3><div class="copybox"><code>${esc(url)}</code><button class="btn btn-ghost btn-sm" id="cpl">Copy</button></div>
      <div class="row" style="margin-top:10px">${l.phone ? `<a class="btn btn-ghost btn-sm" href="sms:${esc(l.phone.replace(/[^\d+]/g, ''))}?&body=${encodeURIComponent(msg)}">${icon.msg}Text it</a>` : ''}
      ${l.email ? `<a class="btn btn-ghost btn-sm" href="mailto:${esc(l.email)}?subject=${encodeURIComponent('Rightway Growth: your plan')}&body=${encodeURIComponent(msg)}">${icon.mail}Email it</a>` : ''}</div></div>`;
    $('#cpl', out).addEventListener('click', () => copy(url, 'Link copied'));
  };
  $('#lwo', m.el).addEventListener('click', async (e) => {
    busy(e.target, true);
    try {
      const r = await api(`/api/leads/${l.id}/work-order`, { method: 'POST', body: { plan: $('#lplan', m.el).value, reducedSetup: $('#lreduced', m.el).checked } });
      share(r.url, r.hasPayLink ? 'Work order link (sign, then pay)' : 'Work order link. Add the Stripe payment link in Settings so they can pay after signing.',
        `Hi ${l.contact_name ? l.contact_name.split(' ')[0] : ''}, here is your Rightway Growth work order. Review it, sign, and you can pay right after: ${r.url}`);
    } catch (err) { toast(err.message, true); } finally { busy(e.target, false); }
  });
  $('#lpay', m.el).addEventListener('click', async (e) => {
    busy(e.target, true);
    const plan = $('#lplan', m.el).value;
    try {
      const r = await api(`/api/leads/${l.id}/payment-link`, { method: 'POST', body: { plan: plan === 'starter' && $('#lreduced', m.el).checked ? 'starter_reduced' : plan } });
      share(r.link, 'Stripe payment link', `Here is the secure payment link to start your Rightway Growth plan: ${r.link}`);
    } catch (err) { toast(err.message, true); } finally { busy(e.target, false); }
  });
  $('#lwon', m.el)?.addEventListener('click', async (e) => {
    busy(e.target, true);
    try { const r = await api(`/api/leads/${l.id}/convert`, { method: 'POST', body: { plan: $('#lplan', m.el).value } }); m.close(); location.hash = `#/client/${r.clientId}/overview`; }
    catch (err) { toast(err.message, true); busy(e.target, false); }
  });
  $$('[data-wo]', m.el).forEach((b) => b.addEventListener('click', () => copy(`${location.origin}/sign.html#${b.dataset.wo}`, 'Work order link copied')));
  $('#ldel', m.el).addEventListener('click', async () => {
    if (!confirm(`Delete ${l.business} and its history?`)) return;
    try { await api(`/api/leads/${l.id}`, { method: 'DELETE' }); done(); } catch (err) { toast(err.message, true); }
  });
}

function activityText(a) {
  if (a.type === 'call') {
    const o = OUTCOMES.find(([k]) => k === a.outcome);
    return `Call${o ? `: ${o[1]}` : a.status ? ` (${a.status.replace(/_/g, ' ')})` : ''}${a.duration ? `, ${Math.floor(a.duration / 60)}m ${a.duration % 60}s` : ''}`;
  }
  if (a.type === 'note') return 'Note';
  return a.body || a.type;
}

// ---------- CSV import ----------
export function parseCsv(textIn) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(textIn).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const MAP = [
  ['business', /^(business|company|business name|company name|account|organization|organisation|title|name of business)$/i],
  ['contact_name', /(contact|owner|full name|first name|^name$|decision)/i], ['phone', /(phone|mobile|cell|tel)/i], ['email', /e-?mail/i],
  ['website', /(website|url|domain|site)/i], ['city', /^city$/i], ['state', /^(state|province|region|st)$/i], ['industry', /(industry|category|niche|type|vertical)/i],
  ['address', /address/i],
];

export function mapRows(rows) {
  const [head, ...body] = rows;
  const cols = head.map((h) => { const hit = MAP.find(([, re]) => re.test(h.trim())); return hit ? hit[0] : null; });
  if (!cols.includes('business')) { const i = cols.indexOf('contact_name'); if (i >= 0 && !cols.includes('business')) cols[i] = 'business'; }
  return body.map((r) => {
    const o = {};
    cols.forEach((k, i) => { if (k && r[i] != null && String(r[i]).trim() && !o[k]) o[k] = String(r[i]).trim(); });
    if (o.address && (!o.city || !o.state)) {
      const m = o.address.match(/,\s*([^,]+),\s*([A-Za-z]{2})\b/);
      if (m) { o.city ||= m[1].trim(); o.state ||= m[2].toUpperCase(); }
    }
    delete o.address;
    return o;
  }).filter((o) => o.business);
}

function importModal(onDone) {
  const m = modal(`<div class="card-head"><h2>Import leads</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <p class="muted">Upload a CSV or paste it below. Columns are matched by their headers: business, contact, phone, email, website, city, state, industry. Duplicate phone numbers are skipped. Only use lists you have the right to call.</p>
    <input type="file" id="csvf" accept=".csv,text/csv,text/plain" style="margin:10px 0">
    <textarea id="csvt" rows="8" placeholder="business,contact,phone,city,state,industry&#10;Summit Roofing,Bob,954-555-0101,Hollywood,FL,Roofing"></textarea>
    <p id="csvp" class="small"></p>
    <div class="row end"><button class="btn btn-primary" id="csvgo" disabled>Import</button></div>`);
  let mapped = [];
  const preview = () => {
    mapped = mapRows(parseCsv($('#csvt', m.el).value || ''));
    $('#csvp', m.el).textContent = mapped.length ? `${mapped.length} leads ready. First: ${mapped[0].business}${mapped[0].phone ? `, ${mapped[0].phone}` : ''}` : 'No rows with a business name found yet.';
    $('#csvgo', m.el).disabled = !mapped.length;
  };
  $('#csvt', m.el).addEventListener('input', preview);
  $('#csvf', m.el).addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) { $('#csvt', m.el).value = await f.text(); preview(); } });
  $('#csvgo', m.el).addEventListener('click', async (e) => {
    busy(e.target, true);
    try { const r = await api('/api/leads/import', { method: 'POST', body: { rows: mapped.slice(0, 2000), source: 'import' } }); toast(`${r.imported} imported, ${r.skipped} skipped`); m.close(); onDone?.(); }
    catch (err) { toast(err.message, true); busy(e.target, false); }
  });
}

// ---------- power dialer ----------
export async function dialerPage(app, user) {
  const view = staffShell(app, user, 'dialer');
  let me, q;
  try { [me, q] = await Promise.all([api('/api/me'), api('/api/dialer/queue?limit=100')]); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  let idx = 0;
  const first = (user.name || '').split(' ')[0] || '(your name)';
  const render = () => {
    const l = q.queue[idx];
    view.innerHTML = `
      <div class="page-head"><div><p class="eyebrow">Power dialer</p><h1>Call queue</h1></div>
        <div class="row"><span class="badge">${q.queue.length - idx} ready now</span>${q.waitingForHours ? `<span class="badge gray">${q.waitingForHours} waiting for their calling hours</span>` : ''}<a class="btn btn-ghost btn-sm" href="#/pipeline">Pipeline</a></div></div>
      <div class="stats">
        <div class="stat hero"><div class="stat-num">${q.stats.dials}</div><div class="stat-label">dials today (target 60)</div></div>
        <div class="stat"><div class="stat-num">${q.stats.talks}</div><div class="stat-label">owner conversations</div></div>
        <div class="stat"><div class="stat-num">${q.stats.booked}</div><div class="stat-label">audits booked</div></div>
      </div>
      ${!l ? `<div class="card empty"><h3>Queue clear</h3><p>No one is due right now inside 8am to 8pm their time. Import leads or check back later.</p><a class="btn btn-primary" href="#/pipeline">Go to pipeline</a></div>` : `
      <div class="split" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)">
        <div class="card dial-card">
          <p class="eyebrow">${esc(STAGE_LABEL[l.stage])}${l.attempts ? ` · attempt ${l.attempts + 1}` : ''}${l.next_action ? ` · ${esc(l.next_action)}` : ''}</p>
          <h2 style="font-size:30px">${esc(l.business)}</h2>
          <div class="muted">${esc([l.contact_name, l.industry, [l.city, l.state].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</div>
          <div class="row" style="margin:14px 0"><span class="badge">${l.tz_known ? `Their time: ${esc(l.local_time)}` : 'Time zone unknown: add the state'}</span>${l.sms_consent ? '<span class="badge">Agreed to texts</span>' : ''}</div>
          <div class="dial-phone">${esc(l.phone || '')}</div>
          <div class="row" style="margin-top:14px">
            <a class="btn btn-mint btn-xl" style="width:auto;flex:1 1 220px" href="${telHref(l.phone)}" id="dtel">${icon.phone}Call from my phone</a>
            ${me.twilio ? `<button class="btn btn-primary btn-xl" style="width:auto;flex:1 1 220px" id="dhub">Call through the Hub</button>` : ''}
          </div>
          ${me.twilio && !me.user.phone ? '<form id="dphone" class="row" style="margin-top:10px"><input name="phone" placeholder="Your mobile, so the Hub can ring you" style="flex:1 1 200px"><button class="btn btn-ghost btn-sm">Save</button></form>' : ''}
          <div class="caption" style="margin-top:16px"><b>Opener:</b> Hey ${esc(l.contact_name ? l.contact_name.split(' ')[0] : '[Name]')}, this is ${esc(first)} with Rightway Growth. I'll be honest, this is a cold call. Can I take 30 seconds to tell you why I called, and you tell me if it's worth talking?</div>
          <div class="row" style="margin-top:10px">
            <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/${encodeURIComponent(`${l.industry || ''} ${l.city || ''} ${l.state || ''}`)}">Prep: map pack</a>
            <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/${encodeURIComponent(`${l.business} ${l.city || ''}`)}">Their profile</a>
            <button class="btn btn-ghost btn-sm" id="dopen">Full details</button>
          </div>
        </div>
        <div class="card">
          <h3>How did it go?</h3>
          <div class="outcomes big">${OUTCOMES.map(([k, n, key]) => `<button class="btn btn-ghost" data-out="${k}"><span class="kbd">${key}</span>${n}</button>`).join('')}</div>
          <label class="field" style="margin-top:12px"><span>Callback or audit time</span><input type="datetime-local" id="dwhen"></label>
          <label class="field" style="margin-top:10px"><span>Note</span><textarea id="dnote" rows="3" placeholder="Job value, capacity, what they said"></textarea></label>
          <div class="row" style="margin-top:12px"><button class="btn btn-ghost btn-sm" id="dskip">Skip for now</button><span class="small">Keys 1 to 9 log an outcome.</span></div>
          ${l.notes ? `<h3 style="margin-top:18px">Notes</h3><div class="caption">${esc(l.notes)}</div>` : ''}
        </div>
      </div>`}`;
    if (!l) return;
    $('#dskip', view).addEventListener('click', () => { idx++; render(); });
    $('#dopen', view).addEventListener('click', () => leadModal(l.id, () => {}));
    $('#dhub', view)?.addEventListener('click', async (e) => {
      busy(e.target, true, 'Ringing you...');
      try { await api('/api/dialer/call', { method: 'POST', body: { leadId: l.id } }); toast('Your phone is ringing. Answer to connect.'); }
      catch (err) { toast(err.message, true); } finally { setTimeout(() => busy(e.target, false), 4000); }
    });
    $('#dphone', view)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const r = await api('/api/me/phone', { method: 'PUT', body: { phone: e.target.phone.value } }); me.user.phone = r.phone; toast('Saved'); render(); } catch (err) { toast(err.message, true); }
    });
    $$('[data-out]', view).forEach((b) => b.addEventListener('click', () => logOutcome(b.dataset.out, b)));
  };
  const logOutcome = async (outcome, btn) => {
    const l = q.queue[idx];
    const when = $('#dwhen', view)?.value;
    if ((outcome === 'callback' || outcome === 'booked') && !when) return toast('Pick the date and time first.', true);
    busy(btn, true);
    try {
      await api(`/api/leads/${l.id}/outcome`, { method: 'POST', body: { outcome, note: $('#dnote', view).value, callbackAt: when || null } });
      q.stats.dials++;
      if (['conversation', 'booked', 'callback', 'not_interested'].includes(outcome)) q.stats.talks++;
      if (outcome === 'booked') { q.stats.booked++; toast('Audit booked. Send the invite and confirmation email.'); }
      idx++;
      render();
    } catch (err) { toast(err.message, true); busy(btn, false); }
  };
  const onKey = (e) => {
    if (!document.body.contains(view) || /input|textarea|select/i.test(e.target.tagName)) return;
    const o = OUTCOMES.find(([, , k]) => k === e.key);
    if (o) { const b = $(`[data-out="${o[0]}"]`, view); if (b) logOutcome(o[0], b); }
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => document.removeEventListener('keydown', onKey), { once: true });
  render();
}

// ---------- settings ----------
export async function settingsPage(app, user) {
  const view = staffShell(app, user, 'settings');
  let s, me;
  try { [s, me] = await Promise.all([api('/api/settings'), api('/api/me')]); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const c = s.connected;
  const pill = (on) => `<span class="badge ${on ? '' : 'gray'}">${on ? 'Connected' : 'Not connected'}</span>`;
  const formUrl = `${location.origin}/api/public/lead`;
  view.innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>
    <div class="card"><div class="card-head"><h2>Stripe payment links</h2>${pill(c.stripe)}</div>
      <p class="muted">Paste each plan's payment link from Stripe (Payment Links, Copy link). Work orders and the "Payment link" button use these, tagged with the lead, so payment marks the deal won and creates the client automatically.</p>
      <form id="plinks" class="form-grid">
        ${[['starter', 'Starter ($994 first charge)'], ['starter_reduced', 'Starter, reduced setup ($894)'], ['growth', 'Growth ($1,994)'], ['authority', 'Authority ($2,494)'], ['leader', 'Market Leader ($3,994)']]
          .map(([k, n]) => `<label class="field"><span>${n}</span><input name="${k}" value="${esc(s.links[k])}" placeholder="https://buy.stripe.com/..."${user.role === 'admin' ? '' : ' disabled'}></label>`).join('')}
        ${user.role === 'admin' ? '<div class="span-all row end"><button class="btn btn-primary" type="submit">Save links</button></div>' : ''}
      </form></div>
    <div class="card"><div class="card-head"><h2>Connections</h2></div>
      <ul class="list">
        ${[['DataForSEO (scans)', c.dataforseo, 'DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD'], ['Stripe (billing status)', c.stripe, 'STRIPE_SECRET_KEY (restricted key)'],
          ['Stripe webhook (auto-win on payment)', c.stripeWebhook, `STRIPE_WEBHOOK_SECRET. Endpoint: ${location.origin}/api/stripe/webhook`],
          ['Twilio (call through the Hub)', c.twilio, 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM'], ['AI captions', c.ai, 'ANTHROPIC_API_KEY'],
          ['Email sending', c.email, 'RESEND_API_KEY, EMAIL_FROM'], ['Photo storage', c.media, 'R2 bucket rightway-media']]
          .map(([n, on, keys]) => `<li class="item">${pill(on)}<div><div class="item-title">${esc(n)}</div><div class="item-sub mono">${esc(keys)}</div></div><span></span></li>`).join('')}
      </ul><p class="small" style="margin-top:12px">Add keys in Cloudflare under Build variables and secrets, then ask Claude to rebuild.</p></div>
    <div class="card"><div class="card-head"><h2>Your phone for the dialer</h2></div>
      <form id="myphone" class="row"><input name="phone" value="${esc(me.user.phone || '')}" placeholder="Your mobile number" style="flex:1 1 220px"><button class="btn btn-primary" type="submit">Save</button></form>
      <p class="small" style="margin-top:8px">With Twilio connected, "Call through the Hub" rings this phone first, then connects you to the lead from the business number. Recording stays off.</p></div>
    <div class="card"><div class="card-head"><h2>Website form</h2></div>
      <p class="muted">Point the audit form on rightwaygrowth.com here and requests land in the pipeline as "Audit requested", at the top of the call queue.</p>
      <div class="copybox"><code>${esc(formUrl)}</code><button class="btn btn-ghost btn-sm" id="cpf">Copy</button></div></div>`;
  $('#cpf', view).addEventListener('click', () => copy(formUrl, 'Form address copied'));
  $('#plinks', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/settings', { method: 'PUT', body: { links: Object.fromEntries(new FormData(e.target).entries()) } }); toast('Links saved'); } catch (err) { toast(err.message, true); }
  });
  $('#myphone', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/me/phone', { method: 'PUT', body: { phone: e.target.phone.value } }); toast('Saved'); } catch (err) { toast(err.message, true); }
  });
}

// ---------- billing tab (client page) ----------
export async function billingTab(el, c) {
  el.innerHTML = '<div class="skeleton"></div>';
  let b;
  try { b = await api(`/api/clients/${c.id}/billing`); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  if (!b.connected) { el.innerHTML = '<div class="card empty"><h3>Stripe is not connected yet</h3><p>Add STRIPE_SECRET_KEY in Cloudflare, then billing shows here.</p></div>'; return; }
  if (!b.linked) {
    el.innerHTML = `<div class="card"><h2>Link this client to Stripe</h2><p class="muted">Payments through a Hub work order link automatically. For anyone who paid another way, find them by billing email.</p>
      <form id="blink" class="row"><input name="email" type="email" value="${esc(c.contact_email || '')}" placeholder="Billing email" style="flex:1 1 240px" required><button class="btn btn-primary">Find in Stripe</button></form></div>`;
    $('#blink', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api(`/api/clients/${c.id}/billing/link`, { method: 'POST', body: { email: e.target.email.value } }); toast('Linked'); billingTab(el, c); } catch (err) { toast(err.message, true); }
    });
    return;
  }
  const sub = b.subscriptions?.[0];
  el.innerHTML = `
    <div class="stats">
      <div class="stat hero"><div class="stat-num">${fmt.money((b.mrr_cents || 0) / 100)}</div><div class="stat-label">monthly from Stripe</div></div>
      <div class="stat"><div class="stat-num" style="font-size:24px">${esc((sub?.status || b.status || '-').replace('_', ' '))}</div><div class="stat-label">subscription status</div></div>
      <div class="stat"><div class="stat-num" style="font-size:24px">${sub?.current_period_end ? esc(fmt.date(sub.current_period_end)) : '-'}</div><div class="stat-label">${sub?.cancel_at_period_end ? 'ends on' : 'next charge'}</div></div>
    </div>
    <div class="card"><div class="card-head"><h2>Invoices</h2><button class="btn btn-ghost btn-sm" id="bportal">Open Stripe portal</button></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Number</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
      ${(b.invoices || []).map((i) => `<tr><td>${esc(fmt.date(i.created))}</td><td>${esc(i.number || '-')}</td><td>${fmt.money(i.amount_cents / 100)}</td><td><span class="badge ${i.status === 'paid' ? '' : 'warn'}">${esc(i.status)}</span></td><td>${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">View</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No invoices yet.</td></tr>'}
      </tbody></table></div></div>`;
  $('#bportal', el).addEventListener('click', async () => { try { const r = await api(`/api/clients/${c.id}/billing/portal`, { method: 'POST' }); window.open(r.url, '_blank'); } catch (err) { toast(err.message, true); } });
}
