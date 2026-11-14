import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { applyOutcome, timezoneFor, inCallingHours, e164, digits } from '../src/crm.js';
import { verifyStripeSignature } from '../src/billing.js';
import { twilioSignature } from '../src/calls.js';
import { d1, r2 } from './shims.mjs';

const enc = new TextEncoder();
async function stripeSig(body, secret, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${body}`)))].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${sig}`;
}

function setup() {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', STRIPE_WEBHOOK_SECRET: 'whsec_test', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+17545550000' };
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const h = { 'x-rw': '1', ...headers };
    if (cookie) h.cookie = cookie;
    let payload;
    if (typeof body === 'string') payload = body;
    else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload, redirect: 'manual' }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text(), res };
  };
  return { env, call, clearCookie: () => { cookie = ''; } };
}

async function owner(t) {
  const r = await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  assert.equal(r.status, 200);
}

test('time zones, calling hours, phone formats', () => {
  assert.equal(timezoneFor('FL'), 'America/New_York');
  assert.equal(timezoneFor('texas'), 'America/Chicago');
  assert.equal(timezoneFor('AZ'), 'America/Phoenix');
  assert.equal(timezoneFor('ZZ'), null);
  assert.equal(inCallingHours('America/New_York', Date.UTC(2026, 10, 2, 15, 0)), true); // 10am ET
  assert.equal(inCallingHours('America/Los_Angeles', Date.UTC(2026, 10, 2, 14, 0)), false); // 6am PT
  assert.equal(inCallingHours('America/New_York', Date.UTC(2026, 10, 3, 1, 30)), false); // 8:30pm ET
  assert.equal(e164('(954) 555-0100'), '+19545550100');
  assert.equal(e164('1-954-555-0100'), '+19545550100');
  assert.equal(e164('555'), null);
  assert.equal(digits('+1 954 555 0100'), '9545550100');
});

test('playbook cadence: no answer schedules day 1, 2, 4, 7, then recycles', () => {
  const t0 = Date.UTC(2026, 10, 2);
  let lead = { stage: 'new', attempts: 0 };
  const days = [];
  for (let i = 0; i < 5; i++) {
    const set = applyOutcome(lead, 'no_answer', { at: t0 });
    days.push(Math.round((set.next_action_at - t0) / 864e5));
    lead = { ...lead, ...set };
  }
  assert.deepEqual(days, [1, 2, 3, 7, 60]);
  assert.equal(lead.stage, 'not_now');
  assert.throws(() => applyOutcome(lead, 'callback', {}));
  assert.equal(applyOutcome(lead, 'dnc').dnc, 1);
  assert.equal(applyOutcome(lead, 'booked', { at: t0, callbackAt: t0 + 5e6 }).stage, 'audit_booked');
});

test('leads: create, dedupe, import, outcome, queue, convert', async () => {
  const t = setup();
  await owner(t);
  let r = await t.call('POST', '/api/leads', { business: 'Summit Roofing', contact_name: 'Bob', phone: '(954) 555-0101', state: 'FL', city: 'Hollywood' });
  assert.equal(r.status, 200);
  const id = r.data.lead.id;
  assert.equal(r.data.lead.timezone, 'America/New_York');
  r = await t.call('POST', '/api/leads', { business: 'Dupe', phone: '954-555-0101' });
  assert.equal(r.status, 409);
  r = await t.call('POST', '/api/leads/import', { rows: [
    { business: 'Ace Plumbing', phone: '305-555-0102', state: 'FL' }, { business: 'Dupe again', phone: '9545550101' },
    { business: '', phone: '1' }, { business: 'Lone Star HVAC', phone: '512-555-0103', state: 'TX' },
  ] });
  assert.equal(r.data.imported, 2);
  assert.equal(r.data.skipped, 2);
  assert.equal(r.data.skippedBy.phone, 1);
  assert.equal(r.data.skippedBy.invalid, 1);
  r = await t.call('GET', '/api/leads?q=hvac');
  assert.equal(r.data.leads.length, 1);
  assert.equal(r.data.counts.new, 3);

  r = await t.call('POST', `/api/leads/${id}/outcome`, { outcome: 'no_answer', note: 'Left voicemail' });
  assert.equal(r.data.lead.stage, 'attempting');
  assert.equal(r.data.lead.attempts, 1);
  r = await t.call('GET', '/api/dialer/queue');
  assert.ok(!r.data.queue.some((l) => l.id === id), 'just-called lead is not re-queued');

  r = await t.call('POST', `/api/leads/${id}/outcome`, { outcome: 'dnc' });
  assert.equal(r.data.lead.dnc, 1);
  r = await t.call('POST', `/api/leads/${id}/note`, { text: 'Owner asked not to be called' });
  r = await t.call('GET', `/api/leads/${id}`);
  assert.ok(r.data.activities.length >= 3);

  const lead2 = (await t.call('GET', '/api/leads?q=ace')).data.leads[0];
  r = await t.call('POST', `/api/leads/${lead2.id}/convert`, { plan: 'authority' });
  const clientId = r.data.clientId;
  r = await t.call('GET', `/api/clients/${clientId}`);
  assert.equal(r.data.client.plan, 'authority');
  assert.equal(r.data.client.name, 'Ace Plumbing');
});

test('website form posts a lead, honeypot drops bots, CORS only for the site', async () => {
  const t = setup();
  const form = 'name=Maria+Lopez&business=Orale&email=maria%40orale.com&phone=9545550199&city=Hollywood%2C+FL&industry=Restaurant&message=Help&sms_consent_service=on';
  let r = await t.call('POST', '/api/public/lead', form, { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://rightwaygrowth.com', 'x-rw': '' });
  assert.equal(r.status, 200);
  assert.equal(r.res.headers.get('access-control-allow-origin'), 'https://rightwaygrowth.com');
  r = await t.call('POST', '/api/public/lead', 'name=Bot&company-url=x', { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' });
  assert.equal(r.res.headers.get('access-control-allow-origin'), null);
  await owner(t);
  r = await t.call('GET', '/api/leads');
  assert.equal(r.data.leads.length, 1);
  assert.equal(r.data.leads[0].stage, 'audit_requested');
  assert.equal(r.data.leads[0].sms_consent, 1);
  assert.equal(r.data.leads[0].state, 'FL');
});

test('work order: price is typed (no package), then public view, sign, and Stripe payment creates the client with the quoted scope', async () => {
  const t = setup();
  t.env.STRIPE_SECRET_KEY = 'rk_test_abcdefgh';
  await owner(t);
  // A tiny Stripe: every product, price and payment link the Hub asks for is made and numbered.
  const made = { links: [], prices: [] };
  let r, lead;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    if (!String(u).startsWith('https://api.stripe.com/v1')) return realFetch(u, init);
    const path = String(u).replace('https://api.stripe.com/v1', '').split('?')[0];
    const params = init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : {};
    if (path === '/products') return Response.json({ id: 'prod_1' });
    if (path === '/prices') { made.prices.push(params); return Response.json({ id: `price_${made.prices.length}` }); }
    if (path === '/payment_links') { made.links.push(params); return Response.json({ id: `plink_${made.links.length}`, url: `https://buy.stripe.com/test_${made.links.length}` }); }
    return Response.json({ error: { message: `unexpected ${path}` } }, { status: 400 });
  };
  try {
    r = await t.call('PUT', '/api/settings', { links: { growth: 'https://evil.example/pay' } });
    assert.equal(r.status, 200, 'plan links are gone: the old field is ignored');
    lead = (await t.call('POST', '/api/leads', { business: 'Coastal Roof Pros', contact_name: 'Ana', email: 'ana@coastal.com', phone: '9545550111', state: 'FL' })).data.lead;
    // No price typed: nothing is made up for them.
    r = await t.call('POST', `/api/leads/${lead.id}/payment-link`, {});
    assert.equal(r.status, 400);
    assert.match(r.data.error, /Type the buildout and the monthly/);
    r = await t.call('POST', `/api/leads/${lead.id}/work-order`, { plan: 'growth' });
    assert.equal(r.status, 400, 'an old caller naming a plan gets no default price');
    // The owner types the price and picks the scope.
    r = await t.call('PUT', `/api/leads/${lead.id}/quote`, { setup: '500', monthly: '425', services: [{ id: 'profile' }, { id: 'posts', qty: 6 }, { id: 'pages', qty: 3 }, { id: 'report' }] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.quote.services, ['profile', 'posts', 'pages', 'report']);
    assert.equal(r.data.quote.qty.posts, 6);
    assert.equal(r.data.quote.setup, 500);
    r = await t.call('POST', `/api/leads/${lead.id}/payment-link`, {});
    assert.match(r.data.link, /client_reference_id=ld_/);
    assert.match(r.data.link, /prefilled_email=ana%40coastal.com/);
    assert.deepEqual(made.prices.map((p) => p.unit_amount), ['42500', '50000']);
    r = await t.call('POST', `/api/leads/${lead.id}/work-order`, {});
    assert.equal(r.data.hasPayLink, true);
    assert.equal(made.links.length, 1, 'the same amounts reuse the same payment link');
    const tok = r.data.url.split('#')[1];
    t.clearCookie();
    r = await t.call('GET', `/api/public/wo/${tok}`);
    assert.equal(r.data.order.plan, undefined, 'the client never sees a plan name');
    assert.equal(r.data.order.monthly_cents, 42500);
    assert.equal(r.data.order.setup_cents, 50000);
    // One agreement for every client: same sections, only the amounts change.
    assert.ok(r.data.order.sections.length >= 8);
    const agreement = JSON.stringify(r.data.order.sections);
    assert.match(agreement, /\$925\.00 \(due upon signing\)/);
    assert.match(agreement, /\$425\.00 per month/);
    assert.match(agreement, /three \(3\) months/);
    assert.match(agreement, /Website design/);
    assert.ok(!/[–—]/.test(agreement));
    r = await t.call('POST', `/api/public/wo/${tok}/sign`, { name: 'Ana Ruiz', agree: false });
    assert.equal(r.status, 400);
    r = await t.call('POST', `/api/public/wo/${tok}/sign`, { name: 'Ana Ruiz', agree: true }, { 'cf-connecting-ip': '203.0.113.9' });
    assert.equal(r.data.order.status, 'signed');
    assert.match(r.data.order.pay_url, /buy\.stripe\.com/);
  } finally { globalThis.fetch = realFetch; }
  // The signing page is public; the owner signs back in for the rest.
  r = await t.call('POST', '/api/auth/login', { email: 'v@rightwaygrowth.com', password: 'correct horse battery' });
  assert.equal(r.status, 200);

  // Stripe webhook: bad signature refused, good one links everything.
  const event = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: lead.id, amount_total: 92500, customer: 'cus_1', subscription: 'sub_1', customer_details: { email: 'ana@coastal.com' } } } };
  const body = JSON.stringify(event);
  r = await t.call('POST', '/api/stripe/webhook', body, { 'stripe-signature': 't=1,v1=bad', 'content-type': 'application/json' });
  assert.equal(r.status, 400);
  r = await t.call('POST', '/api/stripe/webhook', body, { 'stripe-signature': await stripeSig(body, 'whsec_test'), 'content-type': 'application/json' });
  assert.equal(r.data.result, 'linked');
  r = await t.call('POST', '/api/stripe/webhook', body, { 'stripe-signature': await stripeSig(body, 'whsec_test'), 'content-type': 'application/json' });
  assert.equal(r.data.result, 'duplicate');
  r = await t.call('GET', `/api/leads/${lead.id}`);
  assert.equal(r.data.lead.stage, 'won');
  assert.equal(r.data.orders[0].status, 'paid');
  r = await t.call('GET', `/api/clients/${r.data.lead.client_id}`);
  // The client gets exactly the quoted scope, and what they pay is what the owner typed.
  assert.equal(r.data.client.billing_status, 'active');
  assert.equal(r.data.client.mrr_cents, 42500);
  assert.deepEqual(r.data.client.plan_info.scope.map((x) => [x.id, x.qty]), [['profile', 1], ['posts', 6], ['pages', 3], ['report', 1]]);
  assert.equal(r.data.client.plan_info.custom, true);
  const month = await t.call('GET', `/api/clients/${r.data.client.id}/tasks?month=${new Date().toISOString().slice(0, 7)}`);
  const titles = (month.data.tasks || []).map((x) => x.title);
  assert.equal(titles.filter((x) => /^Google profile post/.test(x)).length, 6);
  assert.equal(titles.filter((x) => /^New local service or city page/.test(x)).length, 3);
  assert.ok(!titles.some((x) => /Local link|Content piece/.test(x)), 'services not in the scope make no tasks');

  // Subscription canceled later
  const cancel = { id: 'evt_2', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', items: { data: [] } } } };
  const cb = JSON.stringify(cancel);
  r = await t.call('POST', '/api/stripe/webhook', cb, { 'stripe-signature': await stripeSig(cb, 'whsec_test'), 'content-type': 'application/json' });
  assert.equal(r.data.result, 'updated');
});

test('stripe signature checks time tolerance', async () => {
  const body = '{"a":1}';
  const old = await stripeSig(body, 's', Math.floor(Date.now() / 1000) - 1000);
  assert.equal(await verifyStripeSignature(body, old, 's'), false);
  assert.equal(await verifyStripeSignature(body, await stripeSig(body, 's'), 's'), true);
  assert.equal(await verifyStripeSignature(body, await stripeSig(body, 's'), 'other'), false);
});

test('twilio bridge: signed webhooks only, TwiML dials the lead without recording', async () => {
  const t = setup();
  await owner(t);
  const lead = (await t.call('POST', '/api/leads', { business: 'Bay & Sons Roofing', phone: '9545550123', state: 'FL' })).data.lead;
  // Simulate the activity the dialer creates.
  const { logActivity } = await import('../src/crm.js');
  const aid = await logActivity(t.env, { lead_id: lead.id, type: 'call', status: 'ringing_you' });
  const url = `https://hub.test/api/twilio/bridge?a=${aid}`;
  const params = { CallSid: 'CA1', From: '+17545550000', To: '+19545550999' };
  const form = new URLSearchParams(params).toString();
  let r = await t.call('POST', `/api/twilio/bridge?a=${aid}`, form, { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'nope' });
  assert.equal(r.status, 403);
  r = await t.call('POST', `/api/twilio/bridge?a=${aid}`, form, { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': await twilioSignature('tok', url, params) });
  assert.equal(r.status, 200);
  assert.match(r.data, /<Number[^>]*>\+19545550123<\/Number>/);
  assert.match(r.data, /record="do-not-record"/);
  assert.match(r.data, /Bay &amp; Sons Roofing/);
  const doneUrl = `https://hub.test/api/twilio/dial-done?a=${aid}`;
  const dp = { DialCallStatus: 'completed', DialCallDuration: '83' };
  r = await t.call('POST', `/api/twilio/dial-done?a=${aid}`, new URLSearchParams(dp).toString(), { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': await twilioSignature('tok', doneUrl, dp) });
  assert.equal(r.status, 200);
  r = await t.call('GET', `/api/leads/${lead.id}`);
  const callAct = r.data.activities.find((a) => a.id === aid);
  assert.equal(callAct.duration, 83);
  // Phone number for the bridge
  r = await t.call('PUT', '/api/me/phone', { phone: '954 555 0001' });
  assert.equal(r.data.phone, '+19545550001');
});

test('dial out: lists Twilio numbers, validates caller ID, blocks DNC, bridges from the chosen number', async () => {
  const t = setup();
  await owner(t);
  t.env.TWILIO_ACCOUNT_SID = 'ACtest'; t.env.TWILIO_AUTH_TOKEN = 'tok'; t.env.TWILIO_FROM = '+13055073393';
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const s = String(u);
    if (s.includes('IncomingPhoneNumbers')) return Response.json({ incoming_phone_numbers: [
      { phone_number: '+19547374725', friendly_name: '(954) 737-4725', capabilities: { voice: true } },
      { phone_number: '+13055073393', friendly_name: '(305) 507-3393', capabilities: { voice: true } },
      { phone_number: '+13056970181', friendly_name: '(305) 697-0181', capabilities: { voice: true } },
    ] });
    if (s.includes('/Calls.json')) { calls.push(new URLSearchParams(init.body)); return Response.json({ sid: 'CA123' }, { status: 201 }); }
    return realFetch(u, init);
  };
  try {
    let r = await t.call('GET', '/api/dialer/numbers');
    assert.equal(r.data.numbers.length, 3);
    assert.equal(r.data.numbers[0].number, '+13055073393');
    await t.call('PUT', '/api/me/phone', { phone: '954 555 0001' });
    r = await t.call('POST', '/api/dialer/dial', { to: '(954) 555 0188', from: '+15555550000' });
    assert.equal(r.status, 400);
    r = await t.call('POST', '/api/dialer/dial', { to: '(900) 555 0188', from: '+19547374725' });
    assert.equal(r.status, 400);
    r = await t.call('POST', '/api/dialer/dial', { to: '(954) 555 0188', from: '+19547374725' });
    assert.equal(r.status, 200);
    assert.equal(calls[0].get('From'), '+19547374725');
    const bridgeUrl = calls[0].get('Url');
    assert.match(bridgeUrl, /to=%2B19545550188/);
    const params = { CallSid: 'CA123' };
    r = await t.call('POST', new URL(bridgeUrl).pathname + new URL(bridgeUrl).search, new URLSearchParams(params).toString(),
      { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': await twilioSignature('tok', bridgeUrl, params) });
    assert.equal(r.status, 200);
    assert.match(r.data, /callerId="\+19547374725"/);
    assert.match(r.data, /<Number[^>]*>\+19545550188<\/Number>/);
    r = await t.call('GET', '/api/dialer/recent');
    assert.equal(r.data.calls.length, 1);
    // Do Not Call blocks a manual dial too
    const lead = (await t.call('POST', '/api/leads', { business: 'No Calls Inc', phone: '9545550777', state: 'FL' })).data.lead;
    await t.call('POST', `/api/leads/${lead.id}/outcome`, { outcome: 'dnc' });
    r = await t.call('POST', '/api/dialer/dial', { to: '954-555-0777', from: '+19547374725' });
    assert.equal(r.status, 409);
  } finally { globalThis.fetch = realFetch; }
});
