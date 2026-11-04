// Team home: today's calling, meetings, callbacks, pipeline, clients, deals. Plus the Client view (see the app as a client does).
import { $, $$, esc, api, toast, busy, fmt, icon, animateNumbers } from './core.js';
import { staffShell, clientsTabs } from './staff.js';
import { leadModal, STAGE_LABEL } from './crm.js';
import { paymentsSnapshot } from './payments.js';

const DIAL_TARGET = 60;
const when = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const hello = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const ACT = { call: 'Call', sms: 'Text', stage: 'Update', note: 'Note', payment: 'Payment', meeting: 'Meeting' };

export async function homePage(app, user) {
  const view = staffShell(app, user, 'home');
  const day = new Date(); day.setHours(0, 0, 0, 0);
  let d;
  try { d = await api(`/api/dashboard?since=${day.getTime()}&week=${day.getTime() - 6 * 864e5}`); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const first = (user.name || '').split(' ')[0];
  const pctDials = Math.min(100, Math.round((100 * d.me.dials) / DIAL_TARGET));
  const pipe = [['new', 'New'], ['attempting', 'Attempting'], ['callback', 'Callback'], ['audit_booked', 'Audit booked'], ['follow_up', 'Follow up'], ['won', 'Won']];
  const maxPipe = Math.max(1, ...pipe.map(([k]) => d.pipeline.byStage[k] || 0));
  const workPct = d.work.tasksTotal ? Math.round((100 * d.work.tasksDone) / d.work.tasksTotal) : 0;
  view.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">${esc(new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }))}</p><h1>${esc(hello())}${first ? `, ${esc(first)}` : ''}</h1></div>
      <div class="row"><a class="btn btn-mint" href="#/phone">${icon.phone}Start dialing</a><a class="btn btn-ghost" href="#/pipeline">${icon.chart}Pipeline</a></div></div>
    <div class="stats">
      <div class="stat hero"><div class="stat-num" data-count="${d.me.dials}">0</div><div class="stat-label">dials today (goal ${DIAL_TARGET})</div><div class="progress" style="margin-top:10px"><span data-w="${pctDials}"></span></div></div>
      <div class="stat"><div class="stat-num" data-count="${d.me.talks}">0</div><div class="stat-label">owner conversations today</div></div>
      <div class="stat"><div class="stat-num" data-count="${d.me.booked}">0</div><div class="stat-label">audits booked today</div></div>
      <div class="stat"><div class="stat-num" data-count="${d.pipeline.callableNow}">0</div><div class="stat-label">leads you can call right now (${d.pipeline.aLeads} A grade open)</div></div>
    </div>
    <div class="home-grid">
      ${user.role === 'admin' ? '<div class="card" id="paysnap"><div class="card-head"><h2>Payments</h2></div><div class="skeleton" style="height:70px"></div></div><div class="card" id="balsnap"></div>' : ''}
      <div class="card" id="floor"><div class="card-head"><h2>Team floor</h2><a class="btn btn-ghost btn-sm" href="#/agents">Agents</a></div><div class="skeleton" style="height:70px"></div></div>
      <div class="card"><div class="card-head"><h2>Meetings coming up</h2><a class="btn btn-ghost btn-sm" href="#/pipeline">All leads</a></div>
        ${d.meetings.length ? `<ul class="list">${d.meetings.map((m) => `<li class="item"><span class="badge">${esc(when(m.meet_at))}</span>
          <div><div class="item-title">${esc(m.business)}</div><div class="item-sub">${esc(m.contact_name || '')}</div></div>
          <div class="row" style="gap:6px">${m.meet_link ? `<a class="btn btn-mint btn-sm" href="${esc(m.meet_link)}" target="_blank" rel="noopener">Join</a>` : ''}<a class="btn btn-primary btn-sm" href="/present.html#${esc(m.id)}" target="_blank" rel="noopener">Present</a></div></li>`).join('')}</ul>`
        : '<p class="muted">No meetings booked yet. Every audit you book shows up here with its Meet link and presentation.</p>'}</div>
      <div class="card"><div class="card-head"><h2>Callbacks due</h2><span class="badge ${d.due.length ? 'warn' : 'gray'}">${d.due.length}</span></div>
        ${d.due.length ? `<ul class="list">${d.due.map((l) => `<li class="item" data-lead="${esc(l.id)}" style="cursor:pointer"><span class="badge ${l.next_action_at < Date.now() ? 'bad' : 'gray'}">${esc(l.next_action_at < Date.now() ? 'Now' : new Date(l.next_action_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</span>
          <div><div class="item-title">${esc(l.business)}</div><div class="item-sub">${esc(l.next_action || STAGE_LABEL[l.stage] || '')}</div></div>${l.grade ? `<span class="badge gray">${esc(l.grade)}</span>` : ''}</li>`).join('')}</ul>`
        : '<p class="muted">Nothing due today. The dialer brings callbacks back at the right time automatically.</p>'}</div>
      <div class="card"><div class="card-head"><h2>Pipeline</h2><span class="small">${d.pipeline.open} open leads</span></div>
        <div class="pipe-bars">${pipe.map(([k, n]) => `<a href="#/pipeline" class="pipe-bar"><span>${n}</span><i><b style="width:${Math.round((100 * (d.pipeline.byStage[k] || 0)) / maxPipe)}%"></b></i><em>${d.pipeline.byStage[k] || 0}</em></a>`).join('')}</div>
        <p class="small" style="margin-top:12px">This week, whole team: ${d.week.dials} dials, ${d.week.talks} conversations, ${d.week.booked} audits booked.</p></div>
      <div class="card"><div class="card-head"><h2>Deals this month</h2></div>
        <div class="mini3"><div><b>${d.orders.sent}</b><span>agreements out</span></div><div><b>${d.orders.signed}</b><span>signed</span></div><div><b>${d.orders.paid}</b><span>paid</span></div></div>
        <div class="row" style="margin-top:14px"><span class="badge ${d.unread ? '' : 'gray'}">${d.unread} unread text${d.unread === 1 ? '' : 's'}</span><a class="btn btn-ghost btn-sm" href="#/phone/texts">${icon.msg}Inbox</a></div></div>
      <div class="card"><div class="card-head"><h2>Clients</h2><a class="btn btn-ghost btn-sm" href="#/clients">Open</a></div>
        <div class="mini3"><div><b>${fmt.money(d.clients.mrr)}</b><span>monthly revenue</span></div><div><b>${d.clients.active}</b><span>active clients</span></div><div><b>${workPct}%</b><span>of this month's work done</span></div></div>
        <p class="small" style="margin-top:12px">${d.work.postsWaiting} post${d.work.postsWaiting === 1 ? '' : 's'} waiting to go out.</p>
        <div class="row" style="margin-top:6px">${d.clients.sample ? `<a class="btn btn-ghost btn-sm" href="#/clients/view/${esc(d.clients.sample)}">${icon.device}See the sample client app</a>` : `<button class="btn btn-ghost btn-sm" id="mk-sample">${icon.device}Create a sample client</button>`}</div></div>
      <div class="card"><div class="card-head"><h2>Recent activity</h2></div>
        ${d.recent.length ? `<ul class="feed">${d.recent.map((a) => `<li><span class="dot">${a.type === 'call' ? icon.phone : a.type === 'sms' ? icon.msg : icon.note}</span>
          <div><div>${esc(ACT[a.type] || 'Update')}${a.outcome ? `: ${esc(a.outcome.replace(/_/g, ' '))}` : ''}${a.business ? ` · ${esc(a.business)}` : ''}</div>${a.body ? `<div class="small">${esc(String(a.body).slice(0, 90))}</div>` : ''}</div><span class="small">${esc(fmt.ago(a.at))}</span></li>`).join('')}</ul>`
        : '<p class="muted">Calls, texts, and updates from the last 7 days show up here.</p>'}</div>
    </div>`;
  animateNumbers(view);
  api('/api/agents').then((d) => {
    const box = $('#floor', view); if (!box) return;
    const st = (a) => ({ on_call: 'On a call', available: 'Available', break: 'Break', lunch: 'Lunch', training: 'Training', meeting: 'Meeting', admin: 'Admin work', offline: 'Offline' })[a.status] || a.status;
    const tone = (a) => ({ on_call: 'live', available: 'good', break: 'warn', lunch: 'warn', offline: 'gray' })[a.status] || 'info';
    box.innerHTML = `<div class="card-head"><h2>Team floor</h2><a class="btn btn-ghost btn-sm" href="#/agents">Agents</a></div>
      <div style="display:grid;gap:8px">${d.agents.map((a) => `<div class="row" style="flex-wrap:nowrap;gap:10px"><i class="dot ${tone(a)}"></i><b style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.name)}</b>
        <span class="small">${esc(a.call ? `with ${a.call.business || 'a lead'}` : st(a))}</span><span class="badge gray mono">${a.today.dials} dials</span></div>`).join('')}</div>`;
  }).catch(() => $('#floor', view)?.remove());
  if (user.role === 'admin') { paymentsSnapshot($('#paysnap', view)); import('./balances.js').then((m) => m.balancesCard($('#balsnap', view))); }
  $$('[data-lead]', view).forEach((li) => li.addEventListener('click', () => leadModal(li.dataset.lead, () => homePage(app, user))));
  $('#mk-sample', view)?.addEventListener('click', async (e) => {
    busy(e.currentTarget, true, 'Creating...');
    try { const r = await api('/api/sample-client', { method: 'POST' }); location.hash = `#/clients/view/${r.id}`; } catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
  });
}

const PORTAL_TABS = [['', 'Home'], ['messages', 'Messages'], ['reviews', 'Reviews'], ['post', 'Post'], ['results', 'Results'], ['start', 'Get started']];

export async function clientViewPage(app, user, clientId) {
  const view = staffShell(app, user, 'clients');
  let clients;
  try { ({ clients } = await api('/api/clients')); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  if (!clients.length) {
    view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Clients</p><h1>See what clients see</h1></div></div>${clientsTabs('view')}
      <div class="card empty"><h3>No clients yet</h3><p>Create a sample client with realistic data: rankings, reviews, posts, tasks, and onboarding. It stays out of your revenue numbers.</p>
      <button class="btn btn-primary" id="mk">${icon.device}Create a sample client</button></div>`;
    $('#mk', view).addEventListener('click', async (e) => {
      busy(e.currentTarget, true, 'Creating...');
      try { const r = await api('/api/sample-client', { method: 'POST' }); location.hash = `#/clients/view/${r.id}`; } catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
    });
    return;
  }
  const c = clients.find((x) => x.id === clientId) || clients.find((x) => x.sample) || clients[0];
  const src = (tab = '') => `/?as=${encodeURIComponent(c.id)}#/${tab}`;
  view.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">Clients · client view, read only</p><h1>See what ${esc(c.contact_name ? c.contact_name.split(' ')[0] : 'the client')} sees</h1></div>
      <div class="row"><select id="cv-pick" aria-label="Client">${clients.map((x) => `<option value="${esc(x.id)}"${x.id === c.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
        <a class="btn btn-ghost" href="${esc(src())}" target="_blank" rel="noopener">Open full screen</a></div></div>
    ${clientsTabs('view')}
    <div class="cv">
      <div class="cv-side">
        <div class="seg cv-tabs" role="tablist">${PORTAL_TABS.map(([k, n], i) => `<button type="button" class="${i === 0 ? 'is-on' : ''}" data-tab="${k}">${n}</button>`).join('')}</div>
        <div class="card" style="box-shadow:none">
          <h3>${esc(c.name)}</h3>
          <p class="small">This is the client app exactly as their login shows it. Buttons that change anything are switched off here, so nothing gets sent or saved.</p>
          <ul class="small cv-notes"><li>Team notes and internal tasks are hidden, same as for the client.</li><li>Check it on a phone: open full screen, or scan their app link from your phone while logged in.</li></ul>
          <div class="row" style="margin-top:12px"><a class="btn btn-ghost btn-sm" href="#/client/${esc(c.id)}/overview">Open in the Hub</a>
            ${c.sample ? '<button class="btn btn-danger btn-sm" id="cv-del">Remove sample</button>' : ''}</div>
        </div>
      </div>
      <div class="cv-phone"><iframe id="cv-frame" title="Client app preview" src="${esc(src())}"></iframe></div>
    </div>`;
  const frame = $('#cv-frame', view);
  // The app renders at a real phone size (390 x 844) and is scaled down to fit the screen, so nothing is cut off or squeezed.
  const fit = () => {
    const ph = $('.cv-phone', view); if (!ph) { window.removeEventListener('resize', fit); return; }
    const top = ph.getBoundingClientRect().top + window.scrollY;
    const avail = Math.max(480, window.innerHeight - (top < window.innerHeight * 0.6 ? top : 90) - 24);
    const wide = Math.max(260, Math.min(ph.parentElement.clientWidth, 460) - 24);
    ph.style.setProperty('--k', String(Math.min(1, (avail - 24) / 844, wide / 390).toFixed(3)));
  };
  fit(); window.addEventListener('resize', fit);
  window.addEventListener('hashchange', () => window.removeEventListener('resize', fit), { once: true });
  $('#cv-pick', view).addEventListener('change', (e) => { location.hash = `#/clients/view/${e.target.value}`; });
  $$('[data-tab]', view).forEach((b) => b.addEventListener('click', () => {
    $$('[data-tab]', view).forEach((x) => x.classList.toggle('is-on', x === b));
    try { frame.contentWindow.location.hash = `#/${b.dataset.tab}`; } catch { frame.src = src(b.dataset.tab); }
  }));
  $('#cv-del', view)?.addEventListener('click', async (e) => {
    if (!confirm('Remove the sample client and all its sample data?')) return;
    busy(e.currentTarget, true);
    try { await api('/api/sample-client', { method: 'DELETE' }); toast('Sample removed'); location.hash = '#/clients/view'; } catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
  });
}
