// Google Calendar and Google Meet: connect a Google account, book meetings with a Meet link from a lead,
// and a public booking page that reads real availability. Keys: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
import { HttpError, json } from './util.js';
import { all, first, run, now, token, getSettings, setSetting } from './db.js';
import { requireStaff, requireAdmin, cleanEmail } from './auth.js';
import { route } from './router.js';
import { cleanLead, insertLead, logActivity, rescore, apptScope, stateCode } from './crm.js';
import { automationTick, bookToken } from './automations.js';
import { openSlots } from '../public/js/slots.js';
import { dupKeys } from '../public/js/leadintel.js';
import { notifyLater } from './notify.js';

// Full Calendar access. The narrower calendar.events scope can book events but cannot list calendars, which the Calendar page
// and the connection check need: with it Google answers 403 "insufficient authentication scopes" and no amount of re-ticking fixes it.
export const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar';
export const CAL_EVENTS = 'https://www.googleapis.com/auth/calendar.events';
const SCOPES = ['openid', 'email', CAL_SCOPE];
const scopeSet = (s) => new Set(String(s || '').split(/\s+/).filter(Boolean));
export const calendarFull = (s) => scopeSet(s).has(CAL_SCOPE);
export const calendarAny = (s) => calendarFull(s) || scopeSet(s).has(CAL_EVENTS);
// Extra Google apps a user can turn on. Each adds its scope on top of what they already granted.
export const APP_SCOPES = {
  mail: 'https://www.googleapis.com/auth/gmail.modify',
  drive: 'https://www.googleapis.com/auth/drive',
  docs: 'https://www.googleapis.com/auth/documents',
  sheets: 'https://www.googleapis.com/auth/drive.file',
  gsc: 'https://www.googleapis.com/auth/webmasters.readonly',
  ga: 'https://www.googleapis.com/auth/analytics.readonly',
  ads: 'https://www.googleapis.com/auth/adwords',
  gbp: 'https://www.googleapis.com/auth/business.manage',
};
// Scopes are matched whole, not as substrings: ".../auth/drive" is a prefix of ".../auth/drive.file".
export function hasScope(scopeStr, scope) {
  const set = new Set(String(scopeStr || '').split(/\s+/).filter(Boolean));
  if (set.has(scope)) return true;
  // Full Drive covers everything the narrow drive.file scope can do.
  return scope === APP_SCOPES.sheets && set.has(APP_SCOPES.drive);
}
const APP_LABEL = { mail: 'Gmail', drive: 'Drive', docs: 'Docs', sheets: 'Sheets', gsc: 'Search Console', ga: 'Analytics', ads: 'Google Ads', gbp: 'Business Profile' };
// What was asked for but not granted, as a message for the person. Empty when everything came through.
export function missingText(scopeStr, apps = []) {
  const miss = [];
  if (!calendarFull(scopeStr)) miss.push('Calendar');
  for (const a of apps) if (APP_SCOPES[a] && !hasScope(scopeStr, APP_SCOPES[a])) miss.push(APP_LABEL[a] || a);
  return miss.length ? `Connected, but Google did not give access to ${miss.join(', ')}. Click Turn on again and tick every box on Google's screen (or Select all) before Continue.` : '';
}
export function grantedApps(scopeStr) {
  const apps = Object.entries(APP_SCOPES).filter(([, sc]) => hasScope(scopeStr, sc)).map(([k]) => k);
  if (calendarFull(scopeStr)) apps.unshift('calendar');
  return apps;
}
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
  if (!res.ok || !data.access_token) {
    if (data.error === 'invalid_grant') throw new HttpError('Your Google sign in expired or was removed. Google ends it every 7 days while the Google app is in Testing mode. Open the Google page and press Turn on all to sign in again.', 400);
    throw new HttpError(`Google turned down the saved connection (${data.error_description || data.error || `HTTP ${res.status}`}). Open the Google page and press Turn on all to sign in again.`, 400);
  }
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

export async function moveMeeting(env, owner, eventId, start, minutes, fetchImpl) {
  return gcal(env, owner, `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: 'PATCH', fetchImpl, body: { start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(start + minutes * 60e3).toISOString() } },
  });
}

export async function cancelEvent(env, owner, eventId, fetchImpl) {
  const t = await accessToken(env, owner, fetchImpl);
  const res = await (fetchImpl || fetch)(`${API}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: 'DELETE', headers: { authorization: `Bearer ${t}` } });
  if (!res.ok && res.status !== 410 && res.status !== 404) throw new HttpError(`Google Calendar: HTTP ${res.status}`, 502);
  return true;
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
    title: s.book_title || 'Book a free consultation',
    owner: s.book_owner || null,
    link: s.book_link || '', // meeting link used when Google is not connected (Zoom, a Meet room, or empty for a phone call)
    rep: s.book_rep || '', // who gets online bookings: a user id, 'rr' for round robin, or '' for the owners
  };
}

export async function bookingOwner(env, cfg) {
  if (cfg.owner) { const u = await first(env, 'SELECT * FROM users WHERE id = ? AND google_token IS NOT NULL', cfg.owner); if (u) return u; }
  return first(env, "SELECT * FROM users WHERE role = 'admin' AND google_token IS NOT NULL ORDER BY created_at LIMIT 1");
}

const AGENDA = (business) => [
  `Rightway Growth consultation${business ? ` for ${business}` : ''}`,
  '',
  'What we will cover (about 20 minutes):',
  '1. Your Google clarity scan: where you show up across your area, and where it is inconsistent',
  '2. Who is getting your calls and why',
  '3. What we would fix, how it works, and what it costs',
  '',
  'Join with the Google Meet link in this invite. Questions: reply to this email.',
].join('\n');

// ---------- routes ----------
route('GET', '/api/google/status', async ({ env, user }) => {
  requireStaff(user);
  const row = await first(env, 'SELECT google_email, google_token, google_scopes FROM users WHERE id = ?', user.id);
  const cfg = await bookingConfig(env);
  const owner = await bookingOwner(env, cfg);
  const team = await all(env, "SELECT name, email, google_email, google_scopes FROM users WHERE google_token IS NOT NULL AND role IN ('admin','team')");
  return json({ ready: googleReady(env), connected: Boolean(row?.google_token), email: row?.google_email || null,
    apps: row?.google_token ? (row.google_scopes ? grantedApps(row.google_scopes) : ['calendar']) : [],
    teamApps: [...new Set(team.flatMap((u) => (u.google_scopes ? grantedApps(u.google_scopes) : ['calendar'])))],
    adsToken: Boolean(env.GOOGLE_ADS_DEVELOPER_TOKEN),
    booking: { ...cfg, ownerEmail: owner?.google_email || null } });
});

route('GET', '/api/google/connect', async ({ env, user, url }) => {
  requireStaff(user);
  if (!googleReady(env)) throw new HttpError('Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Cloudflare first.', 503);
  const apps = (url.searchParams.get('apps') || '').split(',').filter((a) => APP_SCOPES[a]);
  const state = `${token(18)}${url.searchParams.get('back') === 'google' ? '_g' : ''}`;
  await run(env, 'DELETE FROM oauth_states WHERE at < ?', now() - 600e3);
  await run(env, 'INSERT INTO oauth_states (state, user_id, at, apps) VALUES (?, ?, ?, ?)', state, user.id, now(), apps.join(','));
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${url.origin}/api/google/callback`, response_type: 'code', scope: [...SCOPES, ...apps.map((a) => APP_SCOPES[a])].join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state, login_hint: user.email,
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`, 302);
});

route('GET', '/api/google/callback', async ({ env, user, url }) => {
  const toPage = (url.searchParams.get('state') || '').endsWith('_g') ? 'google' : 'settings';
  const back = (msg) => Response.redirect(`${url.origin}/?google=${encodeURIComponent(msg)}#/${toPage}`, 302);
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
  try { const part = data.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); email = JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4))).email || null; } catch { email = null; }
  await run(env, 'UPDATE users SET google_token = ?, google_email = ?, google_scopes = ? WHERE id = ?', await seal(env, data.refresh_token), email, data.scope || null, user.id);
  cache.delete(user.id);
  // Google's consent screen has a checkbox per app. If one was left unticked, say which, instead of failing later.
  return back(missingText(data.scope, (st.apps || '').split(',').filter(Boolean)) || 'ok');
});

route('POST', '/api/google/disconnect', async ({ env, user }) => {
  requireStaff(user);
  await run(env, 'UPDATE users SET google_token = NULL, google_email = NULL, google_scopes = NULL WHERE id = ?', user.id);
  cache.delete(user.id);
  return json({ ok: true });
});

route('PUT', '/api/google/booking', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  const keys = { tz: 'book_tz', days: 'book_days', start: 'book_start', end: 'book_end', minutes: 'book_minutes', buffer: 'book_buffer', notice: 'book_notice', window: 'book_window', title: 'book_title' };
  for (const [k, sk] of Object.entries(keys)) if (k in b) await setSetting(env, sk, String(b[k] ?? '').slice(0, 120));
  if ('link' in b) {
    const link = String(b.link || '').trim();
    if (link && !/^https:\/\/\S+$/.test(link)) throw new HttpError('The meeting link must start with https://');
    await setSetting(env, 'book_link', link.slice(0, 400));
  }
  if ('rep' in b) {
    const rep = String(b.rep || '');
    if (rep && rep !== 'rr' && !(await first(env, "SELECT id FROM users WHERE id = ? AND role IN ('admin','team')", rep))) throw new HttpError('Pick someone on the team.');
    await setSetting(env, 'book_rep', rep);
  }
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
  const me = googleReady(env) ? await first(env, 'SELECT * FROM users WHERE id = ?', user.id) : null;
  const owner = me?.google_token ? me : googleReady(env) ? await bookingOwner(env, await bookingConfig(env)) : null;
  if (!owner) {
    // No Google yet: still book it in the Hub with a pasted meeting link (Zoom, Meet, or a phone call), so booking never stops.
    const link = /^https:\/\//.test(String(b.link || '').trim()) ? String(b.link).trim().slice(0, 400) : null;
    const set = { stage: 'audit_booked', meet_at: start, meet_link: link, gcal_event_id: null, meet_by: user.id, next_action_at: start, next_action: 'Clarity call: open Present', updated_at: now() };
    if (email && !lead.email) set.email = email;
    Object.assign(set, rescore({ ...lead, ...set }));
    const cols = Object.keys(set);
    await run(env, `UPDATE leads SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => set[k]), lead.id);
    await logActivity(env, { lead_id: lead.id, type: 'meeting', body: `Clarity call booked for ${new Date(start).toISOString()} (Hub only${link ? ', link added' : ''})`, by: user.id });
    return json({ ok: true, meet: link, start, google: false, rep: String(user.name || '').split(' ')[0] });
  }
  const m = await createMeeting(env, owner, {
    summary: `Rightway Growth consultation: ${lead.business}`, description: [AGENDA(lead.business), b.note ? `\nNote: ${String(b.note).slice(0, 500)}` : ''].join(''),
    start, minutes, attendees: [email], leadId: lead.id,
  });
  const set = { stage: 'audit_booked', meet_at: start, meet_link: m.meet, gcal_event_id: m.id, meet_by: user.id, next_action_at: start, next_action: 'Audit call (Call 2): open Present', updated_at: now() };
  if (email && !lead.email) set.email = email;
  Object.assign(set, rescore({ ...lead, ...set }));
  const cols = Object.keys(set);
  await run(env, `UPDATE leads SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => set[k]), lead.id);
  await logActivity(env, { lead_id: lead.id, type: 'meeting', body: `Audit booked for ${new Date(start).toISOString()}${m.meet ? ` with Google Meet` : ''}${email ? `, invite sent to ${email}` : ''}`, by: user.id });
  return json({ ok: true, meet: m.meet, link: m.link, start });
});

route('GET', '/api/calendar/upcoming', async ({ env, user }) => {
  requireStaff(user);
  const scope = apptScope(user);
  const meetings = await all(env, `SELECT id, business, contact_name, phone, meet_at, meet_link, stage, score, grade, plan FROM leads WHERE meet_at >= ?${scope.sql} ORDER BY meet_at LIMIT 50`, now() - 2 * 3600e3, ...scope.args);
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
// Hub appointments as busy times, so the booking page works without Google (and never double books with Google).
async function hubBusy(env, from, to, minutes, repId = null) {
  const lo = from - 3 * 3600e3;
  const leads = await all(env, 'SELECT meet_at FROM leads WHERE meet_at >= ? AND meet_at < ?', lo, to).catch(() => []);
  const mtgs = await all(env, 'SELECT start_at, minutes FROM meetings WHERE start_at >= ? AND start_at < ?', lo, to).catch(() => []);
  // Appointments added by hand on the Hub calendar block the person who takes bookings (or the owners when nobody is set).
  const evs = await all(env, repId ? 'SELECT start_at, minutes FROM events WHERE start_at >= ? AND start_at < ? AND owner_id = ?'
    : "SELECT e.start_at, e.minutes FROM events e JOIN users u ON u.id = e.owner_id WHERE e.start_at >= ? AND e.start_at < ? AND u.role = 'admin'", lo, to, ...(repId ? [repId] : [])).catch(() => []);
  return [...leads.map((r) => [r.meet_at, r.meet_at + minutes * 60e3]), ...[...mtgs, ...evs].map((r) => [r.start_at, r.start_at + (r.minutes || 30) * 60e3])];
}
const fixedRep = (cfg) => (cfg.rep && cfg.rep !== 'rr' ? cfg.rep : null);

async function bookingBusy(env, cfg, owner) {
  const from = now(), to = from + (cfg.days + 1) * 864e5;
  const g = owner ? await busyTimes(env, owner, from, to).catch(() => []) : [];
  return [...g, ...await hubBusy(env, from, to, cfg.minutes, fixedRep(cfg))];
}

// Who gets an online booking: the person set in booking settings, or round robin (fewest upcoming audits), or nobody (owners see it).
export async function pickRep(env, cfg) {
  if (fixedRep(cfg)) return (await first(env, "SELECT id FROM users WHERE id = ? AND role IN ('admin','team')", cfg.rep))?.id || null;
  if (cfg.rep !== 'rr') return null;
  const rows = await all(env, "SELECT u.id, (SELECT COUNT(*) FROM leads l WHERE l.meet_by = u.id AND l.meet_at > ?) AS n FROM users u WHERE u.role IN ('admin','team') ORDER BY n, u.created_at", now());
  return rows[0]?.id || null;
}

// Everything the booking form needs before it can book. Pure: the page, the Worker and the tests agree on it.
export const BOOK_FIELDS = [['name', 'Your name'], ['business', 'Business name'], ['email', 'Email'], ['phone', 'Mobile phone'], ['city', 'City'], ['state', 'State']];
export function bookingProblem(b = {}) {
  for (const [k, label] of BOOK_FIELDS) if (!String(b[k] ?? '').trim()) return { field: k, error: `${label} is needed to book.` };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email).trim())) return { field: 'email', error: 'That email does not look right. The invite goes there.' };
  if (String(b.phone).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '').length !== 10) return { field: 'phone', error: 'Enter a 10 digit mobile number.' };
  if (!stateCode(b.state)) return { field: 'state', error: 'Enter your state, like FL.' };
  if (!Number(b.start)) return { field: 'time', error: 'Pick a time first.' };
  return null;
}
const okTz = (z) => { if (!z || typeof z !== 'string' || z.length > 64) return false; try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch { return false; } };

route('GET', '/api/public/book', async ({ env, url }) => {
  const cfg = await bookingConfig(env);
  const owner = googleReady(env) ? await bookingOwner(env, cfg) : null;
  const busy = await bookingBusy(env, cfg, owner);
  // A personal link (?l=) fills in what we already know, so the person only types what is missing.
  const t = String(url.searchParams.get('l') || '');
  const l = t.length >= 16 ? await first(env, 'SELECT contact_name, business, email, phone, website, city, state, industry, meet_at FROM leads WHERE book_token = ?', t) : null;
  const lead = l ? { name: l.contact_name || '', business: /^Unknown /.test(l.business || '') ? '' : l.business || '', email: l.email || '', phone: l.phone || '', website: l.website || '', city: l.city || '', state: l.state || '', industry: l.industry || '', booked: l.meet_at && l.meet_at > now() ? l.meet_at : null } : null;
  return json({ ready: true, google: Boolean(owner), title: cfg.title, minutes: cfg.minutes, tz: cfg.tz, slots: openSlots({ ...cfg, from: now(), busy }), required: BOOK_FIELDS.map(([k]) => k), lead });
}, { public: true });

route('POST', '/api/public/book', async ({ env, request, defer }) => {
  const b = await request.json().catch(() => ({}));
  if (b['company-url']) return json({ ok: true });
  const bad = bookingProblem(b);
  if (bad) return json(bad, 400);
  const cfg = await bookingConfig(env);
  const owner = googleReady(env) ? await bookingOwner(env, cfg) : null;
  const start = Number(b.start);
  const busy = await bookingBusy(env, cfg, owner);
  const taken = { error: 'That time was just taken. Pick another one.', field: 'time' };
  if (!openSlots({ ...cfg, from: now(), busy }).includes(start)) return json(taken, 409);
  const email = String(b.email).trim().toLowerCase();
  const tz = okTz(b.tz) ? b.tz : null;
  const data = cleanLead({ business: b.business || b.name, contact_name: b.name, email, phone: b.phone, website: b.website, city: b.city, state: b.state, industry: b.industry, source: 'booking', notes: b.note ? `Booking note: ${b.note}` : null });
  // The personal link names the lead; otherwise match by phone, site, name and city, or email.
  const tok = String(b.lead_token || '');
  let lead = tok.length >= 16 ? await first(env, 'SELECT id FROM leads WHERE book_token = ?', tok) : null;
  if (!lead) {
    const rows = await all(env, 'SELECT id, business, phone_digits, website, city, zip, email FROM leads');
    const keys = new Set(dupKeys(data));
    lead = rows.find((r) => dupKeys(r).some((k) => keys.has(k)) || (r.email && r.email.toLowerCase() === email));
  }
  let leadId = lead?.id;
  if (!leadId) leadId = await insertLead(env, { ...data, stage: 'audit_booked', ...(tz ? { timezone: tz } : {}) }, null);
  const full = await first(env, 'SELECT * FROM leads WHERE id = ?', leadId);
  // Two people on the page at once: the second one to press Book gets a fresh list instead of a double booking.
  if (await first(env, 'SELECT id FROM leads WHERE id != ? AND meet_at > ? AND meet_at < ?', leadId, start - cfg.minutes * 60e3, start + cfg.minutes * 60e3)) return json(taken, 409);
  const rep = await pickRep(env, cfg);
  // Google first: a calendar event with a Meet link and Google's own invite. If Google fails, the booking still stands in the Hub.
  let m = { meet: null, id: null }, gErr = null;
  if (owner) {
    try {
      if (full.gcal_event_id && full.meet_at) { await moveMeeting(env, owner, full.gcal_event_id, start, cfg.minutes); m = { id: full.gcal_event_id, meet: full.meet_link }; }
      else m = await createMeeting(env, owner, { summary: `Rightway Growth consultation: ${full.business}`, description: AGENDA(full.business), start, minutes: cfg.minutes, attendees: [email], leadId });
    } catch (e) { gErr = e.message; m = { meet: null, id: null }; }
  }
  const link = m.meet || cfg.link || null;
  const set = { stage: 'audit_booked', meet_at: start, meet_link: link, gcal_event_id: m.id || null, meet_by: rep, next_action_at: start, next_action: 'Audit call (Call 2): open Present', updated_at: now() };
  if (rep && !full.owner_id) set.owner_id = rep;
  for (const k of ['contact_name', 'email', 'phone', 'phone_digits', 'website', 'city', 'state', 'industry']) if (data[k] && !full[k]) set[k] = data[k];
  if (tz) set.timezone = tz;
  if (b.sms_consent && !full.sms_stop) set.sms_consent = 1;
  Object.assign(set, rescore({ ...full, ...set, source: full.source || 'booking' }));
  const cols = Object.keys(set);
  await run(env, `UPDATE leads SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => set[k]), leadId);
  const repName = rep ? ((await first(env, 'SELECT name FROM users WHERE id = ?', rep))?.name || '').split(' ')[0] : '';
  await logActivity(env, { lead_id: leadId, type: 'meeting', body: `${full.meet_at ? 'Rebooked' : 'Booked'} online for ${new Date(start).toISOString()}${repName ? ` with ${repName}` : ''}${m.id ? ', Google invite sent' : ''}${b.sms_consent ? ', agreed to text reminders' : ''}` });
  const when = new Date(start).toLocaleString('en-US', { timeZone: cfg.tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const note = gErr ? ` Google Calendar failed (${gErr}) so the time is held in the Hub without a Meet link: reconnect Google on the Google page and send them a link.`
    : !link ? ' No meeting link: call them at the time, or send a link.' : '';
  await notifyLater({ env, defer }, { to: 'staff', kind: 'lead', title: `New booking: ${full.business}`, body: `${when}${repName ? `, ${repName}` : ''}.${note}`, url: `/#/pipeline/${leadId}` });
  // Confirmation email (with the calendar file) and text go out now, not on the next cron minute.
  // In the Worker this finishes after the response (waitUntil); without it (tests, local) it is awaited.
  await defer(automationTick(env).catch(() => 0));
  return json({ ok: true, start, meet: link, minutes: cfg.minutes, title: cfg.title, google: Boolean(m.id), confirm: !link });
}, { public: true });

// A private booking link for one lead (lead panel "Booking link", and {book} in automations).
route('GET', '/api/leads/:id/book-link', async ({ env, user, params, url }) => {
  requireStaff(user);
  const lead = await first(env, 'SELECT id, book_token FROM leads WHERE id = ?', params.id);
  if (!lead) throw new HttpError('Lead not found.', 404);
  return json({ url: `${url.origin}/book.html?l=${await bookToken(env, lead)}` });
});
