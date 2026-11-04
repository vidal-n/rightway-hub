// Stripe: webhook (signed), payment links per plan, client billing status, Stripe customer portal for clients.
// Keys: STRIPE_SECRET_KEY (use a restricted key), STRIPE_WEBHOOK_SECRET.
import { HttpError, json } from './util.js';
import { SCRIPT_KEYS, SCRIPT_VERSION } from '../public/js/leadintel.js';
import { all, first, run, now, getSettings, setSetting } from './db.js';
import { requireStaff, requireAdmin, requireClientAccess } from './auth.js';
import { FIRST_CHARGE_CENTS, MONTHLY_CENTS } from './plans.js';
import { convertLead, logActivity } from './crm.js';
import { route } from './router.js';
import { webhookSecret, storedWebhookSecret, readSetup } from './stripekeys.js';
import { notify } from './notify.js';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const sigs = header.split(',').filter((p) => p.trim().startsWith('v1=')).map((p) => p.trim().slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(nowSec - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`)));
  return sigs.some((s) => s.length === expected.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ expected.charCodeAt(i)), 0) === 0);
}

export async function stripe(env, method, path, params, fetchImpl = fetch, extraHeaders = {}) {
  if (!env.STRIPE_SECRET_KEY) throw new HttpError('Stripe is not connected yet. Add STRIPE_SECRET_KEY in Cloudflare.', 503);
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const url = `https://api.stripe.com/v1${path}${method === 'GET' && body ? `?${body}` : ''}`;
  const res = await fetchImpl(url, {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(method !== 'GET' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...extraHeaders },
    body: method !== 'GET' ? body : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    const perm = /permission|restricted|not allowed/i.test(msg) ? ' Edit the key in Stripe (Developers, API keys) and allow it.' : '';
    throw new HttpError(`Stripe: ${msg}${perm}`, 502);
  }
  return data;
}

const PLAN_LINK_KEYS = ['starter', 'starter_reduced', 'growth', 'authority', 'leader'];

export async function paymentLinkFor(env, plan, { leadId, email } = {}) {
  const s = await getSettings(env);
  const base = s[`pay_link_${plan}`];
  if (!base) return null;
  const u = new URL(base);
  if (leadId) u.searchParams.set('client_reference_id', leadId);
  if (email) u.searchParams.set('prefilled_email', email);
  return u.toString();
}

function subMonthlyCents(sub) {
  return (sub.items?.data || []).reduce((s, it) => {
    const p = it.price || it.plan || {};
    if (p.recurring?.interval === 'year' || p.interval === 'year') return s + Math.round(((p.unit_amount ?? p.amount) || 0) * (it.quantity || 1) / 12);
    return s + ((p.unit_amount ?? p.amount) || 0) * (it.quantity || 1);
  }, 0);
}

// ---------- webhook ----------
export async function handleStripeEvent(env, event) {
  if (await first(env, 'SELECT id FROM stripe_events WHERE id = ?', event.id)) return 'duplicate';
  await run(env, 'INSERT INTO stripe_events (id, type, at) VALUES (?, ?, ?)', event.id, event.type, now());
  const o = event.data?.object || {};
  if (event.type === 'checkout.session.completed') {
    const email = (o.customer_details?.email || o.customer_email || '').toLowerCase();
    let lead = o.client_reference_id ? await first(env, 'SELECT * FROM leads WHERE id = ?', o.client_reference_id) : null;
    if (!lead && email) lead = await first(env, 'SELECT * FROM leads WHERE lower(email) = ? ORDER BY updated_at DESC LIMIT 1', email);
    const plan = FIRST_CHARGE_CENTS[o.amount_total] || lead?.plan || null;
    let clientId = lead?.client_id || null;
    if (lead) {
      const order = await first(env, "SELECT * FROM work_orders WHERE lead_id = ? AND status != 'paid' ORDER BY created_at DESC LIMIT 1", lead.id);
      clientId = await convertLead(env, lead, order?.plan || plan, null);
      if (order) await run(env, "UPDATE work_orders SET status = 'paid', paid_at = ?, client_id = ? WHERE id = ?", now(), clientId, order.id);
      await logActivity(env, { lead_id: lead.id, client_id: clientId, type: 'payment', body: `Paid $${((o.amount_total || 0) / 100).toFixed(2)} through Stripe` });
    } else if (email) {
      const c = await first(env, 'SELECT id FROM clients WHERE lower(contact_email) = ?', email);
      clientId = c?.id || null;
    }
    if (clientId) {
      await run(env, `UPDATE clients SET stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = COALESCE(?, stripe_subscription_id),
        billing_status = 'active', mrr_cents = COALESCE(mrr_cents, ?), status = 'active' WHERE id = ?`,
      o.customer || null, o.subscription || null, plan ? MONTHLY_CENTS[plan] : null, clientId);
    }
    const who = lead?.business || email || 'Someone';
    await notify(env, { to: 'admins', kind: 'money', title: clientId ? `New client: ${who}` : 'Payment received', body: `Paid $${((o.amount_total || 0) / 100).toFixed(2)} through Stripe${clientId ? '' : ', not matched to a lead yet'}.`, url: clientId ? `/#/client/${clientId}/overview` : '/#/payments' }).catch(() => {});
    return clientId ? 'linked' : 'unmatched';
  }
  if (event.type.startsWith('customer.subscription.')) {
    const c = await first(env, 'SELECT id FROM clients WHERE stripe_customer_id = ? OR stripe_subscription_id = ?', o.customer || '', o.id || '');
    if (!c) return 'unmatched';
    const status = event.type === 'customer.subscription.deleted' ? 'canceled' : o.status;
    await run(env, 'UPDATE clients SET stripe_subscription_id = ?, billing_status = ?, mrr_cents = ? WHERE id = ?',
      o.id, status, status === 'active' || status === 'trialing' ? subMonthlyCents(o) : 0, c.id);
    return 'updated';
  }
  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const c = await first(env, 'SELECT id FROM clients WHERE stripe_customer_id = ?', o.customer || '');
    if (!c) return 'unmatched';
    const paid = event.type === 'invoice.paid';
    await run(env, 'UPDATE clients SET billing_status = ? WHERE id = ?', paid ? 'active' : 'past_due', c.id);
    await logActivity(env, { client_id: c.id, type: 'payment', body: paid ? `Invoice paid: $${((o.amount_paid || 0) / 100).toFixed(2)}` : 'Payment failed. Stripe will retry.' });
    if (!paid) {
      const cl = await first(env, 'SELECT name FROM clients WHERE id = ?', c.id);
      await notify(env, { to: 'admins', kind: 'money', title: `Payment failed: ${cl?.name || 'a client'}`, body: 'Stripe will retry. Check their card in the Billing tab.', url: `/#/client/${c.id}/billing` }).catch(() => {});
    }
    return 'updated';
  }
  return 'ignored';
}

route('POST', '/api/stripe/webhook', async ({ env, request }) => {
  const raw = await request.text();
  const ok = await verifyStripeSignature(raw, request.headers.get('stripe-signature'), await webhookSecret(env));
  if (!ok) throw new HttpError('Bad signature.', 400);
  const result = await handleStripeEvent(env, JSON.parse(raw));
  return json({ received: true, result });
}, { public: true });

// ---------- settings: payment links ----------
function prettyPhone(e) {
  const d = String(e || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : '';
}

route('GET', '/api/settings', async ({ env, user }) => {
  requireStaff(user);
  const s = await getSettings(env);
  return json({
    links: Object.fromEntries(PLAN_LINK_KEYS.map((k) => [k, s[`pay_link_${k}`] || ''])),
    company_phone: s.company_phone || '',
    // The number reps leave on voicemails: the saved company phone, else the Twilio business number.
    number: s.company_phone || prettyPhone(env.TWILIO_FROM),
    // A saved script only counts if it was saved for the current pitch (SCRIPT_VERSION); older edits fall back to the new default.
    script: s.script && Number(s.script_version) === SCRIPT_VERSION ? JSON.parse(s.script) : null,
    objections: s.objections && Number(s.script_version) === SCRIPT_VERSION ? JSON.parse(s.objections) : null,
    research_radius: Number(s.research_radius) || 2,
    connected: {
      google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      dataforseo: Boolean(env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD), stripe: Boolean(env.STRIPE_SECRET_KEY), stripeWebhook: Boolean(env.STRIPE_WEBHOOK_SECRET || (await storedWebhookSecret(env))),
      twilio: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM), ai: Boolean(env.ANTHROPIC_API_KEY), email: Boolean(env.RESEND_API_KEY),
      media: Boolean(env.MEDIA),
    },
  });
});

route('PUT', '/api/settings', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  for (const k of PLAN_LINK_KEYS) {
    if (!(k in (b.links || {}))) continue;
    const v = String(b.links[k] || '').trim();
    if (v && !/^https:\/\/(buy\.stripe\.com|checkout\.stripe\.com)\//.test(v)) throw new HttpError(`The ${k.replace('_', ' ')} link must be a Stripe payment link (https://buy.stripe.com/...).`);
    await setSetting(env, `pay_link_${k}`, v);
  }
  if ('company_phone' in b) await setSetting(env, 'company_phone', String(b.company_phone || '').slice(0, 30));
  if ('script' in b || 'objections' in b) await setSetting(env, 'script_version', String(SCRIPT_VERSION));
  if ('script' in b) {
    const keys = SCRIPT_KEYS.map(([k]) => k);
    const sc = b.script && typeof b.script === 'object' ? Object.fromEntries(keys.filter((k) => typeof b.script[k] === 'string' && b.script[k].trim()).map((k) => [k, b.script[k].slice(0, 3000)])) : null;
    await setSetting(env, 'script', sc && Object.keys(sc).length ? JSON.stringify(sc) : '');
  }
  if ('objections' in b) {
    const ob = Array.isArray(b.objections) ? b.objections.filter((o) => Array.isArray(o) && o[0] && o[1]).slice(0, 40).map(([q, a]) => [String(q).slice(0, 120), String(a).slice(0, 1500)]) : [];
    await setSetting(env, 'objections', ob.length ? JSON.stringify(ob) : '');
  }
  if ('research_radius' in b) await setSetting(env, 'research_radius', String(Math.min(10, Math.max(0.5, Number(b.research_radius) || 2))));
  return json({ ok: true });
});

route('POST', '/api/leads/:id/payment-link', async ({ env, user, params, body }) => {
  requireStaff(user);
  const lead = await first(env, 'SELECT * FROM leads WHERE id = ?', params.id);
  if (!lead) throw new HttpError('Lead not found.', 404);
  const { plan } = await body();
  const link = await paymentLinkFor(env, plan, { leadId: lead.id, email: lead.email });
  if (!link) throw new HttpError('Add that plan\'s Stripe payment link in Settings first.');
  await run(env, 'UPDATE leads SET plan = ?, updated_at = ? WHERE id = ?', plan === 'starter_reduced' ? 'starter' : plan, now(), lead.id);
  await logActivity(env, { lead_id: lead.id, type: 'payment', body: `Payment link created (${plan.replace('_', ' ')})`, by: user.id });
  return json({ link });
});

// ---------- client billing ----------
route('GET', '/api/clients/:id/billing', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', params.id);
  if (!c) throw new HttpError('Client not found.', 404);
  const base = { connected: Boolean(env.STRIPE_SECRET_KEY), linked: Boolean(c.stripe_customer_id), status: c.billing_status, mrr_cents: c.mrr_cents };
  if (!env.STRIPE_SECRET_KEY || !c.stripe_customer_id) return json(base);
  const [subs, invoices] = await Promise.all([
    stripe(env, 'GET', '/subscriptions', { customer: c.stripe_customer_id, status: 'all', limit: '5' }),
    stripe(env, 'GET', '/invoices', { customer: c.stripe_customer_id, limit: '12' }),
  ]);
  return json({
    ...base,
    subscriptions: (subs.data || []).map((s) => ({ id: s.id, status: s.status, monthly_cents: subMonthlyCents(s), current_period_end: (s.current_period_end || s.items?.data?.[0]?.current_period_end || 0) * 1000, cancel_at_period_end: s.cancel_at_period_end })),
    invoices: (invoices.data || []).map((i) => ({ id: i.id, number: i.number, status: i.status, amount_cents: i.amount_due, paid_cents: i.amount_paid, created: i.created * 1000, url: i.hosted_invoice_url })),
  });
});

route('POST', '/api/clients/:id/billing/link', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', params.id);
  if (!c) throw new HttpError('Client not found.', 404);
  const email = String((await body()).email || c.contact_email || '').trim().toLowerCase();
  if (!email) throw new HttpError('Add the client\'s billing email.');
  const found = await stripe(env, 'GET', '/customers', { email, limit: '3' });
  const cust = found.data?.[0];
  if (!cust) throw new HttpError(`No Stripe customer with ${email}.`, 404);
  const subs = await stripe(env, 'GET', '/subscriptions', { customer: cust.id, status: 'active', limit: '1' });
  const sub = subs.data?.[0];
  await run(env, 'UPDATE clients SET stripe_customer_id = ?, stripe_subscription_id = ?, billing_status = ?, mrr_cents = ? WHERE id = ?',
    cust.id, sub?.id || null, sub ? sub.status : 'no_subscription', sub ? subMonthlyCents(sub) : 0, c.id);
  return json({ ok: true, customer: cust.id });
});

route('POST', '/api/clients/:id/billing/portal', async ({ env, user, params, url }) => {
  requireClientAccess(user, params.id);
  const c = await first(env, 'SELECT stripe_customer_id FROM clients WHERE id = ?', params.id);
  if (!c?.stripe_customer_id) throw new HttpError('Billing is not linked yet. Ask the Rightway team.');
  const portal = (await readSetup(env)).portal;
  const s = await stripe(env, 'POST', '/billing_portal/sessions', { customer: c.stripe_customer_id, return_url: `${url.origin}/#/`, ...(portal ? { configuration: portal } : {}) });
  return json({ url: s.url });
});

export async function mrrFromStripe(env) {
  const rows = await all(env, "SELECT SUM(mrr_cents) AS cents, COUNT(*) AS n FROM clients WHERE billing_status IN ('active','trialing')");
  return { cents: rows[0]?.cents || 0, n: rows[0]?.n || 0 };
}
