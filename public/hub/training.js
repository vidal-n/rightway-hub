// Training: scripts (read here or print the PDF), objection drills, playbooks for how we work in the Hub, the fulfillment guides,
// the owner setup checklist and links. Each person ticks off what they have done (users.training).
import { $, $$, esc, api, toast, icon } from './core.js';
import { staffShell } from './shell.js';
import { docHtml, objectionGroups, rich } from '/js/scriptprint.js';
import { onSwipe, slideIn } from './swipe.js';
import { jobLabel, can } from '/js/jobs.js';
import { PLAN_KEYS, PLAN_REF, INCLUDED_ALL, itemLine, refMoney } from '/js/planref.js';
import { WEB_TIERS, WEB_MIN, CARE_MONTHLY, OWN_AFTER_MONTHS, money as wmoney, webValue } from '/js/webprice.js';
import { DEFAULT_GUIDES, PROOF_LABEL } from '/js/guides.js';

const PDF = { cold: '/training/RightWay-Growth-Cold-Call-Script.pdf', analysis: '/training/RightWay-Growth-Competitor-Analysis-Script.pdf', plan: '/training/RightWay-Growth-Game-Plan-Script.pdf', clarity: '/training/RightWay-Growth-Google-Clarity-Audit-Script.pdf' };
const PDF_TEAM = { cold: '/training/RightWay-Growth-Cold-Call-Script-Team.pdf', analysis: '/training/RightWay-Growth-Competitor-Analysis-Script-Team.pdf', plan: '/training/RightWay-Growth-Game-Plan-Script-Team.pdf', clarity: '/training/RightWay-Growth-Google-Clarity-Audit-Script-Team.pdf' };
// Owners read the script as "I". Everyone else gets the "we" copy. Owners can flip to the team copy to see it.
let teamView = false;
const voiceFor = (user) => (user?.role === 'admin' && !teamView ? 'I' : 'we');
const blanks = (s) => rich(esc(s).replace(/\[\[(.+?)\]\]/g, '<span class="blank">$1</span>'));

// Playbooks: how we actually run the day in the Hub. Plain steps, kept short.
const PLAYBOOKS = [
  ['day', 'The calling day', 'How a rep runs a block of dials.', [
    'Open the Hub. Your status turns Available by itself. Set Break, Lunch, Training or Meeting from the pill at the top right when you step away, so your numbers are fair.',
    'Phone, Dialer. Pick the time zone tab that is in calling hours (8am to 8pm their time). The queue only shows leads you can call now.',
    'Call prep opens beside the queue and researches the next leads ahead. Read the scan line and the listing check before they pick up. No research yet: press Research now while it rings.',
    'Run the cold call script (Cold call tab in call prep). Say why you called in the first ten seconds. No asking for their time.',
    'After every call the disposition popup opens. Pick the result. The Hub sets the next call date for you. Number keys 1 to 9 pick the first nine.',
    'Booked: Book meeting, pick the time, paste a link if Google is not connected, then Text it or Email it. Then run Check listings so the audit has the real directories.',
    'End of block: check Agents for your dials, contacts, talk time and handle time. Call analytics shows which lists and grades are worth calling.',
  ]],
  ['audit', 'Running the Google clarity audit', 'The second call, on a screen share.', [
    '10 minutes before: open the lead and press Present. Press P for the presenter view (your notes, with the same script lines and their real numbers). Share only the slides window.',
    'On the Scan slide press Run the full scan. The Scan tool opens in its own tab with their business and keyword filled in.',
    'During discovery: switch to the Scan tool tab, add their other money searches, pick 9 x 9 or bigger, press Run scan, switch back. It scans while you ask.',
    'At the scan step: share the Scan tool tab, press Replay the scan, click through each keyword tab. Press Save to lead, then switch back to the slideshow: the Scan slide now shows the deep scan with a tab per keyword.',
    'Search together: new tab, google.com, search the keyword like a customer, then Maps. Back to the slideshow for You vs the leaders.',
    'Inconsistencies slide: their real listing check. Click a red row to open that directory and show the wrong phone or address.',
    'Your app slide: tap through the live sample client app (Home, Rankings, Reviews, Post a photo). Say it keeps getting new features.',
    'Your investment slide starts blank. Type the buildout and monthly you decided from discovery. They save when you go to the next slide.',
    'Start this week slide: Send the work order. They sign on their phone, pay by Stripe, and the Hub makes them a client with their first month of tasks.',
  ]],
  ['close', 'Closing and onboarding', 'From signed to started.', [
    'Signed and paid: the lead turns Won and a client is created with its first month of tasks, a Slack chat and a client app login invite.',
    'Book the onboarding call from the client page, Meetings tab. 30 to 45 minutes at a computer.',
    'On the call: get manager access to their Google profile and website (Access tab checklist), fill the intake form together, set target keywords and cities in Profile.',
    'Run their first scan from the Rankings tab. It becomes the baseline every report compares to.',
    'Onboarding tab: work the fix list and the citations list. Each fix logged checks off a task.',
  ]],
  ['month', 'The monthly fulfillment cycle', 'What every client gets, every month.', [
    'My work fills every client\'s month by itself. Each task has a guide, a timer and the proof it needs before it can close.',
    'Posts: from the Posts tab or Publish to Google. Reviews: answer every new one (Draft a reply helps). Citations and links: Citations tab.',
    'Pages: Content tab. Draft, send to the client to approve, publish to WordPress or mark live.',
    'Scans run on their schedule (Settings, automatic scans). The monthly report drafts itself when the scan finishes. Check it and press Send.',
    'Monthly meeting: Meetings tab. Agenda comes from the report. Mark held with notes.',
  ]],
  ['status', 'Statuses and how we track time', 'What the numbers on the Agents page mean.', [
    'Logged in time counts while the Hub is open and your status is not Offline. Closing the laptop stops the clock within about 3 minutes.',
    'On a call shows by itself while a browser call rings or talks. Owners can Listen, Whisper or Barge from Agents.',
    'Talk time is from when they answer to hang up. Handle time is from dialing to the moment you save the disposition, so it includes wrap up.',
    'A contact means a person picked up: voicemail and no answer never count, even when Twilio says answered.',
    'We say on every call that it may be recorded. The Hub never plays a recording announcement on our calls.',
  ]],
];

const SETUP = [
  ['dfs', 'Fund DataForSEO', 'app.dataforseo.com, Payments, Add funds. Start with $50 to $100. Research is about $0.04 a lead, a listing check about $0.03, a 13 x 13 scan about $0.70 per keyword.'],
  ['google', 'Check the Google connection', 'Google page, Setup tab, Check connection. Fix what it lists. If Google blocks you, add your email as a Test user on the OAuth consent screen in Google Cloud.'],
  ['resend', 'Add Resend for email', 'resend.com: add and verify rightwaygrowth.com, create a Sending access key. Cloudflare, Workers, rightway-hub, Settings, Build, Variables and secrets: RESEND_API_KEY and EMAIL_FROM. Then rebuild.'],
  ['anthropic', 'Add the Anthropic key', 'console.anthropic.com: add credits, create a key. Cloudflare: ANTHROPIC_API_KEY. Then rebuild. Turns on Ask Claude, AI captions, page drafts and review replies.'],
  ['stripe', 'Run Stripe setup', 'Settings, Stripe setup, tick Replace existing links, press Set up Stripe. The key needs Write on Products, Prices, Payment Links, Webhook Endpoints and Customer portal.'],
  ['site', 'Send the website files', 'Netlify, the site, Deploys, latest deploy, Download. Attach the zip in the chat so pricing comes off and every button points at the booking page.'],
];

const RESOURCES = [
  ['Google Business Profile guidelines', 'https://support.google.com/business/answer/3038177', 'What is and is not allowed on a profile.'],
  ['How Google ranks local results', 'https://support.google.com/business/answer/7091', 'Relevance, distance, prominence. Use it on calls.'],
  ['Booking page', '/book.html', 'Send it to anyone who wants to pick their own time.'],
  ['Blank work order', '/workorder.html', 'The printable agreement, SEO or website.'],
  ['Scan tool', '/scan.html', 'Run any business, up to 13 x 13 and 5 keywords.'],
  ['Twilio console', 'https://console.twilio.com', 'Balance, numbers, A2P status.'],
  ['DataForSEO', 'https://app.dataforseo.com', 'Balance and usage.'],
  ['Stripe dashboard', 'https://dashboard.stripe.com', 'Payments, payouts, customers.'],
];

let done = null;
async function loadDone() {
  if (done) return done;
  try { done = new Set((await api('/api/me/training')).done || []); } catch { done = new Set(); }
  return done;
}
async function toggleDone(key, on) {
  if (on) done.add(key); else done.delete(key);
  try { await api('/api/me/training', { method: 'PUT', body: { done: [...done] } }); } catch (e) { toast(e.message, true); }
}
const tabs = (active, user) => `<nav class="tabs">${[['', 'Overview'], ['tour', 'Hub tour'], ['scripts', 'Scripts'], ['warmup', 'Warm up'], ['drills', 'Objection drills'], ['playbooks', 'Playbooks'], ['guides', 'Fulfillment guides'], ...(can(user, 'close') ? [['pricing', 'Pricing']] : []), ...(user.role === 'admin' ? [['setup', 'Owner setup']] : []), ['resources', 'Resources']]
  .map(([k, n]) => `<a href="#/training${k ? `/${k}` : ''}" class="${active === k ? 'is-active' : ''}">${n}</a>`).join('')}</nav>`;
const head = (title, eyebrow = 'Training') => `<div class="page-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1></div></div>`;

export async function trainingPage(app, user, sub, arg) {
  const view = staffShell(app, user, 'training');
  await loadDone();
  if (sub === 'scripts') return scripts(view, user, arg || 'analysis');
  if (sub === 'warmup') return warmup(view, user);
  if (sub === 'drills') return drills(view, user, arg || 'cold');
  if (sub === 'playbooks') return playbooks(view, user);
  if (sub === 'guides') return guides(view, user);
  if (sub === 'setup') return setup(view, user);
  if (sub === 'resources') return resources(view, user);
  if (sub === 'pricing') return pricing(view, user);
  if (sub === 'tour') return tourRef(view, user);
  const n = (keys) => keys.filter((k) => done.has(k)).length;
  const pbKeys = PLAYBOOKS.map((p) => `pb:${p[0]}`);
  const card = (href, ic, t, p, foot) => `<a class="tr-card" href="${href}"><span class="tr-ico">${icon[ic] || ''}</span><h3>${esc(t)}</h3><p>${esc(p)}</p>${foot || ''}</a>`;
  view.innerHTML = `${head('Training and guides')}${tabs('', user)}
    <div class="tr-grid">
      ${card('#/training/tour', 'spark', 'Hub tour', 'A one minute walk through the menu and the top bar, fitted to your job.', `<span class="tr-done">${done.has('tour:hub') ? `${icon.check}Done` : 'Not taken yet'}</span>`)}
      ${card('#/training/scripts/cold', 'phone', 'Cold call script', 'Pattern interrupt, the free plan, book it on this call, discovery after.', `<span class="tr-done">${done.has('script:cold') ? `${icon.check}Read` : 'Not read yet'}</span>`)}
      ${card('#/training/scripts/analysis', 'msg', 'Competitor analysis script', 'Cold call that offers the free Competitor Analysis, what to say once they pick a time, discovery, and the rebuttals.', `<span class="tr-done">${done.has('script:analysis') ? `${icon.check}Read` : 'Not read yet'}</span>`)}
      ${card('#/training/scripts/plan', 'msg', 'Google Game Plan script (website audit)', 'Three short parts: the call, what to say if they ask, and what to say once they pick a time.', `<span class="tr-done">${done.has('script:plan') ? `${icon.check}Read` : 'Not read yet'}</span>`)}
      ${card('#/training/scripts/clarity', 'device', 'Google clarity audit script', 'The screen share pitch with every screen cue: slideshow, Scan tool tab and Google.', `<span class="tr-done">${done.has('script:clarity') ? `${icon.check}Read` : 'Not read yet'}</span>`)}
      ${card('#/training/warmup', 'phone', 'Warm up with the AI owner', 'Practice your opener and objections on a pretend owner by typing or speaking. It coaches you at the end.')}
      ${card('#/training/drills', 'msg', 'Objection drills', 'Flash cards for every objection, before price, after price and the closes.', `<span class="tr-done">${n(['drill:cold', 'drill:before', 'drill:after', 'drill:any'])} of 4 sets done</span>`)}
      ${card('#/training/playbooks', 'note', 'Playbooks', 'How we run the calling day, the audit, closing, onboarding and the monthly work.', `<span class="tr-done">${n(pbKeys)} of ${pbKeys.length} done</span>`)}
      ${card('#/training/guides', 'check', 'Fulfillment guides', 'Step by step for every task in My work, with the proof each one needs.')}
      ${user.role === 'admin' ? card('#/training/setup', 'key', 'Owner setup', 'The six things only an owner can do: wallets, keys, Stripe, Google, website.', `<span class="tr-done">${n(SETUP.map((x) => `setup:${x[0]}`))} of ${SETUP.length} done</span>`) : ''}
      ${can(user, 'close') ? card('#/training/pricing', 'chart', 'Pricing reference', 'Where to start a price: the plan guide, website pricing, bundles and the residual model. Closers and owners only.') : ''}
      ${card('#/training/resources', 'link', 'Resources', 'Google guidelines, booking page, work order, dashboards.')}
    </div>`;
}

function scripts(view, user, which) {
  const voice = voiceFor(user);
  which = ['cold', 'clarity', 'plan', 'analysis'].includes(which) ? which : 'analysis';
  const NAMES = { cold: 'Cold call script', analysis: 'Competitor analysis script', clarity: 'Google clarity audit script', plan: 'Google Game Plan script (website audit)' };
  view.innerHTML = `${head(NAMES[which], 'Scripts')}${tabs('scripts', user)}
    <div class="row" style="justify-content:space-between;margin-bottom:16px">
      <div class="seg"><a class="btn btn-sm ${which === 'analysis' ? 'btn-primary' : 'btn-ghost'}" href="#/training/scripts/analysis">Competitor analysis</a><a class="btn btn-sm ${which === 'cold' ? 'btn-primary' : 'btn-ghost'}" href="#/training/scripts/cold">Cold call</a><a class="btn btn-sm ${which === 'plan' ? 'btn-primary' : 'btn-ghost'}" href="#/training/scripts/plan">Game Plan</a><a class="btn btn-sm ${which === 'clarity' ? 'btn-primary' : 'btn-ghost'}" href="#/training/scripts/clarity">Clarity audit</a></div>
      <div class="row"><a class="btn btn-ghost btn-sm" href="${(voice === 'I' ? PDF : PDF_TEAM)[which]}" target="_blank" rel="noopener">${icon.down}Print PDF</a>
        ${user.role === 'admin' ? `<div class="seg"><button class="btn btn-sm ${voice === 'I' ? 'btn-primary' : 'btn-ghost'}" data-voice="I">Owner copy (I)</button><button class="btn btn-sm ${voice === 'we' ? 'btn-primary' : 'btn-ghost'}" data-voice="we">Team copy (we)</button></div>` : ''}
        <label class="row small" style="gap:8px"><input type="checkbox" id="pgmode"${pagedOn() ? ' checked' : ''}> Page by page (swipe)</label>
        <label class="row small" style="gap:8px"><input type="checkbox" id="rd"${done.has(`script:${which}`) ? ' checked' : ''}> I have read it</label></div></div>
    <p class="small muted" style="margin:0 0 16px">Say the plain lines. Italic underlined lines are for you, never out loud. Brackets are blanks that call prep fills in with the lead's real names and numbers. The live version is in call prep and the presenter notes.</p>
    <div class="card script-read doc"><div class="d-brand"><img class="on-light" src="/brand/rightway-logo-light.svg" alt="Rightway Growth" width="170" height="28"><img class="on-dark" src="/brand/rightway-logo-dark.svg" alt="" width="170" height="28"></div>${docHtml(which, { voice })}</div>`;
  $$('[data-voice]', view).forEach((b) => b.addEventListener('click', () => { teamView = b.dataset.voice === 'we'; scripts(view, user, which); }));
  $('#rd', view).addEventListener('change', (e) => toggleDone(`script:${which}`, e.target.checked));
  $('#pgmode', view).addEventListener('change', (e) => { try { localStorage.setItem('rw-script-pages', e.target.checked ? '1' : '0'); } catch { /* ignore */ } scripts(view, user, which); });
  if (pagedOn()) pagedReader($('.script-read.doc', view));
}

// Page by page reading: one step of the script at a time, with Back and Next and a swipe (left is next, right is back).
const pagedOn = () => { try { const v = localStorage.getItem('rw-script-pages'); return v === null ? matchMedia('(pointer: coarse)').matches : v === '1'; } catch { return false; } };
function pagedReader(doc) {
  if (!doc) return;
  const kids = [...doc.children];
  const first = kids.findIndex((k) => k.classList.contains('d-h'));
  if (first < 0) return;
  const pages = [];
  let cur = null;
  for (const k of kids.slice(first)) {
    if (k.classList.contains('d-h')) { cur = document.createElement('section'); cur.className = 'd-page'; doc.insertBefore(cur, k); pages.push(cur); }
    cur.appendChild(k);
  }
  const nav = document.createElement('div');
  nav.className = 'd-pager';
  nav.innerHTML = '<button type="button" class="btn btn-ghost btn-sm" data-pg="back">Back</button><span class="small muted" data-pos></span><button type="button" class="btn btn-primary btn-sm" data-pg="next">Next</button>';
  doc.appendChild(nav);
  let at = 0;
  const show = (to, dir) => {
    at = Math.max(0, Math.min(pages.length - 1, to));
    pages.forEach((p, i) => { p.hidden = i !== at; });
    $('[data-pos]', nav).textContent = `${at + 1} of ${pages.length}`;
    $('[data-pg="back"]', nav).disabled = at === 0;
    $('[data-pg="next"]', nav).disabled = at === pages.length - 1;
    if (dir) { slideIn(pages[at], dir); doc.scrollIntoView({ block: 'nearest' }); }
  };
  nav.addEventListener('click', (e) => { const b = e.target.closest('[data-pg]'); if (b) show(at + (b.dataset.pg === 'next' ? 1 : -1), b.dataset.pg); });
  onSwipe(doc, (dir) => show(at + (dir === 'next' ? 1 : -1), dir));
  show(0);
}

// The tour as a reference: every stop for this person's job, with Show me to jump straight to it.
async function tourRef(view, user) {
  const { tourSteps, startTour } = await import('./tour.js');
  const steps = tourSteps(user);
  view.innerHTML = `${head('Hub tour')}${tabs('tour', user)}
    <div class="row" style="justify-content:space-between;margin-bottom:16px"><p class="muted" style="margin:0">Where everything lives, for ${esc(user.role === 'admin' ? 'owners' : jobLabel(user).toLowerCase() + 's')}.</p>
      <button class="btn btn-primary" id="trtour">${icon.spark || ''}Start the tour</button></div>
    <div class="card"><ul class="list tour-list">${steps.filter((s) => s.nav || s.sel).map((s) => `<li class="item"><div><div class="item-title">${esc(s.title)}</div><div class="item-sub">${esc(s.body)}</div></div>
      <button class="btn btn-ghost btn-sm" data-at="${steps.indexOf(s)}">Show me</button></li>`).join('')}</ul></div>`;
  $('#trtour', view).addEventListener('click', () => startTour(user, { onEnd: () => { done.add('tour:hub'); } }));
  $$('[data-at]', view).forEach((b) => b.addEventListener('click', () => startTour(user, { at: Number(b.dataset.at) })));
}

async function warmup(view, user) {
  const { practiceView } = await import('./practice.js');
  view.innerHTML = `${head('Warm up')}${tabs('warmup', user)}
    <div class="card" style="max-width:720px;margin-bottom:16px"><h3 style="margin-top:0">Warm up dialer</h3>
      <p class="muted" style="margin:0 0 10px">The whole power dialer with seven pretend leads: Up next, script and research, the countdown, ringing, the call window, a pretend owner who picks up, rings out or goes to voicemail, texting, booking, your result buttons and a score at the end. Nothing is dialed, texted, booked or saved, and it costs nothing.</p>
      <button type="button" class="btn btn-primary" id="wustart">Start the warm up dialer</button></div>
    <p class="muted" style="max-width:640px">Or just talk to one pretend owner here. Say your opener, handle the objections, and ask for the booking with two times. When you end the call, the coach scores it. Nothing is dialed or saved.</p>
    <div class="card" style="max-width:720px"><div id="wuhost"></div></div>`;
  $('#wustart', view).addEventListener('click', () => { try { sessionStorage.setItem('rw-warmup', '1'); } catch { /* ignore */ } location.hash = '#/dialer'; });
  practiceView($('#wuhost', view), { persona: 'friendly', lead: { business: 'Test Plumbing Co', city: 'Miami' } });
}
function drills(view, user, set) {
  const groups = objectionGroups(undefined, voiceFor(user));
  const g = groups.find((x) => x[0] === set) || groups[0];
  let order = g[2].map((_, i) => i).sort(() => Math.random() - 0.5), n = 0, shown = false;
  view.innerHTML = `${head('Objection drills')}${tabs('drills', user)}
    <div class="row" style="justify-content:space-between;margin-bottom:16px"><div class="seg">${groups.map(([k, name, l]) => `<button type="button" data-set="${k}" class="${k === g[0] ? 'is-on' : ''}">${esc(name)} (${l.length})</button>`).join('')}</div>
      <span class="small muted">Say your answer out loud first. Space flips the card, arrow right for the next one.</span></div>
    <div class="drill"><div class="drill-card" id="dc"></div>
      <div class="row" style="justify-content:space-between;margin-top:14px"><span class="small muted" id="dn"></span>
        <div class="row"><button class="btn btn-ghost" id="flip">Show the answer</button><button class="btn btn-primary" id="nx">Next</button></div></div></div>`;
  const draw = () => {
    const o = g[2][order[n]];
    if (!o) { $('#dc', view).innerHTML = '<div class="q">No cards in this set.</div>'; return; }
    $('#dc', view).innerHTML = `<div class="small" style="color:#7F978C">They say</div><div class="q">"${esc(o.q)}"</div>${shown ? `<div class="a">${blanks(o.a)}</div>` : ''}`;
    $('#dn', view).textContent = `Card ${n + 1} of ${order.length}`;
    $('#flip', view).textContent = shown ? 'Hide the answer' : 'Show the answer';
  };
  const next = () => { if (n === order.length - 1) { toggleDone(`drill:${g[0]}`, true); toast('Set done. Shuffled for another round.'); order = order.sort(() => Math.random() - 0.5); n = 0; } else n += 1; shown = false; draw(); };
  $('#flip', view).addEventListener('click', () => { shown = !shown; draw(); });
  $('#nx', view).addEventListener('click', next);
  $$('[data-set]', view).forEach((b) => b.addEventListener('click', () => { location.hash = `#/training/drills/${b.dataset.set}`; }));
  const key = (e) => {
    if (!document.body.contains(view)) { document.removeEventListener('keydown', key); return; }
    if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
    if (e.key === ' ') { e.preventDefault(); shown = !shown; draw(); }
    if (e.key === 'ArrowRight') next();
  };
  document.addEventListener('keydown', key);
  draw();
}

function playbooks(view, user) {
  view.innerHTML = `${head('Playbooks')}${tabs('playbooks', user)}
    <div class="ana-grid">${PLAYBOOKS.map(([k, t, sub, steps]) => `<div class="card"><div class="card-head"><div><h3>${esc(t)}</h3><p class="small muted" style="margin:2px 0 0">${esc(sub)}</p></div>
      <label class="row small" style="gap:6px"><input type="checkbox" data-pb="${k}"${done.has(`pb:${k}`) ? ' checked' : ''}> Done</label></div>
      <ol class="cv-notes" style="font-size:14.5px;gap:8px">${steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>`).join('')}</div>`;
  $$('[data-pb]', view).forEach((c) => c.addEventListener('change', () => toggleDone(`pb:${c.dataset.pb}`, c.checked)));
}

function guides(view, user) {
  const list = Object.entries(DEFAULT_GUIDES);
  view.innerHTML = `${head('Fulfillment guides')}${tabs('guides', user)}
    <div class="row" style="justify-content:space-between;margin-bottom:14px"><p class="small muted" style="margin:0">Every task in My work opens with its guide as a checklist. These are the defaults; owners edit the live ones in My work, Guides.</p>
      <a class="btn btn-ghost btn-sm" href="#/work/guides">${icon.edit || ''}Edit the live guides</a></div>
    <div class="ana-grid">${list.map(([k, gd]) => `<details class="card"><summary style="cursor:pointer;list-style:none"><div class="card-head" style="margin:0"><h3>${esc(gd.title)}</h3><span class="badge gray">${gd.minutes} min · ${esc(PROOF_LABEL[gd.proof] || '')}</span></div></summary>
      ${gd.need?.length ? `<p class="small" style="margin:12px 0 4px"><b>You need:</b> ${esc(gd.need.join(', '))}</p>` : ''}
      <ol class="cv-notes" style="font-size:14px;gap:6px">${(gd.steps || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ol></details>`).join('')}</div>`;
}

function setup(view, user) {
  view.innerHTML = `${head('Owner setup')}${tabs('setup', user)}
    <div class="card" style="max-width:860px">${SETUP.map(([k, t, how], i) => `<div class="row" style="align-items:flex-start;gap:14px;padding:14px 0;border-bottom:1px solid var(--line);flex-wrap:nowrap">
      <input type="checkbox" data-su="${k}"${done.has(`setup:${k}`) ? ' checked' : ''} style="margin-top:3px"><div><b>${i + 1}. ${esc(t)}</b><p class="small" style="margin:4px 0 0">${esc(how)}</p></div></div>`).join('')}
      <p class="small muted" style="margin:14px 0 0">Wallet balances show on the Dashboard and in Settings. A yellow wallet button appears in the top bar when one runs low.</p></div>`;
  $$('[data-su]', view).forEach((c) => c.addEventListener('change', () => toggleDone(`setup:${c.dataset.su}`, c.checked)));
}

// Closers and owners only (the file is also locked on the server). Same numbers as the spreadsheet and the plan guide in the presenter view.
function pricing(view, user) {
  if (!can(user, 'close')) { view.innerHTML = `${head('Pricing')}<div class="card"><p>Pricing is for closers and owners.</p></div>`; return; }
  const v = webValue(WEB_TIERS[2].build);
  view.innerHTML = `${head('Pricing reference')}${tabs('pricing', user)}
    <div class="card" style="max-width:980px">
      <p style="margin:0 0 6px"><b>Internal. Never show this to a client.</b> It tells you where to start a price so we do not over or undercharge. The price a client pays is always the custom number you type.</p>
      <p class="small muted" style="margin:0 0 12px">Local SEO first. Starter is the entry (loss leader), every plan above it is the upsell after results. Websites are sold after results, and the monthly care is the residual.</p>
      <a class="btn btn-primary btn-sm" href="/training/pricing/Rightway-Pricing-Reference.xlsx" download>${icon.down} Download the spreadsheet</a>
      <span class="small muted" style="margin-left:8px">Plans, websites, bundles and a residual projection with formulas.</span>
    </div>
    <div class="card" style="max-width:980px;margin-top:14px"><h3 style="margin-top:0">Plan guide</h3>
      <div class="table-wrap"><table class="table"><thead><tr><th>Plan</th><th>Monthly to start</th><th>What it covers</th></tr></thead><tbody>
      ${PLAN_KEYS.map((k) => { const p = PLAN_REF[k]; return `<tr><td><b>${esc(p.name)}</b>${k === 'starter' ? '<br><span class="small muted">entry, loss leader</span>' : ''}</td><td>${esc(refMoney(p.monthly))}</td><td class="small">${esc(p.items.map(itemLine).join('; '))}</td></tr>`; }).join('')}
      </tbody></table></div>
      <p class="small muted" style="margin:10px 0 0">On every plan: ${esc(INCLUDED_ALL.map((x) => x.name.toLowerCase()).join(', '))}.</p>
    </div>
    <div class="card" style="max-width:980px;margin-top:14px"><h3 style="margin-top:0">Website pricing</h3>
      <div class="table-wrap"><table class="table"><thead><tr><th>Size</th><th>Build fee</th><th>Care a month</th><th>Year one</th><th></th></tr></thead><tbody>
      ${WEB_TIERS.map((t) => `<tr><td><b>${esc(t.label)}</b></td><td>${esc(wmoney(t.build))}</td><td>${esc(wmoney(t.care))}</td><td>${esc(wmoney(webValue(t.build, t.care).yearOne))}</td><td class="small muted">${t.given.build && t.given.care ? "V's numbers" : t.given.build ? "Build is V's, care suggested" : 'Suggested, confirm'}</td></tr>`).join('')}
      </tbody></table></div>
      <ul class="small" style="margin:10px 0 0;padding-left:18px">
        <li>The market floor is ${esc(wmoney(WEB_MIN))}. Never go under it. More than 15 pages or custom features: type your own price above the 11 to 15 page price.</li>
        <li>${esc(wmoney(CARE_MONTHLY))} a month covers hosting and care. A 7 to 10 page site is ${esc(wmoney(v.yearOne))} in year one and ${esc(wmoney(CARE_MONTHLY * 12))} a year after that.</li>
        <li>After ${OWN_AFTER_MONTHS} months of care they own the site. They still pay for hosting wherever it lives. If they want us to keep managing it, it stays ${esc(wmoney(CARE_MONTHLY))} a month.</li>
        <li>Bundle the website care with the SEO monthly. Yelp and social posts go on only when you check them off in the client's scope of work.</li>
      </ul>
    </div>`;
}

function resources(view, user) {
  view.innerHTML = `${head('Resources')}${tabs('resources', user)}
    <div class="tr-grid">${RESOURCES.map(([t, href, p]) => `<a class="tr-card" href="${esc(href)}"${href.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}><span class="tr-ico">${(icon.chain || icon.share)}</span><h3>${esc(t)}</h3><p>${esc(p)}</p></a>`).join('')}
      <a class="tr-card" href="${(voiceFor(user) === 'I' ? PDF : PDF_TEAM).cold}" target="_blank" rel="noopener"><span class="tr-ico">${icon.down}</span><h3>Cold call script PDF</h3><p>Large print, for the desk.</p></a>
      <a class="tr-card" href="${(voiceFor(user) === 'I' ? PDF : PDF_TEAM).clarity}" target="_blank" rel="noopener"><span class="tr-ico">${icon.down}</span><h3>Clarity audit script PDF</h3><p>Large print, with every screen cue.</p></a>
      <a class="tr-card" href="${(voiceFor(user) === 'I' ? PDF : PDF_TEAM).analysis}" target="_blank" rel="noopener"><span class="tr-ico">${icon.down}</span><h3>Competitor analysis script PDF</h3><p>The cold call and rebuttals, for the desk.</p></a></div>`;
}
