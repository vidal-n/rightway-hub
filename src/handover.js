// Company accounts register, login audit, staff handover and per client work record (owners only).
// Modeled on the ownership transfer and offboarding flows in Google Workspace admin and the shared vault ownership lists in 1Password
// Business: work and access belong to the company, a person's items are handed to someone else and the history stays.
// V's rule (Nov 2026): accounts are opened with info@rightwaygrowth.com. Kiron did fulfillment under his own domain email, so the
// Dhal Unlimited work must stay on the record: nothing here deletes or rewrites who did what, it only moves what is still open.
import { HttpError, json } from './util.js';
import { all, first, run, newId, now, batch } from './db.js';
import { requireAdmin } from './auth.js';
import { route } from './router.js';
import { inviteToChat } from './chat.js';
import { VENDORS, loginState } from '../public/js/accounts.js';
import { AGENCY_EMAIL } from '../public/js/agency.js';

const cut = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const OPEN = "('todo','doing')";

// Names for every person who ever did work, including people who were removed (former_staff keeps their name after a delete).
export async function nameMap(env) {
  const m = {};
  for (const u of await all(env, 'SELECT id, name, email, role FROM users WHERE role != ?', 'client')) m[u.id] = { name: u.name || u.email, email: u.email, role: u.role, former: false };
  for (const u of await all(env, 'SELECT id, name, email, role FROM former_staff').catch(() => [])) if (!m[u.id]) m[u.id] = { name: `${u.name || u.email} (removed)`, email: u.email, role: u.role, former: true };
  return m;
}
export async function rememberStaff(env, target) {
  if (!target || target.role === 'client') return;
  await run(env, 'INSERT INTO former_staff (id, name, email, role, removed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET removed_at = excluded.removed_at', target.id, target.name || null, target.email, target.role, now());
}

// ---------- company accounts ----------
const accountRow = (a) => ({ ...a, state: loginState(a.login_email) });
route('GET', '/api/accounts', async ({ env, user }) => {
  requireAdmin(user);
  const rows = (await all(env, 'SELECT * FROM company_accounts ORDER BY vendor COLLATE NOCASE')).map(accountRow);
  return json({ accounts: rows, email: AGENCY_EMAIL, counts: { ok: rows.filter((r) => r.state === 'ok').length, other: rows.filter((r) => r.state === 'other').length, unset: rows.filter((r) => r.state === 'unset').length } });
});
route('POST', '/api/accounts', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = (await body()) || {};
  const vendor = cut(b.vendor, 80);
  if (!vendor) throw new HttpError('Type the name of the tool or vendor.');
  const id = newId('ca_');
  await run(env, 'INSERT INTO company_accounts (id, vendor, purpose, url, login_email, status, note, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, vendor, cut(b.purpose, 200) || null, cut(b.url, 300) || null, cut(b.login_email, 200).toLowerCase() || null, 'unchecked', cut(b.note, 500) || null, now(), user.id);
  return json({ ok: true, id });
});
route('POST', '/api/accounts/seed', async ({ env, user }) => {
  requireAdmin(user);
  const have = new Set((await all(env, 'SELECT vendor FROM company_accounts')).map((r) => r.vendor.toLowerCase()));
  const add = VENDORS.filter(([v]) => !have.has(v.toLowerCase()));
  if (add.length) await batch(env, add.map(([v, p, u]) => ['INSERT INTO company_accounts (id, vendor, purpose, url, login_email, status, updated_at, updated_by) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)', newId('ca_'), v, p, u || null, 'unchecked', now(), user.id]));
  return json({ ok: true, added: add.length });
});
route('PUT', '/api/accounts/:id', async ({ env, user, params, body }) => {
  requireAdmin(user);
  const cur = await first(env, 'SELECT * FROM company_accounts WHERE id = ?', params.id);
  if (!cur) throw new HttpError('Not found.', 404);
  const b = (await body()) || {};
  const pick = (k, n, lower) => (k in b ? (cut(b[k], n) ? (lower ? cut(b[k], n).toLowerCase() : cut(b[k], n)) : null) : cur[k]);
  const email = pick('login_email', 200, true);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError('That does not look like an email address.');
  await run(env, 'UPDATE company_accounts SET vendor = ?, purpose = ?, url = ?, login_email = ?, status = ?, note = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    cut(b.vendor, 80) || cur.vendor, pick('purpose', 200), pick('url', 300), email, ['unchecked', 'moved', 'ok'].includes(b.status) ? b.status : cur.status, pick('note', 500), now(), user.id, cur.id);
  return json({ ok: true });
});
route('DELETE', '/api/accounts/:id', async ({ env, user, params }) => {
  requireAdmin(user);
  await run(env, 'DELETE FROM company_accounts WHERE id = ?', params.id);
  return json({ ok: true });
});

// Every login that is not info@: company accounts, and client access items (Google profile manager, WordPress, Analytics ...) where the
// login used was a person's own address. These are the ones to re-invite as info@ and then mark moved.
route('GET', '/api/logins/audit', async ({ env, user }) => {
  requireAdmin(user);
  const accounts = (await all(env, 'SELECT * FROM company_accounts ORDER BY vendor COLLATE NOCASE')).map(accountRow).filter((a) => a.state !== 'ok');
  const items = await all(env, `SELECT a.client_id, a.item, a.status, a.login_email, a.note, c.name AS client FROM client_access a JOIN clients c ON c.id = a.client_id
    WHERE a.login_email IS NOT NULL AND TRIM(a.login_email) != '' AND LOWER(TRIM(a.login_email)) != ? AND c.status = 'active' ORDER BY c.name, a.item`, AGENCY_EMAIL);
  return json({ email: AGENCY_EMAIL, accounts, items });
});

// ---------- who holds what ----------
async function holdsOf(env, uid) {
  const t = now();
  const clients = await all(env, "SELECT id, name, status FROM clients WHERE owner_id = ? AND sample = 0 ORDER BY name", uid);
  const open = await first(env, `SELECT COUNT(*) AS n FROM tasks WHERE owner = ? AND status IN ${OPEN}`, uid);
  const appts = await first(env, 'SELECT COUNT(*) AS n FROM leads WHERE meet_at >= ? AND COALESCE(closer_id, meet_by) = ?', t, uid);
  const done = await all(env, "SELECT c.id, c.name, COUNT(*) AS n FROM tasks k JOIN clients c ON c.id = k.client_id WHERE k.done_by = ? AND k.status = 'done' GROUP BY c.id ORDER BY n DESC", uid);
  const mins = await all(env, 'SELECT client_id, SUM(COALESCE(minutes, 0)) AS m FROM time_entries WHERE user_id = ? GROUP BY client_id', uid);
  const minBy = Object.fromEntries(mins.map((r) => [r.client_id, r.m || 0]));
  const logins = await all(env, `SELECT a.client_id, a.item, a.login_email, c.name AS client FROM client_access a JOIN clients c ON c.id = a.client_id WHERE a.login_email IS NOT NULL AND LOWER(TRIM(a.login_email)) != ?`, AGENCY_EMAIL);
  return { clients, openTasks: open?.n || 0, appointments: appts?.n || 0, doneBy: done.map((r) => ({ ...r, minutes: minBy[r.id] || 0 })), logins };
}
route('GET', '/api/handover/holds/:id', async ({ env, user, params }) => {
  requireAdmin(user);
  const names = await nameMap(env);
  if (!names[params.id]) throw new HttpError('Person not found.', 404);
  const h = await holdsOf(env, params.id);
  // Logins typed with this person's own address, or any address on their work domain (not a free mail domain), are the ones to re-invite as info@.
  const mine = names[params.id].email.toLowerCase();
  const dom = mine.split('@')[1] || '';
  const FREE = /^(gmail|googlemail|yahoo|outlook|hotmail|icloud|aol|proton|protonmail|live|msn)\./;
  const theirs = (e) => { const x = String(e || '').trim().toLowerCase(); return x === mine || (dom && !FREE.test(dom) && x.endsWith(`@${dom}`) && x !== AGENCY_EMAIL); };
  return json({ person: names[params.id], ...h, theirLogins: h.logins.filter((l) => theirs(l.login_email)) });
});
route('GET', '/api/handover/clients', async ({ env, user, url }) => {
  requireAdmin(user);
  const q = cut(url.searchParams.get('q'), 60).toLowerCase();
  const rows = await all(env, "SELECT id, name, status, owner_id FROM clients WHERE sample = 0 ORDER BY name");
  const names = await nameMap(env);
  const list = rows.filter((c) => !q || c.name.toLowerCase().includes(q));
  const by = await all(env, "SELECT client_id, done_by, COUNT(*) AS n FROM tasks WHERE status = 'done' GROUP BY client_id, done_by");
  return json({ clients: list.map((c) => ({ id: c.id, name: c.name, status: c.status, manager: c.owner_id ? names[c.owner_id]?.name || 'unknown' : 'Nobody',
    workBy: by.filter((r) => r.client_id === c.id).map((r) => ({ who: names[r.done_by]?.name || (r.done_by ? 'unknown' : 'Hub'), n: r.n })) })) });
});

// ---------- the handover ----------
route('POST', '/api/handover', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = (await body()) || {};
  const names = await nameMap(env);
  const from = names[b.from], to = names[b.to];
  if (!from) throw new HttpError('Pick who the work is coming from.');
  if (!to || to.former) throw new HttpError('Pick someone on the team to take it over.');
  if (b.from === b.to) throw new HttpError('Pick two different people.');
  const held = await all(env, 'SELECT id, name FROM clients WHERE owner_id = ?', b.from);
  const ids = b.clients === 'all' ? held.map((c) => c.id) : (Array.isArray(b.clients) ? b.clients : []).filter((id) => held.some((c) => c.id === id));
  let tasks = 0, appts = 0;
  const at = now();
  for (const id of ids) {
    await run(env, 'UPDATE clients SET owner_id = ? WHERE id = ?', b.to, id);
    const r = await run(env, `UPDATE tasks SET owner = ? WHERE client_id = ? AND status IN ${OPEN} AND (owner = ? OR owner IS NULL)`, b.to, id, b.from);
    tasks += r?.meta?.changes ?? 0;
    await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', newId('l_'), id, `Account manager changed from ${from.name} to ${to.name}. Earlier work stays on the record.`, at, user.id);
    await inviteToChat(env, id, [b.to]).catch(() => {});
  }
  if (b.appointments) {
    const r = await run(env, 'UPDATE leads SET closer_id = ? WHERE meet_at >= ? AND COALESCE(closer_id, meet_by) = ?', b.to, at, b.from);
    appts = r?.meta?.changes ?? 0;
  }
  const counts = { clients: ids.length, tasks, appointments: appts };
  await run(env, 'INSERT INTO handovers (id, from_user, from_name, to_user, to_name, counts, note, at, by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId('ho_'), b.from, from.name, b.to, to.name, JSON.stringify(counts), cut(b.note, 300) || null, at, user.id);
  return json({ ok: true, ...counts });
});
route('GET', '/api/handover/history', async ({ env, user }) => {
  requireAdmin(user);
  const rows = await all(env, 'SELECT * FROM handovers ORDER BY at DESC LIMIT 50');
  return json({ history: rows.map((r) => ({ ...r, counts: JSON.parse(r.counts || '{}') })) });
});

// ---------- work record ----------
const dt = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '');
async function safe(p) { try { return await p; } catch { return []; } }
export async function workRecord(env, clientId) {
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', clientId);
  if (!c) return null;
  const who = await nameMap(env);
  const n = (id) => (id ? who[id]?.name || 'unknown' : 'The Hub');
  const rows = [];
  const add = (section, at, by, what, detail = '', link = '') => rows.push({ section, date: dt(at), by, what: String(what || ''), detail: String(detail || ''), link: String(link || '') });
  for (const t of await safe(all(env, 'SELECT * FROM tasks WHERE client_id = ? ORDER BY month, sort', clientId))) add('Tasks', t.done_at || t.created_at, n(t.done_by || t.owner), `${t.month} ${t.kind}: ${t.title}`, `${t.status}${t.note ? `. ${t.note}` : ''}`, t.link);
  for (const l of await safe(all(env, 'SELECT * FROM log WHERE client_id = ? ORDER BY at', clientId))) add('Log', l.at, n(l.by), l.text, '', l.link);
  for (const e of await safe(all(env, 'SELECT e.*, t.title FROM time_entries e LEFT JOIN tasks t ON t.id = e.task_id WHERE e.client_id = ? ORDER BY e.started_at', clientId))) add('Time', e.started_at, n(e.user_id), e.title || e.kind || 'Time', `${e.minutes || 0} minutes${e.note ? `. ${e.note}` : ''}`);
  for (const p of await safe(all(env, 'SELECT * FROM posts WHERE client_id = ? ORDER BY created_at', clientId))) add('Posts', p.posted_at || p.created_at, n(p.created_by), (p.google_text || p.facebook_text || p.note || '').slice(0, 160), p.status);
  for (const p of await safe(all(env, 'SELECT * FROM content WHERE client_id = ? ORDER BY created_at', clientId))) add('Pages and content', p.published_at || p.created_at, n(p.created_by), p.title, p.status, p.live_url);
  for (const f of await safe(all(env, 'SELECT * FROM site_fixes WHERE client_id = ? ORDER BY created_at', clientId))) add('Site fixes', f.created_at, n(f.by), f.what, `${f.before_text ? `Before: ${f.before_text}. ` : ''}${f.after_text ? `After: ${f.after_text}` : ''}${f.status === 'verified' ? ' (verified)' : ''}`, f.page_url);
  for (const k of await safe(all(env, 'SELECT * FROM link_log WHERE client_id = ? ORDER BY created_at', clientId))) add('Listings and links', k.live_at || k.created_at, n(k.by), `${k.type}: ${k.name}`, k.status, k.url);
  for (const a of await safe(all(env, 'SELECT * FROM client_access WHERE client_id = ?', clientId))) add('Access', a.updated_at, n(a.updated_by), a.item, `${a.status}${a.login_email ? `. Login: ${a.login_email}` : ''}${a.note ? `. ${a.note}` : ''}`);
  const people = {};
  for (const r of rows) if (r.section === 'Tasks' && /done/.test(r.detail)) people[r.by] = (people[r.by] || 0) + 1;
  return { client: { id: c.id, name: c.name, website: c.website, manager: n(c.owner_id) }, made: dt(now()), tasksDoneBy: people, rows };
}
const csvCell = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
route('GET', '/api/clients/:id/work-record', async ({ env, user, params, url }) => {
  requireAdmin(user);
  const rec = await workRecord(env, params.id);
  if (!rec) throw new HttpError('Client not found.', 404);
  if (url.searchParams.get('format') === 'csv') {
    const lines = [['Section', 'Date', 'Who', 'What', 'Detail', 'Link'].join(',')].concat(rec.rows.map((r) => [r.section, r.date, r.by, r.what, r.detail, r.link].map(csvCell).join(',')));
    return new Response(lines.join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${rec.client.name.replace(/[^\w ]+/g, '').trim() || 'client'} work record.csv"` } });
  }
  return json(rec);
});
