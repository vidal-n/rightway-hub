// Google Calendar inside the Hub: every calendar the person has, events read and written, Meet links,
// invites, and the Hub ties (an event can be pinned to a lead or a client, and Hub meetings show up here).
import { HttpError, json } from './util.js';
import { all, first, run, now, token } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { accessToken } from './google.js';
import { ownFor } from './googleapps.js';
import { apptScope } from './crm.js';
import { slimEvent } from '../public/js/calgrid.js';

const API = 'https://www.googleapis.com/calendar/v3';
// One request per calendar, so a person watching many of them still stays under the Worker's limit.
const MAX_CALS = 6;

async function cal(env, row, path, { method = 'GET', body } = {}) {
  const t = await accessToken(env, row);
  const res = await fetch(`${API}${path}`, {
    method, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    if (res.status === 403 && /insufficient|scope/i.test(msg)) throw new HttpError('Calendar needs to be turned on again on the Google page.', 400);
    throw new HttpError(`Google Calendar: ${msg}`, res.status === 401 || res.status === 403 ? 400 : 502);
  }
  return data;
}

route('GET', '/api/google/cal/calendars', async ({ env, user }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'calendar');
  const d = await cal(env, me, '/users/me/calendarList?maxResults=50&minAccessRole=reader');
  // Owners see every calendar they can open. Teammates see only their own calendars (no shared team or company calendars).
  const items = (d.items || []).filter((c) => user.role === 'admin' || c.primary || c.accessRole === 'owner');
  const cals = items.map((c) => ({
    id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '#23B07E',
    primary: Boolean(c.primary), selected: c.selected !== false, canWrite: ['owner', 'writer'].includes(c.accessRole),
    tz: c.timeZone || null,
  }));
  return json({ calendars: cals, email: me.google_email || null });
});

route('GET', '/api/google/cal/events', async ({ env, user, url }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'calendar');
  const from = Number(url.searchParams.get('from')) || Date.now();
  const to = Number(url.searchParams.get('to')) || from + 31 * 864e5;
  let wanted = (url.searchParams.get('cals') || 'primary').split(',').filter(Boolean).slice(0, MAX_CALS);
  if (user.role !== 'admin' && wanted.some((id) => id !== 'primary')) {
    const own = await cal(env, me, '/users/me/calendarList?maxResults=50&minAccessRole=owner').catch(() => ({ items: [] }));
    const ok = new Set(['primary', ...(own.items || []).map((c) => c.id)]);
    wanted = wanted.filter((id) => ok.has(id));
  }
  const colors = Object.fromEntries((url.searchParams.get('colors') || '').split(',').filter(Boolean).map((p) => p.split('|')));
  const q = (id) => `/calendars/${encodeURIComponent(id)}/events?${new URLSearchParams({
    timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(),
    singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
  })}`;
  const pages = await Promise.all(wanted.map(async (id) => {
    try { return { id, data: await cal(env, me, q(id)) }; } catch (e) { return { id, error: e.message }; }
  }));
  const events = pages.flatMap((p) => (p.data?.items || [])
    .filter((e) => e.status !== 'cancelled')
    .map((e) => slimEvent(e, p.id, colors[p.id] || '')));
  const errors = Object.fromEntries(pages.filter((p) => p.error).map((p) => [p.id, p.error]));
  // Leads and clients these events already point at, so the page can name them.
  const leadIds = [...new Set(events.map((e) => e.leadId).filter(Boolean))].slice(0, 40);
  const clientIds = [...new Set(events.map((e) => e.clientId).filter(Boolean))].slice(0, 40);
  const [leads, clients] = await Promise.all([
    leadIds.length ? all(env, `SELECT id, business FROM leads WHERE id IN (${leadIds.map(() => '?').join(',')})`, ...leadIds) : [],
    clientIds.length ? all(env, `SELECT id, name FROM clients WHERE id IN (${clientIds.map(() => '?').join(',')})`, ...clientIds) : [],
  ]);
  // Hub appointments in this range: all of them for owners, only the ones you booked for everyone else.
  const scope = apptScope(user);
  const appts = await all(env, `SELECT id, business, contact_name, meet_at, meet_link, gcal_event_id FROM leads WHERE meet_at >= ? AND meet_at < ?${scope.sql} ORDER BY meet_at LIMIT 100`, from, to, ...scope.args).catch(() => []);
  const seen = new Set(events.map((e) => e.id));
  const appointments = appts.filter((a) => !a.gcal_event_id || !seen.has(a.gcal_event_id)).map((a) => ({
    id: `appt_${a.id}`, calendarId: 'hub', color: '#0A6B4C', appt: true, title: `Appointment: ${a.business}`, where: '', notes: a.contact_name ? `With ${a.contact_name}` : '',
    start: a.meet_at, end: a.meet_at + 30 * 60e3, allDay: false, meet: a.meet_link || null, link: null, organizer: '', attendees: [], leadId: a.id, clientId: null, mine: false, busy: true, recurring: false,
  }));
  return json({ events: [...events, ...appointments], errors, leads: [...leads, ...appts.filter((a) => !leads.some((l) => l.id === a.id)).map((a) => ({ id: a.id, business: a.business }))], clients, email: me.google_email || null, owner: user.role === 'admin' });
});

const body2event = (b) => {
  const allDay = Boolean(b.allDay);
  const start = Number(b.start);
  const end = Number(b.end) || start + 30 * 60e3;
  if (!start) throw new HttpError('When does it start?');
  const ymd = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
  const ev = {
    summary: String(b.title || '').slice(0, 300) || 'Busy',
    description: String(b.notes || '').slice(0, 6000) || undefined,
    location: String(b.where || '').slice(0, 300) || undefined,
    start: allDay ? { date: ymd(start) } : { dateTime: new Date(start).toISOString() },
    end: allDay ? { date: ymd(end) } : { dateTime: new Date(end).toISOString() },
    attendees: (Array.isArray(b.attendees) ? b.attendees : []).filter(Boolean).slice(0, 25).map((email) => ({ email: String(email).trim() })),
  };
  if (b.leadId || b.clientId) ev.extendedProperties = { private: { ...(b.leadId ? { rwLead: String(b.leadId) } : {}), ...(b.clientId ? { rwClient: String(b.clientId) } : {}) } };
  return ev;
};

route('POST', '/api/google/cal/events', async ({ env, user, body }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'calendar');
  const b = await body();
  const calId = String(b.calendarId || 'primary');
  const ev = body2event(b);
  if (b.meet) ev.conferenceData = { createRequest: { requestId: token(12), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  const made = await cal(env, me, `/calendars/${encodeURIComponent(calId)}/events?conferenceDataVersion=1&sendUpdates=${ev.attendees.length ? 'all' : 'none'}`, { method: 'POST', body: ev });
  return json({ event: slimEvent(made, calId) });
});

route('PATCH', '/api/google/cal/events/:id', async ({ env, user, params, body }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'calendar');
  const b = await body();
  const calId = String(b.calendarId || 'primary');
  const patch = b.move
    ? { start: Number(b.start) && b.allDay === true ? body2event(b).start : { dateTime: new Date(Number(b.start)).toISOString() }, end: b.allDay === true ? body2event(b).end : { dateTime: new Date(Number(b.end)).toISOString() } }
    : body2event(b);
  const made = await cal(env, me, `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(params.id)}?conferenceDataVersion=1&sendUpdates=all`, { method: 'PATCH', body: patch });
  return json({ event: slimEvent(made, calId) });
});

route('DELETE', '/api/google/cal/events/:id', async ({ env, user, params, url }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'calendar');
  const calId = url.searchParams.get('calendarId') || 'primary';
  const t = await accessToken(env, me);
  const res = await fetch(`${API}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(params.id)}?sendUpdates=all`, { method: 'DELETE', headers: { authorization: `Bearer ${t}` } });
  if (!res.ok && res.status !== 404 && res.status !== 410) throw new HttpError(`Google Calendar: HTTP ${res.status}`, 502);
  return json({ ok: true });
});

// People to invite: the Hub's own leads, clients and teammates.
route('GET', '/api/google/cal/people', async ({ env, user, url }) => {
  requireStaff(user);
  const q = `%${(url.searchParams.get('q') || '').toLowerCase().slice(0, 60)}%`;
  const [leads, clients, team] = await Promise.all([
    all(env, "SELECT business AS name, contact_name, email FROM leads WHERE email IS NOT NULL AND email != '' AND (lower(business) LIKE ? OR lower(email) LIKE ?) LIMIT 6", q, q),
    all(env, "SELECT id, name, contact_name, contact_email AS email FROM clients WHERE contact_email IS NOT NULL AND contact_email != '' AND lower(name) LIKE ? LIMIT 6", q),
    all(env, 'SELECT name, email FROM users WHERE lower(name) LIKE ? OR email LIKE ? LIMIT 5', q, q),
  ]);
  const out = [
    ...leads.map((l) => ({ email: l.email, name: l.contact_name || l.name, note: l.name, kind: 'Lead' })),
    ...clients.map((c) => ({ email: c.email, name: c.contact_name || c.name, note: c.name, kind: 'Client', clientId: c.id })),
    ...team.map((t) => ({ email: t.email, name: t.name, note: 'Rightway Growth', kind: 'Team' })),
  ];
  const seen = new Set();
  return json({ people: out.filter((p) => p.email && !seen.has(p.email.toLowerCase()) && seen.add(p.email.toLowerCase())).slice(0, 12) });
});
