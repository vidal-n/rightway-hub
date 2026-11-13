// "Wants info first" email from the dialer result window. GET fills the form (their email, subject, opening paragraph, booking link),
// POST sends the branded email, saves a corrected address on the lead and logs it on the timeline. Modeled on the requested-info
// follow-up emails of Apollo.io and Outreach sequences, with a Calendly style booking button. Copy and layout: public/js/infomail.js.
import { HttpError, json } from './util.js';
import { first, run, newId, now, getSettings } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { canEmail, sendEmail } from './email.js';
import { logActivity } from './crm.js';
import { emailBlocked } from './suppress.js';
import { fromFor } from './hubmail.js';
import { sendGmail } from './gmail.js';
import { bookToken } from './automations.js';
import { hasScope, APP_SCOPES } from './google.js';
import { whoIs, personOf } from '../public/js/leadintel.js';
import { validZone } from '../public/js/apptime.js';
import { infoEmail, infoFacts, defaultIntro, defaultSubject, EMAIL_RE } from '../public/js/infomail.js';

async function context(env, user, lead) {
  const s = await getSettings(env);
  const origin = String(s.hub_origin || s.autoscan_origin || '').replace(/\/$/, '');
  const bt = await bookToken(env, lead);
  const me = await first(env, 'SELECT * FROM users WHERE id = ?', user.id);
  const gmail = Boolean(me?.google_token && hasScope(me.google_scopes, APP_SCOPES.mail));
  const via = gmail ? 'gmail' : canEmail(env) ? 'resend' : null;
  let intel = null;
  try { intel = lead.intel ? JSON.parse(lead.intel) : null; } catch { intel = null; }
  const w = whoIs(lead);
  const first_ = w.known ? String(w.name).split(' ')[0] : '';
  const repFirst = String(user.name || '').split(' ')[0] || '';
  return {
    me, via, intel, first: first_, repFirst,
    bookUrl: origin && bt ? `${origin}/book.html?l=${bt}` : '',
    logoUrl: origin ? `${origin}/brand/rightway-logo-email.png` : '',
    tz: validZone(lead.timezone) || 'America/New_York',
  };
}

route('GET', '/api/leads/:id/info-email', async ({ env, user, params }) => {
  requireStaff(user);
  const lead = await first(env, 'SELECT * FROM leads WHERE id = ?', params.id);
  if (!lead) throw new HttpError('Lead not found.', 404);
  const c = await context(env, user, lead);
  const facts = infoFacts(lead, c.intel);
  return json({
    to: lead.email || '', first: c.first, business: lead.business || '', industry: lead.industry || '', rep: user.name || '', repFirst: c.repFirst,
    subject: defaultSubject(lead, c.first), intro: defaultIntro(lead, { first: c.first, repFirst: c.repFirst, facts }),
    bookUrl: c.bookUrl, logoUrl: c.logoUrl, tz: c.tz, via: c.via, dnc: Boolean(lead.dnc), person: personOf(lead) || '',
  });
});

route('POST', '/api/leads/:id/info-email', async ({ env, user, params, body }) => {
  requireStaff(user);
  if (user.viewAs) throw new HttpError('Client view is read only.', 403);
  const lead = await first(env, 'SELECT * FROM leads WHERE id = ?', params.id);
  if (!lead) throw new HttpError('Lead not found.', 404);
  if (lead.dnc || await emailBlocked(env, lead)) throw new HttpError('This lead is on the do not call list. No email.', 400);
  const b = await body();
  const to = String(b.to || '').trim().toLowerCase();
  if (!to) throw new HttpError('Add their email address first.');
  if (!EMAIL_RE.test(to)) throw new HttpError(`"${to}" does not look like an email address.`);
  const c = await context(env, user, lead);
  if (!c.via) throw new HttpError('Sending needs email set up: connect your Gmail on the Google page, or add RESEND_API_KEY in Cloudflare.', 503);
  const cbMs = b.callbackAt ? Number(new Date(b.callbackAt)) || 0 : 0;
  const mail = infoEmail({
    first: c.first, business: lead.business, industry: lead.industry, rep: user.name, repFirst: c.repFirst,
    subject: String(b.subject || '').slice(0, 200), intro: String(b.intro || '').slice(0, 3000),
    bookUrl: c.bookUrl, logoUrl: c.logoUrl, callbackAt: cbMs, tz: c.tz,
  });
  let error = null;
  try {
    if (c.via === 'gmail') await sendGmail(env, c.me, { to, subject: mail.subject, html: mail.html, text: mail.text });
    else await sendEmail(env, { to, subject: mail.subject, text: mail.text, html: mail.html, replyTo: user.email, from: fromFor(env, user) });
  } catch (e) { error = e.message; }
  await run(env, 'INSERT INTO mail_log (id, user_id, to_email, subject, body, lead_id, client_id, status, error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId('m_'), user.id, to, mail.subject, mail.text, lead.id, null, error ? 'failed' : 'sent', error, now());
  if (error) throw new HttpError(`The email did not send: ${error}`, 502);
  // A corrected address stays on the lead, so the next email and the call card use it.
  if (to !== String(lead.email || '').toLowerCase()) await run(env, 'UPDATE leads SET email = ?, email_status = NULL, updated_at = ? WHERE id = ?', to, now(), lead.id);
  await logActivity(env, { lead_id: lead.id, type: 'email', body: `Info email sent to ${to}: ${mail.subject}${cbMs ? ' (callback time offered)' : ''}`, by: user.id });
  return json({ ok: true, to, via: c.via, subject: mail.subject });
});

// The same builder the browser previews with, so what they see is what goes out.
route('POST', '/api/leads/:id/info-email/preview', async ({ env, user, params, body }) => {
  requireStaff(user);
  const lead = await first(env, 'SELECT * FROM leads WHERE id = ?', params.id);
  if (!lead) throw new HttpError('Lead not found.', 404);
  const b = await body();
  const c = await context(env, user, lead);
  const cbMs = b.callbackAt ? Number(new Date(b.callbackAt)) || 0 : 0;
  return json(infoEmail({ first: c.first, business: lead.business, industry: lead.industry, rep: user.name, repFirst: c.repFirst, subject: String(b.subject || ''), intro: String(b.intro || ''), bookUrl: c.bookUrl, logoUrl: c.logoUrl, callbackAt: cbMs, tz: c.tz }));
});
