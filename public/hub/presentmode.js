// Present mode: a switch in the top bar. Search the business you are pitching, and the whole screen becomes a clean view built for them:
// the competitor analysis, the game plan, the slides and the live scan, in one window you can screen share.
// Nothing internal shows here: no menus, no pipeline, no prices of other deals, no notes, no alerts, no call bar. Your notes open in their own window.
import { $, $$, esc, api, toast, copy, modal, busy, icon } from './core.js';
import { packParts } from '/js/packview.js';

const FROM = 'rw-present-from';

export const presentButton = () => `<button type="button" class="cmd-pres" id="presbtn" title="Present to a client" aria-label="Present mode">${icon.eye}<span>Present</span></button>`;

// Step 1: pick the business.
export function presentPicker() {
  const m = modal(`<h2>Present to a business</h2><p class="muted small">Search the lead or client. The screen switches to a clean view for them. Nothing internal is shown.</p>
    <input id="pmq" class="input" placeholder="Business name, city or phone" autocomplete="off" style="width:100%;margin:8px 0">
    <div id="pml" class="pm-pick"></div>`);
  const input = $('#pmq'), list = $('#pml');
  let seq = 0, t;
  const go = (kind, id) => {
    try { sessionStorage.setItem(FROM, location.hash.startsWith('#/present') ? '#/' : location.hash || '#/'); } catch { /* fine */ }
    m.close();
    location.hash = `#/present/${kind}/${id}`;
  };
  const draw = (rows) => {
    list.innerHTML = rows.length ? rows.map((r, i) => `<button type="button" class="pm-row" data-i="${i}"><span class="pal-kind">${esc(r.kind)}</span><b>${esc(r.label)}</b><span class="small muted">${esc(r.sub)}</span></button>`).join('') : '<p class="small muted">Nothing found.</p>';
    $$('.pm-row', list).forEach((b) => b.addEventListener('click', () => go(rows[Number(b.dataset.i)].k, rows[Number(b.dataset.i)].id)));
  };
  const search = async () => {
    const q = input.value.trim(), my = ++seq;
    if (q.length < 2) { list.innerHTML = '<p class="small muted">Type two letters of the business name.</p>'; return; }
    const [leads, clients] = await Promise.all([
      api(`/api/leads?q=${encodeURIComponent(q)}&limit=8`).then((d) => d.leads || []).catch(() => []),
      api('/api/clients').then((d) => d.clients || []).catch(() => []),
    ]);
    if (my !== seq) return;
    const ql = q.toLowerCase();
    draw([
      ...leads.map((l) => ({ kind: 'Lead', k: 'lead', id: l.id, label: l.business, sub: [l.city, l.stage?.replace(/_/g, ' ')].filter(Boolean).join(' · ') })),
      ...clients.filter((c) => [c.name, c.business, c.city].some((v) => String(v || '').toLowerCase().includes(ql))).slice(0, 5).map((c) => ({ kind: 'Client', k: 'client', id: c.id, label: c.name || c.business, sub: c.city || '' })),
    ]);
  };
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 160); });
  input.focus();
  search();
}

const TABS_LEAD = [['overview', 'Overview'], ['competitors', 'Competitors'], ['why', 'Why they win'], ['plan', 'Game plan'], ['slides', 'Slides'], ['scan', 'Live scan']];
const TABS_CLIENT = [['progress', 'Your progress'], ['overview', 'Original audit'], ['competitors', 'Competitors'], ['plan', 'Next steps']];

// Step 2: the clean view.
export async function presentView(app, user, kind, id, tabKey) {
  document.body.classList.add('presenting');
  document.body.classList.remove('hubbg');
  app.innerHTML = '<div class="pm"><div class="pm-body"><div class="skeleton"></div></div></div>';
  let name = '', leadId = null, pack = null, report = null;
  try {
    if (kind === 'client') {
      const d = await api(`/api/present/client/${encodeURIComponent(id)}`);
      name = d.name; leadId = d.lead_id; report = d.report_link;
      if (leadId) pack = (await api(`/api/leads/${encodeURIComponent(leadId)}/pack`)).pack;
    } else {
      leadId = id;
      const d = await api(`/api/leads/${encodeURIComponent(id)}/pack`);
      pack = d.pack; name = pack.business;
      if (!name) name = (await api(`/api/leads/${encodeURIComponent(id)}`).catch(() => ({}))).lead?.business || 'Business';
    }
  } catch (e) { app.innerHTML = `<div class="pm"><div class="pm-body"><p>${esc(e.message)}</p><button class="btn btn-ghost" id="pmx">Exit</button></div></div>`; $('#pmx').onclick = () => exitPresent(); return; }

  const tabs = (kind === 'client' ? TABS_CLIENT : TABS_LEAD).filter(([k]) => (k === 'progress' ? report : true));
  let tab = tabKey && tabs.some(([k]) => k === tabKey) ? tabKey : tabs[0][0];
  const parts = pack?.ready ? packParts(pack) : null;

  app.innerHTML = `<div class="pm">
    <header class="pm-bar"><picture><source media="(prefers-color-scheme: dark)" srcset="/brand/rightway-logo-dark.svg"><img class="pm-logo" src="/brand/rightway-logo-light.svg" alt="Rightway Growth"></picture><b class="pm-name">${esc(name)}</b>
      <nav class="pm-tabs" aria-label="Sections">${tabs.map(([k, l]) => `<button type="button" data-t="${k}">${esc(l)}</button>`).join('')}</nav>
      <div class="pm-actions">${kind === 'lead' && pack?.ready ? '<button type="button" class="btn btn-ghost btn-sm" id="pmsend">Send analysis</button>' : ''}
        ${leadId ? '<button type="button" class="btn btn-ghost btn-sm hide-s" id="pmnotes" title="Opens your notes in a separate window so they are not on the shared screen">My notes</button>' : ''}
        <button type="button" class="btn btn-ghost btn-sm hide-s" id="pmfull">Full screen</button>
        <button type="button" class="btn btn-primary btn-sm" id="pmexit">Exit</button></div></header>
    <main class="pm-body" id="pmbody"></main></div>`;

  const body = $('#pmbody');
  const notReady = () => `<div class="pk-sec"><h2>${esc(name)}</h2><p>${esc(pack?.reason || 'There is no research for this business yet.')}</p>
    ${leadId ? '<p><button class="btn btn-primary" id="pmrun">Run the research now</button> <span class="cost-hint" data-cost="research_call" data-n="1"></span></p><p class="muted small">Takes under a minute. The analysis fills in on this screen.</p>' : ''}</div>`;
  const show = (k) => {
    tab = k;
    $$('.pm-tabs button', app).forEach((b) => b.classList.toggle('is-on', b.dataset.t === k));
    try { history.replaceState(null, '', `#/present/${kind}/${id}/${k}`); } catch { /* fine */ }
    body.classList.toggle('is-frame', k === 'slides' || k === 'scan' || k === 'progress');
    if (k === 'slides') body.innerHTML = `<iframe class="pm-frame" src="/present.html#${encodeURIComponent(leadId)}" title="Slides" allow="fullscreen"></iframe>`;
    else if (k === 'scan') body.innerHTML = `<iframe class="pm-frame" src="/scan.html?lead=${encodeURIComponent(leadId)}" title="Live scan"></iframe>`;
    else if (k === 'progress') body.innerHTML = `<iframe class="pm-frame" src="${esc(report)}" title="Progress report"></iframe>`;
    else if (!parts) {
      body.innerHTML = `<div class="pk">${notReady()}</div>`;
      $('#pmrun')?.addEventListener('click', async (e) => {
        busy(e.currentTarget, true, 'Running');
        try { await api(`/api/leads/${encodeURIComponent(leadId)}/research`, { method: 'POST', body: {} }); presentView(app, user, kind, id, tab); }
        catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
      });
    } else body.innerHTML = `<div class="pk">${parts[k] || ''}</div>`;
    body.scrollTop = 0;
  };
  $$('.pm-tabs button', app).forEach((b) => b.addEventListener('click', () => show(b.dataset.t)));
  $('#pmexit').onclick = () => exitPresent();
  $('#pmfull')?.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); });
  $('#pmnotes')?.addEventListener('click', () => window.open(`/#/pipeline/${encodeURIComponent(leadId)}`, 'rw-notes', 'width=520,height=820'));
  $('#pmsend')?.addEventListener('click', () => sendModal(leadId, name));
  show(tab);
}

function sendModal(leadId, name) {
  api(`/api/leads/${encodeURIComponent(leadId)}`).catch(() => ({})).then((d) => {
    const l = d.lead || {};
    const sm = modal(`<h2>Send the analysis</h2><p class="muted small">${esc(name)} gets a private link to the full report.</p>
      <label>Email<input id="pmto" class="input" type="email" value="${esc(l.email || '')}" placeholder="owner@business.com"></label>
      <label>Note (optional)<textarea id="pmnote" class="input" rows="3" placeholder="Here is the analysis we just went over."></textarea></label>
      <div class="row" style="gap:8px;margin-top:10px"><button class="btn btn-primary" id="pmgo">Email it</button><button class="btn btn-ghost" id="pmcopy">Copy link</button></div>`);
    $('#pmgo').onclick = async (e) => {
      busy(e.currentTarget, true, 'Sending');
      try { await api(`/api/leads/${encodeURIComponent(leadId)}/pack/send`, { method: 'POST', body: { to: $('#pmto').value, note: $('#pmnote').value } }); toast('Sent'); sm.close(); }
      catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
    };
    $('#pmcopy').onclick = async () => { try { const r = await api(`/api/leads/${encodeURIComponent(leadId)}/pack`, { method: 'POST', body: {} }); copy(r.link, 'Link copied'); } catch (err) { toast(err.message, true); } };
  });
}

export function exitPresent() {
  document.body.classList.remove('presenting');
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  let back = '#/';
  try { back = sessionStorage.getItem(FROM) || '#/'; sessionStorage.removeItem(FROM); } catch { /* fine */ }
  location.hash = back.startsWith('#/present') ? '#/' : back;
}
export const leavePresent = () => document.body.classList.remove('presenting');
