import { gridPoints, gridStats, estimateCost, UNRANKED } from './js/grid.js';
import {
  profileChecklist, categoryGap, planMath, sameBusiness, rankAt, leaderboard, findings, fixFirst,
} from './js/analysis.js';
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
const SOURCE_LABEL = { local: 'Google local results', maps: 'Google Maps' };
const REDUCED = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const $ = (sel) => document.querySelector(sel);
const state = { demo: false, keyRequired: false, target: null, scan: null, map: null, runToken: 0, searchCost: 0, view: null, staff: null, clientId: null, clientName: '' };

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
const fmtInt = (n) => (n == null ? '-' : Number(n).toLocaleString('en-US'));
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const slug = (s) => String(s || 'scan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const keyOf = (b) => b.cid || b.place_id || b.title;

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
  if (!el) return;
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

// Animated number. Final value is always written, so print and reduced motion are correct.
function countUp(el, to, { decimals = 0, suffix = '', prefix = '' } = {}) {
  if (!el) return;
  const final = `${prefix}${Number(to).toFixed(decimals)}${suffix}`;
  if (REDUCED || !Number.isFinite(Number(to))) { el.textContent = final; return; }
  const start = performance.now();
  const dur = 900;
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = `${prefix}${(Number(to) * eased).toFixed(decimals)}${suffix}`;
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = final;
  };
  requestAnimationFrame(step);
}

// Fade sections in as they scroll into view.
const revealer = 'IntersectionObserver' in window && !REDUCED
  ? new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('is-in'); revealer.unobserve(e.target); }
  }), { threshold: 0.08 })
  : null;
function reveal(root) {
  root.querySelectorAll('.reveal').forEach((n) => (revealer ? revealer.observe(n) : n.classList.add('is-in')));
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
  setStatus(status, 'Searching Google...');
  try {
    const data = await api('/api/business-search', { name: $('#find-name').value, location: $('#find-location').value });
    state.searchCost += data.cost || 0;
    if (!data.results.length) {
      setStatus(status, 'No listings found. Try the exact name on Google, or add the street.', true);
      return;
    }
    setStatus(status, `${data.results.length} listing${data.results.length > 1 ? 's' : ''} found. Pick the right one.`);
    data.results.forEach((biz, i) => {
      const li = document.createElement('li');
      li.className = 'result';
      li.style.animationDelay = `${i * 50}ms`;
      li.innerHTML = `<div><div class="result-name">${esc(biz.title)}</div>
        <div class="result-meta">${esc(biz.address)}${biz.category ? ` · ${esc(biz.category)}` : ''}${biz.rating != null ? ` · ${biz.rating.toFixed(1)} stars, ${fmtInt(biz.reviews)} reviews` : ''}</div></div>`;
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
  change.addEventListener('click', () => { $('#step-scan').hidden = true; $('#find-name').focus(); });
  picked.appendChild(change);
  const kw = $('#scan-keyword');
  if (!kw.value && biz.category) kw.value = biz.category.toLowerCase();
  $('#step-scan').hidden = false;
  updateCost();
  $('#step-scan').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
}

// ---------- step 2: scan ----------
function updateCost() {
  const size = Number($('#scan-size').value);
  const source = $('#scan-source').value;
  const note = state.demo ? ' Demo mode: free.' : '';
  $('#scan-cost').textContent = `${size * size} checks, about ${cents(estimateCost(size, source) + 0.006)} in DataForSEO credit.${note}`;
  $('#zoom-field').hidden = source !== 'maps';
}
['#scan-size', '#scan-source'].forEach((s) => $(s).addEventListener('change', updateCost));

$('#scan-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!state.target) return;
  const size = Number($('#scan-size').value);
  const radius = Number($('#scan-radius').value);
  const scan = {
    version: 2,
    createdAt: new Date().toISOString(),
    demo: state.demo,
    target: state.target,
    keyword: $('#scan-keyword').value.trim(),
    size,
    radius,
    source: $('#scan-source').value,
    device: $('#scan-device').value,
    zoom: Number($('#scan-zoom').value),
    points: gridPoints(state.target.lat, state.target.lng, size, radius),
    details: {},
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
  state.view = null;
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
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const data = await api('/api/grid-point', {
            keyword: scan.keyword, lat: p.lat, lng: p.lng, zoom: scan.zoom, source: scan.source, device: scan.device,
            cid: scan.target.cid, place_id: scan.target.place_id, title: scan.target.title,
          });
          if (token !== state.runToken) return;
          p.rank = data.rank;
          p.top = data.top || [];
          p.status = 'done';
          if (!scan.itemTypes && data.types) scan.itemTypes = data.types;
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
  await finishScan(scan, token);
}

async function finishScan(scan, token) {
  scan.completedAt = new Date().toISOString();
  const s = gridStats(scan.points);
  const label = $('#r-progress-label');
  const empty = scan.points.filter((p) => p.status === 'done').every((p) => !(p.top || []).length);
  if (empty && s.done) {
    label.textContent = `Google returned no listings for "${scan.keyword}". Try a broader keyword. (Debug: ${JSON.stringify(scan.itemTypes || [])})`;
  } else {
    label.textContent = 'Getting competitor profile details...';
  }
  await loadDetails(scan, token);
  if (token !== state.runToken) return;
  saveLast(scan);
  renderAnalysis(scan, true);
  $('#r-progress').hidden = true;
  if (!empty) label.textContent = s.errors ? `${s.errors} point${s.errors > 1 ? 's' : ''} failed (gray). Run the scan again if it matters.` : '';
}

// Full profile details (categories, photos, claimed) for the top 3 competitors.
async function loadDetails(scan, token) {
  const board = leaderboard(scan.points, scan.target, 3);
  for (const c of board.rows) {
    const k = keyOf(c);
    if (scan.details[k] || !c.title) continue;
    try {
      const data = await api('/api/details', {
        title: c.title, cid: c.cid, place_id: c.place_id,
        lat: c.lat ?? scan.target.lat, lng: c.lng ?? scan.target.lng,
      });
      if (token !== state.runToken) return;
      scan.cost += data.cost || 0;
      if (data.business) scan.details[k] = data.business;
    } catch { /* details are optional */ }
  }
}

function withDetails(scan, b) {
  const d = scan.details?.[keyOf(b)];
  return d ? { ...b, ...d, rank: b.rank } : b;
}

function saveLast(scan) {
  store(LAST_SCAN, JSON.stringify(scan));
}

// ---------- report ----------
function renderReport(scan, live) {
  const r = $('#report');
  r.hidden = false;
  const t = scan.target;
  const source = SOURCE_LABEL[scan.source || 'maps'];
  r.innerHTML = `
    <div class="report-actions no-print">
      <button class="btn btn-primary btn-sm" type="button" id="r-print">Print or save as PDF</button>
      <button class="btn btn-ghost btn-sm" type="button" id="r-download">Download scan file</button>
      <button class="btn btn-ghost btn-sm" type="button" id="r-new">New scan</button>
      <span class="cost-note" id="r-cost"></span>
      <span id="r-save" class="row-inline"></span>
    </div>
    <header class="r-hero">
      <div class="r-hero-top">
        <img src="/brand/rightway-logo-dark.svg" alt="Rightway Growth" width="150" height="24">
        <span class="r-date">${esc(fmtDate(scan.createdAt))}</span>
      </div>
      <p class="eyebrow">Local ranking audit${scan.demo ? ' (demo data)' : ''}</p>
      <h1 class="r-title">${esc(t.title)}</h1>
      <p class="r-addr">${esc(t.address)}</p>
      <ul class="r-chips">
        <li>Search: <b>${esc(scan.keyword)}</b></li>
        <li>${scan.size} x ${scan.size} grid, ${scan.radius} mile radius</li>
        <li>${esc(source)}${scan.device === 'mobile' ? ', mobile' : ''}</li>
      </ul>
      <div class="r-stats" id="r-stats"></div>
    </header>
    <div class="no-print">
      <div class="progress" id="r-progress"${live ? '' : ' hidden'}><span></span></div>
      <p class="hint" id="r-progress-label"></p>
    </div>
    <section class="r-mapsec">
      <div class="r-mapcol">
        <div class="map-tools no-print">
          <label class="field inline"><span>Show rankings for</span><select id="r-view" disabled><option>Scanning...</option></select></label>
          <label class="toggle"><input type="checkbox" id="r-heat"> Heat map</label>
        </div>
        <div id="r-map"></div>
        <div class="legend">
          <span><i style="background:var(--top3)"></i>Top 3</span>
          <span><i style="background:var(--top10)"></i>4 to 10</span>
          <span><i style="background:var(--top20)"></i>11 to 20</span>
          <span><i style="background:var(--none)"></i>Not in top 20</span>
        </div>
        <p class="hint" id="r-view-caption">Each circle is a Google search for "${esc(scan.keyword)}" from that spot. The center circle is the business address.</p>
      </div>
      <aside class="r-side no-print" id="r-point">
        <h3>From any spot</h3>
        <p class="muted">Click a circle on the map to see exactly who ranks there.</p>
      </aside>
    </section>
    <section id="r-findings" class="r-findings"></section>
    <section id="r-board"></section>
    <section id="r-h2h"></section>
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
    $('#step-find').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' });
  });
  $('#r-heat').addEventListener('change', (e) => state.map?.setHeat(e.target.checked));
  setupSave(scan);

  drawMap(scan);
  updateLive(scan);
  if (!live) renderAnalysis(scan, true);
  r.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
}

function viewRankOf(scan) {
  const biz = state.view;
  return (p) => {
    if (p.status === 'error') return 'error';
    if (p.status !== 'done') return undefined;
    return biz ? rankAt(p, biz) : p.rank;
  };
}

function drawMap(scan, opts = {}) {
  const el = $('#r-map');
  if (!el) return;
  state.map = createMap(el, scan.points, {
    ...opts,
    rankOf: viewRankOf(scan),
    heat: $('#r-heat')?.checked,
    onSelect: (i) => showPoint(scan, i),
  });
}

function showPoint(scan, i) {
  const p = scan.points[i];
  state.map?.select(i);
  const box = $('#r-point');
  if (!p || p.status !== 'done') {
    box.innerHTML = `<h3>From this spot</h3><p class="muted">${p?.status === 'error' ? esc(p.error || 'This check failed.') : 'Still checking this spot.'}</p>`;
    return;
  }
  const t = scan.target;
  const focus = state.view;
  const list = (p.top || []).slice(0, 10);
  const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(scan.keyword)}/@${p.lat},${p.lng},14z`;
  box.innerHTML = `
    <h3>From this spot</h3>
    <p class="muted">${esc(t.title)} ranks <b>${p.rank ? `#${p.rank}` : 'below #20'}</b> here.</p>
    <ol class="spot-list">${list.map((b, idx) => {
      const isT = sameBusiness(b, t);
      const isF = focus && sameBusiness(b, focus);
      return `<li style="--i:${idx}" class="${isT ? 'is-target' : ''}${isF ? ' is-focus' : ''}"><span class="spot-rank">${b.rank}</span>
        <span class="spot-name">${esc(b.title)}</span>${b.reviews != null ? `<span class="spot-meta">${b.rating != null ? `${b.rating.toFixed(1)}, ` : ''}${fmtInt(b.reviews)}</span>` : ''}</li>`;
    }).join('')}</ol>
    ${list.length ? '' : '<p class="muted">No listings came back for this spot.</p>'}
    <a class="btn btn-ghost btn-sm" href="${esc(mapsUrl)}" target="_blank" rel="noopener">Check this spot on Google Maps</a>`;
  box.classList.remove('is-pulse');
  void box.offsetWidth;
  box.classList.add('is-pulse');
}

function updateLive(scan) {
  const s = gridStats(scan.points);
  const bar = $('#r-progress > span');
  if (bar) bar.style.width = `${Math.round((100 * (s.done + s.errors)) / s.total)}%`;
  const label = $('#r-progress-label');
  if (label && s.done + s.errors < s.total) label.textContent = `Checked ${s.done + s.errors} of ${s.total} points...`;
  const cost = $('#r-cost');
  if (cost) cost.textContent = scan.demo ? 'Demo data, no charge.' : `DataForSEO cost: ${cents(scan.cost)}`;
  renderStats(scan, s, false);
}

function renderStats(scan, s, animate) {
  const box = $('#r-stats');
  if (!box) return;
  const center = s.centerRank === undefined ? null : s.centerRank;
  const tiles = [
    { id: 'st-top3', num: s.top3Pct, suffix: '%', label: `of the area sees them in the top 3 (${s.top3} of ${s.done || s.total} points)`, tone: s.done ? (s.top3Pct >= 50 ? 'good' : 'bad') : '' },
    { id: 'st-avg', num: s.avgRank, decimals: 1, label: `average rank across the grid (not in the top 20 counts as ${UNRANKED})` },
    { id: 'st-top10', num: s.top10Pct, suffix: '%', label: 'of the area sees them on the first page (top 10)' },
    { id: 'st-center', num: center, prefix: '#', label: 'rank right at their own address', none: s.centerRank === null ? '20+' : null },
  ];
  box.innerHTML = tiles.map((t) => `
    <div class="stat ${t.tone ? `stat-${t.tone}` : ''}">
      <div class="stat-num" id="${t.id}">${t.none || (t.num == null || !s.done ? '...' : `${t.prefix || ''}${Number(t.num).toFixed(t.decimals || 0)}${t.suffix || ''}`)}</div>
      <div class="stat-label">${esc(t.label)}</div>
    </div>`).join('');
  if (animate && s.done) {
    tiles.forEach((t) => { if (!t.none && t.num != null) countUp($(`#${t.id}`), t.num, t); });
  }
}

function renderAnalysis(scan, animate) {
  const t = scan.target;
  const s = gridStats(scan.points);
  const board = leaderboard(scan.points, t, 8);
  const comps = board.rows.slice(0, 3).map((c) => withDetails(scan, c));
  const checks = profileChecklist(t, comps);
  const gaps = categoryGap(t, comps);
  renderStats(scan, s, animate);

  // View selector: switch the map to any competitor's grid.
  const sel = $('#r-view');
  sel.disabled = false;
  sel.innerHTML = `<option value="">${esc(t.title)} (you)</option>${board.rows.map((b, i) => `<option value="${i}">${esc(b.title)}</option>`).join('')}`;
  sel.onchange = () => {
    state.view = sel.value === '' ? null : board.rows[Number(sel.value)];
    state.map?.setRankOf(viewRankOf(scan));
    const v = state.view;
    $('#r-view-caption').textContent = v
      ? `Showing ${v.title}: top 3 at ${v.top3Points} of ${s.done} points, average rank ${v.avgRank}.`
      : `Each circle is a Google search for "${scan.keyword}" from that spot. The center circle is the business address.`;
  };

  // Findings and fix list
  const facts = findings({ target: t, points: scan.points, size: scan.size, radius: scan.radius, keyword: scan.keyword, board, comps, checks, gaps });
  const fixes = fixFirst(checks);
  $('#r-findings').innerHTML = `
    <div class="find-col reveal">
      <h2>What the scan shows</h2>
      <ul class="facts">${facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
    </div>
    <div class="find-col reveal">
      <h2>What we'd fix first</h2>
      ${fixes.length ? `<ol class="fixes">${fixes.map((f) => `<li><span class="impact impact-${f.impact.toLowerCase()}">${f.impact}</span>${esc(f.text)}</li>`).join('')}</ol>`
        : '<p class="muted">No profile gaps against the top competitors. The work here is content, links, and steady reviews.</p>'}
    </div>`;

  // Share of local voice
  const all = [board.target, ...board.rows].filter(Boolean).sort((a, b) => b.top3Points - a.top3Points || a.avgRank - b.avgRank);
  $('#r-board').innerHTML = `
    <div class="reveal">
      <h2>Who owns this area</h2>
      <p class="muted">Share of the grid where each business shows in the top 3. ${esc(t.title)} is #${board.position} of ${board.total} businesses seen.</p>
      <div class="table-wrap"><table class="board">
        <thead><tr><th>Business</th><th class="w-bar">Top 3 share</th><th>Avg rank</th><th>Top 10 spots</th><th>Rating</th><th>Reviews</th></tr></thead>
        <tbody>${all.map((b) => `
          <tr class="${b.isTarget ? 'is-target' : ''}">
            <td>${esc(b.title)}${b.isTarget ? ' (you)' : ''}</td>
            <td class="w-bar"><div class="bar"><span style="--w:${b.sov}%"></span></div><span class="bar-num">${b.sov}%</span></td>
            <td class="num">${b.avgRank}</td>
            <td class="num">${b.top10Points} of ${s.done}</td>
            <td class="num">${b.rating != null ? Number(b.rating).toFixed(1) : '-'}</td>
            <td class="num">${fmtInt(b.reviews)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;

  // Head to head
  const rows = [{ ...t, isTarget: true }, ...comps];
  $('#r-h2h').innerHTML = `
    <div class="reveal">
      <h2>Head to head with the top 3</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Business</th><th>Rating</th><th>Reviews</th><th>Photos</th><th>Categories</th><th>Website</th><th>Primary category</th></tr></thead>
        <tbody>${rows.map((b) => `
          <tr class="${b.isTarget ? 'is-target' : ''}">
            <td>${esc(b.title)}${b.isTarget ? ' (you)' : ''}</td>
            <td class="num">${b.rating != null ? Number(b.rating).toFixed(1) : '-'}</td>
            <td class="num">${fmtInt(b.reviews)}</td>
            <td class="num">${fmtInt(b.photos)}</td>
            <td class="num">${b.additional_categories ? 1 + b.additional_categories.length : '-'}</td>
            <td>${b.url || b.domain ? 'Yes' : b.additional_categories ? 'No' : '-'}</td>
            <td>${esc(b.category || '-')}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <p class="hint">Details come from each business's Google profile. A dash means Google did not report it.</p>
    </div>`;

  // Checklist
  const gapsCount = checks.filter((c) => c.status === 'gap').length;
  $('#r-checklist').innerHTML = `
    <div class="reveal">
      <h2>Google profile check</h2>
      <p class="muted">${gapsCount ? `${gapsCount} gap${gapsCount > 1 ? 's' : ''} against the top competitors.` : 'No gaps against the top competitors.'}</p>
      <ul class="checklist">${checks.map((c) => `
        <li class="check ${c.status}">
          <span class="check-icon" aria-hidden="true">${c.status === 'good' ? '&#10003;' : c.status === 'gap' ? '&#10005;' : '?'}</span>
          <div><div class="check-label">${esc(c.label)}</div><div class="check-detail">${esc(c.detail)}</div></div>
        </li>`).join('')}
      </ul>
    </div>`;

  // Category gap
  $('#r-gap').innerHTML = `
    <div class="reveal">
      <h2>Categories competitors use</h2>
      <p class="muted">Used by the top ${comps.length || 3} but not this profile. Add only the ones that match real services.</p>
      ${gaps.length
        ? `<ul class="chips">${gaps.map((g) => `<li class="chip">${esc(g.category)}<b>${g.count}/${comps.length}</b></li>`).join('')}</ul>`
        : '<p>No category gaps.</p>'}
      <h3 style="margin-top:20px">Current categories</h3>
      <ul class="chips">${[t.category, ...(t.additional_categories || [])].filter(Boolean).map((c) => `<li class="chip">${esc(c)}</li>`).join('') || '<li class="chip">None listed</li>'}</ul>
    </div>`;

  renderSpeed(scan);
  renderMath(scan);
  reveal($('#report'));
  requestAnimationFrame(() => document.querySelectorAll('.bar > span').forEach((n) => n.classList.add('is-grown')));
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
  const color = ps.score >= 90 ? 'var(--top3)' : ps.score >= 50 ? 'var(--top20)' : 'var(--none)';
  return `<div class="speed-out">
    <div class="gauge" style="--p:${ps.score};--c:${color}"><span>${ps.score}</span></div>
    <div><b>${verdict}</b><br>Main content loads in <b>${esc(ps.lcp || '-')}</b>. Layout shift ${esc(ps.cls || '-')}. Blocking time ${esc(ps.tbt || '-')}.</div>
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

function openScan(scan) {
  scan.math ||= { jobValue: '', closeRatePct: 40, extraCalls: 10, plan: 'Growth' };
  scan.details ||= {};
  state.runToken++;
  state.scan = scan;
  state.view = null;
  renderReport(scan, false);
}

$('#load-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const scan = JSON.parse(await file.text());
    if (!scan || !Array.isArray(scan.points) || !scan.target) throw new Error('bad file');
    openScan(scan);
  } catch {
    setStatus($('#find-status'), 'That file is not a Rightway scan file.', true);
  }
});

// ---------- map redraw on resize and print ----------
let resizeTimer;
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  if (window.innerWidth === lastWidth) return;
  lastWidth = window.innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => state.scan && !$('#report').hidden && drawMap(state.scan), 200);
});
window.addEventListener('beforeprint', () => state.scan && drawMap(state.scan, { size: 430 }));
window.addEventListener('afterprint', () => state.scan && drawMap(state.scan));

// ---------- Rightway Hub link: logged-in team members skip the key and can save scans to a client ----------
async function hubApi(path, opts = {}) {
  const res = await fetch(path, { method: opts.method || 'GET', headers: { 'x-rw': '1', ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function setupSave(scan) {
  const box = $('#r-save');
  if (!box || !state.staff) return;
  const save = async (clientId, name, btn) => {
    if (!scan.completedAt) return setStatus($('#r-progress-label'), 'Wait for the scan to finish, then save it.', true);
    btn.disabled = true;
    try {
      await hubApi(`/api/clients/${clientId}/scans`, { method: 'POST', body: { scan } });
      btn.textContent = `Saved to ${name}`;
    } catch (err) { btn.disabled = false; setStatus($('#r-progress-label'), err.message, true); }
  };
  if (state.clientId) {
    box.innerHTML = `<button class="btn btn-ghost btn-sm" type="button">Save to ${esc(state.clientName)}</button>`;
    box.firstElementChild.addEventListener('click', (e) => save(state.clientId, state.clientName, e.currentTarget));
    return;
  }
  box.innerHTML = '<button class="btn btn-ghost btn-sm" type="button">Save to a client</button>';
  box.firstElementChild.addEventListener('click', async () => {
    try {
      const { clients } = await hubApi('/api/clients');
      if (!clients.length) return setStatus($('#r-progress-label'), 'Add a client in the Hub first.', true);
      box.innerHTML = `<select class="btn-sm" style="min-height:36px;width:auto">${clients.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select> <button class="btn btn-primary btn-sm" type="button">Save</button>`;
      box.querySelector('button').addEventListener('click', (e) => {
        const sel = box.querySelector('select');
        save(sel.value, sel.options[sel.selectedIndex].text, e.currentTarget);
      });
    } catch (err) { setStatus($('#r-progress-label'), err.message, true); }
  });
}

async function hubSession() {
  try {
    const s = await hubApi('/api/auth/state');
    if (s.user && (s.user.role === 'admin' || s.user.role === 'team')) state.staff = s.user;
  } catch { /* hub not connected yet */ }
  const clientId = new URLSearchParams(location.search).get('client');
  if (!state.staff || !clientId) return;
  try {
    const { client: c } = await hubApi(`/api/clients/${encodeURIComponent(clientId)}`);
    state.clientId = c.id;
    state.clientName = c.name;
    const kw = (c.keywords || '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean)[0];
    if (kw) $('#scan-keyword').value = kw;
    const loc = (c.address || '').split(',').slice(1).join(',').trim();
    if (loc && (c.cid || c.place_id)) {
      // Pull the live profile (rating, reviews, photos) so the report's checks have real numbers.
      try {
        const r = await api('/api/business-search', { name: c.name, location: loc });
        state.searchCost += r.cost || 0;
        const hit = r.results.find((b) => (c.cid && b.cid === c.cid) || (c.place_id && b.place_id === c.place_id));
        if (hit && typeof hit.lat === 'number') { pickBusiness(hit); return; }
      } catch { /* fall back to the saved profile */ }
    }
    if (typeof c.lat === 'number' && typeof c.lng === 'number' && (c.cid || c.place_id)) {
      pickBusiness({ title: c.name, cid: c.cid || '', place_id: c.place_id || '', lat: c.lat, lng: c.lng, address: c.address || '', category: c.category || '',
        url: c.website || '', domain: '', phone: c.phone || '', additional_categories: [], rating: null, reviews: null, claimed: null, photos: null, hours: false });
    } else {
      $('#find-name').value = c.name;
      setStatus($('#find-status'), `Find ${c.name} on Google once, and add its place ID in the Hub to skip this step next time.`);
    }
  } catch (err) { setStatus($('#find-status'), err.message, true); }
}

// ---------- start ----------
async function init() {
  try {
    const res = await fetch('/api/health');
    const h = await res.json();
    setDemo(Boolean(h.demo));
    state.keyRequired = Boolean(h.keyRequired);
    await hubSession();
    if (h.keyRequired && !load(KEY_STORE) && !state.staff) showKeyCard(true);
  } catch {
    setStatus($('#find-status'), 'Could not reach the server.', true);
  }
  updateCost();
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
        btn.addEventListener('click', () => { openScan(scan); status.innerHTML = ''; });
        status.appendChild(btn);
      }
    } catch { /* ignore */ }
  }
}

window.__rw = { state };
init();
