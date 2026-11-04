// DataForSEO SERP calls (live, advanced). One task per request.
// Grid ranks use Google's Local Finder by default (the "More places" list behind the 3-pack),
// which is what BrightLocal's Local Search Grid reads. Google Maps is available as an option.
// Docs: https://docs.dataforseo.com/v3/serp/google/local_finder/overview/
//       https://docs.dataforseo.com/v3/serp/google/maps/live/advanced/
import { HttpError } from './util.js';

const BASE = 'https://api.dataforseo.com/v3/serp/google';
const MAPS = `${BASE}/maps/live/advanced`;
const LOCAL = `${BASE}/local_finder/live/advanced`;
const ORGANIC = `${BASE}/organic/live/advanced`;
const US = 2840;

// DataForSEO errors in plain words. 40200 and "payment required" mean the balance ran out, the usual reason a scan fails.
export function dfsMessage(code, msg = '') {
  if (code === 40200 || code === 40210 || /payment|insufficient|balance|funds/i.test(msg)) return 'DataForSEO balance is empty, so the scan could not run. Add funds at app.dataforseo.com (Billing), then try again. Owners see the balance on the Dashboard.';
  if (code === 40100 || code === 40101) return 'DataForSEO rejected the login. Check DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Cloudflare.';
  return `DataForSEO: ${msg || 'no result'}`;
}

async function liveSerp(env, endpoint, task, fetchImpl = fetch) {
  const auth = btoa(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`);
  let res;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([task]),
    });
  } catch (err) {
    throw new HttpError(`Could not reach DataForSEO: ${err.message}`, 502);
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401) throw new HttpError('DataForSEO rejected the login. Check DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD.', 502);
  if (!res.ok || !data) throw new HttpError(`DataForSEO error (HTTP ${res.status}).`, 502);
  if (data.status_code !== 20000) throw new HttpError(dfsMessage(data.status_code, data.status_message), 502);
  const t = data.tasks?.[0];
  if (!t || t.status_code !== 20000) throw new HttpError(dfsMessage(t?.status_code, t?.status_message), 502);
  const r = t.result?.[0] || {};
  return { items: Array.isArray(r.items) ? r.items : [], types: r.item_types || [], cost: Number(t.cost ?? data.cost ?? 0) };
}

// Unpaid business listings only, in the order Google shows them.
export function organicListings(items) {
  return items.filter((i) => i && !i.is_paid && !/paid|ads/i.test(i.type || '') && (i.cid || i.place_id || i.title));
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Full record, from Google Maps results (has categories, photos, hours, coordinates).
export function slim(i) {
  return {
    rank: i.rank_group ?? null,
    title: i.title || '',
    cid: i.cid || '',
    place_id: i.place_id || '',
    category: i.category || '',
    additional_categories: Array.isArray(i.additional_categories) ? i.additional_categories : [],
    rating: num(i.rating?.value),
    reviews: num(i.rating?.votes_count) ?? 0,
    address: i.address || '',
    phone: i.phone || '',
    url: i.url || '',
    domain: i.domain || '',
    lat: num(i.latitude),
    lng: num(i.longitude),
    claimed: typeof i.is_claimed === 'boolean' ? i.is_claimed : null,
    photos: num(i.total_photos),
    hours: Boolean(i.work_hours && i.work_hours.timetable && Object.keys(i.work_hours.timetable).length),
  };
}

// Compact record for every listing at every grid point.
export function lite(i, rank) {
  return {
    rank,
    title: i.title || '',
    cid: i.cid || '',
    place_id: i.place_id || '',
    category: i.category || '',
    rating: num(i.rating?.value),
    reviews: num(i.rating?.votes_count),
    domain: i.domain || '',
    lat: num(i.latitude),
    lng: num(i.longitude),
  };
}

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

export function sameBusiness(item, target) {
  if (!item || !target) return false;
  if (target.cid && item.cid) return item.cid === target.cid;
  if (target.place_id && item.place_id) return item.place_id === target.place_id;
  // Fallback when a result has no ids: exact name match.
  return Boolean(target.title && item.title && norm(item.title) === norm(target.title));
}

export async function searchBusinesses(env, { name, location }, fetchImpl) {
  const { items, cost } = await liveSerp(
    env, MAPS,
    { keyword: `${name} ${location}`, location_code: US, language_code: 'en', depth: 10 },
    fetchImpl,
  );
  return { results: organicListings(items).filter((i) => i.type === 'maps_search' || !i.type).slice(0, 8).map(slim), cost };
}

export async function rankAtPoint(env, q, fetchImpl) {
  const maps = q.source === 'maps';
  const task = maps
    ? { keyword: q.keyword, location_coordinate: `${q.lat.toFixed(7)},${q.lng.toFixed(7)},${q.zoom}z`, language_code: 'en', depth: 20, device: q.device }
    : { keyword: q.keyword, location_coordinate: `${q.lat.toFixed(7)},${q.lng.toFixed(7)}`, language_code: 'en', depth: 20, device: q.device };
  const { items, types, cost } = await liveSerp(env, maps ? MAPS : LOCAL, task, fetchImpl);
  const list = organicListings(items).slice(0, 20);
  const pos = list.findIndex((i) => sameBusiness(i, q));
  return {
    rank: pos >= 0 ? pos + 1 : null,
    top: list.map((i, idx) => lite(i, idx + 1)),
    count: list.length,
    types,
    cost,
  };
}

// Full profile details for one business (used for the head-to-head table).
export async function businessDetails(env, q, fetchImpl) {
  const { items, cost } = await liveSerp(
    env, MAPS,
    { keyword: q.title, location_coordinate: `${q.lat.toFixed(7)},${q.lng.toFixed(7)},14z`, language_code: 'en', depth: 10 },
    fetchImpl,
  );
  const list = organicListings(items);
  const hit = list.find((i) => sameBusiness(i, q)) || list.find((i) => norm(i.title) === norm(q.title)) || null;
  return { business: hit ? slim(hit) : null, cost };
}

// Plain Google web results (used for directory checks and link prospects). About $0.002 per 10 results.
export async function webSearch(env, keyword, { depth = 10 } = {}, fetchImpl) {
  const { items, cost } = await liveSerp(env, ORGANIC, { keyword, location_code: US, language_code: 'en', depth }, fetchImpl);
  return {
    results: items.filter((i) => i && i.type === 'organic' && i.url).slice(0, depth)
      .map((i) => ({ url: i.url, title: i.title || '', snippet: i.description || '', domain: i.domain || '' })),
    cost,
  };
}
