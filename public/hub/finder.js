// Lead finder: our own Outscraper style Google Maps scraper, owners only. Type keywords and areas, it covers each area with a grid of
// map views, removes repeats, and lists the businesses here. Filter them, download a CSV, or add them to the Pipeline, where the
// background scrub fills in emails, owner names and socials. The server does the searching, so this works the same on an iPad.
import { $, $$, esc, api, toast, busy } from './core.js';
import { staffShell } from './shell.js';
import { COVERAGE, estimate, parseKeywords, parseAreas, MAX_REQUESTS, passes, cleanFilters, csvText } from '/js/finder.js';

const num = (n) => Number(n || 0).toLocaleString('en-US');
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const STATUS = { queued: ['Waiting', 'gray'], running: ['Searching', ''], done: ['Done', ''], failed: ['Needs attention', 'bad'], stopped: ['Paused', 'warn'] };
const active = (j) => j.status === 'queued' || j.status === 'running';
const ago = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };

// The filter boxes, used when starting a search and when looking through the results.
const filterHtml = () => `<div class="fgrid">
  <label class="field"><span>Reviews at least</span><input data-f="minReviews" inputmode="numeric" placeholder="any"></label>
  <label class="field"><span>Reviews at most</span><input data-f="maxReviews" inputmode="numeric" placeholder="any"></label>
  <label class="field"><span>Rating at least</span><input data-f="minRating" inputmode="decimal" placeholder="any"></label>
  <label class="field"><span>Rating at most</span><input data-f="maxRating" inputmode="decimal" placeholder="any"></label>
  <label class="field"><span>Website</span><select data-f="website"><option value="any">Any</option><option value="has">Has a website</option><option value="none">No website</option></select></label>
  <label class="field"><span>Phone</span><select data-f="phone"><option value="has">Has a phone</option><option value="any">Any</option></select></label>
  <label class="field"><span>Google profile</span><select data-f="claimed"><option value="any">Any</option><option value="claimed">Claimed</option><option value="unclaimed">Not claimed</option></select></label>
  <label class="field"><span>Category contains</span><input data-f="category" placeholder="roof, gutter"></label>
  <label class="field"><span>Skip names with</span><input data-f="exclude" placeholder="home depot, lowe's"></label>
</div>`;
const readFilters = (root) => cleanFilters(Object.fromEntries($$('[data-f]', root).map((el) => [el.dataset.f, el.value])));
const setFilters = (root, f) => { const c = cleanFilters(f); $$('[data-f]', root).forEach((el) => { el.value = c[el.dataset.f] ?? ''; }); };

export async function finderPage(app, user, jobId = '') {
  const view = staffShell(app, user, 'finder');
  return jobId ? jobPage(view, jobId) : homePage(view);
}

// ---------- the list of searches and the new search form ----------
async function homePage(view) {
  view.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api('/api/finder'); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  let size = 5;
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Sell</p><h1>Lead finder</h1></div></div>
    <p class="small muted" style="margin:-8px 0 16px">Finds every business for a keyword in an area, straight from Google Maps. Big areas are split into map views so you get past Google's 100 result cap, repeats are removed, and nothing is added to the Pipeline until you say so (or turn on auto add). About $0.002 per search.</p>
    ${d.demo ? '<div class="card" style="border-color:#E8A33D;margin-bottom:14px">Demo mode: DataForSEO is not connected, so these are made up businesses. Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Cloudflare for real ones.</div>' : ''}
    <div class="card" id="fnew"><div class="card-head"><h3>New search</h3></div>
      <div class="fform">
        <label class="field"><span>Keywords, one per line</span><textarea id="fkw" rows="3" placeholder="roofing contractor&#10;roofer"></textarea></label>
        <label class="field"><span>Areas, one per line (city, state or ZIP)</span><textarea id="far" rows="3" placeholder="Miami, FL&#10;Fort Lauderdale, FL&#10;33139"></textarea></label>
      </div>
      <p class="small muted" style="margin:10px 0 6px"><b>How thorough</b></p>
      <div class="seg" id="fcov">${COVERAGE.map((c) => `<button type="button" data-size="${c.size}" class="${c.size === size ? 'is-on' : ''}">${esc(c.label)}</button>`).join('')}</div>
      <p class="small muted" id="fcovx" style="margin:6px 0 0"></p>
      <div class="row" style="margin-top:12px;gap:14px">
        <label class="field" style="flex:0 0 170px"><span>Reach from the middle</span><select id="frad"><option value="">Fit each place</option>${[2, 3, 5, 8, 12, 20].map((m) => `<option value="${m}">${m} miles</option>`).join('')}</select></label>
        <label class="field" style="flex:1 1 220px"><span>Tag for the leads</span><input id="ftag" placeholder="e.g. Miami roofers Nov"></label>
      </div>
      <details class="fold" style="margin-top:12px"><summary><span>Filters</span></summary><div class="fold-body"><p class="small muted" style="margin-top:0">Used by auto add, and as the starting point when you look at the results. You can change them there.</p>${filterHtml()}</div></details>
      <label class="row small" style="gap:8px;margin-top:12px"><input type="checkbox" id="fauto"> Add everything that matches the filters to the Pipeline when the search finishes</label>
      <div class="row" style="margin-top:14px;justify-content:space-between;align-items:center"><span class="small" id="fest"></span><button class="btn btn-primary" id="fgo">Find leads</button></div>
      <p class="err-text small" id="ferr" hidden></p>
    </div>
    <h3 style="margin:22px 0 10px">Searches</h3><div id="fjobs"></div>
`;
  setFilters($('#fnew', view), {});
  const est = () => {
    const e = estimate({ areas: parseAreas($('#far', view).value, 99).length, size, keywords: parseKeywords($('#fkw', view).value, 99).length });
    $('#fest', view).innerHTML = e.requests ? `${num(e.requests)} searches, about <b>${money(e.cost)}</b>${e.tooBig ? ` <span class="err-text">One search can run up to ${num(MAX_REQUESTS)}. Use fewer areas or keywords, or a smaller coverage.</span>` : ''}` : 'Type keywords and areas to see the cost.';
    $('#fcovx', view).textContent = COVERAGE.find((c) => c.size === size)?.what || '';
  };
  est();
  $('#fnew', view).addEventListener('input', est);
  $('#fcov', view).addEventListener('click', (e) => {
    const b = e.target.closest('[data-size]'); if (!b) return;
    size = Number(b.dataset.size);
    $$('#fcov button', view).forEach((x) => x.classList.toggle('is-on', x === b));
    est();
  });
  $('#fgo', view).addEventListener('click', async (e) => {
    const err = $('#ferr', view); err.hidden = true;
    busy(e.currentTarget, true, 'Starting');
    try {
      const r = await api('/api/finder/jobs', { method: 'POST', body: { keywords: $('#fkw', view).value, areas: $('#far', view).value, size, radius: $('#frad', view).value || 'auto', tag: $('#ftag', view).value, autoAdd: $('#fauto', view).checked, filters: readFilters($('#fnew', view)) } });
      toast('Search started');
      location.hash = `#/finder/${r.job.id}`;
    } catch (x) { err.textContent = x.message; err.hidden = false; busy(e.currentTarget, false); }
  });

  let jobs = d.jobs;
  const card = (j) => {
    const [label, tone] = STATUS[j.status] || [j.status, 'gray'];
    return `<div class="card fj" data-id="${esc(j.id)}"><div class="card-head"><div><h3 style="margin:0"><a href="#/finder/${esc(j.id)}">${esc(j.name)}</a></h3>
        <p class="small muted" style="margin:2px 0 0">${esc(j.keywords.join(', '))} · ${esc(j.areas.map((a) => a.label).join(' · '))} · ${ago(j.createdAt)}</p></div><span class="badge ${tone}">${label}</span></div>
      <div class="progress"><span style="width:${j.pct}%"></span></div>
      <div class="row small" style="gap:16px;margin-top:8px"><span><b>${num(j.found)}</b> found</span><span><b>${num(j.added)}</b> in the Pipeline</span><span>${num(j.done)} of ${num(j.total)} searches</span><span>${money(j.cost)}</span></div>
      ${j.error ? `<p class="err-text small" style="margin:8px 0 0">${esc(j.error)}</p>` : ''}
      <div class="row" style="margin-top:10px"><a class="btn btn-primary btn-sm" href="#/finder/${esc(j.id)}">Open</a>
        ${active(j) ? '<button class="btn btn-ghost btn-sm" data-act="stop">Pause</button>' : j.done < j.total ? '<button class="btn btn-ghost btn-sm" data-act="resume">Resume</button>' : ''}
        <button class="btn btn-ghost btn-sm" data-act="del">Delete</button></div></div>`;
  };
  const paint = () => {
    $('#fjobs', view).innerHTML = jobs.length ? `<div class="fj-grid">${jobs.map(card).join('')}</div>` : '<p class="muted">No searches yet. Your first one will show up here.</p>';
  };
  paint();
  $('#fjobs', view).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.closest('.fj').dataset.id;
    try {
      if (b.dataset.act === 'del') {
        if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Sure? Click again'; return; }
        await api(`/api/finder/jobs/${id}`, { method: 'DELETE' }); jobs = jobs.filter((j) => j.id !== id);
      } else { const r = await api(`/api/finder/jobs/${id}/${b.dataset.act}`, { method: 'POST' }); jobs = jobs.map((j) => (j.id === id ? r.job : j)); }
      paint();
    } catch (x) { toast(x.message, true); }
  });
  let busyTick = false;
  const timer = setInterval(async () => {
    if (!document.body.contains(view)) { clearInterval(timer); return; }
    if (busyTick || !jobs.some(active)) return;
    busyTick = true;
    try { const r = await api('/api/finder/tick', { method: 'POST' }); const by = new Map(r.jobs.map((j) => [j.id, j])); jobs = jobs.map((j) => by.get(j.id) || j); paint(); } catch { /* try again */ }
    busyTick = false;
  }, 5000);
}

// ---------- one search: progress, filters, results ----------
async function jobPage(view, id) {
  view.innerHTML = '<div class="skeleton"></div>';
  let job, rows = [], capped = false, total = 0;
  const loadResults = async () => { const r = await api(`/api/finder/jobs/${id}/results`); job = r.job; rows = r.results; capped = r.capped; total = r.total; };
  try { await loadResults(); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p><a href="#/finder">Back to the lead finder</a>`; return; }
  let f = cleanFilters(job.filters);
  let q = '', sort = 'reviews_desc', shown = 100;
  const picked = new Set();
  const SORTS = { reviews_desc: ['Most reviews', (a, b) => (b.reviews || 0) - (a.reviews || 0)], reviews_asc: ['Fewest reviews', (a, b) => (a.reviews || 0) - (b.reviews || 0)], rating_desc: ['Highest rating', (a, b) => (b.rating || 0) - (a.rating || 0)], rating_asc: ['Lowest rating', (a, b) => (a.rating ?? 9) - (b.rating ?? 9)], name: ['Name', (a, b) => a.title.localeCompare(b.title)] };

  view.innerHTML = `<div class="page-head"><div><p class="eyebrow"><a href="#/finder">Lead finder</a></p><h1 id="jt"></h1></div><div class="row" id="jact"></div></div>
    <div id="jprog"></div><div class="stats" id="jstats"></div>
    <div class="card"><div class="card-head"><h3>Filters</h3><span class="small muted" id="jcount"></span></div>${filterHtml()}
      <div class="row" style="margin-top:10px;gap:12px"><label class="field" style="flex:1 1 200px"><span>Search the list</span><input id="jq" placeholder="name, city, phone"></label>
        <label class="field" style="flex:0 0 180px"><span>Sort</span><select id="jsort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></label></div></div>
    <div class="card" style="margin-top:14px"><div class="row" id="jbar" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"></div>
      <div class="tbl-wrap" style="margin-top:10px"><table class="tbl sheet"><thead><tr><th style="width:30px"><input type="checkbox" id="jall" title="Pick everything shown that is not in the Hub yet"></th><th>Business</th><th>Category</th><th>Phone</th><th>Website</th><th class="n">Rating</th><th class="n">Reviews</th><th>City</th><th>Status</th><th>Email</th><th>Owner</th></tr></thead><tbody id="jrows"></tbody></table></div>
      <div class="row" style="justify-content:center;margin-top:10px"><button class="btn btn-ghost" id="jmore" hidden>Show more</button></div>
      <p class="small muted" id="jnote" style="margin:10px 0 0"></p></div>`;
  setFilters(view, f);

  const ST = { new: ['New', ''], added: ['Added', ''], inhub: ['In the Hub', 'gray'], dnc: ['Do not call', 'bad'], nophone: ['No phone', 'gray'] };
  const visible = () => rows.filter((r) => passes(r, f) && (!q || [r.title, r.city, r.phone, r.category, r.website].some((v) => String(v || '').toLowerCase().includes(q)))).sort(SORTS[sort][1]);
  const addable = (list) => list.filter((r) => r.st === 'new');

  const drawTop = () => {
    const [label, tone] = STATUS[job.status] || [job.status, 'gray'];
    $('#jt', view).innerHTML = `${esc(job.name)} <span class="badge ${tone}" style="vertical-align:middle;font-size:12px">${label}</span>`;
    $('#jact', view).innerHTML = `${active(job) ? '<button class="btn btn-ghost" data-a="stop">Pause</button>' : job.done < job.total ? '<button class="btn btn-ghost" data-a="resume">Resume</button>' : ''}<button class="btn btn-ghost" data-a="refresh">Refresh</button>`;
    $('#jprog', view).innerHTML = active(job) || job.status === 'failed' || job.status === 'stopped' ? `<div class="card" style="margin-bottom:14px"><div class="progress"><span style="width:${job.pct}%"></span></div>
      <p class="small" style="margin:8px 0 0">${num(job.done)} of ${num(job.total)} searches · ${money(job.cost)} so far${job.errors ? ` · ${num(job.errors)} failed` : ''}${active(job) ? '. Keep this page open to finish faster. It also runs on its own in the background.' : ''}</p>${job.error ? `<p class="err-text small" style="margin:6px 0 0">${esc(job.error)}</p>` : ''}</div>` : (job.error ? `<p class="err-text">${esc(job.error)}</p>` : '');
  };
  const drawStats = () => {
    const now = visible();
    const c = (st) => rows.filter((r) => r.st === st).length;
    $('#jstats', view).innerHTML = [['Found', total], ['Match the filters', now.length], ['New', c('new')], ['In the Hub', c('inhub') + c('added') + c('dnc')], ['Cost', money(job.cost)]]
      .map(([l, v]) => `<div class="stat"><div class="stat-num">${typeof v === 'number' ? num(v) : v}</div><div class="stat-label">${l}</div></div>`).join('');
    $('#jcount', view).textContent = `${num(now.length)} of ${num(rows.length)} shown`;
  };
  const drawRows = () => {
    const list = visible();
    $('#jrows', view).innerHTML = list.slice(0, shown).map((r) => {
      const [sl, st] = ST[r.st] || [r.st, 'gray'];
      const dom = r.website ? String(r.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '') : '';
      return `<tr data-k="${esc(r.key)}"><td>${r.st === 'new' ? `<input type="checkbox" data-pick${picked.has(r.key) ? ' checked' : ''}>` : ''}</td>
        <td><b>${esc(r.title)}</b>${r.claimed === false ? ' <span class="small muted">· not claimed</span>' : ''}</td><td class="small">${esc(r.category)}</td><td>${esc(r.phone)}</td>
        <td>${dom ? `<a href="${esc(r.website)}" target="_blank" rel="noopener">${esc(dom)}</a>` : '<span class="muted">none</span>'}</td>
        <td class="n">${r.rating != null ? r.rating.toFixed(1) : ''}</td><td class="n">${num(r.reviews)}</td><td>${esc(r.city)}</td>
        <td>${r.lead_id ? `<a class="badge ${st}" href="#/pipeline/${esc(r.lead_id)}">${sl}</a>` : `<span class="badge ${st}">${sl}</span>`}</td><td class="small">${esc(r.email || '')}</td><td class="small">${esc(r.owner_name || '')}</td></tr>`;
    }).join('') || '<tr><td colspan="11" class="muted" style="padding:18px">Nothing matches yet.</td></tr>';
    $('#jmore', view).hidden = list.length <= shown;
    $('#jmore', view).textContent = `Show more (${num(list.length - shown)} left)`;
    $('#jall', view).checked = false;
    $('#jnote', view).textContent = `${capped ? `Showing the first ${num(rows.length)} of ${num(total)} found. ` : ''}After you add them, emails, owner names and social links fill in on their own in the Pipeline (Data column). Reload the list to see them here.`;
  };
  const drawBar = () => {
    const list = visible(), canAdd = addable(list);
    const n = picked.size;
    $('#jbar', view).innerHTML = `<div class="row small" style="gap:8px">${n ? `<b>${num(n)} picked</b> <button class="btn btn-ghost btn-sm" data-a="clear">Clear</button>` : `<span class="muted">Tick businesses, or add everything that matches.</span>`}</div>
      <div class="row" style="gap:8px"><button class="btn btn-ghost" data-a="csv">Download CSV (${num(list.length)})</button>
        <button class="btn btn-primary" data-a="add"${(n ? n : canAdd.length) ? '' : ' disabled'}>${n ? `Add ${num(n)} to the Pipeline` : `Add all ${num(canAdd.length)} new to the Pipeline`}</button></div>`;
  };
  const draw = () => { drawTop(); drawStats(); drawRows(); drawBar(); };
  draw();

  $('#jrows', view).addEventListener('change', (e) => {
    const cb = e.target.closest('[data-pick]'); if (!cb) return;
    const k = cb.closest('tr').dataset.k;
    if (cb.checked) picked.add(k); else picked.delete(k);
    drawBar();
  });
  $('#jall', view).addEventListener('change', (e) => {
    const list = visible().slice(0, shown);
    for (const r of addable(list)) { if (e.target.checked) picked.add(r.key); else picked.delete(r.key); }
    drawRows(); $('#jall', view).checked = e.target.checked; drawBar();
  });
  const refilter = () => { f = readFilters(view); q = $('#jq', view).value.trim().toLowerCase(); sort = $('#jsort', view).value; shown = 100; drawStats(); drawRows(); drawBar(); };
  view.addEventListener('input', (e) => { if (e.target.matches('[data-f], #jq')) refilter(); });
  view.addEventListener('change', (e) => { if (e.target.matches('[data-f], #jsort')) refilter(); });
  $('#jmore', view).addEventListener('click', () => { shown += 200; drawRows(); });

  view.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    try {
      if (a === 'clear') { picked.clear(); drawRows(); drawBar(); }
      else if (a === 'refresh') { busy(b, true, 'Loading'); await loadResults(); draw(); }
      else if (a === 'stop' || a === 'resume') { job = (await api(`/api/finder/jobs/${id}/${a}`, { method: 'POST' })).job; drawTop(); drawBar(); }
      else if (a === 'csv') {
        const list = visible();
        const blob = new Blob([csvText(list)], { type: 'text/csv' });
        const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = `${job.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'leads'}.csv`; el.click(); setTimeout(() => URL.revokeObjectURL(el.href), 5000);
      } else if (a === 'add') {
        busy(b, true, 'Adding');
        const body = picked.size ? { keys: [...picked] } : { filters: f };
        const r = await api(`/api/finder/jobs/${id}/add`, { method: 'POST', body });
        const why = Object.entries(r.skippedBy || {}).filter(([, v]) => v).map(([k, v]) => `${v} ${{ phone: 'same phone', website: 'same website', name: 'same name', invalid: 'no phone', dnc: 'do not call' }[k] || k}`).join(', ');
        toast(`${num(r.imported)} added to the Pipeline${r.skipped ? `, ${num(r.skipped)} skipped (${why})` : ''}`);
        picked.clear(); await loadResults(); draw();
      }
    } catch (x) { toast(x.message, true); busy(b, false); }
  });

  // While the search is running, push it along and refresh the numbers (the cron also does this every minute).
  let ticking = false, lastRows = 0;
  const timer = setInterval(async () => {
    if (!document.body.contains(view)) { clearInterval(timer); return; }
    if (ticking || !active(job)) return;
    ticking = true;
    try {
      const t = await api('/api/finder/tick', { method: 'POST' });
      const mine = t.jobs.find((j) => j.id === id);
      if (mine) { job = mine; drawTop(); }
      if (!active(job) || job.found - lastRows >= 60) { lastRows = job.found; await loadResults(); draw(); }
    } catch { /* try again */ }
    ticking = false;
  }, 5000);
}

