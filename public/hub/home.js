// Team home: today's calling, meetings, callbacks, pipeline, clients, deals. Plus the Client view (see the app as a client does).
import { $, $$, esc, api, toast, busy, fmt, icon, animateNumbers, editGoal } from './core.js';
import { staffShell, clientsTabs } from './staff.js';
import { can } from '/js/jobs.js';
import { leadModal, STAGE_LABEL } from './crm.js';
import { paymentsSnapshot } from './payments.js';
import { initials } from './shell.js';
import { avatarHtml, wireAvatars, miniAvatar } from './avatar.js';
import { lineChart, barChart, donut, ring, spark, legend } from '/js/charts.js';

const when = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const hello = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const ACT = { call: 'Call', sms: 'Text', stage: 'Update', note: 'Note', payment: 'Payment', meeting: 'Meeting' };

const PIPE = [['new', 'New', 'var(--c-slate)'], ['attempting', 'Attempting', 'var(--c-blue)'], ['callback', 'Callback', 'var(--c-amber)'], ['audit_booked', 'Audit booked', 'var(--c-violet)'], ['follow_up', 'Follow up', 'var(--c-teal)'], ['won', 'Won', 'var(--c-green)']];
const GRADE = { A: 'var(--c-green)', B: 'var(--c-teal)', C: 'var(--c-amber)', D: 'var(--c-slate)', 'Not scored': 'var(--c-line)' };
const ACT_TONE = { call: 'k-call', sms: 'k-text', stage: 'k-lead', note: 'k-task', payment: 'k-money', meeting: 'k-meet' };
const hourLabel = (h) => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`;
const dLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export async function homePage(app, user) {
  const view = staffShell(app, user, 'home');
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const admin = user.role === 'admin';
  let d, an;
  try {
    [d, an] = await Promise.all([api(`/api/dashboard?since=${day.getTime()}&week=${day.getTime() - 6 * 864e5}`), api('/api/analytics/calls?days=14').catch(() => null)]);
  } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const first = (user.name || '').split(' ')[0];
  const DIAL_TARGET = d.me.goal || 60;
  const pctDials = Math.min(100, Math.round((100 * d.me.dials) / DIAL_TARGET));
  const workPct = d.work.tasksTotal ? Math.round((100 * d.work.tasksDone) / d.work.tasksTotal) : 0;
  const daily = an?.daily || [];
  const dl = daily.map((x) => dLabel(x.day));
  const lastN = (k) => daily.map((x) => x[k] || 0);
  const pipeSegs = PIPE.map(([k, label, color]) => ({ label, value: d.pipeline.byStage[k] || 0, color }));
  const scope = admin ? 'Team' : 'Your';
  const inv = (an?.inventory || []).reduce((m, r) => { const g = String(r.grade || 'Not scored'); m[g] = m[g] || { total: 0, fresh: 0 }; m[g].total += r.total || 0; m[g].fresh += r.fresh || 0; return m; }, {});
  const grades = ['A', 'B', 'C', 'D', 'Not scored'].filter((g) => inv[g]);
  const maxGrade = Math.max(1, ...grades.map((g) => inv[g].total));
  const funnel = an?.funnel || [];
  const f0 = Math.max(1, funnel[0]?.n || 0);
  const hrs = an?.hours || [];
  const tile = (cls, num, label, sparkVals, color, extra = '') => `<div class="stat tile ${cls}"><div class="tile-top"><div class="stat-num mono" data-count="${num}">0</div>${sparkVals.length > 1 ? `<div class="tile-spark">${spark(sparkVals, { color })}</div>` : ''}</div><div class="stat-label">${label}</div>${extra}</div>`;
  view.innerHTML = `
    <div class="page-head"><div class="hello"><span class="hello-av">${avatarHtml(user, initials(user))}</span><div><p class="eyebrow">${esc(new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }))}</p><h1>${esc(hello())}${first ? `, ${esc(first)}` : ''}</h1></div></div>
      <div class="row"><a class="btn btn-mint" href="#/phone">${icon.phone}Start dialing</a><a class="btn btn-ghost" href="#/pipeline">${icon.chart}Pipeline</a></div></div>
    <div id="gprompt"></div>
    <div class="bento">
      <div class="stat tile hero w-3"><div class="tile-top"><div class="stat-num mono" data-count="${d.me.dials}">0</div>${daily.length > 1 ? `<div class="tile-spark">${spark(lastN('dials'), { color: 'var(--mint)' })}</div>` : ''}</div><div class="stat-label">dials today, goal ${DIAL_TARGET}</div><div class="progress" style="margin-top:10px"><span data-w="${pctDials}"></span></div></div>
      ${tile('tint-blue w-3', d.me.talks, 'owner conversations today', lastN('contacts'), 'var(--c-blue)')}
      ${tile('tint-amber w-3', d.me.booked, 'audits booked today', lastN('booked'), 'var(--c-amber)')}
      ${tile('tint-violet w-3', d.pipeline.callableNow, `leads you can call now (${d.pipeline.aLeads} A grade open)`, [], 'var(--c-violet)')}

      <div class="card w-8 wc-blue"><div class="card-head"><h2>${scope} calls, last 14 days</h2><span class="small muted">${an ? `${an.total.dials} dials, ${an.total.connects} contacts, ${an.total.booked} booked` : ''}</span></div>
        ${daily.length > 1 ? (() => { const S = [{ name: 'Dials', color: 'var(--c-blue)', values: lastN('dials') }, { name: 'Contacts', color: 'var(--c-green)', values: lastN('contacts') }, { name: 'Booked', color: 'var(--c-amber)', values: lastN('booked') }]; return lineChart(dl, S, { h: 230, area: true }) + legend(S); })() : '<p class="muted">Calls show up here as soon as the dialer is used.</p>'}</div>
      <div class="card w-4 wc-green"><div class="card-head"><h2>Today's goal</h2><span class="badge gray mono">${d.me.dials}/${user.role === 'admin' ? `<button type="button" class="goal-btn" id="hgoal" title="Click to change your daily dial goal">${DIAL_TARGET}</button>` : `<span title="Your owner sets your daily dial goal">${DIAL_TARGET}</span>`}</span></div>
        <div class="goal-ring">${ring(pctDials, { size: 150, thick: 16, color: pctDials >= 100 ? 'var(--c-green)' : 'var(--c-blue)', center: `${pctDials}%`, sub: 'of dial goal' })}</div>
        <div class="mini3"><div><b>${d.me.dials}</b><span>dials</span></div><div><b>${d.me.talks}</b><span>talks</span></div><div><b>${d.me.booked}</b><span>booked</span></div></div>
        <p class="small" style="margin:10px 0 0">${DIAL_TARGET - d.me.dials > 0 ? `${DIAL_TARGET - d.me.dials} dials to goal.` : 'Goal hit. Keep going.'} Team this week: ${d.week.dials} dials, ${d.week.booked} booked.</p></div>

      <div class="card w-4 wc-violet"><div class="card-head"><h2>Pipeline</h2><span class="small muted">${d.pipeline.open} open</span></div>
        <div class="dn-row">${donut(pipeSegs, { size: 150, thick: 20, center: String(d.pipeline.open), sub: 'open leads' })}<ul class="dn-leg">${pipeSegs.map((p) => `<li><i style="background:${p.color}"></i><span>${esc(p.label)}</span><b class="mono">${p.value}</b></li>`).join('')}</ul></div></div>
      <div class="card w-4 wc-teal"><div class="card-head"><h2>Conversion funnel</h2><span class="small muted">last 14 days</span></div>
        ${funnel.length && f0 > 1 ? `<div class="fn">${funnel.map((x, i) => `<div class="fn-row"><span>${esc(x.label)}</span><i><b style="width:${Math.max(2, Math.round((100 * x.n) / f0))}%;background:hsl(${210 - i * 22} 62% ${52 - i * 2}%)"></b></i><em class="mono">${x.n}${i && funnel[i - 1].n ? ` <small>${Math.round((100 * x.n) / funnel[i - 1].n)}%</small>` : ''}</em></div>`).join('')}</div>` : '<p class="muted">Dial for a few days and the funnel fills in: contacts, conversations, audits, signed, paid.</p>'}</div>
      <div class="card w-4 wc-amber"><div class="card-head"><h2>Lead quality</h2><a class="btn btn-ghost btn-sm" href="#/phone">Dial</a></div>
        ${grades.length ? `<div class="gq">${grades.map((g) => `<div class="gq-row"><span class="gq-g" style="background:${GRADE[g]}">${esc(g === 'Not scored' ? '?' : g)}</span><i><b style="width:${Math.max(3, Math.round((100 * inv[g].total) / maxGrade))}%;background:${GRADE[g]}"></b></i><em class="mono">${inv[g].total}</em><small>${inv[g].fresh} fresh</small></div>`).join('')}</div>` : '<p class="muted">Import leads and research them. The best ones float to the top of the dialer.</p>'}</div>

      <div class="card w-6 wc-blue"><div class="card-head"><h2>Best hours to call</h2><span class="small muted">dials and contacts by hour</span></div>
        ${hrs.length ? (() => { const S = [{ name: 'Dials', color: 'var(--c-blue)', values: hrs.map((h) => h.dials) }, { name: 'Contacts', color: 'var(--c-green)', values: hrs.map((h) => h.connects) }]; return barChart(hrs.map((h) => hourLabel(h.hour)), S, { h: 190 }) + legend(S); })() : '<p class="muted">Once there are calls, you see which hours get people on the phone.</p>'}</div>
      <div class="card w-6 wc-coral"><div class="card-head"><h2>Meetings coming up</h2><a class="btn btn-ghost btn-sm" href="#/calendar">Calendar</a></div>
        ${d.meetings.length ? `<ul class="list">${d.meetings.map((m) => `<li class="item"><span class="badge k-meet-b">${esc(when(m.meet_at))}</span>
          <div><div class="item-title">${esc(m.business)}</div><div class="item-sub">${esc(m.contact_name || '')}</div></div>
          <div class="row" style="gap:6px">${m.meet_link ? `<a class="btn btn-mint btn-sm" href="${esc(m.meet_link)}" target="_blank" rel="noopener">Join</a>` : ''}${can(user, 'close') ? `<a class="btn btn-primary btn-sm" href="/present.html#${esc(m.id)}" target="_blank" rel="noopener">Present</a>` : ''}</div></li>`).join('')}</ul>`
        : '<p class="muted">No meetings booked yet. Every audit you book shows up here with its Meet link and presentation.</p>'}</div>

      <div class="card w-4 wc-amber"><div class="card-head"><h2>Callbacks due</h2><span class="badge ${d.due.length ? 'warn' : 'gray'}">${d.due.length}</span></div>
        ${d.due.length ? `<ul class="list">${d.due.map((l) => `<li class="item" data-lead="${esc(l.id)}" style="cursor:pointer"><span class="badge ${l.next_action_at < Date.now() ? 'bad' : 'gray'}">${esc(l.next_action_at < Date.now() ? 'Now' : new Date(l.next_action_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</span>
          <div><div class="item-title">${esc(l.business)}</div><div class="item-sub">${esc(l.next_action || STAGE_LABEL[l.stage] || '')}</div></div>${l.grade ? `<span class="badge gray">${esc(l.grade)}</span>` : ''}</li>`).join('')}</ul>`
        : '<p class="muted">Nothing due today. The dialer brings callbacks back at the right time automatically.</p>'}</div>
      ${admin ? '<div class="card w-4 wc-green" id="paysnap"><div class="card-head"><h2>Payments</h2></div><div class="skeleton" style="height:70px"></div></div><div class="card w-4 wc-violet" id="budsnap"><div class="card-head"><h2>Budget and costs</h2></div><div class="skeleton" style="height:120px"></div></div><div class="card w-4 wc-amber" id="balsnap"></div>' : ''}
      <div class="card w-4 wc-teal" id="floor"><div class="card-head"><h2>Team floor</h2><a class="btn btn-ghost btn-sm" href="#/agents">Agents</a></div><div class="skeleton" style="height:70px"></div></div>
      ${can(user, 'deliver') ? `<div class="card w-4 wc-green"><div class="card-head"><h2>Clients</h2><a class="btn btn-ghost btn-sm" href="#/clients">Open</a></div>
        <div class="cl-row">${ring(workPct, { size: 104, thick: 12, color: 'var(--c-green)', center: `${workPct}%`, sub: 'work done' })}<div class="cl-nums">${d.clients.mrr != null ? `<div><b class="mono">${fmt.money(d.clients.mrr)}</b><span>monthly revenue</span></div>` : ''}<div><b class="mono">${d.clients.active}</b><span>active clients</span></div><div><b class="mono">${d.orders.signed}</b><span>signed this month</span></div></div></div>
        <p class="small" style="margin-top:10px">${d.work.postsWaiting} post${d.work.postsWaiting === 1 ? '' : 's'} waiting to go out. ${d.orders.sent} agreement${d.orders.sent === 1 ? '' : 's'} out, ${d.orders.paid} paid.</p>
        <div class="row" style="margin-top:6px">${d.clients.sample ? `<a class="btn btn-ghost btn-sm" href="#/clients/view/${esc(d.clients.sample)}">${icon.device}See the sample client app</a>` : `<button class="btn btn-ghost btn-sm" id="mk-sample">${icon.device}Create a sample client</button>`}<a class="btn btn-ghost btn-sm" href="#/phone/texts">${icon.msg}${d.unread} unread</a></div></div>` : ''}
      <div class="card w-12 wc-blue"><div class="card-head"><h2>Recent activity</h2></div>
        ${d.recent.length ? `<ul class="feed">${d.recent.map((a) => `<li><span class="dot ${ACT_TONE[a.type] || 'k-text'}">${a.type === 'call' ? icon.phone : a.type === 'sms' ? icon.msg : icon.note}</span>
          <div><div>${esc(ACT[a.type] || 'Update')}${a.outcome ? `: ${esc(a.outcome.replace(/_/g, ' '))}` : ''}${a.business ? ` · ${esc(a.business)}` : ''}</div>${a.body ? `<div class="small">${esc(String(a.body).slice(0, 90))}</div>` : ''}</div><span class="small">${esc(fmt.ago(a.at))}</span></li>`).join('')}</ul>`
        : '<p class="muted">Calls, texts, and updates from the last 7 days show up here.</p>'}</div>
    </div>`;
  animateNumbers(view);
  wireAvatars(view);
  $('#hgoal', view)?.addEventListener('click', (e) => editGoal(e.currentTarget, DIAL_TARGET, () => homePage(app, user)));
  api('/api/agents').then((r) => {
    const box = $('#floor', view); if (!box) return;
    const st = (a) => ({ on_call: 'On a call', available: 'Available', break: 'Break', lunch: 'Lunch', training: 'Training', meeting: 'Meeting', admin: 'Admin work', maintenance: 'Hub maintenance', offline: 'Offline' })[a.status] || a.status;
    const tone = (a) => ({ on_call: 'live', available: 'good', break: 'warn', lunch: 'warn', offline: 'gray', maintenance: 'maint' })[a.status] || 'info';
    box.innerHTML = `<div class="card-head"><h2>Team floor</h2><a class="btn btn-ghost btn-sm" href="#/agents">Agents</a></div>
      <div style="display:grid;gap:10px">${r.agents.map((a) => `<div class="row" style="flex-wrap:nowrap;gap:10px">${miniAvatar(a)}<div style="flex:1;min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.name)}</b>
        <span class="small"><i class="dot ${tone(a)}" style="margin-right:6px"></i>${esc(a.call ? `with ${a.call.business || 'a lead'}` : st(a))}</span></div>${admin && a.call?.canJoin ? `<button type="button" class="btn btn-ghost btn-sm" data-listen="${esc(a.call.id)}" data-who="${esc(a.name)}">Listen</button>` : ''}<span class="badge gray mono">${a.today.dials} dials</span></div>`).join('')}</div>`;
    $$('[data-listen]', box).forEach((b) => b.addEventListener('click', async () => {
      const a = r.agents.find((x) => x.call?.id === b.dataset.listen);
      busy(b, true);
      try { const { joinCall } = await import('./phone.js'); await joinCall({ act: a.call.id, mode: 'listen', name: a.call.business, number: a.call.number, rep: a.name }); }
      catch (err) { toast(err.message, true); }
      busy(b, false);
    }));
  }).catch(() => $('#floor', view)?.remove());
  // The money widgets call Stripe, DataForSEO and Twilio, which are slow. The dashboard draws first, then these fill in one by one.
  if (admin) {
    const later = (ms, fn) => setTimeout(() => { if (document.body.contains(view) && $('#paysnap', view)) fn(); }, ms);
    later(2500, () => paymentsSnapshot($('#paysnap', view)));
    later(5500, () => import('./budget.js').then((m) => m.budgetCard($('#budsnap', view))));
    later(8500, () => import('./balances.js').then((m) => m.balancesCard($('#balsnap', view))));
  }
  $$('[data-lead]', view).forEach((li) => li.addEventListener('click', () => leadModal(li.dataset.lead, () => homePage(app, user))));
  $('#mk-sample', view)?.addEventListener('click', async (e) => {
    busy(e.currentTarget, true, 'Creating...');
    try { const r = await api('/api/sample-client', { method: 'POST' }); location.hash = `#/clients/view/${r.id}`; } catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
  });
  googlePrompt($('#gprompt', view), user);
}

// Everyone on the team connects their own Google (their calendar, Gmail and Drive in the Hub, for their own use). Asked until they do or say later.
async function googlePrompt(box, user) {
  const key = `rw-gprompt-${user.id}`;
  try { if (Number(localStorage.getItem(key) || 0) > Date.now()) return; } catch { /* ignore */ }
  let g;
  try { g = await api('/api/google/status'); } catch { return; }
  if (!g.ready || (g.connected && g.apps?.includes('calendar'))) return;
  const again = g.connected; // signed in before the Hub asked for full Calendar access
  box.innerHTML = `<div class="card gprompt"><div class="row" style="gap:14px;align-items:center;flex-wrap:wrap">
      <div style="flex:1 1 280px"><b>${again ? 'Sign in to Google once more' : 'Connect your own Google'}</b><div class="small muted">${again ? 'The Hub needs one more Calendar permission. Takes 20 seconds.' : 'Your calendar, Gmail and Drive inside the Hub, and invites for your calls sent from your own calendar. It is yours only: nobody else on the team can read it.'}</div></div>
      <a class="btn btn-primary btn-sm" href="/api/google/connect?back=google&apps=mail,drive,docs,sheets">${again ? 'Sign in again' : 'Connect my Google'}</a>
      <button class="btn btn-ghost btn-sm" type="button" id="glater">Later</button></div></div>`;
  $('#glater', box).addEventListener('click', () => { try { localStorage.setItem(key, String(Date.now() + 3 * 864e5)); } catch { /* ignore */ } box.innerHTML = ''; });
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
