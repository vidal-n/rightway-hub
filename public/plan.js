// Quarterly plan page: /plan.html#<token>. Read only.
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function render(p) {
  const d = p.data || {};
  const q = p.quarter.replace('-', ' ');
  document.title = `${p.client.name}: ${q} plan`;
  $('#qp').innerHTML = `
    <div class="qp-head"><span><img class="logo-light" src="/brand/rightway-logo-light.svg" alt="Rightway Growth"><img class="logo-dark" src="/brand/rightway-logo-dark.svg" alt="Rightway Growth"></span>
      <button class="btn btn-ghost btn-sm no-print" id="qpprint">Save as PDF</button></div>
    <section class="qp-hero"><p class="eyebrow">Quarterly plan</p><h1>${esc(q)}</h1><p>${esc(p.client.name)}</p></section>
    ${d.notes ? `<section class="qp-notes"><b>From your Rightway team</b><br>${esc(d.notes)}</section>` : ''}
    ${d.goals?.length ? `<section class="card"><h2>Goals for the quarter</h2><table class="qp-goalt"><thead><tr><th>Goal</th><th>Now</th><th>Target</th></tr></thead><tbody>
      ${d.goals.map((g) => `<tr><td>${esc(g.label)}</td><td>${esc(g.now)}</td><td>${esc(g.target)}</td></tr>`).join('')}</tbody></table></section>` : ''}
    ${d.focus?.length ? `<section class="card"><h2>Where we focus</h2><ul>${d.focus.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></section>` : ''}
    ${d.months?.length ? `<div class="qp-three">${d.months.map((m) => `<section class="card"><h2>${esc(m.label)}</h2>${m.items.length ? `<ul>${m.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="muted">To be set.</p>'}</section>`).join('')}</div>` : ''}
    <p class="small muted" style="text-align:center">Prepared by Rightway Growth. We review this together at each monthly meeting.</p>`;
  $('#qpprint').addEventListener('click', () => window.print());
}

(async () => {
  try {
    const res = await fetch(`/api/public/plan/${encodeURIComponent(location.hash.slice(1))}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'This plan could not be loaded.');
    render(data);
  } catch (e) {
    $('#qp').innerHTML = `<div class="card"><h2>Plan not found</h2><p class="muted">${esc(e.message)}</p></div>`;
  }
})();
