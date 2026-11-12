// Social planner screens: the client's Social tab in the Hub. Calendar, board and list of posts, one editor with a caption per
// channel, media, a preview, AI captions and ideas, and private review links for the client. Nothing here posts anywhere by itself:
// until Meta approves our app, each post is copied or downloaded and then marked posted with its link.
import { $, $$, esc, api, toast, copy, modal, busy } from './core.js';
import { PLATFORMS, PLATFORM, STATUSES, STATUS, captionIssues, readyForReview, summary, byDay, dayKey, monthKey, monthLabel, shiftMonth } from '../js/social.js';
import { monthGrid, startOfDay } from '../js/calgrid.js';

const VIEWS = [['calendar', 'Calendar'], ['board', 'Board'], ['list', 'List']];
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* ignore */ } return null; };
const badge = (s) => `<span class="badge ${STATUS[s]?.tone === 'ok' ? '' : STATUS[s]?.tone || 'gray'}">${esc(STATUS[s]?.label || s)}</span>`;
const chans = (ids = []) => ids.map((i) => `<span class="sp-ch" title="${esc(PLATFORM[i]?.label || i)}">${esc(PLATFORM[i]?.short || i)}</span>`).join('');
const toInput = (ms) => { if (!ms) return ''; const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const fromInput = (v) => (v ? new Date(v).getTime() : null);
const when = (ms) => (ms ? new Date(ms).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No date');
const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export async function socialTab(el, c) {
  let d; let view = store('rw-social-view') || 'calendar'; let month = monthKey(Date.now());
  const f = { project: '', channel: '' };
  const load = async () => { d = await api(`/api/clients/${c.id}/social`); };
  const paint = () => {
    const projects = [...new Set(d.items.map((i) => i.project).filter(Boolean))].sort();
    let items = d.items;
    if (f.project) items = items.filter((i) => i.project === f.project);
    if (f.channel) items = items.filter((i) => i.channels.includes(f.channel));
    const s = summary(d.items);
    el.innerHTML = `
      <div class="card" id="spauto"></div>
      <div class="card">
        <div class="card-head"><h2>Social planner</h2>
          <div class="row" style="gap:8px"><button class="btn btn-ghost btn-sm" id="spideas">Get ideas</button><button class="btn btn-primary btn-sm" id="spnew">New post</button></div></div>
        <div class="sp-stats">${STATUSES.map((st) => `<span class="sp-stat"><b>${s[st.id]}</b> ${esc(st.label)}</span>`).join('')}</div>
        <div class="row sp-bar"><div class="seg">${VIEWS.map(([k, n]) => `<button class="${view === k ? 'is-on' : ''}" data-view="${k}">${n}</button>`).join('')}</div>
          <label class="field sp-f"><select id="spproj"><option value="">All projects</option>${projects.map((p) => `<option${f.project === p ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
          <label class="field sp-f"><select id="spch"><option value="">All channels</option>${PLATFORMS.map((p) => `<option value="${p.id}"${f.channel === p.id ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label></div>
        <div id="spbody"></div>
      </div>
      <div class="card" id="spshare"></div>
      <div class="card" id="spconn"></div>`;
    $$('[data-view]', el).forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; store('rw-social-view', view); paint(); }));
    $('#spproj', el).addEventListener('change', (e) => { f.project = e.target.value; paint(); });
    $('#spch', el).addEventListener('change', (e) => { f.channel = e.target.value; paint(); });
    $('#spnew', el).addEventListener('click', () => newPost());
    $('#spideas', el).addEventListener('click', ideasModal);
    const body = $('#spbody', el);
    if (view === 'calendar') calendar(body, items); else if (view === 'board') board(body, items); else list(body, items);
    $$('[data-open]', el).forEach((b) => b.addEventListener('click', () => open(b.dataset.open)));
    autoCard($('#spauto', el)); shareCard($('#spshare', el)); connCard($('#spconn', el));
  };
  const refresh = async () => { await load(); paint(); };
  const open = (id) => editor(c, d.items.find((i) => i.id === id), d.items, refresh);

  const card = (i) => `<article class="lead-card sp-card" draggable="true" data-id="${esc(i.id)}" data-open="${esc(i.id)}">
    <div class="item-title">${esc(i.title || 'Untitled post')}</div>
    <div class="row small" style="gap:6px;margin-top:6px">${chans(i.channels)}${i.scheduled_at ? `<span>${esc(when(i.scheduled_at))}</span>` : '<span class="muted">No date</span>'}${i.comments ? `<span class="badge gray">${i.comments} comment${i.comments === 1 ? '' : 's'}</span>` : ''}</div>
    ${i.project ? `<div class="small muted" style="margin-top:4px">${esc(i.project)}</div>` : ''}</article>`;

  function calendar(body, items) {
    const days = byDay(items);
    const cells = monthGrid(new Date(`${month}-01T12:00:00`).getTime());
    const today = dayKey(Date.now());
    const loose = items.filter((i) => !i.scheduled_at && i.status !== 'idea');
    const monthDays = cells.filter((x) => x.inMonth);
    body.innerHTML = `<div class="row sp-nav"><button class="btn btn-ghost btn-sm" id="spprev" aria-label="Previous month">&lsaquo;</button><b class="sp-month">${esc(monthLabel(month))}</b><button class="btn btn-ghost btn-sm" id="spnext" aria-label="Next month">&rsaquo;</button><button class="btn btn-ghost btn-sm" id="sptoday">Today</button></div>
      <div class="sp-cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((n) => `<div class="sp-dow">${n}</div>`).join('')}
        ${cells.map(({ day, inMonth }) => {
    const k = dayKey(day); const list = days.get(k) || [];
    return `<div class="sp-day${inMonth ? '' : ' out'}${k === today ? ' today' : ''}" data-day="${day}"><span class="sp-n">${new Date(day).getDate()}</span>
            ${list.map((i) => `<button type="button" class="sp-chip st-${esc(i.status)}" data-open="${esc(i.id)}" title="${esc(i.title)}">${chans(i.channels)} ${esc(i.title || 'Untitled post')}</button>`).join('')}</div>`;
  }).join('')}</div>
      <div class="sp-agenda">${monthDays.map(({ day }) => { const list = days.get(dayKey(day)) || []; return list.length ? `<div class="sp-aday"><b>${esc(new Date(day).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }))}</b>${list.map(card).join('')}</div>` : ''; }).join('') || '<p class="muted">Nothing planned this month.</p>'}</div>
      ${loose.length ? `<h3 style="margin:18px 0 8px">No date yet</h3><div class="sp-loose">${loose.map(card).join('')}</div>` : ''}`;
    $('#spprev', body).addEventListener('click', () => { month = shiftMonth(month, -1); paint(); });
    $('#spnext', body).addEventListener('click', () => { month = shiftMonth(month, 1); paint(); });
    $('#sptoday', body).addEventListener('click', () => { month = monthKey(Date.now()); paint(); });
    $$('.sp-day', body).forEach((cell) => cell.addEventListener('click', (e) => { if (e.target.closest('[data-open]')) return; const t = new Date(Number(cell.dataset.day)); t.setHours(10, 0, 0, 0); newPost(t.getTime()); }));
  }

  function board(body, items) {
    body.innerHTML = `<div class="board sp-board">${STATUSES.map((st) => { const list = items.filter((i) => i.status === st.id);
      return `<section class="col" data-stage="${esc(st.id)}"><header class="col-head"><b>${esc(st.label)}</b><span class="badge gray">${list.length}</span></header><div class="col-body">${list.map(card).join('')}</div></section>`; }).join('')}</div>
      <p class="small muted">Drag a post to another column to change its status.</p>`;
    let drag = null;
    $$('.sp-card', body).forEach((a) => { a.addEventListener('dragstart', () => { drag = a.dataset.id; a.classList.add('dragging'); }); a.addEventListener('dragend', () => { a.classList.remove('dragging'); }); });
    $$('.col', body).forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop-on'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop-on'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault(); col.classList.remove('drop-on');
        if (!drag) return;
        const it = d.items.find((x) => x.id === drag); drag = null;
        if (!it || it.status === col.dataset.stage) return;
        try { await api(`/api/social/${it.id}`, { method: 'PATCH', body: { status: col.dataset.stage } }); await refresh(); } catch (err) { toast(err.message, true); }
      });
    });
  }

  function list(body, items) {
    body.innerHTML = items.length ? `<ul class="list">${items.map((i) => `<li class="item sp-row" data-open="${esc(i.id)}" tabindex="0">${badge(i.status)}
      <div><div class="item-title">${esc(i.title || 'Untitled post')}</div><div class="item-sub">${esc(when(i.scheduled_at))}${i.project ? `, ${esc(i.project)}` : ''}</div><div class="row small" style="gap:6px;margin-top:4px">${chans(i.channels)}</div></div>
      <span class="small muted">Open</span></li>`).join('')}</ul>` : '<p class="muted">No posts match. Start with New post or Get ideas.</p>';
    $$('.sp-row', body).forEach((r) => r.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(r.dataset.open); }));
  }

  function newPost(at) {
    const defaults = ['facebook', 'instagram', 'google'];
    const m = modal(`<div class="card-head"><h2>New post</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
      <form id="spnf" class="form-grid" style="grid-template-columns:1fr">
        <label class="field"><span>Title (only for you and the client)</span><input name="title" required maxlength="160" placeholder="Before and after: tile roof in Miami" autofocus></label>
        <label class="field"><span>Date and time</span><input type="datetime-local" name="when" value="${esc(toInput(at))}"></label>
        <label class="field"><span>Project or campaign (optional)</span><input name="project" maxlength="80" list="spprojs" placeholder="November"><datalist id="spprojs">${[...new Set(d.items.map((i) => i.project).filter(Boolean))].map((p) => `<option value="${esc(p)}">`).join('')}</datalist></label>
        <div class="field"><span>Channels</span><div class="sp-chips">${PLATFORMS.map((p) => `<label class="sp-pick"><input type="checkbox" name="ch" value="${p.id}"${defaults.includes(p.id) ? ' checked' : ''}> ${esc(p.label)}</label>`).join('')}</div></div>
        <div class="row end" style="gap:8px"><button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Make the post</button></div></form>`);
    $('#spnf', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target); const btn = e.submitter; busy(btn, true);
      try {
        const r = await api(`/api/clients/${c.id}/social`, { method: 'POST', body: { title: fd.get('title'), project: fd.get('project'), scheduled_at: fromInput(fd.get('when')), channels: fd.getAll('ch') } });
        m.close(); await load(); paint(); open(r.item.id);
      } catch (err) { busy(btn, false); toast(err.message, true); }
    });
  }

  function ideasModal() {
    const m = modal(`<div class="card-head"><h2>Get post ideas</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
      <p class="small muted">Ideas come from ${esc(c.name)}'s services and cities. They land in the Idea column. Nothing is posted.</p>
      <form id="spif" class="form-grid" style="grid-template-columns:1fr">
        <label class="field"><span>How many</span><select name="count">${[4, 8, 12].map((n) => `<option${n === 8 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field"><span>Project (optional)</span><input name="project" maxlength="80" value="${esc(monthLabel(month).split(' ')[0])}"></label>
        <div class="row end" style="gap:8px"><button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Get ideas</button></div></form>`);
    $('#spif', m.el).addEventListener('submit', async (e) => {
      e.preventDefault(); const fd = new FormData(e.target); const btn = e.submitter; busy(btn, true);
      try {
        const r = await api(`/api/clients/${c.id}/social/ideas`, { method: 'POST', body: { count: Number(fd.get('count')), project: fd.get('project'), month: monthLabel(month) } });
        m.close(); toast(`${r.items.length} ideas added${r.ai ? '' : ' (templates, no Anthropic key yet)'}`); view = 'board'; store('rw-social-view', view); await refresh();
      } catch (err) { busy(btn, false); toast(err.message, true); }
    });
  }

  function shareCard(host) {
    host.innerHTML = `<div class="card-head"><h2>Client review links</h2><button class="btn btn-ghost btn-sm" id="spnl">New link</button></div>
      <p class="small muted">The client opens a link, sees every post marked With client, and approves or asks for changes. No login. Anyone with the link can open it, so send it only to them.</p>
      ${d.shares.length ? `<ul class="list">${d.shares.map((s) => `<li class="item"><div><div class="item-title">${esc(s.label || (s.project ? s.project : 'All posts'))}</div><div class="item-sub">${s.project ? `Project: ${esc(s.project)}. ` : ''}Opened ${s.views} time${s.views === 1 ? '' : 's'}${s.last_seen ? `, last ${esc(when(s.last_seen))}` : ''}</div></div>
        <div class="row" style="gap:6px"><button class="btn btn-ghost btn-sm" data-copy="${esc(s.token)}">Copy link</button><a class="btn btn-ghost btn-sm" href="/social.html#${esc(s.token)}" target="_blank" rel="noopener">Open</a><button class="btn btn-ghost btn-sm" data-revoke="${esc(s.token)}">Stop sharing</button></div></li>`).join('')}</ul>` : '<p class="muted">No links yet.</p>'}`;
    $('#spnl', host).addEventListener('click', async () => {
      const projects = [...new Set(d.items.map((i) => i.project).filter(Boolean))];
      const m = modal(`<div class="card-head"><h2>New review link</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
        <form id="spsf" class="form-grid" style="grid-template-columns:1fr"><label class="field"><span>Name (the client sees it)</span><input name="label" maxlength="80" placeholder="November posts"></label>
        <label class="field"><span>Show</span><select name="project"><option value="">Every post that is with the client</option>${projects.map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>
        <div class="row end" style="gap:8px"><button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Make the link</button></div></form>`);
      $('#spsf', m.el).addEventListener('submit', async (e) => {
        e.preventDefault(); const fd = new FormData(e.target); const btn = e.submitter; busy(btn, true);
        try { const r = await api(`/api/clients/${c.id}/social/shares`, { method: 'POST', body: { label: fd.get('label'), project: fd.get('project') } }); await copy(`${location.origin}${r.url}`, 'Link copied'); m.close(); await refresh(); }
        catch (err) { busy(btn, false); toast(err.message, true); }
      });
    });
    $$('[data-copy]', host).forEach((b) => b.addEventListener('click', () => copy(`${location.origin}/social.html#${b.dataset.copy}`, 'Link copied')));
    $$('[data-revoke]', host).forEach((b) => b.addEventListener('click', async () => { if (!confirm('Stop sharing this link? The client will no longer be able to open it.')) return; try { await api(`/api/social/shares/${b.dataset.revoke}`, { method: 'DELETE' }); await refresh(); } catch (e) { toast(e.message, true); } }));
  }

  // The autopilot card is built once too, so paging the calendar does not reload it.
  let autoHost = null;
  function autoCard(host) {
    if (!autoHost) {
      autoHost = document.createElement('div'); autoHost.className = 'card'; autoHost.id = 'spauto';
      import('./socialauto.js').then((m) => m.autopilotCard(autoHost, c, { onChange: refresh, open })).catch((e) => { autoHost.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; });
    }
    host.replaceWith(autoHost);
  }

  // Built once and put back on every redraw, so changing the month or filters does not ask Meta's status again.
  let connHost = null;
  function connCard(host) {
    if (!connHost) {
      connHost = document.createElement('div'); connHost.className = 'card'; connHost.id = 'spconn';
      import('./meta.js').then((m) => m.metaCard(connHost, c)).catch((e) => { connHost.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; });
    }
    host.replaceWith(connHost);
  }

  try { await load(); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  paint();
}

// ---------- the editor ----------
function editor(c, item, all, onChange) {
  if (!item) return;
  const it = JSON.parse(JSON.stringify(item));
  let tab = it.channels[0] || 'facebook';
  const m = modal(`<div class="sp-ed"><div class="card-head"><h2 id="sptitleh">${esc(it.title || 'Post')}</h2><div class="row" style="gap:8px">${badge(it.status)}<button class="btn btn-ghost btn-sm" data-close>Close</button></div></div><div id="spedit"></div></div>`);
  const host = $('#spedit', m.el);
  const issuesFor = (id) => captionIssues(id, it.captions[id]?.text, it.media);
  const collect = () => {
    it.title = $('#spt', host).value; it.project = $('#spp', host).value || null; it.notes = $('#spn', host).value || null;
    it.scheduled_at = fromInput($('#spw', host).value); it.status = $('#sps', host).value;
    it.channels = $$('[name=ch]:checked', host).map((x) => x.value);
    const cur = $('#spcap', host); if (cur) it.captions[tab] = { text: cur.value, first_comment: $('#spfc', host)?.value || '' };
  };
  const body = () => ({ title: it.title, project: it.project, notes: it.notes, scheduled_at: it.scheduled_at, channels: it.channels, captions: it.captions, status: it.status, post_links: it.post_links });
  const apply = (r) => { Object.assign(it, r.item); };
  const save = async (extra = {}, quiet = false) => {
    collect();
    const r = await api(`/api/social/${it.id}`, { method: 'PATCH', body: { ...body(), ...extra } });
    apply(r); if (!quiet) toast('Saved'); onChange(); return r;
  };
  const paintAll = () => {
    const ch = it.channels; if (!ch.includes(tab)) tab = ch[0] || '';
    const p = PLATFORM[tab]; const cap = it.captions[tab] || { text: '', first_comment: '' };
    const iss = tab ? issuesFor(tab) : [];
    host.innerHTML = `<div class="sp-grid">
      <div class="sp-left">
        <label class="field"><span>Title</span><input id="spt" maxlength="160" value="${esc(it.title)}"></label>
        <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap"><label class="field" style="flex:1 1 200px"><span>Date and time</span><input type="datetime-local" id="spw" value="${esc(toInput(it.scheduled_at))}"></label>
          <label class="field" style="flex:1 1 150px"><span>Status</span><select id="sps">${STATUSES.map((s) => `<option value="${s.id}"${it.status === s.id ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
          <label class="field" style="flex:1 1 150px"><span>Project</span><input id="spp" maxlength="80" value="${esc(it.project || '')}" list="spedp"><datalist id="spedp">${[...new Set(all.map((i) => i.project).filter(Boolean))].map((x) => `<option value="${esc(x)}">`).join('')}</datalist></label></div>
        <div class="field"><span>Channels</span><div class="sp-chips">${PLATFORMS.map((x) => `<label class="sp-pick"><input type="checkbox" name="ch" value="${x.id}"${ch.includes(x.id) ? ' checked' : ''}> ${esc(x.label)}</label>`).join('')}</div></div>
        <div class="field"><span>Photos and videos</span>
          <div class="sp-media">${it.media.map((x, i) => `<figure class="sp-m">${/^video\//.test(x.type) ? `<video src="/api/social/${esc(it.id)}/media/${i}" muted playsinline preload="metadata"></video>` : `<img src="/api/social/${esc(it.id)}/media/${i}" alt="">`}
            <figcaption><a href="/api/social/${esc(it.id)}/media/${i}?download=1">Download</a> <button type="button" class="linkbtn" data-rm="${i}">Remove</button></figcaption></figure>`).join('')}
            <label class="sp-add">+ Add<input type="file" id="spfile" accept="image/*,video/*" multiple hidden></label></div>
          <p class="small muted">Up to 10 files. Photos 10 MB, videos 50 MB.</p></div>
        <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" id="spai">Write captions with AI</button><span class="small muted">Fills empty channels. Your own captions stay.</span></div>
        ${ch.length ? `<div class="tabs sp-tabs">${ch.map((x) => `<button type="button" class="${x === tab ? 'is-on' : ''}" data-tab="${x}">${esc(PLATFORM[x].label)}${issuesFor(x).length ? ' <i class="sp-dot"></i>' : ''}</button>`).join('')}</div>
          <label class="field"><span>${esc(p.label)} caption</span><textarea id="spcap" rows="7" placeholder="Write the caption for ${esc(p.label)}">${esc(cap.text)}</textarea></label>
          <div class="row small" style="gap:10px;justify-content:space-between"><span id="spcount" class="${cap.text.length > p.max ? 'err-text' : 'muted'}">${cap.text.length} of ${p.max} characters</span><span class="row" style="gap:6px"><button type="button" class="btn btn-ghost btn-sm" id="spcopy">Copy caption</button><button type="button" class="btn btn-ghost btn-sm" id="spall">Use for every channel</button></span></div>
          <label class="field"><span>First comment (optional, for hashtags or a link)</span><textarea id="spfc" rows="2">${esc(cap.first_comment || '')}</textarea></label>
          <ul class="sp-iss" id="spiss">${iss.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">Pick at least one channel to write captions.</p>'}
        <label class="field"><span>Internal notes (the client never sees these)</span><textarea id="spn" rows="2">${esc(it.notes || '')}</textarea></label>
        <details class="sp-posted"${it.status === 'posted' || Object.keys(it.post_links || {}).length ? ' open' : ''}><summary>Posted? Paste the links</summary>
          ${ch.map((x) => `<label class="field"><span>${esc(PLATFORM[x].label)} link</span><input data-pl="${x}" value="${esc(it.post_links?.[x] || '')}" placeholder="https://"></label>`).join('') || '<p class="small muted">No channels picked.</p>'}</details>
        <div class="row sp-actions" style="gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" id="spsave">Save</button>
          ${['idea', 'draft', 'changes'].includes(it.status) ? '<button class="btn btn-mint" id="spsend">Send to client</button>' : ''}
          ${it.status === 'review' ? '<button class="btn btn-ghost" id="spokay">Mark approved</button>' : ''}
          ${['approved', 'scheduled'].includes(it.status) ? '<button class="btn btn-mint" id="spposted">Mark posted</button>' : ''}
          <button class="btn btn-ghost" id="spdup">Duplicate</button><button class="btn btn-ghost" id="spdel">Delete</button></div>
      </div>
      <div class="sp-right">
        <h3>Preview</h3><div id="sppv">${preview(tab, it, c)}</div>
        ${it.approved_by ? `<p class="small" style="margin-top:10px"><b>Approved by ${esc(it.approved_by)}</b></p>` : ''}
        <h3 style="margin-top:18px">Comments</h3><div id="spcm"><div class="skeleton"></div></div>
      </div></div>`;
    wire();
  };
  const wire = () => {
    $$('[data-tab]', host).forEach((b) => b.addEventListener('click', () => { collect(); tab = b.dataset.tab; paintAll(); }));
    $$('[name=ch]', host).forEach((b) => b.addEventListener('change', () => { collect(); paintAll(); }));
    const cap = $('#spcap', host);
    cap?.addEventListener('input', () => {
      const p = PLATFORM[tab]; it.captions[tab] = { text: cap.value, first_comment: $('#spfc', host).value };
      $('#spcount', host).textContent = `${cap.value.length} of ${p.max} characters`; $('#spcount', host).className = cap.value.length > p.max ? 'err-text' : 'muted';
      $('#spiss', host).innerHTML = issuesFor(tab).map((x) => `<li>${esc(x)}</li>`).join(''); $('#sppv', host).innerHTML = preview(tab, it, c);
    });
    $('#spcopy', host)?.addEventListener('click', () => copy(cap.value, 'Caption copied'));
    $('#spall', host)?.addEventListener('click', () => { collect(); const t = it.captions[tab]; for (const x of it.channels) if (x !== tab) it.captions[x] = { text: t.text, first_comment: t.first_comment }; toast('Copied to every channel. Check the limits.'); paintAll(); });
    $('#spt', host).addEventListener('input', (e) => { $('#sptitleh', m.el).textContent = e.target.value || 'Post'; });
    $('#spfile', host).addEventListener('change', async (e) => {
      const files = [...e.target.files]; if (!files.length) return; collect();
      const fd = new FormData(); files.forEach((x) => fd.append('file', x));
      try { await save({}, true); const r = await api(`/api/social/${it.id}/media`, { method: 'POST', form: fd }); apply(r); onChange(); paintAll(); } catch (err) { toast(err.message, true); }
    });
    $$('[data-rm]', host).forEach((b) => b.addEventListener('click', async () => { try { collect(); const r = await api(`/api/social/${it.id}/media/${b.dataset.rm}`, { method: 'DELETE' }); it.media = r.item.media; onChange(); paintAll(); } catch (err) { toast(err.message, true); } }));
    $('#spai', host).addEventListener('click', async (e) => {
      busy(e.currentTarget, true);
      try { await save({}, true); const r = await api(`/api/social/${it.id}/ai`, { method: 'POST', body: {} }); apply(r); onChange(); toast(r.ai ? 'Captions written' : `Captions filled from templates${r.error ? ` (${r.error})` : ''}`); paintAll(); }
      catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
    });
    $('#spsave', host).addEventListener('click', async (e) => { busy(e.currentTarget, true); try { await save(); } catch (err) { toast(err.message, true); } busy(e.currentTarget, false); paintAll(); });
    $('#spsend', host)?.addEventListener('click', async () => {
      collect(); const need = readyForReview(it);
      if (need.length && !confirm(`Not ready yet:\n${need.slice(0, 4).join('\n')}\n\nTry anyway?`)) return;
      try { await save({ status: 'review' }, true); toast('Sent. Share a review link so they can open it.'); paintAll(); } catch (err) { toast(err.message, true); }
    });
    $('#spokay', host)?.addEventListener('click', async () => { try { await save({ status: 'approved' }); paintAll(); } catch (err) { toast(err.message, true); } });
    $('#spposted', host)?.addEventListener('click', async () => {
      try { it.post_links = Object.fromEntries($$('[data-pl]', host).map((x) => [x.dataset.pl, x.value.trim()]).filter(([, v]) => v)); await save({ status: 'posted' }); paintAll(); } catch (err) { toast(err.message, true); }
    });
    $$('[data-pl]', host).forEach((x) => x.addEventListener('change', () => { it.post_links = Object.fromEntries($$('[data-pl]', host).map((y) => [y.dataset.pl, y.value.trim()]).filter(([, v]) => v)); }));
    $('#spdup', host).addEventListener('click', async () => { try { await api(`/api/social/${it.id}/duplicate`, { method: 'POST', body: {} }); toast('Copy made as a draft'); onChange(); m.close(); } catch (err) { toast(err.message, true); } });
    $('#spdel', host).addEventListener('click', async () => { if (!confirm('Delete this post and its files?')) return; try { await api(`/api/social/${it.id}`, { method: 'DELETE' }); onChange(); m.close(); toast('Deleted'); } catch (err) { toast(err.message, true); } });
    comments();
  };
  const comments = async () => {
    const box = $('#spcm', host); if (!box) return;
    try {
      const r = await api(`/api/social/${it.id}/comments`);
      box.innerHTML = `${r.comments.length ? r.comments.map((x) => `<div class="sp-cm ${x.kind}"><b>${esc(x.author)}</b> <span class="small muted">${esc(when(x.created_at))}</span><p>${esc(x.body).replace(/\n/g, '<br>')}</p></div>`).join('') : '<p class="small muted">No comments yet.</p>'}
        <form id="spcf" class="row" style="gap:6px"><input name="b" placeholder="Reply to the client" maxlength="2000" style="flex:1"><button class="btn btn-ghost btn-sm">Send</button></form>`;
      $('#spcf', box).addEventListener('submit', async (e) => { e.preventDefault(); const v = e.target.b.value.trim(); if (!v) return; try { await api(`/api/social/${it.id}/comments`, { method: 'POST', body: { body: v } }); comments(); } catch (err) { toast(err.message, true); } });
    } catch (err) { box.innerHTML = `<p class="err-text">${esc(err.message)}</p>`; }
  };
  paintAll();
}

// Our own feed mock-up. Looks like a post in a feed, not like any one app.
export function preview(platform, it, c) {
  const p = PLATFORM[platform];
  if (!p) return '<p class="muted small">Pick a channel to see a preview.</p>';
  const cap = it.captions?.[platform]?.text || '';
  const first = (it.media || [])[0];
  const url = first && it.id ? `/api/social/${it.id}/media/0` : '';
  const media = first ? (/^video\//.test(first.type) ? `<video src="${esc(url)}" controls playsinline preload="metadata"></video>` : `<img src="${esc(url)}" alt="">`) : (p.needsMedia ? '<div class="pv-none">Add a photo or video</div>' : '');
  return `<div class="pv pv-${esc(platform)}"><div class="pv-head"><span class="pv-av">${esc(initials(c.name))}</span><div><b>${esc(c.name)}</b><div class="small muted">${esc(p.label)}${it.scheduled_at ? ` · ${esc(when(it.scheduled_at))}` : ''}</div></div></div>${media}<div class="pv-cap">${esc(cap).replace(/\n/g, '<br>') || '<span class="muted">No caption yet</span>'}</div></div>`;
}
