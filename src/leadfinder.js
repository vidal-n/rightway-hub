// Lead finder (our own Outscraper style Google Maps scraper). Owners type keywords and areas; each area becomes a grid of map views,
// each view is one DataForSEO Maps search (about $0.002 for up to 100 businesses), repeats are removed, and the businesses wait in a
// results table. From there they go into the Pipeline through the same import the CSV uses (dedupe, DNC, free scrub, background
// enrichment of emails, owner names and socials), or download as CSV. A cron tick works a few searches at a time so a job never
// runs into Worker limits, and the open page nudges it every few seconds so it finishes quickly while someone watches.
import { bgOk } from './spend.js';
import { HttpError, json } from './util.js';
import { all, first, run, batch, newId, now } from './db.js';
import { requireAdmin } from './auth.js';
import { route } from './router.js';
import { mapsSearch } from './dataforseo.js';
import { mockFinder } from './mock.js';
import { osmSearch, isFreeMode } from './freedata.js';
import { importLeads, existingKeys } from './crm.js';
import { dupKeys } from '../public/js/leadintel.js';
import { notify } from './notify.js';
import {
  parseKeywords, parseAreas, MAX_KEYWORDS, MAX_AREAS, MAX_REQUESTS, MAX_OSM_REQUESTS, MAX_VIEWS, OSM_SIZES, SIZES, customSize, estimate, taskList, keyOf, cleanFilters, passes, leadRow, radiusFromBox,
} from '../public/js/finder.js';

const isDemo = (env) => !env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD;
const LOCK_MS = 60e3;
export const PER_TICK = 12; // searches per tick (Workers allow about 50 outside requests per run)
const PARALLEL = 6;
// Every request works on a small slice, so a big search never runs past the Worker's time limit (Cloudflare answers 503 then).
const PAGE = 400;        // results per page when the list is opened
const ADD_MAX = 100;     // businesses per Add request
const AUTO_STEP = 300;   // rows looked at per run while auto add works through a finished search
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const text = (v, max) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

export function jobView(j) {
  const areas = parse(j.areas, []);
  return {
    id: j.id, name: j.name, keywords: parse(j.keywords, []), areas: areas.map((a) => ({ label: a.label, radius: a.radius, size: a.size, views: a.views ?? null, lat: a.lat, lng: a.lng })),
    status: j.status, total: j.total, done: j.done, errors: j.errors, found: j.found, added: j.added, cost: Math.round((j.cost || 0) * 1000) / 1000, error: j.error || null,
    source: j.source === 'osm' ? 'osm' : 'google', demo: Boolean(j.demo), autoAdd: Boolean(j.auto_add), tag: j.tag || '', filters: cleanFilters(parse(j.filters, {})), createdAt: j.created_at, finishedAt: j.finished_at || null,
    pct: j.total ? Math.min(100, Math.round((j.done / j.total) * 100)) : 0,
  };
}

// ---------- places ----------
// A city, a ZIP code, or "lat,lng". OpenStreetMap's free geocoder (one request a second, with an identifying User-Agent).
export async function geocode(env, query, fetchImpl = fetch) {
  const q = text(query, 120);
  if (!q) throw new HttpError('Type a city or ZIP code.');
  const pair = /^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/.exec(q);
  if (pair) return { label: `${Number(pair[1]).toFixed(3)}, ${Number(pair[2]).toFixed(3)}`, lat: Number(pair[1]), lng: Number(pair[2]), radius: 5, state: '' };
  if (isDemo(env)) { const h = hash(q); return { label: q, lat: 25.7617 + ((h % 100) - 50) / 1000, lng: -80.1918 + (((h >>> 8) % 100) - 50) / 1000, radius: 4, state: (/,\s*([A-Za-z]{2})$/.exec(q)?.[1] || 'FL').toUpperCase() }; }
  let res;
  try {
    res = await fetchImpl(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&countrycodes=us&q=${encodeURIComponent(q)}`,
      { headers: { 'user-agent': 'RightwayHub/1.0 (hello@rightwaygrowth.com)', accept: 'application/json' } });
  } catch (e) { throw new HttpError(`Could not look up "${q}": ${e.message}`, 502); }
  if (!res.ok) throw new HttpError(`The place lookup failed (HTTP ${res.status}). Try again in a minute, or type the place as lat,lng.`, 502);
  const hit = (await res.json().catch(() => []))[0];
  if (!hit) throw new HttpError(`Could not find "${q}". Try a city and state, like Miami, FL, or a ZIP code.`);
  const lat = Number(hit.lat), lng = Number(hit.lon);
  const st = String(hit.address?.['ISO3166-2-lvl4'] || '').replace(/^US-/, '');
  const name = String(hit.name || hit.display_name || q).split(',')[0].trim();
  return { label: st && !new RegExp(`\\b${st}\\b`, 'i').test(q) ? `${name}, ${st}` : q, lat, lng, radius: radiusFromBox((hit.boundingbox || []).map(Number), lat), state: st };
}

route('POST', '/api/finder/geocode', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  return json({ place: await geocode(env, b.q) });
});

// ---------- jobs ----------
const clampRadius = (v) => Math.round(Math.min(30, Math.max(0.5, v)) * 10) / 10;

// Searches run one at a time, oldest first, so the others show as waiting rather than searching.
function listView(jobs) {
  const live = jobs.filter((j) => j.status === 'queued' || j.status === 'running').sort((a, b) => a.created_at - b.created_at);
  const working = new Set(live.filter((j, i) => i === 0 || (j.locked_until && j.locked_until > now())).map((j) => j.id));
  return jobs.map((j) => { const v = jobView(j); if (v.status === 'running' && !working.has(j.id)) v.status = 'queued'; return v; });
}

route('GET', '/api/finder', async ({ env, user }) => {
  requireAdmin(user);
  const jobs = await all(env, 'SELECT * FROM finder_jobs ORDER BY created_at DESC LIMIT 40');
  const sp = await bgOk(env);
  return json({ spendPaused: sp.ok ? null : { spent: sp.spent, cap: sp.cap }, jobs: listView(jobs), demo: isDemo(env), free: await isFreeMode(env), limits: { maxRequests: MAX_REQUESTS, maxOsmRequests: MAX_OSM_REQUESTS, maxKeywords: MAX_KEYWORDS, maxAreas: MAX_AREAS } });
});

route('POST', '/api/finder/jobs', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  const keywords = parseKeywords(b.keywords, 99);
  if (!keywords.length) throw new HttpError('Type at least one keyword, like "roofing contractor".');
  if (keywords.length > MAX_KEYWORDS) throw new HttpError(`Use up to ${MAX_KEYWORDS} keywords per search.`);
  const names = parseAreas(b.areas, 99);
  if (!names.length) throw new HttpError('Type at least one city or ZIP code, one per line.');
  if (names.length > MAX_AREAS) throw new HttpError(`Use up to ${MAX_AREAS} areas per search.`);
  const source = b.source === 'osm' ? 'osm' : 'google';
  if (source === 'google' && await isFreeMode(env)) throw new HttpError('Free lead data mode is on, so Google Maps searches (which cost money) are off. Pick OpenStreetMap, or switch the mode in Settings.');
  // Custom views (Google only): a number of map views per place, 1 to 81. Otherwise the coverage grid size.
  const views = source === 'google' && Number(b.views) >= 1 ? Math.min(MAX_VIEWS, Math.round(Number(b.views))) : null;
  const size = views ? customSize(views) : source === 'osm' ? (OSM_SIZES.includes(Number(b.size)) ? Number(b.size) : 3) : SIZES.includes(Number(b.size)) ? Number(b.size) : 5;
  const est = estimate({ areas: names.length, size, keywords: keywords.length, source, views });
  if (est.tooBig) throw new HttpError(source === 'osm'
    ? `That is ${est.requests} free searches. One free job can run up to ${MAX_OSM_REQUESTS} so OpenStreetMap's shared servers stay happy. Use fewer areas or keywords, or a smaller coverage.`
    : `That is ${est.requests.toLocaleString('en-US')} searches (about $${est.cost.toFixed(2)}). One job can run up to ${MAX_REQUESTS.toLocaleString('en-US')}. Use fewer areas or keywords, or a smaller coverage.`);
  const fixed = Number(b.radius) > 0 ? clampRadius(Number(b.radius)) : null;
  const areas = [];
  const skippedAreas = [];
  for (const [i, n] of names.entries()) {
    if (i && !isDemo(env) && env.FINDER_GEOCODE_GAP !== '0') await sleep(1100); // the geocoder allows one request a second
    const p = await geocode(env, n);
    // "Miami, FL" that the map puts in another state is a bad match, so it is skipped rather than searched.
    const want = /,\s*([A-Za-z]{2})$/.exec(n)?.[1]?.toUpperCase();
    if (want && p.state && p.state.toUpperCase() !== want) { skippedAreas.push(n); continue; }
    areas.push({ label: p.label, lat: p.lat, lng: p.lng, radius: fixed ?? clampRadius(p.radius), size, views, state: p.state });
  }
  if (!areas.length) throw new HttpError(`None of those places could be found in the state named: ${skippedAreas.join(', ')}.`);
  const name = text(b.name, 80) || `${keywords[0]} in ${areas[0].label}${areas.length > 1 ? ` and ${areas.length - 1} more` : ''}`;
  const id = newId('fj_');
  const total = taskList(areas, keywords).length;
  await run(env, `INSERT INTO finder_jobs (id, name, keywords, areas, filters, auto_add, tag, status, total, demo, created_by, created_at, updated_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`, id, name, JSON.stringify(keywords), JSON.stringify(areas), JSON.stringify(cleanFilters(b.filters)), b.autoAdd ? 1 : 0,
  text(b.tag, 60) || name.slice(0, 60), total, source === 'google' && isDemo(env) ? 1 : 0, user.id, now(), now(), source);
  return json({ job: jobView(await first(env, 'SELECT * FROM finder_jobs WHERE id = ?', id)) });
});

async function jobOr404(env, id) {
  const j = await first(env, 'SELECT * FROM finder_jobs WHERE id = ?', id);
  if (!j) throw new HttpError('Search not found.', 404);
  return j;
}

route('GET', '/api/finder/jobs/:id', async ({ env, user, params }) => {
  requireAdmin(user);
  return json({ job: jobView(await jobOr404(env, params.id)) });
});

route('POST', '/api/finder/jobs/:id/stop', async ({ env, user, params }) => {
  requireAdmin(user);
  await jobOr404(env, params.id);
  await run(env, "UPDATE finder_jobs SET status = 'stopped', locked_until = NULL, updated_at = ? WHERE id = ? AND status IN ('queued', 'running')", now(), params.id);
  return json({ job: jobView(await jobOr404(env, params.id)) });
});

route('POST', '/api/finder/jobs/:id/resume', async ({ env, user, params }) => {
  requireAdmin(user);
  const j = await jobOr404(env, params.id);
  if (j.done < j.total) await run(env, "UPDATE finder_jobs SET status = 'queued', error = NULL, locked_until = NULL, finished_at = NULL, updated_at = ? WHERE id = ? AND status IN ('stopped', 'failed')", now(), params.id);
  return json({ job: jobView(await jobOr404(env, params.id)) });
});

route('DELETE', '/api/finder/jobs/:id', async ({ env, user, params }) => {
  requireAdmin(user);
  await jobOr404(env, params.id);
  await batch(env, [['DELETE FROM finder_results WHERE job_id = ?', params.id], ['DELETE FROM finder_jobs WHERE id = ?', params.id]]);
  return json({ ok: true });
});

// ---------- results ----------
const dupShape = (r) => ({ business: r.title, phone: r.phone, website: r.website, city: r.city, zip: r.zip });

// One page at a time (`after` = the last key of the page before; `next` is set while there is more). The page keeps the list open fast.
route('GET', '/api/finder/jobs/:id/results', async ({ env, user, params, url }) => {
  requireAdmin(user);
  const job = await jobOr404(env, params.id);
  const after = String(url.searchParams.get('after') || '').slice(0, 400);
  const limit = Math.min(1000, Math.max(1, Math.round(Number(url.searchParams.get('limit'))) || PAGE));
  const rows = await all(env, 'SELECT rkey, data, state, lead_id FROM finder_results WHERE job_id = ? AND rkey > ? ORDER BY rkey LIMIT ?', job.id, after, limit + 1);
  const more = rows.length > limit;
  if (more) rows.pop();
  const total = after ? job.found : (await first(env, 'SELECT COUNT(*) AS n FROM finder_results WHERE job_id = ?', job.id))?.n || 0;
  const keys = rows.some((r) => r.state === 'new') ? await existingKeys(env) : new Map();
  const results = rows.map((r) => {
    const rec = parse(r.data, {});
    let st = r.state, leadId = r.lead_id || null;
    if (st === 'new') { const hit = dupKeys(dupShape(rec)).find((k) => keys.has(k)); if (hit) { const k = keys.get(hit); st = k?.dnc ? 'dnc' : k?.supp ? 'blocked' : 'inhub'; leadId = k?.id || null; } }
    return { key: r.rkey, ...rec, st, lead_id: leadId };
  });
  // What the background scrub found for the ones already in the Hub: emails, owner, phone type, socials.
  const ids = [...new Set(results.map((r) => r.lead_id).filter(Boolean))];
  const byId = new Map();
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    for (const l of await all(env, `SELECT id, email, email_status, owner_name, phone_type, data_score, socials, stage FROM leads WHERE id IN (${part.map(() => '?').join(',')})`, ...part)) byId.set(l.id, l);
  }
  for (const r of results) {
    const l = byId.get(r.lead_id);
    if (l) Object.assign(r, { email: l.email || '', email_status: l.email_status || '', owner_name: l.owner_name || '', phone_type: l.phone_type || '', data_score: l.data_score ?? null, socials: parse(l.socials, null), lead_stage: l.stage });
  }
  const next = more ? rows[rows.length - 1].rkey : null;
  return json({ job: jobView(job), results, total, next, capped: false });
});

// Put businesses into the Pipeline. Either the keys the person ticked, or everything that passes the filters.
export async function addToPipeline(env, job, rows, by, { tag } = {}) {
  const recs = rows.map((r) => ({ key: r.rkey, rec: parse(r.data, {}) }));
  const out = await importLeads(env, { id: by }, recs.map(({ rec }) => leadRow(rec)), { source: 'Lead finder', tags: tag || job.tag || job.name, merge: false });
  const ops = out.rows.map((o, i) => (o.id
    ? ["UPDATE finder_results SET state = 'added', lead_id = ? WHERE job_id = ? AND rkey = ?", o.id, job.id, recs[i].key]
    : ['UPDATE finder_results SET state = ?, lead_id = ? WHERE job_id = ? AND rkey = ?', o.skipped === 'dnc' ? 'dnc' : o.skipped === 'suppressed' ? 'blocked' : o.skipped === 'invalid' ? 'nophone' : 'inhub', o.lead_id || null, job.id, recs[i].key]));
  for (let i = 0; i < ops.length; i += 100) await batch(env, ops.slice(i, i + 100));
  await run(env, 'UPDATE finder_jobs SET added = added + ?, updated_at = ? WHERE id = ?', out.imported, now(), job.id);
  const st = (o) => (o.id ? 'added' : o.skipped === 'dnc' ? 'dnc' : o.skipped === 'suppressed' ? 'blocked' : o.skipped === 'invalid' ? 'nophone' : 'inhub');
  out.byKey = Object.fromEntries(out.rows.map((o, i) => [recs[i].key, { st: st(o), lead_id: o.id || o.lead_id || null }]));
  return out;
}

// Either the keys the person ticked (up to ADD_MAX a request; the page sends them in batches), or what passes the filters,
// looked at AUTO_STEP rows at a time from `after` (`next` says where to carry on).
route('POST', '/api/finder/jobs/:id/add', async ({ env, user, params, body }) => {
  requireAdmin(user);
  const job = await jobOr404(env, params.id);
  const b = await body();
  let rows, next = null;
  if (Array.isArray(b.keys)) {
    const keys = [...new Set(b.keys.map(String))];
    if (keys.length > ADD_MAX) throw new HttpError(`Send up to ${ADD_MAX} at a time.`);
    rows = keys.length ? await all(env, `SELECT rkey, data FROM finder_results WHERE job_id = ? AND state = 'new' AND rkey IN (${keys.map(() => '?').join(',')})`, job.id, ...keys) : [];
    if (!rows.length) return json({ imported: 0, skipped: 0, skippedBy: {}, scrubbed: 0, results: {}, job: jobView(job) });
  } else {
    const f = cleanFilters(b.filters ?? parse(job.filters, {}));
    const page = await all(env, 'SELECT rkey, data, state FROM finder_results WHERE job_id = ? AND rkey > ? ORDER BY rkey LIMIT ?', job.id, String(b.after || ''), AUTO_STEP + 1);
    if (page.length > AUTO_STEP) { page.pop(); next = page[page.length - 1].rkey; }
    rows = page.filter((r) => r.state === 'new' && passes(parse(r.data, {}), f));
    if (!rows.length && !next) throw new HttpError('Nothing to add. These are already in the Hub, or none match the filters.');
  }
  const out = { imported: 0, skipped: 0, scrubbed: 0, skippedBy: { phone: 0, website: 0, name: 0, invalid: 0, dnc: 0, suppressed: 0 }, results: {} };
  for (let i = 0; i < rows.length; i += 25) {
    const r = await addToPipeline(env, job, rows.slice(i, i + 25), user.id, { tag: text(b.tag, 60) });
    out.imported += r.imported; out.skipped += r.skipped; out.scrubbed += r.scrubbed;
    for (const k of Object.keys(out.skippedBy)) out.skippedBy[k] += r.skippedBy[k] || 0;
    Object.assign(out.results, r.byKey);
  }
  return json({ ...out, next, job: jobView(await jobOr404(env, job.id)) });
});

// ---------- the queue ----------
// Auto add works through a finished search AUTO_STEP rows per run (auto_add 1 = still going, 2 = finished), so no run reads the whole search.
async function autoAddStep(env, job) {
  const f = cleanFilters(parse(job.filters, {}));
  const page = await all(env, 'SELECT rkey, data, state FROM finder_results WHERE job_id = ? AND rkey > ? ORDER BY rkey LIMIT ?', job.id, job.auto_cursor || '', AUTO_STEP + 1);
  const last = page.length <= AUTO_STEP;
  if (!last) page.pop();
  const want = page.filter((r) => r.state === 'new' && passes(parse(r.data, {}), f));
  let added = 0;
  for (let i = 0; i < want.length; i += 25) added += (await addToPipeline(env, job, want.slice(i, i + 25), job.created_by)).imported;
  await run(env, 'UPDATE finder_jobs SET auto_cursor = ?, auto_add = ? WHERE id = ?', page.length ? page[page.length - 1].rkey : job.auto_cursor || '', last ? 2 : 1, job.id);
  return { added, last };
}
async function autoAddTick(env, at) {
  const job = await first(env, "SELECT * FROM finder_jobs WHERE status = 'done' AND auto_add = 1 AND (locked_until IS NULL OR locked_until < ?) ORDER BY finished_at LIMIT 1", at);
  if (!job) return;
  const claim = await run(env, 'UPDATE finder_jobs SET locked_until = ? WHERE id = ? AND (locked_until IS NULL OR locked_until < ?)', at + LOCK_MS, job.id, at);
  if ((claim?.meta?.changes ?? 1) < 1) return;
  try {
    const { last } = await autoAddStep(env, job);
    if (last) {
      const done = await jobOr404(env, job.id);
      await notify(env, { to: job.created_by ? [job.created_by] : 'admins', kind: 'lead', title: `Lead search added to the Pipeline: ${(done.added || 0).toLocaleString('en-US')} businesses`, body: job.name, url: `/#/finder/${job.id}`, slack: false }).catch(() => {});
    }
  } finally { await run(env, 'UPDATE finder_jobs SET locked_until = NULL WHERE id = ?', job.id); }
}

// Work on the oldest waiting search for up to `budget` map views. Returns how many were run (the cron uses it to share the outside request budget).
export async function finderTick(env, budget = PER_TICK, { fetchImpl, at = now() } = {}) {
  const job = await first(env, "SELECT * FROM finder_jobs WHERE status IN ('queued', 'running') AND (locked_until IS NULL OR locked_until < ?) ORDER BY created_at LIMIT 1", at);
  if (!job) { await autoAddTick(env, at).catch((e) => console.error('finder auto add', e)); return 0; }
  const claim = await run(env, "UPDATE finder_jobs SET locked_until = ?, status = 'running' WHERE id = ? AND (locked_until IS NULL OR locked_until < ?)", at + LOCK_MS, job.id, at);
  if ((claim?.meta?.changes ?? 1) < 1) return 0;
  const osm = job.source === 'osm';
  const demo = !osm && isDemo(env);
  // Paid Google Maps searches stop for the day at the owner's spending limit (OpenStreetMap is free and keeps going).
  if (!osm && !demo && !(await bgOk(env)).ok) { await run(env, 'UPDATE finder_jobs SET locked_until = NULL WHERE id = ?', job.id); return 0; }
  const tasks = taskList(parse(job.areas, []), parse(job.keywords, []));
  if (osm) budget = Math.min(budget, 3);              // OpenStreetMap's servers are shared and free: a few at a time, one by one
  let i = job.done, used = 0, cost = 0, errors = 0, fatal = null;
  while (i < tasks.length && used < budget && !fatal) {
    const slice = tasks.slice(i, i + Math.min(osm ? 1 : PARALLEL, budget - used));
    if (osm && used) await sleep(env.FINDER_OSM_GAP === '0' ? 0 : 1200);
    const out = await Promise.all(slice.map(async (t) => { try { return demo ? mockFinder(t) : osm ? await osmSearch(env, t, fetchImpl) : await mapsSearch(env, t, fetchImpl); } catch (e) { return { error: e }; } }));
    const ops = [];
    out.forEach((r, k) => {
      if (r.error) { errors++; if (/balance is empty|rejected the login/i.test(r.error.message || '')) fatal = r.error.message; return; }
      cost += r.cost || 0;
      for (const rec of r.results) ops.push(['INSERT OR IGNORE INTO finder_results (job_id, rkey, data) VALUES (?, ?, ?)', job.id, keyOf(rec), JSON.stringify({ ...rec, kw: slice[k].keyword, area: slice[k].label })]);
    });
    for (let p = 0; p < ops.length; p += 100) await batch(env, ops.slice(p, p + 100));
    used += slice.length;
    if (fatal) break; // this slice is run again after the problem is fixed
    i += slice.length;
  }
  const found = (await first(env, 'SELECT COUNT(*) AS n FROM finder_results WHERE job_id = ?', job.id))?.n || 0;
  const finished = i >= tasks.length;
  const allFailed = finished && found === 0 && job.errors + errors > 0;
  const status = fatal || allFailed ? 'failed' : finished ? 'done' : 'running';
  const error = fatal || (allFailed ? (osm ? 'Every search failed. OpenStreetMap\'s free servers may be busy. Try Resume in a few minutes.' : 'Every search failed. Check the DataForSEO balance and login, then resume.') : job.error);
  await run(env, 'UPDATE finder_jobs SET done = ?, errors = errors + ?, found = ?, cost = cost + ?, status = ?, error = ?, locked_until = NULL, updated_at = ?, finished_at = ? WHERE id = ?',
    i, errors, found, cost, status, error || null, now(), finished || fatal ? now() : null, job.id);
  if (status === 'done') {
    // The first step of auto add runs now; a big search carries on in the next runs.
    const step = job.auto_add === 1 ? await autoAddStep(env, { ...job, auto_cursor: '' }).catch((e) => { console.error('finder auto add', e); return { added: 0, last: true }; }) : null;
    const tail = step ? `. ${step.added.toLocaleString('en-US')} added to the Pipeline${step.last ? '.' : ' so far, the rest are being added now.'}` : '. Review them and add the ones you want.';
    await notify(env, { to: job.created_by ? [job.created_by] : 'admins', kind: 'lead', title: `Lead search finished: ${found.toLocaleString('en-US')} businesses`, body: `${job.name}${tail}`, url: `/#/finder/${job.id}`, slack: false }).catch(() => {});
  }
  return used;
}

route('POST', '/api/finder/tick', async ({ env, user }) => {
  requireAdmin(user);
  const used = await finderTick(env, PER_TICK);
  const jobs = await all(env, "SELECT * FROM finder_jobs WHERE status IN ('queued', 'running') OR finished_at > ? ORDER BY created_at DESC LIMIT 40", now() - 60e3);
  return json({ used, jobs: listView(jobs) });
});
