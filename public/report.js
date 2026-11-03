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

// Share of the area in each rank band, as one bar.
function bandBar(b) {
  if (!b || !b.n) return '';
  const seg = [['top3', b.top3, 'Top 3'], ['page1', b.page1, '4 to 10'], ['page2', b.page2, '11 to 20'], ['none', b.none, 'Not in top 20']].filter(([, v]) => v > 0);
  return `<div class="rp-bands" role="img" aria-label="${seg.map(([, v, l]) => `${l}: ${v}%`).join(', ')}">${seg.map(([k, v, l]) => `<span style="width:${v}%;background:${COLORS[k]}" title="${l}: ${v}%">${v >= 9 ? `${v}%` : ''}</span>`).join('')}</div>`;
}

function keywordCard(k) {
  const start = k.start && k.start.ranks ? k.start : null;
  return `<section class="card">
    <div class="card-head"><div><p class="eyebrow">Google Maps search</p><h2>"${esc(k.keyword)}"</h2></div>
      <span class="badge gray">${k.now.size} x ${k.now.size} spots, ${k.now.radius} mi</span></div>
    <div class="rp-row3">
      <div><b>${k.now.top10Pct ?? 0}%</b><span>of your area sees you on the first page (top 10)</span><br>${change(k.now.top10Pct, k.before?.top10Pct, { unit: ' pts', words: ['up', 'down'] })}</div>
      <div><b>${k.now.avgRank ?? '-'}</b><span>average position</span><br>${change(k.now.avgRank, k.before?.avgRank, { lowerBetter: true })}</div>
      <div><b>${k.now.centerRank ? `#${k.now.centerRank}` : '20+'}</b><span>at your address</span><br>${k.before && k.before.centerRank !== k.now.centerRank ? `<i class="muted">was ${k.before.centerRank ? `#${k.before.centerRank}` : '20+'}</i>` : ''}</div>
    </div>
    ${bandBar(k.now.bands)}
    <div class="rp-maps">
      ${start ? `<figure><figcaption>Where you started, ${esc(day(start.date))}: first page in ${start.top10Pct ?? 0}%</figcaption>${grid(start.ranks, start.size, `Starting map for ${k.keyword}`)}</figure>` : ''}
      <figure><figcaption>${start ? 'Now' : 'This month'}, ${esc(day(k.now.date))}: first page in ${k.now.top10Pct ?? 0}%</figcaption>${grid(k.now.ranks, k.now.size, `Current map for ${k.keyword}`)}</figure>
    </div>
  </section>`;
}

// Who holds each spot in the top 10, and what it would take to pass the ones just above.
function ladderCard(d, k0) {
  if (!d.leaders.length) return '';
  if (d.leaders[0].position == null) { // reports made before the top 10 ladder
    return `<section class="card"><div class="card-head"><h2>Who shows up most</h2><span class="small muted">"${esc(k0.keyword)}", share of the area</span></div>
      ${d.leaders.map((l) => `<div class="rp-bar${l.isTarget ? ' you' : ''}"><span class="nm">${esc(l.title)}${l.isTarget ? ' (you)' : ''}</span><span class="track"><span class="fill" style="width:${Math.max(2, l.sov)}%"></span></span><b>${l.sov}%</b></div>`).join('')}</section>`;
  }
  const you = d.leaders.find((l) => l.isTarget);
  const next = d.climb?.next || [];
  return `<section class="card"><div class="card-head"><h2>Who holds the top 10</h2><span class="small muted">"${esc(k0.keyword)}", by average spot across your area</span></div>
    <div class="table-wrap"><table class="rp-ladder"><thead><tr><th>Spot</th><th>Business</th><th>First page</th><th>Reviews</th><th>To pass them</th></tr></thead><tbody>
    ${d.leaders.map((l) => `<tr class="${l.isTarget ? 'you' : ''}"><td><b>#${l.position}</b></td><td>${esc(l.title)}${l.isTarget ? ' (you)' : ''}</td><td>${l.sov10 ?? 0}%</td>
      <td>${l.reviews ?? '-'}${l.rating ? ` <span class="muted">${l.rating}★</span>` : ''}</td><td class="small">${l.isTarget ? '' : esc(you && l.position < you.position ? l.gap || '-' : '')}</td></tr>`).join('')}
    </tbody></table></div>
    ${you ? `<p class="small" style="margin-top:10px">You are <b>#${you.position}</b>${d.climb?.total ? ` of ${d.climb.total} businesses seen` : ''}, with an average rank of ${you.avgRank} across your area.${next.length ? ` Next spots up: ${next.map((n) => `#${n.position} ${esc(n.title)}${n.gap ? ` (${esc(n.gap)})` : ''}`).join('; ')}.` : ''}</p>` : ''}
    <p class="small muted">Rank also depends on how close a searcher is and how well the business matches the search, so these are the gaps we can work on, not a promised spot.</p></section>`;
}

function proofCard(d, tok) {
  const p = d.work.proof || [];
  if (!p.length) return '';
  return `<section class="card"><div class="card-head"><h2>Proof of the work</h2><span class="small muted">links and screenshots</span></div>
    <div class="rp-proof">${p.map((x) => `<div class="rp-proof-item">${x.shot ? `<a href="/api/public/proof/${encodeURIComponent(tok)}/${encodeURIComponent(x.id)}" target="_blank" rel="noopener"><img src="/api/public/proof/${encodeURIComponent(tok)}/${encodeURIComponent(x.id)}" alt="Screenshot: ${esc(x.title)}" loading="lazy"></a>` : ''}
      <div><span class="badge gray">${esc(x.label)}</span><div>${esc(x.title)}</div>${x.link ? `<a class="small" href="${esc(x.link)}" target="_blank" rel="noopener">See it live</a>` : ''}</div></div>`).join('')}</div></section>`;
}

function gbpCard(g) {
  if (!g) return '';
  const ch = (a, b) => (b != null ? change(a, b, { words: ['up', 'down'] }) : '');
  return `<section class="card"><div class="card-head"><h2>From your Google profile</h2><span class="small muted">this month, from Google</span></div>
    <div class="rp-row3" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div><b>${g.calls}</b><span>calls</span><br>${ch(g.calls, g.prev?.calls)}</div><div><b>${g.directions}</b><span>direction requests</span><br>${ch(g.directions, g.prev?.directions)}</div>
      <div><b>${g.website}</b><span>website clicks</span><br>${ch(g.website, g.prev?.website)}</div><div><b>${g.views}</b><span>profile views</span><br>${ch(g.views, g.prev?.views)}</div></div></section>`;
}

function render(d, note, tok) {
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
      <div class="rp-kpi"><b>${k0 ? `${k0.now.top10Pct ?? 0}%` : '-'}</b><span>${k0 ? `first page (top 10) coverage for "${esc(k0.keyword)}"` : 'no map scan yet'}</span>${k0?.start ? change(k0.now.top10Pct, k0.start.top10Pct, { unit: ' pts since you started', words: ['up', 'down'] }) : ''}</div>
      <div class="rp-kpi"><b>${rev.count ?? '-'}</b><span>Google reviews${rev.rating ? `, ${rev.rating} stars` : ''}</span>${rev.startCount != null && rev.count != null && rev.count !== rev.startCount ? `<i class="good-text">${rev.count - rev.startCount > 0 ? '+' : ''}${rev.count - rev.startCount} since you started</i>` : ''}</div>
      <div class="rp-kpi"><b>${d.work.done}</b><span>tasks done this month</span></div>
      <div class="rp-kpi"><b>${d.posts}</b><span>Google posts this month</span></div>
    </section>
    ${d.keywords.length ? `${d.keywords.map(keywordCard).join('')}<div class="small">${legend}</div>` : '<section class="card"><h2>Rankings</h2><p class="muted">Your first map scan will show up here.</p></section>'}
    ${k0 ? ladderCard(d, k0) : ''}
    ${gbpCard(d.gbp)}
    ${d.calls ? `<section class="card"><div class="card-head"><h2>Calls from Google and your site</h2><span class="small muted">tracked numbers</span></div>
      <div class="rp-row3" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div><b>${d.calls.total}</b><span>calls this month</span></div><div><b>${d.calls.firstTime}</b><span>new callers</span></div>
        <div><b>${d.calls.answered}</b><span>answered</span></div><div><b class="${d.calls.missed ? 'bad-text' : ''}">${d.calls.missed}</b><span>missed${d.calls.voicemail ? `, ${d.calls.voicemail} left a voicemail` : ''}</span></div></div>
      ${d.calls.bySource.length > 1 ? `<p class="small" style="margin-top:10px">${d.calls.bySource.map((x) => `${esc(x.source)}: <b>${x.n}</b>`).join(' &middot; ')}</p>` : ''}
      ${d.calls.missed ? '<p class="small muted" style="margin-top:6px">Every missed call is a customer who may call the next business. Calling back within an hour wins most of them.</p>' : ''}</section>` : ''}
    ${d.reputation ? `<section class="card"><div class="card-head"><h2>Reputation</h2><span class="small muted">Google reviews</span></div>
      <div class="rp-row3" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div><b>${d.reputation.rating ?? '-'}</b><span>star rating</span></div><div><b>${d.reputation.newThisMonth}</b><span>new reviews this month</span></div>
        <div><b>${d.reputation.perMonth}</b><span>new reviews a month (last 90 days)</span></div><div><b>${d.reputation.replyRate ?? '-'}%</b><span>of reviews have a reply</span></div></div>
      ${d.reputation.themes.length ? `<p class="small" style="margin-top:10px"><b>What customers mention:</b> ${d.reputation.themes.map((t) => `${esc(t.label)} (${t.pos} good${t.neg ? `, ${t.neg} bad` : ''})`).join(', ')}</p>` : ''}</section>` : ''}
    ${proofCard(d, tok)}
    <div class="rp-two">
      <section class="card"><h2>Work done in ${esc(d.monthLabel.split(' ')[0])}</h2>
        ${d.work.byKind.length ? `<div class="rp-chips">${d.work.byKind.map((b) => `<span class="badge">${esc(b.label)}: ${b.n}</span>`).join('')}</div>` : ''}
        ${d.work.items.length ? `<ul class="plain">${d.work.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="muted">The task list for this month is on its way.</p>'}
        ${d.links && (d.links.citations.length || d.links.links.length) ? `<p class="small" style="margin-top:12px"><b>New listings and links:</b> ${[...d.links.citations, ...d.links.links].map(esc).join(', ')}</p>` : ''}
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
    render(data.report, data.note, tok);
    $('#rpprint')?.addEventListener('click', () => window.print());
  } catch (e) {
    $('#rp').innerHTML = `<div class="card"><h2>Report not found</h2><p class="muted">${esc(e.message)}</p></div>`;
  }
})();
