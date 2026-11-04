// The team calendar. Every appointment the team books (dialer, lead page, booking page, and appointments added on the Hub calendar) is copied
// onto one shared Google calendar, the master calendar, so everyone sees who has what. The lead's own invite with the Meet link comes from the
// closer's Google calendar (whoever runs the call, leads.closer_id); the person who booked it stays in leads.meet_by. Before a time is given to
// a closer the Hub checks that closer's other audits, their Hub appointments and their Google busy times, so nobody gets double booked.
// The copies are kept in step by the cron (masterTick) as well as right away, so every booking path is covered.
import { HttpError, json } from './util.js';
import { all, first, run, now, getSettings, setSetting, token } from './db.js';
import { requireStaff, requireAdmin } from './auth.js';
import { route } from './router.js';
import { accessToken, googleReady, calendarAny, calendarFull, bookingOwner, bookingConfig, busyTimes, AGENDA } from './google.js';
import { logActivity } from './crm.js';

const API = 'https://www.googleapis.com/calendar/v3';
const TZ = 'America/New_York';
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const canCal = (u) => Boolean(u?.google_token && calendarAny(u.google_scopes));
const userRow = (env, id) => (id ? first(env, 'SELECT * FROM users WHERE id = ?', id) : null);
export const closerOf = (l) => l?.closer_id || l?.meet_by || null;
const clock = (t, tz = TZ) => new Date(t).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

async function gc(env, row, path, { method = 'GET', body } = {}) {
  const t = await accessToken(env, row);
  const res = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new HttpError(`Google Calendar: ${data.error?.message || `HTTP ${res.status}`}`, 502); e.gstatus = res.status; throw e; }
  return data;
}

// ---------- the master calendar ----------
export async function masterCal(env) {
  const s = await getSettings(env);
  try { const m = JSON.parse(s.master_cal || 'null'); if (m?.id && m?.owner) return m; } catch { /* not set */ }
  return null;
}
async function masterOwner(env, m) {
  const u = m ? await userRow(env, m.owner) : null;
  return canCal(u) ? u : null;
}

// ---------- double booking ----------
// Is this closer free? Their other audits, their Hub appointments and (when connected) their own Google calendar. Returns a reason or null.
export async function closerConflict(env, closerId, start, minutes = 30, { leadId = null, eventId = null, google = true } = {}) {
  if (!closerId || !start) return null;
  const end = start + minutes * 60e3;
  const who = firstName((await userRow(env, closerId))?.name) || 'They';
  const leads = await all(env, `SELECT id, business, meet_at FROM leads WHERE meet_at > ? AND meet_at < ? AND (closer_id = ? OR (closer_id IS NULL AND meet_by = ?))${leadId ? ' AND id != ?' : ''}`,
    start - 4 * 3600e3, end, closerId, closerId, ...(leadId ? [leadId] : []));
  const hit = leads.find((l) => l.meet_at < end && l.meet_at + minutes * 60e3 > start);
  if (hit) return `${who} already has ${hit.business} at ${clock(hit.meet_at)}.`;
  const evs = await all(env, `SELECT id, title, start_at, minutes FROM events WHERE owner_id = ? AND start_at > ? AND start_at < ?${eventId ? ' AND id != ?' : ''}`,
    closerId, start - 8 * 3600e3, end, ...(eventId ? [eventId] : [])).catch(() => []);
  const ev = evs.find((e) => e.start_at < end && e.start_at + (e.minutes || 30) * 60e3 > start);
  if (ev) return `${who} has "${ev.title}" at ${clock(ev.start_at)}.`;
  if (google) {
    const u = await userRow(env, closerId);
    if (canCal(u)) {
      const own = leadId ? await first(env, 'SELECT meet_at FROM leads WHERE id = ?', leadId) : null;
      const busy = await busyTimes(env, u, start - 60e3, end + 60e3).catch(() => []);
      // Their own copy of this very appointment is not a clash.
      if (busy.some(([s, e]) => s < end && e > start && !(own?.meet_at && s === own.meet_at))) return `${who}'s Google Calendar is busy at ${clock(start)}.`;
    }
  }
  return null;
}

// ---------- the lead's invite (with Meet) ----------
// Sent from the closer's own calendar when they connected Google, else the booker's, else the booking calendar owner's, with the closer as a guest.
export async function inviteLead(env, leadId, { minutes = 30, note = '' } = {}) {
  const l = await first(env, 'SELECT * FROM leads WHERE id = ?', leadId);
  if (!l?.meet_at || !googleReady(env)) return { google: false };
  const closer = await userRow(env, closerOf(l));
  const booker = l.meet_by && l.meet_by !== closer?.id ? await userRow(env, l.meet_by) : null;
  const closerEmail = closer ? (closer.google_email || closer.email || '').toLowerCase() : '';
  const start = { dateTime: new Date(l.meet_at).toISOString() };
  const end = { dateTime: new Date(l.meet_at + minutes * 60e3).toISOString() };
  const description = [AGENDA(l.business), closer ? `\nYour consultant: ${firstName(closer.name)}, Rightway Growth.` : '', note ? `\nNote: ${String(note).slice(0, 500)}` : ''].join('');
  if (l.gcal_event_id) {
    // Moving or handing over an existing invite: change it where it lives, so the lead gets an update, not a second invite.
    let org = await userRow(env, l.gcal_owner);
    if (!canCal(org)) org = canCal(booker) ? booker : canCal(closer) ? closer : await bookingOwner(env, await bookingConfig(env));
    if (!org) return { google: false };
    const cal = encodeURIComponent(l.gcal_cal || 'primary');
    const ev = await gc(env, org, `/calendars/${cal}/events/${encodeURIComponent(l.gcal_event_id)}`);
    const have = new Map((ev.attendees || []).map((a) => [String(a.email || '').toLowerCase(), a]));
    for (const e of [l.email, org.id !== closer?.id ? closerEmail : '']) if (e && !have.has(e.toLowerCase())) have.set(e.toLowerCase(), { email: e });
    const made = await gc(env, org, `/calendars/${cal}/events/${encodeURIComponent(l.gcal_event_id)}?sendUpdates=all`, { method: 'PATCH', body: { start, end, attendees: [...have.values()] } });
    return { google: true, id: made.id, meet: l.meet_link || made.hangoutLink || null, organizer: org.id };
  }
  const org = canCal(closer) ? closer : canCal(booker) ? booker : await bookingOwner(env, await bookingConfig(env));
  if (!org) return { google: false };
  const attendees = [l.email, org.id !== closer?.id ? closerEmail : ''].filter(Boolean).map((email) => ({ email }));
  const made = await gc(env, org, '/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all', {
    method: 'POST',
    body: {
      summary: `Rightway Growth consultation: ${l.business}`, description, start, end, attendees,
      conferenceData: { createRequest: { requestId: token(12), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
      reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 1440 }, { method: 'popup', minutes: 15 }] },
      extendedProperties: { private: { rwLead: l.id } },
    },
  });
  const meet = made.hangoutLink || made.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri || null;
  await run(env, 'UPDATE leads SET gcal_event_id = ?, gcal_owner = ?, gcal_cal = ?, meet_link = COALESCE(?, meet_link) WHERE id = ?', made.id, org.id, 'primary', meet, l.id);
  return { google: true, id: made.id, meet, organizer: org.id };
}

// ---------- copies on the master calendar ----------
const COLORS = ['9', '10', '5', '11', '3', '7', '6', '2', '4', '1', '8'];
const colorFor = (id) => { let h = 0; for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) | 0; return COLORS[Math.abs(h) % COLORS.length]; };
const gone = (l) => !l.meet_at || ['lost', 'dnc'].includes(l.stage);
export const leadSig = (l, closerName) => (gone(l) ? 'gone' : [l.meet_at, closerName, l.business, l.meet_link || '', l.stage].join('|'));
export const eventSig = (e, ownerName) => [e.start_at, e.minutes, e.title, e.link || '', ownerName].join('|');

async function upsertCopy(env, owner, m, existingId, body) {
  const cal = encodeURIComponent(m.id);
  if (existingId) {
    try { return await gc(env, owner, `/calendars/${cal}/events/${encodeURIComponent(existingId)}?sendUpdates=none`, { method: 'PATCH', body }); }
    catch (e) { if (![404, 410].includes(e.gstatus)) throw e; }
  }
  return gc(env, owner, `/calendars/${cal}/events?sendUpdates=none`, { method: 'POST', body });
}
async function dropCopy(env, owner, m, id) {
  if (!id) return;
  try { await gc(env, owner, `/calendars/${encodeURIComponent(m.id)}/events/${encodeURIComponent(id)}?sendUpdates=none`, { method: 'DELETE' }); }
  catch (e) { if (![404, 410].includes(e.gstatus)) throw e; }
}

export async function mirrorLead(env, leadId, ctx = {}) {
  const m = ctx.m || await masterCal(env);
  const owner = ctx.owner || await masterOwner(env, m);
  if (!m || !owner) return false;
  const l = await first(env, 'SELECT * FROM leads WHERE id = ?', leadId);
  if (!l) return false;
  const closer = await userRow(env, closerOf(l));
  const booker = l.meet_by ? await userRow(env, l.meet_by) : null;
  const sig = leadSig(l, closer?.name || '');
  if (sig === 'gone') {
    await dropCopy(env, owner, m, l.master_event_id);
    await run(env, 'UPDATE leads SET master_event_id = NULL, master_sig = ? WHERE id = ?', sig, l.id);
    return true;
  }
  const s = await getSettings(env);
  const origin = s.hub_origin || s.autoscan_origin || '';
  const body = {
    summary: `${firstName(closer?.name) || 'Nobody yet'}: ${l.business}`,
    description: [`Audit (${l.stage === 'audit_booked' ? 'booked' : l.stage})`, `Runs the call: ${closer?.name || 'nobody assigned yet'}`, `Booked by: ${booker?.name || (l.source === 'booking' ? 'the booking page' : 'unknown')}`,
      l.contact_name ? `Contact: ${l.contact_name}` : '', l.phone ? `Phone: ${l.phone}` : '', l.meet_link ? `Join: ${l.meet_link}` : '', origin ? `Open in the Hub: ${origin}/#/pipeline/${l.id}` : ''].filter(Boolean).join('\n'),
    start: { dateTime: new Date(l.meet_at).toISOString() }, end: { dateTime: new Date(l.meet_at + 30 * 60e3).toISOString() },
    location: l.meet_link || '', colorId: colorFor(closer?.id), transparency: 'opaque',
    extendedProperties: { private: { rwLead: l.id, rwCloser: closer?.id || '' } },
  };
  const made = await upsertCopy(env, owner, m, l.master_event_id, body);
  await run(env, 'UPDATE leads SET master_event_id = ?, master_sig = ? WHERE id = ?', made.id, sig, l.id);
  return true;
}

export async function mirrorEvent(env, eventId, ctx = {}) {
  const m = ctx.m || await masterCal(env);
  const owner = ctx.owner || await masterOwner(env, m);
  if (!m || !owner) return false;
  const e = await first(env, 'SELECT * FROM events WHERE id = ?', eventId);
  if (!e) return false;
  const who = await userRow(env, e.owner_id);
  const body = {
    summary: `${firstName(who?.name) || 'Team'}: ${e.title}`,
    description: [e.note || '', e.link ? `Join: ${e.link}` : '', e.guest_email ? `Guest: ${e.guest_email}` : ''].filter(Boolean).join('\n'),
    start: { dateTime: new Date(e.start_at).toISOString() }, end: { dateTime: new Date(e.start_at + (e.minutes || 30) * 60e3).toISOString() },
    location: e.link || '', colorId: colorFor(e.owner_id), extendedProperties: { private: { rwEvent: e.id } },
  };
  const made = await upsertCopy(env, owner, m, e.master_event_id, body);
  await run(env, 'UPDATE events SET master_event_id = ?, master_sig = ? WHERE id = ?', made.id, eventSig(e, who?.name || ''), e.id);
  return true;
}
export async function unmirror(env, masterEventId) {
  const m = await masterCal(env);
  const owner = await masterOwner(env, m);
  if (m && owner && masterEventId) await dropCopy(env, owner, m, masterEventId).catch(() => {});
}

// Cron and "Sync now": bring the master calendar in step with the Hub, a few at a time (each is one Google call).
export async function masterTick(env, limit = 6) {
  const m = await masterCal(env);
  const owner = await masterOwner(env, m);
  if (!m || !owner) return 0;
  const names = Object.fromEntries((await all(env, 'SELECT id, name FROM users')).map((u) => [u.id, u.name || '']));
  const leads = await all(env, 'SELECT * FROM leads WHERE (meet_at > ?) OR (master_event_id IS NOT NULL AND (meet_at IS NULL OR stage IN (\'lost\', \'dnc\'))) LIMIT 400', now() - 864e5);
  const evs = await all(env, 'SELECT * FROM events WHERE start_at > ? LIMIT 400', now() - 864e5).catch(() => []);
  const todo = [
    ...leads.filter((l) => leadSig(l, names[closerOf(l)] || '') !== (l.master_sig || '') && !(leadSig(l, '') === 'gone' && !l.master_event_id)).map((l) => ['lead', l.id]),
    ...evs.filter((e) => eventSig(e, names[e.owner_id] || '') !== (e.master_sig || '')).map((e) => ['event', e.id]),
  ];
  let n = 0;
  for (const [kind, id] of todo.slice(0, limit)) {
    try { await (kind === 'lead' ? mirrorLead(env, id, { m, owner }) : mirrorEvent(env, id, { m, owner })); n++; } catch (e) { console.error('master calendar', e.message); }
  }
  return n;
}

// Leads booked by a path that does not send an invite itself (a Booked result from dial out, an import, a teammate without Google): the cron sends it.
export async function inviteTick(env, limit = 2) {
  if (!googleReady(env)) return 0;
  const rows = await all(env, "SELECT id FROM leads WHERE stage = 'audit_booked' AND meet_at > ? AND gcal_event_id IS NULL AND email IS NOT NULL AND email != '' AND invite_tried IS NULL AND updated_at < ? LIMIT ?", now() + 30 * 60e3, now() - 120e3, limit);
  let n = 0;
  for (const r of rows) {
    await run(env, 'UPDATE leads SET invite_tried = ? WHERE id = ?', now(), r.id);
    try { if ((await inviteLead(env, r.id)).google) n++; } catch (e) { console.error('invite', e.message); }
  }
  return n;
}

// ---------- routes ----------
route('GET', '/api/team-cal', async ({ env, user }) => {
  requireStaff(user);
  const m = await masterCal(env);
  const owner = m ? await userRow(env, m.owner) : null;
  const me = await userRow(env, user.id);
  let calendars = [];
  if (user.role === 'admin' && canCal(me) && calendarFull(me.google_scopes)) {
    try {
      const d = await gc(env, me, '/users/me/calendarList?minAccessRole=writer&maxResults=50');
      calendars = (d.items || []).filter((c) => !c.primary).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary || c.id }));
    } catch { calendars = []; }
  }
  const pending = m ? (await first(env, 'SELECT COUNT(*) AS n FROM leads WHERE meet_at > ? AND master_event_id IS NULL', now()))?.n || 0 : 0;
  return json({
    master: m ? { id: m.id, name: m.name, owner: owner?.name || '', ownerOk: canCal(owner), link: `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(m.id)}`, pending } : null,
    canSetUp: user.role === 'admin' && canCal(me) && calendarFull(me.google_scopes), connected: canCal(me), calendars,
  });
});

// Share the master calendar with everyone on the team: owners can change events, teammates can see them.
async function shareWithTeam(env, m, owner) {
  const team = await all(env, "SELECT id, name, email, google_email, role FROM users WHERE role IN ('admin','team') AND id != ?", owner.id);
  const out = [];
  for (const u of team) {
    const email = (u.google_email || u.email || '').toLowerCase();
    if (!email) continue;
    try {
      await gc(env, owner, `/calendars/${encodeURIComponent(m.id)}/acl?sendNotifications=true`, { method: 'POST', body: { role: u.role === 'admin' ? 'writer' : 'reader', scope: { type: 'user', value: email } } });
      out.push({ name: u.name, email, ok: true });
    } catch (e) { out.push({ name: u.name, email, ok: false, error: e.message }); }
  }
  return out;
}

route('POST', '/api/team-cal', async ({ env, user, body }) => {
  requireAdmin(user);
  const me = await userRow(env, user.id);
  if (!canCal(me) || !calendarFull(me.google_scopes)) throw new HttpError('Connect Google with full Calendar first: Google page, Turn on all.', 400);
  const b = await body();
  let id = String(b.id || '').trim(), name = String(b.name || '').trim().slice(0, 80);
  if (!id) {
    const made = await gc(env, me, '/calendars', { method: 'POST', body: { summary: name || 'Rightway Appointments', description: 'Every appointment booked in the Rightway Hub, with who runs it. Kept up to date by the Hub.', timeZone: TZ } });
    id = made.id; name = made.summary;
    await gc(env, me, '/users/me/calendarList', { method: 'POST', body: { id } }).catch(() => {});
  } else {
    const c = await gc(env, me, `/users/me/calendarList/${encodeURIComponent(id)}`);
    if (!['owner', 'writer'].includes(c.accessRole)) throw new HttpError('You can only use a calendar you can change.');
    name = c.summaryOverride || c.summary || name;
  }
  const m = { id, name, owner: me.id };
  await setSetting(env, 'master_cal', JSON.stringify(m));
  // A new calendar means new copies: forget the old ones so the cron fills this one.
  await run(env, 'UPDATE leads SET master_event_id = NULL, master_sig = NULL WHERE master_event_id IS NOT NULL OR master_sig IS NOT NULL');
  await run(env, 'UPDATE events SET master_event_id = NULL, master_sig = NULL').catch(() => {});
  const shared = b.share === false ? [] : await shareWithTeam(env, m, me);
  const synced = await masterTick(env, 12);
  return json({ ok: true, master: m, shared, synced });
});

route('POST', '/api/team-cal/share', async ({ env, user }) => {
  requireAdmin(user);
  const m = await masterCal(env);
  const owner = await masterOwner(env, m);
  if (!m || !owner) throw new HttpError('Set up the team calendar first.', 400);
  return json({ shared: await shareWithTeam(env, m, owner) });
});

route('POST', '/api/team-cal/sync', async ({ env, user }) => {
  requireStaff(user);
  const m = await masterCal(env);
  if (!m) throw new HttpError('Set up the team calendar first (Settings).', 400);
  if (!(await masterOwner(env, m))) throw new HttpError('The owner of the team calendar needs to sign in to Google again (Google page, Turn on all).', 400);
  return json({ synced: await masterTick(env, 15) });
});

route('DELETE', '/api/team-cal', async ({ env, user }) => {
  requireAdmin(user);
  await setSetting(env, 'master_cal', '');
  return json({ ok: true });
});

// Hand an appointment to a closer. Refuses a clash unless forced, then updates the invite and the team calendar.
route('PUT', '/api/leads/:id/closer', async ({ env, user, params, body, defer }) => {
  requireStaff(user);
  const l = await first(env, 'SELECT * FROM leads WHERE id = ?', params.id);
  if (!l) throw new HttpError('Lead not found.', 404);
  const b = await body();
  const closer = b.closer_id ? await first(env, "SELECT id, name FROM users WHERE id = ? AND role IN ('admin','team')", b.closer_id) : null;
  if (b.closer_id && !closer) throw new HttpError('Pick someone on the team.');
  if (closer && l.meet_at && !b.force) {
    const clash = await closerConflict(env, closer.id, l.meet_at, 30, { leadId: l.id });
    if (clash) return json({ error: clash, conflict: true }, 409);
  }
  await run(env, 'UPDATE leads SET closer_id = ?, updated_at = ? WHERE id = ?', closer?.id || null, now(), l.id);
  await logActivity(env, { lead_id: l.id, type: 'note', body: closer ? `Call handed to ${closer.name}` : 'Closer removed', by: user.id });
  let invite = null;
  if (closer && l.meet_at && l.meet_at > now()) invite = await inviteLead(env, l.id).catch((e) => ({ error: e.message }));
  await defer(mirrorLead(env, l.id).catch(() => false));
  if (closer && closer.id !== user.id) {
    const { notifyLater } = await import('./notify.js');
    await notifyLater({ env, defer }, { to: [closer.id], kind: 'meeting', title: `You have a new audit: ${l.business}`, body: l.meet_at ? clock(l.meet_at) : 'No time yet', url: `/#/pipeline/${l.id}` });
  }
  return json({ ok: true, closer: closer ? { id: closer.id, name: closer.name } : null, invite });
});

// Is this person free at that time? Used by the booking form before it books.
route('GET', '/api/closers/free', async ({ env, user, url }) => {
  requireStaff(user);
  const start = Number(url.searchParams.get('start'));
  const minutes = Number(url.searchParams.get('minutes')) || 30;
  const leadId = url.searchParams.get('lead') || null;
  const team = await all(env, "SELECT id, name FROM users WHERE role IN ('admin','team') ORDER BY name");
  const out = [];
  for (const u of team) out.push({ id: u.id, name: u.name, clash: start ? await closerConflict(env, u.id, start, minutes, { leadId }) : null });
  return json({ closers: out });
});
