// The (i) next to every number (Nov 2026 overhaul): tap it to see what the number is, how it is worked out, what data it covers,
// what good looks like, why it matters, when it misleads, and where to act. Definitions live in public/js/metrics.js.
// Modeled on Stripe's and HubSpot's metric tooltips and AgencyAnalytics' metric descriptions. Labels are matched by their words,
// so new pages get explainers without code; a `data-metric="<key>"` attribute picks one on purpose.
import { metricFor, metricByKey } from '../js/metrics.js';
import { esc } from './core.js';

const LABELS = '.stat-label, .ins-tile > span, .db-tile > span, .card-head > h2, .card-head > h3, .tile .stat-label, [data-metric]';
let pop = null;

function closePop() { if (!pop) return; pop.btn?.setAttribute('aria-expanded', 'false'); pop.el.remove(); pop = null; }
function show(btn, m) {
  const was = pop?.btn === btn;
  closePop();
  if (was) return;
  const el = document.createElement('div');
  el.className = 'xpop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', m.name);
  el.innerHTML = `<button type="button" class="xp-x" aria-label="Close">&times;</button><h4>${esc(m.name)}</h4><p class="xp-what">${esc(m.what)}</p><dl>
    <dt>How it is worked out</dt><dd class="xp-f">${esc(m.formula)}</dd>
    <dt>What data it covers</dt><dd>${esc(m.scope)}</dd>
    <dt>What good looks like</dt><dd>${esc(m.bench)}</dd>
    <dt>Why it matters</dt><dd>${esc(m.why)}</dd>
    <dt>When it can mislead</dt><dd class="xp-miss">${esc(m.misleads)}</dd>
    ${m.go ? `<dt>Act on it</dt><dd><a href="${esc(m.go)}">Open the page</a></dd>` : ''}</dl>`;
  document.body.appendChild(el);
  const r = btn.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = `${Math.max(10, Math.min(r.left - 12, innerWidth - w - 10))}px`;
  el.style.top = `${r.bottom + h + 12 < innerHeight ? r.bottom + 8 : Math.max(10, r.top - h - 8)}px`;
  btn.setAttribute('aria-expanded', 'true');
  pop = { el, btn };
  el.querySelector('.xp-x').onclick = closePop;
  el.querySelector('a')?.addEventListener('click', closePop);
  import('./sound.js').then((s) => s.play('tick')).catch(() => {});
}

export function addExplainers(root = document.getElementById('view')) {
  if (!root) return;
  root.querySelectorAll(LABELS).forEach((lab) => {
    if (lab.dataset.xi || lab.closest('.modal, .xpop, .pmenu, .callbar')) return;
    lab.dataset.xi = '1';
    const m = lab.dataset.metric ? metricByKey(lab.dataset.metric) : metricFor(lab.textContent);
    if (!m) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'xi'; b.textContent = 'i';
    b.setAttribute('aria-label', `What is ${m.name}?`); b.setAttribute('aria-expanded', 'false'); b.title = `What is ${m.name}?`;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); show(b, m); });
    lab.appendChild(b);
  });
}

let wired = false;
export function wireExplain() {
  addExplainers();
  if (wired) return;
  wired = true;
  let t;
  new MutationObserver(() => { if (!t) t = setTimeout(() => { t = null; addExplainers(); }, 90); }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', (e) => { if (pop && !pop.el.contains(e.target) && e.target !== pop.btn) closePop(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
  addEventListener('hashchange', closePop);
}
