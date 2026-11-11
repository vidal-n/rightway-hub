// Market Leader screens: Locations roll-up, Reputation report, Quarterly plan builder (Hub tabs), and the live dashboard in the client app.
import { $, $$, esc, api, toast, copy, modal, busy, fmt } from './core.js';

const stars = (n) => (n == null ? '-' : `${n}`);
const arrow = (d) => (d == null || d === 0 ? '' : `<span class="small ${d > 0 ? 'good-text' : 'bad-text'}">${d > 0 ? 'up' : 'down'} ${Math.abs(d)}</span>`);

// ---------- Locations ----------
export async function locationsTab(el, c) {
  el.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/locations`); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  if (d.isLocation) { el.innerHTML = `<div class="card"><p>This is a location of <a href="#/client/${esc(d.parent.id)}/locations">${esc(d.parent.name)}</a>. The roll-up lives there.</p></div>`; return; }
  const r = d.rollup;
  el.innerHTML = `<div class="card"><div class="card-head"><h2>Locations</h2><button class="btn btn-primary btn-sm" id="locadd">Add location</button></div>
    <p class="small muted">Each location gets its own keywords, map scans, monthly report, call tracking and listings. The plan's tasks and the bill stay on ${esc(c.name)}.</p>
    ${r ? `<div class="table-wrap" style="margin-top:12px"><table class="small loc-table"><thead><tr><th>Location</th><th>First page coverage</th><th>Reviews</th><th>Calls this month</th><th>Website</th><th>Listings</th><th>Report</th></tr></thead><tbody>
      ${r.locations.map((l) => `<tr><td><a href="#/client/${esc(l.id)}/overview"><b>${esc(l.name)}</b></a>${l.isMain ? ' <span class="badge gray">Main</span>' : ''}<div class="muted">${esc(l.address)}</div></td>
        <td>${l.top10Avg != null ? `<b>${l.top10Avg}%</b>` : '<span class="muted">No scan yet</span>'}${l.keywords.length ? `<div class="muted">${l.keywords.length} keyword${l.keywords.length === 1 ? '' : 's'}</div>` : ''}</td>
        <td>${l.reviews ? `${stars(l.reviews.rating)} stars, ${l.reviews.count ?? '-'}` : '-'}</td>
        <td>${l.calls ? `${l.calls.total}${l.calls.missed ? ` <span class="bad-text">(${l.calls.missed} missed)</span>` : ''}` : '<span class="muted">No tracking</span>'}</td>
        <td>${l.site ?? '-'}</td><td>${l.listings}</td><td>${l.report ? `<a href="${esc(l.report.url)}" target="_blank" rel="noopener">${esc(l.report.month)}</a>` : '-'}</td></tr>`).join('')}
      <tr class="loc-total"><td><b>All ${r.totals.count}</b></td><td>${r.totals.top10Avg != null ? `<b>${r.totals.top10Avg}%</b> average` : '-'}</td><td>${r.totals.reviews}</td><td>${r.totals.calls}${r.totals.missed ? ` <span class="bad-text">(${r.totals.missed} missed)</span>` : ''}</td><td></td><td>${r.totals.listings}</td><td></td></tr>
      </tbody></table></div>` : '<p class="muted" style="margin-top:10px">No other locations yet. Add one for each address or service area that needs its own rankings and report.</p>'}</div>`;
  $('#locadd', el).addEventListener('click', () => {
    const m = modal(`<h2>Add a location</h2><form id="locf" class="form-grid" style="grid-template-columns:1fr">
      <label class="field"><span>Location name</span><input name="name" required maxlength="120" value="${esc(c.name)} " placeholder="${esc(c.name)} Pembroke Pines"></label>
      <label class="field"><span>Address</span><input name="address" maxlength="300" placeholder="123 Main St, Pembroke Pines, FL 33024"></label>
      <label class="field"><span>Phone (if different)</span><input name="phone" maxlength="30" placeholder="${esc(c.phone || '')}"></label>
      <label class="field"><span>Cities it serves</span><input name="cities" maxlength="500" placeholder="Pembroke Pines, Miramar, Weston"></label>
      <label class="field"><span>Keywords (comma separated, blank to copy the main ones)</span><input name="keywords" maxlength="500" placeholder="${esc(c.keywords || '')}"></label>
      <p class="small muted">After adding, open the location's Profile and find its Google listing so map scans can run.</p>
      <div class="row end" style="gap:8px"><button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Add location</button></div></form>`);
    $('#locf', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      busy($('button[type=submit]', f), true);
      try { const x = await api(`/api/clients/${c.id}/locations`, { method: 'POST', body: Object.fromEntries(new FormData(f)) }); m.close(); toast('Location added'); location.hash = `#/client/${x.client.id}/profile`; }
      catch (err) { busy($('button[type=submit]', f), false); toast(err.message, true); }
    });
  });
}

// ---------- Reputation ----------
let repPoll = null;
export async function reputationTab(el, c) {
  el.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/reputation`); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const again = () => reputationTab(el, c);
  const a = d.analysis;
  const pace = d.pace;
  const maxM = a ? Math.max(1, ...a.months.map((m) => m.n)) : 1;
  const totalStars = a ? Object.values(a.stars).reduce((s, n) => s + n, 0) || 1 : 1;
  el.innerHTML = `
    <div class="card"><div class="card-head"><h2>Reputation</h2><button class="btn ${a ? 'btn-ghost' : 'btn-primary'} btn-sm" id="reppull"${d.waiting ? ' disabled' : ''}>${d.waiting ? 'Getting reviews...' : a ? 'Get the latest reviews' : 'Get their Google reviews'}<span class="cost-hint" data-cost="reviews_pull"></span></button></div>
      ${d.waiting ? '<div class="sa-prog"><span class="spin"></span> Google reviews are on the way. Usually a few minutes. You can leave this page.</div>' : ''}
      <p class="small muted">Reads their newest 100 Google reviews: rating trend, how fast reviews come in compared with competitors, reply rate, and what customers talk about. A few cents each time.${d.demo ? ' DataForSEO is not connected, so this is demo data.' : ''}${d.pull ? ` Last read ${esc(fmt.date(d.pull.at))}.` : ''}</p>
      ${a ? `<div class="stats" style="grid-template-columns:repeat(4,minmax(0,1fr));margin:12px 0 0">
        <div class="stat hero"><div class="stat-num">${stars(d.pull.rating ?? a.avg)}</div><div class="stat-label">star rating${d.pull.total ? `, ${d.pull.total} reviews` : ''}</div></div>
        <div class="stat"><div class="stat-num">${a.perMonth}</div><div class="stat-label">new reviews a month (last 90 days)</div></div>
        <div class="stat"><div class="stat-num${a.replyRate < 80 ? ' bad-text' : ''}">${a.replyRate}%</div><div class="stat-label">of reviews have a reply</div></div>
        <div class="stat"><div class="stat-num${a.unansweredCount ? ' bad-text' : ''}">${a.unansweredCount}</div><div class="stat-label">reviews of 3 stars or less with no reply</div></div></div>` : ''}
    </div>
    ${a ? `<div class="rep-grid">
      <div class="card"><div class="card-head"><h2>Reviews per month</h2><span class="small muted">average stars under each month</span></div>
        <div class="rep-bars">${a.months.map((m) => `<div class="rep-col"><span class="rep-n">${m.n}</span><span class="rep-bar" style="height:${Math.round((100 * m.n) / maxM)}%"></span><span class="rep-lab">${esc(m.label)}</span><span class="rep-avg">${m.avg ?? ''}</span></div>`).join('')}</div></div>
      <div class="card"><div class="card-head"><h2>Stars</h2></div>
        ${[5, 4, 3, 2, 1].map((s) => `<div class="rep-star"><span>${s} star${s === 1 ? '' : 's'}</span><span class="track"><span class="fill${s <= 2 ? ' bad' : ''}" style="width:${Math.round((100 * (a.stars[s] || 0)) / totalStars)}%"></span></span><b>${a.stars[s] || 0}</b></div>`).join('')}</div>
    </div>
    <div class="card"><div class="card-head"><h2>What customers talk about</h2></div>
      ${a.themes.length ? `<ul class="list">${a.themes.map((t) => `<li class="item"><span class="badge ${t.neg > t.pos ? 'bad' : ''}">${t.pos} good${t.neg ? `, ${t.neg} bad` : ''}</span><div><div class="item-title">${esc(t.label)}</div>${t.quote ? `<div class="item-sub">"${esc(t.quote)}"</div>` : ''}</div><span></span></li>`).join('')}</ul>` : '<p class="muted">Not enough review text yet.</p>'}</div>
    ${a.unanswered.length ? `<div class="card"><div class="card-head"><h2>Reply to these</h2><a class="btn btn-ghost btn-sm" href="https://business.google.com/" target="_blank" rel="noopener">Open Google Business Profile</a></div>
      <ul class="list">${a.unanswered.map((r) => `<li class="item"><span class="badge bad">${r.rating} star${r.rating === 1 ? '' : 's'}</span><div><div class="item-sub">${esc(fmt.date(r.at))}</div><div>${esc(r.text || '(no text)')}</div></div><span></span></li>`).join('')}</ul></div>` : ''}` : ''}
    <div class="card"><div class="card-head"><h2>Review pace vs competitors</h2><span class="small muted">from the monthly map scans</span></div>
      ${pace.mine ? `<div class="table-wrap"><table class="small"><thead><tr><th>Business</th><th>Reviews</th><th>Rating</th><th>New per month</th></tr></thead><tbody>
        <tr class="is-you"><td><b>${esc(c.name)}</b></td><td>${pace.mine.reviews ?? '-'}</td><td>${stars(pace.mine.rating)}</td><td>${pace.mine.perMonth ?? '<span class="muted">needs 2 months of scans</span>'}</td></tr>
        ${pace.competitors.map((x) => `<tr><td>${esc(x.title)}</td><td>${x.reviews ?? '-'}</td><td>${stars(x.rating)}</td><td>${x.perMonth ?? '-'}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">Shows once the client has a map scan. Run one on the Rankings tab.</p>'}</div>`;
  $('#reppull', el)?.addEventListener('click', async (e) => {
    busy(e.currentTarget, true, 'Asking Google');
    try { const r = await api(`/api/clients/${c.id}/reputation/pull`, { method: 'POST' }); toast(r.waiting ? 'Requested. Reviews arrive in a few minutes.' : 'Reviews loaded'); again(); }
    catch (err) { busy(e.currentTarget, false); toast(err.message, true); }
  });
  clearTimeout(repPoll);
  if (d.waiting) repPoll = setTimeout(() => { if (el.isConnected) again(); }, 15000);
}

// ---------- Quarterly plan ----------
export async function quarterlyTab(el, c, openId = null) {
  el.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/quarterly`); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const sel = d.plans.find((p) => p.id === openId) || d.plans[0] || null;
  const qName = (q) => q.replace('-', ' ');
  el.innerHTML = `<div class="card"><div class="card-head"><h2>Quarterly plans</h2><div class="row" style="gap:8px">
      ${d.plans.some((p) => p.quarter === d.current) ? '' : `<button class="btn btn-ghost btn-sm" data-draft="${esc(d.current)}">Draft ${esc(qName(d.current))}</button>`}
      ${d.plans.some((p) => p.quarter === d.next) ? '' : `<button class="btn btn-primary btn-sm" data-draft="${esc(d.next)}">Draft ${esc(qName(d.next))}</button>`}</div></div>
    <p class="small muted">The Hub drafts goals, focus areas and a month by month plan from their rankings, reviews, calls, website check, listings and content ideas. Edit it, then share the link before the planning meeting.</p>
    ${d.plans.length ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:10px">${d.plans.map((p) => `<button class="btn btn-sm ${p.id === sel?.id ? 'btn-primary' : 'btn-ghost'}" data-open="${esc(p.id)}">${esc(qName(p.quarter))} ${p.status === 'shared' ? '(shared)' : '(draft)'}</button>`).join('')}</div>` : ''}</div>
    ${sel ? editorHtml(sel) : ''}`;
  $$('[data-draft]', el).forEach((b) => b.addEventListener('click', async () => {
    busy(b, true, 'Drafting');
    try { const r = await api(`/api/clients/${c.id}/quarterly`, { method: 'POST', body: { quarter: b.dataset.draft } }); quarterlyTab(el, c, r.plan.id); } catch (err) { busy(b, false); toast(err.message, true); }
  }));
  $$('[data-open]', el).forEach((b) => b.addEventListener('click', () => quarterlyTab(el, c, b.dataset.open)));
  if (sel) bindEditor(el, c, sel);
}

function editorHtml(p) {
  const g = p.data.goals || [];
  return `<div class="card qp-edit"><div class="card-head"><div><p class="eyebrow">${esc(p.quarter.replace('-', ' '))}</p><h2>Plan</h2></div><span class="badge ${p.status === 'shared' ? '' : 'warn'}">${p.status === 'shared' ? 'Shared' : 'Draft'}</span></div>
    <h3>Goals</h3>
    <div class="qp-goals" id="qpg">${g.map((x) => goalRow(x)).join('')}</div>
    <button class="btn btn-ghost btn-sm" id="qpadd" type="button" style="margin-top:6px">Add a goal</button>
    <h3 style="margin-top:18px">Focus this quarter <span class="small muted">(one per line)</span></h3>
    <textarea id="qpfocus" rows="5">${esc((p.data.focus || []).join('\n'))}</textarea>
    <div class="qp-months">${(p.data.months || []).map((m, i) => `<label class="field"><span>${esc(m.label)} <i class="small muted">(one per line)</i></span><textarea data-month="${i}" rows="8">${esc(m.items.join('\n'))}</textarea></label>`).join('')}</div>
    <label class="field" style="margin-top:12px"><span>Notes for the client</span><textarea id="qpnotes" rows="3" placeholder="Anything to talk through in the meeting.">${esc(p.data.notes || '')}</textarea></label>
    <div class="row" style="gap:8px;margin-top:14px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" id="qpredraft" type="button">Redraft from the latest data</button><button class="btn btn-ghost btn-sm" id="qpdel" type="button">Delete</button>
      <span class="spacer"></span>
      <a class="btn btn-ghost" href="${esc(p.url)}" target="_blank" rel="noopener">Open</a><button class="btn btn-ghost" id="qpsave" type="button">Save</button>
      <button class="btn btn-primary" id="qpshare" type="button">${p.status === 'shared' ? 'Copy link' : 'Save and share'}</button></div></div>`;
}
const goalRow = (x = {}) => `<div class="qp-goal"><input data-k="label" placeholder="Goal" value="${esc(x.label || '')}"><input data-k="now" placeholder="Now" value="${esc(x.now || '')}"><input data-k="target" placeholder="Target" value="${esc(x.target || '')}"><button type="button" class="btn btn-ghost btn-sm" data-rm aria-label="Remove goal">Remove</button></div>`;

function bindEditor(el, c, p) {
  const box = $('.qp-edit', el);
  const wireRm = () => $$('[data-rm]', box).forEach((b) => { b.onclick = () => b.closest('.qp-goal').remove(); });
  wireRm();
  $('#qpadd', box).addEventListener('click', () => { $('#qpg', box).insertAdjacentHTML('beforeend', goalRow()); wireRm(); });
  const collect = () => ({
    goals: $$('.qp-goal', box).map((r) => Object.fromEntries($$('input', r).map((i) => [i.dataset.k, i.value]))),
    focus: $('#qpfocus', box).value.split('\n'),
    months: $$('[data-month]', box).map((t) => ({ items: t.value.split('\n') })),
    notes: $('#qpnotes', box).value,
  });
  const save = () => api(`/api/quarterly/${p.id}`, { method: 'PUT', body: collect() });
  $('#qpsave', box).addEventListener('click', async (e) => { busy(e.currentTarget, true); try { await save(); toast('Saved'); quarterlyTab(el, c, p.id); } catch (err) { busy(e.currentTarget, false); toast(err.message, true); } });
  $('#qpshare', box).addEventListener('click', async (e) => {
    busy(e.currentTarget, true);
    try { await save(); await api(`/api/quarterly/${p.id}/share`, { method: 'POST' }); copy(`${location.origin}${p.url}`, 'Shared. Link copied. It also shows in their app.'); quarterlyTab(el, c, p.id); }
    catch (err) { busy(e.currentTarget, false); toast(err.message, true); }
  });
  $('#qpredraft', box).addEventListener('click', async (e) => {
    if (!confirm('Replace this plan with a fresh draft from the latest data? Your edits will be lost.')) return;
    busy(e.currentTarget, true);
    try { await api(`/api/clients/${c.id}/quarterly`, { method: 'POST', body: { quarter: p.quarter, redraft: true } }); quarterlyTab(el, c, p.id); } catch (err) { busy(e.currentTarget, false); toast(err.message, true); }
  });
  $('#qpdel', box).addEventListener('click', async () => {
    if (!confirm('Delete this plan?')) return;
    try { await api(`/api/quarterly/${p.id}`, { method: 'DELETE' }); quarterlyTab(el, c); } catch (err) { toast(err.message, true); }
  });
}

// ---------- client app: live dashboard (Market Leader) ----------
export async function liveDashboard(c) {
  let d;
  try { d = await api(`/api/clients/${c.id}/live`); } catch { return ''; }
  const card = (title, body, link = '') => `<div class="card live-card"><div class="card-head"><h2>${title}</h2>${link}</div>${body}</div>`;
  const parts = [];
  if (d.keywords.length) parts.push(card('Rankings', `<ul class="live-list">${d.keywords.map((k) => `<li><span>${esc(k.keyword)}</span><b>${k.top10Pct ?? 0}%</b>${arrow(k.change)}</li>`).join('')}</ul><p class="small muted">Share of your area that sees you on Google's first page (top 10).</p>`, '<a class="small" href="#/results">Maps</a>'));
  if (d.reviews) parts.push(card('Reviews', `<div class="live-big"><b>${stars(d.reviews.rating)}</b><span>stars${d.reviews.count != null ? `, ${d.reviews.count} reviews` : ''}</span></div>${d.reviews.newThisMonth != null ? `<p class="small">${d.reviews.newThisMonth} new this month. ${d.reviews.replyRate != null ? `${d.reviews.replyRate}% have a reply.` : ''}</p>` : ''}`, '<a class="small" href="#/reviews">Get more</a>'));
  if (d.calls) parts.push(card('Calls this month', `<div class="live-big"><b>${d.calls.total}</b><span>calls, ${d.calls.firstTime} new callers</span></div>${d.calls.missed ? `<p class="small bad-text">${d.calls.missed} missed. Call them back.</p>` : ''}`, '<a class="small" href="#/calls">See calls</a>'));
  parts.push(card('Work this month', `<div class="live-big"><b>${d.work.done}</b><span>of ${d.work.total} things done</span></div>${d.work.recent.length ? `<ul class="live-feed">${d.work.recent.slice(0, 5).map((r) => `<li><span>${esc(r.text)}</span><i>${esc(fmt.date(r.at))}</i></li>`).join('')}</ul>` : ''}`));
  if (d.site || d.listings) parts.push(card('Website and listings', `<ul class="live-list">${d.site ? `<li><span>Website health</span><b>${d.site.score}</b></li>` : ''}<li><span>Directory listings and links live</span><b>${d.listings}</b></li></ul>`));
  if (d.locations) parts.push(card('Your locations', `<ul class="live-list">${d.locations.locations.map((l) => `<li><span>${esc(l.name)}</span><b>${l.top10Avg != null ? `${l.top10Avg}%` : '-'}</b>${l.calls ? `<i class="small muted">${l.calls.total} calls</i>` : ''}</li>`).join('')}</ul><p class="small muted">Top 3 coverage per location.</p>`));
  const links = [d.report ? `<a class="btn btn-ghost btn-sm" href="${esc(d.report.url)}" target="_blank" rel="noopener">${esc(d.report.month)} report</a>` : '', ...d.plans.map((p) => `<a class="btn btn-ghost btn-sm" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.quarter.replace('-', ' '))} plan</a>`)].filter(Boolean);
  if (links.length) parts.push(`<div class="row" style="gap:8px;flex-wrap:wrap">${links.join('')}</div>`);
  return `<div class="live"><p class="eyebrow" style="margin:0">Live dashboard</p>${parts.join('')}</div>`;
}
