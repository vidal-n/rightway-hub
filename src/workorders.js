// Work orders: one service agreement for every plan (public/js/agreement.js), only the setup and monthly amounts change.
// Signed online (typed name + agreement, with time, IP, and device recorded), then paid by Stripe link.
// The wording is saved with each order, so later edits never change an agreement someone already got.
import { HttpError, json } from './util.js';
import { first, run, newId, token, now } from './db.js';
import { requireStaff } from './auth.js';
import { PLANS, MONTHLY_CENTS, SETUP_CENTS } from './plans.js';
import { agreementSnapshot } from '../public/js/agreement.js';
import { paymentLinkFor } from './billing.js';
import { logActivity } from './crm.js';
import { route } from './router.js';

route('POST', '/api/leads/:id/work-order', async ({ env, user, params, url, body }) => {
  requireStaff(user);
  const lead = await first(env, 'SELECT * FROM leads WHERE id = ?', params.id);
  if (!lead) throw new HttpError('Lead not found.', 404);
  const b = await body();
  const plan = PLANS[b.plan] ? b.plan : null;
  if (!plan) throw new HttpError('Pick a plan.');
  const setup = SETUP_CENTS[plan];
  const payUrl = await paymentLinkFor(env, plan, { leadId: lead.id, email: lead.email });
  const terms = JSON.stringify(agreementSnapshot({ setupCents: setup, monthlyCents: MONTHLY_CENTS[plan] }));
  const id = newId('wo_');
  const t = token(18);
  await run(env, `INSERT INTO work_orders (id, token, lead_id, plan, monthly_cents, setup_cents, business, contact_name, email, terms, pay_url, status, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)`,
  id, t, lead.id, plan, MONTHLY_CENTS[plan], setup, lead.business, lead.contact_name, lead.email, terms, payUrl, now(), user.id);
  await run(env, 'UPDATE leads SET plan = ?, updated_at = ? WHERE id = ?', plan, now(), lead.id);
  await logActivity(env, { lead_id: lead.id, type: 'work_order', body: `Work order sent: ${PLANS[plan].name}`, by: user.id });
  return json({ url: `${url.origin}/sign.html#${t}`, hasPayLink: Boolean(payUrl) });
});

function publicOrder(o) {
  const t = JSON.parse(o.terms || '{}');
  return {
    business: o.business, contact_name: o.contact_name, plan: PLANS[o.plan]?.name || o.plan, monthly_cents: o.monthly_cents, setup_cents: o.setup_cents,
    includes: t.includes || [], terms: t.terms || [], sections: t.sections || null, status: o.status, signed_name: o.signed_name, signed_at: o.signed_at, created_at: o.created_at,
    pay_url: o.status !== 'paid' ? o.pay_url : null,
  };
}

route('GET', '/api/public/wo/:token', async ({ env, params }) => {
  const o = await first(env, 'SELECT * FROM work_orders WHERE token = ?', params.token);
  if (!o) throw new HttpError('This work order link is not valid.', 404);
  return json({ order: publicOrder(o) });
}, { public: true });

route('POST', '/api/public/wo/:token/sign', async ({ env, params, request }) => {
  const o = await first(env, 'SELECT * FROM work_orders WHERE token = ?', params.token);
  if (!o) throw new HttpError('This work order link is not valid.', 404);
  if (o.status !== 'sent') return json({ order: publicOrder(o) });
  const b = await request.json().catch(() => ({}));
  const name = String(b.name || '').trim().slice(0, 120);
  if (name.length < 3) throw new HttpError('Type your full name to sign.');
  if (b.agree !== true) throw new HttpError('Check the box to agree to the terms.');
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';
  const ua = (request.headers.get('user-agent') || '').slice(0, 300);
  await run(env, "UPDATE work_orders SET status = 'signed', signed_name = ?, signed_at = ?, signed_ip = ?, signed_ua = ? WHERE id = ?", name, now(), ip, ua, o.id);
  if (o.lead_id) {
    await logActivity(env, { lead_id: o.lead_id, type: 'work_order', body: `Work order signed by ${name}` });
    await run(env, "UPDATE leads SET stage = CASE WHEN stage IN ('won') THEN stage ELSE 'follow_up' END, next_action = 'Waiting on payment', next_action_at = ?, updated_at = ? WHERE id = ?", now() + 864e5, now(), o.lead_id);
  }
  return json({ order: publicOrder(await first(env, 'SELECT * FROM work_orders WHERE id = ?', o.id)) });
}, { public: true });
