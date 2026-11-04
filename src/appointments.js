// The appointment calendar every logged in teammate can see (view only), booked audits landing on the booker's own Google Calendar,
// and Google Meet started from a lead in one click (Meet cannot run inside another site, so it opens in its own window beside the Hub).
import { HttpError, json } from './util.js';
import { all, first, run, now } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { createMeeting, googleReady, bookingOwner, bookingConfig } from './google.js';

// After a Booked result with a time: put it on the booker's Google Calendar with a Meet link (if they connected Google).
export async function bookOnCalendar(env, userId, leadId) {
  if (!googleReady(env)) return null;
  const lead = await first(env, 'SELECT * FROM leads WHERE id = ?', leadId);
  if (!lead?.meet_at || lead.stage !== 'audit_booked' || lead.gcal_event_id || lead.meet_at < now()) return null;
  const me = await first(env, 'SELECT * FROM users WHERE id = ?', userId);
  const owner = me?.google_token ? me : await bookingOwner(env, await bookingConfig(env));
  if (!owner) return null;
  const m = await createMeeting(env, owner, {
    summary: `RightWay Growth: Google clarity audit with ${lead.business}`,
    description: `Free Google clarity audit (15 minutes, screen share).\nLead in the Hub: open Present before the call.`,
    start: lead.meet_at, minutes: 30, attendees: [lead.email], leadId: lead.id,
  });
  await run(env, 'UPDATE leads SET gcal_event_id = ?, meet_link = COALESCE(meet_link, ?) WHERE id = ?', m.id, m.meet, lead.id);
  return m;
}

route('GET', '/api/appointments', async ({ env, user, url }) => {
  requireStaff(user);
  const from = Number(url.searchParams.get('from')) || now() - 7 * 864e5;
  const to = Math.min(Number(url.searchParams.get('to')) || now() + 35 * 864e5, from + 100 * 864e5);
  const users = Object.fromEntries((await all(env, 'SELECT id, name, email FROM users')).map((u) => [u.id, (u.name || u.email || '').split(' ')[0]]));
  const leads = await all(env, `SELECT id, business, contact_name, city, meet_at, meet_link, meet_by, owner_id, stage FROM leads WHERE meet_at >= ? AND meet_at < ? ORDER BY meet_at LIMIT 500`, from, to);
  const mtgs = await all(env, `SELECT m.id, m.client_id, m.title, m.start_at, m.minutes, m.meet_link, c.name AS client FROM meetings m LEFT JOIN clients c ON c.id = m.client_id WHERE m.start_at >= ? AND m.start_at < ? ORDER BY m.start_at LIMIT 300`, from, to).catch(() => []);
  const mine = (l) => user.role === 'admin' || l.meet_by === user.id || (!l.meet_by && l.owner_id === user.id);
  const items = [
    ...leads.map((l) => ({ kind: 'audit', id: l.id, title: l.business, who: (l.contact_name || '').split(' ')[0], city: l.city, start: l.meet_at, minutes: 30, by: users[l.meet_by] || 'Booking page', stage: l.stage, link: mine(l) ? l.meet_link : null, open: mine(l) })),
    ...mtgs.map((m) => ({ kind: 'client', id: m.client_id, title: m.client || m.title, who: m.title, start: m.start_at, minutes: m.minutes || 30, by: 'Client meeting', link: user.role !== 'client' ? m.meet_link : null, open: true })),
  ].sort((a, b) => a.start - b.start);
  return json({ items, from, to });
});

route('POST', '/api/leads/:id/meet-now', async ({ env, user, params }) => {
  requireStaff(user);
  if (!googleReady(env)) throw new HttpError('Google is not connected yet. Google page, Setup tab.', 503);
  const lead = await first(env, 'SELECT * FROM leads WHERE id = ?', params.id);
  if (!lead) throw new HttpError('Lead not found.', 404);
  const me = await first(env, 'SELECT * FROM users WHERE id = ?', user.id);
  if (!me?.google_token) throw new HttpError('Connect your Google account first (Google page, Setup, Turn on Calendar).', 400);
  const m = await createMeeting(env, me, { summary: `RightWay Growth: ${lead.business}`, description: 'Google clarity audit on a screen share.', start: now(), minutes: 30, attendees: [lead.email], leadId: lead.id });
  await run(env, 'UPDATE leads SET meet_link = ? WHERE id = ?', m.meet, lead.id);
  return json({ ok: true, meet: m.meet, invited: Boolean(lead.email) });
});

// Start a Google Meet now from the Phone tab (no lead needed). Invites anyone you list.
route('POST', '/api/meet/now', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const me = googleReady(env) ? await first(env, 'SELECT * FROM users WHERE id = ?', user.id) : null;
  if (!me?.google_token) return json({ ok: false, fallback: 'https://meet.google.com/new', reason: 'Google is not connected for you yet, so this opens Meet in your browser instead.' });
  const emails = String(b.invite || '').split(/[\s,;]+/).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).slice(0, 20);
  const minutes = Math.min(240, Math.max(15, Number(b.minutes) || 30));
  const start = b.start ? Number(new Date(b.start)) || now() : now();
  const m = await createMeeting(env, me, { summary: String(b.title || 'RightWay Growth meeting').slice(0, 120), description: String(b.note || '').slice(0, 1000), start, minutes, attendees: emails, leadId: b.leadId || null });
  return json({ ok: true, meet: m.meet, link: m.link, invited: emails.length, start });
});
