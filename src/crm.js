// CRM: leads, pipeline stages, call outcomes with the playbook follow-up cadence, call queue, website form, convert to client.
import { HttpError, json } from './util.js';
import { all, first, run, batch, newId, now } from './db.js';
import { requireStaff } from './auth.js';
import { PLANS } from './plans.js';
import { route } from './router.js';

export const STAGES = ['new', 'attempting', 'callback', 'audit_requested', 'audit_booked', 'no_show', 'follow_up', 'won', 'not_now', 'lost', 'dnc'];
const CALLABLE = ['new', 'attempting', 'callback', 'audit_requested', 'no_show', 'follow_up', 'not_now'];
const DAY = 864e5;

const TZ_BY_STATE = {
  ET: ['CT', 'DE', 'DC', 'FL', 'GA', 'IN', 'KY', 'ME', 'MD', 'MA', 'MI', 'NH', 'NJ', 'NY', 'NC', 'OH', 'PA', 'RI', 'SC', 'VT', 'VA', 'WV'],
  CT: ['AL', 'AR', 'IL', 'IA', 'KS', 'LA', 'MN', 'MS', 'MO', 'NE', 'ND', 'OK', 'SD', 'TN', 'TX', 'WI'],
  MT: ['CO', 'MT', 'NM', 'UT', 'WY', 'ID'],
  AZ: ['AZ'],
  PT: ['CA', 'NV', 'OR', 'WA'],
  AK: ['AK'],
  HI: ['HI'],
};
const ZONE = { ET: 'America/New_York', CT: 'America/Chicago', MT: 'America/Denver', AZ: 'America/Phoenix', PT: 'America/Los_Angeles', AK: 'America/Anchorage', HI: 'Pacific/Honolulu' };
const STATE_NAMES = { florida: 'FL', texas: 'TX', california: 'CA', 'new york': 'NY', georgia: 'GA', arizona: 'AZ', illinois: 'IL', ohio: 'OH', 'north carolina': 'NC', colorado: 'CO', washington: 'WA', nevada: 'NV', tennessee: 'TN', pennsylvania: 'PA', michigan: 'MI', virginia: 'VA', 'new jersey': 'NJ', massachusetts: 'MA', oregon: 'OR', utah: 'UT' };

export function stateCode(s) {
  const v = String(s || '').trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return STATE_NAMES[v.toLowerCase()] || null;
}
export function timezoneFor(state) {
  const code = stateCode(state);
  for (const [k, list] of Object.entries(TZ_BY_STATE)) if (code && list.includes(code)) return ZONE[k];
  return null;
}
export function localHour(tz, at = Date.now()) {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(at));
  } catch { return null; }
}
export function localTime(tz, at = Date.now()) {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(at); } catch { return ''; }
}
// Calls are allowed 8am to 8pm in the lead's time zone (TCPA hours).
export function inCallingHours(tz, at = Date.now()) {
  const h = localHour(tz, at);
  return h != null && h >= 8 && h < 20;
}

export function digits(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  return d;
}
export function e164(phone) {
  const d = digits(phone);
  if (d.length === 10) return `+1${d}`;
  if (String(phone || '').trim().startsWith('+') && d.length > 7) return `+${String(phone).replace(/\D/g, '')}`;
  return null;
}

// Playbook cadence for no answer: day 1, 2, 4, 7, 14, then recycle in 60 days.
const NEXT_AFTER_ATTEMPT = { 1: 1, 2: 2, 3: 3, 4: 7 };

export function applyOutcome(lead, outcome, { at = now(), callbackAt = null, note = '' } = {}) {
  const set = { last_call_at: at, updated_at: at };
  switch (outcome) {
    case 'no_answer':
    case 'voicemail':
    case 'gatekeeper': {
      const attempts = (lead.attempts || 0) + 1;
      set.attempts = attempts;
      if (attempts >= 5) { set.stage = 'not_now'; set.next_action_at = at + 60 * DAY; set.next_action = 'Recycle: fresh map check and call'; }
      else { set.stage = lead.stage === 'new' || lead.stage === 'not_now' ? 'attempting' : lead.stage; set.next_action_at = at + NEXT_AFTER_ATTEMPT[attempts] * DAY; set.next_action = `Call attempt ${attempts + 1}`; }
      break;
    }
    case 'callback':
      if (!callbackAt) throw new HttpError('Pick a callback time.');
      Object.assign(set, { stage: 'callback', next_action_at: callbackAt, next_action: 'Callback' });
      break;
    case 'conversation':
      Object.assign(set, { stage: 'follow_up', next_action_at: at + 2 * DAY, next_action: 'Follow up' });
      break;
    case 'booked':
      Object.assign(set, { stage: 'audit_booked', next_action_at: callbackAt || at + DAY, next_action: 'Audit call (Call 2)' });
      break;
    case 'no_show':
      Object.assign(set, { stage: 'no_show', next_action_at: at + DAY, next_action: 'Rebook the audit' });
      break;
    case 'not_interested':
      Object.assign(set, { stage: 'not_now', next_action_at: at + 90 * DAY, next_action: 'Recycle in 90 days' });
      break;
    case 'bad_number':
      Object.assign(set, { stage: 'lost', next_action_at: null, next_action: null });
      break;
    case 'dnc':
      Object.assign(set, { stage: 'dnc', dnc: 1, next_action_at: null, next_action: 'Do not call' });
      break;
    case 'won':
      Object.assign(set, { stage: 'won', next_action_at: null, next_action: 'Run the onboarding script' });
      break;
    default:
      throw new HttpError('Unknown call outcome.');
  }
  if (note) set.notes = [lead.notes, note].filter(Boolean).join('\n');
  return set;
}

const text = (v, max = 300) => (v == null ? null : String(v).replace(/\u0000/g, '').trim().slice(0, max) || null);
const LEAD_FIELDS = ['business', 'contact_name', 'phone', 'email', 'website', 'city', 'state', 'industry', 'source', 'plan', 'next_action', 'notes', 'place_id', 'cid'];

export function cleanLead(b, partial = false) {
  const out = {};
  for (const f of LEAD_FIELDS) if (f in b) out[f] = text(b[f], f === 'notes' ? 5000 : 300);
  for (const f of ['lat', 'lng']) if (f in b) { const n = Number(b[f]); out[f] = b[f] === '' || b[f] == null || !Number.isFinite(n) ? null : n; }
  if ('next_action_at' in b) out.next_action_at = b.next_action_at ? Number(new Date(b.next_action_at)) || null : null;
  if ('stage' in b) { if (!STAGES.includes(b.stage)) throw new HttpError('Unknown stage.'); out.stage = b.stage; if (b.stage === 'dnc') out.dnc = 1; }
  if ('plan' in out && out.plan && !PLANS[out.plan]) out.plan = null;
  if (!partial && !out.business) throw new HttpError('Business name is required.');
  if ('phone' in out) out.phone_digits = digits(out.phone) || null;
  if ('state' in out) { out.state = stateCode(out.state) || out.state; out.timezone = timezoneFor(out.state); }
  return out;
}

async function leadOr404(env, id) {
  const l = await first(env, 'SELECT * FROM leads WHERE id = ?', id);
  if (!l) throw new HttpError('Lead not found.', 404);
  return l;
}

export async function insertLead(env, data, by = null) {
  const l = { ...data, id: newId('ld_'), created_at: now(), updated_at: now(), owner_id: by };
  if (!l.stage) l.stage = 'new';
  const cols = Object.keys(l);
  await run(env, `INSERT INTO leads (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((k) => l[k]));
  return l.id;
}

export async function logActivity(env, a) {
  const id = newId('a_');
  await run(env, 'INSERT INTO activities (id, lead_id, client_id, type, outcome, body, duration, call_sid, status, at, by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, a.lead_id || null, a.client_id || null, a.type, a.outcome || null, a.body || null, a.duration ?? null, a.call_sid || null, a.status || null, a.at || now(), a.by || null);
  return id;
}

function decorate(l) {
  const tz = l.timezone || null;
  return { ...l, local_time: localTime(tz), callable_now: !l.dnc && inCallingHours(tz), tz_known: Boolean(tz) };
}

// ---------- routes ----------
route('GET', '/api/leads', async ({ env, user, url }) => {
  requireStaff(user);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const stage = url.searchParams.get('stage');
  let rows = await all(env, `SELECT * FROM leads ${stage ? 'WHERE stage = ?' : ''} ORDER BY updated_at DESC LIMIT 2000`, ...(stage ? [stage] : []));
  if (q) rows = rows.filter((l) => [l.business, l.contact_name, l.phone, l.email, l.city, l.industry].some((v) => String(v || '').toLowerCase().includes(q)));
  const counts = await all(env, 'SELECT stage, COUNT(*) AS n FROM leads GROUP BY stage');
  return json({ leads: rows.map(decorate), counts: Object.fromEntries(counts.map((c) => [c.stage, c.n])) });
});

route('POST', '/api/leads', async ({ env, user, body }) => {
  requireStaff(user);
  const data = cleanLead(await body());
  if (data.phone_digits && (await first(env, 'SELECT id FROM leads WHERE phone_digits = ?', data.phone_digits))) throw new HttpError('A lead with that phone number already exists.', 409);
  const id = await insertLead(env, data, user.id);
  await logActivity(env, { lead_id: id, type: 'stage', body: 'Lead created', by: user.id });
  return json({ lead: decorate(await leadOr404(env, id)) });
});

route('POST', '/api/leads/import', async ({ env, user, body }) => {
  requireStaff(user);
  const { rows, source } = await body();
  if (!Array.isArray(rows) || !rows.length) throw new HttpError('No rows to import.');
  if (rows.length > 2000) throw new HttpError('Import up to 2,000 leads at a time.');
  const existing = new Set((await all(env, 'SELECT phone_digits FROM leads WHERE phone_digits IS NOT NULL')).map((r) => r.phone_digits));
  const items = [];
  let skipped = 0;
  for (const r of rows) {
    let d;
    try { d = cleanLead({ ...r, source: r.source || source || 'import' }); } catch { skipped++; continue; }
    if (d.phone_digits && existing.has(d.phone_digits)) { skipped++; continue; }
    if (d.phone_digits) existing.add(d.phone_digits);
    const l = { ...d, id: newId('ld_'), stage: 'new', created_at: now(), updated_at: now(), owner_id: user.id };
    const cols = Object.keys(l);
    items.push([`INSERT INTO leads (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((k) => l[k])]);
  }
  for (let i = 0; i < items.length; i += 100) await batch(env, items.slice(i, i + 100));
  return json({ imported: items.length, skipped });
});

route('GET', '/api/leads/:id', async ({ env, user, params }) => {
  requireStaff(user);
  const l = await leadOr404(env, params.id);
  const activities = await all(env, 'SELECT * FROM activities WHERE lead_id = ? ORDER BY at DESC LIMIT 200', l.id);
  const orders = await all(env, 'SELECT id, token, plan, status, signed_name, signed_at, paid_at, created_at FROM work_orders WHERE lead_id = ? ORDER BY created_at DESC', l.id);
  return json({ lead: decorate(l), activities, orders });
});

route('PATCH', '/api/leads/:id', async ({ env, user, params, body }) => {
  requireStaff(user);
  const l = await leadOr404(env, params.id);
  const set = cleanLead(await body(), true);
  set.updated_at = now();
  const cols = Object.keys(set);
  await run(env, `UPDATE leads SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => set[k]), l.id);
  if (set.stage && set.stage !== l.stage) await logActivity(env, { lead_id: l.id, type: 'stage', body: `Moved to ${set.stage.replace('_', ' ')}`, by: user.id });
  return json({ lead: decorate(await leadOr404(env, l.id)) });
});

route('DELETE', '/api/leads/:id', async ({ env, user, params }) => {
  requireStaff(user);
  await batch(env, [['DELETE FROM activities WHERE lead_id = ?', params.id], ['DELETE FROM leads WHERE id = ?', params.id]]);
  return json({ ok: true });
});

route('POST', '/api/leads/:id/outcome', async ({ env, user, params, body }) => {
  requireStaff(user);
  const l = await leadOr404(env, params.id);
  const b = await body();
  const callbackAt = b.callbackAt ? Number(new Date(b.callbackAt)) || null : null;
  const set = applyOutcome(l, b.outcome, { callbackAt, note: text(b.note, 2000) || '' });
  const cols = Object.keys(set);
  await run(env, `UPDATE leads SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => set[k]), l.id);
  // Attach to the most recent call record from the dialer if there is one in the last hour.
  const recent = await first(env, "SELECT id FROM activities WHERE lead_id = ? AND type = 'call' AND outcome IS NULL AND at > ? ORDER BY at DESC LIMIT 1", l.id, now() - 3600e3);
  if (recent) await run(env, 'UPDATE activities SET outcome = ?, body = COALESCE(?, body) WHERE id = ?', b.outcome, text(b.note, 2000), recent.id);
  else await logActivity(env, { lead_id: l.id, type: 'call', outcome: b.outcome, body: text(b.note, 2000), by: user.id });
  return json({ lead: decorate(await leadOr404(env, l.id)) });
});

route('POST', '/api/leads/:id/note', async ({ env, user, params, body }) => {
  requireStaff(user);
  await leadOr404(env, params.id);
  const t = text((await body()).text, 4000);
  if (!t) throw new HttpError('Write a note.');
  await logActivity(env, { lead_id: params.id, type: 'note', body: t, by: user.id });
  await run(env, 'UPDATE leads SET updated_at = ? WHERE id = ?', now(), params.id);
  return json({ ok: true });
});

// Turn a won lead into a client (keeps the lead's details).
export async function convertLead(env, lead, plan, by) {
  if (lead.client_id) return lead.client_id;
  const id = newId('c_');
  const address = [lead.city, lead.state].filter(Boolean).join(', ');
  await run(env, `INSERT INTO clients (id, name, plan, status, start_date, contact_name, contact_email, phone, website, address, place_id, cid, lat, lng, category, lead_id, created_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  id, lead.business, PLANS[plan] ? plan : (lead.plan || 'growth'), new Date().toISOString().slice(0, 10), lead.contact_name, lead.email, lead.phone,
  lead.website, address || null, lead.place_id, lead.cid, lead.lat, lead.lng, lead.industry, lead.id, now());
  await run(env, "UPDATE leads SET client_id = ?, stage = 'won', updated_at = ? WHERE id = ?", id, now(), lead.id);
  await logActivity(env, { lead_id: lead.id, client_id: id, type: 'stage', body: 'Won: client created', by });
  return id;
}

route('POST', '/api/leads/:id/convert', async ({ env, user, params, body }) => {
  requireStaff(user);
  const l = await leadOr404(env, params.id);
  const clientId = await convertLead(env, l, (await body()).plan, user.id);
  return json({ clientId });
});

// The call queue: who to call right now, in order.
route('GET', '/api/dialer/queue', async ({ env, user, url }) => {
  requireStaff(user);
  const t = now();
  const rows = await all(env, `SELECT * FROM leads WHERE dnc = 0 AND stage IN (${CALLABLE.map(() => '?').join(',')})
    AND (next_action_at IS NULL OR next_action_at <= ?) AND phone_digits IS NOT NULL ORDER BY next_action_at IS NULL, next_action_at LIMIT 1000`, ...CALLABLE, t);
  const priority = { callback: 0, audit_requested: 1, no_show: 2, follow_up: 3, new: 4, attempting: 5, not_now: 6 };
  const ready = rows
    .filter((l) => !(l.last_call_at && t - l.last_call_at < 3 * 3600e3))
    .map(decorate)
    .sort((a, b) => (priority[a.stage] ?? 9) - (priority[b.stage] ?? 9) || (a.next_action_at || 0) - (b.next_action_at || 0));
  const now_ = ready.filter((l) => l.callable_now);
  const later = ready.length - now_.length;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const stats = await first(env, `SELECT COUNT(*) AS dials, SUM(outcome IN ('conversation','booked','callback','not_interested','won')) AS talks, SUM(outcome = 'booked') AS booked
    FROM activities WHERE type = 'call' AND by = ? AND at >= ?`, user.id, today.getTime());
  return json({ queue: now_.slice(0, Number(url.searchParams.get('limit')) || 50), waitingForHours: later, stats: { dials: stats?.dials || 0, talks: stats?.talks || 0, booked: stats?.booked || 0 } });
});

// Website form (public). Add the Hub's /api/public/lead as the form action on rightwaygrowth.com.
const ALLOWED_ORIGINS = ['https://rightwaygrowth.com', 'https://www.rightwaygrowth.com'];
export function corsHeaders(request) {
  const origin = request.headers.get('origin');
  return ALLOWED_ORIGINS.includes(origin) ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' } : {};
}

route('OPTIONS', '/api/public/lead', async ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request) }), { public: true });

route('POST', '/api/public/lead', async ({ env, request }) => {
  const ct = request.headers.get('content-type') || '';
  const b = ct.includes('json') ? await request.json().catch(() => ({})) : Object.fromEntries((await request.formData().catch(() => new FormData())).entries());
  const headers = corsHeaders(request);
  if (b['company-url']) return json({ ok: true }, 200, headers); // honeypot
  const data = cleanLead({
    business: b.business || b.company || b.name, contact_name: b.name, email: b.email, phone: b.phone, website: b.website,
    city: (b.city || '').split(',')[0], state: (b.city || '').split(',')[1] || b.state, industry: b.industry, source: 'website',
    notes: [b.message, b.interest && `Interested in: ${b.interest}`, b.best_time && `Best time: ${b.best_time}`].filter(Boolean).join('\n'),
  });
  if (!data.email && !data.phone_digits) throw new HttpError('Add an email or phone number.');
  data.stage = 'audit_requested';
  data.sms_consent = b.sms_consent_service || b.sms_consent_marketing ? 1 : 0;
  data.next_action_at = now();
  data.next_action = 'Call within 5 minutes: website audit request';
  const id = await insertLead(env, data, null);
  await logActivity(env, { lead_id: id, type: 'stage', body: `Website audit request${data.sms_consent ? ' (agreed to texts)' : ''}` });
  const redirect = b.redirect && /^https:\/\/(www\.)?rightwaygrowth\.com\//.test(b.redirect) ? b.redirect : null;
  if (!ct.includes('json') && redirect) return Response.redirect(redirect, 303);
  return json({ ok: true }, 200, headers);
}, { public: true });
