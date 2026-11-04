// Team views: all clients, one client (overview, tasks, reviews, posts, rankings, profile, access), team.
import { $, $$, esc, api, toast, copy, fmt, icon, busy, modal, animateNumbers, monthKey, shiftMonth, PLAN_NAMES, PLAN_PRICE, KIND_LABEL } from './core.js';
import { feedHtml, renderReviews, renderPosts, renderRankings } from './shared.js';
import { billingTab } from './crm.js';
import { onboardingTab } from './onboarding.js';

import { NAV } from './nav.js';

import { staffShell, initials } from './shell.js';
export { staffShell, initials };

// Settings holds the team too.
export const settingsTabs = (active, user) => `<nav class="tabs" style="margin-bottom:16px"><a href="#/settings" class="${active === 'general' ? 'is-active' : ''}">General</a><a href="#/settings/team" class="${active === 'team' ? 'is-active' : ''}">Agents</a><a href="#/settings/files" class="${active === 'files' ? 'is-active' : ''}">Files</a>${user?.role === 'admin' ? `<a href="#/settings/budget" class="${active === 'budget' ? 'is-active' : ''}">Budget and costs</a>` : ''}</nav>`;

export const clientsTabs = (active) => `<nav class="tabs" style="margin-bottom:16px"><a href="#/clients" class="${active === 'all' ? 'is-active' : ''}">All clients</a><a href="#/clients/view" class="${active === 'view' ? 'is-active' : ''}">Client view</a></nav>`;

// ---------- dashboard ----------
export async function dashboard(app, user) {
  const view = staffShell(app, user, 'clients');
  const month = monthKey();
  let data;
  try { data = await api(`/api/clients?month=${month}`); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const active = data.clients.filter((c) => c.status === 'active' && !c.sample && !c.parent_id);
  const mains = data.clients.filter((c) => !c.parent_id);
  data.clients = mains.flatMap((m) => [m, ...data.clients.filter((c) => c.parent_id === m.id)]).concat(data.clients.filter((c) => c.parent_id && !mains.some((m) => m.id === c.parent_id)));
  // Real Stripe amounts when billing is linked, plan price otherwise.
  const mrr = active.reduce((s, c) => s + (c.mrr_cents != null && c.billing_status ? c.mrr_cents / 100 : (PLAN_PRICE[c.plan] || 0)), 0);
  const tot = data.clients.filter((c) => !c.sample).reduce((a, c) => ({ done: a.done + c.overview.tasks.done, total: a.total + c.overview.tasks.total, rr: a.rr + c.overview.reviews.sent, pend: a.pend + c.overview.posts.pending }), { done: 0, total: 0, rr: 0, pend: 0 });
  view.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">${esc(fmt.month(month))}</p><h1>Clients</h1></div>
      <button class="btn btn-primary" id="add-client">${icon.plus}Add client</button></div>
    ${clientsTabs('all')}
    <div class="stats">
      <div class="stat hero"><div class="stat-num" data-count="${mrr}" data-prefix="$">0</div><div class="stat-label">monthly recurring revenue (${active.length} active)</div></div>
      <div class="stat"><div class="stat-num" data-count="${tot.total ? Math.round((100 * tot.done) / tot.total) : 0}" data-suffix="%">0</div><div class="stat-label">of this month's work done (${tot.done} of ${tot.total})</div></div>
      <div class="stat"><div class="stat-num" data-count="${tot.rr}">0</div><div class="stat-label">review requests this month</div></div>
      <div class="stat"><div class="stat-num" data-count="${tot.pend}">0</div><div class="stat-label">posts waiting to go out</div></div>
    </div>
    ${data.clients.length ? `<div class="clients">${data.clients.map((c, i) => clientCard(c, i)).join('')}</div>` : `
      <div class="card empty"><h3>No clients yet</h3><p>Add your first client to start their tasks, portal, and review link.</p>
      <button class="btn btn-primary" id="add-client-2">${icon.plus}Add your first client</button></div>`}`;
  animateNumbers(view);
  $$('#add-client, #add-client-2', view).forEach((b) => b.addEventListener('click', () => clientForm(null, (c) => { location.hash = `#/client/${c.id}/overview`; })));
}

function clientCard(c, i) {
  const o = c.overview;
  const pct = o.tasks.total ? Math.round((100 * o.tasks.done) / o.tasks.total) : 0;
  return `<a class="client-card" href="#/client/${esc(c.id)}/overview" style="animation-delay:${i * 40}ms">
    <div class="row"><h3>${esc(c.name)}</h3><span class="spacer"></span>${c.billing_status === 'past_due' ? '<span class="badge bad">Past due</span>' : ''}${c.sample ? '<span class="badge warn">Sample</span>' : ''}${c.parent_id ? '<span class="badge gray">Location</span>' : ''}<span class="badge ${c.status === 'active' ? '' : 'gray'}">${esc(PLAN_NAMES[c.plan] || c.plan)}</span></div>
    <div><div class="row small"><span>This month's work</span><span class="spacer"></span><b>${o.tasks.done} of ${o.tasks.total}</b></div>
      <div class="progress" style="margin-top:6px"><span data-w="${pct}"></span></div></div>
    <div class="mini">
      <div><b>${o.lastScan ? `${o.lastScan.top10Pct ?? 0}%` : '-'}</b><span>first page area</span></div>
      <div><b>${o.reviews.sent}</b><span>review asks</span></div>
      <div><b>${o.posts.pending}</b><span>posts pending</span></div>
    </div></a>`;
}

// ---------- client form (add and edit) ----------
const FIELDS = [
  ['name', 'Business name', 'text', true], ['plan', 'Plan', 'plan'], ['status', 'Status', 'status'], ['start_date', 'Start date', 'date'],
  ['contact_name', 'Contact name', 'text'], ['contact_email', 'Contact email', 'email'], ['phone', 'Phone', 'tel'], ['website', 'Website', 'url'],
  ['address', 'Address', 'text', false, true], ['category', 'Primary Google category', 'text'], ['place_id', 'Google place ID', 'text'],
  ['cid', 'Google CID', 'text'], ['lat', 'Latitude', 'number'], ['lng', 'Longitude', 'number'],
  ['services', 'Services (comma separated)', 'area'], ['cities', 'Cities served (comma separated)', 'area'], ['keywords', 'Target keywords (comma separated)', 'area'],
  ['brand_voice', 'Brand voice for captions', 'area'], ['review_url', 'Custom review link (optional)', 'url', false, true], ['notes', 'Private team notes', 'area'],
];

function fieldHtml([k, label, type, req, wide], c) {
  const v = c?.[k] ?? '';
  const span = type === 'area' || wide ? ' span-all' : '';
  if (type === 'plan') return `<label class="field"><span>${label}</span><select name="plan">${Object.entries(PLAN_NAMES).map(([id, n]) => `<option value="${id}"${(v || 'growth') === id ? ' selected' : ''}>${n} (${fmt.money(PLAN_PRICE[id])}/mo)</option>`).join('')}</select></label>`;
  if (type === 'status') return `<label class="field"><span>${label}</span><select name="status">${['active', 'paused', 'prospect', 'cancelled'].map((s) => `<option${(v || 'active') === s ? ' selected' : ''}>${s}</option>`).join('')}</select></label>`;
  if (type === 'area') return `<label class="field${span}"><span>${label}</span><textarea name="${k}" rows="3">${esc(v)}</textarea></label>`;
  return `<label class="field${span}"><span>${label}</span><input name="${k}" type="${type === 'number' ? 'text' : type}" inputmode="${type === 'number' ? 'decimal' : 'text'}" value="${esc(v)}"${req ? ' required' : ''}></label>`;
}

export function clientForm(client, onSaved) {
  const m = modal(`
    <div class="card-head"><h2>${client ? 'Edit client' : 'Add a client'}</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <div class="card" style="box-shadow:none;margin-bottom:18px;background:var(--mint-soft)">
      <h3>Fill from Google</h3>
      <form id="gfind" class="row"><input name="q" placeholder="Business name" style="flex:2 1 200px" required><input name="loc" placeholder="City, ST" style="flex:1 1 140px" required>
        <button class="btn btn-primary" type="submit">Search</button></form>
      <ul class="list" id="gres" style="margin-top:12px"></ul>
    </div>
    <form id="cform" class="form-grid">${FIELDS.map((f) => fieldHtml(f, client)).join('')}
      <div class="span-all row end"><button class="btn btn-primary btn-xl" type="submit" style="width:auto">${client ? 'Save changes' : 'Add client'}</button></div></form>`);
  const form = $('#cform', m.el);
  $('#gfind', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    busy(btn, true);
    try {
      const r = await api('/api/business-search', { method: 'POST', body: { name: e.target.q.value, location: e.target.loc.value } });
      $('#gres', m.el).innerHTML = r.results.map((b, i) => `<li class="item"><span class="badge gray">${i + 1}</span><div><div class="item-title">${esc(b.title)}</div><div class="item-sub">${esc(b.address)}</div></div><button class="btn btn-ghost btn-sm" type="button" data-i="${i}">Use</button></li>`).join('') || '<li class="muted">No listings found.</li>';
      $$('[data-i]', m.el).forEach((b) => b.addEventListener('click', () => {
        const x = r.results[Number(b.dataset.i)];
        const set = { name: x.title, address: x.address, phone: x.phone, website: x.url, category: x.category, place_id: x.place_id, cid: x.cid, lat: x.lat, lng: x.lng };
        for (const [k, v] of Object.entries(set)) if (v != null && v !== '' && form[k] && (!form[k].value || k !== 'name')) form[k].value = v;
        toast('Filled from Google');
      }));
    } catch (err) { toast(err.message, true); } finally { busy(btn, false); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form).entries());
    const btn = form.querySelector('button[type=submit]');
    busy(btn, true);
    try {
      const r = client ? await api(`/api/clients/${client.id}`, { method: 'PATCH', body }) : await api('/api/clients', { method: 'POST', body });
      toast(client ? 'Saved' : 'Client added');
      m.close();
      onSaved?.(r.client);
    } catch (err) { toast(err.message, true); } finally { busy(btn, false); }
  });
}

// ---------- one client ----------
// Market Leader tabs show only where they apply: locations on main businesses (Market Leader or with locations), reputation on
// Authority and Market Leader, the quarterly plan on Market Leader main businesses.
const tabsFor = (c) => TABS.filter(([k]) => (k === 'locations' ? !c.parent_id && (c.plan === 'leader' || c.locations > 0)
  : k === 'reputation' ? ['authority', 'leader'].includes(c.plan) : k === 'plan' ? c.plan === 'leader' && !c.parent_id : true));
const TABS = [['overview', 'Overview'], ['locations', 'Locations'], ['onboarding', 'Onboarding'], ['tasks', 'Tasks'], ['chat', 'Messages'], ['accesslist', 'Access'], ['meetings', 'Meetings'], ['gbp', 'Google profile'], ['reviews', 'Reviews'], ['reputation', 'Reputation'], ['posts', 'Posts'], ['rankings', 'Rankings'], ['reports', 'Reports'], ['plan', 'Quarterly plan'], ['content', 'Content'], ['site', 'Site audit'], ['calls', 'Calls'], ['citations', 'Citations'], ['website', 'Website'], ['files', 'Files'], ['billing', 'Billing'], ['profile', 'Profile'], ['access', 'Client logins']];

export async function clientPage(app, user, id, tab = 'overview', state = {}) {
  const view = staffShell(app, user, 'clients');
  let data;
  try { data = await api(`/api/clients/${id}`); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const c = data.client;
  view.innerHTML = `
    <div class="page-head"><div><p class="eyebrow"><a href="#/clients">Clients</a> / ${c.parent ? `Location of <a href="#/client/${esc(c.parent.id)}/locations">${esc(c.parent.name)}</a>` : esc(PLAN_NAMES[c.plan])}</p><h1>${esc(c.name)}</h1>
      <div class="small">${esc(c.address || '')}</div></div>
      <div class="row"><label class="small row" style="gap:6px">Account manager <select id="cowner" aria-label="Account manager"><option value="">Nobody</option></select></label><span class="badge ${c.status === 'active' ? '' : 'gray'}">${esc(c.status)}</span><a class="btn btn-ghost btn-sm" href="/scan.html?client=${esc(c.id)}">${icon.scan}Scan</a><button class="btn btn-ghost btn-sm" id="cslack">${icon.slack}Slack</button>${c.contact_email ? `<button class="btn btn-ghost btn-sm" id="cmail">${icon.mail}Email</button>` : ''}<button class="btn btn-ghost btn-sm" id="ccal">Meeting</button><button class="btn btn-mint btn-sm" id="cclaude">Ask Claude</button></div></div>
    <nav class="tabs">${tabsFor(c).map(([k, n]) => `<a href="#/client/${esc(id)}/${k}" class="${tab === k ? 'is-active' : ''}">${n}</a>`).join('')}</nav>
    <section id="tab"></section>`;
  const el = $('#tab', view);
  // Keep the open tab in view when the tab row scrolls sideways.
  const on = $('.tabs .is-active', view);
  if (on) on.parentElement.scrollLeft = Math.max(0, on.offsetLeft - on.parentElement.clientWidth / 2 + on.offsetWidth / 2);
  ownerPicker($('#cowner', view), c);
  $('#cslack', view).addEventListener('click', () => import('./slackapp.js').then((m) => m.sendToSlack('client', c.id)));
  // Google: write to them, or put a meeting with them on your own calendar.
  $('#cclaude', view).addEventListener('click', () => import('./assistant.js').then((m) => m.openAssistant({ clientId: c.id, name: c.name })));
  $('#cmail', view)?.addEventListener('click', async () => ((await import('./gstate.js').then((g) => g.hasGoogle('mail')))
    ? import('./mail.js').then((m) => m.compose({ to: c.contact_email, subject: `${c.name} and Rightway Growth` }))
    : import('./hubmail.js').then((m) => m.compose({ to: c.contact_email, subject: `${c.name} and Rightway Growth`, client_id: c.id }))));
  $('#ccal', view).addEventListener('click', async () => ((await import('./gstate.js').then((g) => g.hasGoogle('calendar')))
    ? import('./gcal.js').then((m) => m.quickEvent({ title: `${c.name} check-in`, attendees: [c.contact_email].filter(Boolean), clientId: c.id }))
    : import('./apptcal.js').then((m) => m.quickAppointment({ title: `${c.name} check-in`, guest_email: c.contact_email || '', client_id: c.id }))));
  if (tab === 'overview') return overviewTab(el, data);
  if (tab === 'accesslist') return import('./work.js').then((m) => m.accessListTab(el, c));
  if (tab === 'chat') return import('./chat.js').then((m) => m.chatView(el, c.id, { staff: true }));
  if (tab === 'meetings') return import('./meetings.js').then((m) => m.meetingsTab(el, c, user));
  if (tab === 'gbp') return import('./gbp.js').then((m) => m.gbpTab(el, c, user));
  if (tab === 'files') return import('./files.js').then((m) => m.clientFilesTab(el, c));
  if (tab === 'tasks') return tasksTab(el, c, state.month || monthKey(), user);
  if (tab === 'reviews') return renderReviews(el, c.id, { staff: true, clientName: c.name });
  if (tab === 'posts') return renderPosts(el, c.id, { staff: true, ai: state.ai });
  if (tab === 'rankings') return renderRankings(el, c.id, { staff: true });
  if (tab === 'reports') return import('./reports.js').then((m) => m.reportsTab(el, c));
  if (tab === 'content') return import('./content.js').then((m) => m.contentTab(el, c, state.sub));
  if (tab === 'site') return import('./siteaudit.js').then((m) => m.siteTab(el, c));
  if (tab === 'calls') return import('./calltrack.js').then((m) => m.callsTab(el, c, user));
  if (tab === 'locations') return import('./leader.js').then((m) => m.locationsTab(el, c));
  if (tab === 'reputation') return import('./leader.js').then((m) => m.reputationTab(el, c));
  if (tab === 'plan') return import('./leader.js').then((m) => m.quarterlyTab(el, c));
  if (tab === 'citations') return import('./citations.js').then((m) => m.citationsTab(el, c));
  if (tab === 'profile') return profileTab(el, c);
  if (tab === 'access') return accessTab(el, c);
  if (tab === 'billing') return billingTab(el, c);
  if (tab === 'website') return import('./googleapps.js').then((m) => m.websiteTab(el, c));
  if (tab === 'onboarding') return onboardingTab(el, c);
}

function overviewTab(el, { client: c, overview: o, activity }) {
  const pct = o.tasks.total ? Math.round((100 * o.tasks.done) / o.tasks.total) : 0;
  el.innerHTML = `
    <div class="stats">
      <div class="stat hero"><div class="stat-num" data-count="${pct}" data-suffix="%">0</div><div class="stat-label">of ${esc(fmt.month(o.month))} work done (${o.tasks.done} of ${o.tasks.total})</div></div>
      <div class="stat"><div class="stat-num" data-count="${o.lastScan?.top10Pct ?? 0}" data-suffix="%">0</div><div class="stat-label">${o.lastScan ? `first page (top 10) coverage for "${esc(o.lastScan.keyword)}"` : 'no scan saved yet'}</div></div>
      <div class="stat"><div class="stat-num" data-count="${o.reviews.sent}">0</div><div class="stat-label">review requests this month (${o.reviews.clicked} opened)</div></div>
      <div class="stat"><div class="stat-num" data-count="${o.posts.posted}">0</div><div class="stat-label">posts published this month (${o.posts.pending} pending)</div></div>
    </div>
    <div class="split" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
      <div class="card">
        <div class="card-head"><h2>Work log</h2></div>
        <form id="lf" class="row" style="margin-bottom:12px"><input name="text" placeholder="Add what was done (the client sees this)" style="flex:1 1 220px" maxlength="1000"><button class="btn btn-primary" type="submit">Add</button></form>
        ${feedHtml(activity)}
      </div>
      <div class="card">
        <div class="card-head"><h2>Plan</h2><span class="badge">${esc(PLAN_NAMES[c.plan])} · ${fmt.money(PLAN_PRICE[c.plan])}/mo</span></div>
        <ul class="list">${(c.plan_info?.monthly || []).map(([kind, title, n]) => `<li class="item"><span class="badge gray">${n}x</span><div class="item-title">${esc(title)}</div><span></span></li>`).join('')}</ul>
        <p class="small" style="margin-top:12px">Tracking ${c.plan_info?.keywords || '-'} keywords. ${c.plan_info?.meetingMinutes || '-'} minute monthly meeting.</p>
      </div>
    </div>`;
  animateNumbers(el);
  $('#lf', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = e.target.text.value.trim();
    if (!t) return;
    try { await api(`/api/clients/${c.id}/log`, { method: 'POST', body: { text: t } }); toast('Logged'); location.reload(); } catch (err) { toast(err.message, true); }
  });
}

// Account manager: new monthly tasks for this client go to this person. Changing it can move the open tasks too.
async function ownerPicker(sel, c) {
  if (!sel) return;
  try {
    const { users } = await api('/api/team');
    sel.innerHTML = `<option value="">Nobody</option>${users.filter((u) => u.role !== 'client').map((u) => `<option value="${esc(u.id)}"${c.owner_id === u.id ? ' selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}`;
  } catch { return; }
  sel.addEventListener('change', async () => {
    const apply = confirm('Also give this person the open tasks nobody owns?');
    try { const r = await api(`/api/clients/${c.id}/owner`, { method: 'PUT', body: { owner_id: sel.value || null, apply } }); c.owner_id = r.owner_id; toast(apply ? `Saved. ${r.moved} tasks moved.` : 'Saved'); } catch (err) { toast(err.message, true); }
  });
}

async function tasksTab(el, c, month, user) {
  el.innerHTML = '<div class="skeleton"></div>';
  let data, team = [];
  try { [data, { users: team }] = await Promise.all([api(`/api/clients/${c.id}/tasks?month=${month}`), api('/api/team')]); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const who = new Map(team.map((u) => [u.id, u.name || u.email]));
  const tasks = data.tasks;
  const done = tasks.filter((t) => t.status === 'done').length;
  const pct = tasks.length ? Math.round((100 * done) / tasks.length) : 0;
  const groups = {};
  tasks.forEach((t) => { (groups[t.kind] ||= []).push(t); });
  const openPanel = (id) => import('./work.js').then((m) => m.openTask(id, user, { onChange: () => tasksTab(el, c, month, user) }));
  el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div class="row"><button class="icon-btn" id="mprev" title="Previous month">&lsaquo;</button><h2 style="margin:0 6px">${esc(fmt.month(month))}</h2><button class="icon-btn" id="mnext" title="Next month">&rsaquo;</button></div>
        <div class="row">${tasks.length ? `<span class="small" id="tcount"><b>${done}</b> of ${tasks.length} done</span>` : ''}<button class="btn btn-ghost btn-sm" id="tadd">${icon.plus}Add task</button></div>
      </div>
      ${tasks.length ? `<div class="progress"><span data-w="${pct}"></span></div><p class="small muted" style="margin:8px 0 0">Tap a task for its guide, timer and proof. Most tasks need a live link or a screenshot to close.</p>` : `
        <div class="empty"><h3>No tasks for this month yet</h3><p>${c.parent_id ? 'Locations do not get plan tasks. The work lives on the main business.' : `They are made on their own for active clients at the start of each month. You can also make them now from the ${esc(PLAN_NAMES[c.plan])} plan.`}</p>
        ${c.parent_id ? '' : `<button class="btn btn-primary" id="tgen">Create ${esc(fmt.month(month))} tasks</button>`}</div>`}
      ${Object.entries(groups).map(([kind, list]) => `<div class="group-title">${esc(KIND_LABEL[kind] || kind)} · ${list.filter((t) => t.status === 'done').length}/${list.length}</div>
        <ul class="list">${list.map((t) => taskRow(t, who)).join('')}</ul>`).join('')}
    </div>`;
  animateNumbers(el);
  $('#mprev', el).addEventListener('click', () => tasksTab(el, c, shiftMonth(month, -1), user));
  $('#mnext', el).addEventListener('click', () => tasksTab(el, c, shiftMonth(month, 1), user));
  $('#tgen', el)?.addEventListener('click', async (e) => {
    busy(e.target, true);
    try { const r = await api(`/api/clients/${c.id}/tasks/generate`, { method: 'POST', body: { month } }); toast(`${r.created} tasks created`); tasksTab(el, c, month, user); } catch (err) { toast(err.message, true); busy(e.target, false); }
  });
  $('#tadd', el).addEventListener('click', async () => {
    const title = prompt('Task');
    if (!title) return;
    try { const r = await api(`/api/clients/${c.id}/tasks`, { method: 'POST', body: { title, month } }); tasksTab(el, c, month, user); openPanel(r.task.id); } catch (err) { toast(err.message, true); }
  });
  el.onclick = async (e) => {
    const row = e.target.closest('.item[data-task]');
    if (!row) return;
    const t = tasks.find((x) => x.id === row.dataset.task);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    try {
      if (act === 'open') return openPanel(t.id);
      if (act === 'toggle') {
        const status = t.status === 'done' ? 'todo' : 'done';
        try { await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { status } }); } catch (err) {
          if (err.status === 400 && status === 'done') { toast(err.message, true); return openPanel(t.id); }
          throw err;
        }
        t.status = status;
        row.classList.toggle('is-done', status === 'done');
        $('.check', row).classList.toggle('on', status === 'done');
        const d = tasks.filter((x) => x.status === 'done').length;
        $('.progress > span', el).style.width = `${Math.round((100 * d) / tasks.length)}%`;
        $('#tcount', el).innerHTML = `<b>${d}</b> of ${tasks.length} done`;
      }
      if (act === 'eye') {
        await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { client_visible: !t.client_visible } });
        t.client_visible = t.client_visible ? 0 : 1;
        e.target.closest('[data-act]').classList.toggle('off', !t.client_visible);
        toast(t.client_visible ? 'Client can see this' : 'Hidden from the client');
      }
      if (act === 'del') {
        if (!confirm('Delete this task?')) return;
        await api(`/api/tasks/${t.id}`, { method: 'DELETE' });
        row.remove();
      }
    } catch (err) { toast(err.message, true); }
  };
}

function taskRow(t, who = new Map()) {
  const on = t.status === 'done';
  const meta = [t.due ? `due ${new Date(`${t.due}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '', t.owner ? who.get(t.owner) || 'assigned' : 'nobody assigned', t.status === 'doing' ? 'in progress' : '', t.link || t.proof_key ? 'proof added' : ''].filter(Boolean).join(' · ');
  return `<li class="item${on ? ' is-done' : ''}" data-task="${esc(t.id)}">
    <button class="check${on ? ' on' : ''}" data-act="toggle" aria-label="Mark done">${icon.check}</button>
    <div data-act="open" class="task-open" role="button" tabindex="0"><div class="item-title">${esc(t.title)}</div><div class="item-sub">${esc(meta)}</div>${t.note ? `<div class="item-sub">${esc(t.note)}</div>` : ''}${t.link ? `<a class="small" href="${esc(t.link)}" target="_blank" rel="noopener">${esc(t.link)}</a>` : ''}</div>
    <div class="item-actions">
      <button class="icon-btn${t.client_visible ? '' : ' off'}" data-act="eye" title="Client can see this">${icon.eye}</button>
      <button class="icon-btn" data-act="open" title="Open the task">${icon.note}</button>
      <button class="icon-btn" data-act="del" title="Delete">${icon.trash}</button>
    </div></li>`;
}

function profileTab(el, c) {
  el.innerHTML = `<div class="card"><div class="card-head"><h2>Business profile</h2><button class="btn btn-primary" id="edit">Edit profile</button></div>
    <div class="form-grid">${FIELDS.filter(([k]) => k !== 'notes' || c.notes).map(([k, label]) => `<div><div class="small">${esc(label)}</div><div>${esc(c[k] ?? '-') || '-'}</div></div>`).join('')}</div></div>
    <div class="card"><h3>Review link</h3><div class="copybox"><code>${esc(c.review_link || 'Add a Google place ID to create it')}</code>${c.review_link ? '<button class="btn btn-ghost btn-sm" id="cp">Copy</button>' : ''}</div></div>`;
  $('#edit', el).addEventListener('click', () => clientForm(c, () => location.reload()));
  $('#cp', el)?.addEventListener('click', () => copy(c.review_link, 'Review link copied'));
}

async function accessTab(el, c) {
  el.innerHTML = '<div class="skeleton"></div>';
  let users;
  try { ({ users } = await api(`/api/clients/${c.id}/users`)); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  el.innerHTML = `
    <div class="card"><div class="card-head"><h2>Give ${esc(c.name)} a login</h2></div>
      <p class="muted">They get their own dashboard: results, work done, review requests, and photo posting. They can install it on their phone home screen like an app.</p>
      <form id="inv" class="form-grid"><label class="field"><span>Name</span><input name="name" required></label><label class="field"><span>Email</span><input name="email" type="email" required></label>
        <div class="span-all row end"><button class="btn btn-primary" type="submit">Create invite link</button></div></form>
      <div id="invout"></div></div>
    <div class="card"><h2>Logins</h2>${users.length ? `<ul class="list">${users.map((u) => `<li class="item" data-u="${esc(u.id)}"><span class="badge ${u.active ? '' : 'warn'}">${u.active ? 'Active' : 'Invited'}</span>
      <div><div class="item-title">${esc(u.name || u.email)}</div><div class="item-sub">${esc(u.email)}${u.last_login ? ` · last in ${esc(fmt.ago(u.last_login))}` : ''}</div></div>
      <div class="item-actions"><button class="btn btn-ghost btn-sm" data-act="reset">New link</button><button class="icon-btn" data-act="rm" title="Remove">${icon.trash}</button></div></li>`).join('')}</ul>` : '<p class="muted">No logins yet.</p>'}</div>`;
  $('#inv', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api(`/api/clients/${c.id}/invite`, { method: 'POST', body: Object.fromEntries(new FormData(e.target).entries()) });
      showInvite($('#invout', el), r.inviteUrl, c.name);
    } catch (err) { toast(err.message, true); }
  });
  el.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const id = e.target.closest('[data-u]')?.dataset.u;
    if (!act || !id) return;
    try {
      if (act === 'reset') { const r = await api(`/api/users/${id}/reset`, { method: 'POST' }); showInvite($('#invout', el), r.inviteUrl, c.name); }
      if (act === 'rm' && confirm('Remove this login?')) { await api(`/api/users/${id}`, { method: 'DELETE' }); accessTab(el, c); }
    } catch (err) { toast(err.message, true); }
  };
}

export function showInvite(box, url, name) {
  const msg = `Here's your Rightway Growth dashboard${name ? ` for ${name}` : ''}. Tap to set your password: ${url}`;
  box.innerHTML = `<div class="card" style="box-shadow:none;background:var(--mint-soft);margin-top:16px"><h3>Invite link (works for 7 days)</h3>
    <div class="copybox"><code>${esc(url)}</code><button class="btn btn-ghost btn-sm" id="ci">Copy</button></div>
    <div class="row" style="margin-top:10px"><a class="btn btn-ghost btn-sm" href="sms:?&body=${encodeURIComponent(msg)}">${icon.msg}Text it</a><a class="btn btn-ghost btn-sm" href="mailto:?subject=${encodeURIComponent('Your Rightway Growth dashboard')}&body=${encodeURIComponent(msg)}">${icon.mail}Email it</a></div></div>`;
  $('#ci', box).addEventListener('click', () => copy(url, 'Invite link copied'));
}

// ---------- team ----------
export async function teamPage(app, user) {
  const view = staffShell(app, user, 'settings');
  let users;
  try { ({ users } = await api('/api/team')); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  view.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">Settings</p><h1>Agents</h1></div></div>${settingsTabs('team', user)}
    ${user.role === 'admin' ? `<div class="card"><h2>Invite an agent or owner</h2>
      <form id="tinv" class="form-grid"><label class="field"><span>Name</span><input name="name" required></label><label class="field"><span>Email</span><input name="email" type="email" required></label>
      <label class="field"><span>Role</span><select name="role"><option value="admin">Owner (full access)</option><option value="team">Agent (own calls, no owner settings)</option></select></label>
      <div class="span-all row end"><button class="btn btn-primary" type="submit">Create invite link</button></div></form><div id="tout"></div></div>` : ''}
    <div class="card"><h2>Owners and agents</h2><ul class="list">${users.map((u) => `<li class="item"><span class="badge ${u.active ? '' : 'warn'}">${u.role === 'admin' ? 'Owner' : 'Agent'}</span>
      <div><div class="item-title">${esc(u.name || u.email)}${u.id === user.id ? ' (you)' : ''}</div><div class="item-sub">${esc(u.email)}${u.active ? '' : ' · invite pending'}</div></div>${user.role === 'admin' && u.id !== user.id ? `<button type="button" class="btn btn-ghost btn-sm" data-role="${esc(u.id)}" data-to="${u.role === 'admin' ? 'team' : 'admin'}">${u.role === 'admin' ? 'Make agent' : 'Make owner'}</button>` : '<span></span>'}</li>`).join('')}</ul>
      <p class="small muted" style="margin:12px 0 0">Owners can listen to agents' calls, hear agents' recordings, change phone settings and manage agents. Owners never see each other's personal line, recordings or vault. Agents only see their own calls and numbers.</p></div>`;
  $$('[data-role]', view).forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.to === 'admin' && !b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Click again to confirm'; setTimeout(() => { if (document.body.contains(b)) { delete b.dataset.sure; b.textContent = 'Make owner'; } }, 4000); return; }
    try { await api(`/api/users/${b.dataset.role}/role`, { method: 'PUT', body: { role: b.dataset.to } }); toast(b.dataset.to === 'admin' ? 'Now an owner' : 'Now an agent'); teamPage(app, user); }
    catch (err) { toast(err.message, true); }
  }));
  $('#tinv', view)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const r = await api('/api/team/invite', { method: 'POST', body: Object.fromEntries(new FormData(e.target).entries()) }); showInvite($('#tout', view), r.inviteUrl, ''); }
    catch (err) { toast(err.message, true); }
  });
}
