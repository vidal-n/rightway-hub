// Call prep: research snapshot, problems with talk tracks, the adaptive script, objections, booking, and presenting.
import { $, $$, esc, api, toast, busy, modal, fmt, PLAN_NAMES, PLAN_PRICE } from './core.js';
import { buildScript, findProblems, scoreLead, recommendPlan, industryInfo, rankText } from '/js/leadintel.js';

let customCache = null;
export async function scriptSettings() {
  if (!customCache) customCache = api('/api/settings').then((s) => ({ script: s.script || {}, objections: s.objections || null })).catch(() => ({ script: {}, objections: null }));
  return customCache;
}
export function clearScriptCache() { customCache = null; }

export function gradeBadge(grade, score) {
  if (!grade) return '<span class="badge gray" title="Not scored yet">-</span>';
  const cls = grade === 'A' ? 'grade-a' : grade === 'B' ? 'grade-b' : grade === 'C' ? 'grade-c' : grade === 'W' ? 'grade-a' : 'grade-d';
  return `<span class="grade ${cls}" title="Lead score ${score ?? ''}">${esc(grade)}${score != null && grade !== 'W' && grade !== 'X' ? `<small>${score}</small>` : ''}</span>`;
}

export function miniGrid(grid) {
  if (!grid?.cells?.length) return '';
  const size = grid.size || Math.sqrt(grid.cells.length);
  const band = (c) => (c.error ? 'err' : c.rank == null ? 'none' : c.rank <= 3 ? 'top3' : c.rank <= 10 ? 'top10' : 'top20');
  return `<div class="minigrid" style="grid-template-columns:repeat(${size},1fr)">${grid.cells.map((c) => `<span class="mg ${band(c)}" title="${c.rank ? `#${c.rank}` : 'not in top 20'}">${c.error ? '!' : c.rank ?? '20+'}</span>`).join('')}</div>`;
}

function snapshot(lead, intel) {
  if (!intel) return '';
  const L = intel.listing || {};
  const top = intel.competitors?.[0];
  const cells = [
    ['Map rank', intel.found ? rankText(intel.rank) : 'No profile', intel.keyword ? `"${intel.keyword}" at their address` : ''],
    ['Top 3 coverage', intel.grid ? `${intel.grid.top3} of ${intel.grid.points}` : '-', intel.grid ? `${intel.grid.radiusMiles} mile grid` : ''],
    ['Reviews', L.reviews != null ? `${L.reviews}${L.rating ? ` · ${L.rating.toFixed(1)}★` : ''}` : '-', top ? `#1 ${top.title}: ${top.reviews ?? '?'}` : ''],
    ['Mobile speed', intel.speed?.score != null ? `${intel.speed.score}/100` : intel.website?.blocked ? 'Blocked' : L.url || lead.website ? '-' : 'No site', intel.website?.platform || ''],
  ];
  return `<div class="snap">${cells.map(([k, v, s]) => `<div><div class="snap-k">${esc(k)}</div><div class="snap-v">${esc(v)}</div><div class="snap-s">${esc(s)}</div></div>`).join('')}</div>`;
}

// Renders the full prep panel into el. Returns nothing; wires its own buttons.
export async function prepPanel(el, lead, intel, { rep = '', onResearched, compact = false } = {}) {
  const custom = await scriptSettings();
  const probs = findProblems(intel, lead);
  const sc = scoreLead(lead, intel);
  const rec = recommendPlan(lead, intel);
  const info = industryInfo(lead.industry, intel?.listing?.category || lead.category);
  const plan = lead.plan || rec.plan;
  const s = buildScript(lead, intel, { rep, plan }, custom);
  const age = intel?.at ? fmt.ago(intel.at) : null;
  el.innerHTML = `
    <div class="prep">
      <div class="prep-head">
        ${gradeBadge(sc.grade, sc.score)}
        <div style="min-width:0"><div class="item-title">${esc(PLAN_NAMES[plan])} plan recommended <span class="small">(${esc(fmt.money(PLAN_PRICE[plan]))}/mo)</span></div>
          <div class="small">${esc(rec.why.join(' · '))}</div></div>
        <div class="row" style="margin-left:auto">
          <button class="btn btn-ghost btn-sm" data-act="research">${intel ? 'Refresh research' : 'Research now'}</button>
          <a class="btn btn-ghost btn-sm" href="/present.html#${esc(lead.id)}" target="_blank" rel="noopener">Present</a>
          <button class="btn btn-ghost btn-sm" data-act="book">Book meeting</button>
        </div>
      </div>
      ${!intel ? `<div class="caption" style="margin:12px 0">Not researched yet. Research finds their Google profile, checks where they rank around their address, reads their website, and tests mobile speed. About 4 cents.</div>` : `
      ${intel.demo ? '<p class="badge warn" style="margin:10px 0 0">Demo data: DataForSEO is not connected</p>' : ''}
      <div class="prep-grid">
        <div>${snapshot(lead, intel)}</div>
        ${intel.grid ? `<div class="prep-map">${miniGrid(intel.grid)}<div class="small" style="text-align:center">Rank around them</div></div>` : ''}
      </div>
      <div class="small" style="margin-top:6px">${esc(info.label)}${intel.listing?.category ? ` · Google category: ${esc(intel.listing.category)}` : ''}${age ? ` · researched ${esc(age)}` : ''}</div>
      ${intel.competitors?.length ? `<div class="comps">${intel.competitors.slice(0, 3).map((c, i) => `<span class="badge gray">#${i + 1} ${esc(c.title)}${c.reviews != null ? ` · ${c.reviews} reviews` : ''}${c.rating ? ` · ${c.rating}★` : ''}</span>`).join('')}</div>` : ''}
      ${probs.length ? `<h3 style="margin-top:16px">Problems to pitch (${probs.length})</h3><ul class="probs">${probs.map((p) => `<li class="prob sev-${p.severity}"><div class="item-title">${esc(p.title)}</div><div class="small">${esc(p.detail)}</div><div class="say">Say: ${esc(p.talk)}</div></li>`).join('')}</ul>` : '<p class="muted" style="margin-top:12px">No major problems found. Pitch protecting their spot and growing into more keywords and areas.</p>'}`}
      <h3 style="margin-top:18px">Script</h3>
      <div class="seg script-tabs" role="tablist">${s.steps.map((st, i) => `<button type="button" role="tab" class="${i === 0 ? 'is-on' : ''}" data-step="${i}">${esc(st.title)}</button>`).join('')}</div>
      <div class="script-body">${s.steps.map((st, i) => `<div class="script-step" data-body="${i}"${i ? ' hidden' : ''}>${st.lines.length > 1 ? `<ol>${st.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>` : `<p>${esc(st.lines[0] || '')}</p>`}</div>`).join('')}</div>
      ${compact ? '' : `<h3 style="margin-top:16px">Objections</h3><div class="objs">${s.objections.map((o) => `<details class="obj"><summary>${esc(o.q)}</summary><p>${esc(o.a)}</p></details>`).join('')}</div>`}
    </div>`;
  $$('[data-step]', el).forEach((b) => b.addEventListener('click', () => {
    $$('[data-step]', el).forEach((x) => x.classList.toggle('is-on', x === b));
    $$('[data-body]', el).forEach((x) => { x.hidden = x.dataset.body !== b.dataset.step; });
  }));
  $('[data-act="research"]', el).addEventListener('click', async (e) => {
    busy(e.target, true, 'Researching...');
    try {
      const r = await api(`/api/leads/${lead.id}/research`, { method: 'POST', body: { force: Boolean(intel) } });
      toast(`Research done${r.intel?.cost ? ` ($${r.intel.cost.toFixed(3)})` : ''}`);
      const next = { ...lead, score: r.score ?? lead.score, grade: r.grade ?? lead.grade, plan: lead.plan || r.plan };
      onResearched?.(next, r.intel);
      prepPanel(el, next, r.intel, { rep, onResearched, compact });
    } catch (err) { toast(err.message, true); busy(e.target, false); }
  });
  $('[data-act="book"]', el).addEventListener('click', () => bookModal(lead));
}

// Book a meeting with a Google Meet link and calendar invite.
export async function bookModal(lead, onDone) {
  let g = null;
  try { g = await api('/api/google/status'); } catch { g = null; }
  const d = new Date(Date.now() + 864e5); d.setHours(10, 0, 0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  const m = modal(`<div class="card-head"><h2>Book the audit: ${esc(lead.business)}</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    ${!g?.ready ? '<p class="err-text">Google is not connected yet. Add the Google keys in Cloudflare, then connect your account in Settings.</p>' : !g.connected && !g.booking?.ownerEmail ? '<p class="err-text">Connect your Google account in Settings first.</p>' : `<p class="muted">Creates the event on ${esc(g.email || g.booking.ownerEmail)} with a Google Meet link and emails the invite to the lead.</p>`}
    <form id="bkf" class="form-grid">
      <label class="field"><span>Date and time (your time)</span><input type="datetime-local" name="start" value="${local}" required></label>
      <label class="field"><span>Length</span><select name="minutes"><option value="20">20 minutes</option><option value="30" selected>30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select></label>
      <label class="field span-all"><span>Their email for the invite</span><input type="email" name="email" value="${esc(lead.email || '')}" required></label>
      <label class="field span-all"><span>Note in the invite (optional)</span><input name="note" placeholder="Anything they should have ready"></label>
      <div class="span-all row end"><button class="btn btn-primary" type="submit"${g?.ready ? '' : ' disabled'}>Book with Google Meet</button></div>
    </form><div id="bkout"></div>`);
  $('#bkf', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    const btn = e.target.querySelector('button[type=submit]');
    busy(btn, true, 'Booking...');
    try {
      const r = await api(`/api/leads/${lead.id}/meeting`, { method: 'POST', body: { ...f, start: new Date(f.start).toISOString() } });
      $('#bkout', m.el).innerHTML = `<div class="card" style="box-shadow:none;background:var(--mint-soft);margin-top:12px"><h3>Booked for ${esc(new Date(r.start).toLocaleString())}</h3>
        ${r.meet ? `<div class="copybox"><code>${esc(r.meet)}</code></div>` : ''}<p class="small">Invite sent. The lead moved to Audit booked. Open Present before the call.</p></div>`;
      toast('Meeting booked');
      onDone?.(r);
    } catch (err) { toast(err.message, true); } finally { busy(btn, false); }
  });
}
