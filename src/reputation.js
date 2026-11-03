// Reputation report (Phase 9, Market Leader; Authority sees it too): pulls the newest Google reviews through DataForSEO's
// reviews task (async: post now, collect when ready), then works out the rating trend, review pace against the competitors seen
// in the monthly scans, the reply rate, unanswered bad reviews, and what customers talk about (plain word lists, no AI needed).
import { HttpError, json } from './util.js';
import { all, first, run, newId, now } from './db.js';
import { requireStaff, requireClientAccess } from './auth.js';
import { route } from './router.js';
import { leaderboard } from '../public/js/analysis.js';

const API = 'https://api.dataforseo.com/v3/business_data/google/reviews';
const isDemo = (env) => !env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD;
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const DAY = 86400e3;

export const THEMES = [
  ['On time and quick', /\b(on time|punctual|fast|quick(ly)?|prompt(ly)?|same day|right away|showed up)\b/i],
  ['Late or slow', /\b(late|slow|delay(ed|s)?|took forever|never showed|no show|kept waiting|waited)\b/i],
  ['Price and value', /\b(price[ds]?|pricing|cost|affordable|reasonable|fair|quote|estimate|expensive|overpriced|overcharg\w*)\b/i],
  ['Communication', /\b(communicat\w*|responsive|kept (me|us) (informed|updated|posted)|explained|answered (all )?(my|our) questions|call(ed)? (me )?back|never called|no response|ghost\w*)\b/i],
  ['Quality of the work', /\b(quality|great job|excellent work|workmanship|did a great|perfect(ly)?|beautiful|looks (great|amazing)|poor work|sloppy|shoddy|still leak\w*|redo)\b/i],
  ['Friendly and professional', /\b(friendly|professional(ism)?|polite|courteous|kind|respectful|rude|unprofessional|attitude)\b/i],
  ['Clean up', /\b(clean(ed)? up|cleanup|tidy|left a mess|messy|debris)\b/i],
  ['Would recommend', /\b(recommend\w*|use them again|will use again|go-to|call them again)\b/i],
];

// Everything the report shows, from a list of slim reviews { rating, text, at, reply }. Pure.
export function analyzeReviews(reviews = [], at = Date.now()) {
  const list = reviews.filter((r) => r && r.rating);
  const months = [];
  const d = new Date(at);
  for (let i = 5; i >= 0; i--) {
    const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1), b = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i + 1, 1);
    const inM = list.filter((r) => r.at >= a && r.at < b);
    months.push({ label: new Date(a).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }), n: inM.length, avg: inM.length ? Math.round((inM.reduce((s, r) => s + r.rating, 0) / inM.length) * 10) / 10 : null });
  }
  const last90 = list.filter((r) => r.at >= at - 90 * DAY);
  const stars = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  list.forEach((r) => { stars[Math.round(r.rating)] = (stars[Math.round(r.rating)] || 0) + 1; });
  const themes = THEMES.map(([label, re]) => {
    const hits = list.filter((r) => re.test(r.text || ''));
    const pos = hits.filter((r) => r.rating >= 4), neg = hits.filter((r) => r.rating <= 2);
    const quote = (neg.length > pos.length ? neg : pos)[0];
    return { label, total: hits.length, pos: pos.length, neg: neg.length, quote: quote ? excerpt(quote.text, re) : null };
  }).filter((t) => t.total).sort((a, b) => b.total - a.total);
  const unanswered = list.filter((r) => r.rating <= 3 && !r.reply).sort((a, b) => b.at - a.at);
  return {
    pulled: list.length,
    avg: list.length ? Math.round((list.reduce((s, r) => s + r.rating, 0) / list.length) * 10) / 10 : null,
    months, last90: last90.length, perMonth: Math.round((last90.length / 3) * 10) / 10,
    replyRate: list.length ? Math.round((100 * list.filter((r) => r.reply).length) / list.length) : null,
    stars, themes,
    unanswered: unanswered.slice(0, 5).map((r) => ({ rating: r.rating, at: r.at, text: (r.text || '').slice(0, 280) })),
    unansweredCount: unanswered.length,
  };
}
function excerpt(text, re) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const m = t.match(re);
  if (!m) return t.slice(0, 140);
  const i = Math.max(0, m.index - 60);
  return `${i ? '...' : ''}${t.slice(i, i + 150).trim()}${i + 150 < t.length ? '...' : ''}`;
}

// Review counts over time for the client and the top competitors, from the monthly scans. Pure over the snapshots given.
export function reviewPace(snaps) {
  const s = snaps.filter((x) => x && x.at).sort((a, b) => a.at - b.at);
  if (!s.length) return { history: [], competitors: [], mine: null };
  const first0 = s[0], last = s[s.length - 1];
  const months = Math.max((last.at - first0.at) / (30 * DAY), 0);
  const rate = (a, b) => (months >= 0.9 && a != null && b != null ? Math.round(((b - a) / months) * 10) / 10 : null);
  const history = s.map((x) => ({ at: x.at, rating: x.rating ?? null, reviews: x.reviews ?? null }));
  const competitors = (last.competitors || []).slice(0, 3).map((c) => {
    const early = first0.competitors?.find((e) => e.key === c.key);
    return { title: c.title, reviews: c.reviews, rating: c.rating, perMonth: rate(early?.reviews, c.reviews) };
  });
  return { history, competitors, mine: { reviews: last.reviews, rating: last.rating, perMonth: rate(first0.reviews, last.reviews) }, months: Math.round(months * 10) / 10 };
}

// Snapshots from the client's scans: one per month (the newest scan in each), last 6 months.
async function scanSnaps(env, clientId) {
  const rows = await all(env, 'SELECT id, created_at FROM scans WHERE client_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 60', clientId, now() - 200 * DAY);
  const perMonth = new Map();
  for (const r of rows) { const k = new Date(r.created_at).toISOString().slice(0, 7); if (!perMonth.has(k)) perMonth.set(k, r); }
  const snaps = [];
  for (const r of [...perMonth.values()].slice(0, 6)) {
    const d = parse((await first(env, 'SELECT data FROM scans WHERE id = ?', r.id))?.data);
    if (!d?.target) continue;
    const lb = d.points ? leaderboard(d.points, d.target, 5) : { rows: [] };
    snaps.push({ at: r.created_at, rating: d.target.rating ?? null, reviews: d.target.reviews ?? null,
      competitors: lb.rows.map((c) => ({ key: c.cid || c.place_id || c.title, title: c.title, reviews: c.reviews ?? null, rating: c.rating ?? null })) });
  }
  return snaps;
}

// ---------- pulling reviews ----------
const auth = (env) => `Basic ${btoa(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`)}`;
export function slimReviews(items = []) {
  return items.filter((i) => i && (i.type === 'google_reviews_search' || i.type === 'google_review' || i.rating)).map((i) => {
    const ts = Date.parse(String(i.timestamp || '').replace(' +00:00', 'Z').replace(' ', 'T'));
    return { rating: Number(i.rating?.value ?? i.rating) || null, text: String(i.review_text || i.original_review_text || '').slice(0, 1200), at: Number.isFinite(ts) ? ts : null, reply: Boolean(i.owner_answer) };
  }).filter((r) => r.rating && r.at);
}

function demoReviews(at = Date.now()) {
  const good = ['Showed up on time and fixed our roof leak the same day. Fair price and they cleaned up everything.', 'Very professional and friendly crew. Explained the whole job and the quote was reasonable. Highly recommend.',
    'Great job on our tile roof. Quality work and great communication the whole way.', 'Quick response after the storm. Would recommend to anyone in Hollywood.', 'Honest estimate, beautiful work, left no mess.'];
  const bad = ['They were late twice and never called back about the second visit.', 'Price was higher than the estimate and the leak came back.', 'Rude on the phone and took forever to schedule.'];
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  return Array.from({ length: 46 }, (_, i) => {
    const r = rnd();
    const rating = r < 0.08 ? 1 : r < 0.13 ? 2 : r < 0.2 ? 3 : r < 0.4 ? 4 : 5;
    const text = rating >= 4 ? good[i % good.length] : rating === 3 ? 'Job got done. Communication could be better.' : bad[i % bad.length];
    return { rating, text, at: at - Math.floor(rnd() * 170 * DAY), reply: rnd() < (rating >= 4 ? 0.5 : 0.3) };
  });
}

async function postPull(env, c) {
  const task = { language_code: 'en', depth: 100, sort_by: 'newest', priority: 1 };
  if (c.cid && !/^(demo|sample)/.test(c.cid)) task.cid = String(c.cid);
  else if (c.place_id && !/^(demo|sample)/.test(c.place_id)) task.place_id = c.place_id;
  else task.keyword = c.name;
  if (c.lat != null && c.lng != null) task.location_coordinate = `${Number(c.lat).toFixed(6)},${Number(c.lng).toFixed(6)},2000`;
  else task.location_code = 2840;
  const res = await fetch(`${API}/task_post`, { method: 'POST', headers: { Authorization: auth(env), 'content-type': 'application/json' }, body: JSON.stringify([task]) });
  const data = await res.json().catch(() => null);
  const t = data?.tasks?.[0];
  if (!res.ok || !t || !String(t.status_code).startsWith('201')) throw new HttpError(`DataForSEO: ${t?.status_message || data?.status_message || `HTTP ${res.status}`}`, 502);
  return { taskId: t.id, cost: Number(t.cost || 0) };
}

// Ask DataForSEO for a pull that is still waiting. Returns true once it is stored.
export async function collectPull(env, pull) {
  const res = await fetch(`${API}/task_get/${pull.task_id}`, { headers: { Authorization: auth(env) } });
  const data = await res.json().catch(() => null);
  const t = data?.tasks?.[0];
  if (!t) return false;
  if ([40601, 40602, 40100].includes(Number(t.status_code))) return false; // handed or still in the queue
  if (Number(t.status_code) !== 20000) {
    await run(env, "UPDATE review_pulls SET status = 'failed', error = ?, finished_at = ? WHERE id = ?", String(t.status_message || 'failed').slice(0, 300), now(), pull.id);
    return true;
  }
  const r = t.result?.[0] || {};
  const reviews = slimReviews(r.items || []);
  await run(env, "UPDATE review_pulls SET status = 'done', reviews = ?, rating = ?, total = ?, cost = cost + ?, finished_at = ? WHERE id = ?",
    JSON.stringify(reviews), r.rating?.value ?? null, r.reviews_count ?? r.rating?.votes_count ?? null, Number(t.cost || 0), now(), pull.id);
  return true;
}

// Cron: collect up to 3 waiting pulls a run.
export async function reviewTick(env) {
  if (isDemo(env)) return 0;
  const waiting = await all(env, "SELECT * FROM review_pulls WHERE status = 'queued' AND created_at < ? ORDER BY created_at LIMIT 3", now() - 30e3).catch(() => []);
  for (const p of waiting) await collectPull(env, p).catch(() => null);
  return waiting.length;
}

async function clientOr404(env, id) {
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', id);
  if (!c) throw new HttpError('Client not found.', 404);
  return c;
}

export async function reputationFor(env, c, { collect = false } = {}) {
  let pull = await first(env, "SELECT * FROM review_pulls WHERE client_id = ? AND status IN ('done','queued') ORDER BY created_at DESC LIMIT 1", c.id);
  if (collect && pull?.status === 'queued' && !isDemo(env) && now() - pull.created_at > 15e3) {
    if (await collectPull(env, pull).catch(() => false)) pull = await first(env, 'SELECT * FROM review_pulls WHERE id = ?', pull.id);
  }
  const done = pull?.status === 'done' ? pull : await first(env, "SELECT * FROM review_pulls WHERE client_id = ? AND status = 'done' ORDER BY created_at DESC LIMIT 1", c.id);
  const pace = reviewPace(await scanSnaps(env, c.id));
  return {
    waiting: pull?.status === 'queued' ? { since: pull.created_at } : null,
    pull: done ? { at: done.finished_at || done.created_at, rating: done.rating, total: done.total, demo: Boolean(done.demo) } : null,
    analysis: done ? analyzeReviews(parse(done.reviews) || [], done.finished_at || now()) : null,
    pace,
  };
}

route('GET', '/api/clients/:id/reputation', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  const c = await clientOr404(env, params.id);
  return json({ ...(await reputationFor(env, c, { collect: true })), demo: isDemo(env) });
});

route('POST', '/api/clients/:id/reputation/pull', async ({ env, user, params }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  const waiting = await first(env, "SELECT id FROM review_pulls WHERE client_id = ? AND status = 'queued' AND created_at > ?", c.id, now() - 3600e3);
  if (waiting) return json({ ok: true, waiting: true });
  const id = newId('rv_');
  if (isDemo(env)) {
    const reviews = demoReviews();
    await run(env, "INSERT INTO review_pulls (id, client_id, status, reviews, rating, total, cost, demo, created_at, finished_at) VALUES (?, ?, 'done', ?, 4.6, 58, 0, 1, ?, ?)", id, c.id, JSON.stringify(reviews), now(), now());
    return json({ ok: true, waiting: false });
  }
  const { taskId, cost } = await postPull(env, c);
  await run(env, "INSERT INTO review_pulls (id, client_id, task_id, status, cost, demo, created_at) VALUES (?, ?, ?, 'queued', ?, 0, ?)", id, c.id, taskId, cost, now());
  return json({ ok: true, waiting: true });
});
