// Google page: turn each Google app on, export to Sheets, quick links to other Google tools.
// Client Website tab: Search Console, Analytics and Google Ads numbers for that client.
import { $, $$, esc, api, toast, busy, fmt, icon } from './core.js';
import { staffShell } from './staff.js';

const APPS = [
  { k: 'calendar', name: 'Calendar and Meet', what: 'Book audits from the dialer with a Meet link, and the public booking page reads your real free times.', base: true },
  { k: 'mail', name: 'Gmail', what: 'Read, write, reply and search your email on the Mail tab. Mail to a lead or client is logged on their timeline.' },
  { k: 'drive', name: 'Google Drive', what: 'Browse, search, upload and share your Drive on the Drive tab, and attach files to a client.' },
  { k: 'docs', name: 'Google Docs', what: 'Make a Google Doc from a report, a proposal or a page draft, straight into your Drive.' },
  { k: 'sheets', name: 'Google Sheets', what: 'Send leads, clients, calls or payments to a new Google Sheet in your Drive. The Hub can only open sheets it makes.' },
  { k: 'gsc', name: 'Search Console', what: 'Clicks, impressions, average position and top searches for each client site, on the client Website tab.' },
  { k: 'ga', name: 'Google Analytics', what: 'Visitors, sessions, leads (key events) and where traffic comes from, for each client, on the Website tab.' },
  { k: 'ads', name: 'Google Ads', what: 'Spend, clicks, conversions and cost per lead by campaign for each client, on the Website tab.' },
  { k: 'gbp', name: 'Google Business Profile', what: 'Publish posts and photos, reply to reviews, edit the description, phone and website, and see calls, direction requests and views, on each client\'s Google profile tab. Google has to approve API access for the project first.' },
];
const LINKS = [
  ['Google Business Profile', 'https://business.google.com/locations'], ['Looker Studio', 'https://lookerstudio.google.com'], ['Tag Manager', 'https://tagmanager.google.com'],
  ['Keyword Planner', 'https://ads.google.com/aw/keywordplanner/home'], ['Merchant Center', 'https://merchants.google.com'], ['Google Trends', 'https://trends.google.com'],
  ['PageSpeed Insights', 'https://pagespeed.web.dev'], ['Rich Results Test', 'https://search.google.com/test/rich-results'],
];
const connectUrl = (apps) => `/api/google/connect?back=google${apps.length ? `&apps=${apps.join(',')}` : ''}`;

// Tabs across the top of every Google page: the apps themselves, then the setup page.
const GTABS = [['mail', '#/google/mail', 'Mail'], ['calendar', '#/google/calendar', 'Calendar'], ['drive', '#/google/drive', 'Drive'], ['apps', '#/google', 'Setup']];
export const googleTabs = (active) => `<nav class="tabs" style="margin-bottom:16px">${GTABS.map(([k, href, name]) => `<a href="${href}" class="${active === k ? 'is-active' : ''}">${name}</a>`).join('')}</nav>`;

export async function googlePage(app, user) {
  const view = staffShell(app, user, 'google');
  const tabs = googleTabs('apps');
  const msg = new URLSearchParams(location.search).get('google');
  if (msg) { toast(msg === 'ok' ? 'Google connected' : msg, msg !== 'ok'); history.replaceState(null, '', `${location.pathname}${location.hash}`); }
  let g;
  try { g = await api('/api/google/status'); } catch (e) { view.innerHTML = `${tabs}<p class="err-text">${esc(e.message)}</p>`; return; }
  const on = new Set(g.apps || []);
  const card = (a) => {
    const has = on.has(a.k);
    const teamHas = !has && (g.teamApps || []).includes(a.k);
    const needsToken = a.k === 'ads' && !g.adsToken;
    return `<div class="card gapp">
      <div class="card-head"><h3 style="margin:0">${esc(a.name)}</h3>${has ? '<span class="badge">On</span>' : teamHas ? '<span class="badge gray">On for a teammate</span>' : '<span class="badge gray">Off</span>'}</div>
      <p class="small muted" style="margin:6px 0 12px">${esc(a.what)}</p>
      ${a.k === 'sheets' && has ? `<div class="row" style="gap:6px">${[['leads', 'Leads'], ['clients', 'Clients'], ['calls', 'Calls'], ...(user.role === 'admin' ? [['payments', 'Payments']] : [])].map(([k, n]) => `<button class="btn btn-ghost btn-sm" data-export="${k}">${n}</button>`).join('')}</div>` : ''}
      ${a.k === 'calendar' && has ? '<a class="btn btn-ghost btn-sm" href="#/settings">Booking page settings</a>' : ''}
      ${needsToken ? `<p class="small" style="margin:10px 0 0"><b>One more step:</b> Google Ads needs a developer token. In your Google Ads <b>manager</b> account open Admin, then API Center, apply for a token, and add it in Cloudflare as <b>GOOGLE_ADS_DEVELOPER_TOKEN</b>. If you use a manager account, also add <b>GOOGLE_ADS_LOGIN_CUSTOMER_ID</b> with its 10 digit ID.</p>` : ''}
      ${!has && g.ready ? `<a class="btn ${a.base ? 'btn-primary' : 'btn-ghost'} btn-sm" style="margin-top:10px" href="${esc(connectUrl(a.base ? [] : [a.k]))}">Turn on</a>` : ''}
    </div>`;
  };
  view.innerHTML = `${tabs}
    <div class="page-head"><div><p class="eyebrow">Integrations</p><h1>Google</h1></div>
      ${g.ready && g.connected ? `<div class="row"><span class="small muted">Signed in as ${esc(g.email || 'Google')}</span>${APPS.some((a) => !a.base && !on.has(a.k)) ? `<a class="btn btn-primary btn-sm" href="${esc(connectUrl(APPS.filter((a) => !a.base).map((a) => a.k)))}">Turn on all</a>` : ''}</div>` : ''}</div>
    ${!g.ready ? `<div class="card" style="margin-bottom:18px"><h2>Connect Google first</h2><p>Add <b>GOOGLE_CLIENT_ID</b> and <b>GOOGLE_CLIENT_SECRET</b> in Cloudflare, Build, Variables and secrets, then rebuild. In Google Cloud, turn on these APIs for the project: Google Calendar, Google Sheets, Google Drive, Search Console, Google Analytics Data, Google Analytics Admin, and Google Ads.</p></div>` : ''}
    <div class="gapps">${APPS.map(card).join('')}</div>
    <div class="card" style="margin-top:18px"><div class="card-head"><h3 style="margin:0">Google Business Profile</h3><span class="badge warn">Waiting on Google</span></div>
      <p class="small muted" style="margin:6px 0 0">Posting and reading reviews from the Hub needs Google to approve API access for Rightway. Until then, posts are copied and marked posted. Apply at the Business Profile APIs access form with your agency details.</p></div>
    <div class="card" style="margin-top:18px"><h3 style="margin:0 0 10px">Other Google tools</h3>
      <div class="row" style="gap:6px">${LINKS.map(([n, u]) => `<a class="btn btn-ghost btn-sm" href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a>`).join('')}</div></div>
    <div id="gout"></div>`;
  $$('[data-export]', view).forEach((b) => b.addEventListener('click', async () => {
    busy(b, true);
    try {
      const r = await api('/api/google/sheets/export', { method: 'POST', body: { what: b.dataset.export } });
      $('#gout', view).innerHTML = `<div class="card" style="margin-top:18px"><p><b>${esc(r.title)}</b> is ready with ${r.rows} row${r.rows === 1 ? '' : 's'}.</p><a class="btn btn-primary" href="${esc(r.url)}" target="_blank" rel="noopener">Open in Google Sheets</a></div>`;
      toast('Sheet created');
    } catch (err) { toast(err.message, true); } finally { busy(b, false); }
  }));
}

// ---------- client Website tab ----------
const n0 = (v) => Math.round(v || 0).toLocaleString('en-US');
const chg = (v, betterUp = true) => (v == null ? '' : `<span class="chg ${(v >= 0) === betterUp ? 'up' : 'down'}">${v >= 0 ? 'up' : 'down'} ${Math.abs(v)}%</span>`);

export async function websiteTab(el, c) {
  el.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/website`); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const L = d.links;
  const err = (k) => (d.errors[k] ? `<p class="small err-text">${esc(d.errors[k])}</p>` : '');
  const gsc = d.gsc, ga = d.ga, ads = d.ads;
  el.innerHTML = `
    <div class="card" style="margin-bottom:18px"><div class="card-head"><h2>Connected accounts</h2><button class="btn btn-ghost btn-sm" id="wlink">Change</button></div>
      <div class="mini3"><div><b class="small">${L.gsc_site ? esc(L.gsc_site.replace(/^sc-domain:/, '')) : 'Not linked'}</b><span>Search Console</span></div>
        <div><b class="small">${L.ga4_property ? `Property ${esc(L.ga4_property)}` : 'Not linked'}</b><span>Google Analytics</span></div>
        <div><b class="small">${L.ads_customer ? esc(L.ads_customer.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')) : 'Not linked'}</b><span>Google Ads</span></div></div>
      <div id="wform"></div></div>
    <div class="web-grid">
      <div class="card"><div class="card-head"><h2>Google search</h2><span class="small muted">last 28 days</span></div>
        ${gsc ? `<div class="mini3"><div><b>${n0(gsc.clicks)}</b><span>clicks ${chg(gsc.change.clicks)}</span></div><div><b>${n0(gsc.impressions)}</b><span>times shown ${chg(gsc.change.impressions)}</span></div>
          <div><b>${gsc.position ? gsc.position.toFixed(1) : 'n/a'}</b><span>average position${gsc.change.position != null ? ` <span class="chg ${gsc.change.position >= 0 ? 'up' : 'down'}">${gsc.change.position >= 0 ? 'up' : 'down'} ${Math.abs(gsc.change.position)}</span>` : ''}</span></div></div>
          ${gsc.queries.length ? `<h3 style="margin-top:16px">Top searches</h3><table class="ptable small"><thead><tr><th>Search</th><th>Clicks</th><th>Shown</th><th>Position</th></tr></thead><tbody>
            ${gsc.queries.map((q) => `<tr><td>${esc(q.q)}</td><td>${n0(q.clicks)}</td><td>${n0(q.impressions)}</td><td>${q.position.toFixed(1)}</td></tr>`).join('')}</tbody></table>` : ''}`
          : L.gsc_site ? err('gsc') : '<p class="muted">Link the client\'s Search Console site to see how they show up on Google.</p>'}</div>
      <div class="card"><div class="card-head"><h2>Website visitors</h2><span class="small muted">last 28 days</span></div>
        ${ga ? `<div class="mini3"><div><b>${n0(ga.users)}</b><span>visitors ${chg(ga.change.users)}</span></div><div><b>${n0(ga.sessions)}</b><span>visits ${chg(ga.change.sessions)}</span></div><div><b>${n0(ga.keyEvents)}</b><span>leads (key events) ${chg(ga.change.keyEvents)}</span></div></div>
          ${ga.channels.length ? `<h3 style="margin-top:16px">Where visits come from</h3><ul class="list">${ga.channels.map((ch) => `<li class="item"><span></span><div><div class="item-title">${esc(ch.name)}</div></div><span class="badge gray">${n0(ch.sessions)}</span></li>`).join('')}</ul>` : ''}`
          : L.ga4_property ? err('ga') : '<p class="muted">Link the client\'s Google Analytics property to see visitors and leads.</p>'}</div>
      <div class="card"><div class="card-head"><h2>Google Ads</h2><span class="small muted">last 30 days</span></div>
        ${ads ? `<div class="mini3"><div><b>${esc(fmt.money(ads.cost))}</b><span>spent</span></div><div><b>${n0(ads.conversions)}</b><span>conversions</span></div><div><b>${ads.costPerConv != null ? esc(fmt.money(ads.costPerConv)) : 'n/a'}</b><span>per conversion</span></div></div>
          ${ads.campaigns.length ? `<table class="ptable small" style="margin-top:14px"><thead><tr><th>Campaign</th><th>Spent</th><th>Clicks</th><th>Conv.</th></tr></thead><tbody>
            ${ads.campaigns.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(fmt.money(x.cost))}</td><td>${n0(x.clicks)}</td><td>${n0(x.conversions)}</td></tr>`).join('')}</tbody></table>` : '<p class="small muted">No campaign activity in the last 30 days.</p>'}`
          : L.ads_customer ? err('ads') : '<p class="muted">Link the client\'s Google Ads account to see spend and leads from ads.</p>'}</div>
    </div>`;
  $('#wlink', el).addEventListener('click', () => linkForm($('#wform', el), c, L, () => websiteTab(el, c)));
  if (!L.gsc_site && !L.ga4_property && !L.ads_customer) linkForm($('#wform', el), c, L, () => websiteTab(el, c));
}

async function linkForm(box, c, L, done) {
  box.innerHTML = '<div class="skeleton" style="height:60px;margin-top:12px"></div>';
  const [sites, props, cust] = await Promise.all([
    api('/api/google/gsc/sites').catch((e) => ({ error: e.message })),
    api('/api/google/ga/properties').catch((e) => ({ error: e.message })),
    api('/api/google/ads/customers').catch((e) => ({ error: e.message })),
  ]);
  const guess = (c.website || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
  const pickSite = L.gsc_site || (sites.sites || []).find((s) => guess && s.toLowerCase().includes(guess)) || '';
  const sel = (id, list, cur, none) => `<select id="${id}"><option value="">${none}</option>${list.map(([v, n]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
  box.innerHTML = `<div class="form-grid" style="margin-top:14px">
      <label class="field"><span>Search Console site</span>${sites.error ? `<input id="wgsc" value="${esc(L.gsc_site || '')}" placeholder="sc-domain:example.com"><em class="small err-text">${esc(sites.error)}</em>` : sel('wgsc', sites.sites.map((s) => [s, s.replace(/^sc-domain:/, '')]), pickSite, 'Not linked')}</label>
      <label class="field"><span>Analytics property</span>${props.error ? `<input id="wga" value="${esc(L.ga4_property || '')}" placeholder="Property ID, numbers only"><em class="small err-text">${esc(props.error)}</em>` : sel('wga', props.properties.map((p) => [p.id, `${p.name} (${p.account})`]), L.ga4_property || '', 'Not linked')}</label>
      <label class="field"><span>Google Ads account</span>${cust.error ? `<input id="wads" value="${esc(L.ads_customer || '')}" placeholder="123-456-7890"><em class="small err-text">${esc(cust.error)}</em>` : sel('wads', cust.customers.map((x) => [x, x.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')]), L.ads_customer || '', 'Not linked')}</label>
    </div><div class="row end" style="margin-top:10px"><button class="btn btn-primary btn-sm" id="wsave">Save links</button></div>`;
  $('#wsave', box).addEventListener('click', async (e) => {
    busy(e.currentTarget, true);
    try { await api(`/api/clients/${c.id}/google`, { method: 'PUT', body: { gsc_site: $('#wgsc', box).value, ga4_property: $('#wga', box).value, ads_customer: $('#wads', box).value } }); toast('Saved'); done(); }
    catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
  });
}

export const googleIcon = icon.apps;
