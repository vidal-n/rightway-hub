// Rows of filter chips fold into one dropdown button when they would take up room (Nov 2026 overhaul). Modeled on the filter
// popovers of Linear, Attio and Close Smart Views: one button shows what is picked, a tap opens the full list.
// Nothing is copied: the original row (with its own click handlers) is shown as the popover, so every page keeps working.
// A row folds when it has 5 or more choices on any screen, or 3 or more on a phone or tablet.
const ROWS = '.chips, .db-presets, .tz-tabs, .tiers, .sp-chips, .sc-chips, .db-chips, .gm-chips, .sl-chips';
const CHOICE = ':scope > button, :scope > a, :scope > label';
let open = null;

function labelOf(row) {
  const cap = row.querySelector(':scope > .small, :scope > span:not([class*=badge])');
  const aria = row.getAttribute('aria-label');
  return (cap?.textContent || aria || 'Filter').replace(/:\s*$/, '').trim();
}
function picked(row) {
  const on = [...row.querySelectorAll(CHOICE)].filter((b) => b.matches('.on, .is-on, .is-active, [aria-pressed=true]') || b.querySelector('input:checked'));
  if (!on.length) return 'Any';
  const names = on.map((b) => b.textContent.replace(/\s+/g, ' ').trim());
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
}
function close() {
  if (!open) return;
  open.row.classList.remove('cmp-open');
  open.btn.setAttribute('aria-expanded', 'false');
  open = null;
}
function place(row, btn) {
  const r = btn.getBoundingClientRect();
  row.style.left = `${Math.max(8, Math.min(r.left, innerWidth - Math.min(360, innerWidth * 0.92) - 8))}px`;
  const below = innerHeight - r.bottom;
  if (below < 240 && r.top > below) { row.style.top = ''; row.style.bottom = `${innerHeight - r.top + 6}px`; } else { row.style.bottom = ''; row.style.top = `${r.bottom + 6}px`; }
}

export function compactRows(root = document) {
  const small = matchMedia('(max-width: 1024px)').matches;
  root.querySelectorAll(ROWS).forEach((row) => {
    if (row.closest('.modal, .pmenu, .np, .callbar, .pd, .cmp-open')) return;
    const n = row.querySelectorAll(CHOICE).length;
    const want = n >= 5 || (small && n >= 3);
    const btn = row.previousElementSibling?.classList.contains('cmp-btn') ? row.previousElementSibling : null;
    if (!want) { if (btn) { btn.remove(); row.classList.remove('cmp-on', 'cmp-open'); } return; }
    if (btn) { const v = btn.querySelector('.cmp-v'), now = picked(row); if (v.textContent !== now) v.textContent = now; return; }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cmp-btn'; b.setAttribute('aria-haspopup', 'listbox'); b.setAttribute('aria-expanded', 'false');
    b.innerHTML = `<span class="cmp-l"></span><span class="cmp-v"></span>`;
    b.querySelector('.cmp-l').textContent = `${labelOf(row)}:`;
    b.querySelector('.cmp-v').textContent = picked(row);
    if (row.dataset.sec) b.dataset.secFor = row.dataset.sec;
    row.before(b);
    row.classList.add('cmp-on');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const was = open?.row === row;
      close();
      if (was) return;
      place(row, b);
      row.classList.add('cmp-open');
      b.setAttribute('aria-expanded', 'true');
      open = { row, btn: b };
      import('./sound.js').then((m) => m.play('tick')).catch(() => {});
    });
    // A pick inside the list updates the button; pages that redraw replace both anyway.
    row.addEventListener('click', () => setTimeout(() => { if (b.isConnected) b.querySelector('.cmp-v').textContent = picked(row); }, 30));
  });
}

let wired = false;
export function wireCompact() {
  compactRows();
  const vs = document.getElementById('vscroll');
  if (vs && !vs.__rwCmp) { vs.__rwCmp = true; vs.addEventListener('scroll', close, { passive: true }); }
  if (wired) return;
  wired = true;
  let t;
  new MutationObserver(() => { if (!t) t = setTimeout(() => { t = null; compactRows(); }, 80); }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', (e) => { if (open && !open.row.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  addEventListener('resize', () => { close(); compactRows(); });
  addEventListener('hashchange', close);
}
