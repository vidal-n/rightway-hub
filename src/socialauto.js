// Social autopilot (server): keeps each client's social calendar stacked with ready-to-post items.
// It never posts anywhere. Items land as drafts or "scheduled" with auto = 1 and stay hidden from the client until a person
// verifies them. Then the team copies the caption, posts it by hand and marks it posted.
//   - settings per client in settings `social_auto:<clientId>` (see `cleanSettings` in public/js/socialplan.js)
//   - real inputs: the client's scans (weak spots), posted items with logged leads, real Google reviews (never demo ones), waiting client photos
//   - captions by Claude in batches when ANTHROPIC_API_KEY is set (cost logged, background runs obey the daily limit), templates otherwise
import { HttpError, json } from './util.js';
import { all, first, run, newId, now, setSetting } from './db.js';
import { route } from './router.js';
import { requireStaff } from './auth.js';
import { notify } from './notify.js';
import { logClaude } from './costs.js';
import { bgOk } from './spend.js';
import { shape } from './social.js';
import { captionIssues, readyForReview } from '../public/js/social.js';
import { cleanSettings, planQueue, batchPrompt, parseBatch, mergeCaptions, readiness, PILLAR, PILLARS, localDayKey } from '../public/js/socialplan.js';

const API = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const CHUNK = 8;
const MAX_NEW = 40;
const DAY = 86400e3;
const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
const keyOf = (id) => `social_auto:${id}`;

export async function autoSettings(env, clientId) {
  const row = await first(env, 'SELECT v FROM settings WHERE k = ?', keyOf(clientId));
  return cleanSettings(parse(row?.v, {}));
}

async function loadClient(env, id) {
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', id);
  if (!c) throw new HttpError('Client not found.', 404);
  return c;
}

// Newest scan per keyword: [{keyword, top10Pct}]
async function scanRows(env, clientId) {
  const rows = await all(env, 'SELECT keyword, summary FROM scans WHERE client_id = ? ORDER BY created_at DESC LIMIT 60', clientId);
  const seen = new Set(); const out = [];
  for (const r of rows) { const k = String(r.keyword || '').toLowerCase(); if (!k || seen.has(k)) continue; seen.add(k); out.push({ keyword: r.keyword, top10Pct: parse(r.summary, {}).top10Pct ?? 0 }); }
  return out;
}

// Real reviews only. A demo pull (no DataForSEO) is made up, so it never reaches a caption.
async function realReviews(env, clientId) {
  const row = await first(env, "SELECT reviews FROM review_pulls WHERE client_id = ? AND status = 'done' AND demo = 0 ORDER BY finished_at DESC LIMIT 1", clientId);
  return parse(row?.reviews, []).filter((r) => Number(r.rating) >= 4 && String(r.text || '').length >= 40).slice(0, 20);
}

async function claudeBatch(env, client, items) {
  const model = env.ANTHROPIC_CONTENT_MODEL || env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const res = await fetch(API, { method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'user', content: batchPrompt(client, items) }] }) });
  const data = await res.json().catch(() => null);
  await logClaude(env, model, data, 'social autopilot');
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return parseBatch((data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'), items.length);
}

// Waiting client photos go onto posts that need one. The file is copied, so the Photos tab keeps its own.
async function attachPhotos(env, clientId, rows) {
  if (!env.MEDIA) return 0;
  const photos = await all(env, 'SELECT * FROM client_photos WHERE client_id = ? AND post_id IS NULL ORDER BY created_at LIMIT 60', clientId);
  let used = 0;
  for (const row of rows) {
    if (!row.needsPhoto || !photos.length) continue;
    const p = photos.shift();
    const obj = await env.MEDIA.get(p.media_key);
    if (!obj) continue;
    const ext = (p.media_key.split('.').pop() || 'jpg');
    const key = `social/${clientId}/${row.id}/${newId('m_')}.${ext}`;
    await env.MEDIA.put(key, new Uint8Array(await obj.arrayBuffer()), { httpMetadata: { contentType: p.media_type || 'image/jpeg' } });
    row.media = [{ key, type: p.media_type || 'image/jpeg', name: `photo.${ext}`, size: p.size || 0 }];
    await run(env, 'UPDATE client_photos SET post_id = ? WHERE id = ?', row.id, p.id);
    used += 1;
  }
  return used;
}

// Build the plan for a client. `commit` writes it. Returns what was (or would be) made.
export async function stack(env, client, { user = null, commit = true, useAi = true, max = MAX_NEW } = {}) {
  const settings = await autoSettings(env, client.id);
  const t = now();
  const existing = (await all(env, 'SELECT scheduled_at, status, auto FROM social_items WHERE client_id = ? AND scheduled_at >= ?', client.id, t - 2 * DAY));
  const history = (await all(env, "SELECT pillar, leads FROM social_items WHERE client_id = ? AND status = 'posted' AND leads IS NOT NULL AND pillar IS NOT NULL LIMIT 200", client.id));
  const plan = planQueue({ client, settings, scans: await scanRows(env, client.id), history, existing, reviews: await realReviews(env, client.id), now: t });
  const items = plan.items.slice(0, max);
  let ai = false; let error = null;
  if (useAi && env.ANTHROPIC_API_KEY && items.length) {
    ai = true;
    for (let i = 0; i < items.length; i += CHUNK) {
      const part = items.slice(i, i + CHUNK);
      try { (await claudeBatch(env, client, part)).forEach((c, n) => { part[n].captions = mergeCaptions(part[n], c); }); } catch (e) { error = String(e.message || e); ai = ai && i > 0; }
    }
  }
  if (!commit) return { settings, items, ai, error, learned: plan.learned, summary: plan.summary, photos: 0 };
  const rows = items.map((it) => ({ ...it, id: newId('sp_'), media: [] }));
  const photos = await attachPhotos(env, client.id, rows);
  for (const r of rows) {
    const captions = Object.fromEntries(r.channels.map((ch) => [ch, { text: r.captions[ch] || '', first_comment: '' }]));
    const left = readiness({ channels: r.channels, captions, media: r.media }, captionIssues).left.filter((x) => !/Many hashtags/.test(x));
    r.status = left.length ? 'draft' : 'scheduled';
    r.left = left;
    await run(env, `INSERT INTO social_items (id, client_id, title, project, notes, status, channels, captions, media, scheduled_at, assignee, post_links, ai, auto, pillar, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 'Autopilot', ?, ?, ?, ?, ?, ?, NULL, '{}', ?, 1, ?, ?, ?, ?)`,
    r.id, client.id, r.title.slice(0, 160), r.note, r.status, JSON.stringify(r.channels), JSON.stringify(captions), JSON.stringify(r.media), r.at, r.captions.ai ? 1 : 0, r.pillar, user?.id ?? null, t, t);
  }
  await setSetting(env, `social_auto_last:${client.id}`, String(t));
  return { settings, items: rows.map((r) => ({ id: r.id, title: r.title, scheduled_at: r.at, channels: r.channels, status: r.status, left: r.left })), ai, error, learned: plan.learned, summary: plan.summary, photos };
}

// Counts for the card: how full the stack is and what still needs a person.
async function status(env, clientId) {
  const t = now();
  const rows = (await all(env, "SELECT id, status, scheduled_at, auto, verified_at, pillar, leads, channels, captions, media FROM social_items WHERE client_id = ? AND status != 'idea' AND (auto = 1 OR scheduled_at >= ?) LIMIT 600", clientId, t)).map(shape);
  const future = rows.filter((r) => r.scheduled_at && r.scheduled_at >= t && r.status !== 'posted');
  const auto = future.filter((r) => r.auto);
  const needsPhoto = auto.filter((r) => r.status === 'draft').length;
  const toVerify = auto.filter((r) => !r.verified_at && r.status === 'scheduled').length;
  const verified = auto.filter((r) => r.verified_at).length;
  const last = future.reduce((m, r) => Math.max(m, r.scheduled_at), 0);
  const waiting = (await first(env, 'SELECT COUNT(*) n FROM client_photos WHERE client_id = ? AND post_id IS NULL', clientId))?.n || 0;
  const withResult = rows.filter((r) => r.status === 'posted' && r.leads != null && r.pillar).length;
  return { stacked: future.length, auto: auto.length, needsPhoto, toVerify, verified, lastAt: last || null, photosWaiting: waiting, withResult, resultsNeeded: Math.max(0, 6 - withResult) };
}

route('GET', '/api/clients/:id/social/autopilot', async ({ env, user, params }) => {
  requireStaff(user);
  const c = await loadClient(env, params.id);
  return json({ settings: await autoSettings(env, c.id), status: await status(env, c.id), pillars: PILLARS.map((p) => ({ id: p.id, label: p.label, goal: p.goal })), ai: Boolean(env.ANTHROPIC_API_KEY),
    ready: Boolean(String(c.services || '').trim() && String(c.cities || '').trim()) });
});

route('PUT', '/api/clients/:id/social/autopilot', async ({ env, user, params, body: readBody }) => {
  const body = await readBody();
  requireStaff(user);
  const c = await loadClient(env, params.id);
  const s = cleanSettings(body?.settings || body || {});
  await setSetting(env, keyOf(c.id), JSON.stringify(s));
  return json({ settings: s, status: await status(env, c.id) });
});

// Preview shows what would be made (templates only, free). Run makes it.
route('POST', '/api/clients/:id/social/autopilot/run', async ({ env, user, params, body: readBody }) => {
  const body = await readBody();
  requireStaff(user);
  const c = await loadClient(env, params.id);
  if (!String(c.services || '').trim() && !String(c.category || '').trim()) throw new HttpError('Add the client\'s services and cities on their profile first. The posts are built from them.', 400);
  const max = Math.max(1, Math.min(MAX_NEW, Math.round(Number(body?.max) || MAX_NEW)));
  const out = await stack(env, c, { user, commit: !body?.preview, useAi: !body?.preview, max });
  if (!body?.preview && !out.items.length) return json({ ...out, message: 'The calendar is already full for the weeks ahead.' });
  return json({ ...out, status: await status(env, c.id) });
});

// ---------- verify, results, queue ----------
async function verifyOne(env, user, it, { force = false, defer } = {}) {
  const left = readiness(it, captionIssues).left.filter((x) => !/Many hashtags/.test(x));
  if (left.length && !force) throw new HttpError(`Not ready yet. ${left.slice(0, 3).join(' ')}`, 400);
  const s = await autoSettings(env, it.client_id);
  const toClient = s.clientReview && it.status !== 'review';
  if (toClient) {
    const problems = readyForReview(it);
    if (problems.length) throw new HttpError(`Not ready for the client yet. ${problems.slice(0, 3).join(' ')}`, 400);
  }
  const next = toClient ? 'review' : (['draft', 'idea', 'changes'].includes(it.status) ? 'scheduled' : it.status);
  await run(env, 'UPDATE social_items SET status = ?, verified_at = ?, updated_at = ? WHERE id = ?', next, now(), now(), it.id);
  if (toClient) defer?.(notify(env, { to: { clientUsers: it.client_id }, kind: 'update', title: 'A post is ready for you to check', body: it.title, url: '/#/social', slack: false }).catch(() => {}));
  return next;
}

route('POST', '/api/social/:id/verify', async ({ env, user, params, body: readBody, defer }) => {
  const body = await readBody();
  requireStaff(user);
  const it = shape(await first(env, 'SELECT * FROM social_items WHERE id = ?', params.id));
  if (!it) throw new HttpError('Post not found.', 404);
  const status = await verifyOne(env, user, it, { force: Boolean(body?.force), defer });
  return json({ ok: true, status });
});

// Verify every ready autopilot post for a client in one click. Posts that still need a photo are skipped and counted.
route('POST', '/api/clients/:id/social/verify-all', async ({ env, user, params, defer }) => {
  requireStaff(user);
  await loadClient(env, params.id);
  const rows = (await all(env, "SELECT * FROM social_items WHERE client_id = ? AND auto = 1 AND verified_at IS NULL AND status IN ('draft','scheduled') AND scheduled_at >= ? ORDER BY scheduled_at LIMIT 60", params.id, now())).map(shape);
  let done = 0; let skipped = 0;
  for (const it of rows) { try { await verifyOne(env, user, it, { defer }); done += 1; } catch { skipped += 1; } }
  return json({ done, skipped, status: await status(env, params.id) });
});

// How many leads (calls, messages, quote requests) this post brought. The autopilot gives more slots to what works.
route('PUT', '/api/social/:id/result', async ({ env, user, params, body: readBody }) => {
  const body = await readBody();
  requireStaff(user);
  const it = await first(env, 'SELECT id FROM social_items WHERE id = ?', params.id);
  if (!it) throw new HttpError('Post not found.', 404);
  const raw = body?.leads;
  const n = raw === null || raw === '' || raw === undefined ? null : Math.round(Number(raw));
  if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1000)) throw new HttpError('Type a number from 0 to 1000.');
  await run(env, 'UPDATE social_items SET leads = ?, updated_at = ? WHERE id = ?', n, now(), it.id);
  return json({ ok: true, leads: n });
});

// Everything waiting for a person across all clients: overdue and the next few days, plus what still needs verifying.
route('GET', '/api/social/queue', async ({ env, user, url }) => {
  requireStaff(user);
  const days = Math.max(1, Math.min(60, Math.round(Number(url.searchParams.get('days')) || 7)));
  const only = String(url.searchParams.get('client') || '');
  const t = now();
  const rows = (await all(env, `SELECT s.*, c.name AS client_name FROM social_items s JOIN clients c ON c.id = s.client_id
    WHERE s.status IN ('draft','scheduled','approved','review','changes') AND s.scheduled_at IS NOT NULL AND s.scheduled_at < ? AND (? != '' AND s.client_id = ? OR ? = '' AND c.status = 'active' AND COALESCE(c.sample, 0) = 0)
    ORDER BY s.scheduled_at LIMIT 300`, t + days * DAY, only, only, only)).map((r) => ({ ...shape(r), client_name: r.client_name }));
  const items = rows.map((r) => {
    const left = readiness(r, captionIssues).left.filter((x) => !/Many hashtags/.test(x));
    return { id: r.id, client_id: r.client_id, client_name: r.client_name, title: r.title, status: r.status, auto: Boolean(r.auto), verified: Boolean(r.verified_at), pillar: r.pillar, channels: r.channels, captions: r.captions,
      scheduled_at: r.scheduled_at, notes: r.notes, media: r.media.map((m, n) => ({ type: m.type, url: `/api/social/${r.id}/media/${n}` })), left, overdue: r.scheduled_at < t - 3600e3 };
  });
  const toScore = (await all(env, `SELECT s.id, s.client_id, s.title, s.posted_at, s.pillar, c.name AS client_name FROM social_items s JOIN clients c ON c.id = s.client_id
    WHERE s.status = 'posted' AND s.auto = 1 AND s.leads IS NULL AND s.posted_at >= ? AND (? = '' OR s.client_id = ?) ORDER BY s.posted_at DESC LIMIT 30`, t - 21 * DAY, only, only)).map((r) => ({ ...r, pillar: PILLAR[r.pillar]?.label || r.pillar }));
  const count = (f) => items.filter(f).length;
  return json({ items, toScore, counts: { total: items.length, overdue: count((i) => i.overdue), toVerify: count((i) => i.auto && !i.verified && !i.left.length), needsPhoto: count((i) => i.left.length), today: count((i) => localDayKey(i.scheduled_at, 'America/New_York') === localDayKey(t, 'America/New_York')) } });
});

// ---------- cron ----------
// One client per run, at most once a day each, only when the stack is running low. Claude only when the daily spend limit allows it.
export async function socialAutoTick(env) {
  const rows = await all(env, "SELECT k, v FROM settings WHERE k LIKE 'social_auto:%'");
  const t = now();
  for (const r of rows) {
    const s = cleanSettings(parse(r.v, {}));
    if (!s.enabled || !s.autoTopUp) continue;
    const id = r.k.slice('social_auto:'.length);
    const last = Number((await first(env, 'SELECT v FROM settings WHERE k = ?', `social_auto_last:${id}`))?.v) || 0;
    if (t - last < DAY) continue;
    const c = await first(env, "SELECT * FROM clients WHERE id = ? AND status = 'active' AND COALESCE(sample, 0) = 0", id);
    if (!c) continue;
    const st = await status(env, id);
    if (st.lastAt && st.lastAt - t > (s.weeks - 1) * 7 * DAY) continue; // still stacked at least a week short of the goal
    const out = await stack(env, c, { commit: true, useAi: (await bgOk(env).catch(() => ({ ok: false }))).ok });
    if (out.items.length) {
      await notify(env, { to: { client: c.id }, kind: 'task', title: `${c.name}: ${out.items.length} social posts are ready to verify`, body: 'Autopilot stacked the calendar. Check each one, then post it by hand.', url: `/#/client/${c.id}/social`, slack: false }).catch(() => {});
    }
    return; // one client a run
  }
}

