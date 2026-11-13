// Lead finder: our own Outscraper style Google Maps scraper, owners only. Type keywords and areas, it covers each area with a grid of
// map views, removes repeats, and lists the businesses here. Filter them, download a CSV, or add them to the Pipeline, where the
// background scrub fills in emails, owner names and socials. The server does the searching, so this works the same on an iPad.
import { $, $$, esc, api, toast, busy } from './core.js';
import { staffShell } from './shell.js';
import { COVERAGE, estimate, MAX_KEYWORDS, MAX_REQUESTS, MAX_OSM_REQUESTS, MAX_AREAS, MAX_VIEWS, customSize, SOURCES, cleanFilters, csvText, passes } from '/js/finder.js';
const DIALS_PER_DAY = 200; // how many businesses the team can call in a day, for the "days of calls" estimate
import { multiSelect } from './multiselect.js';
import { CITIES, DEFAULT_TOP, chunkAreas } from '/js/cities.js';
import { STATES, NEW_FILING_STATES } from '/js/registries.js';
import { TARGET_INDUSTRIES } from '/js/leadintel.js';
import { directoryLinks } from '/js/freedata.js';
import { mountPlays } from './plays.js';
import { planFor, readFilters as readFilterGuide, readIndustries, southFloridaAreas, SOUTH_FLORIDA, weakness, gapLabel } from '/js/plays.js';
const MINE_KEY = 'rw-finder-industries';
const mineRead = () => { try { return JSON.parse(localStorage.getItem(MINE_KEY) || '[]'); } catch { return []; } };
const mineSave = (v) => { try { localStorage.setItem(MINE_KEY, JSON.stringify(v)); } catch { /* private window: nothing saved */ } };

const num = (n) => Number(n || 0).toLocaleString('en-US');
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const STATUS = { queued: ['Waiting', 'gray'], running: ['Searching', ''], done: ['Done', ''], failed: ['Needs attention', 'bad'], stopped: ['Paused', 'warn'] };
const active = (j) => j.status === 'queued' || j.status === 'running';
const ago = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };

// The filter boxes, used when starting a search and when looking through the results.
const opts = (list) => list.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
const REVIEWS_MIN = [['', 'Any'], ['1', 'At least 1'], ['5', 'At least 5'], ['10', 'At least 10'], ['25', 'At least 25'], ['50', 'At least 50'], ['100', 'At least 100']];
const REVIEWS_MAX = [['', 'Any'], ['10', 'Up to 10'], ['25', 'Up to 25'], ['50', 'Up to 50'], ['100', 'Up to 100'], ['250', 'Up to 250'], ['500', 'Up to 500']];
const RATING_MIN = [['', 'Any'], ['3', '3.0 or more'], ['3.5', '3.5 or more'], ['4', '4.0 or more'], ['4.3', '4.3 or more'], ['4.5', '4.5 or more'], ['4.8', '4.8 or more']];
const RATING_MAX = [['', 'Any'], ['3.5', '3.5 or less'], ['4', '4.0 or less'], ['4.3', '4.3 or less'], ['4.5', '4.5 or less'], ['4.8', '4.8 or less']];
// Big national chains a lead list often has, skipped with one tick each.
const CHAINS = ['Home Depot', "Lowe's", 'Walmart', 'Target', 'Best Buy', 'Costco', "Sam's Club", 'Menards', 'Ace Hardware', 'Sherwin-Williams', 'Staples', 'Harbor Freight'];
const FILTER_SETS = {
  category: { options: TARGET_INDUSTRIES.map((x) => ({ value: x.keyword, label: x.label })), label: 'Any category' },
  exclude: { options: CHAINS.map((x) => ({ value: x, label: x })), label: 'Keep all' },
};
const filterHtml = () => `<div class="fgrid">
  <label class="field"><span>Reviews at least</span><select data-f="minReviews">${opts(REVIEWS_MIN)}</select></label>
  <label class="field"><span>Reviews at most</span><select data-f="maxReviews">${opts(REVIEWS_MAX)}</select></label>
  <label class="field"><span>Rating at least</span><select data-f="minRating">${opts(RATING_MIN)}</select></label>
  <label class="field"><span>Rating at most</span><select data-f="maxRating">${opts(RATING_MAX)}</select></label>
  <label class="field"><span>Website</span><select data-f="website"><option value="any">Any</option><option value="has">Has a website</option><option value="none">No website</option></select></label>
  <label class="field"><span>Phone</span><select data-f="phone"><option value="has">Has a phone</option><option value="any">Any</option></select></label>
  <label class="field"><span>Google profile</span><select data-f="claimed"><option value="any">Any</option><option value="claimed">Claimed</option><option value="unclaimed">Not claimed</option></select></label>
  <div class="field"><span>Category</span><div data-ms="category"></div><input type="hidden" data-f="category"></div>
  <div class="field"><span>Skip big chains</span><div data-ms="exclude"></div><input type="hidden" data-f="exclude"></div>
</div>`;
// Tick-box menus for the list filters. Each writes its picks into a hidden field, so reading and refiltering work as before.
function mountFilters(root) {
  $$('[data-ms]', root).forEach((host) => {
    if (host._ms) return;
    const key = host.dataset.ms;
    const hidden = root.querySelector(`input[data-f="${key}"]`);
    host._ms = multiSelect(host, { ...FILTER_SETS[key], onChange: (vals) => { hidden.value = vals.join(', '); hidden.dispatchEvent(new Event('change', { bubbles: true })); } });
  });
}
const readFilters = (root) => cleanFilters(Object.fromEntries($$('[data-f]', root).map((el) => [el.dataset.f, el.value])));
const setFilters = (root, f) => {
  const c = cleanFilters(f);
  $$('[data-f]', root).forEach((el) => { el.value = c[el.dataset.f] ?? ''; });
  $$('[data-ms]', root).forEach((host) => host._ms?.set(String(c[host.dataset.ms] || '').split(',').map((x) => x.trim()).filter(Boolean)));
};

export async function finderPage(app, user, jobId = '') {
  const view = staffShell(app, user, 'finder');
  return jobId ? jobPage(view, jobId) : homePage(view);
}

// The step-by-step search form (dropdowns only, nothing to type but an optional keyword or ZIP), the list of searches, and the new businesses card.
const COST_IC = (t) => `<span class="cost-ic" title="${esc(t)}" aria-label="${esc(t)}">$</span>`;
const FREE_IC = '<span class="cost-ic free" title="No cost" aria-label="No cost">Free</span>';
const STEP = (n, title, sub = '') => `<div class="fstep"><span class="fstep-n">${n}</span><div><h3>${title}</h3>${sub ? `<p class="small muted">${sub}</p>` : ''}</div></div>`;
const stateNameOf = (c) => STATES.find((x) => x[0] === c)?.[1] || c;
const chunkList = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const cityLabel = (c, code) => `${c}, ${code}`;
const citiesOf = (codes) => codes.flatMap((code) => (CITIES[code] || []).map((c) => ({ value: cityLabel(c, code), label: cityLabel(c, code) })));
const topCities = (codes, n) => codes.flatMap((code) => (CITIES[code] || []).slice(0, n).map((c) => cityLabel(c, code)));

async function homePage(view) {
  view.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api('/api/finder'); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  let source = d.free ? 'osm' : 'google';
  let size = source === 'osm' ? 3 : 5;
  const OSM_COVERAGE = [{ size: 1, label: 'One spot', what: 'One search around the middle of each area. Fastest.' }, { size: 3, label: '3 x 3 spots', what: 'Nine searches per area, so you get past the busiest streets.' }, { size: 5, label: '5 x 5 spots', what: 'Twenty five searches per area. Best for a big city.' }];
  const covers = () => (source === 'osm' ? OSM_COVERAGE : COVERAGE);
  let custom = null; // views per place when Custom is chosen, otherwise null
  const topN = () => Number($('#ftop', view).value) || DEFAULT_TOP;

  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Sell</p><h1>Lead finder</h1></div></div>
    <p class="small muted" style="margin:-8px 0 16px">Pick industries, states and cities from the lists, then start. Google Maps gives the most (ratings, reviews, claimed profiles) at about $0.002 a search. OpenStreetMap is free but thinner. Nothing is added to the Pipeline until you say so (or turn on auto add).</p>
    ${d.free ? '<div class="card" style="border-color:#23B07E;margin-bottom:14px"><b>Free lead data mode is on.</b> Only OpenStreetMap searches run, nothing is spent. Turn it off in Settings, Lead data mode, to use Google Maps again.</div>' : ''}
    ${d.demo ? '<div class="card" style="border-color:#E8A33D;margin-bottom:14px">Demo mode: DataForSEO is not connected, so these are made up businesses. Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Cloudflare for real ones.</div>' : ''}
    <div id="fplays"></div>
    <div class="card" id="fnew" style="margin-top:14px">
      ${STEP(1, `Industries ${COST_IC('Each industry is its own search in every place')}`, 'Pick the industries you work with. Choose as many as you like. They run in groups of 10 per search.')}
      <div class="guide" id="g1"></div>
      <div id="findbox"></div>
      <label class="field" style="margin-top:10px"><span>Other keyword (optional)</span><input id="fextra" placeholder="e.g. pool cleaning"></label>

      ${STEP(2, 'Where', 'Pick states, then the cities in them. Each state brings its biggest cities, already ticked.')}
      <div class="guide" id="g2">Home turf first: calls to Miami and Fort Lauderdale are local and meetings are easy. Start with three cities, then widen when a play books audits. <button type="button" class="btn btn-ghost btn-sm" id="fsfl">Use South Florida (12 cities)</button></div>
      <div class="row" style="gap:12px;align-items:flex-end;flex-wrap:wrap">
        <div id="fstatebox" style="flex:1 1 260px;min-width:0"></div>
        <label class="field" style="flex:0 0 160px"><span>Cities per state ${COST_IC('Each city is searched for every industry, so more cities cost more')}</span><select id="ftop">${[3, 5, 10, 20, 50].map((n) => `<option value="${n}"${n === DEFAULT_TOP ? ' selected' : ''}>${n === 50 ? 'All' : `Top ${n}`}</option>`).join('')}</select></label>
      </div>
      <div id="fcitybox" style="margin-top:12px"></div>
      <label class="field" style="margin-top:12px"><span>ZIP codes (optional, comma separated)</span><input id="fzip" placeholder="33139, 33301"></label>

      ${STEP(3, 'How to search', `Paid choices carry a ${COST_IC('Costs money')} mark. Amounts are estimates before you start.`)}
      <div class="seg" id="fsrc">${SOURCES.map(([k, l]) => `<button type="button" data-src="${k}" class="${k === source ? 'is-on' : ''}"${k === 'google' && d.free ? ' disabled title="Free lead data mode is on"' : ''}>${esc(l)} ${k === 'google' ? COST_IC('Paid per search') : FREE_IC}</button>`).join('')}</div>
      <p class="small muted" id="fsrcx" style="margin:6px 0 10px"></p>
      <div class="seg" id="fcov"></div>
      <p class="small muted" id="fcovx" style="margin:6px 0 0"></p>
      <div id="fcustom" class="row" style="gap:12px;align-items:flex-end;margin-top:10px" hidden><label class="field" style="flex:0 0 220px"><span>Map views per place (1 to ${MAX_VIEWS})</span><input id="fviews" type="number" min="1" max="${MAX_VIEWS}" value="4" inputmode="numeric"></label><p class="small muted" style="margin:0;flex:1 1 300px">One view is one map search at the middle of the place. More views add the spots around it, nearest first. Each view costs about $0.002 per industry.</p></div>

      <details class="fold" style="margin-top:14px" id="fadv"><summary><span>Advanced settings</span></summary><div class="fold-body">
        <div class="row" style="gap:14px;flex-wrap:wrap">
          <label class="field" style="flex:0 0 170px"><span>Reach from the middle</span><select id="frad"><option value="">Fit each place</option>${[2, 3, 5, 8, 12, 20].map((m) => `<option value="${m}">${m} miles</option>`).join('')}</select></label>
          <label class="field" style="flex:0 0 200px"><span>Stop if it would cost more than</span><select id="fcap">${[[0, 'No limit'], [1, '$1'], [5, '$5'], [10, '$10'], [25, '$25'], [50, '$50']].map(([v, l]) => `<option value="${v}"${v === 10 ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field" style="flex:1 1 220px"><span>Tag for the leads</span><input id="ftag" placeholder="e.g. Miami roofers Nov"></label>
        </div>
        <label class="row small" style="gap:8px;margin-top:12px"><input type="checkbox" id="fauto"> Add everything that matches the filters to the Pipeline when the search finishes</label>
        <details class="fold" style="margin-top:12px"><summary><span>Filters</span></summary><div class="fold-body"><p class="small muted" style="margin-top:0">Used by auto add, and as the starting point when you look at the results. You can change them there.</p>${filterHtml()}</div></details>
      </div></details>

      <div class="guide" id="g4"></div>
      <div class="fsum" id="fsum"></div>
      <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn btn-primary" id="fgo">Start search</button></div>
      <p class="err-text small" id="ferr" hidden></p>
    </div>
    ${d.spendPaused ? `<p class="bad-text" style="margin:18px 0 0"><b>Google Maps searches are paused for today.</b> Spending reached the $${esc(String(d.spendPaused.cap))} daily limit. Raise it in Settings, Spending and background jobs, or wait until tomorrow. OpenStreetMap searches are not affected.</p>` : ''}
    <h3 style="margin:22px 0 10px">Searches</h3><div id="fjobs"></div>
`;
  mountFilters($('#fnew', view));
  setFilters($('#fnew', view), {});

  // Dropdowns: industries (remembered on this device), states, cities.
  const mine = mineRead();
  const indOpts = TARGET_INDUSTRIES.map((x) => ({ value: x.keyword, label: x.label }));
  const ind = multiSelect($('#findbox', view), { options: indOpts, selected: mine.filter((k) => indOpts.some((o) => o.value === k)), label: 'Choose industries', onChange: (v) => { mineSave(v); est(); } });
  let prevStates = ['FL'];
  const stateSel = multiSelect($('#fstatebox', view), { options: STATES.map(([c, n]) => ({ value: c, label: n })), selected: prevStates, label: 'Choose states', onChange: () => {
    const now = stateSel.get();
    const added = now.filter((c) => !prevStates.includes(c));
    prevStates = now;
    cities.setOptions(citiesOf(now), topCities(added, topN()));
    est();
  } });
  const cities = multiSelect($('#fcitybox', view), { options: citiesOf(prevStates), selected: topCities(prevStates, topN()), label: 'Choose cities', onChange: () => est() });
  $('#ftop', view).addEventListener('change', () => { cities.set(topCities(stateSel.get(), topN())); est(); });

  // What we search: industries and an optional keyword, in groups of 10. Areas: picked cities plus ZIPs.
  const kwAll = () => [...new Set([...ind.get(), ...$('#fextra', view).value.split(',').map((x) => x.trim()).filter(Boolean)])];
  const areasAll = () => [...cities.get(), ...$('#fzip', view).value.split(',').map((x) => x.trim()).filter(Boolean)];
  const plan = () => {
    const kws = kwAll();
    const all = areasAll();
    const cap = source === 'osm' ? MAX_OSM_REQUESTS : MAX_REQUESTS;
    const jobs = [];
    if (all.length) {
      for (const group of chunkList(kws, MAX_KEYWORDS)) {
        const perArea = estimate({ areas: 1, size, keywords: group.length, source, views: custom }).requests || 1;
        const perJob = Math.max(1, Math.min(MAX_AREAS, Math.floor(cap / perArea)));
        for (const chunk of chunkAreas(all, perJob)) jobs.push({ keywords: group, areas: chunk });
      }
    }
    return { kws, all, jobs };
  };
  // Views per place and cost per place, shown on each coverage choice.
  const viewsOf = (sz) => estimate({ areas: 1, size: sz, keywords: 1, source }).requests || 1;
  // Leads per map view from this person's finished searches on the same source. Null until there is history.
  const leadsPerView = () => {
    const past = d.jobs.filter((j) => j.source === source && j.done > 0);
    const views = past.reduce((s, j) => s + j.done, 0);
    const found = past.reduce((s, j) => s + j.found, 0);
    return views ? { per: found / views, n: past.length } : null;
  };
  // Short guide lines above the options: what the current picks will likely give you.
  const drawGuides = () => {
    const ul = (list) => `<ul>${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    const g1 = $('#g1', view), g4 = $('#g4', view);
    if (g1) g1.innerHTML = `<b>What your picks tend to give you</b>${ul(readIndustries(kwAll()))}`;
    if (g4) g4.innerHTML = `<b>What these filters will likely give you</b>${ul(readFilterGuide(readFilters($('#fnew', view)), source))}`;
  };
  const est = () => {
    const pl = plan();
    const parts = pl.jobs.map((j) => estimate({ areas: j.areas.length, size, keywords: j.keywords.length, source, views: custom }));
    const requests = parts.reduce((s, e) => s + (e.requests || 0), 0);
    const cost = parts.reduce((s, e) => s + (e.cost || 0), 0);
    const tooBig = parts.some((e) => e.tooBig);
    const s = (n) => (n === 1 ? '' : 's');
    const cap = Number($('#fcap', view).value) || 0;
    const over = cap > 0 && source !== 'osm' && cost > cap;
    if (!pl.jobs.length) {
      $('#fsum', view).innerHTML = !pl.kws.length ? 'Pick at least one industry (or type a keyword).' : 'Pick at least one state and city, or add a ZIP code.';
      $('#fgo', view).disabled = true;
    } else {
      const hist = leadsPerView();
      const days = hist ? Math.max(1, Math.round((requests * hist.per) / DIALS_PER_DAY)) : 0;
      const leads = hist
        ? `about <b>${num(Math.round(requests * hist.per))}</b> businesses, about <b>${days}</b> day${days === 1 ? '' : 's'} of calls at ${DIALS_PER_DAY} a day (from your last ${hist.n} finished search${hist.n === 1 ? '' : 'es'}; an upper estimate, repeats not removed)`
        : 'not known yet. Your first finished search shows how many it finds.';
      $('#fsum', view).innerHTML = `
        <p class="small" style="margin:0 0 6px"><b>${pl.kws.length}</b> keyword${s(pl.kws.length)} × <b>${pl.all.length}</b> area${s(pl.all.length)} × <b>${custom ?? viewsOf(size)}</b> map view${(custom ?? viewsOf(size)) === 1 ? '' : 's'} = <b>${num(requests)}</b> searches${pl.jobs.length > 1 ? `, started as ${pl.jobs.length} jobs` : ''}</p>
        <p class="small" style="margin:0 0 6px">${source === 'osm' ? '<b>Cost: free</b>' : `${COST_IC('Costs money')} Cost: about <b>${money(cost)}</b>`}</p>
        <p class="small" style="margin:0">Leads: ${leads}</p>
        ${over ? `<p class="err-text small" style="margin:8px 0 0">This would cost about ${money(cost)}, over your ${money(cap)} limit. Use fewer places or a smaller coverage, or change the limit in Advanced settings.</p>` : ''}
        ${tooBig ? '<p class="err-text small" style="margin:8px 0 0">Too many searches for one job. Use a smaller coverage.</p>' : ''}`;
      $('#fgo', view).disabled = over || tooBig;
    }
    $('#fgo', view).textContent = source === 'osm' ? 'Start search (free)' : 'Start search';
    $('#fcovx', view).textContent = covers().find((c) => c.size === size)?.what || '';
    nfIndLine();
    drawGuides();
  };

  const drawCov = () => {
    if (!covers().some((c) => c.size === size)) size = source === 'osm' ? 3 : 5;
    $('#fcov', view).innerHTML = covers().map((c) => {
      const views = viewsOf(c.size);
      const per = estimate({ areas: 1, size: c.size, keywords: 1, source }).cost;
      const tag = source === 'osm' ? FREE_IC : COST_IC(`About ${money(per)} for each place, each industry`);
      return `<button type="button" data-size="${c.size}" class="${c.size === size ? 'is-on' : ''}" title="${esc(c.what)}">${esc(c.label)} <small class="muted">${views} views</small> ${tag}</button>`;
    }).join('') + (source === 'osm' ? '' : `<button type="button" data-size="custom" class="${custom != null ? 'is-on' : ''}" title="Choose how many map views each place gets">Custom</button>`);
    $$('#fsrc button', view).forEach((x) => x.classList.toggle('is-on', x.dataset.src === source));
    $('#fsrcx', view).textContent = SOURCES.find((x) => x[0] === source)?.[2] || '';
    $('#fcustom', view).hidden = custom == null;
  };
  drawCov(); est();
  $('#fzip', view).addEventListener('input', est);
  $('#fextra', view).addEventListener('input', est);
  $('#fcap', view).addEventListener('change', est);
  // While typing, only a whole number from 1 counts; an empty box keeps the last value. Leaving the box tidies it.
  $('#fviews', view).addEventListener('input', () => {
    const n = Math.round(Number($('#fviews', view).value));
    if (custom == null || !(n >= 1)) return;
    custom = Math.min(MAX_VIEWS, n);
    size = customSize(custom); drawCov(); est();
  });
  $('#fviews', view).addEventListener('change', () => { if (custom != null) $('#fviews', view).value = custom; });
  $('#fsrc', view).addEventListener('click', (e) => {
    const b = e.target.closest('[data-src]'); if (!b || b.disabled) return;
    source = b.dataset.src; size = source === 'osm' ? 3 : 5; drawCov(); est();
  });
  $('#fcov', view).addEventListener('click', (e) => {
    const b = e.target.closest('[data-size]'); if (!b) return;
    if (b.dataset.size === 'custom') {
      custom = Math.min(MAX_VIEWS, Math.max(1, Math.round(Number($('#fviews', view).value)) || 4));
      size = customSize(custom);
    } else { custom = null; size = Number(b.dataset.size); }
    drawCov(); est();
  });

  $('#fnew', view).addEventListener('change', (e) => { if (e.target.matches('[data-f]')) drawGuides(); });
  $('#fsfl', view).addEventListener('click', () => {
    prevStates = ['FL']; stateSel.set(['FL']);
    const sfl = southFloridaAreas(SOUTH_FLORIDA.length);
    const have = citiesOf(['FL']);
    cities.set([]); cities.setOptions([...have, ...sfl.filter((c) => !have.some((o) => o.value === c)).map((c) => ({ value: c, label: c }))], sfl);
    est();
  });

  // A play fills the whole form (trades, places, source, coverage, filters, tag, spend limit). Nothing is spent until Start search.
  const applyPlay = (play, budgetId, thenStart) => {
    source = play.source === 'osm' || d.free ? 'osm' : 'google';
    custom = null;
    let areas;
    if (play.mine) {
      size = covers().some((c) => c.size === play.size) ? play.size : (source === 'osm' ? 3 : 5);
      areas = play.areas;
    } else {
      const pl = planFor(play, budgetId);
      size = pl.size;
      areas = southFloridaAreas(pl.places);
    }
    const codes = [...new Set(areas.map((a) => String(a).split(',').pop().trim().toUpperCase()).filter((c) => STATES.some((x) => x[0] === c)))];
    const stateCodes = codes.length ? codes : ['FL'];
    prevStates = stateCodes; stateSel.set(stateCodes);
    const have = citiesOf(stateCodes);
    cities.set([]); cities.setOptions([...have, ...areas.filter((c) => !have.some((o) => o.value === c)).map((c) => ({ value: c, label: c }))], areas);
    ind.set(play.industries); $('#fextra', view).value = ''; $('#fzip', view).value = '';
    setFilters($('#fnew', view), play.filters);
    $('#ftag', view).value = `${play.name}, ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    $('#fauto', view).checked = false;
    drawCov(); est();
    // A spend limit just above this run's estimate, so a typo in the form cannot cost much more than the play said.
    const cost = plan().jobs.reduce((t, j) => t + estimate({ areas: j.areas.length, size, keywords: j.keywords.length, source, views: null }).cost, 0);
    const lim = [1, 5, 10, 25, 50].find((x) => x >= cost * 1.3) || 0;
    $('#fcap', view).value = String(lim); est();
    $('#fnew', view).scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(`${play.name}: form filled. Change anything, then Start search.`);
    if (thenStart && !$('#fgo', view).disabled) $('#fgo', view).click();
  };
  const snapshot = () => ({ industries: kwAll(), filters: readFilters($('#fnew', view)), source, size: custom ? customSize(custom) : size, areas: areasAll() });
  mountPlays($('#fplays', view), { apply: applyPlay, snapshot, freeMode: d.free });

  $('#fgo', view).addEventListener('click', async (e) => {
    const err = $('#ferr', view); err.hidden = true;
    const pl = plan();
    if (!pl.jobs.length) { err.textContent = 'Pick at least one industry, state and city.'; err.hidden = false; return; }
    busy(e.currentTarget, true, 'Starting');
    try {
      // Each job is its own search, run in turn, so no single search goes over the cap.
      const started = [];
      for (const job of pl.jobs) {
        const r = await api('/api/finder/jobs', { method: 'POST', body: { source, keywords: job.keywords.join('\n'), areas: job.areas.join('\n'), size, views: custom || undefined, radius: $('#frad', view).value || 'auto', tag: $('#ftag', view).value, autoAdd: $('#fauto', view).checked, filters: readFilters($('#fnew', view)) } });
        started.push(r.job.id);
      }
      toast(started.length > 1 ? `${started.length} searches started` : 'Search started');
      location.hash = `#/finder/${started[0]}`;
    } catch (x) { err.textContent = x.message; err.hidden = false; busy(e.currentTarget, false); }
  });

  // New businesses: filings in the last few months from the states that publish them (free). These have no phone, so research and call by hand.
  const newBox = document.createElement('div');
  newBox.className = 'card'; newBox.style.marginTop = '22px';
  newBox.innerHTML = `<div class="card-head"><h3>New businesses (state filings, free)</h3></div>
    <p class="small muted" style="margin:0 0 10px">Companies that just filed with the state, so they often need a website, a Google profile and marketing. Only ${NEW_FILING_STATES.map((c) => stateNameOf(c)).join(', ')} publish this for free. The filing does not show phone numbers or whether they have a Google listing, so check Google by hand (the links open the search).</p>
    <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
      <div id="nfstate" style="flex:1 1 240px;min-width:0"></div>
      <label class="field" style="flex:0 0 160px"><span>Filed in the last</span><select id="nfdays"><option value="30">30 days</option><option value="90" selected>90 days</option><option value="180">6 months</option><option value="365">1 year</option></select></label>
      <button class="btn btn-primary btn-sm" id="nfgo" type="button">Find new businesses</button>
    </div>
    <p class="small muted" id="nfind" style="margin:8px 0 0"></p>
    <div id="nfout" style="margin-top:12px"></div>`;
  $('#fjobs', view).parentElement.appendChild(newBox);
  const nfSel = multiSelect($('#nfstate', view), { options: NEW_FILING_STATES.map((c) => ({ value: c, label: stateNameOf(c) })), selected: ['CO'], label: 'Choose states' });
  function nfIndLine() {
    const el = $('#nfind', view); if (!el) return;
    const k = ind.get();
    el.textContent = `Industries: ${k.length ? k.join(', ') : 'none picked (all businesses). Pick industries above to narrow it.'}`;
  }
  nfIndLine();
  $('#nfgo', view).addEventListener('click', async (e) => {
    const states = nfSel.get();
    if (!states.length) return toast('Choose a state', true);
    busy(e.currentTarget, true, 'Searching');
    try {
      const q = new URLSearchParams({ states: states.join(','), days: $('#nfdays', view).value, industries: ind.get().join('|') });
      const r = await api(`/api/finder/new-filings?${q}`);
      const rows = r.filings;
      const link = (x) => directoryLinks({ business: x.name, city: x.city, state: x.state }).filter((l) => ['google', 'yelp'].includes(l.key)).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(' · ');
      $('#nfout', view).innerHTML = `<p class="small"><b>${num(r.count)}</b> filed in the last ${esc(r.days)} days${r.errors?.length ? ` · <span class="err-text">${r.errors.map((x) => `${x.state} could not be read (${esc(x.error)})`).join('; ')}</span>` : ''}</p>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Business</th><th>State</th><th>City</th><th>Filed</th><th>Status</th><th>Agent</th><th>Check Google</th></tr></thead><tbody>
        ${rows.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.state)}</td><td>${esc(x.city)}</td><td>${esc(x.filed)}</td><td class="small">${esc(x.status || '')}</td><td class="small">${esc(x.agent || '')}</td><td class="small">${link(x)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nothing filed in that time with those words.</td></tr>'}
        </tbody></table></div>
        ${rows.length ? '<div class="row" style="margin-top:8px"><button class="btn btn-ghost btn-sm" id="nfcsv" type="button">Download list (CSV)</button></div>' : ''}`;
      $('#nfcsv', view)?.addEventListener('click', () => {
        const head = ['business', 'state', 'city', 'filed', 'status', 'agent'];
        const body = rows.map((x) => [x.name, x.state, x.city, x.filed, x.status, x.agent].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
        const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv' })); el.download = 'new-businesses.csv'; el.click();
      });
    } catch (x) { toast(x.message, true); }
    busy(e.currentTarget, false);
  });

  let jobs = d.jobs;
  const card = (j) => {
    const [label, tone] = STATUS[j.status] || [j.status, 'gray'];
    return `<div class="card fj" data-id="${esc(j.id)}"><div class="card-head"><div><h3 style="margin:0"><a href="#/finder/${esc(j.id)}">${esc(j.name)}</a></h3>
        <p class="small muted" style="margin:2px 0 0">${esc(j.keywords.join(', '))} · ${esc(j.areas.map((a) => a.label).join(' · '))} · ${ago(j.createdAt)}</p></div><span class="badge ${tone}">${label}</span></div>
      <div class="progress"><span style="width:${j.pct}%"></span></div>
      <div class="row small" style="gap:16px;margin-top:8px"><span><b>${num(j.found)}</b> found</span><span><b>${num(j.added)}</b> in the Pipeline</span><span>${num(j.done)} of ${num(j.total)} searches</span><span>${j.source === 'osm' ? 'Free (OpenStreetMap)' : money(j.cost)}</span></div>
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
  view.innerHTML = '<div class="skeleton"></div><p class="small muted" id="jload" style="margin-top:10px">Loading the results</p>';
  let job, rows = [], capped = false, total = 0;
  // The results come a page at a time (a big search has thousands), so the server never does too much in one go.
  const MAX_ROWS = 40000;
  const loadResults = async (onPage) => {
    const out = [];
    let after = '', firstPage = true;
    for (;;) {
      const r = await api(`/api/finder/jobs/${id}/results?after=${encodeURIComponent(after)}`);
      if (firstPage) { job = r.job; total = r.total; firstPage = false; }
      out.push(...r.results);
      onPage?.(out.length, total);
      if (!r.next || out.length >= MAX_ROWS) { capped = Boolean(r.next); break; }
      after = r.next;
    }
    rows = out;
  };
  const loading = (n, t) => { const el = $('#jload', view); if (el) el.textContent = `Loading ${num(n)} of ${num(t)}`; };
  try { await loadResults(loading); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p><a href="#/finder">Back to the lead finder</a>`; return; }
  let f = cleanFilters(job.filters);
  let q = '', sort = 'weak_desc', shown = 100;
  // Profile gap (higher = needs more help = better prospect), worked out once per row. Follows the weakest first ranking of local SEO lead tools.
  const gapOf = (r) => (r._gap ||= weakness({ ...r, source: job.source }));
  const picked = new Set();
  const SORTS = { weak_desc: ['Weakest profile first (best prospects)', (a, b) => gapOf(b).score - gapOf(a).score || (b.reviews || 0) - (a.reviews || 0)], reviews_desc: ['Most reviews', (a, b) => (b.reviews || 0) - (a.reviews || 0)], reviews_asc: ['Fewest reviews', (a, b) => (a.reviews || 0) - (b.reviews || 0)], rating_desc: ['Highest rating', (a, b) => (b.rating || 0) - (a.rating || 0)], rating_asc: ['Lowest rating', (a, b) => (a.rating ?? 9) - (b.rating ?? 9)], name: ['Name', (a, b) => a.title.localeCompare(b.title)] };

  view.innerHTML = `<div class="page-head"><div><p class="eyebrow"><a href="#/finder">Lead finder</a></p><h1 id="jt"></h1></div><div class="row" id="jact"></div></div>
    <div id="jprog"></div><div class="stats" id="jstats"></div>
    <div class="card"><div class="card-head"><h3>Filters</h3><span class="small muted" id="jcount"></span></div>${filterHtml()}
      <div class="row" style="margin-top:10px;gap:12px"><label class="field" style="flex:1 1 200px"><span>Search the list</span><input id="jq" placeholder="name, city, phone"></label>
        <label class="field" style="flex:0 0 180px"><span>Sort</span><select id="jsort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></label></div></div>
    <div class="card" style="margin-top:14px"><div class="row" id="jbar" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"></div>
      <div class="tbl-wrap" style="margin-top:10px"><table class="tbl sheet"><thead><tr><th style="width:30px"><input type="checkbox" id="jall" title="Pick everything shown that is not in the Hub yet"></th><th>Business</th><th>Category</th><th>Phone</th><th>Website</th><th class="n" title="How much the profile needs help: no website, not claimed, few reviews, weak rating, few photos. Higher is a better prospect.">Gap</th><th class="n">Rating</th><th class="n">Reviews</th><th>City</th><th>Status</th><th>Email</th><th>Owner</th></tr></thead><tbody id="jrows"></tbody></table></div>
      <div class="row" style="justify-content:center;margin-top:10px"><button class="btn btn-ghost" id="jmore" hidden>Show more</button></div>
      <p class="small muted" id="jnote" style="margin:10px 0 0"></p></div>`;
  mountFilters(view);
  setFilters(view, f);

  const ST = { new: ['New', ''], added: ['Added', ''], inhub: ['In the Hub', 'gray'], dnc: ['Do not call', 'bad'], blocked: ['On the do not call list', 'bad'], nophone: ['No phone', 'gray'] };
  const visible = () => rows.filter((r) => passes(r, f) && (!q || [r.title, r.city, r.phone, r.category, r.website].some((v) => String(v || '').toLowerCase().includes(q)))).sort(SORTS[sort][1]);
  const addable = (list) => list.filter((r) => r.st === 'new');

  const drawTop = () => {
    const [label, tone] = STATUS[job.status] || [job.status, 'gray'];
    $('#jt', view).innerHTML = `${esc(job.name)} <span class="badge ${tone}" style="vertical-align:middle;font-size:12px">${label}</span>`;
    $('#jact', view).innerHTML = `${active(job) ? '<button class="btn btn-ghost" data-a="stop">Pause</button>' : job.done < job.total ? '<button class="btn btn-ghost" data-a="resume">Resume</button>' : ''}<button class="btn btn-ghost" data-a="refresh">Refresh</button>`;
    $('#jprog', view).innerHTML = active(job) || job.status === 'failed' || job.status === 'stopped' ? `<div class="card" style="margin-bottom:14px"><div class="progress"><span style="width:${job.pct}%"></span></div>
      <p class="small" style="margin:8px 0 0">${num(job.done)} of ${num(job.total)} searches${job.source === 'osm' ? '' : ` · ${money(job.cost)} so far`}${job.errors ? ` · ${num(job.errors)} failed` : ''}${active(job) ? '. Keep this page open to finish faster. It also runs on its own in the background.' : ''}</p>${job.error ? `<p class="err-text small" style="margin:6px 0 0">${esc(job.error)}</p>` : ''}</div>` : (job.error ? `<p class="err-text">${esc(job.error)}</p>` : '');
  };
  const drawStats = () => {
    const now = visible();
    const c = (st) => rows.filter((r) => r.st === st).length;
    $('#jstats', view).innerHTML = [['Found', total], ['Match the filters', now.length], ['New', c('new')], ['In the Hub', c('inhub') + c('added') + c('dnc') + c('blocked')], ['Cost', job.source === 'osm' ? 'Free' : money(job.cost)]]
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
        <td class="n" title="${esc(gapOf(r).why.join(', ') || 'Strong profile')}"><span class="badge ${gapOf(r).score >= 60 ? '' : 'gray'}">${gapOf(r).score}</span></td><td class="n">${r.rating != null ? r.rating.toFixed(1) : ''}</td><td class="n">${job.source === 'osm' ? '' : num(r.reviews)}</td><td>${esc(r.city)}</td>
        <td>${r.lead_id ? `<a class="badge ${st}" href="#/pipeline/${esc(r.lead_id)}">${sl}</a>` : `<span class="badge ${st}">${sl}</span>`}</td><td class="small">${esc(r.email || '')}</td><td class="small">${esc(r.owner_name || '')}</td></tr>`;
    }).join('') || '<tr><td colspan="12" class="muted" style="padding:18px">Nothing matches yet.</td></tr>';
    $('#jmore', view).hidden = list.length <= shown;
    $('#jmore', view).textContent = `Show more (${num(list.length - shown)} left)`;
    $('#jall', view).checked = false;
    $('#jnote', view).textContent = `${job.source === 'osm' ? 'OpenStreetMap has no ratings or reviews. Research in the Pipeline fills those in only when Google research is on. ' : ''}${capped ? `Showing the first ${num(rows.length)} of ${num(total)} found. ` : ''}After you add them, emails, owner names and social links fill in on their own in the Pipeline (Data column). Reload the list to see them here.`;
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
      else if (a === 'refresh') { busy(b, true, 'Loading'); await loadResults((n, t) => busy(b, true, `Loading ${num(n)} of ${num(t)}`)); draw(); }
      else if (a === 'stop' || a === 'resume') { job = (await api(`/api/finder/jobs/${id}/${a}`, { method: 'POST' })).job; drawTop(); drawBar(); }
      else if (a === 'csv') {
        const list = visible();
        const blob = new Blob([csvText(list)], { type: 'text/csv' });
        const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = `${job.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'leads'}.csv`; el.click(); setTimeout(() => URL.revokeObjectURL(el.href), 5000);
      } else if (a === 'add') {
        busy(b, true, 'Adding');
        // The ticked rows, or every new one that matches the filters, go in batches of 25 so one request never does too much on the server.
        // Each answer says what happened to each row, so the list updates in place without loading it all again.
        const keys = picked.size ? [...picked] : addable(visible()).map((x) => x.key);
        const byKey = new Map(rows.map((x) => [x.key, x]));
        const r = { imported: 0, skipped: 0, skippedBy: {} };
        let sent = 0;
        try {
          for (const part of chunkList(keys, 25)) {
            busy(b, true, `Adding ${num(sent)} of ${num(keys.length)}`);
            const res = await api(`/api/finder/jobs/${id}/add`, { method: 'POST', body: { keys: part } });
            sent += part.length;
            r.imported += res.imported; r.skipped += res.skipped;
            for (const [k, v] of Object.entries(res.skippedBy || {})) r.skippedBy[k] = (r.skippedBy[k] || 0) + v;
            for (const [k, v] of Object.entries(res.results || {})) { const row = byKey.get(k); if (row) { row.st = v.st; row.lead_id = v.lead_id; } picked.delete(k); }
            if (res.job) job = res.job;
          }
        } catch (x) {
          // Whatever went in before the error stays in; the rest can be added again (anything already added is skipped).
          toast(`${num(r.imported)} added before it stopped: ${x.message} Press Add again to carry on.`, true);
          draw(); return;
        }
        const why = Object.entries(r.skippedBy).filter(([, v]) => v).map(([k, v]) => `${v} ${{ phone: 'same phone', website: 'same website', name: 'same name', invalid: 'no phone', dnc: 'do not call', suppressed: 'on the do not call list' }[k] || k}`).join(', ');
        toast(`${num(r.imported)} added to the Pipeline${r.skipped ? `, ${num(r.skipped)} skipped (${why})` : ''}`);
        picked.clear(); draw();
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
      if (!active(job)) { await loadResults(); draw(); }
      else if (job.found <= 1500 && job.found - lastRows >= 60) { lastRows = job.found; await loadResults(); draw(); }
      else if (job.found > rows.length) { total = job.found; drawStats(); $('#jnote', view).textContent = `${num(job.found - rows.length)} more found since this list loaded. Press Refresh to see them, or wait: the list reloads when the search finishes.`; }
    } catch { /* try again */ }
    ticking = false;
  }, 5000);
}

