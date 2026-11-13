// CRM screens: pipeline board, lead details, CSV import, power dialer, settings.
import { $, $$, esc, api, toast, copy, fmt, icon, busy, modal, makeDraggable, isPhone, editGoal, trayAdd, trayRemove } from './core.js';
import { staffShell, settingsTabs } from './staff.js';
import { prepPanel, gradeBadge, bookModal, clearScriptCache, fold, wireFolds } from './prep.js';
import { textModal } from './texts.js';
import { dialTabs, callerSelect, bindCaller, phoneBadge } from './dialout.js';
import { loadDispos, keyed, dispositionModal } from './dispo.js';
import { stripeSetup } from './stripesetup.js';
import { autoScanCard } from './scans.js';
import { hoverCards, hoverHtml } from './hovercard.js';
import { isPersonName, titleLike } from '/js/names.js';
import { placeCall, startPhone, onPhoneState, phoneState, hangUp, contactRows, initialsOf, takeCallDraft, wrapUp } from './phone.js';
import { warmAudio, holdMic, dropMic } from './audioset.js';
import { arriving, leaving } from './dialwin.js';
import { testLeads, testIntel } from '/js/testleads.js';
import { testTextModal, testBookModal, testLeadModal, testSummaryHtml } from './testdial.js';
import { practiceModal } from './practice.js';
import { filterLeads } from '/js/leadfilter.js';
import { quoteFor, callCategory, whoIs, personOf, CALL_CATS } from '/js/leadintel.js';
import { refLines } from '/js/planref.js';
import { WEB_TIERS, webTierById, webLines, money as webMoney } from '/js/webprice.js';
import { SCOPE, effort, hoursOf } from '/js/scope.js';
import { can, canRunCalls } from '/js/jobs.js';
import { PHONE_TYPE_LABEL, EMAIL_STATUS_LABEL } from '/js/scrub.js';
import { bothTimes, validZone, fromInputs, inputsIn } from '/js/apptime.js';
const yourZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
import { licenseSearchUrl, sunbizSearchUrl } from '/js/freedata.js';
import { registryFor } from '/js/registries.js';
import { RESEARCH_DEPTHS, adsLine, adLibraryLinks, directoryLinks } from '/js/freedata.js';

export const STAGE_LABEL = {
  new: 'New lead', attempting: 'Attempting', callback: 'Callback set', audit_requested: 'Audit requested', audit_booked: 'Audit booked',
  no_show: 'No-show', follow_up: 'Following up', won: 'Won', not_now: 'Not now', lost: 'Lost', dnc: 'Do not call',
};
// Stages the dialer can call (the same list the server uses).
const DIALABLE = ['new', 'attempting', 'callback', 'audit_requested', 'no_show', 'follow_up', 'not_now'];
const BOARD = ['new', 'attempting', 'callback', 'audit_requested', 'audit_booked', 'no_show', 'follow_up', 'won'];
const CLOSED = ['not_now', 'lost', 'dnc'];
// Built in results, used until the custom list loads and for older call records.
const OUTCOMES = [
  ['no_answer', 'No answer', '1'], ['voicemail', 'Voicemail', '2'], ['gatekeeper', 'Gatekeeper', '3'], ['conversation', 'Talked, follow up', '4'],
  ['booked', 'Booked audit', '5'], ['callback', 'Callback', '6'], ['not_interested', 'Not interested', '7'], ['bad_number', 'Bad number', '8'], ['dnc', 'Do not call', '9'], ['phone_menu', 'Phone menu, nobody to reach', ''],
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
let REP = '', VOICE = 'I';
export const setRep = (user) => { REP = (user?.name || '').split(' ')[0] || ''; VOICE = user?.role === 'admin' ? 'I' : 'we'; };
const telHref = (p) => `tel:${String(p || '').replace(/[^\d+]/g, '')}`;

// ---------- pipeline ----------
const TZS = [['ET', 'Eastern'], ['CT', 'Central'], ['MT', 'Mountain'], ['AZ', 'Arizona'], ['PT', 'Pacific'], ['AK', 'Alaska'], ['HI', 'Hawaii'], ['?', 'Unknown']];
const GRADES = ['A', 'B', 'C', 'D'];
const GROUPS = [['', 'No grouping'], ['tz_short', 'Time zone'], ['state', 'State'], ['city', 'City'], ['industry', 'Industry'], ['grade', 'Grade'], ['stage', 'Stage'], ['source', 'Source'], ['tags', 'Tag']];
const PIPE_KEY = 'rw-pipe-v2';
const tzSel = (p) => String(p.tz || '').split(',').filter(Boolean);
const loadPipe = () => { try { return { view: 'board', tz: '', group: '', sort: '-score', f: {}, ...JSON.parse(localStorage.getItem(PIPE_KEY) || '{}') }; } catch { return { view: 'board', tz: '', group: '', sort: '-score', f: {} }; } };
const PIPE_LAYOUT = [['get', 'Step 1: Get leads'], ['clean', 'Step 2: Clean up'], ['tz', 'Time zone tabs'], ['lists', 'Call list chips'], ['stats', 'Numbers line']];
const loadLay = () => { const d = { get: true, clean: true, tz: true, lists: true, stats: true }; try { return { ...d, ...JSON.parse(localStorage.getItem('rw-pipe-layout') || '{}') }; } catch { return d; } };
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

export async function pipelinePage(app, user, openId, screen) {
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
  const lay = loadLay();
  const playShut = (e) => { if (!document.body.contains(view)) { document.removeEventListener('click', playShut); document.removeEventListener('keydown', playShut); return; } if (!playOpen) return; if (e.type === 'keydown' ? e.key === 'Escape' : !e.target.closest('.dlayout')) { playOpen = false; const b = document.getElementById('playbody'); if (b) b.hidden = true; document.getElementById('playbtn')?.setAttribute('aria-expanded', 'false'); } };
  document.addEventListener('click', playShut); document.addEventListener('keydown', playShut);
  let playOpen = false;
  let offHover = null;

  // The Pipeline's current filters as a dialer filter. A stage narrows it to one column.
  const dialFilter = (stage = '') => ({ tz: tzSel(p).filter((z) => z !== '?').join(','), grade: (p.f.grades || []).join(','), state: p.f.state || '', industry: p.f.industry || '', tag: p.f.tag || '', city: p.f.city || '', data: p.f.phoneType === 'mobile' ? 'mobile' : p.f.owner === 'yes' ? 'owner' : p.f.email ? 'email' : '', stage });
  // "Dial this column": open the dialer with only that stage's leads (and the filters set above).
  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dialcol]'); if (!b) return;
    e.preventDefault();
    try { localStorage.setItem('rw-dial-filter', JSON.stringify(dialFilter(b.dataset.dialcol))); } catch { /* ignore */ }
    location.hash = '#/phone';
  });
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
    const badNames = user.role === 'admin' ? all.filter((l) => (l.owner_name && !isPersonName(l.owner_name)) || (l.contact_name && titleLike(l.contact_name, l.business))).length : 0;
    const unscrubbed = rows.filter((l) => !l.scrubbed_at && !['won', 'lost', 'dnc'].includes(l.stage)).length;
    const unresearched = rows.filter((l) => !l.researched && !['won', 'lost', 'dnc'].includes(l.stage)).length;
    view.dataset.hide = Object.entries(lay).filter(([, v]) => !v).map(([k]) => k).join(' ');
    view.innerHTML = `
      <div class="page-head"><div><p class="eyebrow">CRM</p><h1>Pipeline</h1></div>
        <div class="row"><div class="dlayout"><button type="button" class="dl-btn" id="playbtn" aria-expanded="${playOpen}" aria-haspopup="true">Customize layout</button>
          <div class="dlayout-body" id="playbody" role="group" aria-label="Customize layout"${playOpen ? '' : ' hidden'}>
            <p class="small muted" style="margin:0">Show or hide parts of this page. Saved for you on this computer.</p>
            ${PIPE_LAYOUT.map(([k, n]) => `<label><input type="checkbox" data-play="${k}"${lay[k] ? ' checked' : ''}> ${n}</label>`).join('')}
            <button type="button" class="btn btn-ghost btn-sm" id="playreset">Show everything</button></div></div></div></div>
      <div class="flow">
        <section class="fstep" data-sec="get"><header><span class="fn">1</span><div><h3>Get leads</h3><p>Find new businesses or bring a list in.</p></div></header>
          <div class="row">${user.role === 'admin' ? `<a class="btn btn-ghost btn-sm" href="#/finder">Lead finder</a>` : ''}<button class="btn btn-ghost btn-sm" id="imp">${icon.upload}Import a list</button><button class="btn btn-ghost btn-sm" id="addl">${icon.plus}Add one lead</button></div></section>
        <section class="fstep" data-sec="clean"><header><span class="fn">2</span><div><h3>Clean up</h3><p>${unscrubbed ? `${unscrubbed} not scrubbed yet.` : 'Every lead in view is scrubbed.'} ${unresearched} not researched.</p></div></header>
          <div class="row small">${unscrubbed ? `<button class="btn btn-ghost btn-sm" id="scruball">Scrub ${unscrubbed} (free)</button>` : ''}${badNames ? `<button class="btn btn-mint btn-sm" id="fixnames" title="Owner or contact names that are really job titles, business names or page headings (Outscraper files do this). They are cleared and those leads are scrubbed again to find the real name.">Fix ${badNames} wrong owner name${badNames === 1 ? '' : 's'}</button>` : ''}<button class="btn btn-ghost btn-sm" id="fillin">Fill in missing info</button>
            <button class="btn btn-ghost btn-sm" id="resall">Research ${Math.min(50, unresearched)}<span class="cost-hint" data-cost="research_call" data-n="${Math.min(50, unresearched)}"></span></button><button class="btn btn-ghost btn-sm" id="dups">Duplicates</button>
            ${user.role === 'admin' && all.some((l) => !l.tz_known || !l.tz_how) ? `<button class="btn btn-ghost btn-sm" id="fixtz">${all.some((l) => !l.tz_known) ? `Find ${all.filter((l) => !l.tz_known).length} unknown time zones` : 'Re-check time zones'}</button>` : ''}</div></section>
        <section class="fstep wide" data-sec="pick"><header><span class="fn">3</span><div><h3>Choose who to call</h3><p>${rows.length} leads match. Narrow it by time zone, list or grade.</p></div></header>
          <div class="tz-tabs" data-sec="tz"><button class="tz ${!p.tz ? 'is-on' : ''}" data-tz="">All <b>${all.length}</b></button>${TZS.map(([k, n]) => {
            const c = tzCount(k);
            return c ? `<button class="tz ${tzSel(p).includes(k) ? 'is-on' : ''}" data-tz="${k}" title="${n}. Tap more than one to call several time zones together." aria-pressed="${tzSel(p).includes(k)}">${tzNow(k) ? '<i class="live"></i>' : ''}${k === '?' ? 'Unknown' : k} <b>${c}</b></button>` : '';
          }).join('')}</div>
          <div class="chips lists" data-sec="lists" aria-label="Call lists"><span class="small muted">Call lists:</span>${CALL_LISTS.map(([k, n]) => `<button class="chip ${p.list === k ? 'on' : ''}" data-list="${k}">${n}</button>`).join('')}</div>
          <div class="filterbar">
            <input id="fq" value="${esc(f.q || '')}" placeholder="Search name, phone, city, industry, zip, tag" style="flex:1 1 240px">
            <div class="chips gradechips" aria-label="Lead grade"><span class="small muted" title="Grade is the lead score from our research. A is the best lead to call (75 and up), B 60 to 74, C 45 to 59, D under 45. Tap letters to show only those grades.">Grade</span>${GRADES.map((g) => `<button class="chip ${f.grades?.includes(g) ? 'on' : ''}" data-grade="${g}" title="${{ A: 'A: best leads, score 75 and up', B: 'B: score 60 to 74', C: 'C: score 45 to 59', D: 'D: score under 45' }[g]}">${g}</button>`).join('')}</div>
            <button class="btn btn-ghost btn-sm" id="fmore">Filters${activeFilters ? ` (${activeFilters})` : ''}</button></div>
          <div class="card filters" id="fpanel" ${p.open ? '' : 'hidden'}>
        <div class="form-grid filt">
          <label class="field"><span>State</span><select data-f="state"><option value="">Any</option>${states.map((s) => `<option${f.state === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
          <label class="field"><span>City</span><input data-f="city" value="${esc(f.city || '')}" placeholder="Any"></label>
          <label class="field"><span>Industry</span><input data-f="industry" list="indlist" value="${esc(f.industry || '')}" placeholder="Any"><datalist id="indlist">${industries.map((i) => `<option value="${esc(i)}">`).join('')}</datalist></label>
          <label class="field"><span>Source</span><select data-f="source"><option value="">Any</option>${sources.map((s) => `<option${f.source === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
          <label class="field"><span>Stage</span><select data-f="stage"><option value="">Any</option>${Object.entries(STAGE_LABEL).map(([k, n]) => `<option value="${k}"${f.stage === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="field"><span>Tag</span><input data-f="tag" value="${esc(f.tag || '')}" placeholder="Any"></label>
          <label class="field"><span>Website</span><select data-f="site"><option value="">Any</option><option value="yes"${f.site === 'yes' ? ' selected' : ''}>Has a website</option><option value="no"${f.site === 'no' ? ' selected' : ''}>No website</option></select></label>
          <label class="field"><span>Google profile</span><select data-f="gbp"><option value="">Any</option><option value="yes"${f.gbp === 'yes' ? ' selected' : ''}>Has one</option><option value="none"${f.gbp === 'none' ? ' selected' : ''}>None found (after the Google check)</option><option value="unknown"${f.gbp === 'unknown' ? ' selected' : ''}>Not checked yet</option></select></label>
          <label class="field"><span>Researched</span><select data-f="researched"><option value="">Any</option><option value="yes"${f.researched === 'yes' ? ' selected' : ''}>Yes</option><option value="no"${f.researched === 'no' ? ' selected' : ''}>Not yet</option></select></label>
          <label class="field"><span>Reviews from</span><input type="number" min="0" data-f="minReviews" value="${esc(f.minReviews ?? '')}"></label>
          <label class="field"><span>Reviews up to</span><input type="number" min="0" data-f="maxReviews" value="${esc(f.maxReviews ?? '')}"></label>
          <label class="field"><span>Rating up to</span><input type="number" min="1" max="5" step="0.1" data-f="maxRating" value="${esc(f.maxRating ?? '')}"></label>
          <label class="field"><span>Score at least</span><input type="number" min="0" max="100" data-f="minScore" value="${esc(f.minScore ?? '')}"></label>
          <label class="field"><span>Phone type</span><select data-f="phoneType"><option value="">Any</option>${[['mobile', 'Mobile'], ['landline', 'Landline'], ['voip', 'Internet phone'], ['unknown', 'Not checked']].map(([k, n]) => `<option value="${k}"${f.phoneType === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="field"><span>Email</span><select data-f="email"><option value="">Any</option>${[['yes', 'Has a good email'], ['person', 'A person, not info@'], ['no', 'No good email']].map(([k, n]) => `<option value="${k}"${f.email === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="field"><span>Owner name</span><select data-f="owner"><option value="">Any</option><option value="yes"${f.owner === 'yes' ? ' selected' : ''}>Known</option><option value="no"${f.owner === 'no' ? ' selected' : ''}>Unknown</option></select></label>
          <label class="field"><span>Scrubbed</span><select data-f="scrubbed"><option value="">Any</option><option value="yes"${f.scrubbed === 'yes' ? ' selected' : ''}>Yes</option><option value="no"${f.scrubbed === 'no' ? ' selected' : ''}>Not yet</option></select></label>
          <label class="field"><span>Data score at least</span><input type="number" min="0" max="100" data-f="minData" value="${esc(f.minData ?? '')}"></label>
        </div>
        <div class="row" style="margin-top:10px"><label class="row small" style="gap:6px"><input type="checkbox" data-f="callable"${f.callable ? ' checked' : ''}> Callable right now</label>
          <label class="row small" style="gap:6px" title="Hides big brands, franchises, hospitals and schools, toll free numbers and businesses over 400 reviews. Fewer phone menus. A best guess."><input type="checkbox" data-f="small"${f.small ? ' checked' : ''}> Likely owner picks up</label>
          <label class="row small" style="gap:6px"><input type="checkbox" data-f="notTop3"${f.notTop3 ? ' checked' : ''}> Not in the top 3</label>
          <label class="row small" style="gap:6px"><input type="checkbox" data-f="notTop10"${f.notTop10 ? ' checked' : ''}> Not on the first page</label>
          <span class="spacer"></span><button class="btn btn-ghost btn-sm" id="fclear">Clear filters</button></div>
      </div>
        </section>
        <section class="fstep wide go" data-sec="work"><header><span class="fn">4</span><div><h3>Call and work the list</h3>
          <p class="fstats" data-sec="stats"><b>${open.length}</b> open · <b>${open.filter((l) => l.grade === 'A').length}</b> A leads · <b>${open.filter((l) => l.callable_now).length}</b> callable now · <b>${(by.audit_booked || []).length}</b> audits booked · <b>${(by.won || []).length}</b> won</p></div></header>
          <div class="row"><div class="seg"><button class="${p.view === 'board' ? 'is-on' : ''}" data-view="board">Board</button><button class="${p.view === 'list' ? 'is-on' : ''}" data-view="list">List</button></div>
            <a class="btn btn-mint" href="#/phone" id="godial">${icon.phone}Dial this list</a></div></section>
      </div>
      <div id="scstrip"></div>
      <div id="pbody"></div>`;
    const body = $('#pbody', view);
    if (p.view === 'list') renderList(body, rows); else renderBoard(body, by);
    wire();
    resumeScrub(reload);
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
    ['reviews', 'Reviews', '-reviews'], ['rating', 'Rating', 'rating'], ['map_rank', 'Map rank', 'map_rank'], ['data_score', 'Data', '-data_score'], ['stage', 'Stage', 'stage'], ['next', 'Next', 'next_action_at']];
  const renderList = (el, rows) => {
    const sorted = sortLeads(rows, p.sort);
    const groups = new Map();
    if (p.group) for (const l of sorted) { const k = String(l[p.group] ?? '') || 'None'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
    else groups.set('', sorted);
    const row = (l) => `<tr data-id="${esc(l.id)}"><td><input type="checkbox" class="sel" data-id="${esc(l.id)}"${selected.has(l.id) ? ' checked' : ''}></td>
      <td>${gradeBadge(l.grade, l.score)}</td><td><b>${esc(l.business)}</b><div class="small">${esc([personOf(l), l.phone, PHONE_TYPE_LABEL[l.phone_type]].filter(Boolean).join(' · '))}</div></td>
      <td>${esc([l.city, l.state].filter(Boolean).join(', '))}${l.zip ? ` <span class="small">${esc(l.zip)}</span>` : ''}</td>
      <td>${l.tz_short ? `<span class="badge ${l.callable_now ? '' : 'gray'}" title="${l.tz_alt_short ? 'On the line between two zones. Call only when both are inside 8am to 8pm.' : ''}">${esc(l.tz_short)}${l.tz_alt_short ? `/${esc(l.tz_alt_short)}` : ''} ${esc(l.local_time)}</span>` : `<span class="small" title="Time zone unknown. Callable 11am to 8pm Eastern only.">?${l.callable_now ? '' : ' wait'}</span>`}</td>
      <td>${esc(l.industry || l.category || '')}</td><td>${l.reviews ?? ''}</td><td>${l.rating ?? ''}</td><td>${l.map_rank == null ? '' : l.map_rank > 20 ? '20+' : `#${l.map_rank}`}</td>
      <td>${l.data_score == null ? '<span class="small muted">not yet</span>' : `<span class="dscore d${l.data_score >= 80 ? 'a' : l.data_score >= 60 ? 'b' : l.data_score >= 40 ? 'c' : 'd'}">${l.data_score}</span>`}</td>
      <td><span class="badge gray">${esc(STAGE_LABEL[l.stage])}</span></td><td class="small">${esc(dueText(l.next_action_at))}</td></tr>`;
    el.innerHTML = `
      <div class="row" style="margin-bottom:10px"><label class="field" style="flex:0 1 220px"><select id="grp">${GROUPS.map(([k, n]) => `<option value="${k}"${p.group === k ? ' selected' : ''}>Group: ${n}</option>`).join('')}</select></label>
        <div class="bulk" id="bulk" ${selected.size ? '' : 'hidden'}><b id="selc">${selected.size} selected</b>
          <button class="btn btn-ghost btn-sm" data-bulk="research">Research</button><button class="btn btn-ghost btn-sm" data-bulk="scrub">Scrub</button><button class="btn btn-ghost btn-sm" data-bulk="callnow">Call next</button>
          <select id="bstage"><option value="">Move to...</option>${Object.entries(STAGE_LABEL).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select>
          <button class="btn btn-ghost btn-sm" data-bulk="tag">Tag</button><button class="btn btn-danger btn-sm" data-bulk="delete">Delete</button></div></div>
      <div class="table-wrap"><table class="leads-table"><thead><tr><th><input type="checkbox" id="selall"></th>${COLS.map(([k, n, s]) => `<th><button class="th" data-sort="${s}">${n}${p.sort.replace('-', '') === s.replace('-', '') ? (p.sort.startsWith('-') ? ' ↓' : ' ↑') : ''}</button></th>`).join('')}</tr></thead>
      <tbody>${[...groups.entries()].map(([g, ls]) => `${p.group ? `<tr class="grp"><td colspan="${COLS.length + 1}">${esc(g)} <span class="small">${ls.length}</span></td></tr>` : ''}${ls.slice(0, PER_LIST).map(row).join('')}${ls.length > PER_LIST ? `<tr class="more"><td colspan="${COLS.length + 1}"><a class="btn btn-ghost btn-sm" href="${p.group ? `#/pipeline/group/${esc(p.group)}/${encodeURIComponent(g)}` : '#/pipeline/stage/all'}">Open all ${ls.length}${p.group ? ` in ${esc(g)}` : ' leads'} in a full screen</a></td></tr>` : ''}`).join('') || `<tr><td colspan="${COLS.length + 1}" class="muted">No leads match.</td></tr>`}</tbody></table></div>`;
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
      if (a === 'scrub') return scrubMany(all.filter((l) => selected.has(l.id)), reload);
      if (a === 'tag') { const t = prompt('Tag to add'); if (t) bulk('tag', t); return; }
      if (a === 'delete' && !confirm(`Delete ${selected.size} leads and their history?`)) return;
      bulk(a);
    }));
  };

  const wire = () => {
    offHover?.();
    offHover = hoverCards(view, { selector: '.lead-card, tbody tr[data-id]', build: (el) => leadHover(all.find((x) => x.id === (el.dataset.id || ''))) });
    // Customize layout: ticks apply at once and the menu stays open (no redraw), same as the dialer.
    const pbody = document.getElementById('playbody');
    const applyPlay = () => { view.dataset.hide = Object.entries(lay).filter(([, v]) => !v).map(([k]) => k).join(' '); try { localStorage.setItem('rw-pipe-layout', JSON.stringify(lay)); } catch { /* ignore */ } };
    $('#playbtn', view)?.addEventListener('click', (e) => { e.stopPropagation(); playOpen = !playOpen; pbody.hidden = !playOpen; e.currentTarget.setAttribute('aria-expanded', String(playOpen)); });
    $$('[data-play]', view).forEach((c) => c.addEventListener('change', () => { lay[c.dataset.play] = c.checked; applyPlay(); }));
    $('#playreset', view)?.addEventListener('click', () => { Object.keys(lay).forEach((k) => { lay[k] = true; }); $$('[data-play]', view).forEach((c) => { c.checked = true; }); applyPlay(); });
    $('#addl', view).addEventListener('click', () => leadForm(null, reload));
    $('#imp', view).addEventListener('click', () => importModal(reload));
    $('#dups', view).addEventListener('click', () => duplicatesModal(reload));
    $('#godial', view).addEventListener('click', () => { try { localStorage.setItem('rw-dial-filter', JSON.stringify(dialFilter())); } catch { /* ignore */ } });
    // Time zone tabs are multi select: tap one to add it, tap again to take it off, All clears them.
    $$('[data-tz]', view).forEach((b) => b.addEventListener('click', () => { const k = b.dataset.tz; if (!k) p.tz = ''; else { const cur = tzSel(p); p.tz = (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]).join(','); } render(); }));
    $$('[data-grade]', view).forEach((b) => b.addEventListener('click', () => { const g = b.dataset.grade; const s = new Set(p.f.grades || []); if (s.has(g)) s.delete(g); else s.add(g); p.f.grades = [...s]; render(); }));
    $$('[data-view]', view).forEach((b) => b.addEventListener('click', () => { p.view = b.dataset.view; render(); }));
    $('#fmore', view).addEventListener('click', () => { p.open = !p.open; $('#fpanel', view).hidden = !p.open; savePipe(p); });
    let t;
    $('#fq', view).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { p.f.q = e.target.value; render(); const i = $('#fq', view); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
    $$('[data-f]', view).forEach((i) => i.addEventListener('change', () => { p.f[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value; render(); }));
    $('#fclear', view).addEventListener('click', () => { p.list = ''; p.f = {}; p.tz = ''; render(); });
    $$('[data-list]', view).forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.list;
      const off = p.list === k;
      for (const key of LIST_KEYS) delete p.f[key];
      p.list = off ? '' : k;
      if (!off) { Object.assign(p.f, CALL_LIST_F[k]); p.view = 'list'; p.sort = CALL_LIST_SORT[k] || '-data_score'; }
      render();
    }));
    $('#scruball', view)?.addEventListener('click', () => scrubMany(filterLeads(all, p).filter((l) => !l.scrubbed_at && !['won', 'lost', 'dnc'].includes(l.stage)), reload));
    $('#fillin', view)?.addEventListener('click', () => import('./fillin.js').then((m) => m.fillInPanel(filterLeads(all, p), { scrubMany, onDone: reload, owner: user.role === 'admin' })));
    $('#fixnames', view)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!confirm('Clear every owner name that is not a real person (like "Owner Operator" or "Authorized Person") and scrub those leads again to find the real name? Names you typed that are real people are not touched.')) return;
      busy(btn, true, 'Cleaning');
      try {
        let after = '', fixed = 0; const ids = []; const seen = [];
        for (let n = 0; n < 200; n++) {
          const r = await api('/api/scrub/fix-names', { method: 'POST', body: { after } });
          fixed += r.fixed; ids.push(...r.ids); seen.push(...r.examples);
          if (!r.next) break;
          after = r.next;
        }
        toast(fixed ? `Cleared ${fixed} wrong name${fixed === 1 ? '' : 's'}${seen.length ? ` (like "${seen[0]}")` : ''}. Scrubbing them again for the real names.` : 'No wrong owner names found.');
        if (ids.length) { await scrubMany(ids.map((id) => ({ id })), reload); } else reload();
      } catch (err) { toast(err.message, true); busy(btn, false); }
    });
    $('#fixtz', view)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      let after = '', checked = 0, fixed = 0, unknown = 0;
      try {
        for (;;) {
          const r = await api('/api/leads/fix-timezones', { method: 'POST', body: { after } });
          checked += r.checked; fixed += r.fixed; unknown += r.unknown;
          btn.textContent = `Checking time zones: ${checked} done`;
          if (!r.next) break;
          after = r.next;
        }
        toast(unknown ? `${fixed} time zones set. ${unknown} still have no state, ZIP or address, so they stay in the 11am to 8pm Eastern window.` : `${fixed} time zones set.`);
      } catch (err) { toast(err.message, true); }
      reload();
    });
    $('#resall', view).addEventListener('click', () => researchMany(filterLeads(all, p).filter((l) => !l.researched && !['won', 'lost', 'dnc'].includes(l.stage)).slice(0, 50), reload));
  };
  const fullScreen = () => {
    const rows0 = filterLeads(all, p);
    let title; let rows;
    if (screen.kind === 'group') { const v = screen.value; rows = rows0.filter((l) => (String(l[screen.field] ?? '') || 'None') === v); title = `${v}`; }
    else if (screen.key === 'all') { rows = rows0; title = 'All leads in this view'; }
    else { rows = rows0.filter((l) => l.stage === screen.key); title = STAGE_LABEL[screen.key] || 'Leads'; }
    rows = sortLeads(rows, p.sort || '-score');
    let q = ''; let shown = 50;
    const draw = () => {
      const ql = q.trim().toLowerCase();
      const list = ql ? rows.filter((l) => [l.business, l.phone, l.city, l.state, l.zip, l.industry, l.contact_name, l.owner_name].join(' ').toLowerCase().includes(ql)) : rows;
      $('#fsl', view).innerHTML = `${list.slice(0, shown).map(card).join('') || '<p class="muted">No leads match.</p>'}${list.length > shown ? `<button class="btn btn-ghost" id="fsmore">Show 50 more (${list.length - shown} left)</button>` : ''}`;
      $('#fscount', view).textContent = `${list.length} lead${list.length === 1 ? '' : 's'}`;
      $$('#fsl .lead-card', view).forEach((c) => c.addEventListener('click', () => leadModal(c.dataset.id, () => pipelinePage(app, user, null, screen))));
      $('#fsmore', view)?.addEventListener('click', () => { shown += 50; draw(); });
    };
    view.innerHTML = `<div class="fullscreen-list"><div class="page-head"><div><a class="btn btn-ghost btn-sm" href="#/pipeline">&lsaquo; Back to the pipeline</a><h1 style="margin-top:10px">${esc(title)}</h1><p class="small muted" id="fscount"></p></div>${screen.kind !== 'group' && DIALABLE.includes(screen.key) ? `<button type="button" class="btn btn-mint" data-dialcol="${esc(screen.key)}">${icon.phone}Dial this column</button>` : ''}</div>
      <label class="field"><input id="fsq" placeholder="Search this list" autocomplete="off"></label><div class="fs-grid" id="fsl"></div></div>`;
    $('#fsq', view).addEventListener('input', (e) => { q = e.target.value; shown = 50; draw(); });
    draw();
  };
  if (screen) fullScreen(); else render();
}

// Research several leads, three at a time, with a progress bar and a stop button.
export function researchMany(leads, onDone) {
  if (!leads.length) return toast('Nothing to research in this view.');
  let stop = false;
  const m = modal(`<div class="card-head"><h2>Researching ${leads.length} leads</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <p class="muted">Each lead: find the Google profile, rank check at 9 points around them, website read, mobile speed. About 4 cents each, ${esc(fmt.money(leads.length * 0.04))} max.</p>
    <div class="progress"><span id="rmbar" style="width:0%"></span></div><p class="small" id="rmtxt">Starting...</p>
    <div class="row end"><button class="btn btn-ghost btn-sm" id="rmstop">Pause</button></div>`, { onClose: () => { stop = true; onDone?.(); } });
  let done = 0, failed = 0, cost = 0;
  const queue = leads.slice();
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
  const btn = $('#rmstop', m.el);
  const run = () => {
    stop = false; btn.textContent = 'Pause'; btn.onclick = () => { stop = true; btn.disabled = true; };
    Promise.all([worker(), worker(), worker()]).then(() => {
      btn.disabled = false;
      if (queue.length) { $('#rmtxt', m.el).textContent += ` Paused with ${queue.length} left.`; btn.textContent = `Resume (${queue.length} left)`; btn.onclick = run; }
      else { $('#rmtxt', m.el).textContent += ' All done.'; btn.textContent = 'Done'; btn.onclick = () => m.close(); }
    });
  };
  run();
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

const PER_LIST = 10;
function column(stage, leads) {
  const more = leads.length > PER_LIST;
  return `<section class="col" data-stage="${stage}"><header class="col-head"><b>${STAGE_LABEL[stage]}</b><span class="col-tools">${DIALABLE.includes(stage) && leads.length ? `<button type="button" class="col-dial" data-dialcol="${esc(stage)}" title="Dial only the ${esc(STAGE_LABEL[stage])} column. Leads not due yet or called in the last 3 hours wait.">${icon.phone}Dial</button>` : ''}<span class="badge gray">${leads.length}</span></span></header>
    <div class="col-body">${leads.slice(0, PER_LIST).map(card).join('')}${more ? `<a class="btn btn-ghost btn-sm col-all" href="#/pipeline/stage/${esc(stage)}">Open all ${leads.length} in a full screen</a>` : ''}</div></section>`;
}
function card(l) {
  return `<article class="lead-card" draggable="true" data-id="${esc(l.id)}">
    <div class="row lc-top" style="gap:8px;flex-wrap:nowrap">${gradeBadge(l.grade, l.score)}<div style="min-width:0"><div class="item-title">${esc(l.business)}</div>
    <div class="item-sub">${esc([l.industry || l.category, [l.city, l.state].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</div></div></div>
    <div class="row small" style="margin-top:6px;gap:6px">${l.next_action_at ? `<span class="badge ${l.next_action_at <= Date.now() ? 'warn' : 'gray'}">${esc(dueText(l.next_action_at))}</span>` : ''}
      ${l.meet_at && l.meet_at > Date.now() - 3600e3 ? `<span class="badge">Meet ${esc(new Date(l.meet_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span>` : ''}
      ${l.reviews != null ? `<span>${l.reviews} rev</span>` : ''}${l.map_rank ? `<span>${l.map_rank > 20 ? '20+' : `#${l.map_rank}`}</span>` : ''}${l.tz_known ? `<span class="${l.callable_now ? 'ok-dot' : ''}">${esc(l.tz_short)}${l.tz_alt_short ? `/${esc(l.tz_alt_short)}` : ''} ${esc(l.local_time)}</span>` : ''}</div></article>`;
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

// Call lists: the scrubbed data turned into who to call first.
const CALL_LISTS = [['best', 'Best data first'], ['mobile', 'Mobile numbers'], ['owner', 'Owner name known'], ['email', 'Email a person'], ['nosite', 'No website'], ['few', 'Under 20 reviews'], ['page2', 'Not on page one'], ['nogbp', 'No Google profile'], ['small', 'Likely owner picks up']];
const CALL_LIST_F = { best: { minData: 60 }, mobile: { phoneType: 'mobile' }, owner: { owner: 'yes' }, email: { email: 'person' }, nosite: { site: 'no' }, few: { maxReviews: 20 }, page2: { notTop10: true }, nogbp: { gbp: 'none' }, small: { small: true } };
const CALL_LIST_SORT = { few: 'reviews', page2: '-score' };
const LIST_KEYS = ['minData', 'phoneType', 'owner', 'email', 'site', 'maxReviews', 'notTop10', 'gbp', 'small'];

// Scrub: queue the leads on the server, then a progress strip on the Pipeline watches the queue and keeps it moving
// (two leads per call, two calls at a time). It also finishes on its own in the background if the page is closed.
let scrubTimer = null, scrubBusy = false, scrubDoneCb = null;
const scrubKey = 'rw-scrub-total', pausedKey = 'rw-scrub-paused';
const store = (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, String(v)); } catch {} };
const load = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const stripHtml = (queued, total, scrubbed, paused) => {
  const done = Math.max(0, total - queued);
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 100;
  const bar = `<div class="progress" style="margin-top:8px"><span style="width:${pct}%"></span></div>`;
  if (!queued) return `<div class="card scstrip"><div class="row"><strong>Scrub finished</strong><span class="small">${total} lead${total === 1 ? '' : 's'} done. ${scrubbed} scrubbed in total.</span><span class="spacer"></span><button class="btn btn-ghost btn-sm" id="scclose">Dismiss</button></div>${bar}</div>`;
  if (paused) return `<div class="card scstrip paused"><div class="row"><strong>Scrub paused</strong><span class="small">${done} of ${total} done · ${queued} left${typeof paused === 'string' ? ` · ${esc(paused)}` : ''}</span><span class="spacer"></span><button class="btn btn-primary btn-sm" id="scresume">Resume</button><button class="btn btn-ghost btn-sm" id="scclear">Clear the rest</button></div>${bar}</div>`;
  return `<div class="card scstrip"><div class="row"><strong>Scrubbing</strong><span class="small">${done} of ${total} done · ${queued} left</span><span class="spacer"></span><button class="btn btn-ghost btn-sm" id="scpause">Pause</button></div>${bar}<p class="small muted" style="margin:6px 0 0">Reading websites, checking emails, cleaning names. Keep this page open to go faster. It also runs in the background.</p></div>`;
};
function paintStrip(queued, total, scrubbed, paused) {
  const el = document.getElementById('scstrip');
  if (!el) return false;
  el.innerHTML = total || queued ? stripHtml(queued, total, scrubbed, paused) : '';
  const stopTimer = () => { clearInterval(scrubTimer); scrubTimer = null; };
  document.getElementById('scpause')?.addEventListener('click', () => { stopTimer(); store(pausedKey, '1'); paintStrip(queued, total, scrubbed, true); });
  document.getElementById('scresume')?.addEventListener('click', () => { store(pausedKey, null); paintStrip(queued, total, scrubbed, false); watchScrub(0, scrubDoneCb); });
  document.getElementById('scclear')?.addEventListener('click', async () => {
    stopTimer();
    try { await api('/api/scrub/cancel', { method: 'POST' }); } catch (e) { toast(e.message, true); }
    store(scrubKey, null); store(pausedKey, null); el.innerHTML = '';
    scrubDoneCb?.();
  });
  document.getElementById('scclose')?.addEventListener('click', () => { store(scrubKey, null); el.innerHTML = ''; });
  return true;
}
export function watchScrub(added = 0, onDone) {
  if (onDone) scrubDoneCb = onDone;
  store(pausedKey, null);
  let total = (Number(load(scrubKey)) || 0) + added;
  store(scrubKey, total);
  if (scrubTimer) return;
  const step = async () => {
    if (scrubBusy) return;
    if (!document.getElementById('scstrip')) { clearInterval(scrubTimer); scrubTimer = null; return; }   // left the Pipeline
    scrubBusy = true;
    try {
      const rs = await Promise.all([api('/api/scrub/tick', { method: 'POST' }), api('/api/scrub/tick', { method: 'POST' })]);
      const st = rs[rs.length - 1];
      total = Math.max(Number(load(scrubKey)) || 0, st.queued); store(scrubKey, total);
      paintStrip(st.queued, total, st.scrubbed, false);
      if (!st.queued) { clearInterval(scrubTimer); scrubTimer = null; scrubDoneCb?.(); }
    } catch (e) {
      // Interrupted (offline, server busy): stop and offer Resume instead of failing quietly.
      clearInterval(scrubTimer); scrubTimer = null; store(pausedKey, '1');
      try { const st = await api('/api/scrub/status'); paintStrip(st.queued, Math.max(total, st.queued), st.scrubbed, 'stopped: ' + e.message); } catch { paintStrip(1, Math.max(total, 1), 0, 'stopped: ' + e.message); }
    }
    scrubBusy = false;
  };
  scrubTimer = setInterval(step, 1500);
  step();
}
// Pick the strip up again after a refresh or coming back to the Pipeline. Paused stays paused until Resume.
export async function resumeScrub(onDone) {
  try {
    const st = await api('/api/scrub/status');
    let total = Number(load(scrubKey)) || 0;
    if (scrubDoneCb == null || onDone) scrubDoneCb = onDone || scrubDoneCb;
    if (st.queued) {
      total = Math.max(total, st.queued); store(scrubKey, total);
      const paused = load(pausedKey) === '1';
      paintStrip(st.queued, total, st.scrubbed, paused);
      if (!paused) watchScrub(0, onDone);
    } else if (total) paintStrip(0, total, st.scrubbed, false);
  } catch {}
}
export async function scrubMany(leads, onDone, opts = {}) {
  if (!leads.length) return toast('Nothing to scrub in this view.');
  try {
    const r = await api('/api/scrub/queue', { method: 'POST', body: { ids: leads.map((l) => l.id), lookup: Boolean(opts.lookup) } });
    toast(`${r.queued} lead${r.queued === 1 ? '' : 's'} queued.`);
    store(scrubKey, null);
    paintStrip(r.queued, r.queued, 0, false);
    watchScrub(r.queued, onDone);
  } catch (e) { toast(e.message, true); }
}

// Florida registry facts and what the business says about itself on its own site. All free, all optional.
function sunbizRows(l, scrub) {
  const rg = scrub?.registry;
  if (rg && rg.code !== 'FL' && !rg.skipped) {
    if (rg.linkOnly) return `<dt>${esc(rg.state)} registry</dt><dd class="small muted">${esc(rg.state)} has no open data the Hub can read. <a href="${esc(rg.searchUrl)}" target="_blank" rel="noopener">Search ${esc(rg.registry)}</a> for "${esc(l.business)}"</dd>`;
    if (!rg.found) return `<dt>${esc(rg.state)} registry</dt><dd class="small muted">${rg.error ? esc(rg.error) : 'No matching company found.'} <a href="${esc(rg.searchUrl)}" target="_blank" rel="noopener">Search by hand</a></dd>`;
    return `<dt>${esc(rg.state)} registry</dt><dd><a href="${esc(rg.searchUrl)}" target="_blank" rel="noopener">${esc(rg.name)}</a>${rg.status ? ` <span class="badge ${rg.active === false ? 'bad' : ''}">${esc(rg.status)}</span>` : ''}</dd>
      ${rg.kind ? `<dt>Type</dt><dd>${esc(rg.kind)}</dd>` : ''}${rg.filed ? `<dt>Filed</dt><dd>${esc(rg.filed)}${rg.years != null ? ` · ${rg.years} years ago` : ''}</dd>` : ''}
      ${rg.agent ? `<dt>Registered agent</dt><dd>${esc(rg.agent)} <span class="small muted">(often a service, not the owner)</span></dd>` : ''}`;
  }
  const sb = scrub?.sunbiz;
  if (!sb || sb.skipped) return '';
  if (!sb.found) return `<dt>Florida registry</dt><dd class="small muted">${sb.error ? esc(sb.error) : 'No matching company found.'} <a href="${esc(sunbizSearchUrl(l.business))}" target="_blank" rel="noopener">Search by hand</a></dd>`;
  const people = (sb.people || []).slice(0, 4).map((p) => `${esc(p.name)}${p.title ? ` (${esc(p.title)})` : ''}`).join(', ');
  return `<dt>Florida registry</dt><dd><a href="${esc(sb.url)}" target="_blank" rel="noopener">${esc(sb.name)}</a> <span class="badge ${sb.active ? '' : 'bad'}">${esc(sb.status || (sb.active ? 'Active' : 'Not active'))}</span></dd>
    ${sb.filed ? `<dt>Filed</dt><dd>${esc(sb.filed)}${sb.years != null ? ` · ${sb.years} years ago` : ''}</dd>` : ''}
    ${people ? `<dt>Officers</dt><dd>${people}</dd>` : ''}${sb.agent ? `<dt>Registered agent</dt><dd>${esc(sb.agent)}</dd>` : ''}`;
}
function adsRows(l, ads) {
  const links = adLibraryLinks({ website: l.website, business: l.business });
  if (!ads && !links.length) return '';
  const tags = ads ? [...(ads.platforms || []), ...(ads.callTracking || []).map((x) => `${x} call tracking`)] : [];
  return `<dt>Ads</dt><dd>${ads ? `${tags.length ? tags.map((t) => `<span class="badge warn">${esc(t)}</span>`).join(' ') + '<br>' : ''}<span class="small muted">${esc(adsLine(ads))}</span>` : '<span class="small muted">Site not read yet.</span>'}${links.length ? `<br>${links.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a>`).join(' · ')}` : ''}</dd>`;
}
function profileRows(p) {
  if (!p) return '';
  const flags = [['freeEstimate', 'free estimates'], ['emergency', '24/7 or same day'], ['financing', 'financing'], ['warranty', 'warranty'], ['family', 'family owned'], ['reviewsOnSite', 'testimonials'], ['hasChat', 'live chat'], ['hasBooking', 'online booking'], ['hasForm', 'contact form']].filter(([k]) => p[k]).map(([, t]) => t);
  const rows = [
    p.services?.length ? ['Services', p.services.join(', ')] : null,
    p.areas?.length ? ['Areas served', p.areas.join(', ')] : null,
    p.years || p.founded ? ['In business', [p.years ? `${p.years} years` : '', p.founded ? `since ${p.founded}` : ''].filter(Boolean).join(', ')] : null,
    p.license ? ['License on site', p.license] : null,
    p.hours ? ['Hours on site', p.hours] : null,
    p.team?.length ? ['Team', p.team.join(', ')] : null,
    flags.length ? ['They say', flags.join(', ')] : null,
    p.cms ? ['Built on', p.cms] : null,
    p.description ? ['About', p.description] : null,
  ].filter(Boolean);
  return rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') + (p.license ? `<dt>License check</dt><dd><a href="${esc(licenseSearchUrl())}" target="_blank" rel="noopener">Look it up at Florida DBPR</a></dd>` : '');
}

// The scrubbed data on a lead: cleaned name, phone type, emails, owner, social pages, data score and what is missing.
function leadDataCard(box, l, scrub, onChange) {
  let socials = {};
  try { socials = JSON.parse(l.socials || '{}'); } catch { socials = {}; }
  const emails = (scrub?.emails || []).filter((x) => x.ok);
  box.innerHTML = `<div class="card ldata" style="box-shadow:none"><div class="card-head"><h3 style="margin:0">Lead data ${l.data_score == null ? '' : `<span class="dscore d${l.data_score >= 80 ? 'a' : l.data_score >= 60 ? 'b' : l.data_score >= 40 ? 'c' : 'd'}">${l.data_score}</span>`}</h3>
      <button class="btn btn-ghost btn-sm" id="lscrub">${l.scrubbed_at ? 'Scrub again' : 'Scrub now'}</button></div>
    ${!l.scrubbed_at ? '<p class="small muted">Not scrubbed yet. Scrub reads their website for the owner, emails and social pages, and checks the number.</p>' : `<dl class="kv">
      ${l.business_raw && l.business_raw !== l.business ? `<dt>Name on Google</dt><dd>${esc(l.business_raw)}</dd>` : ''}
      <dt>Phone</dt><dd>${esc(PHONE_TYPE_LABEL[l.phone_type] || 'Type not checked')}${l.phone_carrier ? ` · ${esc(l.phone_carrier)}` : ''}</dd>
      <dt>Owner</dt><dd>${esc(personOf(l) || 'Not found')}</dd>
      <dt>Email</dt><dd>${emails.length ? emails.slice(0, 4).map((x) => `${esc(x.email)} <span class="badge ${x.mx === false ? 'bad' : x.role ? 'warn' : ''}">${esc(x.mx === false ? 'no mail server' : x.role ? 'shared inbox' : x.mx ? 'valid' : 'not checked')}</span>`).join('<br>') : 'None found'}</dd>
      ${Object.keys(socials).length ? `<dt>Social</dt><dd>${Object.entries(socials).map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(k === 'x' ? 'X' : k.charAt(0).toUpperCase() + k.slice(1))}</a>`).join(' · ')}</dd>` : ''}
      ${sunbizRows(l, scrub)}${profileRows(scrub?.profile)}${adsRows(l, scrub?.profile?.ads)}
      ${scrub?.site && !scrub.site.ok ? `<dt>Website</dt><dd class="err-text">${esc(scrub.site.error || 'Did not load')}</dd>` : ''}
      ${scrub?.missing?.length ? `<dt>Missing</dt><dd class="small muted">${esc(scrub.missing.join(', '))}</dd>` : ''}</dl>`}</div>`;
  // Free lookups: the rep opens these during the call and types what the public listing shows.
  const byHand = (() => { try { return l.manual_listing ? JSON.parse(l.manual_listing) : {}; } catch { return {}; } })();
  const links = directoryLinks({ business: l.business, city: l.city, state: l.state, website: l.website });
  const hand = document.createElement('div');
  hand.className = 'ldata-hand';
  hand.innerHTML = `<div class="small" style="margin:12px 0 6px"><b>Look up (free)</b></div>
    <div class="row small" style="gap:10px;flex-wrap:wrap">${links.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a>`).join('')}</div>
    <details class="fold" style="margin-top:10px"><summary><span>Type in what the listing shows</span></summary><div class="fold-body">
      <form class="form-grid" id="lhand" style="grid-template-columns:repeat(2,1fr);gap:8px">
        <label class="field"><span>Rating (1 to 5)</span><input name="rating" inputmode="decimal" value="${esc(byHand.rating ?? l.rating ?? '')}"></label>
        <label class="field"><span>Reviews</span><input name="reviews" inputmode="numeric" value="${esc(byHand.reviews ?? l.reviews ?? '')}"></label>
        <label class="field"><span>Phone on listing</span><input name="phone" value="${esc(byHand.phone || '')}"></label>
        <label class="field"><span>Owner name</span><input name="owner_name" value="${esc(byHand.owner_name || l.owner_name || '')}"></label>
        <label class="field" style="grid-column:1/-1"><span>Hours</span><input name="hours" value="${esc(byHand.hours || '')}" placeholder="Mon to Fri 8am to 5pm"></label>
        <label class="field" style="grid-column:1/-1"><span>Listing link (paste the Google Maps address)</span><input name="google_url" value="${esc(byHand.google_url || '')}" placeholder="https://www.google.com/maps/..."></label>
        <div style="grid-column:1/-1"><button class="btn btn-primary btn-sm" type="submit">Save what I read</button></div>
      </form></div></details>`;
  box.querySelector('.card')?.appendChild(hand);
  hand.querySelector('#lhand').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try {
      const r = await api(`/api/leads/${l.id}/listing-by-hand`, { method: 'PUT', body });
      Object.assign(l, { rating: r.manual.rating, reviews: r.manual.reviews, owner_name: r.manual.owner_name || l.owner_name, manual_listing: JSON.stringify(r.manual) });
      toast('Saved'); onChange?.();
    } catch (err) { toast(err.message, true); }
  });
  $('#lscrub', box).addEventListener('click', async (e) => {
    busy(e.target, true, 'Scrubbing...');
    try { const r = await api(`/api/leads/${l.id}/scrub`, { method: 'POST' }); Object.assign(l, r.lead, { scrubbed_at: Date.now() }); leadDataCard(box, l, r.scrub, onChange); onChange?.(); toast(r.scrub.name?.changed ? `Name cleaned: ${r.lead.business}` : 'Scrubbed'); }
    catch (err) { toast(err.message, true); busy(e.target, false); }
  });
}

// ---------- lead details ----------
export async function leadModal(id, onChange) {
  let changed = false;
  const origin = location.hash.split('/').slice(0, 2).join('/');   // the page it was opened from; its list is only redrawn if you are still on it
  const m = modal('<div class="skeleton"></div>', { onClose: () => { if (changed && location.hash.startsWith(origin)) onChange?.(); } });
  let data;
  try { [data] = await Promise.all([api(`/api/leads/${id}`), refreshDispos()]); } catch (e) { m.el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const l = data.lead;
  const Q = quoteFor(l, data.intel, l.quote);
  const closer = can(window.__rwUser, 'close'); // quotes, work orders, payment links and the presentation
  const soon = l.stage === 'audit_booked' || Boolean(l.meet_at && l.meet_at > Date.now() - 3 * 3600e3 && l.meet_at < Date.now() + 3 * 3600e3);
  m.el.innerHTML = `
    <div class="lm-top"><div class="card-head"><div><p class="eyebrow">${esc(STAGE_LABEL[l.stage])}${l.attempts ? ` · ${l.attempts} attempts` : ''}</p><h2>${esc(l.business)}</h2>
      <div class="small">${esc([personOf(l), l.city, l.state].filter(Boolean).join(' · '))}${l.tz_known ? ` · their time ${esc(l.local_time)}` : ''}</div></div>
      <button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <div class="row lm-actions">
      ${l.phone ? `<a class="btn btn-mint" href="${telHref(l.phone)}">${icon.phone}${esc(l.phone)}</a>` : ''}
      ${l.email ? `<button class="btn btn-ghost" id="lmailbtn">${icon.mail}Email</button>` : ''}
      <button class="btn btn-ghost" id="lmeetbtn">Add appointment</button>
      <button class="btn btn-ghost" id="lbooklink" title="A personal booking page link for this lead">Booking link</button>
      ${l.meet_at ? '<span id="lcloserbox" class="row small" style="gap:6px"></span>' : ''}
      ${l.website ? `<a class="btn btn-ghost" href="${esc(/^https?:/.test(l.website) ? l.website : `https://${l.website}`)}" target="_blank" rel="noopener">Website</a>` : ''}
      <a class="btn btn-ghost" href="https://www.google.com/maps/search/${encodeURIComponent(`${l.business} ${l.city || ''} ${l.state || ''}`)}" target="_blank" rel="noopener">Google Maps</a>
      ${l.phone ? '<button class="btn btn-ghost" id="ltexts">Texts</button>' : ''}
      ${closer ? `<a class="btn btn-primary" href="#/present/lead/${esc(l.id)}" id="lpresent" title="Clean screen share view for this business">Present</a><button class="btn btn-ghost" id="lpack" title="Link to the free competitor analysis">Copy analysis link</button>` : ''}
      <button class="btn btn-ghost" id="ledit">Edit</button>
    </div></div>
    ${l.dnc ? '<p class="badge bad" style="margin-bottom:12px">Do not call</p>' : ''}
    ${l.meet_at && l.meet_at > Date.now() - 2 * 3600e3 ? `<div class="card meet-card"><b>Audit meeting ${esc(bothTimes(l.meet_at, validZone(l.timezone) || yourZone(), yourZone()))}</b>
      ${l.meet_link ? `<a class="btn btn-mint btn-sm" href="${esc(l.meet_link)}" target="_blank" rel="noopener">Join Google Meet</a>` : ''}${closer ? `<a class="btn btn-primary btn-sm" href="/present.html#${esc(l.id)}" target="_blank" rel="noopener">Open presentation</a>` : ''}</div>` : ''}
    <div class="card" id="lprep" style="box-shadow:none;margin-bottom:16px"></div>
    <div class="split" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
      <div>
        ${fold('lm-log', 'Log a call', `
        <div class="outcomes">${DISP.map((d) => `<button class="btn btn-ghost btn-sm" data-out="${esc(d.id)}">${esc(d.label)}</button>`).join('')}</div>
        <label class="field" style="margin-top:10px"><span>Callback or audit time (for Callback and Booked)</span><input type="datetime-local" id="lwhen"></label>
        <label class="field" style="margin-top:10px"><span>Note</span><textarea id="lnote" rows="3" placeholder="What happened on the call"></textarea></label>
        <div class="row" style="margin-top:10px"><button class="btn btn-ghost btn-sm" id="lnotebtn">Save note only</button>
          <label class="field" style="flex:1 1 160px"><select id="lstage">${Object.entries(STAGE_LABEL).map(([k, n]) => `<option value="${k}"${k === l.stage ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div>
        `, true)}
        ${closer ? fold('lm-close', 'Scope and price', `
        <p class="small muted" style="margin:0 0 8px">Built from the research. Switch services on or off, set how much of each a month, then type your price. The client sees the services and the price, never a package.</p>
        <div class="field"><span>Scope of work</span><div class="scope-pick">${Q.all.map((s) => {
          const picked = Q.services.find((x) => x.id === s.id);
          const c = SCOPE[s.id] || {};
          return `<div class="scope-row" data-id="${esc(s.id)}"><label class="row small" style="gap:6px;align-items:flex-start;flex:1 1 220px;flex-wrap:nowrap"><input type="checkbox" value="${esc(s.id)}"${picked ? ' checked' : ''}> <span><b>${esc(s.name)}</b>${s.why ? `<br><span class="muted">${esc(s.why)}</span>` : ''}</span></label>
            ${c.unit ? `<label class="scope-qty small"><input type="number" data-qty="${esc(s.id)}" min="${c.min}" max="${c.max}" value="${picked?.qty ?? s.qty}" inputmode="numeric"> <span class="muted">${esc(c.unit)}</span></label>` : ''}</div>`;
        }).join('')}</div></div>
        <div class="scope-fx small" id="lfx"></div>
        <div class="card small" id="lref" style="margin-top:8px;box-shadow:none"></div>
        <div class="row" style="margin-top:8px;gap:8px">
          <label class="field" style="flex:1 1 110px"><span>Buildout $</span><input id="lsetup" inputmode="decimal" value="${esc(Q.setup ?? '')}" placeholder="You set it"></label>
          <label class="field" style="flex:1 1 110px"><span>Monthly $</span><input id="lmonthly" inputmode="decimal" value="${esc(Q.monthly ?? '')}" placeholder="You set it"></label>
        </div>
        <details style="margin-top:8px"><summary class="small" style="cursor:pointer;font-weight:600">Price talk numbers (optional, for the script)</summary>
          <p class="small muted" style="margin:6px 0">The script says your top number first ("everything we offer"), then the lower one if they push back. Leave blank and it shows [brackets] for you to say live.</p>
          <div class="row" style="gap:8px">
            <label class="field" style="flex:1 1 90px"><span>Top buildout $</span><input id="lasetup" inputmode="decimal" value="${esc(Q.anchor?.setup ?? '')}"></label>
            <label class="field" style="flex:1 1 90px"><span>Top monthly $</span><input id="lamonthly" inputmode="decimal" value="${esc(Q.anchor?.monthly ?? '')}"></label>
            <label class="field" style="flex:1 1 90px"><span>Lower buildout $</span><input id="ldsetup" inputmode="decimal" value="${esc(Q.drop?.setup ?? '')}"></label>
            <label class="field" style="flex:1 1 90px"><span>Lower monthly $</span><input id="ldmonthly" inputmode="decimal" value="${esc(Q.drop?.monthly ?? '')}"></label></div></details>
        <div class="row" style="margin-top:10px">
          <button class="btn btn-ghost btn-sm" id="lquote">Save quote</button>
          <button class="btn btn-primary btn-sm" id="lwo">Send work order</button>
          <button class="btn btn-ghost btn-sm" id="lpay">Payment link only</button>
          ${l.client_id ? `<a class="btn btn-ghost btn-sm" href="#/client/${esc(l.client_id)}/overview">Open client</a>` : '<button class="btn btn-ghost btn-sm" id="lwon">Won: create client</button>'}
        </div>
        <div id="lout"></div>
        <details style="margin-top:16px"><summary class="small" style="cursor:pointer;font-weight:600">Website project (separate work order)</summary>
          <label class="field" style="margin-top:8px"><span>Size (fills a starting price you can change)</span><select id="wtier"><option value="">Pick a size</option>${WEB_TIERS.map((t) => `<option value="${t.id}">${esc(t.label)}: ${esc(webMoney(t.build))} + ${esc(webMoney(t.care))} a month</option>`).join('')}<option value="custom">More than 15 pages or custom</option></select></label>
          <div class="card small" id="wguide" style="margin-top:8px;box-shadow:none"></div>
          <div class="row" style="margin-top:8px;gap:8px">
            <label class="field" style="flex:1 1 120px"><span>Build fee $</span><input id="wsetup" inputmode="decimal" placeholder="1500"></label>
            <label class="field" style="flex:1 1 120px"><span>Monthly care $ (optional)</span><input id="wmonthly" inputmode="decimal" placeholder="0"></label></div>
          <label class="field" style="margin-top:8px"><span>What the website includes (one per line)</span><textarea id="wscope" rows="4" placeholder="5 page website: home, about, services, service area, contact&#10;Mobile friendly design&#10;Contact form and tap to call&#10;Basic on-page setup for Google"></textarea></label>
          <button class="btn btn-primary btn-sm" id="lwweb" style="margin-top:8px">Send website work order</button></details>`, soon) : '<p class="small muted" style="margin-top:22px">The closer who runs the audit handles the quote, work order and payment.</p>'}
        ${data.orders.length ? fold('lm-wo', 'Work orders', `<ul class="list">${data.orders.map((o) => `<li class="item"><span class="badge ${o.status === 'paid' ? '' : o.status === 'signed' ? 'warn' : 'gray'}">${esc(o.status)}</span>
          <div><div class="item-title">${o.kind === 'website' ? 'Website' : 'Local marketing'} · ${esc(fmt.money((o.setup_cents || 0) / 100))} + ${esc(fmt.money((o.monthly_cents || 0) / 100))}/mo</div><div class="item-sub">${o.signed_name ? `Signed by ${esc(o.signed_name)} ${esc(fmt.ago(o.signed_at))}` : `Sent ${esc(fmt.ago(o.created_at))}`}</div></div>
          <button class="btn btn-ghost btn-sm" data-wo="${esc(o.token)}">Copy link</button></li>`).join('')}</ul>`, false, data.orders.length) : ''}
      </div>
      <div>
        ${fold('lm-next', 'Next step and notes', `<p style="margin-top:0">${l.next_action ? `${esc(l.next_action)} <span class="badge gray">${esc(dueText(l.next_action_at))}</span>` : '<span class="muted">None set</span>'}</p>
        ${l.notes ? `<div class="caption">${esc(l.notes)}</div>` : ''}`, true)}
        ${fold('lm-data', 'Lead data', '<div id="ldata"></div>', false)}
        ${fold('lm-mail', 'Recent email', '<div class="card" id="lmail" style="box-shadow:none;padding:0"></div>', false)}
        ${fold('lm-hist', 'History', `<ul class="feed">${data.activities.map((a) => `<li><span class="dot">${a.type === 'call' ? icon.msg : a.type === 'payment' ? icon.star : icon.note}</span>
          <div><div>${esc(activityText(a))}</div>${a.body && a.type !== 'stage' ? `<div class="small">${esc(a.body)}</div>` : ''}</div><span class="small">${esc(fmt.ago(a.at))}</span></li>`).join('') || '<li class="muted">Nothing yet.</li>'}</ul>`, false, data.activities.length)}
        <button class="btn btn-danger btn-sm" id="ldel" style="margin-top:16px">Delete lead</button>
      </div>
    </div>`;
  const done = () => { m.close(); onChange?.(); };
  wireFolds(m.el);
  prepPanel($('#lprep', m.el), l, data.intel, { rep: REP, voice: VOICE, onResearched: () => { changed = true; } });
  $('#ltexts', m.el)?.addEventListener('click', () => textModal(l, { rep: REP, onChange: () => { changed = true; } }));
  // Google: write to them, see what you have already sent, and put a meeting on your own calendar.
  $('#lmailbtn', m.el)?.addEventListener('click', async () => {
    const gmail = await import('./gstate.js').then((g) => g.hasGoogle('mail'));
    if (gmail) import('./mail.js').then((x) => x.compose({ to: l.email, subject: `${l.business} and Rightway Growth` }));
    else import('./hubmail.js').then((x) => x.compose({ to: l.email, subject: `${l.business} and Rightway Growth`, lead_id: l.id }));
  });
  leadDataCard($('#ldata', m.el), l, data.scrub, () => { changed = true; });
  // Who runs the booked call. Changing it checks they are free, updates the lead's invite and the team calendar.
  const cbox = $('#lcloserbox', m.el);
  if (cbox) api('/api/team').then(({ users }) => {
    const team = (users || []).filter(canRunCalls);
    const cur = l.closer_id || '';
    const me = window.__rwUser || {};
    const mayMove = can(me, 'schedule') || [l.meet_by, l.closer_id].includes(me.id); // schedulers, closers, owners, or the person who booked it
    cbox.innerHTML = `<label class="row small" style="gap:6px">Runs the call <select id="lcloser"${mayMove ? '' : ' disabled title="A scheduler or owner can hand this over"'}><option value="">Nobody yet</option>${team.map((u) => `<option value="${esc(u.id)}"${u.id === cur ? ' selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}</select></label>`;
    $('#lcloser', cbox).addEventListener('change', async (e) => {
      const send = (force) => api(`/api/leads/${l.id}/closer`, { method: 'PUT', body: { closer_id: e.target.value || null, force } });
      try { await send(false); toast('Handed over. The invite and team calendar are updated.'); changed = true; }
      catch (err) {
        if (err.status === 409 && confirm(`${err.message}\n\nGive it to them anyway?`)) { try { await send(true); toast('Handed over'); changed = true; } catch (x) { toast(x.message, true); } }
        else { toast(err.message, true); e.target.value = cur; }
      }
    });
  }).catch(() => {});
  $('#lbooklink', m.el)?.addEventListener('click', async (e) => {
    try { const r = await api(`/api/leads/${l.id}/book-link`); await copy(r.url, 'Booking link copied. It fills in what we know and asks for the rest.'); } catch (err) { toast(err.message, true); }
  });
  $('#lmeetbtn', m.el).addEventListener('click', async () => (await import('./gstate.js').then((g) => g.hasGoogle('calendar'))) ? import('./gcal.js').then((x) => x.quickEvent({
    title: `Audit call: ${l.business}`, attendees: [l.email].filter(Boolean), leadId: l.id,
    notes: [l.contact_name && `Contact: ${l.contact_name}`, l.phone && `Phone: ${l.phone}`, l.website && `Site: ${l.website}`].filter(Boolean).join('\n'),
  })) : import('./apptcal.js').then((x) => x.quickAppointment({
    title: `Audit call: ${l.business}`, guest_email: l.email || '', lead_id: l.id, lead_name: l.business,
    note: [l.contact_name && `Contact: ${l.contact_name}`, l.phone && `Phone: ${l.phone}`, l.website && `Site: ${l.website}`].filter(Boolean).join('\n'),
  })));
  if (l.email) import('./gstate.js').then((g) => g.hasGoogle('mail')).then((gm) => import(gm ? './mail.js' : './hubmail.js')).then((x) => x.mailWith($('#lmail', m.el), l.email, { name: l.contact_name || l.business })).catch(() => {});
  $('#lpack', m.el)?.addEventListener('click', async (e) => { busy(e.currentTarget, true, 'Making'); try { const r = await api(`/api/leads/${l.id}/pack`, { method: 'POST', body: {} }); copy(r.link, 'Analysis link copied'); } catch (err) { toast(err.message, true); } busy(e.currentTarget, false); });
  $('#ledit', m.el).addEventListener('click', () => { m.close(); leadForm(l, () => onChange?.()); });
  $$('[data-out]', m.el).forEach((b) => b.addEventListener('click', async () => {
    const outcome = b.dataset.out;
    const acts = dispoOf(outcome).acts;
    const when = $('#lwhen', m.el).value;
    if ((acts === 'callback' || acts === 'booked') && !when) return toast('Pick the date and time first.', true);
    busy(b, true);
    try { const r = await api(`/api/leads/${l.id}/outcome`, { method: 'POST', body: { dispo: outcome, note: $('#lnote', m.el).value, callbackAt: when || null } }); toast(r.calendar?.warning ? `Logged. Heads up: ${r.calendar.warning}` : 'Logged', Boolean(r.calendar?.warning)); done(); }
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
  const readScope = () => $$('.scope-row', m.el).filter((r) => $('input[type=checkbox]', r).checked).map((r) => ({ id: r.dataset.id, qty: $('[data-qty]', r)?.value }));
  const val = (id) => $(`#${id}`, m.el)?.value ?? '';
  const saveQuote = () => api(`/api/leads/${l.id}/quote`, { method: 'PUT', body: {
    setup: val('lsetup'), monthly: val('lmonthly'), services: readScope(),
    anchor: { setup: val('lasetup'), monthly: val('lamonthly') }, drop: { setup: val('ldsetup'), monthly: val('ldmonthly') } } });
  // Delivery time for what is switched on, from the task guides, and what the price works out to per hour of that work.
  const fx = () => {
    const box = $('#lfx', m.el);
    if (!box) return;
    const sc = readScope().map((x) => ({ id: x.id, qty: Number(x.qty) || undefined }));
    const e = effort(sc);
    const mo = Number(String(val('lmonthly')).replace(/[$,\s]/g, ''));
    const rf = $('#lref', m.el);
    if (rf) rf.innerHTML = `<b>Plan guide (internal, never shown to the client)</b><ul class="list" style="margin:6px 0 0">${refLines(sc).map((t) => `<li class="item"><div class="item-sub">${esc(t)}</div></li>`).join('')}</ul>`;
    box.innerHTML = `Delivery time: about <b>${hoursOf(e.monthly)} h a month</b>, plus about ${hoursOf(e.setup)} h to set up.${mo > 0 && e.monthly ? ` At ${esc(fmt.money(mo))} a month that is <b>${esc(fmt.money(Math.round(mo / (e.monthly / 60))))} an hour</b> of delivery.` : ' Type your monthly to see what it pays per hour.'}`;
  };
  $('.scope-pick', m.el)?.addEventListener('input', fx);
  $('#lmonthly', m.el)?.addEventListener('input', fx);
  fx();
  $('#lquote', m.el)?.addEventListener('click', async (e) => { busy(e.target, true); try { await saveQuote(); toast('Quote saved'); changed = true; } catch (err) { toast(err.message, true); } finally { busy(e.target, false); } });
  const wguide = (pages) => { const g = $('#wguide', m.el); if (g) g.innerHTML = `<b>Website guide (internal, never shown to the client)</b><ul class="list" style="margin:6px 0 0">${webLines(pages).map((t) => `<li class="item"><div class="item-sub">${esc(t)}</div></li>`).join('')}</ul>`; };
  wguide(8);
  $('#wtier', m.el)?.addEventListener('change', (e) => {
    const t = webTierById(e.target.value);
    wguide(t ? t.pages[1] : e.target.value === 'custom' ? 20 : 8);
    if (!t) return;
    $('#wsetup', m.el).value = t.build;
    $('#wmonthly', m.el).value = t.care;
    $('#wscope', m.el).value = [`${t.label} website: ${t.note.replace(/\.$/, '')}`, 'Mobile friendly design', 'Contact form and tap to call', 'Basic on-page setup for Google', 'Hosting, backups, updates and small edits each month', 'You own the site after 12 months of care'].join('\n');
  });
  $('#lwweb', m.el)?.addEventListener('click', async (e) => {
    busy(e.target, true);
    try {
      const r = await api(`/api/leads/${l.id}/work-order`, { method: 'POST', body: { kind: 'website', setup: $('#wsetup', m.el).value, monthly: $('#wmonthly', m.el).value, scope: $('#wscope', m.el).value } });
      share(r.url, r.hasPayLink ? 'Website work order link (sign, then pay)' : 'Website work order link. No payment link yet: run Set up Stripe in Settings.',
        `Hi ${personOf(l) ? personOf(l).split(' ')[0] : ''}, here is your Rightway Growth website agreement. Review it, sign, and you can pay right after: ${r.url}`);
    } catch (err) { toast(err.message, true); } finally { busy(e.target, false); }
  });
  $('#lwo', m.el)?.addEventListener('click', async (e) => {
    busy(e.target, true);
    try {
      await saveQuote();
      const r = await api(`/api/leads/${l.id}/work-order`, { method: 'POST', body: { kind: 'seo', setup: val('lsetup'), monthly: val('lmonthly') } });
      share(r.url, r.hasPayLink ? 'Work order link (sign, then pay)' : 'Work order link. No payment link yet: run Set up Stripe in Settings, then send a payment link.',
        `Hi ${personOf(l) ? personOf(l).split(' ')[0] : ''}, here is your Rightway Growth work order. Review it, sign, and you can pay right after: ${r.url}`);
    } catch (err) { toast(err.message, true); } finally { busy(e.target, false); }
  });
  $('#lpay', m.el)?.addEventListener('click', async (e) => {
    busy(e.target, true);
    try {
      await saveQuote();
      const r = await api(`/api/leads/${l.id}/payment-link`, { method: 'POST', body: { setup: val('lsetup'), monthly: val('lmonthly') } });
      share(r.link, 'Stripe payment link', `Here is the secure payment link to get started with Rightway Growth: ${r.link}`);
    } catch (err) { toast(err.message, true); } finally { busy(e.target, false); }
  });
  $('#lwon', m.el)?.addEventListener('click', async (e) => {
    busy(e.target, true);
    try { await saveQuote().catch(() => null); const r = await api(`/api/leads/${l.id}/convert`, { method: 'POST', body: {} }); m.close(); location.hash = `#/client/${r.clientId}/overview`; }
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
  ['business', /^(business|company|business name|company name|account|organization|organisation|name of business)$/i],
  ['contact_name', /^(?!.*(title|job|position|role|link|url|_id\b|\bid\b|phone|status|valid|source|company|business|type)).*(contact|owner|full[ _]?name|first[ _]?name|^name$|decision)/i], ['phone', /(phone|mobile|cell|tel)/i], ['email', /^(?!.*(title|name|status|valid|source|phone|social|domain|position|role)).*e-?mail/i],
  ['website', /(website|url|domain|site)/i], ['city', /^city$/i], ['state', /^(state|province|region|st)$/i], ['industry', /(industry|category|niche|type|vertical)/i],
  ['address', /address/i],
];

export function mapRows(rows) {
  const [head, ...body] = rows;
  const cols = head.map((h) => { const hit = MAP.find(([, re]) => re.test(h.trim())); return hit ? hit[0] : null; });
  // No business column: a plain "name" column is the business (Outscraper), else a "title" column (some exports), else the first name-like column.
  if (!cols.includes('business')) {
    const plain = head.findIndex((h) => /^name$/i.test(h.trim()));
    const ti = head.findIndex((h) => /^title$/i.test(h.trim()));
    const i = plain >= 0 ? plain : ti >= 0 ? ti : cols.indexOf('contact_name');
    if (i >= 0) cols[i] = 'business';
  }
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
    <textarea id="csvt" rows="8" placeholder="business,contact,phone,city,state,industry&#10;Summit Roofing,Bob,954-555-0101,Miami,FL,Roofing"></textarea>
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
// Call category chip: what to lead with on this call, from what we know about the business.
const catChip = (c) => `<i class="cc cc-${esc(c.id)}" title="${esc(c.lead)}">${esc(c.label)}</i>`;
// What the call windows show about a lead: the facts the scrub gathered, ready while talking.
const callInfo = (l) => {
  const w = whoIs(l);
  const bad = ['bad', 'no_mail_server'].includes(l.email_status);
  const place = [l.city, l.state].filter(Boolean).join(', ');
  return [
    { k: 'Phone', v: l.phone || '', tag: l.phone_type ? (PHONE_TYPE_LABEL[l.phone_type] || l.phone_type) : '', copy: l.phone || '' },
    { k: 'Their time', v: l.tz_known && l.local_time ? l.local_time : '' },
    { k: 'Email', v: l.email || '', href: l.email ? `mailto:${l.email}` : '', tag: l.email && l.email_status ? (EMAIL_STATUS_LABEL[l.email_status] || '') : '', tone: bad ? 'bad' : l.email_status === 'role' ? 'warn' : '', copy: l.email || '' },
    { k: 'Owner', v: w.known && w.role === 'Owner' ? w.name : '' },
    { k: 'Place', v: place },
    { k: 'Website', v: l.website ? String(l.website).replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '') : '', href: l.website ? (/^https?:/.test(l.website) ? l.website : `https://${l.website}`) : '' },
    { k: 'Google', v: l.reviews != null ? `${l.reviews} reviews${l.rating ? ` · ${l.rating}★` : ''}` : '' },
  ];
};
// Everything known about a lead, for the hover card on the board, the list and the dialer queue.
const leadHover = (l) => {
  if (!l) return '';
  const w = whoIs(l);
  const info = callInfo(l);
  const pick = (k) => info.find((x) => x.k === k) || { k, v: '' };
  const meet = l.meet_at && l.meet_at > Date.now() - 3600e3 ? bothTimes(l.meet_at, validZone(l.timezone) || yourZone(), yourZone()) : '';
  const tags = Array.isArray(l.tags) ? l.tags.join(', ') : String(l.tags || '').replace(/[\[\]"]/g, '').replace(/,/g, ', ');
  return hoverHtml({ initials: initialsOf(w.known ? w.name : l.business), name: w.known ? w.name : '', role: w.known ? w.role : '', business: l.business,
    badges: [l.grade ? `Grade ${l.grade}${l.score != null ? ` · ${l.score}` : ''}` : '', STAGE_LABEL[l.stage] || '', l.dnc ? 'Do not call' : '', l.sms_consent ? 'OK to text' : ''],
    rows: [pick('Phone'), pick('Their time'), pick('Email'), w.known ? { k: 'Speaking with', v: `${w.name}${w.role ? `, ${w.role}` : ''}` } : { k: 'Ask for', v: 'The owner' }, pick('Place'), pick('Website'), pick('Google'),
      { k: 'Industry', v: l.industry || l.category || '' }, { k: 'Map rank', v: l.map_rank == null ? '' : l.map_rank > 20 ? 'Not in the first 20' : `#${l.map_rank}` },
      { k: 'Source', v: l.source || '' }, { k: 'Calls', v: l.attempts ? `${l.attempts} tried${l.last_call_at ? `, last ${new Date(l.last_call_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}` : 'Not called yet' },
      { k: 'Next step', v: l.next_action_at ? `${l.next_action || 'Follow up'} · ${dueText(l.next_action_at)}` : '' }, { k: 'Audit', v: meet }, { k: 'Tags', v: tags }],
    foot: 'Click to open. Everything here is saved on the lead.' });
};
// One tap callback times for the call window, set on the lead's clock where it is known (10 AM their time), filled into the result box in your clock.
const callbackChips = (l) => {
  const mine = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  const zone = validZone(l.timezone) || mine;
  const local = (ms) => { const v = inputsIn(ms, mine); return `${v.date}T${v.time}`; };
  const at = (days, hhmm) => { const d = inputsIn(Date.now() + days * 864e5, zone).date; const ms = fromInputs(d, hhmm, zone); return ms ? local(ms) : ''; };
  const hour = new Date(Math.ceil((Date.now() + 3600e3) / 300e3) * 300e3);
  const their = validZone(l.timezone) && l.tz_known ? ' their time' : '';
  return [['In 1 hour', local(hour.getTime())], [`Tomorrow 10 AM${their}`, at(1, '10:00')], [`Tomorrow 2 PM${their}`, at(1, '14:00')], [`Next week 10 AM${their}`, at(7, '10:00')]].filter(([, v]) => v);
};
const whoHtml = (w) => (w.known ? `<b>${esc(w.name)}</b><span class="cc-role">${esc(w.role)}</span>${w.also ? `<span class="small muted">also ${esc(w.also)}</span>` : ''}` : `<b class="muted">${esc(w.line)}</b>`);
export async function dialerPage(app, user) {
  setRep(user);
  const view = staffShell(app, user, 'dialer');
  let flt = {};
  try { flt = JSON.parse(localStorage.getItem(DIAL_KEY) || '{}'); } catch { flt = {}; }
  // Researching the next leads as you dial costs money, so it starts off (Nov 2026). The old saved choice is ignored once.
  let auto = false;
  try { auto = localStorage.getItem('rw-dial-auto2') === '1'; } catch { /* ignore */ }
  const qs = new URLSearchParams(Object.entries(flt).filter(([, v]) => v)).toString();
  let me, q, cal, nums = { numbers: [] };
  try { [me, q, cal, nums] = await Promise.all([api('/api/me'), api(`/api/dialer/queue?limit=150&since=${new Date().setHours(0, 0, 0, 0)}${qs ? `&${qs}` : ''}`), api('/api/calendar/upcoming').catch(() => ({ meetings: [] })), api('/api/dialer/numbers').catch(() => ({ numbers: [] }))]); }
  catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  await refreshDispos();
  if (me.twilio) startPhone().catch(() => {});
  const offPhone = onPhoneState((st) => { if (!document.body.contains(view)) return offPhone(); const b = $('#pbadge', view); if (b) b.innerHTML = phoneBadge(st); });
  let idx = 0;
  let offDialHover = null;
  // Power dial: shows the next 3, counts down, rings the first through the browser phone, opens the result popup when it ends,
  // then moves to the next 3. One call at a time, so nobody ever picks up to silence.
  let power = false, pdTimer = null, pdStart = 0, pdCalls = 0, pdWait = 5;
  try { pdWait = Number(localStorage.getItem('rw-pd-wait')) || 5; } catch { /* ignore */ }
  pdWait = Math.min(10, Math.max(1, Math.round(pdWait)));
  // One setting for the pause between calls: 1 to 10 seconds. Every picker (dialer header, power dial box, call window) shows the same value.
  const WAITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const waitOpts = () => WAITS.map((v) => `<option value="${v}"${v === pdWait ? ' selected' : ''}>${v} second${v === 1 ? '' : 's'}</option>`).join('');
  const setWait = (v) => { pdWait = Math.min(10, Math.max(1, Math.round(Number(v)) || 5)); try { localStorage.setItem('rw-pd-wait', String(pdWait)); } catch { /* ignore */ } document.querySelectorAll('select.pd-wait').forEach((x) => { x.value = String(pdWait); }); };
  let pdBox = null;
  let skipDispo = null;
  // One thing at a time: idle -> countdown (box) -> calling (call window) -> wrap (result inside the call window) -> idle, then the countdown for the next lead.
  // powerStep and dialFirst do nothing unless the phase allows it, so a Resume click, a redraw or a timer can never dial over a live call or an open result.
  let phase = 'idle';
  const busyPhase = () => phase === 'calling' || phase === 'wrap' || phoneState().onCall;
  const bookedDuring = new Set();
  // Test power dial: pretend leads and a pretend call so anyone can watch the whole flow. Nothing is dialed, saved or counted.
  let testMode = false;
  let testLog = [];
  const testHist = new Map();
  const testHit = (l, text) => { const a = testHist.get(l.id) || []; a.push(text); testHist.set(l.id, a); };
  const dialOn = () => Boolean(me.twilio) || testMode;
  const testNote = (what) => toast(`Test mode: ${what} is for real leads. Nothing happens here.`);
  const testScore = new Map();
  const testBook = (l) => testBookModal(l, () => { const id = (DISP.find((d) => d.acts === 'booked') || { id: 'booked' }).id; testHit(l, 'Audit booked (pretend)'); afterBooking(l, id); });
  const testText = (l) => testTextModal(l, { onSent: (t) => testHit(l, `Texted: ${t.slice(0, 60)}`) });
  // On a phone (600px or less) power dialing takes over the whole screen: countdown, call window and result sheet are each full screen. Everything else keeps its normal layout.
  const phoneNarrow = () => isPhone();
  const setPdx = () => {
    const on = power && phoneNarrow();
    document.body.classList.toggle('pdx', on);
    if (!on) document.body.classList.remove('pdx-script');
    let back = document.getElementById('pdxback');
    if (on && !back) { back = document.createElement('button'); back.id = 'pdxback'; back.type = 'button'; back.className = 'btn btn-primary pdx-back'; back.textContent = 'Back to the call'; back.addEventListener('click', () => document.body.classList.remove('pdx-script')); document.body.appendChild(back); }
    if (!on) back?.remove();
    let shut = document.getElementById('pdxclose');
    if (on && !shut) {
      shut = document.createElement('button'); shut.id = 'pdxclose'; shut.type = 'button'; shut.className = 'pdx-close'; shut.setAttribute('aria-label', 'Close power dial'); shut.innerHTML = '<span aria-hidden="true">&times;</span><b>Close</b>';
      shut.addEventListener('click', () => {
        const live = phoneState().onCall;
        if (live && !window.confirm('End the call and stop power dialing?')) return;
        const id = q.queue[idx]?.id;
        powerStop();
        document.querySelectorAll('.modal-bg [data-close]').forEach((b) => b.click());
        if (live) { skipDispo = id; takeCallDraft(); hangUp(); }
        toast('Power dial stopped.');
      });
      document.body.appendChild(shut);
    }
    if (!on) shut?.remove();
  };
  const powerStop = () => { power = false; dropMic(); clearInterval(pdTimer); if (phase === 'countdown') phase = 'idle'; if (pdBox) { leaving(pdBox); pdBox.remove(); } pdBox = null; setPdx(); const b = document.getElementById('pdgo'); if (b) b.textContent = 'Start power dial'; };
  // Leaving the dialer pauses power dialing instead of ending it: a chip waits in the tray, one click comes back and carries on.
  window.addEventListener('hashchange', () => {
    if (!power) return;
    const keep = { calls: pdCalls, start: pdStart };
    powerStop();
    trayAdd('powerdial', { title: 'Power dial paused', sub: `${keep.calls} call${keep.calls === 1 ? '' : 's'} so far. Click to carry on.`, hot: true,
      onResume: () => { holdMic(); window.__rwPowerPause = keep; location.hash = '#/phone'; }, onDrop: () => { window.__rwPowerPause = null; } });
  }, { once: true });
  if (window.__rwPowerPause) { const k = window.__rwPowerPause; window.__rwPowerPause = null; trayRemove('powerdial'); pdCalls = k.calls; pdStart = k.start; power = true; setPdx(); }
  // Esc: on the result window it means Later, on the countdown box it stops dialing. A live call is never ended by Esc.
  const onEsc = (e) => {
    if (e.key !== 'Escape') return;
    if (!document.body.contains(view)) return document.removeEventListener('keydown', onEsc);
    if (document.querySelector('.modal-bg')) return;
    const skip = document.querySelector('.callbar .cb-wrap [data-skip]');
    if (skip) { e.preventDefault(); skip.click(); return; }
    if (pdBox && phase !== 'calling') { e.preventDefault(); powerStop(); toast('Dialing stopped.'); }
  };
  document.addEventListener('keydown', onEsc);
  const sessClock = () => { const t = Math.floor((Date.now() - pdStart) / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  const powerStep = () => {
    clearInterval(pdTimer);
    if (!power || busyPhase()) return;
    phase = 'countdown';
    const next = q.queue.slice(idx, idx + 3);
    if (!pdBox) {
      pdBox = document.createElement('div'); pdBox.className = 'pd'; document.body.appendChild(pdBox);
      // Drag it by the top bar or the name area. It remembers where you put it. The window is redrawn every second, so the grab test runs on the window itself.
      makeDraggable(pdBox, { grab: () => true, key: 'dialwin', off: () => isPhone() });
      pdBox.dataset.new = '1';
    }
    if (!next.length) { pdBox.innerHTML = `<div class="pd-head">${icon.phone}<span>Power dial</span><b>${pdCalls} calls · ${sessClock()}</b></div><div class="pd-list"><p style="margin:0">Queue clear. Pick another quality tab or time zone.</p></div><div class="pd-foot"><button class="btn btn-primary btn-sm" id="pdx">Close</button></div>`; $('#pdx', pdBox).onclick = powerStop; return; }
    let left = pdWait;
    const draw = () => {
      pdBox.className = 'pd';
      pdBox.innerHTML = `<div class="pd-head">${icon.phone}<span>Power dial · <b>${pdCalls}</b> calls · <b>${sessClock()}</b></span><span class="pd-count">${left}</span><button type="button" class="pd-x" id="pdclose" aria-label="Stop dialing and close (Esc)" title="Stop dialing (Esc)">&times;</button></div>
        <div class="pd-bar" style="width:${(100 * (pdWait - left)) / pdWait}%"></div>
        <div class="pd-list">${next.map((l, i) => `<div class="pd-card${i === 0 ? ' first' : ''}"><span class="g ${esc(l.grade || '')}">${esc(l.grade || '?')}</span>
          <div style="min-width:0"><b>${esc(whoIs(l).name || 'Ask for the owner')}</b><span class="small">${esc([l.business, l.city, l.local_time ? `${l.local_time} their time` : ''].filter(Boolean).join(' · '))}</span>${l.email ? `<span class="small">${esc(l.email)}</span>` : ''}${catChip(callCategory(l))}</div>
          <span class="small">${i === 0 ? 'Calling next' : `Then #${i + 1}`}</span></div>`).join('')}</div>
        <div class="pd-foot"><button class="btn btn-primary btn-sm" id="pdnow">Call now</button><button class="btn btn-ghost btn-sm" id="pdskip">Skip</button><button class="btn btn-ghost btn-sm" id="pdpause">Pause</button><button class="btn btn-ghost btn-sm pd-stopbtn" id="pdstop">Stop dialing</button>
          <label class="row small" style="gap:6px;margin-left:auto">Wait between calls <select id="pdw" class="pd-wait" style="width:auto;min-height:32px;padding:4px 8px">${waitOpts()}</select></label></div>`;
      $('#pdnow', pdBox).onclick = () => { clearInterval(pdTimer); dialFirst(); };
      $('#pdclose', pdBox).onclick = () => { powerStop(); toast('Dialing stopped.'); };
      $('#pdstop', pdBox).onclick = () => { powerStop(); toast('Dialing stopped.'); };
      $('#pdskip', pdBox).onclick = () => { clearInterval(pdTimer); phase = 'idle'; idx++; render(); };
      $('#pdpause', pdBox).onclick = () => { clearInterval(pdTimer); phase = 'idle'; pdBox.querySelector('.pd-count').textContent = 'II'; $('#pdpause', pdBox).textContent = 'Resume'; $('#pdpause', pdBox).onclick = () => powerStep(); };
      $('#pdw', pdBox).onchange = (e) => { setWait(e.target.value); left = Math.min(left, pdWait); draw(); };
    };
    draw();
    if (pdBox.dataset.new) { delete pdBox.dataset.new; arriving(pdBox); }
    pdTimer = setInterval(() => {
      if (!power || phase !== 'countdown' || busyPhase()) { clearInterval(pdTimer); return; }
      left--; if (left <= 0) { clearInterval(pdTimer); dialFirst(); } else draw();
    }, 1000);
  };
  // The result popup was closed without a result: keep the session, say what it is waiting for.
  const holdPower = (reopen) => {
    if (!power || phoneState().onCall) return;
    clearInterval(pdTimer);
    phase = 'idle';
    const born = !pdBox;
    if (!pdBox) { pdBox = document.createElement('div'); pdBox.className = 'pd'; document.body.appendChild(pdBox); makeDraggable(pdBox, { grab: () => true, key: 'dialwin', off: () => isPhone() }); }
    pdBox.className = 'pd';
    pdBox.innerHTML = `<div class="pd-head">${icon.phone}<span>Power dial · <b>${pdCalls}</b> calls · <b>${sessClock()}</b></span></div>
      <div class="pd-list"><p style="margin:0"><b>Waiting for the result.</b> Pick how the call went and the next one starts ${pdWait} second${pdWait === 1 ? '' : 's'} after.</p></div>
      <div class="pd-foot"><button class="btn btn-primary btn-sm" id="pdre">Pick the result</button><button class="btn btn-ghost btn-sm" id="pdx2">Stop power dial</button></div>`;
    $('#pdre', pdBox).onclick = reopen;
    $('#pdx2', pdBox).onclick = powerStop;
    if (born) arriving(pdBox);
  };
  const dialFirst = () => {
    const btn = document.getElementById('dhub');
    if (busyPhase()) return;
    if (!btn || btn.disabled) { toast('The browser phone is not ready. Check Phone setup.', true); return powerStop(); }
    pdCalls++;
    // One window: the countdown box goes away while the call window is up, so only one clock runs on screen.
    clearInterval(pdTimer);
    if (pdBox) { leaving(pdBox); pdBox.remove(); } pdBox = null;
    phase = 'calling';
    btn.click();
  };
  const intelCache = new Map();
  const researching = new Set();
  const prefetch = async (l) => {
    if (!l || intelCache.has(l.id) || researching.has(l.id)) return;
    if (testMode) { intelCache.set(l.id, testIntel(l)); return; }
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
    prepPanel(el, l, intelCache.get(l.id), { rep: REP, voice: VOICE, onResearched: (next, intel) => { Object.assign(l, next); intelCache.set(l.id, intel); const gg = $('#dgrade', view); if (gg) gg.innerHTML = gradeBadge(l.grade, l.score); } });
  };
  const upcoming = (cal.meetings || []).filter((m) => m.meet_at > Date.now() - 3600e3).slice(0, 4);
  // Low prepaid balance on Twilio or DataForSEO: say so before calls or research start failing.
  setTimeout(() => api('/api/balances/status').then((b) => { const el = document.getElementById('lowbal'); if (el && b.low?.length) el.innerHTML = `<div class="card" style="border-color:#E8A33D;margin-bottom:12px"><b>${b.low.map((x) => esc(x.name)).join(' and ')} balance ${b.low.some((x) => x.empty) ? 'is empty' : 'is low'}.</b> <span class="small">${b.low.some((x) => x.key === 'twilio') ? 'Calls and texts stop when Twilio runs out. ' : ''}${b.low.some((x) => x.key === 'dataforseo') ? 'Research and scans stop when DataForSEO runs out. ' : ''}An owner can add funds from the Dashboard.</span></div>`; }).catch(() => {}), 50);
  const filterText = Object.entries(flt).filter(([k, v]) => v && k !== 'tier' && k !== 'cat').map(([k, v]) => (k === 'stage' ? `Column: ${String(v).split(',').map((x) => STAGE_LABEL[x] || x).join(', ')}` : `${k === 'tz' ? 'Time zone' : k[0].toUpperCase() + k.slice(1)}: ${v}`)).join(' · ');
  let lay = { queue: true, prep: true, compact: false, tiers: true, cats: true, upcoming: true, notes: true, links: true };
  let layOpen = false;
  // Click anywhere else, or press Escape, to close the layout menu.
  const shutLay = () => { layOpen = false; const b = document.getElementById('dlaybody'); if (b) b.hidden = true; document.getElementById('dlaybtn')?.setAttribute('aria-expanded', 'false'); };
  const layOutside = (e) => { if (!document.body.contains(view)) { document.removeEventListener('click', layOutside); document.removeEventListener('keydown', layEsc); return; } if (layOpen && !e.target.closest('.dlayout')) shutLay(); };
  const layEsc = (e) => { if (e.key === 'Escape' && layOpen) shutLay(); };
  document.addEventListener('click', layOutside); document.addEventListener('keydown', layEsc);
  try { lay = { ...lay, ...JSON.parse(localStorage.getItem('rw-dial-layout') || '{}') }; } catch { /* ignore */ }
  const startTest = () => {
    testMode = true; idx = 0; pdStart = 0; pdCalls = 0; testLog = []; testHist.clear(); testScore.clear(); intelCache.clear();
    const tl = testLeads(); const tiers = { hot: 0, good: 0, maybe: 0, low: 0, fresh: 0 }; const cats = {}; tl.forEach((x) => { tiers[{ A: 'hot', B: 'good', C: 'maybe', D: 'low' }[x.grade] || 'fresh']++; const c = callCategory(x).id; cats[c] = (cats[c] || 0) + 1; });
    q = { ...q, queue: tl, tiers, cats, waitingForHours: 0, stats: { dials: 0, talks: 0, booked: 0, goal: q.stats?.goal || 60 } };
    render();
  };
  const render = () => {
    const l = q.queue[idx];
    if (!l && testMode && power) powerStop();
    view.innerHTML = `
      <div class="page-head"><div><p class="eyebrow">Power dialer</p><h1>Call queue</h1></div>
        <div class="row"><span class="badge">${q.queue.length - idx} ready now</span>${q.waitingForHours ? `<span class="badge gray">${q.waitingForHours} waiting for their calling hours</span>` : ''}
          ${testMode ? '' : `<label class="row small" style="gap:6px"><input type="checkbox" id="dauto"${auto ? ' checked' : ''}> Auto research ahead<span class="cost-hint" data-cost="research_call"></span></label>`}<a class="btn btn-ghost btn-sm" href="#/pipeline">Pipeline</a>
          <button class="btn btn-ghost btn-sm" id="pdtest" title="Try power dialing with pretend leads and a pretend call. Nothing is dialed or saved.">${testMode ? 'Exit test' : 'Test power dial'}</button>
          ${dialOn() ? `<label class="row small" style="gap:6px" title="Pause between calls while power dialing">Wait <select id="pdwh" class="pd-wait" style="width:auto;min-height:32px;padding:4px 8px">${waitOpts()}</select></label><button class="btn btn-primary btn-sm" id="pdgo">${power ? 'Power dialing...' : 'Start power dial'}</button>` : ''}</div></div>
      ${testMode ? '<div class="card test-banner"><b>Test mode.</b> Seven pretend leads run the whole dialer, from Start power dial to the result popup and the next lead. Nothing is dialed, texted, booked or saved, and it costs nothing. <a href="#/training/warmup">Warm up in Training</a>. <button type="button" class="btn btn-ghost btn-sm" id="pdtestx">Exit test</button></div>' : ''}
      ${dialTabs('queue', user)}
      <div class="dropfilters">
        <label class="dropf" data-sec="tiers"><span>Quality</span><select id="dtier" data-tier-sel aria-label="Quality">${[['', 'Best first', 'all'], ['hot', 'Hot', 'A grade, callbacks, audit requests'], ['good', 'Good', 'B grade'], ['maybe', 'Maybe', 'C grade'], ['low', 'Low', 'D grade'], ['fresh', 'Not researched', 'researching in the background']]
          .map(([k, n]) => `<option value="${k}"${(flt.tier || '') === k ? ' selected' : ''}>${esc(n)} (${k ? (q.tiers?.[k] ?? 0) : Object.values(q.tiers || {}).reduce((a, b) => a + b, 0)})</option>`).join('')}</select></label>
        <label class="dropf" data-sec="cats"><span>Call type</span><select id="dcat" data-cat-sel aria-label="Call type">${[['', 'All', 'every call type'], ...CALL_CATS.map((c) => [c.id, c.label, c.lead])]
          .filter(([k]) => !k || q.cats?.[k] || (flt.cat || '') === k)
          .map(([k, n]) => `<option value="${k}"${(flt.cat || '') === k ? ' selected' : ''}>${esc(n)} (${k ? (q.cats?.[k] ?? 0) : Object.values(q.cats || {}).reduce((a, b) => a + b, 0)})</option>`).join('')}</select></label>
      </div>
      ${fold('dfilters', 'More filters and research status', `<div class="row small" style="margin:-4px 0 10px;gap:8px">Data: <div class="seg">${[['', 'Any'], ['mobile', 'Mobile numbers'], ['owner', 'Owner name known'], ['email', 'Has an email']].map(([k, n]) => `<button type="button" data-dq="${k}" class="${(flt.data || '') === k ? 'is-on' : ''}">${n}</button>`).join('')}</div></div>
      <div id="rsx" class="small muted" style="margin:6px 0 0"></div>
      ${filterText ? `<div class="row small" style="margin:6px 0 0">Dialing: ${esc(filterText)} <button class="linkbtn" id="dclear">Dial everyone instead</button></div>` : ''}`, Boolean(filterText))}
      <div class="dstrip" aria-label="Today"><span class="dgoal"><b>${q.stats.dials}</b> dials <i>of ${user.role === 'admin' ? `<button type="button" class="goal-btn" id="dgoal" title="Click to change your daily dial goal">${q.stats.goal || 60}</button>` : `<span class="goal-fixed" title="Your owner sets your daily dial goal">${q.stats.goal || 60}</span>`}</i><em class="dgbar" aria-hidden="true"><u style="width:${Math.min(100, Math.round((100 * q.stats.dials) / (q.stats.goal || 60)))}%"></u></em>${q.stats.dials >= (q.stats.goal || 60) ? '<b class="gdone">Goal hit</b>' : ''}</span><span><b>${q.stats.talks}</b> owner talks</span><span><b>${q.stats.booked}</b> booked</span><span><b>${q.stats.dials ? Math.round((q.stats.talks / q.stats.dials) * 100) : 0}%</b> contact rate</span>
        <div class="dlayout"><button type="button" class="dl-btn" id="dlaybtn" aria-expanded="${layOpen}" aria-haspopup="true">Customize layout</button>
          <div class="dlayout-body" id="dlaybody" role="group" aria-label="Customize layout"${layOpen ? '' : ' hidden'}>
            <p class="small muted" style="margin:0">Show or hide. Saved for you on this computer.</p>
            ${[['queue', 'Up next list'], ['prep', 'Script and research'], ['tiers', 'Quality tabs'], ['cats', 'Call type tabs'], ['upcoming', 'Coming up appointments'], ['links', 'Map, profile and website buttons'], ['notes', 'Note and callback time'], ['compact', 'Tighter spacing']]
              .map(([k, n]) => `<label><input type="checkbox" data-lay="${k}"${lay[k] ? ' checked' : ''}> ${n}</label>`).join('')}
            <button type="button" class="btn btn-ghost btn-sm" id="dlayreset">Show everything</button></div></div></div>
      <div id="lowbal"></div>
      ${upcoming.length ? `<div class="card upcoming" data-sec="upcoming"><b>Coming up</b>${upcoming.map((m) => `<span class="badge${m.meet_at < Date.now() + 3600e3 ? ' warn' : ''}">${esc(bothTimes(m.meet_at, validZone(m.timezone) || yourZone(), yourZone()))} ${esc(m.business)}</span>
        ${m.meet_link ? `<a class="small" href="${esc(m.meet_link)}" target="_blank" rel="noopener">Meet</a>` : ''}${can(window.__rwUser, 'close') ? `<a class="small" href="/present.html#${esc(m.id)}" target="_blank" rel="noopener">Present</a>` : ''}`).join('')}</div>` : ''}
      ${!l && testMode ? testSummaryHtml(testLog) : !l ? `<div class="card empty"><h3>Queue clear</h3><p>No one is due right now inside 8am to 8pm their time${filterText ? ' for this filter' : ''}. Import leads or check back later.</p><a class="btn btn-primary" href="#/pipeline">Go to pipeline</a></div>` : `
      <div class="dial-grid${lay.queue ? '' : ' no-queue'}${lay.prep ? '' : ' no-prep'}${lay.compact ? ' tight' : ''}">
        <aside class="dial-queue card" aria-label="Up next"><div class="card-head"><h3>Up next</h3><span class="small muted">${Math.max(0, q.queue.length - idx - 1)} after this</span></div>
          <ol>${q.queue.slice(idx, idx + 10).map((x, i) => `<li><button type="button" data-jump="${idx + i}" class="${i === 0 ? 'is-on' : ''}">${gradeBadge(x.grade, x.score)}<span class="dq-t"><b>${esc(x.business)}</b><small>${esc([x.city, x.state].filter(Boolean).join(', '))}${x.local_time ? ` · ${esc(x.local_time)}` : ''}</small>${catChip(callCategory(x))}</span></button></li>`).join('')}</ol></aside>
        <div class="dial-left">
          <div class="card dial-card">
            <p class="eyebrow">${esc(STAGE_LABEL[l.stage])}${l.attempts ? ` · attempt ${l.attempts + 1}` : ''}${l.next_action ? ` · ${esc(l.next_action)}` : ''}</p>
            <div class="row" style="gap:12px;flex-wrap:nowrap"><span id="dgrade">${gradeBadge(l.grade, l.score)}</span><h2 style="font-size:28px;margin:0;min-width:0">${esc(l.business)}</h2></div>
            <div class="dial-who" id="dwho"><span class="small muted">Speaking with</span>${whoHtml(whoIs(l))}</div>
            <div class="muted" style="margin-top:6px">${esc([l.industry || l.category, [l.city, l.state].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</div>
            ${(() => { const c = callCategory(l); return `<div class="dial-cat">${catChip(c)}<span>${esc(c.lead)}</span>${c.facts.length || c.tags.length ? `<small class="muted">${esc([...c.facts, ...c.tags.map((t) => t.label)].join(' · '))}</small>` : ''}</div>`; })()}
            <div class="row" style="margin:12px 0"><span class="badge">${l.tz_known ? `Their time: ${esc(l.local_time)}` : 'Time zone unknown: callable 11am to 8pm Eastern only'}</span>${l.sms_consent ? '<span class="badge">Agreed to texts</span>' : ''}${l.reviews != null ? `<span class="badge gray">${l.reviews} reviews${l.rating ? ` · ${l.rating}★` : ''}</span>` : ''}</div>
            <div class="dial-phone">${esc(l.phone || '')}</div>
            <div class="pd-live dial-infobox" style="padding:0;margin-top:10px">${contactRows(callInfo(l).filter((x) => ['Email', 'Owner', 'Website', 'Google'].includes(x.k)))}</div>
            <div class="row" style="margin-top:14px">
              ${dialOn() ? `<button class="btn btn-mint btn-xl" style="width:auto;flex:1 1 200px" id="dhub">${icon.phone}Call</button>` : ''}
              <a class="btn ${dialOn() ? 'btn-ghost' : 'btn-mint btn-xl'}" style="width:auto;${dialOn() ? '' : 'flex:1 1 200px'}" href="${telHref(l.phone)}" id="dtel">${dialOn() ? '' : icon.phone}Call from my phone</a>
            </div>
            ${me.twilio && !testMode ? `<div class="row" style="margin-top:10px;align-items:flex-end">${nums.numbers.length > 1 ? callerSelect(nums.numbers) : ''}<span id="pbadge" style="margin-bottom:10px">${testMode ? '' : phoneBadge()}</span></div>` : ''}
            <div class="row" data-sec="links" style="margin-top:12px">
              <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/${encodeURIComponent(`${l.industry || l.category || ''} ${l.city || ''} ${l.state || ''}`)}">Map pack</a>
              <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/${encodeURIComponent(`${l.business} ${l.city || ''}`)}">Their profile</a>
              ${l.website ? `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${esc(/^https?:/.test(l.website) ? l.website : `https://${l.website}`)}">Website</a>` : ''}
              <button class="btn btn-ghost btn-sm" id="dtext">Text</button>
              <button class="btn btn-ghost btn-sm" id="dopen">Full details</button>
            </div>
          </div>
          <div class="card dial-after">
            <div class="row" style="gap:8px"><button class="btn btn-ghost btn-sm" id="dskip">Skip for now</button><button class="btn btn-primary" id="dbook">Book appointment</button><button class="btn btn-ghost btn-sm" id="dlog" title="Called from your own phone? Log how it went here.">Log a result</button></div>
            <p class="small muted" style="margin:8px 0 0">The result opens in the call window when a call ends. Keys 1 to 9 pick it there.</p>
            ${l.notes ? fold('dold', 'Earlier notes', `<div class="caption">${esc(l.notes)}</div>`, false) : ''}
          </div>
        </div>
        <div class="card dial-prep" id="dprep"></div>
      </div>`}`;
    wireFolds(view);
    $$('[data-jump]', view).forEach((b) => b.addEventListener('click', () => { if (busyPhase()) return toast('Finish this call and save the result first.', true); idx = Number(b.dataset.jump); render(); }));
    // Customize layout: tick boxes change the page in place (no redraw), so the menu stays open while you choose.
    const applyLay = () => {
      view.dataset.hide = ['tiers', 'cats', 'upcoming', 'links', 'notes'].filter((k) => !lay[k]).join(' ');
      const g = $('.dial-grid', view);
      if (g) { g.classList.toggle('no-queue', !lay.queue); g.classList.toggle('no-prep', !lay.prep); g.classList.toggle('tight', Boolean(lay.compact)); }
    };
    const saveLay = () => { try { localStorage.setItem('rw-dial-layout', JSON.stringify(lay)); } catch { /* ignore */ } };
    const openLay = (on) => { layOpen = on; const b = $('#dlaybody', view); if (b) b.hidden = !on; $('#dlaybtn', view)?.setAttribute('aria-expanded', String(on)); };
    $('#dlaybtn', view)?.addEventListener('click', (e) => { e.stopPropagation(); openLay(!layOpen); });
    $$('[data-lay]', view).forEach((c) => c.addEventListener('change', () => { lay[c.dataset.lay] = c.checked; saveLay(); applyLay(); }));
    $('#dlayreset', view)?.addEventListener('click', () => { lay = { queue: true, prep: true, compact: false, tiers: true, cats: true, upcoming: true, notes: true, links: true }; saveLay(); applyLay(); $$('[data-lay]', view).forEach((c) => { c.checked = Boolean(lay[c.dataset.lay]); }); });
    $('#dgoal', view)?.addEventListener('click', (e) => editGoal(e.currentTarget, q.stats.goal || 60, (g) => { q.stats.goal = g; render(); }));
    applyLay();
    offDialHover?.();
    offDialHover = hoverCards(view, { selector: '[data-jump]', build: (el) => leadHover(q.queue[Number(el.dataset.jump)]) });
    $('#dauto', view)?.addEventListener('change', (e) => { auto = e.target.checked; try { localStorage.setItem('rw-dial-auto2', auto ? '1' : '0'); } catch { /* ignore */ } if (auto) { intelCache.delete(q.queue[idx]?.id); prefetch(q.queue[idx]); } });
    $('#dclear', view)?.addEventListener('click', () => { try { localStorage.removeItem(DIAL_KEY); } catch { /* ignore */ } dialerPage(app, user); });
    $$('[data-dq]', view).forEach((b) => b.addEventListener('click', () => { flt = { ...flt, data: b.dataset.dq }; try { localStorage.setItem(DIAL_KEY, JSON.stringify(flt)); } catch { /* ignore */ } dialerPage(app, user); }));
    $('#dcat', view)?.addEventListener('change', (e) => { flt = { ...flt, cat: e.target.value }; try { localStorage.setItem(DIAL_KEY, JSON.stringify(flt)); } catch { /* ignore */ } dialerPage(app, user); });
    $('#dtier', view)?.addEventListener('change', (e) => { flt = { ...flt, tier: e.target.value }; try { localStorage.setItem(DIAL_KEY, JSON.stringify(flt)); } catch { /* ignore */ } dialerPage(app, user); });
    $('#pdwh', view)?.addEventListener('change', (e) => setWait(e.target.value));
    $('#pdtest', view)?.addEventListener('click', () => {
      if (testMode) return dialerPage(app, user);
      if (phoneState().onCall) return toast('Finish your call first.', true);
      powerStop();
      startTest();
    });
    $('#pdtestx', view)?.addEventListener('click', () => { powerStop(); dialerPage(app, user); });
    $('#tsagain', view)?.addEventListener('click', () => startTest());
    $('#tsexit', view)?.addEventListener('click', () => { powerStop(); dialerPage(app, user); });
    $('#pdgo', view)?.addEventListener('click', () => { warmAudio(); if (!testMode && !power) holdMic(); if (!testMode) startPhone().catch(() => {}); power = !power; setPdx(); if (power) { trayRemove('powerdial'); pdStart = pdStart || Date.now(); powerStep(); } else powerStop(); $('#pdgo', view).textContent = power ? 'Power dialing...' : 'Start power dial'; });
    if (!l) return;
    showPrep();
    prefetch(l);
    prefetch(q.queue[idx + 1]);
    $('#dskip', view).addEventListener('click', () => { if (busyPhase()) return toast('Finish this call and save the result first.', true); idx++; render(); });
    $('#dlog', view)?.addEventListener('click', () => { if (busyPhase()) return toast('The result opens in the call window when the call ends.', true); const w = whoIs(l); dispositionModal({ title: l.business, person: w.known ? w.name : '', business: l.business, facts: callInfo(l).filter((x) => ['Phone', 'Email', 'Their time'].includes(x.k)), sub: 'Pick how it went. It moves the lead to the right next step.', answered: true, onSave: (r) => logOutcome(l, r.dispo, { note: r.note, when: r.callbackAt }) }); });
    $('#dopen', view).addEventListener('click', () => (testMode ? testLeadModal(l, testHist.get(l.id) || []) : leadModal(l.id, () => {})));
    $('#dtext', view).addEventListener('click', () => (testMode ? testText(l) : textModal(l, { rep: REP })));
    const bookedId = (DISP.find((d) => d.acts === 'booked') || { id: 'booked' }).id;
    $('#dbook', view).addEventListener('click', () => (testMode ? testBook(l) : bookModal(l, () => afterBooking(l, bookedId))));
    const callerVal = bindCaller(view);
    $('#dhub', view)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (phase === 'wrap' || phoneState().onCall) return toast('Finish this call and save the result first.', true);
      phase = 'calling';
      busy(btn, true);
      try {
        await placeCall({ test: testMode, outcome: l.test_outcome, onLive: () => { if (testMode) practiceModal({ persona: l.persona, lead: l, onScore: (n) => testScore.set(l.id, n), onFinish: () => { if (phoneState().onCall) hangUp(); } }); }, leadId: l.id, from: callerVal(), name: l.business, who: whoIs(l), cat: callCategory(l), info: callInfo(l),
          tools: { chips: callbackChips(l), strip: power ? powerStrip() : null, actions: [...(power && phoneNarrow() ? [['Script', () => document.body.classList.toggle('pdx-script')]] : []), ['Text them', () => (testMode ? testText(l) : textModal(l, { rep: REP }))], ['Book appointment', () => (testMode ? testBook(l) : bookModal(l, () => afterBooking(l, bookedId))), 'primary'], ['Full details', () => (testMode ? testLeadModal(l, testHist.get(l.id) || []) : leadModal(l.id, () => {}))]] },
          onEnd: ({ answered }) => {
            const dr = takeCallDraft();
            if (skipDispo === l.id) { skipDispo = null; phase = 'idle'; return; }
            // The same window turns into the result picker. The next call waits until it is saved.
            phase = 'wrap';
            openDispo(l, answered, dr);
            return 'keep';
          } });
      }
      catch (err) {
        phase = 'idle';
        toast(err.message, true);
        // Power dialing never stalls on one bad number (do not call, outside hours): skip it and keep going.
        if (power && !/already on a call/i.test(err.message) && q.queue[idx]?.id === l.id) { idx++; render(); return; }
      } finally { busy(btn, false); }
    });
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
    api('/api/scrub/tick', { method: 'POST' }).catch(() => {});
  };
  const rsTimer = setInterval(rsTick, 20e3);
  setTimeout(rsTick, 1500);
  // The result opens inside the call window itself (wrapUp). Skipping it parks the power dial on a small "Waiting for the result" box.
  const openDispo = (l, answered, dr) => {
    const w = whoIs(l);
    const powerLine = `<button type="button" class="cb-book" data-pbook>Book appointment</button>${power ? `<div class="row" style="justify-content:space-between;margin-top:8px"><span class="small muted">Next call starts ${pdWait} second${pdWait === 1 ? '' : 's'} after you save.</span><button type="button" class="cbp-stop" data-pstop>Stop dialing</button></div>` : ''}`;
    wrapUp({ title: l.business, person: w.known ? w.name : '', business: l.business, facts: callInfo(l).filter((x) => ['Phone', 'Email', 'Their time'].includes(x.k)), note: dr.note, callbackAt: dr.when,
      sub: answered ? 'Pick how it went. It moves the lead to the right next step.' : 'No one picked up? Pick the result.', answered, skipLabel: 'Later',
      foot: powerLine, footBind: (el) => {
        el.querySelector('[data-pbook]')?.addEventListener('click', () => (testMode ? testBook(l) : bookModal(l, () => { bookedDuring.add(l.id); toast('Booked. Pick the result and Save.'); })));
        el.querySelector('[data-pstop]')?.addEventListener('click', () => { powerStop(); toast('Dialing stopped.'); const r = el.querySelector('.row'); if (r) r.innerHTML = '<span class="small muted">Dialing stopped. Save the result to finish.</span>'; });
      },
      onSkip: () => { phase = 'idle'; if (power) holdPower(() => { phase = 'wrap'; openDispo(l, answered, dr); }); },
      onSave: async (r) => { await logOutcome(l, r.dispo, { note: r.note, when: r.callbackAt }); } }).catch(() => { phase = 'idle'; });
  };
  const afterBooking = (l, bookedId) => { bookedDuring.add(l.id); if (!busyPhase() && q.queue[idx]?.id === l.id) logOutcome(l, bookedId, {}, true); };
  // The strip inside the call window while power dialing: the wait between calls and a Stop.
  const powerStrip = () => ({
    html: () => `<span class="cbp-t"><b>Power dial</b> on</span><label class="cbp-w" title="The next call starts this long after you save the result">Next call in <select class="pd-wait" aria-label="Seconds before the next call">${waitOpts()}</select></label><button type="button" class="cbp-stop" data-pstop>Stop dialing</button>`,
    bind: (el) => {
      el.querySelector('select').addEventListener('change', (e) => setWait(e.target.value));
      el.querySelector('[data-pstop]').addEventListener('click', () => { powerStop(); toast('Dialing stopped. Finish this call and save the result.'); el.innerHTML = '<span class="cbp-t">Dialing stopped. Finish this call, then pick a result.</span>'; });
    },
  });
  // Save a result for lead l. Throws on failure so the result window stays open. Moves on to the next lead, and power dial's countdown starts from the redraw.
  const logOutcome = async (l, outcome, extra = {}, alreadyBooked = false) => {
    const note = (extra.note || '').trim(), when = extra.when || '';
    const advance = () => { phase = 'idle'; if (q.queue[idx]?.id === l.id) idx++; render(); };
    if (testMode) {
      const dd = dispoOf(outcome), acts = dd.acts;
      const talk = ['conversation', 'booked', 'callback', 'not_interested'].includes(acts);
      const booked = acts === 'booked';
      testLog.push({ id: l?.id, label: dd.label || outcome, talk, booked, score: testScore.get(l?.id) ?? null });
      testHit(l, `Result: ${dd.label || outcome}`);
      q.stats.dials++; if (talk) q.stats.talks++; if (booked) q.stats.booked++;
      toast(`Test result: ${dd.label || outcome}. Nothing was saved.`);
      return advance();
    }
    const acts = dispoOf(outcome).acts;
    const booked = alreadyBooked || bookedDuring.has(l.id);
    if (acts === 'callback' && !when) throw new Error('Pick the date and time first.');
    if (acts === 'booked' && !when && !booked) {
      // Needs the booking form first. Book it there, then press Save again.
      bookModal(l, () => { bookedDuring.add(l.id); toast('Booked. Press Save to finish.'); });
      throw new Error('Fill in the booking form that just opened, or add a time here, then press Save.');
    }
    if (!(booked && acts === 'booked') && !(acts === 'booked' && bookedDuring.has(l.id))) {
      const r = await api(`/api/leads/${l.id}/outcome`, { method: 'POST', body: { dispo: outcome, note, callbackAt: when || null } });
      if (r.calendar?.warning) toast(`Heads up: ${r.calendar.warning} Hand it to someone else on the lead.`, true);
    } else if (note) await api(`/api/leads/${l.id}/note`, { method: 'POST', body: { text: note } });
    bookedDuring.delete(l.id);
    q.stats.dials++;
    if (['conversation', 'booked', 'callback', 'not_interested'].includes(acts)) q.stats.talks++;
    if (acts === 'booked') { q.stats.booked++; toast('Audit booked'); }
    advance();
  };
  // Training, Warm up starts the pretend dialer straight away.
  let warm = false;
  try { warm = sessionStorage.getItem('rw-warmup') === '1'; sessionStorage.removeItem('rw-warmup'); } catch { /* ignore */ }
  if (warm) startTest(); else render();
}

// ---------- settings ----------
export async function settingsPage(app, user) {
  const view = staffShell(app, user, 'settings');
  let s, me, g;
  let team = [];
  try { [s, me, g, team] = await Promise.all([api('/api/settings'), api('/api/me'), api('/api/google/status').catch(() => null), api('/api/team').then((r) => r.users || []).catch(() => [])]); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const gmsg = new URLSearchParams(location.search).get('google');
  if (gmsg) { toast(gmsg === 'ok' ? 'Google connected' : gmsg, gmsg !== 'ok'); history.replaceState(null, '', `${location.pathname}${location.hash}`); }
  // Agents get their own settings only: their Google, their phone for the dialer, and the team calendar. The rest is for owners.
  if (user.role !== 'admin') {
    view.innerHTML = `<div class="page-head"><h1>Settings</h1></div>${settingsTabs('general', user)}
      <div class="card"><div class="card-head"><h2>Your Google</h2><span class="badge ${g?.connected ? '' : 'gray'}">${g?.connected ? 'Connected' : 'Not connected'}</span></div>
        <p>Connect your own Google account so your calendar, Gmail and Drive work inside the Hub, and invites for your calls come from your calendar. It's yours only: nobody else on the team can read it.</p>
        <a class="btn btn-primary" href="#/google">${g?.connected ? 'Open the Google page' : 'Connect my Google'}</a></div>
      <div class="card"><div class="card-head"><h2>Your phone for the dialer</h2></div>
        <form id="myphone" class="row"><input name="phone" value="${esc(me.user.phone || '')}" placeholder="Your mobile number" style="flex:1 1 220px"><button class="btn btn-primary" type="submit">Save</button></form></div>
      <div class="card" id="myavail"></div>
      <div class="card" id="teamcal"></div>
      <p class="small muted">Everything else in Settings is for owners.</p>`;
    $('#myphone', view).addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/api/me/phone', { method: 'PUT', body: { phone: e.target.phone.value } }); toast('Saved'); } catch (err) { toast(err.message, true); }
    });
    import('./teamcal.js').then((x) => x.teamCalCard($('#teamcal', view), user)).catch(() => {});
    import('./avail.js').then((x) => x.availCard($('#myavail', view))).catch(() => {});
    return;
  }
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
    ${isAdmin ? '<div class="card" id="setspend"></div><div class="card" id="setbal"></div><div class="card" id="setrs"></div>' : ''}
    <div id="stripesetup"></div>
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

    </div>
    <div class="card"><div class="card-head"><h2>Online booking</h2><span class="badge ${g?.connected && bk.ownerEmail ? '' : 'gray'}">${bk.ownerEmail ? `Google: ${esc(bk.ownerEmail)}` : 'Hub only'}</span></div>
      <p class="muted">Leads pick an open time in their own time zone. ${bk.ownerEmail ? `With Google connected the time comes off ${esc(bk.ownerEmail)}'s calendar and Google sends the invite with a Meet link.` : 'Connect Google on the Google page so each booking gets a Google Calendar invite with a Meet link. Until then the time is held in the Hub and the link below is used.'} The confirmation email and text go out right away (Automations). Each lead also has a personal booking link that fills in what we know.</p>
      <div class="copybox"><code>${esc(bookUrl)}</code><button class="btn btn-ghost btn-sm" data-copy="${esc(bookUrl)}">Copy</button><a class="btn btn-ghost btn-sm" href="/book.html" target="_blank" rel="noopener">Open</a></div>
      <form id="bkset" class="form-grid" style="margin-top:12px">
        <label class="field"><span>Meeting name</span><input name="title" value="${esc(bk.title || '')}"${isAdmin ? '' : ' disabled'}></label>
        <label class="field"><span>Length (minutes)</span><input name="minutes" type="number" min="15" max="120" value="${esc(bk.minutes ?? 30)}"${isAdmin ? '' : ' disabled'}></label>
        <label class="field"><span>First slot (hour, 24h)</span><input name="start" type="number" min="0" max="23" value="${esc(bk.startHour ?? 9)}"${isAdmin ? '' : ' disabled'}></label>
        <label class="field"><span>Last end time (hour, 24h)</span><input name="end" type="number" min="1" max="24" value="${esc(bk.endHour ?? 17)}"${isAdmin ? '' : ' disabled'}></label>
        <label class="field"><span>Days (0 Sun to 6 Sat)</span><input name="days" value="${esc((bk.weekdays || [1, 2, 3, 4, 5]).join(','))}"${isAdmin ? '' : ' disabled'}></label>
        <label class="field"><span>Buffer between (minutes)</span><input name="buffer" type="number" min="0" max="120" value="${esc(bk.buffer ?? 15)}"${isAdmin ? '' : ' disabled'}></label>
        <label class="field"><span>Minimum notice (hours)</span><input name="notice" type="number" min="0" max="168" value="${esc(bk.noticeHours ?? 4)}"${isAdmin ? '' : ' disabled'}></label>
        <label class="field"><span>How far ahead (days)</span><input name="window" type="number" min="1" max="60" value="${esc(bk.days ?? 14)}"${isAdmin ? '' : ' disabled'}></label>
        <label class="field"><span>Your time zone</span><input name="tz" value="${esc(bk.tz || 'America/New_York')}"${isAdmin ? '' : ' disabled'}></label>
        <label class="field"><span>Who takes online bookings</span><select name="rep"${isAdmin ? '' : ' disabled'}><option value="">Owners (nobody assigned)</option><option value="rr"${bk.rep === 'rr' ? ' selected' : ''}>Round robin (fewest upcoming)</option>${team.filter((u) => u.role === 'admin' || u.role === 'team').map((u) => `<option value="${esc(u.id)}"${bk.rep === u.id ? ' selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}</select></label>
        <label class="field span-all"><span>Meeting link when Google is not connected (Zoom or a Meet room; empty means you call them)</span><input name="link" placeholder="https://" value="${esc(bk.link || '')}"${isAdmin ? '' : ' disabled'}></label>
        ${isAdmin ? `<div class="span-all row end">${g?.connected ? '<label class="row small" style="gap:6px"><input type="checkbox" name="ownerSelf"> Book on my Google Calendar</label>' : ''}<button class="btn btn-primary" type="submit">Save booking settings</button></div>` : ''}
      </form></div>
    <div class="card" id="myavail"></div>
      <div class="card" id="teamcal"></div>
    <div class="card"><div class="card-head"><h2>Call script</h2></div>
      <p class="muted">The dialer and the presentation fill these in for each lead. One line per thing to say. Start a line with "Or:" for an alternative, and wrap coaching notes in (parentheses).</p>
      <p class="small mono">{first} {rep} {my_number} {business} {city} {industry} {keyword} {scan_line} {hook_impact} {opener_reason} {vm_scan} {rank} {top_name} {top_name_or_them} {top_reviews} {top3_of_points} {top10_of_points} {reviews} {rating} {price} {setup} {today_total} {services_list} {price_anchor} {drop_offer} {ticket} {breakeven} {breakeven_jobs} {problems} {slot1} {slot2} {email_or_phone} {email_or_ask}</p>
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
  if (isAdmin) import('./spend.js').then((m) => m.spendCard($('#setspend', view)));
  if (isAdmin) import('./balances.js').then((m) => m.balancesCard($('#setbal', view)));
  if (isAdmin) Promise.all([api('/api/research/status'), api('/api/lead-mode').catch(() => ({ mode: 'paid', sunbiz: true }))]).then(([r, lm]) => {
    const box = $('#setrs', view); if (!box) return;
    const free = lm.mode === 'free';
    box.innerHTML = `<div class="card-head"><h2>Lead data mode</h2><span class="small muted">${free ? 'Free: costs nothing' : 'Paid: Google data'}</span></div>
      <p class="small">Free mode turns off every paid lead call: Google Maps finder searches and automatic research (DataForSEO). You still get OpenStreetMap searches, the website read (services, areas, years, hours, team), emails, social pages and the state business registry: Florida owners and officers from Sunbiz, filing facts for CO, OR, CT, NY and PA, and a one click link to the official search for every other state. It has no Google ratings, reviews or map rank, so call categories that need them stay general.</p>
      <div class="row"><label class="row" style="gap:8px"><input type="radio" name="lmode" value="paid"${free ? '' : ' checked'}> Paid (best data)</label>
        <label class="row" style="gap:8px"><input type="radio" name="lmode" value="free"${free ? ' checked' : ''}> Free (no per lead cost)</label>
        <label class="row" style="gap:8px"><input type="checkbox" id="lmsb"${lm.sunbiz === false ? '' : ' checked'}> Look up the state business registry (Florida owners, 4 other states by API, the rest by link)</label>
        <button class="btn btn-ghost btn-sm" id="lmsave">Save</button></div>
      <hr style="margin:16px 0;border:0;border-top:1px solid var(--line)">
      <div class="card-head" style="padding:0"><h2>Lead research and scrubbing</h2><span class="small muted">${r.left} waiting · ${r.scrubbed} scrubbed</span></div>
      <p class="small">Researched leads are scored, graded and split into the dialer's quality queues. Bad and toll free numbers and businesses closed on Google are scrubbed out.</p>
      <p class="small">Automatic research is off until you switch it on in <b>Spending and background jobs</b> above, where its price per lead and daily limit are.</p>`;
    $('#lmsave', box).addEventListener('click', async () => {
      try { await api('/api/lead-mode', { method: 'PUT', body: { mode: box.querySelector('[name=lmode]:checked')?.value || 'paid', sunbiz: $('#lmsb', box).checked } }); toast('Saved'); settingsPage(app, user); } catch (e) { toast(e.message, true); }
    });
    api('/api/scrub/status').then((sc) => {
      const d = document.createElement('div');
      d.innerHTML = `<h3 style="margin-top:18px">Data scrubber</h3>
        <p class="small">Cleans business names (SEO stuffing, LLC, all caps), checks every number, reads each website for the owner's name, emails and social pages, and checks the emails take mail. Free. ${sc.scrubbed} scrubbed, ${sc.notYet} open leads not yet${sc.queued ? `, ${sc.queued} in the queue` : ''}.</p>
        <div class="row"><label class="row" style="gap:8px"><input type="checkbox" id="scauto"${sc.auto ? ' checked' : ''}> Scrub every new lead automatically</label>
          <label class="row" style="gap:8px"><input type="checkbox" id="sclook"${sc.lookup ? ' checked' : ''}${sc.twilio ? '' : ' disabled'}> Check mobile or landline (Twilio Lookup, about $0.008 a number)${sc.twilio ? '' : ' (needs Twilio)'}</label>
          <button class="btn btn-ghost btn-sm" id="scsave">Save</button>${sc.notYet ? `<button class="btn btn-ghost btn-sm" id="scall">Scrub all ${sc.notYet} open leads</button>` : ''}</div>`;
      box.appendChild(d);
      $('#scsave', d).addEventListener('click', async () => { try { await api('/api/scrub/settings', { method: 'PUT', body: { auto: $('#scauto', d).checked, lookup: $('#sclook', d).checked } }); toast('Saved'); } catch (e) { toast(e.message, true); } });
      $('#scall', d)?.addEventListener('click', async (e) => { try { const r = await api('/api/scrub/queue', { method: 'POST', body: { all: true } }); toast(`${r.queued} leads queued. They scrub in the background, faster while the dialer is open.`); e.target.remove(); } catch (err) { toast(err.message, true); } });
    }).catch(() => {});
  }).catch(() => {});
  stripeSetup($('#stripesetup', view), user);
  import('./teamcal.js').then((x) => x.teamCalCard($('#teamcal', view), user)).catch(() => {});
  import('./avail.js').then((x) => x.availCard($('#myavail', view))).catch(() => {});
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
