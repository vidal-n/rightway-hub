// The staff shell: a grouped side rail, a command bar (page, search, your status, wallet warning, alerts, settings, profile),
// the presence heartbeat behind the Agents page, and the command palette (Ctrl K or /).
import { $, $$, esc, api, toast, icon } from './core.js';
import { navItems, wireNav, activeKey, customizeMenu, NAV, GROUPS, groupOf } from './nav.js';
import { STATUSES, statusLabel, statusTone, statusesFor } from '/js/callstats.js';
import { avatarHtml, wireAvatars, pickAvatar, removeAvatar } from './avatar.js';

export const initials = (u) => String(u.name || u.email || '?').trim().split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// ---------- presence and status ----------
const me = { status: null, since: null, user: null, onCall: false };
const listeners = new Set();
export const myStatus = () => ({ ...me });
export const onStatus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => { listeners.forEach((f) => { try { f(myStatus()); } catch { /* ignore */ } }); paintPills(); };
let beat = null;
async function heartbeat() {
  try { const r = await api('/api/me/presence', { method: 'POST' }); me.status = r.status; me.since = r.since; emit(); } catch { /* offline for a moment */ }
}
function startPresence(user) {
  me.user = user;
  if (beat) return;
  heartbeat();
  beat = setInterval(heartbeat, 45e3);
  // A call in progress shows as On a call without anyone touching the status.
  import('./phone.js').then((p) => p.onPhoneState?.((s) => { const on = Boolean(s.onCall); if (on !== me.onCall) { me.onCall = on; emit(); } })).catch(() => {});
}
export async function setMyStatus(status) {
  const r = await api('/api/me/status', { method: 'POST', body: { status } });
  me.status = r.status; me.since = r.since; emit();
  toast(`Status: ${statusLabel(status)}`);
}
const since = (t) => {
  if (!t) return '';
  const m = Math.max(0, Math.floor((Date.now() - t) / 60e3));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};
function pillHtml() {
  const k = me.onCall ? 'on_call' : me.status || 'available';
  return `<i></i><span class="lbl">${esc(statusLabel(k))}</span><span class="t">${esc(me.onCall ? 'live' : since(me.since))}</span>`;
}
function paintPills() {
  $$('[data-stpill]').forEach((b) => { b.dataset.tone = statusTone(me.onCall ? 'on_call' : me.status || 'available'); b.innerHTML = pillHtml(); });
}
setInterval(paintPills, 30e3);

// Every drop-down (status, profile, notifications) goes through here, so opening one always closes the others.
// Triggers do not stop propagation, so the outside-click listener of an open menu sees the click on another trigger.
export function closeMenus(keep = null) {
  document.querySelectorAll('.pmenu, .np').forEach((el) => { if (el !== keep) el.remove(); });
}

function statusMenu(anchor) {
  const wasOpen = document.querySelector('.stmenu');
  closeMenus();
  if (wasOpen) return; // clicking the same pill again closes it
  const r = anchor.getBoundingClientRect();
  const m = document.createElement('div');
  m.className = 'pmenu stmenu';
  m.dataset.menu = 'status';
  m.setAttribute('role', 'menu');
  m.style.top = `${r.bottom + 8}px`;
  m.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  m.innerHTML = `<p class="pmenu-cap">Your status</p>${statusesFor(me.user).map(([k, label, tone]) => `<button type="button" role="menuitemradio" aria-checked="${me.status === k}" data-st="${k}" class="${me.status === k ? 'is-on' : ''}"><i class="dot ${tone}"></i>${esc(label)}</button>`).join('')}
    <p class="pmenu-note">Calls switch you to On a call by themselves. Login time and status time show on the Agents page.</p>`;
  document.body.appendChild(m);
  const close = () => { m.remove(); document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close), 0);
  $$('[data-st]', m).forEach((b) => b.addEventListener('click', async (e) => { e.stopPropagation(); close(); try { await setMyStatus(b.dataset.st); } catch (err) { toast(err.message, true); } }));
}

// ---------- wallet warning ----------
let walletAt = 0, walletLow = null;
async function paintWallet(root) {
  const el = $('[data-wallet]', root);
  if (!el) return;
  if (Date.now() - walletAt > 5 * 60e3) {
    walletAt = Date.now();
    try { const r = await api('/api/balances/status'); walletLow = (r.low || []).length ? r.low : null; } catch { walletLow = null; }
  }
  el.hidden = !walletLow;
  if (walletLow) el.title = `Low balance: ${walletLow.map((x) => x.name || x).join(', ')}. Top up so calls and scans keep working.`;
}

// ---------- the shell ----------
export function staffShell(app, user, active, inner) {
  window.__rwUser = user; // the pop-up email composer reads who is sending
  active = activeKey(active);
  startPresence(user);
  document.body.classList.add('hubbg');
  // Entrance animation plays once per page; refreshes after that redraw quietly.
  document.body.classList.remove('settled');
  clearTimeout(window.__rwSettle);
  window.__rwSettle = setTimeout(() => document.body.classList.add('settled'), 900);
  const item = NAV.find((n) => n[0] === active);
  const grp = GROUPS.find((g) => g[0] === groupOf(active));
  app.innerHTML = `
    <div class="hub">
      <div class="side-scrim" id="scrim" hidden></div>
      <aside class="rail" id="side" aria-label="Main menu">
        <div class="rail-head"><a class="rail-brand" href="#/"><img src="/brand/rightway-logo-dark.svg" alt="Rightway Growth" width="140" height="24"></a>
          <button type="button" class="cmd-ico rail-close" id="menu-close" aria-label="Close menu">${icon.close}</button></div>
        <nav aria-label="Main">${railLinks(user, active)}</nav>
      </aside>
      <div class="deck">
        <header class="cmd">
          <button type="button" class="cmd-ico cmd-menu" id="menu-open" aria-label="Open menu">${icon.menu}</button>
          <div class="cmd-title" data-grp="${esc(groupOf(active))}"><small>${esc(grp ? grp[1] : 'Hub')}</small><b>${esc(item ? item[3] : '')}</b></div>
          <button type="button" class="cmd-search" id="cmdk" aria-label="Search">${icon.search}<span>Search leads, clients, pages</span><kbd>Ctrl K</kbd></button>
          <div class="cmd-right">
            <button type="button" class="stpill" data-stpill aria-label="Your status">${pillHtml()}</button>
            <a class="cmd-ico warn" href="#/settings" data-wallet hidden aria-label="A wallet is low">${icon.money}</a>
            <button type="button" class="cmd-ico" id="notifbtn" aria-label="Notifications" aria-haspopup="dialog" title="Notifications">${icon.bell}<b class="nbadge" data-badge="alerts" hidden></b></button>
            <a class="cmd-ico hide-s" href="#/settings" aria-label="Settings">${icon.cog}</a>
            <button type="button" class="pbub" data-pbub title="${esc(user.name || user.email || 'Profile')}" aria-label="Profile menu">${avatarHtml(user, initials(user))}</button>
          </div>
        </header>
        <main class="main" id="view">${inner || '<div class="skeleton"></div>'}</main>
      </div>
      <nav class="bbar" id="bbar" aria-label="Quick menu"></nav>
    </div>`;
  paintPills();
  const side = $('#side'), scrim = $('#scrim');
  const setOpen = (on) => {
    side.classList.toggle('is-open', on); scrim.hidden = !on;
    document.body.classList.toggle('menu-open', on);
    if (on) $('nav a.is-active, nav a', side)?.focus({ preventScroll: true });
  };
  $('#menu-close').addEventListener('click', () => setOpen(false));
  $('#menu-open').addEventListener('click', () => setOpen(true));
  scrim.addEventListener('click', () => setOpen(false));
  side.addEventListener('click', (e) => { if (e.target.closest('nav a')) setOpen(false); });
  const onKey = (e) => {
    if (e.key === 'Escape' && side.classList.contains('is-open')) setOpen(false);
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) { e.preventDefault(); palette(user); }
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('menu-open'); }, { once: true });
  wireNav(app, user, active, () => setOpen(true));
  const logout = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.hash = '#/login'; location.reload(); };
  wireAvatars(app);
  $('#notifbtn').addEventListener('click', (e) => { const btn = e.currentTarget; import('./notifpanel.js').then((m) => m.notifPanel(btn)).catch((err) => toast(err.message, true)); });
  $('#cmdk').addEventListener('click', () => palette(user));
  $$('[data-stpill]', app).forEach((b) => b.addEventListener('click', () => statusMenu(b)));
  $$('[data-pbub]', app).forEach((b) => b.addEventListener('click', () => profileMenu(b, user, logout)));
  paintWallet(app);
  if (user.role === 'admin' && !window.__rwMt) { window.__rwMt = 1; api('/api/auth/state').then((st) => paintMaint(st.maintenance?.on)).catch(() => {}); }
  // Ask Claude, owners only for now: bottom right on every page. On a client page it knows that client.
  if (user.role === 'admin' && !document.querySelector('.aib')) {
    const b = document.createElement('button');
    b.className = 'aib'; b.type = 'button'; b.title = 'Ask Claude'; b.setAttribute('aria-label', 'Ask Claude');
    b.innerHTML = icon.spark || icon.msg;
    b.addEventListener('click', () => {
      const m = location.hash.match(/^#\/client\/([^/]+)/);
      import('./assistant.js').then((a) => a.openAssistant(m ? { clientId: m[1], name: document.querySelector('.page-head h1')?.textContent || '' } : { name: 'Your business: pipeline, calls, clients' }));
    });
    document.body.appendChild(b);
  }
  return $('#view');
}

export function railLinks(user, active) {
  const { shown } = navItems(user);
  return GROUPS.map(([g, label]) => {
    const items = shown.filter((n) => groupOf(n[0]) === g);
    if (!items.length) return '';
    return `<div class="rail-grp"><p>${esc(label)}</p>${items.map(([k, href, ic, name]) => `<a href="${href}" data-nav="${k}" class="${active === k ? 'is-active' : ''}">${icon[ic] || ''}<span>${esc(name)}</span>${['work', 'slack', 'phone', 'pipeline', 'alerts'].includes(k) ? `<b class="nbadge" data-badge="${k}" hidden></b>` : ''}</a>`).join('')}</div>`;
  }).join('');
}

function profileMenu(b, user, logout) {
  const wasOpen = document.querySelector('.pmenu:not(.stmenu)');
  closeMenus();
  if (wasOpen) return;
  const r = b.getBoundingClientRect();
  const m = document.createElement('div');
  m.className = 'pmenu';
  m.dataset.menu = 'profile';
  m.setAttribute('role', 'menu');
  m.style.top = `${r.bottom + 8}px`;
  m.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  const tone = statusTone(me.onCall ? 'on_call' : me.status || 'available');
  m.innerHTML = `<div class="pmenu-who"><button type="button" class="pbub big" data-pm="photo" title="Change photo" aria-label="Change profile photo">${avatarHtml(user, initials(user))}<span class="pcam">${icon.camera}</span></button><div><b>${esc(user.name || 'You')}</b><div class="small muted">${esc(user.email || '')}</div>
      <span class="badge gray"><i class="dot ${tone}"></i>${esc(statusLabel(me.onCall ? 'on_call' : me.status || 'available'))} · ${user.role === 'admin' ? 'Owner' : 'Agent'}</span></div></div>
    <button type="button" data-pm="status" role="menuitem">${icon.clock}Change status</button>
    <a href="#/agents" role="menuitem">${icon.headset || icon.users}My numbers today</a>
    <a href="#/settings" role="menuitem">${icon.cog}Settings</a>
    <a href="#/notifications" role="menuitem">${icon.bell}Notifications</a>
    <button type="button" data-pm="photo" role="menuitem">${icon.camera}${user.avatar_at ? 'Change profile photo' : 'Add a profile photo'}</button>
    ${user.avatar_at ? `<button type="button" data-pm="nophoto" role="menuitem">${icon.trash}Remove photo</button>` : ''}
    ${user.role === 'admin' ? `<a href="#/settings/team" role="menuitem">${icon.users}Agents</a><button type="button" data-pm="mt" role="menuitem">${icon.cog}Maintenance mode</button>` : ''}
    <button type="button" data-pm="nav" role="menuitem">${icon.edit || icon.cog}Customize menu</button>
    <button type="button" data-pm="out" role="menuitem">${icon.close}Log out</button>`;
  document.body.appendChild(m);
  const close = () => { m.remove(); document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close), 0);
  m.querySelector('[data-pm="nav"]').onclick = () => { close(); customizeMenu(user, () => location.reload()); };
  m.querySelector('[data-pm="out"]').onclick = logout;
  wireAvatars(m);
  m.querySelectorAll('[data-pm="photo"]').forEach((x) => { x.onclick = () => { close(); pickAvatar(user, initials(user)); }; });
  const np = m.querySelector('[data-pm="nophoto"]'); if (np) np.onclick = () => { close(); removeAvatar(user, initials(user)); };
  const mt = m.querySelector('[data-pm="mt"]');
  if (mt) mt.onclick = async () => {
    close();
    const st = await api('/api/auth/state').catch(() => ({}));
    const on = !st.maintenance?.on;
    const msg = on ? (prompt('Message agents and clients see while you work (optional):', 'The Hub is being updated. Back in a few minutes.') ?? null) : '';
    if (on && msg === null) return;
    try { await api('/api/maintenance', { method: 'PUT', body: { on, msg } }); toast(on ? 'Maintenance mode on. Only owners can use the Hub.' : 'Maintenance mode off.'); paintMaint(on); } catch (e) { toast(e.message, true); }
  };
  m.querySelector('[data-pm="status"]').onclick = (e) => { close(); statusMenu(document.querySelector('[data-stpill]') || b); };
}

// Owners see a strip while maintenance mode is on, so nobody forgets to turn it off.
export function paintMaint(on) {
  document.getElementById('mtbar')?.remove();
  if (!on) return;
  const b = document.createElement('div');
  b.id = 'mtbar'; b.className = 'mtbar';
  b.innerHTML = 'Maintenance mode is on: agents and clients see a pause screen. <button type="button">Turn it off</button>';
  b.querySelector('button').onclick = async () => { try { await api('/api/maintenance', { method: 'PUT', body: { on: false } }); paintMaint(false); toast('Maintenance mode off.'); } catch (e) { toast(e.message, true); } };
  document.body.appendChild(b);
}

// ---------- command palette ----------
const PAGES = [
  ['Dashboard', '#/'], ['Dialer', '#/phone'], ['Dial out', '#/phone/out'], ['Meetings: start or join Google Meet', '#/phone/meet'], ['Texts', '#/phone/texts'], ['Calls and voicemail', '#/phone/calls'],
  ['Recordings', '#/phone/recordings'], ['Agents', '#/agents'], ['Call analytics', '#/agents/analytics'], ['Pipeline', '#/pipeline'], ['My work', '#/work'],
  ['Hours', '#/work/hours'], ['Task guides', '#/work/guides'], ['Clients', '#/clients'], ['Client view', '#/clients/view'], ['Scan tool', '/scan.html'],
  ['Training', '#/training'], ['Scripts', '#/training/scripts'], ['Objection drills', '#/training/drills'], ['Slack', '#/slack'], ['Mail', '#/mail'],
  ['Calendar', '#/calendar'], ['New appointment', '#/calendar'], ['Files', '#/settings/files'], ['Team calendar', '#/settings'], ['Gmail', '#/google/mail'], ['Google Calendar', '#/google/calendar'], ['Google Drive', '#/google/drive'], ['Google setup', '#/google'], ['Notifications', '#/notifications'], ['Settings', '#/settings'], ['Team', '#/settings/team'],
  ['Payments', '#/payments', 'admin'], ['Phone setup', '#/phone/setup', 'admin'], ['Booking page', '/book.html'],
];
let paletteOpen = false;
async function palette(user) {
  if (paletteOpen) return;
  paletteOpen = true;
  const wrap = document.createElement('div');
  wrap.className = 'pal-wrap';
  wrap.innerHTML = `<div class="pal" role="dialog" aria-label="Search">
    <div class="pal-in">${icon.search}<input id="palq" placeholder="Type a lead, client, phone number or page" autocomplete="off"><kbd>Esc</kbd></div>
    <div class="pal-list" id="pall"></div>
    <div class="pal-foot"><span><kbd>&uarr;</kbd><kbd>&darr;</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>/</kbd> or <kbd>Ctrl K</kbd> from anywhere</span></div></div>`;
  document.body.appendChild(wrap);
  const input = $('#palq', wrap), list = $('#pall', wrap);
  let rows = [], sel = 0, seq = 0, cache = null;
  const close = () => { wrap.remove(); paletteOpen = false; document.removeEventListener('keydown', key, true); };
  const go = (r) => { close(); if (!r) return; if (r.href.startsWith('#')) location.hash = r.href; else location.href = r.href; };
  const draw = () => {
    list.innerHTML = rows.length ? rows.map((r, i) => `<button type="button" class="pal-row${i === sel ? ' is-sel' : ''}" data-i="${i}"><span class="pal-kind">${esc(r.kind)}</span><b>${esc(r.label)}</b><span class="small muted">${esc(r.sub || '')}</span></button>`).join('')
      : '<p class="small muted" style="padding:14px">Nothing found. Try a business name, a city or the last 4 digits of a phone.</p>';
    $$('.pal-row', list).forEach((b) => b.addEventListener('click', () => go(rows[Number(b.dataset.i)])));
    list.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' });
  };
  const search = async () => {
    const q = input.value.trim().toLowerCase();
    const my = ++seq;
    const pages = PAGES.filter(([n, , role]) => (!role || user.role === role) && (!q || n.toLowerCase().includes(q))).map(([label, href]) => ({ kind: 'Page', label, href }));
    rows = pages.slice(0, q ? 6 : 10); sel = 0; draw();
    if (q.length < 2) return;
    try {
      if (!cache) cache = await api('/api/clients').then((d) => d.clients || []).catch(() => []);
      const [leads] = await Promise.all([api(`/api/leads?q=${encodeURIComponent(q)}&limit=8`).then((d) => d.leads || []).catch(() => [])]);
      if (my !== seq) return;
      const qd = q.replace(/\D/g, '');
      const clients = cache.filter((c) => [c.name, c.business, c.city].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 5)
        .map((c) => ({ kind: 'Client', label: c.name || c.business, sub: [c.city, c.parent_id ? 'Location' : ''].filter(Boolean).join(' · '), href: `#/client/${c.id}/overview` }));
      const L = leads.slice(0, 8).map((l) => ({ kind: 'Lead', label: l.business, sub: [l.contact_name, l.city, l.phone, l.stage?.replace(/_/g, ' ')].filter(Boolean).join(' · '), href: `#/pipeline/${l.id}` }));
      rows = [...L, ...clients, ...pages.slice(0, 4)];
      if (qd.length >= 7) rows.unshift({ kind: 'Call', label: `Dial ${q}`, sub: 'Open Dial out with this number', href: `#/phone/out?n=${qd}` });
      sel = 0; draw();
    } catch { /* keep pages */ }
  };
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(rows.length - 1, sel + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(rows[sel]); }
  };
  document.addEventListener('keydown', key, true);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 140); });
  search();
  input.focus();
}
