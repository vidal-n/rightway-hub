// CRM screens: pipeline board, lead details, CSV import, power dialer, settings.
import { $, $$, esc, api, toast, copy, fmt, icon, busy, modal, PLAN_NAMES, PLAN_PRICE } from './core.js';
import { staffShell, settingsTabs } from './staff.js';
import { prepPanel, gradeBadge, bookModal, clearScriptCache } from './prep.js';
import { textModal } from './texts.js';
import { dialTabs, callerSelect, bindCaller, phoneBadge } from './dialout.js';
import { loadDispos, keyed, dispositionModal } from './dispo.js';
import { stripeSetup } from './stripesetup.js';
import { autoScanCard } from './scans.js';
import { placeCall, startPhone, onPhoneState } from './phone.js';
import { filterLeads } from '/js/leadfilter.js';
import { quoteFor, recommendPlan } from '/js/leadintel.js';
import { SERVICE_LIST } from '/js/plancopy.js';

export const STAGE_LABEL = {
  new: 'New lead', attempting: 'Attempting', callback: 'Callback set', audit_requested: 'Audit requested', audit_booked: 'Audit booked',
  no_show: 'No-show', follow_up: 'Following up', won: 'Won', not_now: 'Not now', lost: 'Lost', dnc: 'Do not call',
};
const BOARD = ['new', 'attempting', 'callback', 'audit_requested', 'audit_booked', 'no_show', 'follow_up', 'won'];
const CLOSED = ['not_now', 'lost', 'dnc'];
// Built in results, used until the custom list loads and for older call records.
const OUTCOMES = [
  ['no_answer', 'No answer', '1'], ['voicemail', 'Voicemail', '2'], ['gatekeeper', 'Gatekeeper', '3'], ['conversation', 'Talked, follow up', '4'],
  ['booked', 'Booked audit', '5'], ['callback', 'Callback', '6'], ['not_interested', 'Not interested', '7'], ['bad_number', 'Bad number', '8'], ['dnc', 'Do not call', '9'],
];
const dueText = (ms) => {
  if (!ms) return '';
  const d = ms - Date.now();
  if (d <= 0) return 'due now';
  const h = Math.round(d / 3600e3);
  return h < 24 ? `in ${h} h` : `in ${Math.round(h / 24)} d`;
};
let DISP = keyed(OUTCOMES.map(([id, label]) => ({ id, label, acts: id })));
const dispoOf = (id) => DISP.find((d) => d.id === id) || { id, label: id, acts: id };
async function refreshDispos() { try { DISP = keyed((await loadDispos()).dispositions); } catch { /* keep the built in list */ } }
let REP = '';
export const setRep = (user) => { REP = (user?.name || '').split(' ')[0] || ''; };
const telHref = (p) => `tel:${String(p || '').replace(/[^\d+]/g, '')}`;

// ---------- pipeline ----------
const TZS = [['ET', 'Eastern'], ['CT', 'Central'], ['MT', 'Mountain'], ['AZ', 'Arizona'], ['PT', 'Pacific'], ['AK', 'Alaska'], ['HI', 'Hawaii'], ['?', 'Unknown']];
const GRADES = ['A', 'B', 'C', 'D'];
const GROUPS = [['', 'No grouping'], ['tz_short', 'Time zone'], ['state', 'State'], ['city', 'City'], ['industry', 'Industry'], ['grade', 'Grade'], ['stage', 'Stage'], ['source', 'Source'], ['tags', 'Tag']];
const PIPE_KEY = 'rw-pipe-v2';
const loadPipe = () => { try { return { view: 'board', tz: '', group: '', sort: '-score', f: {}, ...JSON.parse(localStorage.getItem(PIPE_KEY) || '{}') }; } catch { return { view: 'board', tz: '', group: '', sort: '-score', f: {} }; } };
const savePipe = (p) => { try { localStorage.setItem(PIPE_KEY, JSON.stringify(p)); } catch { /* private mode */ } };

function sortLeads(rows, sort) {
  const desc = sort.startsWith('-');
  const k = sort.replace(/^-/, '');
  return rows.slice().sort((a, b) => {
    const x = a[k] ?? (typeof b[k] === 'number' ? -1 : ''), y = b[k] ?? (typeof a[k] === 'number' ? -1 : '');
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return desc ? -c : c;
  });
}

export async function pipelinePage(app, user, openId) {
  setRep(user);
  const view = staffShell(app, user, 'pipeline');
  let data;
  try { data = await api('/api/leads'); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  // #/pipeline/<leadId> (links from the calendar, mail and elsewhere) opens that lead on top of the board.
  if (openId && /^ld_/.test(openId)) setTimeout(() => leadModal(openId, () => pipelinePage(app, user)), 0);
  const p = loadPipe();
  p.f ||= {};
  const all = data.leads;
  const states = [...new Set(all.map((l) => l.state).filter(Boolean))].sort();
  const sources = [...new Set(all.map((l) => l.source).filter(Boolean))].sort();
  const industries = [...new Set(all.map((l) => l.industry).filter(Boolean))].sort();
  const selected = new Set();
  const reload = () => pipelinePage(app, user);

  const render = () => {
    savePipe(p);
    const rows = filterLeads(all, p);
    const tzCount = (tz) => all.filter((l) => (tz === '?' ? !l.tz_short : l.tz_short === tz)).length;
    const tzNow = (tz) => all.some((l) => l.tz_short === tz && l.callable_now && !['won', 'lost', 'dnc'].includes(l.stage));
    const by = {};
    rows.forEach((l) => { (by[l.stage] ||= []).push(l); });
    const open = rows.filter((l) => !['won', 'lost', 'dnc'].includes(l.stage));
    const f = p.f;
    const activeFilters = Object.entries(f).filter(([k, v]) => k !== 'q' && (Array.isArray(v) ? v.length : v !== '' && v != null && v !== false)).length;
    view.innerHTML = `
      <div class="page-head"><div><p class="eyebrow">CRM</p><h1>Pipeline</h1></div>
        <div class="row"><a class="btn btn-mint" href="#/phone" id="godial">${icon.phone}Dial this list</a><button class="btn btn-ghost" id="imp">${icon.upload}Import</button>
          <button class="btn btn-ghost" id="dups">Duplicates</button><button class="btn btn-primary" id="addl">${icon.plus}Add lead</button></div></div>
      <div class="stats">
        <div class="stat hero"><div class="stat-num">${open.length}</div><div class="stat-label">open leads in view (${all.length} total)</div></div>
        <div class="stat"><div class="stat-num">${open.filter((l) => l.grade === 'A').length}</div><div class="stat-label">A leads</div></div>
        <div class="stat"><div class="stat-num">${open.filter((l) => l.callable_now).length}</div><div class="stat-label">callable right now</div></div>
        <div class="stat"><div class="stat-num">${(by.audit_booked || []).length}</div><div class="stat-label">audits booked</div></div>
        <div class="stat"><div class="stat-num">${(by.won || []).length}</div><div class="stat-label">won</div></div>
      </div>
      <div class="tz-tabs"><button class="tz ${!p.tz ? 'is-on' : ''}" data-tz="">All <b>${all.length}</b></button>${TZS.map(([k, n]) => {
        const c = tzCount(k);
        return c ? `<button class="tz ${p.tz === k ? 'is-on' : ''}" data-tz="${k}" title="${n}">${tzNow(k) ? '<i class="live"></i>' : ''}${k === '?' ? 'Unknown' : k} <b>${c}</b></button>` : '';
      }).join('')}</div>
      <div class="filterbar">
        <input id="fq" value="${esc(f.q || '')}" placeholder="Search name, phone, city, industry, zip, tag" style="flex:1 1 240px">
        <div class="chips">${GRADES.map((g) => `<button class="chip ${f.grades?.includes(g) ? 'on' : ''}" data-grade="${g}">${g}</button>`).join('')}</div>
        <button class="btn btn-ghost btn-sm" id="fmore">Filters${activeFilters ? ` (${activeFilters})` : ''}</button>
        <div class="seg"><button class="${p.view === 'board' ? 'is-on' : ''}" data-view="board">Board</button><button class="${p.view === 'list' ? 'is-on' : ''}" data-view="list">List</button></div>
      </div>
      <div class="card filters" id="fpanel" ${p.open ? '' : 'hidden'}>
        <div class="form-grid filt">
          <label class="field"><span>State</span><select data-f="state"><option value="">Any</option>${states.map((s) => `<option${f.state === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
          <label class="field"><span>City</span><input data-f="city" value="${esc(f.city || '')}" placeholder="Any"></label>
          <label class="field"><span>Industry</span><input data-f="industry" list="indlist" value="${esc(f.industry || '')}" placeholder="Any"><datalist id="indlist">${industries.map((i) => `<option value="${esc(i)}">`).join('')}</datalist></label>
          <label class="field"><span>Source</span><select data-f="source"><option value="">Any</option>${sources.map((s) => `<option${f.source === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
          <label class="field"><span>Stage</span><select data-f="stage"><option value="">Any</option>${Object.entries(STAGE_LABEL).map(([k, n]) => `<option value="${k}"${f.stage === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="field"><span>Tag</span><input data-f="tag" value="${esc(f.tag || '')}" placeholder="Any"></label>
          <label class="field"><span>Website</span><select data-f="site"><option value="">Any</option><option value="yes"${f.site === 'yes' ? ' selected' : ''}>Has a website</option><option value="no"${f.site === 'no' ? ' selected' : ''}>No website</option></select></label>
          <label class="field"><span>Researched</span><select data-f="researched"><option value="">Any</option><option value="yes"${f.researched === 'yes' ? ' selected' : ''}>Yes</option><option value="no"${f.researched === 'no' ? ' selected' : ''}>Not yet</option></select></label>
          <label class="field"><span>Reviews from</span><input type="number" min="0" data-f="minReviews" value="${esc(f.minReviews ?? '')}"></label>
          <label class="field"><span>Reviews up to</span><input type="number" min="0" data-f="maxReviews" value="${esc(f.maxReviews ?? '')}"></label>
          <label class="field"><span>Rating up to</span><input type="number" min="1" max="5" step="0.1" data-f="maxRating" value="${esc(f.maxRating ?? '')}"></label>
          <label class="field"><span>Score at least</span><input type="number" min="0" max="100" data-f="minScore" value="${esc(f.minScore ?? '')}"></label>
        </div>
        <div class="row" style="margin-top:10px"><label class="row small" style="gap:6px"><input type="checkbox" data-f="callable"${f.callable ? ' checked' : ''}> Callable right now</label>
          <label class="row small" style="gap:6px"><input type="checkbox" data-f="notTop3"${f.notTop3 ? ' checked' : ''}> Not in the top 3</label>
          <label class="row small" style="gap:6px"><input type="checkbox" data-f="notTop10"${f.notTop10 ? ' checked' : ''}> Not on the first page</label>
          <span class="spacer"></span><button class="btn btn-ghost btn-sm" id="fclear">Clear filters</button></div>
      </div>
      <div class="row small" style="margin:6px 0 14px">${rows.length} leads match. <button class="linkbtn" id="resall">Research the ${Math.min(50, rows.filter((l) => !l.researched && !['won', 'lost', 'dnc'].includes(l.stage)).length)} unresearched ones (up to 50)</button></div>
      <div id="pbody"></div>`;
    const body = $('#pbody', view);
    if (p.view === 'list') renderList(body, rows); else renderBoard(body, by);
    wire();
  };

  const renderBoard = (el, by) => {
    el.innerHTML = `<div class="board">${BOARD.map((s) => column(s, sortLeads(by[s] || [], '-score'))).join('')}</div>
      <details class="card" style="margin-top:18px"><summary style="cursor:pointer;font-weight:600">Closed: not now, lost, do not call (${CLOSED.reduce((n, s) => n + (by[s] || []).length, 0)})</summary>
        <div class="board" style="margin-top:14px">${CLOSED.map((s) => column(s, by[s] || [])).join('')}</div></details>`;
    $$('.lead-card', el).forEach((c) => {
      c.addEventListener('click', () => leadModal(c.dataset.id, reload));
      c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', c.dataset.id); c.classList.add('dragging'); });
      c.addEventListener('dragend', () => c.classList.remove('dragging'));
    });
    $$('.col', el).forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop-on'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop-on'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drop-on');
        const id = e.dataTransfer.getData('text/plain');
        const card = $(`.lead-card[data-id="${CSS.escape(id)}"]`, el);
        if (!card || card.closest('.col') === col) return;
        $('.col-body', col).prepend(card);
        const l = all.find((x) => x.id === id);
        try { await api(`/api/leads/${id}`, { method: 'PATCH', body: { stage: col.dataset.stage } }); if (l) l.stage = col.dataset.stage; toast(`Moved to ${STAGE_LABEL[col.dataset.stage]}`); }
        catch (err) { toast(err.message, true); reload(); }
      });
    });
  };

  const COLS = [['grade', 'Grade', '-score'], ['business', 'Business', 'business'], ['city', 'Area', 'city'], ['tz_short', 'TZ', 'tz_short'], ['industry', 'Industry', 'industry'],
    ['reviews', 'Reviews', '-reviews'], ['rating', 'Rating', 'rating'], ['map_rank', 'Map rank', 'map_rank'], ['stage', 'Stage', 'stage'], ['next', 'Next', 'next_action_at']];
  const renderList = (el, rows) => {
    const sorted = sortLeads(rows, p.sort);
    const groups = new Map();
    if (p.group) for (const l of sorted) { const k = String(l[p.group] ?? '') || 'None'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
    else groups.set('', sorted);
    const row = (l) => `<tr data-id="${esc(l.id)}"><td><input type="checkbox" class="sel" data-id="${esc(l.id)}"${selected.has(l.id) ? ' checked' : ''}></td>
      <td>${gradeBadge(l.grade, l.score)}</td><td><b>${esc(l.business)}</b><div class="small">${esc([l.contact_name, l.phone].filter(Boolean).join(' · '))}</div></td>
      <td>${esc([l.city, l.state].filter(Boolean).join(', '))}${l.zip ? ` <span class="small">${esc(l.zip)}</span>` : ''}</td>
      <td>${l.tz_short ? `<span class="badge ${l.callable_now ? '' : 'gray'}">${esc(l.tz_short)} ${esc(l.local_time)}</span>` : '<span class="small">?</span>'}</td>
      <td>${esc(l.industry || l.category || '')}</td><td>${l.reviews ?? ''}</td><td>${l.rating ?? ''}</td><td>${l.map_rank == null ? '' : l.map_rank > 20 ? '20+' : `#${l.map_rank}`}</td>
      <td><span class="badge gray">${esc(STAGE_LABEL[l.stage])}</span></td><td class="small">${esc(dueText(l.next_action_at))}</td></tr>`;
    el.innerHTML = `
      <div class="row" style="margin-bottom:10px"><label class="field" style="flex:0 1 220px"><select id="grp">${GROUPS.map(([k, n]) => `<option value="${k}"${p.group === k ? ' selected' : ''}>Group: ${n}</option>`).join('')}</select></label>
        <div class="bulk" id="bulk" ${selected.size ? '' : 'hidden'}><b id="selc">${selected.size} selected</b>
          <button class="btn btn-ghost btn-sm" data-bulk="research">Research</button><button class="btn btn-ghost btn-sm" data-bulk="callnow">Call next</button>
          <select id="bstage"><option value="">Move to...</option>${Object.entries(STAGE_LABEL).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select>
          <button class="btn btn-ghost btn-sm" data-bulk="tag">Tag</button><button class="btn btn-danger btn-sm" data-bulk="delete">Delete</button></div></div>
      <div class="table-wrap"><table class="leads-table"><thead><tr><th><input type="checkbox" id="selall"></th>${COLS.map(([k, n, s]) => `<th><button class="th" data-sort="${s}">${n}${p.sort.replace('-', '') === s.replace('-', '') ? (p.sort.startsWith('-') ? ' ↓' : ' ↑') : ''}</button></th>`).join('')}</tr></thead>
      <tbody>${[...groups.entries()].map(([g, ls]) => `${p.group ? `<tr class="grp"><td colspan="${COLS.length + 1}">${esc(g)} <span class="small">${ls.length}</span></td></tr>` : ''}${ls.slice(0, 1500).map(row).join('')}`).join('') || `<tr><td colspan="${COLS.length + 1}" class="muted">No leads match.</td></tr>`}</tbody></table></div>`;
    const syncBulk = () => { $('#bulk', el).hidden = !selected.size; $('#selc', el).textContent = `${selected.size} selected`; };
    $('#grp', el).addEventListener('change', (e) => { p.group = e.target.value; render(); });
    $$('[data-sort]', el).forEach((b) => b.addEventListener('click', () => { const s = b.dataset.sort; const base = s.replace('-', ''); p.sort = p.sort.replace('-', '') === base ? (p.sort.startsWith('-') ? base : `-${base}`) : s; render(); }));
    $$('tbody tr[data-id]', el).forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.classList.contains('sel')) return; leadModal(tr.dataset.id, reload); }));
    $$('.sel', el).forEach((c) => c.addEventListener('change', () => { if (c.checked) selected.add(c.dataset.id); else selected.delete(c.dataset.id); syncBulk(); }));
    $('#selall', el).addEventListener('change', (e) => { sorted.forEach((l) => (e.target.checked ? selected.add(l.id) : selected.delete(l.id))); $$('.sel', el).forEach((c) => { c.checked = e.target.checked; }); syncBulk(); });
    const bulk = async (action, value) => {
      try { const r = await api('/api/leads/bulk', { method: 'POST', body: { ids: [...selected], action, value } }); toast(`${r.count} updated`); selected.clear(); reload(); } catch (err) { toast(err.message, true); }
    };
    $('#bstage', el).addEventListener('change', (e) => { if (e.target.value) bulk('stage', e.target.value); });
    $$('[data-bulk]', el).forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.bulk;
      if (a === 'research') return researchMany(all.filter((l) => selected.has(l.id)), reload);
      if (a === 'tag') { const t = prompt('Tag to add'); if (t) bulk('tag', t); return; }
      if (a === 'delete' && !confirm(`Delete ${selected.size} leads and their history?`)) return;
      bulk(a);
    }));
  };

  const wire = () => {
    $('#addl', view).addEventListener('click', () => leadForm(null, reload));
    $('#imp', view).addEventListener('click', () => importModal(reload));
    $('#dups', view).addEventListener('click', () => duplicatesModal(reload));
    $('#godial', view).addEventListener('click', () => { try { localStorage.setItem('rw-dial-filter', JSON.stringify({ tz: p.tz === '?' ? '' : p.tz, grade: (p.f.grades || []).join(','), state: p.f.state || '', industry: p.f.industry || '', tag: p.f.tag || '', city: p.f.city || '' })); } catch { /* ignore */ } });
    $$('[data-tz]', view).forEach((b) => b.addEventListener('click', () => { p.tz = b.dataset.tz; render(); }));
    $$('[data-grade]', view).forEach((b) => b.addEventListener('click', () => { const g = b.dataset.grade; const s = new Set(p.f.grades || []); if (s.has(g)) s.delete(g); else s.add(g); p.f.grades = [...s]; render(); }));
    $$('[data-view]', view).forEach((b) => b.addEventListener('click', () => { p.view = b.dataset.view; render(); }));
    $('#fmore', view).addEventListener('click', () => { p.open = !p.open; $('#fpanel', view).hidden = !p.open; savePipe(p); });
    let t;
    $('#fq', view).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { p.f.q = e.target.value; render(); const i = $('#fq', view); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
    $$('[data-f]', view).forEach((i) => i.addEventListener('change', () => { p.f[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value; render(); }));
    $('#fclear', view).addEventListener('click', () => { p.f = {}; p.tz = ''; render(); });
    $('#resall', view).addEventListener('click', () => researchMany(filterLeads(all, p).filter((l) => !l.researched && !['won', 'lost', 'dnc'].includes(l.stage)).slice(0, 50), reload));
  };
  render();
}

// Research several leads, three at a time, with a progress bar and a stop button.
export function researchMany(leads, onDone) {
  if (!leads.length) return toast('Nothing to research in this view.');
  let stop = false;
  const m = modal(`<div class="card-head"><h2>Researching ${leads.length} leads</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <p class="muted">Each lead: find the Google profile, rank check at 9 points around them, website read, mobile speed. About 4 cents each, ${esc(fmt.money(leads.length * 0.04))} max.</p>
    <div class="progress"><span id="rmbar" style="width:0%"></span></div><p class="small" id="rmtxt">Starting...</p>
    <div class="row end"><button class="btn btn-ghost btn-sm" id="rmstop">Stop</button></div>`, { onClose: () => { stop = true; onDone?.(); } });
  let done = 0, failed = 0, cost = 0;
  const queue = leads.slice();
  $('#rmstop', m.el).addEventListener('click', () => { stop = true; });
  const tick = (l, err) => {
    done++;
    $('#rmbar', m.el).style.width = `${Math.round((done / leads.length) * 100)}%`;
    $('#rmtxt', m.el).textContent = `${done} of ${leads.length} done${failed ? `, ${failed} could not be researched` : ''}. ${err ? `Last issue: ${l.business}: ${err}` : `Last: ${l.business}`}. Spent about $${cost.toFixed(2)}.`;
  };
  const worker = async () => {
    while (queue.length && !stop) {
      const l = queue.shift();
      try { const r = await api(`/api/leads/${l.id}/research`, { method: 'POST', body: {} }); cost += r.intel?.cost || 0; tick(l); }
      catch (err) { failed++; tick(l, err.message); }
    }
  };
  Promise.all([worker(), worker(), worker()]).then(() => { $('#rmtxt', m.el).textContent += stop ? ' Stopped.' : ' All done.'; $('#rmstop', m.el).textContent = 'Done'; $('#rmstop', m.el).onclick = () => m.close(); });
}

async function duplicatesModal(onDone) {
  let merged = 0;
  const m = modal('<div class="skeleton"></div>', { onClose: () => { if (merged) onDone?.(); } });
  let d;
  try { d = await api('/api/leads/duplicates'); } catch (e) { m.el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  m.el.innerHTML = `<div class="card-head"><h2>Duplicates (${d.groups.length} groups)</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <p class="muted">Matched by phone, website, or business name plus city or zip. Pick the one to keep. Its blanks get filled from the others and their call history moves over.</p>
    ${d.groups.length ? `<div class="row end" style="margin-bottom:10px"><button class="btn btn-primary btn-sm" id="mergeall">Merge all, keep the top pick</button></div>` : '<p>No duplicates found.</p>'}
    <div class="dup-groups">${d.groups.map((g, gi) => `<div class="card" style="box-shadow:none" data-g="${gi}">${g.map((l, i) => `<label class="row" style="gap:10px;margin:4px 0"><input type="radio" name="keep${gi}" value="${esc(l.id)}"${i === 0 ? ' checked' : ''}>
      <span><b>${esc(l.business)}</b> <span class="small">${esc([l.phone, l.website, l.city, STAGE_LABEL[l.stage]].filter(Boolean).join(' · '))}</span></span></label>`).join('')}
      <div class="row end"><button class="btn btn-ghost btn-sm" data-merge="${gi}">Merge</button></div></div>`).join('')}</div>`;
  const merge = async (gi) => {
    const g = d.groups[gi];
    const keep = $(`input[name="keep${gi}"]:checked`, m.el).value;
    await api('/api/leads/merge', { method: 'POST', body: { keep, remove: g.map((l) => l.id).filter((id) => id !== keep) } });
    $(`[data-g="${gi}"]`, m.el).remove();
    merged++;
  };
  $$('[data-merge]', m.el).forEach((b) => b.addEventListener('click', async () => { try { await merge(Number(b.dataset.merge)); toast('Merged'); } catch (err) { toast(err.message, true); } }));
  $('#mergeall', m.el)?.addEventListener('click', async (e) => {
    busy(e.target, true);
    let n = 0;
    for (let gi = 0; gi < d.groups.length; gi++) { if ($(`[data-g="${gi}"]`, m.el)) { try { await merge(gi); n++; } catch { /* keep going */ } } }
    toast(`${n} groups merged`); m.close();
  });
}

function column(stage, leads) {
  return `<section class="col" data-stage="${stage}"><header class="col-head"><b>${STAGE_LABEL[stage]}</b><span class="badge gray">${leads.length}</span></header>
    <div class="col-body">${leads.slice(0, 200).map(card).join('')}${leads.length > 200 ? `<p class="small">${leads.length - 200} more. Use List view.</p>` : ''}</div></section>`;
}
function card(l) {
  return `<article class="lead-card" draggable="true" data-id="${esc(l.id)}">
    <div class="row" style="gap:8px;flex-wrap:nowrap">${gradeBadge(l.grade, l.score)}<div style="min-width:0"><div class="item-title ellip">${esc(l.business)}</div>
    <div class="item-sub ellip">${esc([l.industry || l.category, [l.city, l.state].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</div></div></div>
    <div class="row small" style="margin-top:6px;gap:6px">${l.next_action_at ? `<span class="badge ${l.next_action_at <= Date.now() ? 'warn' : 'gray'}">${esc(dueText(l.next_action_at))}</span>` : ''}
      ${l.meet_at && l.meet_at > Date.now() - 3600e3 ? `<span class="badge">Meet ${esc(new Date(l.meet_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span>` : ''}
      ${l.reviews != null ? `<span>${l.reviews} rev</span>` : ''}${l.map_rank ? `<span>${l.map_rank > 20 ? '20+' : `#${l.map_rank}`}</span>` : ''}${l.tz_known ? `<span class="${l.callable_now ? 'ok-dot' : ''}">${esc(l.tz_short)} ${esc(l.local_time)}</span>` : ''}</div></article>`;
}

// ---------- lead form ----------
const LF = [['business', 'Business name', true], ['contact_name', 'Contact name'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'],
  ['city', 'City'], ['state', 'State (2 letters)'], ['industry', 'Industry'], ['source', 'Source']];

export function leadForm(lead, onSaved) {
  const m = modal(`<div class="card-head"><h2>${lead ? 'Edit lead' : 'Add a lead'}</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <form id="lform" class="form-grid">${LF.map(([k, label, req]) => `<label class="field"><span>${label}</span><input name="${k}" value="${esc(lead?.[k] || '')}"${req ? ' required' : ''}></label>`).join('')}
      <label class="field span-all"><span>Notes</span><textarea name="notes">${esc(lead?.notes || '')}</textarea></label>
      <div class="span-all row end"><button class="btn btn-primary" type="submit">${lead ? 'Save' : 'Add lead'}</button></div></form>`);
  $('#lform', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try {
      const r = lead ? await api(`/api/leads/${lead.id}`, { method: 'PATCH', body }) : await api('/api/leads', { method: 'POST', body });
      toast('Saved'); m.close(); onSaved?.(r.lead);
    } catch (err) { toast(err.message, true); }
  });
}

// ---------- lead details ----------
export async function leadModal(id, onChange) {
  let changed = false;
  const m = modal('<div class="skeleton"></div>', { onClose: () => { if (changed) onChange?.(); } });
  let data;
  try { [data] = await Promise.all([api(`/api/leads/${id}`), refreshDispos()]); } catch (e) { m.el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const l = data.lead;
  const Q = quoteFor(l, data.intel, l.quote);
  const REC = recommendPlan(l, data.intel).plan;
  m.el.innerHTML = `
    <div class="card-head"><div><p class="eyebrow">${esc(STAGE_LABEL[l.stage])}${l.attempts ? ` · ${l.attempts} attempts` : ''}</p><h2>${esc(l.business)}</h2>
      <div class="small">${esc([l.contact_name, l.city, l.state].filter(Boolean).join(' · '))}${l.tz_known ? ` · their time ${esc(l.local_time)}` : ''}</div></div>
      <button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <div class="row" style="margin-bottom:14px">
      ${l.phone ? `<a class="btn btn-mint" href="${telHref(l.phone)}">${icon.phone}${esc(l.phone)}</a>` : ''}
      ${l.email ? `<button class="btn btn-ghost" id="lmailbtn">${icon.mail}Email</button>` : ''}
      <button class="btn btn-ghost" id="lmeetbtn">Add appointment</button>
      ${l.website ? `<a class="btn btn-ghost" href="${esc(/^https?:/.test(l.website) ? l.website : `https://${l.website}`)}" target="_blank" rel="noopener">Website</a>` : ''}
      <a class="btn btn-ghost" href="https://www.google.com/maps/search/${encodeURIComponent(`${l.business} ${l.city || ''} ${l.state || ''}`)}" target="_blank" rel="noopener">Google Maps</a>
      ${l.phone ? '<button class="btn btn-ghost" id="ltexts">Texts</button>' : ''}
      <button class="btn btn-ghost" id="ledit">Edit</button>
    </div>
    ${l.dnc ? '<p class="badge bad" style="margin-bottom:12px">Do not call</p>' : ''}
    ${l.meet_at && l.meet_at > Date.now() - 2 * 3600e3 ? `<div class="card meet-card"><b>Audit meeting ${esc(new Date(l.meet_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</b>
      ${l.meet_link ? `<a class="btn btn-mint btn-sm" href="${esc(l.meet_link)}" target="_blank" rel="noopener">Join Google Meet</a>` : ''}<a class="btn btn-primary btn-sm" href="/present.html#${esc(l.id)}" target="_blank" rel="noopener">Open presentation</a></div>` : ''}
    <div class="card" id="lprep" style="box-shadow:none;margin-bottom:16px"></div>
    <div class="split" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
      <div>
        <h3>Log a call</h3>
        <div class="outcomes">${DISP.map((d) => `<button class="btn btn-ghost btn-sm" data-out="${esc(d.id)}">${esc(d.label)}</button>`).join('')}</div>
        <label class="field" style="margin-top:10px"><span>Callback or audit time (for Callback and Booked)</span><input type="datetime-local" id="lwhen"></label>
        <label class="field" style="margin-top:10px"><span>Note</span><textarea id="lnote" rows="3" placeholder="What happened on the call"></textarea></label>
        <div class="row" style="margin-top:10px"><button class="btn btn-ghost btn-sm" id="lnotebtn">Save note only</button>
          <label class="field" style="flex:1 1 160px"><select id="lstage">${Object.entries(STAGE_LABEL).map(([k, n]) => `<option value="${k}"${k === l.stage ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div>
        <h3 style="margin-top:22px">Close the deal</h3>
        <p class="small muted" style="margin:0 0 8px">Pick what they need and set the price from discovery. The client sees the services and the price, never the plan name.</p>
        <div class="field"><span>Services they need</span><div class="svc-pick">${SERVICE_LIST.map((s) => `<label class="row small" style="gap:6px;align-items:flex-start"><input type="checkbox" value="${esc(s.id)}"${Q.services.some((x) => x.id === s.id) ? ' checked' : ''}> <span>${esc(s.name)}</span></label>`).join('')}</div></div>
        <div class="row" style="margin-top:8px;gap:8px">
          <label class="field" style="flex:1 1 110px"><span>Buildout $</span><input id="lsetup" inputmode="decimal" value="${esc(Q.setup)}"></label>
          <label class="field" style="flex:1 1 110px"><span>Monthly $</span><input id="lmonthly" inputmode="decimal" value="${esc(Q.monthly)}"></label>
          <label class="field" style="flex:1 1 170px"><span>Internal plan (monthly work)</span><select id="lplan">${Object.entries(PLAN_NAMES).map(([k, n]) => `<option value="${k}"${Q.plan === k ? ' selected' : ''}>${n}${REC === k ? ' (suggested)' : ''}</option>`).join('')}</select></label>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn btn-ghost btn-sm" id="lquote">Save quote</button>
          <button class="btn btn-primary btn-sm" id="lwo">Send work order</button>
          <button class="btn btn-ghost btn-sm" id="lpay">Payment link only</button>
          ${l.client_id ? `<a class="btn btn-ghost btn-sm" href="#/client/${esc(l.client_id)}/overview">Open client</a>` : '<button class="btn btn-ghost btn-sm" id="lwon">Won: create client</button>'}
        </div>
        <div id="lout"></div>
        <details style="margin-top:16px"><summary class="small" style="cursor:pointer;font-weight:600">Website project (separate work order)</summary>
          <div class="row" style="margin-top:8px;gap:8px">
            <label class="field" style="flex:1 1 120px"><span>Build fee $</span><input id="wsetup" inputmode="decimal" placeholder="1500"></label>
            <label class="field" style="flex:1 1 120px"><span>Monthly care $ (optional)</span><input id="wmonthly" inputmode="decimal" placeholder="0"></label></div>
          <label class="field" style="margin-top:8px"><span>What the website includes (one per line)</span><textarea id="wscope" rows="4" placeholder="5 page website: home, about, services, service area, contact&#10;Mobile friendly design&#10;Contact form and tap to call&#10;Basic on-page setup for Google"></textarea></label>
          <button class="btn btn-primary btn-sm" id="lwweb" style="margin-top:8px">Send website work order</button></details>
        ${data.orders.length ? `<h3 style="margin-top:22px">Work orders</h3><ul class="list">${data.orders.map((o) => `<li class="item"><span class="badge ${o.status === 'paid' ? '' : o.status === 'signed' ? 'warn' : 'gray'}">${esc(o.status)}</span>
          <div><div class="item-title">${o.kind === 'website' ? 'Website' : 'Local marketing'} · ${esc(fmt.money((o.setup_cents || 0) / 100))} + ${esc(fmt.money((o.monthly_cents || 0) / 100))}/mo${o.kind === 'website' ? '' : ` <span class="badge gray">${esc(PLAN_NAMES[o.plan] || o.plan)}</span>`}</div><div class="item-sub">${o.signed_name ? `Signed by ${esc(o.signed_name)} ${esc(fmt.ago(o.signed_at))}` : `Sent ${esc(fmt.ago(o.created_at))}`}</div></div>
          <button class="btn btn-ghost btn-sm" data-wo="${esc(o.token)}">Copy link</button></li>`).join('')}</ul>` : ''}
      </div>
      <div>
        <h3>Next step</h3>
        <p>${l.next_action ? `${esc(l.next_action)} <span class="badge gray">${esc(dueText(l.next_action_at))}</span>` : '<span class="muted">None set</span>'}</p>
        ${l.notes ? `<h3>Notes</h3><div class="caption">${esc(l.notes)}</div>` : ''}
        <div class="card" id="lmail" style="box-shadow:none;padding:0;margin-top:18px"></div>
        <h3 style="margin-top:18px">History</h3>
        <ul class="feed">${data.activities.map((a) => `<li><span class="dot">${a.type === 'call' ? icon.msg : a.type === 'payment' ? icon.star : icon.note}</span>
          <div><div>${esc(activityText(a))}</div>${a.body && a.type !== 'stage' ? `<div class="small">${esc(a.body)}</div>` : ''}</div><span class="small">${esc(fmt.ago(a.at))}</span></li>`).join('') || '<li class="muted">Nothing yet.</li>'}</ul>
        <button class="btn btn-danger btn-sm" id="ldel" style="margin-top:16px">Delete lead</button>
      </div>
    </div>`;
  const done = () => { m.close(); onChange?.(); };
  prepPanel($('#lprep', m.el), l, data.intel, { rep: REP, onResearched: () => { changed = true; } });
  $('#ltexts', m.el)?.addEventListener('click', () => textModal(l, { rep: REP, onChange: () => { changed = true; } }));
  // Google: write to them, see what you have already sent, and put a meeting on your own calendar.
  $('#lmailbtn', m.el)?.addEventListener('click', () => import('./hubmail.js').then((x) => x.compose({ to: l.email, subject: `${l.business} and Rightway Growth`, lead_id: l.id })));
  $('#lmeetbtn', m.el).addEventListener('click', () => import('./apptcal.js').then((x) => x.quickAppointment({
    title: `Audit call: ${l.business}`, guest_email: l.email || '', lead_id: l.id, lead_name: l.business,
    note: [l.contact_name && `Contact: ${l.contact_name}`, l.phone && `Phone: ${l.phone}`, l.website && `Site: ${l.website}`].filter(Boolean).join('\n'),
  })));
  if (l.email) import('./hubmail.js').then((x) => x.mailWith($('#lmail', m.el), l.email, { name: l.contact_name || l.business })).catch(() => {});
  $('#ledit', m.el).addEventListener('click', () => { m.close(); leadForm(l, () => onChange?.()); });
  $$('[data-out]', m.el).forEach((b) => b.addEventListener('click', async () => {
    const outcome = b.dataset.out;
    const acts = dispoOf(outcome).acts;
    const when = $('#lwhen', m.el).value;
    if ((acts === 'callback' || acts === 'booked') && !when) return toast('Pick the date and time first.', true);
    busy(b, true);
    try { await api(`/api/leads/${l.id}/outcome`, { method: 'POST', body: { dispo: outcome, note: $('#lnote', m.el).value, callbackAt: when || null } }); toast('Logged'); done(); }
    catch (err) { toast(err.message, true); busy(b, false); }
  }));
  $('#lnotebtn', m.el).addEventListener('click', async () => {
    const t = $('#lnote', m.el).value.trim();
    if (!t) return;
    try { await api(`/api/leads/${l.id}/note`, { method: 'POST', body: { text: t } }); toast('Note saved'); m.close(); leadModal(id, onChange); } catch (err) { toast(err.message, true); }
  });
  $('#lstage', m.el).addEventListener('change', async (e) => {
    try { await api(`/api/leads/${l.id}`, { method: 'PATCH', body: { stage: e.target.value } }); toast('Stage updated'); onChange?.(); } catch (err) { toast(err.message, true); }
  });
  const out = $('#lout', m.el);
  const share = (url, label, msg) => {
    out.innerHTML = `<div class="card" style="box-shadow:none;background:var(--mint-soft);margin-top:12px"><h3>${esc(label)}</h3><div class="copybox"><code>${esc(url)}</code><button class="btn btn-ghost btn-sm" id="cpl">Copy</button></div>
      <div class="row" style="margin-top:10px">${l.phone ? `<a class="btn btn-ghost btn-sm" href="sms:${esc(l.phone.replace(/[^\d+]/g, ''))}?&body=${encodeURIComponent(msg)}">${icon.msg}Text it</a>` : ''}
      ${l.email ? `<a class="btn btn-ghost btn-sm" href="mailto:${esc(l.email)}?subject=${encodeURIComponent('Rightway Growth: your plan')}&body=${encodeURIComponent(msg)}">${icon.mail}Email it</a>` : ''}</div></div>`;
    $('#cpl', out).addEventListener('click', () => copy(url, 'Link copied'));
  };
  // The quote: services picked, buildout, monthly, internal plan. Saved on the lead; the presentation and work order use it.
  const saveQuote = () => api(`/api/leads/${l.id}/quote`, { method: 'PUT', body: {
    plan: $('#lplan', m.el).value, setup: $('#lsetup', m.el).value, monthly: $('#lmonthly', m.el).value,
    services: $$('.svc-pick input:checked', m.el).map((x) => x.value) } });
  $('#lquote', m.el).addEventListener('click', async (e) => { busy(e.target, true); try { await saveQuote(); toast('Quote saved'); changed = true; } catch (err) { toast(err.message, true); } finally { busy(e.target, false); } });
  $('#lwweb', m.el).addEventListener('click', async (e) => {
    busy(e.target, true);
    try {
      const r = await api(`/api/leads/${l.id}/work-order`, { method: 'POST', body: { kind: 'website', setup: $('#wsetup', m.el).value, monthly: $('#wmonthly', m.el).value, scope: $('#wscope', m.el).value } });
      share(r.url, r.hasPayLink ? 'Website work order link (sign, then pay)' : 'Website work order link. No payment link yet: run Set up Stripe in Settings.',
        `Hi ${l.contact_name ? l.contact_name.split(' ')[0] : ''}, here is your Rightway Growth website agreement. Review it, sign, and you can pay right after: ${r.url}`);
    } catch (err) { toast(err.message, true); } finally { busy(e.target, false); }
  });
  $('#lwo', m.el).addEventListener('click', async (e) => {
    busy(e.target, true);
    try {
      await saveQuote();
      const r = await api(`/api/leads/${l.id}/work-order`, { method: 'POST', body: { kind: 'seo', plan: $('#lplan', m.el).value, setup: $('#lsetup', m.el).value, monthly: $('#lmonthly', m.el).value } });
      share(r.url, r.hasPayLink ? 'Work order link (sign, then pay)' : 'Work order link. No payment link yet: run Set up Stripe in Settings, then send a payment link.',
        `Hi ${l.contact_name ? l.contact_name.split(' ')[0] : ''}, here is your Rightway Growth work order. Review it, sign, and you can pay right after: ${r.url}`);
    } catch (err) { toast(err.message, true); } finally { busy(e.target, false); }
  });
  $('#lpay', m.el).addEventListener('click', async (e) => {
    busy(e.target, true);
    const plan = $('#lplan', m.el).value;
    try {
      await saveQuote();
      const r = await api(`/api/leads/${l.id}/payment-link`, { method: 'POST', body: { plan, setup: $('#lsetup', m.el).value, monthly: $('#lmonthly', m.el).value } });
      share(r.link, 'Stripe payment link', `Here is the secure payment link to start your Rightway Growth plan: ${r.link}`);
    } catch (err) { toast(err.message, true); } finally { busy(e.target, false); }
  });
  $('#lwon', m.el)?.addEventListener('click', async (e) => {
    busy(e.target, true);
    try { const r = await api(`/api/leads/${l.id}/convert`, { method: 'POST', body: { plan: $('#lplan', m.el).value } }); m.close(); location.hash = `#/client/${r.clientId}/overview`; }
    catch (err) { toast(err.message, true); busy(e.target, false); }
  });
  $$('[data-wo]', m.el).forEach((b) => b.addEventListener('click', () => copy(`${location.origin}/sign.html#${b.dataset.wo}`, 'Work order link copied')));
  $('#ldel', m.el).addEventListener('click', async () => {
    if (!confirm(`Delete ${l.business} and its history?`)) return;
    try { await api(`/api/leads/${l.id}`, { method: 'DELETE' }); done(); } catch (err) { toast(err.message, true); }
  });
}

function activityText(a) {
  if (a.type === 'call') {
    const o = a.dispo ? [a.outcome, a.dispo] : OUTCOMES.find(([k]) => k === a.outcome);
    return `Call${o ? `: ${o[1]}` : a.status ? ` (${a.status.replace(/_/g, ' ')})` : ''}${a.duration ? `, ${Math.floor(a.duration / 60)}m ${a.duration % 60}s` : ''}`;
  }
  if (a.type === 'note') return 'Note';
  return a.body || a.type;
}

// ---------- CSV import ----------
export function parseCsv(textIn) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(textIn).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const MAP = [
  ['zip', /^(zip|zip ?code|postal|postal ?code|postcode)$/i], ['rating', /^(rating|stars|google rating|avg\.? rating|average rating|review rating)$/i],
  ['reviews', /(reviews?( count)?|# ?of reviews|num(ber)? of reviews|ratings? count|review_count|user_ratings_total)$/i], ['category', /^(category|main category|google category|primary category)$/i],
  ['business', /^(business|company|business name|company name|account|organization|organisation|title|name of business)$/i],
  ['contact_name', /(contact|owner|full name|first name|^name$|decision)/i], ['phone', /(phone|mobile|cell|tel)/i], ['email', /e-?mail/i],
  ['website', /(website|url|domain|site)/i], ['city', /^city$/i], ['state', /^(state|province|region|st)$/i], ['industry', /(industry|category|niche|type|vertical)/i],
  ['address', /address/i],
];

export function mapRows(rows) {
  const [head, ...body] = rows;
  const cols = head.map((h) => { const hit = MAP.find(([, re]) => re.test(h.trim())); return hit ? hit[0] : null; });
  if (!cols.includes('business')) { const i = cols.indexOf('contact_name'); if (i >= 0 && !cols.includes('business')) cols[i] = 'business'; }
  return body.map((r) => {
    const o = {};
    cols.forEach((k, i) => { if (k && r[i] != null && String(r[i]).trim() && !o[k]) o[k] = String(r[i]).trim(); });
    if (o.address && (!o.city || !o.state)) {
      const m = o.address.match(/,\s*([^,]+),\s*([A-Za-z]{2})\b/);
      if (m) { o.city ||= m[1].trim(); o.state ||= m[2].toUpperCase(); }
    }
    delete o.address;
    return o;
  }).filter((o) => o.business);
}

function importModal(onDone) {
  const m = modal(`<div class="card-head"><h2>Import leads</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <p class="muted">Upload a CSV or paste it below. Columns are matched by their headers: business, contact, phone, email, website, address, city, state, zip, industry, category, rating, reviews. Duplicates are skipped by phone, website, and name plus city or zip, including leads marked Do not call. Only use lists you have the right to call.</p>
    <input type="file" id="csvf" accept=".csv,text/csv,text/plain" style="margin:10px 0">
    <textarea id="csvt" rows="8" placeholder="business,contact,phone,city,state,industry&#10;Summit Roofing,Bob,954-555-0101,Hollywood,FL,Roofing"></textarea>
    <p id="csvp" class="small"></p>
    <div class="row"><label class="field" style="flex:1 1 220px"><span>Tag this batch (optional)</span><input id="csvtag" placeholder="e.g. Broward roofers Nov"></label>
      <label class="row small" style="gap:6px"><input type="checkbox" id="csvres"> Research the A and B leads after import</label></div>
    <div class="row end"><button class="btn btn-primary" id="csvgo" disabled>Import</button></div>`);
  let mapped = [];
  const preview = () => {
    mapped = mapRows(parseCsv($('#csvt', m.el).value || ''));
    $('#csvp', m.el).textContent = mapped.length ? `${mapped.length} leads ready. First: ${mapped[0].business}${mapped[0].phone ? `, ${mapped[0].phone}` : ''}` : 'No rows with a business name found yet.';
    $('#csvgo', m.el).disabled = !mapped.length;
  };
  $('#csvt', m.el).addEventListener('input', preview);
  $('#csvf', m.el).addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) { $('#csvt', m.el).value = await f.text(); preview(); } });
  $('#csvgo', m.el).addEventListener('click', async (e) => {
    busy(e.target, true);
    const wantRes = $('#csvres', m.el).checked;
    const startedAt = Date.now() - 5000;
    try {
      const r = await api('/api/leads/import', { method: 'POST', body: { rows: mapped.slice(0, 5000), source: 'import', tags: $('#csvtag', m.el).value } });
      const sb = r.skippedBy || {};
      const why = [['phone', 'same phone'], ['website', 'same website'], ['name', 'same name and area'], ['dnc', 'do not call'], ['invalid', 'no phone or email']].filter(([k]) => sb[k]).map(([k, n]) => `${sb[k]} ${n}`).join(', ');
      m.el.innerHTML = `<div class="card-head"><h2>Import done</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div><p><b>${r.imported}</b> new leads added. ${r.skipped ? `${r.skipped} skipped: ${esc(why)}.` : 'Nothing skipped.'}${r.scrubbed ? ` ${r.scrubbed} scrubbed out (bad or toll free numbers).` : ''}</p>
        <p class="small">Every new lead is now researched in the background (Google profile, map ranks, website, speed), scored and sorted into the dialer's Hot, Good, Maybe and Low queues.</p>
        <p class="small">Every lead is scored. Open the List view and sort by grade, or research them for full scores and pitch notes.</p>`;
      onDone?.();
      if (wantRes && r.imported) {
        const fresh = (await api('/api/leads')).leads.filter((l) => l.created_at >= startedAt && !l.researched && ['A', 'B'].includes(l.grade)).slice(0, 100);
        m.close();
        researchMany(fresh, onDone);
      }
    }
    catch (err) { toast(err.message, true); busy(e.target, false); }
  });
}

// ---------- power dialer ----------
const DIAL_KEY = 'rw-dial-filter';
export async function dialerPage(app, user) {
  setRep(user);
  const view = staffShell(app, user, 'dialer');
  let flt = {};
  try { flt = JSON.parse(localStorage.getItem(DIAL_KEY) || '{}'); } catch { flt = {}; }
  let auto = true;
  try { auto = localStorage.getItem('rw-dial-auto') !== '0'; } catch { /* ignore */ }
  const qs = new URLSearchParams(Object.entries(flt).filter(([, v]) => v)).toString();
  let me, q, cal, nums = { numbers: [] };
  try { [me, q, cal, nums] = await Promise.all([api('/api/me'), api(`/api/dialer/queue?limit=150${qs ? `&${qs}` : ''}`), api('/api/calendar/upcoming').catch(() => ({ meetings: [] })), api('/api/dialer/numbers').catch(() => ({ numbers: [] }))]); }
  catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  await refreshDispos();
  if (me.twilio) startPhone().catch(() => {});
  const offPhone = onPhoneState((st) => { if (!document.body.contains(view)) return offPhone(); const b = $('#pbadge', view); if (b) b.innerHTML = phoneBadge(st); });
  let idx = 0;
  // Power dial: shows the next 3, counts down, rings the first through the browser phone, opens the result popup when it ends,
  // then moves to the next 3. One call at a time, so nobody ever picks up to silence.
  let power = false, pdTimer = null, pdStart = 0, pdCalls = 0, pdWait = 5;
  try { pdWait = Number(localStorage.getItem('rw-pd-wait')) || 5; } catch { /* ignore */ }
  let pdBox = null;
  const powerStop = () => { power = false; clearInterval(pdTimer); pdBox?.remove(); pdBox = null; const b = document.getElementById('pdgo'); if (b) b.textContent = 'Start power dial'; };
  window.addEventListener('hashchange', powerStop, { once: true });
  const sessClock = () => { const t = Math.floor((Date.now() - pdStart) / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  const powerStep = () => {
    clearInterval(pdTimer);
    if (!power) return;
    const next = q.queue.slice(idx, idx + 3);
    if (!pdBox) { pdBox = document.createElement('div'); pdBox.className = 'pd'; document.body.appendChild(pdBox); }
    if (!next.length) { pdBox.innerHTML = `<div class="pd-head">${icon.phone}<span>Power dial</span><b>${pdCalls} calls · ${sessClock()}</b></div><div class="pd-list"><p style="margin:0">Queue clear. Pick another quality tab or time zone.</p></div><div class="pd-foot"><button class="btn btn-primary btn-sm" id="pdx">Close</button></div>`; $('#pdx', pdBox).onclick = powerStop; return; }
    let left = pdWait;
    const draw = () => {
      pdBox.className = 'pd';
      pdBox.innerHTML = `<div class="pd-head">${icon.phone}<span>Power dial · <b>${pdCalls}</b> calls · <b>${sessClock()}</b></span><span class="pd-count">${left}</span></div>
        <div class="pd-bar" style="width:${(100 * (pdWait - left)) / pdWait}%"></div>
        <div class="pd-list">${next.map((l, i) => `<div class="pd-card${i === 0 ? ' first' : ''}"><span class="g ${esc(l.grade || '')}">${esc(l.grade || '?')}</span>
          <div style="min-width:0"><b>${esc(l.business)}</b><span class="small">${esc([l.contact_name, l.city, l.local_time ? `${l.local_time} their time` : ''].filter(Boolean).join(' · '))}</span></div>
          <span class="small">${i === 0 ? 'Calling next' : `Then #${i + 1}`}</span></div>`).join('')}</div>
        <div class="pd-foot"><button class="btn btn-primary btn-sm" id="pdnow">Call now</button><button class="btn btn-ghost btn-sm" id="pdskip">Skip</button><button class="btn btn-ghost btn-sm" id="pdpause">Pause</button>
          <label class="row small" style="gap:6px;margin-left:auto">Wait <select id="pdw" style="width:auto;min-height:32px;padding:4px 8px">${[3, 5, 8, 12].map((v) => `<option${v === pdWait ? ' selected' : ''}>${v}</option>`).join('')}</select> s</label></div>`;
      $('#pdnow', pdBox).onclick = () => { clearInterval(pdTimer); dialFirst(); };
      $('#pdskip', pdBox).onclick = () => { clearInterval(pdTimer); idx++; render(); };
      $('#pdpause', pdBox).onclick = () => { clearInterval(pdTimer); pdBox.querySelector('.pd-count').textContent = 'II'; $('#pdpause', pdBox).textContent = 'Resume'; $('#pdpause', pdBox).onclick = () => powerStep(); };
      $('#pdw', pdBox).onchange = (e) => { pdWait = Number(e.target.value); try { localStorage.setItem('rw-pd-wait', String(pdWait)); } catch { /* ignore */ } };
    };
    draw();
    pdTimer = setInterval(() => { left--; if (left <= 0) { clearInterval(pdTimer); dialFirst(); } else draw(); }, 1000);
  };
  const dialFirst = () => {
    const btn = document.getElementById('dhub');
    if (!btn || btn.disabled) { toast('The browser phone is not ready. Check Phone setup.', true); return powerStop(); }
    pdCalls++;
    if (pdBox) { pdBox.className = 'pd mini'; pdBox.querySelector('.pd-count').textContent = 'LIVE'; }
    btn.click();
  };
  const intelCache = new Map();
  const researching = new Set();
  const prefetch = async (l) => {
    if (!l || intelCache.has(l.id) || researching.has(l.id)) return;
    researching.add(l.id);
    try {
      const d = await api(`/api/leads/${l.id}`);
      let intel = d.intel;
      if (!intel && auto) { const r = await api(`/api/leads/${l.id}/research`, { method: 'POST', body: {} }); intel = r.intel; Object.assign(l, { score: r.score, grade: r.grade, plan: l.plan || r.plan }); }
      intelCache.set(l.id, intel || null);
    } catch { intelCache.set(l.id, null); } finally { researching.delete(l.id); }
    if (q.queue[idx]?.id === l.id) showPrep();
  };
  const showPrep = () => {
    const l = q.queue[idx];
    const el = $('#dprep', view);
    if (!l || !el) return;
    if (!intelCache.has(l.id)) { el.innerHTML = `<div class="skeleton"></div><p class="small">${auto ? 'Researching this lead: Google profile, map ranks, website, speed...' : 'Loading...'}</p>`; return; }
    const g = $('#dgrade', view);
    if (g) g.innerHTML = gradeBadge(l.grade, l.score);
    prepPanel(el, l, intelCache.get(l.id), { rep: REP, onResearched: (next, intel) => { Object.assign(l, next); intelCache.set(l.id, intel); const gg = $('#dgrade', view); if (gg) gg.innerHTML = gradeBadge(l.grade, l.score); } });
  };
  const upcoming = (cal.meetings || []).filter((m) => m.meet_at > Date.now() - 3600e3).slice(0, 4);
  // Low prepaid balance on Twilio or DataForSEO: say so before calls or research start failing.
  setTimeout(() => api('/api/balances/status').then((b) => { const el = document.getElementById('lowbal'); if (el && b.low?.length) el.innerHTML = `<div class="card" style="border-color:#E8A33D;margin-bottom:12px"><b>${b.low.map((x) => esc(x.name)).join(' and ')} balance ${b.low.some((x) => x.empty) ? 'is empty' : 'is low'}.</b> <span class="small">${b.low.some((x) => x.key === 'twilio') ? 'Calls and texts stop when Twilio runs out. ' : ''}${b.low.some((x) => x.key === 'dataforseo') ? 'Research and scans stop when DataForSEO runs out. ' : ''}An owner can add funds from the Dashboard.</span></div>`; }).catch(() => {}), 50);
  const filterText = Object.entries(flt).filter(([k, v]) => v && k !== 'tier').map(([k, v]) => `${k === 'tz' ? 'Time zone' : k[0].toUpperCase() + k.slice(1)}: ${v}`).join(' · ');
  const render = () => {
    const l = q.queue[idx];
    view.innerHTML = `
      <div class="page-head"><div><p class="eyebrow">Power dialer</p><h1>Call queue</h1></div>
        <div class="row"><span class="badge">${q.queue.length - idx} ready now</span>${q.waitingForHours ? `<span class="badge gray">${q.waitingForHours} waiting for their calling hours</span>` : ''}
          <label class="row small" style="gap:6px"><input type="checkbox" id="dauto"${auto ? ' checked' : ''}> Auto research ahead</label><a class="btn btn-ghost btn-sm" href="#/pipeline">Pipeline</a>
          ${me.twilio ? `<button class="btn btn-primary btn-sm" id="pdgo">${power ? 'Power dialing...' : 'Start power dial'}</button>` : ''}</div></div>
      ${dialTabs('queue', user)}
      <div class="tiers">${[['', 'Best first', 'all'], ['hot', 'Hot', 'A grade, callbacks, audit requests'], ['good', 'Good', 'B grade'], ['maybe', 'Maybe', 'C grade'], ['low', 'Low', 'D grade'], ['fresh', 'Not researched', 'researching in the background']]
        .map(([k, n, t]) => `<button type="button" data-tier="${k}" title="${esc(t)}" class="${(flt.tier || '') === k ? 'is-on' : ''}">${n}<b>${k ? (q.tiers?.[k] ?? 0) : Object.values(q.tiers || {}).reduce((a, b) => a + b, 0)}</b></button>`).join('')}</div>
      <div id="rsx" class="small muted" style="margin:-6px 0 12px"></div>
      ${filterText ? `<div class="row small" style="margin:-6px 0 14px">Dialing: ${esc(filterText)} <button class="linkbtn" id="dclear">Dial everyone instead</button></div>` : ''}
      <div class="stats">
        <div class="stat hero"><div class="stat-num">${q.stats.dials}</div><div class="stat-label">dials today (target 60)</div></div>
        <div class="stat"><div class="stat-num">${q.stats.talks}</div><div class="stat-label">owner conversations</div></div>
        <div class="stat"><div class="stat-num">${q.stats.booked}</div><div class="stat-label">audits booked</div></div>
        <div class="stat"><div class="stat-num">${q.stats.dials ? Math.round((q.stats.talks / q.stats.dials) * 100) : 0}%</div><div class="stat-label">contact rate</div></div>
      </div>
      <div id="lowbal"></div>
      ${upcoming.length ? `<div class="card upcoming"><b>Coming up</b>${upcoming.map((m) => `<span class="badge${m.meet_at < Date.now() + 3600e3 ? ' warn' : ''}">${esc(new Date(m.meet_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))} ${esc(m.business)}</span>
        ${m.meet_link ? `<a class="small" href="${esc(m.meet_link)}" target="_blank" rel="noopener">Meet</a>` : ''}<a class="small" href="/present.html#${esc(m.id)}" target="_blank" rel="noopener">Present</a>`).join('')}</div>` : ''}
      ${!l ? `<div class="card empty"><h3>Queue clear</h3><p>No one is due right now inside 8am to 8pm their time${filterText ? ' for this filter' : ''}. Import leads or check back later.</p><a class="btn btn-primary" href="#/pipeline">Go to pipeline</a></div>` : `
      <div class="dial-grid">
        <div class="dial-left">
          <div class="card dial-card">
            <p class="eyebrow">${esc(STAGE_LABEL[l.stage])}${l.attempts ? ` · attempt ${l.attempts + 1}` : ''}${l.next_action ? ` · ${esc(l.next_action)}` : ''}</p>
            <div class="row" style="gap:12px;flex-wrap:nowrap"><span id="dgrade">${gradeBadge(l.grade, l.score)}</span><h2 style="font-size:28px;margin:0;min-width:0">${esc(l.business)}</h2></div>
            <div class="muted" style="margin-top:6px">${esc([l.contact_name, l.industry || l.category, [l.city, l.state].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</div>
            <div class="row" style="margin:12px 0"><span class="badge">${l.tz_known ? `Their time: ${esc(l.local_time)}` : 'Time zone unknown: add the state'}</span>${l.sms_consent ? '<span class="badge">Agreed to texts</span>' : ''}${l.reviews != null ? `<span class="badge gray">${l.reviews} reviews${l.rating ? ` · ${l.rating}★` : ''}</span>` : ''}</div>
            <div class="dial-phone">${esc(l.phone || '')}</div>
            <div class="row" style="margin-top:14px">
              ${me.twilio ? `<button class="btn btn-mint btn-xl" style="width:auto;flex:1 1 200px" id="dhub">${icon.phone}Call</button>` : ''}
              <a class="btn ${me.twilio ? 'btn-ghost' : 'btn-mint btn-xl'}" style="width:auto;${me.twilio ? '' : 'flex:1 1 200px'}" href="${telHref(l.phone)}" id="dtel">${me.twilio ? '' : icon.phone}Call from my phone</a>
            </div>
            ${me.twilio ? `<div class="row" style="margin-top:10px;align-items:flex-end">${nums.numbers.length > 1 ? callerSelect(nums.numbers) : ''}<span id="pbadge" style="margin-bottom:10px">${phoneBadge()}</span></div>` : ''}
            <div class="row" style="margin-top:12px">
              <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/${encodeURIComponent(`${l.industry || l.category || ''} ${l.city || ''} ${l.state || ''}`)}">Map pack</a>
              <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/${encodeURIComponent(`${l.business} ${l.city || ''}`)}">Their profile</a>
              ${l.website ? `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${esc(/^https?:/.test(l.website) ? l.website : `https://${l.website}`)}">Website</a>` : ''}
              <button class="btn btn-ghost btn-sm" id="dtext">Text</button>
              <button class="btn btn-ghost btn-sm" id="dopen">Full details</button>
            </div>
          </div>
          <div class="card">
            <h3>How did it go?</h3>
            <div class="outcomes big">${DISP.map((d) => `<button class="btn btn-ghost" data-out="${esc(d.id)}">${d.key ? `<span class="kbd">${d.key}</span>` : ''}${esc(d.label)}</button>`).join('')}</div>
            <label class="field" style="margin-top:12px"><span>Callback or audit time</span><input type="datetime-local" id="dwhen"></label>
            <label class="field" style="margin-top:10px"><span>Note</span><textarea id="dnote" rows="3" placeholder="Job value, capacity, who handles marketing, what they said"></textarea></label>
            <div class="row" style="margin-top:12px"><button class="btn btn-ghost btn-sm" id="dskip">Skip for now</button><button class="btn btn-ghost btn-sm" id="dbook">Booked: send Meet invite</button><span class="small">Keys 1 to 9 log an outcome.</span></div>
            ${l.notes ? `<h3 style="margin-top:18px">Notes</h3><div class="caption">${esc(l.notes)}</div>` : ''}
          </div>
        </div>
        <div class="card dial-prep" id="dprep"></div>
      </div>`}`;
    $('#dauto', view)?.addEventListener('change', (e) => { auto = e.target.checked; try { localStorage.setItem('rw-dial-auto', auto ? '1' : '0'); } catch { /* ignore */ } if (auto) { intelCache.delete(q.queue[idx]?.id); prefetch(q.queue[idx]); } });
    $('#dclear', view)?.addEventListener('click', () => { try { localStorage.removeItem(DIAL_KEY); } catch { /* ignore */ } dialerPage(app, user); });
    $$('[data-tier]', view).forEach((b) => b.addEventListener('click', () => { flt = { ...flt, tier: b.dataset.tier }; try { localStorage.setItem(DIAL_KEY, JSON.stringify(flt)); } catch { /* ignore */ } dialerPage(app, user); }));
    $('#pdgo', view)?.addEventListener('click', () => { power = !power; if (power) { pdStart = pdStart || Date.now(); powerStep(); } else powerStop(); $('#pdgo', view).textContent = power ? 'Power dialing...' : 'Start power dial'; });
    if (!l) return;
    showPrep();
    prefetch(l);
    prefetch(q.queue[idx + 1]);
    $('#dskip', view).addEventListener('click', () => { idx++; render(); });
    $('#dopen', view).addEventListener('click', () => leadModal(l.id, () => {}));
    $('#dtext', view).addEventListener('click', () => textModal(l, { rep: REP }));
    const bookedId = (DISP.find((d) => d.acts === 'booked') || { id: 'booked' }).id;
    $('#dbook', view).addEventListener('click', () => bookModal(l, () => logOutcome(bookedId, $(`[data-out="${bookedId}"]`, view), true)));
    const callerVal = bindCaller(view);
    $('#dhub', view)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      busy(btn, true);
      try {
        await placeCall({ leadId: l.id, from: callerVal(), name: l.business, onEnd: ({ answered }) => {
          if (q.queue[idx]?.id !== l.id) return;
          dispositionModal({ title: l.business, sub: answered ? 'Pick how it went. It moves the lead to the right next step.' : 'No one picked up? Pick the result.', answered,
            onSave: async (r) => {
              const note = $('#dnote', view); if (note && r.note) note.value = [note.value, r.note].filter(Boolean).join('\n');
              const w = $('#dwhen', view); if (w && r.callbackAt) w.value = r.callbackAt;
              await logOutcome(r.dispo, $(`[data-out="${r.dispo}"]`, view));
            } });
        } });
      }
      catch (err) { toast(err.message, true); } finally { busy(btn, false); }
    });
    $$('[data-out]', view).forEach((b) => b.addEventListener('click', () => logOutcome(b.dataset.out, b)));
    if (power) setTimeout(powerStep, 300);
    paintResearch();
  };
  // Background research status, and a nudge every 20 seconds while this page is open so grading keeps up with imports.
  let rs = null;
  const paintResearch = () => {
    const el = document.getElementById('rsx'); if (!el || !rs) return;
    el.innerHTML = !rs.connected ? 'Background research needs DataForSEO connected.' : !rs.on ? `Background research is off${user.role === 'admin' ? ' (Settings)' : ''}.` : rs.left ? `Researching ${rs.left} lead${rs.left === 1 ? '' : 's'} in the background (${rs.done} of ${rs.cap} today). They move into Hot, Good, Maybe or Low as they finish.${rs.scrubbed ? ` ${rs.scrubbed} scrubbed out.` : ''}` : `Every lead is researched and graded.${rs.scrubbed ? ` ${rs.scrubbed} scrubbed out (bad numbers, toll free, closed).` : ''}`;
  };
  const rsTick = async () => {
    if (!document.body.contains(view)) return clearInterval(rsTimer);
    try { rs = await api('/api/research/status'); paintResearch(); if (rs.on && rs.connected && rs.left && rs.done < rs.cap) await api('/api/research/tick', { method: 'POST' }); } catch { /* ignore */ }
  };
  const rsTimer = setInterval(rsTick, 20e3);
  setTimeout(rsTick, 1500);
  const logOutcome = async (outcome, btn, alreadyBooked = false) => {
    const l = q.queue[idx];
    const acts = dispoOf(outcome).acts;
    const when = $('#dwhen', view)?.value;
    if (acts === 'callback' && !when) return toast('Pick the date and time first.', true);
    if (acts === 'booked' && !when && !alreadyBooked) return bookModal(l, () => logOutcome(outcome, btn, true));
    busy(btn, true);
    try {
      if (!(alreadyBooked && acts === 'booked')) await api(`/api/leads/${l.id}/outcome`, { method: 'POST', body: { dispo: outcome, note: $('#dnote', view).value, callbackAt: when || null } });
      else if ($('#dnote', view).value) await api(`/api/leads/${l.id}/note`, { method: 'POST', body: { text: $('#dnote', view).value } });
      q.stats.dials++;
      if (['conversation', 'booked', 'callback', 'not_interested'].includes(acts)) q.stats.talks++;
      if (acts === 'booked') { q.stats.booked++; toast('Audit booked'); }
      idx++;
      render();
    } catch (err) { toast(err.message, true); busy(btn, false); }
  };
  const onKey = (e) => {
    if (!document.body.contains(view) || /input|textarea|select/i.test(e.target.tagName) || document.querySelector('.modal-bg')) return;
    const o = DISP.find((d) => d.key && d.key === e.key);
    if (o) { const b = $(`[data-out="${o.id}"]`, view); if (b) logOutcome(o.id, b); }
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => document.removeEventListener('keydown', onKey), { once: true });
  render();
}

// ---------- settings ----------
export async function settingsPage(app, user) {
  const view = staffShell(app, user, 'settings');
  let s, me, g;
  try { [s, me, g] = await Promise.all([api('/api/settings'), api('/api/me'), api('/api/google/status').catch(() => null)]); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const gmsg = new URLSearchParams(location.search).get('google');
  if (gmsg) { toast(gmsg === 'ok' ? 'Google connected' : gmsg, gmsg !== 'ok'); history.replaceState(null, '', `${location.pathname}${location.hash}`); }
  const { DEFAULT_SCRIPT, DEFAULT_OBJECTIONS, SCRIPT_KEYS } = await import('/js/leadintel.js');
  const sc = { ...DEFAULT_SCRIPT, ...(s.script || {}) };
  const obs = s.objections || DEFAULT_OBJECTIONS;
  const bk = g?.booking || {};
  const bookUrl = `${location.origin}/book.html`;
  const isAdmin = user.role === 'admin';
  const c = s.connected;
  const pill = (on) => `<span class="badge ${on ? '' : 'gray'}">${on ? 'Connected' : 'Not connected'}</span>`;
  const formUrl = `${location.origin}/api/public/lead`;
  view.innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>${settingsTabs('general', user)}
    ${isAdmin ? '<div class="card" id="setbal"></div><div class="card" id="setrs"></div>' : ''}
    <div id="stripesetup"></div>
    <div class="card"><div class="card-head"><h2>Stripe payment links</h2>${pill(c.stripe)}</div>
      <p class="muted">The Stripe setup above fills these in for you. You can also paste each plan's payment link from Stripe (Payment Links, Copy link) to use your own. Work orders and the "Payment link" button use these, tagged with the lead, so payment marks the deal won and creates the client automatically.</p>
      <form id="plinks" class="form-grid">
        ${[['leader', 'Market Leader ($1,198 first charge)'], ['authority', 'Authority ($998)'], ['growth', 'Growth ($898)'], ['starter', 'Starter ($798)']]
          .map(([k, n]) => `<label class="field"><span>${n}</span><input name="${k}" value="${esc(s.links[k])}" placeholder="https://buy.stripe.com/..."${user.role === 'admin' ? '' : ' disabled'}></label>`).join('')}
        ${user.role === 'admin' ? '<div class="span-all row end"><button class="btn btn-primary" type="submit">Save links</button></div>' : ''}
      </form></div>
    <div class="card"><div class="card-head"><h2>Connections</h2></div>
      <ul class="list">
        ${[['DataForSEO (scans and lead research)', c.dataforseo, 'DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD'], ['Google Calendar and Meet', c.google, 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET'], ['Stripe (billing status)', c.stripe, 'STRIPE_SECRET_KEY (restricted key)'],
          ['Stripe webhook (auto-win on payment)', c.stripeWebhook, `Stripe setup above, or STRIPE_WEBHOOK_SECRET. Endpoint: ${location.origin}/api/stripe/webhook`],
          ['Twilio (call through the Hub)', c.twilio, 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM'], ['Claude (Ask Claude, captions, page drafts)', c.ai, 'ANTHROPIC_API_KEY'],
          ['Email sending', c.email, 'RESEND_API_KEY, EMAIL_FROM'], ['Photo storage', c.media, 'R2 bucket rightway-media']]
          .map(([n, on, keys]) => `<li class="item">${pill(on)}<div><div class="item-title">${esc(n)}</div><div class="item-sub mono">${esc(keys)}</div></div><span></span></li>`).join('')}
      </ul><p class="small" style="margin-top:12px">Add keys in Cloudflare under Build variables and secrets, then ask Claude to rebuild.</p></div>
    <div class="card"><div class="card-head"><h2>Google Calendar and Meet</h2>${pill(g?.connected)}</div>
      ${!g?.ready ? `<p class="muted">Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Cloudflare Build secrets first. In Google Cloud, the OAuth redirect address is:</p><div class="copybox"><code>${esc(location.origin)}/api/google/callback</code><button class="btn btn-ghost btn-sm" data-copy="${esc(location.origin)}/api/google/callback">Copy</button></div>`
        : g.connected ? `<p>Connected as <b>${esc(g.email || 'your Google account')}</b>. Meetings you book from a lead go on this calendar with a Meet link and the lead gets the invite.</p><div class="row"><button class="btn btn-ghost btn-sm" id="gdisc">Disconnect</button></div>`
        : `<p class="muted">Connect the Google account whose calendar you use for audits.</p><a class="btn btn-primary" href="/api/google/connect">Connect Google</a>`}
      ${g?.ready ? `<h3 style="margin-top:20px">Public booking page</h3>
        <p class="muted">Leads pick an open time from ${esc(bk.ownerEmail || 'the connected calendar')} and get a Meet invite. Link it from your site, emails, and texts.</p>
        <div class="copybox"><code>${esc(bookUrl)}</code><button class="btn btn-ghost btn-sm" data-copy="${esc(bookUrl)}">Copy</button></div>
        <form id="bkset" class="form-grid" style="margin-top:12px">
          <label class="field"><span>Meeting name</span><input name="title" value="${esc(bk.title || '')}"${isAdmin ? '' : ' disabled'}></label>
          <label class="field"><span>Length (minutes)</span><input name="minutes" type="number" min="15" max="120" value="${esc(bk.minutes ?? 30)}"${isAdmin ? '' : ' disabled'}></label>
          <label class="field"><span>First slot (hour, 24h)</span><input name="start" type="number" min="0" max="23" value="${esc(bk.startHour ?? 9)}"${isAdmin ? '' : ' disabled'}></label>
          <label class="field"><span>Last end time (hour, 24h)</span><input name="end" type="number" min="1" max="24" value="${esc(bk.endHour ?? 17)}"${isAdmin ? '' : ' disabled'}></label>
          <label class="field"><span>Days (0 Sun to 6 Sat)</span><input name="days" value="${esc((bk.weekdays || [1, 2, 3, 4, 5]).join(','))}"${isAdmin ? '' : ' disabled'}></label>
          <label class="field"><span>Buffer between (minutes)</span><input name="buffer" type="number" min="0" max="120" value="${esc(bk.buffer ?? 15)}"${isAdmin ? '' : ' disabled'}></label>
          <label class="field"><span>Minimum notice (hours)</span><input name="notice" type="number" min="0" max="168" value="${esc(bk.noticeHours ?? 4)}"${isAdmin ? '' : ' disabled'}></label>
          <label class="field"><span>Time zone</span><input name="tz" value="${esc(bk.tz || 'America/New_York')}"${isAdmin ? '' : ' disabled'}></label>
          ${isAdmin ? `<div class="span-all row end">${g.connected ? '<label class="row small" style="gap:6px"><input type="checkbox" name="ownerSelf"> Book on my calendar</label>' : ''}<button class="btn btn-primary" type="submit">Save booking settings</button></div>` : ''}
        </form>` : ''}
    </div>
    <div class="card"><div class="card-head"><h2>Call script</h2></div>
      <p class="muted">The dialer and the presentation fill these in for each lead. One line per thing to say. Start a line with "Or:" for an alternative, and wrap coaching notes in (parentheses).</p>
      <p class="small mono">{first} {rep} {my_number} {business} {city} {industry} {keyword} {scan_line} {hook_impact} {opener_reason} {vm_scan} {rank} {top_name} {top_name_or_them} {top_reviews} {top3_of_points} {top10_of_points} {reviews} {rating} {plan} {plan_why} {price} {setup} {starter_price} {ticket} {breakeven} {breakeven_jobs} {problems} {slot1} {slot2} {email_or_phone} {email_or_ask}</p>
      <form id="scf" class="form-grid" style="grid-template-columns:1fr">
        ${SCRIPT_KEYS.map(([k, n]) => `<label class="field"><span>${n}</span><textarea name="${k}" rows="${Math.min(9, Math.max(3, String(sc[k] || '').split('\n').length + 1))}"${isAdmin ? '' : ' disabled'}>${esc(Array.isArray(sc[k]) ? sc[k].join('\n') : sc[k])}</textarea></label>`).join('')}
        <label class="field"><span>Objections (one per block: the objection on the first line, the answer below, blank line between)</span><textarea name="objections" rows="14"${isAdmin ? '' : ' disabled'}>${esc(obs.map(([q, a]) => `${q}\n${a}`).join('\n\n'))}</textarea></label>
        ${isAdmin ? '<div class="row end"><button class="btn btn-ghost" type="button" id="screset">Reset to default</button><button class="btn btn-primary" type="submit">Save script</button></div>' : ''}
      </form></div>
    <div id="autoscan"></div>
    <div class="card"><div class="card-head"><h2>Lead research</h2></div>
      <form id="resf" class="row"><label class="field" style="flex:0 1 260px"><span>Rank check radius (miles)</span><input name="research_radius" type="number" min="0.5" max="10" step="0.5" value="${esc(s.research_radius || 2)}"${isAdmin ? '' : ' disabled'}></label>
        ${isAdmin ? '<button class="btn btn-ghost" type="submit">Save</button>' : ''}</form>
      <p class="small" style="margin-top:8px">Research checks 9 points around the business. Use 1 to 2 miles in dense cities, 3 to 5 for suburbs and service area businesses.</p></div>
    <div class="card"><div class="card-head"><h2>Your phone for the dialer</h2></div>
      <form id="myphone" class="row"><input name="phone" value="${esc(me.user.phone || '')}" placeholder="Your mobile number" style="flex:1 1 220px"><button class="btn btn-primary" type="submit">Save</button></form>
      <p class="small" style="margin-top:8px">With Twilio connected, "Call through the Hub" rings this phone first, then connects you to the lead from the business number. Recording stays off.</p></div>
    <div class="card"><div class="card-head"><h2>Website form</h2></div>
      <p class="muted">Point the audit form on rightwaygrowth.com here and requests land in the pipeline as "Audit requested", at the top of the call queue.</p>
      <div class="copybox"><code>${esc(formUrl)}</code><button class="btn btn-ghost btn-sm" id="cpf">Copy</button></div></div>`;
  $('#cpf', view).addEventListener('click', () => copy(formUrl, 'Form address copied'));
  if (isAdmin) import('./balances.js').then((m) => m.balancesCard($('#setbal', view)));
  if (isAdmin) api('/api/research/status').then((r) => {
    const box = $('#setrs', view); if (!box) return;
    box.innerHTML = `<div class="card-head"><h2>Lead research and scrubbing</h2><span class="small muted">${r.left} waiting · ${r.scrubbed} scrubbed</span></div>
      <p class="small">Every imported lead is researched in the background (about $0.04 each on DataForSEO), scored, graded and split into the dialer's quality queues. Bad and toll free numbers and businesses closed on Google are scrubbed out.</p>
      <div class="row"><label class="row" style="gap:8px"><input type="checkbox" id="rson"${r.on ? ' checked' : ''}> Research every new lead automatically</label>
        <label class="row small" style="gap:6px">Daily cap <input id="rscap" type="number" min="0" max="5000" value="${r.cap}" style="width:100px"> leads (about $${(r.cap * 0.04).toFixed(0)} a day at most)</label>
        <button class="btn btn-ghost btn-sm" id="rssave">Save</button></div>`;
    $('#rssave', box).addEventListener('click', async () => { try { await api('/api/research/settings', { method: 'PUT', body: { on: $('#rson', box).checked, cap: Number($('#rscap', box).value) } }); toast('Saved'); } catch (e) { toast(e.message, true); } });
  }).catch(() => {});
  stripeSetup($('#stripesetup', view), user);
  autoScanCard($('#autoscan', view), user);
  $$('[data-copy]', view).forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy, 'Copied')));
  $('#gdisc', view)?.addEventListener('click', async () => { try { await api('/api/google/disconnect', { method: 'POST' }); toast('Disconnected'); settingsPage(app, user); } catch (err) { toast(err.message, true); } });
  $('#bkset', view)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    try { await api('/api/google/booking', { method: 'PUT', body: { ...f, ownerSelf: Boolean(f.ownerSelf) } }); toast('Booking settings saved'); } catch (err) { toast(err.message, true); }
  });
  $('#scf', view)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    const objections = String(f.objections || '').split(/\n\s*\n/).map((b) => b.trim().split('\n')).filter((x) => x.length >= 2).map(([q, ...a]) => [q.trim(), a.join(' ').trim()]);
    const script = Object.fromEntries(SCRIPT_KEYS.map(([k]) => [k, f[k] || '']));
    try { await api('/api/settings', { method: 'PUT', body: { script, objections } }); clearScriptCache(); toast('Script saved'); } catch (err) { toast(err.message, true); }
  });
  $('#screset', view)?.addEventListener('click', async () => {
    if (!confirm('Reset the script and objections to the default?')) return;
    try { await api('/api/settings', { method: 'PUT', body: { script: null, objections: [] } }); clearScriptCache(); settingsPage(app, user); } catch (err) { toast(err.message, true); }
  });
  $('#resf', view)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/settings', { method: 'PUT', body: { research_radius: e.target.research_radius.value } }); toast('Saved'); } catch (err) { toast(err.message, true); }
  });
  $('#plinks', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/settings', { method: 'PUT', body: { links: Object.fromEntries(new FormData(e.target).entries()) } }); toast('Links saved'); } catch (err) { toast(err.message, true); }
  });
  $('#myphone', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/me/phone', { method: 'PUT', body: { phone: e.target.phone.value } }); toast('Saved'); } catch (err) { toast(err.message, true); }
  });
}

// ---------- billing tab (client page) ----------
export async function billingTab(el, c) {
  el.innerHTML = '<div class="skeleton"></div>';
  let b;
  try { b = await api(`/api/clients/${c.id}/billing`); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  if (!b.connected) { el.innerHTML = '<div class="card empty"><h3>Stripe is not connected yet</h3><p>Add STRIPE_SECRET_KEY in Cloudflare, then billing shows here.</p></div>'; return; }
  if (!b.linked) {
    el.innerHTML = `<div class="card"><h2>Link this client to Stripe</h2><p class="muted">Payments through a Hub work order link automatically. For anyone who paid another way, find them by billing email.</p>
      <form id="blink" class="row"><input name="email" type="email" value="${esc(c.contact_email || '')}" placeholder="Billing email" style="flex:1 1 240px" required><button class="btn btn-primary">Find in Stripe</button></form></div>`;
    $('#blink', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api(`/api/clients/${c.id}/billing/link`, { method: 'POST', body: { email: e.target.email.value } }); toast('Linked'); billingTab(el, c); } catch (err) { toast(err.message, true); }
    });
    return;
  }
  const sub = b.subscriptions?.[0];
  el.innerHTML = `
    <div class="stats">
      <div class="stat hero"><div class="stat-num">${fmt.money((b.mrr_cents || 0) / 100)}</div><div class="stat-label">monthly from Stripe</div></div>
      <div class="stat"><div class="stat-num" style="font-size:24px">${esc((sub?.status || b.status || '-').replace('_', ' '))}</div><div class="stat-label">subscription status</div></div>
      <div class="stat"><div class="stat-num" style="font-size:24px">${sub?.current_period_end ? esc(fmt.date(sub.current_period_end)) : '-'}</div><div class="stat-label">${sub?.cancel_at_period_end ? 'ends on' : 'next charge'}</div></div>
    </div>
    <div class="card"><div class="card-head"><h2>Invoices</h2><button class="btn btn-ghost btn-sm" id="bportal">Open Stripe portal</button></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Number</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
      ${(b.invoices || []).map((i) => `<tr><td>${esc(fmt.date(i.created))}</td><td>${esc(i.number || '-')}</td><td>${fmt.money(i.amount_cents / 100)}</td><td><span class="badge ${i.status === 'paid' ? '' : 'warn'}">${esc(i.status)}</span></td><td>${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">View</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No invoices yet.</td></tr>'}
      </tbody></table></div></div>`;
  $('#bportal', el).addEventListener('click', async () => { try { const r = await api(`/api/clients/${c.id}/billing/portal`, { method: 'POST' }); window.open(r.url, '_blank'); } catch (err) { toast(err.message, true); } });
}
