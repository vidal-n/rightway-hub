// Client app: the More tab and the screens behind it (Progress, Reports, Listings and links, Website health, Reputation, Your plan).
// Modeled on the "Insights" and "Reports" areas of BrightLocal and Whitespark client portals: one list, plain words, everything the client paid for in one place.
// Every number comes from an API the client is already allowed to read; nothing here shows prices or plan names.
import { esc, api, fmt, icon } from './core.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (key) => { const [y, m] = String(key || '').split('-').map(Number); return m ? `${MONTHS[m - 1]} ${y}` : ''; };
const back = '<a class="small" href="#/more">Back to More</a>';
const empty = (title, text) => `<div class="card"><div class="card-head"><h2>${esc(title)}</h2></div><p class="muted">${esc(text)}</p>${back}</div>`;
const err = (e) => `<div class="card"><p class="err-text">${esc(e.message || 'Something went wrong. Try again.')}</p>${back}</div>`;

// ---------- More ----------
export async function moreView(v, c, o = {}) {
  let d = null;
  try { d = await api(`/api/clients/${c.id}/live`); } catch { /* rows still show */ }
  const rows = [
    ['progress', icon.chart, 'Your progress', d?.keywords?.length ? `${d.keywords.length} search${d.keywords.length === 1 ? '' : 'es'} tracked on the map` : 'Rankings, reviews, calls and work in one place'],
    ['reports', icon.check, 'Monthly reports', d?.report ? `Latest: ${monthName(d.report.month)}` : 'Your report arrives after each monthly scan'],
    ['listings', icon.pin, 'Listings and links', d ? `${d.listings} live on directories and other sites` : 'Where your business is listed'],
    ['site', icon.home, 'Website health', d?.site ? `Score ${d.site.score} out of 100` : 'A check of your site and what we fixed'],
    ['reputation', icon.star, 'Reviews and reputation', d?.reviews?.rating != null ? `${d.reviews.rating} stars${d.reviews.count != null ? `, ${d.reviews.count} reviews` : ''}` : 'Your rating, pace and replies'],
    ['plan', icon.check, 'Your 90 day plan', d?.plans?.length ? `${d.plans[0].quarter.replace('-', ' ')} plan is ready` : 'Goals and the work planned for the quarter'],
    ['calls', icon.phone, 'Your calls', d?.calls ? `${d.calls.total} this month, ${d.calls.firstTime} new callers` : 'Calls from your Google profile and website'],
    ['social', icon.camera, 'Social media', 'Posts, what is coming up and your Facebook and Instagram'],
    ['content', icon.msg, 'Pages to check', 'New website pages waiting for your OK'],
  ];
  if (!c.intake_at) rows.push(['start', icon.check, 'Get started', 'Tell us about your business and give us access']);
  v.innerHTML = `
    <div class="card" style="padding:6px">
      ${rows.map(([k, ic, t, s]) => `<a class="msg-card more-row" href="#/${k}"><span class="msg-card-ic">${ic}</span><span class="msg-card-t"><b>${esc(t)}</b><span class="small">${esc(s)}</span></span><span class="more-go" aria-hidden="true">&rsaquo;</span></a>`).join('')}
    </div>
    ${c.stripe_customer_id ? '<button class="btn btn-ghost btn-xl" id="pbill2">Billing and invoices</button>' : ''}
    <p class="small" style="text-align:center">Questions about any of this? <a href="#/messages">Message your team</a>.</p>`;
  const bill = v.querySelector('#pbill2');
  if (bill) bill.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const r = await api(`/api/clients/${c.id}/billing/portal`, { method: 'POST' }); location.href = r.url; }
    catch (x) { e.target.disabled = false; (await import('./core.js')).toast(x.message, true); }
  });
  void o;
}

// ---------- Progress ----------
export async function progressView(v, c) {
  v.innerHTML = '<div class="skeleton"></div>';
  const html = await import('./leader.js').then((m) => m.liveDashboard(c)).catch(() => '');
  v.innerHTML = html ? `${html}<p style="margin:0">${back}</p>` : empty('Your progress', 'Your numbers show here after your first map scan and a few days of work.');
}

// ---------- Reports ----------
export async function reportsView(v, c) {
  v.innerHTML = '<div class="skeleton"></div>';
  const html = await import('./reports.js').then((m) => m.clientReportsCard(c.id)).catch(() => '');
  v.innerHTML = html ? `${html}<p style="margin:0">${back}</p>` : empty('Monthly reports', 'Your first report arrives after your first monthly map scan. It shows your rankings, reviews, calls and the work we did.');
}

// ---------- Listings and links ----------
const KIND = { association: 'Business association', chamber: 'Chamber of commerce', sponsorship: 'Sponsorship', list: 'Best of list', trade: 'Trade group' };
export async function listingsView(v, c) {
  v.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/citations`); } catch (e) { v.innerHTML = err(e); return; }
  const listed = d.directories.filter((x) => x.listed);
  const live = d.log.filter((x) => x.status === 'live');
  const links = live.filter((x) => x.type === 'link');
  const cites = live.filter((x) => x.type !== 'link');
  const row = (name, sub, url) => `<li class="item"><span class="badge ok">Live</span><div><div class="item-title">${esc(name)}</div>${sub ? `<div class="item-sub">${esc(sub)}</div>` : ''}</div>${/^https?:\/\//.test(url || '') ? `<a class="btn btn-ghost btn-sm" href="${esc(url)}" target="_blank" rel="noopener">Open</a>` : '<span></span>'}</li>`;
  const names = new Set(cites.map((x) => x.name));
  v.innerHTML = `
    <div class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr));margin:0">
      <div class="stat hero"><div class="stat-num">${listed.length}</div><div class="stat-label">directories that list your business</div></div>
      <div class="stat"><div class="stat-num">${links.length}</div><div class="stat-label">links from other local sites</div></div>
    </div>
    <div class="card"><div class="card-head"><h2>Directories</h2></div>
      ${listed.length || cites.length ? `<ul class="list">${listed.map((x) => row(x.name, x.group === 'Core' ? '' : x.group, x.url)).join('')}${cites.filter((x) => !listed.some((l) => l.name === x.name) && names.has(x.name)).map((x) => row(x.name, '', x.url)).join('')}</ul>` : '<p class="muted">We are building your listings. They show here as each one goes live.</p>'}
      <p class="small muted">Your name, address and phone number should read the same everywhere. We check and fix them every month.</p></div>
    <div class="card"><div class="card-head"><h2>Links from local sites</h2></div>
      ${links.length ? `<ul class="list">${links.map((x) => row(x.name, KIND[x.kind] || x.kind, x.url)).join('')}</ul>` : '<p class="muted">Links from chambers, associations and local guides show here once they are live.</p>'}
      <p class="small muted">We only earn real links from real local groups. Nothing bought or automated.</p></div>
    ${d.quota.total ? `<div class="card"><div class="row small"><span>Listing and link work this month</span><span class="spacer"></span><b>${d.quota.done} of ${d.quota.total} done</b></div></div>` : ''}
    <p style="margin:0">${back}</p>`;
}

// ---------- Website health ----------
export async function siteView(v, c) {
  v.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/site/summary`); } catch (e) { v.innerHTML = err(e); return; }
  if (d.score == null && !d.fixes) { v.innerHTML = empty('Website health', 'We check your website every month for things that hold back your rankings. Your first check shows here soon.'); return; }
  const tone = d.score == null ? '' : d.score >= 85 ? 'good-text' : d.score < 60 ? 'bad-text' : '';
  v.innerHTML = `
    <div class="stats" style="grid-template-columns:repeat(3,minmax(0,1fr));margin:0">
      <div class="stat hero"><div class="stat-num ${tone}">${d.score ?? '-'}</div><div class="stat-label">health score out of 100</div></div>
      <div class="stat"><div class="stat-num">${d.pages}</div><div class="stat-label">pages checked</div></div>
      <div class="stat"><div class="stat-num">${d.fixes}</div><div class="stat-label">fixes made</div></div>
    </div>
    ${d.at ? `<p class="small muted" style="margin:0">Last checked ${esc(fmt.date(d.at))}. ${d.issues ? `${d.issues} thing${d.issues === 1 ? '' : 's'} still on our list.` : 'Nothing left on our list.'}</p>` : ''}
    <div class="card"><div class="card-head"><h2>What we fixed</h2></div>
      ${d.recent?.length ? `<ul class="list">${d.recent.map((f) => `<li class="item"><span class="badge ${f.verified ? 'ok' : 'gray'}">${f.verified ? 'Checked' : 'Fixed'}</span>
        <div><div class="item-title">${esc(f.what)}</div><div class="item-sub">${esc(fmt.date(f.at))}${f.page ? `, ${esc(f.page)}` : ''}</div>${f.before || f.after ? `<div class="small">${f.before ? `Before: ${esc(f.before)}. ` : ''}${f.after ? `Now: ${esc(f.after)}` : ''}</div>` : ''}</div><span></span></li>`).join('')}</ul>
        <p class="small muted">"Checked" means our next scan confirmed the fix is in place.</p>` : '<p class="muted">Fixes we make to your site show here with before and after.</p>'}</div>
    <p style="margin:0">${back}</p>`;
}

// ---------- Reviews and reputation ----------
export async function reputationView(v, c) {
  v.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/reputation`); } catch (e) { v.innerHTML = err(e); return; }
  const a = d.analysis;
  if (!a) { v.innerHTML = empty('Reviews and reputation', d.waiting ? 'We are pulling your latest Google reviews. Check back in a few minutes.' : 'Your rating trend, how fast reviews come in and your reply rate show here after we pull your Google reviews.'); return; }
  const maxM = Math.max(1, ...a.months.map((m) => m.n));
  const total = Object.values(a.stars).reduce((s, n) => s + n, 0) || 1;
  const mine = d.pace?.mine;
  v.innerHTML = `
    <div class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr));margin:0">
      <div class="stat hero"><div class="stat-num">${d.pull?.rating ?? a.avg ?? '-'}</div><div class="stat-label">star rating${d.pull?.total ? `, ${d.pull.total} reviews` : ''}</div></div>
      <div class="stat"><div class="stat-num">${a.perMonth}</div><div class="stat-label">new reviews a month (last 90 days)</div></div>
      <div class="stat"><div class="stat-num${a.replyRate < 80 ? ' bad-text' : ''}">${a.replyRate}%</div><div class="stat-label">of reviews have a reply</div></div>
      <div class="stat"><div class="stat-num">${a.months[a.months.length - 1]?.n ?? 0}</div><div class="stat-label">new reviews this month</div></div>
    </div>
    <div class="card"><div class="card-head"><h2>Reviews per month</h2></div>
      <div class="rep-bars">${a.months.map((m) => `<div class="rep-col"><span class="rep-n">${m.n}</span><span class="rep-bar" style="height:${Math.round((100 * m.n) / maxM)}%"></span><span class="rep-lab">${esc(m.label)}</span></div>`).join('')}</div></div>
    <div class="card"><div class="card-head"><h2>Stars</h2></div>
      ${[5, 4, 3, 2, 1].map((s) => `<div class="rep-star"><span>${s} star${s === 1 ? '' : 's'}</span><span class="track"><span class="fill${s <= 2 ? ' bad' : ''}" style="width:${Math.round((100 * (a.stars[s] || 0)) / total)}%"></span></span><b>${a.stars[s] || 0}</b></div>`).join('')}</div>
    ${a.themes?.length ? `<div class="card"><div class="card-head"><h2>What customers talk about</h2></div><ul class="list">${a.themes.map((t) => `<li class="item"><span class="badge ${t.neg > t.pos ? 'bad' : ''}">${t.pos} good${t.neg ? `, ${t.neg} bad` : ''}</span><div><div class="item-title">${esc(t.label)}</div></div><span></span></li>`).join('')}</ul></div>` : ''}
    ${mine && d.pace.competitors?.length ? `<div class="card"><div class="card-head"><h2>Compared with nearby competitors</h2></div><div class="table-wrap"><table class="small"><thead><tr><th>Business</th><th>Reviews</th><th>Rating</th></tr></thead><tbody>
      <tr class="is-you"><td><b>${esc(c.name)}</b></td><td>${mine.reviews ?? '-'}</td><td>${mine.rating ?? '-'}</td></tr>${d.pace.competitors.map((x) => `<tr><td>${esc(x.title)}</td><td>${x.reviews ?? '-'}</td><td>${x.rating ?? '-'}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
    <a class="btn btn-mint btn-xl" href="#/reviews">${icon.star}Ask a customer for a review</a>
    <p style="margin:0">${back}</p>`;
}

// ---------- Your plan ----------
export async function planView(v, c) {
  v.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/quarterly`); } catch (e) { v.innerHTML = err(e); return; }
  const p = d.plans[0];
  if (!p) { v.innerHTML = empty('Your 90 day plan', 'Your goals and the work planned for the next three months show here once your plan is ready.'); return; }
  const x = p.data || {};
  v.innerHTML = `
    <div class="card"><div class="card-head"><h2>Goals for ${esc(p.quarter.replace('-', ' '))}</h2><a class="btn btn-ghost btn-sm" href="${esc(p.url)}" target="_blank" rel="noopener">Open full plan</a></div>
      ${x.goals?.length ? `<ul class="list">${x.goals.map((g) => `<li class="item"><span class="badge">${esc(g.now)}</span><div><div class="item-title">${esc(g.label)}</div><div class="item-sub">Goal: ${esc(g.target)}</div></div><span></span></li>`).join('')}</ul>` : '<p class="muted">Goals are coming.</p>'}</div>
    ${x.focus?.length ? `<div class="card"><div class="card-head"><h2>What we are focused on</h2></div><ul class="plain">${x.focus.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>` : ''}
    ${(x.months || []).map((m, i) => `<div class="card"><div class="card-head"><h2>${esc(m.label || `Month ${i + 1}`)}</h2></div><ul class="plain">${(m.items || []).map((it) => `<li>${esc(it)}</li>`).join('')}</ul></div>`).join('')}
    ${x.notes ? `<div class="card"><p>${esc(x.notes)}</p></div>` : ''}
    <p class="small muted" style="margin:0">Rankings depend on distance and relevance too, so we plan the work, not a promised spot.</p>
    <p style="margin:0">${back}</p>`;
}
