// Pipeline, "Do not call list" tab. Modeled on the suppression lists in Apollo.io, Outreach and Close (a list kept apart from the leads that
// every dialer, text and import checks) and the Do Not Contact lists in ZoomInfo and Outscraper. Server: src/suppress.js. Rules: public/js/suppress.js.
// Bad numbers, phone menus, dead leads and requests not to be called land here on their own when a call result is saved. The lead stays in the
// database for analytics; the list keeps it from being dialed, texted, or scraped and added a second time.
import { $, $$, esc, api, toast, modal, fmt } from './core.js';
import { staffShell, pipeTabs } from './staff.js';
import { donut, stackBars } from '../js/charts.js';
import { REASONS, MANUAL_REASONS, SOURCES, scanChunk, scanText } from '../js/suppress.js';

const ORDER = ['dnc', 'registry', 'dead', 'bad_number', 'phone_menu', 'deleted'];
const when = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const dayLabel = (k) => { const [, m, d] = k.split('-'); return `${Number(m)}/${Number(d)}`; };
const HELP = {
  dnc: 'Said not to call, or you marked Do not call. Blocks calls, texts and email. Stays on the list for good.',
  registry: 'Matched a do not call registry file you uploaded. Blocks calls, texts and email. Stays on the list for good.',
  dead: 'Not interested and never worth another call. Blocks calls and texts to every number we know for the business.',
  bad_number: 'Disconnected, wrong or unreachable. Blocks that number. The business stays known so it is not scraped again.',
  phone_menu: 'Only a phone menu answers. Blocks that number. A different direct number found later can still be called.',
  deleted: 'You deleted the lead. Blocks nothing, but the same business is not added a second time.',
};

// Small window used from the lead panel: pick a reason and a note, then the lead is moved and listed.
export function addModal({ leadId = null, business = '', phone = '' } = {}, onDone) {
  const m = modal(`<div class="card-head"><h2>Do not call list</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <p class="small muted" style="margin:0 0 10px">${esc(business || phone || 'This number')} stays in the database. It will not be dialed, texted or added again.</p>
    <label class="field"><span>Why</span><select id="sp-reason">${MANUAL_REASONS.map((r) => `<option value="${r}">${esc(REASONS[r].label)}</option>`).join('')}</select></label>
    <p class="small muted" id="sp-help" style="margin:6px 0 0"></p>
    ${leadId ? '' : `<label class="field"><span>Phone number</span><input id="sp-phone" type="tel" inputmode="tel" value="${esc(phone)}" placeholder="(305) 555 0100"></label>`}
    <label class="field"><span>Note (optional)</span><input id="sp-note" maxlength="200" placeholder="What they said"></label>
    <div class="row" style="margin-top:12px"><button class="btn btn-primary" id="sp-save">Add to the list</button></div>`);
  const help = () => { $('#sp-help', m.el).textContent = HELP[$('#sp-reason', m.el).value] || ''; };
  $('#sp-reason', m.el).addEventListener('change', help); help();
  $('#sp-save', m.el).addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await api('/api/suppress', { method: 'POST', body: { leadId, business, phone: $('#sp-phone', m.el)?.value || phone, reason: $('#sp-reason', m.el).value, note: $('#sp-note', m.el).value } });
      toast('Added to the do not call list');
      m.close(); onDone?.();
    } catch (err) { toast(err.message, true); e.target.disabled = false; }
  });
}

export async function suppressPage(app, user) {
  const view = staffShell(app, user, 'pipeline');
  const owner = user.role === 'admin';
  let reason = '', q = '', status = 'active', timer = null;
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">CRM</p><h1>Do not call list</h1></div></div>${pipeTabs('suppress')}<div class="skeleton"></div>`;
  let st;
  try { st = await api('/api/suppress/stats'); } catch (e) { $('.skeleton', view).outerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const reasons = ORDER.map((r) => ({ id: r, n: st.by[r] || 0 }));
  const segs = reasons.filter((r) => r.n).map((r) => ({ label: REASONS[r.id].short, value: r.n, color: REASONS[r.id].color }));
  const series = ORDER.filter((r) => st.by[r]).map((r) => ({ name: REASONS[r].short, color: REASONS[r].color, values: st.days.map((d) => st.per_day[d]?.[r] || 0) }));
  const reg = st.registry;
  const tile = (n, label, sub) => `<div class="ins-tile"><b class="mono">${n}</b><span class="stat-label">${label}</span><i class="small muted">${sub}</i></div>`;
  view.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">CRM</p><h1>Do not call list</h1><p class="small muted" style="margin:4px 0 0">Bad numbers, phone menus, dead leads and do not call requests. They stay in your database for analytics, but are never dialed, texted or scraped twice.</p></div>
      <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn btn-primary" id="sp-add">Add a number</button>${owner ? '<a class="btn btn-ghost" href="/api/suppress/export" download>Export CSV</a>' : ''}</div></div>
    ${pipeTabs('suppress')}
    <div class="ins-tiles">
      ${tile(fmt.int(st.total), 'On the list', `${fmt.int(st.blocking)} block calls and texts`)}
      ${tile(fmt.int(st.legal), 'Requests and registry matches', 'Permanent: asked not to be called, or on a registry')}
      ${tile(fmt.int(st.kept_out), 'Re-scrapes kept out', `${fmt.int(st.kept_out_recent)} entries blocked a repeat in the last 30 days`)}
      ${tile(reg.days == null ? 'Never' : reg.days === 0 ? 'Today' : `${reg.days}d`, 'Registry last checked', reg.stale ? 'Check again now. The FTC wants a scrub at least every 31 days.' : 'Inside the 31 day limit')}
    </div>
    <div class="grid-2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:14px;margin-bottom:14px">
      <div class="card"><h3 style="margin:0 0 8px">Why they are on it</h3>
        <div class="row" style="gap:16px;align-items:center;flex-wrap:wrap">${segs.length ? donut(segs, { center: fmt.int(st.total), sub: 'on the list' }) : '<p class="muted small">Nothing on the list yet. Results like Bad number, Phone menu, Dead lead and Do not call land here on their own.</p>'}
          <div class="small" style="display:grid;gap:6px;min-width:0">${reasons.map((r) => `<button type="button" class="sp-leg${reason === r.id ? ' on' : ''}" data-reason="${r.id}" title="${esc(HELP[r.id])}"><span><i style="background:${REASONS[r.id].color}"></i>${esc(REASONS[r.id].label)}</span><b class="mono">${fmt.int(r.n)}</b></button>`).join('')}</div></div>
        <p class="small muted" style="margin:8px 0 0">How it helps: a business marked dead stops costing dials, and the same business does not come back in the next scrape. How it can mislead: a bad number does not mean a bad business, so a different direct number can still be called.</p></div>
      <div class="card"><h3 style="margin:0 0 8px">Added in the last 30 days</h3>${series.length ? `<div class="bg-chart">${stackBars(st.days.map(dayLabel), series, { h: 190, pad: 28 })}</div>` : '<p class="muted small">Nothing added in the last 30 days.</p>'}
        ${Object.keys(st.reps).length ? `<p class="small muted" style="margin:8px 0 0">By person: ${Object.entries(st.reps).map(([n, c]) => `${esc(n)} ${c}`).join(', ')}</p>` : ''}</div>
    </div>
    ${owner ? `<div class="card" style="margin-bottom:14px" id="sp-sweep"><h3 style="margin:0 0 6px">Check every lead against this list</h3>
      <p class="small muted" style="margin:0 0 8px">One list for the whole company. This looks at every lead, including copies with another phone number or no ZIP, and puts any copy of a business on Do Not Call on Do Not Call too, so nobody can dial it. It also runs by itself once a day, and the moment a lead goes on the list. Free, no outside calls.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><button class="btn btn-primary" id="sp-sweepgo">Check now</button><span class="small" id="sp-sweepmsg"></span></div></div>` : ''}
    ${owner ? `<div class="card" style="margin-bottom:14px" id="sp-registry"><h3 style="margin:0 0 6px">Scrub against a do not call registry</h3>
      <p class="small muted" style="margin:0 0 8px">Business to business calls are mostly outside the federal registry, but owners of small shops often list a personal or cell number, and states add their own rules (Florida keeps its own list). Download your list from donotcall.gov (and your state's list), then choose the file here. The file is read in your browser and never uploaded: only the numbers that match your leads are sent. ${esc(reg.text)}.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end"><label class="field" style="flex:1 1 180px;margin:0"><span>Name of the list</span><input id="sp-label" value="National Do Not Call Registry" maxlength="60"></label>
        <input type="file" id="sp-file" accept=".txt,.csv,.tsv,.zip" multiple><button class="btn btn-primary" id="sp-scrub">Check my leads</button></div>
      <p class="small" id="sp-prog" style="margin:8px 0 0"></p>
      ${reg.log.length ? `<div class="small muted" style="margin-top:8px">${reg.log.map((x) => `${when(x.at)}: ${esc(x.label)}, ${fmt.int(x.matched)} matched of ${fmt.int(x.checked)} numbers checked${x.by ? ` (${esc(x.by)})` : ''}`).join('<br>')}</div>` : ''}</div>
      <div class="card" style="margin-bottom:14px"><h3 style="margin:0 0 6px">Which call results go on the list by themselves</h3>
        <p class="small muted" style="margin:0 0 8px">Do not call, Dead lead, Bad number and Phone menu are always on. Not interested normally recycles in 90 days. Switch this on if you want every Not interested to be a dead lead.</p>
        <label class="row small" style="gap:8px"><input type="checkbox" id="sp-opt"${st.optional.includes('not_interested') ? ' checked' : ''}> Put every "Not interested" result on the list too</label></div>` : ''}
    <div class="card"><div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <input id="sp-q" type="search" placeholder="Search business, phone or website" style="flex:1 1 220px" value="${esc(q)}">
      <select id="sp-status"><option value="active">On the list</option><option value="lifted">Taken off</option></select>
      ${reason ? `<button class="btn btn-ghost btn-sm" id="sp-clear">Showing ${esc(REASONS[reason].short)}. Show all</button>` : ''}</div>
      <div id="sp-rows"><div class="skeleton"></div></div><div id="sp-more" style="margin-top:10px"></div></div>`;

  const rowsHtml = (items) => (items.length ? `<div class="table-wrap"><table class="small"><thead><tr><th>Business</th><th>Phone</th><th>Why</th><th>Added</th><th>Kept out</th><th></th></tr></thead><tbody>
    ${items.map((i) => `<tr><td><b>${esc(i.business || '')}</b><div class="muted">${esc([i.city, i.state].filter(Boolean).join(', '))}${i.website ? ` · ${esc(i.website)}` : ''}</div></td><td class="mono">${esc(i.phone || '')}</td>
      <td><span class="badge" style="background:${REASONS[i.reason]?.color || 'var(--line)'};color:#fff">${esc(REASONS[i.reason]?.short || i.reason)}</span>${i.note ? `<div class="muted">${esc(i.note)}</div>` : ''}</td>
      <td>${esc(when(i.at))}<div class="muted">${esc(SOURCES[i.source] || '')}${i.by_name ? ` · ${esc(i.by_name)}` : ''}</div></td><td class="mono">${fmt.int(i.hits || 0)}</td>
      <td>${i.lifted_at ? `<span class="muted">Off ${esc(when(i.lifted_at))}</span>` : owner && !i.legal ? `<button class="btn btn-ghost btn-sm" data-lift="${esc(i.grp)}">Take off</button>` : i.legal ? '<span class="muted" title="A request not to be called stays for good">Permanent</span>' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Nothing here.</p>');
  let items = [], next = null;
  const load = async (more) => {
    const url = `/api/suppress?status=${status}${reason ? `&reason=${reason}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}${more && next ? `&before=${next}` : ''}`;
    try {
      const r = await api(url);
      items = more ? items.concat(r.items) : r.items; next = r.next;
      $('#sp-rows', view).innerHTML = rowsHtml(items);
      $('#sp-more', view).innerHTML = next ? '<button class="btn btn-ghost btn-sm" id="sp-next">Show more</button>' : '';
      $('#sp-next', view)?.addEventListener('click', () => load(true));
    } catch (e) { $('#sp-rows', view).innerHTML = `<p class="err-text">${esc(e.message)}</p>`; }
  };
  $('#sp-status', view).value = status;
  $('#sp-status', view).addEventListener('change', (e) => { status = e.target.value; load(); });
  $('#sp-q', view).addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { q = e.target.value.trim(); load(); }, 250); });
  $$('[data-reason]', view).forEach((b) => b.addEventListener('click', () => { reason = reason === b.dataset.reason ? '' : b.dataset.reason; suppressPage(app, user); }));
  $('#sp-clear', view)?.addEventListener('click', () => { reason = ''; suppressPage(app, user); });
  $('#sp-add', view).addEventListener('click', () => addModal({}, () => suppressPage(app, user)));
  view.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-lift]');
    if (!b || !confirm('Take this off the list? The business can be called, texted and scraped again.')) return;
    try { await api('/api/suppress/lift', { method: 'POST', body: { grp: b.dataset.lift } }); toast('Taken off the list'); suppressPage(app, user); } catch (err) { toast(err.message, true); }
  });
  $('#sp-opt', view)?.addEventListener('change', async (e) => {
    try { await api('/api/suppress/settings', { method: 'PUT', body: { optional: e.target.checked ? ['not_interested'] : [] } }); toast('Saved'); } catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; }
  });

  // Registry scrub: the file is read here, in chunks, and only numbers that match our leads are sent.
  $('#sp-sweepgo', view)?.addEventListener('click', async (e) => {
    const btn = e.currentTarget, msg = $('#sp-sweepmsg', view);
    btn.disabled = true;
    try {
      let after = '', scanned = 0, marked = 0;
      for (;;) {
        const r = await api('/api/suppress/sweep', { method: 'POST', body: { after } });
        scanned += r.scanned; marked += r.marked;
        msg.textContent = `Checked ${fmt.int(scanned)} leads, ${fmt.int(marked)} put on Do Not Call...`;
        if (!r.next) break;
        after = r.next;
      }
      msg.textContent = `Done. Checked ${fmt.int(scanned)} leads. ${marked ? `${fmt.int(marked)} copies of businesses on the list are now Do Not Call.` : 'No copies found, every lead is clean.'}`;
      if (marked) toast(`${marked} lead${marked === 1 ? '' : 's'} put on Do Not Call`);
    } catch (err) { msg.textContent = err.message; }
    btn.disabled = false;
  });
  $('#sp-scrub', view)?.addEventListener('click', async (e) => {
    const files = [...($('#sp-file', view).files || [])];
    const prog = $('#sp-prog', view);
    if (!files.length) { prog.textContent = 'Choose the file first.'; return; }
    e.target.disabled = true;
    try {
      prog.textContent = 'Loading your lead numbers...';
      const wanted = new Set((await api('/api/suppress/phones')).phones);
      const found = new Set();
      let bytes = 0; const total = files.reduce((a, f) => a + f.size, 0);
      for (const f of files) {
        if (/\.zip$/i.test(f.name)) throw new Error('Unzip the file first and choose the .txt or .csv inside.');
        const rd = f.stream().getReader(); const dec = new TextDecoder(); let carry = '';
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          bytes += value.length;
          carry = scanChunk(carry + dec.decode(value, { stream: true }), wanted, found);
          prog.textContent = `Reading ${Math.round((100 * bytes) / Math.max(1, total))}%. ${fmt.int(found.size)} matches so far.`;
        }
        for (const n of scanText(carry, wanted)) found.add(n);
      }
      const list = [...found]; let matched = 0;
      const label = $('#sp-label', view).value;
      for (let i = 0; i <= list.length; i += 5000) {
        const last = i + 5000 >= list.length;
        const r = await api('/api/suppress/registry', { method: 'POST', body: { label, phones: list.slice(i, i + 5000), checked: wanted.size, final: last, matchedTotal: list.length } });
        matched += r.matched;
        if (last) break;
      }
      toast(`${fmt.int(matched)} lead${matched === 1 ? '' : 's'} matched and moved to Do not call`);
      suppressPage(app, user);
    } catch (err) { prog.textContent = err.message; toast(err.message, true); e.target.disabled = false; }
  });
  load();
}
