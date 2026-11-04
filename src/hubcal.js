// Appointments kept inside the Hub, no Google account needed. People add them by hand on the calendar page; booked audits and
// client meetings already live in the Hub. Everything reaches a real calendar two ways: a private calendar feed (.ics link) that
// Google Calendar, Apple Calendar and Outlook subscribe to once, and an email invite with the event attached.
import { HttpError, json } from './util.js';
import { first, run, newId, token, now } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { appointmentItems } from './appointments.js';
import { canEmail, sendEmail } from './email.js';
import { logActivity } from './crm.js';
import { can } from '../public/js/jobs.js';
import { icsCalendar, googleAddUrl } from '../public/js/ics.js';
import { mirrorEvent, unmirror } from './teamcal.js';

const b64 = (s) => { const b = new TextEncoder().encode(s); let t = ''; for (let i = 0; i < b.length; i += 8192) t += String.fromCharCode(...b.subarray(i, i + 8192)); return btoa(t); };
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function clean(b, cur = {}) {
  const title = 'title' in b ? String(b.title || '').trim().slice(0, 160) : cur.title;
  if (!title) throw new HttpError('Give the appointment a title.');
  const start = 'start' in b ? Number(b.start) : cur.start_at;
  if (!Number.isFinite(start) || start < 1e12) throw new HttpError('Pick a date and time.');
  const guest = 'guest_email' in b ? String(b.guest_email || '').trim().toLowerCase() : cur.guest_email || '';
  if (guest && !EMAIL.test(guest)) throw new HttpError('That guest email does not look right.');
  const link = 'link' in b ? String(b.link || '').trim().slice(0, 500) : cur.link || '';
  if (link && !/^https?:\/\//i.test(link)) throw new HttpError('The meeting link must start with https://');
  return {
    title, start, guest, link,
    minutes: Math.min(480, Math.max(5, Number('minutes' in b ? b.minutes : cur.minutes) || 30)),
    note: ('note' in b ? String(b.note || '') : cur.note || '').slice(0, 2000),
    lead_id: 'lead_id' in b ? b.lead_id || null : cur.lead_id || null,
    client_id: 'client_id' in b ? b.client_id || null : cur.client_id || null,
  };
}

// The email with the appointment attached. Opens straight into Apple Calendar and Outlook, and links to Google Calendar.
async function invite(env, user, e, kind = 'invite') {
  if (!e.guest || !canEmail(env)) return false;
  const when = new Date(e.start).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const add = googleAddUrl({ title: e.title, start: e.start, minutes: e.minutes, details: e.note, location: e.link });
  const lines = [`${kind === 'update' ? 'Updated: ' : ''}${e.title}`, `${when} Eastern, ${e.minutes} minutes`, e.link ? `Join: ${e.link}` : '', e.note || '', `Add to Google Calendar: ${add}`].filter(Boolean);
  const ics = icsCalendar([{ uid: e.id, title: e.title, start: e.start, minutes: e.minutes, description: [e.note, e.link].filter(Boolean).join('\n'), location: e.link, organizer: { name: user.name, email: user.email }, attendees: [e.guest] }], { method: 'REQUEST' });
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  await sendEmail(env, {
    to: e.guest, replyTo: user.email, subject: `${kind === 'update' ? 'Updated: ' : ''}${e.title} on ${when.split(',').slice(0, 2).join(',')}`, text: lines.join('\n\n'),
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#0F1B17"><p><b>${esc(e.title)}</b></p><p>${esc(when)} Eastern, ${e.minutes} minutes</p>${e.link ? `<p><a href="${esc(e.link)}">Join the meeting</a></p>` : ''}${e.note ? `<p>${esc(e.note).replace(/\n/g, '<br>')}</p>` : ''}<p><a href="${esc(add)}">Add to Google Calendar</a>. The attached file opens in Apple Calendar and Outlook.</p></div>`,
    attachments: [{ filename: 'appointment.ics', content: b64(ics), content_type: 'text/calendar; method=REQUEST; charset=UTF-8' }],
  });
  return true;
}

const row = (r) => ({ id: r.id, title: r.title, start: r.start_at, minutes: r.minutes, guest_email: r.guest_email, link: r.link, note: r.note, lead_id: r.lead_id, client_id: r.client_id, owner_id: r.owner_id });
async function mine(env, user, id) {
  const e = await first(env, 'SELECT * FROM events WHERE id = ?', id);
  if (!e) throw new HttpError('Appointment not found.', 404);
  if (!can(user, 'schedule') && e.owner_id !== user.id) throw new HttpError('That appointment belongs to someone else.', 403);
  return e;
}

route('POST', '/api/events', async ({ env, user, body, defer }) => {
  requireStaff(user);
  const b = await body();
  const e = clean(b);
  const id = newId('ev_');
  await run(env, 'INSERT INTO events (id, title, start_at, minutes, owner_id, lead_id, client_id, guest_email, link, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, e.title, e.start, e.minutes, user.id, e.lead_id, e.client_id, e.guest || null, e.link || null, e.note || null, now(), now());
  if (e.lead_id) await logActivity(env, { lead_id: e.lead_id, type: 'note', body: `Appointment added: ${e.title}`, by: user.id });
  let invited = false, inviteError = null;
  if (b.invite && e.guest) { try { invited = await invite(env, user, { ...e, id }); } catch (err) { inviteError = err.message; } }
  await defer(mirrorEvent(env, id).catch(() => false));
  return json({ id, invited, inviteError, noEmail: Boolean(b.invite && e.guest && !canEmail(env)) });
});

route('PUT', '/api/events/:id', async ({ env, user, params, body, defer }) => {
  requireStaff(user);
  const cur = await mine(env, user, params.id);
  const b = await body();
  const e = clean(b, cur);
  await run(env, 'UPDATE events SET title = ?, start_at = ?, minutes = ?, lead_id = ?, client_id = ?, guest_email = ?, link = ?, note = ?, updated_at = ? WHERE id = ?',
    e.title, e.start, e.minutes, e.lead_id, e.client_id, e.guest || null, e.link || null, e.note || null, now(), cur.id);
  let invited = false, inviteError = null;
  if (b.invite && e.guest) { try { invited = await invite(env, user, { ...e, id: cur.id }, 'update'); } catch (err) { inviteError = err.message; } }
  await defer(mirrorEvent(env, cur.id).catch(() => false));
  return json({ ok: true, invited, inviteError });
});

route('DELETE', '/api/events/:id', async ({ env, user, params, defer }) => {
  requireStaff(user);
  const cur = await mine(env, user, params.id);
  await run(env, 'DELETE FROM events WHERE id = ?', cur.id);
  await defer(unmirror(env, cur.master_event_id));
  return json({ ok: true });
});

// ---------- the private calendar feed ----------
async function feedToken(env, user, rotate = false) {
  const r = await first(env, 'SELECT cal_token FROM users WHERE id = ?', user.id);
  if (r?.cal_token && !rotate) return r.cal_token;
  const t = token(24);
  await run(env, 'UPDATE users SET cal_token = ? WHERE id = ?', t, user.id);
  return t;
}
const feedUrls = (origin, t) => ({ url: `${origin}/api/public/cal/${t}.ics`, webcal: `${origin.replace(/^https?:/, 'webcal:')}/api/public/cal/${t}.ics` });

route('GET', '/api/me/calendar-feed', async ({ env, user, url }) => {
  requireStaff(user);
  return json(feedUrls(url.origin, await feedToken(env, user)));
});
route('POST', '/api/me/calendar-feed', async ({ env, user, url }) => {
  requireStaff(user);
  return json(feedUrls(url.origin, await feedToken(env, user, true)));
});

// Public on purpose (calendar apps cannot log in). The long random link is the key; "New link" makes the old one stop working.
route('GET', '/api/public/cal/:token', async ({ env, params, url }) => {
  const t = String(params.token || '').replace(/\.ics$/i, '');
  const u = t.length >= 20 ? await first(env, "SELECT id, role, name FROM users WHERE cal_token = ? AND role IN ('admin','team')", t) : null;
  if (!u) throw new HttpError('This calendar link is not valid.', 404);
  const items = await appointmentItems(env, u, now() - 30 * 864e5, now() + 180 * 864e5);
  const label = { audit: 'Audit', client: 'Client meeting', event: '' };
  const events = items.map((x) => ({
    uid: `${x.kind}-${x.id}-${x.start}`, title: `${label[x.kind] ? `${label[x.kind]}: ` : ''}${x.title}`, start: x.start, minutes: x.minutes,
    description: [x.who && `With ${x.who}`, x.note, x.kind === 'audit' && x.open ? `Open in the Hub: ${url.origin}/#/pipeline/${x.id}` : ''].filter(Boolean).join('\n'), location: x.link || '',
  }));
  return new Response(icsCalendar(events, { name: 'Rightway Hub' }), { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=300' } });
}, { public: true });
