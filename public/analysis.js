// The prospect's competitor analysis: /analysis.html#<token>. Read only.
import { packHtml } from './js/packview.js';
const host = document.getElementById('pk');
const t = location.hash.replace(/^#/, '');
(async () => {
  try {
    const r = await fetch(`/api/public/analysis/${encodeURIComponent(t)}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'This link is not valid.');
    document.title = `Competitor analysis: ${d.pack.business}`;
    host.innerHTML = `<div class="pk-top"><picture><source media="(prefers-color-scheme: dark)" srcset="/brand/rightway-logo-dark.svg"><img  src="/brand/rightway-logo-light.svg" alt="Rightway Growth"></picture></div>${packHtml(d.pack)}`;
  } catch (e) {
    host.innerHTML = `<div class="card"><p>${String(e.message).replace(/[<>&]/g, '')}</p></div>`;
  }
})();
