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
