// Pipeline, Call insights tab: every outbound call, cut by who picked up, the lead's own hour and weekday, attempt number, phone type, trade,
// review count, grade, source and rep. Modeled on the analytics in Orum, Nooks, Gong and Close: raw counts with the denominator shown next to every rate,
// a 60 second owner conversation flag (Orum), fast hang ups (Orum: under 5% of connects), and objections in Gong's three groups.
// Benchmarks are B2B office calling (no vendor publishes local business numbers); our own numbers are the ones that count.
import { $, $$, esc, api, toast, fmt } from './core.js';
import { staffShell, pipeTabs } from './staff.js';
import { donut, lineChart } from '../js/charts.js';
import { bestHours, answeredLabel, objectionLabel, filterCount, cleanFilter } from '../js/leaddb.js';

const COLORS = { owner: 'var(--c-green)', staff: 'var(--c-teal)', service: 'var(--c-blue)', wrong: 'var(--c-coral)', someone: 'var(--c-violet)', menu: 'var(--c-amber)', voicemail: 'var(--c-slate)', screening: 'var(--c-pink)', none: '#B8C4BE', dead: '#7A1F1F' };
const pc = (v) => `${Math.round((v || 0) * 1000) / 10}%`;
const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round((s || 0) % 60)).padStart(2, '0')}`;
const of = (n, d) => `<span class="small muted">${fmt.int(n)} of ${fmt.int(d)}</span>`;

// Horizontal bars, readable on a phone. rows: [{label, value (0..1), sub}]
const bars = (rows, { tone = 'green' } = {}) => {
  const max = Math.max(0.0001, ...rows.map((r) => r.value));
  return `<div class="ib">${rows.map((r) => `<div class="ib-row"><span class="ib-l">${esc(r.label)}</span><span class="ib-t"><i class="tone-${tone}" style="width:${Math.max(1, (100 * r.value) / max)}%"></i></span><b class="mono">${esc(r.text ?? pc(r.value))}</b>${r.sub ? `<span class="ib-s">${r.sub}</span>` : ''}</div>`).join('')}</div>`;
};
const segTable = (list, keyLabel, { label = (k) => k } = {}) => (list.length ? `<div class="table-wrap"><table class="small ib-table"><thead><tr><th>${esc(keyLabel)}</th><th>Dials</th><th>Pickup</th><th>Owner</th><th>Menu</th><th>Talks 60s+</th><th>Booked</th><th>Avg talk</th></tr></thead><tbody>
  ${list.map((s) => `<tr><td><b>${esc(label(s.key, s))}</b></td><td class="mono">${fmt.int(s.dials)}</td><td class="mono">${pc(s.pickup)}</td><td class="mono">${pc(s.ownerRate)}</td><td class="mono">${pc(s.menuRate)}</td><td class="mono">${fmt.int(s.conv)}</td><td class="mono">${fmt.int(s.booked)}</td><td class="mono">${mmss(s.avgTalk)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Not enough calls yet.</p>');

export async function insightsPage(app, user) {
  const view = staffShell(app, user, 'pipeline');
  const owner = user.role === 'admin';
  let days = 90, rep = '', useDb = false;
  try { const s = JSON.parse(localStorage.getItem('rw-ins') || '{}'); days = s.days || 90; useDb = Boolean(s.useDb); } catch { /* ignore */ }
  let dbf = {};
  try { dbf = cleanFilter(JSON.parse(localStorage.getItem('rw-db-state') || '{}').f || {}); } catch { dbf = {}; }
  const draw = async () => {
    try { localStorage.setItem('rw-ins', JSON.stringify({ days, useDb })); } catch { /* ignore */ }
    view.innerHTML = `<div class="page-head"><div><p class="eyebrow">CRM</p><h1>Call insights</h1></div></div>${pipeTabs('insights')}<div class="skeleton"></div>`;
    let d;
    const f = useDb && filterCount(dbf) ? `&f=${encodeURIComponent(JSON.stringify(dbf))}` : '';
    try { d = await api(`/api/leaddb/insights?days=${days}${rep ? `&rep=${rep}` : ''}${f}`); } catch (e) { $('.skeleton', view).outerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
    const T = d.total;
    const best = bestHours(d.byHour, 10);
    const tile = (n, label, sub, bench = '') => `<div class="ins-tile"><b class="mono">${n}</b><span>${label}</span>${sub}${bench ? `<i class="small muted">${bench}</i>` : ''}</div>`;
    const answeredTotal = d.answered.reduce((a, x) => a + x.n, 0);
    view.innerHTML = `
      <div class="page-head"><div><p class="eyebrow">CRM</p><h1>Call insights</h1><p class="small muted" style="margin:4px 0 0">Every outbound call ${days === 365 ? 'this year' : `in the last ${days} days`}${d.capped ? ' (the newest 20,000)' : ''}. Hours and days are in each business's own time zone.</p></div>
        <div class="row ins-ctl" style="gap:8px;flex-wrap:wrap">
          <select id="insdays">${[[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months']].map(([v, n]) => `<option value="${v}"${v === days ? ' selected' : ''}>${n}</option>`).join('')}</select>
          ${owner ? `<select id="insrep"><option value="">Everyone</option>${d.users.map((u) => `<option value="${esc(u.id)}"${u.id === rep ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}
          ${filterCount(dbf) ? `<label class="row small" style="gap:6px"><input type="checkbox" id="insdb"${useDb ? ' checked' : ''}> Only the Lead database search (${filterCount(dbf)} filter${filterCount(dbf) === 1 ? '' : 's'})</label>` : ''}
        </div></div>
      ${pipeTabs('insights')}
      ${!T.dials ? '<div class="card"><p class="muted">No calls in this window yet. Dial a list and come back: every result you save fills this page.</p></div>' : `
      <div class="ins-tiles">
        ${tile(fmt.int(T.dials), 'Dials', `<span class="small muted">${fmt.int(T.businesses)} businesses</span>`)}
        ${tile(pc(T.pickup), 'A person picked up', of(T.human, T.dials), 'Gong average 5.4%, top reps 13.3%')}
        ${tile(pc(T.ownerRate), 'Reached the owner', of(T.owner, T.dials), 'No public benchmark: ours to learn')}
        ${tile(pc(T.convRate), 'Owner talks over 60s', of(T.conv, T.owner), 'Orum: about 41% of connects')}
        ${tile(pc(T.setRate), 'Audits per talk', of(T.booked, T.conv), 'Orum 12%, Belkins 4.6%')}
        ${tile(T.dialsPerBooked ? fmt.int(T.dialsPerBooked) : '-', 'Dials per audit', `<span class="small muted">${fmt.int(T.booked)} booked</span>`, 'Belkins about 370')}
        ${tile(pc(T.fastRate), 'Hung up in 10s', of(T.fast, T.human), 'Orum: keep under 5%')}
        ${tile(pc(T.menuRate), 'Phone menus', of(T.menu, T.dials))}
        ${tile(pc(T.bizReach), 'Businesses reached', of(T.reachedBiz, T.businesses), 'Belkins 24.5% after about 3 tries')}
        ${tile(pc(T.fillRate), 'Calls with a result', of(T.logged, T.dials), 'Aim for 100%')}
        ${tile(d.triesToOwner ?? '-', 'Dials to reach an owner', '<span class="small muted">average, when reached</span>')}
        ${tile(mmss(T.avgTalk), 'Average talk', '<span class="small muted">per person reached</span>')}
      </div>
      <div class="ins-grid two">
        <div class="card"><div class="card-head"><h2>Call funnel</h2><span class="small muted">every outbound call</span></div>${funnel(T)}
          <p class="small muted">Each bar is a share of dials; the percent on the right is the step from the one above. The biggest drop is the step to coach.</p></div>
        <div class="card"><div class="card-head"><h2>When owners answer</h2><span class="small muted">their time</span></div>${heat(d.heat)}
          <div class="heat-key">Owner reached per dial <b></b> more</div><p class="small muted">Striped squares had no dials. Fill your power dial blocks where the squares are darkest; squares with under 10 dials are guesses.</p></div>
      </div>
      <div class="card"><div class="card-head"><h2>How many tries pay off</h2><span class="small muted">share of businesses reached by each try</span></div>
        <div class="curve">${curve(d.attemptCurve)}</div>
        <p class="small muted">Green: a person answered by that try. Blue: the owner answered. When the lines go flat, more calls to the same number stop paying; Florida caps it at 3 calls in 24 hours anyway.</p></div>
      <div class="ins-grid">
        <div class="card"><div class="card-head"><h2>Who picks up</h2></div>
          <div class="ins-donut">${donut(d.answered.map((a) => ({ label: a.label, value: a.n, color: COLORS[a.key] || 'var(--c-slate)' })), { center: fmt.int(answeredTotal), sub: 'dials' })}
          <ul class="ins-legend">${d.answered.map((a) => `<li><i style="background:${COLORS[a.key] || 'var(--c-slate)'}"></i>${esc(a.label)}<b class="mono">${fmt.int(a.n)}</b><span class="small muted">${pc(a.n / Math.max(1, answeredTotal))}</span></li>`).join('')}</ul></div></div>
        <div class="card"><div class="card-head"><h2>Best hours, their time</h2></div>
          ${best.length ? `<p class="small">Owners picked up most at <b>${best.map((h) => `${h.key % 12 || 12}${h.key < 12 ? 'am' : 'pm'}`).join(', ')}</b>.</p>` : '<p class="small muted">Needs 10 dials in an hour before it ranks hours.</p>'}
          ${bars(d.byHour.map((h) => ({ label: `${h.key % 12 || 12}${h.key < 12 ? 'am' : 'pm'}`, value: h.ownerRate, text: h.dials ? pc(h.ownerRate) : '-', sub: h.dials ? `${pc(h.pickup)} pickup, ${fmt.int(h.dials)} dials` : '' })))}
          <p class="small muted">Bar: owner reached per dial. Research says pickups peak about 10 to 11am, results in the late afternoon (Orum, Cognism, Belkins).</p></div>
        <div class="card"><div class="card-head"><h2>Days of the week</h2></div>
          ${bars(d.byDay.map((h) => ({ label: h.key, value: h.ownerRate, text: h.dials ? pc(h.ownerRate) : '-', sub: h.dials ? `${pc(h.pickup)} pickup, ${fmt.int(h.dials)} dials` : '' })))}</div>
        <div class="card"><div class="card-head"><h2>By attempt</h2></div>
          ${bars(d.byAttempt.map((h) => ({ label: h.key >= 8 ? '8th+' : `${h.key}${['st', 'nd', 'rd'][h.key - 1] || 'th'} call`, value: h.pickup, sub: `${pc(h.ownerRate)} owner, ${fmt.int(h.dials)} dials` })), { tone: 'blue' })}
          <p class="small muted">Pickup on each try. Shows when to stop calling a number.</p></div>
        <div class="card"><div class="card-head"><h2>Phone type</h2></div>
          ${bars(d.byPhoneType.map((h) => ({ label: { mobile: 'Mobile', landline: 'Landline', voip: 'Internet phone', toll_free: 'Toll free' }[h.key] || h.key, value: h.ownerRate, sub: `${pc(h.pickup)} pickup, ${fmt.int(h.dials)} dials` })))}
          <p class="small muted">Nooks found mobiles connect 45% more often. Check phone types in Fill in missing info.</p></div>
        <div class="card"><div class="card-head"><h2>Google reviews</h2></div>
          ${bars(d.byReviews.map((h) => ({ label: h.key, value: h.ownerRate, sub: `${pc(h.menuRate)} menus, ${fmt.int(h.dials)} dials` })))}
          <p class="small muted">Bigger businesses tend to have staff and menus. This shows where owners still answer.</p></div>
        <div class="card"><div class="card-head"><h2>How long calls last</h2></div>
          ${bars(d.talk.map((b) => ({ label: b.label, value: b.calls, text: fmt.int(b.calls), sub: b.booked ? `${b.booked} booked` : '' })), { tone: 'violet' })}
          <p class="small muted">Calls with a person. Booked calls run about 4 to 6 minutes; misses end under 1 (Orum, Gong).</p></div>
        <div class="card"><div class="card-head"><h2>Objections</h2></div>
          ${d.objections.length ? `${bars(d.objectionGroups.map((g) => ({ label: g.label, value: g.n, text: fmt.int(g.n) })), { tone: 'amber' })}
            <p class="small muted">Gong across 300M calls: brush offs 49.5%, situation 42.6%, already has help 7.9%.</p>
            ${bars(d.objections.map((o) => ({ label: o.label, value: o.n, text: fmt.int(o.n), sub: pc(o.share) })), { tone: 'coral' })}` : '<p class="small muted">Pick the reason in the result window after a "Not interested" or "Hung up", and it shows here.</p>'}</div>
        <div class="card"><div class="card-head"><h2>Where calls ended</h2></div>
          ${d.hangupStages.length ? bars(d.hangupStages.map((o) => ({ label: o.label, value: o.n, text: fmt.int(o.n) })), { tone: 'coral' }) : '<p class="small muted">Pick where it ended in the result window after a hang up.</p>'}
          <p class="small muted">Right away: try another day. After the pitch or at price: a real no, give it time.</p></div>
      </div>
      <div class="ins-grid two">
        <div class="card"><div class="card-head"><h2>Shortest calls with a person</h2></div>${callList(d.shortest)}</div>
        <div class="card"><div class="card-head"><h2>Longest calls</h2></div>${callList(d.longest)}</div>
      </div>
      <div class="card"><div class="card-head"><h2>By trade</h2><span class="small muted">5 dials or more</span></div>${segTable(d.byIndustry, 'Trade')}</div>
      <div class="ins-grid two">
        <div class="card"><div class="card-head"><h2>By fit grade</h2></div>${segTable(d.byGrade, 'Grade')}</div>
        <div class="card"><div class="card-head"><h2>By lead source</h2></div>${segTable(d.bySource, 'Source')}</div>
        <div class="card"><div class="card-head"><h2>By state</h2></div>${segTable(d.byState, 'State')}</div>
        ${owner ? `<div class="card"><div class="card-head"><h2>By rep</h2></div>${segTable(d.byRep, 'Rep', { label: (k, s) => s.label || k })}</div>` : ''}
      </div>
      <div class="card"><div class="card-head"><h2>Results</h2></div>${bars(d.dispositions.slice(0, 20).map((x) => ({ label: x.label, value: x.n, text: fmt.int(x.n) })), { tone: 'slate' })}</div>
      <p class="small muted">Benchmarks come from B2B office calling (Gong, Orum, Belkins, Nooks). No vendor publishes local business numbers, so the numbers on this page are the real yardstick. Research: Lead database and call analytics report.</p>`}`;
    $('#insdays', view)?.addEventListener('change', (e) => { days = Number(e.target.value); draw(); });
    $('#insrep', view)?.addEventListener('change', (e) => { rep = e.target.value; draw(); });
    $('#insdb', view)?.addEventListener('change', (e) => { useDb = e.target.checked; draw(); });
    $$('[data-lead]', view).forEach((el) => el.addEventListener('click', () => import('./crm.js').then((m) => m.leadModal(el.dataset.lead, () => {}))));
  };
  const funnel = (T) => {
    const steps = [['Dials', T.dials], ['A person picked up', T.human], ['Reached the owner', T.owner], ['Owner talks over 60s', T.conv], ['Audits booked', T.booked]];
    return `<div class="funnel">${steps.map(([n, v], i) => {
      const w = T.dials ? Math.max(1.5, (100 * v) / T.dials) : 0;
      const step = i && steps[i - 1][1] ? `${Math.round((1000 * v) / steps[i - 1][1]) / 10}%` : '';
      return `<div class="fr"><span>${esc(n)}</span><span class="fb"><i style="width:${w}%"></i><em>${fmt.int(v)}</em></span><b>${step}</b></div>`;
    }).join('')}</div>`;
  };
  const heat = (rows = []) => {
    const max = Math.max(0.0001, ...rows.flatMap((r) => r.cells.filter((c) => c.dials >= 3).map((c) => c.ownerRate)));
    const hrs = rows[0]?.cells.map((c) => c.hour) || [];
    return `<div class="heat" style="--cols:${hrs.length}"><span></span>${hrs.map((h) => `<span>${h % 12 || 12}${h < 12 ? 'a' : 'p'}</span>`).join('')}
      ${rows.map((r) => `<span>${esc(r.day)}</span>${r.cells.map((c) => `<i class="${c.dials ? '' : 'none'}" style="--v:${c.dials ? Math.min(1, c.ownerRate / max) : 0}" title="${esc(`${r.day} ${c.hour % 12 || 12}${c.hour < 12 ? 'am' : 'pm'}: ${c.dials} dials, ${pc(c.pickup)} pickup, ${pc(c.ownerRate)} owner`)}"></i>`).join('')}`).join('')}</div>`;
  };
  const curve = (pts = []) => (pts.some((p) => p.businesses) ? lineChart(pts.map((p) => `Try ${p.attempt}`), [
    { name: 'Person reached', color: 'var(--c-green)', values: pts.map((p) => Math.round(p.human * 1000) / 10) },
    { name: 'Owner reached', color: 'var(--c-blue)', values: pts.map((p) => Math.round(p.owner * 1000) / 10) },
  ], { h: 200, area: true, fmt: (v) => `${v}%` }) : '<p class="small muted">Needs calls with try numbers. They fill in as results are saved.</p>');
  const callList = (list) => (list.length ? `<ul class="list ins-calls">${list.map((c) => `<li class="item" data-lead="${esc(c.lead_id || '')}"><span class="badge ${c.secs < 10 ? 'bad' : c.secs >= 60 ? 'ok' : 'gray'}">${mmss(c.secs)}</span>
      <div><div class="item-title">${esc(c.business || 'Unknown business')}</div><div class="item-sub">${esc(answeredLabel(c.by))} · ${esc(c.dispo)}${c.objection ? ` · ${esc(objectionLabel(c.objection))}` : ''} · ${esc(fmt.ago(c.at))}</div></div><span></span></li>`).join('')}</ul>` : '<p class="small muted">None yet.</p>');
  try { await draw(); } catch (e) { toast(e.message, true); }
}
