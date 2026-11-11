// Lead finder maths. Pure (no browser or server calls) so the Worker, the Hub page and Node tests share it.
// A search is keywords x areas. Each area is a grid of map views around a centre, because one Google Maps search only ever
// returns about 100 businesses. Running the same keyword over a grid and removing repeats is how a whole city gets covered.
import { gridPoints } from './grid.js';

export const COST_PER_REQUEST = 0.002; // DataForSEO Maps live: one search of up to 100 results
export const MAX_REQUESTS = 2000; // most searches one job may run (about $4)
export const MAX_KEYWORDS = 10;
export const MAX_AREAS = 12;
export const COVERAGE = [
  { id: 'quick', size: 3, label: 'Quick', what: '9 map views per keyword and area. A small town or one neighborhood.' },
  { id: 'standard', size: 5, label: 'Standard', what: '25 views. A city.' },
  { id: 'deep', size: 7, label: 'Deep', what: '49 views. A big city or a crowded trade.' },
  { id: 'max', size: 9, label: 'Max', what: '81 views. A whole metro, every pocket.' },
];
export const SIZES = COVERAGE.map((c) => c.size);

const uniq = (list, max) => {
  const seen = new Set(), out = [];
  for (const raw of list) {
    const v = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v.slice(0, 120));
    if (out.length >= max) break;
  }
  return out;
};
// Keywords: one per line, or separated by commas or semicolons.
export const parseKeywords = (text, max = MAX_KEYWORDS) => uniq(Array.isArray(text) ? text : String(text || '').split(/[\n,;]/), max);
// Areas: one per line (or separated by semicolons), because a place like "Miami, FL" has a comma in it.
export const parseAreas = (text, max = MAX_AREAS) => uniq(Array.isArray(text) ? text : String(text || '').split(/[\n;]/), max);

export const requestCount = (areaCount, size, keywordCount, views) => Math.max(0, areaCount) * (views ?? size * size) * Math.max(0, keywordCount);
// Most map views one place can get (a 9 x 9 grid). A custom count takes the nearest spots to the middle first.
export const MAX_VIEWS = 81;
// Smallest grid (3, 5, 7 or 9 per side) that holds this many views.
export const customSize = (views) => [3, 5, 7, 9].find((s) => s * s >= views) || 9;
export const costOf = (requests) => Math.round(requests * COST_PER_REQUEST * 1000) / 1000;
export function estimate({ areas, size, keywords, source = 'google', views }) {
  const requests = requestCount(areas, size, keywords, views);
  if (source === 'osm') return { requests, cost: 0, tooBig: requests > MAX_OSM_REQUESTS };
  return { requests, cost: costOf(requests), tooBig: requests > MAX_REQUESTS };
}
// OpenStreetMap's free servers are shared, so a free search is kept smaller.
export const MAX_OSM_REQUESTS = 150;
export const OSM_SIZES = [1, 3, 5];
export const SOURCES = [['google', 'Google Maps', 'Best data: ratings, reviews, claimed profiles. About $0.002 a map view.'], ['osm', 'OpenStreetMap (free)', 'Costs nothing. No ratings or reviews, and smaller businesses are often missing.']];

// Radius that fits a place, from its bounding box [south, north, west, east]. Half the longer side, kept to a useful range.
export function radiusFromBox(box, lat = 25) {
  if (!Array.isArray(box) || box.length < 4 || box.some((n) => !Number.isFinite(Number(n)))) return 5;
  const [s, n, w, e] = box.map(Number);
  const tall = Math.abs(n - s) * 69;
  const wide = Math.abs(e - w) * 69.172 * Math.cos((lat * Math.PI) / 180);
  const r = Math.max(tall, wide) / 2;
  return Math.round(Math.min(12, Math.max(1.5, r)) * 10) / 10;
}

// Zoom for one grid cell so neighbouring map views overlap a little: the view is about 1.5 cells wide.
export function zoomFor(stepMiles, lat = 25) {
  const target = Math.max(0.3, stepMiles) * 1.5;
  const z = Math.log2((1000 * 156543.03 * Math.cos((lat * Math.PI) / 180)) / (1609.34 * target));
  return Math.min(17, Math.max(10, Math.round(z)));
}

// Every search a job will run, in a fixed order, so a job can stop and carry on where it left off.
export function taskList(areas, keywords) {
  const out = [];
  for (const a of areas) {
    const size = a.size, half = (size - 1) / 2;
    const step = half ? a.radius / half : a.radius;
    const zoom = zoomFor(step, a.lat);
    const grid = size === 1 ? [{ lat: a.lat, lng: a.lng }] : gridPoints(a.lat, a.lng, size, a.radius);
    const near = (p) => Math.hypot(p.lat - a.lat, (p.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180));
    const pts = a.views && a.views < grid.length ? [...grid].sort((p, q) => near(p) - near(q)).slice(0, a.views) : grid;
    for (const p of pts) for (const keyword of keywords) out.push({ keyword, lat: p.lat, lng: p.lng, zoom, label: a.label, radius: size === 1 ? a.radius : Math.round(step * 1.1 * 10) / 10 });
  }
  return out;
}

const digitsOf = (v) => String(v || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
const normName = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
// One key per business, whatever Google gave us.
export const keyOf = (r) => r.place_id || r.cid || `n:${normName(r.title)}|${digitsOf(r.phone)}`;

// ---------- filters ----------
const numOrNull = (v) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const list = (v) => String(v || '').split(/[,\n;]/).map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 30);
export const DEFAULT_FILTERS = { minReviews: null, maxReviews: null, minRating: null, maxRating: null, website: 'any', phone: 'has', claimed: 'any', category: '', exclude: '' };
export function cleanFilters(f = {}) {
  const pick = (v, ok, d) => (ok.includes(v) ? v : d);
  return {
    minReviews: numOrNull(f.minReviews), maxReviews: numOrNull(f.maxReviews), minRating: numOrNull(f.minRating), maxRating: numOrNull(f.maxRating),
    website: pick(f.website, ['any', 'has', 'none'], 'any'), phone: pick(f.phone, ['any', 'has'], 'has'), claimed: pick(f.claimed, ['any', 'claimed', 'unclaimed'], 'any'),
    category: String(f.category || '').slice(0, 200), exclude: String(f.exclude || '').slice(0, 400),
  };
}
// Does this business pass the filters? Pure, so the page and the server agree.
export function passes(r, filters) {
  const f = cleanFilters(filters);
  const reviews = Number(r.reviews) || 0;
  if (f.minReviews != null && reviews < f.minReviews) return false;
  if (f.maxReviews != null && reviews > f.maxReviews) return false;
  if (f.minRating != null && !(r.rating != null && r.rating >= f.minRating)) return false;
  if (f.maxRating != null && !(r.rating != null && r.rating <= f.maxRating)) return false;
  if (f.website === 'has' && !r.website) return false;
  if (f.website === 'none' && r.website) return false;
  if (f.phone === 'has' && !digitsOf(r.phone)) return false;
  if (f.claimed === 'claimed' && r.claimed !== true) return false;
  if (f.claimed === 'unclaimed' && r.claimed !== false) return false;
  const cats = list(f.category);
  if (cats.length) {
    const have = [r.category, ...(r.cats || [])].join(' | ').toLowerCase();
    if (!cats.some((c) => have.includes(c))) return false;
  }
  const name = String(r.title || '').toLowerCase();
  if (list(f.exclude).some((w) => name.includes(w))) return false;
  return true;
}

// A found business as a lead the Pipeline import understands.
export function leadRow(r, { industry } = {}) {
  return {
    business: r.title, phone: r.phone, website: r.website, address: r.address, city: r.city, state: r.state, zip: r.zip,
    category: r.category, industry: industry || r.kw || r.category, rating: r.rating, reviews: r.reviews, lat: r.lat, lng: r.lng,
    place_id: r.place_id, cid: r.cid, source: 'Lead finder', email: r.email || '',
  };
}

// ---------- CSV (Outscraper style columns) ----------
export const CSV_COLUMNS = [
  ['name', (r) => r.title], ['category', (r) => r.category], ['other_categories', (r) => (r.cats || []).join('; ')], ['phone', (r) => r.phone], ['website', (r) => r.website],
  ['email', (r) => r.email], ['email_status', (r) => r.email_status], ['owner_name', (r) => r.owner_name], ['phone_type', (r) => r.phone_type],
  ['facebook', (r) => r.socials?.facebook], ['instagram', (r) => r.socials?.instagram], ['linkedin', (r) => r.socials?.linkedin],
  ['hours', (r) => r.hours_text], ['address', (r) => r.address], ['city', (r) => r.city], ['state', (r) => r.state], ['postal_code', (r) => r.zip],
  ['rating', (r) => r.rating], ['reviews', (r) => r.reviews], ['claimed', (r) => (r.claimed == null ? '' : r.claimed ? 'yes' : 'no')], ['photos', (r) => r.photos],
  ['latitude', (r) => r.lat], ['longitude', (r) => r.lng], ['place_id', (r) => r.place_id], ['cid', (r) => r.cid],
  ['google_maps_url', (r) => (r.place_id ? `https://www.google.com/maps/place/?q=place_id:${r.place_id}` : '')], ['keyword', (r) => r.kw], ['search_area', (r) => r.area],
];
const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function csvText(rows) {
  return [CSV_COLUMNS.map((c) => c[0]).join(','), ...rows.map((r) => CSV_COLUMNS.map(([, f]) => cell(f(r))).join(','))].join('\r\n');
}
