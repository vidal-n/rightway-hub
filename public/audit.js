// The audit report page (Nov 2026, V: replace the slide deck with a real scrolling report). /audit.html#<leadId>
// Two pages you can see: Report (the whole audit, top to bottom, going along with the script) and App (the live client app). The Proposal is the
// page after the App, reached by a quiet arrow so it never looks salesy. ?embed=1 inside the Hub's Present mode, ?notes=1 is the presenter notes view
// (script for the section on screen, pricing guide, deal desk) which follows the report from a phone or another window.
// The map scan is the first thing on the page and runs INSIDE it (the scan tool in a frame, no redirect). When it saves, the page reads the Google
// profile and competitors, checks the directories, and builds the rest of the report below it, one section after another.
// Modeled on BrightLocal's Local Search Grid and Citation Tracker reports. Closers and owners only.
import { buildAudit, sectionsOf, jobCalc, money } from '/js/auditdoc.js';
import { gridSvg } from '/js/packview.js';
import { buildScript, unbold, quoteFor } from '/js/leadintel.js';
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, method = 'GET', body) {
  const res = await fetch(path, { method, headers: { 'x-rw': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
  return data;
}
const store = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(`rw-au-${k}`); sessionStorage.setItem(`rw-au-${k}`, v); } catch { return null; } return null; };
const parseJ = (v) => { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };

const S = { tab: 'report', kw: 0, site: store('site') === '1', ticket: null, jobs: 4, monthly: '', sec: 'summary', appSrc: null, frame: null, scanOpen: false, skipScan: store('skip') === '1', busy: false, stage: null, fresh: false, appLoaded: false };
let D = null; // { lead, intel, me, settings }
let A = null; // the audit document

function build() {
  A = buildAudit(D.lead, { intel: D.intel, listings: D.lead.listings, deepScan: D.lead.deep_scan, quote: D.lead.quote, rep: D.rep });
  if (S.ticket == null) S.ticket = A.ready ? A.ticket || 500 : 500;
  if (S.monthly === '' && A.ready && A.quote.monthly != null) S.monthly = String(A.quote.monthly);
}
const hasDeep = () => (parseJ(D.lead.deep_scan)?.scans || []).some((s) => s?.cells?.length);
// The scan comes first: until a live scan is saved (or the rep chooses the quick research grid) only the scan shows.
const gated = () => !hasDeep() && !(S.skipScan && A?.ready);
const showRest = () => A?.ready && !gated() && !S.stage;
const pad = (n) => String(n).padStart(2, '0');
const numOf = (k) => { const o = sectionsOf(A).map((x) => x[0]).filter((x) => x !== 'summary'); const i = o.indexOf(k); return pad((i < 0 ? 0 : i) + 1); };

// ---------- helpers for the look ----------
const stars = (r) => (r == null ? 'n/a' : r.toFixed(1));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
function mix(cells) {
  const c = { t3: 0, t10: 0, t20: 0, none: 0, err: 0 };
  for (const r of cells) { if (r === -1) c.err++; else if (r === 0) c.none++; else if (r <= 3) c.t3++; else if (r <= 10) c.t10++; else c.t20++; }
  return c;
}
const tone = (good, warn) => (good ? 'good' : warn ? 'warn' : 'bad');

// ---------- the cover and what needs attention ----------
function coverInner(ready) {
  const crumbs = [A.city || D.lead.city, A.state || D.lead.state].filter(Boolean).join(', ');
  return `<div class="kick"><span class="pulse"></span>Local search audit</div><h1>${esc(ready ? A.business : D.lead.business)}</h1>
    <div class="cv-sub">${esc(crumbs)}${ready && A.industry ? ` · ${esc(A.industry)}` : ''}</div>`;
}
function kpiCard(t, big, label, sub, fill) {
  return `<div class="kpi ${t}"><span class="kpi-l">${esc(label)}</span><b>${esc(big)}</b>${fill != null ? `<div class="meter"><i style="width:${Math.max(4, Math.min(100, fill))}%"></i></div>` : ''}${sub ? `<i class="kpi-s">${esc(sub)}</i>` : ''}</div>`;
}
function topHtml() {
  if (!A.ready || !showRest()) {
    return `<section class="au-sec" id="sec-summary"><div class="au-cover slim">${coverInner(false)}
      <p class="cv-head">${gated() ? 'Step one is the map scan. It runs right here, then the rest of the audit builds itself underneath.' : 'Building the audit.'}</p></div></section>`;
  }
  const p = A.profile, top = A.competitors[0], g = A.scans.find((s) => s.deep) || A.scans[0], c = A.citations;
  const wrong = c ? (c.counts.mismatch || 0) + (c.counts.missing || 0) : null;
  const k1 = g ? kpiCard(tone(g.top10 / (g.points || 1) >= 0.7, g.top10 / (g.points || 1) >= 0.35), `${g.top10} of ${g.points}`, 'Spots on page one', `${g.top3} in the top 3 for "${g.keyword}"`, pct(g.top10, g.points)) : kpiCard('neutral', p.rank ? `#${p.rank}` : '20+', 'Rank at your address', '', null);
  const rv = p.reviews ?? 0, tr = top?.reviews ?? null;
  const k2 = kpiCard(tr == null ? 'neutral' : tone(rv >= tr, rv >= tr * 0.6), p.reviews ?? 'n/a', 'Google reviews', top && tr != null ? `${top.name}: ${tr}` : '', tr ? pct(rv, Math.max(rv, tr)) : null);
  const k3 = kpiCard(p.rating == null ? 'neutral' : tone(p.rating >= 4.5, p.rating >= 4.0), stars(p.rating), 'Google rating', top && top.rating != null ? `${top.name}: ${stars(top.rating)}` : '', p.rating ? pct(p.rating, 5) : null);
  const k4 = kpiCard(wrong == null ? 'neutral' : tone(wrong === 0, wrong <= 3), wrong == null ? 'Not run' : `${wrong} of ${c.checked}`, 'Directories wrong or missing', c ? 'Google double checks these' : 'Run the listing check below', c ? pct(wrong, c.checked) : null);
  const fixes = A.fixes.filter((f) => S.site || !f.site);
  const high = fixes.filter((f) => f.severity === 'high');
  const lead = (high.length ? high : fixes.filter((f) => f.severity === 'medium')).slice(0, 4);
  const attn = lead.length ? `<div class="attn"><div class="attn-h"><span class="attn-ico">!</span><div><h3>${high.length ? 'Needs attention first' : 'Worth fixing next'}</h3><p>${high.length ? `${high.length} ${high.length === 1 ? 'problem is' : 'problems are'} costing ${esc(A.business)} customers right now.` : 'Nothing urgent, these move the needle.'}</p></div></div>
      <ol class="attn-l">${lead.map((f) => `<li><a href="#sec-fixes"><b>${esc(f.title)}</b><span>${esc(f.detail)}</span></a><em class="tag ${f.severity === 'high' ? 'bad' : 'warn'}">${f.severity === 'high' ? 'Fix first' : 'Important'}</em></li>`).join('')}</ol></div>` : '';
  return `<section class="au-sec rv" id="sec-summary"><div class="au-cover">${coverInner(true)}
      <p class="cv-head">${esc(A.headline)}</p>
      <div class="au-meta"><div><b>Prepared</b>${esc(new Date(A.at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}</div>
        ${A.contact ? `<div><b>For</b>${esc(A.contact)}</div>` : ''}${A.rep ? `<div><b>By</b>${esc(A.rep)}, Rightway Growth</div>` : ''}
        <div><b>Searches checked</b><span class="chips">${A.keywords.map((k) => `<span class="chip">${esc(k)}</span>`).join('')}</span></div></div></div>
    <div class="grid4 kpis">${k1}${k2}${k3}${k4}</div>${attn}
    <p class="note">Where you appear also depends on distance and relevance, so no one can promise a spot. You keep this audit either way.</p></section>`;
}

// ---------- the scan (section 01, always first) ----------
function scanPanel(s) {
  const m = mix(s.cells), tot = s.cells.length || 1;
  const seg = (k, n, cls, lab) => (n ? `<i class="${cls}" style="width:${(n / tot) * 100}%" title="${lab}: ${n}"><span>${n}</span></i>` : '');
  return `<div class="scanbox"><div>${gridSvg(s.cells, s.size, `Map scan for ${s.keyword}`)}
      <div class="legend"><span><i style="background:var(--g3)"></i>Top 3</span><span><i style="background:var(--g10)"></i>4 to 10</span><span><i style="background:var(--g20)"></i>11 to 20</span><span><i style="background:var(--gnone)"></i>Not found</span></div></div>
    <div class="statlist"><div class="big-stat ${tone(s.top10 / (s.points || 1) >= 0.7, s.top10 / (s.points || 1) >= 0.35)}"><b>${s.top10}<small> of ${s.points}</small></b><span>spots on the first page (top 10) within ${s.radiusMiles} miles</span></div>
      <div class="mixbar" aria-label="How the spots split">${seg('t3', m.t3, 'a', 'Top 3')}${seg('t10', m.t10, 'b', '4 to 10')}${seg('t20', m.t20, 'c', '11 to 20')}${seg('none', m.none + m.err, 'd', 'Not found')}</div>
      <div class="mixkey"><span><i class="a"></i>${m.t3} top 3</span><span><i class="b"></i>${m.t10} at 4 to 10</span><span><i class="c"></i>${m.t20} at 11 to 20</span><span><i class="d"></i>${m.none + m.err} not found</span></div>
      <div class="grid2" style="gap:10px"><div class="kpi neutral"><b>${s.avg ?? '20+'}</b><span class="kpi-l">Average rank</span></div><div class="kpi neutral"><b>${s.top3}</b><span class="kpi-l">Top 3 spots</span></div></div>
      <p class="note" style="margin:0">Each square is a spot around the business. The number is where you show up when someone there searches "${esc(s.keyword)}". The middle square is the business address.</p></div></div>`;
}
function scanSkeleton() {
  return `<div id="scan-head"></div><div id="scanres"></div>
    <div class="scanwrap" id="scanwrap" hidden><div class="scanwrap-bar"><span class="live-dot"></span><b>Live scan</b><span class="muted small" id="scanhint">Pick the search, run it. It saves itself and the report builds below.</span><button class="btn btn-ghost btn-sm" id="scanclose" type="button">Hide the scan</button></div><div class="scanframe"></div></div>
    <div id="scan-act" class="no-print"></div>`;
}
function paintScan() {
  const n = A?.ready ? numOf('scan') : '01';
  const deep = hasDeep();
  const sc = A?.ready ? A.scans : [];
  const s = sc[Math.min(S.kw, Math.max(0, sc.length - 1))];
  $('#scan-head').innerHTML = `<h2><span class="n">${n}</span>Map scan</h2><p class="au-lead">${gated() ? 'Google is searched from every square around the business, the way a customer standing there would. This comes first because everything else is built from it.' : s ? `${s.deep ? `A ${s.size} by ${s.size} scan, ${s.radiusMiles} miles wide.` : 'The quick research grid.'} Google is searched from every square, the way a customer standing there would.` : ''}</p>`;
  let res = '';
  if (showRest() && s) {
    const tabs = sc.length > 1 ? `<div class="kwtabs">${sc.map((x, i) => `<button type="button" data-kw="${i}" class="${i === Math.min(S.kw, sc.length - 1) ? 'on' : ''}">${esc(x.keyword)}<b>${x.top10}/${x.points}</b></button>`).join('')}</div>` : '';
    const sum = sc.length > 1 ? `<div class="tbl-wrap" style="margin-top:18px"><table class="t"><thead><tr><th>Search</th><th>Page one</th><th>Top 3</th><th>Average rank</th></tr></thead><tbody>${sc.map((x) => `<tr><td>${esc(x.keyword)}</td><td>${x.top10} of ${x.points}</td><td>${x.top3}</td><td>${x.avg ?? '20+'}</td></tr>`).join('')}</tbody></table></div>` : '';
    res = `${tabs}<div class="card">${scanPanel(s)}</div>${sum}`;
  } else if (S.stage || (deep && !A?.ready)) {
    const raw = (parseJ(D.lead.deep_scan)?.scans || []).filter((x) => x?.cells?.length);
    res = raw.length ? `<div class="card saved"><span class="ok-dot">✓</span><div><b>Scan saved</b><p class="muted small" style="margin:2px 0 0">${raw.map((x) => `${esc(x.keyword)}: ${x.top10 ?? x.cells.filter((c) => c.rank > 0 && c.rank <= 10).length} of ${x.points ?? x.cells.length} spots on page one`).join(' · ')}</p></div></div>` : '';
  }
  $('#scanres').innerHTML = res;
  const quick = !deep && A?.ready;
  $('#scan-act').innerHTML = S.scanOpen ? '' : `<p style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;align-items:center"><button class="btn ${deep ? 'btn-ghost' : ''} btn-sm" data-openscan>${deep ? 'Scan another search' : 'Open the live scan'}</button>${quick && gated() ? '<button class="btn btn-ghost btn-sm" data-skipscan>Use the quick research grid instead</button>' : ''}</p>`;
  $('#scanclose').hidden = gated() && !deep;
  $$('[data-kw]', $('#scanres')).forEach((b) => b.addEventListener('click', () => { S.kw = Number(b.dataset.kw); paintScan(); }));
  $$('[data-openscan]').forEach((b) => b.addEventListener('click', () => openScan(true)));
  $$('[data-skipscan]').forEach((b) => b.addEventListener('click', () => { S.skipScan = true; store('skip', '1'); closeScan(false); paintAll(); }));
}
function openScan(user) {
  const wrap = $('#scanwrap');
  if (!S.frame) {
    S.frame = document.createElement('iframe');
    S.frame.title = 'Live scan'; S.frame.setAttribute('allow', 'fullscreen');
    S.frame.src = `/scan.html?lead=${encodeURIComponent(id)}&embed=1`;
    $('.scanframe', wrap).appendChild(S.frame);
  }
  wrap.hidden = false; S.scanOpen = true; $('#scan-act').innerHTML = '';
  $('#scanclose').hidden = gated() && !hasDeep();
  if (user) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function closeScan(drop) {
  const wrap = $('#scanwrap'); if (!wrap) return;
  wrap.hidden = true; S.scanOpen = false;
  if (drop && S.frame) { S.frame.remove(); S.frame = null; }
  if (A) paintScan();
}

// ---------- building the report after the scan ----------
const STEP_DEF = [['scan', 'Scan saved'], ['research', 'Reading your Google profile and the businesses ahead of you'], ['listings', 'Checking the 15 directories Google trusts'], ['write', 'Writing the findings and fixes']];
function paintBuild() {
  const h = $('#r-build'); if (!h) return;
  const st = S.stage;
  if (st) {
    h.innerHTML = `<section class="au-sec buildcard" id="sec-build" aria-live="polite"><div class="card build"><div class="build-h"><span class="spin"></span><div><h3>Building the audit</h3><p class="muted small" style="margin:0">Your scan is the first thing done. Now everything else is worked out from it.</p></div></div>
      <ol class="bsteps">${st.steps.map((x) => `<li class="${x.s}"><span class="bi">${x.s === 'done' ? '✓' : x.s === 'err' ? '!' : x.s === 'run' ? '<i class="spin sm"></i>' : ''}</span><span>${esc(x.t)}</span></li>`).join('')}</ol>
      ${st.err ? `<p class="build-err">${esc(st.err)}</p><p><button class="btn btn-sm" id="retry">Try again</button></p>` : ''}</div></section>`;
    $('#retry')?.addEventListener('click', () => generate());
    return;
  }
  if (gated()) {
    const names = ['Citations and listings', 'Who is ahead', 'How to pass each one', 'Your Google profile', 'Exact fixes', 'The game plan', 'First 90 days'];
    h.innerHTML = `<section class="au-sec pending" aria-label="What builds after the scan"><h2><span class="n">...</span>Builds after the scan</h2><div class="pend-grid">${names.map((x, i) => `<div class="pend"><span>${pad(i + 2)}</span>${esc(x)}</div>`).join('')}</div></section>`;
  } else if (!A.ready) {
    h.innerHTML = `<section class="au-sec"><div class="card build"><h3>Build the rest of the report</h3><p class="muted">The scan is saved. The rest of the audit needs the Google profile and competitor research.</p><p><button class="btn" id="genbtn">Build the report</button></p></div></section>`;
    $('#genbtn')?.addEventListener('click', () => generate());
  } else h.innerHTML = '';
}
async function reloadLead() {
  const d = await api(`/api/leads/${encodeURIComponent(id)}`);
  D.lead = { ...D.lead, ...d.lead }; D.intel = d.intel || D.intel;
}
function setStep(st, k, s) { const x = st.steps.find((y) => y.k === k); if (x) x.s = s; paintBuild(); }
async function generate() {
  if (S.busy) return;
  S.busy = true;
  const st = { steps: STEP_DEF.map(([k, t]) => ({ k, t, s: k === 'scan' ? 'done' : 'wait' })), err: null };
  S.stage = st; paintAll();
  let step = 'research';
  try {
    build();
    if (!A.ready) { setStep(st, 'research', 'run'); await api(`/api/leads/${encodeURIComponent(id)}/research`, 'POST', {}); await reloadLead(); build(); }
    setStep(st, 'research', 'done');
    step = 'listings';
    if (!D.lead.listings) {
      setStep(st, 'listings', 'run');
      try { await api(`/api/leads/${encodeURIComponent(id)}/listings`, 'POST', {}); await reloadLead(); } catch (e) { setStep(st, 'listings', 'err'); st.note = `Directories could not be checked (${e.message}). You can run it again from the citations section.`; await sleep(900); }
    }
    if (st.steps.find((x) => x.k === 'listings').s !== 'err') setStep(st, 'listings', 'done');
    step = 'write';
    setStep(st, 'write', 'run'); build(); await sleep(450); setStep(st, 'write', 'done'); await sleep(250);
    if (!A.ready) throw new Error(A.reason || 'The research did not return anything to build from.');
    S.stage = null; S.fresh = true; S.kw = 0; S.busy = false;
    paintAll();
    document.getElementById('sec-summary')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    setStep(st, step, 'err'); st.err = e.message; S.busy = false; paintBuild();
  }
}

// ---------- the report sections ----------
function secCitations() {
  const c = A.citations, n0 = numOf('citations');
  if (!c) return `<section class="au-sec" id="sec-citations"><h2><span class="n">${n0}</span>Citations and listings</h2><div class="card"><p>Google double checks your name, address and phone across directories before it trusts you. We have not checked yours yet.</p>${D.canClose ? '<button class="btn" data-lst>Run the listing check (15 directories)</button>' : ''}</div></section>`;
  const n = c.counts, tot = c.checked || 1;
  const bar = `<div class="mixbar wide">${[['a', n.match || 0, 'Match'], ['c', n.mismatch || 0, 'Wrong'], ['d', n.missing || 0, 'Missing']].map(([cls, v, l]) => (v ? `<i class="${cls}" style="width:${(v / tot) * 100}%"><span>${v} ${l}</span></i>` : '')).join('')}</div>`;
  return `<section class="au-sec" id="sec-citations"><h2><span class="n">${n0}</span>Citations and listings</h2><p class="au-lead">We checked ${c.checked} directories. ${n.mismatch || 0} show wrong information, ${n.missing || 0} do not list you, ${n.match || 0} match. Wrong and missing rows are fixed first.</p>
    ${bar}<div class="tbl-wrap"><table class="t"><thead><tr><th>Directory</th><th>Status</th><th>What Google finds</th></tr></thead><tbody>${c.rows.map((r) => `<tr class="row-${esc(r.tone)}"><td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)}</td><td><span class="tag ${esc(r.tone)}">${esc(r.label)}</span></td><td>${esc(r.note)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function secAhead() {
  const you = { you: true, name: A.business, reviews: A.profile.reviews, rating: A.profile.rating, category: A.profile.category, wins: A.scans[0]?.top3 ?? null, best: null };
  const rows = [you, ...A.competitors];
  const maxRev = Math.max(...rows.map((r) => r.reviews || 0)) || 1;
  const bars = `<div class="card"><h3>Reviews compared</h3><div class="hbars">${[...rows].sort((a, b) => (b.reviews || 0) - (a.reviews || 0)).map((r) => `<div class="hb ${r.you ? 'you' : ''}"><span class="hb-n">${r.you ? 'You: ' : ''}${esc(r.name)}</span><div class="hb-t"><i style="width:${Math.max(2, ((r.reviews || 0) / maxRev) * 100)}%"></i></div><b>${r.reviews ?? '-'}</b></div>`).join('')}</div></div>`;
  const tbl = `<div class="tbl-wrap" style="margin-top:14px"><table class="t"><thead><tr><th>Business</th><th>Reviews</th><th>Rating</th><th>Top 3 spots</th><th>Main category</th></tr></thead><tbody>${rows.map((r) => `<tr class="${r.you ? 'you' : ''}"><td>${r.you ? 'You: ' : ''}${esc(r.name)}</td><td class="${r.reviews === maxRev && maxRev ? 'good' : ''}">${r.reviews ?? '-'}</td><td>${stars(r.rating)}</td><td>${r.wins ?? '-'}</td><td>${esc(r.category || '-')}</td></tr>`).join('')}</tbody></table></div>`;
  const top = A.competitors[0];
  const cmp = A.compare.length ? `<h3 style="margin:26px 0 10px">You against ${esc(top?.name)}</h3><div class="tbl-wrap"><table class="t"><thead><tr><th></th><th>${esc(A.business)}</th><th>${esc(top?.name)}</th></tr></thead><tbody>${A.compare.map((r) => `<tr><td>${esc(r.label)}</td><td class="${r.lead === 'you' ? 'good' : r.lead === 'them' ? 'badv' : ''}">${esc(r.you ?? '-')}</td><td class="${r.lead === 'them' ? 'good' : ''}">${esc(r.them ?? '-')}</td></tr>`).join('')}</tbody></table></div>` : '';
  const rm = A.reviewMath;
  const math = rm ? `<div class="card callout ${rm.gap ? 'bad' : 'good'}" style="margin-top:16px"><h3>The review math</h3><p style="margin:0">${rm.gap ? `<b>${rm.gap} reviews</b> to pass ${esc(rm.leader)} (${rm.leaderReviews}). At <b>${rm.perMonth} a month</b> that is about <b>${rm.months} months</b>, with every review answered.` : `You already have more reviews than ${esc(rm.leader)}. Keep asking so the lead stays.`}</p></div>` : '';
  const urg = A.urgency?.length ? `<div class="card callout warn" style="margin-top:16px"><h3>What waiting costs</h3><ul class="sumlist">${A.urgency.map((u) => `<li>${esc(u.line)}</li>`).join('')}</ul><p class="note">Based on the numbers above. An estimate, not a promise.</p></div>` : '';
  return `<section class="au-sec" id="sec-ahead"><h2><span class="n">${numOf('ahead')}</span>Who is ahead</h2><p class="au-lead">The businesses showing up around you, side by side, using only numbers visible on Google.</p>${bars}${tbl}${cmp}${math}${urg}</section>`;
}
function secPassing() {
  if (!A.competitors.length) return '';
  const me = A.profile;
  return `<section class="au-sec" id="sec-passing"><h2><span class="n">${numOf('passing')}</span>How to pass each one</h2><p class="au-lead">For every competitor, exactly what it takes. Distance and relevance also decide who shows first, so this narrows the gap and cannot guarantee a spot.</p>
    ${A.competitors.map((c, i) => {
      const gap = c.reviews != null && me.reviews != null ? c.reviews - me.reviews : null;
      return `<div class="card comp"><h3><span class="rk">${i + 1}</span>${esc(c.name)} <span class="muted small">${esc(c.category || '')}</span></h3>
      <div class="chips" style="margin-bottom:8px"><span class="chip">${c.reviews ?? 'n/a'} reviews</span><span class="chip">${stars(c.rating)} rating</span>${c.wins ? `<span class="chip">${c.wins} top 3 spots</span>` : ''}${gap != null ? `<span class="chip ${gap > 0 ? 'bad' : 'good'}">${gap > 0 ? `${gap} reviews ahead of you` : 'you lead on reviews'}</span>` : ''}</div>
      ${c.why.length ? `<p class="muted small" style="margin:0">Why they are ahead today</p><ul class="pass">${c.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <p class="muted small" style="margin:12px 0 0">What it takes to pass them</p><ul class="pass go">${c.pass.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`;
    }).join('')}</section>`;
}
function secProfile() {
  const p = A.profile;
  const facts = [['Name', p.name], ['Main category', p.category], ['Phone', p.phone], ['Address or area', p.address], ['Website', p.website], ['Rating', p.rating != null ? `${stars(p.rating)} from ${p.reviews ?? 'n/a'} reviews` : 'n/a'], ['Photos', p.photos ?? 'n/a'], ['Claimed', p.claimed == null ? 'Not checked' : p.claimed ? 'Yes' : 'No']];
  const done = A.checklist.filter((c) => c.state === true).length;
  return `<section class="au-sec" id="sec-profile"><h2><span class="n">${numOf('profile')}</span>Your Google profile</h2><p class="au-lead">What Google shows today, and the checklist a fully built profile has.</p>
    <div class="grid2"><div class="card"><h3>What we found</h3>${facts.map(([k, v]) => `<div class="check" style="grid-template-columns:130px 1fr"><span class="muted">${esc(k)}</span><b>${esc(v || '-')}</b></div>`).join('')}</div>
      <div class="card"><h3>Profile checklist <span class="tag ${done === A.checklist.length ? 'good' : done >= A.checklist.length / 2 ? 'warn' : 'bad'}">${done} of ${A.checklist.length}</span></h3>${A.checklist.map((c) => `<div class="check"><span class="dot ${c.state === true ? 'yes' : c.state === false ? 'no' : 'na'}">${c.state === true ? '✓' : c.state === false ? '!' : '?'}</span><span>${esc(c.label)}</span></div>`).join('')}
        <p class="note">✓ done, ! missing, ? we confirm with you during onboarding.</p></div></div></section>`;
}
function secFixes() {
  const list = A.fixes.filter((f) => S.site || !f.site);
  const cnt = (s) => list.filter((f) => f.severity === s).length;
  const pills = list.length ? `<div class="sevrow"><span class="tag bad">${cnt('high')} fix first</span><span class="tag warn">${cnt('medium')} important</span><span class="tag good">${cnt('low')} polish</span></div>` : '';
  return `<section class="au-sec" id="sec-fixes"><h2><span class="n">${numOf('fixes')}</span>Exact fixes</h2><p class="au-lead">Everything found, in order of importance, with the exact steps that fix it.</p>${pills}
    ${list.length ? list.map((f) => `<div class="card fix ${esc(f.severity)}"><header><h3 style="margin:0">${esc(f.title)}</h3><span class="tag ${f.severity === 'high' ? 'bad' : f.severity === 'medium' ? 'warn' : 'good'}">${f.severity === 'high' ? 'Fix first' : f.severity === 'medium' ? 'Important' : 'Polish'}</span>${f.site ? '<span class="tag">Website</span>' : ''}</header>
      <p class="muted" style="margin:0">${esc(f.detail)}</p><ol class="steps">${f.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>`).join('') : '<div class="card"><p class="muted">No major gaps found.</p></div>'}</section>`;
}
function secPlan() {
  const sv = A.services.filter((s) => S.site || (!s.site && !s.need));
  const need = A.services.filter((s) => s.need);
  return `<section class="au-sec" id="sec-plan"><h2><span class="n">${numOf('plan')}</span>The game plan</h2><p class="au-lead">What gets ${esc(A.business)} onto the first page across the area, and keeps it there.</p>
    <div class="card"><h3>Step 1: the local foundation</h3>${sv.length ? sv.map((s) => `<div class="svc"><b>${esc(s.name)}</b><span class="q">${s.qty && s.unit ? `${s.qty} ${esc(s.unit)}` : ''}</span><p>${esc(s.why || s.what)}</p></div>`).join('') : '<p class="muted">Services are chosen after we talk.</p>'}</div>
    ${need.length ? `<div class="card"><h3>Also needed to rank higher</h3>${need.map((s) => `<div class="svc"><b>${esc(s.name)}</b><span></span><p>${esc(s.why || s.what)}</p></div>`).join('')}</div>` : ''}
    <div class="card"><h3>Included every month</h3>${A.plan.included.map((i) => `<div class="svc"><b>${esc(i.name)}</b><span></span><p>${esc(i.what)}</p></div>`).join('')}</div>
    ${S.site ? `<div class="card"><h3>Step 2: grow on top of it (sold separately, after results)</h3>${A.growth.map((g) => `<div class="svc"><b>${esc(g.name)}</b><span class="q">${g.fit === 'high' ? 'Fix first' : g.fit === 'good' ? 'Good fit' : 'Later'}</span><p>${esc(g.why)}</p></div>`).join('')}</div>` : `<div class="card"><h3>Step 2: what is next</h3><p class="muted" style="margin:0">Once the foundation is working, the monthly branding call is where we look at your results together and decide what to do next.</p></div>`}
    ${S.site && A.site ? `<div class="card"><h3>Website snapshot (for us)</h3><p class="muted" style="margin:0">Secure: ${A.site.https ? 'yes' : 'no'}. Homepage says service and city: ${A.site.titleOk ? 'yes' : 'no'}. Tap to call: ${A.site.tel ? 'yes' : 'no'}. Schema: ${A.site.schema ? 'yes' : 'no'}.</p></div>` : ''}</section>`;
}
function secRoadmap() {
  return `<section class="au-sec" id="sec-roadmap"><h2><span class="n">${numOf('roadmap')}</span>First 90 days</h2><p class="au-lead">What happens after you say yes.</p>
    <div class="months">${A.ninety.map((m, i) => `<div class="card month"><span class="mn">${i + 1}</span><h3>${esc(m.title)}</h3><ul>${m.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}</div>
    <p class="note">${esc(A.note)}</p></section>`;
}
function restHtml() {
  if (!showRest()) return '';
  return secCitations() + secAhead() + secPassing() + secProfile() + secFixes() + secPlan() + secRoadmap();
}

// ---------- painting the report page ----------
function reportSkeleton() {
  return `<div id="r-top"></div><section class="au-sec" id="sec-scan">${scanSkeleton()}</section><div id="r-build"></div><div id="r-rest"></div>`;
}
function paintNav() {
  const nav = $('#au-nav'); if (!nav) return;
  const secs = showRest() ? sectionsOf(A) : [['scan', 'Map scan']];
  nav.innerHTML = secs.map(([k, l]) => `<a href="#sec-${k === 'summary' ? 'summary' : k}" data-sec="${k}" class="${S.sec === k ? 'on' : ''}">${esc(l)}</a>`).join('');
}
function paintAll() {
  if (!$('#p-report')) return;
  $('#r-top').innerHTML = topHtml();
  paintScan();
  paintBuild();
  const rest = $('#r-rest');
  rest.innerHTML = restHtml();
  if (S.fresh && showRest()) {
    $$('.au-sec', rest).forEach((el, i) => { el.classList.add('rv'); el.style.setProperty('--i', String(i + 1)); });
    S.fresh = false;
  }
  paintNav();
  chrome();
  wireReport();
  watchSections();
  if (S.tab === 'proposal') paintProposal();
}
function wireReport() {
  $$('[data-lst]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = 'Checking 15 directories...';
    try { await api(`/api/leads/${encodeURIComponent(id)}/listings`, 'POST', {}); await reloadLead(); build(); const y = window.scrollY; paintAll(); window.scrollTo(0, y); } catch (e) { b.disabled = false; b.textContent = e.message; }
  }));
}

// ---------- app tab ----------
function appHtml() {
  return `<section class="au-sec"><h2>Your app</h2><p class="au-lead">The same app your account gets: rankings, every task we do, reviews, photos and a direct line to your manager. Tap through it.</p>
    <div class="phone"><iframe id="appframe" title="Client app" src="about:blank"></iframe></div></section>`;
}
async function loadApp() {
  const f = $('#appframe');
  if (!f || S.appLoaded) return;
  S.appLoaded = true;
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

function paintProposal() {
  const p = $('#p-proposal'); if (!p) return;
  p.innerHTML = proposalHtml();
  if (A.ready) wireProposal();
}

// ---------- shell, tabs and the quiet arrows ----------
const CHEV = (flip) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${flip ? ' style="transform:scaleX(-1)"' : ''}><path d="M9 5l7 7-7 7"/></svg>`;
function shell() {
  root.innerHTML = `<header class="au-bar"><div class="au-bar-in"><img class="au-logo lg-l" src="/brand/rightway-logo-light.svg" alt="Rightway Growth"><img class="au-logo lg-d" src="/brand/rightway-logo-dark.svg" alt="">
      <span class="au-biz">${esc(D.lead.business)}</span>
      <div class="au-tabs" role="tablist">${[['report', 'Report'], ['app', 'App']].map(([k, l]) => `<button type="button" data-tab="${k}" role="tab">${l}</button>`).join('')}<span class="au-crumb" id="crumb" hidden>Proposal</span></div>
      <span class="au-sp"></span><div class="au-tools no-print">
        <label class="au-switch" id="siteswitch" title="Show website findings and what we sell after results"><input type="checkbox" id="sitetoggle" ${S.site ? 'checked' : ''}> Website findings</label>
        <button type="button" class="btn btn-ghost btn-sm" id="pdf" title="Print or save as PDF">Print</button></div></div>
      <nav class="au-nav" id="au-nav" aria-label="Sections"></nav></header>
    <main class="au-main" id="au-main"><div id="p-report" class="panel">${reportSkeleton()}</div><div id="p-app" class="panel" hidden>${appHtml()}</div><div id="p-proposal" class="panel" hidden></div></main>
    <button type="button" class="arrow arrow-prev no-print" id="aprev" aria-label="Previous page">${CHEV(true)}</button>
    <button type="button" class="arrow arrow-next no-print" id="anext" aria-label="Next page">${CHEV(false)}</button>`;
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#anext').addEventListener('click', () => showTab(S.tab === 'report' ? 'app' : 'proposal'));
  $('#aprev').addEventListener('click', () => showTab(S.tab === 'proposal' ? 'app' : 'report'));
  $('#sitetoggle').addEventListener('change', (e) => { S.site = e.target.checked; store('site', S.site ? '1' : '0'); const y = window.scrollY; paintAll(); window.scrollTo(0, y); });
  $('#pdf').addEventListener('click', () => window.print());
  $('#scanclose').addEventListener('click', () => closeScan(false));
  paintAll();
  if (gated()) openScan(false);
  showTab(S.tab, true);
}
function chrome() {
  const rep = S.tab === 'report';
  $('#siteswitch').hidden = !rep || !showRest();
  $('#au-nav').hidden = !rep;
}
function showTab(t, keep) {
  S.tab = t;
  ['report', 'app', 'proposal'].forEach((k) => { const el = $(`#p-${k}`); if (el) el.hidden = k !== t; });
  $$('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  $('#crumb').hidden = t !== 'proposal';
  chrome();
  const nx = $('#anext'), pv = $('#aprev');
  pv.hidden = t === 'report';
  nx.hidden = t === 'proposal';
  nx.classList.toggle('secret', t === 'app');
  nx.setAttribute('aria-label', t === 'report' ? 'Next page' : 'Continue');
  if (t === 'app') loadApp();
  if (t === 'proposal') paintProposal();
  if (!keep) window.scrollTo(0, 0);
}

let io = null;
function watchSections() {
  io?.disconnect();
  const els = $$('#p-report .au-sec[id^="sec-"]').filter((e) => e.id !== 'sec-build');
  if (!els.length || !('IntersectionObserver' in window)) return;
  io = new IntersectionObserver((ents) => {
    if (S.tab !== 'report') return;
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

// Picks up a scan saved somewhere else (the scan tool in its own window) when the page is shown again.
async function refreshLead() {
  if (S.busy) return;
  try {
    const before = `${D.lead.deep_scan || ''}|${D.lead.listings || ''}|${D.lead.quote || ''}`;
    await reloadLead();
    const after = `${D.lead.deep_scan || ''}|${D.lead.listings || ''}|${D.lead.quote || ''}`;
    if (before !== after) { S.kw = 0; build(); const y = window.scrollY; paintAll(); window.scrollTo(0, y); }
  } catch { /* keep what we have */ }
}
// The scan frame saves itself and tells this page. Both the window message and the broadcast channel arrive, so the first one wins.
async function onScanSaved() {
  if (S.busy || Date.now() - (S.lastSaved || 0) < 5000) return;
  S.lastSaved = Date.now();
  try { await reloadLead(); } catch { /* use what we have */ }
  S.kw = 0; build();
  closeScan(true);
  await generate();
}

// ---------- presenter notes ----------
const STEPS = { summary: ['c_open', 'c_frame'], scan: ['c_verify', 'c_scan', 'c_live'], ahead: ['c_why'], passing: ['c_why'], profile: ['c_verify'], citations: ['c_listings'], fixes: ['c_why'], plan: ['c_story', 'c_program'], roadmap: ['c_process'], proposal: ['c_trial', 'c_price', 'c_close', 'c_post', 'c_onboard', 'c_book'] };
function notesView() {
  const secs = [...sectionsOf(A), ['proposal', 'Proposal']];
  const script = buildScript(D.lead, D.intel, { rep: D.rep, voice: D.voice, plan: 'growth', ticket: S.ticket || 500, quote: quoteFor(D.lead, D.intel, D.lead.quote) }, D.custom);
  const ref = quoteFor(D.lead, D.intel, D.lead.quote).ref;
  const say = (k) => (STEPS[k] || []).map((sid) => (script.steps.find((x) => x.id === sid)?.lines || []).map(unbold).join('\n\n')).filter(Boolean).join('\n\n* * *\n\n');
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
      if ((r.cseq || 0) !== seq) {
        seq = r.cseq || 0;
        if (r.ck === 'proposal') showTab('proposal');
        else if (r.ck) { if (S.tab !== 'report') showTab('report', true); document.getElementById(`sec-${r.ck}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      }
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
    try { const bc = 'BroadcastChannel' in window ? new BroadcastChannel(`rw-present-${id}`) : null; bc?.addEventListener('message', (e) => { if (e.data?.type === 'deep') onScanSaved(); }); } catch { /* fine */ }
    window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data?.type === 'rw-scan-saved' && e.data.lead === id) onScanSaved(); });
  } catch (e) {
    root.innerHTML = e.status === 401 || e.status === 403 ? '<div class="au-err">Log in to the Hub first.<br><a href="/">Open Rightway Hub</a></div>' : `<div class="au-err">${esc(e.message)}</div>`;
  }
}
boot();
