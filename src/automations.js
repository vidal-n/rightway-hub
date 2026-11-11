// Automations: booking confirmations and appointment reminders by email (Resend) and text (Twilio, same consent, STOP and hours rules
// as every other text). Owners edit them on the Automations page, write them by hand or with Claude, and send themselves a test.
// The cron sends what is due every minute; each automation goes out once per lead per appointment time (automation_log).
import { HttpError, json } from './util.js';
import { all, first, run, newId, now, getSettings, setSetting } from './db.js';
import { requireStaff, requireAdmin } from './auth.js';
import { route } from './router.js';
import { sendEmail, canEmail } from './email.js';
import { logClaude } from './costs.js';
import { token } from './db.js';
import { icsCalendar, googleAddUrl } from '../public/js/ics.js';
import { zoned, wallDate } from '../public/js/slots.js';
import { clockIn, validZone } from '../public/js/apptime.js';

export const TRIGGERS = { booked: 'When an appointment is booked', morning: 'The morning of the appointment', before: 'Before the appointment', after: 'After a missed appointment (no show)' };
export const VARS = ['first', 'business', 'date', 'time', 'when', 'meet_line', 'meet_or_call', 'link', 'rep', 'rep_first', 'book', 'company'];

// Three ready sets in V's words, from the cold call script: the confirmation at booking (with the Google Meet link), the morning of
// ("found something crazy"), 3 hours before (the link again) and 10 minutes before (the link). Email only is for now, until A2P 10DLC
// is approved for texts; then Text only, or Email and text. In Email and text, a text that cannot go (no permission yet, STOP, outside
// 8am to 8pm their time) goes out as an email instead (fallback), so nobody misses the link.
// {meet_line} is the Meet link on its own line (a Join button in the email) or "I'll call you"; {meet_or_call} is the same for a text.
const NO_SHOW = { id: 'no_show', name: 'Missed appointment follow up (text)', on: false, channel: 'sms', trigger: 'after', offset: 30,
  body: 'Hey {first}, we missed you today. Want to pick a new time? {book}' };
const E = {
  confirm: { id: 'confirm_email', name: 'Booked: confirmation with the Meet link (email)', on: true, channel: 'email', trigger: 'booked', offset: 0,
    subject: "You're booked, {first}: {when}",
    body: "Hey {first},\n\nIt's {rep_first} from RightWay Growth. You're all set for {date} at {time}.\n\nHere's your Google Meet link. It's in your calendar invite too, and I'll send it again before we talk:\n{meet_line}\n\nBefore then I'm going to look into all your competitors, break down their reviews and their websites, and see what they're doing compared to you. So even if we don't work together, you're still gonna walk away knowing all of it.\n\nIf something comes up, pick a new time here: {book}\n\nTalk soon,\n{rep}" },
  morning: { id: 'morning_email', name: 'Morning of: found something (email)', on: true, channel: 'email', trigger: 'morning', offset: 510,
    subject: 'Looked into all your competitors, {first}',
    body: "Hey {first}, looked into all your competitors, found something crazy, so excited to show you.\n\nSee you at {time}. Here's the Google Meet so it's handy:\n{meet_line}\n\n{rep}" },
  three: { id: 'three_hour_email', name: '3 hours before: the Meet link again (email)', on: true, channel: 'email', trigger: 'before', offset: 180,
    subject: 'Today at {time}: your Google Meet link',
    body: "Hey {first}, super excited! Here's the Google Meet link again so you have it ready:\n{meet_line}\n\nLet me know you got it OK.\n\n{rep}" },
  ten: { id: 'ten_min_email', name: '10 minutes before: join link (email)', on: true, channel: 'email', trigger: 'before', offset: 10,
    subject: 'Starting in 10 minutes: join here',
    body: "Hey {first}, here's the Google Meet, super excited to chat with you.\n{meet_line}\n\n{rep}" },
};
const T = {
  confirm: { id: 'confirm_text', name: 'Booked: confirmation with the Meet link (text)', on: true, channel: 'sms', trigger: 'booked', offset: 0,
    body: "Hey {first}, it's {rep_first} with RightWay Growth. You're all set for {when}. Here's the Google Meet link: {meet_or_call}" },
  confirmBoth: { id: 'confirm_text_short', name: 'Booked: heads up, link is in your email (text)', on: true, channel: 'sms', trigger: 'booked', offset: 0,
    body: "Hey {first}, it's {rep_first} with RightWay Growth. You're all set for {when}. I just emailed you the Google Meet link." },
  morning: { id: 'morning_text', name: 'Morning of: found something (text)', on: true, channel: 'sms', trigger: 'morning', offset: 510, fallback: true,
    subject: 'Looked into all your competitors, {first}',
    body: 'Hey {first}, looked into all your competitors, found something crazy, so excited to show you.' },
  three: { id: 'three_hour_text', name: '3 hours before: the Meet link (text)', on: true, channel: 'sms', trigger: 'before', offset: 180,
    body: "Hey {first}, super excited! Here's the Google Meet link for later: {meet_or_call} Let me know if you have it OK." },
  threeBoth: { id: 'three_hour_text_short', name: '3 hours before: did you get the link? (text)', on: true, channel: 'sms', trigger: 'before', offset: 180,
    body: 'Hey {first}, super excited! I emailed you the Google Meet link. Let me know if you have it OK.' },
  ten: { id: 'ten_min_text', name: '10 minutes before: join link (text)', on: true, channel: 'sms', trigger: 'before', offset: 10, fallback: true,
    subject: 'Starting in 10 minutes: join here',
    body: "Hey {first}, here's the Google Meet, super excited to chat with you. {meet_or_call}" },
};
export const AUTOMATION_SETS = {
  email: { name: 'Email only', note: 'Use now, while texts wait on A2P approval.', list: [E.confirm, E.morning, E.three, E.ten, NO_SHOW] },
  sms: { name: 'Text only', note: 'After A2P is approved. Google still emails its own invite.', list: [T.confirm, T.morning, T.three, T.ten, NO_SHOW] },
  both: { name: 'Email and text', note: 'After A2P is approved. The link goes by email, texts give the heads up; a text that cannot go is sent as an email.', list: [E.confirm, T.confirmBoth, T.morning, E.three, T.threeBoth, T.ten, NO_SHOW] },
};
export const DEFAULT_AUTOMATIONS = AUTOMATION_SETS.email.list;

export async function getAutomations(env) {
  const raw = (await getSettings(env)).automations;
  if (raw) { try { const l = JSON.parse(raw); if (Array.isArray(l) && l.length) return l; } catch { /* default */ } }
  return DEFAULT_AUTOMATIONS;
}

export function cleanAutomation(a = {}) {
  const channel = a.channel === 'sms' ? 'sms' : 'email';
  const trigger = TRIGGERS[a.trigger] ? a.trigger : 'booked';
  const out = {
    id: /^[a-z0-9_]{2,40}$/.test(a.id || '') ? a.id : `a_${Math.random().toString(36).slice(2, 10)}`,
    name: String(a.name || 'Automation').trim().slice(0, 80), on: Boolean(a.on), channel, trigger,
    offset: trigger === 'booked' ? 0 : trigger === 'morning' ? Math.max(300, Math.min(720, Math.round(Number(a.offset) || 510))) : Math.max(5, Math.min(14 * 1440, Math.round(Number(a.offset) || 60))),
    fallback: channel === 'sms' && Boolean(a.fallback),
    body: String(a.body || '').replace(/\r/g, '').slice(0, channel === 'sms' ? 480 : 6000),
  };
  if (channel === 'email' || out.fallback) out.subject = String(a.subject || '').trim().slice(0, 160);
  if (!out.body.trim()) throw new HttpError(`"${out.name}" has no message.`);
  if (channel === 'email' && !out.subject) throw new HttpError(`"${out.name}" needs a subject.`);
  return out;
}

const TZ_DEFAULT = 'America/New_York';
// Fill the template for one lead and appointment. Pure.
export function fillTemplate(t, { lead = {}, start, rep = '', repFirst = '', tz = TZ_DEFAULT, bookUrl = '' } = {}) {
  const d = start ? new Date(start) : null;
  // The time is written in the lead's own zone with its name (12:45 PM EST), so it matches what they see on their clock.
  const zone = validZone(lead.timezone) || validZone(tz) || TZ_DEFAULT;
  const date = d ? d.toLocaleDateString('en-US', { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric' }) : '';
  const time = d ? clockIn(d, zone) : '';
  const v = {
    first: (lead.contact_name || '').split(' ')[0] || 'there', business: lead.business || 'your business', date, time, when: d ? `${date} at ${time}` : '',
    link: lead.meet_link ? `Join here: ${lead.meet_link}` : 'We will call you at this number and send the screen share link.',
    rep: rep || 'The RightWay Growth team', rep_first: repFirst || (rep ? rep.split(',')[0] : '') || 'the team', book: bookUrl, company: 'RightWay Growth',
    meet_line: lead.meet_link || "I'll call you at the number you gave me.", meet_or_call: lead.meet_link || "I'll call you at this number.",
  };
  return String(t || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
}

// Which automations are due for this lead right now. Pure: the cron and the tests use it.
export function dueFor(autos, lead, t, sent = new Set()) {
  if (!lead.meet_at) return [];
  const out = [];
  for (const a of autos) {
    if (!a.on) continue;
    const key = `${a.id}:${lead.meet_at}`;
    if (sent.has(key)) continue;
    const until = lead.meet_at - t;
    if (a.trigger === 'booked' && until > 10 * 60e3) out.push(a);
    // The morning of: at the set clock time in their time zone, only when the meeting is at least 4 hours later (else the 3 hour reminder covers it).
    if (a.trigger === 'morning') {
      const tz = lead.timezone || TZ_DEFAULT;
      const day = wallDate(tz, lead.meet_at);
      const at = zoned(day.y, day.m, day.d, Math.floor(a.offset / 60), a.offset % 60, tz);
      if (t >= at && t < at + 45 * 60e3 && lead.meet_at - at >= 4 * 3600e3) out.push(a);
    }
    // Reminders go out inside a 45 minute window after their moment, so a late booking never gets a reminder that is already stale.
    if (a.trigger === 'before' && until <= a.offset * 60e3 && until > a.offset * 60e3 - 45 * 60e3 && until > 0) out.push(a);
    if (a.trigger === 'after' && lead.stage === 'no_show' && -until >= a.offset * 60e3 && -until < a.offset * 60e3 + 6 * 3600e3) out.push(a);
  }
  return out;
}

async function sendOne(env, a, lead, ctx) {
  const body = fillTemplate(a.body, ctx);
  if (a.channel === 'email') {
    if (!canEmail(env)) throw new Error('Email is not set up (RESEND_API_KEY).');
    if (!lead.email) throw new Error('No email on the lead.');
    // Confirmations and reminders carry the appointment: a calendar file for Apple Calendar and Outlook, and a link for Google Calendar.
    // Not when Google already sent its own invite, or they would get the appointment twice.
    const withCal = (a.trigger === 'booked' || a.trigger === 'before') && lead.meet_at && !lead.gcal_event_id;
    const add = withCal ? googleAddUrl({ title: 'Rightway Growth: your free Google clarity audit', start: lead.meet_at, minutes: 30, location: lead.meet_link || '' }) : '';
    const text = withCal && a.trigger === 'booked' && !/calendar\.google\.com/.test(body) ? `${body}\n\nAdd it to your calendar: ${add}\nThe attached file opens in Apple Calendar and Outlook.` : body;
    await sendEmail(env, { to: lead.email, subject: fillTemplate(a.subject, ctx), text, html: emailHtml(text),
      attachments: withCal ? [{ filename: 'appointment.ics', content: b64(appointmentIcs(lead)), content_type: 'text/calendar; charset=UTF-8' }] : undefined });
    return lead.email;
  }
  const { sendText } = await import('./sms.js');
  try { await sendText(env, lead, body, { id: lead.closer_id || lead.meet_by || null }, ctx.origin); return lead.phone; }
  catch (e) {
    if (!a.fallback || !lead.email || !canEmail(env)) throw e;
    await sendEmail(env, { to: lead.email, subject: fillTemplate(a.subject || 'A quick note from RightWay Growth', ctx), text: body, html: emailHtml(body) });
    return `${lead.email} (email, text could not go: ${String(e.message || e).slice(0, 60)})`;
  }
}

// Plain text in, simple branded email out. A line that is only a meeting link becomes a big Join button, so the link is one tap away.
export function emailHtml(text) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const buttons = [];
  const lines = String(text || '').split('\n').map((raw) => {
    const u = raw.trim();
    if (/^https:\/\/\S+$/.test(u) && /meet\.google\.com|zoom\.us|teams\.microsoft\.com/.test(u)) { buttons.push(u); return `@@BTN${buttons.length - 1}@@`; }
    return esc(raw);
  });
  const label = (u) => (/meet\.google\.com/.test(u) ? 'Join the Google Meet' : /zoom\.us/.test(u) ? 'Join the Zoom' : 'Join the meeting');
  const body = lines.map((l) => (/^@@BTN\d+@@$/.test(l) ? l : l.startsWith('- ') ? `<li style="margin:0 0 4px">${l.slice(2)}</li>` : l ? `<p style="margin:0 0 12px">${l}</p>` : ''))
    .join('').replace(/(<li[\s\S]*?<\/li>)+/g, (m) => `<ul style="margin:0 0 12px;padding-left:18px">${m}</ul>`)
    .replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0A6B4C">$1</a>')
    .replace(/@@BTN(\d+)@@/g, (_, i) => { const u = buttons[Number(i)]; return `<p style="margin:4px 0 16px"><a href="${esc(u)}" style="display:inline-block;background:#23B07E;color:#ffffff;padding:13px 22px;border-radius:10px;font-weight:700;text-decoration:none">${label(u)}</a><br><span style="font-size:12px;color:#61716B">${esc(u)}</span></p>`; });
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#0F1B17;max-width:560px">
    <div style="font-weight:700;letter-spacing:.08em;font-size:12px;color:#0A6B4C;text-transform:uppercase;margin-bottom:14px">RightWay Growth</div>${body}</div>`;
}

// A private booking link for one lead: opens the booking page with what we know filled in and asks only for what is missing.
export async function bookToken(env, lead) {
  if (lead?.book_token) return lead.book_token;
  if (!lead?.id || String(lead.id) === 'test') return null;
  const t = token(18);
  try { await run(env, 'UPDATE leads SET book_token = ? WHERE id = ? AND book_token IS NULL', t, lead.id); } catch { return null; }
  const row = await first(env, 'SELECT book_token FROM leads WHERE id = ?', lead.id).catch(() => null);
  return row?.book_token || null;
}

// The appointment as a calendar file, for the email attachment.
export function appointmentIcs(lead, minutes = 30) {
  return icsCalendar([{ uid: `lead-${lead.id}-${lead.meet_at}`, title: 'Rightway Growth: your free Google clarity audit', start: lead.meet_at, minutes,
    description: [lead.meet_link ? `Join: ${lead.meet_link}` : 'We will call you at the number you gave us.', 'Questions: reply to the email this came with.'].join('\n'), location: lead.meet_link || '' }], { name: 'Rightway Growth' });
}
const b64 = (s) => { const b = new TextEncoder().encode(s); let t = ''; for (let i = 0; i < b.length; i += 8192) t += String.fromCharCode(...b.subarray(i, i + 8192)); return btoa(t); };

async function context(env, lead) {
  const s = await getSettings(env);
  const origin = s.hub_origin || s.autoscan_origin || '';
  const repId = lead.closer_id || lead.meet_by;
  const rep = (repId ? (await first(env, 'SELECT name FROM users WHERE id = ?', repId))?.name : '') || (await first(env, "SELECT name FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1").catch(() => null))?.name || '';
  const bt = await bookToken(env, lead);
  return { lead, start: lead.meet_at, rep: rep.split(' ')[0] ? `${rep.split(' ')[0]}, RightWay Growth` : '', repFirst: rep.split(' ')[0] || '', tz: s.book_tz || TZ_DEFAULT, bookUrl: origin ? `${origin}/book.html${bt ? `?l=${bt}` : ''}` : '', origin };
}

// Every minute: send what is due. At most 20 sends a run.
export async function automationTick(env, t = now()) {
  const autos = (await getAutomations(env)).filter((a) => a.on);
  if (!autos.length) return 0;
  const leads = await all(env, `SELECT * FROM leads WHERE meet_at IS NOT NULL AND meet_at > ? AND meet_at < ? AND dnc = 0 LIMIT 300`, t - 2 * 864e5, t + 15 * 864e5);
  if (!leads.length) return 0;
  const logs = await all(env, `SELECT auto_id, lead_id, meet_at FROM automation_log WHERE lead_id IN (${leads.map(() => '?').join(',')})`, ...leads.map((l) => l.id));
  let n = 0;
  for (const lead of leads) {
    const sent = new Set(logs.filter((x) => x.lead_id === lead.id).map((x) => `${x.auto_id}:${x.meet_at}`));
    const waitForLink = !lead.meet_link && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && t - (lead.updated_at || 0) < 3 * 60e3;
    for (const a of dueFor(autos, lead, t, sent).filter((x) => !(waitForLink && x.trigger === 'booked'))) {
      if (n >= 20) return n;
      n++;
      let status = 'sent', error = null, to = null;
      try { to = await sendOne(env, a, lead, await context(env, lead)); } catch (e) { status = 'failed'; error = String(e.message || e).slice(0, 300); }
      await run(env, 'INSERT OR IGNORE INTO automation_log (id, auto_id, lead_id, meet_at, channel, status, error, to_addr, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        newId('al_'), a.id, lead.id, lead.meet_at, a.channel, status, error, to, t);
      if (status === 'sent') await run(env, 'INSERT INTO activities (id, lead_id, type, body, at) VALUES (?, ?, ?, ?, ?)', newId('a_'), lead.id, a.channel === 'email' ? 'email' : 'sms', `Automation: ${a.name}`, t);
    }
  }
  return n;
}

route('GET', '/api/automations', async ({ env, user }) => {
  requireAdmin(user);
  const s = await getSettings(env);
  return json({ automations: await getAutomations(env), triggers: TRIGGERS, vars: VARS, custom: Boolean(s.automations), sets: Object.fromEntries(Object.entries(AUTOMATION_SETS).map(([k, v]) => [k, { name: v.name, note: v.note }])), set: s.automation_set || (s.automations ? 'custom' : 'email'), email: canEmail(env), sms: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN), ai: Boolean(env.ANTHROPIC_API_KEY), canEdit: user.role === 'admin' });
});

route('PUT', '/api/automations', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  if (b.reset) { await setSetting(env, 'automations', ''); await setSetting(env, 'automation_set', 'email'); return json({ automations: DEFAULT_AUTOMATIONS, set: 'email' }); }
  if (b.set) {
    const set = AUTOMATION_SETS[b.set];
    if (!set) throw new HttpError('Pick one of the sets.');
    const list = set.list.map(cleanAutomation);
    // Appointments already booked do not get a late "you're booked" from a set switched on now.
    const before = new Set((await getAutomations(env)).map((x) => x.id));
    const fresh = list.filter((x) => x.trigger === 'booked' && !before.has(x.id));
    if (fresh.length) {
      const upcoming = await all(env, 'SELECT id, meet_at FROM leads WHERE meet_at > ?', now());
      for (const l of upcoming) for (const x of fresh) await run(env, 'INSERT OR IGNORE INTO automation_log (id, auto_id, lead_id, meet_at, channel, status, error, to_addr, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', newId('al_'), x.id, l.id, l.meet_at, x.channel, 'skipped', 'Set switched on after booking', null, now());
    }
    await setSetting(env, 'automations', JSON.stringify(list));
    await setSetting(env, 'automation_set', b.set);
    return json({ automations: list, set: b.set });
  }
  const list = (Array.isArray(b.automations) ? b.automations : []).slice(0, 30).map(cleanAutomation);
  const ids = new Set(); for (const a of list) { if (ids.has(a.id)) a.id = `${a.id}_${ids.size}`; ids.add(a.id); }
  await setSetting(env, 'automations', JSON.stringify(list));
  await setSetting(env, 'automation_set', 'custom');
  return json({ automations: list, set: 'custom' });
});

route('GET', '/api/automations/log', async ({ env, user }) => {
  requireAdmin(user);
  const rows = await all(env, `SELECT g.*, l.business FROM automation_log g LEFT JOIN leads l ON l.id = g.lead_id ORDER BY g.at DESC LIMIT 100`);
  return json({ log: rows });
});

// Send one to yourself with sample details, to see exactly what a lead gets.
route('POST', '/api/automations/test', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  const a = cleanAutomation(b.automation || {});
  const me = await first(env, 'SELECT name, email, phone FROM users WHERE id = ?', user.id);
  const start = now() + 864e5;
  const lead = { id: 'test', business: 'Sample Plumbing Co', contact_name: me?.name || 'Sam', email: me?.email, phone: me?.phone, meet_link: 'https://meet.google.com/abc-defg-hij', timezone: 'America/New_York', sms_consent: 1 };
  const ctx = { ...(await context(env, { ...lead, meet_at: start })), rep: `${(me?.name || '').split(' ')[0] || 'Vidal'}, RightWay Growth` };
  if (a.channel === 'email') {
    if (!canEmail(env)) throw new HttpError('Email is not set up yet (RESEND_API_KEY).', 503);
    await sendEmail(env, { to: me.email, subject: `[Test] ${fillTemplate(a.subject, ctx)}`, text: fillTemplate(a.body, ctx), html: emailHtml(fillTemplate(a.body, ctx)) });
    return json({ ok: true, to: me.email });
  }
  if (!me?.phone) throw new HttpError('Save your mobile number in Settings first, then test the text.');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST', headers: { Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: me.phone, From: env.TWILIO_FROM, Body: `[Test] ${fillTemplate(a.body, ctx)}` }).toString(),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new HttpError(`Twilio: ${d.message || res.status}`, 502); }
  return json({ ok: true, to: me.phone });
});

// Write an automation with Claude (or a solid template without a key).
route('POST', '/api/automations/draft', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  const channel = b.channel === 'sms' ? 'sms' : 'email';
  const purpose = String(b.purpose || 'booking confirmation').slice(0, 300);
  const tone = String(b.tone || 'confident, warm, short').slice(0, 80);
  if (!env.ANTHROPIC_API_KEY) {
    const base = DEFAULT_AUTOMATIONS.find((a) => a.channel === channel && (/remind/i.test(purpose) ? a.trigger === 'before' : a.trigger === 'booked'));
    return json({ ai: false, subject: base?.subject || '', body: base?.body || '' });
  }
  const sys = `You write ${channel === 'sms' ? 'text messages (under 300 characters, no emojis, no links except {link} and {book})' : 'short plain emails'} for RightWay Growth, a local SEO agency serving Miami and Fort Lauderdale, Florida. The appointment is a free 15 minute Google clarity audit on a screen share. RightWay only takes ten clients at a time, so the tone is a consultant with high authority, never needy. Use only these placeholders, written exactly with curly braces: {first} {business} {date} {time} {when} {link} {rep} {book} {company}. Never invent facts, prices or promises of rankings. Never use dashes as punctuation. Reply with ${channel === 'email' ? 'SUBJECT: on the first line, then a blank line, then the email body' : 'the text only'}.`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.ANTHROPIC_ASSIST_MODEL || env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 700, system: sys, messages: [{ role: 'user', content: `Write the ${purpose}. Tone: ${tone}.${b.notes ? ` Notes: ${String(b.notes).slice(0, 500)}` : ''}` }] }),
  });
  const d = await res.json().catch(() => ({}));
  await logClaude(env, env.ANTHROPIC_ASSIST_MODEL || env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001', d, 'automation drafts');
  if (!res.ok) throw new HttpError(`Claude: ${d.error?.message || res.status}`, 502);
  const text = String(d.content?.[0]?.text || '').replace(/[–—]/g, ',').trim();
  if (channel === 'email') {
    const m = text.match(/^SUBJECT:\s*(.+)\n+([\s\S]*)$/i);
    return json({ ai: true, subject: (m ? m[1] : 'Your Google clarity audit').trim(), body: (m ? m[2] : text).trim() });
  }
  return json({ ai: true, body: text.slice(0, 480) });
});
