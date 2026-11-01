import { gridPoints, gridStats, estimateCost, UNRANKED } from './js/grid.js';
import { topCompetitors, profileChecklist, categoryGap, planMath, sameBusiness } from './js/analysis.js';
import { createMap } from './js/map.js';

const KEY_STORE = 'rw-hub-key';
const LAST_SCAN = 'rw-hub-last-scan';
const CONCURRENCY = 5;
const PLANS = [
  { name: 'Starter', price: 597 },
  { name: 'Growth', price: 997 },
  { name: 'Authority', price: 1497 },
  { name: 'Market Leader', price: 2497 },
];

const $ = (sel) => document.querySelector(sel);
const state = { demo: false, keyRequired: false, target: null, scan: null, map: null, runToken: 0, searchCost: 0 };

// ---------- helpers ----------
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function store(key, value) {
  try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const cents = (n) => `$${Number(n || 0).toFixed(2)}`;
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const slug = (s) => String(s || 'scan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

class AuthError extends Error {}

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-access-key': load(KEY_STORE) || '' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (res.status === 401) {
    store(KEY_STORE, null);
    showKeyCard(true);
    throw new AuthError('Access key needed. Enter it above, then try again.');
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  if (data.demo) setDemo(true);
  return data;
}

function setStatus(el, msg, isError = false) {
  el.textContent = msg || '';
  el.classList.toggle('err', Boolean(isError));
}

function setDemo(on) {
  state.demo = on;
  $('#demo-banner').hidden = !on;
}

function showKeyCard(show) {
  $('#key-card').hidden = !show;
  if (show) $('#key-input').focus();
}

// ---------- step 1: find ----------
$('#key-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = $('#key-input').value.trim();
  const msg = $('#key-status');
  if (!v) return;
  store(KEY_STORE, v);
  setStatus(msg, 'Checking...');
  try {
    await api('/api/check-key', {});
    $('#key-input').value = '';
    setStatus(msg, '');
    showKeyCard(false);
    setStatus($('#find-status'), 'Unlocked. You can search now.');
  } catch (err) {
    setStatus(msg, err instanceof AuthError
      ? "That key doesn't match the ACCESS_KEY the app was built with. If you changed it in Cloudflare, the app needs a rebuild first."
      : err.message, true);
  }
});

$('#find-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('#find-status');
  const btn = $('#find-btn');
  const list = $('#find-results');
  list.innerHTML = '';
  btn.disabled = true;
  setStatus(status, 'Searching Google Maps...');
  try {
    const data = await api('/api/business-search', { name: $('#find-name').value, location: $('#find-location').value });
    state.searchCost += data.cost || 0;
    if (!data.results.length) {
      setStatus(status, 'No listings found. Try the exact name on Google, or add the street.', true);
      return;
    }
    setStatus(status, `${data.results.length} listing${data.results.length > 1 ? 's' : ''} found. Pick the right one.`);
    data.results.forEach((biz) => {
      const li = document.createElement('li');
      li.className = 'result';
      li.innerHTML = `<div><div class="result-name">${esc(biz.title)}</div>
        <div class="result-meta">${esc(biz.address)}${biz.category ? ` · ${esc(biz.category)}` : ''}${biz.rating != null ? ` · ${biz.rating.toFixed(1)} stars, ${biz.reviews} reviews` : ''}</div></div>`;
      const pick = document.createElement('button');
      pick.className = 'btn btn-ghost btn-sm';
      pick.type = 'button';
      pick.textContent = 'This one';
      pick.addEventListener('click', () => pickBusiness(biz));
      li.appendChild(pick);
      list.appendChild(li);
    });
  } catch (err) {
    setStatus(status, err.message, true);
  } finally {
    btn.disabled = false;
  }
});

function pickBusiness(biz) {
  if (typeof biz.lat !== 'number' || typeof biz.lng !== 'number') {
    setStatus($('#find-status'), 'That listing has no map location, so it cannot be scanned. Pick another.', true);
    return;
  }
  state.target = biz;
  const picked = $('#picked');
  picked.innerHTML = `<div><b>${esc(biz.title)}</b><div class="result-meta">${esc(biz.address)}</div></div>`;
  const change = document.createElement('button');
  change.type = 'button';
  change.className = 'btn btn-ghost btn-sm';
  change.textContent = 'Change';
  change.addEventListener('click', () => {
    $('#step-scan').hidden = true;
    $('#find-name').focus();
  });
  picked.appendChild(change);
  const kw = $('#scan-keyword');
  if (!kw.value && biz.category) kw.value = biz.category.toLowerCase();
  $('#step-scan').hidden = false;
  updateCost();
  $('#step-scan').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- step 2: scan ----------
function updateCost() {
  const size = Number($('#scan-size').value);
  const note = state.demo ? ' Demo mode: free.' : '';
  $('#scan-cost').textContent = `${size * size} checks, about ${cents(estimateCost(size))} in DataForSEO credit.${note}`;
}
$('#scan-size').addEventListener('change', updateCost);

$('#scan-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!state.target) return;
  const size = Number($('#scan-size').value);
  const radius = Number($('#scan-radius').value);
  const zoom = Number($('#scan-zoom').value);
  const scan = {
    version: 1,
    createdAt: new Date().toISOString(),
    demo: state.demo,
    target: state.target,
    keyword: $('#scan-keyword').value.trim(),
    size,
    radius,
    zoom,
    points: gridPoints(state.target.lat, state.target.lng, size, radius),
    cost: state.searchCost,
    pagespeed: null,
    math: { jobValue: '', closeRatePct: 40, extraCalls: 10, plan: 'Growth' },
  };
  state.searchCost = 0;
  runScan(scan);
});

async function runScan(scan) {
  const token = ++state.runToken;
  state.scan = scan;
  renderReport(scan, true);
  const btn = $('#scan-btn');
  btn.disabled = true;
  let next = 0;
  let authFailed = false;

  async function worker() {
    while (next < scan.points.length && token === state.runToken && !authFailed) {
      const i = next++;
      const p = scan.points[i];
      p.status = 'running';
      state.map?.update(i);
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const data = await api('/api/grid-point', {
            keyword: scan.keyword, lat: p.lat, lng: p.lng, zoom: scan.zoom,
            cid: scan.target.cid, place_id: scan.target.place_id,
          });
          if (token !== state.runToken) return;
          p.rank = data.rank;
          p.top = data.top || [];
          p.status = 'done';
          scan.cost += data.cost || 0;
          break;
        } catch (err) {
          if (err instanceof AuthError) { authFailed = true; p.status = 'pending'; break; }
          p.status = 'error';
          p.error = err.message;
        }
      }
      if (token !== state.runToken) return;
      state.map?.update(i);
      updateLive(scan);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (token !== state.runToken) return;
  btn.disabled = false;
  if (authFailed) {
    $('#r-progress-label').textContent = 'Stopped: access key needed. Enter it above and run the scan again.';
    return;
  }
  finishScan(scan);
}

function finishScan(scan) {
  scan.completedAt = new Date().toISOString();
  saveLast(scan);
  renderAnalysis(scan);
  const s = gridStats(scan.points);
  $('#r-progress').hidden = true;
  $('#r-progress-label').textContent = s.errors ? `${s.errors} point${s.errors > 1 ? 's' : ''} failed (gray). Run the scan again if it matters.` : '';
}

function saveLast(scan) {
  store(LAST_SCAN, JSON.stringify(scan));
}

// ---------- report ----------
function renderReport(scan, live) {
  const r = $('#report');
  r.hidden = false;
  const t = scan.target;
  r.innerHTML = `
    <div class="report-actions no-print">
      <button class="btn btn-primary btn-sm" type="button" id="r-print">Print or save as PDF</button>
      <button class="btn btn-ghost btn-sm" type="button" id="r-download">Download scan file</button>
      <button class="btn btn-ghost btn-sm" type="button" id="r-new">New scan</button>
      <span class="cost-note" id="r-cost"></span>
    </div>
    <header class="report-head">
      <div>
        <img src="/brand/rightway-logo-light.svg" alt="Rightway Growth" width="160" height="26">
        <p class="eyebrow">Local ranking audit${scan.demo ? ' (demo data)' : ''}</p>
        <h1 class="report-title">${esc(t.title)}</h1>
        <div class="report-meta">${esc(t.address)}</div>
      </div>
      <div class="report-meta">
        Search: <b>${esc(scan.keyword)}</b><br>
        Grid: <b>${scan.size} x ${scan.size}</b>, ${scan.radius} mile radius<br>
        Date: <b>${esc(fmtDate(scan.createdAt))}</b>
      </div>
    </header>
    <div class="no-print">
      <div class="progress" id="r-progress"${live ? '' : ' hidden'}><span></span></div>
      <p class="hint" id="r-progress-label"></p>
    </div>
    <section class="grid-wrap">
      <div>
        <div id="r-map"></div>
        <div class="legend">
          <span><i style="background:var(--top3)"></i>Top 3 (map pack)</span>
          <span><i style="background:var(--top10)"></i>4 to 10</span>
          <span><i style="background:var(--top20)"></i>11 to 20</span>
          <span><i style="background:var(--none)"></i>Not in top 20</span>
        </div>
        <p class="hint">Each circle is a Google Maps search for "${esc(scan.keyword)}" from that spot. The center circle is the business address.</p>
      </div>
      <div class="tiles" id="r-tiles"></div>
    </section>
    <section id="r-competitors"></section>
    <section class="two-col page-break">
      <div id="r-checklist"></div>
      <div id="r-gap"></div>
    </section>
    <section class="two-col">
      <div id="r-speed"></div>
      <div id="r-math"></div>
    </section>`;

  $('#r-print').addEventListener('click', () => window.print());
  $('#r-download').addEventListener('click', () => downloadScan(scan));
  $('#r-new').addEventListener('click', () => {
    state.runToken++;
    $('#scan-btn').disabled = false;
    r.hidden = true;
    $('#step-find').scrollIntoView({ behavior: 'smooth' });
  });

  drawMap(scan);
  updateLive(scan);
  if (!live) renderAnalysis(scan);
  r.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function drawMap(scan, opts) {
  const el = $('#r-map');
  if (!el) return;
  state.map = createMap(el, scan.points, null, opts); // grid is centered on the business, so no separate pin
}

function updateLive(scan) {
  const s = gridStats(scan.points);
  const bar = $('#r-progress > span');
  if (bar) bar.style.width = `${Math.round((100 * (s.done + s.errors)) / s.total)}%`;
  const label = $('#r-progress-label');
  if (label && s.done + s.errors < s.total) label.textContent = `Checked ${s.done + s.errors} of ${s.total} points...`;
  const cost = $('#r-cost');
  if (cost) cost.textContent = scan.demo ? 'Demo data, no charge.' : `DataForSEO cost so far: ${cents(scan.cost)}`;

  const center = s.centerRank === undefined ? '...' : s.centerRank == null ? '20+' : `#${s.centerRank}`;
  $('#r-tiles').innerHTML = `
    <div class="tile ${s.top3Pct >= 50 ? 'tile-good' : s.done ? 'tile-bad' : ''}">
      <div class="tile-num">${s.done ? `${s.top3Pct}%` : '...'}</div>
      <div class="tile-label">of the area shows them in the top 3 (${s.top3} of ${s.done || s.total} points)</div>
    </div>
    <div class="tile">
      <div class="tile-num">${s.avgRank == null ? '...' : s.avgRank}</div>
      <div class="tile-label">average rank across the grid (not in the top 20 counts as ${UNRANKED})</div>
    </div>
    <div class="tile">
      <div class="tile-num">${s.done ? `${s.top10Pct}%` : '...'}</div>
      <div class="tile-label">of the area shows them on the first page (top 10)</div>
    </div>
    <div class="tile">
      <div class="tile-num">${center}</div>
      <div class="tile-label">rank right at the business address</div>
    </div>`;
}

function renderAnalysis(scan) {
  const t = scan.target;
  const s = gridStats(scan.points);
  const comps = topCompetitors(scan.points, t, 3);
  scan.competitors = comps;

  // Competitor table
  const rows = [
    { ...t, top3Points: s.top3, isTarget: true },
    ...comps,
  ];
  $('#r-competitors').innerHTML = `
    <h2>Who's beating them</h2>
    <p class="muted">The businesses that hold the top 3 most often across the grid.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Business</th><th>Top 3 spots</th><th>Rating</th><th>Reviews</th><th>Photos</th><th>Primary category</th></tr></thead>
      <tbody>${rows.map((b) => `
        <tr class="${b.isTarget ? 'is-target' : ''}">
          <td>${esc(b.title)}${b.isTarget ? ' (you)' : ''}</td>
          <td class="num">${b.top3Points} of ${s.done}</td>
          <td class="num">${b.rating != null ? b.rating.toFixed(1) : '-'}</td>
          <td class="num">${b.reviews ?? '-'}</td>
          <td class="num">${b.photos ?? '-'}</td>
          <td>${esc(b.category || '-')}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    ${comps.length ? '' : '<p class="hint">No competitor data yet.</p>'}`;

  // Checklist
  const checks = profileChecklist(t, comps);
  const gaps = checks.filter((c) => c.status === 'gap').length;
  $('#r-checklist').innerHTML = `
    <h2>Google profile check</h2>
    <p class="muted">${gaps ? `${gaps} gap${gaps > 1 ? 's' : ''} found against the top competitors.` : 'No gaps found against the top competitors.'}</p>
    <ul class="checklist">${checks.map((c) => `
      <li class="check ${c.status}">
        <span class="check-icon" aria-hidden="true">${c.status === 'good' ? '&#10003;' : c.status === 'gap' ? '&#10005;' : '?'}</span>
        <div><div class="check-label">${esc(c.label)}</div><div class="check-detail">${esc(c.detail)}</div></div>
      </li>`).join('')}
    </ul>`;

  // Category gap
  const gap = categoryGap(t, comps);
  $('#r-gap').innerHTML = `
    <h2>Categories competitors use</h2>
    <p class="muted">Categories the top ${comps.length || 3} use that this profile doesn't. Add only the ones that match real services.</p>
    ${gap.length
      ? `<ul class="chips">${gap.map((g) => `<li class="chip">${esc(g.category)}<b>${g.count}/${comps.length}</b></li>`).join('')}</ul>`
      : '<p>No category gaps.</p>'}
    <h3 style="margin-top:20px">Current categories</h3>
    <ul class="chips">${[t.category, ...(t.additional_categories || [])].filter(Boolean).map((c) => `<li class="chip">${esc(c)}</li>`).join('') || '<li class="chip">None listed</li>'}</ul>`;

  renderSpeed(scan);
  renderMath(scan);
  saveLast(scan);
}

function renderSpeed(scan) {
  const t = scan.target;
  const box = $('#r-speed');
  const ps = scan.pagespeed;
  box.innerHTML = `
    <h2>Website on a phone</h2>
    ${!t.url ? '<p>No website on the Google profile.</p>' : `
      <p class="muted">Google's mobile speed test for ${esc(t.domain || t.url)}.</p>
      ${ps ? speedHtml(ps) : '<button class="btn btn-ghost btn-sm no-print" type="button" id="r-speed-btn">Run mobile speed test</button><div class="speed-out" id="r-speed-out"></div>'}`}`;
  const btn = $('#r-speed-btn');
  if (btn) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const out = $('#r-speed-out');
      out.textContent = 'Testing, this takes 10 to 40 seconds...';
      try {
        scan.pagespeed = await api('/api/pagespeed', { url: t.url });
        saveLast(scan);
        renderSpeed(scan);
      } catch (err) {
        out.textContent = err.message;
        btn.disabled = false;
      }
    });
  }
}

function speedHtml(ps) {
  const verdict = ps.score >= 90 ? 'Good' : ps.score >= 50 ? 'Needs work' : 'Poor';
  return `<div class="speed-out">
    <div><span class="speed-score" style="color:${ps.score >= 90 ? 'var(--top3)' : ps.score >= 50 ? 'var(--top20)' : 'var(--none)'}">${ps.score}</span> / 100, ${verdict}</div>
    <div>Main content loads in <b>${esc(ps.lcp || '-')}</b>. Layout shift ${esc(ps.cls || '-')}. Blocking time ${esc(ps.tbt || '-')}.</div>
  </div>`;
}

function renderMath(scan) {
  const m = scan.math;
  const box = $('#r-math');
  box.innerHTML = `
    <h2>The math</h2>
    <p class="muted">Their numbers from the call.</p>
    <form class="math-form" id="math-form">
      <label class="field"><span>Average job value ($)</span><input name="jobValue" type="number" min="0" step="50" value="${esc(m.jobValue)}"></label>
      <label class="field"><span>Close rate (%)</span><input name="closeRatePct" type="number" min="0" max="100" value="${esc(m.closeRatePct)}"></label>
      <label class="field"><span>Extra calls a month</span><input name="extraCalls" type="number" min="0" value="${esc(m.extraCalls)}"></label>
      <label class="field"><span>Plan</span><select name="plan">${PLANS.map((p) => `<option${p.name === m.plan ? ' selected' : ''}>${p.name}</option>`).join('')}</select></label>
    </form>
    <div class="math-out" id="math-out"></div>`;
  const form = $('#math-form');
  const calc = () => {
    const fd = new FormData(form);
    Object.assign(m, Object.fromEntries(fd.entries()));
    const plan = PLANS.find((p) => p.name === m.plan) || PLANS[1];
    const out = planMath({ ...m, planPrice: plan.price });
    $('#math-out').innerHTML = Number(m.jobValue) > 0
      ? `${m.extraCalls} extra calls at ${m.closeRatePct}% is about <b>${out.jobs} jobs</b>, or <b>${money(out.revenue)}</b> a month.<br>${plan.name} is ${money(plan.price)} a month. <b>${out.jobsToCover} job${out.jobsToCover === 1 ? '' : 's'}</b> a month covers it.`
      : 'Enter their average job value.';
    saveLast(scan);
  };
  form.addEventListener('input', calc);
  calc();
}

// ---------- save / load ----------
function downloadScan(scan) {
  const blob = new Blob([JSON.stringify(scan, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rightway-scan-${slug(scan.target.title)}-${scan.createdAt.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('#load-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const scan = JSON.parse(await file.text());
    if (!scan || !Array.isArray(scan.points) || !scan.target) throw new Error('bad file');
    scan.math ||= { jobValue: '', closeRatePct: 40, extraCalls: 10, plan: 'Growth' };
    state.runToken++;
    state.scan = scan;
    renderReport(scan, false);
  } catch {
    setStatus($('#find-status'), 'That file is not a Rightway scan file.', true);
  }
});

// ---------- map redraw on resize and print ----------
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => state.scan && !$('#report').hidden && drawMap(state.scan), 200);
});
window.addEventListener('beforeprint', () => state.scan && drawMap(state.scan, { size: 430 }));
window.addEventListener('afterprint', () => state.scan && drawMap(state.scan));

// ---------- start ----------
async function init() {
  try {
    const res = await fetch('/api/health');
    const h = await res.json();
    setDemo(Boolean(h.demo));
    state.keyRequired = Boolean(h.keyRequired);
    if (h.keyRequired && !load(KEY_STORE)) showKeyCard(true);
  } catch {
    setStatus($('#find-status'), 'Could not reach the server.', true);
  }
  updateCost();
  // Offer the last scan if there is one.
  const last = load(LAST_SCAN);
  if (last) {
    try {
      const scan = JSON.parse(last);
      if (scan?.target && Array.isArray(scan.points) && scan.completedAt) {
        const status = $('#find-status');
        status.innerHTML = '';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-ghost btn-sm';
        btn.textContent = `Reopen last scan: ${scan.target.title}, "${scan.keyword}"`;
        btn.addEventListener('click', () => { state.scan = scan; renderReport(scan, false); status.innerHTML = ''; });
        status.appendChild(btn);
      }
    } catch { /* ignore */ }
  }
}

// Exposed for tests only.
window.__rw = { state, sameBusiness };
init();
