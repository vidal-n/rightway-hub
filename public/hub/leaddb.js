// Pipeline, Lead database tab: every business we know, searchable by anything we have learned about it and every call made to it.
// Modeled on Apollo.io and ZoomInfo search: filters in categories down the side, ready made and saved searches, a column picker, sortable columns,
// data coverage numbers at the top, export, and "Dial this search" straight into the power dialer. Catalog and SQL whitelist: public/js/leaddb.js.
import { ZONE_SHORT } from '/js/timezone.js';
const TZ_NAME = { ET: 'Eastern (ET)', CT: 'Central (CT)', MT: 'Mountain (MT)', AZ: 'Arizona (AZ)', PT: 'Pacific (PT)', AK: 'Alaska (AK)', HI: 'Hawaii (HI)' };
import { donut } from '../js/charts.js';
import { $, $$, esc, api, toast, fmt, modal, busy } from './core.js';
import { staffShell, pipeTabs } from './staff.js';
import { FILTERS, FILTER_CATS, FILTER_MAP, COLUMNS, COLUMN_MAP, DEFAULT_COLUMNS, PRESETS, cleanFilter, filterCount, answeredLabel, objectionLabel, comboLabel, engageTier, reachTier } from '../js/leaddb.js';

const KEY = 'rw-db-state';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } };
const STAGE = Object.fromEntries(FILTER_MAP.stage.options);
const PHONE = { mobile: 'Mobile', landline: 'Landline', voip: 'Internet phone', toll_free: 'Toll free' };
const mmss = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '-');
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '-');

// One table cell. Every string from the database is escaped.
function cell(k, r) {
  switch (k) {
    case 'business': return `<b>${esc(r.business)}</b>${r.menu_path ? `<div class="small muted">Menu: ${esc(r.menu_path)}</div>` : ''}`;
    case 'owner': return esc(r.owner_name || r.contact_name || '') || '<span class="muted">Ask for the owner</span>';
    case 'phone': return esc(r.phone || '');
    case 'phone_type': return r.phone_type ? `<span class="badge ${r.phone_type === 'mobile' ? 'ok' : r.phone_type === 'toll_free' ? 'bad' : 'gray'}">${esc(PHONE[r.phone_type] || r.phone_type)}</span>` : '<span class="muted">Not checked</span>';
    case 'email': return r.email ? `${esc(r.email)}${r.email_status ? ` <span class="small muted">${esc(r.email_status)}</span>` : ''}` : '';
    case 'stage': return esc(STAGE[r.stage] || r.stage || '');
    case 'combo': {
      const t = `Fit ${r.grade || 'not scored'}${r.score != null ? ` (${r.score})` : ''}, engagement ${r.engage_score ?? 0} (tier ${engageTier(r.engage_score || 0)}), reach ${r.reach_score ?? 0}`;
      return `<span class="db-combo g-${esc((r.grade || 'x').toLowerCase())}" title="${esc(t)}">${esc(comboLabel(r.grade, r.engage_score))}</span>`;
    }
    case 'reach_score': case 'engage_score': {
      const v = r[k] ?? 0;
      const tier = k === 'reach_score' ? reachTier(v) : engageTier(v);
      return `<span class="db-meter t${tier}"><i style="width:${Math.max(4, v)}%"></i></span><b class="mono">${v}</b>`;
    }
    case 'r_talk': case 'r_longest': return mmss(r[k] || 0);
    case 'r_last_by': return r.r_last_by ? esc(answeredLabel(r.r_last_by)) : '<span class="muted">Not called</span>';
    case 'r_obj': return esc(objectionLabel(r.r_obj || ''));
    case 'last_call_at': case 'created_at': return r[k] ? esc(fmt.ago(r[k])) : '';
    case 'qual_n': return r.qual_n ? `${r.qual_n}` : '';
    case 'r_owner': return r.r_owner ? `<b class="good-text">${r.r_owner}</b>` : (r.r_dials ? '0' : '');
    case 'rating': return r.rating != null ? `${r.rating}` : '';
    case 'map_rank': return r.map_rank == null ? '' : r.map_rank > 20 ? '20+' : `#${r.map_rank}`;
    default: return esc(r[k] ?? '');
  }
}

function filterInput(f, val, meta) {
  const id = `dbf-${f.k}`;
  if (f.type === 'text') return `<label class="field"><span>${esc(f.label)}</span><input id="${id}" data-f="${f.k}" value="${esc(val || '')}" placeholder="Contains"></label>`;
  if (f.type === 'bool') return `<label class="field"><span>${esc(f.label)}</span><select data-f="${f.k}" id="${id}"><option value="">Any</option><option value="yes"${val === true ? ' selected' : ''}>Yes</option><option value="no"${val === false ? ' selected' : ''}>No</option></select></label>`;
  if (f.type === 'range') return `<div class="field"><span>${esc(f.label)}</span><div class="db-range"><input type="number" step="${f.step || 1}" placeholder="Min" data-f="${f.k}" data-r="min" value="${val?.min ?? ''}"><input type="number" step="${f.step || 1}" placeholder="Max" data-f="${f.k}" data-r="max" value="${val?.max ?? ''}"></div></div>`;
  const opts = f.dynamic ? (meta[f.k === 'state' ? 'states' : 'sources'] || []).map((o) => [o.v, `${o.v} (${o.n})`]) : f.options;
  const on = new Set(val || []);
  return `<details class="db-pick"${on.size ? ' open' : ''}><summary>${esc(f.label)}${on.size ? ` <b>${on.size}</b>` : ''}</summary>
    <div class="db-opts">${opts.map(([v, n]) => `<label><input type="checkbox" data-f="${f.k}" data-v="${esc(v)}"${on.has(v) ? ' checked' : ''}> ${esc(n)}</label>`).join('') || '<span class="small muted">Nothing yet</span>'}</div></details>`;
}

export async function databasePage(app, user) {
  const view = staffShell(app, user, 'pipeline');
  const st = load();
  st.f = cleanFilter(st.f || {});
  st.sort ||= 'score'; st.dir ||= 'desc'; st.page = 1;
  st.cols = Array.isArray(st.cols) && st.cols.length ? st.cols.filter((c) => COLUMN_MAP[c]) : DEFAULT_COLUMNS.slice();
  st.cats ||= { business: true, calls: true };
  const owner = user.role === 'admin';
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">CRM</p><h1>Lead database</h1></div></div>${pipeTabs('database')}<div class="skeleton"></div>`;
  let meta = { states: [], sources: [], pending: 0, presets: [] }, health = {}, saved = [];
  try {
    [meta, { health }, { saved }] = await Promise.all([api('/api/leaddb/meta'), api('/api/leaddb/health'), api('/api/leaddb/saved')]);
  } catch (e) { $('.skeleton', view).outerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const H = health || {};
  view.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">CRM</p><h1>Lead database</h1><p class="small muted" style="margin:4px 0 0">Every business, everything we know about it, and every call we made to it. Search, sort, save the search, then dial it.</p></div>
      <div class="row" style="gap:8px;flex-wrap:wrap">${owner ? '<button class="btn btn-ghost btn-sm" id="dbexport">Export CSV</button>' : ''}<button class="btn btn-primary btn-sm" id="dbdial">Load as my call list</button></div></div>
    ${pipeTabs('database')}
    ${meta.pending ? `<div class="banner" style="margin-bottom:12px">${fmt.int(meta.pending)} businesses still need their call history added up. It runs on its own a few dozen a minute${owner ? ', or <button class="linkbtn" id="dbrebuild">add them all up now</button>' : ''}.</div>` : ''}
    <div class="db-charts">
      <div class="card"><div class="card-head"><h3>Data coverage</h3><span class="small muted">of ${fmt.int(H.total || 0)} businesses</span></div><div class="cov">${[['Phone', H.phone], ['Mobile line', H.mobile], ['Owner name', H.owner], ['Valid email', H.email_valid], ['Website', H.website], ['Researched', H.researched], ['Scrubbed', H.scrubbed]]
        .map(([n, v]) => { const p = H.total ? Math.round((100 * (v || 0)) / H.total) : 0; return `<div class="cr"><span>${esc(n)}</span><span class="cb"><i style="width:${p}%"></i></span><b>${p}%</b></div>`; }).join('')}</div>
        <p class="small muted" style="margin:10px 0 0">Owner name and mobile line raise the chance the owner answers; scrub to fill them (free, Pipeline step 2).</p></div>
      <div class="card"><div class="card-head"><h3>Call coverage</h3><span class="small muted">where every business stands</span></div>${(() => {
        const never = H.never || 0, owner = H.reached_owner || 0, dnc = H.dnc || 0, called = Math.max(0, (H.total || 0) - never - owner);
        return `<div class="ins-donut">${donut([{ label: 'Never called', value: never, color: 'var(--c-slate)' }, { label: 'Called, owner not reached', value: called, color: 'var(--c-amber)' }, { label: 'Reached the owner', value: owner, color: 'var(--c-green)' }], { center: fmt.int(H.total || 0), sub: 'businesses' })}
          <ul class="ins-legend"><li><i style="background:var(--c-slate)"></i>Never called<b class="mono">${fmt.int(never)}</b></li><li><i style="background:var(--c-amber)"></i>Called, owner not reached<b class="mono">${fmt.int(called)}</b></li><li><i style="background:var(--c-green)"></i>Reached the owner<b class="mono">${fmt.int(owner)}</b></li><li><i style="background:var(--bad)"></i>Do not call<b class="mono">${fmt.int(dnc)}</b></li><li><i style="background:var(--c-violet)"></i>Qualification answers on file<b class="mono">${fmt.int(H.qualified || 0)}</b></li><li><i style="background:var(--line-2)"></i>Data over 6 months old<b class="mono">${fmt.int(H.stale || 0)}</b></li></ul></div>`;
      })()}</div>
      ${(H.byTz || []).length ? `<div class="card cov-tz"><div class="card-head"><h3>Call coverage by time zone</h3><span class="small muted">every lead, imports included</span></div>
        <div class="table-wrap"><table class="pv"><thead><tr><th>Time zone</th><th>Businesses</th><th>Never called</th><th>Called, owner not reached</th><th>Reached the owner</th><th>Do not call</th><th>Qualification on file</th></tr></thead>
        <tbody>${H.byTz.map((r) => { const called = Math.max(0, (r.total || 0) - (r.never || 0) - (r.reached_owner || 0)); return `<tr><th scope="row">${esc(TZ_NAME[ZONE_SHORT[r.tz]] || 'Not known')}</th><td>${fmt.int(r.total)}</td><td>${fmt.int(r.never)}</td><td>${fmt.int(called)}</td><td>${fmt.int(r.reached_owner)}</td><td>${fmt.int(r.dnc)}</td><td>${fmt.int(r.qualified)}</td></tr>`; }).join('')}</tbody></table></div></div>` : ''}
    </div>
    <div class="db-wrap">
      <details class="db-side card"${window.innerWidth >= 1000 ? ' open' : ''}><summary class="row" style="justify-content:space-between"><h2 style="margin:0">Filters</h2><button class="linkbtn" id="dbclear">Clear all</button></summary>
        <div id="dbfilters"></div></details>
      <section class="db-main">
        <div class="db-bar">
          <input id="dbq" type="search" placeholder="Search a name, phone, city or owner" value="${esc(st.f.q || '')}">
          <select id="dbsaved"><option value="">Saved searches</option>${saved.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>
          <button class="btn btn-ghost btn-sm" id="dbsave">Save search</button>
          <button class="btn btn-ghost btn-sm" id="dbcols">Columns</button>
        </div>
        <div class="db-presets">${PRESETS.map(([id, label]) => `<button class="chip" data-preset="${id}">${esc(label)}</button>`).join('')}</div>
        <div id="dbchips" class="db-chips"></div>
        <div id="dbres"><div class="skeleton"></div></div>
      </section>
    </div>`;

  const filtersBox = $('#dbfilters', view);
  const drawFilters = () => {
    filtersBox.innerHTML = FILTER_CATS.map(([cat, name]) => {
      const list = FILTERS.filter((f) => f.cat === cat && f.k !== 'q');
      const n = list.filter((f) => st.f[f.k] != null).length;
      return `<details class="db-cat" data-cat="${cat}"${st.cats[cat] ? ' open' : ''}><summary>${esc(name)}${n ? ` <span class="badge">${n}</span>` : ''}</summary>
        <div class="db-fields">${list.map((f) => filterInput(f, st.f[f.k], meta)).join('')}</div></details>`;
    }).join('');
  };
  const chipText = (k, v) => {
    const f = FILTER_MAP[k];
    if (f.type === 'bool') return `${f.label}: ${v ? 'yes' : 'no'}`;
    if (f.type === 'range') return `${f.label}: ${v.min ?? 'any'} to ${v.max ?? 'any'}`;
    if (f.type === 'pick') { const o = Object.fromEntries(f.options || []); return `${f.label}: ${v.map((x) => (x === '__null' ? 'none' : o[x] || x)).join(', ')}`; }
    return `${f.label}: ${v}`;
  };
  const drawChips = () => {
    const keys = Object.keys(st.f);
    $('#dbchips', view).innerHTML = keys.length ? keys.map((k) => `<span class="chip on">${esc(chipText(k, st.f[k]))} <button class="linkbtn" data-unset="${k}" aria-label="Remove">×</button></span>`).join('') : '<span class="small muted">No filters: showing every business.</span>';
  };

  let timer = null, seq = 0;
  const query = () => `f=${encodeURIComponent(JSON.stringify(st.f))}&sort=${encodeURIComponent(st.sort)}&dir=${st.dir}`;
  const loadRows = async () => {
    save({ f: st.f, sort: st.sort, dir: st.dir, cols: st.cols, cats: st.cats });
    drawChips();
    const my = ++seq;
    const box = $('#dbres', view);
    box.style.opacity = '.55';
    let d;
    try { d = await api(`/api/leaddb/search?${query()}&page=${st.page}&per=50`); } catch (e) { box.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; box.style.opacity = ''; return; }
    if (my !== seq) return;
    box.style.opacity = '';
    const from = d.total ? (d.page - 1) * d.per + 1 : 0, to = Math.min(d.total, d.page * d.per);
    box.innerHTML = `<div class="row small" style="justify-content:space-between;margin:4px 0 8px"><span><b>${fmt.int(d.total)}</b> businesses match. Showing ${from} to ${to}.</span>
        <span class="row" style="gap:6px"><button class="btn btn-ghost btn-sm" id="dbprev"${d.page <= 1 ? ' disabled' : ''}>Back</button><button class="btn btn-ghost btn-sm" id="dbnext"${to >= d.total ? ' disabled' : ''}>Next</button></span></div>
      ${d.rows.length ? `<div class="table-wrap db-table"><table><thead><tr>${st.cols.map((c) => `<th><button class="db-sort${st.sort === c ? ' on' : ''}" data-sort="${c}">${esc(COLUMN_MAP[c][1])}${st.sort === c ? (st.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>`).join('')}</tr></thead>
        <tbody>${d.rows.map((r) => `<tr data-lead="${esc(r.id)}"${r.dnc ? ' class="is-dnc"' : ''}>${st.cols.map((c) => `<td data-label="${esc(COLUMN_MAP[c][1])}">${cell(c, r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
        : '<div class="card"><p class="muted">Nothing matches. Loosen a filter or clear them.</p></div>'}`;
    $('#dbprev', box)?.addEventListener('click', () => { st.page--; loadRows(); });
    $('#dbnext', box)?.addEventListener('click', () => { st.page++; loadRows(); });
    $$('[data-sort]', box).forEach((b) => b.addEventListener('click', () => { const k = b.dataset.sort; if (st.sort === k) st.dir = st.dir === 'asc' ? 'desc' : 'asc'; else { st.sort = k; st.dir = ['business', 'owner', 'city', 'state', 'industry', 'stage', 'phone_type', 'email', 'source'].includes(k) ? 'asc' : 'desc'; } st.page = 1; loadRows(); }));
    $$('tr[data-lead]', box).forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.closest('a,button')) return; import('./crm.js').then((m) => m.leadModal(tr.dataset.lead, () => loadRows())); }));
  };
  const soon = () => { clearTimeout(timer); timer = setTimeout(() => { st.page = 1; loadRows(); }, 350); };
  const readFilters = () => {
    const f = { q: $('#dbq', view).value.trim() };
    for (const el of $$('[data-f]', filtersBox)) {
      const k = el.dataset.f, d = FILTER_MAP[k];
      if (d.type === 'pick') { if (el.checked) (f[k] ||= []).push(el.dataset.v); }
      else if (d.type === 'range') { if (el.value !== '') (f[k] ||= {})[el.dataset.r] = el.value; }
      else if (d.type === 'bool') { if (el.value) f[k] = el.value === 'yes'; }
      else if (el.value.trim()) f[k] = el.value.trim();
    }
    st.f = cleanFilter(f);
  };
  filtersBox.addEventListener('input', () => { readFilters(); soon(); });
  filtersBox.addEventListener('change', () => { readFilters(); soon(); });
  filtersBox.addEventListener('toggle', (e) => { const c = e.target.closest?.('.db-cat'); if (c) st.cats[c.dataset.cat] = c.open; }, true);
  $('#dbq', view).addEventListener('input', () => { readFilters(); soon(); });
  $('#dbchips', view).addEventListener('click', (e) => { const k = e.target.closest('[data-unset]')?.dataset.unset; if (!k) return; delete st.f[k]; if (k === 'q') $('#dbq', view).value = ''; drawFilters(); st.page = 1; loadRows(); });
  $('#dbclear', view).addEventListener('click', () => { st.f = {}; $('#dbq', view).value = ''; drawFilters(); st.page = 1; loadRows(); });
  $$('[data-preset]', view).forEach((b) => b.addEventListener('click', () => {
    const p = PRESETS.find((x) => x[0] === b.dataset.preset);
    st.f = cleanFilter(p[2]); st.sort = p[3]; st.dir = 'desc'; st.page = 1; $('#dbq', view).value = '';
    $$('[data-preset]', view).forEach((x) => x.classList.toggle('on', x === b));
    drawFilters(); loadRows();
  }));
  $('#dbsaved', view).addEventListener('change', (e) => {
    const s = saved.find((x) => x.id === e.target.value); if (!s) return;
    st.f = cleanFilter(s.f); st.sort = s.sort; st.dir = s.dir; st.page = 1; $('#dbq', view).value = st.f.q || '';
    drawFilters(); loadRows();
  });
  $('#dbsave', view).addEventListener('click', async () => {
    if (!filterCount(st.f)) return toast('Add a filter first, then save it.', true);
    const m = modal(`<div class="card-head"><h2>Save this search</h2><button class="btn btn-ghost btn-sm" data-close>Cancel</button></div>
      <form id="dbsv"><label class="field"><span>Name</span><input name="name" required maxlength="60" placeholder="Roofers, mobile, never called"></label>
      <div class="row end" style="margin-top:10px"><button class="btn btn-primary" type="submit">Save</button></div></form>`);
    const name = await new Promise((res) => { $('#dbsv', m.el).addEventListener('submit', (ev) => { ev.preventDefault(); res(ev.currentTarget.name.value.trim()); m.close(); }); });
    if (!name) return;
    try { const r = await api('/api/leaddb/saved', { method: 'PUT', body: { saved: [...saved, { name, f: st.f, sort: st.sort, dir: st.dir }] } }); saved = r.saved; toast('Search saved');
      $('#dbsaved', view).innerHTML = `<option value="">Saved searches</option>${saved.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}`; }
    catch (e) { toast(e.message, true); }
  });
  $('#dbcols', view).addEventListener('click', () => {
    const m = modal(`<div class="card-head"><h2>Columns</h2><button class="btn btn-ghost btn-sm" data-close>Done</button></div>
      <p class="small muted">Pick what the table shows. Saved on this device.</p>
      <div class="db-colpick">${COLUMNS.map(([k, n]) => `<label><input type="checkbox" value="${k}"${st.cols.includes(k) ? ' checked' : ''}> ${esc(n)}</label>`).join('')}</div>
      <div class="row end" style="margin-top:10px"><button class="btn btn-ghost btn-sm" id="colreset">Back to the default</button></div>`, { onClose: () => loadRows() });
    $$('.db-colpick input', m.el).forEach((i) => i.addEventListener('change', () => { st.cols = $$('.db-colpick input', m.el).filter((x) => x.checked).map((x) => x.value); if (!st.cols.length) st.cols = ['business']; }));
    $('#colreset', m.el).addEventListener('click', () => { st.cols = DEFAULT_COLUMNS.slice(); m.close(); });
  });
  $('#dbdial', view).addEventListener('click', async (e) => {
    busy(e.currentTarget, true);
    try {
      const label = Object.keys(st.f).length ? Object.keys(st.f).map((k) => chipText(k, st.f[k])).join('; ').slice(0, 120) : 'Everyone';
      const r = await api('/api/leaddb/load-list', { method: 'POST', body: { f: st.f, label: `Lead database: ${label}` } });
      localStorage.setItem('rw-dial-filter', JSON.stringify({ campaign: '1', label: r.label }));
      if (r.taken) toast(`${r.taken} lead${r.taken === 1 ? ' is' : 's are'} left out because ${r.takenBy.map((x) => x.name).join(' and ')} already ${r.takenBy.length === 1 ? 'has' : 'have'} them on a list.`);
      location.hash = '#/phone';
    } catch (err) { busy(e.currentTarget, false); toast(err.message, true); }
  });
  $('#dbexport', view)?.addEventListener('click', () => { location.href = `/api/leaddb/export?${query()}`; });
  $('#dbrebuild', view)?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    let after = '', total = 0;
    try {
      for (;;) { const r = await api('/api/leaddb/rebuild', { method: 'POST', body: { after } }); total += r.done; btn.textContent = `Adding up... ${fmt.int(total)} done`; if (!r.next) break; after = r.next; }
      toast(`Done: ${fmt.int(total)} businesses added up.`); databasePage(app, user);
    } catch (err) { btn.disabled = false; toast(err.message, true); }
  });
  drawFilters();
  loadRows();
}
