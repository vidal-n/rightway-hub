// Agents: everyone on the team (owners too) with their status, whether they are in the Hub, the call they are on (owners can listen,
// whisper or barge), and today's numbers. Analytics: call time, handle time, call lengths, dispositions and lead quality.
import { $, $$, esc, api, toast, busy, icon } from './core.js';
import { staffShell, initials } from './shell.js';
import { setMyStatus, onStatus } from './shell.js';
import { joinCall, onPhoneState, phoneState, pretty } from './phone.js';
import { STATUSES, statusLabel, statusTone, statusesFor, clock, pct } from '/js/callstats.js';
import { lineChart, barChart, legend } from '/js/charts.js';
import { avatarUrl } from './avatar.js';

const TONE_COLOR = { good: '#23B07E', warn: '#E8A33D', info: '#4E7FD8', gray: '#9AA8A2', live: '#D64545', maint: '#8B5CF6' };
const stColor = (k) => TONE_COLOR[statusTone(k)] || '#9AA8A2';
const tabs = (active) => `<nav class="tabs"><a href="#/agents" class="${active === 'board' ? 'is-active' : ''}">Agents</a><a href="#/agents/analytics" class="${active === 'analytics' ? 'is-active' : ''}">Call analytics</a><a href="#/agents/sheet" class="${active === 'sheet' ? 'is-active' : ''}">Master sheet</a></nav>`;
// Only touch the page when something changed, so refreshes never flash.
const setHtml = (el, html) => { if (!el || el.__h === html) return false; el.innerHTML = html; el.__h = html; return true; };
const ago = (t) => { if (!t) return ''; const m = Math.floor((Date.now() - t) / 60e3); return m < 1 ? 'just now' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; };

export async function agentsPage(app, user, sub) {
  if (sub === 'analytics') return analyticsPage(app, user);
  if (sub === 'sheet') return masterSheet(app, user);
  const view = staffShell(app, user, 'agents');
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Team floor</p><h1>Agents</h1></div>
      <div class="seg" id="mine" aria-label="Your status">${statusesFor(user).map(([k, l]) => `<button type="button" data-st="${k}">${esc(l)}</button>`).join('')}</div></div>
    ${tabs('board')}
    <div class="stats" id="agtot"></div>
    <div class="legend" style="margin:-6px 0 14px">${[['on_call', 'On a call'], ...STATUSES.map(([k, l]) => [k, l])].map(([k, l]) => `<span><i class="dot ${statusTone(k)}"></i>${esc(l)}</span>`).join('')}
      ${user.role === 'admin' ? '<span style="display:inline"><b>Listen</b>: nobody hears you · <b>Whisper</b>: only the agent hears you · <b>Barge</b>: everyone hears you</span>' : ''}</div>
    <div class="ag-grid" id="ags"><div class="skeleton"></div></div>`;
  const paintMine = (s) => $$('#mine [data-st]', view).forEach((b) => b.classList.toggle('is-on', b.dataset.st === s.status));
  const offS = onStatus(paintMine);
  $$('#mine [data-st]', view).forEach((b) => b.addEventListener('click', async () => { try { await setMyStatus(b.dataset.st); draw(); } catch (e) { toast(e.message, true); } }));
  let timer = null, d = null;
  const draw = async () => {
    if (!document.body.contains(view)) { clearInterval(timer); offS(); return; }
    try { d = await api('/api/agents'); } catch (e) { $('#ags', view).innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
    const meRow = d.agents.find((a) => a.id === d.me);
    if (meRow) paintMine({ status: meRow.picked });
    const online = d.agents.filter((a) => a.online).length, onCall = d.agents.filter((a) => a.status === 'on_call').length, avail = d.agents.filter((a) => a.status === 'available').length;
    setHtml($('#agtot', view), `
      <div class="stat"><div class="stat-num">${online}<span class="muted" style="font-size:18px">/${d.agents.length}</span></div><div class="stat-label">in the Hub now</div></div>
      <div class="stat"><div class="stat-num">${onCall}</div><div class="stat-label">on a call</div></div>
      <div class="stat"><div class="stat-num">${avail}</div><div class="stat-label">available</div></div>
      <div class="stat"><div class="stat-num">${d.team.dials}</div><div class="stat-label">dials today, ${d.team.connects} contacts, ${d.team.booked} booked</div></div>
      <div class="stat"><div class="stat-num">${clock(d.team.talk)}</div><div class="stat-label">talk time today</div></div>`);
    const busyPhone = phoneState().onCall;
    const changed = setHtml($('#ags', view), d.agents.map((a) => {
      const tone = statusTone(a.status);
      const per = a.today.per || {};
      const tot = Object.values(per).reduce((s, v) => s + v, 0) || 1;
      const c = a.call;
      const talking = c && c.status === 'in-progress';
      return `<article class="ag" data-tone="${tone}">
        <div class="ag-top"><div class="ag-av">${esc(initials(a))}${a.avatar ? `<img class="pimg" src="${avatarUrl(a.id, a.avatar)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<i class="dot ${tone}"></i></div>
          <div style="min-width:0;flex:1"><div class="ag-name">${esc(a.name)}${a.id === d.me ? ' <span class="badge gray">You</span>' : ''}</div>
            <div class="ag-st">${esc(statusLabel(a.status))}${a.status !== 'offline' && a.since ? ` · ${ago(a.since)}` : a.lastSeen ? ` · seen ${ago(a.lastSeen)} ago` : ''} · ${a.role === 'admin' ? 'Owner' : 'Team'}</div></div></div>
        ${c ? `<div class="ag-call"><div><b>${esc(c.business || pretty(c.number) || 'Dialing')}</b> <span class="small">${talking ? `talking ${clock((Date.now() - (c.answeredAt || c.at)) / 1000)}` : 'ringing'}${c.monitoredBy ? ` · ${c.mine ? `you are ${c.mode === 'barge' ? 'on the call' : `${c.mode}ing`}` : 'an owner is listening'}` : ''}</span></div>
          ${d.canMonitor && c.canJoin ? `<div class="row" style="gap:6px">${['listen', 'whisper', 'barge'].map((m) => `<button type="button" class="btn btn-ghost btn-sm${c.mine && c.mode === m ? ' is-on' : ''}" data-mon="${esc(c.id)}" data-mode="${m}" data-agent="${esc(a.name)}"${!c.mine && busyPhone ? ' disabled' : ''}>${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}
            ${c.leadId ? `<a class="btn btn-ghost btn-sm" href="#/pipeline/${esc(c.leadId)}">Lead</a>` : ''}</div>` : ''}</div>` : ''}
        <div class="ag-nums"><div><b>${clock(a.today.login)}</b><span>logged in</span></div><div><b>${a.today.dials}</b><span>dials</span></div>
          <div><b>${clock(a.today.talk)}</b><span>talk</span></div><div><b>${clock(a.today.avgHandle)}</b><span>avg handle</span></div></div>
        <div class="ag-bar" title="Today by status">${Object.entries(per).map(([k, v]) => `<i style="width:${(100 * v) / tot}%;background:${stColor(k)}" title="${esc(statusLabel(k))}: ${clock(v)}"></i>`).join('')}</div>
        <div class="small muted">${Object.entries(per).map(([k, v]) => `${esc(statusLabel(k))} ${clock(v)}`).join(' · ') || 'No time logged today'}${a.today.connects ? ` · ${a.today.connects} contacts, ${a.today.booked} booked` : ''}</div>
      </article>`;
    }).join('') || '<div class="card empty"><h3>No teammates yet</h3><p>Invite your team from Settings, Agents.</p></div>');
    if (!changed) return;
    $$('[data-mon]', view).forEach((b) => b.addEventListener('click', async () => {
      const a = d.agents.find((x) => x.call?.id === b.dataset.mon);
      busy(b, true);
      try {
        if (a.call.mine) await api(`/api/voice/monitor/${a.call.id}`, { method: 'POST', body: { mode: b.dataset.mode } });
        else await joinCall({ act: a.call.id, mode: b.dataset.mode, name: a.call.business, number: a.call.number, rep: a.name });
        setTimeout(draw, 800);
      } catch (e) { toast(e.message, true); busy(b, false); }
    }));
  };
  draw();
  timer = setInterval(draw, 5000);
  const off = onPhoneState(() => { if (!document.body.contains(view)) { off(); return; } draw(); });
}

// ---------- analytics ----------
async function analyticsPage(app, user) {
  const view = staffShell(app, user, 'agents');
  let days = 7, rep = '';
  try { const saved = JSON.parse(localStorage.getItem('rw-ana') || '{}'); days = saved.days || 7; } catch { /* ignore */ }
  const load = async () => {
    view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Data</p><h1>Call analytics</h1></div><div class="row" id="anactl"></div></div>${tabs('analytics')}<div class="skeleton"></div>`;
    let d;
    try { d = await api(`/api/analytics/calls?days=${days}${rep ? `&rep=${encodeURIComponent(rep)}` : ''}`); }
    catch (e) { view.querySelector('.skeleton').outerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
    const T = d.total;
    const max = (arr, k) => Math.max(1, ...arr.map((x) => x[k] || 0));
    const qual = (rows, title, note) => `<div class="card"><div class="card-head"><h3>${esc(title)}</h3><span class="small muted">${esc(note || '')}</span></div>
      ${rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th class="n">Dials</th><th class="n">Contact</th><th class="n">Booked</th><th class="n">Book rate</th><th class="n">Avg talk</th></tr></thead><tbody>
      ${rows.slice(0, 12).map((r) => `<tr><td>${esc(String(r.label).replace(/_/g, ' '))}</td><td class="n">${r.dials}</td><td class="n">${pct(r.connectRate)}</td><td class="n">${r.booked}</td><td class="n">${pct(r.bookRate)}</td><td class="n">${clock(r.avgTalk)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">No calls in this range.</p>'}</div>`;
    const bucketMax = max(d.buckets, 'calls');
    const dispoMax = max(d.dispos, 'n');
    const hourMax = Math.max(0.01, ...d.hours.map((h) => h.connectRate));
    view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Data</p><h1>Call analytics</h1></div>
        <div class="row"><div class="seg" id="rng">${[[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '90 days']].map(([v, l]) => `<button type="button" data-d="${v}" class="${v === days ? 'is-on' : ''}">${l}</button>`).join('')}</div>
        ${user.role === 'admin' ? `<select id="rep" style="width:auto;min-height:38px"><option value="">Everyone</option>${d.users.map((u) => `<option value="${esc(u.id)}"${u.id === rep ? ' selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}</select>` : ''}</div></div>
      ${tabs('analytics')}
      <div class="stats">
        <div class="stat"><div class="stat-num">${T.dials}</div><div class="stat-label">dials</div></div>
        <div class="stat"><div class="stat-num">${T.connects}</div><div class="stat-label">contacts (${pct(T.connectRate)} of dials)</div></div>
        <div class="stat"><div class="stat-num">${T.decision}</div><div class="stat-label">decision maker conversations</div></div>
        <div class="stat"><div class="stat-num">${T.booked}</div><div class="stat-label">booked (${pct(T.bookRate)} of contacts)</div></div>
        <div class="stat"><div class="stat-num">${clock(T.talk)}</div><div class="stat-label">talk time, avg ${clock(T.avgTalk)} per contact</div></div>
        <div class="stat"><div class="stat-num">${clock(T.avgHandle)}</div><div class="stat-label">average handle time (dial to disposition)</div></div>
      </div>
      <div class="ana-grid" style="margin-bottom:14px">
        <div class="card"><div class="card-head"><h3>Day by day</h3><span class="small muted">Dials, contacts and booked</span></div>
          ${(() => { const S = [{ name: 'Dials', color: '#0A6B4C', values: d.daily.map((x) => x.dials) }, { name: 'Contacts', color: '#23B07E', values: d.daily.map((x) => x.contacts) }, { name: 'Booked', color: '#E8A33D', values: d.daily.map((x) => x.booked) }];
            const L = d.daily.map((x) => new Date(`${x.day}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }));
            return d.daily.length > 1 ? lineChart(L, S) + legend(S) : barChart(L, S) + legend(S); })()}</div>
        <div class="card"><div class="card-head"><h3>Conversion funnel</h3><span class="small muted">${d.newMrr ? `$${Math.round(d.newMrr).toLocaleString()} new monthly revenue` : 'From the first dial to paid'}</span></div>
          <div class="funnel">${d.funnel.map((f, i) => { const top = d.funnel[0].n || 1; const prev = i ? d.funnel[i - 1].n : null; return `<div class="funnel-row"><span>${esc(f.label)}</span><div><div class="funnel-bar" style="width:${Math.max(2, (100 * f.n) / top)}%">${f.n}</div></div><span class="n">${i ? `${prev ? pct(f.n / prev) : '0%'} of ${esc(d.funnel[i - 1].label.toLowerCase())}` : ''}</span></div>`; }).join('')}</div>
          <p class="small muted" style="margin:10px 0 0">${T.dials ? `It takes ${T.booked ? Math.round(T.dials / T.booked) : '?'} dials per booked audit${d.funnel[6].n ? ` and ${Math.round(T.dials / d.funnel[6].n)} dials per paying client` : ''} right now.` : 'Start dialing and this fills in.'}</p></div>
      </div>
      <div class="card"><div class="card-head"><h3>Agents</h3><span class="small muted">Login time counts while the Hub is open and the status is not Offline.</span></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Agent</th><th class="n">Logged in</th><th class="n">On break</th><th class="n">Dials</th><th class="n">Dials/hr</th><th class="n">Contacts</th><th class="n">Contact</th><th class="n">Booked</th><th class="n">Talk</th><th class="n">Avg talk</th><th class="n">Avg handle</th><th class="n">Longest</th></tr></thead><tbody>
        ${d.agents.map((a) => `<tr><td><b>${esc(a.label)}</b></td><td class="n">${clock(a.login || 0)}</td><td class="n">${clock((a.per?.break || 0) + (a.per?.lunch || 0))}</td><td class="n">${a.dials}</td><td class="n">${a.dialsPerHour ? a.dialsPerHour.toFixed(1) : '-'}</td><td class="n">${a.connects}</td><td class="n">${pct(a.connectRate)}</td><td class="n">${a.booked}</td><td class="n">${clock(a.talk)}</td><td class="n">${clock(a.avgTalk)}</td><td class="n">${clock(a.avgHandle)}</td><td class="n">${clock(a.longest)}</td></tr>`).join('') || '<tr><td colspan="12" class="small muted">No calls yet in this range.</td></tr>'}
        </tbody></table></div></div>
      <div class="ana-grid" style="margin-top:14px">
        <div class="card"><div class="card-head"><h3>Call length</h3><span class="small muted">Contacts only. Longer calls book more.</span></div>
          ${(() => { const S = [{ name: 'Calls', color: '#0A6B4C', values: d.buckets.map((b) => b.calls) }, { name: 'Booked', color: '#E8A33D', values: d.buckets.map((b) => b.booked) }]; return barChart(d.buckets.map((b) => b.label.replace(' to ', '-').replace(' and up', '+')), S, { h: 200 }) + legend(S); })()}
          ${d.buckets.map((b) => `<div class="hbar"><span>${esc(b.label)}</span><div class="track"><div class="fill" style="width:${(100 * b.calls) / bucketMax}%"></div></div><span class="n">${b.calls} · ${pct(b.bookRate)}</span></div>`).join('')}
          <p class="small muted" style="margin:8px 0 0">Count of calls, then the share that booked.</p></div>
        <div class="card"><div class="card-head"><h3>Dispositions</h3><span class="small muted">${T.dials} calls</span></div>
          ${d.dispos.map((x) => `<div class="hbar"><span>${esc(x.label)}</span><div class="track"><div class="fill b2" style="width:${(100 * x.n) / dispoMax}%"></div></div><span class="n">${x.n} · ${pct(x.share)}</span></div>`).join('') || '<p class="small muted">No calls yet.</p>'}</div>
        <div class="card"><div class="card-head"><h3>Best hours to call</h3><span class="small muted">Contact rate by hour (New York time)</span></div>
          ${d.hours.map((h) => `<div class="hbar"><span>${((h.hour + 11) % 12) + 1}${h.hour < 12 ? 'am' : 'pm'}</span><div class="track"><div class="fill" style="width:${(100 * h.connectRate) / hourMax}%"></div></div><span class="n">${pct(h.connectRate)} of ${h.dials}</span></div>`).join('') || '<p class="small muted">No calls yet.</p>'}</div>
      </div>
      <h2 style="margin:26px 0 12px">Lead quality</h2>
      <div class="ana-grid">
        ${qual(d.grades, 'By lead grade', 'Is the scoring right? A should beat C.')}
        ${qual(d.sources, 'By lead source', 'Which lists are worth buying again')}
        ${qual(d.industries, 'By industry')}
        ${qual(d.zones, 'By time zone')}
      </div>
      <div class="card" style="margin-top:14px"><div class="card-head"><h3>Lead inventory</h3><span class="small muted">What is left to call, by source and grade</span></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Source</th><th>Grade</th><th class="n">Leads</th><th class="n">Never called</th><th class="n">Booked now</th><th class="n">Closed out</th><th class="n">Avg score</th></tr></thead><tbody>
        ${d.inventory.map((r) => `<tr><td>${esc(r.source)}</td><td>${esc(r.grade)}</td><td class="n">${r.total}</td><td class="n"><b>${r.fresh || 0}</b></td><td class="n">${r.booked || 0}</td><td class="n">${r.done || 0}</td><td class="n">${r.score ?? '-'}</td></tr>`).join('') || '<tr><td colspan="7" class="small muted">No leads yet. Import a CSV from the Pipeline.</td></tr>'}
        </tbody></table></div></div>`;
    $$('#rng [data-d]', view).forEach((b) => b.addEventListener('click', () => { days = Number(b.dataset.d); try { localStorage.setItem('rw-ana', JSON.stringify({ days })); } catch { /* ignore */ } load(); }));
    $('#rep', view)?.addEventListener('change', (e) => { rep = e.target.value; load(); });
  };
  load();
}
export const _icon = icon;

// ---------- master sheet ----------
const COLS = [
  ['business', 'Business'], ['contact_name', 'Contact'], ['phone', 'Phone'], ['email', 'Email'], ['city', 'City'], ['state', 'State'], ['industry', 'Industry'], ['source', 'Source'],
  ['stage', 'Stage'], ['grade', 'Grade'], ['score', 'Score'], ['rating', 'Rating'], ['reviews', 'Reviews'], ['map_rank', 'Map rank'], ['problems', 'Problems'],
  ['dials', 'Dials'], ['contacts', 'Contacts'], ['talk', 'Talk'], ['last_dispo', 'Last result'], ['last_call_at', 'Last call'], ['next_action_at', 'Next call'],
  ['meet_at', 'Audit'], ['booked_by', 'Booked by'], ['owner', 'Owner'], ['monthly', 'Monthly'], ['setup', 'Buildout'], ['scrub', 'Scrubbed'], ['website', 'Website'], ['created_at', 'Added'],
];
const fmtCell = (k, v) => (v == null || v === '' ? '' : ['last_call_at', 'next_action_at', 'meet_at', 'created_at'].includes(k) ? new Date(v).toLocaleDateString([], { month: 'short', day: 'numeric' }) : k === 'talk' ? clock(v) : ['monthly', 'setup'].includes(k) ? `$${v}` : k === 'stage' ? String(v).replace(/_/g, ' ') : String(v));
async function masterSheet(app, user) {
  const view = staffShell(app, user, 'agents');
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Data</p><h1>Master sheet</h1></div><div class="row"><button class="btn btn-ghost" id="mcsv">${icon.down || ''}Download CSV</button><a class="btn btn-ghost" href="#/google">Send to Google Sheets</a></div></div>${tabs('sheet')}<div class="skeleton"></div>`;
  let d;
  try { d = await api('/api/analytics/master'); } catch (e) { view.querySelector('.skeleton').outerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  let q = '', sort = 'score', dir = -1, grade = '', stage = '';
  const stages = [...new Set(d.rows.map((r) => r.stage))].sort();
  const rowsNow = () => d.rows.filter((r) => (!grade || (r.grade || 'none') === grade) && (!stage || r.stage === stage) && (!q || COLS.some(([k]) => String(r[k] ?? '').toLowerCase().includes(q))))
    .sort((a, b) => { const x = a[sort], y = b[sort]; return (x == null) - (y == null) || (typeof x === 'number' && typeof y === 'number' ? (x - y) * dir : String(x ?? '').localeCompare(String(y ?? '')) * dir); });
  const draw = () => {
    const rows = rowsNow();
    const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    $('#msum', view).innerHTML = `<b>${rows.length}</b> leads · ${sum('dials')} dials · ${sum('contacts')} contacts · ${rows.filter((r) => r.meet_at).length} with an audit · ${rows.filter((r) => r.stage === 'won').length} won · ${rows.filter((r) => !r.researched).length} not researched yet`;
    $('#mtbl', view).innerHTML = `<table class="tbl sheet"><thead><tr>${COLS.map(([k, n]) => `<th data-k="${k}" class="${['score', 'rating', 'reviews', 'map_rank', 'problems', 'dials', 'contacts', 'talk', 'monthly', 'setup'].includes(k) ? 'n' : ''}" style="cursor:pointer">${esc(n)}${sort === k ? (dir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.slice(0, 600).map((r) => `<tr>${COLS.map(([k]) => `<td class="${['score', 'rating', 'reviews', 'map_rank', 'problems', 'dials', 'contacts', 'talk', 'monthly', 'setup'].includes(k) ? 'n' : ''}">${k === 'business' ? `<a href="#/pipeline/${esc(r.id)}">${esc(r.business)}</a>` : esc(fmtCell(k, r[k]))}</td>`).join('')}</tr>`).join('')}</tbody></table>
      ${rows.length > 600 ? `<p class="small muted">Showing 600 of ${rows.length}. Download the CSV for all of them.</p>` : ''}`;
    $$('#mtbl th', view).forEach((th) => th.addEventListener('click', () => { if (sort === th.dataset.k) dir = -dir; else { sort = th.dataset.k; dir = -1; } draw(); }));
  };
  view.querySelector('.skeleton').outerHTML = `<div class="row" style="margin-bottom:12px"><input id="mq" placeholder="Filter anything: name, city, source, result" style="max-width:340px">
      <select id="mg" style="width:auto"><option value="">All grades</option>${['A', 'B', 'C', 'D', 'none'].map((g) => `<option value="${g}">${g === 'none' ? 'Not graded' : `Grade ${g}`}</option>`).join('')}</select>
      <select id="ms" style="width:auto"><option value="">All stages</option>${stages.map((x) => `<option value="${esc(x)}">${esc(String(x).replace(/_/g, ' '))}</option>`).join('')}</select><span class="small" id="msum"></span></div>
    <div class="card" style="padding:0"><div class="tbl-wrap" id="mtbl" style="max-height:70vh"></div></div>`;
  $('#mq', view).addEventListener('input', (e) => { q = e.target.value.toLowerCase(); draw(); });
  $('#mg', view).addEventListener('change', (e) => { grade = e.target.value; draw(); });
  $('#ms', view).addEventListener('change', (e) => { stage = e.target.value; draw(); });
  $('#mcsv', view).addEventListener('click', () => {
    const cell = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const csv = [COLS.map(([, n]) => n).join(','), ...rowsNow().map((r) => COLS.map(([k]) => cell(fmtCell(k, r[k]))).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `rightway-master-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  });
  draw();
}
