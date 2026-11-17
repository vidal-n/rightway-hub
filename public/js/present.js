// Presentation mode: a tailored deck for one lead, built from the research, with a presenter view in a second window.
// Open /present.html#<leadId>. Presenter view: /present.html?presenter=1#<leadId>. Keys: arrows or space, F fullscreen, P presenter view.
import { findProblems, industryInfo, rankText, buildScript, roi, top10Of, quoteFor, allServicesFor, unbold } from './leadintel.js';
import { ninetyDayPlan, reviewTarget } from './fulfill.js';
import { SERVICE_LIST, WEBSITE_SERVICE_IDS, WEBSITE_PROBLEM_KEYS, WEBSITE_NEED_IDS, NEED_COPY } from './plancopy.js';
import { INCLUDED_ALL, refFor, refLines, refMoney } from './planref.js';
import { urgencyFor, LF8 } from './lifeforce.js';
import { webLines } from './webprice.js';
import { buildPack } from './pack.js';
import { qrSvg } from './qr.js';
import { parseListings, listingsLine, listingsTable } from './listings.js';
import { can } from './jobs.js';
import { inFlow, titleOf, purposeOf, pace, QUESTIONS, CONTRACT, EXIT_TERMS } from './pitchflow.js';

const root = document.getElementById('root');
const id = decodeURIComponent(location.hash.slice(1));
const QS = new URLSearchParams(location.search);
const presenter = QS.get('presenter') === '1';
// Inside the Hub's Present mode the deck runs in a frame: the Hub's own bar has Full screen, My notes and Exit.
const embedded = QS.get('embed') === '1' || window.self !== window.top;
const chan = 'BroadcastChannel' in window ? new BroadcastChannel(`rw-present-${id}`) : null;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SITE_WORDS = /website|on-page|titles, headings|\bsite\b/i;
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

async function api(path, opts = {}) {
  const res = await fetch(path, { method: opts.method || 'GET', headers: { 'x-rw': '1', ...(opts.body ? { 'content-type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
  return data;
}

const state = { i: 0, plan: 'growth', ticket: 500, jobs: 4, quote: null, entered: { setup: '', monthly: '' }, kwi: 0, svc: null };
// What the closer sees about pricing: the plan guide. Never drawn on the client's screen except the plan NAME, very small.
const svcNow = () => state.svc || (state.quote ? state.quote.services.map((x) => ({ id: x.id, qty: x.qty })) : []);
// The deep scan run in the Scan tool tab (saved to the lead) wins over the quick research grid. One entry per keyword.
function deepScans() {
  const raw = D?.lead?.deep_scan;
  if (!raw) return [];
  try { const d = typeof raw === 'string' ? JSON.parse(raw) : raw; return Array.isArray(d.scans) ? d.scans.filter((x) => x.cells?.length) : []; } catch { return []; }
}
function activeGrid() {
  const deep = deepScans();
  if (deep.length) { const g = deep[Math.min(state.kwi, deep.length - 1)]; return { ...g, deep: true, count: deep.length }; }
  const g = D?.intel?.grid;
  return g ? { ...g, keyword: D.intel.keyword, center: D.intel.rank, deep: false, count: 1 } : null;
}
let D = null;

function stars(r) { if (r == null) return ''; const n = Math.round(r); return `<span class="stars">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span> ${r.toFixed(1)}`; }
const foot = (n, total, dark) => `<div class="foot"><img src="/brand/rightway-logo-${dark ? 'dark' : 'light'}.svg" alt="Rightway Growth"><span>${esc(D.lead.business)} · ${n} / ${total}</span></div>`;

function slides() {
  const { lead, intel } = D;
  const L = intel?.listing || {};
  const info = industryInfo(lead.industry, L.category || lead.category);
  const probs = findProblems(intel, lead);
  const comps = (intel?.competitors || []).slice(0, 3);
  const city = lead.city || '';
  const kw = intel?.keyword || info.keyword || 'your service';
  const plan = state.plan;
  const Q = state.quote;
  const script = buildScript(lead, intel, { rep: D.rep, voice: D.voice, plan, ticket: state.ticket, quote: Q }, D.custom);
  const v = script.vars;
  const first = (lead.contact_name || '').split(' ')[0];
  const r = roi({ ticket: state.ticket, jobs: state.jobs, price: Q.monthly });
  const rt = reviewTarget(intel);
  const qtyOf = (id) => Q.services.find((x) => x.id === id)?.qty;
  const nd = ninetyDayPlan(plan, intel, lead, { posts: qtyOf('posts'), pages: qtyOf('pages') || 0, links: qtyOf('links') || 0 });
  const shown = Q.services.filter((x) => !WEBSITE_SERVICE_IDS.includes(x.id) && !WEBSITE_NEED_IDS.includes(x.id));
  const needed = Q.services.filter((x) => WEBSITE_NEED_IDS.includes(x.id));
  const hiddenSvc = Q.services.filter((x) => WEBSITE_SERVICE_IDS.includes(x.id));
  const ref = refFor(Q.services.map((x) => ({ id: x.id, qty: x.qty })));
  const siteProbs = probs.filter((p) => WEBSITE_PROBLEM_KEYS.includes(p.key));
  const seoProbs = probs.filter((p) => !WEBSITE_PROBLEM_KEYS.includes(p.key));
  const P = buildPack(lead, { intel, listings: lead.listings, deepScan: lead.deep_scan });
  const topC = comps[0];
  const g = activeGrid();
  const deep = deepScans();
  const lf = urgencyFor({ business: lead.business, industry: info.label, grid: intel?.grid || null, you: { reviews: L.reviews ?? null, rating: L.rating ?? null, rank: intel?.rank ?? null }, top: topC ? { name: topC.title, reviews: topC.reviews, rating: topC.rating, wins: topC.wins } : null });
  const lfNotes = lf.asks.map((a) => `• ${LF8.find((x) => x.id === a.id).name}: "${a.ask}"`).join('\n');
  // Closer only: website findings and what to sell after results. Never on screen.
  const siteNotes = `\n\nWEBSITE (closer only, not on screen, sold separately after results):\n${webLines(8).map((x) => `• ${x}`).join('\n')}\n${intel?.speed?.score != null ? `Mobile speed ${intel.speed.score} of 100. ` : ''}${siteProbs.length ? siteProbs.map((x) => `• ${x.title}: ${x.detail}`).join('\n') : 'No website problems found.'}${hiddenSvc.length ? `\nIn the quote but not shown: ${hiddenSvc.map((x) => `${x.name} (${x.qty} a month)`).join(', ')}.` : ''}`;
  const out = [];
  const add = (key, title, html, notes, dark = false) => out.push({ key, title, html, notes, dark });
  // Presenter notes come straight from the one pitch (the Google clarity call), so the deck and the phone script never drift apart.
  const say = (id, coach = true) => (script.steps.find((x) => x.id === id)?.lines || []).filter((l) => coach || !/^\(/.test(l)).map(unbold).join('\n\n');

  // 1. Welcome: the up front contract (Sandler). They keep the audit either way and say yes or no at the end.
  add('welcome', 'Plan for today', `
    <img class="cover-mark" src="/brand/rightway-mark-light.svg" alt="">
    <div class="anim"><p class="kicker">Google clarity audit</p><h1>${esc(lead.business)}</h1>
    <p class="lead">Prepared for ${esc(lead.contact_name || 'you')} by Rightway Growth</p></div>
    <div class="welcome-ag anim"><span>1</span>Your business on Google<span>2</span>Your map, street by street<span>3</span>Your plan<span>4</span>Your options</div>
    <p class="keep anim">You keep this audit either way.</p>
    <div class="cover-meta"><div><b>${esc(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}</b>Date</div><div><b>${esc(kw)}</b>Main search</div>${D.rep ? `<div><b>${esc(D.rep)}</b>Your strategist</div>` : ''}</div>`,
  `Thank them for the time and confirm it: "Do you still have about 45 minutes?"\n\n${say('c_open')}\n\nThe up front contract, then wait for the yes:\n"${CONTRACT}"\n\n${say('c_frame')}\n\nNo company story here. That comes later, in under 2 minutes.\n\nAsk: "Is anyone else involved in decisions like this who should be on the call?"`, true);

  // 2. Your business on Google: discovery and verifying the profile, category, searches and towns.
  const kws = [...new Set([...deep.map((x) => x.keyword), kw].filter(Boolean))].slice(0, 5);
  add('verify', 'Your business on Google', `<p class="kicker">Your business on Google</p><h2>First, let's make sure we checked the right things</h2>
    <div class="cols c2" style="align-items:start;gap:56px">
      <div class="box profile anim">${[['Name', L.title || lead.business], ['Main category', L.category || lead.category || info.label], ['Phone', L.phone || lead.phone], ['Address or area', L.address || [lead.city, lead.state].filter(Boolean).join(', ')], ['Reviews', L.reviews != null ? `${L.reviews}${L.rating ? `, ${Number(L.rating).toFixed(1)} stars` : ''}` : 'Not found yet']]
        .map(([k, v]) => `<div class="pf"><span>${esc(k)}</span><b>${esc(v || '-')}</b></div>`).join('')}</div>
      <div class="anim"><h3>Searches we checked</h3><div class="kwchips">${kws.map((x) => `<span>${esc(x)}</span>`).join('') || '<span>Not chosen yet</span>'}</div>
        <p class="note" style="margin-top:22px">Tell us what else your customers search for, and the towns you want work from.</p></div></div>`,
  `Discovery. Listen more than you talk. Write their words down, you will use them later.\n\nAsk about 6 of these now, the rest during the audit:\n${QUESTIONS.slice(0, 6).map((q) => `• ${q}`).join('\n')}\n\n${say('c_discovery')}\n\n${say('c_verify')}\n\nFix the searches and towns now: if they name a search or town we did not scan, open the live scan on the next screens and add it.\n\nAsk: "Did I get your main search right, and which towns matter most to you?"`);

  // 3. How to read the map: a ten second legend first (Mayer pre-training), then a real strength.
  const strong = g ? g.cells.filter((c) => c.rank != null && c.rank <= 3).length : 0;
  const centerRank = g ? (g.center ?? g.cells[Math.floor(g.cells.length / 2)]?.rank ?? null) : null;
  const strength = strong ? `You are already in Google's top 3 in ${strong} of ${g.points} spots we checked.` : centerRank != null && centerRank <= 10 ? `At your own address you show up #${centerRank}, on the first page.` : L.reviews ? `You already have ${L.reviews} Google reviews${L.rating ? ` at ${Number(L.rating).toFixed(1)} stars` : ''}. That is the base everything else builds on.` : 'Your business is on Google, which is the base everything else builds on.';
  add('read', 'How to read the map', `<p class="kicker">How to read the map</p><h2>Each square is a customer searching from that spot</h2>
    <div class="cols c2" style="align-items:center;gap:64px">
      <div class="anim"><div class="legend-demo">${['top3', 'top10', 'top20', 'none', 'top3', 'top10', 'none', 'top20', 'top3'].map((b, i) => `<span class="${b}${i === 4 ? ' center' : ''}">${i === 4 ? '📍' : ''}</span>`).join('')}</div>
        <div class="legend" style="margin-top:22px"><span><i style="background:#23B07E"></i>Top 3: they see you first</span><span><i style="background:#E8A33D"></i>4 to 10: first page</span><span><i style="background:#E07B39"></i>11 to 20</span><span><i style="background:#D64545"></i>Not found</span></div>
        <p class="note" style="margin-top:16px">The pin in the middle is your shop. We search Google from every square, the way a customer standing there would.</p></div>
      <div class="anim"><div class="box"><h3>Where you are strong</h3><p>${esc(strength)}</p></div>
        <div class="pack" style="margin-top:22px"><div class="q">🔍 ${esc(kw)}</div>
        ${comps.map((c, i) => `<div class="row"><span class="pin">${String.fromCharCode(65 + i)}</span><div><b>${esc(c.title)}</b><br><span style="font-size:18px;color:#61716B">${c.rating ? stars(c.rating) : ''} (${c.reviews ?? 0})</span></div></div>`).join('') || '<div class="row">Run research to show the map pack.</div>'}</div></div></div>`,
  `Spend about 20 seconds on the legend: "Green means a customer there sees you in the top 3. Orange is page one. Red means they don't find you. The pin is your shop."\n\nThen a real strength, out loud: "${strength}"\n\nMost people call one of the first businesses they see, and few scroll past the first page. That is why every square matters.\n\nAsk: "When you search your own service from home, where do you see yourself?"`);

  const scanBtn = `<button class="replay scanlive" id="deepscan" type="button" title="Opens the live scan right here, filled in for ${esc(lead.business)}">${g?.deep ? 'Scan live again' : 'Run the live scan'}</button>`;
  if (g) {
    const band = (c) => (c.error ? 'err' : c.rank == null ? 'none' : c.rank <= 3 ? 'top3' : c.rank <= 10 ? 'top10' : 'top20');
    const mid = Math.floor(g.cells.length / 2);
    const gkw = g.keyword || kw;
    const center = g.center ?? g.cells[mid]?.rank ?? null;
    add('grid', 'The scan', `<p class="kicker">The scan${g.deep ? ` · ${g.size} x ${g.size}, ${g.radiusMiles} miles` : ''}</p><h2>${top10Of(g) ? `First page in ${top10Of(g)} of ${g.points} spots` : 'Not on the first page anywhere we checked'}</h2>
      ${deep.length > 1 ? `<div class="kwtabs">${deep.map((x, i) => `<button type="button" data-kw="${i}" class="${i === Math.min(state.kwi, deep.length - 1) ? 'on' : ''}">${esc(x.keyword)}<b>${top10Of(x)}/${x.points}</b></button>`).join('')}</div>` : ''}
      <div class="cols" style="grid-template-columns:auto 1fr;align-items:center;gap:72px">
        <div><div class="biggrid" id="biggrid" style="grid-template-columns:repeat(${g.size},1fr);--s:${g.size}">${g.cells.map((c, i) => `<span data-i="${i}" data-band="${band(c)}" class="${band(c)}${i === mid ? ' center' : ''}">${c.error ? '!' : c.rank ?? '20+'}</span>`).join('')}</div>
          <div class="legend"><span><i style="background:#23B07E"></i>Top 3</span><span><i style="background:#E8A33D"></i>4 to 10</span><span><i style="background:#E07B39"></i>11 to 20</span><span><i style="background:#D64545"></i>Not found</span><button class="replay" id="greplay" type="button">Replay</button>${scanBtn}</div></div>
        <div class="gside">
          <div class="gphone" id="gphone" hidden></div>
          <div class="gstats" id="gstats" style="display:grid;gap:22px">
            <div class="box"><div class="num">${esc(rankText(center).replace('not in the top 20', '20+'))}</div><div class="label">at your own address for "${esc(gkw)}"</div></div>
            <div class="box"><div class="num">${top10Of(g)}<small> of ${g.points}</small></div><div class="label">spots where you are on the first page (top 10), within ${g.radiusMiles} miles</div></div>
            <div class="box"><div class="num">${g.avg ?? '20+'}</div><div class="label">average rank across the area</div></div></div></div></div>`,
    `${say('c_scan')}\n\n${g.deep ? `This is the saved scan (${deep.length} search${deep.length === 1 ? '' : 'es'}). Click a search above the grid to switch.` : 'This is the quick research grid. Best practice: run the full scan BEFORE the meeting and save it, so this replay is ready.'}\n\nThe replay plays when you land here (Replay runs it again). Narrate it from the middle out:\n"I stood in ${g.points} spots around ${lead.business}, up to ${g.radiusMiles} miles out, and searched ${gkw} on Google the way a customer does. Watch who comes up at each spot."\n\nWhen it finishes: "First page in ${top10Of(g)} of ${g.points}." Point at one weak square in a town they said they want work from. Never say "your map is red".\n\nIf they say "but I show up when I search": that is the square at their shop. Show one a mile or two out.\n\nRun the live scan (button under the grid) to scan a town they named or a wider radius, up to 50 miles. It opens right here; press Save and it comes back to this screen. If it hangs, close it and stay on the replay.\n\nAsk and wait: "Is that the area you want jobs from?"`);
  } else {
    add('grid', 'The scan', `<p class="kicker">The scan</p><h2>Where ${esc(lead.business)} shows up, street by street</h2>
      <div style="margin-top:18px">${scanBtn}</div>`,
    `${say('c_scan')}\n\nNo scan yet. Press "Run the live scan": it opens right here with the business filled in. Run it, press Save, and this screen fills in by itself. Next time run it before the meeting.\n\nAsk: "Which towns do you want jobs from?" and scan those.`);
  }

  if (comps.length && !(P.ready && P.compare?.length)) {
    const rows = [{ title: lead.business, rating: L.rating, reviews: L.reviews, category: L.category, site: L.url || lead.website, you: true }, ...comps.map((c) => ({ title: c.title, rating: c.rating, reviews: c.reviews, category: c.category, site: c.domain }))];
    const maxRev = Math.max(...rows.map((x) => x.reviews || 0));
    add('vs', 'You vs the leaders', `<p class="kicker">You vs the leaders</p><h2>${comps[0].reviews > (L.reviews || 0) ? `${esc(comps[0].title)} has ${comps[0].reviews - (L.reviews || 0)} more reviews` : 'How you stack up'}</h2>
      <table class="vs anim"><thead><tr><th>Business</th><th>Reviews</th><th>Rating</th><th>Google category</th></tr></thead><tbody>
      ${rows.map((x) => `<tr class="${x.you ? 'you' : ''}"><td>${x.you ? '★ ' : ''}${esc(x.title)}</td><td class="${x.reviews === maxRev ? 'good' : x.you ? 'badv' : ''}">${x.reviews ?? '-'}</td><td>${x.rating ? stars(x.rating) : '-'}</td><td>${esc(x.category || '-')}</td></tr>`).join('')}
      </tbody></table>`,
    `These are the businesses showing up highest around you.\n${comps.map((c) => `${c.title}: ${c.reviews ?? '?'} reviews, ${c.rating ?? '?'} stars`).join('\n')}\nYou: ${L.reviews ?? '?'} reviews, ${L.rating ?? '?'} stars.\n\nAsk: "Do you know these guys? Is their work better than yours?" (Almost always no.)\nThen: "So the only difference is what Google sees. That part is fixable."\n\n${say('c_why')}`);
  }

  add('fixes', 'What we would fix first', `<p class="kicker">What we would fix first</p><h2>${seoProbs.length ? `The ${Math.min(3, seoProbs.length)} biggest things holding ${esc(lead.business)} back` : 'Your foundation is solid'}</h2>
    ${seoProbs.length ? `<div class="probs anim">${seoProbs.slice(0, 3).map((p) => `<div class="prob ${p.severity}"><b>${esc(p.title)}</b><span>${esc(p.detail)}</span></div>`).join('')}</div>` : '<p class="lead">No major gaps. The plan focuses on protecting your spot and growing into more searches and areas.</p>'}`,
  seoProbs.length ? `Tie each one to something they told you in discovery. What it is, and what it costs them in calls. Plain words.\n\n${seoProbs.slice(0, 3).map((p) => `• ${p.talk}`).join('\n')}${seoProbs.length > 3 ? `\n\nAlso found (in the plan, not on screen):\n${seoProbs.slice(3, 8).map((p) => `• ${p.title}`).join('\n')}` : ''}\n\nAsk: "Which of these matters most to you?" Lead with that one in the close.${siteNotes}` : `Pitch growth: more searches, more areas, staying ahead of competitors who are catching up.\n\nAsk: "Where do you want to grow next?"${siteNotes}`);

  const LS = parseListings(lead.listings);
  const lc = LS?.counts || {};
  add('listings', 'Inconsistencies', `<p class="kicker">Inconsistencies</p><h2>${LS ? `${(lc.mismatch || 0) + (lc.missing || 0)} of ${LS.results.length} directories Google checks have you wrong or missing` : 'Where Google double checks you'}</h2>
    ${LS ? `<p class="lead" style="margin:-6px 0 18px">${esc(listingsLine(LS))}</p><div class="anim lstwrap">${listingsTable(LS, { max: 7, links: true })}</div>`
      : `<p class="lead">Google checks your name, address and phone against dozens of sites before it trusts you. Let's see what it finds for ${esc(lead.business)}.</p><button class="btn" id="run-lst" style="margin-top:26px">Run the listing check now</button><div id="lst-out" class="lstwrap" style="margin-top:20px"></div>`}`,
  `Show 2 or 3 concrete mismatches ("your old address on Yelp"), red rows first. Never a percentage score.\n\n${LS ? listingsLine(LS) : 'Press "Run the listing check now" (about 3 cents, 15 directories). It takes about 10 seconds.'}\n\n${say('c_listings')}\n\nAsk: "Is that old address or phone still yours?"`);

  if (P.ready && P.compare?.length) {
    const rm = P.reviewMath;
    const why = (P.competitors?.[0]?.why || []).slice(0, 3);
    add('ahead', 'Who holds your spots', `<p class="kicker">Who holds your spots</p><h2>${esc(topC.title)} gets the calls where you don't show up</h2>
      <div class="cols c2" style="align-items:start;gap:56px"><table class="vs anim"><thead><tr><th></th><th>${esc(lead.business)}</th><th>${esc(topC.title)}</th></tr></thead><tbody>
      ${P.compare.map((r) => `<tr><td>${esc(r.label)}</td><td class="${r.lead === 'you' ? 'good' : r.lead === 'them' ? 'badv' : ''}">${esc(r.you ?? '-')}</td><td class="${r.lead === 'them' ? 'good' : ''}">${esc(r.them ?? '-')}</td></tr>`).join('')}</tbody></table>
      <div class="anim">${why.length ? `<div class="box"><h3>Why Google picks them today</h3><ul class="whyl">${why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
      ${rm ? `<div class="box" style="margin-top:22px"><h3>The review math</h3><p>${rm.gap ? `<strong>${rm.gap} reviews</strong> to pass ${esc(rm.leader)}. At <strong>${rm.perMonth} a month</strong> that is about ${rm.months} months, with a real customer behind every one.` : `You already have more reviews than ${esc(rm.leader)}. The job is to keep it that way.`}</p></div>` : ''}</div></div>
      <p class="note" style="margin-top:18px">From our scan. Where you show up also depends on distance and relevance.</p>`,
    `Reveal the table one row at a time as you talk. Show the gap in numbers, not opinions.\n${P.compare.map((r) => `${r.label}: you ${r.you ?? '-'}, them ${r.them ?? '-'}`).join('\n')}\n\n${rm?.gap ? `Reviews: ${rm.gap} to pass them, about ${rm.perMonth} a month, about ${rm.months} months. The app makes asking take seconds.` : ''}\n\n${why.length ? `Why they win, in plain words:\n${why.map((w) => `• ${w}`).join('\n')}\n\n` : ''}One real number, said exactly: "47% of people won't use a business with under 20 reviews" (BrightLocal 2026).\n${rt.text || ''}\n\n${say('c_why')}\n\nAsk: "Is their work actually better than yours?" Then: "So what is different? What Google can see. That part is fixable."`);
  }

  add('worth', 'What waiting costs', `<p class="kicker">What waiting costs</p><h2>What a few more jobs a month means for you</h2>
    <div class="calc"><div class="anim"><label>Average job value<input id="in-ticket" type="number" min="0" step="50" value="${state.ticket}"></label>
      <label>Extra jobs a month from Google<input id="in-jobs" type="number" min="0" step="1" value="${state.jobs}"></label></div>
      <div class="out"><div class="num" id="out-month">${money(r.monthly)}</div><div class="label">extra revenue a month</div>
        <div class="num" style="font-size:64px;margin-top:26px" id="out-year">${money(r.yearly)}</div><div class="label">a year</div>
        <div class="label" style="margin-top:26px;font-size:22px;color:#fff" id="out-mult">${r.multiple >= 1 ? `${r.multiple.toFixed(1)}x your monthly investment` : `Pays for itself at ${r.breakeven} jobs a month`}</div></div></div>
    ${lf.lines.length ? `<div class="factline anim">${lf.lines.slice(0, 3).map((u) => `<span>${esc(u.line)}</span>`).join('')}</div>` : ''}
    <p class="note">An estimate from your own numbers, not a promise. We can't promise calls or a spot on Google.</p>`,
  `Let them give the numbers. Type their answers in:\n• "What's a typical job worth to you?" (starting guess ${money(info.ticket)} for ${info.label.toLowerCase()})\n• "If you got a few more calls a week, how many would you close?"\n\nSay: "At ${money(state.ticket)} a job, ${r.breakeven} extra job${r.breakeven === 1 ? '' : 's'} a month covers the whole thing. Everything after that is yours."\nThen stop and let it sink in.\n\nNo industry "you are losing $X" figures and no deadline. Skip this screen if they gave no numbers.\n\n${lf.lines.length ? `Urgency from their own scan only (Life-Force 8). Pick one or two and ask it, then stop talking:\n${lfNotes}\n\n` : ''}Ask: "Does that feel low or high to you?"`);

  const t10 = intel?.grid ? top10Of(intel.grid) : null;
  add('plan', 'What gets you results', `<p class="kicker">What gets you results</p><h2>What ${esc(lead.business)} needs to reach the first page</h2>
    ${intel?.grid && shown.length <= 6 ? `<p class="lead" style="margin:-6px 0 22px">Today: first page (top 10) in ${t10} of ${intel.grid.points} spots around you. Goal: the first page across ${esc(city || 'your area')}, then climb.</p>` : ''}
    <span class="plan-tag" title="For us only">Plan: ${esc(ref.name)}</span>
    <div class="svcs anim${shown.length > 6 ? ' many' : ''}">${shown.map((x) => `<div class="svc" data-svc="${esc(x.id)}"><button class="svc-x" data-drop="${esc(x.id)}" title="Remove" aria-label="Remove ${esc(x.name)}">×</button><b>${esc(x.name)}</b><span>${x.unit ? `<strong>${x.qty} ${esc(x.unit)}.</strong> ` : ''}${esc(x.why || x.what)}</span></div>`).join('')}</div>
    ${needed.length ? `<div class="need anim"><span class="need-h">Also needed to rank higher</span>${needed.map((x) => `<div class="need-i" data-svc="${esc(x.id)}"><button class="svc-x" data-drop="${esc(x.id)}" title="Remove" aria-label="Remove ${esc(x.name)}">×</button><b>${esc(x.name)}</b><span>${esc(NEED_COPY[x.id] || x.why || x.what)}</span></div>`).join('')}</div>` : ''}
    <div class="incl anim"><span>Included every month</span>${INCLUDED_ALL.map((x) => `<b title="${esc(x.what)}">${esc(x.name)}</b>`).join('')}
      ${SERVICE_LIST.some((x) => !WEBSITE_SERVICE_IDS.includes(x.id) && !Q.services.find((y) => y.id === x.id)) ? `<span class="svc-add"><select id="svc-add" aria-label="Add a service"><option value="">+ Add a service</option>${SERVICE_LIST.filter((x) => !WEBSITE_SERVICE_IDS.includes(x.id) && !Q.services.find((y) => y.id === x.id)).map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></span>` : ''}</div>`,
  `Only what they need. Walk each one: what it is, and why it gets them onto the first page (top 10) in more of their area. "Also needed to rank higher" is what they need on their website: say it as a need, not something we are doing in the monthly work. Websites are a separate service, sold after results. Rank also depends on distance and relevance, so never promise a spot.\n\n(Hover a service and press × to drop it, or add one from the list. The price slide and the work order use this list.)\n\nEvery line is sized from their own scan, so say the number out loud: posts, links, reviews a month, directories to fix. Included on every plan, say it as a bonus: competitor analysis, a monthly branding call, and the Rightway app with a direct line to their manager.\n\nAsk: "Which part of this matters most to you?"\n\nPRICING GUIDE (closer only):\n${refLines(Q.services.map((x) => ({ id: x.id, qty: x.qty }))).join('\n')}${siteNotes}`);

  add('days', 'First 90 days', `<p class="kicker">First 90 days</p><h2>What happens after you say yes</h2>
    <div class="months anim">${nd.months.map((m) => `<div class="month"><h3>${esc(m.title)}</h3><ul>${m.items.filter((x) => !SITE_WORDS.test(x)).slice(0, 5).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}</div>
    ${nd.fixes.filter((f) => !WEBSITE_PROBLEM_KEYS.includes(f.key)).length ? `<p class="note" style="margin-top:22px">Your fixes first: ${esc(nd.fixes.filter((f) => !WEBSITE_PROBLEM_KEYS.includes(f.key)).slice(0, 4).map((f) => `${f.title} (week ${f.week})`).join(' · '))}</p>` : ''}`,
  `${say('c_program')}\n\n` + 'Make it concrete so it feels safe. Onboarding call within a few business days of signing. Month 1 is the foundation, month 2 we build, month 3 it compounds.\n\nBe honest about timing: profile fixes and reviews move things in 30 to 60 days, pages and links build over 3 to 6 months. Honesty here is what makes them trust the rest.\n\nAsk: "How does that timeline sound for you?"');

  add('app', 'How it works', `<p class="kicker">How it works</p><h2>You see every piece of work, in your own app</h2>
    <div class="cols" style="grid-template-columns:auto 1fr;gap:80px;align-items:center">
      <div class="phone live"><iframe id="appframe" title="The Rightway client app" src="about:blank" loading="lazy"></iframe><div class="phone-hint">Tap around: this is the real app</div></div>
      <ul class="feat anim"><li><b>Rankings map every month</b><span>See exactly where you show up, compared to your starting point.</span></li>
        <li><b>Every task we do, logged</b><span>Posts, pages, citations, fixes. Nothing hidden.</span></li>
        <li><b>Review requests from your phone</b><span>Text or email a link in seconds, plus a counter QR code.</span></li>
        <li><b>Snap a photo, we post it</b><span>We write the post for Google, Facebook, and Instagram.</span></li>
        <li><b>A monthly results meeting</b><span>We go over the numbers and the next month's plan.</span></li>
        <li><b>Always getting better</b><span>We add new features every month. You get them free, automatically.</span></li></ul></div>
    <div class="needs anim"><span>What we need from you</span><b>Manager access to your Google profile</b><b>A few job photos a month</b><b>Asking every customer for a review</b></div>`,
  `Under 2 minutes in total. The story first:\n${say('c_story')}\n\nThen the app. The phone is the real client app (a sample business). Tap Home, then Rankings, then Reviews (send a request), then Post a photo. Say: "This is what you get on day one, and we keep adding to it."\n\nThis answers "how do I know you will do the work?" before they ask it.\n\n${say('c_process')}\n\nAsk: "Can you see yourself using this?"`);

  // Trial close before price (Gong: handle the "what about X" questions before the number).
  add('trial', 'Questions before we talk investment', `<p class="kicker">Before we talk investment</p><h2>Does this look like what ${esc(lead.business)} needs?</h2>
    <div class="cols c2" style="align-items:start;gap:56px">
      <div class="box anim"><h3>Your plan</h3><ul class="whyl">${shown.slice(0, 6).map((x) => `<li>${esc(x.name)}${x.unit ? `: ${x.qty} ${esc(x.unit)}` : ''}</li>`).join('')}</ul></div>
      <div class="box anim"><h3>Every month</h3><ul class="whyl">${INCLUDED_ALL.map((x) => `<li>${esc(x.name)}</li>`).join('')}<li>A map of where you show up, so you can see it move</li></ul></div></div>`,
  `Trial close. Stop and ask, then wait:\n${say('c_trial')}\n\nHandle the "what about X" questions here, before price. If the answer is clearly no, skip to the last screen and set a follow up.\n\nAsk: "Based on what you've seen, does this look like what you need?"`);

  const anc = Q.anchor && (Q.anchor.monthly || Q.anchor.setup) ? Q.anchor : null;
  add('price', 'Your investment', `<p class="kicker">Your investment</p><h2>Built for ${esc(lead.business)}, not a package</h2>
    ${anc ? `<p class="anchor anim">Everything we would do for you: ${anc.setup ? `${money(anc.setup)} buildout, ` : ''}${anc.monthly ? `${money(anc.monthly)} a month` : ''}</p>` : ''}
    <div class="invest anim">
      <div class="box"><div class="label">One time buildout</div><div class="num">$<input id="q-setup" class="qin" inputmode="decimal" value="${esc(state.entered.setup)}" aria-label="Buildout"></div></div>
      <div class="box"><div class="label">Monthly</div><div class="num">$<input id="q-monthly" class="qin" inputmode="decimal" value="${esc(state.entered.monthly)}" aria-label="Monthly"></div></div>
      <div class="box dark"><div class="label">Due today</div><div class="num" id="q-today">${dueToday()}</div><div class="label">next payment in 30 days</div></div>
    </div>
    <p class="note" style="margin-top:22px">Includes: ${esc([...shown.map((x) => x.name), ...INCLUDED_ALL.map((x) => x.name)].join(', '))}.</p>
    <div class="terms">${EXIT_TERMS.map((t) => `<span>${esc(t)}</span>`).join('')}</div>`,
  `PRICING GUIDE (closer only, never on screen):\n${refLines(Q.services.map((x) => ({ id: x.id, qty: x.qty }))).join('\n')}\n\nDrop close. The amounts start blank: click each box and type the buildout and monthly you set from discovery. When you move to the next slide they are saved to the lead, and Send the work order fills them in.\n\n${say('c_price')}\n\n${say('c_close')}\n\nIf price comes up: ${script.objections.find((o) => /afford/i.test(o.q))?.a || ''}\n\nIf it still doesn't fit: ${script.objections.find((o) => /\\(drop\\)/.test(o.q))?.a || ''}\n\nPrice is raised ONCE. Say the exit terms out loud: "3 months minimum, then month to month, and here is how you leave." Answer the real objection once, no rebuttal loops.\n\nAsk: "Which one fits?"`);

  // Work order on the shared screen: sign and pay while still on the call (Proposify: e-sign +15% close rate).
  add('sign', 'Work order', `<div class="cols c2" style="align-items:center;gap:64px"><div class="anim"><p class="kicker">Work order</p><h2 style="color:#fff">Start this week</h2>
      <div class="steps"><div class="step"><i>1</i>Review and sign the one page work order</div><div class="step"><i>2</i>Pay the buildout and first month through Stripe</div><div class="step"><i>3</i>Book your onboarding call</div></div>
      <div class="woterms">${EXIT_TERMS.slice(0, 2).map((t) => `<span>${esc(t)}</span>`).join('')}</div>
      <div style="margin-top:28px;display:flex;gap:14px;flex-wrap:wrap"><button class="btn" id="send-wo">Make the work order</button></div>
      <div class="wostat" id="wostat" hidden></div></div>
    <div class="signbox" id="signbox"><div style="font:600 22px var(--display)">Scan to review and sign</div><div style="width:300px;height:300px;display:grid;place-items:center;color:#9AA8A2;text-align:center">Press "Make the work order" to make their link</div></div></div>`,
  `${say('c_post')}\n\nPress Make the work order, then have them scan the code with their phone (or Text it). Walk the three key lines: the services, the amount, the minimum and how to cancel. Then stay quiet while they sign. The status under the button turns to Signed, then Paid, by itself.\n\nIf they hesitate, ask what is unclear and answer it. No added urgency.\n\nAsk: "Any questions on the agreement before you sign?"`, true);

  // What happens next: onboarding booked on this call, or a fixed follow up (Gong: about 4 minutes on next steps in won demos).
  add('next', 'What happens next', `<p class="kicker">What happens next</p><h2>Your first 30 days</h2>
    <div class="cols c2" style="align-items:start;gap:56px">
      <div class="anim"><div class="steps lite"><div class="step"><i>1</i>Onboarding call: access and goals</div><div class="step"><i>2</i>We save your starting map, the before picture</div><div class="step"><i>3</i>Your Google profile and listings get fixed first</div><div class="step"><i>4</i>Your app shows every task as we do it</div></div>
        <div class="box" style="margin-top:22px"><h3>Before the onboarding call</h3><ul class="whyl"><li>Add us as a manager on your Google profile</li><li>Send a few photos of your work</li><li>Have your website login handy, if you have one</li></ul></div></div>
      <div class="box anim book"><h3>Pick a time</h3><p class="small">For the onboarding call, or a quick follow up.</p>
        <label>Day and time<input id="nb-when" type="datetime-local"></label>
        <div class="nbbtns"><button class="btn" id="nb-onb">Book the onboarding call</button><button class="btn ghost" id="nb-fu">Set a follow up instead</button></div>
        <div id="nb-out" class="small" style="margin-top:12px"></div></div></div>`,
  `${say('c_onboard')}\n\nBook it on this call: pick the time together and press Book the onboarding call. It lands on the Hub calendar for this lead.\n\nIf they did not sign: set a specific follow up time with Set a follow up instead, and send the analysis link and the work order today (Send analysis in the top bar).\n\nUse the full 4 minutes here.\n\nAsk: "What time works best for the onboarding call?"`);

  // The order of the clarity audit meeting (public/js/pitchflow.js), so the screens and the script line up.
  return inFlow(out).map((x) => ({ ...x, title: titleOf(x.key) || x.title, purpose: purposeOf(x.key) }));
}


function stageScale() {
  const st = document.querySelector('.stage');
  if (!st) return;
  const s = Math.min(window.innerWidth / 1640, window.innerHeight / 940);
  st.style.transform = `translate(-50%, -50%) scale(${s})`;
}

let list = [];
function renderDeck() {
  list = slides();
  state.i = Math.min(state.i, list.length - 1);
  root.innerHTML = `<div class="progress" id="prog"></div><div class="viewport"><div class="stage">${list.map((s, n) => `<section class="slide${s.dark ? ' dark' : ''}" data-n="${n}">${s.html}${foot(n + 1, list.length, s.dark)}</section>`).join('')}</div></div>
    <div class="bar" id="bar"><button id="prev" aria-label="Previous">←</button><span class="cnt" id="cnt"></span><button id="next" aria-label="Next">→</button>
      ${embedded ? '<button id="pv" hidden>Presenter view</button><button id="fs" hidden>Full screen</button>' : '<button id="pv">Presenter view</button><button id="fs">Full screen</button>'}</div>`;
  stageScale();
  wireDeck();
  go(state.i, false);
}

// The scan slide replays the search spot by spot, center first, like the scan tool does.
let gridTimer = 0;
function where(g, c) {
  const half = (g.size - 1) / 2, step = g.radiusMiles / half;
  const east = (c.col - half) * step, north = (half - c.row) * step;
  const d = Math.hypot(east, north);
  if (d < 0.05) return 'Searching at your address';
  const dirs = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  const ang = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
  return `Searching ${d.toFixed(1)} miles ${dirs[Math.round(ang / 45) % 8]} of you`;
}
function playGrid() {
  const g = activeGrid();
  const grid = document.getElementById('biggrid');
  if (!g || !grid) return;
  const token = ++gridTimer;
  const cells = [...grid.children];
  const phone = document.getElementById('gphone'), stats = document.getElementById('gstats');
  const kw = g.keyword || D.intel?.keyword || 'your service';
  const half = (g.size - 1) / 2;
  const order = g.cells.map((c, i) => ({ i, d: Math.hypot(c.row - half, c.col - half), a: Math.atan2(c.col - half, half - c.row) })).sort((a, b) => a.d - b.d || a.a - b.a).map((x) => x.i);
  cells.forEach((el) => { el.className = `pend${el.dataset.i == Math.floor(cells.length / 2) ? ' center' : ''}`; el.dataset.txt = el.textContent; el.textContent = ''; });
  phone.hidden = false; stats.style.display = 'none';
  const per = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 80 : Math.max(500, Math.min(1100, 8000 / order.length));
  let n = 0;
  const step = () => {
    if (token !== gridTimer) return;
    if (n >= order.length) { cells.forEach((x) => x.classList.remove('now')); phone.hidden = true; stats.style.display = 'grid'; return; }
    const i = order[n++];
    const c = g.cells[i];
    const el = cells[i];
    cells.forEach((x) => x.classList.remove('now'));
    el.className = `${el.dataset.band}${i === Math.floor(cells.length / 2) ? ' center' : ''} now pop`;
    el.textContent = el.dataset.txt;
    const top = (c.top || []).slice(0, 3);
    const you = c.rank;
    phone.innerHTML = `<div class="gwhere">${esc(where(g, c))}</div><div class="gbar">🔍 <span class="gtype" style="--n:${Math.min(36, kw.length)}">${esc(kw)}</span></div>
      <ol class="glist">${top.map((t, k) => `<li style="--k:${k}" class="${you && t.rank === you ? 'you' : ''}"><b>${t.rank}</b><span>${esc(t.title)}</span></li>`).join('')}</ol>
      ${you && you <= 3 ? '' : `<div class="gyou ${you ? (you <= 10 ? 'mid' : 'low') : 'none'}"><b>${you || '20+'}</b><span>${esc(D.lead.business)}</span></div>`}
      <div class="gverdict ${you && you <= 10 ? 'good' : 'bad'}">${you && you <= 3 ? 'A customer here sees you near the top' : you && you <= 10 ? `A customer here sees you at #${you}, on the first page` : `A customer here calls ${esc(top[0]?.title || 'someone else')} first`}</div>`;
    setTimeout(step, per);
  };
  setTimeout(step, 500);
}

function go(n, broadcast = true) {
  const prev = state.i;
  // Leaving the investment slide: what was typed becomes the price on the work order.
  if (list[prev]?.key === 'price' && n !== prev && (state.entered.setup !== '' || state.entered.monthly !== '')) saveQuote();
  state.i = Math.max(0, Math.min(list.length - 1, n));
  document.querySelectorAll('.slide').forEach((el) => { const k = Number(el.dataset.n); el.classList.toggle('on', k === state.i); el.classList.toggle('past', k < state.i); });
  const c = document.getElementById('cnt'); if (c) c.textContent = `${state.i + 1} / ${list.length}`;
  const p = document.getElementById('prog'); if (p) p.style.width = `${((state.i + 1) / list.length) * 100}%`;
  if (broadcast) chan?.postMessage({ type: 'slide', i: state.i, plan: state.plan, ticket: state.ticket, jobs: state.jobs, svc: svcNow() });
  if (!presenter && broadcast) syncOut();
  if (!presenter) { if (list[state.i]?.key === 'sign') watchOrder(); else stopWatch(); }
  if (!presenter && list[state.i]?.key === 'grid' && (prev !== state.i || !broadcast)) playGrid();
  if (!presenter && list[state.i]?.key === 'app') loadApp();
}

function updateCalc() {
  const r = roi({ ticket: state.ticket, jobs: state.jobs, price: state.quote.monthly });
  const set = (sel, t) => { const el = document.getElementById(sel); if (el) el.textContent = t; };
  set('out-month', money(r.monthly)); set('out-year', money(r.yearly));
  set('out-mult', r.multiple >= 1 ? `${r.multiple.toFixed(1)}x your monthly investment` : `Pays for itself at ${r.breakeven} jobs a month`);
}

// The app slide shows the real client app (the sample business), so the owner can tap through it during the meeting.
let appSrc = null;
async function loadApp() {
  const f = document.getElementById('appframe');
  if (!f) return;
  if (!appSrc) {
    try { const r = await api('/api/sample-client', { method: 'POST' }); appSrc = `/?as=${encodeURIComponent(r.id)}#/`; } catch { appSrc = ''; }
  }
  if (appSrc && f.getAttribute('src') !== appSrc) f.setAttribute('src', appSrc);
}

async function runListings(btn) {
  btn.disabled = true; btn.textContent = 'Checking 15 directories...';
  try {
    const r = await api(`/api/leads/${encodeURIComponent(id)}/listings`, { method: 'POST' });
    D.lead.listings = r;
    renderDeck();
  } catch (e) { btn.disabled = false; btn.textContent = e.message; }
}

// The investment slide starts blank; what the rep types becomes the quote the work order uses.
const num = (v) => Math.max(0, Number(String(v).replace(/[$,\s]/g, '')) || 0);
function dueToday() {
  const e = state.entered;
  return e.setup !== '' && e.monthly !== '' ? money(num(e.setup) + num(e.monthly)) : '$';
}
// The quote lives on the lead, so changes made in the meeting carry into the work order and the Hub.
function saveQuote() {
  const q = state.quote;
  return api(`/api/leads/${encodeURIComponent(id)}/quote`, { method: 'PUT', body: { setup: q.setup, monthly: q.monthly, services: q.services.map((x) => ({ id: x.id, qty: x.qty })) } }).catch(() => null);
}
let saveTimer = 0;
const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveQuote, 700); chan?.postMessage({ type: 'svc', svc: svcNow() }); };
const allServices = () => allServicesFor(D.lead, D.intel);

async function sendWorkOrder(btn) {
  if (state.entered.setup === '' || state.entered.monthly === '') {
    if (!confirm(`No price typed on the investment slide. Send the work order at $${state.quote.setup} buildout and $${state.quote.monthly} a month from the lead's quote?`)) return;
  }
  btn.disabled = true; btn.textContent = 'Creating...';
  try {
    await saveQuote();
    orderSince = Date.now();
    const r = await api(`/api/leads/${encodeURIComponent(id)}/work-order`, { method: 'POST', body: { kind: 'seo', setup: state.quote.setup, monthly: state.quote.monthly } });
    stopWatch(); watchOrder();
    const box = document.getElementById('signbox');
    const first = (D.lead.contact_name || '').split(' ')[0];
    const msg = `Hi ${first}, here is your Rightway Growth agreement. Review it, sign, and you can pay right after: ${r.url}`;
    box.innerHTML = `<div style="font:600 22px var(--display)">Scan to review and sign</div>${qrSvg(r.url, { title: 'Agreement link' })}<code>${esc(r.url)}</code>
      <div style="display:flex;gap:10px">${D.lead.phone ? `<a class="btn" href="sms:${esc(D.lead.phone.replace(/[^\d+]/g, ''))}?&body=${encodeURIComponent(msg)}">Text it</a>` : ''}
      ${D.lead.email ? `<a class="btn" href="mailto:${esc(D.lead.email)}?subject=${encodeURIComponent('Your Rightway Growth agreement')}&body=${encodeURIComponent(msg)}">Email it</a>` : ''}
      <button class="btn" id="cp">Copy link</button></div>`;
    document.getElementById('cp').onclick = () => navigator.clipboard?.writeText(r.url);
    btn.textContent = 'Work order ready';
  } catch (e) { btn.disabled = false; btn.textContent = e.message; }
}

// ---------- the live scan, inside the presentation (no new tab, no tab hopping) ----------
// The Scan tool opens over the deck with the business filled in. Save sends a 'deep' message; the deck picks up the new scan and closes it.
function openLive() {
  closeLive();
  const box = document.createElement('div');
  box.className = 'lvscan'; box.id = 'live';
  box.innerHTML = `<div class="live-bar"><b>Live scan for ${esc(D.lead.business)}</b><span>Run it, then press Save. You come back here by yourself.</span><button type="button" id="live-x">Back to the presentation</button></div>
    <div class="live-wait" id="live-wait">Opening the scan tool...</div>
    <iframe src="/scan.html?lead=${encodeURIComponent(id)}&embed=1" title="Live scan" allow="fullscreen"></iframe>`;
  document.body.appendChild(box);
  document.body.classList.add('live-on');
  const fr = box.querySelector('iframe');
  fr.addEventListener('load', () => document.getElementById('live-wait')?.remove());
  document.getElementById('live-x').onclick = () => closeLive();
  setTimeout(() => { const w = document.getElementById('live-wait'); if (w) w.textContent = 'Still loading. If it stays blank, press Back to the presentation and use the saved scan.'; }, 9000);
}
function closeLive() {
  document.getElementById('live')?.remove();
  document.body.classList.remove('live-on');
}

// ---------- work order status, live on the screen (Signed, then Paid) ----------
let orderTimer = 0, orderSince = 0;
function stopWatch() { clearInterval(orderTimer); orderTimer = 0; }
function watchOrder() {
  if (orderTimer) return;
  const tick = async () => {
    if (document.hidden) return;
    try {
      const d = await api(`/api/leads/${encodeURIComponent(id)}`);
      const o = (d.orders || []).find((x) => x.kind !== 'website' && (!orderSince || x.created_at >= orderSince - 60e3)) || null;
      const el = document.getElementById('wostat');
      if (!el || !o) return;
      el.hidden = false;
      el.className = `wostat ${o.paid_at ? 'paid' : o.signed_at ? 'signed' : ''}`;
      el.textContent = o.paid_at ? 'Signed and paid. Welcome aboard.' : o.signed_at ? `Signed${o.signed_name ? ` by ${o.signed_name}` : ''}. Waiting for the payment.` : 'Waiting for the signature...';
      if (o.paid_at) stopWatch();
    } catch { /* try again next tick */ }
  };
  tick();
  orderTimer = setInterval(tick, 4000);
}

// ---------- the last screen: onboarding booked on the call, or a fixed follow up ----------
async function bookNext(kind, btn) {
  const out = document.getElementById('nb-out');
  const v = document.getElementById('nb-when')?.value;
  const start = v ? new Date(v).getTime() : NaN;
  if (!Number.isFinite(start)) { if (out) out.textContent = 'Pick a day and time first.'; return; }
  btn.disabled = true;
  try {
    await api('/api/events', { method: 'POST', body: { title: `${kind === 'onboarding' ? 'Onboarding call' : 'Follow up'}: ${D.lead.business}`, start, minutes: kind === 'onboarding' ? 45 : 20, lead_id: id, note: kind === 'onboarding' ? 'Booked during the clarity audit.' : 'Follow up set at the end of the clarity audit.' } });
    if (out) out.textContent = `${kind === 'onboarding' ? 'Onboarding call' : 'Follow up'} booked for ${new Date(start).toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. It is on the Hub calendar.`;
    btn.textContent = 'Booked';
  } catch (e) { btn.disabled = false; if (out) out.textContent = e.message; }
}

// ---------- notes on a second device (a mirrored iPad share shows everything on the iPad) ----------
// The deck saves where it is; the presenter view on a phone or laptop polls it and can send Back and Next.
let syncTimer = 0, lastCmd = 0, firstSync = true;
const deckStart = Date.now();
function syncOut() {
  clearTimeout(syncTimer);
  // The first save of a new meeting also stamps when it started, so the phone notes keep pace with the meeting, not with the phone.
  const body = { i: state.i, n: list.length, t0: deckStart, reset: firstSync };
  firstSync = false;
  syncTimer = setTimeout(() => api(`/api/present/${encodeURIComponent(id)}/sync`, { method: 'PUT', body }).catch(() => {}), 250);
}
function syncIn() {
  setInterval(async () => {
    if (document.hidden) return;
    try {
      const r = await api(`/api/present/${encodeURIComponent(id)}/sync`);
      if (r.cseq && r.cseq !== lastCmd) { const first = !lastCmd; lastCmd = r.cseq; if (!first && Number.isInteger(r.cmd)) go(r.cmd); }
    } catch { /* offline for a moment */ }
  }, 2500);
}

function wireDeck() {
  document.getElementById('prev').onclick = () => go(state.i - 1);
  document.getElementById('next').onclick = () => go(state.i + 1);
  document.getElementById('fs').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
  document.getElementById('pv').onclick = () => window.open(`/present.html?presenter=1#${encodeURIComponent(id)}`, 'rw-presenter', 'width=1100,height=760');
  document.querySelectorAll('[data-drop]').forEach((b) => { b.onclick = () => { state.quote.services = state.quote.services.filter((x) => x.id !== b.dataset.drop); saveSoon(); renderDeck(); }; });
  const add = document.getElementById('svc-add');
  if (add) add.onchange = () => { const x = allServices().find((y) => y.id === add.value); if (x) { state.quote.services.push(x); saveSoon(); renderDeck(); } };
  const qs = document.getElementById('q-setup'), qm = document.getElementById('q-monthly');
  const qUpdate = () => {
    state.entered = { setup: qs.value.trim(), monthly: qm.value.trim() };
    if (state.entered.setup !== '') state.quote.setup = num(qs.value);
    if (state.entered.monthly !== '') state.quote.monthly = num(qm.value);
    const el = document.getElementById('q-today'); if (el) el.textContent = dueToday();
  };
  if (qs) qs.oninput = qUpdate;
  if (qm) qm.oninput = qUpdate;
  const t = document.getElementById('in-ticket'), j = document.getElementById('in-jobs');
  if (t) t.oninput = () => { state.ticket = Number(t.value) || 0; updateCalc(); };
  if (j) j.oninput = () => { state.jobs = Number(j.value) || 0; updateCalc(); };
  const wo = document.getElementById('send-wo'); if (wo) wo.onclick = () => sendWorkOrder(wo);
  const rl = document.getElementById('run-lst'); if (rl) rl.onclick = () => runListings(rl);
  const rp = document.getElementById('greplay'); if (rp) rp.onclick = () => playGrid();
  const ds = document.getElementById('deepscan'); if (ds) ds.onclick = () => openLive();
  const nbw = document.getElementById('nb-when');
  if (nbw && !nbw.value) { const d = new Date(Date.now() + 2 * 864e5); d.setHours(10, 0, 0, 0); nbw.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T10:00`; }
  const nbOn = document.getElementById('nb-onb'), nbFu = document.getElementById('nb-fu');
  if (nbOn) nbOn.onclick = () => bookNext('onboarding', nbOn);
  if (nbFu) nbFu.onclick = () => bookNext('follow', nbFu);
  document.querySelectorAll('[data-kw]').forEach((b) => { b.onclick = () => { state.kwi = Number(b.dataset.kw); renderDeck(); }; });
}

function startDeck() {
  renderDeck();
  window.addEventListener('resize', stageScale);
  document.addEventListener('keydown', (e) => {
    if (/input|select|textarea/i.test(e.target.tagName)) return;
    if (e.key === 'Escape' && document.getElementById('live')) { closeLive(); return; }
    if (document.getElementById('live')) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(state.i + 1); }
    if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(state.i - 1); }
    if (e.key === 'f' || e.key === 'F') document.getElementById('fs').click();
    if (e.key === 'p' || e.key === 'P') document.getElementById('pv').click();
    if (e.key === 'Home') go(0);
    if (e.key === 'End') go(list.length - 1);
  });
  let idle;
  const bar = () => { const b = document.getElementById('bar'); if (!b) return; b.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => document.getElementById('bar')?.classList.add('idle'), 2500); };
  document.addEventListener('mousemove', bar); bar();
  // Back from the Scan tool tab: pick up the deep scan it saved.
  const refresh = async () => {
    try {
      const d = await api(`/api/leads/${encodeURIComponent(id)}`);
      if ((d.lead.deep_scan || '') !== (D.lead.deep_scan || '') || (d.lead.listings || '') !== (D.lead.listings || '')) { D.lead = { ...D.lead, deep_scan: d.lead.deep_scan, listings: d.lead.listings }; state.kwi = 0; renderDeck(); }
    } catch { /* keep what we have */ }
  };
  window.addEventListener('focus', refresh);
  syncIn();
  syncOut();
  chan?.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.type === 'deep') { closeLive(); refresh(); }
    if (m.type === 'go') go(m.i);
    if (m.type === 'hello') chan.postMessage({ type: 'slide', i: state.i, plan: state.plan, ticket: state.ticket, jobs: state.jobs, svc: svcNow() });
  });
}

// ---------- presenter view ----------
function startPresenter() {
  document.body.classList.add('presenter');
  let t0 = Date.now();
  const asked = new Set();
  // Follow the deck from another device: where it is now (polled), so a phone can hold the notes while an iPad shares the screen.
  setInterval(async () => {
    if (document.hidden) return;
    try { const r = await api(`/api/present/${encodeURIComponent(id)}/sync`); if (Number.isFinite(r.t0) && r.t0 < t0) t0 = r.t0; if (Number.isInteger(r.i) && r.i !== state.i && !document.querySelector('.pv input:focus')) { state.i = r.i; render(); } } catch { /* try again */ }
  }, 2000);
  const render = () => {
    list = slides();
    const s = list[state.i] || list[0];
    const nx = list[state.i + 1];
    const script = buildScript(D.lead, D.intel, { rep: D.rep, voice: D.voice, plan: state.plan, ticket: state.ticket, quote: state.quote }, D.custom);
    const pc = pace(s.key, (Date.now() - t0) / 60000);
    root.innerHTML = `<div class="pv"><div><h1>${esc(s.title)}</h1><div class="meta">Screen ${state.i + 1} of ${list.length}${nx ? ` · Next: ${esc(nx.title)}` : ''} · ${esc(D.lead.business)}${pc ? ` · <span class="pace ${Math.abs(pc.diff) <= 2 ? 'ok' : 'off'}">Plan: minute ${pc.at}, ${esc(pc.text)}</span>` : ''}</div>
        ${s.purpose ? `<div class="purpose">${esc(s.purpose)}</div>` : ''}
        <div class="notes">${esc(s.notes)}</div>
        <div class="ctrls" style="margin-top:16px"><button class="ghost" id="pp">← Back</button><button id="pn">Next →</button></div></div>
      <div class="side"><div class="card"><div class="small" style="color:#85988F">Time in meeting</div><div class="timer" id="tm">0:00</div></div>
        <div class="card guide"><b>Pricing guide (closer only)</b>${(() => { const r = refFor(svcNow()); return `<p class="gref"><span>${esc(r.name)}</span> ${esc(refMoney(r.monthly))} a month to start</p>${r.why.length ? `<p class="small">${esc(r.why.join('; '))}</p>` : ''}${r.key === 'starter' ? '' : `<p class="small">Entry plan (loss leader): ${esc(r.entry.name)} ${esc(refMoney(r.entry.monthly))}</p>`}${r.next ? `<p class="small">Upsell after results: ${esc(r.next.name)} ${esc(refMoney(r.next.monthly))} adds ${esc(r.adds.join('; '))}</p>` : ''}<p class="small">Buildout is your custom number. The client never sees this card.</p>`; })()}</div>
        <div class="card list">${list.map((x, n) => `<button data-go="${n}" class="${n === state.i ? 'on' : ''}">${n + 1}. ${esc(x.title)}</button>`).join('')}</div>
        <div class="card qs"><b>Discovery questions (tick as you ask)</b>${QUESTIONS.map((q, n) => `<label><input type="checkbox" data-q="${n}"${asked.has(n) ? ' checked' : ''}> ${esc(q)}</label>`).join('')}</div>
        <div class="card"><b>Objections</b>${script.objections.filter((o) => o.kind === 'meeting').map((o) => `<details><summary>${esc(o.q)}</summary><p>${esc(o.a)}</p></details>`).join('')}</div></div></div>`;
    // Same device: BroadcastChannel. Another device (phone notes next to an iPad share): the server relay.
    const send = (i) => { state.i = i; chan?.postMessage({ type: 'go', i }); api(`/api/present/${encodeURIComponent(id)}/sync`, { method: 'PUT', body: { cmd: i } }).catch(() => {}); render(); };
    document.getElementById('pp').onclick = () => send(Math.max(0, state.i - 1));
    document.getElementById('pn').onclick = () => send(Math.min(list.length - 1, state.i + 1));
    document.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => send(Number(b.dataset.go)); });
    document.querySelectorAll('[data-q]').forEach((b) => { b.onchange = () => { if (b.checked) asked.add(Number(b.dataset.q)); else asked.delete(Number(b.dataset.q)); }; });
  };
  setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); const el = document.getElementById('tm'); if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 1000);
  // The closer may add, drop or resize services in the deck window: keep the pricing guide in step.
  const takeSvc = (svc) => {
    if (!Array.isArray(svc)) return;
    const all = allServices();
    state.quote.services = svc.map((x) => { const a = all.find((y) => y.id === x.id); return a ? { ...a, qty: x.qty } : null; }).filter(Boolean);
    state.svc = svc;
  };
  chan?.addEventListener('message', (e) => { const m = e.data || {}; if (m.type === 'slide') { Object.assign(state, { i: m.i, plan: m.plan, ticket: m.ticket, jobs: m.jobs }); takeSvc(m.svc); render(); } if (m.type === 'svc') { takeSvc(m.svc); render(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === ' ') document.getElementById('pn')?.click(); if (e.key === 'ArrowLeft') document.getElementById('pp')?.click(); });
  render();
  chan?.postMessage({ type: 'hello' });
}

async function boot() {
  if (!id) { root.innerHTML = '<div class="err">Open a presentation from a lead in the Hub.</div>'; return; }
  try {
    const [d, me, s] = await Promise.all([api(`/api/leads/${encodeURIComponent(id)}`), api('/api/me'), api('/api/settings').catch(() => ({}))]);
    if (!can(me.user, 'close')) { root.innerHTML = '<div class="err"><div>Presentations are run by closers. Ask an owner to hand you the call.<br><a href="/">Back to the Hub</a></div></div>'; return; }
    D = { lead: d.lead, intel: d.intel, rep: (me.user?.name || '').split(' ')[0] || '', voice: me.user?.role === 'admin' ? 'I' : 'we', custom: { script: s.script || {}, objections: s.objections || null, number: s.number || '' } };
    const info = industryInfo(D.lead.industry, D.intel?.listing?.category || D.lead.category);
    state.quote = quoteFor(D.lead, D.intel, D.lead.quote);
    state.plan = state.quote.plan;
    state.ticket = info.ticket;
    document.title = `${D.lead.business}: growth plan`;
    if (presenter) startPresenter(); else startDeck();
  } catch (e) {
    root.innerHTML = e.status === 401 || e.status === 403 ? '<div class="err"><div>Log in to the Hub first.<br><a href="/">Open Rightway Hub</a></div></div>' : `<div class="err">${esc(e.message)}</div>`;
  }
}
boot();
