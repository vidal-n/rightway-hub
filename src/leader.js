// Market Leader extras (Phase 9): locations under one client with a roll-up, and the live dashboard the client app shows.
// A location is its own client row with parent_id set, so it gets its own keywords, scans, reports, calls and citations for free.
// Locations do not get plan tasks or count toward revenue: the work and the bill live on the main client.
import { HttpError, json } from './util.js';
import { all, first, run, newId, now } from './db.js';
import { requireStaff, requireClientAccess } from './auth.js';
import { route } from './router.js';
import { monthKey } from './plans.js';
import { callStats } from './calltrack.js';
import { reputationFor } from './reputation.js';

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const monthRange = (m) => { const [y, mo] = m.split('-').map(Number); return [Date.UTC(y, mo - 1, 1), Date.UTC(y, mo, 1)]; };

// Latest scan per keyword with the change from the scan before. Up to 5 keywords.
export async function keywordTrend(env, clientId) {
  const rows = await all(env, 'SELECT keyword, created_at, summary FROM scans WHERE client_id = ? ORDER BY created_at DESC LIMIT 150', clientId);
  const by = new Map();
  for (const r of rows) {
    const k = String(r.keyword || '').toLowerCase();
    if (!by.has(k)) by.set(k, []);
    if (by.get(k).length < 2) by.get(k).push(r);
  }
  return [...by.values()].slice(0, 5).map(([a, b]) => {
    const s = parse(a.summary) || {};
    const p = b ? parse(b.summary) || {} : null;
    return { keyword: a.keyword, at: a.created_at, top10Pct: s.top10Pct ?? 0, top3Pct: s.top3Pct ?? 0, avgRank: s.avgRank ?? null, centerRank: s.centerRank ?? null, change: p ? (s.top10Pct ?? 0) - (p.top10Pct ?? 0) : null };
  });
}

async function latestTarget(env, clientId) {
  const r = await first(env, 'SELECT data FROM scans WHERE client_id = ? ORDER BY created_at DESC LIMIT 1', clientId);
  return parse(r?.data)?.target || null;
}

// One location's numbers for the roll-up.
async function snapshot(env, c, month) {
  const [a, b] = monthRange(month);
  const [keywords, target, tracked, site, report, listings] = await Promise.all([
    keywordTrend(env, c.id), latestTarget(env, c.id),
    first(env, "SELECT COUNT(*) AS n FROM tracking_numbers WHERE client_id = ? AND status = 'active'", c.id).catch(() => null),
    first(env, "SELECT score, finished_at FROM site_audits WHERE client_id = ? AND status = 'done' ORDER BY finished_at DESC LIMIT 1", c.id).catch(() => null),
    first(env, "SELECT month, token FROM reports WHERE client_id = ? AND status = 'sent' ORDER BY month DESC LIMIT 1", c.id).catch(() => null),
    first(env, "SELECT COUNT(*) AS n FROM link_log WHERE client_id = ? AND status = 'live'", c.id).catch(() => null),
  ]);
  const calls = tracked?.n ? await callStats(env, c.id, a, b) : null;
  return {
    id: c.id, name: c.name, address: c.address || '', isMain: !c.parent_id,
    keywords, top10Avg: keywords.length ? Math.round(keywords.reduce((s, k) => s + k.top10Pct, 0) / keywords.length) : null,
    reviews: target && (target.rating != null || target.reviews != null) ? { rating: target.rating ?? null, count: target.reviews ?? null } : null,
    calls: calls ? { total: calls.total, missed: calls.missed, firstTime: calls.firstTime } : null,
    site: site ? site.score : null, listings: listings?.n || 0,
    report: report ? { month: report.month, url: `/report.html#${report.token}` } : null,
  };
}

export async function rollup(env, parent, month = monthKey()) {
  const kids = await all(env, "SELECT * FROM clients WHERE parent_id = ? AND status != 'cancelled' ORDER BY name", parent.id);
  if (!kids.length) return null;
  const rows = await Promise.all([parent, ...kids].map((c) => snapshot(env, c, month)));
  const sum = (f) => rows.reduce((s, r) => s + (f(r) || 0), 0);
  const withTop = rows.filter((r) => r.top10Avg != null);
  return {
    month, locations: rows,
    totals: {
      count: rows.length, calls: sum((r) => r.calls?.total), missed: sum((r) => r.calls?.missed), reviews: sum((r) => r.reviews?.count), listings: sum((r) => r.listings),
      top10Avg: withTop.length ? Math.round(withTop.reduce((s, r) => s + r.top10Avg, 0) / withTop.length) : null,
    },
  };
}

async function clientOr404(env, id) {
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', id);
  if (!c) throw new HttpError('Client not found.', 404);
  return c;
}

route('GET', '/api/clients/:id/locations', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  const c = await clientOr404(env, params.id);
  if (c.parent_id) {
    const p = await first(env, 'SELECT id, name FROM clients WHERE id = ?', c.parent_id);
    return json({ isLocation: true, parent: p });
  }
  return json({ isLocation: false, rollup: await rollup(env, c) });
});

route('POST', '/api/clients/:id/locations', async ({ env, user, params, body }) => {
  requireStaff(user);
  const p = await clientOr404(env, params.id);
  if (p.parent_id) throw new HttpError('Add locations to the main business, not to a location.');
  const b = await body();
  const t = (v, max = 300) => (v == null ? null : String(v).trim().slice(0, max) || null);
  const name = t(b.name, 120);
  if (!name) throw new HttpError('Name the location, like "Sunrise Roofing Pembroke Pines".');
  const id = newId('c_');
  await run(env, `INSERT INTO clients (id, name, plan, status, start_date, contact_name, contact_email, phone, website, address, category, services, cities, keywords, brand_voice, review_url, parent_id, created_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, name, p.plan, new Date().toISOString().slice(0, 10), p.contact_name, p.contact_email,
  t(b.phone, 30) || p.phone, t(b.website, 300) || p.website, t(b.address), p.category, p.services, t(b.cities, 500) || p.cities, t(b.keywords, 500) || p.keywords, p.brand_voice, null, p.id, now());
  await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', newId('l_'), p.id, `Location added: ${name}`, now(), user.id);
  return json({ client: await first(env, 'SELECT id, name, parent_id FROM clients WHERE id = ?', id) });
});

// The live dashboard in the client app: rankings, reviews, calls, work, site health, listings, locations, plans and the last report.
route('GET', '/api/clients/:id/live', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  const c = await clientOr404(env, params.id);
  const staff = user.role !== 'client';
  const month = monthKey();
  const [a, b] = monthRange(month);
  const [keywords, rep, tracked, tasks, recent, site, listings, report, plans, roll] = await Promise.all([
    keywordTrend(env, c.id), reputationFor(env, c).catch(() => null),
    first(env, "SELECT COUNT(*) AS n FROM tracking_numbers WHERE client_id = ? AND status = 'active'", c.id).catch(() => null),
    first(env, `SELECT COUNT(*) AS total, SUM(status = 'done') AS done FROM tasks WHERE client_id = ? AND month = ?${staff ? '' : ' AND client_visible = 1'}`, c.id, month),
    all(env, `SELECT text, at FROM (SELECT title AS text, done_at AS at FROM tasks WHERE client_id = ? AND status = 'done' AND done_at IS NOT NULL${staff ? '' : ' AND client_visible = 1'}
      UNION ALL SELECT text, at FROM log WHERE client_id = ?) ORDER BY at DESC LIMIT 8`, c.id, c.id),
    first(env, "SELECT score, finished_at FROM site_audits WHERE client_id = ? AND status = 'done' ORDER BY finished_at DESC LIMIT 1", c.id).catch(() => null),
    first(env, "SELECT COUNT(*) AS n FROM link_log WHERE client_id = ? AND status = 'live'", c.id).catch(() => null),
    first(env, "SELECT month, token FROM reports WHERE client_id = ? AND status = 'sent' ORDER BY month DESC LIMIT 1", c.id).catch(() => null),
    all(env, "SELECT quarter, token FROM quarterly_plans WHERE client_id = ? AND status = 'shared' ORDER BY quarter DESC LIMIT 2", c.id).catch(() => []),
    c.parent_id ? null : rollup(env, c, month),
  ]);
  const target = rep?.analysis ? null : await latestTarget(env, c.id);
  const an = rep?.analysis;
  const thisMonth = an?.months?.[an.months.length - 1];
  return json({
    month, keywords,
    reviews: an ? { rating: rep.pull.rating ?? an.avg, count: rep.pull.total ?? null, newThisMonth: thisMonth?.n ?? null, perMonth: an.perMonth, replyRate: an.replyRate }
      : target ? { rating: target.rating ?? null, count: target.reviews ?? null } : null,
    calls: tracked?.n ? await callStats(env, c.id, a, b) : null,
    work: { done: tasks?.done || 0, total: tasks?.total || 0, recent: recent.map((r) => ({ text: r.text, at: r.at })) },
    site: site ? { score: site.score, at: site.finished_at } : null,
    listings: listings?.n || 0,
    report: report ? { month: report.month, url: `/report.html#${report.token}` } : null,
    plans: plans.map((p) => ({ quarter: p.quarter, url: `/plan.html#${p.token}` })),
    locations: roll,
  });
});
