// Client review page: /social.html#<token>. No login. The client sees the posts marked for them, can approve one, ask for changes or comment.
import { PLATFORM, dayKey, monthKey, monthLabel, shiftMonth, byDay } from '/js/social.js';
import { monthGrid } from '/js/calgrid.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const when = (ms) => (ms ? new Date(ms).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Date to be set');
const root = $('#sr');
const token = decodeURIComponent(location.hash.slice(1));
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* ignore */ } return null; };
const post = async (path, body) => {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Something went wrong (HTTP ${res.status}).`);
  return data;
};

let data; let view = 'list'; let month = monthKey(Date.now());
const tabs = {}; // item id -> channel
const GROUPS = [
  ['review', 'Waiting for you', 'Read each post, then approve it or tell us what to change.'],
  ['changes', 'Changes you asked for', 'We are working on these.'],
  ['approved', 'Approved', 'Ready to go out.'],
  ['scheduled', 'Scheduled', 'These go out on the date shown.'],
  ['posted', 'Posted', 'Already live.'],
];

function postCard(it) {
  const tab = tabs[it.id] && it.channels.includes(tabs[it.id]) ? tabs[it.id] : it.channels[0];
  const cap = it.captions?.[tab];
  const open = ['review', 'changes', 'approved'].includes(it.status);
  return `<article class="card sr-post" id="p-${esc(it.id)}">
    <div class="sr-top"><div><div class="item-title">${esc(it.title || 'Post')}</div><div class="item-sub">${esc(when(it.scheduled_at))}${it.project ? `, ${esc(it.project)}` : ''}</div></div>
      <span class="badge ${it.status === 'review' ? 'warn' : it.status === 'changes' ? 'bad' : ''}">${esc(data.statuses[it.status] || it.status)}</span></div>
    ${it.media.length ? `<div class="sr-media">${it.media.map((m) => (/^video\//.test(m.type) ? `<video src="${esc(m.url)}" controls playsinline preload="metadata"></video>` : `<a href="${esc(m.url)}" target="_blank" rel="noopener"><img src="${esc(m.url)}" alt="" loading="lazy"></a>`)).join('')}</div>` : ''}
    ${it.channels.length ? `<div class="sr-tabs" role="tablist">${it.channels.map((x) => `<button type="button" role="tab" class="${x === tab ? 'is-on' : ''}" data-tab="${esc(x)}" data-id="${esc(it.id)}">${esc(PLATFORM[x]?.label || x)}</button>`).join('')}</div>
      <div class="sr-cap">${cap?.text ? esc(cap.text) : '<span class="muted">No caption for this channel.</span>'}</div>
      ${cap?.first_comment ? `<div class="small muted">First comment: ${esc(cap.first_comment)}</div>` : ''}` : ''}
    ${it.approved_by ? `<p class="small"><b>Approved by ${esc(it.approved_by)}</b></p>` : ''}
    ${it.comments.length ? `<div class="sr-cms">${it.comments.map((c) => `<div class="sr-cm ${esc(c.kind)}"><b>${esc(c.author)}</b> <span class="small muted">${esc(when(c.created_at))}</span><p>${esc(c.body).replace(/\n/g, '<br>')}</p></div>`).join('')}</div>` : ''}
    <div class="sr-act">
      <label class="field"><span>${open ? 'Your note (needed when you ask for changes)' : 'Leave a comment'}</span><textarea rows="2" maxlength="2000" data-note="${esc(it.id)}" placeholder="${open ? 'What should we change?' : 'Write to us'}"></textarea></label>
      <div class="sr-btns">${it.status === 'review' || it.status === 'changes' ? `<button class="btn btn-primary" data-act="approve" data-id="${esc(it.id)}">Approve</button>` : ''}
        ${open ? `<button class="btn btn-ghost" data-act="changes" data-id="${esc(it.id)}">Ask for changes</button>` : ''}
        <button class="btn btn-ghost" data-act="comment" data-id="${esc(it.id)}">Send comment</button></div>
      <p class="err-text small" data-err="${esc(it.id)}" role="alert"></p>
    </div></article>`;
}

function calendar() {
  const days = byDay(data.items);
  const cells = monthGrid(new Date(`${month}-01T12:00:00`).getTime());
  return `<div class="card"><div class="row" style="justify-content:space-between;gap:8px;margin-bottom:10px"><button class="btn btn-ghost btn-sm" id="srprev" aria-label="Previous month">&lsaquo;</button><b>${esc(monthLabel(month))}</b><button class="btn btn-ghost btn-sm" id="srnext" aria-label="Next month">&rsaquo;</button></div>
    <div class="sr-cal">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((n) => `<div class="dow">${n}</div>`).join('')}${cells.map(({ day, inMonth }) => `<div class="d${inMonth ? '' : ' out'}"><span>${new Date(day).getDate()}</span>${(days.get(dayKey(day)) || []).map((i) => `<a href="#p-${esc(i.id)}" data-jump="${esc(i.id)}" title="${esc(i.title)}">${esc(i.title)}</a>`).join('')}</div>`).join('')}</div></div>`;
}

function paint() {
  const name = store('rw-social-name') || '';
  const needs = data.items.filter((i) => i.status === 'review').length;
  root.innerHTML = `<div class="sr-head"><span><img class="logo-light" src="/brand/rightway-logo-light.svg" alt="Rightway Growth"><img class="logo-dark" src="/brand/rightway-logo-dark.svg" alt="Rightway Growth"></span><span class="small muted">Private link. Please do not share it.</span></div>
    <section class="sr-hero"><div class="eyebrow">${esc(data.label || 'Social media posts')}</div><h1>${esc(data.business)}</h1>
      <p>${needs ? `${needs} post${needs === 1 ? ' is' : 's are'} waiting for you.` : 'Nothing is waiting for you right now.'}</p></section>
    <div class="card"><label class="field"><span>Your name (so we know who answered)</span><input id="srname" maxlength="80" value="${esc(name)}" autocomplete="name"></label>
      <div class="seg" style="margin-top:10px"><button class="${view === 'list' ? 'is-on' : ''}" data-view="list">List</button><button class="${view === 'cal' ? 'is-on' : ''}" data-view="cal">Calendar</button></div></div>
    ${view === 'cal' ? calendar() : ''}
    ${data.items.length ? GROUPS.map(([k, h, sub]) => { const list = data.items.filter((i) => i.status === k); return list.length ? `<section class="sr-sec"><h2>${esc(h)}</h2><p class="small muted">${esc(sub)}</p>${list.map(postCard).join('')}</section>` : ''; }).join('') : '<div class="card"><p>No posts to review yet. We will let you know when there are.</p></div>'}`;
  $('#srname').addEventListener('input', (e) => store('rw-social-name', e.target.value.trim()));
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; paint(); }));
  $('#srprev')?.addEventListener('click', () => { month = shiftMonth(month, -1); paint(); });
  $('#srnext')?.addEventListener('click', () => { month = shiftMonth(month, 1); paint(); });
  $$('[data-jump]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); $(`#p-${a.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { tabs[b.dataset.id] = b.dataset.tab; keep(() => paint()); }));
  $$('[data-act]').forEach((b) => b.addEventListener('click', () => act(b)));
}

// Redraw without losing what someone is typing or where they are on the page.
function keep(fn) {
  const y = scrollY; const notes = Object.fromEntries($$('[data-note]').map((t) => [t.dataset.note, t.value]));
  fn();
  $$('[data-note]').forEach((t) => { if (notes[t.dataset.note]) t.value = notes[t.dataset.note]; });
  scrollTo(0, y);
}

async function act(btn) {
  const id = btn.dataset.id; const kind = btn.dataset.act;
  const name = ($('#srname').value || '').trim(); const note = ($(`[data-note="${id}"]`).value || '').trim();
  const err = $(`[data-err="${id}"]`); err.textContent = '';
  if (!name) { err.textContent = 'Add your name at the top first.'; $('#srname').focus(); return; }
  if (kind === 'changes' && !note) { err.textContent = 'Tell us what to change.'; return; }
  if (kind === 'comment' && !note) { err.textContent = 'Write a comment first.'; return; }
  if (kind === 'approve' && !confirm('Approve this post as written?')) return;
  btn.disabled = true;
  try {
    const r = await post(`/api/public/social/${encodeURIComponent(token)}/items/${encodeURIComponent(id)}/${kind}`, { name, body: note });
    const i = data.items.findIndex((x) => x.id === id); if (i >= 0) data.items[i] = r.item;
    store('rw-social-name', name); keep(() => paint());
    const card = $(`#p-${id}`); card?.scrollIntoView({ block: 'nearest' });
  } catch (e) { err.textContent = e.message; btn.disabled = false; }
}

async function start() {
  if (!token) { root.innerHTML = '<div class="card"><p>This link is missing its code. Ask us for a new one.</p></div>'; return; }
  try {
    const res = await fetch(`/api/public/social/${encodeURIComponent(token)}`);
    data = await res.json();
    if (!res.ok) throw new Error(data.error || 'This review link is not valid any more.');
    document.title = `${data.business} posts`;
    paint();
  } catch (e) { root.innerHTML = `<div class="card"><h2>We could not open this</h2><p>${esc(e.message)}</p></div>`; }
}
window.addEventListener('hashchange', () => location.reload());
start();
