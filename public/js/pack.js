// The competitor analysis pack: what we show a prospect on the call and send afterwards. Pure and shared (Worker, Hub, tests).
// Only facts the research found. No prices, plan names, scores, notes, rep names or anything internal. Website findings are kept in the data (site, growth, foundation[].site, reasons[].site)
// but packview leaves them off the client's screen: the analysis is local SEO first, and website and ads are sold separately after results. Rank also depends on distance and relevance, so nothing here promises a spot.
import { industryInfo, keywordFor, findProblems, top10Of, servicesFor, rankText } from './leadintel.js';
import { sortedListings, LISTING_LABEL } from './listings.js';
import { reviewTarget } from './fulfill.js';
import { urgencyFor } from './lifeforce.js';
import { WEBSITE_SERVICE_IDS, WEBSITE_PROBLEM_KEYS } from './plancopy.js';

export const PACK_VERSION = 2;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const parse = (v) => { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };

// Why one competitor beats the business, using only numbers we have for both.
export function whyThey(c, you, grid) {
  const out = [];
  if (c.reviews != null && you.reviews != null && c.reviews - you.reviews >= 10) out.push(`${plural(c.reviews - you.reviews, 'more Google review')} (${c.reviews} vs ${you.reviews})`);
  if (c.rating != null && you.rating != null && c.rating - you.rating >= 0.2) out.push(`Higher rating (${c.rating.toFixed(1)} vs ${you.rating.toFixed(1)})`);
  if (grid && grid.points && c.wins) out.push(`Top 3 in ${c.wins} of the ${grid.points} spots we checked`);
  else if (c.best && c.best <= 3) out.push(`Shows in the top 3 next to your address`);
  if (c.category && you.category && c.category.toLowerCase() !== you.category.toLowerCase()) out.push(`Main category "${c.category}" (yours is "${you.category}")`);
  return out;
}

// The grid we show: the deep scan (bigger) when the rep ran one, else the research grid.
function gridOf(intel, deep) {
  const s = deep?.scans?.[0];
  if (s?.cells?.length) return { size: s.size, radiusMiles: s.radiusMiles, points: s.points, top10: s.top10, top3: s.top3, avg: s.avg, keyword: s.keyword, cells: s.cells.map((c) => (c.error ? -1 : c.rank ?? 0)) };
  const g = intel?.grid;
  if (g?.cells?.length) return { size: g.size, radiusMiles: g.radiusMiles, points: g.points, top10: top10Of(g), top3: g.top3, avg: g.avg, keyword: intel.keyword, cells: g.cells.map((c) => (c.error ? -1 : c.rank ?? 0)) };
  return null;
}

// Growth services beyond the local SEO foundation. They are sold separately at the monthly branding calls, never bundled into the foundation.
export const GROWTH = [
  { id: 'website', name: 'Website build or rebuild', what: 'A fast, mobile first site built to turn visitors into calls, with a page for every service and city.' },
  { id: 'website_seo', name: 'Website SEO', what: 'Titles, headings, internal links, speed and content so Google knows exactly what you do and where.' },
  { id: 'schema', name: 'Schema markup', what: 'The code that tells Google your business name, address, phone, services and reviews, tied to your Google profile.' },
  { id: 'social', name: 'Social media management', what: 'A steady posting calendar, captions and approvals so you look active everywhere customers check you out.' },
  { id: 'google_ads', name: 'Google Ads', what: 'Paid spots above the map for the searches that bring jobs, with call tracking so you see what each dollar returns.' },
  { id: 'meta_ads', name: 'Meta ads (Facebook and Instagram)', what: 'Targeted ads for your area that put your best work and offers in front of local homeowners.' },
  { id: 'content', name: 'Content and local pages', what: 'Articles and pages that answer what customers ask, so Google shows you for more searches.' },
];

function growthFor(lead, intel, problems, info) {
  const has = (...k) => problems.some((p) => k.includes(p.key));
  const W = intel?.website;
  const hasSite = Boolean(intel?.listing?.url || lead.website);
  const big = info.tier === 'high';
  const climbing = has('not_top10', 'not_top3', 'grid_weak');
  const f = {
    website: !hasSite || has('site_down', 'slow_site', 'no_https') ? ['high', hasSite ? 'The current site is holding the business back (slow, not secure, or not loading).' : 'There is no website on the Google profile, so Google and customers have nothing to trust.'] : ['later', 'The site exists. Revisit after the foundation shows results.'],
    website_seo: hasSite && (has('weak_title', 'slow_site', 'no_click_to_call') || (W && (!W.titleHasCity || !W.titleHasService))) ? ['high', 'The homepage does not say what you do and where, which is the first thing Google reads.'] : hasSite ? ['good', 'Tighten titles, headings and speed to support the profile.'] : ['later', 'Comes after a website exists.'],
    schema: has('no_schema') ? ['high', 'No local business code found on the site, so Google has to guess how it ties to the profile.'] : ['good', 'Add services, areas and review markup on top of the basics.'],
    social: ['good', 'Active social pages give customers more proof and give Google more signals that the business is real.'],
    google_ads: climbing ? ['good', 'Ads put you above the map today while the foundation climbs, with calls tracked so we see what each dollar returns.'] : ['later', 'Add when the organic position is strong and you want more volume.'],
    meta_ads: big ? ['good', 'Higher value jobs justify targeted ads to local homeowners with your best work.'] : ['later', 'Best after reviews and photos are strong.'],
    content: has('not_top3', 'grid_weak', 'not_top10') ? ['good', 'More pages and articles give Google more reasons to show you in more places.'] : ['later', 'Worth adding once service and city pages are done.'],
  };
  return GROWTH.map((g) => ({ ...g, fit: f[g.id][0], why: f[g.id][1] })).sort((a, b) => ({ high: 0, good: 1, later: 2 })[a.fit] - ({ high: 0, good: 1, later: 2 })[b.fit]);
}

// Builds the snapshot. `ready` is false until the research ran.
export function buildPack(lead = {}, { intel = null, listings = null, deepScan = null, at = Date.now() } = {}) {
  intel = parse(intel); listings = parse(listings); deepScan = parse(deepScan);
  if (!intel || intel.found === undefined) return { v: PACK_VERSION, ready: false, business: lead.business || '', reason: 'Run the lead research first so there is something to compare.' };
  const L = intel.listing || {};
  const info = industryInfo(lead.industry, L.category || lead.category);
  const keyword = keywordFor(lead, intel);
  const grid = gridOf(intel, deepScan);
  const you = { rating: num(L.rating), reviews: num(L.reviews), category: L.category || lead.category || '', rank: intel.rank ?? null, hasSite: Boolean(L.url || lead.website), photos: num(L.photos), claimed: L.claimed ?? null };
  const problems = findProblems(intel, lead);
  const comps = (intel.competitors || []).slice(0, 5).map((c) => ({
    name: c.title, rating: num(c.rating), reviews: num(c.reviews), category: c.category || '', domain: c.domain || '', hasSite: Boolean(c.domain), wins: c.wins || 0, best: c.best ?? null,
    why: whyThey({ ...c, reviews: num(c.reviews), rating: num(c.rating) }, you, grid),
  }));
  const top = comps[0] || null;

  const reasons = problems.slice(0, 8).map((p) => ({ key: p.key, site: WEBSITE_PROBLEM_KEYS.includes(p.key), title: p.title, detail: p.detail, severity: p.severity }));
  const lst = listings?.results?.length ? {
    checked: listings.results.length, counts: listings.counts || {},
    rows: sortedListings(listings).filter((r) => r.status === 'mismatch' || r.status === 'missing').slice(0, 8)
      .map((r) => ({ name: r.name, status: r.status, label: LISTING_LABEL[r.status]?.[1] || '', note: r.notes?.length ? r.notes.join('. ') : r.status === 'missing' ? 'No listing found' : '' })),
  } : null;
  if (lst && (lst.counts.mismatch || lst.counts.missing)) reasons.push({ title: `${(lst.counts.mismatch || 0) + (lst.counts.missing || 0)} of ${lst.checked} directories are wrong or missing`, detail: 'Google double checks your name, address and phone across directories. Mismatches weaken trust.', severity: 'medium' });

  const foundation = servicesFor(lead, intel).map((s) => ({ id: s.id, name: s.name, what: s.what, why: s.why || '', site: WEBSITE_SERVICE_IDS.includes(s.id) }));
  const growth = growthFor(lead, intel, problems, info);

  // More to show, all from the research: the compare against the leader, the review math, and what waiting costs.
  const rt = reviewTarget(intel);
  const lead3 = (a, b, hi = true) => (a == null || b == null ? null : a === b ? 'tie' : (hi ? a > b : a < b) ? 'you' : 'them');
  const compare = top ? [
    { label: 'Google reviews', you: you.reviews, them: top.reviews, lead: lead3(you.reviews, top.reviews) },
    { label: 'Rating', you: you.rating, them: top.rating, lead: lead3(you.rating, top.rating) },
    ...(grid && grid.points ? [{ label: `Top 3 spots (of ${grid.points} checked)`, you: grid.top3 ?? 0, them: top.wins, lead: lead3(grid.top3 ?? 0, top.wins) }] : []),
    { label: 'Rank at your address', you: you.rank ? `#${you.rank}` : '20+', them: top.best ? `#${top.best}` : null, lead: top.best && you.rank ? lead3(you.rank, top.best, false) : null },
    { label: 'Main Google category', you: you.category || 'n/a', them: top.category || 'n/a', lead: null },
  ].filter((r) => r.them != null && r.you != null) : [];
  const reviewMath = top && top.reviews ? { mine: rt.mine, leader: top.name, leaderReviews: top.reviews, gap: rt.gap, perMonth: rt.perMonth, months: rt.gap ? Math.ceil(rt.gap / rt.perMonth) : 0 } : null;
  const lost = grid && grid.points ? { spots: grid.points - (grid.top10 || 0), of: grid.points, top10: grid.top10 || 0 } : null;
  const urgency = urgencyFor({ business: lead.business || 'the business', industry: lead.industry || info.label, grid, you, top: top ? { name: top.name, reviews: top.reviews, rating: top.rating, wins: top.wins } : null }).lines;

  let headline;
  if (!intel.found) headline = `We could not find ${lead.business || 'the business'} on Google Maps. Customers searching for ${keyword || 'your service'} cannot find you there either.`;
  else if (grid && grid.points) headline = `${lead.business} is on the first page for "${keyword}" in ${grid.top10} of ${grid.points} spots around the business.${top ? (grid.top10 / grid.points >= 0.8 ? ` ${top.name} is the closest competitor, and the gap is smaller than it looks.` : ` ${top.name} is the one taking the calls you are missing.`) : ''}`;
  else headline = `Searching "${keyword}" from the business address, ${lead.business} shows up ${rankText(intel.rank)}.${top ? ` ${top.name} shows first.` : ''}`;

  return {
    v: PACK_VERSION, ready: true, at,
    business: lead.business || '', city: lead.city || '', state: lead.state || '', industry: info.label, keyword, headline,
    you, grid, competitors: comps, reasons, listings: lst, foundation, growth, compare, reviewMath, lost, urgency,
    site: intel.website && intel.website.ok ? { https: Boolean(intel.website.https), schema: Boolean(intel.website.schema), tel: Boolean(intel.website.tel), titleOk: Boolean(intel.website.titleHasCity && intel.website.titleHasService), speed: intel.speed?.score ?? null } : null,
    cadence: [
      { when: 'Month 1', title: 'Local SEO foundation', text: 'Fix the Google profile, listings and reviews found above. This is the base everything else sits on.' },
      { when: 'Months 2 and 3', title: 'Climb', text: 'Pages and links for the areas where you are weak, steady posts, steady reviews, and a monthly map so you see it move.' },
      { when: 'Every month', title: 'Branding call', text: 'We open this same analysis, show what moved, and decide the next step together once the foundation is working.' },
    ],
    note: 'Where you appear also depends on distance and relevance, so no one can promise a spot. You keep this analysis either way.',
  };
}

// The sentence a rep says when sending it.
export const sendLine = (p) => `Here is the free competitor analysis for ${p.business}. It shows who is getting the calls and exactly why.`;
