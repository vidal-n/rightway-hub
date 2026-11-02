// Payments dashboard from Stripe (owners only): recurring revenue, money collected, balance, payouts, unpaid and failed payments.
// Every Stripe read is separate, so a restricted key missing one permission only blanks that one section.
// Cached for 60 seconds per Worker instance to keep the page fast and Stripe calls low.
import { HttpError, json } from './util.js';
import { all } from './db.js';
import { requireAdmin } from './auth.js';
import { route } from './router.js';

const API = 'https://api.stripe.com/v1';
async function sget(env, path, params = {}) {
  const q = new URLSearchParams(params).toString();
  const res = await fetch(`${API}${path}${q ? `?${q}` : ''}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    const e = new Error(/permission|restricted/i.test(msg) ? 'Your Stripe key cannot read this. Give it read access in Stripe, Developers, API keys.' : msg);
    e.status = res.status;
    throw e;
  }
  return data;
}
async function listAll(env, path, params, maxPages = 5) {
  let out = [];
  let after = null;
  for (let i = 0; i < maxPages; i++) {
    const page = await sget(env, path, { ...params, limit: '100', ...(after ? { starting_after: after } : {}) });
    out = out.concat(page.data || []);
    if (!page.has_more || !page.data?.length) break;
    after = page.data[page.data.length - 1].id;
  }
  return out;
}
const safe = async (fn) => { try { return { ok: true, v: await fn() }; } catch (e) { return { ok: false, error: e.message }; } };

// Monthly value of a subscription in cents.
export function monthlyCents(sub) {
  return (sub.items?.data || []).reduce((sum, it) => {
    const p = it.price || it.plan || {};
    const amt = (p.unit_amount ?? p.amount ?? 0) * (it.quantity || 1);
    const r = p.recurring || { interval: p.interval, interval_count: p.interval_count };
    const n = r.interval_count || 1;
    const per = r.interval === 'year' ? amt / (12 * n) : r.interval === 'week' ? (amt * 52) / (12 * n) : r.interval === 'day' ? (amt * 365) / (12 * n) : amt / n;
    return sum + per;
  }, 0) * (1 - (sub.discount?.coupon?.percent_off || 0) / 100);
}

const monthStart = (d, back = 0) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1);
const net = (c) => (c.status === 'succeeded' && c.paid ? c.amount - (c.amount_refunded || 0) : 0);

export async function buildPayments(env, at = new Date()) {
  const since = Math.floor(monthStart(at, 5) / 1000);
  const [balance, charges, active, pastDue, open, payouts, clients] = await Promise.all([
    safe(() => sget(env, '/balance')),
    safe(() => listAll(env, '/charges', { 'created[gte]': String(since) })),
    safe(() => listAll(env, '/subscriptions', { status: 'active' }, 3)),
    safe(() => listAll(env, '/subscriptions', { status: 'past_due' }, 2)),
    safe(() => listAll(env, '/invoices', { status: 'open' }, 2)),
    safe(() => sget(env, '/payouts', { limit: '6' })),
    all(env, 'SELECT id, name, stripe_customer_id FROM clients WHERE stripe_customer_id IS NOT NULL').catch(() => []),
  ]);
  const byCustomer = Object.fromEntries(clients.map((c) => [c.stripe_customer_id, { id: c.id, name: c.name }]));
  const who = (o) => byCustomer[o.customer]?.name || o.billing_details?.name || o.customer_name || o.receipt_email || o.customer_email || o.billing_details?.email || 'Customer';
  const out = { connected: true, at: Date.now(), errors: {} };
  for (const [k, r] of Object.entries({ balance, charges, active, pastDue, open, payouts })) if (!r.ok) out.errors[k] = r.error;

  if (active.ok) {
    out.mrr = Math.round(active.v.reduce((s, sub) => s + monthlyCents(sub), 0));
    out.activeSubs = active.v.length;
  }
  if (pastDue.ok) {
    out.pastDue = pastDue.v.map((s) => ({ id: s.id, customer: who(s), clientId: byCustomer[s.customer]?.id || null, monthly: Math.round(monthlyCents(s)), since: (s.current_period_start || 0) * 1000 }));
  }
  if (open.ok) {
    const nowS = Date.now() / 1000;
    out.unpaid = open.v.map((i) => ({ id: i.id, customer: who(i), clientId: byCustomer[i.customer]?.id || null, amount: i.amount_remaining, due: i.due_date ? i.due_date * 1000 : null, overdue: Boolean(i.due_date && i.due_date < nowS), url: i.hosted_invoice_url || null }))
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due || 0) - (b.due || 0));
    out.unpaidTotal = out.unpaid.reduce((s, i) => s + (i.amount || 0), 0);
  }
  if (charges.ok) {
    const thisM = monthStart(at, 0) / 1000;
    const lastM = monthStart(at, 1) / 1000;
    const months = Array.from({ length: 6 }, (_, i) => { const s = monthStart(at, 5 - i); return { start: s, label: new Date(s).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }), cents: 0, count: 0 }; });
    for (const c of charges.v) {
      const t = c.created * 1000;
      for (let i = months.length - 1; i >= 0; i--) if (t >= months[i].start) { months[i].cents += net(c); if (net(c)) months[i].count++; break; }
    }
    out.months = months;
    out.collectedThisMonth = charges.v.filter((c) => c.created >= thisM).reduce((s, c) => s + net(c), 0);
    out.collectedLastMonth = charges.v.filter((c) => c.created >= lastM && c.created < thisM).reduce((s, c) => s + net(c), 0);
    out.failedThisMonth = charges.v.filter((c) => c.created >= thisM && c.status === 'failed').length;
    out.recent = charges.v.slice(0, 15).map((c) => ({
      id: c.id, at: c.created * 1000, amount: c.amount, refunded: c.amount_refunded || 0, status: c.status === 'succeeded' && c.refunded ? 'refunded' : c.status,
      customer: who(c), clientId: byCustomer[c.customer]?.id || null, description: c.description || '', reason: c.failure_message || c.outcome?.seller_message || '', receipt: c.receipt_url || null,
    }));
  }
  if (balance.ok) {
    const sum = (arr) => (arr || []).filter((b) => b.currency === 'usd').reduce((s, b) => s + b.amount, 0);
    out.balance = { available: sum(balance.v.available), pending: sum(balance.v.pending) };
  }
  if (payouts.ok) {
    out.payouts = (payouts.v.data || []).map((p) => ({ id: p.id, amount: p.amount, arrival: p.arrival_date * 1000, status: p.status }));
    out.nextPayout = out.payouts.filter((p) => ['pending', 'in_transit'].includes(p.status)).sort((a, b) => a.arrival - b.arrival)[0] || null;
  }
  return out;
}

let cache = { at: 0, key: '', data: null };
route('GET', '/api/payments', async ({ env, user, url }) => {
  requireAdmin(user);
  if (!env.STRIPE_SECRET_KEY) return json({ connected: false });
  const fresh = url.searchParams.get('fresh') === '1';
  if (!fresh && cache.data && cache.key === env.STRIPE_SECRET_KEY.slice(-8) && Date.now() - cache.at < 60e3) return json(cache.data);
  const data = await buildPayments(env);
  if (Object.keys(data.errors).length === 6) throw new HttpError(`Stripe: ${data.errors.balance || Object.values(data.errors)[0]}`, 502);
  cache = { at: Date.now(), key: env.STRIPE_SECRET_KEY.slice(-8), data };
  return json(data);
});
