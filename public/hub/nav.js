// The Hub menu: each person's own order and hidden items, a side menu on computers and a bottom bar on phones and tablets that
// shows as many items as fit the screen (the rest under More), and notification dots everywhere ([data-badge] elements, the menu,
// and the app icon).
import { $, $$, esc, api, toast, modal, icon } from './core.js';

export const NAV = [
  ['home', '#/', 'dash', 'Dashboard'], ['phone', '#/phone', 'phone', 'Phone'], ['pipeline', '#/pipeline', 'chart', 'Pipeline'], ['calendar', '#/calendar', 'cal', 'Calendar'],
  ['agents', '#/agents', 'headset', 'Agents'], ['automations', '#/automations', 'send', 'Automations'],
  ['work', '#/work', 'check', 'My work'], ['clients', '#/clients', 'users', 'Clients'], ['scan', '/scan.html', 'grid', 'Scan tool'],
  ['training', '#/training', 'book', 'Training'], ['vault', '#/vault', 'key', 'Vault'], ['slack', '#/slack', 'slack', 'Slack'], ['google', '#/google', 'apps', 'Google'],
  ['payments', '#/payments', 'money', 'Payments', 'admin'], ['alerts', '#/alerts', 'bell', 'Alerts'], ['settings', '#/settings', 'cog', 'Settings'],
];
// The rail groups the menu by the job: selling, delivering, the team, and running the business.
export const GROUPS = [['sell', 'Sell'], ['deliver', 'Deliver'], ['team', 'Team'], ['run', 'Run']];
const GROUP_OF = { home: 'sell', phone: 'sell', pipeline: 'sell', calendar: 'sell', agents: 'sell', automations: 'sell', vault: 'team', work: 'deliver', clients: 'deliver', scan: 'deliver', training: 'team', slack: 'team', google: 'team', payments: 'run', alerts: 'run', settings: 'run' };
export const groupOf = (k) => GROUP_OF[k] || 'run';
// Which dot belongs to which menu item.
const BADGE_KEY = { work: 'work', slack: 'slack', phone: 'phone', pipeline: 'pipeline', alerts: 'alerts' };
const ALIAS = { dialer: 'phone', inbox: 'phone', team: 'settings', clientview: 'clients', client: 'clients' };
export const activeKey = (k) => ALIAS[k] || k;

let prefs = null;
try { prefs = JSON.parse(localStorage.getItem('rw-nav') || 'null'); } catch { prefs = null; }
let loaded = false;
async function loadPrefs() {
  if (loaded) return prefs;
  loaded = true;
  try { const r = await api('/api/me/nav'); if (r.prefs) { prefs = r.prefs; try { localStorage.setItem('rw-nav', JSON.stringify(prefs)); } catch { /* ignore */ } } } catch { /* keep local */ }
  return prefs;
}

export function navItems(user) {
  const allowed = NAV.filter((n) => !n[4] || user.role === n[4]);
  const order = prefs?.order || [];
  const hidden = new Set(prefs?.hidden || []);
  const sorted = [...allowed].sort((a, b) => {
    const ia = order.indexOf(a[0]), ib = order.indexOf(b[0]);
    return (ia < 0 ? 999 + NAV.indexOf(a) : ia) - (ib < 0 ? 999 + NAV.indexOf(b) : ib);
  });
  return { shown: sorted.filter((n) => !hidden.has(n[0]) || n[0] === 'settings'), all: sorted, hidden };
}

const link = ([k, href, ic, label], active, cls = '') => `<a href="${href}" data-nav="${k}" class="${cls}${active === k ? ' is-active' : ''}">${icon[ic] || ''}<span>${label}</span>${BADGE_KEY[k] ? `<b class="nbadge" data-badge="${BADGE_KEY[k]}" hidden></b>` : ''}</a>`;
export const sideLinks = (user, active) => navItems(user).shown.map((n) => link(n, active)).join('');

// Bottom bar: as many items as fit, the rest under More (which opens the full menu).
export function renderBottom(bar, user, active, openMore) {
  if (!bar) return;
  const items = navItems(user).shown;
  const fit = Math.max(3, Math.min(7, Math.floor(window.innerWidth / 78)));
  const showMore = items.length > fit;
  const first = showMore ? items.slice(0, fit - 1) : items;
  // Keep the open page in the bar when it would fall under More.
  const cur = items.find((n) => n[0] === active);
  if (showMore && cur && !first.includes(cur)) first[first.length - 1] = cur;
  bar.innerHTML = first.map((n) => link(n, active, 'bb-item')).join('') + (showMore ? `<button type="button" class="bb-item" id="bb-more">${icon.menu}<span>More</span><b class="nbadge" data-badge="more" hidden></b></button>` : '');
  bar.style.setProperty('--n', String(first.length + (showMore ? 1 : 0)));
  $('#bb-more', bar)?.addEventListener('click', openMore);
  bar.dataset.under = JSON.stringify(showMore ? items.filter((n) => !first.includes(n)).map((n) => n[0]) : []);
  paint(last);
}

export function wireNav(root, user, active, openMore) {
  const bar = $('#bbar', root);
  const draw = () => renderBottom(bar, user, active, openMore);
  draw();
  let t;
  const onResize = () => { clearTimeout(t); t = setTimeout(draw, 120); };
  window.addEventListener('resize', onResize);
  window.addEventListener('hashchange', () => window.removeEventListener('resize', onResize), { once: true });
  // Server copy of the order may differ from this device: redraw once it arrives.
  if (!loaded) loadPrefs().then(() => { const side = $('#side nav', root); if (side) import('./shell.js').then((m) => { side.innerHTML = m.railLinks(user, active); paint(last); }); draw(); paint(last); });
  refreshBadges();
}

// ---------- dots ----------
let last = null;
let lastAt = 0;
let timer = null;
function paint(b) {
  if (!b) return;
  $$('[data-badge]').forEach((el) => {
    const k = el.dataset.badge;
    let n = b[k] || 0;
    if (k === 'more') {
      const under = JSON.parse($('#bbar')?.dataset.under || '[]');
      n = under.reduce((s, key) => s + (BADGE_KEY[key] ? b[BADGE_KEY[key]] || 0 : 0), 0);
    }
    el.hidden = !n;
    el.textContent = n > 99 ? '99+' : String(n);
  });
  try { if ('setAppBadge' in navigator) { if (b.total) navigator.setAppBadge(b.total); else navigator.clearAppBadge(); } } catch { /* ignore */ }
}
export async function refreshBadges(force = false) {
  if (!force && last && Date.now() - lastAt < 15e3) { paint(last); return last; }
  try { last = await api('/api/badges'); lastAt = Date.now(); paint(last); } catch { /* ignore */ }
  if (!timer) {
    timer = setInterval(() => { if (!document.hidden) refreshBadges(true); }, 45e3);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshBadges(true); });
  }
  return last;
}
export const badgeCache = () => last;

// ---------- customize ----------
export function customizeMenu(user, onSaved) {
  const { all, hidden } = navItems(user);
  let order = all.map((n) => n[0]);
  const off = new Set(hidden);
  const m = modal(`<div class="card-head"><h2>Customize the menu</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <p class="small muted">Pick what shows and in what order. On phones and tablets, the first items go in the bottom bar and the rest under More.</p>
    <ul class="list cust-list" id="cust"></ul>
    <div class="row end" style="margin-top:12px"><button class="btn btn-ghost" id="cust-reset">Reset</button><button class="btn btn-primary" id="cust-save">Save</button></div>`);
  const draw = () => {
    $('#cust', m.el).innerHTML = order.map((k, i) => {
      const n = all.find((x) => x[0] === k);
      return `<li class="item" data-k="${k}"><label class="row" style="gap:10px"><input type="checkbox" ${off.has(k) ? '' : 'checked'}${k === 'settings' ? ' disabled' : ''}>${icon[n[2]] || ''}<span>${esc(n[3])}</span></label>
        <span class="spacer"></span><button class="icon-btn" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">&uarr;</button><button class="icon-btn" data-down="${i}" ${i === order.length - 1 ? 'disabled' : ''} aria-label="Move down">&darr;</button></li>`;
    }).join('');
  };
  draw();
  $('#cust', m.el).addEventListener('click', (e) => {
    const up = e.target.closest('[data-up]'), down = e.target.closest('[data-down]');
    if (up) { const i = Number(up.dataset.up); [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); }
    if (down) { const i = Number(down.dataset.down); [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(); }
  });
  $('#cust', m.el).addEventListener('change', (e) => { const k = e.target.closest('[data-k]')?.dataset.k; if (k) { if (e.target.checked) off.delete(k); else off.add(k); } });
  const save = async (body) => {
    try {
      const r = await api('/api/me/nav', { method: 'PUT', body });
      prefs = r.prefs;
      try { if (prefs) localStorage.setItem('rw-nav', JSON.stringify(prefs)); else localStorage.removeItem('rw-nav'); } catch { /* ignore */ }
      m.close(); toast('Menu saved'); onSaved?.();
    } catch (err) { toast(err.message, true); }
  };
  $('#cust-save', m.el).addEventListener('click', () => save({ order, hidden: [...off] }));
  $('#cust-reset', m.el).addEventListener('click', () => save({ reset: true }));
}
