// Client meetings: monthly results calls and strategy calls with a Google Meet link and a calendar invite to the client.
// The agenda fills in from the client's numbers. Marking a meeting held (with notes) checks off that month's meeting task,
// and the summary shows in the client app. Without Google connected, paste any meeting link and it still tracks.
import { HttpError, json } from './util.js';
import { all, first, run, newId, now } from './db.js';
import { requireStaff, requireClientAccess, cleanEmail } from './auth.js';
import { route } from './router.js';
import { planOf, monthKey } from './plans.js';
import { googleReady, createMeeting, moveMeeting, cancelEvent, bookingOwner, bookingConfig } from './google.js';
import { notify } from './notify.js';

const text = (v, max = 2000) => (v == null ? null : String(v).replace(/\u0000/g, '').trim().slice(0, max) || null);
const parse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthOf = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

async function clientOr404(env, id) {
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', id);
  if (!c) throw new HttpError('Client not found.', 404);
  return c;
}

// A starting agenda from the latest report and this month's work. Plain text, edited before the call.
export function agendaText(c, rep, work) {
  const lines = [`Rightway Growth and ${c.name}`, ''];
  if (rep?.keywords?.length) {
    lines.push('1. Where you stand on Google Maps');
    for (const k of rep.keywords.slice(0, 3)) {
      const was = k.before?.top10Pct;
      lines.push(`   "${k.keyword}": first page (top 10) in ${k.now.top10Pct ?? 0}% of your area${was != null && was !== k.now.top10Pct ? ` (was ${was}%)` : ''}${k.now.centerRank ? `, #${k.now.centerRank} at your address` : ''}`);
    }
  } else lines.push('1. Where you stand on Google Maps (latest scan)');
  lines.push('2. What we did this month');
  if (work) lines.push(`   ${work.done} of ${work.total} tasks done${work.items?.length ? `: ${work.items.slice(0, 4).join('; ')}` : ''}`);
  if (rep?.reviews?.count != null) lines.push(`3. Reviews: ${rep.reviews.count}${rep.reviews.rating ? ` at ${rep.reviews.rating} stars` : ''}${rep.reviews.requestsSent ? `, ${rep.reviews.requestsSent} review requests sent` : ''}`);
  else lines.push('3. Reviews and calls');
  lines.push('4. Next month: the plan and what we need from you (photos, jobs to feature, questions customers ask)', '5. Your questions');
  return lines.join('\n');
}

async function suggestedAgenda(env, c) {
  const r = await first(env, 'SELECT data FROM reports WHERE client_id = ? ORDER BY month DESC LIMIT 1', c.id).catch(() => null);
  const rep = parse(r?.data);
  const m = monthKey();
  const tasks = await all(env, 'SELECT title, status, client_visible FROM tasks WHERE client_id = ? AND month = ?', c.id, m);
  const done = tasks.filter((t) => t.status === 'done');
  return agendaText(c, rep, { done: done.length, total: tasks.length, items: done.filter((t) => t.client_visible).map((t) => t.title) });
}

const out = (m, staff) => ({
  id: m.id, title: m.title, start: m.start_at, minutes: m.minutes, meet: m.meet_link, status: m.status, eventLink: staff ? m.event_link : undefined,
  calendar: Boolean(m.event_id), attendees: staff ? parse(m.attendees, []) : undefined, agenda: m.agenda || '', notes: staff ? m.notes || '' : undefined,
  summary: m.summary || '', created_at: m.created_at,
});

async function calendarOwner(env, user) {
  if (!googleReady(env)) return null;
  const me = await first(env, 'SELECT * FROM users WHERE id = ?', user.id);
  if (me?.google_token) return me;
  return bookingOwner(env, await bookingConfig(env));
}

route('GET', '/api/clients/:id/meetings', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  const c = await clientOr404(env, params.id);
  const staff = user.role !== 'client';
  const rows = await all(env, `SELECT * FROM meetings WHERE client_id = ? ${staff ? '' : "AND status != 'cancelled'"} ORDER BY start_at DESC LIMIT 60`, c.id);
  const res = { meetings: rows.map((m) => out(m, staff)) };
  if (staff) {
    const owner = await calendarOwner(env, user).catch(() => null);
    Object.assign(res, { google: Boolean(owner), googleEmail: owner?.google_email || null, minutes: planOf(c.plan).meetingMinutes || 30, email: c.contact_email || '', agenda: await suggestedAgenda(env, c) });
  }
  return json(res);
});

route('POST', '/api/clients/:id/meetings', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  const b = await body();
  const start = Number(new Date(b.start));
  if (!start || start < now() - 3600e3) throw new HttpError('Pick a time in the future.');
  const minutes = Math.min(180, Math.max(15, Number(b.minutes) || planOf(c.plan).meetingMinutes || 30));
  const monthName = MONTHS[new Date(start).getUTCMonth()];
  const title = text(b.title, 160) || `${c.name} and Rightway Growth: ${monthName} results`;
  const emails = [...new Set(String(b.emails ?? c.contact_email ?? '').split(/[,\s]+/).map((e) => cleanEmail(e)).filter(Boolean))].slice(0, 10);
  const agenda = text(b.agenda, 4000) || await suggestedAgenda(env, c);
  let meet = text(b.link, 500);
  if (meet && !/^https:\/\//i.test(meet)) throw new HttpError('Meeting links start with https://');
  let ev = null;
  let owner = null;
  if (!meet) {
    owner = await calendarOwner(env, user);
    if (!owner) throw new HttpError('Connect Google on the Google page to send invites with a Meet link, or paste a meeting link.', 400);
    ev = await createMeeting(env, owner, { summary: title, description: `${agenda}\n\nJoin with the Google Meet link in this invite.`, start, minutes, attendees: emails });
    meet = ev.meet;
  }
  const id = newId('mt_');
  await run(env, `INSERT INTO meetings (id, client_id, title, start_at, minutes, meet_link, event_id, event_link, event_owner, attendees, agenda, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`, id, c.id, title, start, minutes, meet, ev?.id || null, ev?.link || null, owner?.id || null, JSON.stringify(emails), agenda, user.id, now(), now());
  await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', newId('l_'), c.id, `Meeting booked: ${title}`, now(), user.id);
  await notify(env, { to: { clientUsers: c.id }, kind: 'update', title: 'Meeting booked with Rightway Growth', body: new Date(start).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), url: '/#/', slack: false }).catch(() => {});
  return json({ meeting: out(await first(env, 'SELECT * FROM meetings WHERE id = ?', id), true), invited: ev ? emails : [] });
});

route('PATCH', '/api/meetings/:id', async ({ env, user, params, body }) => {
  requireStaff(user);
  const m = await first(env, 'SELECT * FROM meetings WHERE id = ?', params.id);
  if (!m) throw new HttpError('Meeting not found.', 404);
  const b = await body();
  const set = {};
  for (const [k, col, max] of [['title', 'title', 160], ['agenda', 'agenda', 4000], ['notes', 'notes', 8000], ['summary', 'summary', 2000]]) if (k in b) set[col] = text(b[k], max);
  if ('link' in b) {
    const l = text(b.link, 500);
    if (l && !/^https:\/\//i.test(l)) throw new HttpError('Meeting links start with https://');
    set.meet_link = l;
  }
  const owner = m.event_owner ? await first(env, 'SELECT * FROM users WHERE id = ?', m.event_owner) : null;
  if ('start' in b || 'minutes' in b) {
    const start = 'start' in b ? Number(new Date(b.start)) : m.start_at;
    const minutes = Math.min(180, Math.max(15, Number(b.minutes) || m.minutes));
    if (!start || start < now() - 3600e3) throw new HttpError('Pick a time in the future.');
    if (m.event_id && owner) await moveMeeting(env, owner, m.event_id, start, minutes);
    Object.assign(set, { start_at: start, minutes, reminded_at: null });
  }
  if ('status' in b) {
    if (!['scheduled', 'held', 'cancelled'].includes(b.status)) throw new HttpError('Unknown status.');
    if (b.status === 'held' && !text(set.notes ?? m.notes)) throw new HttpError('Write the meeting notes first.');
    if (b.status === 'cancelled' && m.event_id && owner && m.status !== 'cancelled') await cancelEvent(env, owner, m.event_id).catch((e) => console.error('cancel event', e));
    set.status = b.status;
  }
  set.updated_at = now();
  const cols = Object.keys(set);
  await run(env, `UPDATE meetings SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => set[k]), m.id);
  if (set.status === 'held' && m.status !== 'held') {
    // Closes that month's meeting task (or the latest open one) and logs it for the client.
    const month = monthOf(set.start_at || m.start_at);
    const t = await first(env, "SELECT id FROM tasks WHERE client_id = ? AND kind = 'meeting' AND status IN ('todo','doing') ORDER BY month = ? DESC, month DESC LIMIT 1", m.client_id, month);
    if (t) await run(env, "UPDATE tasks SET status = 'done', done_at = ?, done_by = ?, note = COALESCE(note, ?) WHERE id = ?", now(), user.id, text(set.summary ?? m.summary, 300) || 'Meeting held', t.id);
    await run(env, 'UPDATE meetings SET task_id = ? WHERE id = ?', t?.id || null, m.id);
    await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', newId('l_'), m.client_id, `Meeting held: ${set.title || m.title}`, now(), user.id);
  }
  return json({ meeting: out(await first(env, 'SELECT * FROM meetings WHERE id = ?', m.id), true) });
});

route('DELETE', '/api/meetings/:id', async ({ env, user, params }) => {
  requireStaff(user);
  const m = await first(env, 'SELECT * FROM meetings WHERE id = ?', params.id);
  if (!m) throw new HttpError('Meeting not found.', 404);
  if (m.event_id && m.event_owner && m.status === 'scheduled') {
    const owner = await first(env, 'SELECT * FROM users WHERE id = ?', m.event_owner);
    if (owner) await cancelEvent(env, owner, m.event_id).catch((e) => console.error('cancel event', e));
  }
  await run(env, 'DELETE FROM meetings WHERE id = ?', m.id);
  return json({ ok: true });
});

route('GET', '/api/meetings/upcoming', async ({ env, user }) => {
  requireStaff(user);
  const rows = await all(env, `SELECT m.*, c.name AS client_name FROM meetings m JOIN clients c ON c.id = m.client_id
    WHERE m.status = 'scheduled' AND m.start_at >= ? ORDER BY m.start_at LIMIT 30`, now() - 3600e3);
  return json({ meetings: rows.map((m) => ({ ...out(m, true), client_id: m.client_id, client_name: m.client_name })) });
});
