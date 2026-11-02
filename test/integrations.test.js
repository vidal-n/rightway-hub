import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, run } from '../src/db.js';
import { seal, grantedApps } from '../src/google.js';
import { monthlyCents } from '../src/payments.js';
import { d1, r2 } from './shims.mjs';

function setup(extra = {}) {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret', ...extra };
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const h = { 'x-rw': '1', ...headers };
    if (cookie) h.cookie = cookie;
    let payload;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload, redirect: 'manual' }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text(), res };
  };
  return { env, call, logout: () => { cookie = ''; } };
}
async function owner(t) {
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
}
function mock(handler) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u, init = {}) => { seen.push({ url: String(u), init }); const r = await handler(String(u), init); return r || real(u, init); };
  return { seen, restore: () => { globalThis.fetch = real; } };
}

test('monthly value of subscriptions handles yearly, weekly and quantity', () => {
  assert.equal(monthlyCents({ items: { data: [{ price: { unit_amount: 49700, recurring: { interval: 'month', interval_count: 1 } }, quantity: 1 }] } }), 49700);
  assert.equal(monthlyCents({ items: { data: [{ price: { unit_amount: 120000, recurring: { interval: 'year', interval_count: 1 } }, quantity: 1 }] } }), 10000);
  assert.equal(monthlyCents({ items: { data: [{ price: { unit_amount: 1000, recurring: { interval: 'month', interval_count: 1 } }, quantity: 3 }] } }), 3000);
  assert.equal(Math.round(monthlyCents({ items: { data: [{ price: { unit_amount: 1200, recurring: { interval: 'week', interval_count: 1 } }, quantity: 1 }] } })), 5200);
});

test('payments: owners only, totals from Stripe, a missing permission blanks one section', async () => {
  const t = setup({ STRIPE_SECRET_KEY: 'rk_test_abcdefgh' });
  await owner(t);
  const nowS = Math.floor(Date.now() / 1000);
  const m = mock((u) => {
    if (!u.startsWith('https://api.stripe.com')) return null;
    if (u.includes('/v1/balance')) return Response.json({ available: [{ amount: 150000, currency: 'usd' }], pending: [{ amount: 50000, currency: 'usd' }] });
    if (u.includes('/v1/charges')) return Response.json({ data: [
      { id: 'ch_1', amount: 49700, amount_refunded: 0, status: 'succeeded', paid: true, created: nowS - 100, customer: 'cus_1', description: 'Growth plan' },
      { id: 'ch_2', amount: 29700, amount_refunded: 0, status: 'failed', paid: false, created: nowS - 200, customer: 'cus_2', failure_message: 'Card declined' },
      { id: 'ch_3', amount: 99700, amount_refunded: 10000, status: 'succeeded', paid: true, created: nowS - 300, customer: 'cus_3' },
    ], has_more: false });
    if (u.includes('/v1/subscriptions') && u.includes('past_due')) return Response.json({ data: [{ id: 'sub_9', customer: 'cus_2', items: { data: [{ price: { unit_amount: 29700, recurring: { interval: 'month' } }, quantity: 1 }] } }], has_more: false });
    if (u.includes('/v1/subscriptions')) return Response.json({ data: [
      { id: 'sub_1', customer: 'cus_1', items: { data: [{ price: { unit_amount: 49700, recurring: { interval: 'month' } }, quantity: 1 }] } },
      { id: 'sub_3', customer: 'cus_3', items: { data: [{ price: { unit_amount: 99700, recurring: { interval: 'month' } }, quantity: 1 }] } },
    ], has_more: false });
    if (u.includes('/v1/invoices')) return Response.json({ data: [{ id: 'in_1', customer: 'cus_2', amount_remaining: 29700, due_date: nowS - 86400, hosted_invoice_url: 'https://invoice.stripe.com/i/x' }], has_more: false });
    if (u.includes('/v1/payouts')) return Response.json({ error: { message: 'The provided key does not have the required permissions for this endpoint' } }, { status: 403 });
    return null;
  });
  try {
    let r = await t.call('GET', '/api/payments?fresh=1');
    assert.equal(r.status, 200);
    assert.equal(r.data.mrr, 149400);
    assert.equal(r.data.collectedThisMonth, 49700 + 89700);
    assert.equal(r.data.failedThisMonth, 1);
    assert.equal(r.data.balance.available, 150000);
    assert.equal(r.data.pastDue.length, 1);
    assert.equal(r.data.unpaid[0].overdue, true);
    assert.equal(r.data.months.length, 6);
    assert.equal(r.data.months[5].cents, 49700 + 89700);
    assert.match(r.data.errors.payouts, /read access/);
    assert.equal(r.data.payouts, undefined);
  } finally { m.restore(); }
  // A team member cannot see payments
  const inv = await t.call('POST', '/api/team/invite', { email: 'rep@rightwaygrowth.com', name: 'Rep', role: 'team' });
  t.logout();
  await t.call('POST', '/api/auth/invite/accept', { token: inv.data.inviteUrl.split('/#/invite/')[1], password: 'another long password' });
  assert.equal((await t.call('GET', '/api/payments')).status, 403);
});

test('payments without Stripe says not connected', async () => {
  const t = setup();
  await owner(t);
  assert.equal((await t.call('GET', '/api/payments')).data.connected, false);
});

test('google: per app scopes, Sheets export, client website numbers', async () => {
  const t = setup({ GOOGLE_ADS_DEVELOPER_TOKEN: 'devtok' });
  await owner(t);
  assert.deepEqual(grantedApps('openid https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.file'), ['calendar', 'sheets']);
  // Connect asks only for the apps requested, on top of calendar
  let r = await t.call('GET', '/api/google/connect?back=google&apps=gsc,ga');
  const loc = new URL(r.res.headers.get('location'));
  const scope = loc.searchParams.get('scope');
  assert.match(scope, /webmasters\.readonly/); assert.match(scope, /analytics\.readonly/); assert.match(scope, /calendar\.events/);
  assert.doesNotMatch(scope, /adwords/);
  assert.match(loc.searchParams.get('state'), /_g$/);
  // Before turning on Sheets: a clear message
  r = await t.call('POST', '/api/google/sheets/export', { what: 'leads' });
  assert.equal(r.status, 400);
  // Simulate a finished connection with every app on
  const scopes = 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/adwords';
  await run(t.env, 'UPDATE users SET google_token = ?, google_email = ?, google_scopes = ?', await seal(t.env, 'refresh-1'), 'v@rightwaygrowth.com', scopes);
  r = await t.call('GET', '/api/google/status');
  assert.deepEqual(r.data.apps, ['calendar', 'sheets', 'gsc', 'ga', 'ads']);
  await t.call('POST', '/api/leads', { business: 'Bay Roofing', phone: '9545550101', state: 'FL' });
  const client = (await t.call('POST', '/api/clients', { name: 'Shore Plumbing', plan: 'growth', website: 'https://shoreplumbing.com' })).data.client;
  const m = mock((u, init) => {
    if (u.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'at', expires_in: 3600 });
    if (u === 'https://sheets.googleapis.com/v4/spreadsheets') return Response.json({ spreadsheetId: 'S1', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/S1' });
    if (u.startsWith('https://sheets.googleapis.com/v4/spreadsheets/S1/values')) return Response.json({ updatedRows: 2 });
    if (u.endsWith('/webmasters/v3/sites')) return Response.json({ siteEntry: [{ siteUrl: 'sc-domain:shoreplumbing.com', permissionLevel: 'siteOwner' }] });
    if (u.includes('/searchAnalytics/query')) {
      const b = JSON.parse(init.body);
      if (b.dimensions?.[0] === 'query') return Response.json({ rows: [{ keys: ['plumber near me'], clicks: 40, impressions: 900, position: 3.2 }] });
      if (b.dimensions?.[0] === 'page') return Response.json({ rows: [{ keys: ['https://shoreplumbing.com/'], clicks: 60, impressions: 1500 }] });
      return Response.json({ rows: [b.startDate > '2000' && b.endDate === new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10) ? { clicks: 120, impressions: 3000, ctr: 0.04, position: 6.5 } : { clicks: 100, impressions: 2500, ctr: 0.04, position: 8 }] });
    }
    if (u.includes('accountSummaries')) return Response.json({ accountSummaries: [{ displayName: 'Shore', propertySummaries: [{ property: 'properties/123456', displayName: 'Shore site' }] }] });
    if (u.includes(':runReport')) {
      const b = JSON.parse(init.body);
      if (b.dimensions) return Response.json({ rows: [{ dimensionValues: [{ value: 'Organic Search' }], metricValues: [{ value: '300' }] }] });
      return Response.json({ rows: [{ dimensionValues: [{ value: 'cur' }], metricValues: [{ value: '500' }, { value: '400' }, { value: '25' }] }, { dimensionValues: [{ value: 'prev' }], metricValues: [{ value: '400' }, { value: '320' }, { value: '20' }] }] });
    }
    if (u.includes('customers:listAccessibleCustomers')) { assert.equal(init.headers['developer-token'], 'devtok'); return Response.json({ resourceNames: ['customers/1234567890'] }); }
    if (u.includes('googleAds:search')) return Response.json({ results: [{ campaign: { name: 'Plumbing search', status: 'ENABLED' }, metrics: { costMicros: '850000000', clicks: '210', impressions: '4000', conversions: 17 } }] });
    return null;
  });
  try {
    r = await t.call('POST', '/api/google/sheets/export', { what: 'leads' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.url, 'https://docs.google.com/spreadsheets/d/S1');
    const put = m.seen.find((x) => x.url.includes('/values/'));
    const vals = JSON.parse(put.init.body).values;
    assert.equal(vals[0][0], 'Business'); assert.equal(vals[1][0], 'Bay Roofing');
    r = await t.call('POST', '/api/google/sheets/export', { what: 'payments' });
    assert.equal(r.status, 400); // Stripe not connected
    // Pick lists and linking
    assert.deepEqual((await t.call('GET', '/api/google/gsc/sites')).data.sites, ['sc-domain:shoreplumbing.com']);
    assert.equal((await t.call('GET', '/api/google/ga/properties')).data.properties[0].id, '123456');
    assert.deepEqual((await t.call('GET', '/api/google/ads/customers')).data.customers, ['1234567890']);
    assert.equal((await t.call('PUT', `/api/clients/${client.id}/google`, { gsc_site: 'not a site', ga4_property: 'properties/123456', ads_customer: '123-456-7890' })).data.gsc_site, null);
    await t.call('PUT', `/api/clients/${client.id}/google`, { gsc_site: 'sc-domain:shoreplumbing.com' });
    r = await t.call('GET', `/api/clients/${client.id}/website`);
    assert.deepEqual(r.data.errors, {});
    assert.equal(r.data.gsc.clicks, 120); assert.equal(r.data.gsc.change.clicks, 20); assert.equal(r.data.gsc.queries[0].q, 'plumber near me');
    assert.equal(r.data.ga.users, 400); assert.equal(r.data.ga.change.sessions, 25); assert.equal(r.data.ga.channels[0].name, 'Organic Search');
    assert.equal(r.data.ads.cost, 850); assert.equal(r.data.ads.conversions, 17); assert.equal(Math.round(r.data.ads.costPerConv), 50);
  } finally { m.restore(); }
});
