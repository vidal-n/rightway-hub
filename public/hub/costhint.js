// Shows the price next to every button that costs money (owners only). A button carries an empty
// <span class="cost-hint" data-cost="<price id>" data-n="<count>"></span>; this fills it in, including for markup drawn later.
// "research_call" is the price of researching one lead at the depth set for reps, so it follows the owner's setting.
import { api } from './core.js';
import { PRICES, money } from '/js/pricing.js';

let callUsd = null, asked = false;
function loadDepth() {
  if (asked) return;
  asked = true;
  api('/api/research/status').then((r) => { const c = r.depths?.[r.callDepth]?.cost || 0; callUsd = c ? c + 0.002 : 0; fill(document.body); }).catch(() => { callUsd = 0.02; });
}
function fill(root) {
  for (const el of root.querySelectorAll('[data-cost]:not([data-costed])')) {
    const id = el.dataset.cost, n = Number(el.dataset.n || 1);
    let usd;
    if (id === 'research_call') { loadDepth(); if (callUsd == null) continue; usd = callUsd; } else usd = PRICES[id]?.usd;
    if (usd == null) { el.dataset.costed = '1'; continue; }
    el.dataset.costed = '1';
    el.textContent = usd ? `about ${money(usd * n)}` : 'free';
    el.title = usd ? `${n > 1 ? `${money(usd)} each. ` : ''}An estimate. Settings, Spending shows the real total.` : 'No outside bill';
  }
}
export function startCostHints() {
  if (window.__costHints) return;
  window.__costHints = true;
  fill(document.body);
  let t = 0;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => fill(document.body), 30); }).observe(document.body, { childList: true, subtree: true });
}
