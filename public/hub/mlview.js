// Mirror and label on screen (Nov 2026): the rules, what to say to each kind of answer, and the 46 objection catalog with the funnel
// for yes, no and a dodge. Used by call prep (dialer and lead panel) and Training. Content: public/js/rebuttals.js (pure).
import { esc } from './core.js';
import { GROUPS } from '/js/rebuttals.js';

const row = (k, t) => (t ? `<div class="ml-step"><b>${k}</b><span>${esc(t)}</span></div>` : '');

// The mirror, label and question to say first, above an objection's answer.
export function mlLead(ml) {
  if (!ml) return '';
  return `<div class="ml-lead"><span class="ml-tag">Mirror</span> ${esc(ml.mirror)} <i>(pause)</i><br><span class="ml-tag">Label</span> ${esc(ml.label)}<br><span class="ml-tag">Ask</span> ${esc(ml.ask)}</div>`;
}

export function catalogHtml(s, { open = false } = {}) {
  const list = s.catalog || [];
  return `<details class="obj ml-rules"${open ? ' open' : ''}><summary>How to mirror and label</summary><ol>${(s.mlRules || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ol></details>
    ${GROUPS.map(([g, name]) => {
      const items = list.filter((x) => x.group === g);
      return items.length ? `<p class="ml-group">${esc(name)}</p>${items.map((x) => `<details class="obj ml-item"><summary>"${esc(x.q)}"</summary>
        <p class="ml-say">${esc(x.say)}</p>${row('If yes', x.yes)}${row('If no', x.no)}${row('If they dodge', x.dodge)}${row('Exit', x.exit)}</details>`).join('')}` : '';
    }).join('')}`;
}
