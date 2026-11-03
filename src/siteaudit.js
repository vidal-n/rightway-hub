// Site audit (Phase 6): a small crawler that reads a client's website a few pages per cron run (Worker limits), finds on-page and
// technical issues, and keeps a fix log with before and after. The next crawl checks each fix. Also builds LocalBusiness schema
// from the client profile. Crawls run monthly with the scan schedule, or on demand.
import { HttpError, json } from './util.js';
import { all, first, run, newId, now, getSettings, setSetting } from './db.js';
import { requireStaff, requireClientAccess } from './auth.js';
import { route } from './router.js';
import { monthKey } from './plans.js';

export const MAX_PAGES = 40;
export const FETCHES_PER_TICK = 15;
const LOCK_MS = 120e3;
const UA = 'Mozilla/5.0 (compatible; RightwayHub/1.0; +https://rightwaygrowth.com)';
const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|pptx?|mp4|mov|mp3|ics|xml|txt|css|js)(\?|$)/i;
const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const clean = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

export function normUrl(href, base) {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(k)) u.searchParams.delete(k);
    let s = u.toString();
    if (u.pathname !== '/' && s.endsWith('/') && !u.search) s = s.slice(0, -1);
    return s;
  } catch { return null; }
}

// Everything the audit needs from one HTML page. Pure, so tests can feed it HTML.
export function parsePage(html, url, { phone = '' } = {}) {
  const head = html.slice(0, 200000);
  const meta = (name) => (head.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']*)`, 'i')) || head.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i')))?.[1];
  const title = clean(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const description = decode(meta('description') || '').trim();
  const robots = (meta('robots') || '').toLowerCase();
  const canonical = head.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)/i)?.[1] || head.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical/i)?.[1] || '';
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => clean(m[1])).filter(Boolean);
  const body = html.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ');
  const text = clean(body);
  const words = (text.match(/\S+/g) || []).length;
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const noAlt = imgs.filter((t) => !/\balt\s*=/i.test(t)).length;
  const links = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#][^"']*)["']/gi)].map((m) => normUrl(decode(m[1]), url)).filter(Boolean);
  const types = new Set();
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const j = parse(m[1].trim());
    const walk = (o) => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(walk); const t = o['@type']; (Array.isArray(t) ? t : t ? [t] : []).forEach((x) => types.add(String(x))); if (o['@graph']) walk(o['@graph']); };
    walk(j);
  }
  for (const m of html.matchAll(/itemtype=["']https?:\/\/schema\.org\/([A-Za-z]+)/gi)) types.add(m[1]);
  const ph = digits(phone);
  return {
    url, title, titleLen: title.length, description, descLen: description.length, h1: h1s[0] || '', h1Count: h1s.length,
    canonical: canonical ? normUrl(canonical, url) : '', noindex: /noindex/.test(robots), words, images: imgs.length, noAlt,
    links: [...new Set(links)], schema: [...types], tel: /href=["']tel:/i.test(html), viewport: /<meta[^>]+name=["']viewport/i.test(head),
    mixed: url.startsWith('https://') && /<(img|script|iframe|link)[^>]+(src|href)=["']http:\/\//i.test(html),
    phoneOnPage: ph.length === 10 ? digits(text).includes(ph) || html.includes(ph) : null,
  };
}

const LOCAL_TYPES = /LocalBusiness|Contractor|Plumber|Electrician|Roofing|HVAC|Dentist|Restaurant|Store|Service|Attorney|Legal|AutoRepair|Locksmith|Moving|Painter|Physician|Salon|Spa|Clinic|Agent|Agency|Business/i;

// Turn crawl results into a list of issues. Each issue has a stable key so a later crawl can tell if it is gone.
export function findIssues(audit, client = {}) {
  const pages = (audit.pages || []).filter((p) => p.status === 200 && p.html !== false);
  const broken = (audit.pages || []).filter((p) => p.status >= 400 || p.status === 0);
  const home = (audit.pages || []).find((p) => p.home) || pages[0] || null;
  const out = [];
  const add = (key, severity, kind, title, detail, fix, list = []) => out.push({ key, severity, kind, title, detail, fix, pages: list.slice(0, 15), count: list.length });
  const path = (u) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };
  const byTitle = new Map(), byDesc = new Map();
  for (const p of pages) {
    if (p.title) byTitle.set(p.title.toLowerCase(), [...(byTitle.get(p.title.toLowerCase()) || []), p.url]);
    if (p.description) byDesc.set(p.description.toLowerCase(), [...(byDesc.get(p.description.toLowerCase()) || []), p.url]);
  }
  const each = (fn) => pages.filter((p) => !p.noindex && fn(p)).map((p) => p.url);

  if (!audit.https) add('https', 'high', 'technical', 'Site is not on https', 'Browsers mark it "Not secure" and Google prefers secure pages.', 'Turn on SSL with the host (most include it free) and send http to https.');
  else if (audit.httpRedirect === false) add('http-redirect', 'medium', 'technical', 'http does not send visitors to https', 'Someone typing the address without https lands on an insecure copy.', 'Add a redirect from http to https in the host settings.');
  if (broken.length) add('broken', 'high', 'onpage', `${broken.length} broken page${broken.length === 1 ? '' : 's'}`, 'Links on the site lead to pages that do not load.', 'Fix the link or redirect the old address to the right page.', broken.map((p) => p.url));
  let l = each((p) => !p.title);
  if (l.length) add('title-missing', 'high', 'onpage', 'Pages with no title', 'The title is what shows as the blue link on Google.', 'Write a title with the service and city, under 60 characters.', l);
  l = each((p) => p.titleLen > 65);
  if (l.length) add('title-long', 'low', 'onpage', 'Titles too long', 'Google cuts titles past about 60 characters.', 'Shorten to under 60 characters, service and city first.', l);
  const dupT = [...byTitle.values()].filter((v) => v.length > 1).flat();
  if (dupT.length) add('title-dupe', 'medium', 'onpage', 'Pages share the same title', 'Google cannot tell which page to show.', 'Give each page its own title about what that page covers.', dupT);
  l = each((p) => !p.description);
  if (l.length) add('desc-missing', 'medium', 'onpage', 'Pages with no meta description', 'Google writes its own snippet, often a poor one.', 'Write 1 or 2 sentences, under 155 characters, that make people click.', l);
  const dupD = [...byDesc.values()].filter((v) => v.length > 1).flat();
  if (dupD.length) add('desc-dupe', 'low', 'onpage', 'Pages share the same meta description', 'Copies of the same snippet look like the same page.', 'Write a different description for each page.', dupD);
  l = each((p) => p.h1Count === 0);
  if (l.length) add('h1-missing', 'medium', 'onpage', 'Pages with no main heading (H1)', 'The H1 tells people and Google what the page is about.', 'Add one H1 with the main service and city.', l);
  l = each((p) => p.h1Count > 1);
  if (l.length) add('h1-many', 'low', 'onpage', 'Pages with more than one H1', 'Several main headings blur what the page is about.', 'Keep one H1 and change the rest to H2.', l);
  l = each((p) => p.words < 250 && !/contact|privacy|terms|thank|login|cart|gallery/i.test(p.url));
  if (l.length) add('thin', 'medium', 'onpage', 'Thin pages (under 250 words)', 'Short pages rarely rank for anything.', 'Add useful detail: what the service includes, the process, areas served, and FAQs. The Content tab can draft it.', l);
  l = each((p) => p.noAlt > 0);
  if (l.length) add('alt', 'low', 'onpage', 'Images with no alt text', 'Alt text helps Google read photos and helps people on screen readers.', 'Describe each photo in a few words, with the service where it fits.', l);
  l = pages.filter((p) => p.noindex && (audit.linkedFrom?.[p.url] || 0) > 0).map((p) => p.url);
  if (l.length) add('noindex', 'high', 'technical', 'Pages hidden from Google (noindex)', 'These pages are linked on the site but tell Google not to show them.', 'Remove the noindex setting unless the page should stay hidden (in WordPress, check the SEO plugin and Settings, Reading).', l);
  l = each((p) => p.mixed);
  if (l.length) add('mixed', 'medium', 'technical', 'Insecure files on secure pages', 'Images or scripts load over http, which can show a warning.', 'Change those file links to https.', l);
  if (home) {
    if (!home.viewport) add('viewport', 'high', 'technical', 'Home page is not set up for phones', 'Most local searches happen on a phone.', 'Add a mobile viewport tag, or move to a mobile friendly theme.', [home.url]);
    if (!home.tel) add('tel', 'medium', 'onpage', 'No tap-to-call link on the home page', 'Phone visitors want to call with one tap.', 'Make the phone number a tel: link in the header.', [home.url]);
    if (home.phoneOnPage === false) add('nap-phone', 'high', 'onpage', 'Home page phone does not match the Google profile', 'Google trusts a business more when the name, address and phone match everywhere.', `Show ${client.phone || 'the profile phone number'} on the home page, in the header or footer.`, [home.url]);
    if (!home.schema.some((t) => LOCAL_TYPES.test(t))) add('schema', 'medium', 'technical', 'No local business schema on the home page', 'Schema tells Google the business name, address, phone and area in a format it reads directly.', 'Copy the schema from the Schema card below into the site header.', [home.url]);
    const city = (String(client.cities || '').split(',')[0] || '').trim().toLowerCase();
    if (city && home.title && !home.title.toLowerCase().includes(city)) add('home-city', 'medium', 'onpage', 'Home page title does not mention the city', `People search "${(String(client.services || client.category || 'service').split(',')[0] || '').trim().toLowerCase()} ${city}".`, 'Put the main service and city in the home page title.', [home.url]);
  }
  if (!audit.sitemap) add('sitemap', 'low', 'technical', 'No sitemap found', 'A sitemap helps Google find every page.', 'Turn one on (WordPress: Yoast or Rank Math do it) and submit it in Search Console.');
  if (audit.robotsBlocksAll) add('robots', 'high', 'technical', 'robots.txt blocks the whole site', 'Google is told not to crawl anything.', 'Remove "Disallow: /" from robots.txt.');
  const sev = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => sev[a.severity] - sev[b.severity] || b.count - a.count).map((i) => ({ ...i, pages: i.pages.map((u) => ({ url: u, path: path(u) })) }));
}

export function scoreOf(issues) {
  const w = { high: 12, medium: 5, low: 2 };
  return Math.max(0, 100 - issues.reduce((s, i) => s + w[i.severity], 0));
}

// ---------- schema builder ----------
const TYPE_MAP = [
  [/roof/i, 'RoofingContractor'], [/plumb/i, 'Plumber'], [/electric/i, 'Electrician'], [/hvac|air condition|heating|cooling/i, 'HVACBusiness'],
  [/dentist|dental/i, 'Dentist'], [/restaurant|taqueria|pizz|grill|cafe|bistro|diner/i, 'Restaurant'], [/lawyer|attorney|law firm/i, 'LegalService'],
  [/auto repair|mechanic|auto body|collision/i, 'AutoRepair'], [/locksmith/i, 'Locksmith'], [/moving|movers/i, 'MovingCompany'], [/paint/i, 'HousePainter'],
  [/general contractor|remodel|construction|builder/i, 'GeneralContractor'], [/real estate|realtor/i, 'RealEstateAgent'], [/salon|barber|hair/i, 'HairSalon'],
  [/spa|massage/i, 'DaySpa'], [/gym|fitness/i, 'ExerciseGym'], [/insurance/i, 'InsuranceAgency'], [/account|cpa|tax/i, 'AccountingService'],
  [/landscap|lawn|pest|pool|clean|handyman|fence|garage door|window|floor|tile|concrete|pressure wash/i, 'HomeAndConstructionBusiness'],
];
export function schemaType(category) { return TYPE_MAP.find(([re]) => re.test(category || ''))?.[1] || 'LocalBusiness'; }

export function buildSchema(c) {
  const parts = String(c.address || '').split(',').map((s) => s.trim()).filter(Boolean);
  const stZip = (parts[parts.length - 1] || '').match(/^([A-Z]{2})\s*(\d{5})?/);
  const address = parts.length >= 3 ? {
    '@type': 'PostalAddress', streetAddress: parts.slice(0, parts.length - 2).join(', '), addressLocality: parts[parts.length - 2],
    ...(stZip ? { addressRegion: stZip[1], ...(stZip[2] ? { postalCode: stZip[2] } : {}) } : {}), addressCountry: 'US',
  } : null;
  const services = String(c.services || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 12);
  const cities = String(c.cities || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 15);
  const sameAs = [c.cid && !/^demo|^sample/.test(c.cid) ? `https://maps.google.com/?cid=${c.cid}` : null].filter(Boolean);
  const site = c.website ? (/^https?:/i.test(c.website) ? c.website : `https://${c.website}`) : null;
  const data = {
    '@context': 'https://schema.org', '@type': schemaType(c.category), name: c.name,
    ...(site ? { '@id': `${site.replace(/\/$/, '')}/#business`, url: site } : {}),
    ...(c.phone ? { telephone: c.phone } : {}),
    ...(address ? { address } : {}),
    ...(c.lat != null && c.lng != null ? { geo: { '@type': 'GeoCoordinates', latitude: Number(c.lat), longitude: Number(c.lng) } } : {}),
    ...(cities.length ? { areaServed: cities.map((n) => ({ '@type': 'City', name: n })) } : {}),
    ...(services.length ? { hasOfferCatalog: { '@type': 'OfferCatalog', name: 'Services', itemListElement: services.map((s) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s } })) } } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
  const missing = [!c.phone && 'phone', !address && 'full address (street, city, state ZIP)', !site && 'website', c.lat == null && 'map location'].filter(Boolean);
  return { json: data, html: `<script type="application/ld+json">\n${JSON.stringify(data, null, 2)}\n</script>`, missing };
}

// ---------- crawler ----------
async function get(url, fetchImpl = fetch, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const started = Date.now();
  try {
    const res = await fetchImpl(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'text/html,application/xml;q=0.9,*/*;q=0.5' } });
    const type = res.headers.get('content-type') || '';
    const body = /html|xml|text\/plain/i.test(type) || !type ? (await res.text()).slice(0, 1_500_000) : '';
    return { status: res.status, url: res.url || url, type, body, ms: Date.now() - started };
  } catch (e) {
    return { status: 0, url, type: '', body: '', error: e.name === 'AbortError' ? 'timed out' : 'did not respond', ms: Date.now() - started };
  } finally { clearTimeout(t); }
}

function startUrl(c) {
  if (!c.website) return null;
  try { const u = new URL(/^https?:\/\//i.test(c.website) ? c.website : `https://${c.website}`); return `${u.origin}/`; } catch { return null; }
}

async function firstStep(data, client, fetchImpl) {
  const origin = new URL(data.start).origin;
  const [home, robots, httpHome] = await Promise.all([
    get(data.start, fetchImpl), get(`${origin}/robots.txt`, fetchImpl, 6000), get(data.start.replace(/^https:/, 'http:'), fetchImpl, 6000),
  ]);
  let used = 3;
  data.https = home.status > 0 && home.url.startsWith('https://');
  data.httpRedirect = httpHome.status > 0 ? httpHome.url.startsWith('https://') : null;
  data.host = hostOf(home.url || data.start);
  const robotsTxt = robots.status === 200 ? robots.body : '';
  data.robotsBlocksAll = /User-agent:\s*\*[\s\S]*?^Disallow:\s*\/\s*$/im.test(robotsTxt) && !/^Allow:\s*\/\s*$/im.test(robotsTxt);
  const maps = [...robotsTxt.matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  const smUrl = maps[0] || `${origin}/sitemap.xml`;
  let sm = await get(smUrl, fetchImpl, 8000); used++;
  if (sm.status === 200 && /<sitemapindex/i.test(sm.body)) {
    const child = [...sm.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]).find((u) => /page|post|sitemap/i.test(u));
    if (child) { sm = await get(child, fetchImpl, 8000); used++; }
  }
  data.sitemap = sm.status === 200 && /<urlset|<loc>/i.test(sm.body);
  const fromMap = data.sitemap ? [...sm.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => normUrl(decode(m[1]), data.start)).filter(Boolean) : [];
  data.queue = [];
  data.seen = {};
  data.linkedFrom = {};
  data.pages = [];
  record(data, home, client, true);
  for (const u of fromMap) enqueue(data, u);
  return used;
}

function enqueue(data, u) {
  if (!u || data.seen[u] || SKIP_EXT.test(u) || hostOf(u) !== data.host) return;
  if (Object.keys(data.seen).length >= MAX_PAGES) return;
  data.seen[u] = 1;
  data.queue.push(u);
}

function record(data, res, client, isHome = false) {
  const final = normUrl(res.url, res.url) || res.url;
  const page = { url: final, asked: res.url, status: res.status, ms: res.ms, home: isHome || undefined };
  if (res.status === 200 && /html/i.test(res.type || 'text/html')) {
    const p = parsePage(res.body, final, { phone: client.phone });
    for (const l of p.links) if (hostOf(l) === data.host) { data.linkedFrom[l] = (data.linkedFrom[l] || 0) + 1; enqueue(data, l); }
    delete p.links;
    Object.assign(page, p);
  } else if (res.status === 200) page.html = false;
  else page.error = res.error || null;
  data.seen[final] = 1;
  data.pages.push(page);
}

export async function auditTick(env, { budget = FETCHES_PER_TICK, fetchImpl = fetch, at = now() } = {}) {
  let used = 0;
  while (used < budget) {
    const job = await first(env, "SELECT * FROM site_audits WHERE status IN ('queued','running') AND (locked_until IS NULL OR locked_until < ?) ORDER BY created_at LIMIT 1", at);
    if (!job) break;
    const claim = await run(env, "UPDATE site_audits SET locked_until = ?, status = 'running' WHERE id = ? AND (locked_until IS NULL OR locked_until < ?)", at + LOCK_MS, job.id, at);
    if ((claim?.meta?.changes ?? 1) === 0) break;
    const client = await first(env, 'SELECT * FROM clients WHERE id = ?', job.client_id);
    try {
      let data = parse(job.data);
      if (!data) {
        data = { start: job.start_url };
        used += await firstStep(data, client || {}, fetchImpl);
        if (!data.pages[0] || data.pages[0].status === 0 || data.pages[0].status >= 400) {
          const p = data.pages[0] || {};
          await run(env, "UPDATE site_audits SET status = 'failed', error = ?, finished_at = ?, locked_until = NULL, data = NULL WHERE id = ?",
            p.status ? `The home page returned an error (HTTP ${p.status}).` : 'The website did not respond.', at, job.id);
          continue;
        }
      }
      const batch = data.queue.splice(0, Math.max(0, budget - used));
      const results = await Promise.all(batch.map((u) => get(u, fetchImpl)));
      results.forEach((r) => record(data, r, client || {}));
      used += batch.length;
      if (data.queue.length) {
        await run(env, 'UPDATE site_audits SET data = ?, pages = ?, locked_until = NULL WHERE id = ?', JSON.stringify(data), data.pages.length, job.id);
        continue;
      }
      await finishAudit(env, job, client || {}, data, at);
    } catch (e) {
      await run(env, "UPDATE site_audits SET status = 'failed', error = ?, finished_at = ?, locked_until = NULL, data = NULL WHERE id = ?", String(e.message || e).slice(0, 300), at, job.id);
    }
  }
  return used;
}

async function finishAudit(env, job, client, data, at) {
  const issues = findIssues(data, client);
  const pages = data.pages.map(({ url, status, title, titleLen, description, descLen, h1, h1Count, words, noAlt, noindex, schema, home, ms }) =>
    ({ url, status, title, titleLen, description, descLen, h1, h1Count, words, noAlt, noindex, schema, home, ms }));
  const result = { at, start: data.start, https: data.https, sitemap: data.sitemap, pages, issues, score: scoreOf(issues) };
  await run(env, "UPDATE site_audits SET status = 'done', result = ?, data = NULL, pages = ?, score = ?, issues = ?, finished_at = ?, locked_until = NULL WHERE id = ?",
    JSON.stringify(result), pages.length, result.score, issues.length, at, job.id);
  // Check the fix log: a fixed issue whose key is gone (for that page) is verified.
  const keys = new Set(issues.flatMap((i) => [i.key, ...i.pages.map((p) => `${i.key}|${p.url}`)]));
  const fixes = await all(env, "SELECT * FROM site_fixes WHERE client_id = ? AND status = 'fixed'", job.client_id);
  for (const f of fixes) {
    const still = f.page_url ? keys.has(`${f.issue_key}|${f.page_url}`) : keys.has(f.issue_key);
    await run(env, 'UPDATE site_fixes SET status = ?, checked_at = ? WHERE id = ?', still ? 'fixed' : 'verified', at, f.id);
  }
  await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', newId('l_'), job.client_id,
    `Website check: ${pages.length} pages read, health score ${result.score}`, at, job.by && job.by !== 'auto' ? job.by : null);
}

export async function queueAudit(env, client, by = null) {
  const start = startUrl(client);
  if (!start) throw new HttpError('Add the website on the client profile first.');
  const busy = await first(env, "SELECT id FROM site_audits WHERE client_id = ? AND status IN ('queued','running')", client.id);
  if (busy) return busy.id;
  const id = newId('sa_');
  await run(env, "INSERT INTO site_audits (id, client_id, start_url, status, by, created_at) VALUES (?, ?, ?, 'queued', ?, ?)", id, client.id, start, by, now());
  return id;
}

// Monthly: with the scan schedule on, crawl each active client with a website once per scan period.
export async function enqueueDueAudits(env, at = now()) {
  const s = await getSettings(env).catch(() => ({}));
  const cfg = parse(s.autoscan) || {};
  if (!cfg.enabled || cfg.crawl === false) return 0;
  if (at - Number(s.audit_checked || 0) < 30 * 60e3) return 0;
  await setSetting(env, 'audit_checked', String(at));
  const every = (Number(cfg.everyDays) || 30) * 86400e3;
  const clients = await all(env, "SELECT * FROM clients WHERE status = 'active' AND sample = 0 AND website IS NOT NULL AND website != ''");
  let made = 0;
  for (const c of clients) {
    const last = await first(env, "SELECT MAX(created_at) AS at FROM site_audits WHERE client_id = ? AND status != 'failed'", c.id);
    if (last?.at && at - last.at < every) continue;
    await queueAudit(env, c, 'auto').then(() => made++).catch(() => {});
  }
  return made;
}

// ---------- routes ----------
async function clientOr404(env, id) {
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', id);
  if (!c) throw new HttpError('Client not found.', 404);
  return c;
}

route('GET', '/api/clients/:id/site', async ({ env, user, params }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  const [last, running, fixes] = await Promise.all([
    first(env, "SELECT * FROM site_audits WHERE client_id = ? AND status = 'done' ORDER BY finished_at DESC LIMIT 1", c.id),
    first(env, "SELECT id, status, pages, created_at, error FROM site_audits WHERE client_id = ? AND (status IN ('queued','running') OR (status = 'failed' AND finished_at > ?)) ORDER BY created_at DESC LIMIT 1", c.id, now() - 86400e3),
    all(env, 'SELECT * FROM site_fixes WHERE client_id = ? ORDER BY created_at DESC LIMIT 100', c.id),
  ]);
  const prev = last ? await first(env, "SELECT score, finished_at FROM site_audits WHERE client_id = ? AND status = 'done' AND finished_at < ? ORDER BY finished_at DESC LIMIT 1", c.id, last.finished_at) : null;
  return json({
    website: c.website || '', audit: last ? parse(last.result) : null, previous: prev ? { score: prev.score, at: prev.finished_at } : null,
    running: running ? { id: running.id, status: running.status, pages: running.pages || 0, error: running.error || null, max: MAX_PAGES } : null,
    fixes: fixes.map((f) => ({ id: f.id, key: f.issue_key, page: f.page_url, what: f.what, before: f.before_text, after: f.after_text, status: f.status, at: f.created_at, checked_at: f.checked_at })),
    schema: buildSchema(c),
  });
});

route('POST', '/api/clients/:id/site/audit', async ({ env, user, params }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  return json({ id: await queueAudit(env, c, user.id) });
});

// The page asks the server to keep crawling while it is open, in case the cron is slow.
route('POST', '/api/site/tick', async ({ env, user }) => {
  requireStaff(user);
  const used = await auditTick(env);
  return json({ used });
});

route('POST', '/api/clients/:id/site/fixes', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  const b = await body();
  const what = String(b.what || '').trim().slice(0, 200);
  if (!what) throw new HttpError('Say what was fixed.');
  const id = newId('fx_');
  const kind = b.kind === 'technical' ? 'technical' : 'onpage';
  await run(env, `INSERT INTO site_fixes (id, client_id, issue_key, page_url, what, before_text, after_text, kind, status, by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'fixed', ?, ?)`, id, c.id, String(b.key || '').slice(0, 120) || null, String(b.page || '').slice(0, 500) || null, what,
  String(b.before || '').slice(0, 2000), String(b.after || '').slice(0, 2000), kind, user.id, now());
  // Count it against this month's on-page (or technical) task.
  const task = await first(env, "SELECT id FROM tasks WHERE client_id = ? AND month = ? AND kind IN (?, 'onpage') AND status != 'done' ORDER BY kind = ? DESC, sort LIMIT 1", c.id, monthKey(), kind, kind);
  if (task) await run(env, "UPDATE tasks SET status = 'done', done_at = ?, done_by = ?, note = COALESCE(note, ?) WHERE id = ?", now(), user.id, what, task.id);
  await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', newId('l_'), c.id, `Website fix: ${what}`, now(), user.id);
  return json({ id, task: task?.id || null });
});

route('DELETE', '/api/site/fixes/:id', async ({ env, user, params }) => {
  requireStaff(user);
  await run(env, 'DELETE FROM site_fixes WHERE id = ?', params.id);
  return json({ ok: true });
});

// Short summary (score, pages, fixes) that the client app and reports can show.
route('GET', '/api/clients/:id/site/summary', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  const last = await first(env, "SELECT score, pages, issues, finished_at FROM site_audits WHERE client_id = ? AND status = 'done' ORDER BY finished_at DESC LIMIT 1", params.id);
  const fixes = await first(env, 'SELECT COUNT(*) AS n FROM site_fixes WHERE client_id = ?', params.id);
  return json({ score: last?.score ?? null, pages: last?.pages ?? 0, issues: last?.issues ?? 0, at: last?.finished_at ?? null, fixes: fixes?.n || 0 });
});
