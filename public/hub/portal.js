// The client app: home, reviews, post a photo, results. Built phone-first and installable.
import { $, esc, api, fmt, icon, animateNumbers, PLAN_NAMES } from './core.js';
import { feedHtml, renderReviews, renderPosts, renderRankings } from './shared.js';
import { clientStart } from './onboarding.js';

const TABS = [['home', 'Home', icon.home], ['messages', 'Messages', icon.msg], ['reviews', 'Reviews', icon.star], ['post', 'Post', icon.camera], ['results', 'Results', icon.chart]];

function shell(app, client, user, active, title, sub) {
  app.innerHTML = `
    <div class="portal">
      <header class="p-top"><div class="p-top-in">
        <div class="row"><img src="/brand/rightway-logo-dark.svg" alt="Rightway Growth" width="150" height="24">${user.viewAs ? '' : '<button class="btn btn-ghost btn-sm" id="logout" style="color:#E7F1EC;border-color:rgba(255,255,255,.2)">Log out</button>'}</div>
        <h1>${esc(title)}</h1><p>${esc(sub)}</p>
      </div></header>
      <main class="p-main" id="pview"></main>
      <nav class="tabbar" aria-label="Main">${TABS.map(([k, n, ic]) => `<a href="#/${k === 'home' ? '' : k}" class="${active === k ? 'is-active' : ''}">${ic}<span>${n}</span>${k === 'messages' ? '<b class="nbadge" data-badge="messages" hidden></b>' : ''}</a>`).join('')}</nav>
    </div>`;
  clientBadges();
  $('#logout')?.addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.hash = '#/login'; location.reload(); });
  return $('#pview');
}

// The Messages dot in the client app, and the app icon number.
let badgeTimer = null;
async function clientBadges() {
  try {
    const b = await api('/api/client-badges');
    document.querySelectorAll('[data-badge="messages"]').forEach((el) => { el.hidden = !b.messages; el.textContent = b.messages > 99 ? '99+' : String(b.messages); });
    if ('setAppBadge' in navigator) { if (b.messages) navigator.setAppBadge(b.messages); else navigator.clearAppBadge(); }
  } catch { /* ignore */ }
  if (!badgeTimer) badgeTimer = setInterval(() => { if (!document.hidden) clientBadges(); }, 45e3);
}

export async function portal(app, user, tab, state) {
  let data;
  try { data = await api(`/api/clients/${user.client_id}`); } catch (e) { app.innerHTML = `<div class="auth"><div class="auth-card"><p class="err-text">${esc(e.message)}</p></div></div>`; return; }
  const c = data.client;
  const first = String(user.name || '').split(/\s+/)[0];
  if (tab === 'messages') {
    const v = shell(app, c, user, 'messages', 'Messages', 'Talk to your Rightway team. Send questions, photos and files.');
    return import('./chat.js').then((m) => m.chatView(v, c.id, { staff: false })).then(() => clientBadges());
  }
  if (tab === 'reviews') {
    const v = shell(app, c, user, 'reviews', 'Get more reviews', 'Text a customer in seconds, or show them your QR code.');
    return renderReviews(v, c.id, { clientName: c.name });
  }
  if (tab === 'post') {
    const v = shell(app, c, user, 'post', 'Post a photo', 'Snap a job, send it, and we handle the captions and posting.');
    return renderPosts(v, c.id, { staff: false, ai: state.ai });
  }
  if (tab === 'start') {
    const v = shell(app, c, user, 'home', 'Get started', 'A few details so we can get to work.');
    return clientStart(v, c);
  }
  if (tab === 'content') {
    const v = shell(app, c, user, 'home', 'Pages for your website', 'Check new pages before they go live.');
    return import('./content.js').then((m) => m.clientContent(v, c, state.sub));
  }
  if (tab === 'calls') {
    const v = shell(app, c, user, 'home', 'Your calls', 'Calls from your Google profile and website.');
    return import('./calltrack.js').then((m) => m.clientCalls(v, c));
  }
  if (tab === 'results') {
    const v = shell(app, c, user, 'results', 'Your results', 'Where you show up on Google across your area.');
    return renderRankings(v, c.id, { staff: false });
  }
  const o = data.overview;
  const pct = o.tasks.total ? Math.round((100 * o.tasks.done) / o.tasks.total) : 0;
  const v = shell(app, c, user, 'home', `${first ? `Hi ${first}` : 'Welcome'}`, c.name);
  v.innerHTML = `
    <div class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr));margin:0">
      <div class="stat hero"><div class="stat-num" data-count="${o.lastScan?.top10Pct ?? 0}" data-suffix="%">0</div><div class="stat-label">${o.lastScan ? `of your area sees you on Google's first page (top 10) for "${esc(o.lastScan.keyword)}"` : 'first page coverage (first scan coming)'}</div></div>
      <div class="stat"><div class="stat-num" data-count="${o.tasks.done}">0</div><div class="stat-label">things we did for you this month</div></div>
      <div class="stat"><div class="stat-num" data-count="${o.reviews.sent}">0</div><div class="stat-label">review requests sent (${o.reviews.clicked} opened)</div></div>
      <div class="stat"><div class="stat-num" data-count="${o.posts.posted}">0</div><div class="stat-label">posts published this month</div></div>
    </div>
    ${!c.intake_at ? `<a class="card start-card" href="#/start"><b>Get started: 3 quick steps</b><span>Tell us about your business, give us Google access, and upload photos.</span></a>` : ''}
    <a class="btn btn-mint btn-xl" href="#/reviews">${icon.star}Ask a customer for a review</a>
    <a class="btn btn-ghost btn-xl" href="#/post">${icon.camera}Send us a photo to post</a>
    <div class="card">
      <div class="card-head"><h2>This month's plan</h2><span class="badge">${esc(PLAN_NAMES[c.plan])}</span></div>
      <div class="row small"><span>${esc(fmt.month(o.month))}</span><span class="spacer"></span><b>${o.tasks.done} of ${o.tasks.total} done</b></div>
      <div class="progress" style="margin-top:8px"><span data-w="${pct}"></span></div>
    </div>
    <div id="pmeet"></div>
    <div id="ppush"></div>
    <div class="card"><div class="card-head"><h2>What we did</h2></div>${feedHtml(data.activity, 'Your first updates show up here as we work.')}</div>
    ${c.stripe_customer_id ? '<button class="btn btn-ghost btn-xl" id="pbill">Billing and invoices</button>' : ''}
    <p class="small" style="text-align:center">Tip: add this app to your home screen. On iPhone tap Share, then Add to Home Screen. On Android tap the menu, then Install app.</p>`;
  animateNumbers(v);
  import('./meetings.js').then(async (m) => { const html = await m.nextMeetingCard(c.id); const box = $('#pmeet', v); if (box && html) box.innerHTML = html; }).catch(() => {});
  if (!user.viewAs) import('./alerts.js').then((m) => m.pushPrompt($('#ppush', v), 'Get a note when your report is ready, a page needs your OK, or a meeting is booked.')).catch(() => {});
  if (c.plan === 'leader') {
    import('./leader.js').then(async (m) => {
      const html = await m.liveDashboard(c);
      const stats = v.querySelector('.stats');
      if (html && stats && v.isConnected) { stats.insertAdjacentHTML('afterend', html); }
    });
  }
  import('./calltrack.js').then(async (m) => {
    const s = await m.callsSummary(c.id);
    const stats = v.querySelector('.stats');
    if (s && stats && v.isConnected) stats.insertAdjacentHTML('afterend', `<a class="card start-card" href="#/calls"><b>${s.total} call${s.total === 1 ? '' : 's'} this month</b><span>${s.firstTime} new caller${s.firstTime === 1 ? '' : 's'}${s.missed ? `, ${s.missed} missed. Tap to call them back.` : '. Tap to see them.'}</span></a>`);
  });
  import('./content.js').then(async (m) => {
    const n = await m.waitingCount(c.id);
    if (n && v.isConnected) v.insertAdjacentHTML('afterbegin', `<a class="card start-card" href="#/content"><b>${n} new page${n === 1 ? '' : 's'} to check</b><span>Read ${n === 1 ? 'it' : 'them'} and approve, or tell us what to change.</span></a>`);
  });
  $('#pbill', v)?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const r = await api(`/api/clients/${c.id}/billing/portal`, { method: 'POST' }); location.href = r.url; }
    catch (err) { e.target.disabled = false; (await import('./core.js')).toast(err.message, true); }
  });
}
