// The client app: home, reviews, post a photo, results. Built phone-first and installable.
import { $, esc, api, fmt, icon, animateNumbers, PLAN_NAMES } from './core.js';
import { feedHtml, renderReviews, renderPosts, renderRankings } from './shared.js';

const TABS = [['home', 'Home', icon.home], ['reviews', 'Reviews', icon.star], ['post', 'Post', icon.camera], ['results', 'Results', icon.chart]];

function shell(app, client, user, active, title, sub) {
  app.innerHTML = `
    <div class="portal">
      <header class="p-top"><div class="p-top-in">
        <div class="row"><img src="/brand/rightway-logo-dark.svg" alt="Rightway Growth" width="150" height="24"><button class="btn btn-ghost btn-sm" id="logout" style="color:#E7F1EC;border-color:rgba(255,255,255,.2)">Log out</button></div>
        <h1>${esc(title)}</h1><p>${esc(sub)}</p>
      </div></header>
      <main class="p-main" id="pview"></main>
      <nav class="tabbar" aria-label="Main">${TABS.map(([k, n, ic]) => `<a href="#/${k === 'home' ? '' : k}" class="${active === k ? 'is-active' : ''}">${ic}<span>${n}</span></a>`).join('')}</nav>
    </div>`;
  $('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.hash = '#/login'; location.reload(); });
  return $('#pview');
}

export async function portal(app, user, tab, state) {
  let data;
  try { data = await api(`/api/clients/${user.client_id}`); } catch (e) { app.innerHTML = `<div class="auth"><div class="auth-card"><p class="err-text">${esc(e.message)}</p></div></div>`; return; }
  const c = data.client;
  const first = String(user.name || '').split(/\s+/)[0];
  if (tab === 'reviews') {
    const v = shell(app, c, user, 'reviews', 'Get more reviews', 'Text a customer in seconds, or show them your QR code.');
    return renderReviews(v, c.id, { clientName: c.name });
  }
  if (tab === 'post') {
    const v = shell(app, c, user, 'post', 'Post a photo', 'Snap a job, send it, and we handle the captions and posting.');
    return renderPosts(v, c.id, { staff: false, ai: state.ai });
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
      <div class="stat hero"><div class="stat-num" data-count="${o.lastScan?.top3Pct ?? 0}" data-suffix="%">0</div><div class="stat-label">${o.lastScan ? `of your area sees you in Google's top 3 for "${esc(o.lastScan.keyword)}"` : 'top 3 coverage (first scan coming)'}</div></div>
      <div class="stat"><div class="stat-num" data-count="${o.tasks.done}">0</div><div class="stat-label">things we did for you this month</div></div>
      <div class="stat"><div class="stat-num" data-count="${o.reviews.sent}">0</div><div class="stat-label">review requests sent (${o.reviews.clicked} opened)</div></div>
      <div class="stat"><div class="stat-num" data-count="${o.posts.posted}">0</div><div class="stat-label">posts published this month</div></div>
    </div>
    <a class="btn btn-mint btn-xl" href="#/reviews">${icon.star}Ask a customer for a review</a>
    <a class="btn btn-ghost btn-xl" href="#/post">${icon.camera}Send us a photo to post</a>
    <div class="card">
      <div class="card-head"><h2>This month's plan</h2><span class="badge">${esc(PLAN_NAMES[c.plan])}</span></div>
      <div class="row small"><span>${esc(fmt.month(o.month))}</span><span class="spacer"></span><b>${o.tasks.done} of ${o.tasks.total} done</b></div>
      <div class="progress" style="margin-top:8px"><span data-w="${pct}"></span></div>
    </div>
    <div class="card"><div class="card-head"><h2>What we did</h2></div>${feedHtml(data.activity, 'Your first updates show up here as we work.')}</div>
    ${c.stripe_customer_id ? '<button class="btn btn-ghost btn-xl" id="pbill">Billing and invoices</button>' : ''}
    <p class="small" style="text-align:center">Tip: add this app to your home screen. On iPhone tap Share, then Add to Home Screen. On Android tap the menu, then Install app.</p>`;
  animateNumbers(v);
  $('#pbill', v)?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const r = await api(`/api/clients/${c.id}/billing/portal`, { method: 'POST' }); location.href = r.url; }
    catch (err) { e.target.disabled = false; (await import('./core.js')).toast(err.message, true); }
  });
}
