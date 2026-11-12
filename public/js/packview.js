// Draws the competitor analysis (pure: pack in, HTML string out). Used by the prospect's page and by Present mode.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const COLORS = { top3: '#23B07E', page1: '#F2B544', page2: '#E8833A', none: '#D64545', nodata: '#C9D3CF' };
const band = (r) => (r === -1 ? 'nodata' : r === 0 ? 'none' : r <= 3 ? 'top3' : r <= 10 ? 'page1' : 'page2');

export function gridSvg(ranks, size, label) {
  if (!ranks?.length || !size) return '';
  const cell = size > 9 ? 26 : 40, gap = size > 9 ? 3 : 4, w = size * cell + (size - 1) * gap, mid = Math.floor((size * size) / 2);
  const cells = ranks.map((r, i) => {
    const x = (i % size) * (cell + gap), y = Math.floor(i / size) * (cell + gap), b = band(r);
    const txt = r > 0 ? String(r) : r === 0 ? '20+' : '';
    const ink = b === 'top3' || b === 'none' ? '#fff' : '#0F1B17';
    return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="${cell > 30 ? 8 : 5}" fill="${COLORS[b]}"${i === mid ? ' stroke="#0F1B17" stroke-width="3"' : ''}/>${size <= 9 && txt ? `<text x="${x + cell / 2}" y="${y + cell / 2 + 5}" text-anchor="middle" font-size="${txt.length > 2 ? 12 : 15}" font-weight="700" font-family="Instrument Sans, Arial, sans-serif" fill="${ink}">${txt}</text>` : ''}`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${w}" role="img" aria-label="${esc(label)}">${cells}</svg>`;
}

const stars = (r) => (r == null ? 'n/a' : r.toFixed(1));
const FIT = { high: ['Fix first', 'bad'], good: ['Strong fit', 'good'], later: ['Later', 'gray'] };

// The analysis in four parts so Present mode can show one at a time and the report page can show all of them.
export function packParts(p) {
  const top = p.competitors[0], y = p.you, g = p.grid;
  const kpi = (big, label, sub) => `<div class="pk-kpi"><b>${esc(big)}</b><span>${esc(label)}</span>${sub ? `<i>${esc(sub)}</i>` : ''}</div>`;
  const kpis = [
    g ? kpi(`${g.top10} of ${g.points}`, 'spots where you are on page one', `${g.top3} in the top 3`) : kpi(y.rank ? `#${y.rank}` : '20+', 'your rank at your own address', ''),
    kpi(y.reviews ?? 'n/a', 'your Google reviews', top && top.reviews != null ? `${top.name}: ${top.reviews}` : ''),
    kpi(stars(y.rating), 'your rating', top && top.rating != null ? `${top.name}: ${stars(top.rating)}` : ''),
    kpi(p.competitors.length, 'competitors taking your calls', top ? `Biggest: ${top.name}` : ''),
  ].join('');
  const comps = p.competitors.length ? `<div class="pk-comps">${p.competitors.map((c, i) => `
    <article class="pk-comp"><header><b>${i + 1}. ${esc(c.name)}</b><span class="muted">${esc(c.category || '')}</span></header>
      <div class="pk-nums"><span><b>${c.reviews ?? 'n/a'}</b> reviews</span><span><b>${stars(c.rating)}</b> rating</span>${c.wins ? `<span><b>${c.wins}</b> top 3 spots</span>` : ''}</div>
      ${c.why.length ? `<ul>${c.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '<p class="muted">Close to you on the numbers we can see.</p>'}</article>`).join('')}</div>` : '<p class="muted">No competitors were captured in the research.</p>';
  const you = `<article class="pk-comp you"><header><b>${esc(p.business)} (you)</b><span class="muted">${esc(y.category || '')}</span></header><div class="pk-nums"><span><b>${y.reviews ?? 'n/a'}</b> reviews</span><span><b>${stars(y.rating)}</b> rating</span>${g ? `<span><b>${g.top3}</b> top 3 spots</span>` : ''}</div></article>`;
  const reasons = p.reasons.length ? p.reasons.map((r) => `<li class="pk-reason ${esc(r.severity)}"><b>${esc(r.title)}</b><span>${esc(r.detail)}</span></li>`).join('') : '<li class="muted">No major gaps found.</li>';
  const lst = p.listings ? `<section class="pk-sec"><h2>Directories Google double checks</h2><p class="muted">We checked ${p.listings.checked} directories. ${p.listings.counts.mismatch || 0} show wrong information, ${p.listings.counts.missing || 0} do not list you, ${p.listings.counts.match || 0} match.</p>
    ${p.listings.rows.length ? `<table class="pk-table"><tbody>${p.listings.rows.map((r) => `<tr><td>${esc(r.name)}</td><td><span class="pk-tag ${r.status === 'mismatch' ? 'bad' : 'warn'}">${esc(r.label)}</span> ${esc(r.note)}</td></tr>`).join('')}</tbody></table>` : ''}</section>` : '';
  const site = p.site ? `<section class="pk-sec"><h2>Your website</h2><div class="pk-nums wide">
    <span><b>${p.site.https ? 'Yes' : 'No'}</b> secure (HTTPS)</span><span><b>${p.site.titleOk ? 'Yes' : 'No'}</b> homepage says service and city</span><span><b>${p.site.tel ? 'Yes' : 'No'}</b> tap to call</span><span><b>${p.site.schema ? 'Yes' : 'No'}</b> local business code</span>${p.site.speed != null ? `<span><b>${p.site.speed}</b> mobile speed (of 100)</span>` : ''}</div></section>` : '';
  const found = p.foundation.length ? p.foundation.map((s) => `<li><b>${esc(s.name)}</b><span>${esc(s.what)}</span>${s.why ? `<em>${esc(s.why)}</em>` : ''}</li>`).join('') : '';
  const growth = p.growth.map((s) => { const [l, c] = FIT[s.fit] || FIT.later; return `<li><b>${esc(s.name)} <span class="pk-tag ${c}">${l}</span></b><span>${esc(s.what)}</span><em>${esc(s.why)}</em></li>`; }).join('');
  const cad = p.cadence.map((c) => `<li><span class="pk-when">${esc(c.when)}</span><b>${esc(c.title)}</b><span>${esc(c.text)}</span></li>`).join('');
  return {
    overview: `<section class="pk-hero"><div class="eyebrow">Free competitor analysis</div><h1>${esc(p.business)}</h1><p>${esc(p.city)}${p.state ? `, ${esc(p.state)}` : ''} · "${esc(p.keyword || '')}"</p><p class="pk-head">${esc(p.headline)}</p></section>
  <div class="pk-kpis">${kpis}</div>
  ${g ? `<section class="pk-sec"><h2>Where customers find you</h2><p class="muted">Each square is a spot around the business. The number is where you show up when someone there searches "${esc(p.keyword || '')}". Green is the top 3, yellow is the rest of page one, red is not on the first page.</p><div class="pk-map">${gridSvg(g.cells, g.size, 'Search results around the business')}</div></section>` : ''}`,
    competitors: `<section class="pk-sec"><h2>Who is getting your calls, and why</h2><div class="pk-comps">${you}</div>${comps}</section>`,
    why: `<section class="pk-sec"><h2>Exactly why they are ahead</h2><ul class="pk-reasons">${reasons}</ul></section>${lst}${site}`,
    plan: `<section class="pk-sec"><h2>The game plan</h2>
    <h3>Step 1: fix the local SEO foundation</h3><p class="muted">This is the base. Everything else works better once it is done.</p><ul class="pk-list">${found}</ul>
    <h3>Step 2: grow on top of it</h3><p class="muted">Each of these is its own service. We review them together on a monthly branding call and add the next one when it makes sense.</p><ul class="pk-list">${growth}</ul>
    <h3>How it runs</h3><ol class="pk-cad">${cad}</ol></section>
  <p class="pk-note">${esc(p.note)}</p>`,
  };
}

export function packHtml(p, { bookUrl = '/book.html', present = false } = {}) {
  if (!p?.ready) return `<div class="card"><p class="muted">${esc(p?.reason || 'Nothing to show yet.')}</p></div>`;
  const x = packParts(p);
  return `${x.overview}${x.competitors}${x.why}${x.plan}${present ? '' : `<p class="no-print"><a class="btn btn-primary" href="${esc(bookUrl)}">Book a time to go over it</a> <button class="btn btn-ghost" onclick="window.print()">Print or save as PDF</button></p>`}`;
}
