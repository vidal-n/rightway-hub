// Lead database and call intelligence (Pipeline, "Lead database" and "Call insights" tabs).
// Modeled on Apollo.io and ZoomInfo search (category filters, saved searches, column picker, export), and the call analytics in Orum, Nooks and Gong
// (who answered, pickup by hour and attempt, talk time buckets, fast hang ups, objection types). The pure parts live in public/js/leaddb.js.
// Every lead carries a roll up of its own calls (leads.r_*), kept current when a result is saved and by the cron, so search and sort never re-read every call.
import { HttpError, json } from './util.js';
import { all, first, run, batch, now, getSettings, setSetting } from './db.js';
import { requireStaff, requireAdmin } from './auth.js';
import { route } from './router.js';
import { rollup, reachScore, engageScore, whereFor, cleanFilter, cleanQual, qualCount, insights, COLUMNS, COLUMN_MAP, PRESETS, answeredLabel } from '../public/js/leaddb.js';
import { isPersonName } from '../public/js/names.js';
import { likelyOwner } from '../public/js/leadfilter.js';
import { dtf } from '../public/js/fmtcache.js';

const OUTBOUND = "type IN ('call','manual_call') AND (status IS NULL OR status NOT IN ('inbound','missed','voicemail','inbound_answered'))";
const R_COLS = ['r_dials', 'r_connects', 'r_owner', 'r_staff', 'r_menu', 'r_vm', 'r_noans', 'r_dead', 'r_wrong', 'r_talk', 'r_longest', 'r_fast_hangs', 'r_shortest',
  'r_last_by', 'r_last_dispo', 'r_last_secs', 'r_obj', 'r_first_at', 'r_owner_at', 'r_to_owner', 'r_24h', 'r_convs', 'r_service'];

// Work out and save the roll up, scores and attempt numbers for these leads (any number; read 90 at a time, D1 allows 100 values a statement).
export async function rollupLeads(env, ids = []) {
  const t = now();
  let done = 0;
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const q = part.map(() => '?').join(',');
    const [leads, calls] = await Promise.all([
      all(env, `SELECT id, business, business_raw, phone_digits, phone_type, owner_name, reviews, dnc, scrub, stage, qual_n, source, meet_at, pack_views FROM leads WHERE id IN (${q})`, ...part),
      all(env, `SELECT id, lead_id, at, answered_at, duration, status, outcome, dispo, dispo_id, answered_by, hangup_stage, objection, attempt_no FROM activities WHERE lead_id IN (${q}) AND ${OUTBOUND} ORDER BY at`, ...part),
    ]);
    const by = new Map();
    for (const c of calls) (by.get(c.lead_id) || by.set(c.lead_id, []).get(c.lead_id)).push(c);
    const stmts = [];
    for (const l of leads) {
      const list = by.get(l.id) || [];
      const r = rollup(list, t);
      const facts = { ...l, ...r, owner_known: isPersonName(l.owner_name || ''), likely_owner: likelyOwner(l) };
      const set = { ...r, reach_score: reachScore(facts), engage_score: engageScore(facts, t), roll_at: t };
      const cols = Object.keys(set);
      stmts.push([`UPDATE leads SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => set[k]), l.id]);
      // Attempt number on each dial, for "pickup by attempt". Shells nobody dialed do not count.
      let n = 0;
      for (const c of list) {
        if (c.status === 'ready' && !c.outcome) continue;
        n++;
        if (c.attempt_no !== n) stmts.push(['UPDATE activities SET attempt_no = ? WHERE id = ?', n, c.id]);
      }
      done++;
    }
    for (let k = 0; k < stmts.length; k += 80) await batch(env, stmts.slice(k, k + 80));
  }
  return done;
}

// Cron: keep the roll up current for leads that changed or were never rolled up (a few dozen a run).
export async function rollTick(env, max = 40) {
  const rows = await all(env, 'SELECT id FROM leads WHERE roll_at IS NULL OR roll_at < updated_at OR (last_call_at IS NOT NULL AND last_call_at > roll_at) LIMIT ?', max);
  if (rows.length) await rollupLeads(env, rows.map((r) => r.id));
  return rows.length;
}

// What a call's result window sent: who answered, how far it got, the objection, and a phone menu path to keep on the lead.
export async function saveCallDetail(env, activityId, leadId, detail = {}, dispoId = '') {
  const pick = (v, n = 40) => (v ? String(v).replace(/[^a-z_]/gi, '').slice(0, n) || null : null);
  const answered = pick(detail.answered_by), stage = pick(detail.hangup_stage), obj = pick(detail.objection);
  if (activityId) await run(env, 'UPDATE activities SET answered_by = COALESCE(?, answered_by), hangup_stage = COALESCE(?, hangup_stage), objection = COALESCE(?, objection), dispo_id = COALESCE(?, dispo_id) WHERE id = ?',
    answered, stage, obj, pick(dispoId, 60), activityId);
  const menu = detail.menu_path ? String(detail.menu_path).replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  if (leadId && menu) await run(env, 'UPDATE leads SET menu_path = ? WHERE id = ?', menu, leadId);
}

// ---------- search ----------
const LIST = `id, business, contact_name, owner_name, phone, phone_digits, phone_type, email, email_status, website, city, state, zip, industry, category, stage, grade, score,
  rating, reviews, map_rank, source, tags, attempts, last_call_at, dnc, data_score, qual_n, reach_score, engage_score, menu_path, created_at, ${R_COLS.join(', ')}`;
const sortSql = (key) => (COLUMN_MAP[key] ? COLUMN_MAP[key][2] : 'score');
function parseFilter(url) {
  let f = {};
  try { f = JSON.parse(url.searchParams.get('f') || '{}'); } catch { f = {}; }
  return cleanFilter(f);
}
function orderBy(url) {
  const key = url.searchParams.get('sort') || 'score';
  const dir = url.searchParams.get('dir') === 'asc' ? 'ASC' : 'DESC';
  return `ORDER BY ${sortSql(key)} IS NULL, ${sortSql(key)} ${dir}, id`;
}

route('GET', '/api/leaddb/search', async ({ env, user, url }) => {
  requireStaff(user);
  const { where, vals, filter } = whereFor(parseFilter(url), { now: now() });
  const per = Math.min(200, Math.max(10, Number(url.searchParams.get('per')) || 50));
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const [count, rows] = await Promise.all([
    first(env, `SELECT COUNT(*) AS n FROM leads WHERE ${where}`, ...vals),
    all(env, `SELECT ${LIST} FROM leads WHERE ${where} ${orderBy(url)} LIMIT ? OFFSET ?`, ...vals, per, (page - 1) * per),
  ]);
  return json({ total: count?.n || 0, page, per, filter, rows });
});

// Everything the filter panel needs that is not fixed: the states and sources in the data, and how many leads still wait for a roll up.
route('GET', '/api/leaddb/meta', async ({ env, user }) => {
  requireStaff(user);
  const [states, sources, pending] = await Promise.all([
    all(env, "SELECT state AS v, COUNT(*) AS n FROM leads WHERE state IS NOT NULL AND state != '' GROUP BY state ORDER BY n DESC LIMIT 60"),
    all(env, "SELECT source AS v, COUNT(*) AS n FROM leads WHERE source IS NOT NULL AND source != '' GROUP BY source ORDER BY n DESC LIMIT 40"),
    first(env, 'SELECT COUNT(*) AS n FROM leads WHERE roll_at IS NULL'),
  ]);
  return json({ states, sources, pending: pending?.n || 0, presets: PRESETS.map(([id, label, f, sort]) => ({ id, label, f, sort })) });
});

// Data health: how complete and how fresh the database is (Apollo and ZoomInfo show the same kind of coverage numbers).
route('GET', '/api/leaddb/health', async ({ env, user }) => {
  requireStaff(user);
  const t = now();
  const h = await first(env, `SELECT COUNT(*) AS total,
      SUM(CASE WHEN phone_digits IS NOT NULL AND phone_digits != '' THEN 1 ELSE 0 END) AS phone,
      SUM(CASE WHEN phone_type = 'mobile' THEN 1 ELSE 0 END) AS mobile,
      SUM(CASE WHEN phone_type IS NOT NULL AND phone_type != '' THEN 1 ELSE 0 END) AS typed,
      SUM(CASE WHEN owner_name IS NOT NULL AND owner_name != '' THEN 1 ELSE 0 END) AS owner,
      SUM(CASE WHEN email_status = 'valid' THEN 1 ELSE 0 END) AS email_valid,
      SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) AS email,
      SUM(CASE WHEN website IS NOT NULL AND website != '' THEN 1 ELSE 0 END) AS website,
      SUM(CASE WHEN intel_at IS NOT NULL THEN 1 ELSE 0 END) AS researched,
      SUM(CASE WHEN scrubbed_at IS NOT NULL THEN 1 ELSE 0 END) AS scrubbed,
      SUM(CASE WHEN COALESCE(r_dials, 0) = 0 THEN 1 ELSE 0 END) AS never,
      SUM(CASE WHEN COALESCE(r_owner, 0) > 0 THEN 1 ELSE 0 END) AS reached_owner,
      SUM(CASE WHEN COALESCE(qual_n, 0) > 0 THEN 1 ELSE 0 END) AS qualified,
      SUM(CASE WHEN dnc = 1 THEN 1 ELSE 0 END) AS dnc,
      SUM(CASE WHEN COALESCE(scrubbed_at, created_at) < ? THEN 1 ELSE 0 END) AS stale
    FROM leads`, t - 182 * 864e5);
  return json({ health: h || {} });
});

// CSV of a search (owners: the whole list leaves the Hub).
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
route('GET', '/api/leaddb/export', async ({ env, user, url }) => {
  requireAdmin(user);
  const { where, vals } = whereFor(parseFilter(url), { now: now() });
  const rows = await all(env, `SELECT ${LIST} FROM leads WHERE ${where} ${orderBy(url)} LIMIT 5000`, ...vals);
  const cols = ['business', 'owner_name', 'contact_name', 'phone', 'phone_type', 'email', 'email_status', 'website', 'city', 'state', 'zip', 'industry', 'category', 'stage', 'grade', 'score',
    'reach_score', 'engage_score', 'rating', 'reviews', 'map_rank', 'source', 'tags', 'r_dials', 'r_connects', 'r_owner', 'r_staff', 'r_menu', 'r_vm', 'r_talk', 'r_longest', 'r_fast_hangs', 'r_last_by', 'r_last_dispo', 'r_obj',
    'menu_path', 'qual_n', 'data_score', 'dnc', 'last_call_at', 'created_at'];
  const out = [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(c === 'r_last_by' ? answeredLabel(r[c]) : (c.endsWith('_at') && r[c] ? new Date(r[c]).toISOString() : r[c]))).join(','))].join('\n');
  return new Response(out, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="rightway-lead-database.csv"' } });
});

// Saved searches, one list per person (Apollo calls these saved searches).
route('GET', '/api/leaddb/saved', async ({ env, user }) => {
  requireStaff(user);
  let list = [];
  try { list = JSON.parse((await getSettings(env))[`leaddb_saved:${user.id}`] || '[]'); } catch { list = []; }
  return json({ saved: Array.isArray(list) ? list : [] });
});
route('PUT', '/api/leaddb/saved', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const list = (Array.isArray(b.saved) ? b.saved : []).slice(0, 30).map((s) => ({
    id: String(s.id || Math.random().toString(36).slice(2, 10)).replace(/[^a-z0-9_]/gi, '').slice(0, 20),
    name: String(s.name || 'Search').replace(/[–—]/g, ', ').trim().slice(0, 60), f: cleanFilter(s.f || {}),
    sort: COLUMN_MAP[s.sort] ? s.sort : 'score', dir: s.dir === 'asc' ? 'asc' : 'desc',
  }));
  await setSetting(env, `leaddb_saved:${user.id}`, JSON.stringify(list));
  return json({ saved: list });
});

// "Dial this search": the dialer queue applies this filter when asked for db=1 (src/crm.js).
route('PUT', '/api/leaddb/dial', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const f = cleanFilter(b.f || {});
  await setSetting(env, `leaddb_dial:${user.id}`, JSON.stringify(f));
  return json({ ok: true, filter: f });
});
export async function dialFilterOf(env, userId) {
  try { return cleanFilter(JSON.parse((await getSettings(env))[`leaddb_dial:${userId}`] || '{}')); } catch { return {}; }
}

// Qualification answers on a lead (ANUM on the cold call, the rest on the audit).
route('PUT', '/api/leads/:id/qual', async ({ env, user, params, body }) => {
  requireStaff(user);
  const l = await first(env, 'SELECT id, qual FROM leads WHERE id = ?', params.id);
  if (!l) throw new HttpError('Lead not found.', 404);
  const b = await body();
  const q = cleanQual(b.qual || {});
  await run(env, 'UPDATE leads SET qual = ?, qual_n = ? WHERE id = ?', JSON.stringify(q), qualCount(q), l.id);
  await rollupLeads(env, [l.id]);
  return json({ qual: q, qual_n: qualCount(q) });
});

// Owners: rebuild the roll up for every lead, 150 at a time (the page calls again with `after` until `next` is null).
route('POST', '/api/leaddb/rebuild', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  const rows = await all(env, 'SELECT id FROM leads WHERE id > ? ORDER BY id LIMIT 150', String(b.after || ''));
  await rollupLeads(env, rows.map((r) => r.id));
  const left = rows.length === 150 ? rows[rows.length - 1].id : null;
  return json({ done: rows.length, next: left });
});

// ---------- insights ----------
const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
function localParts(at, tz) {
  try {
    const parts = dtf('en-US', { timeZone: tz || 'America/New_York', hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(at);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    const wd = parts.find((p) => p.type === 'weekday')?.value;
    return { hour: Number.isFinite(hour) ? hour % 24 : null, dow: DOW[wd] ?? null };
  } catch { return { hour: null, dow: null }; }
}
route('GET', '/api/leaddb/insights', async ({ env, user, url }) => {
  requireStaff(user);
  const t = now();
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 90));
  const from = t - days * 864e5;
  const rep = user.role === 'admin' ? (url.searchParams.get('rep') || '') : '';
  const { where, vals, filter } = whereFor(parseFilter(url), { now: t });
  const scoped = Object.keys(filter).length ? ` AND a.lead_id IN (SELECT id FROM leads WHERE ${where})` : '';
  const rows = await all(env, `SELECT a.id, a.lead_id, a.at, a.answered_at, a.duration, a.status, a.outcome, a.dispo, a.dispo_id, a.answered_by, a.hangup_stage, a.objection, a.attempt_no, a.by,
      l.business, l.industry, l.category, l.phone_type, l.state, l.source, l.grade, l.reviews, l.timezone
    FROM activities a LEFT JOIN leads l ON l.id = a.lead_id
    WHERE a.type IN ('call','manual_call') AND (a.status IS NULL OR a.status NOT IN ('inbound','missed','voicemail','inbound_answered')) AND a.at >= ?${rep ? ' AND a.by = ?' : ''}${scoped}
    ORDER BY a.at DESC LIMIT 20000`, from, ...(rep ? [rep] : []), ...(scoped ? vals : []));
  for (const r of rows) { const p = localParts(r.at, r.timezone); r.hour = p.hour; r.dow = p.dow; r.industry = r.industry || r.category || null; }
  const out = insights(rows);
  const users = Object.fromEntries((await all(env, "SELECT id, name, email FROM users WHERE role IN ('admin','team')")).map((u) => [u.id, u.name || u.email]));
  out.byRep = user.role === 'admin' ? out.byRep.map((r) => ({ ...r, label: users[r.key] || 'Unknown' })) : [];
  return json({ days, from, rep, filter, calls: rows.length, capped: rows.length >= 20000, users: user.role === 'admin' ? Object.entries(users).map(([id, name]) => ({ id, name })) : [], ...out });
});

export { R_COLS, COLUMNS };
