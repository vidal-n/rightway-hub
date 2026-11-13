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
import { dupKeys } from '../public/js/leadintel.js';
import { REASONS, MANUAL_REASONS, OPTIONAL_ACTS, reasonForAct, reasonLabel, isLegal, rowsFor, tenDigits, summarize, registryAge } from '../public/js/suppress.js';
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
  return ops.length;
}
export const suppress = (env, lead, reason, opts) => suppressMany(env, [lead], reason, opts);

// An active entry that stops a call or text to this lead (any of its keys), legal ones first.
export async function blockedFor(env, lead) {
  const keys = dupKeys(lead).slice(0, 4);
  if (!keys.length) return null;
  return first(env, `SELECT key, grp, reason, note, at, business FROM suppressions WHERE key IN (${keys.map(() => '?').join(',')}) AND blocks = 1 AND lifted_at IS NULL
    ORDER BY CASE WHEN reason IN ('dnc','registry') THEN 0 ELSE 1 END LIMIT 1`, ...keys).catch(() => null);
}
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
  const keys = dupKeys(lead).slice(0, 4);
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
  const keys = dupKeys(lead).slice(0, 4);
  if (!keys.length) return null;
  return first(env, `SELECT grp, reason, blocks, note, source, at FROM suppressions WHERE key IN (${keys.map(() => '?').join(',')}) AND lifted_at IS NULL ORDER BY blocks DESC, at DESC LIMIT 1`, ...keys).catch(() => null);
}
