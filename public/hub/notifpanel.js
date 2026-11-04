// The notifications panel that drops down from the bell: everything that happened, newest first, with filters.
import { $, $$, esc, api, toast, fmt, icon } from './core.js';
import { closeMenus } from './shell.js';

// One color and icon per kind, so the list reads at a glance (the same colors tag items around the Hub).
export const KIND = {
  call: ['Call', 'k-call', 'phone'], voicemail: ['Voicemail', 'k-vm', 'phone'], text: ['Text', 'k-text', 'msg'], task: ['Task', 'k-task', 'check'],
  client: ['Client', 'k-client', 'users'], lead: ['Lead', 'k-lead', 'chart'], money: ['Money', 'k-money', 'money'], meeting: ['Meeting', 'k-meet', 'cal'],
  slack: ['Slack', 'k-slack', 'slack'], update: ['Update', 'k-text', 'bell'],
};
const FILTERS = [['all', 'All', null], ['unread', 'Unread', null], ['calls', 'Calls', ['call', 'voicemail']], ['msgs', 'Messages', ['text', 'slack']], ['work', 'Work', ['task', 'client', 'meeting']], ['sales', 'Sales', ['lead', 'money']]];

export const notifRow = (n) => {
  const [label, cls, ic] = KIND[n.kind] || ['Update', 'k-text', 'bell'];
  return `<button type="button" class="np-row${n.read_at ? '' : ' is-new'}" data-id="${esc(n.id)}" data-url="${esc(n.url || '')}">
    <span class="np-ic ${cls}">${icon[ic] || icon.bell}</span>
    <span class="np-tx"><b>${esc(n.title)}</b>${n.body ? `<em>${esc(n.body)}</em>` : ''}<small><i class="np-tag ${cls}">${esc(label)}</i>${esc(fmt.ago(n.created_at))}</small></span>
    ${n.read_at ? '' : '<i class="np-dot" aria-label="Unread"></i>'}</button>`;
};
export function openUrl(u) {
  if (u.startsWith('/#/')) location.hash = u.slice(1); else if (u.startsWith('#/')) location.hash = u; else if (u.startsWith('/')) window.open(u, '_blank');
}

export async function notifPanel(anchor) {
  const wasOpen = document.querySelector('.np');
  closeMenus();
  if (wasOpen) return; // the bell toggles it
  const r = anchor.getBoundingClientRect();
  const p = document.createElement('div');
  p.className = 'np';
  p.dataset.menu = 'notifications'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Notifications');
  p.style.top = `${r.bottom + 8}px`; p.style.right = `${Math.max(8, window.innerWidth - r.right - 4)}px`;
  p.innerHTML = '<div class="np-head"><h3>Notifications</h3><button type="button" class="btn btn-ghost btn-sm" data-all>Mark all read</button></div><div class="np-tabs"></div><div class="np-list"><div class="skeleton" style="height:120px"></div></div><div class="np-foot"><a href="#/notifications">Open all notifications</a><a href="#/notifications">Settings</a></div>';
  document.body.appendChild(p);
  const close = () => { p.remove(); document.removeEventListener('click', away); document.removeEventListener('keydown', esc_); };
  const away = (e) => { if (!p.contains(e.target) && !anchor.contains(e.target)) close(); };
  const esc_ = (e) => { if (e.key === 'Escape') close(); };
  setTimeout(() => { document.addEventListener('click', away); document.addEventListener('keydown', esc_); }, 0);
  window.addEventListener('hashchange', close, { once: true });
  $$('.np-foot a', p).forEach((a) => a.addEventListener('click', close));
  let list = [], filter = 'all';
  const draw = () => {
    const f = FILTERS.find((x) => x[0] === filter);
    const rows = list.filter((n) => (filter === 'all' ? true : filter === 'unread' ? !n.read_at : f[2].includes(n.kind)));
    $('.np-tabs', p).innerHTML = FILTERS.map(([k, label]) => `<button type="button" data-f="${k}" class="${filter === k ? 'is-on' : ''}">${label}${k === 'unread' && list.some((n) => !n.read_at) ? ` <b>${list.filter((n) => !n.read_at).length}</b>` : ''}</button>`).join('');
    $('.np-list', p).innerHTML = rows.length ? rows.slice(0, 40).map(notifRow).join('') : `<p class="np-empty">${filter === 'all' ? 'Nothing yet. Calls, texts, tasks, leads and payments land here.' : 'Nothing in this view.'}</p>`;
    $$('[data-f]', p).forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; draw(); }));
    $$('.np-row', p).forEach((row) => row.addEventListener('click', async () => {
      await api('/api/notifications/read', { method: 'POST', body: { ids: [row.dataset.id] } }).catch(() => {});
      const u = row.dataset.url; close(); if (u) openUrl(u);
      document.dispatchEvent(new Event('rw-badges'));
    }));
  };
  try { list = (await api('/api/notifications')).notifications; } catch (e) { $('.np-list', p).innerHTML = `<p class="err-text" style="padding:14px">${esc(e.message)}</p>`; return; }
  draw();
  $('[data-all]', p).addEventListener('click', async () => {
    try { await api('/api/notifications/read', { method: 'POST', body: {} }); list.forEach((n) => { n.read_at = n.read_at || Date.now(); }); draw(); document.dispatchEvent(new Event('rw-badges')); } catch (e) { toast(e.message, true); }
  });
}
