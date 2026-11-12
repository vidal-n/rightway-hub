// Presentation mode: a tailored deck for one lead, built from the research, with a presenter view in a second window.
// Open /present.html#<leadId>. Presenter view: /present.html?presenter=1#<leadId>. Keys: arrows or space, F fullscreen, P presenter view.
import { findProblems, industryInfo, rankText, buildScript, roi, top10Of, quoteFor, allServicesFor, unbold } from './leadintel.js';
import { ninetyDayPlan, reviewTarget } from './fulfill.js';
import { SERVICE_LIST } from './plancopy.js';
import { qrSvg } from './qr.js';
import { parseListings, listingsLine, listingsTable } from './listings.js';
import { can } from './jobs.js';

const root = document.getElementById('root');
const id = decodeURIComponent(location.hash.slice(1));
const presenter = new URLSearchParams(location.search).get('presenter') === '1';
const chan = 'BroadcastChannel' in window ? new BroadcastChannel(`rw-present-${id}`) : null;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

async function api(path, opts = {}) {
  const res = await fetch(path, { method: opts.method || 'GET', headers: { 'x-rw': '1', ...(opts.body ? { 'content-type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
  return data;
}

const state = { i: 0, plan: 'growth', ticket: 500, jobs: 4, quote: null, entered: { setup: '', monthly: '' }, kwi: 0 };
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
  const nd = ninetyDayPlan(plan, intel, lead);
  const out = [];
  const add = (key, title, html, notes, dark = false) => out.push({ key, title, html, notes, dark });
  // Presenter notes come straight from the one pitch (the Google clarity call), so the deck and the phone script never drift apart.
  const say = (id, coach = true) => (script.steps.find((x) => x.id === id)?.lines || []).filter((l) => coach || !/^\(/.test(l)).map(unbold).join('\n\n');

  add('cover', 'Cover', `
    <img class="cover-mark" src="/brand/rightway-mark-light.svg" alt="">
    <div class="anim"><p class="kicker">Local growth plan</p><h1>${esc(lead.business)}:<br>more calls from Google${city ? ` in ${esc(city)}` : ''}</h1>
    <p class="lead">Prepared for ${esc(lead.contact_name || 'you')} by Rightway Growth</p></div>
    <div class="cover-meta"><div><b>${esc(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}</b>Date</div><div><b>${esc(kw)}</b>Main search</div>${D.rep ? `<div><b>${esc(D.rep)}</b>Your strategist</div>` : ''}</div>`,
  `Google clarity audit. Set the frame:\n\n${say('c_frame')}\n\nCheck: is everyone who decides on marketing here?`, true);

  add('agenda', 'Agenda', `<div class="anim"><p class="kicker">Today</p><h2>What we'll cover in 20 minutes</h2>
    <ol class="agenda"><li>How customers find ${esc(info.label.toLowerCase())} businesses in ${esc(city || 'your area')}</li><li>Where you show up today, street by street</li><li>You vs the businesses getting the calls</li><li>What's holding you back</li><li>The plan, the timeline, and the investment</li></ol></div>`,
  `Discovery. Write every answer down, you will use their words later.\n\n${say('c_discovery')}\n\nThen verify:\n${say('c_verify')}`);

  add('pack', 'How customers find you', `<p class="kicker">How customers find you</p><h2>When someone searches "${esc(kw)}" near ${esc(city || 'you')}, Google shows 3 businesses first</h2>
    <div class="cols c2" style="align-items:start"><div class="pack anim"><div class="q">🔍 ${esc(kw)}</div>
      ${comps.map((c, i) => `<div class="row"><span class="pin">${String.fromCharCode(65 + i)}</span><div><b>${esc(c.title)}</b><br><span style="font-size:18px;color:#61716B">${c.rating ? stars(c.rating) : ''} (${c.reviews ?? 0})</span></div></div>`).join('') || '<div class="row">Run research to show the live map pack.</div>'}
      ${intel ? `<div class="row you"><span class="pin">${intel.rank && intel.rank <= 20 ? intel.rank : '?'}</span><div><b>${esc(lead.business)}</b><br><span style="font-size:18px;color:#61716B">You: ${esc(rankText(intel.rank))}${L.reviews != null ? ` · ${L.reviews} reviews` : ''}</span></div></div>` : ''}</div>
      <div class="anim"><div class="box"><h3>Why every spot matters</h3><p>Most people call one of the first businesses they see on the map, and few look past the first page. Each spot higher gets more of the calls. Spots are earned with a complete Google profile, reviews, a website Google trusts, and steady activity. Every one of those is something we can work on.</p></div></div></div>`,
  `Teach them something about their own market:\n"This is exactly what your customer sees when they search ${kw}. Most people call one of the first few and few scroll past the first page."\n${comps[0] ? `${comps[0].title} gets the first look with ${comps[0].reviews ?? 'a lot of'} reviews.\n` : ''}You come up ${intel ? rankText(intel.rank) : '(run research first)'}.\n\nAsk: "When you search your own service, where do you see yourself?"`);

  const g = activeGrid();
  const deep = deepScans();
  const scanBtn = `<button class="replay" id="deepscan" type="button" title="Opens the Scan tool in its own tab, filled in for ${esc(lead.business)}">${g?.deep ? 'Run it again' : 'Run the full scan'}</button>`;
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
    `${say('c_scan')}\n\n${g.deep ? `This is the deep scan from the Scan tool tab (${deep.length} keyword${deep.length === 1 ? '' : 's'}). Click a keyword above the grid to switch.` : 'This is the quick research grid. For the full picture press "Run the full scan": it opens the Scan tool in its own tab. Run it during discovery, press Save to lead, and this slide updates by itself.'}\n\nLet the scan play. Narrate it:\n"I stood in ${g.points} spots around ${lead.business}, up to ${g.radiusMiles} miles out, and searched ${gkw} on Google the way a customer does. Watch who comes up at each spot."\n\nWhen it finishes: "First page in ${top10Of(g)} of ${g.points}. Every red and orange square is a customer who called someone else."\n\nThen ask and wait: "What do you think that's costing you?"`);
  } else {
    add('grid', 'The scan', `<p class="kicker">The scan</p><h2>Where ${esc(lead.business)} shows up, street by street</h2>
      <div class="box anim" style="max-width:880px"><h3>Run it live</h3><p>Press the button: the Scan tool opens in its own tab with ${esc(lead.business)} filled in. Run the scan while you talk, press Save to lead, then come back here. This slide fills in by itself.</p>
      <div style="margin-top:18px">${scanBtn}</div></div>`,
    `${say('c_scan')}\n\nNo scan yet. Press "Run the full scan" (opens the Scan tool tab). Start it during discovery so it is ready by now.`);
  }

  if (comps.length) {
    const rows = [{ title: lead.business, rating: L.rating, reviews: L.reviews, category: L.category, site: L.url || lead.website, you: true }, ...comps.map((c) => ({ title: c.title, rating: c.rating, reviews: c.reviews, category: c.category, site: c.domain }))];
    const maxRev = Math.max(...rows.map((x) => x.reviews || 0));
    add('vs', 'You vs the leaders', `<p class="kicker">You vs the leaders</p><h2>${comps[0].reviews > (L.reviews || 0) ? `${esc(comps[0].title)} has ${comps[0].reviews - (L.reviews || 0)} more reviews` : 'How you stack up'}</h2>
      <table class="vs anim"><thead><tr><th>Business</th><th>Reviews</th><th>Rating</th><th>Google category</th><th>Website</th></tr></thead><tbody>
      ${rows.map((x) => `<tr class="${x.you ? 'you' : ''}"><td>${x.you ? '★ ' : ''}${esc(x.title)}</td><td class="${x.reviews === maxRev ? 'good' : x.you ? 'badv' : ''}">${x.reviews ?? '-'}</td><td>${x.rating ? stars(x.rating) : '-'}</td><td>${esc(x.category || '-')}</td><td>${x.site ? '✓' : '<span class="badv">None</span>'}</td></tr>`).join('')}
      </tbody></table>`,
    `These are the businesses showing up highest around you.\n${comps.map((c) => `${c.title}: ${c.reviews ?? '?'} reviews, ${c.rating ?? '?'} stars`).join('\n')}\nYou: ${L.reviews ?? '?'} reviews, ${L.rating ?? '?'} stars.\n\nAsk: "Do you know these guys? Is their work better than yours?" (Almost always no.)\nThen: "So the only difference is what Google sees. That part is fixable."\n\n${say('c_why')}`);
  }

  add('problems', 'What is holding you back', `<p class="kicker">What we found</p><h2>${probs.length ? `${probs.length} things holding ${esc(lead.business)} back` : 'Your foundation is solid'}</h2>
    ${probs.length ? `<div class="probs anim">${probs.slice(0, 6).map((p) => `<div class="prob ${p.severity}"><b>${esc(p.title)}</b><span>${esc(p.detail)}</span></div>`).join('')}</div>` : '<p class="lead">No major gaps. The plan focuses on protecting your spot and growing into more searches and areas.</p>'}`,
  probs.length ? `One at a time: what it is, and what it costs them in calls. Plain words.\n\n${probs.slice(0, 6).map((p) => `• ${p.talk}`).join('\n')}\n\nAsk: "Which of these surprises you most?" Lead with that one in the close.\n\n${say('c_listings')}` : `Pitch growth: more searches, more areas, staying ahead of competitors who are catching up.\n\n${say('c_listings')}`);

  const W = intel?.website;
  if (intel?.speed || (W && W.ok)) {
    const s = intel.speed?.score;
    const color = s == null ? '#9AA8A2' : s >= 90 ? '#23B07E' : s >= 50 ? '#E8A33D' : '#D64545';
    const C = 2 * Math.PI * 70;
    const checks = W && W.ok ? [[W.https, 'Secure (HTTPS)'], [W.titleHasService && W.titleHasCity, 'Title says what you do and where'], [W.tel, 'Tap to call on phones'], [W.schema, 'Local business schema for Google'], [W.viewport, 'Built for mobile screens'], [W.form, 'Contact or quote form']] : [];
    add('site', 'Your website', `<p class="kicker">Your website</p><h2>${s != null && s < 50 ? 'Your site is slow on phones' : 'How your website helps or hurts'}</h2>
      <div class="cols" style="grid-template-columns:auto 1fr;gap:80px;align-items:center">
        <div class="gauge"><svg viewBox="0 0 160 160"><circle cx="80" cy="80" r="70" fill="none" stroke="#EAF1EE" stroke-width="16"/><circle cx="80" cy="80" r="70" fill="none" stroke="${color}" stroke-width="16" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - (s ?? 0) / 100)}"/></svg>
          <div class="v"><div>${s ?? '?'}<small>Google mobile speed score</small></div></div></div>
        <ul class="checks anim">${checks.map(([ok, t]) => `<li class="${ok ? 'ok' : ''}">${esc(t)}</li>`).join('')}${W?.platform ? `<li class="ok">Built on ${esc(W.platform)}</li>` : ''}</ul></div>`,
    `${s != null ? `Google scores the site ${s} out of 100 on mobile.${intel.speed.lcp ? ` The main content takes ${intel.speed.lcp} to show.` : ''}` : ''}\nMost of their customers search on a phone.\n${checks.filter(([ok]) => !ok).map(([, t]) => `Missing: ${t}`).join('\n')}`);
  }

  const LS = parseListings(lead.listings);
  const lc = LS?.counts || {};
  add('listings', 'Inconsistencies', `<p class="kicker">Inconsistencies</p><h2>${LS ? `${(lc.mismatch || 0) + (lc.missing || 0)} of ${LS.results.length} directories Google checks have you wrong or missing` : 'Where Google double checks you'}</h2>
    ${LS ? `<p class="lead" style="margin:-6px 0 18px">${esc(listingsLine(LS))}</p><div class="anim lstwrap">${listingsTable(LS, { max: 12, links: true })}</div>`
      : `<p class="lead">Google checks your name, address and phone against dozens of sites before it trusts you. Let's see what it finds for ${esc(lead.business)}.</p><button class="btn" id="run-lst" style="margin-top:26px">Run the listing check now</button><div id="lst-out" class="lstwrap" style="margin-top:20px"></div>`}`,
  `SCREEN: this slide. Point at each red row first, then the yellow ones.\n\n${LS ? listingsLine(LS) : 'Press "Run the listing check now" (about 3 cents, 15 directories). It takes about 10 seconds.'}\n\n${say('c_listings')}`);

  add('worth', 'What it is worth', `<p class="kicker">What it's worth</p><h2>What a few more jobs a month means for you</h2>
    <div class="calc"><div class="anim"><label>Average job value<input id="in-ticket" type="number" min="0" step="50" value="${state.ticket}"></label>
      <label>Extra jobs a month from Google<input id="in-jobs" type="number" min="0" step="1" value="${state.jobs}"></label></div>
      <div class="out"><div class="num" id="out-month">${money(r.monthly)}</div><div class="label">extra revenue a month</div>
        <div class="num" style="font-size:64px;margin-top:26px" id="out-year">${money(r.yearly)}</div><div class="label">a year</div>
        <div class="label" style="margin-top:26px;font-size:22px;color:#fff" id="out-mult">${r.multiple >= 1 ? `${r.multiple.toFixed(1)}x your monthly investment` : `Pays for itself at ${r.breakeven} jobs a month`}</div></div></div>
    <p class="note">Your numbers, not a promise. Fill these in together.</p>`,
  `Let them give the numbers. Type their answers in:\n• "What's a typical job worth to you?" (starting guess ${money(info.ticket)} for ${info.label.toLowerCase()})\n• "If you got a few more calls a week, how many would you close?"\n\nSay: "At ${money(state.ticket)} a job, ${r.breakeven} extra job${r.breakeven === 1 ? '' : 's'} a month covers the whole thing. Everything after that is yours."\nThen stop and let it sink in.`);

  const t10 = intel?.grid ? top10Of(intel.grid) : null;
  add('plan', 'What gets you results', `<p class="kicker">What gets you results</p><h2>What ${esc(lead.business)} needs to reach the first page</h2>
    ${intel?.grid ? `<p class="lead" style="margin:-6px 0 22px">Today: first page (top 10) in ${t10} of ${intel.grid.points} spots around you. Goal: the first page across ${esc(city || 'your area')}, then climb.</p>` : ''}
    <div class="svcs anim${Q.services.length > 6 ? ' many' : ''}">${Q.services.map((x) => `<div class="svc" data-svc="${esc(x.id)}"><button class="svc-x" data-drop="${esc(x.id)}" title="Remove" aria-label="Remove ${esc(x.name)}">×</button><b>${esc(x.name)}</b><span>${x.unit ? `<strong>${x.qty} ${esc(x.unit)}.</strong> ` : ''}${esc(x.why || x.what)}</span></div>`).join('')}</div>
    ${SERVICE_LIST.some((x) => !Q.services.find((y) => y.id === x.id)) ? `<div class="svc-add" style="position:absolute;bottom:96px;right:116px"><select id="svc-add"><option value="">Add a service</option>${SERVICE_LIST.filter((x) => !Q.services.find((y) => y.id === x.id)).map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div>` : ''}`,
  `Only what they need. Walk each one: what it is, and why it gets them onto the first page (top 10) in more of their area. Rank also depends on distance and relevance, so never promise a spot.\n\n${say('c_story')}\n\n(Hover a service and press × to drop it, or add one from the list. The price slide and the work order use this list.)`);

  add('days', 'First 90 days', `<p class="kicker">First 90 days</p><h2>What happens after you say yes</h2>
    <div class="months anim">${nd.months.map((m) => `<div class="month"><h3>${esc(m.title)}</h3><ul>${m.items.slice(0, 5).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}</div>
    ${nd.fixes.length ? `<p class="note" style="margin-top:22px">Your fixes first: ${esc(nd.fixes.slice(0, 4).map((f) => `${f.title} (week ${f.week})`).join(' · '))}</p>` : ''}`,
  `${say('c_program')}\n\n` + 'Make it concrete so it feels safe. Onboarding call within a few business days of signing. Month 1 is the foundation, month 2 we build, month 3 it compounds.\n\nBe honest about timing: profile fixes and reviews move things in 30 to 60 days, pages and links build over 3 to 6 months. Honesty here is what makes them trust the rest.');

  if (intel?.found) {
    add('reviews', 'Reviews', `<p class="kicker">Reviews</p><h2>${rt.leader && rt.gap ? `${rt.gap} reviews to pass ${esc(rt.leader)}` : 'Keep the reviews coming'}</h2>
      <div class="cols c3 anim"><div class="box"><div class="num">${rt.mine}</div><div class="label">your Google reviews today</div></div>
        <div class="box"><div class="num">${rt.leaderReviews ?? '-'}</div><div class="label">${esc(rt.leader || 'the leader')}</div></div>
        <div class="box"><div class="num">${rt.perMonth}<small>/mo</small></div><div class="label">new reviews a month to get there in 6 months</div></div></div>
      <p class="lead" style="margin-top:30px">Your team texts a review link from the Rightway app in 5 seconds, and a QR code at the counter catches the rest. Every request is tracked.</p>`,
    `${rt.text}\nReviews are what customers trust most, and they are what Google watches.\nThe app makes asking easy: type a name and number, tap send. Real reviews from real customers, straight to Google.\n\nAsk: "Who on your team could send these after every job?"`);
  }

  add('app', 'Your app', `<p class="kicker">You see everything</p><h2>Your own Rightway app</h2>
    <div class="cols" style="grid-template-columns:auto 1fr;gap:80px;align-items:center">
      <div class="phone live"><iframe id="appframe" title="The Rightway client app" src="about:blank" loading="lazy"></iframe><div class="phone-hint">Tap around: this is the real app</div></div>
      <ul class="feat anim"><li><b>Rankings map every month</b><span>See exactly where you show up, compared to your starting point.</span></li>
        <li><b>Every task we do, logged</b><span>Posts, pages, citations, fixes. Nothing hidden.</span></li>
        <li><b>Review requests from your phone</b><span>Text or email a link in seconds, plus a counter QR code.</span></li>
        <li><b>Snap a photo, we post it</b><span>We write the post for Google, Facebook, and Instagram.</span></li>
        <li><b>A monthly results meeting</b><span>We go over the numbers and the next month's plan.</span></li>
        <li><b>Always getting better</b><span>We add new features every month. You get them free, automatically.</span></li></ul></div>`,
  `SCREEN: this slide. The phone is the real client app (a sample business). Tap Home, then Rankings, then Reviews (send a request), then Post a photo, then Tasks. Say: "This is what you get on day one, and we keep adding to it."\n\nThis answers "how do I know you will do the work?" before they ask it.\n\n${say('c_process')}\n\nThen the trial close:\n${say('c_trial')}`);

  add('price', 'Investment', `<p class="kicker">Your investment</p><h2>Built for ${esc(lead.business)}, not a package</h2>
    <div class="invest anim">
      <div class="box"><div class="label">One time buildout</div><div class="num">$<input id="q-setup" class="qin" inputmode="decimal" value="${esc(state.entered.setup)}" aria-label="Buildout"></div></div>
      <div class="box"><div class="label">Monthly</div><div class="num">$<input id="q-monthly" class="qin" inputmode="decimal" value="${esc(state.entered.monthly)}" aria-label="Monthly"></div></div>
      <div class="box dark"><div class="label">Due today</div><div class="num" id="q-today">${dueToday()}</div><div class="label">next payment in 30 days</div></div>
    </div>
    <p class="note" style="margin-top:22px">Includes: ${esc(Q.services.map((x) => x.name).join(', '))}.</p>
    <div class="terms"><span>3 month minimum, then month to month</span><span>30 days notice to cancel after that</span><span>You own your profile and accounts</span><span>No ranking guarantees, every task shown in your app</span></div>`,
  `Drop close. The amounts start blank: click each box and type the buildout and monthly you set from discovery. When you move to the next slide they are saved to the lead, and Send the work order fills them in.\n\n${say('c_price')}\n\n${say('c_close')}\n\nIf price comes up: ${script.objections.find((o) => /afford/i.test(o.q))?.a || ''}\n\nIf it still doesn't fit: ${script.objections.find((o) => /\\(drop\\)/.test(o.q))?.a || ''}`);

  add('next', 'Next steps', `<div class="cols c2" style="align-items:center;gap:64px"><div class="anim"><p class="kicker">Next steps</p><h2 style="color:#fff">Start this week</h2>
      <div class="steps"><div class="step"><i>1</i>Sign the one page work order</div><div class="step"><i>2</i>Secure payment through Stripe</div><div class="step"><i>3</i>Book your onboarding call</div><div class="step"><i>4</i>Baseline map saved, work starts</div></div>
      <div style="margin-top:34px;display:flex;gap:14px"><button class="btn" id="send-wo">Send the work order</button></div></div>
    <div class="signbox" id="signbox"><div style="font:600 22px var(--display)">Scan to review and sign</div><div style="width:300px;height:300px;display:grid;place-items:center;color:#9AA8A2;text-align:center">Press "Send the work order" to make their link</div></div></div>`,
  `${say('c_post')}\n\nPress the button, have them scan the code or send the link.\n\n${say('c_onboard')}`, true);

  // Same order as the clarity call script, so the screen cues line up slide by slide.
  const ORDER = ['cover', 'agenda', 'pack', 'grid', 'vs', 'problems', 'listings', 'site', 'plan', 'days', 'app', 'reviews', 'worth', 'price', 'next'];
  out.sort((a, b) => (ORDER.indexOf(a.key) + 1 || 99) - (ORDER.indexOf(b.key) + 1 || 99));
  return out;
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
      <button id="pv">Presenter view</button><button id="fs">Full screen</button></div>`;
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
  if (broadcast) chan?.postMessage({ type: 'slide', i: state.i, plan: state.plan, ticket: state.ticket, jobs: state.jobs });
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
const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveQuote, 700); };
const allServices = () => allServicesFor(D.lead, D.intel);

async function sendWorkOrder(btn) {
  if (state.entered.setup === '' || state.entered.monthly === '') {
    if (!confirm(`No price typed on the investment slide. Send the work order at $${state.quote.setup} buildout and $${state.quote.monthly} a month from the lead's quote?`)) return;
  }
  btn.disabled = true; btn.textContent = 'Creating...';
  try {
    await saveQuote();
    const r = await api(`/api/leads/${encodeURIComponent(id)}/work-order`, { method: 'POST', body: { kind: 'seo', setup: state.quote.setup, monthly: state.quote.monthly } });
    const box = document.getElementById('signbox');
    const first = (D.lead.contact_name || '').split(' ')[0];
    const msg = `Hi ${first}, here is your Rightway Growth agreement. Review it, sign, and you can pay right after: ${r.url}`;
    box.innerHTML = `<div style="font:600 22px var(--display)">Scan to review and sign</div>${qrSvg(r.url, { title: 'Agreement link' })}<code>${esc(r.url)}</code>
      <div style="display:flex;gap:10px">${D.lead.phone ? `<a class="btn" href="sms:${esc(D.lead.phone.replace(/[^\d+]/g, ''))}?&body=${encodeURIComponent(msg)}">Text it</a>` : ''}
      ${D.lead.email ? `<a class="btn" href="mailto:${esc(D.lead.email)}?subject=${encodeURIComponent('Your Rightway Growth agreement')}&body=${encodeURIComponent(msg)}">Email it</a>` : ''}
      <button class="btn" id="cp">Copy link</button></div>`;
    document.getElementById('cp').onclick = () => navigator.clipboard?.writeText(r.url);
    btn.textContent = 'Agreement sent';
  } catch (e) { btn.disabled = false; btn.textContent = e.message; }
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
  const ds = document.getElementById('deepscan'); if (ds) ds.onclick = () => window.open(`/scan.html?lead=${encodeURIComponent(id)}`, `rw-scan-${id}`);
  document.querySelectorAll('[data-kw]').forEach((b) => { b.onclick = () => { state.kwi = Number(b.dataset.kw); renderDeck(); }; });
}

function startDeck() {
  renderDeck();
  window.addEventListener('resize', stageScale);
  document.addEventListener('keydown', (e) => {
    if (/input|select|textarea/i.test(e.target.tagName)) return;
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
  chan?.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.type === 'deep') refresh();
    if (m.type === 'go') go(m.i);
    if (m.type === 'hello') chan.postMessage({ type: 'slide', i: state.i, plan: state.plan, ticket: state.ticket, jobs: state.jobs });
  });
}

// ---------- presenter view ----------
function startPresenter() {
  document.body.classList.add('presenter');
  const t0 = Date.now();
  const render = () => {
    list = slides();
    const s = list[state.i] || list[0];
    const nx = list[state.i + 1];
    const script = buildScript(D.lead, D.intel, { rep: D.rep, voice: D.voice, plan: state.plan, ticket: state.ticket, quote: state.quote }, D.custom);
    root.innerHTML = `<div class="pv"><div><h1>${esc(s.title)}</h1><div class="meta">Slide ${state.i + 1} of ${list.length}${nx ? ` · Next: ${esc(nx.title)}` : ''} · ${esc(D.lead.business)}</div>
        <div class="notes">${esc(s.notes)}</div>
        <div class="ctrls" style="margin-top:16px"><button class="ghost" id="pp">← Back</button><button id="pn">Next →</button></div></div>
      <div class="side"><div class="card"><div class="small" style="color:#85988F">Time in meeting</div><div class="timer" id="tm">0:00</div></div>
        <div class="card list">${list.map((x, n) => `<button data-go="${n}" class="${n === state.i ? 'on' : ''}">${n + 1}. ${esc(x.title)}</button>`).join('')}</div>
        <div class="card"><b>Objections</b>${script.objections.map((o) => `<details><summary>${esc(o.q)}</summary><p>${esc(o.a)}</p></details>`).join('')}</div></div></div>`;
    document.getElementById('pp').onclick = () => { state.i = Math.max(0, state.i - 1); chan?.postMessage({ type: 'go', i: state.i }); render(); };
    document.getElementById('pn').onclick = () => { state.i = Math.min(list.length - 1, state.i + 1); chan?.postMessage({ type: 'go', i: state.i }); render(); };
    document.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => { state.i = Number(b.dataset.go); chan?.postMessage({ type: 'go', i: state.i }); render(); }; });
  };
  setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); const el = document.getElementById('tm'); if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 1000);
  chan?.addEventListener('message', (e) => { const m = e.data || {}; if (m.type === 'slide') { Object.assign(state, { i: m.i, plan: m.plan, ticket: m.ticket, jobs: m.jobs }); render(); } });
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
