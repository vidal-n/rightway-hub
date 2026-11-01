// Grid math and rank statistics. Pure functions, shared by the app and the tests.

export const UNRANKED = 21; // "not in the top 20" counts as 21 for averages
// DataForSEO live pricing, USD per grid point: Local Finder bills per 10 results (we read 20); Maps bills per 100.
export const COST_PER_POINT = { local: 0.004, maps: 0.002 };

const MILES_PER_DEG_LAT = 69.0;
const MILES_PER_DEG_LNG_EQUATOR = 69.172;

export function gridPoints(lat, lng, size, radiusMiles) {
  if (![3, 5, 7, 9].includes(size)) throw new Error('Grid size must be 3, 5, 7, or 9.');
  if (!(radiusMiles > 0 && radiusMiles <= 25)) throw new Error('Radius must be between 0 and 25 miles.');
  const half = (size - 1) / 2;
  const step = radiusMiles / half;
  const latStep = step / MILES_PER_DEG_LAT;
  const lngStep = step / (MILES_PER_DEG_LNG_EQUATOR * Math.cos((lat * Math.PI) / 180));
  const points = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      points.push({
        row,
        col,
        lat: round7(lat + (half - row) * latStep),
        lng: round7(lng + (col - half) * lngStep),
        status: 'pending',
        rank: null,
        top: [],
      });
    }
  }
  return points;
}

function round7(n) {
  return Math.round(n * 1e7) / 1e7;
}

export function rankBand(point) {
  if (!point || point.status === 'pending' || point.status === 'running') return 'pending';
  if (point.status === 'error') return 'error';
  const r = point.rank;
  if (r == null) return 'none';
  if (r <= 3) return 'top3';
  if (r <= 10) return 'top10';
  return 'top20';
}

export function rankLabel(point) {
  const band = rankBand(point);
  if (band === 'pending') return '';
  if (band === 'error') return '!';
  if (band === 'none') return '20+';
  return String(point.rank);
}

export function gridStats(points) {
  const done = points.filter((p) => p.status === 'done');
  const n = done.length;
  const ranked = done.filter((p) => p.rank != null);
  const top3 = ranked.filter((p) => p.rank <= 3).length;
  const top10 = ranked.filter((p) => p.rank <= 10).length;
  const avg = n ? done.reduce((sum, p) => sum + (p.rank ?? UNRANKED), 0) / n : null;
  const center = points[Math.floor(points.length / 2)];
  return {
    total: points.length,
    done: n,
    errors: points.filter((p) => p.status === 'error').length,
    found: ranked.length,
    top3,
    top10,
    top3Pct: n ? Math.round((100 * top3) / n) : 0,
    top10Pct: n ? Math.round((100 * top10) / n) : 0,
    avgRank: avg == null ? null : Math.round(avg * 10) / 10,
    centerRank: center && center.status === 'done' ? center.rank : undefined,
  };
}

export function estimateCost(size, source = 'local') {
  return size * size * (COST_PER_POINT[source] ?? COST_PER_POINT.local);
}
