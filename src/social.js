// Social planner (Phase 6b): the team plans posts per client on a calendar, board or table, writes one caption per channel,
// attaches photos and videos, and shares a private review link. The client approves or asks for changes without logging in.
// Posts are published by hand (copy, download, "Mark posted") until Meta approves our app. Nothing here posts anywhere on its own.
import { HttpError, json } from './util.js';
import { all, first, run, newId, token, now } from './db.js';
import { route } from './router.js';
import { requireClientAccess, requireStaff, isStaff } from './auth.js';
import { generateCaptions } from './captions.js';
import { logClaude } from './costs.js';
import { notify } from './notify.js';
import { cleanItem, readyForReview, fillCaptions, clientCanSee, templateIdeas, platformIds, STATUS, PLATFORM, progress } from '../public/js/social.js';
import { clientMeta } from './meta.js';
import { monthKey } from './plans.js';

const MAX_IMG = 10 * 1024 * 1024;
const MAX_VID = 50 * 1024 * 1024;
const MAX_MEDIA = 10;
const MAX_INLINE = 4.5 * 1024 * 1024;
const API = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
export const shape = (r) => r && ({ ...r, channels: parse(r.channels, []), captions: parse(r.captions, {}), media: parse(r.media, []), post_links: parse(r.post_links, {}) });
const text = (v, max) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);

async function loadItem(env, id) {
  const it = shape(await first(env, 'SELECT * FROM social_items WHERE id = ?', id));
  if (!it) throw new HttpError('Post not found.', 404);
  return it;
}
async function loadClient(env, id) {
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', id);
  if (!c) throw new HttpError('Client not found.', 404);
  return c;
}
function base64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }

// ---------- staff: the planner ----------
route('GET', '/api/clients/:id/social', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  const staff = isStaff(user);
  let items = (await all(env, 'SELECT * FROM social_items WHERE client_id = ? ORDER BY COALESCE(scheduled_at, 9e15), created_at DESC LIMIT 1000', params.id)).map(shape);
  if (!staff) items = items.filter((i) => clientCanSee(i));
  const counts = Object.fromEntries((await all(env, 'SELECT item_id, COUNT(*) n FROM social_comments WHERE client_id = ? GROUP BY item_id', params.id)).map((r) => [r.item_id, r.n]));
  items = items.map((i) => ({ ...i, comments: counts[i.id] || 0, notes: staff ? i.notes : undefined }));
  const shares = staff ? await all(env, 'SELECT token, label, project, created_at, last_seen, views FROM social_shares WHERE client_id = ? ORDER BY created_at DESC', params.id) : [];
  return json({ items, shares });
});

route('POST', '/api/clients/:id/social', async ({ env, user, params, body: readBody }) => {
  const body = await readBody();
  requireStaff(user);
  await loadClient(env, params.id);
  let c;
  try { c = cleanItem(body); } catch (e) { throw new HttpError(e.message); }
  if (!c.title && c.status !== 'idea') c.title = 'Untitled post';
  const id = newId('sp_');
  const t = now();
  await run(env, `INSERT INTO social_items (id, client_id, title, project, notes, status, channels, captions, media, scheduled_at, assignee, post_links, ai, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, '{}', 0, ?, ?, ?)`,
  id, params.id, c.title || '', c.project ?? null, c.notes ?? null, c.status || 'draft', JSON.stringify(c.channels || []), JSON.stringify(c.captions || {}), c.scheduled_at ?? null, c.assignee ?? null, user.id, t, t);
  return json({ item: await loadItem(env, id) });
});

route('PATCH', '/api/social/:id', async ({ env, user, params, body: readBody, defer }) => {
  const body = await readBody();
  requireStaff(user);
  const it = await loadItem(env, params.id);
  let c;
  try { c = cleanItem(body); } catch (e) { throw new HttpError(e.message); }
  const merged = { ...it, ...c };
  // Sending to the client needs the basics filled in, so they never review a half written post.
  if (c.status === 'review' && it.status !== 'review') {
    const problems = readyForReview(merged);
    if (problems.length) throw new HttpError(`Not ready for the client yet. ${problems.slice(0, 3).join(' ')}`, 400);
  }
  const sets = []; const args = [];
  const put = (col, v) => { sets.push(`${col} = ?`); args.push(v); };
  for (const k of ['title', 'project', 'notes', 'status', 'scheduled_at', 'assignee']) if (k in c) put(k, c[k] ?? null);
  for (const k of ['channels', 'captions', 'post_links']) if (k in c) put(k, JSON.stringify(c[k]));
  if (c.status === 'posted' && it.status !== 'posted') put('posted_at', now());
  if (it.auto && !it.verified_at && ['review', 'approved', 'scheduled', 'posted'].includes(c.status)) put('verified_at', now()); // a person acted on it
  if (c.status === 'approved' && it.status !== 'approved') { put('approved_at', now()); put('approved_by', user.name || 'Rightway Growth'); }
  if (c.status && c.status !== 'approved' && it.status === 'approved' && c.status !== 'scheduled' && c.status !== 'posted') { put('approved_at', null); put('approved_by', null); }
  if (!sets.length) return json({ item: it });
  put('updated_at', now());
  await run(env, `UPDATE social_items SET ${sets.join(', ')} WHERE id = ?`, ...args, it.id);
  if (c.status === 'posted' && it.status !== 'posted') {
    const links = { ...it.post_links, ...(c.post_links || {}) };
    const where = (merged.channels || []).map((id) => PLATFORM[id]?.label).filter(Boolean).join(', ');
    const link = Object.values(links).find((v) => /^https?:\/\//.test(v || '')) || null;
    await run(env, 'INSERT INTO log (id, client_id, text, link, at, by) VALUES (?, ?, ?, ?, ?, ?)', newId('l_'), it.client_id, `Posted${where ? ` to ${where}` : ''}: ${merged.title || 'a new post'}`, link, now(), user.id).catch(() => {});
    // Clients enrolled in social posts have "Facebook and Instagram post" tasks: a post marked posted checks one off (with its link as proof, or waits for a screenshot).
    const st = await first(env, "SELECT id, note FROM tasks WHERE client_id = ? AND kind = 'social' AND status IN ('todo','doing') AND month <= ? ORDER BY month, sort LIMIT 1", it.client_id, monthKey()).catch(() => null);
    if (st) {
      const note = st.note || `Post: ${String(merged.title || '').slice(0, 80)}`;
      if (link) await run(env, "UPDATE tasks SET status = 'done', done_at = ?, done_by = ?, link = ?, note = ? WHERE id = ?", now(), user.id, link, note, st.id).catch(() => {});
      else await run(env, "UPDATE tasks SET status = 'doing', note = ? WHERE id = ?", note, st.id).catch(() => {});
    }
  }
  if (c.status === 'review' && it.status !== 'review') {
    const cl = await loadClient(env, it.client_id);
    defer?.(notify(env, { to: { clientUsers: cl.id }, kind: 'update', title: 'A post is ready for you to check', body: merged.title, url: '/#/social', slack: false }).catch(() => {}));
  }
  return json({ item: await loadItem(env, it.id) });
});

route('DELETE', '/api/social/:id', async ({ env, user, params }) => {
  requireStaff(user);
  const it = await loadItem(env, params.id);
  for (const m of it.media) await env.MEDIA?.delete(m.key).catch(() => {});
  await run(env, 'DELETE FROM social_comments WHERE item_id = ?', it.id);
  await run(env, 'DELETE FROM social_items WHERE id = ?', it.id);
  return json({ ok: true });
});

// A copy to start from: same channels and captions, no date, back to draft.
route('POST', '/api/social/:id/duplicate', async ({ env, user, params }) => {
  requireStaff(user);
  const it = await loadItem(env, params.id);
  const id = newId('sp_'); const t = now();
  const media = [];
  for (const m of it.media) {
    const obj = await env.MEDIA?.get(m.key);
    if (!obj) continue;
    const key = `social/${it.client_id}/${id}/${newId('m_')}.${(m.key.split('.').pop() || 'bin')}`;
    await env.MEDIA.put(key, new Uint8Array(await obj.arrayBuffer()), { httpMetadata: { contentType: m.type } });
    media.push({ ...m, key });
  }
  await run(env, `INSERT INTO social_items (id, client_id, title, project, notes, status, channels, captions, media, scheduled_at, assignee, post_links, ai, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, NULL, ?, '{}', ?, ?, ?, ?)`,
  id, it.client_id, `${it.title} (copy)`.slice(0, 160), it.project, it.notes, JSON.stringify(it.channels), JSON.stringify(it.captions), JSON.stringify(media), it.assignee, it.ai, user.id, t, t);
  return json({ item: await loadItem(env, id) });
});

// ---------- media ----------
route('POST', '/api/social/:id/media', async ({ env, user, params, request }) => {
  requireStaff(user);
  if (!env.MEDIA) throw new HttpError('File storage is not connected yet. Create the R2 bucket in Cloudflare.', 503);
  const it = await loadItem(env, params.id);
  let form;
  try { form = await request.formData(); } catch { throw new HttpError('Choose at least one file.'); }
  const files = form.getAll('file').filter((f) => f && typeof f === 'object' && f.size);
  if (!files.length) throw new HttpError('Choose at least one file.');
  if (it.media.length + files.length > MAX_MEDIA) throw new HttpError(`A post can carry up to ${MAX_MEDIA} files.`);
  for (const f of files) {
    const type = f.type || '';
    if (!/^(image|video)\//.test(type)) throw new HttpError('Photos and videos only.');
    if (type.startsWith('image/') && f.size > MAX_IMG) throw new HttpError('A photo is too big (10 MB max).');
    if (type.startsWith('video/') && f.size > MAX_VID) throw new HttpError('A video is too big (50 MB max).');
  }
  const media = [...it.media];
  for (const f of files) {
    const type = f.type;
    const ext = (type.split('/')[1] || 'bin').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin';
    const key = `social/${it.client_id}/${it.id}/${newId('m_')}.${ext}`;
    await env.MEDIA.put(key, new Uint8Array(await f.arrayBuffer()), { httpMetadata: { contentType: type } });
    media.push({ key, type, name: text(f.name, 120), size: f.size });
  }
  await run(env, 'UPDATE social_items SET media = ?, updated_at = ? WHERE id = ?', JSON.stringify(media), now(), it.id);
  return json({ item: await loadItem(env, it.id) });
});

route('DELETE', '/api/social/:id/media/:idx', async ({ env, user, params }) => {
  requireStaff(user);
  const it = await loadItem(env, params.id);
  const i = Number(params.idx);
  if (!Number.isInteger(i) || !it.media[i]) throw new HttpError('File not found.', 404);
  const [gone] = it.media.splice(i, 1);
  await env.MEDIA?.delete(gone.key).catch(() => {});
  await run(env, 'UPDATE social_items SET media = ?, updated_at = ? WHERE id = ?', JSON.stringify(it.media), now(), it.id);
  return json({ item: await loadItem(env, it.id) });
});

async function sendMedia(env, m, url, request) {
  const obj = await env.MEDIA?.get(m.key);
  if (!obj) throw new HttpError('File not found.', 404);
  const headers = { 'content-type': m.type || 'application/octet-stream', 'cache-control': 'private, max-age=3600' };
  if (url.searchParams.get('download')) headers['content-disposition'] = `attachment; filename="${(m.name || 'file').replace(/[^\w.\- ]/g, '_')}"`;
  return new Response(obj.body, { headers });
}

route('GET', '/api/social/:id/media/:idx', async ({ env, user, params, url, request }) => {
  const it = await loadItem(env, params.id);
  requireClientAccess(user, it.client_id);
  if (!isStaff(user) && !clientCanSee(it)) throw new HttpError('Post not found.', 404);
  const m = it.media[Number(params.idx)];
  if (!m) throw new HttpError('File not found.', 404);
  return sendMedia(env, m, url, request);
});

// ---------- captions and ideas (Claude when a key is set, templates otherwise) ----------
route('POST', '/api/social/:id/ai', async ({ env, user, params, body: readBody }) => {
  const body = await readBody();
  requireStaff(user);
  const it = await loadItem(env, params.id);
  const c = await loadClient(env, it.client_id);
  const channels = (it.channels.length ? it.channels : ['facebook', 'instagram', 'google']).filter((x) => platformIds.includes(x));
  const first = it.media.find((m) => /^image\/(jpeg|png|webp|gif)$/.test(m.type));
  let image = null;
  if (first && first.size <= MAX_INLINE) {
    const obj = await env.MEDIA?.get(first.key);
    if (obj) image = { base64: base64(new Uint8Array(await obj.arrayBuffer())), mediaType: first.type };
  }
  // Internal notes only go to Claude. The template fallback would paste them into a caption the client reads.
  const note = text(body?.note, 1000) || (env.ANTHROPIC_API_KEY ? [it.title, it.notes].filter(Boolean).join('. ') : it.title);
  const cap = await generateCaptions(env, c, note, image);
  const fresh = fillCaptions(cap, channels);
  const keep = body?.overwrite ? {} : it.captions;
  const captions = { ...fresh };
  for (const [k, v] of Object.entries(keep)) if (v?.text?.trim()) captions[k] = v;
  await run(env, 'UPDATE social_items SET captions = ?, channels = ?, ai = ?, updated_at = ? WHERE id = ?', JSON.stringify(captions), JSON.stringify(it.channels.length ? it.channels : channels), cap.ai ? 1 : 0, now(), it.id);
  return json({ item: await loadItem(env, it.id), ai: Boolean(cap.ai), error: cap.error || null });
});

async function claudeIdeas(env, client, count, month) {
  const list = (s) => String(s || '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
  const prompt = `You plan social media posts for a local business. Suggest ${count} post ideas for ${month || 'the coming month'}.
Business: ${client.name}
Category: ${client.category || 'not given'}
Services: ${list(client.services).join(', ') || 'not given'}
Cities: ${list(client.cities).join(', ') || 'not given'}
Brand voice: ${client.brand_voice || 'friendly, local, confident, no hype'}
Mix before and after jobs, tips, common questions, team, local community, seasonal reminders. Each idea names the photo or video the business should capture.
Never invent facts, awards, offers or reviews. Plain words. No dashes.
Reply with only a JSON array of ${count} objects: {"title": "short title", "notes": "one or two sentences on what to say and what to shoot"}.`;
  const model = env.ANTHROPIC_CONTENT_MODEL || env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const res = await fetch(API, { method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }) });
  const data = await res.json().catch(() => null);
  await logClaude(env, model, data, 'social ideas');
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('No ideas in the reply');
  return JSON.parse(m[0]).slice(0, count).map((i) => ({ title: text(String(i.title).replace(/[–—]/g, ', '), 160), notes: text(String(i.notes).replace(/[–—]/g, ', '), 600) })).filter((i) => i.title);
}

route('POST', '/api/clients/:id/social/ideas', async ({ env, user, params, body: readBody }) => {
  const body = await readBody();
  requireStaff(user);
  const c = await loadClient(env, params.id);
  const count = Math.max(1, Math.min(12, Math.round(Number(body?.count) || 8)));
  const month = text(body?.month, 40);
  let ideas; let error = null; let ai = false;
  if (env.ANTHROPIC_API_KEY) { try { ideas = await claudeIdeas(env, c, count, month); ai = true; } catch (e) { error = String(e.message || e); } }
  if (!ideas?.length) ideas = templateIdeas(c, count);
  const t = now();
  const ids = [];
  for (const i of ideas) {
    const id = newId('sp_');
    await run(env, `INSERT INTO social_items (id, client_id, title, project, notes, status, channels, captions, media, scheduled_at, post_links, ai, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'idea', '[]', '{}', '[]', NULL, '{}', ?, ?, ?, ?)`, id, c.id, i.title, text(body?.project, 80) || null, i.notes, ai ? 1 : 0, user.id, t, t);
    ids.push(id);
  }
  const items = (await all(env, `SELECT * FROM social_items WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)).map(shape);
  return json({ items, ai, error });
});

// ---------- comments ----------
route('GET', '/api/social/:id/comments', async ({ env, user, params }) => {
  const it = await loadItem(env, params.id);
  requireClientAccess(user, it.client_id);
  const comments = await all(env, 'SELECT id, author, kind, body, created_at FROM social_comments WHERE item_id = ? ORDER BY created_at', it.id);
  return json({ comments });
});

route('POST', '/api/social/:id/comments', async ({ env, user, params, body: readBody }) => {
  const body = await readBody();
  requireStaff(user);
  const it = await loadItem(env, params.id);
  const b = text(body?.body, 2000);
  if (!b) throw new HttpError('Write a comment first.');
  await run(env, 'INSERT INTO social_comments (id, item_id, client_id, author, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId('sc_'), it.id, it.client_id, user.name || 'Rightway Growth', 'staff', b, now());
  return json({ comments: await all(env, 'SELECT id, author, kind, body, created_at FROM social_comments WHERE item_id = ? ORDER BY created_at', it.id) });
});

// ---------- the client app: progress, posts to check, connection ----------
// A logged in client sees the same posts the review link shows, plus their numbers and whether Facebook and Instagram are connected.
route('GET', '/api/clients/:id/social/overview', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  const c = await loadClient(env, params.id);
  const items = (await all(env, 'SELECT * FROM social_items WHERE client_id = ? ORDER BY COALESCE(scheduled_at, 9e15), created_at DESC LIMIT 1000', params.id)).map(shape).filter((i) => clientCanSee(i));
  const ids = items.filter((i) => ['review', 'changes'].includes(i.status)).map((i) => i.id);
  const comments = ids.length ? await all(env, `SELECT item_id, author, kind, body, created_at FROM social_comments WHERE item_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at`, ...ids) : [];
  const shaped = items.map((i) => ({
    id: i.id, title: i.title, project: i.project, status: i.status, channels: i.channels, captions: i.captions, scheduled_at: i.scheduled_at, posted_at: i.posted_at, updated_at: i.updated_at,
    approved_by: i.approved_by, post_links: i.post_links, media: i.media.map((m, n) => ({ type: m.type, url: `/api/social/${i.id}/media/${n}` })),
    comments: comments.filter((x) => x.item_id === i.id),
  }));
  return json({ business: c.name, items: shaped, progress: progress(items), meta: await clientMeta(env, params.id), statuses: Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v.label])) });
});

route('POST', '/api/clients/:id/social/items/:itemId/:action', async ({ env, user, params, body: readBody, defer }) => {
  const body = await readBody();
  requireClientAccess(user, params.id);
  const it = await loadItem(env, params.itemId);
  if (it.client_id !== params.id || !clientCanSee(it)) throw new HttpError('That post is not available for review.', 404);
  const act = params.action;
  if (!['comment', 'approve', 'changes'].includes(act)) throw new HttpError('Unknown action.', 404);
  const name = user.name || 'Client';
  const msg = text(body?.body, 2000);
  if ((act === 'comment' || act === 'changes') && !msg) throw new HttpError(act === 'changes' ? 'Tell us what to change.' : 'Write a comment first.');
  if (act !== 'comment' && !['review', 'changes', 'approved'].includes(it.status)) throw new HttpError('This post can not be changed any more. Send us a comment instead.');
  if (msg) await run(env, 'INSERT INTO social_comments (id, item_id, client_id, author, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId('sc_'), it.id, it.client_id, name, 'client', msg, now());
  if (act === 'approve') {
    await run(env, "UPDATE social_items SET status = 'approved', approved_at = ?, approved_by = ?, updated_at = ? WHERE id = ?", now(), name, now(), it.id);
    defer?.(tell(env, { client_id: it.client_id }, it, `approved "${it.title}"`, `By ${name}.${msg ? ` ${msg}` : ''}`));
  } else if (act === 'changes') {
    await run(env, "UPDATE social_items SET status = 'changes', approved_at = NULL, approved_by = NULL, updated_at = ? WHERE id = ?", now(), it.id);
    defer?.(tell(env, { client_id: it.client_id }, it, `asked for changes on "${it.title}"`, msg));
  } else {
    defer?.(tell(env, { client_id: it.client_id }, it, `commented on "${it.title}"`, msg));
  }
  return json({ ok: true, status: act === 'approve' ? 'approved' : act === 'changes' ? 'changes' : it.status });
});

// ---------- review links ----------
route('POST', '/api/clients/:id/social/shares', async ({ env, user, params, body: readBody }) => {
  const body = await readBody();
  requireStaff(user);
  await loadClient(env, params.id);
  const t = token(18);
  await run(env, 'INSERT INTO social_shares (token, client_id, label, project, created_by, created_at, views) VALUES (?, ?, ?, ?, ?, ?, 0)', t, params.id, text(body?.label, 80) || null, text(body?.project, 80) || null, user.id, now());
  return json({ token: t, url: `/social.html#${t}` });
});

route('DELETE', '/api/social/shares/:token', async ({ env, user, params }) => {
  requireStaff(user);
  await run(env, 'DELETE FROM social_shares WHERE token = ?', params.token);
  return json({ ok: true });
});

async function loadShare(env, tok) {
  const s = await first(env, 'SELECT * FROM social_shares WHERE token = ?', tok);
  if (!s) throw new HttpError('This review link is not valid any more.', 404);
  return s;
}
const shareItems = async (env, s) => (await all(env, 'SELECT * FROM social_items WHERE client_id = ? ORDER BY COALESCE(scheduled_at, 9e15), created_at', s.client_id)).map(shape)
  .filter((i) => clientCanSee(i) && (!s.project || i.project === s.project));
async function shareItem(env, s, id) {
  const it = (await shareItems(env, s)).find((i) => i.id === id);
  if (!it) throw new HttpError('That post is not available for review.', 404);
  return it;
}
const publicItem = (tok, it, comments) => ({
  id: it.id, title: it.title, project: it.project, status: it.status, channels: it.channels, captions: it.captions, scheduled_at: it.scheduled_at,
  approved_by: it.approved_by, approved_at: it.approved_at,
  media: it.media.map((m, i) => ({ type: m.type, name: m.name, url: `/api/public/social/${tok}/media/${it.id}/${i}` })),
  comments: comments.filter((c) => c.item_id === it.id).map((c) => ({ author: c.author, kind: c.kind, body: c.body, created_at: c.created_at })),
});

// Anyone with the link can open it, like a shared doc, so the token is long and random. Internal notes never leave.
route('GET', '/api/public/social/:token', async ({ env, params }) => {
  const s = await loadShare(env, params.token);
  const c = await first(env, 'SELECT name FROM clients WHERE id = ?', s.client_id);
  await run(env, 'UPDATE social_shares SET views = views + 1, last_seen = ? WHERE token = ?', now(), s.token);
  const items = await shareItems(env, s);
  const comments = items.length ? await all(env, `SELECT item_id, author, kind, body, created_at FROM social_comments WHERE item_id IN (${items.map(() => '?').join(',')}) ORDER BY created_at`, ...items.map((i) => i.id)) : [];
  return json({ business: c?.name || '', label: s.label || '', items: items.map((i) => publicItem(s.token, i, comments)), statuses: Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v.label])) });
}, { public: true });

route('GET', '/api/public/social/:token/media/:id/:idx', async ({ env, params, url, request }) => {
  const s = await loadShare(env, params.token);
  const it = await shareItem(env, s, params.id);
  const m = it.media[Number(params.idx)];
  if (!m) throw new HttpError('File not found.', 404);
  return sendMedia(env, m, url, request);
}, { public: true });

async function tell(env, s, it, title, body) {
  const c = await first(env, 'SELECT name FROM clients WHERE id = ?', s.client_id);
  await notify(env, { to: { client: s.client_id }, kind: 'client', title: `${c?.name || 'A client'} ${title}`, body: body || it.title, url: `/#/client/${s.client_id}/social` }).catch(() => {});
}

route('POST', '/api/public/social/:token/items/:id/:action', async ({ env, params, body: readBody, defer }) => {
  const body = await readBody();
  const s = await loadShare(env, params.token);
  const it = await shareItem(env, s, params.id);
  const name = text(body?.name, 80);
  const msg = text(body?.body, 2000);
  const act = params.action;
  if (!['comment', 'approve', 'changes'].includes(act)) throw new HttpError('Unknown action.', 404);
  if (!name) throw new HttpError('Add your name so we know who answered.');
  if ((act === 'comment' || act === 'changes') && !msg) throw new HttpError(act === 'changes' ? 'Tell us what to change.' : 'Write a comment first.');
  if (act !== 'comment' && !['review', 'changes', 'approved'].includes(it.status)) throw new HttpError('This post can not be changed any more. Send us a comment instead.');
  if (msg) await run(env, 'INSERT INTO social_comments (id, item_id, client_id, author, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId('sc_'), it.id, it.client_id, name, 'client', msg, now());
  if (act === 'approve') {
    await run(env, "UPDATE social_items SET status = 'approved', approved_at = ?, approved_by = ?, updated_at = ? WHERE id = ?", now(), name, now(), it.id);
    defer?.(tell(env, s, it, `approved "${it.title}"`, `By ${name}.${msg ? ` ${msg}` : ''}`));
  } else if (act === 'changes') {
    await run(env, "UPDATE social_items SET status = 'changes', approved_at = NULL, approved_by = NULL, updated_at = ? WHERE id = ?", now(), it.id);
    defer?.(tell(env, s, it, `asked for changes on "${it.title}"`, msg));
  } else {
    defer?.(tell(env, s, it, `commented on "${it.title}"`, msg));
  }
  const fresh = await shareItem(env, s, it.id);
  const comments = await all(env, 'SELECT item_id, author, kind, body, created_at FROM social_comments WHERE item_id = ? ORDER BY created_at', it.id);
  return json({ item: publicItem(s.token, fresh, comments) });
}, { public: true });
