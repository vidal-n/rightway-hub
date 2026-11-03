// Automatic ranking scans: a queue of jobs that a cron tick (every minute) works through a few dozen grid points at a time,
// so it stays inside Worker limits. Finished jobs are saved as normal scans on the client, so the Rankings tab, the client app and
// reports all see them. Owners switch it on in Settings; nothing is scanned (or billed by DataForSEO) until they do.
import { HttpError, json } from './util.js';
import { all, first, run, newId, now, getSettings, setSetting } from './db.js';
import { requireStaff, requireAdmin } from './auth.js';
import { route } from './router.js';
import { gridPoints, gridStats, COST_PER_POINT } from '../public/js/grid.js';
import { rankAtPoint, businessDetails } from './dataforseo.js';
import { mockRank, mockDetails } from './mock.js';

const DEFAULTS = { enabled: false, size: 7, radius: 3, keywords: 3, everyDays: 30, autoSend: false, crawl: true };
export const POINTS_PER_TICK = 40; // Workers allow about 50 outside requests per run on the free plan
const LOCK_MS = 90e3;
const CHECK_EVERY_MS = 30 * 60e3;
const isDemo = (env) => !env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD;

export function cleanConfig(b = {}, base = DEFAULTS) {
  const size = [3, 5, 7, 9, 11, 13].includes(Number(b.size)) ? Number(b.size) : base.size;
  const radius = Math.min(30, Math.max(0.5, Number(b.radius) || base.radius));
  return {
    enabled: 'enabled' in b ? Boolean(b.enabled) : base.enabled,
    size, radius,
    keywords: Math.min(5, Math.max(1, Math.round(Number(b.keywords) || base.keywords))),
    everyDays: Math.min(60, Math.max(7, Math.round(Number(b.everyDays) || base.everyDays))),
    autoSend: 'autoSend' in b ? Boolean(b.autoSend) : Boolean(base.autoSend),
    crawl: 'crawl' in b ? Boolean(b.crawl) : base.crawl !== false,
  };
}
export async function getConfig(env) {
  const s = await getSettings(env).catch(() => ({}));
  let saved = {};
  try { saved = s.autoscan ? JSON.parse(s.autoscan) : {}; } catch { saved = {}; }
  return cleanConfig(saved, DEFAULTS);
}

export function parseKeywords(text, max = 5) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || '').split(/[,\n;]/)) {
    const k = raw.trim().replace(/\s+/g, ' ');
    if (!k || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k.slice(0, 120));
    if (out.length >= max) break;
  }
  return out;
}

export const monthlyCost = (clients, cfg) => Math.round(clients * cfg.keywords * cfg.size * cfg.size * COST_PER_POINT.local * (30 / cfg.everyDays) * 100) / 100;

export function scanReady(c) {
  if (c.lat == null || c.lng == null) return 'Add the address on the client profile so the Hub knows where to scan.';
  if (!c.cid && !c.place_id) return 'Add the Google listing (place ID or CID) on the client profile.';
  if (!parseKeywords(c.keywords).length) return 'Add target keywords on the client profile.';
  return null;
}

// Put one job per keyword in the queue. Skips keywords already waiting or running for this client.
export async function enqueueClient(env, client, { keywords, cfg, by = null, batch = newId('b_') } = {}) {
  const config = cfg || await getConfig(env);
  const list = keywords?.length ? keywords : parseKeywords(client.keywords, config.keywords);
  let made = 0;
  for (const keyword of list.slice(0, 5)) {
    const busy = await first(env, "SELECT id FROM scan_jobs WHERE client_id = ? AND lower(keyword) = lower(?) AND status IN ('queued','running')", client.id, keyword);
    if (busy) continue;
    await run(env, `INSERT INTO scan_jobs (id, client_id, keyword, size, radius, status, cursor, batch, by, created_at)
      VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)`, newId('j_'), client.id, keyword, config.size, config.radius, batch, by, now());
    made++;
  }
  return made;
}

// Clients that are due: active, real, scannable, and no job in the last everyDays.
export async function enqueueDue(env, at = now()) {
  const cfg = await getConfig(env);
  if (!cfg.enabled) return 0;
  const clients = await all(env, "SELECT * FROM clients WHERE status = 'active' AND sample = 0");
  let made = 0;
  for (const c of clients) {
    if (scanReady(c)) continue;
    const last = await first(env, "SELECT MAX(created_at) AS at FROM scan_jobs WHERE client_id = ? AND status != 'failed'", c.id);
    if (last?.at && at - last.at < cfg.everyDays * 86400e3) continue;
    made += await enqueueClient(env, c, { cfg, by: 'auto' });
  }
  return made;
}

async function claim(env, job, at) {
  const r = await run(env, 'UPDATE scan_jobs SET locked_until = ?, status = ? WHERE id = ? AND (locked_until IS NULL OR locked_until < ?)', at + LOCK_MS, 'running', job.id, at);
  return (r?.meta?.changes ?? 1) > 0;
}

function targetOf(client, details) {
  return {
    title: details?.title || client.name, cid: details?.cid || client.cid || '', place_id: details?.place_id || client.place_id || '',
    lat: details?.lat ?? client.lat, lng: details?.lng ?? client.lng, address: details?.address || client.address || '',
    rating: details?.rating ?? null, reviews: details?.reviews ?? null, category: details?.category || client.category || '',
    phone: details?.phone || client.phone || '', url: details?.url || client.website || '', domain: details?.domain || '',
    photos: details?.photos ?? null, claimed: details?.claimed ?? null,
  };
}

async function finish(env, job, client, data, at) {
  const points = data.points;
  const stats = gridStats(points);
  if (stats.done < Math.ceil(points.length * 0.75)) {
    await run(env, "UPDATE scan_jobs SET status = 'failed', error = ?, finished_at = ?, locked_until = NULL, data = NULL WHERE id = ?",
      `Only ${stats.done} of ${points.length} spots came back from Google. It will try again on the next run.`, at, job.id);
    return;
  }
  const scan = {
    version: 2, createdAt: new Date(at).toISOString(), demo: isDemo(env), auto: true, target: data.target, keyword: job.keyword, size: job.size, radius: job.radius,
    source: 'local', device: 'desktop', zoom: 13, points, details: {}, cost: Math.round(points.length * COST_PER_POINT.local * 1000) / 1000, pagespeed: null,
    math: { jobValue: '', closeRatePct: 40, extraCalls: 10, plan: '' },
  };
  const summary = {
    keyword: job.keyword, size: job.size, radius: job.radius, source: 'local', top3Pct: stats.top3Pct, top10Pct: stats.top10Pct, avgRank: stats.avgRank,
    centerRank: stats.centerRank ?? null, done: stats.done, date: scan.createdAt, auto: true,
  };
  const id = newId('s_');
  await run(env, 'INSERT INTO scans (id, client_id, keyword, created_at, summary, data) VALUES (?, ?, ?, ?, ?, ?)', id, job.client_id, job.keyword, at, JSON.stringify(summary), JSON.stringify(scan));
  await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', newId('l_'), job.client_id,
    `Monthly ranking scan for "${job.keyword}": top 3 in ${stats.top3Pct}% of the area, average rank ${stats.avgRank ?? 'n/a'}`, at, job.by && job.by !== 'auto' ? job.by : null);
  await run(env, "UPDATE scan_jobs SET status = 'done', scan_id = ?, cursor = ?, finished_at = ?, locked_until = NULL, data = NULL WHERE id = ?", id, points.length, at, job.id);
  // Last keyword for this client done: make (or refresh) this month's report.
  const left = await first(env, "SELECT COUNT(*) AS n FROM scan_jobs WHERE client_id = ? AND status IN ('queued','running')", job.client_id);
  if (!left?.n) {
    const [cfg, s] = await Promise.all([getConfig(env), getSettings(env).catch(() => ({}))]);
    const { autoReport } = await import('./reports.js');
    await autoReport(env, job.client_id, at, { autoSend: cfg.autoSend, origin: s.autoscan_origin || null }).catch((e) => console.error('report', e));
  }
}

// Work on the oldest waiting job for up to `budget` grid points. Returns how many points were scanned.
export async function runTick(env, { budget = POINTS_PER_TICK, fetchImpl, at = now() } = {}) {
  let used = 0;
  while (used < budget) {
    const job = await first(env, "SELECT * FROM scan_jobs WHERE status IN ('queued','running') AND (locked_until IS NULL OR locked_until < ?) ORDER BY created_at LIMIT 1", at);
    if (!job) break;
    if (!(await claim(env, job, at))) break;
    const client = await first(env, 'SELECT * FROM clients WHERE id = ?', job.client_id);
    if (!client || client.status !== 'active') {
      await run(env, "UPDATE scan_jobs SET status = 'failed', error = 'Client is not active.', finished_at = ?, locked_until = NULL, data = NULL WHERE id = ?", at, job.id);
      continue;
    }
    try {
      let data = job.data ? JSON.parse(job.data) : null;
      if (!data) {
        let details = null;
        if (isDemo(env)) details = mockDetails({ cid: client.cid }).business;
        else { try { details = (await businessDetails(env, { title: client.name, cid: client.cid, place_id: client.place_id, lat: client.lat, lng: client.lng }, fetchImpl)).business; used++; } catch { used++; } }
        data = { target: targetOf(client, details), points: gridPoints(client.lat, client.lng, job.size, job.radius) };
      }
      const pending = data.points.filter((p) => p.status === 'pending' || p.status === 'error' && !p.tried);
      const batch = pending.slice(0, Math.max(0, budget - used));
      let authFailed = null;
      await Promise.all(batch.map(async (p) => {
        const q = { keyword: job.keyword, lat: p.lat, lng: p.lng, zoom: 13, cid: data.target.cid, place_id: data.target.place_id, title: data.target.title, source: 'local', device: 'desktop' };
        try {
          const r = isDemo(env) ? mockRank(q) : await rankAtPoint(env, q, fetchImpl);
          p.rank = r.rank; p.top = r.top || []; p.status = 'done';
        } catch (e) {
          p.status = 'error'; p.tried = true;
          if (/login|password|401|auth/i.test(String(e?.message))) authFailed = e.message;
        }
      }));
      used += batch.length;
      const left = data.points.filter((p) => p.status === 'pending').length;
      if (authFailed && batch.every((p) => p.status === 'error')) {
        await run(env, "UPDATE scan_jobs SET status = 'failed', error = ?, finished_at = ?, locked_until = NULL, data = NULL WHERE id = ?", `DataForSEO refused the login: ${authFailed}`, at, job.id);
        break;
      }
      if (left === 0) await finish(env, job, client, data, at);
      else await run(env, "UPDATE scan_jobs SET data = ?, cursor = ?, status = 'running', started_at = COALESCE(started_at, ?), locked_until = NULL WHERE id = ?",
        JSON.stringify(data), data.points.length - left, at, job.id);
    } catch (e) {
      await run(env, "UPDATE scan_jobs SET status = 'failed', error = ?, finished_at = ?, locked_until = NULL, data = NULL WHERE id = ?", String(e.message || e).slice(0, 300), at, job.id);
    }
  }
  return used;
}

// Called by the cron trigger every minute and by the "work on the queue" button.
export async function autoScanTick(env, opts = {}) {
  const at = opts.at ?? now();
  const s = await getSettings(env).catch(() => ({}));
  if ((await getConfig(env)).enabled && at - Number(s.autoscan_checked || 0) > CHECK_EVERY_MS) {
    await setSetting(env, 'autoscan_checked', String(at));
    await enqueueDue(env, at);
  }
  return runTick(env, { ...opts, at });
}

const jobRow = (j) => ({ id: j.id, client_id: j.client_id, client: j.client_name || null, keyword: j.keyword, status: j.status, done: j.cursor, total: j.size * j.size, error: j.error || null, created_at: j.created_at, finished_at: j.finished_at || null });

route('GET', '/api/autoscan', async ({ env, user }) => {
  requireStaff(user);
  const cfg = await getConfig(env);
  const [active, jobs, queued] = await Promise.all([
    first(env, "SELECT COUNT(*) AS n FROM clients WHERE status = 'active' AND sample = 0"),
    all(env, 'SELECT j.*, c.name AS client_name FROM scan_jobs j LEFT JOIN clients c ON c.id = j.client_id ORDER BY j.created_at DESC LIMIT 25'),
    first(env, "SELECT COUNT(*) AS n FROM scan_jobs WHERE status IN ('queued','running')"),
  ]);
  const drafts = await all(env, "SELECT r.client_id, r.month, c.name FROM reports r JOIN clients c ON c.id = r.client_id WHERE r.status = 'draft' AND c.sample = 0 ORDER BY r.month DESC, c.name LIMIT 30").catch(() => []);
  return json({ config: cfg, clients: active?.n || 0, monthlyCost: monthlyCost(active?.n || 0, cfg), queued: queued?.n || 0, jobs: jobs.map(jobRow), demo: isDemo(env), drafts });
});

route('PUT', '/api/autoscan', async ({ env, user, body, url }) => {
  requireAdmin(user);
  await setSetting(env, 'autoscan_origin', url.origin);
  const cfg = cleanConfig(await body(), await getConfig(env));
  await setSetting(env, 'autoscan', JSON.stringify(cfg));
  if (cfg.enabled) await setSetting(env, 'autoscan_checked', '0');
  return json({ config: cfg });
});

// Run the queue now (the Hub page calls this while jobs are waiting, in case the cron is slow or not set up).
route('POST', '/api/autoscan/tick', async ({ env, user }) => {
  requireStaff(user);
  const used = await autoScanTick(env);
  const queued = await first(env, "SELECT COUNT(*) AS n FROM scan_jobs WHERE status IN ('queued','running')");
  return json({ used, queued: queued?.n || 0 });
});

route('POST', '/api/autoscan/run-all', async ({ env, user, url }) => {
  requireAdmin(user);
  await setSetting(env, 'autoscan_origin', url.origin);
  const cfg = await getConfig(env);
  const clients = await all(env, "SELECT * FROM clients WHERE status = 'active' AND sample = 0");
  let made = 0, skipped = 0;
  const batch = newId('b_');
  for (const c of clients) { if (scanReady(c)) { skipped++; continue; } made += await enqueueClient(env, c, { cfg, by: user.id, batch }); }
  return json({ queued: made, skipped });
});

route('GET', '/api/clients/:id/autoscan', async ({ env, user, params }) => {
  requireStaff(user);
  const jobs = await all(env, "SELECT j.*, NULL AS client_name FROM scan_jobs j WHERE client_id = ? AND (status IN ('queued','running') OR finished_at > ?) ORDER BY created_at DESC LIMIT 12", params.id, now() - 6 * 3600e3);
  return json({ jobs: jobs.map(jobRow) });
});

route('POST', '/api/clients/:id/autoscan', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', params.id);
  if (!c) throw new HttpError('Client not found.', 404);
  const why = scanReady(c);
  if (why) throw new HttpError(why);
  const b = await body();
  const keywords = Array.isArray(b.keywords) ? parseKeywords(b.keywords.join(',')) : undefined;
  const made = await enqueueClient(env, c, { keywords, by: user.id });
  return json({ queued: made });
});
