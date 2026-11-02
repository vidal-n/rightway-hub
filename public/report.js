// Client monthly report page: /report.html#<token>. Read only; the data is a snapshot saved when the report was made.
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const day = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const COLORS = { top3: '#23B07E', page1: '#F2B544', page2: '#E8833A', none: '#D64545', nodata: '#C9D3CF' };
const band = (r) => (r === -1 ? 'nodata' : r === 0 ? 'none' : r <= 3 ? 'top3' : r <= 10 ? 'page1' : 'page2');

// Grid of colored squares, one per search spot, the business address in the middle.
function grid(ranks, size, label) {
  if (!ranks || !size) return '';
  const cell = 40, gap = 4, w = size * cell + (size - 1) * gap;
  const mid = Math.floor((size * size) / 2);
  const cells = ranks.map((r, i) => {
    const x = (i % size) * (cell + gap), y = Math.floor(i / size) * (cell + gap);
    const b = band(r);
    const txt = r > 0 ? String(r) : r === 0 ? '20+' : '';
    const ink = b === 'page1' || b === 'page2' || b === 'nodata' ? '#0F1B17' : '#fff';
    return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="8" fill="${COLORS[b]}"${i === mid ? ' stroke="#0F1B17" stroke-width="3"' : ''}/>
      ${size <= 9 && txt ? `<text x="${x + cell / 2}" y="${y + cell / 2 + 5}" text-anchor="middle" font-size="${txt.length > 2 ? 12 : 15}" font-weight="700" font-family="Instrument Sans, Arial, sans-serif" fill="${ink}">${txt}</text>` : ''}`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${w}" role="img" aria-label="${esc(label)}">${cells}</svg>`;
}

const change = (now, then, { lowerBetter = false, unit = '', words = ['better', 'worse'] } = {}) => {
  if (now == null || then == null) return '';
  const d = Math.round((now - then) * 10) / 10;
  if (!d) return '<i class="muted">same as before</i>';
  const good = lowerBetter ? d < 0 : d > 0;
  return `<i class="${good ? 'good-text' : 'bad-text'}">${good ? words[0] : words[1]} by ${Math.abs(d)}${unit}</i>`;
};

function keywordCard(k) {
  const start = k.start && k.start.ranks ? k.start : null;
  return `<section class="card">
    <div class="card-head"><div><p class="eyebrow">Google Maps search</p><h2>"${esc(k.keyword)}"</h2></div>
      <span class="badge gray">${k.now.size} x ${k.now.size} spots, ${k.now.radius} mi</span></div>
    <div class="rp-row3">
      <div><b>${k.now.top3Pct}%</b><span>of your area sees you in the top 3</span><br>${change(k.now.top3Pct, k.before?.top3Pct, { unit: ' pts', words: ['up', 'down'] })}</div>
      <div><b>${k.now.avgRank ?? '-'}</b><span>average position</span><br>${change(k.now.avgRank, k.before?.avgRank, { lowerBetter: true })}</div>
      <div><b>${k.now.centerRank ? `#${k.now.centerRank}` : '20+'}</b><span>at your address</span><br>${k.before && k.before.centerRank !== k.now.centerRank ? `<i class="muted">was ${k.before.centerRank ? `#${k.before.centerRank}` : '20+'}</i>` : ''}</div>
    </div>
    <div class="rp-maps">
      ${start ? `<figure><figcaption>Where you started, ${esc(day(start.date))}: top 3 in ${start.top3Pct}%</figcaption>${grid(start.ranks, start.size, `Starting map for ${k.keyword}`)}</figure>` : ''}
      <figure><figcaption>${start ? 'Now' : 'This month'}, ${esc(day(k.now.date))}: top 3 in ${k.now.top3Pct}%</figcaption>${grid(k.now.ranks, k.now.size, `Current map for ${k.keyword}`)}</figure>
    </div>
  </section>`;
}

function render(d, note) {
  const k0 = d.keywords[0];
  const rev = d.reviews;
  const legend = `<div class="legend small"><span><i style="background:${COLORS.top3}"></i>Top 3</span><span><i style="background:${COLORS.page1}"></i>4 to 10</span><span><i style="background:${COLORS.page2}"></i>11 to 20</span><span><i style="background:${COLORS.none}"></i>Not in top 20</span><span>Outlined square: your address</span></div>`;
  document.title = `${d.client.name}: ${d.monthLabel} report`;
  $('#rp').innerHTML = `
    <div class="rp-head"><span><img class="logo-light" src="/brand/rightway-logo-light.svg" alt="Rightway Growth"><img class="logo-dark" src="/brand/rightway-logo-dark.svg" alt="Rightway Growth"></span>
      <button class="btn btn-ghost btn-sm no-print" id="rpprint">Save as PDF</button></div>
    <section class="rp-hero"><p class="eyebrow">Monthly report</p><h1>${esc(d.monthLabel)}</h1><p>${esc(d.client.name)}${d.client.planName ? `, ${esc(d.client.planName)} plan` : ''}</p></section>
    ${note ? `<section class="rp-note"><b>From your Rightway team</b><br>${esc(note)}</section>` : ''}
    <section class="rp-kpis">
      <div class="rp-kpi"><b>${k0 ? `${k0.now.top3Pct}%` : '-'}</b><span>${k0 ? `top 3 coverage for "${esc(k0.keyword)}"` : 'no map scan yet'}</span>${k0?.start ? change(k0.now.top3Pct, k0.start.top3Pct, { unit: ' pts since you started', words: ['up', 'down'] }) : ''}</div>
      <div class="rp-kpi"><b>${rev.count ?? '-'}</b><span>Google reviews${rev.rating ? `, ${rev.rating} stars` : ''}</span>${rev.startCount != null && rev.count != null && rev.count !== rev.startCount ? `<i class="good-text">${rev.count - rev.startCount > 0 ? '+' : ''}${rev.count - rev.startCount} since you started</i>` : ''}</div>
      <div class="rp-kpi"><b>${d.work.done}</b><span>tasks done this month</span></div>
      <div class="rp-kpi"><b>${d.posts}</b><span>Google posts this month</span></div>
    </section>
    ${d.keywords.length ? `${d.keywords.map(keywordCard).join('')}<div class="small">${legend}</div>` : '<section class="card"><h2>Rankings</h2><p class="muted">Your first map scan will show up here.</p></section>'}
    ${d.leaders.length ? `<section class="card"><div class="card-head"><h2>Who holds the top 3</h2><span class="small muted">"${esc(k0.keyword)}", share of the area</span></div>
      ${d.leaders.map((l) => `<div class="rp-bar${l.isTarget ? ' you' : ''}"><span class="nm">${esc(l.title)}${l.isTarget ? ' (you)' : ''}</span><span class="track"><span class="fill" style="width:${Math.max(2, l.sov)}%"></span></span><b>${l.sov}%</b></div>`).join('')}</section>` : ''}
    <div class="rp-two">
      <section class="card"><h2>Work done in ${esc(d.monthLabel.split(' ')[0])}</h2>
        ${d.work.byKind.length ? `<div class="rp-chips">${d.work.byKind.map((b) => `<span class="badge">${esc(b.label)}: ${b.n}</span>`).join('')}</div>` : ''}
        ${d.work.items.length ? `<ul class="plain">${d.work.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="muted">The task list for this month is on its way.</p>'}
        <p class="small" style="margin-top:12px">${[rev.requestsSent ? `${rev.requestsSent} review request${rev.requestsSent === 1 ? '' : 's'} sent, ${rev.requestsClicked} opened` : '', d.qrScans ? `${d.qrScans} QR code scan${d.qrScans === 1 ? '' : 's'}` : ''].filter(Boolean).join('. ')}</p></section>
      <section class="card"><h2>Coming up next month</h2>
        ${d.next.length ? `<ul class="plain">${d.next.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="muted">Your plan for next month.</p>'}
        <p class="small muted" style="margin-top:12px">Questions? Reply to the email this came in, or call your Rightway team.</p></section>
    </div>
    <p class="small muted" style="text-align:center">Made ${esc(day(d.at))} by Rightway Growth. Map scans check Google's local results from a grid of spots around your business.</p>`;
}

(async () => {
  const tok = location.hash.slice(1);
  try {
    const res = await fetch(`/api/public/report/${encodeURIComponent(tok)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'This report could not be loaded.');
    render(data.report, data.note);
    $('#rpprint')?.addEventListener('click', () => window.print());
  } catch (e) {
    $('#rp').innerHTML = `<div class="card"><h2>Report not found</h2><p class="muted">${esc(e.message)}</p></div>`;
  }
})();
