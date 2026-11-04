import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, run } from '../src/db.js';
import { seal, grantedApps } from '../src/google.js';
import { monthlyCents } from '../src/payments.js';
import { d1, r2 } from './shims.mjs';
import { LINKS } from '../src/stripesetup.js';
import { FIRST_CHARGE_CENTS } from '../src/plans.js';

function setup(extra = {}) {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret', ...extra };
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const h = { 'x-rw': '1', ...headers };
    if (cookie) h.cookie = cookie;
    let payload;
    if (body !== undefined) { h['content-type'] = headers['content-type'] || 'application/json'; payload = typeof body === 'string' ? body : JSON.stringify(body); }
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

// ---------- one click Stripe setup ----------
function stripeFake(opts = {}) {
  const st = { n: 0, hooks: opts.hooks || [], products: 0, prices: [], links: [], portals: opts.portals || [], posts: [], idem: [] };
  const handler = (u, init = {}) => {
    if (!u.startsWith('https://api.stripe.com/v1')) return null;
    const path = u.replace('https://api.stripe.com/v1', '').split('?')[0];
    const method = init.method || 'GET';
    const params = init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : {};
    if (method === 'POST') { st.posts.push({ path, params }); if (init.headers?.['Idempotency-Key']) st.idem.push(init.headers['Idempotency-Key']); }
    if (path === '/webhook_endpoints' && method === 'GET') return Response.json({ data: st.hooks });
    if (path === '/webhook_endpoints' && method === 'POST') { const h = { id: 'we_1', url: params.url, enabled_events: Object.entries(params).filter(([k]) => k.startsWith('enabled_events')).map(([, v]) => v), secret: 'whsec_abcdefghijklmnop1234' }; st.hooks.push({ ...h, secret: undefined }); return Response.json(h); }
    if (path.startsWith('/webhook_endpoints/') && method === 'POST') return Response.json({ id: 'we_1' });
    if (path === '/products') { st.products++; return Response.json({ id: `prod_${st.products}` }); }
    if (path === '/prices') { st.prices.push(params); return Response.json({ id: `price_${st.prices.length}` }); }
    if (path === '/payment_links' && method === 'POST') { st.links.push(params); return Response.json({ id: `plink_${st.links.length}`, url: `https://buy.stripe.com/test_${st.links.length}` }); }
    if (path.startsWith('/payment_links/')) return Response.json({ id: 'x', active: false });
    if (path === '/billing_portal/configurations' && method === 'GET') return Response.json({ data: st.portals });
    if (path === '/billing_portal/configurations' && method === 'POST') { st.portals.push({ id: 'bpc_1' }); return Response.json({ id: 'bpc_1' }); }
    return Response.json({ error: { message: `unexpected ${method} ${path}` } }, { status: 400 });
  };
  return { st, handler };
}

test('stripe setup: creates webhook, four links and the portal once, then leaves them alone', async () => {
  const t = setup({ STRIPE_SECRET_KEY: 'rk_test_abcdefgh' });
  await owner(t);
  const f = stripeFake();
  const m = mock(f.handler);
  try {
    let r = await t.call('GET', '/api/stripe/setup');
    assert.equal(r.status, 200);
    assert.equal(r.data.mode, 'test');
    assert.equal(r.data.webhook.secret, null);
    assert.equal(r.data.links.length, 4);
    r = await t.call('POST', '/api/stripe/setup', {});
    assert.equal(r.status, 200);
    assert.ok(r.data.results.every((x) => x.ok), JSON.stringify(r.data.results));
    assert.equal(r.data.status.webhook.secret, 'hub');
    assert.ok(r.data.status.links.every((l) => l.url.startsWith('https://buy.stripe.com/')));
    assert.equal(r.data.status.portal, true);
    assert.equal(f.st.links.length, 4);
    assert.equal(f.st.products, 4);
    // amounts: monthly and setup per plan, first charge matches what the webhook uses to recognize a plan
    const amounts = f.st.prices.map((p) => Number(p.unit_amount));
    for (const c of [39900, 44900, 49900, 59900]) assert.ok(amounts.includes(c), `missing price ${c}`);
    for (const l of LINKS) assert.equal(FIRST_CHARGE_CENTS[l.firstCharge] !== undefined, true, l.key);
    const growth = f.st.links.find((p) => p['metadata[rw_plan]'] === 'growth');
    assert.ok(growth['line_items[0][price]'] && growth['line_items[1][price]']);
    assert.ok(f.st.idem.every((k) => k.startsWith('rw-test-')));
    // the stored signing secret now verifies a Stripe webhook
    const body = JSON.stringify({ id: 'evt_setup_1', type: 'ping', data: { object: {} } });
    const tt = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('whsec_abcdefghijklmnop1234'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${tt}.${body}`)))].map((x) => x.toString(16).padStart(2, '0')).join('');
    let w = await t.call('POST', '/api/stripe/webhook', body, { 'stripe-signature': `t=${tt},v1=${sig}`, 'content-type': 'application/json' });
    assert.equal(w.status, 200);
    w = await t.call('POST', '/api/stripe/webhook', body, { 'stripe-signature': `t=${tt},v1=bad`, 'content-type': 'application/json' });
    assert.equal(w.status, 400);
    const set = await t.call('GET', '/api/settings');
    assert.equal(set.data.connected.stripeWebhook, true);
    assert.equal(set.data.links.growth, 'https://buy.stripe.com/test_2');
    assert.equal(JSON.stringify(set.data).includes('whsec_'), false);
    // second run changes nothing
    r = await t.call('POST', '/api/stripe/setup', {});
    assert.ok(r.data.results.every((x) => x.ok));
    assert.equal(f.st.links.length, 4);
    assert.equal(f.st.products, 4);
    assert.equal(f.st.portals.length, 1);
    // replace makes fresh links without new products or prices
    const prices = f.st.prices.length;
    r = await t.call('POST', '/api/stripe/setup', { steps: ['links'], replace: true });
    assert.equal(f.st.links.length, 8);
    assert.equal(f.st.prices.length, prices);
    assert.equal(f.st.products, 4);
  } finally { m.restore(); }
  // not for teammates or signed out visitors
  t.logout();
  assert.ok([401, 403].includes((await t.call('POST', '/api/stripe/setup', {})).status));
});

test('stripe setup: an existing webhook needs its secret pasted, bad secrets are refused, one failed step does not stop the rest', async () => {
  const t = setup({ STRIPE_SECRET_KEY: 'rk_live_abcdefgh' });
  await owner(t);
  const f = stripeFake({ hooks: [{ id: 'we_old', url: 'https://hub.test/api/stripe/webhook', enabled_events: ['invoice.paid'] }] });
  const base = f.handler;
  const m = mock((u, init) => (u.includes('/v1/products') ? Response.json({ error: { message: 'The provided key does not have the required permissions' } }, { status: 403 }) : base(u, init)));
  try {
    let r = await t.call('POST', '/api/stripe/setup', {});
    const hook = r.data.results.find((x) => x.step === 'webhook');
    assert.equal(hook.ok, false);
    assert.equal(hook.needsSecret, true);
    assert.ok(f.st.posts.some((p) => p.path === '/webhook_endpoints/we_old'), 'adds the events it was missing');
    const links = r.data.results.filter((x) => x.step === 'links');
    assert.equal(links.length, 4);
    assert.ok(links.every((x) => !x.ok && /allow it/.test(x.message)));
    assert.equal(r.data.results.find((x) => x.step === 'portal').ok, true);
    assert.equal(r.data.status.mode, 'live');
    r = await t.call('POST', '/api/stripe/setup', { steps: ['webhook'], webhookSecret: 'nope' });
    assert.equal(r.data.results[0].ok, false);
    assert.match(r.data.results[0].message, /whsec_/);
    r = await t.call('POST', '/api/stripe/setup', { steps: ['webhook'], webhookSecret: 'whsec_zzzzzzzzzzzzzzzzzzzz' });
    assert.equal(r.data.results[0].ok, true);
    assert.equal(r.data.status.webhook.secret, 'hub');
  } finally { m.restore(); }
});

test('stripe: owners can create a custom payment link from the Hub', async () => {
  const t = setup({ STRIPE_SECRET_KEY: 'rk_live_abcdefgh' });
  await owner(t);
  const f = stripeFake();
  const m = mock(f.handler);
  try {
    let r = await t.call('POST', '/api/stripe/links', { name: 'Custom plan', monthly: '$497', setup: '297' });
    assert.equal(r.status, 200);
    assert.match(r.data.link.url, /buy\.stripe\.com/);
    assert.deepEqual(f.st.prices.map((p) => p.unit_amount), ['49700', '29700']);
    assert.equal(f.st.links[0]['line_items[1][price]'], 'price_2');
    r = await t.call('POST', '/api/stripe/links', { name: 'Audit', setup: '150' });
    assert.equal(f.st.links[1]['line_items[1][price]'], undefined);
    assert.equal((await t.call('POST', '/api/stripe/links', { name: 'x' })).status, 400);
    assert.equal((await t.call('POST', '/api/stripe/links', { monthly: '5' })).status, 400);
    r = await t.call('GET', '/api/stripe/setup');
    assert.equal(r.data.custom.length, 2);
    assert.equal(r.data.custom[0].name, 'Audit');
  } finally { m.restore(); }
});

test('maps config hands the browser the Google Maps key only when one is set', async () => {
  let t = setup();
  let r = await t.call('GET', '/api/maps/config');
  assert.equal(r.status, 200);
  assert.equal(r.data.google, null);
  t = setup({ GOOGLE_MAPS_KEY: 'AIzaTest' });
  r = await t.call('GET', '/api/maps/config');
  assert.equal(r.data.google, 'AIzaTest');
  r = await t.call('GET', '/api/health');
  assert.equal(r.data.googleMaps, true);
  assert.ok(!JSON.stringify(r.data).includes('AIzaTest'));
});
