// Competitor and profile analysis from grid results. Pure functions.

export function sameBusiness(a, b) {
  if (!a || !b) return false;
  if (a.cid && b.cid && a.cid === b.cid) return true;
  if (a.place_id && b.place_id && a.place_id === b.place_id) return true;
  return false;
}

// Businesses that show up most often in the top 3 across the grid.
export function topCompetitors(points, target, limit = 3) {
  const seen = new Map();
  for (const p of points) {
    if (p.status !== 'done') continue;
    for (const b of p.top || []) {
      if (sameBusiness(b, target)) continue;
      const key = b.cid || b.place_id || b.title;
      const e = seen.get(key) || { biz: b, appearances: 0, top3: 0, rankSum: 0 };
      e.appearances += 1;
      if (b.rank <= 3) e.top3 += 1;
      e.rankSum += b.rank;
      // Prefer the record with the most detail.
      if ((b.reviews || 0) >= (e.biz.reviews || 0)) e.biz = b;
      seen.set(key, e);
    }
  }
  return [...seen.values()]
    .map((e) => ({
      ...e.biz,
      appearances: e.appearances,
      top3Points: e.top3,
      avgTopRank: Math.round((10 * e.rankSum) / e.appearances) / 10,
    }))
    .sort((a, b) => b.top3Points - a.top3Points || b.appearances - a.appearances || a.avgTopRank - b.avgTopRank)
    .slice(0, limit);
}

function avg(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null;
  for (const [v, c] of counts) if (!best || c > best.count) best = { value: v, count: c };
  return best;
}

// Each item: { key, label, status: 'good' | 'gap' | 'unknown', detail }
export function profileChecklist(target, comps) {
  const items = [];
  const add = (key, label, status, detail) => items.push({ key, label, status, detail });

  if (target.claimed === true) add('claimed', 'Profile claimed', 'good', 'The owner has claimed the Google profile.');
  else if (target.claimed === false) add('claimed', 'Profile claimed', 'gap', 'The profile shows as unclaimed. The owner needs to claim and verify it.');
  else add('claimed', 'Profile claimed', 'unknown', 'Google did not report whether it is claimed.');

  add('website', 'Website linked', target.url ? 'good' : 'gap',
    target.url ? `Links to ${target.domain || target.url}.` : 'No website on the profile. Google and customers both look for one.');
  add('phone', 'Phone listed', target.phone ? 'good' : 'gap',
    target.phone ? target.phone : 'No phone number on the profile.');
  add('hours', 'Hours listed', target.hours ? 'good' : 'gap',
    target.hours ? 'Business hours are set.' : 'No hours on the profile.');

  if (comps.length) {
    const leader = [...comps].sort((a, b) => (b.reviews || 0) - (a.reviews || 0))[0];
    const behind = (leader.reviews || 0) - (target.reviews || 0);
    add('reviews', 'Review count', behind <= 0 ? 'good' : 'gap',
      behind <= 0
        ? `${target.reviews} reviews, at or above the top competitors.`
        : `${target.reviews} reviews. ${leader.title} has ${leader.reviews}, ${behind} more.`);

    const compRating = avg(comps.map((c) => c.rating));
    if (target.rating != null && compRating != null) {
      add('rating', 'Star rating', target.rating >= compRating - 0.05 ? 'good' : 'gap',
        `${target.rating.toFixed(1)} stars vs a ${compRating.toFixed(1)} competitor average.`);
    }

    const compPhotos = avg(comps.map((c) => c.photos));
    if (target.photos != null && compPhotos != null) {
      add('photos', 'Photos', target.photos >= compPhotos ? 'good' : 'gap',
        `${target.photos} photos vs a ${Math.round(compPhotos)} competitor average.`);
    }

    const compCats = avg(comps.map((c) => (c.additional_categories || []).length));
    const mine = (target.additional_categories || []).length;
    if (compCats != null) {
      add('categories', 'Secondary categories', mine >= Math.floor(compCats) ? 'good' : 'gap',
        `${mine} secondary ${mine === 1 ? 'category' : 'categories'} vs a ${compCats.toFixed(1)} competitor average.`);
    }

    const primary = mostCommon(comps.map((c) => c.category));
    if (primary && target.category) {
      const match = primary.value.toLowerCase() === target.category.toLowerCase();
      add('primary', 'Primary category', match ? 'good' : 'gap',
        match
          ? `Uses "${target.category}", same as the top competitors.`
          : `Uses "${target.category}". ${primary.count} of the top ${comps.length} use "${primary.value}". Check which fits the main service.`);
    }
  }
  return items;
}

// Categories competitors use that the target does not.
export function categoryGap(target, comps) {
  const mine = new Set(
    [target.category, ...(target.additional_categories || [])].filter(Boolean).map((c) => c.toLowerCase()),
  );
  const counts = new Map();
  for (const c of comps) {
    for (const cat of new Set([c.category, ...(c.additional_categories || [])].filter(Boolean))) {
      if (mine.has(cat.toLowerCase())) continue;
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

// "The math" from the sales playbook: how many extra jobs cover the plan.
export function planMath({ jobValue, closeRatePct, extraCalls, planPrice }) {
  const jv = Number(jobValue) || 0;
  const cr = Math.min(Math.max(Number(closeRatePct) || 0, 0), 100) / 100;
  const calls = Math.max(Number(extraCalls) || 0, 0);
  const jobs = calls * cr;
  const revenue = jobs * jv;
  const jobsToCover = jv > 0 ? Math.ceil((Number(planPrice) || 0) / jv) : null;
  return { jobs: Math.round(jobs * 10) / 10, revenue: Math.round(revenue), jobsToCover };
}

// ---------- Grid insights (v2) ----------
const UNRANKED_RANK = 21;

// A business's rank at one grid point, from that point's top 20 list (null = not in the list).
export function rankAt(point, biz) {
  if (!point || point.status !== 'done') return undefined;
  if (biz?.isTarget) return point.rank;
  const hit = (point.top || []).find((b) => sameBusiness(b, biz));
  return hit ? hit.rank : null;
}

// Every business seen in the grid, scored like Local Falcon / BrightLocal:
// share of local voice = share of points where it's in the top 3.
export function leaderboard(points, target, limit = 8) {
  const done = points.filter((p) => p.status === 'done');
  const n = done.length || 1;
  const seen = new Map();
  const keyOf = (b) => b.cid || b.place_id || b.title;
  const tKey = keyOf(target);
  seen.set(tKey, { biz: { ...target, isTarget: true }, ranks: [] });
  for (const p of done) {
    for (const b of p.top || []) {
      if (sameBusiness(b, target)) continue;
      const k = keyOf(b);
      if (!seen.has(k)) seen.set(k, { biz: b, ranks: [] });
      const e = seen.get(k);
      if ((b.reviews ?? -1) > (e.biz.reviews ?? -1)) e.biz = { ...e.biz, ...b };
    }
  }
  const rows = [...seen.values()].map((e) => {
    const ranks = done.map((p) => rankAt(p, e.biz));
    const top3 = ranks.filter((r) => r != null && r <= 3).length;
    const top10 = ranks.filter((r) => r != null && r <= 10).length;
    const found = ranks.filter((r) => r != null).length;
    const avg = ranks.reduce((s, r) => s + (r ?? UNRANKED_RANK), 0) / n;
    return { ...e.biz, top3Points: top3, top10Points: top10, found, sov: Math.round((100 * top3) / n), avgRank: Math.round(avg * 10) / 10 };
  });
  rows.sort((a, b) => b.top3Points - a.top3Points || a.avgRank - b.avgRank);
  const out = rows.filter((r) => !r.isTarget).slice(0, limit);
  const t = rows.find((r) => r.isTarget);
  return { rows: out, target: t, position: rows.indexOf(t) + 1, total: rows.length };
}

// How far from the address the business holds a given rank (ring by ring, at least half the ring).
export function reach(points, size, radiusMiles, threshold) {
  const half = (size - 1) / 2;
  const step = half ? radiusMiles / half : 0;
  let miles = null;
  for (let ring = 0; ring <= half; ring++) {
    const ringPts = points.filter((p) => p.status === 'done' && Math.max(Math.abs(p.row - half), Math.abs(p.col - half)) === ring);
    if (!ringPts.length) break;
    const hits = ringPts.filter((p) => p.rank != null && p.rank <= threshold).length;
    if (hits / ringPts.length >= 0.5) miles = ring * step;
    else break;
  }
  return miles; // null = not even at the address
}

// Average rank by side of the grid.
export function sides(points, size) {
  const half = (size - 1) / 2;
  const groups = { north: [], south: [], east: [], west: [] };
  for (const p of points) {
    if (p.status !== 'done') continue;
    const r = p.rank ?? UNRANKED_RANK;
    if (p.row < half) groups.north.push(r);
    if (p.row > half) groups.south.push(r);
    if (p.col > half) groups.east.push(r);
    if (p.col < half) groups.west.push(r);
  }
  const res = Object.entries(groups)
    .filter(([, v]) => v.length)
    .map(([side, v]) => ({ side, avg: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 }));
  res.sort((a, b) => a.avg - b.avg);
  return { strongest: res[0] || null, weakest: res[res.length - 1] || null, all: res };
}

const reachText = (m) => (m === 0 ? 'only at its own address' : `out to about ${m % 1 ? m.toFixed(1) : m} mile${m === 1 ? '' : 's'}`);

// Plain-English findings for the report. Facts only, from the scan data.
export function findings({ target, points, size, radius, keyword, board, comps, checks, gaps }) {
  const out = [];
  const done = points.filter((p) => p.status === 'done');
  const n = done.length;
  if (!n) return out;
  const top3 = done.filter((p) => p.rank != null && p.rank <= 3).length;
  const name = target.title;

  if (top3 === 0) out.push(`${name} isn't in Google's top 3 for "${keyword}" anywhere in this ${n}-point area. The top 3 is where most calls go.`);
  else out.push(`${name} is in the top 3 at ${top3} of ${n} points (${Math.round((100 * top3) / n)}% of the area).`);

  const r3 = reach(points, size, radius, 3);
  const r10 = reach(points, size, radius, 10);
  const center = points[Math.floor(points.length / 2)];
  if (r10 == null) out.push(`Even at its own address it ranks ${center?.rank ? `#${center.rank}` : 'below #20'}, so nearby customers see competitors first.`);
  else if (r3 != null) out.push(`It holds the top 3 ${reachText(r3)} and the first page (top 10) ${reachText(r10)}.`);
  else out.push(`It stays on the first page (top 10) ${reachText(r10)} but doesn't hold the top 3 anywhere around its address.`);

  const leader = board?.rows?.[0];
  if (leader && leader.top3Points > top3) {
    let line = `${leader.title} owns the area: top 3 at ${leader.top3Points} of ${n} points`;
    if (leader.reviews != null && target.reviews != null) {
      line += `, with ${Number(leader.reviews).toLocaleString('en-US')} reviews vs ${Number(target.reviews).toLocaleString('en-US')}`;
      const ratio = target.reviews ? leader.reviews / target.reviews : Infinity;
      line += ratio <= 1.25 ? '. Review count is not the gap here, so categories, website relevance, and proximity are.' : '.';
    } else line += '.';
    out.push(line);
  }

  const s = sides(points, size);
  if (s.weakest && s.strongest && s.weakest.avg - s.strongest.avg >= 3) {
    out.push(`Weakest to the ${s.weakest.side} (average rank ${s.weakest.avg}), strongest to the ${s.strongest.side} (average ${s.strongest.avg}).`);
  }

  const common = (gaps || []).filter((g) => comps.length && g.count >= Math.max(2, Math.ceil(comps.length / 2)));
  if (common.length) {
    out.push(`${common.length === 1 ? 'A category' : 'Categories'} most top competitors use that ${name} doesn't: ${common.map((g) => `"${g.category}"`).join(', ')}.`);
  }
  const rev = (checks || []).find((c) => c.key === 'reviews' && c.status === 'gap');
  if (rev) out.push(rev.detail);
  return out;
}

const FIX = {
  claimed: { impact: 'High', text: 'Claim and verify the Google profile. Nothing else sticks until the owner controls it.' },
  primary: { impact: 'High', text: 'Review the primary category. It is the strongest relevance signal Google uses for the map pack.' },
  categories: { impact: 'High', text: 'Add the secondary categories competitors rank with, where they match real services.' },
  website: { impact: 'High', text: 'Link a website with a page for the main service and city. Profiles without one rarely hold the top 3.' },
  reviews: { impact: 'Medium', text: 'Start a steady review request system so new reviews arrive every week, not in bursts.' },
  rating: { impact: 'Medium', text: 'Reply to every review and fix the issues behind low ratings. Rating affects clicks more than rank.' },
  photos: { impact: 'Medium', text: 'Upload real photos every month: team, jobs, storefront. It keeps the profile active and earns clicks.' },
  hours: { impact: 'Medium', text: 'Add business hours. Google can hide businesses that look closed.' },
  phone: { impact: 'Medium', text: 'Add a local phone number that matches the website and directories.' },
};
const ORDER = ['claimed', 'primary', 'categories', 'website', 'reviews', 'rating', 'photos', 'hours', 'phone'];

// Ranked to-do list from the profile gaps.
export function fixFirst(checks, limit = 5) {
  const gapKeys = new Set((checks || []).filter((c) => c.status === 'gap').map((c) => c.key));
  return ORDER.filter((k) => gapKeys.has(k)).slice(0, limit).map((k) => ({ key: k, ...FIX[k] }));
}
