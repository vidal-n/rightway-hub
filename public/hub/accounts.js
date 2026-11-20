// Settings, Accounts and handover (owners). Modeled on the offboarding and ownership transfer pages in Google Workspace admin and the
// shared vault ownership lists in 1Password Business. Three parts: every account we hold and which email it is under, the logins that
// are not info@ yet, and the handover of a person's clients with a work record per client (so nothing someone did is lost).
import { $, $$, esc, api, toast, busy } from './core.js';
import { staffShell, settingsTabs } from './staff.js';
import { loginState, LOGIN_TEXT } from '/js/accounts.js';

const badge = (s) => `<span class="badge ${s === 'ok' ? '' : s === 'other' ? 'warn' : 'gray'}">${LOGIN_TEXT[s]}</span>`;
const subTabs = (a) => `<nav class="tabs" style="margin-bottom:14px">${[['accounts', 'Company accounts'], ['logins', 'Logins to move'], ['handover', 'Handover and work record']].map(([k, l]) => `<a href="#/settings/accounts${k === 'accounts' ? '' : `/${k}`}" class="${a === k ? 'is-active' : ''}">${l}</a>`).join('')}</nav>`;

export async function accountsPage(app, user, sub = '') {
  const view = staffShell(app, user, 'settings');
  const tab = ['logins', 'handover'].includes(sub) ? sub : 'accounts';
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Settings</p><h1>Accounts and handover</h1></div></div>${settingsTabs('accounts', user)}${subTabs(tab)}<div id="acbody"><div class="skeleton"></div></div>`;
  const host = $('#acbody', view);
  try { await ({ accounts, logins, handover }[tab])(host, user); } catch (e) { host.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; }
}

async function accounts(host) {
  const d = await api('/api/accounts');
  host.innerHTML = `<p class="small muted" style="margin:0 0 10px">Every tool we open an account with goes under <b>${esc(d.email)}</b>. Type the email each account really uses. Anything that is not info@ shows in red so it gets moved.</p>
    <div class="row" style="gap:8px;margin-bottom:12px;flex-wrap:wrap"><span class="badge">${d.counts.ok} under info@</span><span class="badge warn">${d.counts.other} to move</span><span class="badge gray">${d.counts.unset} not checked</span>
      <button class="btn btn-ghost btn-sm" id="aseed">Add the usual accounts</button></div>
    <div class="card"><form id="aform" class="row" style="gap:8px;flex-wrap:wrap"><input name="vendor" placeholder="Tool or vendor" required style="flex:1;min-width:160px"><input name="purpose" placeholder="What it is for" style="flex:2;min-width:180px"><input name="login_email" type="email" placeholder="${esc(d.email)}" style="flex:1;min-width:200px"><button class="btn btn-primary btn-sm">Add</button></form></div>
    ${d.accounts.length ? `<ul class="list" style="margin-top:12px">${d.accounts.map((a) => `<li class="item" data-id="${esc(a.id)}"><div style="min-width:0;flex:1"><div class="item-title">${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.vendor)}</a>` : esc(a.vendor)} ${badge(a.state)}</div>
      <div class="item-sub">${esc(a.purpose || '')}</div>
      <input class="small" data-f="login_email" type="email" placeholder="Login email" value="${esc(a.login_email || '')}" style="margin-top:6px;width:100%;max-width:360px">
      <input class="small" data-f="note" placeholder="Note (who has the password, where it is kept)" value="${esc(a.note || '')}" style="margin-top:6px;width:100%"></div>
      <div class="row" style="gap:6px"><button class="btn btn-ghost btn-sm" data-info title="Set the login to ${esc(d.email)}">Use info@</button><button class="btn btn-ghost btn-sm" data-del>Remove</button></div></li>`).join('')}</ul>` : '<div class="card empty" style="margin-top:12px"><h3>Nothing listed yet</h3><p>Press "Add the usual accounts" to start the list.</p></div>'}`;
  $('#aseed', host).onclick = async () => { const r = await api('/api/accounts/seed', { method: 'POST' }); toast(r.added ? `Added ${r.added}` : 'Already there'); accounts(host); };
  $('#aform', host).onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); try { await api('/api/accounts', { method: 'POST', body: f }); accounts(host); } catch (err) { toast(err.message, true); } };
  $$('li[data-id]', host).forEach((li) => {
    const id = li.dataset.id, put = async (body) => { try { await api(`/api/accounts/${id}`, { method: 'PUT', body }); } catch (err) { toast(err.message, true); } };
    $$('[data-f]', li).forEach((i) => i.addEventListener('change', async () => { await put({ [i.dataset.f]: i.value }); if (i.dataset.f === 'login_email') accounts(host); }));
    $('[data-info]', li).onclick = async () => { await put({ login_email: d.email, status: 'moved' }); accounts(host); };
    $('[data-del]', li).onclick = async () => { await api(`/api/accounts/${id}`, { method: 'DELETE' }); accounts(host); };
  });
}

async function logins(host) {
  const d = await api('/api/logins/audit');
  const none = !d.accounts.length && !d.items.length;
  host.innerHTML = `<p class="small muted" style="margin:0 0 10px">Logins that are not <b>${esc(d.email)}</b>. For a client's Google profile, WordPress, Analytics and the rest: add ${esc(d.email)} as a manager or admin from the client's side, then change "Logged in as" on that client's Access tab. Nothing here is deleted.</p>
    ${none ? '<div class="card empty"><h3>Every login that was typed in is under info@</h3><p>Logins nobody has typed in yet show as "Not checked" on each client\'s Access tab.</p></div>' : ''}
    ${d.accounts.length ? `<div class="card"><div class="card-head"><h2>Company accounts</h2></div><ul class="list">${d.accounts.map((a) => `<li class="item"><div><div class="item-title">${esc(a.vendor)} ${badge(a.state)}</div><div class="item-sub">${esc(a.login_email || 'Login email not typed in yet')}</div></div></li>`).join('')}</ul></div>` : ''}
    ${d.items.length ? `<div class="card" style="margin-top:12px"><div class="card-head"><h2>Client accounts under another email</h2></div><ul class="list">${d.items.map((i) => `<li class="item"><div><div class="item-title">${esc(i.client)}: ${esc(i.item)}</div><div class="item-sub">Login: ${esc(i.login_email)}${i.note ? ` · ${esc(i.note)}` : ''}</div></div><a class="btn btn-ghost btn-sm" href="#/client/${esc(i.client_id)}/accesslist">Open</a></li>`).join('')}</ul></div>` : ''}`;
}

async function handover(host) {
  const team = (await api('/api/team')).users.filter((u) => u.role !== 'client');
  const hist = await api('/api/handover/history');
  const opt = (u) => `<option value="${esc(u.id)}">${esc(u.name || u.email)}${u.role === 'admin' ? ' (owner)' : ''}</option>`;
  host.innerHTML = `<div class="card"><div class="card-head"><h2>1. Hand a person's clients to someone</h2></div>
      <p class="small muted">Moves the account manager, their open tasks and (if ticked) their upcoming calls. Everything already done keeps the name of who did it. Nobody's history is deleted or rewritten.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap"><label class="small">From <select id="hfrom"><option value="">Pick a person</option>${team.map(opt).join('')}</select></label>
      <label class="small">To <select id="hto"><option value="">Pick a person</option>${team.map(opt).join('')}</select></label></div>
      <div id="hbox" style="margin-top:12px"></div></div>
    <div class="card" style="margin-top:12px"><div class="card-head"><h2>2. Work record for a client</h2></div>
      <p class="small muted">Everything done for a client in one file: tasks, log, time, posts, pages, site fixes, listings and links, and the access list with logins. Download it before changing anything. Try "Dhal".</p>
      <div class="row" style="gap:8px"><input id="hq" placeholder="Search clients, for example Dhal" value="Dhal" style="flex:1;max-width:360px"><button class="btn btn-ghost btn-sm" id="hgo">Search</button></div>
      <div id="hres" style="margin-top:10px"></div></div>
    <div class="card" style="margin-top:12px"><div class="card-head"><h2>Past handovers</h2></div>${hist.history.length ? `<ul class="list">${hist.history.map((h) => `<li class="item"><div><div class="item-title">${esc(h.from_name)} to ${esc(h.to_name)}</div><div class="item-sub">${esc(new Date(h.at).toLocaleString())} · ${h.counts.clients || 0} clients, ${h.counts.tasks || 0} tasks, ${h.counts.appointments || 0} calls</div></div></li>`).join('')}</ul>` : '<p class="small muted">None yet.</p>'}</div>`;
  const box = $('#hbox', host);
  const draw = async () => {
    const f = $('#hfrom', host).value;
    if (!f) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="skeleton"></div>';
    const h = await api(`/api/handover/holds/${f}`);
    box.innerHTML = `<p class="small"><b>${esc(h.person.name)}</b> (${esc(h.person.email)}) manages <b>${h.clients.length}</b> client${h.clients.length === 1 ? '' : 's'}, has <b>${h.openTasks}</b> open tasks and <b>${h.appointments}</b> upcoming calls.</p>
      ${h.clients.length ? `<ul class="list">${h.clients.map((c) => `<li class="item"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-c="${esc(c.id)}"> ${esc(c.name)}</label></li>`).join('')}</ul>` : ''}
      <label class="small" style="display:block;margin:8px 0"><input type="checkbox" id="happt"> Also move their upcoming booked calls</label>
      <button class="btn btn-primary btn-sm" id="hdo"${h.clients.length || h.appointments ? '' : ' disabled'}>Hand over</button>
      ${h.doneBy.length ? `<h4 style="margin:16px 0 6px">Work this person has done (stays on the record)</h4><ul class="list">${h.doneBy.map((r) => `<li class="item"><div class="item-title">${esc(r.name)}</div><span class="small muted">${r.n} tasks done, ${r.minutes} minutes</span></li>`).join('')}</ul>` : ''}
      ${h.theirLogins.length ? `<h4 style="margin:16px 0 6px">Accounts logged in under their own email: re-invite as info@</h4><ul class="list">${h.theirLogins.map((l) => `<li class="item"><div><div class="item-title">${esc(l.client)}: ${esc(l.item)}</div><div class="item-sub">${esc(l.login_email)}</div></div><a class="btn btn-ghost btn-sm" href="#/client/${esc(l.client_id)}/accesslist">Open</a></li>`).join('')}</ul>` : '<p class="small muted" style="margin-top:12px">No access items are typed in under their email. Check each client\'s Access tab: "Logged in as".</p>'}`;
    $('#hdo', box)?.addEventListener('click', async (e) => {
      const to = $('#hto', host).value;
      if (!to) return toast('Pick who takes over.', true);
      const clients = $$('[data-c]:checked', box).map((i) => i.dataset.c);
      if (!clients.length && !$('#happt', box).checked) return toast('Tick the clients to hand over. Nothing is ticked by default.', true);
      if (!confirm(`Hand ${clients.length} client${clients.length === 1 ? '' : 's'} from ${h.person.name} to the person picked? Open tasks move too. Finished work and its history stay as they are.`)) return;
      await busy(e.currentTarget, async () => { try { const r = await api('/api/handover', { method: 'POST', body: { from: f, to, clients, appointments: $('#happt', box).checked } }); toast(`Moved ${r.clients} clients and ${r.tasks} open tasks`); handover(host); } catch (err) { toast(err.message, true); } });
    });
  };
  $('#hfrom', host).onchange = () => draw().catch((e) => toast(e.message, true));
  const search = async () => {
    const r = await api(`/api/handover/clients?q=${encodeURIComponent($('#hq', host).value)}`);
    $('#hres', host).innerHTML = r.clients.length ? `<ul class="list">${r.clients.map((c) => `<li class="item"><div><div class="item-title">${esc(c.name)}</div><div class="item-sub">Manager: ${esc(c.manager)} · Work done by ${c.workBy.length ? c.workBy.map((w) => `${esc(w.who)} (${w.n})`).join(', ') : 'nobody yet'}</div></div>
      <div class="row" style="gap:6px"><a class="btn btn-primary btn-sm" href="/api/clients/${esc(c.id)}/work-record?format=csv">Download record</a><a class="btn btn-ghost btn-sm" href="#/client/${esc(c.id)}/accesslist">Access</a></div></li>`).join('')}</ul>` : '<p class="small muted">No client by that name.</p>';
  };
  $('#hgo', host).onclick = () => search().catch((e) => toast(e.message, true));
  search().catch(() => {});
}
