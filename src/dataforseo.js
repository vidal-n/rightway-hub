// DataForSEO Google Maps SERP (live, advanced). One task per request, billed per request.
// Docs: https://docs.dataforseo.com/v3/serp/google/maps/live/advanced/
import { HttpError } from './util.js';

const ENDPOINT = 'https://api.dataforseo.com/v3/serp/google/maps/live/advanced';
const US = 2840;

async function liveMaps(env, task, fetchImpl = fetch) {
  const auth = btoa(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`);
  let res;
  try {
    res = await fetchImpl(ENDPOINT, {
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
  if (data.status_code !== 20000) throw new HttpError(`DataForSEO: ${data.status_message}`, 502);
  const t = data.tasks?.[0];
  if (!t || t.status_code !== 20000) {
    // 40200 = payment required (balance empty)
    throw new HttpError(`DataForSEO: ${t?.status_message || 'no result'}`, 502);
  }
  const items = (t.result?.[0]?.items || []).filter((i) => i && i.type === 'maps_search');
  return { items, cost: Number(t.cost ?? data.cost ?? 0) };
}

// Keep only what the app uses, with stable names.
export function slim(i) {
  return {
    rank: i.rank_group ?? null,
    title: i.title || '',
    cid: i.cid || '',
    place_id: i.place_id || '',
    category: i.category || '',
    additional_categories: Array.isArray(i.additional_categories) ? i.additional_categories : [],
    rating: typeof i.rating?.value === 'number' ? i.rating.value : null,
    reviews: typeof i.rating?.votes_count === 'number' ? i.rating.votes_count : 0,
    address: i.address || '',
    phone: i.phone || '',
    url: i.url || '',
    domain: i.domain || '',
    lat: typeof i.latitude === 'number' ? i.latitude : null,
    lng: typeof i.longitude === 'number' ? i.longitude : null,
    claimed: typeof i.is_claimed === 'boolean' ? i.is_claimed : null,
    photos: typeof i.total_photos === 'number' ? i.total_photos : null,
    hours: Boolean(i.work_hours && i.work_hours.timetable && Object.keys(i.work_hours.timetable).length),
  };
}

export function sameBusiness(item, target) {
  if (!item || !target) return false;
  if (target.cid && item.cid && item.cid === target.cid) return true;
  if (target.place_id && item.place_id && item.place_id === target.place_id) return true;
  return false;
}

export async function searchBusinesses(env, { name, location }, fetchImpl) {
  const { items, cost } = await liveMaps(
    env,
    { keyword: `${name} ${location}`, location_code: US, language_code: 'en', depth: 10 },
    fetchImpl,
  );
  return { results: items.slice(0, 8).map(slim), cost };
}

export async function rankAtPoint(env, q, fetchImpl) {
  const { items, cost } = await liveMaps(
    env,
    {
      keyword: q.keyword,
      location_coordinate: `${q.lat.toFixed(7)},${q.lng.toFixed(7)},${q.zoom}z`,
      language_code: 'en',
      depth: 20,
    },
    fetchImpl,
  );
  const hit = items.find((i) => sameBusiness(i, q));
  return {
    rank: hit ? hit.rank_group : null,
    top: items.slice(0, 5).map(slim),
    cost,
  };
}
