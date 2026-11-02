// Lead research: finds the Google profile, checks map rankings around the business, reads the website,
// and runs a mobile speed test. Results are saved on the lead and drive the score, script, and presentation.
import { HttpError, json } from './util.js';
import { first, run, now, getSettings } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { searchBusinesses, rankAtPoint, businessDetails } from './dataforseo.js';
import { pageSpeed } from './pagespeed.js';
import { mockSearch, mockRank, mockPageSpeed } from './mock.js';
import { gridPoints } from '../public/js/grid.js';
import { keywordFor, normName, scoreLead, findProblems, recommendPlan } from '../public/js/leadintel.js';

const isDemo = (env) => !env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD;
const digitsOf = (p) => String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');

// Pick the search result that is really this lead.
export function matchListing(results, lead) {
  if (!results?.length) return null;
  const ph = digitsOf(lead.phone);
  if (ph.length >= 10) {
    const byPhone = results.find((r) => digitsOf(r.phone) === ph);
    if (byPhone) return byPhone;
  }
  const want = normName(lead.business);
  if (!want) return null;
  const wantTokens = new Set(want.split(' '));
  let best = null, bestScore = 0;
  for (const r of results) {
    const got = normName(r.title);
    if (got === want) return r;
    const toks = got.split(' ');
    const overlap = toks.filter((t) => wantTokens.has(t)).length / Math.max(wantTokens.size, toks.length);
    if (overlap > bestScore) { bestScore = overlap; best = r; }
  }
  return bestScore >= 0.5 ? best : null;
}

const SCHEMA_TYPES = /"@type"\s*:\s*\[?\s*"(LocalBusiness|HomeAndConstructionBusiness|ProfessionalService|Plumber|Electrician|RoofingContractor|HVACBusiness|GeneralContractor|HousePainter|Locksmith|MovingCompany|AutoRepair|AutomotiveBusiness|Dentist|MedicalBusiness|MedicalClinic|Physician|Attorney|LegalService|Restaurant|FoodEstablishment|HealthAndBeautyBusiness|BeautySalon|HairSalon|DaySpa|ExerciseGym|SportsActivityLocation|Store|AccountingService|InsuranceAgency|RealEstateAgent|VeterinaryCare|ChildCare|EmergencyService|Florist|LodgingBusiness)"/i;

export function parseSite(html, { finalUrl = '', city = '', keyword = '' } = {}) {
  const pick = (re) => (html.match(re)?.[1] || '').replace(/\s+/g, ' ').trim();
  const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();
  const title = strip(pick(/<title[^>]*>([\s\S]*?)<\/title>/i)).slice(0, 200);
  const description = pick(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i) || pick(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description/i);
  const h1 = strip(pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i)).slice(0, 200);
  const low = `${title} ${h1}`.toLowerCase();
  const kwWords = String(keyword || '').toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !['near', 'service', 'company', 'contractor', 'shop'].includes(w));
  const platform = /wix\.com|wixstatic/i.test(html) ? 'Wix' : /squarespace/i.test(html) ? 'Squarespace' : /wp-content|wordpress/i.test(html) ? 'WordPress'
    : /godaddy|wsimg\.com/i.test(html) ? 'GoDaddy' : /shopify/i.test(html) ? 'Shopify' : /webflow/i.test(html) ? 'Webflow' : /duda|dudamobile/i.test(html) ? 'Duda' : '';
  return {
    ok: true,
    url: finalUrl,
    https: finalUrl.startsWith('https://'),
    title, description: description.slice(0, 300), h1,
    titleHasCity: Boolean(city) && low.includes(String(city).toLowerCase()),
    titleHasService: kwWords.length ? kwWords.some((w) => low.includes(w.replace(/(ing|ers|er|s)$/, '').slice(0, Math.max(4, w.length - 4)) || w)) : true,
    schema: SCHEMA_TYPES.test(html),
    tel: /href=["']tel:/i.test(html),
    viewport: /<meta[^>]+name=["']viewport/i.test(html),
    mapEmbed: /google\.com\/maps\/embed|maps\.googleapis/i.test(html),
    form: /<form[\s>]/i.test(html),
    platform,
    kb: Math.round(html.length / 1024),
  };
}

export async function checkWebsite(url, ctx, fetchImpl = fetch) {
  let target;
  try { target = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); } catch { return { ok: false, error: 'Website address is not valid.' }; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetchImpl(target.toString(), { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; RightwayHub/1.0; +https://rightwaygrowth.com)', accept: 'text/html' } });
    if (res.status === 403 || res.status === 429 || res.status === 503) return { ok: false, blocked: true, status: res.status, error: 'The site blocked our check. Open it yourself.' };
    if (!res.ok) return { ok: false, status: res.status, error: `The site returned an error (HTTP ${res.status}).` };
    const html = (await res.text()).slice(0, 1_500_000);
    return parseSite(html, { ...ctx, finalUrl: res.url || target.toString() });
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'The site took more than 12 seconds to load.' : 'The site did not respond.' };
  } finally { clearTimeout(timer); }
}

async function withTimeout(p, ms) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })]).finally(() => clearTimeout(t));
}

// The research itself. fetchImpl lets the tests stub the network.
export async function researchLead(env, lead, { gridSize = 3, radiusMiles = 2, fetchImpl } = {}) {
  const demo = isDemo(env);
  const location = [lead.city, lead.state].filter(Boolean).join(' ');
  let cost = 0;
  let listing = null;

  if (lead.cid && lead.lat != null && lead.lng != null && !demo) {
    const d = await businessDetails(env, { title: lead.business, cid: lead.cid, place_id: lead.place_id || '', lat: lead.lat, lng: lead.lng }, fetchImpl).catch(() => null);
    if (d) { cost += d.cost || 0; listing = d.business; }
  }
  if (!listing) {
    if (!lead.business || !location) throw new HttpError('Add the city and state so the Hub can find this business on Google.');
    const s = demo ? mockSearch({ name: lead.business, location }) : await searchBusinesses(env, { name: lead.business, location }, fetchImpl);
    cost += s.cost || 0;
    listing = matchListing(s.results, lead);
  }

  const intel = { at: now(), demo, found: Boolean(listing), keyword: null, listing: null, rank: null, grid: null, competitors: [], website: null, speed: null, cost: 0 };
  if (listing) {
    intel.listing = { ...listing, city: lead.city || null };
    intel.keyword = keywordFor(lead, { listing });
  }

  const tasks = [];
  if (listing && intel.keyword && listing.lat != null && listing.lng != null) {
    const pts = gridPoints(listing.lat, listing.lng, gridSize, radiusMiles);
    tasks.push(Promise.all(pts.map(async (p) => {
      const q = { keyword: intel.keyword, lat: p.lat, lng: p.lng, zoom: 13, cid: listing.cid, place_id: listing.place_id, title: listing.title, source: 'local', device: 'desktop' };
      try {
        const r = demo ? mockRank(q) : await rankAtPoint(env, q, fetchImpl);
        cost += r.cost || 0;
        return { row: p.row, col: p.col, lat: p.lat, lng: p.lng, rank: r.rank, top: r.top.slice(0, 5) };
      } catch { return { row: p.row, col: p.col, lat: p.lat, lng: p.lng, rank: null, error: true, top: [] }; }
    })).then((cells) => {
      const ok = cells.filter((c) => !c.error);
      const ranked = ok.filter((c) => c.rank != null);
      const center = cells[Math.floor(cells.length / 2)];
      intel.rank = center && !center.error ? center.rank : null;
      intel.grid = {
        size: gridSize, radiusMiles, points: ok.length,
        top3: ranked.filter((c) => c.rank <= 3).length,
        avg: ranked.length ? Math.round((ranked.reduce((s, c) => s + c.rank, 0) / ranked.length) * 10) / 10 : null,
        cells: cells.map(({ row, col, rank, error, top }) => ({ row, col, rank, error: Boolean(error), top: (top || []).slice(0, 3).map((t) => ({ title: t.title, rank: t.rank, rating: t.rating ?? null, reviews: t.reviews ?? null })) })),
      };
      // Competitors: who wins the most top 3 spots across the grid, ties broken by best rank at the center.
      const tally = new Map();
      for (const c of ok) {
        for (const t of c.top) {
          if (t.cid === listing.cid || (t.place_id && t.place_id === listing.place_id) || normName(t.title) === normName(listing.title)) continue;
          const k = t.cid || t.place_id || t.title;
          const e = tally.get(k) || { title: t.title, cid: t.cid, rating: t.rating, reviews: t.reviews, category: t.category, domain: t.domain, wins: 0, best: 99 };
          if (t.rank <= 3) e.wins++;
          e.best = Math.min(e.best, t.rank);
          tally.set(k, e);
        }
      }
      intel.competitors = [...tally.values()].sort((a, b) => b.wins - a.wins || a.best - b.best).slice(0, 5);
    }));
  }

  const site = listing?.url || lead.website;
  if (site) {
    const ctx = { city: lead.city || '', keyword: intel.keyword || lead.industry || '' };
    tasks.push((demo ? Promise.resolve({ ok: true, url: 'https://example.com', https: false, title: `Home | ${lead.business}`, description: '', h1: 'Welcome', titleHasCity: false, titleHasService: false, schema: false, tel: false, viewport: true, mapEmbed: false, form: true, platform: 'Wix', kb: 640 })
      : checkWebsite(site, ctx, fetchImpl)).then((w) => { intel.website = w; }));
    tasks.push((demo ? Promise.resolve(mockPageSpeed(site)) : withTimeout(pageSpeed(env, /^https?:/.test(site) ? site : `https://${site}`, fetchImpl), 45000))
      .then((s) => { intel.speed = s; }).catch(() => { intel.speed = null; }));
  }
  await Promise.all(tasks);
  intel.cost = Math.round(cost * 10000) / 10000;
  return intel;
}

// Fields copied from the research onto the lead so the pipeline can filter and sort on them.
export function leadFieldsFromIntel(lead, intel) {
  const L = intel.listing || {};
  const merged = { ...lead, rating: L.rating ?? lead.rating, reviews: L.reviews ?? lead.reviews, category: L.category || lead.category };
  const sc = scoreLead(merged, intel);
  const plan = recommendPlan(merged, intel).plan;
  return {
    intel: JSON.stringify(intel), intel_at: intel.at, score: sc.score, grade: sc.grade, plan: lead.plan || plan,
    rating: L.rating ?? lead.rating ?? null, reviews: L.reviews ?? lead.reviews ?? null, category: L.category || lead.category || null,
    map_rank: intel.found ? (intel.rank ?? 21) : null, problems: findProblems(intel, merged).length,
    cid: lead.cid || L.cid || null, place_id: lead.place_id || L.place_id || null, lat: lead.lat ?? L.lat ?? null, lng: lead.lng ?? L.lng ?? null,
    website: lead.website || L.url || null, address: lead.address || L.address || null,
    updated_at: now(),
  };
}

route('POST', '/api/leads/:id/research', async ({ env, user, params, body }) => {
  requireStaff(user);
  const lead = await first(env, 'SELECT * FROM leads WHERE id = ?', params.id);
  if (!lead) throw new HttpError('Lead not found.', 404);
  const b = await body();
  if (!b.force && lead.intel && lead.intel_at && now() - lead.intel_at < 14 * 864e5) return json({ cached: true, intel: JSON.parse(lead.intel) });
  const s = await getSettings(env);
  const intel = await researchLead(env, lead, { gridSize: 3, radiusMiles: Number(s.research_radius) || 2 });
  const set = leadFieldsFromIntel(lead, intel);
  const cols = Object.keys(set);
  await run(env, `UPDATE leads SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => set[k]), lead.id);
  return json({ cached: false, intel, score: set.score, grade: set.grade, plan: set.plan });
});
