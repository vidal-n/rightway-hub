// CRM: leads, pipeline stages, call outcomes with the playbook follow-up cadence, call queue, website form, convert to client.
import { HttpError, json } from './util.js';
import { all, first, run, batch, newId, now } from './db.js';
import { requireStaff, requireAdmin } from './auth.js';
import { PLANS, tasksForMonth, monthKey } from './plans.js';
import { scopeFromLead } from './scopeof.js';
import { tierOf as scopeTier } from '../public/js/scope.js';
import { route } from './router.js';
import { scoreLead, dupKeys, callCategory } from '../public/js/leadintel.js';
import { resolveDispo } from './dispo.js';
import { notifyLater } from './notify.js';
import { autoChatFor } from './chat.js';
import { can } from '../public/js/jobs.js';
import { cleanNewLead, queueScrub } from './scrub.js';
import { resolveZone, canCallNow, stateFromName, ZONE_SHORT } from '../public/js/timezone.js';

export const STAGES = ['new', 'attempting', 'callback', 'audit_requested', 'audit_booked', 'no_show', 'follow_up', 'won', 'not_now', 'lost', 'dnc'];
const CALLABLE = ['new', 'attempting', 'callback', 'audit_requested', 'no_show', 'follow_up', 'not_now'];
const DAY = 864e5;

const TZ_SHORT = ZONE_SHORT;

// Accepts a 2 letter code or a full state name (all 50 states and DC). A 2 letter code is kept even when it is not a state.
export function stateCode(s) {
  const v = String(s || '').trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return stateFromName(v) || null;
}
export function timezoneFor(state) {
  return resolveZone({ state: stateCode(state) }).tz;
}
export function localHour(tz, at = Date.now()) {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(at));
  } catch { return null; }
}
export function localTime(tz, at = Date.now()) {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(at); } catch { return ''; }
}
// Calls are allowed 8am to 8pm in the lead's time zone (TCPA hours). `alt` is a second possible zone (both must be inside).
// No zone at all means only the window that is safe from Miami to Seattle (11am to 8pm Eastern).
export function inCallingHours(tz, at = Date.now(), alt = null) {
  return canCallNow(tz, alt, at);
}
// Where a lead is, from whatever fields it has. Returns the columns to save: timezone, tz_alt, tz_how (and state when it was empty).
export function zoneFields(l) {
  const z = resolveZone(l);
  return { timezone: z.tz, tz_alt: z.alt, tz_how: z.how || null, state: z.state || null };
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

export function applyOutcome(lead, outcome, { at = now(), callbackAt = null, note = '', by = null } = {}) {
  const set = { last_call_at: at, updated_at: at };
  switch (outcome) {
    case 'no_answer':
    case 'voicemail':
    case 'hung_up':
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
      if (callbackAt) Object.assign(set, { meet_at: callbackAt, ...(by ? { meet_by: by } : {}) });
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
const LEAD_FIELDS = ['business', 'contact_name', 'phone', 'email', 'website', 'city', 'state', 'zip', 'address', 'industry', 'category', 'tags', 'source', 'plan', 'next_action', 'notes', 'place_id', 'cid'];

export function cleanLead(b, partial = false) {
  const out = {};
  for (const f of LEAD_FIELDS) if (f in b) out[f] = text(b[f], f === 'notes' ? 5000 : 300);
  for (const f of ['lat', 'lng', 'rating', 'reviews', 'locations']) if (f in b) { const n = Number(b[f]); out[f] = b[f] === '' || b[f] == null || !Number.isFinite(n) ? null : n; }
  if ('next_action_at' in b) out.next_action_at = b.next_action_at ? Number(new Date(b.next_action_at)) || null : null;
  if ('stage' in b) { if (!STAGES.includes(b.stage)) throw new HttpError('Unknown stage.'); out.stage = b.stage; if (b.stage === 'dnc') out.dnc = 1; }
  if ('plan' in out && out.plan && !PLANS[out.plan]) out.plan = null;
  if (!partial && !out.business) throw new HttpError('Business name is required.');
  if ('phone' in out) out.phone_digits = digits(out.phone) || null;
  if ('state' in out) out.state = stateCode(out.state) || out.state;
  if (['state', 'zip', 'address', 'city', 'lat', 'lng'].some((f) => f in out)) {
    const z = resolveZone(out);
    // A change that gives no place at all clears the zone only when the state itself was cleared; otherwise keep what we had.
    if (z.tz || 'state' in out) { out.timezone = z.tz; out.tz_alt = z.alt; out.tz_how = z.how || null; }
    if ('state' in out && !out.state && z.state) out.state = z.state;
  }
  if ('zip' in out && out.zip) out.zip = String(out.zip).replace(/[^\d-]/g, '').slice(0, 10) || null;
  if ('reviews' in out && out.reviews != null) out.reviews = Math.round(out.reviews);
  if ('rating' in out && out.rating != null && (out.rating < 0 || out.rating > 5)) out.rating = null;
  return out;
}

// Score from whatever is known about the lead, including saved research.
export function rescore(lead) {
  let intel = null;
  try { intel = lead.intel ? JSON.parse(lead.intel) : null; } catch { intel = null; }
  const { score, grade } = scoreLead(lead, intel);
  return { score, grade };
}

async function leadOr404(env, id) {
  const l = await first(env, 'SELECT * FROM leads WHERE id = ?', id);
  if (!l) throw new HttpError('Lead not found.', 404);
  return l;
}

export async function insertLead(env, data, by = null) {
  const l = { ...cleanNewLead(data), id: newId('ld_'), created_at: now(), updated_at: now(), owner_id: by };
  if (!l.stage) l.stage = 'new';
  Object.assign(l, rescore(l));
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

// Booked appointments: owners see every one; teammates only see the ones they booked (or, for older rows, on their own leads).
export function canSeeAppt(user, l) {
  if (!user || can(user, 'schedule')) return true; // owners, schedulers and closers see every appointment
  if (l.closer_id && l.closer_id === user.id) return true;
  return l.meet_by ? l.meet_by === user.id : Boolean(l.owner_id) && l.owner_id === user.id;
}
export function apptScope(user, alias = '') {
  if (!user || can(user, 'schedule')) return { sql: '', args: [] };
  const a = alias ? `${alias}.` : '';
  return { sql: ` AND (${a}meet_by = ? OR ${a}closer_id = ? OR (${a}meet_by IS NULL AND ${a}owner_id = ?))`, args: [user.id, user.id, user.id] };
}
function seeAppt(l, user) {
  if (!l || canSeeAppt(user, l)) return l;
  return { ...l, meet_at: null, meet_link: null, gcal_event_id: null };
}
function decorate(l) {
  const tz = l.timezone || null;
  const { intel, scrub_data, ...rest } = l;
  return { ...rest, scrubbed: Boolean(l.scrubbed_at), researched: Boolean(l.intel_at), tz_short: TZ_SHORT[tz] || null, tz_alt_short: TZ_SHORT[l.tz_alt] || null, local_time: tz ? localTime(tz) : '', callable_now: !l.dnc && inCallingHours(tz, Date.now(), l.tz_alt), tz_known: Boolean(tz) };
}
const LIST_COLS = `id, business, contact_name, phone, phone_digits, email, website, city, state, zip, timezone, tz_alt, tz_how, industry, category, tags, source, stage, plan,
  next_action_at, next_action, owner_id, attempts, last_call_at, dnc, sms_consent, client_id, score, grade, rating, reviews, map_rank, problems,
  intel_at, meet_at, meet_link, meet_by, closer_id, created_at, updated_at, business_raw, phone_type, email_status, owner_name, data_score, scrubbed_at, scrub,
  (CASE WHEN socials IS NULL OR socials IN ('', '{}') THEN 0 ELSE 1 END) AS has_socials`;

async function updateLead(env, id, set) {
  const cols = Object.keys(set);
  if (!cols.length) return;
  await run(env, `UPDATE leads SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => set[k]), id);
}
async function refreshScore(env, id) {
  const l = await first(env, 'SELECT * FROM leads WHERE id = ?', id);
  if (l) await updateLead(env, id, rescore(l));
}

// ---------- routes ----------
route('GET', '/api/leads', async ({ env, user, url }) => {
  requireStaff(user);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const stage = url.searchParams.get('stage');
  let rows = await all(env, `SELECT ${LIST_COLS} FROM leads ${stage ? 'WHERE stage = ?' : ''} ORDER BY updated_at DESC LIMIT 5000`, ...(stage ? [stage] : []));
  const qd = q.replace(/\D/g, '');
  if (q) rows = rows.filter((l) => [l.business, l.contact_name, l.phone, l.email, l.city, l.industry, l.category, l.zip, l.tags].some((v) => String(v || '').toLowerCase().includes(q))
    || (qd.length >= 4 && qd.length === q.replace(/[\s()+-]/g, '').length && String(l.phone || '').replace(/\D/g, '').includes(qd)));
  const lim = Number(url.searchParams.get('limit')) || 0;
  if (lim > 0) rows = rows.slice(0, Math.min(lim, 200));
  const counts = await all(env, 'SELECT stage, COUNT(*) AS n FROM leads GROUP BY stage');
  return json({ leads: rows.map((l) => seeAppt(decorate(l), user)), counts: Object.fromEntries(counts.map((c) => [c.stage, c.n])) });
});

route('POST', '/api/leads', async ({ env, user, body }) => {
  requireStaff(user);
  const data = cleanLead(await body());
  const dup = await findDuplicate(env, data);
  if (dup) throw new HttpError(`This looks like a lead you already have: ${dup.business}.`, 409);
  const id = await insertLead(env, data, user.id);
  await queueScrub(env, [id]);
  await logActivity(env, { lead_id: id, type: 'stage', body: 'Lead created', by: user.id });
  return json({ lead: seeAppt(decorate(await leadOr404(env, id)), user) });
});

// Existing dedupe keys: phone, website domain, and name plus city or zip.
export async function existingKeys(env) {
  const rows = await all(env, 'SELECT id, business, phone_digits, website, city, zip, dnc FROM leads');
  const keys = new Map();
  for (const r of rows) for (const k of dupKeys(r)) if (!keys.has(k)) keys.set(k, r);
  return keys;
}
async function findDuplicate(env, data) {
  const keys = await existingKeys(env);
  for (const k of dupKeys(data)) if (keys.has(k)) return keys.get(k);
  return null;
}

// The one import path: the CSV import and the lead finder both come through here, so they dedupe, scrub and queue the same way.
// Returns the counts plus `rows`, one entry per input row: { id } for a new lead or { skipped, lead_id } for one that was not added.
export async function importLeads(env, user, rows, { source, tags, merge = true } = {}) {
  const keys = await existingKeys(env);
  const items = [];
  const out = new Array(rows.length);
  const skipped = { phone: 0, website: 0, name: 0, invalid: 0, dnc: 0 };
  const reason = { p: 'phone', d: 'website', n: 'name', m: 'name' };
  const tagText = text(tags, 200);
  for (const [n, r] of rows.entries()) {
    let d;
    try { d = cleanLead({ ...r, source: r.source || source || 'import' }); } catch { skipped.invalid++; out[n] = { skipped: 'invalid' }; continue; }
    if (!d.phone_digits && !d.email) { skipped.invalid++; out[n] = { skipped: 'invalid' }; continue; }
    const ks = dupKeys(d);
    const hit = ks.find((k) => keys.has(k));
    if (hit) { const prev = keys.get(hit); const why = prev?.dnc ? 'dnc' : reason[hit[0]]; skipped[why]++; out[n] = { skipped: why, lead_id: prev?.id || null }; continue; }
    if (tagText) d.tags = [d.tags, tagText].filter(Boolean).join(', ');
    const l = { ...cleanNewLead(d), id: newId('ld_'), stage: 'new', created_at: now(), updated_at: now(), owner_id: user.id };
    Object.assign(l, rescore(l));
    for (const k of ks) keys.set(k, l);
    const cols = Object.keys(l);
    items.push([`INSERT INTO leads (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((k) => l[k])]);
    out[n] = { id: l.id };
  }
  // Free scrub before anything is called: bad and toll free numbers never reach the queue. Research and grading run in the background.
  const { scrubReason } = await import('./autoresearch.js');
  let scrubbed = 0;
  for (const it of items) {
    const cols = it[0].match(/\(([^)]*)\)/)[1].split(', ');
    const lead = Object.fromEntries(cols.map((c, i) => [c, it[i + 1]]));
    const why = lead.phone_digits ? scrubReason(lead, null) : null;
    if (why) { scrubbed++; const set = { scrub: why, stage: 'lost', next_action: `Scrubbed: ${why}` }; for (const [k, v] of Object.entries(set)) { const i = cols.indexOf(k); if (i >= 0) it[i + 1] = v; else { cols.push(k); it.push(v); } } it[0] = `INSERT INTO leads (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`; }
  }
  for (let i = 0; i < items.length; i += 100) await batch(env, items.slice(i, i + 100));
  // Duplicates with the leads already in the Hub (including name variants) are merged now, so the call list is clean from the start.
  const newIds = out.filter((x) => x?.id).map((x) => x.id);
  // `merge: false` skips it for callers whose rows were all checked against the Hub just above (it reads every lead, which is slow).
  const merged = merge ? await autoMergeAfterImport(env, user, newIds).catch((e) => { console.error('auto merge', e.message); return 0; }) : 0;
  // The full scrub (website emails, owner name, email check) runs in the background for everything that is still open.
  await queueScrub(env, items.filter((it) => !it[0].includes(' scrub,') && !it[0].includes(', scrub)')).map((it) => it[1 + it[0].match(/\(([^)]*)\)/)[1].split(', ').indexOf('id')]));
  const total = Object.values(skipped).reduce((a, b) => a + b, 0);
  return { imported: items.length, skipped: total, skippedBy: skipped, scrubbed, merged, rows: out };
}

route('POST', '/api/leads/import', async ({ env, user, body }) => {
  requireStaff(user);
  const { rows, source, tags } = await body();
  if (!Array.isArray(rows) || !rows.length) throw new HttpError('No rows to import.');
  if (rows.length > 5000) throw new HttpError('Import up to 5,000 leads at a time.');
  const { rows: _rows, ...result } = await importLeads(env, user, rows, { source, tags });
  return json(result);
});

// Duplicate groups among leads already in the Hub.
route('GET', '/api/leads/duplicates', async ({ env, user }) => {
  requireStaff(user);
  const rows = await all(env, 'SELECT id, business, contact_name, phone, phone_digits, website, city, zip, stage, score, created_at FROM leads');
  const parent = new Map(rows.map((r) => [r.id, r.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const seen = new Map();
  for (const r of rows) for (const k of dupKeys(r)) { if (seen.has(k)) parent.set(find(r.id), find(seen.get(k))); else seen.set(k, r.id); }
  const groups = new Map();
  for (const r of rows) { const g = find(r.id); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
  return json({ groups: [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => (b.score || 0) - (a.score || 0) || a.created_at - b.created_at)) });
});

// Merge: keep one lead, fill its blanks from the others, move their history, delete them.
route('POST', '/api/leads/merge', async ({ env, user, body }) => {
  requireStaff(user);
  const { keep, remove } = await body();
  if (!keep || !Array.isArray(remove) || !remove.length) throw new HttpError('Pick the lead to keep and the ones to merge.');
  const k = await leadOr404(env, keep);
  const merged = await mergeLeads(env, user, k, remove);
  return json({ ok: true, merged });
});

// Keep one lead, fill its blanks from the others, move their calls, notes and orders, then delete them.
export async function mergeLeads(env, user, k, remove) {
  const keep = k.id;
  const others = (await Promise.all(remove.filter((id) => id !== keep).map((id) => first(env, 'SELECT * FROM leads WHERE id = ?', id)))).filter(Boolean);
  const set = {};
  for (const o of others) {
    for (const f of [...LEAD_FIELDS, 'phone_digits', 'timezone', 'tz_alt', 'tz_how', 'rating', 'reviews', 'intel', 'intel_at', 'lat', 'lng']) if ((k[f] == null || k[f] === '') && o[f] != null && o[f] !== '' && set[f] == null) set[f] = o[f];
    if (o.notes && o.notes !== k.notes) set.notes = [set.notes || k.notes, o.notes].filter(Boolean).join('\n');
    if (o.dnc) { set.dnc = 1; set.stage = 'dnc'; }
  }
  set.updated_at = now();
  await updateLead(env, k.id, set);
  const ids = others.map((o) => o.id);
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    await batch(env, [[`UPDATE activities SET lead_id = ? WHERE lead_id IN (${ph})`, k.id, ...ids], [`UPDATE work_orders SET lead_id = ? WHERE lead_id IN (${ph})`, k.id, ...ids], [`DELETE FROM leads WHERE id IN (${ph})`, ...ids]]);
  }
  await refreshScore(env, k.id);
  await logActivity(env, { lead_id: k.id, type: 'stage', body: `Merged ${ids.length} duplicate${ids.length === 1 ? '' : 's'}`, by: user.id });
  return ids.length;
}

// After a CSV import: any lead that now matches another (same phone, website, or name in the same place, with the legal name or SEO
// tail ignored) is merged into one. The copy that has history or a client link is kept as the main lead. Never removes a client.
export async function autoMergeAfterImport(env, user, newIds) {
  if (!newIds.length) return 0;
  const rows = await all(env, 'SELECT id, business, phone, phone_digits, website, city, zip, stage, score, client_id, created_at FROM leads');
  const parent = new Map(rows.map((r) => [r.id, r.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const seen = new Map();
  for (const r of rows) for (const key of dupKeys(r)) { if (seen.has(key)) parent.set(find(r.id), find(seen.get(key))); else seen.set(key, r.id); }
  const groups = new Map();
  for (const r of rows) { const g = find(r.id); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
  const fresh = new Set(newIds);
  let removed = 0;
  for (const g of groups.values()) {
    if (g.length < 2 || !g.some((r) => fresh.has(r.id))) continue;
    const ids = g.map((r) => r.id);
    const ph = ids.map(() => '?').join(',');
    const acts = await all(env, `SELECT lead_id, COUNT(*) AS n FROM activities WHERE lead_id IN (${ph}) GROUP BY lead_id`, ...ids);
    const n = new Map(acts.map((a) => [a.lead_id, a.n]));
    const ranked = [...g].sort((a, b) => (Boolean(b.client_id) - Boolean(a.client_id)) || ((n.get(b.id) || 0) > 0) - ((n.get(a.id) || 0) > 0) || (b.stage !== 'new') - (a.stage !== 'new') || (b.score || 0) - (a.score || 0) || a.created_at - b.created_at);
    const keep = ranked[0];
    const drop = ranked.slice(1).filter((r) => !r.client_id).map((r) => r.id);
    if (!drop.length) continue;
    const keepLead = await first(env, 'SELECT * FROM leads WHERE id = ?', keep.id);
    removed += await mergeLeads(env, user, keepLead, drop);
  }
  return removed;
}

// Bulk actions from the list view.
route('POST', '/api/leads/bulk', async ({ env, user, body }) => {
  requireStaff(user);
  const { ids, action, value } = await body();
  if (!Array.isArray(ids) || !ids.length || ids.length > 5000) throw new HttpError('Select some leads first.');
  const ph = ids.map(() => '?').join(',');
  if (action === 'stage') {
    if (!STAGES.includes(value)) throw new HttpError('Unknown stage.');
    await run(env, `UPDATE leads SET stage = ?, dnc = CASE WHEN ? = 'dnc' THEN 1 ELSE dnc END, updated_at = ? WHERE id IN (${ph})`, value, value, now(), ...ids);
  } else if (action === 'tag') {
    const t = text(value, 60);
    if (!t) throw new HttpError('Type a tag.');
    await run(env, `UPDATE leads SET tags = CASE WHEN tags IS NULL OR tags = '' THEN ? ELSE tags || ', ' || ? END, updated_at = ? WHERE id IN (${ph})`, t, t, now(), ...ids);
  } else if (action === 'delete') {
    await batch(env, [[`DELETE FROM activities WHERE lead_id IN (${ph})`, ...ids], [`DELETE FROM leads WHERE id IN (${ph})`, ...ids]]);
  } else if (action === 'callnow') {
    await run(env, `UPDATE leads SET next_action_at = ?, updated_at = ? WHERE id IN (${ph}) AND dnc = 0`, now(), now(), ...ids);
  } else throw new HttpError('Unknown action.');
  return json({ ok: true, count: ids.length });
});

route('GET', '/api/leads/:id', async ({ env, user, params }) => {
  requireStaff(user);
  const l = await leadOr404(env, params.id);
  const activities = await all(env, 'SELECT * FROM activities WHERE lead_id = ? ORDER BY at DESC LIMIT 200', l.id);
  const orders = await all(env, 'SELECT id, token, plan, kind, setup_cents, monthly_cents, status, signed_name, signed_at, paid_at, created_at FROM work_orders WHERE lead_id = ? ORDER BY created_at DESC', l.id);
  let intel = null;
  try { intel = l.intel ? JSON.parse(l.intel) : null; } catch { intel = null; }
  let scrub = null;
  try { scrub = l.scrub_data ? JSON.parse(l.scrub_data) : null; } catch { scrub = null; }
  return json({ lead: seeAppt(decorate(l), user), intel, scrub, activities, orders });
});

route('PATCH', '/api/leads/:id', async ({ env, user, params, body }) => {
  requireStaff(user);
  const l = await leadOr404(env, params.id);
  const set = cleanLead(await body(), true);
  set.updated_at = now();
  Object.assign(set, rescore({ ...l, ...set }));
  await updateLead(env, l.id, set);
  if (set.stage && set.stage !== l.stage) await logActivity(env, { lead_id: l.id, type: 'stage', body: `Moved to ${set.stage.replace('_', ' ')}`, by: user.id });
  return json({ lead: seeAppt(decorate(await leadOr404(env, l.id)), user) });
});

route('DELETE', '/api/leads/:id', async ({ env, user, params }) => {
  requireStaff(user);
  await batch(env, [['DELETE FROM activities WHERE lead_id = ?', params.id], ['DELETE FROM leads WHERE id = ?', params.id]]);
  return json({ ok: true });
});

// Log a call result on a lead: moves the lead along (cadence, callback, DNC) and labels the call record.
export async function recordOutcome(env, l, { dispo, note, callbackAt, by, activityId } = {}) {
  const d = await resolveDispo(env, dispo);
  if (!d) throw new HttpError('Unknown call outcome.');
  let set;
  if (d.acts === 'none') {
    set = { last_call_at: now(), updated_at: now() };
    if (note) set.notes = [l.notes, note].filter(Boolean).join('\n');
  } else {
    set = applyOutcome(l, d.acts, { callbackAt, note: note || '', by });
    Object.assign(set, rescore({ ...l, ...set }));
  }
  await updateLead(env, l.id, set);
  // Attach to this call, or the most recent unlabeled call on the lead in the last hour, so a dial counts once.
  const target = activityId ? { id: activityId }
    : await first(env, "SELECT id FROM activities WHERE lead_id = ? AND type IN ('call','manual_call') AND outcome IS NULL AND at > ? ORDER BY at DESC LIMIT 1", l.id, now() - 3600e3);
  if (target) await run(env, "UPDATE activities SET outcome = ?, dispo = ?, note = ?, dispo_at = ?, lead_id = COALESCE(lead_id, ?), body = CASE WHEN type = 'manual_call' THEN body ELSE COALESCE(?, body) END WHERE id = ?", d.acts, d.label, note || null, now(), l.id, note || null, target.id);
  else {
    const id = await logActivity(env, { lead_id: l.id, type: 'call', outcome: d.acts, body: note || null, by });
    await run(env, 'UPDATE activities SET dispo = ?, note = ?, dispo_at = at WHERE id = ?', d.label, note || null, id);
  }
  return d;
}

route('POST', '/api/leads/:id/outcome', async ({ env, user, params, body }) => {
  requireStaff(user);
  const l = await leadOr404(env, params.id);
  const b = await body();
  const callbackAt = b.callbackAt ? Number(new Date(b.callbackAt)) || null : null;
  await recordOutcome(env, l, { dispo: b.dispo || b.outcome, note: text(b.note, 2000), callbackAt, by: user.id });
  // Booked with a time: it lands on the booker's own Google Calendar with a Meet link (the Hub keeps it either way).
  let calendar = null;
  if (callbackAt) calendar = await import('./appointments.js').then((m) => m.bookOnCalendar(env, user.id, l.id)).catch((e) => ({ error: e.message }));
  return json({ lead: seeAppt(decorate(await leadOr404(env, l.id)), user), calendar });
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
  // The client's scope is what was quoted (or what the research recommends). A workload named by hand (API only) uses that template instead.
  let quote = {};
  try { quote = JSON.parse(lead.quote || '{}') || {}; } catch { quote = {}; }
  const named = !(Array.isArray(quote.services) && quote.services.length) && PLANS[plan];
  const scope = named ? null : scopeFromLead(lead);
  const tier = named ? plan : scopeTier(scope);
  const monthlyCents = Number(quote.monthly) > 0 ? Math.round(Number(quote.monthly) * 100) : null;
  await run(env, `INSERT INTO clients (id, name, plan, scope, mrr_cents, status, start_date, contact_name, contact_email, phone, website, address, place_id, cid, lat, lng, category, lead_id, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  id, lead.business, tier, scope ? JSON.stringify(scope) : null, monthlyCents, new Date().toISOString().slice(0, 10), lead.contact_name, lead.email, lead.phone,
  lead.website, address || null, lead.place_id, lead.cid, lead.lat, lead.lng, lead.industry, lead.id, now());
  // Carry the sales research over as the client's baseline (the "before" for every report).
  let intel = null;
  try { intel = lead.intel ? JSON.parse(lead.intel) : null; } catch { intel = null; }
  if (intel) {
    const kw = intel.keyword ? [intel.keyword, lead.city ? `${intel.keyword} ${lead.city}` : null].filter(Boolean).join('\n') : null;
    await run(env, 'UPDATE clients SET baseline = ?, keywords = COALESCE(keywords, ?), category = COALESCE(?, category), address = COALESCE(?, address), review_url = COALESCE(review_url, ?) WHERE id = ?',
      lead.intel, kw, intel.listing?.category || null, intel.listing?.address || null,
      intel.listing?.place_id ? `https://search.google.com/local/writereview?placeid=${intel.listing.place_id}` : null, id);
  }
  await run(env, "UPDATE leads SET client_id = ?, stage = 'won', score = 100, grade = 'W', updated_at = ? WHERE id = ?", id, now(), lead.id);
  // First month's work, including the setup checklist, is ready the moment they sign.
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', id);
  const month = monthKey();
  const list = tasksForMonth({ ...c, has_setup: false }, month);
  await batch(env, list.map((t, i) => ['INSERT INTO tasks (id, client_id, month, kind, title, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId('t_'), id, month, t.kind, t.title, i, now()]));
  await logActivity(env, { lead_id: lead.id, client_id: id, type: 'stage', body: 'Won: client created', by });
  await autoChatFor(env, id).catch(() => {}); // their private chat with the team is ready from day one
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
  const f = Object.fromEntries(['tz', 'grade', 'state', 'industry', 'tag', 'city', 'tier', 'data', 'cat'].map((k) => [k, (url.searchParams.get(k) || '').trim()]));
  const minScore = Number(url.searchParams.get('minScore')) || 0;
  const has = (v, want) => !want || String(v || '').toLowerCase().includes(want.toLowerCase());
  const ready = rows
    .filter((l) => !(l.last_call_at && t - l.last_call_at < 3 * 3600e3))
    .map((l) => seeAppt(decorate(l), user))
    .filter((l) => (!f.tz || l.tz_short === f.tz) && (!f.grade || f.grade.split(',').includes(l.grade)) && (!f.state || l.state === f.state.toUpperCase())
      && has(`${l.industry} ${l.category}`, f.industry) && has(l.tags, f.tag) && has(l.city, f.city) && (l.score || 0) >= minScore)
    .filter((l) => !f.tier || tierOf(l) === f.tier)
    .filter((l) => !f.cat || callCategory(l).id === f.cat)
    .filter((l) => !f.data || (f.data === 'mobile' ? l.phone_type === 'mobile' : f.data === 'owner' ? Boolean(l.owner_name || l.contact_name) : f.data === 'email' ? Boolean(l.email) && !['bad', 'no_mail_server'].includes(l.email_status) : true))
    .sort((a, b) => (priority[a.stage] ?? 9) - (priority[b.stage] ?? 9) || (b.score || 0) - (a.score || 0) || (b.data_score || 0) - (a.data_score || 0) || (a.next_action_at || 0) - (b.next_action_at || 0));
  const now_ = ready.filter((l) => l.callable_now);
  // Sub queues by lead quality, counted on everything callable now (ignores the tier filter so the tabs always show their size).
  const tiers = { hot: 0, good: 0, maybe: 0, low: 0, fresh: 0 };
  const cats = {};
  for (const l of rows) { if (!(l.last_call_at && t - l.last_call_at < 3 * 3600e3)) { const d = decorate(l); if (d.callable_now) { tiers[tierOf(d)]++; const c = callCategory(d).id; cats[c] = (cats[c] || 0) + 1; } } }
  const later = ready.length - now_.length;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const stats = await first(env, `SELECT COUNT(*) AS dials, SUM(outcome IN ('conversation','booked','callback','not_interested','won')) AS talks, SUM(outcome = 'booked') AS booked
    FROM activities WHERE type = 'call' AND by = ? AND at >= ?`, user.id, today.getTime());
  return json({ queue: now_.slice(0, Number(url.searchParams.get('limit')) || 50), waitingForHours: later, stats: { dials: stats?.dials || 0, talks: stats?.talks || 0, booked: stats?.booked || 0 }, tiers, cats });
});
// Quality tiers: callbacks and booked follow ups always count as hot; not researched yet is its own queue.
export function tierOf(l) {
  if (['callback', 'audit_requested', 'no_show'].includes(l.stage)) return 'hot';
  if (!l.intel_at && !l.grade) return 'fresh';
  return { A: 'hot', B: 'good', C: 'maybe', D: 'low' }[l.grade] || (l.intel_at ? 'maybe' : 'fresh');
}

// Website form (public). Add the Hub's /api/public/lead as the form action on rightwaygrowth.com.
const ALLOWED_ORIGINS = ['https://rightwaygrowth.com', 'https://www.rightwaygrowth.com'];
export function corsHeaders(request) {
  const origin = request.headers.get('origin');
  return ALLOWED_ORIGINS.includes(origin) ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' } : {};
}

route('OPTIONS', '/api/public/lead', async ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request) }), { public: true });

route('POST', '/api/public/lead', async ({ env, request, defer }) => {
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
  await notifyLater({ env, defer }, { to: 'staff', kind: 'lead', title: `New audit request: ${data.business || data.contact_name || 'website form'}`, body: [data.contact_name, data.phone, data.city].filter(Boolean).join(' · ') + '. Call within 5 minutes.', url: `/#/pipeline`, urgent: true, actions: [{ text: 'Claim', action_id: 'lead_claim', value: id, style: 'primary' }] });
  const redirect = b.redirect && /^https:\/\/(www\.)?rightwaygrowth\.com\//.test(b.redirect) ? b.redirect : null;
  if (!ct.includes('json') && redirect) return Response.redirect(redirect, 303);
  return json({ ok: true }, 200, headers);
}, { public: true });

// A deep scan run in the Scan tool tab during the audit, saved to the lead so the presentation shows it. Up to 5 keywords, 15 x 15.
export function compactScan(x) {
  const size = Math.max(1, Math.min(15, Number(x?.size) || Math.round(Math.sqrt((x?.points || []).length)) || 1));
  const pts = (x?.points || []).slice(0, size * size);
  const cells = pts.map((p, i) => ({
    row: Number.isFinite(p.row) ? p.row : Math.floor(i / size), col: Number.isFinite(p.col) ? p.col : i % size,
    rank: Number.isFinite(p.rank) ? p.rank : null, error: p.status === 'error' || Boolean(p.error),
    top: (p.top || []).slice(0, 3).map((t) => ({ title: String(t.title || '').slice(0, 80), rank: Number(t.rank) || null, rating: t.rating ?? null, reviews: t.reviews ?? null })),
  }));
  const ok = cells.filter((c) => !c.error), ranked = ok.filter((c) => c.rank != null);
  return {
    keyword: String(x?.keyword || '').slice(0, 80), size, radiusMiles: Number(x?.radius) || Number(x?.radiusMiles) || null, points: ok.length,
    top3: ranked.filter((c) => c.rank <= 3).length, top10: ranked.filter((c) => c.rank <= 10).length,
    avg: ranked.length ? Math.round((ranked.reduce((s, c) => s + c.rank, 0) / ranked.length) * 10) / 10 : null,
    center: cells[Math.floor(cells.length / 2)]?.rank ?? null, cells,
  };
}
route('POST', '/api/leads/:id/deep-scan', async ({ env, user, params, body }) => {
  requireStaff(user);
  const l = await leadOr404(env, params.id);
  const b = await body();
  const scans = (Array.isArray(b.scans) ? b.scans : [b.scan]).filter(Boolean).slice(0, 5).map(compactScan).filter((x) => x.cells.length);
  if (!scans.length) throw new HttpError('Run the scan first.');
  const at = now();
  await run(env, 'UPDATE leads SET deep_scan = ?, updated_at = ? WHERE id = ?', JSON.stringify({ at, by: user.id, scans }), at, l.id);
  await logActivity(env, { lead_id: l.id, type: 'note', body: `Deep scan saved: ${scans.map((x) => `"${x.keyword}" first page in ${x.top10} of ${x.points}`).join(', ')}`, by: user.id });
  return json({ ok: true, at, scans: scans.length });
});

// Free time zone repair: works out each lead's zone from its state, address, ZIP, city and map spot, 200 leads a request.
// Leads booked through the booking page keep the zone the visitor's browser reported. Anything already right is left alone.
export const FIX_STEP = 200;
route('POST', '/api/leads/fix-timezones', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  const after = String(b.after || '');
  const rows = await all(env, `SELECT id, state, zip, address, city, lat, lng, timezone, tz_alt, tz_how FROM leads
    WHERE (timezone IS NULL OR tz_how IS NULL) AND COALESCE(tz_how, '') != 'booking' AND id > ? ORDER BY id LIMIT ?`, after, FIX_STEP + 1);
  const more = rows.length > FIX_STEP;
  const part = more ? rows.slice(0, FIX_STEP) : rows;
  let fixed = 0, unknown = 0;
  const ops = [];
  for (const l of part) {
    const z = resolveZone(l);
    if (!z.tz) { unknown++; continue; }
    const state = z.state && (!l.state || stateFromName(l.state) === z.state) ? z.state : l.state;
    if (z.tz === l.timezone && (z.alt || null) === (l.tz_alt || null) && z.how === l.tz_how && state === l.state) continue;
    if (z.tz !== l.timezone) fixed++;
    ops.push(['UPDATE leads SET timezone = ?, tz_alt = ?, tz_how = ?, state = ? WHERE id = ?', z.tz, z.alt, z.how, state || null, l.id]);
  }
  for (let i = 0; i < ops.length; i += 100) await batch(env, ops.slice(i, i + 100));
  return json({ checked: part.length, fixed, unknown, next: more ? part[part.length - 1].id : null });
});
