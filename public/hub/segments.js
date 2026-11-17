// Fewer dropdowns (Nov 2026, V: "remove all unnecessary drop downs, the Hub is crowded"). One rule for the whole Hub instead of
// editing every page: a dropdown with 2 to 4 short choices shows as a row of tap buttons (one tap instead of open, scroll, pick),
// and a dropdown with only one choice is hidden (there is nothing to choose). Modeled on the segmented controls of iOS and of
// Linear's and Notion's filter bars. The real <select> stays in the page, hidden, and is still the source of truth: a tap sets its
// value and fires the same "change" event, so every page's own code keeps working untouched.
// A page can opt a dropdown out with class "keep-select" (or data-keep).
const MAX_CHOICES = 4;
const MAX_CHARS = 56; // all the choice names together, so the row stays one short line
const SKIP = '.keep-select, [data-keep], [multiple], .lb select, .callbar select, .pd select, .cmp-open select';

const label = (o) => o.textContent.replace(/\s+/g, ' ').trim();
function fits(sel) {
  if (sel.matches(SKIP) || sel.closest('.keep-select, [data-keep]')) return false;
  if (sel.querySelector('optgroup')) return false;
  const opts = [...sel.options].filter((o) => !o.hidden);
  if (opts.length < 2 || opts.length > MAX_CHOICES) return false;
  return opts.reduce((n, o) => n + label(o).length, 0) <= MAX_CHARS;
}

function sync(sel, seg) {
  seg.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.v === sel.value;
    if (b.classList.contains('is-on') !== on) { b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }
    b.disabled = sel.disabled || Boolean(sel.querySelector(`option[value="${CSS.escape(b.dataset.v)}"]`)?.disabled);
  });
}

function build(sel) {
  const seg = document.createElement('div');
  seg.className = 'seg seg-auto';
  seg.setAttribute('role', 'group');
  const name = sel.getAttribute('aria-label') || sel.closest('label')?.firstChild?.textContent?.trim() || sel.title || '';
  if (name) seg.setAttribute('aria-label', name);
  if (sel.title) seg.title = sel.title;
  for (const o of [...sel.options].filter((x) => !x.hidden)) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.v = o.value; b.textContent = label(o);
    seg.appendChild(b);
  }
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    e.preventDefault();
    if (sel.value === b.dataset.v) return;
    sel.value = b.dataset.v;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    sync(sel, seg);
  });
  sel.after(seg);
  sel.classList.add('seg-src');
  sel.__seg = seg;
  sync(sel, seg);
}

export function segmentSelects(root = document) {
  const view = root.getElementById ? root.getElementById('view') || root : root;
  view.querySelectorAll('select').forEach((sel) => {
    if (sel.__seg) {
      // The page changed the choices or the value since: rebuild or resync.
      const want = [...sel.options].filter((o) => !o.hidden).map((o) => `${o.value}\u0001${label(o)}`).join('\u0002');
      const have = [...sel.__seg.children].map((b) => `${b.dataset.v}\u0001${b.textContent}`).join('\u0002');
      if (want !== have || !sel.__seg.isConnected) { sel.__seg.remove(); sel.__seg = null; sel.classList.remove('seg-src'); }
      else { sync(sel, sel.__seg); return; }
    }
    const one = sel.options.length === 1 && !sel.matches(SKIP) && !sel.required;
    sel.classList.toggle('seg-one', one); // a single choice: nothing to pick, hide it
    if (!one && fits(sel)) build(sel);
  });
}

let wired = false;
export function wireSegments() {
  segmentSelects();
  if (wired) return;
  wired = true;
  let t = null;
  const later = () => { if (!t) t = setTimeout(() => { t = null; segmentSelects(); }, 60); };
  new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  // Code that sets a dropdown's value directly does not fire an event: resync after every tap or key.
  document.addEventListener('click', later, true);
  document.addEventListener('change', later, true);
  document.addEventListener('keyup', later, true);
}
