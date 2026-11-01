// Google Calendar and Google Meet: connect a Google account, book meetings with a Meet link from a lead,
// and a public booking page that reads real availability. Keys: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
import { HttpError, json } from './util.js';
import { all, first, run, now, token, getSettings, setSetting } from './db.js';
import { requireStaff, requireAdmin, cleanEmail } from './auth.js';
import { route } from './router.js';
import { cleanLead, insertLead, logActivity, rescore } from './crm.js';
import { openSlots } from '../public/js/slots.js';
import { dupKeys } from '../public/js/leadintel.js';

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events'];
const API = 'https://www.googleapis.com/calendar/v3';
export const googleReady = (env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

// ---------- token storage (AES-GCM, key derived from the client secret) ----------
async function aesKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`rw-google:${env.GOOGLE_CLIENT_SECRET}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), new TextEncoder().encode(text)));
  return `${b64(iv)}.${b64(ct)}`;
}
export async function unseal(env, sealed) {
  const [iv, ct] = String(sealed || '').split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(ct));
  return new TextDecoder().decode(pt);
}

const cache = new Map();
export async function accessToken(env, userRow, fetchImpl = fetch) {
  if (!googleReady(env)) throw new HttpError('Google is not connected yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Cloudflare.', 503);
  if (!userRow?.google_token) throw new HttpError('Connect your Google account in Settings first.', 400);
  const hit = cache.get(userRow.id);
  if (hit && hit.exp > Date.now() + 60e3) return hit.token;
  let refresh;
  try { refresh = await unseal(env, userRow.google_token); } catch { throw new HttpError('Your Google connection needs to be redone. Open Settings and connect Google again.', 400); }
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new HttpError('Google turned down the saved connection. Open Settings and connect Google again.', 400);
  cache.set(userRow.id, { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 });
  return data.access_token;
}

async function gcal(env, userRow, path, { method = 'GET', body, fetchImpl = fetch } = {}) {
  const t = await accessToken(env, userRow, fetchImpl);
  const res = await fetchImpl(`${API}${path}`, { method, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(`Google Calendar: ${data.error?.message || `HTTP ${res.status}`}`, 502);
  return data;
}

export async function createMeeting(env, owner, { summary, description, start, minutes, attendees = [], leadId, fetchImpl }) {
  const ev = await gcal(env, owner, '/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all', {
    method: 'POST', fetchImpl,
    body: {
      summary, description,
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(start + minutes * 60e3).toISOString() },
      attendees: attendees.filter(Boolean).map((email) => ({ email })),
      conferenceData: { createRequest: { requestId: token(12), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
      reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 1440 }, { method: 'popup', minutes: 15 }] },
      extendedProperties: leadId ? { private: { rwLead: leadId } } : undefined,
    },
  });
  const meet = ev.hangoutLink || ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri || null;
  return { id: ev.id, link: ev.htmlLink, meet };
}

export async function busyTimes(env, owner, from, to, fetchImpl) {
  const q = new URLSearchParams({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
  const data = await gcal(env, owner, `/calendars/primary/events?${q}`, { fetchImpl });
  return (data.items || [])
    .filter((e) => e.status !== 'cancelled' && e.transparency !== 'transparent' && e.start?.dateTime)
    .map((e) => [Date.parse(e.start.dateTime), Date.parse(e.end.dateTime)]);
}

// ---------- booking settings ----------
export async function bookingConfig(env) {
  const s = await getSettings(env);
  const n = (k, d) => (Number.isFinite(Number(s[k])) && s[k] !== '' && s[k] != null ? Number(s[k]) : d);
  return {
    tz: s.book_tz || 'America/New_York',
    weekdays: (s.book_days || '1,2,3,4,5').split(',').map(Number).filter((x) => x >= 0 && x <= 6),
    startHour: n('book_start', 9), endHour: n('book_end', 17), minutes: n('book_minutes', 30), buffer: n('book_buffer', 15),
    noticeHours: n('book_notice', 4), days: n('book_window', 14),
    title: s.book_title || 'Free local visibility audit',
    owner: s.book_owner || null,
  };
}

async function bookingOwner(env, cfg) {
  if (cfg.owner) { const u = await first(env, 'SELECT * FROM users WHERE id = ? AND google_token IS NOT NULL', cfg.owner); if (u) return u; }
  return first(env, "SELECT * FROM users WHERE role = 'admin' AND google_token IS NOT NULL ORDER BY created_at LIMIT 1");
}

const AGENDA = (business) => [
  `Rightway Growth audit${business ? ` for ${business}` : ''}`,
  '',
  'What we will cover (about 20 minutes):',
  '1. Where you show up on Google Maps across your area',
  '2. Who is beating you and why',
  '3. The exact fixes we would make, and what it costs',
  '',
  'Join with the Google Meet link in this invite. Questions: reply to this email.',
].join('\n');

// ---------- routes ----------
route('GET', '/api/google/status', async ({ env, user }) => {
  requireStaff(user);
  const row = await first(env, 'SELECT google_email, google_token FROM users WHERE id = ?', user.id);
  const cfg = await bookingConfig(env);
  const owner = await bookingOwner(env, cfg);
  return json({ ready: googleReady(env), connected: Boolean(row?.google_token), email: row?.google_email || null, booking: { ...cfg, ownerEmail: owner?.google_email || null } });
});

route('GET', '/api/google/connect', async ({ env, user, url }) => {
  requireStaff(user);
  if (!googleReady(env)) throw new HttpError('Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Cloudflare first.', 503);
  const state = token(18);
  await run(env, 'DELETE FROM oauth_states WHERE at < ?', now() - 600e3);
  await run(env, 'INSERT INTO oauth_states (state, user_id, at) VALUES (?, ?, ?)', state, user.id, now());
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${url.origin}/api/google/callback`, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state, login_hint: user.email,
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`, 302);
});

route('GET', '/api/google/callback', async ({ env, user, url }) => {
  const back = (msg) => Response.redirect(`${url.origin}/?google=${encodeURIComponent(msg)}#/settings`, 302);
  if (!user) return back('Log in to the Hub first, then connect Google.');
  const st = await first(env, 'SELECT * FROM oauth_states WHERE state = ?', url.searchParams.get('state') || '');
  if (st) await run(env, 'DELETE FROM oauth_states WHERE state = ?', st.state);
  if (!st || st.user_id !== user.id || now() - st.at > 600e3) return back('That link expired. Try Connect Google again.');
  if (url.searchParams.get('error')) return back('Google connection was cancelled.');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: url.searchParams.get('code') || '', client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${url.origin}/api/google/callback`, grant_type: 'authorization_code' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.refresh_token) return back(data.error_description || 'Google did not return a connection. Remove the Hub under your Google account permissions and try again.');
  let email = null;
  try { email = JSON.parse(atob(data.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || null; } catch { email = null; }
  await run(env, 'UPDATE users SET google_token = ?, google_email = ? WHERE id = ?', await seal(env, data.refresh_token), email, user.id);
  cache.delete(user.id);
  return back('ok');
});

route('POST', '/api/google/disconnect', async ({ env, user }) => {
  requireStaff(user);
  await run(env, 'UPDATE users SET google_token = NULL, google_email = NULL WHERE id = ?', user.id);
  cache.delete(user.id);
  return json({ ok: true });
});

route('PUT', '/api/google/booking', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  const keys = { tz: 'book_tz', days: 'book_days', start: 'book_start', end: 'book_end', minutes: 'book_minutes', buffer: 'book_buffer', notice: 'book_notice', window: 'book_window', title: 'book_title' };
  for (const [k, sk] of Object.entries(keys)) if (k in b) await setSetting(env, sk, String(b[k] ?? '').slice(0, 120));
  if (b.ownerSelf) await setSetting(env, 'book_owner', user.id);
  return json({ ok: true, booking: await bookingConfig(env) });
});

// Book from a lead: Google event with a Meet link, invite sent to the lead, lead moved to Audit booked.
route('POST', '/api/leads/:id/meeting', async ({ env, user, params, body }) => {
  requireStaff(user);
  const lead = await first(env, 'SELECT * FROM leads WHERE id = ?', params.id);
  if (!lead) throw new HttpError('Lead not found.', 404);
  const b = await body();
  const start = Number(new Date(b.start));
  if (!start || start < now() - 3600e3) throw new HttpError('Pick a time in the future.');
  const minutes = Math.min(120, Math.max(15, Number(b.minutes) || 30));
  const email = b.email ? cleanEmail(b.email) : lead.email;
  const me = await first(env, 'SELECT * FROM users WHERE id = ?', user.id);
  const owner = me?.google_token ? me : await bookingOwner(env, await bookingConfig(env));
  if (!owner) throw new HttpError('Connect Google in Settings to send calendar invites with a Meet link.', 400);
  const m = await createMeeting(env, owner, {
    summary: `Rightway Growth audit: ${lead.business}`, description: [AGENDA(lead.business), b.note ? `\nNote: ${String(b.note).slice(0, 500)}` : ''].join(''),
    start, minutes, attendees: [email], leadId: lead.id,
  });
  const set = { stage: 'audit_booked', meet_at: start, meet_link: m.meet, gcal_event_id: m.id, next_action_at: start, next_action: 'Audit call (Call 2): open Present', updated_at: now() };
  if (email && !lead.email) set.email = email;
  Object.assign(set, rescore({ ...lead, ...set }));
  const cols = Object.keys(set);
  await run(env, `UPDATE leads SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => set[k]), lead.id);
  await logActivity(env, { lead_id: lead.id, type: 'meeting', body: `Audit booked for ${new Date(start).toISOString()}${m.meet ? ` with Google Meet` : ''}${email ? `, invite sent to ${email}` : ''}`, by: user.id });
  return json({ ok: true, meet: m.meet, link: m.link, start });
});

route('GET', '/api/calendar/upcoming', async ({ env, user }) => {
  requireStaff(user);
  const meetings = await all(env, `SELECT id, business, contact_name, phone, meet_at, meet_link, stage, score, grade, plan FROM leads WHERE meet_at >= ? ORDER BY meet_at LIMIT 50`, now() - 2 * 3600e3);
  let events = [];
  const me = await first(env, 'SELECT * FROM users WHERE id = ?', user.id);
  if (googleReady(env) && me?.google_token) {
    try {
      const q = new URLSearchParams({ timeMin: new Date(now() - 3600e3).toISOString(), timeMax: new Date(now() + 7 * 864e5).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '30' });
      const data = await gcal(env, me, `/calendars/primary/events?${q}`);
      events = (data.items || []).filter((e) => e.status !== 'cancelled').map((e) => ({ id: e.id, title: e.summary || '(no title)', start: Date.parse(e.start?.dateTime || e.start?.date), meet: e.hangoutLink || null, lead: e.extendedProperties?.private?.rwLead || null }));
    } catch { events = []; }
  }
  return json({ meetings, events, connected: Boolean(me?.google_token) });
});

// ---------- public booking page ----------
route('GET', '/api/public/book', async ({ env }) => {
  const cfg = await bookingConfig(env);
  const owner = googleReady(env) ? await bookingOwner(env, cfg) : null;
  if (!owner) return json({ ready: false, title: cfg.title });
  const from = now();
  const busy = await busyTimes(env, owner, from, from + (cfg.days + 1) * 864e5).catch(() => []);
  return json({ ready: true, title: cfg.title, minutes: cfg.minutes, tz: cfg.tz, slots: openSlots({ ...cfg, from, busy }) });
}, { public: true });

route('POST', '/api/public/book', async ({ env, request }) => {
  const b = await request.json().catch(() => ({}));
  if (b['company-url']) return json({ ok: true });
  const cfg = await bookingConfig(env);
  const owner = googleReady(env) ? await bookingOwner(env, cfg) : null;
  if (!owner) throw new HttpError('Online booking is not set up yet. Call us instead.', 503);
  const start = Number(b.start);
  const busy = await busyTimes(env, owner, now(), now() + (cfg.days + 1) * 864e5);
  if (!openSlots({ ...cfg, from: now(), busy }).includes(start)) throw new HttpError('That time was just taken. Pick another one.', 409);
  const email = cleanEmail(b.email);
  if (!email) throw new HttpError('Add your email so we can send the invite.');
  const data = cleanLead({ business: b.business || b.name, contact_name: b.name, email, phone: b.phone, website: b.website, city: b.city, state: b.state, industry: b.industry, source: 'booking', notes: b.note ? `Booking note: ${b.note}` : null });
  // Match an existing lead by phone, site, name and city, or email.
  const rows = await all(env, 'SELECT id, business, phone_digits, website, city, zip, email FROM leads');
  const keys = new Set(dupKeys(data));
  let lead = rows.find((r) => dupKeys(r).some((k) => keys.has(k)) || (r.email && r.email.toLowerCase() === email));
  let leadId = lead?.id;
  if (!leadId) leadId = await insertLead(env, { ...data, stage: 'audit_booked' }, null);
  const full = await first(env, 'SELECT * FROM leads WHERE id = ?', leadId);
  const m = await createMeeting(env, owner, { summary: `Rightway Growth audit: ${full.business}`, description: AGENDA(full.business), start, minutes: cfg.minutes, attendees: [email], leadId });
  const set = { stage: 'audit_booked', meet_at: start, meet_link: m.meet, gcal_event_id: m.id, next_action_at: start, next_action: 'Audit call (Call 2): open Present', updated_at: now() };
  if (!full.email) set.email = email;
  Object.assign(set, rescore({ ...full, ...set, source: full.source || 'booking' }));
  const cols = Object.keys(set);
  await run(env, `UPDATE leads SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => set[k]), leadId);
  await logActivity(env, { lead_id: leadId, type: 'meeting', body: `Booked online for ${new Date(start).toISOString()}` });
  return json({ ok: true, start, meet: m.meet, minutes: cfg.minutes });
}, { public: true });
