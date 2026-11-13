// Work orders: one service agreement for every plan (public/js/agreement.js), only the setup and monthly amounts change.
// Signed online (typed name + agreement, with time, IP, and device recorded), then paid by Stripe link.
// The wording is saved with each order, so later edits never change an agreement someone already got.
import { HttpError, json } from './util.js';
import { first, run, newId, token, now } from './db.js';
import { requireStaff } from './auth.js';
import { PLANS } from './plans.js';
import { SERVICE_LIST } from '../public/js/plancopy.js';
import { clampQty, dollars, hasQty, tierOf, cleanScope } from '../public/js/scope.js';
import { quoteFor, scopeOfQuote } from '../public/js/leadintel.js';
import { agreementSnapshot, okFont, initialsOf, agreementEmailHtml, agreementEmailText, TITLES } from '../public/js/agreement.js';
import { all as allRows } from './db.js';
import { canEmail, sendEmail } from './email.js';
import { sendGmail } from './gmail.js';
import { quoteLink } from './billing.js';
import { logActivity } from './crm.js';
import { route } from './router.js';

// The deal's quote: the services picked with how much of each a month, the buildout and monthly in dollars (typed by the owner, never
// defaulted), and two optional talking numbers for the price conversation (the top number said first, the lower number if they push back).
const SERVICE_IDS = new Set(SERVICE_LIST.map((x) => x.id));
function cleanQuote(b = {}, prev = {}) {
  const num = (v, d) => (v === undefined ? d : v === '' || v === null ? null : dollars(v));
  const pair = (v, d) => {
    if (v === undefined) return d ?? null;
    if (!v) return null;
    const p = { setup: dollars(v.setup), monthly: dollars(v.monthly) };
    return p.setup == null && p.monthly == null ? null : p;
  };
  let services = prev.services || [], qty = prev.qty || {};
  if (Array.isArray(b.services)) {
    services = [...new Set(b.services.map((x) => (typeof x === 'string' ? x : x?.id)).filter((id) => SERVICE_IDS.has(id)))].slice(0, 20);
    qty = {};
    for (const x of b.services) if (x && typeof x === 'object' && SERVICE_IDS.has(x.id) && hasQty(x.id) && x.qty != null && x.qty !== '') qty[x.id] = clampQty(x.id, x.qty);
    if (b.qty && typeof b.qty === 'object') for (const id of services) if (hasQty(id) && b.qty[id] != null && b.qty[id] !== '') qty[id] = clampQty(id, b.qty[id]);
  }
  const q = {
    plan: services.length ? tierOf(services) : null, // internal workload tier, never shown
    setup: num(b.setup, prev.setup ?? null),
    monthly: num(b.monthly, prev.monthly ?? null),
    anchor: pair(b.anchor, prev.anchor),
    drop: pair(b.drop, prev.drop),
    services, qty,
    at: now(),
  };
  for (const k of ['setup', 'monthly']) if (q[k] != null && (!Number.isFinite(q[k]) || q[k] < 0 || q[k] > 100000)) throw new HttpError('Enter the buildout and monthly as dollar amounts.');
  if (b.setup !== undefined && b.setup !== '' && b.setup !== null && dollars(b.setup) == null) throw new HttpError('Enter the buildout and monthly as dollar amounts.');
  if (b.monthly !== undefined && b.monthly !== '' && b.monthly !== null && dollars(b.monthly) == null) throw new HttpError('Enter the buildout and monthly as dollar amounts.');
  return q;
}
export { cleanQuote };
const parseQ = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };

route('PUT', '/api/leads/:id/quote', async ({ env, user, params, body }) => {
  requireStaff(user);
  const lead = await first(env, 'SELECT id, quote, plan FROM leads WHERE id = ?', params.id);
  if (!lead) throw new HttpError('Lead not found.', 404);
  const q = cleanQuote(await body(), parseQ(lead.quote));
  await run(env, 'UPDATE leads SET quote = ?, updated_at = ? WHERE id = ?', JSON.stringify(q), now(), lead.id);
  return json({ quote: q });
});

route('POST', '/api/leads/:id/work-order', async ({ env, user, params, url, body }) => {
  requireStaff(user);
  const lead = await first(env, 'SELECT * FROM leads WHERE id = ?', params.id);
  if (!lead) throw new HttpError('Lead not found.', 404);
  const b = await body();
  const kind = b.kind === 'website' ? 'website' : 'seo';
  const saved = parseQ(lead.quote);
  const cents = (v) => (v === undefined || v === null || v === '' ? null : Math.round(Number(String(v).replace(/[$,\s]/g, '')) * 100));
  let plan, setup, monthly, scope = [];
  if (kind === 'website') {
    setup = cents(b.setup);
    monthly = cents(b.monthly) || 0;
    if (!setup || setup < 0) throw new HttpError('Enter the website build fee.');
    scope = String(b.scope || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 12).map((x) => x.slice(0, 160));
    if (!scope.length) throw new HttpError('List what the website includes, one item per line.');
    plan = 'website';
  } else {
    // Every client is priced by the owner: the amounts are typed, never filled in from a package.
    const pick = (typed, stored) => (typed !== undefined && typed !== null && typed !== '' ? typed : stored);
    setup = cents(pick(b.setup, saved.setup));
    monthly = cents(pick(b.monthly, saved.monthly));
    if (setup == null || monthly == null || !Number.isFinite(setup) || !Number.isFinite(monthly) || setup < 0 || monthly <= 0) throw new HttpError('Type the buildout and the monthly first. You set the price for every client.');
    // Save the scope with the quote so the client gets exactly this work when they sign and pay.
    let intel = null;
    try { intel = lead.intel ? JSON.parse(lead.intel) : null; } catch { intel = null; }
    const Q = quoteFor(lead, intel, saved);
    const q = cleanQuote({ setup: setup / 100, monthly: monthly / 100, services: scopeOfQuote(Q) }, saved);
    plan = q.plan || tierOf(cleanScope(scopeOfQuote(Q)));
    await run(env, 'UPDATE leads SET quote = ?, updated_at = ? WHERE id = ?', JSON.stringify(q), now(), lead.id);
  }
  const payUrl = await quoteLink(env, { plan: kind === 'website' ? null : plan, setupCents: setup, monthlyCents: monthly, kind, leadId: lead.id, email: lead.email }).catch(() => null);
  const terms = JSON.stringify(agreementSnapshot({ kind, setupCents: setup, monthlyCents: monthly, scope }));
  const id = newId('wo_');
  const t = token(18);
  await run(env, `INSERT INTO work_orders (id, token, lead_id, plan, kind, monthly_cents, setup_cents, business, contact_name, email, terms, pay_url, status, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)`,
  id, t, lead.id, plan, kind, monthly, setup, lead.business, lead.contact_name, lead.email, terms, payUrl, now(), user.id);
  await logActivity(env, { lead_id: lead.id, type: 'work_order', body: kind === 'website' ? `Website work order sent ($${setup / 100} build${monthly ? `, $${monthly / 100} a month` : ''})` : `Work order sent ($${setup / 100} buildout, $${monthly / 100} a month)`, by: user.id });
  return json({ url: `${url.origin}/sign.html#${t}`, hasPayLink: Boolean(payUrl) });
});

function publicOrder(o) {
  const t = JSON.parse(o.terms || '{}');
  return {
    business: o.business, contact_name: o.contact_name, monthly_cents: o.monthly_cents, setup_cents: o.setup_cents,
    includes: t.includes || [], terms: t.terms || [], sections: t.sections || null, kind: t.kind || 'seo', title: t.title || null, status: o.status,
    doc_id: o.id, emailed: o.emailed || null, signed_font: o.signed_font || null, initials: o.initials || null, initials_font: o.initials_font || null, signed_name: o.signed_name, signed_at: o.signed_at, created_at: o.created_at,
    pay_url: o.status !== 'paid' ? o.pay_url : null,
  };
}

route('GET', '/api/public/wo/:token', async ({ env, params }) => {
  const o = await first(env, 'SELECT * FROM work_orders WHERE token = ?', params.token);
  if (!o) throw new HttpError('This work order link is not valid.', 404);
  return json({ order: publicOrder(o) });
}, { public: true });

route('POST', '/api/public/wo/:token/sign', async ({ env, params, request, url, defer }) => {
  const o = await first(env, 'SELECT * FROM work_orders WHERE token = ?', params.token);
  if (!o) throw new HttpError('This work order link is not valid.', 404);
  if (o.status !== 'sent') return json({ order: publicOrder(o) });
  const b = await request.json().catch(() => ({}));
  const name = String(b.name || o.contact_name || '').trim().slice(0, 120);
  if (name.length < 3) throw new HttpError('Type your full name to sign.');
  if (b.agree !== true) throw new HttpError('Check the box to agree to the terms.');
  const t = JSON.parse(o.terms || '{}');
  const font = t.sections ? okFont(b.font) : null;
  const initialsFont = t.sections ? okFont(b.initialsFont || b.font) : null;
  const initials = t.sections ? (String(b.initials || '').replace(/[^A-Za-z.]/g, '').slice(0, 4).toUpperCase() || initialsOf(name)) : null;
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';
  const ua = (request.headers.get('user-agent') || '').slice(0, 300);
  await run(env, "UPDATE work_orders SET status = 'signed', signed_name = ?, signed_at = ?, signed_ip = ?, signed_ua = ?, signed_font = ?, initials = ?, initials_font = ? WHERE id = ?", name, now(), ip, ua, font, initials, initialsFont, o.id);
  if (o.lead_id) {
    await logActivity(env, { lead_id: o.lead_id, type: 'work_order', body: `Work order signed by ${name}` });
    await import('./workflows.js').then((m) => m.fire(env, 'work_order_signed', { leadId: o.lead_id })).catch(() => {});
    await run(env, "UPDATE leads SET stage = CASE WHEN stage IN ('won') THEN stage ELSE 'follow_up' END, next_action = 'Waiting on payment', next_action_at = ?, updated_at = ? WHERE id = ?", now() + 864e5, now(), o.lead_id);
  }
  const signedRow = await first(env, 'SELECT * FROM work_orders WHERE id = ?', o.id);
  // The signed copy goes to the client and to Rightway by email, like a receipt they can print.
  const job = emailSignedCopy(env, signedRow, `${url.origin}/sign.html#${o.token}`).catch((e) => console.error('signed copy email', e.message));
  if (defer) defer(job); else await job;
  const canSend = canEmail(env) || Boolean(await first(env, "SELECT id FROM users WHERE (role = 'admin' OR id = ?) AND google_scopes LIKE '%gmail%' LIMIT 1", signedRow.created_by || ''));
  return json({ order: publicOrder({ ...signedRow, emailed: canSend && signedRow.email ? signedRow.email : null }) });
}, { public: true });

export async function emailSignedCopy(env, o, link) {
  const t = JSON.parse(o.terms || '{}');
  if (!t.sections) return null;
  const sig = { name: o.signed_name, at: o.signed_at, initials: o.initials, id: o.id };
  const title = t.title || TITLES[t.kind] || TITLES.seo;
  const money = (c) => `$${((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  const due = t.kind === 'website' ? `Build fee due today: ${money(o.setup_cents)}.` : `Due today: ${money((o.setup_cents || 0) + (o.monthly_cents || 0))}, then ${money(o.monthly_cents)} a month.`;
  const args = { sections: t.sections, title, business: o.business, sig, link, due };
  const html = agreementEmailHtml(args);
  const text = agreementEmailText(args);
  const team = await allRows(env, "SELECT * FROM users WHERE role = 'admin' OR id = ?", o.created_by || '');
  const to = [...new Set([o.email, ...team.map((u) => u.email)].filter((e) => e && e.includes('@')).map((e) => e.toLowerCase()))];
  if (!to.length) return null;
  const subject = `Signed: ${title} for ${o.business}`;
  let sent = false;
  if (canEmail(env)) {
    for (const addr of to) await sendEmail(env, { to: addr, subject, html, text });
    sent = true;
  } else {
    // No Resend key: send from the rep's (or an owner's) own Gmail when it is connected to the Hub.
    const order = [team.find((u) => u.id === o.created_by), ...team.filter((u) => u.id !== o.created_by)].filter(Boolean);
    for (const u of order) { if (await sendGmail(env, u, { to, subject, html, text }).catch(() => false)) { sent = true; break; } }
  }
  if (sent) await run(env, 'UPDATE work_orders SET emailed = ? WHERE id = ?', to.join(', '), o.id);
  return sent ? to : null;
}

