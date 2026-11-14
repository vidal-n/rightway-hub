// The Do Not Call list (suppression list), Pipeline tab "Do not call list". Modeled on the suppression lists in Apollo.io, Outreach and
// Close, and the Do Not Contact lists in ZoomInfo and Outscraper. The list lives in its own table (`suppressions`), apart from the
// leads, so:
//  - a business that asked not to be called, has a bad number, a phone menu or is a dead lead stays in the database (analytics keep it)
//    but is never dialed or texted again, and the dialer queue, manual dial, texts and workflows all check it;
//  - deleting a lead does not forget it: the importer and the Lead finder see its keys (phone, website domain, name plus place) and skip it,
//    so the same business is not scraped and added twice;
//  - the National and state registries are scrubbed by uploading the file (the browser reads it, only matching numbers reach us).
// Pure rules live in public/js/suppress.js.
import { HttpError, json } from './util.js';
import { all, first, run, batch, newId, now, getSettings, setSetting } from './db.js';
import { requireStaff, requireAdmin } from './auth.js';
import { route } from './router.js';
import { blockKeys, REASONS, MANUAL_REASONS, OPTIONAL_ACTS, reasonForAct, reasonLabel, isLegal, rowsFor, tenDigits, summarize, registryAge } from '../public/js/suppress.js';
import { dayKey } from './day.js';

const text = (v, n = 300) => (v == null ? null : String(v).replace(/\u0000/g, '').trim().slice(0, n) || null);
const crm = () => import('./crm.js');

const UPSERT = `INSERT INTO suppressions (key, grp, reason, blocks, lead_id, business, phone, website, city, state, note, source, by, at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET grp = excluded.grp, reason = excluded.reason, blocks = excluded.blocks, lead_id = excluded.lead_id, business = excluded.business, phone = excluded.phone,
    website = excluded.website, city = excluded.city, state = excluded.state, note = excluded.note, source = excluded.source, by = excluded.by, at = excluded.at, lifted_at = NULL, lifted_by = NULL
  WHERE suppressions.lifted_at IS NOT NULL
    OR (excluded.reason != 'deleted' AND excluded.blocks >= suppressions.blocks AND (suppressions.reason NOT IN ('dnc','registry') OR excluded.reason IN ('dnc','registry')))`;

// Statements that put these leads on the list. One group per lead; a stronger entry already on a key is never weakened.
export function suppressStatements(leads, reason, { by = null, note = null, source = 'manual' } = {}) {
  const t = now();
  const ops = [];
  for (const l of leads) {
    const rows = rowsFor(l, reason);
    if (!rows.length) continue;
    const grp = newId('sp_');
    for (const r of rows) ops.push([UPSERT, r.key, grp, reason, r.blocks, l.id || null, text(l.business, 200), text(l.phone, 40), text(l.website, 200), text(l.city, 80), text(l.state, 20), text(note, 300), source, by, t]);
  }
  return ops;
}
export async function suppressMany(env, leads, reason, opts = {}) {
  const ops = suppressStatements(leads, reason, opts);
  for (let i = 0; i < ops.length; i += 100) await batch(env, ops.slice(i, i + 100));
  // A request not to be called covers every copy of the business already in the Hub (Nov 2026): mark them too, so nobody on the team can dial one.
  if (isLegal(reason) && opts.copies !== false && leads.length <= 20) for (const l of leads) await markCopies(env, l, opts.by || null).catch((e) => console.error('mark copies', e));
  return ops.length;
}
export const suppress = (env, lead, reason, opts) => suppressMany(env, [lead], reason, opts);

// An active entry that stops a call or text to this lead (any of its keys), legal ones first.
export async function blockedFor(env, lead) {
  if (lead?.dnc || lead?.stage === 'dnc') return { key: null, grp: null, reason: 'dnc', note: null, at: null, business: lead.business || null }; // the lead's own flag always counts
  await backfillDnc(env);
  const keys = blockKeys(lead).slice(0, 8);
  if (!keys.length) return null;
  return first(env, `SELECT key, grp, reason, note, at, business FROM suppressions WHERE key IN (${keys.map(() => '?').join(',')}) AND blocks = 1 AND lifted_at IS NULL
    ORDER BY CASE WHEN reason IN ('dnc','registry') THEN 0 ELSE 1 END LIMIT 1`, ...keys).catch(() => null);
}
// Leads flagged Do Not Call before the list existed (or by a path that skipped it) get their entries once, so their copies are blocked too.
// Runs in slices of 300 until none are left, then stamps settings `supp_backfill`.
const backfilled = new WeakSet(); // one check per database per Worker start
async function backfillDnc(env) {
  if (backfilled.has(env.DB)) return;
  const done = await first(env, "SELECT v FROM settings WHERE k = 'supp_backfill'").catch(() => ({ v: '1' }));
  if (done?.v) { backfilled.add(env.DB); return; }
  const rows = await all(env, `SELECT id, business, phone, phone_digits, website, city, zip, state FROM leads
    WHERE (dnc = 1 OR stage = 'dnc') AND id NOT IN (SELECT lead_id FROM suppressions WHERE lead_id IS NOT NULL AND lifted_at IS NULL AND blocks = 1) LIMIT 300`).catch(() => []);
  if (rows.length) await suppressMany(env, rows, 'dnc', { source: 'backfill', note: 'Marked Do Not Call before the list existed.' });
  if (rows.length < 300) { await setSetting(env, 'supp_backfill', String(now())); backfilled.add(env.DB); }
}
// Every active blocking key at once, so a whole list of leads can be checked without a query each (the dialer queue, saved call lists).
// A lead is blocked when ANY of its keys (phone, website domain, name plus place) is here, so a second copy of a business that
// asked not to be called, with another phone number, is kept out too.
export async function blockedKeys(env) {
  await backfillDnc(env);
  const rows = await all(env, 'SELECT key FROM suppressions WHERE blocks = 1 AND lifted_at IS NULL').catch(() => []);
  return new Set(rows.map((r) => r.key));
}
export const leadBlocked = (keys, lead) => Boolean(lead?.dnc) || lead?.stage === 'dnc' || blockKeys(lead).some((k) => keys.has(k));
export async function blockedPhone(env, raw) {
  const d = tenDigits(raw);
  return d ? blockedFor(env, { phone_digits: d }) : null;
}
// The sentence a rep or the API shows when a call, text or email is refused.
export const blockText = (row, what = 'call') => (isLegal(row.reason)
  ? `This business is on the do not call list (${reasonLabel(row.reason).toLowerCase()}). Do not ${what} them.`
  : `This ${row.reason === 'bad_number' || row.reason === 'phone_menu' ? 'number' : 'business'} is on the do not call list (${reasonLabel(row.reason).toLowerCase()}).`);
// Throws the refusal for a call or text.
export async function guardLead(env, lead, what = 'call') {
  const row = await blockedFor(env, lead);
  if (row) throw new HttpError(blockText(row, what), 409);
}
// Email is only stopped by requests not to be contacted.
export async function emailBlocked(env, lead) {
  const keys = blockKeys(lead).slice(0, 8);
  if (!keys.length) return null;
  return first(env, `SELECT reason FROM suppressions WHERE key IN (${keys.map(() => '?').join(',')}) AND lifted_at IS NULL AND reason IN ('dnc','registry') LIMIT 1`, ...keys).catch(() => null);
}

// Active keys as pseudo leads, so the importer and the Lead finder dedupe against them with the code they already have.
export async function suppressedMap(env) {
  const rows = await all(env, 'SELECT key, grp, reason FROM suppressions WHERE lifted_at IS NULL').catch(() => []);
  const m = new Map();
  for (const r of rows) m.set(r.key, { id: null, dnc: isLegal(r.reason) ? 1 : 0, supp: r.reason, grp: r.grp });
  return m;
}
// Remember that a re-scrape was kept out (shown as "kept out" on the page).
export async function noteHits(env, keys) {
  const list = [...new Set(keys)];
  const t = now();
  const ops = [];
  for (let i = 0; i < list.length; i += 90) { const part = list.slice(i, i + 90); ops.push([`UPDATE suppressions SET hits = hits + 1, last_hit_at = ? WHERE key IN (${part.map(() => '?').join(',')})`, t, ...part]); }
  for (let i = 0; i < ops.length; i += 50) await batch(env, ops.slice(i, i + 50)).catch(() => {});
}

export async function optionalActs(env) {
  let l = [];
  try { l = JSON.parse((await getSettings(env).catch(() => ({}))).suppress_optional || '[]'); } catch { l = []; }
  return Array.isArray(l) ? l.filter((a) => OPTIONAL_ACTS[a]) : [];
}
// A call result was saved: if it is one that goes on the list, put the lead there.
export async function noteOutcome(env, lead, acts, { by = null, note = null } = {}) {
  const reason = reasonForAct(acts, await optionalActs(env));
  if (!reason) return null;
  await suppress(env, lead, reason, { by, note: note || null, source: 'call' });
  return reason;
}

// ---------- routes ----------
const lastWhere = (url) => {
  const reason = url.searchParams.get('reason') || '';
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
  const state = url.searchParams.get('status') === 'lifted' ? 'lifted_at IS NOT NULL' : 'lifted_at IS NULL';
  const w = [state], v = [];
  if (REASONS[reason]) { w.push('reason = ?'); v.push(reason); }
  if (q) { const like = `%${q.replace(/[%_]/g, '')}%`; w.push('(LOWER(business) LIKE ? OR phone LIKE ? OR LOWER(website) LIKE ?)'); v.push(like, like, like); }
  return { where: w.join(' AND '), vals: v };
};
const GROUPED = 'SELECT grp, reason, MAX(blocks) AS blocks, business, phone, website, city, state, lead_id, note, source, by, MIN(at) AS at, SUM(hits) AS hits, MAX(last_hit_at) AS last_hit_at, MAX(lifted_at) AS lifted_at FROM suppressions';

route('GET', '/api/suppress', async ({ env, user, url }) => {
  requireStaff(user);
  const { where, vals } = lastWhere(url);
  const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
  const rows = await all(env, `SELECT * FROM (${GROUPED} WHERE ${where} GROUP BY grp) WHERE at < ? ORDER BY at DESC LIMIT 101`, ...vals, before);
  const more = rows.length > 100;
  if (more) rows.pop();
  const names = new Map((await all(env, 'SELECT id, name FROM users')).map((u) => [u.id, u.name]));
  return json({ items: rows.map((r) => ({ ...r, by_name: names.get(r.by) || '', label: reasonLabel(r.reason), legal: isLegal(r.reason) })), next: more ? rows[rows.length - 1].at : null });
});

route('GET', '/api/suppress/stats', async ({ env, user }) => {
  requireStaff(user);
  const t = now();
  const groups = await all(env, `${GROUPED} WHERE lifted_at IS NULL GROUP BY grp`);
  const sum = summarize(groups);
  const keptOut = await first(env, 'SELECT COALESCE(SUM(hits), 0) AS n, COALESCE(SUM(CASE WHEN last_hit_at > ? THEN 1 ELSE 0 END), 0) AS recent FROM suppressions WHERE lifted_at IS NULL', t - 30 * 864e5);
  // Adds per day for the last 30 days, by reason.
  const days = [];
  for (let i = 29; i >= 0; i--) days.push(dayKey(t - i * 864e5));
  const perDay = Object.fromEntries(days.map((d) => [d, {}]));
  for (const g of groups) { if (g.at > t - 31 * 864e5) { const d = dayKey(g.at); if (perDay[d]) perDay[d][g.reason] = (perDay[d][g.reason] || 0) + 1; } }
  const names = new Map((await all(env, 'SELECT id, name FROM users')).map((u) => [u.id, u.name]));
  const reps = {};
  for (const g of groups) if (g.by) reps[names.get(g.by) || 'Someone'] = (reps[names.get(g.by) || 'Someone'] || 0) + 1;
  const st = await getSettings(env).catch(() => ({}));
  let log = [];
  try { log = JSON.parse(st.registry_log || '[]'); } catch { log = []; }
  return json({ ...sum, kept_out: keptOut?.n || 0, kept_out_recent: keptOut?.recent || 0, days, per_day: perDay, reps, optional: await optionalActs(env),
    registry: { ...registryAge(Number(st.registry_checked_at) || 0, t), log: log.slice(0, 8) } });
});

// Add by hand: a lead (from its page) or just a number, with a reason.
route('POST', '/api/suppress', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const reason = String(b.reason || '');
  if (!MANUAL_REASONS.includes(reason)) throw new HttpError('Pick why this goes on the list.');
  const note = text(b.note, 300);
  const acts = { dnc: 'dnc', dead: 'dead', bad_number: 'bad_number', phone_menu: 'phone_menu' }[reason];
  const { applyOutcome, updateLead } = await crm();
  let lead = null;
  if (b.leadId) lead = await first(env, 'SELECT * FROM leads WHERE id = ?', String(b.leadId));
  else if (tenDigits(b.phone)) lead = await first(env, 'SELECT * FROM leads WHERE phone_digits = ? LIMIT 1', tenDigits(b.phone));
  if (b.leadId && !lead) throw new HttpError('Lead not found.', 404);
  if (!lead && !tenDigits(b.phone)) throw new HttpError('Enter a phone number with area code.');
  if (lead) {
    const set = applyOutcome(lead, acts, { note: note ? `Do not call list: ${note}` : '' });
    set.last_call_at = lead.last_call_at; // adding to the list is not a call
    await updateLead(env, lead.id, set);
    await crm().then((m) => m.logActivity(env, { lead_id: lead.id, type: 'stage', body: `Added to the do not call list: ${reasonLabel(reason)}${note ? ` (${note})` : ''}`, by: user.id }));
  }
  const target = lead || { phone: b.phone, business: text(b.business, 200) || 'Number added by hand' };
  await suppress(env, { ...target, id: lead?.id || null }, reason, { by: user.id, note, source: 'manual' });
  return json({ ok: true, reason });
});

// Take an entry off. A request not to be called is permanent: only the other reasons can be lifted, and only by an owner.
route('POST', '/api/suppress/lift', async ({ env, user, body }) => {
  requireAdmin(user);
  const { grp } = await body();
  const rows = await all(env, 'SELECT key, reason, lead_id FROM suppressions WHERE grp = ? AND lifted_at IS NULL', String(grp || ''));
  if (!rows.length) throw new HttpError('That entry is not on the list.', 404);
  if (rows.some((r) => isLegal(r.reason))) throw new HttpError('A request not to be called stays on the list for good.', 409);
  await run(env, 'UPDATE suppressions SET lifted_at = ?, lifted_by = ? WHERE grp = ? AND lifted_at IS NULL', now(), user.id, String(grp));
  const leadId = rows.find((r) => r.lead_id)?.lead_id;
  if (leadId) {
    const l = await first(env, 'SELECT id, stage FROM leads WHERE id = ?', leadId);
    if (l && l.stage === 'lost') { await run(env, "UPDATE leads SET stage = 'new', next_action = NULL, next_action_at = NULL, updated_at = ? WHERE id = ?", now(), l.id); }
  }
  return json({ ok: true });
});

route('PUT', '/api/suppress/settings', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  const optional = (Array.isArray(b.optional) ? b.optional : []).filter((a) => OPTIONAL_ACTS[a]);
  await setSetting(env, 'suppress_optional', JSON.stringify(optional));
  return json({ ok: true, optional });
});

// Registry scrub. The browser reads the file (it can be hundreds of MB) and sends only the numbers that match our leads.
route('GET', '/api/suppress/phones', async ({ env, user }) => {
  requireAdmin(user);
  const rows = await all(env, "SELECT DISTINCT phone_digits FROM leads WHERE phone_digits IS NOT NULL AND phone_digits != '' AND dnc = 0 LIMIT 150000");
  return json({ phones: rows.map((r) => r.phone_digits) });
});
route('POST', '/api/suppress/registry', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  const label = text(b.label, 60) || 'Do not call registry';
  const phones = [...new Set((Array.isArray(b.phones) ? b.phones : []).map(tenDigits).filter(Boolean))];
  if (phones.length > 20000) throw new HttpError('Send up to 20,000 numbers at a time.');
  const checked = Math.max(0, Math.round(Number(b.checked)) || 0);
  const { updateLead } = await crm();
  let matched = 0;
  for (let i = 0; i < phones.length; i += 90) {
    const part = phones.slice(i, i + 90);
    const leads = await all(env, `SELECT * FROM leads WHERE phone_digits IN (${part.map(() => '?').join(',')}) AND dnc = 0`, ...part);
    if (!leads.length) continue;
    await suppressMany(env, leads, 'registry', { by: user.id, note: label, source: 'registry' });
    for (const l of leads) await updateLead(env, l.id, { dnc: 1, stage: 'dnc', next_action: 'On a do not call registry', next_action_at: null, updated_at: now() });
    matched += leads.length;
  }
  if (b.final) {
    const st = await getSettings(env).catch(() => ({}));
    let log = [];
    try { log = JSON.parse(st.registry_log || '[]'); } catch { log = []; }
    log.unshift({ at: now(), label, checked, matched: (Number(b.matchedTotal) || 0) || matched, by: user.name || '' });
    await setSetting(env, 'registry_log', JSON.stringify(log.slice(0, 20)));
    await setSetting(env, 'registry_checked_at', String(now()));
  }
  return json({ ok: true, matched });
});

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
route('GET', '/api/suppress/export', async ({ env, user }) => {
  requireAdmin(user);
  const rows = await all(env, `${GROUPED} WHERE lifted_at IS NULL GROUP BY grp ORDER BY at DESC LIMIT 50000`);
  const cols = ['business', 'phone', 'website', 'city', 'state', 'reason', 'source', 'note', 'added', 'kept_out'];
  const out = [cols.join(','), ...rows.map((r) => [r.business, r.phone, r.website, r.city, r.state, reasonLabel(r.reason), r.source, r.note, new Date(r.at).toISOString(), r.hits].map(csvCell).join(','))].join('\n');
  return new Response(out, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="rightway-do-not-call-list.csv"' } });
});

// The entry on a lead, for its panel (active entries only, blocking or not).
export async function entryFor(env, lead) {
  const keys = blockKeys(lead).slice(0, 8);
  if (!keys.length) return null;
  return first(env, `SELECT grp, reason, blocks, note, source, at FROM suppressions WHERE key IN (${keys.map(() => '?').join(',')}) AND lifted_at IS NULL ORDER BY blocks DESC, at DESC LIMIT 1`, ...keys).catch(() => null);
}


// ---------- copies of a Do Not Call business (Nov 2026, V: a partner called a lead already on Do Not Call; pipeline and leads are one list for the whole company) ----------
// Modeled on the suppression propagation in Outreach and Apollo.io: one request not to be called covers every record of that business.
const LEGAL_KEYS = "SELECT key FROM suppressions WHERE blocks = 1 AND lifted_at IS NULL AND reason IN ('dnc','registry')";
async function legalKeys(env) { await backfillDnc(env); return new Set((await all(env, LEGAL_KEYS).catch(() => [])).map((r) => r.key)); }

// Put these copies on Do Not Call: flag, stage, no next step, a line on their timeline, and their own keys on the list (their other phone numbers too).
async function flagCopies(env, copies, why, by) {
  if (!copies.length) return 0;
  const t = now();
  for (let i = 0; i < copies.length; i += 40) {
    const part = copies.slice(i, i + 40);
    const ph = part.map(() => '?').join(',');
    await batch(env, [
      [`UPDATE leads SET dnc = 1, stage = 'dnc', next_action_at = NULL, next_action = 'Do not call', updated_at = ? WHERE id IN (${ph})`, t, ...part.map((l) => l.id)],
      ...part.map((l) => [`INSERT INTO activities (id, lead_id, type, body, by, at) VALUES (?, ?, 'stage', ?, ?, ?)`, newId('a_'), l.id, `Do not call: ${why}`, by, t]),
    ]).catch((e) => console.error('flag copies', e));
  }
  await suppressMany(env, copies, 'dnc', { by, source: 'copy', note: why, copies: false });
  return copies.length;
}

// After a lead goes on the list: find copies by phone, website or the business name, keep those that share a key, and flag them.
export async function markCopies(env, lead, by = null) {
  const mine = new Set(blockKeys(lead));
  if (!mine.size) return 0;
  const digits = tenDigits(lead.phone_digits || lead.phone);
  const stem = String(lead.business || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 4).sort((a, b) => b.length - a.length)[0] || '';
  const dom = String(lead.website || '').toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  const where = [], vals = [];
  if (digits) { where.push('phone_digits = ?'); vals.push(digits); }
  if (dom && dom.includes('.')) { where.push('LOWER(website) LIKE ?'); vals.push(`%${dom}%`); }
  if (stem) { where.push('LOWER(business) LIKE ?'); vals.push(`%${stem}%`); }
  if (!where.length) return 0;
  const rows = await all(env, `SELECT id, business, phone, phone_digits, website, city, zip, state, dnc, stage FROM leads WHERE dnc = 0 AND stage != 'dnc' AND id != ? AND (${where.join(' OR ')}) LIMIT 200`, lead.id || '', ...vals);
  const copies = rows.filter((r) => blockKeys(r).some((k) => mine.has(k)));
  return flagCopies(env, copies, `copy of ${String(lead.business || 'a business').slice(0, 80)}, which is on the do not call list`, by);
}

// A slice of the sweep: leads after `after` (by id) that match a legal key but are not flagged. Returns where to continue.
export async function sweepSlice(env, after = '', limit = 250, by = null) {
  const keys = await legalKeys(env);
  const rows = await all(env, `SELECT id, business, phone, phone_digits, website, city, zip, state, dnc, stage FROM leads WHERE id > ? ORDER BY id LIMIT ?`, after || '', limit);
  const hit = rows.filter((r) => !(r.dnc || r.stage === 'dnc') && blockKeys(r).some((k) => keys.has(k)));
  const marked = await flagCopies(env, hit, 'matched a business on the do not call list', by);
  return { scanned: rows.length, marked, next: rows.length === limit ? rows[rows.length - 1].id : null };
}

// Keys written before this change used the ZIP or the city, not both. Add the other form for every active entry, once (slices of 200 entries).
export async function reindexKeys(env) {
  const done = await first(env, "SELECT v FROM settings WHERE k = 'supp_reindex'").catch(() => ({ v: 'x' }));
  if (done?.v === 'done') return 0;
  const after = done?.v || '';
  const groups = await all(env, `SELECT grp, reason, MIN(lead_id) AS lead_id, MIN(business) AS business, MIN(phone) AS phone, MIN(website) AS website, MIN(city) AS city, MIN(state) AS state, MIN(at) AS at
    FROM suppressions WHERE lifted_at IS NULL AND grp > ? AND business IS NOT NULL GROUP BY grp ORDER BY grp LIMIT 200`, after);
  const ops = [];
  for (const g of groups) for (const r of rowsFor(g, g.reason)) ops.push([`INSERT OR IGNORE INTO suppressions (key, grp, reason, blocks, lead_id, business, phone, website, city, state, note, source, by, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.key, g.grp, g.reason, r.blocks, g.lead_id, g.business, g.phone, g.website, g.city, g.state, 'Extra key added so copies are found', 'reindex', null, g.at]);
  for (let i = 0; i < ops.length; i += 100) await batch(env, ops.slice(i, i + 100)).catch((e) => console.error('reindex', e));
  await setSetting(env, 'supp_reindex', groups.length < 200 ? 'done' : groups[groups.length - 1].grp);
  return groups.length;
}

// Cron: finish the key reindex, then check every lead against the list once a day (a few hundred a run). Cursor in settings `comp_sweep` {day, after, marked}.
export async function sweepTick(env, limit = 250) {
  if (await reindexKeys(env)) return 0;
  let st = {};
  try { st = JSON.parse((await first(env, "SELECT v FROM settings WHERE k = 'comp_sweep'").catch(() => null))?.v || '{}'); } catch { st = {}; }
  const today = dayKey(now());
  if (st.done === today) return 0;
  const r = await sweepSlice(env, st.after || '', limit, null);
  const marked = (st.marked || 0) + r.marked;
  await setSetting(env, 'comp_sweep', JSON.stringify(r.next ? { after: r.next, marked, day: st.day || today } : { done: today, last: now(), marked }));
  return r.scanned;
}

route('POST', '/api/suppress/sweep', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  await reindexKeys(env);
  const r = await sweepSlice(env, String(b.after || ''), 250, user.id);
  return json(r);
});
route('GET', '/api/suppress/sweep', async ({ env, user }) => {
  requireStaff(user);
  let st = {};
  try { st = JSON.parse((await first(env, "SELECT v FROM settings WHERE k = 'comp_sweep'"))?.v || '{}'); } catch { st = {}; }
  return json({ last: st.last || null, marked: st.marked || 0, running: Boolean(st.after) });
});
