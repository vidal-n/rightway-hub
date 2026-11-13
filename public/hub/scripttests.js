// Script tests page (Nov 2026, V: track what converts the highest for each script and make adjustments). Pipeline tab "Script tests"
// (#/pipeline/scripts). Owners turn a split test on (the Hub picks the script per lead), everyone sees the funnel per script and a plain verdict.
// Modeled on Outreach's A/B test results (one winning metric, a significance gate) and Orum's script analytics. Server: src/scripttest.js.
import { $, $$, esc, api, toast, fmt } from './core.js';
import { staffShell, pipeTabs } from './staff.js';
import { scriptName, loadScriptTest } from './scriptpick.js';
import { MIN_CONVS, MIN_DAYS, DIAL_SCRIPTS } from '/js/scripttest.js';

const pct = (x) => `${Math.round((x || 0) * 1000) / 10}%`;
const TONE = { winner: 'ok', leaning: 'warn', collecting: 'gray', tie: 'gray', single: 'gray' };

export async function scriptTestsPage(app, user) {
  const view = staffShell(app, user, 'pipeline');
  const owner = user.role === 'admin';
  let mode = 'test', days = 90, versions = false;
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">CRM</p><h1>Script tests</h1><p class="muted small">Which cold call script books the most meetings. Every call is counted under the script the rep dialed with.</p></div></div>${pipeTabs('scripts')}<div id="st-body"><div class="skeleton"></div></div>`;
  const body = $('#st-body', view);

  async function draw() {
    let r, team = [];
    try {
      const q = new URLSearchParams({ days: String(days) });
      if (mode === 'test') q.set('test', '1');
      if (versions) q.set('versions', '1');
      [r, team] = await Promise.all([api(`/api/scripts/stats?${q}`), owner ? api('/api/team').then((t) => t.users || []).catch(() => []) : []]);
    } catch (e) { body.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
    const t = r.test || {};
    if (mode === 'test' && !t.started_at) mode = 'all';
    const v = r.verdict || {};
    const nameOfRep = (id) => (Array.isArray(team) ? team.find((u) => u.id === id)?.name : null) || 'Rep';
    const label = (s) => `${esc(scriptName(s.script))}${s.version ? ` <span class="muted small">v ${esc(s.version)}</span>` : ''}`;
    const best = Math.max(0.0001, ...r.stats.map((s) => s.range?.[1] || 0));
    body.innerHTML = `
      ${owner ? `<div class="card st-test"><div class="card-head"><h3>Split test</h3>${t.on ? `<span class="badge ok">Running since ${fmt.date(t.started_at)}</span>` : '<span class="badge gray">Off</span>'}</div>
        <p class="small muted">When it is on, the Hub picks the script for each lead (the same lead always gets the same one) and every rep dials every script, so rep skill and lead quality even out. Changing the scripts starts a new test.</p>
        <div class="row" style="flex-wrap:wrap;gap:8px">${DIAL_SCRIPTS.map((k) => `<label class="chip"><input type="checkbox" data-v="${k}"${t.variants?.includes(k) ? ' checked' : ''}> ${esc(scriptName(k))}</label>`).join('')}</div>
        <div class="row" style="margin-top:10px"><button class="btn btn-primary btn-sm" id="st-on">${t.on ? 'Save and restart the test' : 'Start the split test'}</button>${t.on ? '<button class="btn btn-ghost btn-sm" id="st-off">Stop the test</button>' : ''}</div></div>` : ''}
      <div class="card"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div class="seg">${t.started_at ? `<button type="button" data-mode="test" class="${mode === 'test' ? 'is-on' : ''}">This test</button>` : ''}<button type="button" data-mode="all" class="${mode === 'all' ? 'is-on' : ''}">All scripted calls</button></div>
        <div class="row" style="gap:8px">${mode === 'all' ? `<select id="st-days" style="width:auto">${[30, 90, 180, 365].map((d) => `<option value="${d}"${d === days ? ' selected' : ''}>Last ${d} days</option>`).join('')}</select>` : ''}
        <label class="small row" style="gap:6px"><input type="checkbox" id="st-ver"${versions ? ' checked' : ''}> Split by version</label></div></div>
        <div class="st-verdict tone-${TONE[v.state] || 'gray'}" data-metric="script_verdict"><b>${esc(v.text || '')}</b>${r.stats.length ? '' : ' <span class="muted">Pick a script in the dialer, or start a split test, and dial: results show up here.</span>'}
        <p class="small muted">The winner is picked on meetings booked per owner conversation. Each script needs ${MIN_CONVS} owner conversations and the test ${MIN_DAYS} days before the Hub names one: checking early picks false winners about a quarter of the time. ${r.need?.each && isFinite(r.need.each) ? `To tell ${pct(r.need.at)} from ${pct(r.need.to)} you need about ${r.need.each} conversations per script.` : ''}</p></div></div>
      ${r.stats.length ? `<div class="card"><div class="card-head"><h3 data-metric="script_book">Booked per owner conversation</h3></div>
        <div class="st-bars">${r.stats.map((s) => `<div class="st-bar"><div class="st-name">${label(s)}</div><div class="st-track"><span class="st-range" style="left:${(s.range[0] / best) * 100}%;width:${Math.max(1, ((s.range[1] - s.range[0]) / best) * 100)}%"></span><span class="st-dot" style="left:${(s.rates.book / best) * 100}%"></span></div><div class="st-val"><b>${pct(s.rates.book)}</b> <span class="muted small">${s.booked} of ${s.convs}, range ${pct(s.range[0])} to ${pct(s.range[1])}</span></div></div>`).join('')}</div>
        <p class="small muted">The dot is the rate so far, the bar is where the true rate likely sits (95%). Bars that overlap a lot mean no real difference yet.</p></div>
      <div class="card"><div class="card-head"><h3>The whole funnel</h3></div><div class="table-wrap"><table class="table st-table"><thead><tr><th>Script</th><th>Dials</th><th>Connects</th><th data-metric="script_conv">Owner talks</th><th>Booked</th><th>Booked per talk</th><th>Booked per 100 dials</th><th>Hung up under 10 s</th><th>Showed</th><th>Closed</th><th>Reps</th></tr></thead>
        <tbody>${r.stats.map((s) => `<tr><td>${label(s)}</td><td>${s.dials}</td><td>${s.connects} <span class="muted small">${pct(s.rates.connect)}</span></td><td>${s.convs} <span class="muted small">${pct(s.rates.conv)}</span></td><td>${s.booked}</td><td><b>${pct(s.rates.book)}</b></td><td>${Math.round(s.rates.bookPerDial * 1000) / 10}</td><td>${s.fast}</td><td>${s.held} <span class="muted small">${pct(s.rates.show)}</span></td><td>${s.won}</td><td>${s.reps}</td></tr>`).join('')}</tbody></table></div>
        <p class="small muted">Showed and Closed are checks, not the score: at our volume they take months to mean anything. Owner talks = the owner picked up and the call ran 60 seconds or ended with a real result.</p></div>
      <div class="card"><div class="card-head"><h3>Objections heard, by script</h3></div>${r.stats.map((s) => { const top = Object.entries(s.objections || {}).sort((a, b) => b[1] - a[1]).slice(0, 5); return `<p><b>${label(s)}</b>: ${top.length ? top.map(([k, n]) => `${esc(k.replace(/_/g, ' '))} (${n})`).join(', ') : '<span class="muted">none logged yet</span>'}</p>`; }).join('')}
        <p class="small muted">Logged from "Why" in the result window. More objections on one script can mean its opener invites them.</p></div>
      ${owner && r.perRep?.length ? `<div class="card"><div class="card-head"><h3>Per rep</h3></div><div class="table-wrap"><table class="table"><thead><tr><th>Rep</th>${r.stats.map((s) => `<th>${label(s)}</th>`).join('')}</tr></thead><tbody>${r.perRep.map((p) => `<tr><td>${esc(nameOfRep(p.id))}</td>${r.stats.map((s) => { const x = p.scripts.find((y) => y.key === s.key); return `<td>${x ? `${x.booked} booked / ${x.convs} talks / ${x.dials} dials` : '<span class="muted">none</span>'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="small muted">Outside a split test reps choose their script, so a strong rep on one script can make it look better than it is. Compare the same rep across scripts.</p></div>` : ''}`
      : ''}`;
    $$('[data-mode]', body).forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; draw(); }));
    $('#st-days', body)?.addEventListener('change', (e) => { days = Number(e.target.value); draw(); });
    $('#st-ver', body)?.addEventListener('change', (e) => { versions = e.target.checked; draw(); });
    const save = async (on) => {
      const variants = $$('[data-v]', body).filter((x) => x.checked).map((x) => x.dataset.v);
      try { await api('/api/scripts/test', { method: 'PUT', body: { on, variants } }); await loadScriptTest(true); toast(on ? 'Split test running. The dialer picks the script per lead.' : 'Split test stopped.'); mode = on ? 'test' : 'all'; draw(); } catch (e) { toast(e.message, true); }
    };
    $('#st-on', body)?.addEventListener('click', () => save(true));
    $('#st-off', body)?.addEventListener('click', () => save(false));
  }
  draw();
}
