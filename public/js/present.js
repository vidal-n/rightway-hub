// Presentation mode: a tailored deck for one lead, built from the research, with a presenter view in a second window.
// Open /present.html#<leadId>. Presenter view: /present.html?presenter=1#<leadId>. Keys: arrows or space, F fullscreen, P presenter view.
import { findProblems, recommendPlan, industryInfo, rankText, buildScript, roi } from './leadintel.js';
import { ninetyDayPlan, reviewTarget } from './fulfill.js';
import { INCLUDES, STANDARD_TERMS, PLAN_INFO } from './plancopy.js';
import { qrSvg } from './qr.js';

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

const state = { i: 0, plan: 'growth', ticket: 500, jobs: 4 };
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
  const P = PLAN_INFO[plan];
  const script = buildScript(lead, intel, { rep: D.rep, plan, ticket: state.ticket }, D.custom);
  const v = script.vars;
  const first = (lead.contact_name || '').split(' ')[0];
  const r = roi({ ticket: state.ticket, jobs: state.jobs, plan });
  const rt = reviewTarget(intel);
  const nd = ninetyDayPlan(plan, intel, lead);
  const out = [];
  const add = (key, title, html, notes, dark = false) => out.push({ key, title, html, notes, dark });

  add('cover', 'Cover', `
    <img class="cover-mark" src="/brand/rightway-mark-light.svg" alt="">
    <div class="anim"><p class="kicker">Local growth plan</p><h1>${esc(lead.business)}:<br>more calls from Google${city ? ` in ${esc(city)}` : ''}</h1>
    <p class="lead">Prepared for ${esc(lead.contact_name || 'you')} by Rightway Growth</p></div>
    <div class="cover-meta"><div><b>${esc(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}</b>Date</div><div><b>${esc(kw)}</b>Main search</div>${D.rep ? `<div><b>${esc(D.rep)}</b>Your strategist</div>` : ''}</div>`,
  `Thanks for making the time${first ? `, ${first}` : ''}. Quick agenda: I'll show you where you show up on Google right now, who's beating you and why, and exactly what we'd fix. Then you tell me if it makes sense. Sound good?\n\nConfirm before you start: Is getting more calls from Google a priority this quarter? Who else should be part of the decision?`, true);

  add('agenda', 'Agenda', `<div class="anim"><p class="kicker">Today</p><h2>What we'll cover in 20 minutes</h2>
    <ol class="agenda"><li>How customers find ${esc(info.label.toLowerCase())} businesses in ${esc(city || 'your area')}</li><li>Where you show up today, street by street</li><li>You vs the businesses getting the calls</li><li>What's holding you back</li><li>The plan, the timeline, and the investment</li></ol></div>`,
  'Set the frame: by the end you will know exactly where you stand, even if we never work together.\n\nAsk: Where do most of your new customers come from today? How many calls a week come from Google?');

  add('pack', 'How customers find you', `<p class="kicker">How customers find you</p><h2>When someone searches "${esc(kw)}" near ${esc(city || 'you')}, Google shows 3 businesses first</h2>
    <div class="cols c2" style="align-items:start"><div class="pack anim"><div class="q">🔍 ${esc(kw)}</div>
      ${comps.map((c, i) => `<div class="row"><span class="pin">${String.fromCharCode(65 + i)}</span><div><b>${esc(c.title)}</b><br><span style="font-size:18px;color:#61716B">${c.rating ? stars(c.rating) : ''} (${c.reviews ?? 0})</span></div></div>`).join('') || '<div class="row">Run research to show the live map pack.</div>'}
      ${intel ? `<div class="row you"><span class="pin">${intel.rank && intel.rank <= 20 ? intel.rank : '?'}</span><div><b>${esc(lead.business)}</b><br><span style="font-size:18px;color:#61716B">You: ${esc(rankText(intel.rank))}${L.reviews != null ? ` · ${L.reviews} reviews` : ''}</span></div></div>` : ''}</div>
      <div class="anim"><div class="box"><h3>Why the top 3 matters</h3><p>Most people call one of the first three businesses they see on the map. Those spots are earned with a complete Google profile, reviews, a website Google trusts, and steady activity. Every one of those is something we can work on.</p></div></div></div>`,
  `This is the map pack, pulled live for "${kw}" from their address.\n${comps[0] ? `${comps[0].title} is getting the first look with ${comps[0].reviews ?? 'many'} reviews.` : ''}\nYou come up ${intel ? rankText(intel.rank) : '(run research)'}.\n\nAsk: When you search for your own service, where do you see yourself?`);

  if (intel?.grid) {
    const g = intel.grid;
    const band = (c) => (c.error ? 'err' : c.rank == null ? 'none' : c.rank <= 3 ? 'top3' : c.rank <= 10 ? 'top10' : 'top20');
    const mid = Math.floor(g.cells.length / 2);
    add('grid', 'Where you show up', `<p class="kicker">Where you show up today</p><h2>${g.top3 ? `Top 3 in ${g.top3} of ${g.points} spots` : `Not in the top 3 anywhere we checked`}</h2>
      <div class="cols" style="grid-template-columns:auto 1fr;align-items:center;gap:72px">
        <div><div class="biggrid" style="grid-template-columns:repeat(${g.size},1fr)">${g.cells.map((c, i) => `<span class="${band(c)}${i === mid ? ' center' : ''}">${c.error ? '!' : c.rank ?? '20+'}</span>`).join('')}</div>
          <div class="legend"><span><i style="background:#23B07E"></i>Top 3</span><span><i style="background:#E8A33D"></i>4 to 10</span><span><i style="background:#E07B39"></i>11 to 20</span><span><i style="background:#D64545"></i>Not found</span></div></div>
        <div class="anim" style="display:grid;gap:22px">
          <div class="box"><div class="num">${esc(rankText(intel.rank).replace('not in the top 20', '20+'))}</div><div class="label">at your own address for "${esc(kw)}"</div></div>
          <div class="box"><div class="num">${g.top3}<small> of ${g.points}</small></div><div class="label">spots where you are in the top 3, within ${g.radiusMiles} miles</div></div>
          <div class="box"><div class="num">${g.avg ?? '20+'}</div><div class="label">average rank across the area</div></div></div></div>`,
    `Each square is a real Google search from that spot, ${g.radiusMiles} miles apart. The center one with the outline is your address.\nGreen means you're in the top 3. Red means people searching there don't see you at all.\n\nSay: Every red and orange square is a customer calling someone else.`);
  }

  if (comps.length) {
    const rows = [{ title: lead.business, rating: L.rating, reviews: L.reviews, category: L.category, site: L.url || lead.website, you: true }, ...comps.map((c) => ({ title: c.title, rating: c.rating, reviews: c.reviews, category: c.category, site: c.domain }))];
    const maxRev = Math.max(...rows.map((x) => x.reviews || 0));
    add('vs', 'You vs the top 3', `<p class="kicker">You vs the top 3</p><h2>${comps[0].reviews > (L.reviews || 0) ? `${esc(comps[0].title)} has ${comps[0].reviews - (L.reviews || 0)} more reviews` : 'How you stack up'}</h2>
      <table class="vs anim"><thead><tr><th>Business</th><th>Reviews</th><th>Rating</th><th>Google category</th><th>Website</th></tr></thead><tbody>
      ${rows.map((x) => `<tr class="${x.you ? 'you' : ''}"><td>${x.you ? '★ ' : ''}${esc(x.title)}</td><td class="${x.reviews === maxRev ? 'good' : x.you ? 'badv' : ''}">${x.reviews ?? '-'}</td><td>${x.rating ? stars(x.rating) : '-'}</td><td>${esc(x.category || '-')}</td><td>${x.site ? '✓' : '<span class="badv">None</span>'}</td></tr>`).join('')}
      </tbody></table>`,
    `These are the businesses winning the most top 3 spots around you.\n${comps.map((c) => `${c.title}: ${c.reviews ?? '?'} reviews, ${c.rating ?? '?'} stars`).join('\n')}\nYou: ${L.reviews ?? '?'} reviews, ${L.rating ?? '?'} stars.\n\nAsk: Do you know these guys? Are they doing better work than you?`);
  }

  add('problems', 'What is holding you back', `<p class="kicker">What we found</p><h2>${probs.length ? `${probs.length} things holding ${esc(lead.business)} back` : 'Your foundation is solid'}</h2>
    ${probs.length ? `<div class="probs anim">${probs.slice(0, 6).map((p) => `<div class="prob ${p.severity}"><b>${esc(p.title)}</b><span>${esc(p.detail)}</span></div>`).join('')}</div>` : '<p class="lead">No major gaps. The plan focuses on protecting your spot and growing into more searches and areas.</p>'}`,
  probs.length ? `Walk through each one. Keep it simple: what it is, why it costs them calls.\n\n${probs.slice(0, 6).map((p) => `• ${p.talk}`).join('\n')}\n\nAsk: Which of these surprises you most?` : 'Pitch growth: more keywords, more areas, staying ahead of competitors.');

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

  add('worth', 'What it is worth', `<p class="kicker">What it's worth</p><h2>What a few more jobs a month means for you</h2>
    <div class="calc"><div class="anim"><label>Average job value<input id="in-ticket" type="number" min="0" step="50" value="${state.ticket}"></label>
      <label>Extra jobs a month from Google<input id="in-jobs" type="number" min="0" step="1" value="${state.jobs}"></label></div>
      <div class="out"><div class="num" id="out-month">${money(r.monthly)}</div><div class="label">extra revenue a month</div>
        <div class="num" style="font-size:64px;margin-top:26px" id="out-year">${money(r.yearly)}</div><div class="label">a year</div>
        <div class="label" style="margin-top:26px;font-size:22px;color:#fff" id="out-mult">${r.multiple >= 1 ? `${r.multiple.toFixed(1)}x the ${P.name} plan` : `Pays for itself at ${r.breakeven} jobs a month`}</div></div></div>
    <p class="note">Your numbers, not a promise. Fill these in together.</p>`,
  `Ask, then type their answers in:\n• What's a typical job worth to you? (starting guess ${money(info.ticket)} for ${info.label.toLowerCase()})\n• If you got a few more calls a week, how many would you close?\n\nSay: At ${money(state.ticket)} a job, ${r.breakeven} extra job${r.breakeven === 1 ? '' : 's'} a month covers the whole plan.`);

  add('plan', 'The plan', `<p class="kicker">The plan</p><div class="planhead"><h2 style="margin:0">${esc(P.name)}</h2><span class="pill">Recommended for ${esc(lead.business)}</span></div>
    <ul class="includes anim">${INCLUDES[plan].map((x) => `<li>${esc(x)}</li>`).join('')}<li>Tracking ${P.keywords} keywords</li><li>Your own Rightway app: rankings, every task we do, review requests</li></ul>`,
  `${script.steps.find((s) => s.id === 'pitch')?.lines[0] || ''}\n\nWhy this plan: ${recommendPlan(lead, intel).why.join('; ')}.`);

  add('days', 'First 90 days', `<p class="kicker">First 90 days</p><h2>What happens after you say yes</h2>
    <div class="months anim">${nd.months.map((m) => `<div class="month"><h3>${esc(m.title)}</h3><ul>${m.items.slice(0, 5).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}</div>
    ${nd.fixes.length ? `<p class="note" style="margin-top:22px">Your fixes first: ${esc(nd.fixes.slice(0, 4).map((f) => `${f.title} (week ${f.week})`).join(' · '))}</p>` : ''}`,
  'Make it concrete. Kickoff within 48 hours of signing. Month 1 is the foundation, month 2 we build, month 3 it compounds.\n\nSet expectations: profile and reviews show in 30 to 60 days, pages and links build over 3 to 6 months.');

  if (intel?.found) {
    add('reviews', 'Reviews', `<p class="kicker">Reviews</p><h2>${rt.leader && rt.gap ? `${rt.gap} reviews to pass ${esc(rt.leader)}` : 'Keep the reviews coming'}</h2>
      <div class="cols c3 anim"><div class="box"><div class="num">${rt.mine}</div><div class="label">your Google reviews today</div></div>
        <div class="box"><div class="num">${rt.leaderReviews ?? '-'}</div><div class="label">${esc(rt.leader || 'the leader')}</div></div>
        <div class="box"><div class="num">${rt.perMonth}<small>/mo</small></div><div class="label">new reviews a month to get there in 6 months</div></div></div>
      <p class="lead" style="margin-top:30px">Your team texts a review link from the Rightway app in 5 seconds, and a QR code at the counter catches the rest. Every request is tracked.</p>`,
    `${rt.text}\nThe app makes asking easy: type a name and number, tap send. Real reviews from real customers, straight to Google.`);
  }

  add('app', 'Your app', `<p class="kicker">You see everything</p><h2>Your own Rightway app</h2>
    <div class="cols" style="grid-template-columns:auto 1fr;gap:80px;align-items:center">
      <div class="phone"><div class="scr"><div class="tile"><b>${intel?.grid ? `${intel.grid.top3}/${intel.grid.points}` : '3/9'}</b>top 3 spots this month</div><div class="tile"><b>${L.reviews ?? 0}</b>Google reviews</div><div class="tile"><b>12</b>tasks done this month</div><div class="tile"><b>Send</b>a review request</div><div class="tile"><b>Post</b>a job photo</div></div></div>
      <ul class="feat anim"><li><b>Rankings map every month</b><span>See exactly where you show up, compared to your starting point.</span></li>
        <li><b>Every task we do, logged</b><span>Posts, pages, citations, fixes. Nothing hidden.</span></li>
        <li><b>Review requests from your phone</b><span>Text or email a link in seconds, plus a counter QR code.</span></li>
        <li><b>Snap a photo, we post it</b><span>We write the post for Google, Facebook, and Instagram.</span></li>
        <li><b>A monthly results meeting</b><span>We go over the numbers and the next month's plan.</span></li></ul></div>`,
  'This is the part most agencies skip: you see every piece of work and every ranking change. No black box.\n\nAsk: How do you know today whether your marketing is working?');

  add('price', 'Investment', `<p class="kicker">Investment</p><h2>Pick the plan that fits</h2>
    <div class="plans anim">${Object.entries(PLAN_INFO).map(([k, x]) => `<div class="plan${k === plan ? ' rec' : ''}" data-plan="${k}">${k === plan ? '<span class="tag">Recommended</span>' : ''}<div class="nm">${esc(x.name)}</div>
      <div class="pr">${money(x.price)}<small>/mo</small></div><div class="su">${money(x.setup)} one time setup</div><ul>${INCLUDES[k].slice(0, 4).map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}</div>
    <div class="terms"><span>6 months, then month to month</span><span>Cancel with 30 days notice after that</span><span>You own your profile and content</span><span>No ranking guarantees, every task guaranteed</span></div>`,
  `${script.steps.find((s) => s.id === 'close')?.lines[0] || ''}\n\nThen stop talking. Let them answer.\n\nIf price comes up: ${script.objections[0]?.a || ''}`);

  add('next', 'Next steps', `<div class="cols c2" style="align-items:center;gap:64px"><div class="anim"><p class="kicker">Next steps</p><h2 style="color:#fff">Start this week</h2>
      <div class="steps"><div class="step"><i>1</i>Sign the agreement on your phone</div><div class="step"><i>2</i>Secure payment through Stripe</div><div class="step"><i>3</i>Kickoff call within 48 hours</div><div class="step"><i>4</i>Baseline map saved, work starts</div></div>
      <div style="margin-top:34px;display:flex;gap:14px"><button class="btn" id="send-wo">Send the ${esc(P.name)} agreement</button></div></div>
    <div class="signbox" id="signbox"><div style="font:600 22px var(--display)">Scan to review and sign</div><div style="width:300px;height:300px;display:grid;place-items:center;color:#9AA8A2;text-align:center">Press "Send the agreement" to make their link</div></div></div>`,
  `Close: "${v.plan} is the right fit. I can send the agreement now, you sign on your phone, and we start this week."\nPress the button, have them scan the code or text them the link.\n\nIf they hesitate: "What would you need to see to feel good about starting?"`, true);

  return out;
}

function stageScale() {
  const st = document.querySelector('.stage');
  if (!st) return;
  const s = Math.min(window.innerWidth / 1640, window.innerHeight / 940);
  st.style.transform = `scale(${s})`;
}

let list = [];
function renderDeck() {
  list = slides();
  state.i = Math.min(state.i, list.length - 1);
  root.innerHTML = `<div class="progress" id="prog"></div><div class="viewport"><div class="stage">${list.map((s, n) => `<section class="slide${s.dark ? ' dark' : ''}" data-n="${n}">${s.html}${foot(n + 1, list.length, s.dark)}</section>`).join('')}</div></div>
    <div class="bar" id="bar"><button id="prev" aria-label="Previous">←</button><span class="cnt" id="cnt"></span><button id="next" aria-label="Next">→</button>
      <select id="planSel" aria-label="Plan">${Object.entries(PLAN_INFO).map(([k, x]) => `<option value="${k}"${k === state.plan ? ' selected' : ''}>${x.name}</option>`).join('')}</select>
      <button id="pv">Presenter view</button><button id="fs">Full screen</button></div>`;
  stageScale();
  wireDeck();
  go(state.i, false);
}

function go(n, broadcast = true) {
  state.i = Math.max(0, Math.min(list.length - 1, n));
  document.querySelectorAll('.slide').forEach((el) => { const k = Number(el.dataset.n); el.classList.toggle('on', k === state.i); el.classList.toggle('past', k < state.i); });
  const c = document.getElementById('cnt'); if (c) c.textContent = `${state.i + 1} / ${list.length}`;
  const p = document.getElementById('prog'); if (p) p.style.width = `${((state.i + 1) / list.length) * 100}%`;
  if (broadcast) chan?.postMessage({ type: 'slide', i: state.i, plan: state.plan, ticket: state.ticket, jobs: state.jobs });
}

function updateCalc() {
  const r = roi({ ticket: state.ticket, jobs: state.jobs, plan: state.plan });
  const set = (sel, t) => { const el = document.getElementById(sel); if (el) el.textContent = t; };
  set('out-month', money(r.monthly)); set('out-year', money(r.yearly));
  set('out-mult', r.multiple >= 1 ? `${r.multiple.toFixed(1)}x the ${PLAN_INFO[state.plan].name} plan` : `Pays for itself at ${r.breakeven} jobs a month`);
}

async function sendWorkOrder(btn) {
  btn.disabled = true; btn.textContent = 'Creating...';
  try {
    const r = await api(`/api/leads/${encodeURIComponent(id)}/work-order`, { method: 'POST', body: { plan: state.plan } });
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
  document.getElementById('planSel').onchange = (e) => { state.plan = e.target.value; renderDeck(); chan?.postMessage({ type: 'slide', i: state.i, plan: state.plan, ticket: state.ticket, jobs: state.jobs }); };
  const t = document.getElementById('in-ticket'), j = document.getElementById('in-jobs');
  if (t) t.oninput = () => { state.ticket = Number(t.value) || 0; updateCalc(); };
  if (j) j.oninput = () => { state.jobs = Number(j.value) || 0; updateCalc(); };
  document.querySelectorAll('.plan[data-plan]').forEach((el) => { el.style.cursor = 'pointer'; el.onclick = () => { state.plan = el.dataset.plan; renderDeck(); }; });
  const wo = document.getElementById('send-wo'); if (wo) wo.onclick = () => sendWorkOrder(wo);
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
  chan?.addEventListener('message', (e) => {
    const m = e.data || {};
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
    const script = buildScript(D.lead, D.intel, { rep: D.rep, plan: state.plan, ticket: state.ticket }, D.custom);
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
    D = { lead: d.lead, intel: d.intel, rep: (me.user?.name || '').split(' ')[0] || '', custom: { script: s.script || {}, objections: s.objections || null } };
    const info = industryInfo(D.lead.industry, D.intel?.listing?.category || D.lead.category);
    state.plan = D.lead.plan || recommendPlan(D.lead, D.intel).plan;
    state.ticket = info.ticket;
    document.title = `${D.lead.business}: growth plan`;
    if (presenter) startPresenter(); else startDeck();
  } catch (e) {
    root.innerHTML = e.status === 401 || e.status === 403 ? '<div class="err"><div>Log in to the Hub first.<br><a href="/">Open Rightway Hub</a></div></div>' : `<div class="err">${esc(e.message)}</div>`;
  }
}
boot();
