// Google apps beyond Calendar and Meet:
// - Sheets: export leads, clients, calls or payments to a new Google Sheet (drive.file scope: the Hub only touches files it creates).
// - Search Console and Analytics (GA4): per client website numbers on the client's Website tab.
// - Google Ads: per client campaign numbers. Needs GOOGLE_ADS_DEVELOPER_TOKEN (apply in the Ads API Center of a manager account).
// Data for client sites is read with whichever teammate's Google account has that app turned on (yours first, then an owner's).
import { HttpError, json } from './util.js';
import { all, first, run, now } from './db.js';
import { requireStaff, requireAdmin, requireClientAccess } from './auth.js';
import { route } from './router.js';
import { accessToken, googleReady, APP_SCOPES, hasScope } from './google.js';
import { buildPayments } from './payments.js';

const LABEL = {
  mail: 'Gmail', drive: 'Google Drive', docs: 'Google Docs', sheets: 'Google Sheets',
  gsc: 'Search Console', ga: 'Google Analytics', ads: 'Google Ads', gbp: 'Google Business Profile',
};

export async function userFor(env, user, app) {
  if (!googleReady(env)) throw new HttpError('Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Cloudflare first.', 503);
  const scope = APP_SCOPES[app];
  const me = await first(env, 'SELECT * FROM users WHERE id = ?', user.id);
  if (me?.google_token && hasScope(me.google_scopes, scope)) return me;
  const other = await first(env, "SELECT * FROM users WHERE google_token IS NOT NULL AND google_scopes LIKE ? AND role IN ('admin','team') ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END LIMIT 1", `%${scope}%`);
  if (other) return other;
  throw new HttpError(`Turn on ${LABEL[app]} on the Google page first.`, 400);
}

// Mail, Drive and Calendar are personal: only ever the asking person's own Google account, never a teammate's.
export async function ownFor(env, user, app) {
  if (!googleReady(env)) throw new HttpError('Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Cloudflare first.', 503);
  const me = await first(env, 'SELECT * FROM users WHERE id = ?', user.id);
  if (me?.google_token && hasScope(me.google_scopes, APP_SCOPES[app])) return me;
  throw new HttpError(`Turn on ${LABEL[app]} on the Google page first.`, 400);
}

export async function gfetch(env, row, url, { method = 'GET', body, headers = {}, label = 'Google' } = {}) {
  const t = await accessToken(env, row);
  const res = await fetch(url, { method, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || data[0]?.error?.message || `HTTP ${res.status}`;
    throw new HttpError(`${label}: ${msg}`, res.status === 403 || res.status === 401 ? 400 : 502);
  }
  return data;
}

// ---------- Sheets export ----------
const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '');
const EXPORTS = {
  leads: {
    title: 'Leads', admin: false,
    rows: async (env) => {
      const r = await all(env, 'SELECT business, contact_name, phone, email, website, city, state, industry, stage, grade, score, rating, reviews, next_action, next_action_at, source, created_at FROM leads ORDER BY created_at DESC LIMIT 20000');
      return [['Business', 'Contact', 'Phone', 'Email', 'Website', 'City', 'State', 'Industry', 'Stage', 'Grade', 'Score', 'Rating', 'Reviews', 'Next step', 'Next step date', 'Source', 'Added'],
        ...r.map((l) => [l.business, l.contact_name, l.phone, l.email, l.website, l.city, l.state, l.industry, l.stage, l.grade, l.score, l.rating, l.reviews, l.next_action, day(l.next_action_at), l.source, day(l.created_at)])];
    },
  },
  clients: {
    title: 'Clients', admin: false,
    rows: async (env) => {
      const r = await all(env, 'SELECT name, contact_name, phone, contact_email, website, plan, status, billing_status, mrr_cents, created_at FROM clients WHERE sample = 0 ORDER BY name');
      return [['Client', 'Contact', 'Phone', 'Email', 'Website', 'Plan', 'Status', 'Billing', 'Monthly', 'Since'],
        ...r.map((c) => [c.name, c.contact_name, c.phone, c.contact_email, c.website, c.plan, c.status, c.billing_status, c.mrr_cents != null ? c.mrr_cents / 100 : '', day(c.created_at)])];
    },
  },
  calls: {
    title: 'Calls (last 90 days)', admin: false,
    rows: async (env) => {
      const r = await all(env, `SELECT a.at, a.type, a.dispo, a.outcome, a.status, a.duration, a.to_num, a.from_num, a.note, u.name AS rep, l.business FROM activities a
        LEFT JOIN users u ON u.id = a.by LEFT JOIN leads l ON l.id = a.lead_id WHERE a.type IN ('call','manual_call') AND a.at > ? ORDER BY a.at DESC LIMIT 20000`, now() - 90 * 864e5);
      return [['Date', 'Time', 'Rep', 'Business', 'Number', 'From', 'Result', 'Status', 'Seconds', 'Note'],
        ...r.map((a) => [day(a.at), new Date(a.at).toISOString().slice(11, 16), a.rep, a.business, a.to_num, a.from_num, a.dispo || a.outcome, a.status, a.duration, a.note])];
    },
  },
  payments: {
    title: 'Payments (last 6 months)', admin: true,
    rows: async (env) => {
      if (!env.STRIPE_SECRET_KEY) throw new HttpError('Connect Stripe first.', 400);
      const p = await buildPayments(env);
      return [['Month', 'Collected'], ...(p.months || []).map((m) => [m.label, m.cents / 100]), [], ['Date', 'Customer', 'Amount', 'Status', 'Description'],
        ...(p.recent || []).map((c) => [day(c.at), c.customer, c.amount / 100, c.status, c.description])];
    },
  },
};

route('POST', '/api/google/sheets/export', async ({ env, user, body }) => {
  requireStaff(user);
  const what = (await body()).what;
  const ex = EXPORTS[what];
  if (!ex) throw new HttpError('Pick what to export.');
  if (ex.admin) requireAdmin(user);
  const row = await userFor(env, user, 'sheets');
  const values = (await ex.rows(env)).map((r) => r.map((v) => (v == null ? '' : v)));
  const title = `Rightway Hub: ${ex.title} ${new Date().toISOString().slice(0, 10)}`;
  const sheet = await gfetch(env, row, 'https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST', label: 'Google Sheets',
    body: { properties: { title }, sheets: [{ properties: { title: 'Data', gridProperties: { frozenRowCount: 1 } } }] },
  });
  await gfetch(env, row, `https://sheets.googleapis.com/v4/spreadsheets/${sheet.spreadsheetId}/values/Data!A1?valueInputOption=RAW`, { method: 'PUT', label: 'Google Sheets', body: { values } });
  return json({ url: sheet.spreadsheetUrl, rows: values.length - 1, title });
});

// ---------- pick lists for linking a client ----------
route('GET', '/api/google/gsc/sites', async ({ env, user }) => {
  requireStaff(user);
  const d = await gfetch(env, await userFor(env, user, 'gsc'), 'https://www.googleapis.com/webmasters/v3/sites', { label: 'Search Console' });
  return json({ sites: (d.siteEntry || []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser').map((s) => s.siteUrl).sort() });
});

route('GET', '/api/google/ga/properties', async ({ env, user }) => {
  requireStaff(user);
  const d = await gfetch(env, await userFor(env, user, 'ga'), 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', { label: 'Google Analytics' });
  const props = (d.accountSummaries || []).flatMap((a) => (a.propertySummaries || []).map((p) => ({ id: p.property.replace('properties/', ''), name: p.displayName, account: a.displayName })));
  return json({ properties: props });
});

const adsVersion = (env) => (/^v\d+$/.test(env.GOOGLE_ADS_API_VERSION || '') ? env.GOOGLE_ADS_API_VERSION : 'v25');
function adsHeaders(env) {
  if (!env.GOOGLE_ADS_DEVELOPER_TOKEN) throw new HttpError('Google Ads needs a developer token. Add GOOGLE_ADS_DEVELOPER_TOKEN in Cloudflare (see the Google page).', 400);
  const h = { 'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN };
  if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) h['login-customer-id'] = env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/\D/g, '');
  return h;
}
route('GET', '/api/google/ads/customers', async ({ env, user }) => {
  requireStaff(user);
  const row = await userFor(env, user, 'ads');
  const d = await gfetch(env, row, `https://googleads.googleapis.com/${adsVersion(env)}/customers:listAccessibleCustomers`, { headers: adsHeaders(env), label: 'Google Ads' });
  return json({ customers: (d.resourceNames || []).map((r) => r.replace('customers/', '')) });
});

route('PUT', '/api/clients/:id/google', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = await first(env, 'SELECT id FROM clients WHERE id = ?', params.id);
  if (!c) throw new HttpError('Client not found.', 404);
  const b = await body();
  const clean = (v, re) => { const s = String(v || '').trim(); return s && re.test(s) ? s : null; };
  const set = {};
  if ('gsc_site' in b) set.gsc_site = clean(b.gsc_site, /^(https?:\/\/|sc-domain:)[^\s]{3,200}$/);
  if ('ga4_property' in b) set.ga4_property = clean(String(b.ga4_property || '').replace(/^properties\//, ''), /^\d{4,15}$/);
  if ('ads_customer' in b) set.ads_customer = clean(String(b.ads_customer || '').replace(/-/g, ''), /^\d{10}$/);
  const keys = Object.keys(set);
  if (keys.length) await run(env, `UPDATE clients SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => set[k]), c.id);
  return json({ ok: true, ...set });
});

// ---------- the client's Website tab ----------
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return iso(d); };
const pct = (a, b) => (b ? Math.round((100 * (a - b)) / b) : null);

async function gscReport(env, row, site) {
  const base = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  // Search Console data runs about 3 days behind.
  const cur = { startDate: daysAgo(30), endDate: daysAgo(3) };
  const prev = { startDate: daysAgo(58), endDate: daysAgo(31) };
  const q = (body) => gfetch(env, row, base, { method: 'POST', body, label: 'Search Console' });
  const [t1, t0, queries, pages] = await Promise.all([q(cur), q(prev), q({ ...cur, dimensions: ['query'], rowLimit: 10 }), q({ ...cur, dimensions: ['page'], rowLimit: 5 })]);
  const tot = (d) => d.rows?.[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const a = tot(t1), b = tot(t0);
  return {
    range: cur, clicks: a.clicks, impressions: a.impressions, ctr: a.ctr, position: a.position,
    change: { clicks: pct(a.clicks, b.clicks), impressions: pct(a.impressions, b.impressions), position: b.position ? Math.round((b.position - a.position) * 10) / 10 : null },
    queries: (queries.rows || []).map((r) => ({ q: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position })),
    pages: (pages.rows || []).map((r) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
  };
}

async function gaReport(env, row, prop) {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${prop}:runReport`;
  const [tot, ch] = await Promise.all([
    gfetch(env, row, url, { method: 'POST', label: 'Google Analytics', body: {
      dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday', name: 'cur' }, { startDate: '56daysAgo', endDate: '29daysAgo', name: 'prev' }],
      metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'keyEvents' }] } }),
    gfetch(env, row, url, { method: 'POST', label: 'Google Analytics', body: {
      dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }], dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 6 } }),
  ]);
  const pick = (name) => {
    const r = (tot.rows || []).find((x) => x.dimensionValues?.some((d) => d.value === name)) || (name === 'cur' && tot.rows?.length === 1 ? tot.rows[0] : null);
    const v = (i) => Number(r?.metricValues?.[i]?.value || 0);
    return { sessions: v(0), users: v(1), keyEvents: v(2) };
  };
  const a = pick('cur'), b = pick('prev');
  return { ...a, change: { sessions: pct(a.sessions, b.sessions), users: pct(a.users, b.users), keyEvents: pct(a.keyEvents, b.keyEvents) },
    channels: (ch.rows || []).map((r) => ({ name: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value) })) };
}

async function adsReport(env, row, cid) {
  const q = `SELECT campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
    FROM campaign WHERE segments.date DURING LAST_30_DAYS AND campaign.status != 'REMOVED' ORDER BY metrics.cost_micros DESC LIMIT 10`;
  const d = await gfetch(env, row, `https://googleads.googleapis.com/${adsVersion(env)}/customers/${cid}/googleAds:search`, { method: 'POST', headers: adsHeaders(env), body: { query: q }, label: 'Google Ads' });
  const camps = (d.results || []).map((r) => ({ name: r.campaign?.name, status: r.campaign?.status, cost: Number(r.metrics?.costMicros || 0) / 1e6, clicks: Number(r.metrics?.clicks || 0), impressions: Number(r.metrics?.impressions || 0), conversions: Number(r.metrics?.conversions || 0) }));
  const sum = (k) => camps.reduce((s, c) => s + c[k], 0);
  const cost = sum('cost'), conv = sum('conversions');
  return { cost, clicks: sum('clicks'), impressions: sum('impressions'), conversions: conv, costPerConv: conv ? cost / conv : null, campaigns: camps };
}

route('GET', '/api/clients/:id/website', async ({ env, user, params }) => {
  requireStaff(user);
  requireClientAccess(user, params.id);
  const c = await first(env, 'SELECT id, website, gsc_site, ga4_property, ads_customer FROM clients WHERE id = ?', params.id);
  if (!c) throw new HttpError('Client not found.', 404);
  const out = { links: { gsc_site: c.gsc_site, ga4_property: c.ga4_property, ads_customer: c.ads_customer, website: c.website }, errors: {} };
  const run_ = async (k, app, fn) => {
    try { out[k] = await fn(await userFor(env, user, app)); } catch (e) { out.errors[k] = e.message; }
  };
  await Promise.all([
    c.gsc_site ? run_('gsc', 'gsc', (row) => gscReport(env, row, c.gsc_site)) : null,
    c.ga4_property ? run_('ga', 'ga', (row) => gaReport(env, row, c.ga4_property)) : null,
    c.ads_customer ? run_('ads', 'ads', (row) => adsReport(env, row, c.ads_customer)) : null,
  ]);
  return json(out);
});
