// Fulfillment workflow: the monthly task engine (fills every active client's month on its own, with owners and due dates),
// the "My work" queue across all clients, editable step-by-step guides, proof (live link or screenshot), time tracking,
// hours per client, and the client access checklist.
import { HttpError, json } from './util.js';
import { all, first, run, batch, newId, now } from './db.js';
import { requireStaff, requireAdmin, requireClientAccess, isStaff } from './auth.js';
import { route } from './router.js';
import { tasksForMonth, monthKey, planOf, MONTHLY_CENTS } from './plans.js';
import { guideFor, cleanGuide, dueDate, accessState, accessGaps, blockedBy, ACCESS_ITEMS, ACCESS_STATUS, DEFAULT_GUIDES } from '../public/js/guides.js';
import { notifyLater } from './notify.js';

const parse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const text = (v, max = 500) => (v == null ? null : String(v).replace(/\u0000/g, '').trim().slice(0, max) || null);
const MAX_PROOF = 8 * 1024 * 1024;
const MAX_TIMER_MIN = 6 * 60; // a timer left running overnight is capped at 6 hours
const monthRange = (m) => { const [y, mo] = m.split('-').map(Number); return [Date.UTC(y, mo - 1, 1), Date.UTC(y, mo, 1)]; };
const validMonth = (m) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || '')) ? m : monthKey());

export async function savedGuides(env) {
  const rows = await all(env, 'SELECT kind, data FROM guides').catch(() => []);
  return Object.fromEntries(rows.map((r) => [r.kind, parse(r.data, {})]));
}

// ---------- task engine ----------
// One client's tasks for one month: owner = the client's account manager, due dates spread through the month.
export async function generateTasks(env, c, month) {
  if (c.parent_id) return 0; // locations: the plan's work lives on the main business
  const existing = await first(env, 'SELECT COUNT(*) AS n FROM tasks WHERE client_id = ? AND month = ?', c.id, month);
  if (existing.n > 0) return 0;
  const hasSetup = (await first(env, "SELECT COUNT(*) AS n FROM tasks WHERE client_id = ? AND kind = 'setup'", c.id)).n > 0;
  const list = tasksForMonth({ ...c, has_setup: hasSetup }, month);
  const counts = {};
  const seen = {};
  for (const t of list) counts[t.kind] = (counts[t.kind] || 0) + 1;
  const at = now();
  await batch(env, list.map((t, i) => {
    seen[t.kind] = (seen[t.kind] || 0) + 1;
    return ['INSERT INTO tasks (id, client_id, month, kind, title, sort, created_at, owner, due) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId('t_'), c.id, month, t.kind, t.title, i, at, c.owner_id || null, dueDate(t.kind, month, seen[t.kind], counts[t.kind], c.start_date)];
  }));
  return list.length;
}

// Every active client gets this month's tasks without anyone clicking a button. Cheap when there is nothing to do.
export async function ensureMonthTasks(env, month = monthKey()) {
  const due = await all(env, `SELECT * FROM clients c WHERE c.status = 'active' AND c.sample = 0 AND c.parent_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.client_id = c.id AND t.month = ?)`, month);
  let made = 0;
  for (const c of due) made += await generateTasks(env, c, month);
  return made;
}

// ---------- access ----------
export async function autoAccess(env, c) {
  const tn = await first(env, "SELECT COUNT(*) AS n FROM tracking_numbers WHERE client_id = ? AND status = 'active'", c.id).catch(() => null);
  return { website: Boolean(c.wp_user && c.wp_pass), gsc: Boolean(c.gsc_site), ga4: Boolean(c.ga4_property), gbp: Boolean(c.gbp_location), tracking: Boolean(tn?.n) };
}
export async function accessFor(env, c) {
  const rows = await all(env, 'SELECT * FROM client_access WHERE client_id = ?', c.id);
  return accessState(c, rows, await autoAccess(env, c));
}
export async function markAccess(env, clientId, item, status, by = null) {
  await run(env, `INSERT INTO client_access (client_id, item, status, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(client_id, item) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at, updated_by = excluded.updated_by`, clientId, item, status, now(), by);
}

async function allGaps(env) {
  const clients = await all(env, "SELECT * FROM clients WHERE status = 'active' AND sample = 0 AND parent_id IS NULL ORDER BY name");
  const out = [];
  for (const c of clients) {
    const gaps = accessGaps(await accessFor(env, c));
    if (gaps.length) out.push({ client_id: c.id, name: c.name, gaps: gaps.map((g) => ({ key: g.key, label: g.label, status: g.status })) });
  }
  return out;
}

// ---------- time ----------
async function stopRunning(env, userId) {
  const open = await all(env, 'SELECT * FROM time_entries WHERE user_id = ? AND ended_at IS NULL', userId);
  const t = now();
  for (const e of open) {
    const minutes = Math.min(MAX_TIMER_MIN, Math.max(1, Math.round((t - e.started_at) / 60e3)));
    await run(env, 'UPDATE time_entries SET ended_at = ?, minutes = ? WHERE id = ?', Math.min(t, e.started_at + minutes * 60e3), minutes, e.id);
  }
  return open.length;
}

async function runningFor(env, userId) {
  return first(env, `SELECT e.id, e.task_id, e.client_id, e.started_at, t.title, c.name AS client_name FROM time_entries e
    JOIN tasks t ON t.id = e.task_id JOIN clients c ON c.id = e.client_id WHERE e.user_id = ? AND e.ended_at IS NULL ORDER BY e.started_at DESC LIMIT 1`, userId);
}

async function taskOr404(env, id) {
  const t = await first(env, 'SELECT * FROM tasks WHERE id = ?', id);
  if (!t) throw new HttpError('Task not found.', 404);
  return t;
}

// ---------- the queue ----------
route('GET', '/api/work', async ({ env, user, url }) => {
  requireStaff(user);
  const month = monthKey();
  await ensureMonthTasks(env, month).catch((e) => console.error('task engine', e));
  const who = url.searchParams.get('who') || 'me';
  const clientId = url.searchParams.get('client') || null;
  const where = ["t.status IN ('todo','doing')", "c.status = 'active'", 't.month <= ?'];
  const args = [month];
  if (who === 'me') { where.push('t.owner = ?'); args.push(user.id); }
  else if (who === 'none') where.push('t.owner IS NULL');
  else if (who !== 'all') { where.push('t.owner = ?'); args.push(who); }
  if (clientId) { where.push('t.client_id = ?'); args.push(clientId); }
  const tasks = await all(env, `SELECT t.id, t.client_id, t.month, t.kind, t.title, t.status, t.note, t.link, t.owner, t.due, t.proof_key, t.client_visible,
      c.name AS client_name, c.plan, (SELECT COALESCE(SUM(minutes), 0) FROM time_entries e WHERE e.task_id = t.id AND e.ended_at IS NOT NULL) AS logged
    FROM tasks t JOIN clients c ON c.id = t.client_id WHERE ${where.join(' AND ')} ORDER BY COALESCE(t.due, t.month || '-28'), c.name, t.sort LIMIT 600`, ...args);
  const [a, b] = monthRange(month);
  const ownerSql = who === 'me' ? ' AND owner = ?' : who !== 'all' && who !== 'none' ? ' AND owner = ?' : '';
  const ownerArg = who === 'me' ? [user.id] : who !== 'all' && who !== 'none' ? [who] : [];
  const doneNow = await first(env, `SELECT COUNT(*) AS n FROM tasks WHERE status = 'done' AND done_at >= ? AND done_at < ?${ownerSql}`, a, b, ...ownerArg);
  const userSql = who === 'me' ? ' AND user_id = ?' : who !== 'all' && who !== 'none' ? ' AND user_id = ?' : '';
  const mins = await first(env, `SELECT COALESCE(SUM(minutes), 0) AS m FROM time_entries WHERE ended_at IS NOT NULL AND started_at >= ? AND started_at < ?${userSql}`, a, b, ...ownerArg);
  const team = await all(env, "SELECT id, name, email, role FROM users WHERE role IN ('admin','team') ORDER BY name");
  const saved = await savedGuides(env);
  const est = Object.fromEntries(Object.keys(DEFAULT_GUIDES).map((k) => { const g = guideFor(k, saved); return [k, { minutes: g.minutes, proof: g.proof }]; }));
  const meetings = await all(env, `SELECT m.id, m.client_id, m.title, m.start_at, m.minutes, m.meet_link, c.name AS client_name FROM meetings m JOIN clients c ON c.id = m.client_id
    WHERE m.status = 'scheduled' AND m.start_at >= ? AND m.start_at < ? ORDER BY m.start_at LIMIT 20`, now() - 3600e3, now() + 7 * 864e5).catch(() => []);
  return json({
    month, who, tasks, team, est, meetings,
    stats: { open: tasks.length, doneThisMonth: doneNow?.n || 0, minutesThisMonth: mins?.m || 0 },
    running: await runningFor(env, user.id),
    access: await allGaps(env),
  });
});

// One task with its guide, time, access warnings and the tools for its kind.
route('GET', '/api/tasks/:id', async ({ env, user, params }) => {
  requireStaff(user);
  const t = await taskOr404(env, params.id);
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', t.client_id);
  const guide = guideFor(t.kind, await savedGuides(env));
  const time = await all(env, `SELECT e.id, e.user_id, e.started_at, e.ended_at, e.minutes, e.manual, e.note, u.name AS who FROM time_entries e
    LEFT JOIN users u ON u.id = e.user_id WHERE e.task_id = ? ORDER BY e.started_at DESC LIMIT 50`, t.id);
  const access = await accessFor(env, c);
  return json({
    task: { ...t, checks: parse(t.checks, []), client_name: c.name, plan: c.plan },
    guide, time, blocked: blockedBy(t.kind, access).map((i) => ({ key: i.key, label: i.label, status: i.status, how: i.how })),
    tools: await toolsFor(env, t, c),
    running: await runningFor(env, user.id),
  });
});

// Kind-specific help shown in the task panel, so the work happens from the task.
async function toolsFor(env, t, c) {
  const k = t.kind;
  const out = { kind: k };
  const safe = (p) => p.catch(() => null);
  if (k === 'post') {
    out.posts = (await safe(all(env, "SELECT id, status, google_text, media_key, created_at FROM posts WHERE client_id = ? AND status IN ('approved','draft') ORDER BY status = 'approved' DESC, created_at LIMIT 5", c.id))) || [];
    out.gbp = Boolean(c.gbp_location);
  }
  if (k === 'photos') out.gbp = Boolean(c.gbp_location);
  if (k === 'link' || k === 'setup') {
    out.details = businessDetails(c);
    const audit = await safe(first(env, 'SELECT results, created_at FROM citation_audits WHERE client_id = ? ORDER BY created_at DESC LIMIT 1', c.id));
    const res = parse(audit?.results, []) || [];
    out.missing = res.filter((r) => ['missing', 'mismatch'].includes(r.status)).slice(0, 6).map((r) => ({ name: r.name, status: r.status, url: r.signup || r.url || null }));
    out.submitted = (await safe(all(env, "SELECT id, name, url, status FROM link_log WHERE client_id = ? AND status IN ('planned','submitted') ORDER BY created_at DESC LIMIT 6", c.id))) || [];
  }
  if (k === 'onpage' || k === 'technical') {
    const a = await safe(first(env, "SELECT result, score, finished_at FROM site_audits WHERE client_id = ? AND status = 'done' ORDER BY finished_at DESC LIMIT 1", c.id));
    const r = parse(a?.result, null);
    const rank = { high: 0, medium: 1, low: 2 };
    out.audit = r ? { score: a.score, at: a.finished_at, issues: (r.issues || []).filter((i) => k === 'technical' ? i.kind === 'technical' || /schema/i.test(i.key) : true)
      .sort((x, y) => rank[x.severity] - rank[y.severity]).slice(0, 5).map((i) => ({ key: i.key, severity: i.severity, title: i.title, fix: i.fix, pages: (i.pages || []).slice(0, 3) })) } : null;
    out.website = c.website || null;
  }
  if (k === 'page' || k === 'content') {
    out.content = (await safe(all(env, "SELECT id, title, status, live_url FROM content WHERE client_id = ? AND status != 'published' ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'review' THEN 1 WHEN 'changes' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END, updated_at DESC LIMIT 5", c.id))) || [];
    out.wp = Boolean(c.wp_url && c.wp_user && c.wp_pass);
  }
  if (['replies', 'reviews', 'monitor', 'reputation'].includes(k)) {
    const pull = await safe(first(env, "SELECT reviews, finished_at FROM review_pulls WHERE client_id = ? AND status = 'done' ORDER BY created_at DESC LIMIT 1", c.id));
    const revs = parse(pull?.reviews, []) || [];
    out.reviews = { at: pull?.finished_at || null, unanswered: revs.filter((r) => !r.reply).sort((x, y) => y.at - x.at).slice(0, 8) };
    out.gbp = Boolean(c.gbp_location);
  }
  if (k === 'report' || k === 'calls') {
    const rep = await safe(first(env, 'SELECT id, status, token FROM reports WHERE client_id = ? AND month = ?', c.id, t.month));
    out.report = rep ? { status: rep.status, url: `/report.html#${rep.token}` } : null;
  }
  if (k === 'meeting') {
    const m = await safe(first(env, "SELECT id, start_at, meet_link, status FROM meetings WHERE client_id = ? AND status != 'cancelled' AND start_at >= ? ORDER BY start_at LIMIT 1", c.id, monthRange(t.month)[0]));
    out.meeting = m || null;
  }
  return out;
}

export function businessDetails(c) {
  const lines = [
    ['Business name', c.name], ['Address', c.address], ['Phone', c.phone], ['Website', c.website], ['Category', c.category],
    ['Services', c.services], ['Cities served', c.cities], ['Email', c.contact_email],
  ].filter(([, v]) => v);
  return lines.map(([k, v]) => ({ label: k, value: String(v) }));
}

// ---------- owner, due, bulk ----------
route('PUT', '/api/clients/:id/owner', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = await first(env, 'SELECT id FROM clients WHERE id = ?', params.id);
  if (!c) throw new HttpError('Client not found.', 404);
  const b = await body();
  const owner = b.owner_id ? await first(env, "SELECT id FROM users WHERE id = ? AND role IN ('admin','team')", b.owner_id) : null;
  if (b.owner_id && !owner) throw new HttpError('Pick someone on the team.');
  await run(env, 'UPDATE clients SET owner_id = ? WHERE id = ?', owner?.id || null, c.id);
  let moved = 0;
  if (b.apply) {
    const r = await run(env, "UPDATE tasks SET owner = ? WHERE client_id = ? AND status IN ('todo','doing') AND (owner IS NULL OR ? = 1)", owner?.id || null, c.id, b.all ? 1 : 0);
    moved = r?.meta?.changes ?? 0;
  }
  return json({ ok: true, owner_id: owner?.id || null, moved });
});

route('POST', '/api/work/bulk', async ({ env, user, body, defer }) => {
  requireStaff(user);
  const b = await body();
  const ids = (Array.isArray(b.ids) ? b.ids : []).filter((x) => typeof x === 'string').slice(0, 300);
  if (!ids.length) throw new HttpError('Pick at least one task.');
  const set = {};
  if ('owner' in b) {
    if (b.owner && !(await first(env, "SELECT id FROM users WHERE id = ? AND role IN ('admin','team')", b.owner))) throw new HttpError('Pick someone on the team.');
    set.owner = b.owner || null;
  }
  if ('due' in b) {
    if (b.due && !/^\d{4}-\d{2}-\d{2}$/.test(b.due)) throw new HttpError('Pick a date.');
    set.due = b.due || null;
  }
  const cols = Object.keys(set);
  if (!cols.length) throw new HttpError('Nothing to change.');
  await batch(env, ids.map((id) => [`UPDATE tasks SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => set[k]), id]));
  if (set.owner && set.owner !== user.id) {
    await notifyLater({ env, defer }, { to: [set.owner], kind: 'task', title: `${ids.length} task${ids.length === 1 ? '' : 's'} assigned to you`, body: `From ${user.name || 'a teammate'}. Open My work to see them.`, url: '/#/work', slack: false });
  }
  return json({ ok: true, changed: ids.length });
});

// ---------- proof ----------
route('POST', '/api/tasks/:id/proof', async ({ env, user, params, request }) => {
  requireStaff(user);
  const t = await taskOr404(env, params.id);
  if (!env.MEDIA) throw new HttpError('Photo storage is not connected.', 503);
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') throw new HttpError('Pick a screenshot to attach.');
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) throw new HttpError('Screenshots must be PNG, JPG, WebP or GIF.');
  if (file.size > MAX_PROOF) throw new HttpError('That image is over 8 MB.');
  const key = `proof/${t.client_id}/${t.id}/${newId()}`;
  await env.MEDIA.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  if (t.proof_key) await env.MEDIA.delete(t.proof_key).catch(() => {});
  await run(env, 'UPDATE tasks SET proof_key = ?, proof_type = ? WHERE id = ?', key, file.type, t.id);
  return json({ ok: true });
});

route('DELETE', '/api/tasks/:id/proof', async ({ env, user, params }) => {
  requireStaff(user);
  const t = await taskOr404(env, params.id);
  if (t.proof_key && env.MEDIA) await env.MEDIA.delete(t.proof_key).catch(() => {});
  await run(env, 'UPDATE tasks SET proof_key = NULL, proof_type = NULL WHERE id = ?', t.id);
  return json({ ok: true });
});

async function sendProof(env, t) {
  if (!t?.proof_key || !env.MEDIA) throw new HttpError('No screenshot on this task.', 404);
  const obj = await env.MEDIA.get(t.proof_key);
  if (!obj) throw new HttpError('Screenshot not found.', 404);
  return new Response(obj.body, { headers: { 'content-type': t.proof_type || 'image/jpeg', 'cache-control': 'private, max-age=3600' } });
}

route('GET', '/api/tasks/:id/proof', async ({ env, user, params }) => {
  const t = await taskOr404(env, params.id);
  requireClientAccess(user, t.client_id);
  if (!isStaff(user) && !t.client_visible) throw new HttpError('Not found.', 404);
  return sendProof(env, t);
});

// Screenshots on the shared monthly report: the report link is the key, and only that client's visible tasks for that month show.
route('GET', '/api/public/proof/:token/:taskId', async ({ env, params }) => {
  const rep = await first(env, 'SELECT client_id, month FROM reports WHERE token = ?', params.token);
  const t = rep && await first(env, 'SELECT * FROM tasks WHERE id = ? AND client_id = ? AND month = ? AND client_visible = 1', params.taskId, rep.client_id, rep.month);
  if (!t) throw new HttpError('Not found.', 404);
  return sendProof(env, t);
}, { public: true });

// ---------- time ----------
route('GET', '/api/work/timer', async ({ env, user }) => { requireStaff(user); return json({ running: await runningFor(env, user.id) }); });

route('POST', '/api/tasks/:id/timer', async ({ env, user, params, body }) => {
  requireStaff(user);
  const t = await taskOr404(env, params.id);
  const { action } = await body();
  if (action === 'start') {
    await stopRunning(env, user.id); // one timer at a time
    await run(env, 'INSERT INTO time_entries (id, task_id, client_id, user_id, kind, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId('te_'), t.id, t.client_id, user.id, t.kind, now(), now());
    if (t.status === 'todo') await run(env, "UPDATE tasks SET status = 'doing' WHERE id = ?", t.id);
    if (!t.owner) await run(env, 'UPDATE tasks SET owner = ? WHERE id = ?', user.id, t.id);
  } else if (action === 'stop') {
    await stopRunning(env, user.id);
  } else throw new HttpError('Start or stop.');
  return json({ running: await runningFor(env, user.id) });
});

route('POST', '/api/tasks/:id/time', async ({ env, user, params, body }) => {
  requireStaff(user);
  const t = await taskOr404(env, params.id);
  const b = await body();
  const minutes = Math.round(Number(b.minutes));
  if (!(minutes >= 1 && minutes <= 600)) throw new HttpError('Enter minutes between 1 and 600.');
  const end = now();
  await run(env, 'INSERT INTO time_entries (id, task_id, client_id, user_id, kind, started_at, ended_at, minutes, manual, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
    newId('te_'), t.id, t.client_id, user.id, t.kind, end - minutes * 60e3, end, minutes, text(b.note, 300), now());
  return json({ ok: true });
});

route('DELETE', '/api/time/:id', async ({ env, user, params }) => {
  requireStaff(user);
  const e = await first(env, 'SELECT * FROM time_entries WHERE id = ?', params.id);
  if (!e) throw new HttpError('Time entry not found.', 404);
  if (e.user_id !== user.id && user.role !== 'admin') throw new HttpError('Only owners can remove someone else\'s time.', 403);
  await run(env, 'DELETE FROM time_entries WHERE id = ?', e.id);
  return json({ ok: true });
});

// Hours per client, per person and per kind of task for a month. Owners also see revenue per hour.
export async function hoursReport(env, month, { money = false } = {}) {
  const [a, b] = monthRange(month);
  const rows = await all(env, `SELECT e.client_id, e.user_id, e.kind, e.task_id, e.minutes, c.name AS client_name, c.plan, c.mrr_cents, c.billing_status, c.parent_id, u.name AS user_name
    FROM time_entries e JOIN clients c ON c.id = e.client_id LEFT JOIN users u ON u.id = e.user_id WHERE e.ended_at IS NOT NULL AND e.started_at >= ? AND e.started_at < ?`, a, b);
  const sum = (list) => list.reduce((s, r) => s + (r.minutes || 0), 0);
  const group = (key) => { const m = new Map(); for (const r of rows) { const k = r[key] || 'none'; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
  const clients = await all(env, "SELECT id, name, plan, mrr_cents, billing_status FROM clients WHERE status = 'active' AND sample = 0 AND parent_id IS NULL ORDER BY name");
  const byClient = group('client_id');
  const saved = await savedGuides(env);
  const perClient = clients.map((c) => {
    const list = byClient.get(c.id) || [];
    const minutes = sum(list);
    const revenue = c.mrr_cents != null && c.billing_status ? c.mrr_cents / 100 : (MONTHLY_CENTS[c.plan] || 0) / 100;
    const planned = planOf(c.plan).monthly.reduce((s, [kind, , n]) => s + guideFor(kind, saved).minutes * n, 0);
    return { id: c.id, name: c.name, plan: c.plan, minutes, planned, revenue: money ? revenue : undefined, perHour: money && minutes ? Math.round(revenue / (minutes / 60)) : undefined };
  }).sort((x, y) => y.minutes - x.minutes);
  const perUser = [...group('user_id').entries()].map(([id, list]) => ({ id, name: list[0].user_name || 'Someone', minutes: sum(list), tasks: new Set(list.map((r) => r.task_id)).size })).sort((x, y) => y.minutes - x.minutes);
  const perKind = [...group('kind').entries()].map(([kind, list]) => {
    const tasks = new Set(list.map((r) => r.task_id)).size;
    return { kind, minutes: sum(list), tasks, avg: tasks ? Math.round(sum(list) / tasks) : 0, estimate: guideFor(kind, saved).minutes };
  }).sort((x, y) => y.minutes - x.minutes);
  const total = sum(rows);
  const revenue = money ? perClient.reduce((s, c) => s + (c.revenue || 0), 0) : undefined;
  return { month, total, perClient, perUser, perKind, revenue, perHour: money && total ? Math.round(revenue / (total / 60)) : undefined };
}

route('GET', '/api/work/hours', async ({ env, user, url }) => {
  requireStaff(user);
  return json(await hoursReport(env, validMonth(url.searchParams.get('month')), { money: user.role === 'admin' }));
});

// ---------- guides ----------
route('GET', '/api/guides', async ({ env, user }) => {
  requireStaff(user);
  const saved = await savedGuides(env);
  return json({ guides: Object.keys(DEFAULT_GUIDES).map((k) => guideFor(k, saved)) });
});

route('PUT', '/api/guides/:kind', async ({ env, user, params, body }) => {
  requireAdmin(user);
  if (!DEFAULT_GUIDES[params.kind]) throw new HttpError('Unknown kind of task.', 404);
  const g = cleanGuide(await body());
  await run(env, `INSERT INTO guides (kind, data, updated_at, updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`, params.kind, JSON.stringify(g), now(), user.id);
  return json({ guide: guideFor(params.kind, await savedGuides(env)) });
});

route('DELETE', '/api/guides/:kind', async ({ env, user, params }) => {
  requireAdmin(user);
  await run(env, 'DELETE FROM guides WHERE kind = ?', params.kind);
  return json({ guide: guideFor(params.kind, {}) });
});

// ---------- access checklist ----------
route('GET', '/api/clients/:id/access', async ({ env, user, params }) => {
  requireStaff(user);
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', params.id);
  if (!c) throw new HttpError('Client not found.', 404);
  const items = await accessFor(env, c);
  return json({ items, gaps: accessGaps(items).length, statuses: ACCESS_STATUS });
});

route('PUT', '/api/clients/:id/access/:item', async ({ env, user, params, body }) => {
  requireStaff(user);
  if (!ACCESS_ITEMS.some((i) => i.key === params.item)) throw new HttpError('Unknown access item.', 404);
  const c = await first(env, 'SELECT id FROM clients WHERE id = ?', params.id);
  if (!c) throw new HttpError('Client not found.', 404);
  const b = await body();
  if (b.status && !ACCESS_STATUS[b.status]) throw new HttpError('Unknown status.');
  const cur = await first(env, 'SELECT * FROM client_access WHERE client_id = ? AND item = ?', c.id, params.item);
  await run(env, `INSERT INTO client_access (client_id, item, status, note, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id, item) DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  c.id, params.item, b.status || cur?.status || 'missing', 'note' in b ? text(b.note, 500) : cur?.note || null, now(), user.id);
  if (b.status === 'granted' && cur?.status !== 'granted') {
    const label = ACCESS_ITEMS.find((i) => i.key === params.item).label;
    await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', newId('l_'), c.id, `Access received: ${label}`, now(), user.id);
  }
  return json({ ok: true });
});

route('GET', '/api/access/gaps', async ({ env, user }) => { requireStaff(user); return json({ clients: await allGaps(env) }); });
