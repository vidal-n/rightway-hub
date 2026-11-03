// Slack page: each person's own Slack inside the Hub. Channels, client chats and direct messages with unread dots; messages,
// threads, reactions with the full emoji set (workspace emoji too), edit in place, pins, reminders, mark unread, forward, copy
// link; search and Activity (mentions and thread replies); browse, join, create and leave channels, add people, topic and
// description; members, pins and files; group messages; scheduled messages and drafts; status, away and pausing notifications;
// profiles; link previews; @ and # suggestions and a formatting bar while typing. Polls while open; Slack's events keep the
// dots current when it is closed. Huddles and calls are not open to other apps, so they stay in Slack.
import { $, $$, esc, api, toast, busy, modal, icon } from './core.js';
import { staffShell } from './staff.js';
import { refreshBadges } from './nav.js';
import { slackHtml, slackPlain, emojiHtml, EMOJI_CATS, setCustomEmoji, customEmoji, toSlack, toEditable as editable } from './slacktext.js';

export { slackHtml };

const S = {
  st: null, convs: [], me: null, people: {}, allPeople: null, open: null, view: null, panel: null, thread: null,
  msgs: [], cursor: null, more: false, at: null, newCount: 0, newFrom: null, loadingOlder: false, editing: false,
  timer: null, listTimer: null, sig: '', tsig: '', status: null, activity: 0, details: null,
};
const NOTICE = new Set(['channel_join', 'channel_leave', 'channel_topic', 'channel_purpose', 'channel_name', 'channel_archive', 'channel_unarchive', 'group_join', 'group_leave', 'group_topic', 'group_purpose', 'group_name', 'pinned_item', 'unpinned_item', 'bot_add', 'bot_remove']);
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { if (v == null || v === '') localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  keys(prefix) { try { return Object.keys(localStorage).filter((k) => k.startsWith(prefix)); } catch { return []; } },
};
const draftKey = (k) => `rw-sl-draft:${k}`;

const timeOf = (ts) => new Date(Number(ts) * 1000);
const clock = (ts) => timeOf(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dayOf = (ts) => timeOf(ts).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
const fullTime = (ts) => timeOf(ts).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const when = (sec) => {
  const d = new Date(sec * 1000);
  const today = new Date();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today at ${t}`;
  if (d.toDateString() === y.toDateString()) return `Yesterday at ${t}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })} at ${t}`;
};
const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');
const avatar = (p, name, cls = 'sl-av') => (p?.image ? `<img class="${cls}" src="${esc(p.image)}" alt="">` : `<span class="${cls}">${esc(initials(name))}</span>`);
const fileUrl = (u) => `/api/slack/me/file?u=${encodeURIComponent(u)}`;
const conv = (id) => S.convs.find((c) => c.id === id);
const chanNames = () => Object.fromEntries(S.convs.filter((c) => c.slackName).map((c) => [c.id, c.slackName]));
const html = (t) => slackHtml(t, S.people, chanNames());
const isUser = (id) => /^[UW][A-Z0-9]+$/.test(id || '');
const nowSec = () => Math.floor(Date.now() / 1000);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const convIcon = (c) => (c.kind === 'dm' ? avatar({ image: c.image }, c.name) : c.kind === 'client' ? `<span class="sl-hash">${icon.msg}</span>` : c.kind === 'group' ? `<span class="sl-hash sl-grp">${(c.name.split(',').length)}</span>` : `<span class="sl-hash">${c.kind === 'private' ? '🔒' : '#'}</span>`);
const convLabel = (c) => (c ? (c.kind === 'dm' || c.kind === 'group' ? c.name : c.kind === 'client' ? `${c.name} (client chat)` : `#${c.name}`) : 'a conversation');
const copy = async (text) => { try { await navigator.clipboard.writeText(text); return true; } catch { prompt('Copy this:', text); return false; } };
function setHash(h, push = true) { if (location.hash !== h) history[push ? 'pushState' : 'replaceState'](null, '', h); }
const at9 = (days) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(9, 0, 0, 0); return Math.floor(d / 1000); };
const nextMonday9 = () => { const d = new Date(); d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7)); d.setHours(9, 0, 0, 0); return Math.floor(d / 1000); };

function stopTimers() { clearInterval(S.timer); clearInterval(S.listTimer); }

export async function slackPage(app, user, channel = '', sub = '', subId = '') {
  const view = staffShell(app, user, 'slack');
  stopTimers();
  closeMenus();
  const msg = new URLSearchParams(location.search).get('slack');
  if (msg) { toast(msg === 'ok' ? 'Slack connected' : msg, msg !== 'ok'); history.replaceState(null, '', `${location.pathname}${location.hash}`); }
  let st;
  try { st = await api('/api/slack/me'); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  if (!st.connected) return connectView(view, st);
  S.st = st;
  view.classList.add('sl-main');
  view.innerHTML = `<div class="sl" id="sl">
    <aside class="sl-list">
      <div class="sl-list-head"><button class="sl-me" id="sl-me" type="button" aria-label="Your status and settings"><span id="sl-me-av">${avatar(null, user.name || 'You')}</span>
        <span class="sl-me-text"><b>${esc(st.team?.name || 'Slack')}</b><span class="small" id="sl-me-st">${esc(user.name || 'You')}</span></span></button>
        <button class="icon-btn" id="sl-new" title="New message" aria-label="New message">${icon.note}</button></div>
      ${st.missing?.length ? `<div class="sl-recon"><b>New Slack features are ready.</b> Reconnect your Slack to turn them on.<button class="btn btn-primary btn-sm" id="sl-recon" type="button">Reconnect</button></div>` : ''}
      <nav class="sl-nav">
        <a class="sl-conv" data-view="activity" href="#/slack/activity"><span class="sl-hash">${icon.bell}</span><span class="sl-name">Activity</span><b class="nbadge" id="sl-act-n" hidden></b></a>
        <a class="sl-conv" data-view="search" href="#/slack/search"><span class="sl-hash">${icon.search}</span><span class="sl-name">Search</span></a>
        <a class="sl-conv" data-view="scheduled" href="#/slack/scheduled"><span class="sl-hash">${icon.clock}</span><span class="sl-name">Drafts and scheduled</span></a>
        <a class="sl-conv" data-view="browse" href="#/slack/browse"><span class="sl-hash">${icon.hash}</span><span class="sl-name">Browse channels</span></a>
      </nav>
      <input class="sl-search" id="sl-find" placeholder="Jump to a conversation" aria-label="Jump to a conversation">
      <div id="sl-convs" class="sl-convs"><div class="skeleton"></div></div>
    </aside>
    <section class="sl-pane" id="sl-pane"><div class="sl-empty"><p class="muted">Pick a conversation.</p></div></section>
    <aside class="sl-thread" id="sl-thread" hidden></aside></div>`;
  $('#sl-new', view).addEventListener('click', () => newMessage());
  $('#sl-find', view).addEventListener('input', () => drawList());
  $('#sl-find', view).addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = $('#sl-convs a[data-c]'); if (a) { e.preventDefault(); openConv(a.dataset.c); e.target.value = ''; drawList(); } } });
  $('#sl-me', view).addEventListener('click', (e) => meMenu(e.currentTarget));
  $('#sl-recon', view)?.addEventListener('click', () => reconnect());
  $('.sl-list', view).addEventListener('click', (e) => {
    const a = e.target.closest('a[data-c], a[data-view]');
    if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); if (a.dataset.c) openConv(a.dataset.c); else VIEWS[a.dataset.view](); return; }
    const sec = e.target.closest('[data-sec]');
    if (sec) { const k = `rw-sl-hide:${sec.dataset.sec}`; store.set(k, store.get(k) ? null : 1); drawList(); }
  });
  api('/api/slack/me/emoji').then((r) => { setCustomEmoji(r.emoji); if (S.msgs.length) { S.sig = ''; draw({}); } }).catch(() => {});
  loadStatus();
  await loadConvs();
  if (channel === 'activity' || channel === 'search' || channel === 'browse' || channel === 'scheduled') VIEWS[channel]();
  else if (channel) openConv(channel, { thread: sub === 't' && /^\d+\.\d+$/.test(subId) ? subId : null, push: false });
  else if (window.innerWidth > 900 && S.convs[0]) openConv((S.convs.find((c) => c.unread) || S.convs.find((c) => c.kind === 'channel') || S.convs[0]).id, { push: false });
  S.listTimer = setInterval(async () => {
    if (!document.getElementById('sl')) return stopTimers();
    if (document.hidden) return;
    try {
      const { unreads, activity } = await api('/api/slack/me/unreads');
      S.convs.forEach((c) => { c.unread = c.id === S.open ? 0 : unreads[c.id]?.count || 0; c.mentions = c.id === S.open ? 0 : unreads[c.id]?.mentions || 0; });
      S.activity = activity || 0;
      drawList();
    } catch { /* ignore */ }
  }, 15e3);
  window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/slack')) { stopTimers(); closeMenus(); } }, { once: true });
}

function connectView(view, st) {
  const steps = st.admin && !st.ready ? `<h3>Owner setup (once)</h3>
    <ol class="steps small">
      <li>On the <a href="#/alerts">Alerts page</a>, connect the Slack app first (bot token and signing secret) if you have not.</li>
      <li>In the Slack app's page (api.slack.com/apps, Rightway Hub), open <b>App Manifest</b>, paste the new setup and save. <button class="linkish" id="sl-man" type="button">Copy the new setup</button> It adds what Slack inside the Hub needs.</li>
      <li>Open <b>Basic Information</b>, copy the <b>Client ID</b> and <b>Client Secret</b>, and paste them here.</li>
    </ol>
    <form id="sl-app" class="form-grid"><label class="field"><span>Client ID</span><input name="clientId" placeholder="1234567890.1234567890" autocomplete="off" required></label>
      <label class="field"><span>Client Secret</span><input name="clientSecret" type="password" autocomplete="off" required></label>
      <div class="span-all row end"><button class="btn btn-primary" type="submit">Save</button></div></form>` : '';
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Messages</p><h1>Slack</h1></div></div>
    <div class="card" style="max-width:720px"><h2>Your Slack, inside the Hub</h2>
      <p>Connect your own Slack account. You see your channels, client chats and direct messages, post as yourself, search, react, pin, set reminders and your status, send files, and share Hub items like a client, lead, task or report. Nobody else in the Hub can read your Slack.</p>
      ${st.ready ? '<a class="btn btn-primary btn-xl" href="/api/slack/oauth/start">Connect my Slack</a>' : st.admin ? '' : '<p class="badge warn">An owner has to finish the Slack setup first.</p>'}
      ${st.ready && st.admin ? `<details style="margin-top:14px"><summary class="small">Slack says "redirect_uri did not match" or "invalid permissions"?</summary>
        <p class="small">The Slack app needs the Hub's latest setup. At api.slack.com/apps, open Rightway Hub, then <b>App Manifest</b>, paste the new setup and save. <button class="linkish" id="sl-man2" type="button">Copy the new setup</button></p>
        <p class="small">Or add just the return address: <b>OAuth and Permissions</b>, Redirect URLs, Add New Redirect URL, paste this, Add, then <b>Save URLs</b>.</p>
        <div class="copybox"><code>${esc(`${location.origin}/api/slack/oauth/callback`)}</code><button class="btn btn-ghost btn-sm" type="button" id="sl-redir">Copy</button></div></details>` : ''}
      ${steps}</div>`;
  $('#sl-redir', view)?.addEventListener('click', () => copy(`${location.origin}/api/slack/oauth/callback`).then((ok) => ok && toast('Copied')));
  const man = async () => {
    const d = await api('/api/slack').catch(() => null);
    if (d?.manifest && await copy(JSON.stringify(d.manifest, null, 2))) toast('Setup copied. Paste it in App Manifest and save.');
  };
  $('#sl-man', view)?.addEventListener('click', man);
  $('#sl-man2', view)?.addEventListener('click', man);
  $('#sl-app', view)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); busy(btn, true);
    try { await api('/api/slack/app', { method: 'PUT', body: Object.fromEntries(new FormData(e.target).entries()) }); toast('Saved. Now connect your Slack.'); location.reload(); }
    catch (err) { toast(err.message, true); busy(btn, false); }
  });
}

function reconnect() {
  const admin = S.st?.admin;
  const m = modal(`<div class="card-head"><h2>Reconnect your Slack</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <p>This turns on search, Activity, pins, reminders, status, away, pausing notifications and workspace emoji.</p>
    ${admin ? `<ol class="steps small"><li>Copy the new setup: <button class="btn btn-ghost btn-sm" id="rc-copy" type="button">Copy the new setup</button></li>
      <li>At api.slack.com/apps, open <b>Rightway Hub</b>, then <b>App Manifest</b>. Paste it over what is there and click <b>Save Changes</b>. If Slack asks to reinstall the app, do it.</li>
      <li>Come back here and click Reconnect.</li></ol>`
    : '<p class="small muted">If Slack shows "invalid permissions", ask an owner to update the Slack app first, then try again.</p>'}
    <div class="row end"><a class="btn btn-primary" href="/api/slack/oauth/start">Reconnect</a></div>`);
  $('#rc-copy', m.el)?.addEventListener('click', async () => { const d = await api('/api/slack').catch(() => null); if (d?.manifest && await copy(JSON.stringify(d.manifest, null, 2))) toast('Copied. Paste it in App Manifest.'); });
}

// ---------- list ----------
async function loadConvs() {
  try { const r = await api('/api/slack/me/conversations'); S.convs = r.conversations; S.me = r.me; } catch (e) { $('#sl-convs').innerHTML = `<p class="err-text small">${esc(e.message)}</p>`; return; }
  api('/api/slack/me/unreads').then((r) => { S.activity = r.activity || 0; drawList(); }).catch(() => {});
  drawList();
}

function drawList() {
  const box = $('#sl-convs');
  if (!box) return;
  const actN = $('#sl-act-n');
  if (actN) { actN.hidden = !S.activity; actN.textContent = S.activity > 99 ? '99+' : S.activity; }
  $$('.sl-nav a').forEach((a) => a.classList.toggle('is-open', S.view === a.dataset.view));
  const q = ($('#sl-find')?.value || '').toLowerCase();
  const drafts = new Set(store.keys('rw-sl-draft:').map((k) => k.slice(12).split(':')[0]));
  const list = S.convs.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.slackName || '').toLowerCase().includes(q));
  const row = (c) => `<a class="sl-conv${c.id === S.open ? ' is-open' : ''}${c.unread ? ' is-unread' : ''}" href="#/slack/${esc(c.id)}" data-c="${esc(c.id)}">
    ${convIcon(c)}<span class="sl-name">${esc(c.name)}</span>${drafts.has(c.id) && c.id !== S.open ? `<span class="sl-draft" title="Draft">${icon.note}</span>` : ''}${c.unread ? `<b class="nbadge${c.mentions ? '' : ' soft'}">${c.unread > 99 ? '99+' : c.unread}</b>` : ''}</a>`;
  const sec = (key, title, items) => {
    if (!items.length) return '';
    const hidden = !q && store.get(`rw-sl-hide:${key}`);
    const shown = hidden ? items.filter((c) => c.unread || c.id === S.open) : items;
    return `<button class="sl-sec" type="button" data-sec="${key}" aria-expanded="${hidden ? 'false' : 'true'}"><span class="sl-caret${hidden ? ' shut' : ''}">${icon.chevron}</span>${title}</button>${shown.map(row).join('')}`;
  };
  const byName = (a, b) => (b.unread - a.unread) || a.name.localeCompare(b.name);
  box.innerHTML = sec('ch', 'Channels', list.filter((c) => c.kind === 'channel' || c.kind === 'private').sort(byName))
    + sec('cl', 'Clients', list.filter((c) => c.kind === 'client').sort(byName))
    + sec('dm', 'Direct messages', list.filter((c) => c.kind === 'dm' || c.kind === 'group').sort((a, b) => (b.unread - a.unread) || (b.updated - a.updated)))
    || '<p class="small muted" style="padding:8px 10px">No conversations match.</p>';
}

async function loadStatus() {
  try {
    S.status = await api('/api/slack/me/status');
    if (S.status.me) S.me = S.status.me;
    const av = $('#sl-me-av');
    if (av) av.innerHTML = `${avatar({ image: S.status.image }, S.status.name)}<i class="sl-dot${S.status.presence === 'active' && !S.status.away ? ' on' : ''}"></i>`;
    const line = $('#sl-me-st');
    if (line) line.innerHTML = `${S.status.status.emoji ? `${emojiHtml(S.status.status.emoji.replace(/:/g, ''))} ` : ''}${esc(S.status.status.text || S.status.name || 'You')}${S.status.snooze > nowSec() ? ' · paused' : ''}`;
  } catch { /* older connection without the scopes */ }
}

// ---------- menus and pickers ----------
function closeMenus() { $$('.sl-menu').forEach((m) => m.remove()); }
function place(el, anchor) {
  document.body.appendChild(el);
  if (window.innerWidth < 640) { el.classList.add('sheet'); return; }
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = Math.min(r.right - w, window.innerWidth - w - 8);
  if (left < 8) left = Math.min(r.left, window.innerWidth - w - 8);
  let top = r.bottom + 4;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${top}px`;
}
function dismissOn(el) {
  const off = (e) => { if (!el.isConnected) return cleanup(); if (e.type === 'keydown' ? e.key === 'Escape' : !el.contains(e.target)) { el.remove(); cleanup(); } };
  const cleanup = () => { document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', off, true); };
  setTimeout(() => { document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', off, true); }, 0);
}
// items: { label, icon, run, danger, hint, sub: [items] } | { sep: true } | { head: html } | false
function menu(anchor, items) {
  closeMenus();
  const el = document.createElement('div');
  el.className = 'sl-menu';
  el.setAttribute('role', 'menu');
  const render = (list, back) => {
    const L = list.filter(Boolean);
    el.innerHTML = (back ? `<button class="sl-mi" data-back type="button">‹ Back</button><hr>` : '') + L.map((it, i) => (it.sep ? '<hr>' : it.head ? `<div class="sl-mh">${it.head}</div>`
      : `<button class="sl-mi${it.danger ? ' danger' : ''}" data-i="${i}" type="button" role="menuitem">${it.icon || ''}<span>${esc(it.label)}</span>${it.hint ? `<span class="sl-mi-hint">${esc(it.hint)}</span>` : ''}${it.sub ? '<span class="sl-mi-hint">›</span>' : ''}</button>`)).join('');
    el.onclick = async (e) => {
      if (e.target.closest('[data-back]')) return render(back);
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const it = L[Number(b.dataset.i)];
      if (it.sub) return render(it.sub, list);
      el.remove();
      try { await it.run(); } catch (err) { toast(err.message, true); }
    };
  };
  render(items);
  place(el, anchor);
  dismissOn(el);
  return el;
}

function emojiNames() { return [...new Set([...EMOJI_CATS.flatMap((c) => c.items.map((x) => x[0])), ...Object.keys(customEmoji())])]; }
function emojiPicker(anchor, onPick) {
  closeMenus();
  const recent = store.get('rw-sl-recent', ['+1', 'white_check_mark', 'eyes', 'heart', 'joy', 'tada', 'pray', 'fire']);
  const custom = Object.keys(customEmoji()).sort();
  const cats = [{ name: 'Recent', icon: '🕘', items: recent }, ...EMOJI_CATS.map((c) => ({ name: c.name, icon: c.icon, items: c.items.map((x) => x[0]) })), ...(custom.length ? [{ name: 'Your workspace', icon: '⭐', items: custom }] : [])];
  const el = document.createElement('div');
  el.className = 'sl-menu sl-emo-pick';
  el.innerHTML = `<input class="sl-emo-q" placeholder="Search emoji" aria-label="Search emoji"><div class="sl-emo-tabs">${cats.map((c, i) => `<button type="button" data-cat="${i}" title="${esc(c.name)}">${c.icon}</button>`).join('')}</div><div class="sl-emo-grid"></div>`;
  const grid = $('.sl-emo-grid', el);
  const btn = (n) => `<button type="button" data-e="${esc(n)}" title=":${esc(n)}:">${emojiHtml(n)}</button>`;
  const draw = (q) => {
    if (q) { const hits = emojiNames().filter((n) => n.includes(q)).slice(0, 160); grid.innerHTML = hits.length ? `<div class="sl-emo-set">${hits.map(btn).join('')}</div>` : '<p class="small muted" style="padding:8px">No emoji found.</p>'; return; }
    grid.innerHTML = cats.map((c, i) => `<div class="sl-emo-h" id="emo-cat-${i}">${esc(c.name)}</div><div class="sl-emo-set">${c.items.map(btn).join('')}</div>`).join('');
  };
  draw('');
  el.addEventListener('input', (e) => draw(e.target.value.trim().toLowerCase().replace(/:/g, '')));
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-cat]');
    if (t) { $('.sl-emo-q', el).value = ''; draw(''); $(`#emo-cat-${t.dataset.cat}`, el)?.scrollIntoView({ block: 'start' }); return; }
    const b = e.target.closest('[data-e]');
    if (!b) return;
    const n = b.dataset.e;
    store.set('rw-sl-recent', [n, ...recent.filter((x) => x !== n)].slice(0, 24));
    el.remove();
    onPick(n);
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = $('[data-e]', grid); if (b) { e.preventDefault(); b.click(); } } });
  place(el, anchor);
  dismissOn(el);
  setTimeout(() => $('.sl-emo-q', el).focus(), 0);
}

async function allPeople() {
  if (S.allPeople) return S.allPeople;
  const r = await api('/api/slack/me/people');
  S.allPeople = r.people;
  r.people.forEach((p) => { S.people[p.id] = { ...(S.people[p.id] || {}), name: p.name, handle: p.handle, image: p.image }; });
  return S.allPeople;
}

// Chips for picking people (new message, new channel, add people).
function peoplePicker(root, { max = 30, exclude = [] } = {}) {
  root.innerHTML = '<div class="sl-chips"></div><input class="sl-pp-q" placeholder="Type a name" aria-label="Find a person"><ul class="list sl-pp-list"><li class="skeleton"></li></ul>';
  const picked = new Map();
  let ppl = [];
  const draw = () => {
    $('.sl-chips', root).innerHTML = [...picked.values()].map((p) => `<span class="sl-chip">${avatar(p, p.name)}${esc(p.name)}<button type="button" data-un="${esc(p.id)}" aria-label="Remove">×</button></span>`).join('');
    const q = $('.sl-pp-q', root).value.toLowerCase();
    $('.sl-pp-list', root).innerHTML = ppl.filter((p) => !picked.has(p.id) && !exclude.includes(p.id) && (!q || p.name.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q))).slice(0, 30)
      .map((p) => `<li class="item" data-u="${esc(p.id)}">${avatar(p, p.name)}<div><div class="item-title">${esc(p.name)}</div><div class="item-sub">@${esc(p.handle)}</div></div></li>`).join('') || '<li class="muted small">No one found.</li>';
  };
  allPeople().then((list) => { ppl = list.filter((p) => p.id !== S.me); draw(); }).catch((e) => { $('.sl-pp-list', root).innerHTML = `<li class="err-text">${esc(e.message)}</li>`; });
  root.addEventListener('input', draw);
  root.addEventListener('click', (e) => {
    const un = e.target.closest('[data-un]');
    if (un) { picked.delete(un.dataset.un); draw(); root.dispatchEvent(new Event('change')); return; }
    const li = e.target.closest('[data-u]');
    if (!li) return;
    if (picked.size >= max) return toast(`Up to ${max} people`, true);
    picked.set(li.dataset.u, ppl.find((p) => p.id === li.dataset.u));
    $('.sl-pp-q', root).value = '';
    draw();
    root.dispatchEvent(new Event('change'));
    $('.sl-pp-q', root).focus();
  });
  return { ids: () => [...picked.keys()], people: () => [...picked.values()], focus: () => $('.sl-pp-q', root).focus() };
}

// ---------- a conversation ----------
function leavePane(text = 'Pick a conversation.') {
  clearInterval(S.timer);
  S.open = null; S.thread = null; S.panel = null;
  const pane = $('#sl-pane');
  if (pane) pane.innerHTML = `<div class="sl-empty"><p class="muted">${esc(text)}</p></div>`;
  const side = $('#sl-thread');
  if (side) side.hidden = true;
  $('#sl')?.classList.remove('has-open');
}

async function openConv(id, { at = null, thread = null, push = true } = {}) {
  closeMenus();
  clearInterval(S.timer);
  S.view = 'conv'; S.open = id; S.thread = null; S.panel = null; S.sig = ''; S.msgs = []; S.cursor = null; S.more = false; S.at = at; S.editing = false;
  const c = conv(id) || { id, name: 'Conversation', kind: 'channel' };
  S.newCount = at ? 0 : c.unread || 0; S.newFrom = null;
  c.unread = 0; c.mentions = 0;
  setHash(`#/slack/${id}${thread ? `/t/${thread}` : ''}`, push);
  $('#sl')?.classList.add('has-open');
  drawList();
  $('#sl-thread').hidden = true;
  const canDetails = c.kind !== 'dm';
  $('#sl-pane').innerHTML = `<header class="sl-head"><button class="icon-btn sl-back" id="sl-back" aria-label="Back">${icon.back}</button>
      <button class="sl-title" id="sl-title" type="button">${c.kind === 'dm' ? avatar({ image: c.image }, c.name) : ''}<b>${c.kind === 'channel' ? '# ' : c.kind === 'private' ? '🔒 ' : ''}${esc(c.name)}</b>${icon.chevron}</button>
      <span class="small muted sl-topic">${esc(c.topic || '')}</span><span class="spacer"></span>
      ${c.kind === 'client' && c.clientId ? `<a class="btn btn-ghost btn-sm sl-hide-sm" href="#/client/${esc(c.clientId)}/chat">Client page</a>` : ''}
      <button class="icon-btn" id="sl-pins" title="Pinned" aria-label="Pinned messages">${icon.pin}</button>
      ${canDetails ? `<button class="icon-btn" id="sl-det" title="Details" aria-label="Details">${icon.info}</button>` : ''}</header>
    ${c.kind === 'client' ? '<div class="sl-clientnote small">The client sees everything in this conversation in their Rightway app. Keep internal talk in other channels.</div>' : ''}
    <div class="sl-jump small" id="sl-jump" hidden>You are looking at older messages. <button class="linkish" type="button" id="sl-latest">Jump to the latest</button></div>
    <div class="sl-msgs" id="sl-msgs"><div class="skeleton"></div></div>
    <div class="sl-sched small" id="sl-sched" hidden></div>
    ${composer('main', c.kind === 'dm' || c.kind === 'group' ? `Message ${c.name}` : c.kind === 'client' ? `Message ${c.name} (they will see it)` : `Message #${c.name}`)}`;
  $('#sl-back').addEventListener('click', () => { leavePane(); setHash('#/slack', false); drawList(); });
  $('#sl-title').addEventListener('click', () => (c.kind === 'dm' && c.user ? profileCard(c.user) : openDetails('about')));
  $('#sl-det')?.addEventListener('click', () => openDetails('about'));
  $('#sl-pins').addEventListener('click', () => openDetails('pins'));
  $('#sl-latest').addEventListener('click', () => { S.at = null; S.msgs = []; S.sig = ''; loadMsgs({ scroll: true }); });
  wireComposer($('#sl-pane'), () => ({ channel: id }), id, () => { if (S.at) { S.at = null; S.msgs = []; } S.sig = ''; loadMsgs({ scroll: true }); });
  const box = $('#sl-msgs');
  S.pin = true;
  box.addEventListener('scroll', () => {
    S.pin = box.scrollHeight - box.scrollTop - box.clientHeight < 100;
    if (box.scrollTop < 80 && S.more && !S.loadingOlder && !S.at) loadMsgs({ older: true });
  });
  new ResizeObserver(() => { if (S.pin && !S.at) box.scrollTop = box.scrollHeight; }).observe(box);
  wireMsgs(box, id, false);
  await loadMsgs({ scroll: true });
  loadScheduled(id);
  refreshBadges(true);
  S.timer = setInterval(() => {
    if (document.hidden || !document.getElementById('sl-msgs') || S.open !== id) return;
    if (!S.at) loadMsgs({});
    if (S.thread) loadThread();
  }, 5000);
  if (thread) openThread(id, thread, { push: false });
}

function mergeOlder(older, current) {
  const seen = new Set(current.map((m) => m.ts));
  return [...older.filter((m) => !seen.has(m.ts)), ...current];
}

async function loadMsgs({ scroll = false, older = false } = {}) {
  const id = S.open;
  if (!id) return;
  const q = new URLSearchParams({ channel: id });
  if (older) { if (!S.cursor) return; q.set('cursor', S.cursor); S.loadingOlder = true; }
  else if (S.at) q.set('latest', S.at);
  let r;
  try { r = await api(`/api/slack/me/history?${q}`); } catch (e) {
    S.loadingOlder = false;
    if (!S.msgs.length && $('#sl-msgs')) $('#sl-msgs').innerHTML = `<p class="err-text" style="padding:16px">${esc(e.message)}</p>`;
    return;
  }
  S.loadingOlder = false;
  if (id !== S.open) return;
  Object.assign(S.people, r.people);
  S.me = r.me || S.me;
  if (older) { S.msgs = mergeOlder(r.messages, S.msgs); S.cursor = r.cursor; S.more = r.more; }
  else if (!S.msgs.length || S.at) { S.msgs = r.messages; S.cursor = r.cursor; S.more = r.more; }
  else if (r.messages.length) {
    const min = Number(r.messages[0].ts);
    S.msgs = [...S.msgs.filter((m) => Number(m.ts) < min), ...r.messages];
  }
  if (S.newCount && !S.newFrom) {
    const real = S.msgs.filter((m) => !NOTICE.has(m.subtype));
    S.newFrom = real.length >= S.newCount ? real[real.length - S.newCount].ts : null;
    S.newCount = 0;
  }
  const jump = $('#sl-jump');
  if (jump) jump.hidden = !S.at;
  draw({ scroll, older });
}

function draw({ scroll = false, older = false }) {
  const box = $('#sl-msgs');
  if (!box || S.editing) return;
  const sig = JSON.stringify([S.more, S.at, S.newFrom, S.msgs.map((m) => [m.ts, m.text, m.reactions, m.replies, m.edited, m.pinned, m.files.length, m.attachments.length])]);
  if (sig === S.sig && !scroll) return;
  S.sig = sig;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 100;
  const oldH = box.scrollHeight, oldTop = box.scrollTop;
  const c = conv(S.open) || {};
  const head = S.more ? `<div class="sl-older"><button class="btn btn-ghost btn-sm" type="button" data-older>Load earlier messages</button></div>`
    : S.msgs.length && !S.at ? `<div class="sl-start"><b>${esc(c.kind === 'dm' || c.kind === 'group' ? c.name : `#${c.slackName || c.name}`)}</b><div class="small muted">This is the very beginning of the conversation.</div></div>` : '';
  box.innerHTML = head + (msgsHtml(S.msgs, { newFrom: S.newFrom, highlight: S.at }) || '<p class="muted small" style="padding:16px">No messages yet. Say hello.</p>');
  if (older) box.scrollTop = box.scrollHeight - oldH + oldTop;
  else if (S.at) $('.sl-msg.is-hl', box)?.scrollIntoView({ block: 'center' });
  else if (scroll || atBottom) { box.scrollTop = box.scrollHeight; S.pin = true; }
  // Pictures load after the text; stay at the newest message while they do.
  $$('img', box).forEach((img) => { if (!img.complete) img.addEventListener('load', () => { if (S.pin && !S.at) box.scrollTop = box.scrollHeight; }, { once: true }); });
}

function attachmentsHtml(list) {
  return (list || []).map((a) => {
    const color = /^#?[0-9a-f]{6}$/i.test(a.color || '') ? `#${a.color.replace('#', '')}` : '';
    const link = /^https?:\/\//.test(a.link || '') ? a.link : null;
    return `<div class="sl-att"${color ? ` style="border-left-color:${color}"` : ''}>
      ${a.service ? `<div class="small muted sl-att-svc">${/^https:\/\//.test(a.icon || '') ? `<img src="${esc(a.icon)}" alt="" loading="lazy">` : ''}${esc(a.service)}</div>` : ''}
      ${a.title ? (link ? `<a class="sl-att-title" href="${esc(link)}" target="_blank" rel="noopener">${esc(a.title)}</a>` : `<b>${esc(a.title)}</b>`) : ''}
      ${a.text ? `<div class="sl-att-text">${html(a.text)}</div>` : ''}
      ${/^https:\/\//.test(a.image || '') ? `<img class="sl-att-img" src="${esc(a.image)}" alt="" loading="lazy">` : ''}
      ${a.footer ? `<div class="small muted">${esc(a.footer)}</div>` : ''}</div>`;
  }).join('');
}
function filesHtml(files) {
  return (files || []).map((f) => (f.thumb && /^image\//.test(f.mimetype) ? `<a href="${esc(fileUrl(f.url || f.thumb))}" target="_blank" rel="noopener"><img class="sl-img" src="${esc(fileUrl(f.thumb))}" alt="${esc(f.name)}" loading="lazy"></a>`
    : `<a class="sl-file" href="${esc(f.url ? fileUrl(f.url) : f.permalink || '#')}" target="_blank" rel="noopener">${icon.clip}<span>${esc(f.name)}</span>${f.size ? `<span class="small muted">${f.size > 1e6 ? `${(f.size / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1e3))} KB`}</span>` : ''}</a>`)).join('');
}
function reactionsHtml(list) {
  if (!list.length) return '';
  return `<div class="sl-reacts">${list.map((x) => {
    const on = x.users.includes(S.me);
    const who = x.users.map((u) => (u === S.me ? 'You' : S.people[u]?.name || 'Someone')).slice(0, 8).join(', ');
    return `<button type="button" class="sl-react${on ? ' mine' : ''}" data-react="${esc(x.name)}" data-on="${on ? 1 : 0}" title="${esc(`${who} reacted with :${x.name}:`)}">${emojiHtml(x.name)} ${x.count}</button>`;
  }).join('')}<button type="button" class="sl-react sl-react-add" data-pick title="Add a reaction" aria-label="Add a reaction">${icon.smile}</button></div>`;
}

function msgsHtml(msgs, opt = {}) {
  let lastKey = null, lastTs = 0, lastDay = '';
  return msgs.map((m) => {
    const d = dayOf(m.ts);
    const sep = d !== lastDay ? `<div class="sl-day"><span>${esc(d)}</span></div>` : '';
    const newLine = opt.newFrom && m.ts === opt.newFrom ? '<div class="sl-new"><span>New</span></div>' : '';
    if (NOTICE.has(m.subtype)) { lastKey = null; lastDay = d; return `${sep}${newLine}<div class="sl-note small muted" data-ts="${esc(m.ts)}">${html(m.text)}</div>`; }
    const userId = isUser(m.user) && !m.botName ? m.user : null;
    const p = userId ? S.people[m.user] || {} : { image: m.botImage };
    const name = userId ? (p.name || 'Someone') : (m.botName || S.people[m.user]?.name || 'App');
    const key = `${m.user}|${m.botName || ''}`;
    const compact = !newLine && !sep && key === lastKey && Number(m.ts) - lastTs < 300;
    lastKey = key; lastTs = Number(m.ts); lastDay = d;
    const thread = !opt.inThread && m.replies ? `<button type="button" class="sl-replies" data-thread="${esc(m.ts)}">${(m.replyUsers || []).map((u) => avatar(S.people[u], S.people[u]?.name || '?', 'sl-av sl-av-xs')).join('')}<b>${plural(m.replies, 'reply', 'replies')}</b>${m.lastReply ? `<span class="small muted">Last reply ${esc(when(Number(m.lastReply)))}</span>` : ''}</button>` : '';
    return `${sep}${newLine}<div class="sl-msg${compact ? ' compact' : ''}${opt.highlight === m.ts ? ' is-hl' : ''}${m.pinned ? ' is-pinned' : ''}" data-ts="${esc(m.ts)}">
      ${compact ? `<span class="sl-time-c" title="${esc(fullTime(m.ts))}">${clock(m.ts)}</span>` : userId ? `<button type="button" class="sl-avbtn" data-profile="${esc(userId)}" aria-label="${esc(name)}">${avatar(p, name)}</button>` : avatar(p, name)}
      <div class="sl-body">${m.pinned ? `<div class="sl-pinned small">${icon.pin}Pinned</div>` : ''}
        ${compact ? '' : `<div class="sl-meta">${userId ? `<button type="button" class="sl-who" data-profile="${esc(userId)}">${esc(name)}</button>` : `<b>${esc(name)}</b> <span class="sl-app">App</span>`} <span class="small muted" title="${esc(fullTime(m.ts))}">${clock(m.ts)}</span></div>`}
        ${m.text ? `<div class="sl-text">${html(m.text)}${m.edited ? ' <span class="small muted">(edited)</span>' : ''}</div>` : ''}
        ${attachmentsHtml(m.attachments)}${filesHtml(m.files)}${reactionsHtml(m.reactions)}${thread}
      </div>
      <div class="sl-tools"><button type="button" class="icon-btn" data-pick title="Add a reaction" aria-label="Add a reaction">${icon.smile}</button>${opt.inThread ? '' : `<button type="button" class="icon-btn" data-thread="${esc(m.ts)}" title="Reply in thread" aria-label="Reply in thread">${icon.reply}</button>`}
        <button type="button" class="icon-btn sl-hide-sm" data-fwd title="Forward" aria-label="Forward">${icon.fwd}</button><button type="button" class="icon-btn" data-more title="More" aria-label="More actions">${icon.dots}</button></div></div>`;
  }).join('');
}

function msgFrom(box, el) {
  const ts = el.closest('[data-ts]')?.dataset.ts;
  const list = box.id === 'sl-tmsgs' ? S.tmsgs || [] : S.msgs;
  return list.find((m) => m.ts === ts) || (S.details?.pins || []).find((m) => m.ts === ts) || null;
}
const refreshView = (inThread) => { S.sig = ''; S.tsig = ''; return inThread && S.thread ? loadThread() : loadMsgs({}); };

function wireMsgs(box, channel, inThread) {
  box.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.sl-msg');
    if (!row || e.target.closest('a, img, textarea')) return;
    const m = msgFrom(box, row);
    if (!m) return;
    e.preventDefault();
    msgMenu(row.querySelector('[data-more]') || row, m, channel, inThread, box);
  });
  box.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-profile],[data-react],[data-pick],[data-thread],[data-fwd],[data-more],[data-older],a.sl-mention[href^="#/slack/"]');
    if (!el) {
      const row = e.target.closest('.sl-msg');
      if (row && !e.target.closest('a, button, textarea, img')) { $$('.sl-msg.is-tap', box).forEach((x) => x !== row && x.classList.remove('is-tap')); row.classList.toggle('is-tap'); }
      return;
    }
    if (el.matches('a.sl-mention')) { e.preventDefault(); return openConv(el.getAttribute('href').split('/')[2]); }
    if (el.dataset.older != null) return loadMsgs({ older: true });
    if (el.dataset.profile) return profileCard(el.dataset.profile);
    const m = msgFrom(box, el);
    if (!m) return;
    try {
      if (el.dataset.react) { await api('/api/slack/me/react', { method: 'POST', body: { channel, ts: m.ts, name: el.dataset.react, remove: el.dataset.on === '1' } }); return refreshView(inThread); }
      if (el.dataset.pick != null) return emojiPicker(el, async (name) => { try { await api('/api/slack/me/react', { method: 'POST', body: { channel, ts: m.ts, name } }); refreshView(inThread); } catch (err) { toast(err.message, true); } });
      if (el.dataset.thread) return openThread(channel, el.dataset.thread);
      if (el.dataset.fwd != null) return forwardMsg(channel, m.ts);
      if (el.dataset.more != null) return msgMenu(el, m, channel, inThread, box);
    } catch (err) { toast(err.message, true); }
  });
}

function remindTimes() {
  return [['In 20 minutes', nowSec() + 1200], ['In 1 hour', nowSec() + 3600], ['In 3 hours', nowSec() + 10800], ['Tomorrow at 9 AM', at9(1)], ['Next Monday at 9 AM', nextMonday9()]];
}

function msgMenu(anchor, m, channel, inThread, box) {
  const mine = m.user && m.user === S.me && !m.botName;
  menu(anchor, [
    inThread ? false : { label: 'Reply in thread', icon: icon.reply, run: () => openThread(channel, m.ts) },
    { label: 'Copy link', icon: icon.chain, run: async () => { const { link } = await api(`/api/slack/me/permalink?channel=${encodeURIComponent(channel)}&ts=${encodeURIComponent(m.ts)}`); if (await copy(link)) toast('Link copied'); } },
    m.text ? { label: 'Copy text', icon: icon.copy, run: async () => { if (await copy(slackPlain(m.text, S.people))) toast('Copied'); } } : false,
    { label: m.pinned ? 'Unpin from the conversation' : 'Pin to the conversation', icon: icon.pin, run: async () => { await api('/api/slack/me/pin', { method: 'POST', body: { channel, ts: m.ts, remove: m.pinned } }); toast(m.pinned ? 'Unpinned' : 'Pinned'); refreshView(inThread); if (S.panel === 'details') openDetails(S.detailsTab || 'pins'); } },
    { label: 'Remind me about this', icon: icon.clock, sub: remindTimes().map(([label, time]) => ({ label, run: async () => { await api('/api/slack/me/remind', { method: 'POST', body: { channel, ts: m.ts, time } }); toast(`Slackbot will remind you ${label.toLowerCase()}`); } })) },
    inThread ? false : { label: 'Mark unread from here', icon: icon.bell, run: () => markUnread(channel, m.ts) },
    { label: 'Forward', icon: icon.fwd, run: () => forwardMsg(channel, m.ts) },
    mine ? { sep: true } : false,
    mine ? { label: 'Edit message', icon: icon.note, run: () => inlineEdit(box, m, channel, inThread) } : false,
    mine ? { label: 'Delete message', icon: icon.trash, danger: true, run: async () => { if (!confirm('Delete this message for everyone?')) return; await api('/api/slack/me/edit', { method: 'POST', body: { channel, ts: m.ts, remove: true } }); refreshView(inThread); } } : false,
  ]);
}

async function markUnread(channel, ts) {
  const idx = S.msgs.findIndex((m) => m.ts === ts);
  const count = Math.max(1, S.msgs.slice(Math.max(0, idx)).filter((m) => !NOTICE.has(m.subtype)).length);
  await api('/api/slack/me/unread', { method: 'POST', body: { channel, ts, count } });
  const c = conv(channel);
  if (c) c.unread = count;
  leavePane('Marked as unread.');
  setHash('#/slack', false);
  drawList();
  refreshBadges(true);
}

// Slack text to something you can edit (names instead of ids); toSlack turns it back.
const toEditable = (text, map) => editable(text, map, S.people, chanNames());

function inlineEdit(box, m, channel, inThread) {
  const row = box.querySelector(`.sl-msg[data-ts="${CSS.escape(m.ts)}"]`);
  if (!row) return;
  const map = new Map();
  const body = $('.sl-body', row);
  const old = body.innerHTML;
  S.editing = true;
  body.innerHTML = `<div class="sl-edit"><textarea rows="2" aria-label="Edit message">${esc(toEditable(m.text, map))}</textarea>
    <div class="row"><button class="btn btn-ghost btn-sm" type="button" data-cancel>Cancel</button><button class="btn btn-primary btn-sm" type="button" data-save>Save</button><span class="small muted sl-hide-sm">Enter to save, Esc to cancel</span></div></div>`;
  const ta = $('textarea', body);
  const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(260, ta.scrollHeight)}px`; };
  grow(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  const done = () => { S.editing = false; body.innerHTML = old; S.sig = ''; S.tsig = ''; };
  const save = async () => {
    const text = toSlack(ta.value.trim(), map);
    if (!text) return toast('A message cannot be empty. Delete it instead.', true);
    try { await api('/api/slack/me/edit', { method: 'POST', body: { channel, ts: m.ts, text } }); S.editing = false; refreshView(inThread); } catch (err) { toast(err.message, true); }
  };
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); done(); } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); } });
  $('[data-cancel]', body).addEventListener('click', done);
  $('[data-save]', body).addEventListener('click', save);
}

// ---------- threads ----------
async function openThread(channel, ts, { push = true } = {}) {
  S.thread = { channel, ts }; S.tsig = ''; S.panel = 'thread'; S.tmsgs = [];
  setHash(`#/slack/${channel}/t/${ts}`, push);
  const c = conv(channel) || {};
  const side = $('#sl-thread');
  side.hidden = false;
  side.innerHTML = `<header class="sl-head"><button class="icon-btn sl-back" id="sl-tback" aria-label="Back">${icon.back}</button><div><b>Thread</b><div class="small muted">${esc(convLabel(c))}</div></div><span class="spacer"></span><button class="icon-btn" id="sl-tclose" aria-label="Close thread">${icon.close}</button></header>
    <div class="sl-msgs" id="sl-tmsgs"><div class="skeleton"></div></div>${composer('thread', 'Reply')}`;
  const close = () => { side.hidden = true; S.thread = null; S.panel = null; setHash(`#/slack/${channel}`, false); };
  $('#sl-tclose').addEventListener('click', close);
  $('#sl-tback').addEventListener('click', close);
  wireComposer(side, () => ({ channel, thread_ts: ts }), `${channel}:${ts}`, () => { S.tsig = ''; loadThread(); S.sig = ''; loadMsgs({}); });
  wireMsgs($('#sl-tmsgs'), channel, true);
  await loadThread();
  $('textarea', side)?.focus();
}
async function loadThread() {
  if (!S.thread) return;
  const { channel, ts } = S.thread;
  try {
    const r = await api(`/api/slack/me/replies?channel=${encodeURIComponent(channel)}&ts=${encodeURIComponent(ts)}`);
    if (!S.thread || S.thread.ts !== ts) return;
    Object.assign(S.people, r.people);
    S.tmsgs = r.messages;
    const sig = JSON.stringify(r.messages.map((m) => [m.ts, m.text, m.reactions, m.edited, m.pinned]));
    if (sig === S.tsig || S.editing) return;
    S.tsig = sig;
    const box = $('#sl-tmsgs');
    const [parent, ...replies] = r.messages;
    box.innerHTML = msgsHtml(parent ? [parent] : [], { inThread: true }) + (replies.length ? `<div class="sl-tcount small muted">${plural(replies.length, 'reply', 'replies')}</div>` : '') + msgsHtml(replies, { inThread: true });
    box.scrollTop = box.scrollHeight;
  } catch (e) { const box = $('#sl-tmsgs'); if (box) box.innerHTML = `<p class="err-text" style="padding:16px">${esc(e.message)}</p>`; }
}

// ---------- composer ----------
function composer(kind, placeholder) {
  return `<form class="sl-compose" data-kind="${kind}"><div class="sl-box">
    <div class="sl-fmt" role="toolbar" aria-label="Formatting">
      <button type="button" data-fmt="b" title="Bold (Ctrl B)"><b>B</b></button><button type="button" data-fmt="i" title="Italic (Ctrl I)"><i>I</i></button><button type="button" data-fmt="s" title="Strikethrough"><s>S</s></button>
      <button type="button" data-fmt="link" title="Link">${icon.chain}</button><button type="button" data-fmt="ul" title="Bulleted list">•</button><button type="button" data-fmt="ol" title="Numbered list">1.</button>
      <button type="button" data-fmt="quote" title="Quote">❝</button><button type="button" data-fmt="code" title="Code">&lt;/&gt;</button><button type="button" data-fmt="pre" title="Code block">{ }</button></div>
    <textarea rows="1" name="text" placeholder="${esc(placeholder)}" aria-label="Message"></textarea>
    <div class="sl-ac" role="listbox" hidden></div>
    <div class="sl-compose-row"><label class="icon-btn" title="Attach a file">${icon.clip}<input type="file" name="file" hidden></label>
      <button type="button" class="icon-btn" data-emo title="Emoji" aria-label="Emoji">${icon.smile}</button><button type="button" class="icon-btn" data-at title="Mention someone" aria-label="Mention someone">${icon.at}</button>
      <button type="button" class="btn btn-ghost btn-sm sl-hide-sm" data-share>Share from the Hub</button><span class="small muted sl-filename"></span><span class="spacer"></span>
      ${kind === 'thread' ? '<label class="small sl-bcast"><input type="checkbox" name="broadcast"> Also send to the conversation</label>' : ''}
      <span class="sl-sendgrp"><button class="btn btn-primary btn-sm" type="submit" aria-label="Send">${icon.send}<span class="sl-hide-sm">Send</span></button><button type="button" class="btn btn-primary btn-sm" data-sched title="Schedule for later" aria-label="Schedule for later">${icon.chevron}</button></span></div>
  </div></form>`;
}

function applyFmt(ta, kind) {
  const a = ta.selectionStart, b = ta.selectionEnd;
  const sel = ta.value.slice(a, b);
  const wrap = (l, r = l, ph = 'text') => { const inner = sel || ph; ta.setRangeText(`${l}${inner}${r}`, a, b, 'select'); if (!sel) ta.setSelectionRange(a + l.length, a + l.length + inner.length); };
  const lines = (fn) => {
    const start = ta.value.lastIndexOf('\n', a - 1) + 1;
    const block = ta.value.slice(start, b) || '';
    ta.setRangeText(block.split('\n').map(fn).join('\n'), start, b, 'end');
  };
  if (kind === 'b') wrap('*');
  else if (kind === 'i') wrap('_');
  else if (kind === 's') wrap('~');
  else if (kind === 'code') wrap('`', '`', 'code');
  else if (kind === 'pre') wrap('```\n', '\n```', 'code');
  else if (kind === 'quote') lines((l) => `> ${l}`);
  else if (kind === 'ul') lines((l) => `• ${l}`);
  else if (kind === 'ol') { let n = 0; lines((l) => `${++n}. ${l}`); }
  else if (kind === 'link') {
    const url = prompt('Link address (https://...)', 'https://');
    if (!url || !/^(https?:\/\/|mailto:)\S+$/.test(url.trim())) return;
    ta.setRangeText(sel ? `[${sel}](${url.trim()})` : url.trim(), a, b, 'end');
  }
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

// @people, #channels and :emoji: suggestions while typing.
function autocomplete(ta, box, map) {
  let items = [], idx = 0, range = null, seq = 0;
  const close = () => { box.hidden = true; items = []; };
  const render = () => {
    box.innerHTML = items.map((it, i) => `<button type="button" class="sl-ac-i${i === idx ? ' on' : ''}" data-i="${i}" role="option">${it.pre || ''}<b>${esc(it.label)}</b>${it.sub ? `<span class="small muted">${esc(it.sub)}</span>` : ''}</button>`).join('');
    box.hidden = false;
  };
  const update = async () => {
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return close();
    const m = ta.value.slice(0, pos).match(/(^|[\s(])([@#:])([^\s@#:]{0,40})$/);
    if (!m || (m[2] === ':' && m[3].length < 2)) return close();
    const q = m[3].toLowerCase();
    range = [pos - m[3].length - 1, pos];
    const my = ++seq;
    if (m[2] === '@') {
      const ppl = await allPeople().catch(() => []);
      if (my !== seq) return;
      items = [...ppl.filter((p) => p.name.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q)).slice(0, 7).map((p) => ({ pre: avatar(p, p.name), label: p.name, sub: `@${p.handle}`, insert: `@${p.name}`, token: `<@${p.id}>` })),
        ...['here', 'channel', 'everyone'].filter((x) => x.startsWith(q)).map((x) => ({ label: `@${x}`, sub: x === 'here' ? 'People active in this conversation' : 'Everyone in this conversation', insert: `@${x}` }))];
    } else if (m[2] === '#') {
      items = S.convs.filter((c) => ['channel', 'private', 'client'].includes(c.kind) && c.slackName && (c.slackName.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))).slice(0, 8)
        .map((c) => ({ pre: `<span class="sl-hash">${c.private ? '🔒' : '#'}</span>`, label: c.slackName, sub: c.kind === 'client' ? c.name : '', insert: `#${c.slackName}`, token: `<#${c.id}|${c.slackName}>` }));
    } else {
      items = emojiNames().filter((n) => n.startsWith(q)).concat(emojiNames().filter((n) => !n.startsWith(q) && n.includes(q))).slice(0, 8).map((n) => ({ pre: `<span class="sl-ac-emo">${emojiHtml(n)}</span>`, label: `:${n}:`, insert: `:${n}:` }));
    }
    if (!items.length) return close();
    idx = 0;
    render();
  };
  const pick = (i) => {
    const it = items[i];
    if (!it) return;
    ta.setRangeText(`${it.insert} `, range[0], range[1], 'end');
    if (it.token) map.set(it.insert, it.token);
    close();
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  };
  box.addEventListener('mousedown', (e) => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); pick(Number(b.dataset.i)); } });
  ta.addEventListener('blur', () => setTimeout(close, 150));
  return {
    update,
    keydown(e) {
      if (box.hidden || !items.length) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; render(); return true; }
      if (e.key === 'Enter' || e.key === 'Tab') { pick(idx); return true; }
      if (e.key === 'Escape') { close(); return true; }
      return false;
    },
  };
}

function wireComposer(root, target, key, after) {
  const f = $('.sl-compose', root);
  const ta = $('textarea', f);
  const fileIn = $('input[type=file]', f);
  const map = new Map();
  let file = null;
  let saveT = null;
  const ac = autocomplete(ta, $('.sl-ac', f), map);
  const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(220, ta.scrollHeight)}px`; };
  let lastW = 0;
  new ResizeObserver(() => { if (ta.clientWidth !== lastW) { lastW = ta.clientWidth; grow(); } }).observe(ta);
  const saved = store.get(draftKey(key));
  if (saved?.text) { ta.value = saved.text; (saved.map || []).forEach(([l, t]) => map.set(l, t)); grow(); }
  const showFile = () => { $('.sl-filename', f).innerHTML = file ? `${esc(file.name)} <button type="button" class="linkish" data-unfile>Remove</button>` : ''; };
  const setFile = (x) => { file = x || null; showFile(); };
  ta.addEventListener('input', () => {
    grow();
    ac.update();
    clearTimeout(saveT);
    saveT = setTimeout(() => { store.set(draftKey(key), ta.value.trim() ? { text: ta.value, map: [...map] } : null); drawList(); }, 400);
  });
  ta.addEventListener('click', () => ac.update());
  ta.addEventListener('keydown', (e) => {
    if (ac.keydown(e)) { e.preventDefault(); return; }
    if ((e.ctrlKey || e.metaKey) && ['b', 'i'].includes(e.key.toLowerCase())) { e.preventDefault(); applyFmt(ta, e.key.toLowerCase()); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'x') { e.preventDefault(); applyFmt(ta, 's'); return; }
    if (e.key === 'ArrowUp' && !ta.value && f.dataset.kind === 'main') {
      const last = [...S.msgs].reverse().find((m) => m.user === S.me && !m.botName && !NOTICE.has(m.subtype));
      if (last) { e.preventDefault(); inlineEdit($('#sl-msgs'), last, S.open, false); }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.innerWidth > 700) { e.preventDefault(); f.requestSubmit(); }
  });
  ta.addEventListener('paste', (e) => { const x = [...(e.clipboardData?.files || [])][0]; if (x) { e.preventDefault(); setFile(x); } });
  root.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); root.classList.add('sl-drop'); } });
  root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('sl-drop'); });
  root.addEventListener('drop', (e) => { const x = e.dataTransfer?.files?.[0]; root.classList.remove('sl-drop'); if (x) { e.preventDefault(); setFile(x); ta.focus(); } });
  fileIn.addEventListener('change', () => { setFile(fileIn.files[0]); fileIn.value = ''; });
  f.addEventListener('click', (e) => {
    if (e.target.closest('[data-unfile]')) return setFile(null);
    const fb = e.target.closest('[data-fmt]');
    if (fb) return applyFmt(ta, fb.dataset.fmt);
    const em = e.target.closest('[data-emo]');
    if (em) return emojiPicker(em, (n) => { ta.focus(); ta.setRangeText(`:${n}: `, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); });
    if (e.target.closest('[data-at]')) { ta.focus(); const p = ta.selectionStart; const pre = p && !/\s/.test(ta.value[p - 1]) ? ' @' : '@'; ta.setRangeText(pre, p, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); return; }
    if (e.target.closest('[data-share]')) return shareItem(target(), after);
    const sc = e.target.closest('[data-sched]');
    if (sc) {
      if (!ta.value.trim()) return toast('Type the message first, then pick when to send it.', true);
      if (file) return toast('Files go right away. Remove the file to schedule the message.', true);
      const go = (t) => schedule(t);
      menu(sc, [{ head: 'Schedule message' }, { label: 'Tomorrow at 9:00 AM', run: () => go(at9(1)) }, { label: 'Next Monday at 9:00 AM', run: () => go(nextMonday9()) }, { label: 'Custom time', run: () => customTime(go) }]);
    }
  });
  const reset = () => { ta.value = ''; map.clear(); grow(); store.set(draftKey(key), null); drawList(); };
  const schedule = async (postAt) => {
    try {
      await api('/api/slack/me/schedule', { method: 'POST', body: { ...target(), text: toSlack(ta.value.trim(), map), post_at: postAt } });
      toast(`Scheduled for ${when(postAt)}`);
      reset();
      loadScheduled(target().channel);
    } catch (err) { toast(err.message, true); }
  };
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = toSlack(ta.value.trim(), map);
    if (!text && !file) return;
    const btn = f.querySelector('button[type=submit]'); busy(btn, true);
    try {
      const t = target();
      if (file) {
        const form = new FormData();
        form.append('file', file); form.append('channel', t.channel); if (t.thread_ts) form.append('thread_ts', t.thread_ts); if (text) form.append('comment', text);
        await api('/api/slack/me/upload', { method: 'POST', form });
        setFile(null);
      } else await api('/api/slack/me/send', { method: 'POST', body: { ...t, text, broadcast: Boolean(f.broadcast?.checked) } });
      reset();
      if (f.broadcast) f.broadcast.checked = false;
      after();
    } catch (err) { toast(err.message, true); }
    busy(btn, false);
    ta.focus();
  });
}

function customTime(go) {
  const d = new Date(Date.now() + 3600e3);
  d.setMinutes(0, 0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  const m = modal(`<div class="card-head"><h2>Schedule message</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <form id="ct-f"><label class="field"><span>Send on</span><input type="datetime-local" name="at" value="${local}" required></label>
    <div class="row end" style="margin-top:12px"><button class="btn btn-primary" type="submit">Schedule</button></div></form>`);
  $('#ct-f', m.el).addEventListener('submit', (e) => {
    e.preventDefault();
    const t = Math.floor(new Date(e.target.at.value).getTime() / 1000);
    if (!t || t < nowSec() + 60) return toast('Pick a time at least a minute from now.', true);
    m.close();
    go(t);
  });
}

async function loadScheduled(channel) {
  const bar = $('#sl-sched');
  if (!bar) return;
  try {
    const { messages } = await api(`/api/slack/me/scheduled?channel=${encodeURIComponent(channel)}`);
    if (S.open !== channel) return;
    bar.hidden = !messages.length;
    bar.innerHTML = messages.length ? `${icon.clock}<span>${plural(messages.length, 'scheduled message')} here. Next: ${esc(when(messages[0].post_at))}</span><button class="linkish" type="button" id="sl-sched-see">See all</button>` : '';
    $('#sl-sched-see')?.addEventListener('click', () => scheduledModal(channel, messages));
  } catch { bar.hidden = true; }
}
function scheduledModal(channel, messages) {
  const m = modal(`<div class="card-head"><h2>Scheduled messages</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div><ul class="list" id="sm-list"></ul>`);
  const draw = (list) => {
    $('#sm-list', m.el).innerHTML = list.map((x) => `<li class="item"><div style="flex:1;min-width:0"><div class="item-sub">${esc(when(x.post_at))}</div><div class="sl-text">${html(x.text)}</div></div>
      <button class="btn btn-ghost btn-sm" data-edit="${esc(x.id)}">Edit</button><button class="btn btn-ghost btn-sm" data-del="${esc(x.id)}">Delete</button></li>`).join('') || '<li class="muted small">Nothing scheduled.</li>';
  };
  draw(messages);
  $('#sm-list', m.el).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del],[data-edit]');
    if (!b) return;
    const x = messages.find((y) => y.id === (b.dataset.del || b.dataset.edit));
    try {
      await api('/api/slack/me/scheduled/delete', { method: 'POST', body: { channel, id: x.id } });
      messages = messages.filter((y) => y.id !== x.id);
      draw(messages);
      if (b.dataset.edit) {
        const map = new Map();
        const text = toEditable(x.text, map);
        store.set(draftKey(channel), { text, map: [...map] });
        m.close();
        if (S.open === channel) { const ta = $('#sl-pane textarea'); ta.value = text; ta.dispatchEvent(new Event('input')); ta.focus(); toast('Back in the box. Send it or schedule it again.'); }
      }
      loadScheduled(channel);
    } catch (err) { toast(err.message, true); }
  });
}

// ---------- details: about, members, pins, files ----------
async function openDetails(tab = 'about') {
  const id = S.open;
  const c = conv(id) || { id, name: 'Conversation', kind: 'channel' };
  S.panel = 'details'; S.thread = null; S.detailsTab = tab;
  const side = $('#sl-thread');
  side.hidden = false;
  side.innerHTML = `<header class="sl-head"><button class="icon-btn sl-back" id="sl-dback" aria-label="Back">${icon.back}</button><b>${esc(c.kind === 'channel' ? `#${c.name}` : c.name)}</b><span class="spacer"></span><button class="icon-btn" id="sl-dclose" aria-label="Close">${icon.close}</button></header>
    <div class="sl-dtabs" id="sl-dtabs"></div><div class="sl-dbody" id="sl-dbody"><div class="skeleton"></div></div>`;
  const close = () => { side.hidden = true; S.panel = null; };
  $('#sl-dclose').addEventListener('click', close);
  $('#sl-dback').addEventListener('click', close);
  let d;
  try { d = await api(`/api/slack/me/details?channel=${encodeURIComponent(id)}`); } catch (e) { $('#sl-dbody').innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  if (S.open !== id || S.panel !== 'details') return;
  S.details = d;
  Object.assign(S.people, d.people);
  const tabs = [['about', 'About'], ...(c.kind !== 'dm' ? [['members', `Members ${d.info.count || d.members.length}`]] : []), ['pins', `Pins ${d.pins.length}`], ['files', `Files ${d.files.length}`]];
  const show = (t) => {
    S.detailsTab = t;
    $('#sl-dtabs').innerHTML = tabs.map(([k, l]) => `<button type="button" class="${k === t ? 'on' : ''}" data-tab="${k}">${esc(l)}</button>`).join('');
    const body = $('#sl-dbody');
    if (t === 'about') body.innerHTML = aboutHtml(c, d);
    if (t === 'members') body.innerHTML = `<button class="btn btn-ghost btn-sm" type="button" data-add style="margin-bottom:8px">${icon.plus}Add people</button>${d.parts.members ? '' : '<p class="small muted">Could not load the member list.</p>'}
      <ul class="list">${d.members.map((u) => `<li class="item sl-mem" data-profile="${esc(u)}">${avatar(S.people[u], S.people[u]?.name || u)}<div><div class="item-title">${esc(S.people[u]?.name || 'Someone')}${u === S.me ? ' (you)' : ''}</div>${S.people[u]?.handle ? `<div class="item-sub">@${esc(S.people[u].handle)}</div>` : ''}</div></li>`).join('')}</ul>`;
    if (t === 'pins') {
      body.innerHTML = d.pins.length ? `<div class="sl-msgs sl-pins" id="sl-pinlist">${msgsHtml(d.pins, { inThread: true })}</div>` : `<p class="small muted">${d.parts.pins ? 'Nothing pinned yet. Use a message\'s menu to pin it.' : 'Pins need the reconnect above.'}</p>`;
      $$('#sl-pinlist .sl-msg', body).forEach((row) => row.insertAdjacentHTML('beforeend', `<div class="sl-pinacts"><button class="linkish" type="button" data-goto="${esc(row.dataset.ts)}">Go to message</button> <button class="linkish" type="button" data-unpin="${esc(row.dataset.ts)}">Unpin</button></div>`));
    }
    if (t === 'files') body.innerHTML = d.files.length ? `<ul class="list">${d.files.map((f) => `<li class="item"><a class="sl-frow" href="${esc(f.url ? fileUrl(f.url) : f.permalink || '#')}" target="_blank" rel="noopener">${f.thumb ? `<img src="${esc(fileUrl(f.thumb))}" alt="" loading="lazy">` : `<span class="sl-ficon">${icon.clip}</span>`}<span><b>${esc(f.name)}</b><span class="item-sub">${esc(S.people[f.user]?.name || '')}${f.created ? ` · ${esc(when(f.created))}` : ''}</span></span></a></li>`).join('')}</ul>` : '<p class="small muted">No files shared here yet.</p>';
  };
  show(tabs.some(([k]) => k === tab) ? tab : 'about');
  $('#sl-dtabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); };
  $('#sl-dbody').onclick = async (e) => {
    const el = e.target.closest('[data-add],[data-goto],[data-unpin],[data-edit-topic],[data-edit-purpose],[data-rename],[data-leave],[data-search-in]');
    if (!el) return;
    try {
      if (el.dataset.add != null) return addPeople(id, d.members);
      if (el.dataset.goto) return openConv(id, { at: el.dataset.goto });
      if (el.dataset.unpin) { await api('/api/slack/me/pin', { method: 'POST', body: { channel: id, ts: el.dataset.unpin, remove: true } }); toast('Unpinned'); S.sig = ''; loadMsgs({}); return openDetails('pins'); }
      if (el.dataset.editTopic != null) return editField('Topic', d.info.topic, async (v) => { await api('/api/slack/me/channel', { method: 'POST', body: { action: 'topic', channel: id, text: v } }); c.topic = v; openDetails('about'); });
      if (el.dataset.editPurpose != null) return editField('Description', d.info.purpose, async (v) => { await api('/api/slack/me/channel', { method: 'POST', body: { action: 'purpose', channel: id, text: v } }); openDetails('about'); });
      if (el.dataset.rename != null) return editField('Channel name', d.info.name || c.slackName, async (v) => { await api('/api/slack/me/channel', { method: 'POST', body: { action: 'rename', channel: id, name: v } }); await loadConvs(); openConv(id); });
      if (el.dataset.leave != null) {
        if (!confirm(`Leave ${convLabel(c)}?`)) return;
        await api('/api/slack/me/channel', { method: 'POST', body: { action: 'leave', channel: id } });
        S.convs = S.convs.filter((x) => x.id !== id);
        leavePane('You left the channel.');
        setHash('#/slack', false);
        drawList();
        return;
      }
      if (el.dataset.searchIn != null) return searchView(`in:#${d.info.name || c.slackName} `);
    } catch (err) { toast(err.message, true); }
  };
  wireMsgs($('#sl-dbody'), id, true);
}

function aboutHtml(c, d) {
  const i = d.info;
  const isChannel = !i.im && !i.mpim;
  const creator = i.creator ? S.people[i.creator]?.name || 'someone' : null;
  return `${c.kind === 'client' ? `<div class="sl-clientnote small" style="margin:0 0 10px">Client chat for <b>${esc(c.name)}</b>. Everything here shows in their app. <a href="#/client/${esc(c.clientId)}/chat">Open the client</a></div>` : ''}
    ${isChannel ? `<div class="sl-dsec"><div class="row"><b>Topic</b><span class="spacer"></span><button class="linkish" type="button" data-edit-topic>Edit</button></div><div class="small">${i.topic ? html(i.topic) : '<span class="muted">No topic</span>'}</div></div>
    <div class="sl-dsec"><div class="row"><b>Description</b><span class="spacer"></span><button class="linkish" type="button" data-edit-purpose>Edit</button></div><div class="small">${i.purpose ? html(i.purpose) : '<span class="muted">No description</span>'}</div></div>
    <div class="sl-dsec"><div class="row"><b>Channel name</b><span class="spacer"></span><button class="linkish" type="button" data-rename>Rename</button></div><div class="small">${i.private ? '🔒 ' : '#'}${esc(i.name || '')}</div></div>` : ''}
    ${i.created ? `<div class="sl-dsec small muted">Made${creator ? ` by ${esc(creator)}` : ''} on ${esc(new Date(i.created * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}</div>` : ''}
    <div class="sl-dsec row" style="flex-wrap:wrap;gap:8px">
      ${i.im ? '' : `<button class="btn btn-ghost btn-sm" type="button" data-add>${icon.plus}Add people</button>`}
      ${isChannel && !i.private ? `<button class="btn btn-ghost btn-sm" type="button" data-search-in>${icon.search}Search here</button>` : ''}
      ${isChannel && !i.general ? '<button class="btn btn-ghost btn-sm danger" type="button" data-leave>Leave</button>' : ''}</div>`;
}

function editField(label, value, save) {
  const m = modal(`<div class="card-head"><h2>${esc(label)}</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <form id="ef-f"><input name="v" value="${esc(value || '')}" maxlength="250" style="width:100%"><div class="row end" style="margin-top:12px"><button class="btn btn-primary" type="submit">Save</button></div></form>`);
  const inp = $('input', m.el);
  inp.focus(); inp.select();
  $('#ef-f', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); busy(btn, true);
    try { await save(inp.value.trim()); m.close(); toast('Saved'); } catch (err) { toast(err.message, true); busy(btn, false); }
  });
}

function addPeople(channel, members = []) {
  const m = modal(`<div class="card-head"><h2>Add people</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div><div id="ap-pick"></div>
    <div class="row end" style="margin-top:12px"><button class="btn btn-primary" id="ap-go" disabled>Add</button></div>`);
  const pp = peoplePicker($('#ap-pick', m.el), { exclude: members });
  $('#ap-pick', m.el).addEventListener('change', () => { $('#ap-go', m.el).disabled = !pp.ids().length; });
  $('#ap-go', m.el).addEventListener('click', async (e) => {
    busy(e.target, true);
    try { await api('/api/slack/me/channel', { method: 'POST', body: { action: 'invite', channel, users: pp.ids() } }); toast('Added'); m.close(); if (S.panel === 'details') openDetails('members'); } catch (err) { toast(err.message, true); busy(e.target, false); }
  });
  setTimeout(() => pp.focus(), 50);
}

// ---------- people ----------
async function profileCard(id) {
  const m = modal('<div class="sl-prof"><div class="skeleton" style="height:120px"></div></div>');
  let p;
  try { p = await api(`/api/slack/me/profile?user=${encodeURIComponent(id)}`); } catch (e) { m.el.innerHTML = `<p class="err-text">${esc(e.message)}</p><div class="row end"><button class="btn btn-ghost btn-sm" data-close>Close</button></div>`; return; }
  const local = p.tz ? new Date().toLocaleTimeString('en-US', { timeZone: p.tz, hour: 'numeric', minute: '2-digit' }) : null;
  const status = p.status.emoji || p.status.text ? `${p.status.emoji ? emojiHtml(p.status.emoji.replace(/:/g, '')) : ''} ${esc(p.status.text)}` : '';
  m.el.innerHTML = `<div class="sl-prof">${p.image ? `<img class="sl-prof-img" src="${esc(p.image)}" alt="">` : `<span class="sl-prof-img">${esc(initials(p.name))}</span>`}
    <div class="sl-prof-body"><h2>${esc(p.name)}</h2>${p.title ? `<div class="muted">${esc(p.title)}</div>` : ''}${p.handle && p.handle !== p.name ? `<div class="small muted">@${esc(p.handle)}</div>` : ''}
      <div class="small sl-prof-line"><i class="sl-dot${p.presence === 'active' ? ' on' : ''}"></i>${p.presence === 'active' ? 'Active' : 'Away'}${status ? ` · ${status}` : ''}</div>
      ${local ? `<div class="small muted">${esc(local)} local time</div>` : ''}
      ${p.email ? `<div class="small"><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></div>` : ''}${p.phone ? `<div class="small"><a href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">${esc(p.phone)}</a></div>` : ''}
      <div class="row" style="margin-top:12px;gap:8px">${p.me ? '<button class="btn btn-primary btn-sm" data-status>Set a status</button>' : p.bot ? '' : '<button class="btn btn-primary btn-sm" data-dm>Message</button>'}<button class="btn btn-ghost btn-sm" data-close>Close</button></div></div></div>`;
  $('[data-dm]', m.el)?.addEventListener('click', async () => { m.close(); openDm([id]); });
  $('[data-status]', m.el)?.addEventListener('click', () => { m.close(); statusModal(); });
}

async function openDm(ids) {
  try {
    const { channel } = await api('/api/slack/me/open', { method: 'POST', body: { users: ids } });
    if (!conv(channel)) {
      const ppl = await allPeople().catch(() => []);
      const names = ids.map((u) => ppl.find((x) => x.id === u)?.name || S.people[u]?.name || 'Someone');
      S.convs.unshift({ id: channel, kind: ids.length > 1 ? 'group' : 'dm', name: names.join(', '), user: ids.length === 1 ? ids[0] : null, image: ids.length === 1 ? ppl.find((x) => x.id === ids[0])?.image || null : null, unread: 0, mentions: 0, updated: nowSec() });
    }
    openConv(channel);
  } catch (err) { toast(err.message, true); }
}

function newMessage() {
  const m = modal(`<div class="card-head"><h2>New message</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <p class="small muted">Pick one person for a direct message, or up to 8 for a group.</p><div id="nm-pick"></div>
    <div class="row end" style="margin-top:12px"><button class="btn btn-ghost" id="nm-ch" type="button">Or create a channel</button><button class="btn btn-primary" id="nm-go" disabled>Open</button></div>`);
  const pp = peoplePicker($('#nm-pick', m.el), { max: 8 });
  $('#nm-pick', m.el).addEventListener('change', () => { const n = pp.ids().length; $('#nm-go', m.el).disabled = !n; $('#nm-go', m.el).textContent = n > 1 ? `Open group (${n + 1})` : 'Open'; });
  $('#nm-go', m.el).addEventListener('click', () => { const ids = pp.ids(); m.close(); openDm(ids); });
  $('#nm-ch', m.el).addEventListener('click', () => { m.close(); createChannel(); });
  setTimeout(() => pp.focus(), 50);
}

// ---------- you ----------
function meMenu(anchor) {
  const st = S.status;
  if (!st) return menu(anchor, [{ head: 'Reconnect your Slack to set a status, go away or pause notifications.' }, { label: 'Reconnect', run: () => reconnect() }, { sep: true }, { label: 'Disconnect my Slack', danger: true, run: disconnect }]);
  const hasStatus = st.status.text || st.status.emoji;
  const snoozed = st.snooze > nowSec();
  const until = (sec) => new Date(sec * 1000).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const minsTo9 = () => Math.max(30, Math.round((at9(1) - nowSec()) / 60));
  menu(anchor, [
    { head: `<div class="sl-mh-me">${avatar({ image: st.image }, st.name)}<div><b>${esc(st.name)}</b><div class="small muted">${st.away ? 'Away' : 'Active'}${hasStatus ? ` · ${st.status.emoji ? emojiHtml(st.status.emoji.replace(/:/g, '')) : ''} ${esc(st.status.text)}` : ''}</div></div></div>` },
    { label: hasStatus ? 'Change status' : 'Set a status', icon: icon.smile, run: statusModal },
    hasStatus ? { label: 'Clear status', icon: icon.close, run: async () => { await api('/api/slack/me/status', { method: 'POST', body: { text: '', emoji: '', expires: 0 } }); toast('Status cleared'); loadStatus(); } } : false,
    { label: st.away ? 'Set yourself as active' : 'Set yourself as away', icon: icon.eye, run: async () => { await api('/api/slack/me/presence', { method: 'POST', body: { away: !st.away } }); toast(st.away ? 'You are active' : 'You are away'); loadStatus(); } },
    snoozed ? { label: 'Resume notifications', icon: icon.bell, hint: `paused until ${until(st.snooze)}`, run: () => snooze(0) }
      : { label: 'Pause notifications', icon: icon.bell, sub: [['For 30 minutes', 30], ['For 1 hour', 60], ['For 2 hours', 120], ['Until tomorrow at 9 AM', minsTo9()], ['For a week', 7 * 1440]].map(([label, mins]) => ({ label, run: () => snooze(mins) })) },
    { sep: true },
    { label: 'View my profile', icon: icon.users, run: () => profileCard(S.me) },
    { label: 'Disconnect my Slack', icon: icon.close, danger: true, run: disconnect },
  ]);
}
async function snooze(minutes) {
  await api('/api/slack/me/snooze', { method: 'POST', body: { minutes } });
  toast(minutes ? 'Notifications paused in Slack and the Hub' : 'Notifications are back on');
  loadStatus();
}
async function disconnect() {
  if (!confirm('Disconnect your Slack from the Hub?')) return;
  await api('/api/slack/me/disconnect', { method: 'POST' });
  location.hash = '#/slack';
  location.reload();
}

const PRESETS = [['calendar', 'In a meeting', 3600], ['bus', 'Commuting', 1800], ['telephone_receiver', 'On a call', 3600], ['face_with_thermometer', 'Out sick', 'today'], ['palm_tree', 'Vacationing', 0], ['house_with_garden', 'Working remotely', 'today'], ['car', 'On a site visit', 'today']];
function expiresAt(v) {
  if (v === 'today') { const d = new Date(); d.setHours(23, 59, 0, 0); return Math.floor(d / 1000); }
  if (v === 'week') { const d = new Date(); d.setDate(d.getDate() + (7 - d.getDay()) % 7); d.setHours(23, 59, 0, 0); return Math.floor(d / 1000); }
  const n = Number(v) || 0;
  return n ? nowSec() + n : 0;
}
function statusModal() {
  const st = S.status || { status: { text: '', emoji: '' } };
  let emo = (st.status.emoji || '').replace(/:/g, '') || 'speech_balloon';
  const m = modal(`<div class="card-head"><h2>Set a status</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <form id="ss-f"><div class="row" style="gap:8px"><button type="button" class="btn btn-ghost sl-st-emo" id="ss-emo" aria-label="Pick an emoji">${emojiHtml(emo)}</button><input name="text" maxlength="100" placeholder="What is your status?" value="${esc(st.status.text || '')}" style="flex:1"></div>
      <div class="sl-presets">${PRESETS.map(([e, t, x], i) => `<button type="button" class="sl-preset" data-p="${i}">${emojiHtml(e)} <b>${esc(t)}</b><span class="small muted">${x === 'today' ? 'Today' : x ? `${x / 60} minutes`.replace('60 minutes', '1 hour') : 'Until cleared'}</span></button>`).join('')}</div>
      <label class="field"><span>Clear after</span><select name="exp"><option value="0">Do not clear</option><option value="1800">30 minutes</option><option value="3600">1 hour</option><option value="14400">4 hours</option><option value="today">Today</option><option value="week">This week</option></select></label>
      <div class="row end" style="margin-top:12px;gap:8px"><button class="btn btn-ghost" type="button" id="ss-clear">Clear status</button><button class="btn btn-primary" type="submit">Save</button></div></form>`);
  const f = $('#ss-f', m.el);
  $('#ss-emo', m.el).addEventListener('click', (e) => emojiPicker(e.currentTarget, (n) => { emo = n; $('#ss-emo', m.el).innerHTML = emojiHtml(n); }));
  $('.sl-presets', m.el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    const [e2, t, x] = PRESETS[Number(b.dataset.p)];
    emo = e2; $('#ss-emo', m.el).innerHTML = emojiHtml(e2); f.text.value = t; f.exp.value = String(x);
  });
  const save = async (text, emoji, expires) => {
    await api('/api/slack/me/status', { method: 'POST', body: { text, emoji, expires } });
    m.close(); loadStatus(); toast(text || emoji ? 'Status set' : 'Status cleared');
  };
  $('#ss-clear', m.el).addEventListener('click', () => save('', '', 0).catch((err) => toast(err.message, true)));
  f.addEventListener('submit', (e) => { e.preventDefault(); save(f.text.value.trim(), f.text.value.trim() || emo !== 'speech_balloon' ? emo : '', expiresAt(f.exp.value)).catch((err) => toast(err.message, true)); });
}

// ---------- views: activity, search, browse, drafts and scheduled ----------
function viewPane(name, title, extra = '') {
  closeMenus();
  clearInterval(S.timer);
  S.view = name; S.open = null; S.thread = null; S.panel = null;
  $('#sl-thread').hidden = true;
  $('#sl')?.classList.add('has-open');
  drawList();
  $('#sl-pane').innerHTML = `<header class="sl-head"><button class="icon-btn sl-back" id="sl-back" aria-label="Back">${icon.back}</button><b>${esc(title)}</b><span class="spacer"></span>${extra}</header><div class="sl-view" id="sl-view"><div class="skeleton"></div></div>`;
  $('#sl-back').addEventListener('click', () => { leavePane(); S.view = null; setHash('#/slack', false); drawList(); });
  return $('#sl-view');
}
function resultRow({ channel, ts, thread, user, username, text, top, unseen }) {
  const p = isUser(user) ? S.people[user] || {} : {};
  const name = p.name || username || 'Someone';
  return `<button type="button" class="sl-res${unseen ? ' unseen' : ''}" data-c="${esc(channel || '')}" data-ts="${esc(ts || '')}" data-thread="${esc(thread || '')}">
    <div class="small muted sl-res-top">${top}</div><div class="sl-res-row">${avatar(p, name)}<div style="min-width:0"><b>${esc(name)}</b><div class="sl-text">${html(text)}</div></div></div></button>`;
}
function wireResults(box) {
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.sl-res');
    if (!b || !b.dataset.c) return;
    if (b.dataset.thread && b.dataset.thread !== b.dataset.ts) openConv(b.dataset.c, { thread: b.dataset.thread });
    else openConv(b.dataset.c, { at: b.dataset.ts });
  });
}
const chanLabel = (id, name, kind) => { const c = conv(id); return c ? convLabel(c) : kind === 'dm' ? 'a direct message' : `#${name || 'channel'}`; };

async function activityView() {
  setHash('#/slack/activity');
  const box = viewPane('activity', 'Activity');
  let d;
  try { d = await api('/api/slack/me/activity'); } catch (e) { box.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  if (S.view !== 'activity') return;
  Object.assign(S.people, d.people);
  box.innerHTML = d.items.length ? d.items.map((i) => resultRow({ channel: i.channel, ts: i.ts, thread: i.thread_ts, user: i.user, text: i.text, unseen: !i.seen,
    top: `${i.kind === 'mention' ? 'Mentioned you' : 'Replied to your thread'} in ${esc(chanLabel(i.channel, null, ''))} · ${esc(when(Math.floor(i.at / 1000)))}` })).join('')
    : '<div class="sl-empty-view"><p><b>Nothing here yet.</b></p><p class="small muted">When someone @mentions you or replies to a thread you started, it shows here (from the time Slack was connected).</p></div>';
  wireResults(box);
  if (d.unseen) { api('/api/slack/me/activity/seen', { method: 'POST' }).catch(() => {}); S.activity = 0; drawList(); }
}

async function searchView(q = '') {
  setHash('#/slack/search');
  const box = viewPane('search', 'Search');
  box.innerHTML = `<form class="sl-sform" id="sl-sform"><input name="q" value="${esc(q)}" placeholder="Search messages" aria-label="Search messages" autocomplete="off"><select name="sort" aria-label="Sort"><option value="timestamp">Newest</option><option value="score">Best match</option></select><button class="btn btn-primary btn-sm" type="submit">${icon.search}Search</button></form>
    <p class="small muted sl-tips">Tips: <code>in:#channel</code> <code>from:@name</code> <code>before:2026-01-31</code> <code>after:2025-12-01</code> <code>has:link</code> <code>"exact words"</code></p><div id="sl-sres"></div>`;
  const f = $('#sl-sform', box);
  const res = $('#sl-sres', box);
  let page = 1;
  const run = async (more) => {
    const query = f.q.value.trim();
    if (!query) { res.innerHTML = ''; return; }
    if (!more) { page = 1; res.innerHTML = '<div class="skeleton"></div>'; }
    try {
      const d = await api(`/api/slack/me/search?q=${encodeURIComponent(query)}&sort=${f.sort.value}&page=${page}`);
      Object.assign(S.people, d.people);
      const rows = d.matches.map((m) => resultRow({ channel: m.channel.id, ts: m.ts, thread: m.thread_ts, user: m.user, username: m.username, text: m.text, top: `${esc(chanLabel(m.channel.id, m.channel.name, m.channel.kind))} · ${esc(when(Number(m.ts)))}` })).join('');
      $('[data-more-res]', res)?.remove();
      if (!more) res.innerHTML = `<p class="small muted">${d.total ? `${d.total.toLocaleString()} result${d.total === 1 ? '' : 's'}` : 'No messages found.'}</p>`;
      res.insertAdjacentHTML('beforeend', rows + (d.page < d.pages ? '<div class="row" style="justify-content:center;padding:10px"><button class="btn btn-ghost btn-sm" type="button" data-more-res>More results</button></div>' : ''));
    } catch (e) { res.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; }
  };
  f.addEventListener('submit', (e) => { e.preventDefault(); run(false); });
  f.sort.addEventListener('change', () => run(false));
  res.addEventListener('click', (e) => { if (e.target.closest('[data-more-res]')) { page += 1; run(true); } });
  wireResults(res);
  f.q.focus();
  if (q && !/\s$/.test(q)) run(false);
  else f.q.setSelectionRange(q.length, q.length);
}

async function browseView() {
  setHash('#/slack/browse');
  const box = viewPane('browse', 'Channels', `<button class="btn btn-primary btn-sm" type="button" id="sl-mk">${icon.plus}Create a channel</button>`);
  $('#sl-mk').addEventListener('click', () => createChannel());
  let d;
  try { d = await api('/api/slack/me/browse'); } catch (e) { box.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  if (S.view !== 'browse') return;
  box.innerHTML = `<input class="sl-bq" id="sl-bq" placeholder="Search channels" aria-label="Search channels"><div id="sl-blist"></div><p class="small muted" style="padding:8px 4px">Private channels only show here once someone adds you.</p>`;
  const draw = () => {
    const q = $('#sl-bq', box).value.toLowerCase();
    $('#sl-blist', box).innerHTML = d.channels.filter((c) => !q || c.name.includes(q) || c.purpose.toLowerCase().includes(q)).map((c) => `<div class="sl-brow"><div style="min-width:0"><b># ${esc(c.name)}</b> <span class="small muted">${plural(c.members, 'member')}${c.member ? ' · Joined' : ''}</span>${c.purpose || c.topic ? `<div class="small muted sl-brow-p">${esc(slackPlain(c.purpose || c.topic))}</div>` : ''}</div>
      ${c.member ? `<button class="btn btn-ghost btn-sm" type="button" data-open="${esc(c.id)}">Open</button>` : `<button class="btn btn-primary btn-sm" type="button" data-join="${esc(c.id)}">Join</button>`}</div>`).join('') || '<p class="small muted">No channels match.</p>';
  };
  draw();
  $('#sl-bq', box).addEventListener('input', draw);
  $('#sl-blist', box).addEventListener('click', async (e) => {
    const o = e.target.closest('[data-open]');
    if (o) return openConv(o.dataset.open);
    const j = e.target.closest('[data-join]');
    if (!j) return;
    busy(j, true);
    try {
      await api('/api/slack/me/channel', { method: 'POST', body: { action: 'join', channel: j.dataset.join } });
      const c = d.channels.find((x) => x.id === j.dataset.join);
      if (!conv(c.id)) S.convs.push({ id: c.id, kind: 'channel', name: c.name, slackName: c.name, topic: c.topic || c.purpose, unread: 0, mentions: 0, updated: nowSec() });
      toast(`Joined #${c.name}`);
      openConv(c.id);
    } catch (err) { toast(err.message, true); busy(j, false); }
  });
}

function createChannel() {
  const m = modal(`<div class="card-head"><h2>Create a channel</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <form id="cc-f"><label class="field"><span>Name</span><input name="name" maxlength="80" placeholder="e.g. sales-team" required autocomplete="off"></label><p class="small muted" id="cc-prev">Lowercase, no spaces.</p>
      <label class="field"><span>Description (optional)</span><input name="purpose" maxlength="250"></label>
      <label class="row small" style="gap:8px;margin:8px 0"><input type="checkbox" name="private"> Make it private (only people you add can see it)</label>
      <div class="field"><span>Add people (optional)</span><div id="cc-pick"></div></div>
      <div class="row end" style="margin-top:12px"><button class="btn btn-primary" type="submit">Create</button></div></form>`);
  const f = $('#cc-f', m.el);
  const pp = peoplePicker($('#cc-pick', m.el));
  const slug = (s) => s.toLowerCase().trim().replace(/^#/, '').replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  f.name.addEventListener('input', () => { $('#cc-prev', m.el).textContent = f.name.value ? `It will be #${slug(f.name.value)}` : 'Lowercase, no spaces.'; });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]'); busy(btn, true);
    try {
      const { channel } = await api('/api/slack/me/channel', { method: 'POST', body: { action: 'create', name: f.name.value, purpose: f.purpose.value, private: f.private.checked, users: pp.ids() } });
      S.convs.push({ id: channel.id, kind: channel.private ? 'private' : 'channel', private: channel.private, name: channel.name, slackName: channel.name, topic: f.purpose.value, unread: 0, mentions: 0, updated: nowSec() });
      m.close();
      toast(`#${channel.name} is ready`);
      openConv(channel.id);
    } catch (err) { toast(err.message, true); busy(btn, false); }
  });
  f.name.focus();
}

async function scheduledView() {
  setHash('#/slack/scheduled');
  const box = viewPane('scheduled', 'Drafts and scheduled');
  const drafts = store.keys('rw-sl-draft:').map((k) => { const [ch, th] = k.slice(12).split(':'); return { key: k, ch, th, text: store.get(k)?.text || '' }; }).filter((x) => x.text);
  let sched = [];
  let err = '';
  try { sched = (await api('/api/slack/me/scheduled')).messages; } catch (e) { err = e.message; }
  if (S.view !== 'scheduled') return;
  box.innerHTML = `<h3 class="sl-vh">Drafts</h3>${drafts.length ? drafts.map((x) => `<div class="sl-brow"><button type="button" class="sl-res" data-c="${esc(x.ch)}" data-thread="${esc(x.th || '')}" data-ts=""><div class="small muted">${esc(convLabel(conv(x.ch)))}${x.th ? ' · thread reply' : ''}</div><div class="sl-text">${esc(x.text.slice(0, 300))}</div></button><button class="btn btn-ghost btn-sm" type="button" data-deldraft="${esc(x.key)}">Delete</button></div>`).join('') : '<p class="small muted">No drafts. Anything you type and do not send is kept here, on this device.</p>'}
    <h3 class="sl-vh">Scheduled</h3>${err ? `<p class="err-text small">${esc(err)}</p>` : sched.length ? sched.map((x) => `<div class="sl-brow"><button type="button" class="sl-res" data-c="${esc(x.channel)}" data-ts=""><div class="small muted">${esc(convLabel(conv(x.channel)))} · ${esc(when(x.post_at))}</div><div class="sl-text">${html(x.text)}</div></button><button class="btn btn-ghost btn-sm" type="button" data-delsched="${esc(x.id)}" data-ch="${esc(x.channel)}">Delete</button></div>`).join('') : '<p class="small muted">Nothing scheduled. Use the arrow next to Send to pick a time.</p>'}`;
  box.addEventListener('click', async (e) => {
    const dd = e.target.closest('[data-deldraft]');
    if (dd) { store.set(dd.dataset.deldraft, null); drawList(); return scheduledView(); }
    const ds = e.target.closest('[data-delsched]');
    if (ds) { try { await api('/api/slack/me/scheduled/delete', { method: 'POST', body: { channel: ds.dataset.ch, id: ds.dataset.delsched } }); toast('Deleted'); scheduledView(); } catch (err2) { toast(err2.message, true); } return; }
    const r = e.target.closest('.sl-res');
    if (r?.dataset.c) openConv(r.dataset.c, { thread: r.dataset.thread || null });
  });
}

const VIEWS = { activity: activityView, search: () => searchView(''), browse: browseView, scheduled: scheduledView };

// ---------- sharing ----------
function forwardMsg(from, ts) {
  const m = modal(`<div class="card-head"><h2>Forward message</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <input id="fw-q" placeholder="Find a channel or person" style="width:100%"><ul class="list sl-pick-list" id="fw-list" style="margin-top:8px"></ul>
    <label class="field" style="margin-top:8px"><span>Add a note (optional)</span><input id="fw-note"></label>
    <div class="row end" style="margin-top:12px"><button class="btn btn-primary" id="fw-go" disabled>Forward</button></div>`);
  let to = null;
  const draw = () => {
    const q = $('#fw-q', m.el).value.toLowerCase();
    $('#fw-list', m.el).innerHTML = S.convs.filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 40).map((c) => `<li class="item${c.id === to ? ' on' : ''}" data-to="${esc(c.id)}">${convIcon(c)}<div class="item-title">${esc(convLabel(c))}</div></li>`).join('') || '<li class="muted small">Nothing found.</li>';
  };
  draw();
  $('#fw-q', m.el).addEventListener('input', draw);
  $('#fw-list', m.el).addEventListener('click', (e) => { const li = e.target.closest('[data-to]'); if (!li) return; to = li.dataset.to; $('#fw-go', m.el).disabled = false; draw(); });
  $('#fw-go', m.el).addEventListener('click', async (e) => {
    busy(e.target, true);
    try { await api('/api/slack/me/forward', { method: 'POST', body: { from, ts, to, note: toSlack($('#fw-note', m.el).value.trim()) } }); toast(`Forwarded to ${convLabel(conv(to))}`); m.close(); } catch (err) { toast(err.message, true); busy(e.target, false); }
  });
  $('#fw-q', m.el).focus();
}

function shareItem(t, after) {
  const m = modal(`<div class="card-head"><h2>Share from the Hub</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <input id="sh-q" placeholder="Search clients, leads, tasks, reports" style="width:100%"><ul class="list" id="sh-list" style="margin-top:10px"></ul>
    <label class="field" style="margin-top:10px"><span>Note (optional)</span><input id="sh-note"></label>`);
  const search = async () => {
    const { items } = await api(`/api/slack/me/items?q=${encodeURIComponent($('#sh-q', m.el).value)}`).catch(() => ({ items: [] }));
    $('#sh-list', m.el).innerHTML = items.map((x) => `<li class="item"><span class="badge gray">${esc(x.type)}</span><div class="item-title">${esc(x.label)}</div><button class="btn btn-primary btn-sm" data-type="${esc(x.type)}" data-id="${esc(x.id)}">Send</button></li>`).join('') || '<li class="muted small">Nothing found.</li>';
  };
  let tm;
  $('#sh-q', m.el).addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(search, 250); });
  $('#sh-list', m.el).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    busy(b, true);
    try { await api('/api/slack/me/share', { method: 'POST', body: { ...t, type: b.dataset.type, id: b.dataset.id, note: $('#sh-note', m.el).value } }); toast('Shared'); m.close(); S.sig = ''; after(); }
    catch (err) { toast(err.message, true); busy(b, false); }
  });
  search();
  $('#sh-q', m.el).focus();
}

// Shared from other pages: "Send in Slack" for a client, lead, task or report.
export async function sendToSlack(type, id) {
  let convs;
  try { ({ conversations: convs } = await api('/api/slack/me/conversations')); } catch (e) { toast(e.status === 409 ? 'Connect your Slack on the Slack page first.' : e.message, true); return; }
  const m = modal(`<div class="card-head"><h2>Send in Slack</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <input id="ss-q" placeholder="Find a channel or person" style="width:100%"><label class="field" style="margin-top:8px"><span>Note (optional)</span><input id="ss-note"></label><ul class="list" id="ss-list" style="margin-top:10px"></ul>`);
  const draw = () => {
    const q = $('#ss-q', m.el).value.toLowerCase();
    $('#ss-list', m.el).innerHTML = convs.filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 30).map((c) => `<li class="item"><span>${c.kind === 'dm' || c.kind === 'group' ? '@' : c.kind === 'client' ? '💬' : '#'}</span><div class="item-title">${esc(c.name)}${c.kind === 'client' ? ' <span class="small muted">(client sees it)</span>' : ''}</div><button class="btn btn-primary btn-sm" data-c="${esc(c.id)}">Send</button></li>`).join('');
  };
  draw();
  $('#ss-q', m.el).addEventListener('input', draw);
  $('#ss-list', m.el).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    busy(b, true);
    try { await api('/api/slack/me/share', { method: 'POST', body: { channel: b.dataset.c, type, id, note: $('#ss-note', m.el).value } }); toast('Sent in Slack'); m.close(); } catch (err) { toast(err.message, true); busy(b, false); }
  });
}

