// Competitor analysis pack: built from a lead's research, saved as a snapshot with a private link /analysis.html#<token>.
// The report page shows only the pack (no prices, scores, notes or rep info). Sending it is free: it reads data already saved on the lead.
import { HttpError, json } from './util.js';
import { first, run, token, now } from './db.js';
import { requireStaff } from './auth.js';
import { can } from '../public/js/jobs.js';
import { route } from './router.js';
import { buildPack, sendLine } from '../public/js/pack.js';
import { canEmail, sendEmail } from './email.js';
import { logActivity } from './crm.js';
import { fromFor } from './hubmail.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const leadOr404 = async (env, id) => { const l = await first(env, 'SELECT * FROM leads WHERE id = ?', id); if (!l) throw new HttpError('Lead not found.', 404); return l; };
const liveOf = (l) => buildPack(l, { intel: l.intel, listings: l.listings, deepScan: l.deep_scan });
const originOf = (url, env) => (env.HUB_ORIGIN || url.origin).replace(/\/$/, '');

// Live pack for the rep and Present mode, plus whether a saved link exists.
route('GET', '/api/leads/:id/pack', async ({ env, user, params, url }) => {
  requireStaff(user);
  const l = await leadOr404(env, params.id);
  return json({ pack: liveOf(l), saved: l.pack_token ? { at: l.pack_at, views: l.pack_views || 0, link: `${originOf(url, env)}/analysis.html#${l.pack_token}` } : null });
});

// Save the current research as the report the prospect sees (makes the link the first time, keeps it after).
route('POST', '/api/leads/:id/pack', async ({ env, user, params, url }) => {
  requireStaff(user);
  const l = await leadOr404(env, params.id);
  const pack = liveOf(l);
  if (!pack.ready) throw new HttpError(pack.reason, 400);
  const t = l.pack_token || token(24);
  await run(env, 'UPDATE leads SET pack_token = ?, pack = ?, pack_at = ?, updated_at = ? WHERE id = ?', t, JSON.stringify(pack), now(), now(), l.id);
  return json({ ok: true, at: pack.at, link: `${originOf(url, env)}/analysis.html#${t}` });
});

function emailHtml(p, link, note, rep) {
  const top = p.competitors[0];
  return `<div style="font-family:Arial,sans-serif;max-width:560px;color:#0F1B17;line-height:1.5">
<h2 style="margin:0 0 8px">Your free competitor analysis</h2>
<p>${esc(note || sendLine(p))}</p>
${top ? `<p><b>${esc(top.name)}</b> is the business taking the most calls in your area. The report shows exactly why, side by side with ${esc(p.business)}.</p>` : ''}
<p><a href="${esc(link)}" style="background:#0A6B4C;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;display:inline-block">Open your analysis</a></p>
<p style="color:#55645E;font-size:13px">You keep this analysis either way.${rep ? `<br>${esc(rep)}, Rightway Growth` : ''}</p></div>`;
}

route('POST', '/api/leads/:id/pack/send', async ({ env, user, params, body, url }) => {
  requireStaff(user);
  const l = await leadOr404(env, params.id);
  const b = await body();
  const pack = liveOf(l);
  if (!pack.ready) throw new HttpError(pack.reason, 400);
  const to = String(b.to || l.email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new HttpError('Add an email address for this lead first.');
  if (!canEmail(env)) throw new HttpError('Email is not set up yet. Copy the link and text or email it yourself.');
  const t = l.pack_token || token(24);
  await run(env, 'UPDATE leads SET pack_token = ?, pack = ?, pack_at = ?, updated_at = ? WHERE id = ?', t, JSON.stringify(pack), now(), now(), l.id);
  const link = `${originOf(url, env)}/analysis.html#${t}`;
  const note = String(b.note || '').slice(0, 600);
  await sendEmail(env, { to, subject: `Your free competitor analysis: ${pack.business}`, html: emailHtml(pack, link, note, user.name), text: `${note || sendLine(pack)}\n\nOpen your analysis: ${link}\n\nYou keep this analysis either way.`, replyTo: user.email, from: fromFor(env, user) });
  await logActivity(env, { lead_id: l.id, type: 'email', body: `Sent the competitor analysis to ${to}`, by: user.id });
  return json({ ok: true, link });
});

// The prospect's page. Anyone with the link can read it (like a shared doc). Counts views.
route('GET', '/api/public/analysis/:token', async ({ env, params }) => {
  const l = await first(env, 'SELECT id, pack, pack_views FROM leads WHERE pack_token = ?', params.token);
  if (!l || !l.pack) throw new HttpError('This link is not valid.', 404);
  await run(env, 'UPDATE leads SET pack_views = COALESCE(pack_views, 0) + 1 WHERE id = ?', l.id);
  return json({ pack: JSON.parse(l.pack) });
}, { public: true });

// Present mode for an existing client (branding calls): the original audit from the lead they came from, and their latest report.
route('GET', '/api/present/client/:id', async ({ env, user, params, url }) => {
  requireStaff(user);
  if (!can(user, 'close')) throw new HttpError('Presenting is for closers and owners.', 403);
  const c = await first(env, 'SELECT id, name FROM clients WHERE id = ?', params.id);
  if (!c) throw new HttpError('Client not found.', 404);
  const l = await first(env, 'SELECT id FROM leads WHERE client_id = ? ORDER BY created_at DESC LIMIT 1', c.id);
  const r = await first(env, 'SELECT token FROM reports WHERE client_id = ? ORDER BY month DESC LIMIT 1', c.id);
  return json({ name: c.name, lead_id: l?.id || null, report_link: r ? `${originOf(url, env)}/report.html#${r.token}` : null });
});
