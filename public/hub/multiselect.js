// A dropdown with tick boxes (multi select) that works with a finger on an iPad. Used by the Lead finder.
// multiSelect(host, { options: [{value, label}], selected, label, onChange }) returns { get(), set(values), setOptions(options, selected), el }.
import { esc } from './core.js';

let openPop = null;
// Close the open list when the person taps anywhere else.
document.addEventListener('pointerdown', (e) => {
  if (openPop && !openPop.contains(e.target)) { openPop.hidden = true; openPop = null; }
}, true);

export function multiSelect(host, { options = [], selected = [], label = 'Choose', onChange } = {}) {
  let opts = options.slice();
  let picked = new Set(selected);
  const wrap = document.createElement('div');
  wrap.className = 'ms';
  wrap.innerHTML = `<button type="button" class="ms-btn"></button>
    <div class="ms-pop" hidden>
      <div class="ms-tools"><input class="ms-q" type="search" placeholder="Search"><button type="button" class="btn btn-ghost btn-sm" data-all>All</button><button type="button" class="btn btn-ghost btn-sm" data-none>None</button></div>
      <div class="ms-list"></div>
    </div>`;
  host.appendChild(wrap);
  const btn = wrap.querySelector('.ms-btn');
  const pop = wrap.querySelector('.ms-pop');
  const list = wrap.querySelector('.ms-list');
  const q = wrap.querySelector('.ms-q');

  const summary = () => {
    const n = picked.size;
    const names = opts.filter((o) => picked.has(o.value)).map((o) => o.label);
    btn.innerHTML = `<span class="ms-sum">${n ? esc(n <= 2 ? names.join(', ') : `${n} selected`) : esc(label)}</span><span class="ms-n">${n || ''}</span>`;
  };
  const drawList = () => {
    const needle = q.value.trim().toLowerCase();
    const shown = opts.filter((o) => !needle || o.label.toLowerCase().includes(needle));
    list.innerHTML = shown.length
      ? shown.map((o) => `<label class="ms-opt"><input type="checkbox" value="${esc(o.value)}"${picked.has(o.value) ? ' checked' : ''}><span>${esc(o.label)}</span>${o.hint ? `<span class="ms-hint">${esc(o.hint)}</span>` : ''}</label>`).join('')
      : '<p class="small muted" style="margin:8px">Nothing matches.</p>';
  };
  const emit = () => { summary(); onChange?.(get()); };
  const get = () => opts.map((o) => o.value).filter((v) => picked.has(v));

  btn.addEventListener('click', () => {
    const open = pop.hidden;
    if (openPop && openPop !== pop) openPop.hidden = true;
    pop.hidden = !open;
    openPop = open ? pop : null;
    if (open) { drawList(); setTimeout(() => q.focus(), 0); }
  });
  q.addEventListener('input', drawList);
  list.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type=checkbox]'); if (!cb) return;
    if (cb.checked) picked.add(cb.value); else picked.delete(cb.value);
    emit();
  });
  wrap.querySelector('[data-all]').addEventListener('click', () => { opts.forEach((o) => picked.add(o.value)); drawList(); emit(); });
  wrap.querySelector('[data-none]').addEventListener('click', () => { picked = new Set(); drawList(); emit(); });
  summary();

  return {
    el: wrap,
    get,
    set(values) { picked = new Set(values); drawList(); summary(); },
    // New list of options. Keeps the ticks that still exist, plus any `selected` given.
    setOptions(next, selectedNow) {
      opts = next.slice();
      const keep = new Set(opts.map((o) => o.value));
      picked = new Set([...picked, ...(selectedNow || [])].filter((v) => keep.has(v)));
      drawList(); summary();
    },
  };
}
