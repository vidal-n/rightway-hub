// Hover card: rest the pointer on a lead (board card, list row, Up next) and everything known about them shows beside it.
// One card for the whole page, never blocks clicks (pointer-events none), skipped on touch screens.
import { esc } from './core.js';

export function hoverCards(host, { selector, build, delay = 350 }) {
  if (!host || (matchMedia && matchMedia('(hover: none)').matches)) return () => {};
  let card = null, timer = null, current = null;
  const hide = () => { clearTimeout(timer); timer = null; current = null; card?.remove(); card = null; };
  const place = (el) => {
    if (!card) return;
    const r = el.getBoundingClientRect(), c = card.getBoundingClientRect();
    let x = r.right + 10;
    if (x + c.width > innerWidth - 8) x = r.left - c.width - 10;
    if (x < 8) x = Math.max(8, Math.min(innerWidth - c.width - 8, r.left + 12));
    let y = r.top;
    if (y + c.height > innerHeight - 8) y = innerHeight - c.height - 8;
    card.style.left = `${Math.round(x)}px`; card.style.top = `${Math.round(Math.max(8, y))}px`;
  };
  const show = (el) => {
    const html = build(el);
    if (!html) return;
    hide();
    current = el;
    card = document.createElement('div');
    card.className = 'hcard';
    card.setAttribute('role', 'tooltip');
    card.innerHTML = html;
    document.body.appendChild(card);
    place(el);
  };
  const over = (e) => {
    const el = e.target.closest?.(selector);
    if (!el || el === current) return;
    clearTimeout(timer);
    timer = setTimeout(() => show(el), card ? 120 : delay);
  };
  const out = (e) => {
    const el = e.target.closest?.(selector);
    if (!el) return;
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    hide();
  };
  host.addEventListener('mouseover', over);
  host.addEventListener('mouseout', out);
  host.addEventListener('mousedown', hide);
  host.addEventListener('dragstart', hide);
  addEventListener('scroll', hide, true);
  addEventListener('keydown', hide);
  return () => { hide(); host.removeEventListener('mouseover', over); host.removeEventListener('mouseout', out); host.removeEventListener('mousedown', hide); host.removeEventListener('dragstart', hide); removeEventListener('scroll', hide, true); removeEventListener('keydown', hide); };
}

// rows: [{k, v, tag, tone}], head: {initials, name, role, business, badges: [text]}
export function hoverHtml({ initials = '#', name = '', role = '', business = '', badges = [], rows = [], foot = '' }) {
  const list = rows.filter((r) => r && r.v);
  return `<div class="hc-head"><span class="pd-av">${esc(initials)}</span><div style="min-width:0"><b class="hc-name">${esc(name || business)}${role ? ` <em>${esc(role)}</em>` : ''}</b>${name ? `<span class="hc-biz">${esc(business)}</span>` : ''}</div></div>
    ${badges.length ? `<div class="hc-badges">${badges.filter(Boolean).map((b) => `<span>${esc(b)}</span>`).join('')}</div>` : ''}
    <dl class="hc-rows">${list.map((r) => `<div><dt>${esc(r.k)}</dt><dd>${esc(r.v)}${r.tag ? `<em class="tag ${esc(r.tone || '')}">${esc(r.tag)}</em>` : ''}</dd></div>`).join('')}</dl>${foot ? `<p class="hc-foot">${esc(foot)}</p>` : ''}`;
}
