// Rightway Hub API: team, clients, tasks, activity, reviews, posts, scans, client overview.
import { HttpError, json } from './util.js';
import { ensureSchema, all, first, run, batch, newId, token, now, getSettings, setSetting } from './db.js';
import {
  currentUser, createSession, endSession, login, userCount, createUser, issueInvite, acceptInvite, listUsers,
  requireUser, requireStaff, requireAdmin, requireClientAccess, isStaff, sha256, cleanEmail,
} from './auth.js';
import { PLANS, tasksForMonth, monthKey, workloadOf } from './plans.js';
import { defaultScope } from './scopeof.js';
import { tierOf } from '../public/js/scope.js';
import { dollars } from '../public/js/scope.js';
import { generateCaptions } from './captions.js';
import { canEmail, sendEmail } from './email.js';
import { gridStats } from '../public/js/grid.js';
import { autoChatFor } from './chat.js';
import { routes, route } from './router.js';
import { generateTasks, savedGuides } from './work.js';
import { guideFor, proofMissing } from '../public/js/guides.js';
import { notify, notifyLater } from './notify.js';
import { can, capFor, JOB_CAPS, JOBS } from '../public/js/jobs.js';

// What an agent sees when their job does not cover a page.
const CAP_DENY = { close: 'Closing is for closers. Ask an owner if you need it.', deliver: 'Client work is for closers and owners.', schedule: "Managing other people's appointments is for schedulers." };

const CLIENT_FIELDS = ['name', 'plan', 'status', 'start_date', 'contact_name', 'contact_email', 'phone', 'website', 'address',
  'place_id', 'cid', 'lat', 'lng', 'category', 'services', 'cities', 'keywords', 'brand_voice', 'review_url', 'notes'];
const NUM_FIELDS = new Set(['lat', 'lng']);
const MAX_UPLOAD = 8 * 1024 * 1024;

const text = (v, max = 500) => (v == null ? null : String(v).replace(/\u0000/g, '').trim().slice(0, max) || null);
const monthOk = (m) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(m || '') ? m : monthKey());
const monthStart = (m) => Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1);
const monthEnd = (m) => Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1);

function cleanClient(body, partial) {
  const out = {};
  for (const f of CLIENT_FIELDS) {
    if (!(f in body)) continue;
    if (NUM_FIELDS.has(f)) {
      const n = body[f] === '' || body[f] == null ? null : Number(body[f]);
      out[f] = Number.isFinite(n) ? n : null;
    } else out[f] = text(body[f], f === 'notes' || f === 'brand_voice' ? 4000 : 1000);
  }
  if ('plan' in out && out.plan && !PLANS[out.plan]) throw new HttpError('That workload is not available.');
  if ('status' in out && !['active', 'paused', 'cancelled', 'prospect'].includes(out.status)) throw new HttpError('Unknown status.');
  if (!partial && !out.name) throw new HttpError('Business name is required.');
  return out;
}

export function reviewUrlOf(c) {
  if (c.review_url) return c.review_url;
  if (c.place_id) return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(c.place_id)}`;
  return null;
}

function scanSummary(scan) {
  const s = gridStats(scan.points || []);
  return {
    keyword: scan.keyword, size: scan.size, radius: scan.radius, source: scan.source || 'maps',
    top3Pct: s.top3Pct, top10Pct: s.top10Pct, avgRank: s.avgRank, centerRank: s.centerRank ?? null, done: s.done,
    date: scan.createdAt,
  };
}

async function clientOr404(env, id) {
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', id);
  if (!c) throw new HttpError('Client not found.', 404);
  return c;
}

export async function overview(env, c, month = monthKey(), staff = true) {
  const a = monthStart(month), b = monthEnd(month);
  const [tasks, rr, posts, scan, kit] = await Promise.all([
    first(env, `SELECT COUNT(*) AS total, SUM(status = 'done') AS done FROM tasks WHERE client_id = ? AND month = ?${staff ? '' : ' AND client_visible = 1'}`, c.id, month),
    first(env, 'SELECT COUNT(*) AS sent, SUM(clicks > 0) AS clicked FROM review_requests WHERE client_id = ? AND created_at >= ? AND created_at < ?', c.id, a, b),
    first(env, `SELECT COUNT(*) AS total, SUM(status = 'posted') AS posted, SUM(status IN ('draft','approved')) AS pending FROM posts WHERE client_id = ? AND created_at >= ? AND created_at < ?`, c.id, a, b),
    first(env, 'SELECT id, keyword, created_at, summary FROM scans WHERE client_id = ? ORDER BY created_at DESC LIMIT 1', c.id),
    first(env, 'SELECT COUNT(*) AS n FROM kit_scans WHERE client_id = ? AND at >= ? AND at < ?', c.id, a, b),
  ]);
  return {
    month,
    tasks: { total: tasks?.total || 0, done: tasks?.done || 0 },
    reviews: { sent: rr?.sent || 0, clicked: rr?.clicked || 0, kitScans: kit?.n || 0 },
    posts: { total: posts?.total || 0, posted: posts?.posted || 0, pending: posts?.pending || 0 },
    lastScan: scan ? { id: scan.id, ...JSON.parse(scan.summary || '{}') } : null,
  };
}

async function activity(env, clientId, staff, limit = 30) {
  const tasks = await all(env, `SELECT id, title AS text, link, done_at AS at, 'task' AS type FROM tasks
    WHERE client_id = ? AND status = 'done' AND done_at IS NOT NULL${staff ? '' : ' AND client_visible = 1'} ORDER BY done_at DESC LIMIT ?`, clientId, limit);
  const notes = await all(env, `SELECT id, text, link, at, 'note' AS type FROM log WHERE client_id = ? ORDER BY at DESC LIMIT ?`, clientId, limit);
  return [...tasks, ...notes].sort((x, y) => y.at - x.at).slice(0, limit);
}

function b64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

function reviewMessage(client, name, link) {
  const firstName = String(name || '').trim().split(/\s+/)[0];
  const hi = firstName ? `Hi ${firstName}, ` : 'Hi, ';
  return {
    sms: `${hi}thank you for choosing ${client.name}! If you have a minute, a quick Google review would mean a lot to us: ${link}`,
    subject: `${client.name}: how did we do?`,
    email: `${hi}\n\nThank you for choosing ${client.name}. If you have a minute, would you leave us a quick Google review? It helps other people find us.\n\n${link}\n\nThank you,\n${client.name}`,
  };
}

// ---------- router ----------

export async function handleHub(request, env, url, execCtx = null) {
  for (const r of routes) {
    if (r.method !== request.method) continue;
    const m = url.pathname.match(r.re);
    if (!m) continue;
    await ensureSchema(env);
    // Cross-site forms can't set custom headers, so this blocks CSRF on every write.
    if (!r.public && request.method !== 'GET' && request.headers.get('x-rw') !== '1') throw new HttpError('Missing request header.', 400);
    let user = await currentUser(env, request);
    // Jobs: an agent only reaches the parts of the Hub their job covers (closer, scheduler, appointment setter). Checked here, once, for every route.
    if (!r.public && user?.role === 'team') {
      const cap = capFor(request.method, url.pathname);
      if (cap && !can(user, cap)) throw new HttpError(CAP_DENY[cap], 403);
    }
    // Client view: a team member sees the client app exactly as that client would. Read only.
    const viewAs = request.headers.get('x-view-as');
    if (viewAs && user?.role === 'team' && !can(user, 'close')) throw new HttpError(CAP_DENY.deliver, 403);
    if (viewAs && user && isStaff(user)) {
      if (request.method !== 'GET') throw new HttpError('Client view is read only. Go back to the Hub to make changes.', 403);
      user = { ...user, role: 'client', client_id: viewAs, viewAs: true };
    }
    // defer: work that can finish after the response (notifications), when the platform gives us waitUntil.
    const defer = (p) => (execCtx?.waitUntil ? execCtx.waitUntil(p) : p);
    // Maintenance mode: while an owner works on the Hub, everyone else gets a friendly pause (owners can still come in).
    if (!r.public && user && user.role !== 'admin' && !/^\/api\/(auth|maintenance)\b/.test(url.pathname)) {
      const mt = await maintenance(env);
      if (mt.on) throw new HttpError(mt.msg || 'The Hub is being updated. Back shortly.', 503);
    }
    const ctx = { request, env, url, user, defer, params: m.groups || {}, body: () => request.json().catch(() => ({})) };
    return r.fn(ctx);
  }
  return null;
}

// Public review links: /r/<token> and /r/k/<clientId> (printed QR code)
export async function handleReviewRedirect(request, env, url) {
  const m = url.pathname.match(/^\/r\/(?:(k)\/)?([\w-]{6,64})$/);
  if (!m || !env.DB) return null;
  await ensureSchema(env);
  let client;
  if (m[1] === 'k') {
    client = await first(env, 'SELECT * FROM clients WHERE id = ?', m[2]);
    if (client) await run(env, 'INSERT INTO kit_scans (client_id, at) VALUES (?, ?)', client.id, now());
  } else {
    const rr = await first(env, 'SELECT * FROM review_requests WHERE token = ?', m[2]);
    if (rr) {
      await run(env, 'UPDATE review_requests SET clicks = clicks + 1, clicked_at = COALESCE(clicked_at, ?) WHERE id = ?', now(), rr.id);
      client = await first(env, 'SELECT * FROM clients WHERE id = ?', rr.client_id);
    }
  }
  const dest = client && reviewUrlOf(client);
  if (!dest) return new Response('This review link is not set up yet.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return Response.redirect(dest, 302);
}

// ---------- auth ----------
route('GET', '/api/auth/state', async ({ env, user }) => json({
  users: (await userCount(env)) > 0, user: user && user.role === 'admin' ? { ...user, primary: await import('./agents.js').then((m) => m.isPrimary(env, user)) } : user, email: canEmail(env), ai: Boolean(env.ANTHROPIC_API_KEY), media: Boolean(env.MEDIA), maintenance: await maintenance(env),
}));

let mtCache = { at: 0, v: { on: false } };
async function maintenance(env) {
  if (Date.now() - mtCache.at < 15e3) return mtCache.v;
  let v = { on: false };
  try { v = JSON.parse((await getSettings(env)).maintenance || '{"on":false}'); } catch { v = { on: false }; }
  mtCache = { at: Date.now(), v };
  return v;
}
route('PUT', '/api/maintenance', async ({ env, user, body }) => {
  if (!user || user.role !== 'admin') throw new HttpError('Owners only.', 403);
  const b = await body();
  const v = { on: Boolean(b.on), msg: String(b.msg || '').slice(0, 200), by: user.name || user.email, at: Date.now() };
  await setSetting(env, 'maintenance', JSON.stringify(v));
  mtCache = { at: Date.now(), v };
  return json(v);
});

// The Google Maps browser key. Safe to hand out: Google only accepts it from the Hub's own address (set in Google Cloud).
route('GET', '/api/maps/config', async ({ env }) => json({ google: env.GOOGLE_MAPS_KEY || null }), { public: true });

route('POST', '/api/auth/setup', async ({ env, request, body }) => {
  if ((await userCount(env)) > 0) throw new HttpError('Setup is already done. Log in instead.', 409);
  const b = await body();
  if (!env.ACCESS_KEY || b.accessKey !== env.ACCESS_KEY) throw new HttpError('That access key is not right.', 401);
  const id = await createUser(env, { email: b.email, name: b.name, role: 'admin', password: b.password });
  return json({ ok: true }, 200, { 'set-cookie': await createSession(env, id, request) });
});

route('POST', '/api/auth/login', async ({ env, request, body }) => {
  const u = await login(env, await body());
  return json({ ok: true, role: u.role }, 200, { 'set-cookie': await createSession(env, u.id, request) });
});

route('POST', '/api/auth/logout', async ({ env, request, user }) => {
  if (user && user.role !== 'client') await import('./agents.js').then((m) => m.setStatus(env, user.id, 'offline')).catch(() => {});
  return json({ ok: true }, 200, { 'set-cookie': await endSession(env, request) });
});

route('GET', '/api/auth/invite/:token', async ({ env, params }) => {
  const u = await first(env, 'SELECT email, name, invite_expires FROM users WHERE invite_hash = ?', await sha256(params.token));
  if (!u || u.invite_expires < now()) throw new HttpError('That invite link has expired. Ask for a new one.', 410);
  return json({ email: u.email, name: u.name });
});

route('POST', '/api/auth/invite/accept', async ({ env, request, body }) => {
  const u = await acceptInvite(env, await body());
  return json({ ok: true, role: u.role }, 200, { 'set-cookie': await createSession(env, u.id, request) });
});

// ---------- team ----------
route('GET', '/api/team', async ({ env, user }) => { requireStaff(user); return json({ users: await listUsers(env) }); });

route('POST', '/api/team/invite', async ({ env, user, url, body }) => {
  requireAdmin(user);
  const b = await body();
  const id = await createUser(env, { email: b.email, name: b.name, role: b.role === 'admin' ? 'admin' : 'team', job: b.job });
  return json({ inviteUrl: `${url.origin}/#/invite/${await issueInvite(env, id)}` });
});

route('POST', '/api/users/:id/reset', async ({ env, user, url, params }) => {
  requireStaff(user);
  const target = await first(env, 'SELECT * FROM users WHERE id = ?', params.id);
  if (!target) throw new HttpError('User not found.', 404);
  if (target.role !== 'client') requireAdmin(user);
  return json({ inviteUrl: `${url.origin}/#/invite/${await issueInvite(env, target.id)}` });
});

// Owners can promote a teammate to owner, or set an owner back to team. Not yourself, so there is always an owner.
route('PUT', '/api/users/:id/role', async ({ env, user, params, body }) => {
  requireAdmin(user);
  const role = (await body()).role;
  if (!['admin', 'team'].includes(role)) throw new HttpError('Pick Owner or Team.');
  if (params.id === user.id) throw new HttpError("You can't change your own role.");
  const target = await first(env, 'SELECT * FROM users WHERE id = ?', params.id);
  if (!target || target.role === 'client') throw new HttpError('Teammate not found.', 404);
  await run(env, 'UPDATE users SET role = ?, job = ? WHERE id = ?', role, role === 'team' ? (JOB_CAPS[target.job] ? target.job : 'setter') : target.job, target.id);
  return json({ ok: true, role });
});

// An agent's job: closer, scheduler or appointment setter. Decides what they can reach (public/js/jobs.js).
route('PUT', '/api/users/:id/job', async ({ env, user, params, body }) => {
  requireAdmin(user);
  const job = (await body()).job;
  if (!JOB_CAPS[job]) throw new HttpError(`Pick ${JOBS.map(([, n]) => n).join(', ')}.`);
  const target = await first(env, 'SELECT * FROM users WHERE id = ?', params.id);
  if (!target || target.role !== 'team') throw new HttpError('Agent not found.', 404);
  await run(env, 'UPDATE users SET job = ? WHERE id = ?', job, target.id);
  return json({ ok: true, job });
});

route('DELETE', '/api/users/:id', async ({ env, user, params }) => {
  requireStaff(user);
  if (params.id === user.id) throw new HttpError("You can't remove yourself.");
  const target = await first(env, 'SELECT * FROM users WHERE id = ?', params.id);
  if (!target) throw new HttpError('User not found.', 404);
  if (target.role !== 'client') requireAdmin(user);
  await batch(env, [['DELETE FROM sessions WHERE user_id = ?', target.id], ['DELETE FROM users WHERE id = ?', target.id]]);
  return json({ ok: true });
});

// ---------- clients ----------

route('GET', '/api/clients', async ({ env, user, url }) => {
  requireStaff(user);
  const month = monthOk(url.searchParams.get('month'));
  const clients = await all(env, "SELECT * FROM clients ORDER BY status = 'active' DESC, name");
  // Agents see the work, not the money or the Stripe ids.
  const money = (c) => (user.role === 'admin' ? c : { ...c, mrr_cents: null, stripe_customer_id: null, stripe_subscription_id: null, billing_status: null });
  const out = await Promise.all(clients.map(async ({ wp_pass, ...c }) => ({ ...money(c), overview: await overview(env, c, month, true) })));
  return json({ clients: out, month });
});

route('POST', '/api/clients', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const c = cleanClient(b, false);
  // No packages: a client added by hand starts with the standard scope (editable on the client page). An explicit workload still works for the API.
  if (!c.plan) { const sc = defaultScope({ business: c.name }, null); c.scope = JSON.stringify(sc); c.plan = tierOf(sc); }
  if (b.monthly !== undefined && user.role === 'admin') { const m = dollars(b.monthly); c.mrr_cents = m == null ? null : Math.round(m * 100); }
  c.id = newId('c_');
  c.created_at = now();
  const cols = Object.keys(c);
  await run(env, `INSERT INTO clients (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((k) => c[k]));
  await autoChatFor(env, c.id).catch(() => {});
  return json({ client: await clientOr404(env, c.id) });
});

route('GET', '/api/clients/:id', async ({ env, user, params, url }) => {
  requireClientAccess(user, params.id);
  const c = await clientOr404(env, params.id);
  const staff = isStaff(user);
  const month = monthOk(url.searchParams.get('month'));
  if (!staff) delete c.notes;
  delete c.wp_pass; // sealed WordPress password never leaves the server
  if (user.role !== 'admin' && staff) { c.mrr_cents = null; c.stripe_customer_id = null; c.stripe_subscription_id = null; }
  const parent = c.parent_id ? await first(env, 'SELECT id, name FROM clients WHERE id = ?', c.parent_id) : null;
  const locations = (await first(env, 'SELECT COUNT(*) AS n FROM clients WHERE parent_id = ?', c.id))?.n || 0;
  return json({
    client: { ...c, review_link: reviewUrlOf(c), kit_link: `${url.origin}/r/k/${c.id}`, plan_info: staff ? workloadOf(c, await savedGuides(env)) : { custom: false, monthly: [], keywords: 0, meetingMinutes: 0, scope: [] }, parent, locations },
    overview: await overview(env, c, month, staff),
    activity: await activity(env, c.id, staff, 12),
  });
});

route('PATCH', '/api/clients/:id', async ({ env, user, params, body }) => {
  requireStaff(user);
  await clientOr404(env, params.id);
  const b = await body();
  const c = cleanClient(b, true);
  if (c.plan) c.scope = null; // picking a workload by hand puts the client back on that template
  if (b.monthly !== undefined && user.role === 'admin') { const m = dollars(b.monthly); c.mrr_cents = m == null ? null : Math.round(m * 100); }
  const cols = Object.keys(c);
  if (cols.length) await run(env, `UPDATE clients SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => c[k]), params.id);
  const { wp_pass, ...updated } = await clientOr404(env, params.id);
  return json({ client: updated });
});

route('GET', '/api/clients/:id/users', async ({ env, user, params }) => {
  requireStaff(user);
  return json({ users: await listUsers(env, params.id) });
});

route('POST', '/api/clients/:id/invite', async ({ env, user, params, url, body }) => {
  requireStaff(user);
  await clientOr404(env, params.id);
  const b = await body();
  const id = await createUser(env, { email: b.email, name: b.name, role: 'client', client_id: params.id });
  return json({ inviteUrl: `${url.origin}/#/invite/${await issueInvite(env, id)}` });
});

// ---------- tasks ----------
route('GET', '/api/clients/:id/tasks', async ({ env, user, params, url }) => {
  requireClientAccess(user, params.id);
  const month = monthOk(url.searchParams.get('month'));
  const staff = isStaff(user);
  const tasks = await all(env, `SELECT * FROM tasks WHERE client_id = ? AND month = ?${staff ? '' : ' AND client_visible = 1'} ORDER BY sort, created_at`, params.id, month);
  return json({ month, tasks });
});

route('POST', '/api/clients/:id/tasks/generate', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  const month = monthOk((await body()).month);
  if (c.parent_id) return json({ created: 0, month, location: true }); // the plan's work is tracked on the main business
  return json({ created: await generateTasks(env, c, month), month });
});

route('POST', '/api/clients/:id/tasks', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  const b = await body();
  const title = text(b.title, 300);
  if (!title) throw new HttpError('Task needs a title.');
  const id = newId('t_');
  const due = /^\d{4}-\d{2}-\d{2}$/.test(b.due || '') ? b.due : null;
  await run(env, 'INSERT INTO tasks (id, client_id, month, kind, title, sort, created_at, owner, due) VALUES (?, ?, ?, ?, ?, 999, ?, ?, ?)',
    id, params.id, monthOk(b.month), text(b.kind, 30) || 'custom', title, now(), b.owner || c.owner_id || null, due);
  return json({ task: await first(env, 'SELECT * FROM tasks WHERE id = ?', id) });
});

route('PATCH', '/api/tasks/:id', async ({ env, user, params, body, defer }) => {
  requireStaff(user);
  const t = await first(env, 'SELECT * FROM tasks WHERE id = ?', params.id);
  if (!t) throw new HttpError('Task not found.', 404);
  const b = await body();
  const set = {};
  if ('note' in b) set.note = text(b.note, 2000);
  if ('link' in b) set.link = text(b.link, 1000);
  if ('title' in b && text(b.title, 300)) set.title = text(b.title, 300);
  if ('client_visible' in b) set.client_visible = b.client_visible ? 1 : 0;
  if ('owner' in b) {
    if (b.owner && !(await first(env, "SELECT id FROM users WHERE id = ? AND role IN ('admin','team')", b.owner))) throw new HttpError('Pick someone on the team.');
    set.owner = b.owner || null;
  }
  if ('due' in b) {
    if (b.due && !/^\d{4}-\d{2}-\d{2}$/.test(b.due)) throw new HttpError('Pick a date.');
    set.due = b.due || null;
  }
  if ('checks' in b) set.checks = JSON.stringify((Array.isArray(b.checks) ? b.checks : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 40));
  if ('status' in b) {
    if (!['todo', 'doing', 'done', 'skipped'].includes(b.status)) throw new HttpError('Unknown status.');
    // Proof before a task closes: the guide for its kind says what counts (live link, screenshot or note).
    if (b.status === 'done' && t.status !== 'done') {
      const why = proofMissing(guideFor(t.kind, await savedGuides(env)), { ...t, ...set });
      if (why) throw new HttpError(why, 400);
    }
    if (b.status === 'skipped' && !text(set.note ?? t.note, 2000)) throw new HttpError('Write why it was skipped in the note first.');
    set.status = b.status;
    set.done_at = b.status === 'done' ? (t.done_at || now()) : null;
    set.done_by = b.status === 'done' ? user.id : null;
  }
  const cols = Object.keys(set);
  if (cols.length) await run(env, `UPDATE tasks SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => set[k]), t.id);
  if (set.owner && set.owner !== t.owner && set.owner !== user.id) {
    const c = await first(env, 'SELECT name FROM clients WHERE id = ?', t.client_id);
    await notifyLater({ env, defer }, { to: [set.owner], kind: 'task', title: `New task for you: ${set.title || t.title}`, body: `${c?.name || ''}${(set.due ?? t.due) ? `, due ${set.due ?? t.due}` : ''}. From ${user.name || 'a teammate'}.`, url: `/#/work/task/${t.id}`, slack: false, actions: [{ text: 'Start timer', action_id: 'task_start', value: t.id }] });
  }
  return json({ task: await first(env, 'SELECT * FROM tasks WHERE id = ?', t.id) });
});

route('DELETE', '/api/tasks/:id', async ({ env, user, params }) => {
  requireStaff(user);
  await run(env, 'DELETE FROM tasks WHERE id = ?', params.id);
  return json({ ok: true });
});

// ---------- activity log ----------
route('GET', '/api/clients/:id/activity', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  return json({ activity: await activity(env, params.id, isStaff(user), 60) });
});

route('POST', '/api/clients/:id/log', async ({ env, user, params, body }) => {
  requireStaff(user);
  const b = await body();
  const t = text(b.text, 1000);
  if (!t) throw new HttpError('Write what was done.');
  await run(env, 'INSERT INTO log (id, client_id, text, link, at, by) VALUES (?, ?, ?, ?, ?, ?)', newId('l_'), params.id, t, text(b.link, 1000), now(), user.id);
  return json({ ok: true });
});

// ---------- reviews ----------
route('GET', '/api/clients/:id/reviews', async ({ env, user, params, url }) => {
  requireClientAccess(user, params.id);
  const c = await clientOr404(env, params.id);
  const requests = await all(env, 'SELECT id, customer_name, contact, channel, created_at, clicks, clicked_at FROM review_requests WHERE client_id = ? ORDER BY created_at DESC LIMIT 200', c.id);
  const totals = await first(env, 'SELECT COUNT(*) AS sent, SUM(clicks > 0) AS clicked FROM review_requests WHERE client_id = ?', c.id);
  const kit = await first(env, 'SELECT COUNT(*) AS n FROM kit_scans WHERE client_id = ?', c.id);
  return json({
    reviewUrl: reviewUrlOf(c), kitUrl: `${url.origin}/r/k/${c.id}`, canEmail: canEmail(env),
    requests, totals: { sent: totals?.sent || 0, clicked: totals?.clicked || 0, kitScans: kit?.n || 0 },
  });
});

route('POST', '/api/clients/:id/reviews', async ({ env, user, params, url, body }) => {
  requireClientAccess(user, params.id);
  const c = await clientOr404(env, params.id);
  if (!reviewUrlOf(c)) throw new HttpError('This business has no Google review link yet. The Rightway team needs to add it.');
  const b = await body();
  const channel = ['sms', 'email', 'share'].includes(b.channel) ? b.channel : 'share';
  const name = text(b.name, 120);
  const contact = text(b.contact, 200);
  if (channel === 'email' && contact) cleanEmail(contact);
  const t = token(9);
  await run(env, 'INSERT INTO review_requests (id, client_id, token, customer_name, contact, channel, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    newId('r_'), c.id, t, name, contact, channel, user.id, now());
  const link = `${url.origin}/r/${t}`;
  const msg = reviewMessage(c, name, link);
  let emailed = false;
  if (channel === 'email' && contact && canEmail(env) && b.sendNow) {
    await sendEmail(env, { to: contact, subject: msg.subject, text: msg.email, replyTo: c.contact_email || undefined });
    emailed = true;
  }
  return json({ link, message: msg.sms, subject: msg.subject, emailBody: msg.email, emailed });
});

// ---------- posts ----------
route('GET', '/api/clients/:id/posts', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  return json({ posts: await all(env, 'SELECT * FROM posts WHERE client_id = ? ORDER BY created_at DESC LIMIT 100', params.id) });
});

route('POST', '/api/clients/:id/posts', async ({ env, user, params, request }) => {
  requireClientAccess(user, params.id);
  const c = await clientOr404(env, params.id);
  let form;
  try { form = await request.formData(); } catch { throw new HttpError('Upload a photo or write a note.'); }
  const note = text(form.get('note'), 1000);
  const file = form.get('photo');
  const id = newId('p_');
  let mediaKey = null, mediaType = null, image = null;
  if (file && typeof file === 'object' && file.size) {
    if (!env.MEDIA) throw new HttpError('Photo storage is not connected yet. Create the R2 bucket in Cloudflare.', 503);
    if (file.size > MAX_UPLOAD) throw new HttpError('That photo is too big (8 MB max).');
    mediaType = file.type || 'image/jpeg';
    if (!/^image\//.test(mediaType)) throw new HttpError('Only photos for now.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    mediaKey = `posts/${c.id}/${id}.${mediaType.split('/')[1].replace('jpeg', 'jpg')}`;
    await env.MEDIA.put(mediaKey, bytes, { httpMetadata: { contentType: mediaType } });
    if (bytes.length <= 4.5 * 1024 * 1024) image = { base64: b64(bytes), mediaType };
  }
  if (!mediaKey && !note) throw new HttpError('Add a photo or a note.');
  const cap = await generateCaptions(env, c, note, image);
  await run(env, `INSERT INTO posts (id, client_id, media_key, media_type, note, google_text, facebook_text, instagram_text, hashtags, keywords, alt_text, status, ai, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
  id, c.id, mediaKey, mediaType, note, cap.google, cap.facebook, cap.instagram, JSON.stringify(cap.hashtags), JSON.stringify(cap.keywords), cap.alt_text, cap.ai ? 1 : 0, user.id, now());
  return json({ post: await first(env, 'SELECT * FROM posts WHERE id = ?', id) });
});

// A post going live checks off one open "Google profile post" task this month. With a live link, that link is the proof;
// without one the task stays open for a screenshot (proof rule), but the post is linked in its note.
export async function closePostTask(env, p, liveUrl, by) {
  const m = monthKey();
  const t = await first(env, "SELECT * FROM tasks WHERE client_id = ? AND kind = 'post' AND status IN ('todo','doing') AND month <= ? ORDER BY month, sort LIMIT 1", p.client_id, m);
  if (!t) return null;
  const note = t.note || `Post: ${String(p.google_text || '').slice(0, 80)}`;
  if (liveUrl) await run(env, "UPDATE tasks SET status = 'done', done_at = ?, done_by = ?, link = ?, note = ? WHERE id = ?", now(), by, liveUrl, note, t.id);
  else await run(env, "UPDATE tasks SET status = 'doing', note = ? WHERE id = ?", note, t.id);
  return t.id;
}

async function postWithAccess(env, user, id) {
  const p = await first(env, 'SELECT * FROM posts WHERE id = ?', id);
  if (!p) throw new HttpError('Post not found.', 404);
  requireClientAccess(user, p.client_id);
  return p;
}

route('PATCH', '/api/posts/:id', async ({ env, user, params, body, defer }) => {
  const p = await postWithAccess(env, user, params.id);
  const b = await body();
  const set = {};
  if (isStaff(user)) {
    for (const f of ['google_text', 'facebook_text', 'instagram_text']) if (f in b) set[f] = text(b[f], 2200);
    if ('status' in b) {
      if (!['draft', 'approved', 'posted', 'rejected'].includes(b.status)) throw new HttpError('Unknown status.');
      set.status = b.status;
      if (b.status === 'approved') set.approved_at = now();
      if (b.status === 'posted') set.posted_at = now();
    }
    if ('live_url' in b) set.live_url = /^https?:\/\//i.test(String(b.live_url || '')) ? text(b.live_url, 1000) : null;
  } else if (b.status === 'approved' && p.status === 'draft') {
    set.status = 'approved';
    set.approved_at = now();
    const c = await first(env, 'SELECT name FROM clients WHERE id = ?', p.client_id);
    await notifyLater({ env, defer }, { to: { client: p.client_id }, kind: 'client', title: `${c?.name || 'A client'} approved a post`, body: 'It is ready to go on their Google profile.', url: `/#/client/${p.client_id}/posts` });
  } else throw new HttpError('Only approving is available here.', 403);
  const cols = Object.keys(set);
  if (cols.length) await run(env, `UPDATE posts SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => set[k]), p.id);
  if (set.status === 'posted' && p.status !== 'posted') await closePostTask(env, p, set.live_url || null, user.id);
  return json({ post: await first(env, 'SELECT * FROM posts WHERE id = ?', p.id) });
});

route('POST', '/api/posts/:id/regenerate', async ({ env, user, params }) => {
  requireStaff(user);
  const p = await postWithAccess(env, user, params.id);
  const c = await clientOr404(env, p.client_id);
  let image = null;
  if (p.media_key && env.MEDIA) {
    const obj = await env.MEDIA.get(p.media_key);
    if (obj) {
      const bytes = new Uint8Array(await obj.arrayBuffer());
      if (bytes.length <= 4.5 * 1024 * 1024) image = { base64: b64(bytes), mediaType: p.media_type };
    }
  }
  const cap = await generateCaptions(env, c, p.note, image);
  await run(env, 'UPDATE posts SET google_text = ?, facebook_text = ?, instagram_text = ?, hashtags = ?, keywords = ?, alt_text = ?, ai = ? WHERE id = ?',
    cap.google, cap.facebook, cap.instagram, JSON.stringify(cap.hashtags), JSON.stringify(cap.keywords), cap.alt_text, cap.ai ? 1 : 0, p.id);
  return json({ post: await first(env, 'SELECT * FROM posts WHERE id = ?', p.id) });
});

route('DELETE', '/api/posts/:id', async ({ env, user, params }) => {
  requireStaff(user);
  const p = await postWithAccess(env, user, params.id);
  if (p.media_key && env.MEDIA) await env.MEDIA.delete(p.media_key);
  await run(env, 'DELETE FROM posts WHERE id = ?', p.id);
  return json({ ok: true });
});

route('GET', '/api/media/:id', async ({ env, user, params, url }) => {
  const p = await postWithAccess(env, user, params.id);
  if (!p.media_key || !env.MEDIA) throw new HttpError('No photo.', 404);
  const obj = await env.MEDIA.get(p.media_key);
  if (!obj) throw new HttpError('Photo not found.', 404);
  const headers = { 'content-type': p.media_type || 'image/jpeg', 'cache-control': 'private, max-age=3600' };
  if (url.searchParams.get('download')) headers['content-disposition'] = `attachment; filename="${p.id}.${(p.media_type || 'image/jpeg').split('/')[1]}"`;
  return new Response(obj.body, { headers });
});

// ---------- scans ----------
route('GET', '/api/clients/:id/scans', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  const rows = await all(env, 'SELECT id, keyword, created_at, summary FROM scans WHERE client_id = ? ORDER BY created_at DESC LIMIT 100', params.id);
  return json({ scans: rows.map((r) => ({ id: r.id, keyword: r.keyword, created_at: r.created_at, ...JSON.parse(r.summary || '{}') })) });
});

route('POST', '/api/clients/:id/scans', async ({ env, user, params, body }) => {
  requireStaff(user);
  await clientOr404(env, params.id);
  const { scan } = await body();
  if (!scan || !Array.isArray(scan.points) || !scan.target) throw new HttpError('That is not a scan.');
  const data = JSON.stringify(scan);
  if (data.length > 1_800_000) throw new HttpError('That scan is too large to save.');
  const id = newId('s_');
  await run(env, 'INSERT INTO scans (id, client_id, keyword, created_at, summary, data) VALUES (?, ?, ?, ?, ?, ?)',
    id, params.id, text(scan.keyword, 120), now(), JSON.stringify(scanSummary(scan)), data);
  await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', newId('l_'), params.id,
    `Ranking scan saved for "${text(scan.keyword, 120)}"`, now(), user.id);
  return json({ id });
});

route('GET', '/api/scans/:id', async ({ env, user, params }) => {
  const row = await first(env, 'SELECT * FROM scans WHERE id = ?', params.id);
  if (!row) throw new HttpError('Scan not found.', 404);
  requireClientAccess(user, row.client_id);
  return json({ scan: JSON.parse(row.data) });
});

route('DELETE', '/api/scans/:id', async ({ env, user, params }) => {
  requireStaff(user);
  await run(env, 'DELETE FROM scans WHERE id = ?', params.id);
  return json({ ok: true });
});

// Feature modules register their routes on import.
import './crm.js';
import './billing.js';
import './stripesetup.js';
import './autoscan.js';
import './reports.js';
import './content.js';
import './siteaudit.js';
import './calltrack.js';
import './citations.js';
import './reputation.js';
import './leader.js';
import './quarterly.js';
import './workorders.js';
import './scope.js';
import './calls.js';
import './sms.js';
import './voice.js';
import './dispo.js';
import './payments.js';
import './googleapps.js';
import './dashboard.js';
import './sample.js';
import './intel.js';
import './google.js';
import './onboarding.js';
import './meetings.js';
import './assistant.js';
import './googlecheck.js';
import './balances.js';
import './scrub.js';
import './agents.js';
import './automations.js';
import './leadfinder.js';
import './freedata.js';
import './costs.js';
import './avatar.js';
import './autoresearch.js';
import './spend.js';
import './vault.js';
import './appointments.js';
import './lines.js';
import './voicemail.js';
import './gbp.js';
import './photos.js';
import './social.js';
import './schedule.js';
import './gmail.js';
import './gcal.js';
import './gdrive.js';
import './notify.js';
import './slack.js';
import './slackuser.js';
import './nav.js';
import './avail.js';
import './chat.js';
import './hubcal.js';
import './files.js';
import './hubmail.js';
import './teamcal.js';
