// The audit report page (Nov 2026, V: replace the slide deck with a real scrolling report). /audit.html#<leadId>
// Three tabs: Report (the whole audit, top to bottom, going along with the script), App (the live client app), Proposal (what we would do,
// the per job calculator, the small print plan, and the work order and payment desk). ?embed=1 inside the Hub's Present mode, ?notes=1 is the
// presenter notes view (script for the section on screen, pricing guide, deal desk) which follows the report from a phone or another window.
// Modeled on BrightLocal's Local Search Grid and Citation Tracker reports. Closers and owners only.
import { buildAudit, sectionsOf, jobCalc, money } from '/js/auditdoc.js';
import { gridSvg } from '/js/packview.js';
import { buildScript, unbold, industryInfo, quoteFor } from '/js/leadintel.js';
import { refLines } from '/js/planref.js';
import { can } from '/js/jobs.js';
import { mountDealDesk } from '/js/dealdesk.js';
import { QUESTIONS, CONTRACT } from '/js/pitchflow.js';

const root = document.getElementById('root');
const id = decodeURIComponent(location.hash.slice(1).split('/')[0]);
const QS = new URLSearchParams(location.search);
const embed = QS.get('embed') === '1' || window.self !== window.top;
const notes = QS.get('notes') === '1';
if (embed) document.body.classList.add('embed');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

async function api(path, method = 'GET', body) {
  const res = await fetch(path, { method, headers: { 'x-rw': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
  return data;
}
const store = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(`rw-au-${k}`); sessionStorage.setItem(`rw-au-${k}`, v); } catch { return null; } return null; };

const S = { tab: 'report', kw: 0, site: store('site') === '1', ticket: null, jobs: 4, monthly: '', sec: 'summary', appSrc: null };
let D = null; // { lead, intel, me, settings }
let A = null; // the audit document

function build() {
  A = buildAudit(D.lead, { intel: D.intel, listings: D.lead.listings, deepScan: D.lead.deep_scan, quote: D.lead.quote, rep: D.rep });
  if (S.ticket == null) S.ticket = A.ready ? A.ticket || 500 : 500;
  if (S.monthly === '' && A.ready && A.quote.monthly != null) S.monthly = String(A.quote.monthly);
}

// ---------- the report ----------
const stars = (r) => (r == null ? 'n/a' : r.toFixed(1));
const band = (r) => (r === -1 ? 'err' : r === 0 ? 'none' : r <= 3 ? 'top3' : r <= 10 ? 'top10' : 'top20');

function secSummary() {
  const p = A.profile, top = A.competitors[0], g = A.scans[0];
  const kpi = (b, l, s) => `<div class="kpi"><b>${esc(b)}</b><span>${esc(l)}</span>${s ? `<i>${esc(s)}</i>` : ''}</div>`;
  return `<section class="au-sec" id="sec-summary"><div class="au-cover"><div class="kick">Local search audit</div><h1>${esc(A.business)}</h1>
      <div class="muted">${esc([A.city, A.state].filter(Boolean).join(', '))}${A.industry ? ` · ${esc(A.industry)}` : ''}</div>
      <p style="font-size:18px;margin:16px 0 0;max-width:62ch">${esc(A.headline)}</p>
      <div class="au-meta"><div><b>Prepared</b>${esc(new Date(A.at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}</div>
        ${A.contact ? `<div><b>For</b>${esc(A.contact)}</div>` : ''}${A.rep ? `<div><b>By</b>${esc(A.rep)}, Rightway Growth</div>` : ''}
        <div><b>Searches checked</b><span class="chips" style="margin-top:4px">${A.keywords.map((k) => `<span class="chip">${esc(k)}</span>`).join('')}</span></div></div></div>
    <div class="grid4">
      ${g ? kpi(`${g.top10} of ${g.points}`, 'spots on page one', `${g.top3} in the top 3 for "${g.keyword}"`) : kpi(p.rank ? `#${p.rank}` : '20+', 'rank at your address', '')}
      ${kpi(p.reviews ?? 'n/a', 'Google reviews', top && top.reviews != null ? `${top.name}: ${top.reviews}` : '')}
      ${kpi(stars(p.rating), 'Google rating', top && top.rating != null ? `${top.name}: ${stars(top.rating)}` : '')}
      ${kpi(A.citations ? `${(A.citations.counts.mismatch || 0) + (A.citations.counts.missing || 0)} of ${A.citations.checked}` : 'Not run', 'directories wrong or missing', A.citations ? 'Google double checks these' : 'Run the listing check below')}</div>
    <div class="card" style="margin-top:16px"><h3>What the audit found</h3><ul class="sumlist">${A.summary.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <p class="note">Where you appear also depends on distance and relevance, so no one can promise a spot. You keep this audit either way.</p></div></section>`;
}

function scanPanel(s) {
  return `<div class="scanbox"><div>${gridSvg(s.cells, s.size, `Map scan for ${s.keyword}`)}
      <div class="legend"><span><i style="background:var(--g3)"></i>Top 3</span><span><i style="background:var(--g10)"></i>4 to 10</span><span><i style="background:var(--g20)"></i>11 to 20</span><span><i style="background:var(--gnone)"></i>Not found</span></div></div>
    <div class="statlist"><div class="kpi"><b>${s.top10} of ${s.points}</b><span>spots on the first page (top 10) within ${s.radiusMiles} miles</span></div>
      <div class="kpi"><b>${s.top3}</b><span>spots in the top 3</span></div>
      <div class="kpi"><b>${s.avg ?? '20+'}</b><span>average rank across the area</span></div>
      <p class="note" style="margin:0">Each square is a spot around the business. The number is where you show up when someone there searches "${esc(s.keyword)}". The square in the middle is the business address.</p></div></div>`;
}
function secScan() {
  const sc = A.scans;
  if (!sc.length) return `<section class="au-sec" id="sec-scan"><h2><span class="n">02</span>Map scan</h2><div class="card"><p>No scan yet. Run it now and it fills in here.</p>${D.canClose ? '<button class="btn" data-live>Run the live scan</button>' : ''}</div></section>`;
  const s = sc[Math.min(S.kw, sc.length - 1)];
  const sum = sc.length > 1 ? `<div class="tbl-wrap" style="margin-top:18px"><table class="t"><thead><tr><th>Search</th><th>Page one</th><th>Top 3</th><th>Average rank</th></tr></thead><tbody>${sc.map((x) => `<tr><td>${esc(x.keyword)}</td><td>${x.top10} of ${x.points}</td><td>${x.top3}</td><td>${x.avg ?? '20+'}</td></tr>`).join('')}</tbody></table></div>` : '';
  return `<section class="au-sec" id="sec-scan"><h2><span class="n">02</span>Map scan</h2><p class="au-lead">${s.deep ? `A ${s.size} by ${s.size} scan, ${s.radiusMiles} miles wide.` : 'The quick research grid.'} Google is searched from every square, the way a customer standing there would.</p>
    ${sc.length > 1 ? `<div class="kwtabs">${sc.map((x, i) => `<button type="button" data-kw="${i}" class="${i === Math.min(S.kw, sc.length - 1) ? 'on' : ''}">${esc(x.keyword)}<b>${x.top10}/${x.points}</b></button>`).join('')}</div>` : ''}
    <div class="card">${scanPanel(s)}</div>${sum}
    ${D.canClose ? `<p class="no-print" style="margin-top:12px"><button class="btn btn-ghost btn-sm" data-live>${s.deep ? 'Scan live again' : 'Run the full live scan'}</button></p>` : ''}</section>`;
}
function secAhead() {
  const rows = [{ you: true, name: A.business, reviews: A.profile.reviews, rating: A.profile.rating, category: A.profile.category, wins: A.scans[0]?.top3 ?? null, best: null }, ...A.competitors];
  const maxRev = Math.max(...rows.map((r) => r.reviews || 0));
  const tbl = `<div class="tbl-wrap"><table class="t"><thead><tr><th>Business</th><th>Reviews</th><th>Rating</th><th>Top 3 spots</th><th>Main category</th></tr></thead><tbody>${rows.map((r) => `<tr class="${r.you ? 'you' : ''}"><td>${r.you ? 'You: ' : ''}${esc(r.name)}</td><td class="${r.reviews === maxRev && maxRev ? 'good' : ''}">${r.reviews ?? '-'}</td><td>${stars(r.rating)}</td><td>${r.wins ?? '-'}</td><td>${esc(r.category || '-')}</td></tr>`).join('')}</tbody></table></div>`;
  const top = A.competitors[0];
  const cmp = A.compare.length ? `<h3 style="margin:26px 0 10px">You against ${esc(top?.name)}</h3><div class="tbl-wrap"><table class="t"><thead><tr><th></th><th>${esc(A.business)}</th><th>${esc(top?.name)}</th></tr></thead><tbody>${A.compare.map((r) => `<tr><td>${esc(r.label)}</td><td class="${r.lead === 'you' ? 'good' : r.lead === 'them' ? 'badv' : ''}">${esc(r.you ?? '-')}</td><td class="${r.lead === 'them' ? 'good' : ''}">${esc(r.them ?? '-')}</td></tr>`).join('')}</tbody></table></div>` : '';
  const rm = A.reviewMath;
  const math = rm ? `<div class="card" style="margin-top:16px"><h3>The review math</h3><p style="margin:0">${rm.gap ? `<b>${rm.gap} reviews</b> to pass ${esc(rm.leader)} (${rm.leaderReviews}). At <b>${rm.perMonth} a month</b> that is about <b>${rm.months} months</b>, with every review answered.` : `You already have more reviews than ${esc(rm.leader)}. Keep asking so the lead stays.`}</p></div>` : '';
  const urg = A.urgency?.length ? `<div class="card" style="margin-top:16px"><h3>What waiting costs</h3><ul class="sumlist">${A.urgency.map((u) => `<li>${esc(u.line)}</li>`).join('')}</ul><p class="note">Based on the numbers above. An estimate, not a promise.</p></div>` : '';
  return `<section class="au-sec" id="sec-ahead"><h2><span class="n">03</span>Who is ahead</h2><p class="au-lead">The businesses showing up around you, side by side, using only numbers visible on Google.</p>${tbl}${cmp}${math}${urg}</section>`;
}
function secPassing() {
  if (!A.competitors.length) return '';
  return `<section class="au-sec" id="sec-passing"><h2><span class="n">04</span>How to pass each one</h2><p class="au-lead">For every competitor, exactly what it takes. Distance and relevance also decide who shows first, so this narrows the gap and cannot guarantee a spot.</p>
    ${A.competitors.map((c, i) => `<div class="card"><h3>${i + 1}. ${esc(c.name)} <span class="muted small">${esc(c.category || '')}</span></h3>
      <div class="chips" style="margin-bottom:8px"><span class="chip">${c.reviews ?? 'n/a'} reviews</span><span class="chip">${stars(c.rating)} rating</span>${c.wins ? `<span class="chip">${c.wins} top 3 spots</span>` : ''}</div>
      ${c.why.length ? `<p class="muted small" style="margin:0">Why they are ahead today</p><ul class="pass">${c.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <p class="muted small" style="margin:12px 0 0">What it takes to pass them</p><ul class="pass">${c.pass.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`).join('')}</section>`;
}
function secProfile() {
  const p = A.profile;
  const facts = [['Name', p.name], ['Main category', p.category], ['Phone', p.phone], ['Address or area', p.address], ['Website', p.website], ['Rating', p.rating != null ? `${stars(p.rating)} from ${p.reviews ?? 'n/a'} reviews` : 'n/a'], ['Photos', p.photos ?? 'n/a'], ['Claimed', p.claimed == null ? 'Not checked' : p.claimed ? 'Yes' : 'No']];
  return `<section class="au-sec" id="sec-profile"><h2><span class="n">05</span>Your Google profile</h2><p class="au-lead">What Google shows today, and the checklist a fully built profile has.</p>
    <div class="grid2"><div class="card"><h3>What we found</h3>${facts.map(([k, v]) => `<div class="check" style="grid-template-columns:130px 1fr"><span class="muted">${esc(k)}</span><b>${esc(v || '-')}</b></div>`).join('')}</div>
      <div class="card"><h3>Profile checklist</h3>${A.checklist.map((c) => `<div class="check"><span class="dot ${c.state === true ? 'yes' : c.state === false ? 'no' : 'na'}">${c.state === true ? '✓' : c.state === false ? '!' : '?'}</span><span>${esc(c.label)}</span></div>`).join('')}
        <p class="note">✓ done, ! missing, ? we confirm with you during onboarding.</p></div></div></section>`;
}
function secCitations() {
  const c = A.citations;
  if (!c) return `<section class="au-sec" id="sec-citations"><h2><span class="n">06</span>Citations and listings</h2><div class="card"><p>Google double checks your name, address and phone across directories before it trusts you. We have not checked yours yet.</p>${D.canClose ? '<button class="btn" data-lst>Run the listing check (15 directories)</button>' : ''}</div></section>`;
  const n = c.counts;
  return `<section class="au-sec" id="sec-citations"><h2><span class="n">06</span>Citations and listings</h2><p class="au-lead">We checked ${c.checked} directories. ${n.mismatch || 0} show wrong information, ${n.missing || 0} do not list you, ${n.match || 0} match. Wrong and missing rows are fixed first.</p>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Directory</th><th>Status</th><th>What Google finds</th></tr></thead><tbody>${c.rows.map((r) => `<tr><td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)}</td><td><span class="tag ${esc(r.tone)}">${esc(r.label)}</span></td><td>${esc(r.note)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function secFixes() {
  const list = A.fixes.filter((f) => S.site || !f.site);
  return `<section class="au-sec" id="sec-fixes"><h2><span class="n">07</span>Exact fixes</h2><p class="au-lead">Everything found, in order of importance, with the exact steps that fix it.</p>
    ${list.length ? list.map((f) => `<div class="card fix ${esc(f.severity)}"><header><h3 style="margin:0">${esc(f.title)}</h3><span class="tag ${f.severity === 'high' ? 'bad' : f.severity === 'medium' ? 'warn' : 'good'}">${f.severity === 'high' ? 'Fix first' : f.severity === 'medium' ? 'Important' : 'Polish'}</span>${f.site ? '<span class="tag">Website</span>' : ''}</header>
      <p class="muted" style="margin:0">${esc(f.detail)}</p><ol class="steps">${f.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>`).join('') : '<div class="card"><p class="muted">No major gaps found.</p></div>'}</section>`;
}
function secPlan() {
  const sv = A.services.filter((s) => S.site || (!s.site && !s.need));
  const need = A.services.filter((s) => s.need);
  return `<section class="au-sec" id="sec-plan"><h2><span class="n">08</span>The game plan</h2><p class="au-lead">What gets ${esc(A.business)} onto the first page across the area, and keeps it there.</p>
    <div class="card"><h3>Step 1: the local foundation</h3>${sv.length ? sv.map((s) => `<div class="svc"><b>${esc(s.name)}</b><span class="q">${s.qty && s.unit ? `${s.qty} ${esc(s.unit)}` : ''}</span><p>${esc(s.why || s.what)}</p></div>`).join('') : '<p class="muted">Services are chosen after we talk.</p>'}</div>
    ${need.length ? `<div class="card"><h3>Also needed to rank higher</h3>${need.map((s) => `<div class="svc"><b>${esc(s.name)}</b><span></span><p>${esc(s.why || s.what)}</p></div>`).join('')}</div>` : ''}
    <div class="card"><h3>Included every month</h3>${A.plan.included.map((i) => `<div class="svc"><b>${esc(i.name)}</b><span></span><p>${esc(i.what)}</p></div>`).join('')}</div>
    ${S.site ? `<div class="card"><h3>Step 2: grow on top of it (sold separately, after results)</h3>${A.growth.map((g) => `<div class="svc"><b>${esc(g.name)}</b><span class="q">${g.fit === 'high' ? 'Fix first' : g.fit === 'good' ? 'Good fit' : 'Later'}</span><p>${esc(g.why)}</p></div>`).join('')}</div>` : `<div class="card"><h3>Step 2: what is next</h3><p class="muted" style="margin:0">Once the foundation is working, the monthly branding call is where we look at your results together and decide what to do next.</p></div>`}
    ${S.site && A.site ? `<div class="card"><h3>Website snapshot (for us)</h3><p class="muted" style="margin:0">Secure: ${A.site.https ? 'yes' : 'no'}. Homepage says service and city: ${A.site.titleOk ? 'yes' : 'no'}. Tap to call: ${A.site.tel ? 'yes' : 'no'}. Schema: ${A.site.schema ? 'yes' : 'no'}.</p></div>` : ''}</section>`;
}
function secRoadmap() {
  return `<section class="au-sec" id="sec-roadmap"><h2><span class="n">09</span>First 90 days</h2><p class="au-lead">What happens after you say yes.</p>
    <div class="months">${A.ninety.map((m) => `<div class="card"><h3>${esc(m.title)}</h3><ul>${m.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}</div>
    <p class="note">${esc(A.note)}</p></section>`;
}

function reportHtml() {
  if (!A.ready) return `<div class="card"><h3>Run the research first</h3><p class="muted">${esc(A.reason || 'There is nothing to show yet.')}</p></div>`;
  return secSummary() + secScan() + secAhead() + secPassing() + secProfile() + secCitations() + secFixes() + secPlan() + secRoadmap()
    + `<p class="no-print" style="text-align:center"><button class="btn" data-tab="proposal">Continue to the proposal</button></p>`;
}

// ---------- app tab ----------
function appHtml() {
  return `<section class="au-sec"><h2>Your app</h2><p class="au-lead">The same app your account gets: rankings, every task we do, reviews, photos and a direct line to your manager. Tap through it.</p>
    <div class="phone"><iframe id="appframe" title="Client app" src="about:blank"></iframe></div></section>`;
}
async function loadApp() {
  const f = $('#appframe');
  if (!f) return;
  if (S.appSrc == null) { try { const r = await api('/api/sample-client', 'POST'); S.appSrc = `/?as=${encodeURIComponent(r.id)}#/`; } catch { S.appSrc = ''; } }
  if (S.appSrc) f.src = S.appSrc; else f.replaceWith(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'The sample app is not available right now.' }));
}

// ---------- proposal tab ----------
function calcOut() {
  const c = jobCalc({ ticket: S.ticket, jobs: S.jobs, monthly: S.monthly });
  return `<div class="row"><span>Extra revenue a month</span><b>${money(c.revenue)}</b></div><div class="row"><span>A year</span><b>${money(c.yearly)}</b></div>
    ${c.costPerJob != null ? `<div class="row"><span>Cost per job at ${S.jobs} jobs</span><b>${money(c.costPerJob)}</b></div>` : ''}
    ${c.jobsToCover != null ? `<div class="row"><span>Jobs a month to cover the monthly</span><b>${c.jobsToCover}</b></div>` : ''}
    ${c.multiple != null ? `<div class="row"><span>Return on the monthly</span><b>${c.multiple.toFixed(1)}x</b></div>` : ''}`;
}
function proposalHtml() {
  if (!A.ready) return '<div class="card"><p class="muted">Run the research first.</p></div>';
  const sv = A.services.filter((s) => !s.site && !s.need);
  const c = jobCalc({ ticket: S.ticket, jobs: S.jobs, monthly: S.monthly });
  return `<section class="au-sec"><h2>Proposal for ${esc(A.business)}</h2><p class="au-lead">What we would do, what it is worth to you, and how to get started.</p>
    <div class="card"><h3>What we will do</h3>${sv.map((s) => `<div class="svc"><b>${esc(s.name)}</b><span class="q">${s.qty && s.unit ? `${s.qty} ${esc(s.unit)}` : ''}</span><p>${esc(s.why || s.what)}</p></div>`).join('') || '<p class="muted">Services are set after we talk.</p>'}
      <h3 style="margin-top:18px">Included every month</h3>${A.plan.included.map((i) => `<div class="svc"><b>${esc(i.name)}</b><span></span><p>${esc(i.what)}</p></div>`).join('')}</div>
    <div class="card" id="calc"><h3>What a job is worth</h3><div class="calc"><div class="grid2" style="grid-template-columns:1fr">
      <label>Average job value ($)<input class="input" id="c-ticket" type="number" min="0" step="50" value="${esc(S.ticket)}"></label>
      <label>Extra jobs a month from Google<input class="input" id="c-jobs" type="number" min="0" step="1" value="${esc(S.jobs)}"></label>
      <label>Monthly investment ($)<input class="input" id="c-monthly" type="number" min="0" step="1" value="${esc(S.monthly)}" placeholder="Type it"></label></div>
      <div class="out"><div class="big" id="c-rev">${money(c.revenue)}</div><div class="muted small" style="margin-bottom:10px">extra revenue a month</div><div id="c-rows">${calcOut()}</div></div></div>
      <p class="note">An estimate from your own numbers, not a promise. We cannot promise calls or a spot on Google.</p></div>
    <div class="card"><h3>Work order and payment</h3><div id="deal"></div></div>
    <div class="card no-print"><h3>Next step</h3><div class="grid2" style="grid-template-columns:1fr auto auto;align-items:end"><label>Day and time<input class="input" id="nb-when" type="datetime-local"></label>
      <button class="btn" id="nb-onb">Book onboarding call</button><button class="btn btn-ghost" id="nb-fu">Set a follow up</button></div><p class="small muted" id="nb-out" style="margin:8px 0 0"></p></div>
    <div class="fine"><b>Recommended plan: ${esc(A.plan.name)}.</b> ${A.plan.why.length ? `Based on ${esc(A.plan.why.join(', '))}. ` : ''}${esc(A.plan.exit.join('. '))}. Where you appear on Google depends on distance and relevance, so no one can promise a spot or a number of calls. You keep this audit either way.</div></section>`;
}
function wireProposal() {
  const upd = () => {
    S.ticket = $('#c-ticket').value; S.jobs = $('#c-jobs').value; S.monthly = $('#c-monthly').value;
    const c = jobCalc({ ticket: S.ticket, jobs: S.jobs, monthly: S.monthly });
    $('#c-rev').textContent = money(c.revenue); $('#c-rows').innerHTML = calcOut();
  };
  ['#c-ticket', '#c-jobs', '#c-monthly'].forEach((s) => $(s)?.addEventListener('input', upd));
  const host = $('#deal');
  if (host) mountDealDesk(host, { leadId: D.lead.id });
  const book = async (kind, btn) => {
    const v = $('#nb-when').value, out = $('#nb-out');
    const start = v ? new Date(v).getTime() : NaN;
    if (!Number.isFinite(start)) { out.textContent = 'Pick a day and time first.'; return; }
    btn.disabled = true;
    try {
      await api('/api/events', 'POST', { title: `${kind === 'onboarding' ? 'Onboarding call' : 'Follow up'}: ${D.lead.business}`, start, minutes: kind === 'onboarding' ? 45 : 20, lead_id: D.lead.id, note: kind === 'onboarding' ? 'Booked during the audit.' : 'Follow up set at the end of the audit.' });
      out.textContent = `${kind === 'onboarding' ? 'Onboarding call' : 'Follow up'} booked for ${new Date(start).toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`;
      btn.textContent = 'Booked';
    } catch (e) { btn.disabled = false; out.textContent = e.message; }
  };
  $('#nb-onb')?.addEventListener('click', (e) => book('onboarding', e.currentTarget));
  $('#nb-fu')?.addEventListener('click', (e) => book('follow', e.currentTarget));
}

// ---------- shell ----------
function shell() {
  const secs = sectionsOf(A);
  root.innerHTML = `<header class="au-bar"><div class="au-bar-in"><img class="au-logo lg-l" src="/brand/rightway-logo-light.svg" alt="Rightway Growth"><img class="au-logo lg-d" src="/brand/rightway-logo-dark.svg" alt="">
      <span class="au-biz">${esc(D.lead.business)}</span>
      <div class="au-tabs" role="tablist">${[['report', 'Report'], ['app', 'App'], ['proposal', 'Proposal']].map(([k, l]) => `<button type="button" data-tab="${k}" class="${S.tab === k ? 'on' : ''}" role="tab">${l}</button>`).join('')}</div>
      <span class="au-sp"></span><div class="au-tools no-print">
        ${S.tab === 'report' ? `<label class="au-switch" title="Show website findings and what we sell after results"><input type="checkbox" id="sitetoggle" ${S.site ? 'checked' : ''}> Website findings</label>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" id="pdf" title="Print or save as PDF">Print</button></div></div>
      ${S.tab === 'report' && A.ready ? `<nav class="au-nav" aria-label="Sections">${secs.map(([k, l]) => `<a href="#sec-${k}" data-sec="${k}">${esc(l)}</a>`).join('')}</nav>` : ''}</header>
    <main class="au-main" id="au-main">${S.tab === 'report' ? reportHtml() : S.tab === 'app' ? appHtml() : proposalHtml()}</main>`;
  wire();
  if (S.tab === 'app') loadApp();
  if (S.tab === 'proposal') wireProposal();
  if (S.tab === 'report') watchSections();
}

let io = null;
function watchSections() {
  io?.disconnect();
  const els = $$('.au-sec[id^="sec-"]');
  if (!els.length || !('IntersectionObserver' in window)) return;
  io = new IntersectionObserver((ents) => {
    const vis = ents.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!vis) return;
    const k = vis.target.id.replace('sec-', '');
    if (k === S.sec) return;
    S.sec = k;
    $$('.au-nav a').forEach((a) => a.classList.toggle('on', a.dataset.sec === k));
    pushKey({ k });
  }, { rootMargin: '-110px 0px -65% 0px' });
  els.forEach((e) => io.observe(e));
}
let lastPush = 0;
function pushKey(b) { const t = Date.now(); if (t - lastPush < 600 && !b.ck) return; lastPush = t; api(`/api/present/${encodeURIComponent(id)}/sync`, 'PUT', b).catch(() => {}); }

function openLive() {
  closeLive();
  const box = document.createElement('div');
  box.className = 'lv'; box.id = 'live';
  box.innerHTML = `<div class="lv-bar"><b>Live scan for ${esc(D.lead.business)}</b><span>Run it, then press Save. You come back here by yourself.</span><button class="btn btn-ghost btn-sm" id="lvx">Back to the report</button></div><iframe src="/scan.html?lead=${encodeURIComponent(id)}&embed=1" title="Live scan" allow="fullscreen"></iframe>`;
  document.body.appendChild(box);
  $('#lvx').onclick = closeLive;
}
const closeLive = () => $('#live')?.remove();

async function refreshLead() {
  try {
    const d = await api(`/api/leads/${encodeURIComponent(id)}`);
    const ch = (d.lead.deep_scan || '') !== (D.lead.deep_scan || '') || (d.lead.listings || '') !== (D.lead.listings || '') || (d.lead.quote || '') !== (D.lead.quote || '');
    D.lead = { ...D.lead, ...d.lead }; D.intel = d.intel || D.intel;
    if (ch) { S.kw = 0; build(); const y = window.scrollY; shell(); window.scrollTo(0, y); }
  } catch { /* keep what we have */ }
}

function wire() {
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { S.tab = b.dataset.tab; shell(); window.scrollTo(0, 0); }));
  $$('[data-kw]').forEach((b) => b.addEventListener('click', () => { S.kw = Number(b.dataset.kw); const y = window.scrollY; shell(); window.scrollTo(0, y); }));
  $('#sitetoggle')?.addEventListener('change', (e) => { S.site = e.target.checked; store('site', S.site ? '1' : '0'); const y = window.scrollY; shell(); window.scrollTo(0, y); });
  $('#pdf')?.addEventListener('click', () => window.print());
  $$('[data-live]').forEach((b) => b.addEventListener('click', openLive));
  $$('[data-lst]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = 'Checking 15 directories...';
    try { await api(`/api/leads/${encodeURIComponent(id)}/listings`, 'POST', {}); await refreshLead(); build(); const y = window.scrollY; shell(); window.scrollTo(0, y); } catch (e) { b.disabled = false; b.textContent = e.message; }
  }));
}

// ---------- presenter notes ----------
const STEPS = { summary: ['c_open', 'c_frame'], scan: ['c_verify', 'c_scan', 'c_live'], ahead: ['c_why'], passing: ['c_why'], profile: ['c_verify'], citations: ['c_listings'], fixes: ['c_why'], plan: ['c_story', 'c_program'], roadmap: ['c_process'], proposal: ['c_trial', 'c_price', 'c_close', 'c_post', 'c_onboard', 'c_book'] };
function notesView() {
  const secs = [...sectionsOf(A), ['proposal', 'Proposal']];
  const script = buildScript(D.lead, D.intel, { rep: D.rep, voice: D.voice, plan: 'growth', ticket: S.ticket || 500, quote: quoteFor(D.lead, D.intel, D.lead.quote) }, D.custom);
  const ref = quoteFor(D.lead, D.intel, D.lead.quote).ref;
  const say = (k) => (STEPS[k] || []).map((sid) => (script.steps.find((x) => x.id === sid)?.lines || []).map(unbold).join('\n\n')).filter(Boolean).join('\n\n— — —\n\n');
  const draw = () => {
    root.innerHTML = `<div class="nt"><h1>${esc(D.lead.business)}: your notes</h1><p class="muted small">Never on the shared screen. Tap a section to scroll the report to it.</p>
      <div class="go">${secs.map(([k, l]) => `<button type="button" data-go="${k}" class="${S.sec === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
      <div class="say">${esc(say(S.sec) || (S.sec === 'summary' ? `${CONTRACT}` : 'No script for this section.'))}</div>
      ${S.sec === 'summary' ? `<details open><summary>Discovery questions</summary><ul>${QUESTIONS.slice(0, 8).map((q) => `<li>${esc(q)}</li>`).join('')}</ul></details>` : ''}
      <details><summary>Pricing guide (never on the client screen)</summary><div class="small">${(ref ? refLines(quoteFor(D.lead, D.intel, D.lead.quote).services.map((x) => ({ id: x.id, qty: x.qty }))) : []).map((l) => `<p>${esc(l)}</p>`).join('') || '<p class="muted">No guide yet.</p>'}<p class="muted">A start point for the custom price, never a price. Type the real amounts below.</p></div></details>
      <details open><summary>Work order and payment link</summary><div id="deal"></div></details></div>`;
    $$('[data-go]').forEach((b) => b.addEventListener('click', () => { S.sec = b.dataset.go; pushKey({ ck: b.dataset.go }); draw(); }));
    mountDealDesk($('#deal'), { leadId: D.lead.id, compact: true });
  };
  draw();
  let cseq = 0;
  setInterval(async () => {
    if (document.hidden || $('#deal input:focus, #deal textarea:focus')) return;
    try { const r = await api(`/api/present/${encodeURIComponent(id)}/sync`); if (r.k && r.k !== S.sec) { S.sec = r.k; draw(); } cseq = r.cseq || cseq; } catch { /* keep going */ }
  }, 2500);
}

// The report follows commands from the notes window or phone.
function followNotes() {
  let seq = null;
  setInterval(async () => {
    if (document.hidden) return;
    try {
      const r = await api(`/api/present/${encodeURIComponent(id)}/sync`);
      if (seq == null) { seq = r.cseq || 0; return; }
      if ((r.cseq || 0) !== seq) { seq = r.cseq || 0; if (r.ck && S.tab === 'report') document.getElementById(`sec-${r.ck}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); else if (r.ck === 'proposal') { S.tab = 'proposal'; shell(); window.scrollTo(0, 0); } }
    } catch { /* keep going */ }
  }, 2000);
}

async function boot() {
  if (!id) { root.innerHTML = '<div class="au-err">Open the report from a lead in the Hub.</div>'; return; }
  try {
    const [d, me, s] = await Promise.all([api(`/api/leads/${encodeURIComponent(id)}`), api('/api/me'), api('/api/settings').catch(() => ({}))]);
    if (!can(me.user, 'close')) { root.innerHTML = '<div class="au-err">Reports are run by closers. Ask an owner to hand you the call.<br><a href="/">Back to the Hub</a></div>'; return; }
    D = { lead: d.lead, intel: d.intel, me: me.user, canClose: true, rep: (me.user?.name || '').split(' ')[0] || '', voice: me.user?.role === 'admin' ? 'I' : 'we', custom: { script: s.script || {}, objections: s.objections || null, number: s.number || '' } };
    document.title = `${D.lead.business}: audit report`;
    build();
    if (notes) { notesView(); return; }
    shell();
    followNotes();
    window.addEventListener('focus', refreshLead);
    try { const bc = 'BroadcastChannel' in window ? new BroadcastChannel(`rw-present-${id}`) : null; bc?.addEventListener('message', (e) => { if (e.data?.type === 'deep') { closeLive(); refreshLead(); } }); } catch { /* fine */ }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLive(); });
  } catch (e) {
    root.innerHTML = e.status === 401 || e.status === 403 ? '<div class="au-err">Log in to the Hub first.<br><a href="/">Open Rightway Hub</a></div>' : `<div class="au-err">${esc(e.message)}</div>`;
  }
}
boot();
