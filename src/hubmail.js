// Email from the Hub without a Google account: write it in the Hub, it goes out through Resend under the person's name, and
// replies land in their own inbox (Reply-To is their email). Every send is logged here and on the lead's or client's timeline.
// Reading a Gmail inbox inside the Hub needs Google's API, so that part is not here: replies are read in Gmail as usual.
import { HttpError, json } from './util.js';
import { all, first, run, newId, now } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { canEmail, sendEmail } from './email.js';
import { logActivity } from './crm.js';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function fromFor(env, user) {
  const raw = env.EMAIL_FROM || 'Rightway Growth <hello@rightwaygrowth.com>';
  const m = raw.match(/<([^>]+)>/);
  const addr = m ? m[1] : raw.trim();
  const name = String(user.name || '').replace(/[<>",]/g, '').trim();
  return `${name ? `${name} (Rightway Growth)` : 'Rightway Growth'} <${addr}>`;
}
// Plain text in, simple styled HTML out: paragraphs on blank lines, links made clickable.
export function bodyHtml(text) {
  const link = (s) => esc(s).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1">$1</a>');
  const paras = String(text || '').replace(/\r/g, '').trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${link(p).replace(/\n/g, '<br>')}</p>`).join('');
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#0F1B17">${paras}</div>`;
}

route('POST', '/api/mail/send', async ({ env, user, body }) => {
  requireStaff(user);
  if (user.viewAs) throw new HttpError('Client view is read only.', 403);
  const b = await body();
  const to = [...new Set(String(b.to || '').toLowerCase().split(/[\s,;]+/).filter(Boolean))];
  if (!to.length) throw new HttpError('Add who this is going to.');
  if (to.length > 10) throw new HttpError('Send to 10 people or fewer at a time.');
  const bad = to.find((e) => !EMAIL.test(e));
  if (bad) throw new HttpError(`"${bad}" does not look like an email address.`);
  const subject = String(b.subject || '').trim().slice(0, 200);
  const text = String(b.body || '').trim();
  if (!subject) throw new HttpError('Add a subject.');
  if (!text) throw new HttpError('Write a message first.');
  if (text.length > 20000) throw new HttpError('That message is too long.');
  if (!canEmail(env)) throw new HttpError('Sending from the Hub needs email set up (RESEND_API_KEY in Cloudflare). You can still open it in Gmail.', 503);
  const sent = [], failed = [];
  for (const addr of to) {
    const lead = b.lead_id ? await first(env, 'SELECT id FROM leads WHERE id = ?', b.lead_id) : await first(env, 'SELECT id FROM leads WHERE lower(email) = ? ORDER BY updated_at DESC LIMIT 1', addr);
    const client = b.client_id ? await first(env, 'SELECT id FROM clients WHERE id = ?', b.client_id) : await first(env, 'SELECT id FROM clients WHERE lower(contact_email) = ? LIMIT 1', addr);
    let error = null;
    try { await sendEmail(env, { to: addr, subject, text, html: bodyHtml(text), replyTo: user.email, from: fromFor(env, user) }); } catch (e) { error = e.message; }
    await run(env, 'INSERT INTO mail_log (id, user_id, to_email, subject, body, lead_id, client_id, status, error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId('m_'), user.id, addr, subject, text, lead?.id || null, client?.id || null, error ? 'failed' : 'sent', error, now());
    if (error) { failed.push({ to: addr, error }); continue; }
    sent.push(addr);
    const line = `Email sent: ${subject}`;
    if (lead) await logActivity(env, { lead_id: lead.id, type: 'email', body: line, by: user.id });
    if (client) await logActivity(env, { client_id: client.id, type: 'email', body: line, by: user.id });
  }
  if (!sent.length) throw new HttpError(failed[0].error, 502);
  return json({ sent, failed });
});

route('GET', '/api/mail/sent', async ({ env, user, url }) => {
  requireStaff(user);
  const email = (url.searchParams.get('email') || '').trim().toLowerCase();
  const rows = email
    ? await all(env, `SELECT m.*, u.name AS by_name FROM mail_log m LEFT JOIN users u ON u.id = m.user_id WHERE m.to_email = ? ${user.role === 'admin' ? '' : 'AND m.user_id = ?'} ORDER BY m.at DESC LIMIT 20`, email, ...(user.role === 'admin' ? [] : [user.id]))
    : await all(env, 'SELECT m.*, u.name AS by_name FROM mail_log m LEFT JOIN users u ON u.id = m.user_id WHERE m.user_id = ? ORDER BY m.at DESC LIMIT 100', user.id);
  return json({ mail: rows.map((m) => ({ id: m.id, to: m.to_email, subject: m.subject, body: m.body, status: m.status, error: m.error, at: m.at, by: (m.by_name || '').split(' ')[0] })) });
});

// Address suggestions while typing: leads, clients and teammates.
route('GET', '/api/mail/people', async ({ env, user, url }) => {
  requireStaff(user);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase().replace(/[%_]/g, '');
  if (q.length < 2) return json({ people: [] });
  const like = `%${q}%`;
  const [leads, clients, team] = await Promise.all([
    all(env, "SELECT business, contact_name, email FROM leads WHERE email IS NOT NULL AND email != '' AND (lower(business) LIKE ? OR lower(contact_name) LIKE ? OR lower(email) LIKE ?) ORDER BY updated_at DESC LIMIT 6", like, like, like),
    all(env, "SELECT name, contact_name, contact_email AS email FROM clients WHERE contact_email IS NOT NULL AND contact_email != '' AND (lower(name) LIKE ? OR lower(contact_name) LIKE ? OR lower(contact_email) LIKE ?) LIMIT 6", like, like, like),
    all(env, "SELECT name, email FROM users WHERE role IN ('admin','team') AND (lower(name) LIKE ? OR lower(email) LIKE ?) LIMIT 4", like, like),
  ]);
  const seen = new Set();
  const people = [
    ...team.map((u) => ({ email: u.email, label: `${u.name || u.email} (team)` })),
    ...clients.map((c) => ({ email: c.email, label: `${c.contact_name || c.name}, ${c.name}` })),
    ...leads.map((l) => ({ email: l.email, label: `${l.contact_name || l.business}, ${l.business}` })),
  ].filter((p) => p.email && !seen.has(p.email.toLowerCase()) && seen.add(p.email.toLowerCase())).slice(0, 10);
  return json({ people });
});
