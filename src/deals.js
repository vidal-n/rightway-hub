// Deal desk (Nov 2026, V: one place to find a client, type the price and fields, and send the work order and payment link, also from My notes
// during a presentation). Modeled on the quote and send flow in PandaDoc and Stripe Payment Links: one screen, a few fields, one send.
// It adds NO new pricing rules. The work order and payment link routes in src/workorders.js and src/billing.js decide the amounts (typed, never defaulted);
// this file finds the lead, shows what is already saved and sent, quick creates a lead, and delivers a work order by email.
import { HttpError, json } from './util.js';
import { first, all, run, now } from './db.js';
import { requireStaff } from './auth.js';
import { insertLead, logActivity } from './crm.js';
import { canEmail, sendEmail } from './email.js';
import { sendGmail } from './gmail.js';
import { route } from './router.js';

const parse = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };
const money = (c) => `$${((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digits = (s) => String(s || '').replace(/\D/g, '');

export const leadCard = (l) => ({ id: l.id, business: l.business, contact_name: l.contact_name || '', owner_name: l.owner_name || '', phone: l.phone || '', email: l.email || '', city: l.city || '', state: l.state || '', website: l.website || '', stage: l.stage });

// Find a lead by business, person, phone digits or email. Light columns only, 12 rows.
route('GET', '/api/deals/search', async ({ env, user, url }) => {
  requireStaff(user);
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 80);
  if (q.length < 2) return json({ leads: [] });
  const like = `%${q.toLowerCase()}%`;
  const d = digits(q);
  const rows = await all(env, `SELECT id, business, contact_name, owner_name, phone, email, city, state, website, stage FROM leads
    WHERE lower(business) LIKE ? OR lower(COALESCE(contact_name,'')) LIKE ? OR lower(COALESCE(owner_name,'')) LIKE ? OR lower(COALESCE(email,'')) LIKE ?
      ${d.length >= 4 ? 'OR replace(replace(replace(replace(COALESCE(phone,\'\'), \'-\', \'\'), \' \', \'\'), \'(\', \'\'), \')\', \'\') LIKE ?' : ''}
    ORDER BY updated_at DESC LIMIT 12`, ...[like, like, like, like, ...(d.length >= 4 ? [`%${d}%`] : [])]);
  return json({ leads: rows.map(leadCard) });
});

// Everything the desk shows for one lead: contact, the saved quote, every work order with its link and status.
route('GET', '/api/leads/:id/deal', async ({ env, user, params, url }) => {
  requireStaff(user);
  const l = await first(env, 'SELECT * FROM leads WHERE id = ?', params.id);
  if (!l) throw new HttpError('Lead not found.', 404);
  const orders = await all(env, 'SELECT id, token, kind, setup_cents, monthly_cents, status, signed_name, signed_at, paid_at, created_at, emailed, pay_url FROM work_orders WHERE lead_id = ? ORDER BY created_at DESC LIMIT 10', l.id);
  return json({
    lead: leadCard(l),
    quote: parse(l.quote),
    orders: orders.map((o) => ({ ...o, url: `${url.origin}/sign.html#${o.token}`, token: undefined })),
  });
});

// Quick lead for someone who is not in the Hub yet (a referral, a walk in, a name from the call).
route('POST', '/api/deals/lead', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const business = String(b.business || '').trim().slice(0, 160);
  if (business.length < 2) throw new HttpError('Type the business name.');
  const email = String(b.email || '').trim().toLowerCase().slice(0, 160);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError('That email does not look right.');
  const phone = digits(b.phone).slice(-10);
  if (b.phone && phone.length < 10) throw new HttpError('Type a 10 digit phone number.');
  const dup = phone ? await first(env, "SELECT id FROM leads WHERE replace(replace(replace(replace(COALESCE(phone,''), '-', ''), ' ', ''), '(', ''), ')', '') LIKE ? LIMIT 1", `%${phone}`) : null;
  if (dup) return json({ id: dup.id, existing: true });
  const id = await insertLead(env, { business, contact_name: String(b.contact_name || '').trim().slice(0, 120), email, phone, city: String(b.city || '').slice(0, 80), state: String(b.state || '').slice(0, 40), website: String(b.website || '').slice(0, 200), source: 'deal desk', stage: 'follow_up' }, user.id);
  await logActivity(env, { lead_id: id, type: 'note', body: 'Added from the deal desk', by: user.id });
  return json({ id, existing: false });
});

// Send an existing work order to the client: email with the signing link (and the payment link after they sign).
route('POST', '/api/work-orders/:id/send', async ({ env, user, params, url, body }) => {
  requireStaff(user);
  const o = await first(env, 'SELECT * FROM work_orders WHERE id = ?', params.id);
  if (!o) throw new HttpError('Work order not found.', 404);
  if (o.status === 'paid') throw new HttpError('That work order is already paid.');
  const b = await body();
  const to = String(b.to || o.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new HttpError('Type the email to send it to.');
  const link = `${url.origin}/sign.html#${o.token}`;
  const first_ = String(o.contact_name || '').trim().split(/\s+/)[0] || 'there';
  const due = o.kind === 'website' ? `${money(o.setup_cents)} build fee due at signing` : `${money((o.setup_cents || 0) + (o.monthly_cents || 0))} due at signing, then ${money(o.monthly_cents)} a month`;
  const note = String(b.message || '').trim().slice(0, 800);
  const subject = `Your work order from Rightway Growth: ${o.business}`;
  const text = `Hi ${first_},\n\n${note ? `${note}\n\n` : ''}Here is your work order. Read it, sign it, and the payment step follows.\n${link}\n\nSummary: ${due}.\n\nQuestions? Reply to this email.\n\n${user.name || 'Rightway Growth'}\nRightway Growth`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0F1B17;line-height:1.5"><p>Hi ${esc(first_)},</p>${note ? `<p>${esc(note).replace(/\n/g, '<br>')}</p>` : ''}<p>Here is your work order. Read it, sign it, and the payment step follows.</p><p><a href="${esc(link)}" style="display:inline-block;background:#0A6B4C;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Review and sign</a></p><p style="color:#52605a">Summary: ${esc(due)}.</p><p>Questions? Reply to this email.</p><p>${esc(user.name || 'Rightway Growth')}<br>Rightway Growth</p></div>`;
  let how = null;
  if (canEmail(env)) {
    await sendEmail(env, { to, subject, text, html, replyTo: user.email || undefined, from: user.name ? `${user.name} (Rightway Growth) <${(env.EMAIL_FROM || '').match(/<(.+)>/)?.[1] || 'hello@rightwaygrowth.com'}>` : undefined });
    how = 'email';
  } else {
    const u = await first(env, 'SELECT * FROM users WHERE id = ?', user.id);
    if (await sendGmail(env, u, { to, subject, html, text }).catch(() => false)) how = 'gmail';
  }
  if (!how) throw new HttpError('Email is not set up. Copy the link and text it instead.', 409);
  if (!o.email) await run(env, 'UPDATE work_orders SET email = ? WHERE id = ?', to, o.id);
  if (o.lead_id) await logActivity(env, { lead_id: o.lead_id, type: 'email', body: `Work order emailed to ${to}`, by: user.id });
  return json({ ok: true, via: how, to, link });
});
