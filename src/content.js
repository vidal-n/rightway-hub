// Content engine (Phase 6): page ideas from the client's services, cities and weak rankings, a brief per page,
// a first draft from Claude (template outline without a key), the team's edit, client approval in the app,
// then publishing to WordPress or handing off the HTML. Publishing checks off the month's page or content task.
import { HttpError, json } from './util.js';
import { all, first, run, newId, now } from './db.js';
import { requireStaff, requireClientAccess } from './auth.js';
import { route } from './router.js';
import { monthKey } from './plans.js';
import { canEmail, sendEmail } from './email.js';
import { cleanHtml, slugify, wordCount } from '../public/js/sanitize.js';
import { leaderboard } from '../public/js/analysis.js';
import { notify } from './notify.js';

const API = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const CLIENT_SEES = ['review', 'changes', 'approved', 'published'];
const KINDS = { service: 'Service page', city: 'City page', article: 'Article' };

const list = (s) => String(s || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const cap = (s) => String(s || '').replace(/^\w/, (c) => c.toUpperCase());
const lower = (s) => String(s || '').toLowerCase();
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const cityFromAddress = (a) => (String(a || '').split(',').slice(-2, -1)[0] || '').trim();
export const homeCity = (c) => list(c.cities)[0] || cityFromAddress(c.address) || '';

// ---------- ideas ----------
export function suggestTopics(client, existing = [], scanInfo = new Map()) {
  const services = list(client.services);
  const cities = list(client.cities);
  const home = homeCity(client);
  const main = services[0] || client.category || '';
  const others = cities.filter((c) => lower(c) !== lower(home));
  const have = new Set(existing.map((e) => norm(e.keyword)));
  const out = [];
  const add = (t) => {
    const k = norm(t.keyword);
    if (!k || have.has(k)) return;
    have.add(k);
    out.push({ ...t, keyword: lower(t.keyword).replace(/\s+/g, ' ').trim() });
  };
  for (const s of services.slice(0, 8)) add({ kind: 'service', service: s, city: home, keyword: `${s} ${home}`, title: home ? `${cap(s)} in ${home}` : cap(s) });
  if (main) for (const c of others.slice(0, 10)) add({ kind: 'city', service: main, city: c, keyword: `${main} ${c}`, title: `${cap(main)} in ${c}` });
  for (const s of services.slice(1, 3)) for (const c of others.slice(0, 4)) add({ kind: 'city', service: s, city: c, keyword: `${s} ${c}`, title: `${cap(s)} in ${c}` });
  for (const s of services.slice(0, 3)) {
    add({ kind: 'article', service: s, city: home, keyword: `${s} cost ${home}`, title: `How much does ${lower(s)} cost${home ? ` in ${home}` : ''}?` });
    add({ kind: 'article', service: s, city: home, keyword: `signs you need ${s}`, title: `Signs you need ${lower(s)}` });
  }
  if (client.category && home) add({ kind: 'article', service: main, city: home, keyword: `how to choose a ${client.category} ${home}`, title: `How to choose a ${lower(client.category)} in ${home}` });

  for (const t of out) {
    const words = norm(t.keyword).split(' ');
    let weak = null;
    for (const [k, s] of scanInfo) {
      const kw = k.split(' ').filter((w) => w.length > 3);
      if (kw.length && kw.every((w) => words.some((x) => x.startsWith(w.slice(0, 5))))) if (!weak || s.top10Pct < weak.top10Pct) weak = s;
    }
    t.score = ({ service: 3, city: 2, article: 1 })[t.kind] + (weak ? (100 - weak.top10Pct) / 25 : 0);
    t.reason = weak ? `First page (top 10) in only ${weak.top10Pct}% of the area for "${weak.keyword}"`
      : t.kind === 'city' ? `No page for ${t.city} yet` : t.kind === 'service' ? 'No page for this service yet' : 'Answers a question people search before they call';
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 12);
}

// ---------- brief ----------
export function buildBrief(client, topic, { competitors = [], links = [] } = {}) {
  const intake = parse(client.intake) || {};
  const s = topic.service || list(client.services)[0] || client.category || 'our service';
  const city = topic.city || homeCity(client);
  const name = client.name;
  const kind = KINDS[topic.kind] ? topic.kind : 'service';
  const near = list(client.cities).filter((c) => lower(c) !== lower(city)).slice(0, 5);
  const isCost = /cost|price/i.test(topic.keyword || topic.title || '');
  const isSigns = /^signs/i.test(topic.title || '');
  const outline = kind === 'service' ? [
    `When you need ${lower(s)}${city ? ` in ${city}` : ''}`, `What our ${lower(s)} service includes`, 'Signs it is time to call', 'How the job works, step by step',
    `Why ${city ? `${city} ` : ''}customers choose ${name}`, near.length ? `Areas we serve near ${city}` : null, 'Questions we get a lot',
  ] : kind === 'city' ? [
    `Serving ${city}`, `What ${city} customers usually call us for`, `Our services in ${city}`, `Why choose ${name}`, `How to book in ${city}`, 'Questions we get a lot',
  ] : isCost ? [
    'The short answer', 'What changes the price', 'What you get for the money', 'Ways to keep the cost down', 'When to repair and when to replace', `Get a clear quote from ${name}`,
  ] : isSigns ? [
    'Why catching it early matters', 'The signs to watch for', 'What to do right away', 'When to call a pro', `How ${name} can help`,
  ] : ['The short answer', 'What to look for', 'Common mistakes', 'When to call a pro', `How ${name} can help`];
  const faqs = kind === 'article' ? [] : [
    `How long does ${lower(s)} take?`, near[0] ? `Do you work in ${near[0]}?` : `What areas do you serve?`, 'How do I get a quote?', `What should I do before you arrive?`,
  ];
  const title = topic.title || (city ? `${cap(s)} in ${city}` : cap(s));
  const metaTitle = `${title.replace(/\?$/, '')} | ${name}`.slice(0, 60);
  return {
    kind, keyword: lower(topic.keyword || `${s} ${city}`).trim(), service: s, city, title, slug: slugify(title.replace(/\?$/, '')),
    metaTitle, metaDescription: `${title.replace(/\?$/, '')}. ${name}${city ? ` serves ${city}${near[0] ? ` and nearby areas` : ''}` : ''}. Call for a clear quote.`.slice(0, 155),
    words: kind === 'article' ? 1000 : kind === 'service' ? 800 : 700,
    outline: outline.filter(Boolean), faqs,
    mustInclude: [
      'The phone number near the top and in the closing call to action',
      city ? `Mention ${city} naturally, a few times, not in every sentence` : 'Mention the service area naturally',
      'A link to the contact page and to related service pages',
      'Only real facts about the business. Leave out anything not confirmed.',
    ],
    facts: {
      phone: client.phone || intake.phone || '', address: client.address || intake.address || '', hours: intake.hours || '', area: intake.service_area || list(client.cities).join(', '),
      about: intake.description || '', different: intake.differentiators || '', voice: client.brand_voice || '',
    },
    competitors: competitors.slice(0, 3), links: links.slice(0, 6),
  };
}

// ---------- draft ----------
export function draftPrompt(client, brief) {
  const f = brief.facts;
  return `You write pages for a local business website. Write the page in the brief.

BUSINESS FACTS (use only these about the business; never invent anything else)
Name: ${client.name}
Category: ${client.category || 'not given'}
Phone: ${f.phone || 'not given'}
Address: ${f.address || 'not given'}
Hours: ${f.hours || 'not given'}
Service area: ${f.area || 'not given'}
Services: ${list(client.services).join(', ') || 'not given'}
About them, in their words: ${f.about || 'not given'}
What makes them different, in their words: ${f.different || 'not given'}
Brand voice: ${f.voice || 'friendly, local, plain spoken'}

BRIEF
Page type: ${KINDS[brief.kind]}
Main search to rank for: ${brief.keyword}
Title (this is the H1, do not repeat it in the body): ${brief.title}
Length: about ${brief.words} words
Sections (H2 headings, reword them if it reads better):
${brief.outline.map((o) => `- ${o}`).join('\n')}
${brief.faqs.length ? `End with an FAQ section answering:\n${brief.faqs.map((q) => `- ${q}`).join('\n')}\n` : ''}Must include:
${brief.mustInclude.map((m) => `- ${m}`).join('\n')}
${brief.links.length ? `Internal links you can use (anchor text, then address):\n${brief.links.map((l) => `- ${l.title}: ${l.url}`).join('\n')}\n` : ''}${brief.competitors.length ? `Competitors ranking for this search (never name them): ${brief.competitors.join(', ')}\n` : ''}
RULES
- Write for people first. Use the main search phrase naturally in the first paragraph and in one heading. No keyword stuffing.
- Never invent years in business, licenses, insurance, awards, warranties, prices, reviews, staff names, or guarantees. If a fact is not given, write around it.
- Never make up neighborhoods, landmarks, or local statistics. Keep local mentions to the city names given.
- Short paragraphs, plain words, concrete details about the work. No em dashes. No hype words like "top-notch" or "unparalleled".
- HTML only with h2, h3, p, ul, li, strong and a tags. No h1, no styles, no classes, no images.

Reply in exactly this format and nothing else:
TITLE: <page title>
META_TITLE: <up to 60 characters>
META_DESCRIPTION: <up to 155 characters>
SLUG: <url slug>
HTML:
<the page body>`;
}

export function parseDraft(text) {
  const t = String(text || '');
  const line = (k) => (t.match(new RegExp(`^${k}:\\s*(.+)$`, 'mi'))?.[1] || '').trim();
  const html = t.split(/^HTML:\s*$/mi)[1] ?? t.split(/HTML:/i)[1] ?? '';
  const body = cleanHtml(html.replace(/^```(?:html)?|```$/gim, ''));
  if (!body || wordCount(body) < 60) throw new Error('The draft came back empty or too short.');
  return { title: line('TITLE').replace(/[–—]/g, ', '), meta_title: line('META_TITLE').slice(0, 70), meta_description: line('META_DESCRIPTION').slice(0, 170), slug: slugify(line('SLUG')), html: body };
}

export function templateDraft(client, brief) {
  const f = brief.facts;
  const sec = (h) => `<h2>${esc(h)}</h2>\n<p>[Write 2 to 4 short paragraphs here. Use real details from ${esc(client.name)}.]</p>`;
  const body = [
    `<p>Looking for ${esc(brief.keyword)}? ${esc(client.name)} ${f.phone ? `is one call away at ${esc(f.phone)}` : 'is ready to help'}. [Add one sentence on what makes them different.]</p>`,
    ...brief.outline.map(sec),
    brief.faqs.length ? `<h2>Questions we get a lot</h2>\n${brief.faqs.map((q) => `<h3>${esc(q)}</h3>\n<p>[Answer in 2 or 3 sentences.]</p>`).join('\n')}` : '',
    `<p><strong>Ready to get started?</strong> Call ${esc(client.name)}${f.phone ? ` at <a href="tel:${esc(f.phone.replace(/[^\d+]/g, ''))}">${esc(f.phone)}</a>` : ''} for a clear quote.</p>`,
  ].filter(Boolean).join('\n');
  return { title: brief.title, meta_title: brief.metaTitle, meta_description: brief.metaDescription, slug: brief.slug, html: cleanHtml(body), ai: false };
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function writeDraft(env, client, brief, fetchImpl = fetch) {
  if (!env.ANTHROPIC_API_KEY) return templateDraft(client, brief);
  const res = await fetchImpl(API, {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.ANTHROPIC_CONTENT_MODEL || env.ANTHROPIC_MODEL || DEFAULT_MODEL, max_tokens: 4096, messages: [{ role: 'user', content: draftPrompt(client, brief) }] }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(`Claude could not write the draft: ${data?.error?.message || `HTTP ${res.status}`}`, 502);
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return { ...parseDraft(text), ai: true };
}

// ---------- WordPress ----------
const enc = new TextEncoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function wpKey(env) {
  if (!env.ACCESS_KEY) throw new HttpError('ACCESS_KEY is missing in Cloudflare.', 503);
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode(`rw-wp:${env.ACCESS_KEY}`)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return `${b64(iv)}.${b64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await wpKey(env), enc.encode(text))))}`;
}
async function unseal(env, sealed) {
  const [iv, ct] = String(sealed || '').split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await wpKey(env), unb64(ct)));
}
export function wpBase(url) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); } catch { throw new HttpError('That website address is not valid.'); }
  if (u.protocol !== 'https:') throw new HttpError('Use the https address of the site.');
  return `${u.origin}${u.pathname.replace(/\/wp-admin.*$/, '').replace(/\/+$/, '')}`;
}
async function wpCall(env, c, method, path, body, fetchImpl = fetch, creds = null) {
  const cr = creds || { url: c.wp_url, user: c.wp_user, pass: c.wp_pass ? await unseal(env, c.wp_pass).catch(() => null) : null };
  if (!cr.url || !cr.user || !cr.pass) throw new HttpError('Connect this client\'s WordPress site first.');
  const res = await fetchImpl(`${cr.url}/wp-json/wp/v2${path}`, {
    method,
    headers: { Authorization: `Basic ${btoa(`${cr.user}:${cr.pass.replace(/\s+/g, '')}`)}`, 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'RightwayHub/1.0' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.message || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new HttpError(`WordPress refused the login (${msg}). Check the username and the application password.`, 400);
    if (res.status === 404) throw new HttpError('This site does not answer like WordPress. Check the address, or the WordPress API is turned off on this site.', 400);
    throw new HttpError(`WordPress: ${msg}`, 502);
  }
  return data;
}

// ---------- helpers ----------
async function clientOr404(env, id) {
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', id);
  if (!c) throw new HttpError('Client not found.', 404);
  return c;
}
async function itemOr404(env, id) {
  const it = await first(env, 'SELECT * FROM content WHERE id = ?', id);
  if (!it) throw new HttpError('Page not found.', 404);
  return it;
}
const log = (env, clientId, text, by, link = null) => run(env, 'INSERT INTO log (id, client_id, text, link, at, by) VALUES (?, ?, ?, ?, ?, ?)', newId('l_'), clientId, text, link, now(), by || null);
const out = (it, staff = true) => ({
  id: it.id, client_id: it.client_id, kind: it.kind, kindLabel: KINDS[it.kind] || 'Page', title: it.title, keyword: it.keyword, service: it.service, city: it.city,
  status: it.status, html: it.html || '', meta_title: it.meta_title || '', meta_description: it.meta_description || '', slug: it.slug || '',
  brief: staff ? parse(it.brief) : undefined, client_note: it.client_note || '', words: wordCount(it.html), ai: Boolean(it.ai),
  wp_id: it.wp_id || null, wp_status: it.wp_status || null, live_url: it.live_url || null, published_at: it.published_at || null,
  updated_at: it.updated_at, created_at: it.created_at,
});

async function scanInfo(env, clientId) {
  const rows = await all(env, 'SELECT id, keyword, summary, created_at FROM scans WHERE client_id = ? ORDER BY created_at DESC LIMIT 60', clientId);
  const m = new Map();
  for (const r of rows) { const k = norm(r.keyword); if (!m.has(k)) { const sm = parse(r.summary) || {}; m.set(k, { id: r.id, keyword: r.keyword, top10Pct: sm.top10Pct ?? 0, top3Pct: sm.top3Pct ?? 0 }); } }
  return m;
}
async function competitorsFor(env, info, keyword) {
  const words = norm(keyword).split(' ');
  const hit = [...info.values()].find((s) => norm(s.keyword).split(' ').filter((w) => w.length > 3).every((w) => words.some((x) => x.startsWith(w.slice(0, 5)))));
  if (!hit) return [];
  const row = await first(env, 'SELECT data FROM scans WHERE id = ?', hit.id);
  const d = parse(row?.data);
  if (!d?.points || !d.target) return [];
  return leaderboard(d.points, d.target, 3).rows.map((r) => r.title).filter(Boolean);
}

async function completeTask(env, it, by) {
  const month = monthKey();
  const task = await first(env, "SELECT id FROM tasks WHERE client_id = ? AND month = ? AND kind IN ('page','content') AND status != 'done' ORDER BY sort, created_at LIMIT 1", it.client_id, month);
  if (!task) return null;
  await run(env, "UPDATE tasks SET status = 'done', done_at = ?, done_by = ?, link = COALESCE(?, link), note = COALESCE(note, ?) WHERE id = ?", now(), by, it.live_url, it.title, task.id);
  await run(env, 'UPDATE content SET task_id = ? WHERE id = ?', task.id, it.id);
  return task.id;
}

// ---------- routes ----------
route('GET', '/api/clients/:id/content', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  const staff = user.role !== 'client';
  const rows = await all(env, `SELECT * FROM content WHERE client_id = ? ${staff ? '' : `AND status IN (${CLIENT_SEES.map(() => '?').join(',')})`} ORDER BY updated_at DESC LIMIT 100`, params.id, ...(staff ? [] : CLIENT_SEES));
  const c = staff ? await clientOr404(env, params.id) : null;
  const month = monthKey();
  const quota = staff ? await first(env, "SELECT COUNT(*) AS total, SUM(status = 'done') AS done FROM tasks WHERE client_id = ? AND month = ? AND kind IN ('page','content')", params.id, month) : null;
  return json({
    items: rows.map((r) => { const o = out(r, staff); if (!staff) { delete o.html; } return o; }),
    ...(staff ? { wordpress: { url: c.wp_url || '', user: c.wp_user || '', connected: Boolean(c.wp_url && c.wp_pass) }, ai: Boolean(env.ANTHROPIC_API_KEY), email: canEmail(env), quota: { total: quota?.total || 0, done: quota?.done || 0, month } } : {}),
  });
});

route('GET', '/api/clients/:id/content/ideas', async ({ env, user, params }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  const existing = await all(env, 'SELECT keyword FROM content WHERE client_id = ?', c.id);
  const ideas = suggestTopics(c, existing, await scanInfo(env, c.id));
  return json({ ideas, missing: !list(c.services).length ? 'Add services (and cities) on the client Profile so the Hub can suggest pages.' : null });
});

route('POST', '/api/clients/:id/content', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  const b = await body();
  const title = String(b.title || '').trim().slice(0, 140);
  if (!title) throw new HttpError('Give the page a title.');
  const topic = { kind: KINDS[b.kind] ? b.kind : 'service', title, keyword: String(b.keyword || title).slice(0, 120), service: String(b.service || '').slice(0, 80), city: String(b.city || '').slice(0, 80) };
  const info = await scanInfo(env, c.id);
  const links = (await all(env, "SELECT title, live_url FROM content WHERE client_id = ? AND live_url IS NOT NULL ORDER BY published_at DESC LIMIT 6", c.id)).map((r) => ({ title: r.title, url: r.live_url }));
  if (c.website) links.unshift({ title: 'Home page', url: c.website });
  const brief = buildBrief(c, topic, { competitors: await competitorsFor(env, info, topic.keyword), links });
  const id = newId('ct_');
  await run(env, `INSERT INTO content (id, client_id, kind, title, keyword, service, city, brief, status, slug, meta_title, meta_description, month, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'idea', ?, ?, ?, ?, ?, ?, ?)`, id, c.id, brief.kind, brief.title, brief.keyword, brief.service, brief.city, JSON.stringify(brief),
  brief.slug, brief.metaTitle, brief.metaDescription, monthKey(), user.id, now(), now());
  return json({ item: out(await itemOr404(env, id)) });
});

route('GET', '/api/content/:id', async ({ env, user, params }) => {
  const it = await itemOr404(env, params.id);
  requireClientAccess(user, it.client_id);
  const staff = user.role !== 'client';
  if (!staff && !CLIENT_SEES.includes(it.status)) throw new HttpError('Page not found.', 404);
  return json({ item: out(it, staff) });
});

route('POST', '/api/content/:id/draft', async ({ env, user, params }) => {
  requireStaff(user);
  const it = await itemOr404(env, params.id);
  const c = await clientOr404(env, it.client_id);
  const brief = parse(it.brief) || buildBrief(c, it);
  const d = await writeDraft(env, c, brief);
  await run(env, `UPDATE content SET html = ?, title = ?, meta_title = ?, meta_description = ?, slug = ?, ai = ?, status = CASE WHEN status IN ('idea','changes') THEN 'draft' ELSE status END, updated_at = ? WHERE id = ?`,
    d.html, d.title || it.title, d.meta_title || it.meta_title, d.meta_description || it.meta_description, d.slug || it.slug, d.ai ? 1 : 0, now(), it.id);
  return json({ item: out(await itemOr404(env, it.id)), ai: d.ai });
});

route('PUT', '/api/content/:id', async ({ env, user, params, body }) => {
  requireStaff(user);
  const it = await itemOr404(env, params.id);
  const b = await body();
  const html = 'html' in b ? cleanHtml(b.html).slice(0, 200000) : it.html;
  await run(env, `UPDATE content SET title = ?, html = ?, meta_title = ?, meta_description = ?, slug = ?, keyword = ?, live_url = ?,
    status = CASE WHEN status = 'idea' AND ? != '' THEN 'draft' ELSE status END, updated_at = ? WHERE id = ?`,
  String(b.title ?? it.title).slice(0, 140), html, String(b.meta_title ?? it.meta_title ?? '').slice(0, 70), String(b.meta_description ?? it.meta_description ?? '').slice(0, 170),
  slugify(b.slug ?? it.slug), String(b.keyword ?? it.keyword ?? '').slice(0, 120), b.live_url !== undefined ? (String(b.live_url).trim() || null) : it.live_url, html || '', now(), it.id);
  return json({ item: out(await itemOr404(env, it.id)) });
});

route('POST', '/api/content/:id/review', async ({ env, user, params, url }) => {
  requireStaff(user);
  const it = await itemOr404(env, params.id);
  if (wordCount(it.html) < 60) throw new HttpError('Write the page first.');
  if (/\[(Write|Answer|Add) /.test(it.html || '')) throw new HttpError('Fill in the parts in [brackets] first.');
  await run(env, "UPDATE content SET status = 'review', client_note = NULL, updated_at = ? WHERE id = ?", now(), it.id);
  await log(env, it.client_id, `New page ready for your review: ${it.title}`, user.id);
  await notify(env, { to: { clientUsers: it.client_id }, kind: 'update', title: 'A new page is ready for you to check', body: it.title, url: `/#/content/${it.id}`, slack: false }).catch(() => {});
  const c = await clientOr404(env, it.client_id);
  let emailed = false;
  if (c.contact_email && canEmail(env)) {
    try {
      await sendEmail(env, { to: c.contact_email, subject: `A new page is ready for you to check: ${it.title}`,
        text: `Hi${c.contact_name ? ` ${c.contact_name.split(' ')[0]}` : ''},\n\nWe wrote a new page for your website: "${it.title}". Open your Rightway app to read it, then approve it or tell us what to change.\n\n${url.origin}/#/content/${it.id}\n\nRightway Growth` });
      emailed = true;
    } catch (e) { console.error('review email', e); }
  }
  return json({ item: out(await itemOr404(env, it.id)), emailed });
});

route('POST', '/api/content/:id/approve', async ({ env, user, params }) => {
  const it = await itemOr404(env, params.id);
  requireClientAccess(user, it.client_id);
  if (user.role === 'client' && it.status !== 'review') throw new HttpError('This page is not waiting for your review.');
  await run(env, "UPDATE content SET status = 'approved', updated_at = ? WHERE id = ?", now(), it.id);
  await log(env, it.client_id, `Page approved: ${it.title}`, user.id);
  if (user.role === 'client') await notify(env, { to: { client: it.client_id }, kind: 'client', title: 'Page approved by the client', body: it.title, url: `/#/client/${it.client_id}/content` }).catch(() => {});
  return json({ item: out(await itemOr404(env, it.id), user.role !== 'client') });
});

route('POST', '/api/content/:id/changes', async ({ env, user, params, body }) => {
  const it = await itemOr404(env, params.id);
  requireClientAccess(user, it.client_id);
  if (it.status !== 'review') throw new HttpError('This page is not waiting for review.');
  const note = String((await body()).note || '').trim().slice(0, 2000);
  if (!note) throw new HttpError('Tell us what to change.');
  await run(env, "UPDATE content SET status = 'changes', client_note = ?, updated_at = ? WHERE id = ?", note, now(), it.id);
  await log(env, it.client_id, `Changes asked for on: ${it.title}`, user.id);
  if (user.role === 'client') await notify(env, { to: { client: it.client_id }, kind: 'client', title: 'Client asked for changes', body: `${it.title}: ${note.slice(0, 140)}`, url: `/#/client/${it.client_id}/content` }).catch(() => {});
  return json({ item: out(await itemOr404(env, it.id), user.role !== 'client') });
});

// Publish to WordPress (as a draft there, or live), or mark as published by hand with the live address.
route('POST', '/api/content/:id/publish', async ({ env, user, params, body }) => {
  requireStaff(user);
  const it = await itemOr404(env, params.id);
  const c = await clientOr404(env, it.client_id);
  const b = await body();
  if (wordCount(it.html) < 60) throw new HttpError('Write the page first.');
  if (b.manual) {
    const live = String(b.url || '').trim();
    if (live && !/^https?:\/\//i.test(live)) throw new HttpError('The live address should start with https://');
    await run(env, "UPDATE content SET status = 'published', live_url = ?, published_at = ?, updated_at = ? WHERE id = ?", live || null, now(), now(), it.id);
    const fresh = await itemOr404(env, it.id);
    await completeTask(env, fresh, user.id);
    await log(env, it.client_id, `Page published: ${it.title}`, user.id, live || null);
    return json({ item: out(await itemOr404(env, it.id)) });
  }
  const status = b.status === 'publish' ? 'publish' : 'draft';
  const type = it.kind === 'article' ? 'posts' : 'pages';
  const payload = { title: it.title, content: it.html, status, slug: it.slug || slugify(it.title), excerpt: it.meta_description || '' };
  const wp = await wpCall(env, c, 'POST', it.wp_id ? `/${type}/${it.wp_id}` : `/${type}`, payload);
  const live = status === 'publish' ? (wp.link || null) : null;
  await run(env, `UPDATE content SET wp_id = ?, wp_status = ?, live_url = COALESCE(?, live_url), status = CASE WHEN ? = 'publish' THEN 'published' ELSE status END,
    published_at = CASE WHEN ? = 'publish' THEN ? ELSE published_at END, updated_at = ? WHERE id = ?`, String(wp.id), wp.status || status, live, status, status, now(), now(), it.id);
  const fresh = await itemOr404(env, it.id);
  if (status === 'publish') { await completeTask(env, fresh, user.id); await log(env, it.client_id, `Page published: ${it.title}`, user.id, live); }
  return json({ item: out(await itemOr404(env, it.id)), edit: `${c.wp_url}/wp-admin/post.php?post=${wp.id}&action=edit` });
});

route('DELETE', '/api/content/:id', async ({ env, user, params }) => {
  requireStaff(user);
  await run(env, 'DELETE FROM content WHERE id = ?', params.id);
  return json({ ok: true });
});

route('PUT', '/api/clients/:id/wordpress', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  const b = await body();
  if (b.disconnect) { await run(env, 'UPDATE clients SET wp_url = NULL, wp_user = NULL, wp_pass = NULL WHERE id = ?', c.id); return json({ ok: true }); }
  const url = wpBase(b.url);
  const userName = String(b.user || '').trim();
  const pass = String(b.password || '').trim();
  if (!userName || !pass) throw new HttpError('Enter the WordPress username and an application password.');
  const me = await wpCall(env, c, 'GET', '/users/me?context=edit', null, fetch, { url, user: userName, pass });
  const caps = me?.capabilities || {};
  if (caps && Object.keys(caps).length && !caps.publish_pages && !caps.edit_pages) throw new HttpError('That WordPress user cannot publish pages. Use an Editor or Administrator.');
  await run(env, 'UPDATE clients SET wp_url = ?, wp_user = ?, wp_pass = ? WHERE id = ?', url, userName, await seal(env, pass), c.id);
  return json({ ok: true, url, name: me?.name || userName });
});
