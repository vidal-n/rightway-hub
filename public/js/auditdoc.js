// The audit report document: one long, scrolling report for a lead, built only from what the research, scan and listing check found.
// Pure and shared (page, tests). Modeled on BrightLocal's Local Search Grid and Citation Tracker reports and Whitespark's local ranking reports:
// a summary, the scan per keyword, who holds the spots, a full citation table, then exact fixes and a plan. Every number comes from the data,
// nothing is invented, and nothing promises a spot on Google. Prices never appear here: the Proposal page has its own money section.
import { industryInfo, keywordFor, findProblems, top10Of, rankText, quoteFor } from './leadintel.js';
import { buildPack, whyThey } from './pack.js';
import { reviewTarget, gbpChecklist, ninetyDayPlan } from './fulfill.js';
import { sortedListings, LISTING_LABEL, parseListings } from './listings.js';
import { WEBSITE_SERVICE_IDS, WEBSITE_NEED_IDS, WEBSITE_PROBLEM_KEYS } from './plancopy.js';
import { INCLUDED_ALL, refFor } from './planref.js';
import { EXIT_TERMS } from './pitchflow.js';

export const AUDIT_VERSION = 1;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const parse = (v) => { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };
const plural = (n, w, p) => `${n} ${n === 1 ? w : p || `${w}s`}`;

// Exact solutions: for each problem the research can find, the specific steps that fix it. `ctx` carries the numbers.
// Plain words for the owner. No promises of a spot.
export function solutionFor(p, ctx = {}) {
  const { reviews = 0, gap = 0, perMonth = 8, leader = 'the leader', city = 'your area', keyword = 'your service', wrong = 0, offPage = null, points = null } = ctx;
  const S = {
    not_found: ['Find any existing profile for the business, or create a new one with the exact legal name, address and phone.', 'Verify it (video or postcard) and add Rightway as a Manager so work can start.', 'Fill every field: categories, services, hours, description, photos.'],
    unclaimed: ['Claim the profile and verify it with the owner.', 'Add Rightway as a Manager and keep the owner as Primary Owner.', 'Set the main category, secondary categories, services, hours and a 750 character description.'],
    not_top10: [
      `Fix the profile and listings first so Google trusts the business in ${city}.`,
      offPage ? `Publish pages for the ${offPage} of ${points} spots where you are off page one, one service plus one city per page.` : 'Publish a page for each service and each city you want to win.',
      `Build local links and listings to those pages so Google sees the business is real in ${city}.`,
      'Rescan every month and double down where the map moved.',
    ],
    not_top3: [
      'Close the review gap and rating gap shown against the leader.',
      'Match or beat the leader on the profile fields we can see: categories, services, photos, posts.',
      'Add pages and links aimed at the spots where you sit 4 to 10.',
    ],
    few_reviews: [`Set up the review link and the counter QR code on day one.`, `Ask every happy customer by text right after the job. The target is ${perMonth} new reviews a month.`, 'Reply to every review within 48 hours.'],
    low_rating: ['Reply to every low review calmly and offer to fix it offline.', 'Ask every happy customer right after the job so new 5 star reviews outweigh the old.', 'Never gate or buy reviews. Google removes them.'],
    review_gap: [`${gap || 'More'} reviews to pass ${leader}. At ${perMonth} a month that is about ${Math.max(1, Math.ceil((gap || perMonth) / perMonth))} months.`, 'Text the review link after every job, put the QR code at the counter, add it to invoices.', 'Reply to every review.'],
    no_hours: ['Set regular hours, holiday hours and special hours on the profile.', 'Match the same hours on the website and every major directory.'],
    few_photos: ['Upload at least 30 real photos: team, vehicles, finished jobs, storefront.', 'Add fresh job photos every month with the Google posts.'],
    no_website: ['Build a simple, fast site with a page per service and per city.', 'Link it from the Google profile with tracking so calls and clicks can be counted.'],
    no_https: ['Install an SSL certificate so the site loads with the lock, then redirect http to https.', 'Update the website link on the profile and in every directory.'],
    weak_title: [`Rewrite the homepage title to say the service and the city (for example "${keyword} in ${city}").`, 'Match the main heading and the first paragraph to the same words.'],
    no_schema: ['Add LocalBusiness schema with the exact name, address, phone, hours and services, tied to the Google profile.', 'Add review and service markup on the service pages.'],
    no_click_to_call: ['Make the phone number a tap to call link in the header and the footer.', 'Add a sticky call button on mobile.'],
    site_down: ['Find why the site does not load (hosting, DNS, certificate) and fix it first.', 'Set up uptime alerts so it never goes quiet again.'],
    slow_site: ['Compress and resize images, turn on caching, remove blocking scripts.', 'Retest on mobile and keep the score above 50.'],
    grid_weak: ['Fix the listings and profile first.', 'Publish pages and links for the spots where the map is red.', 'Rescan monthly and move effort toward what moved.'],
  };
  const steps = S[p.key] || (p.fix ? [p.fix] : []);
  return { key: p.key, severity: p.severity, title: p.title, detail: p.detail, steps, site: WEBSITE_PROBLEM_KEYS.includes(p.key), wrong };
}

// What it takes to pass one competitor, using only numbers we have for both sides.
export function passPlan(c, you, grid, rm) {
  const out = [];
  if (c.reviews != null && you.reviews != null) {
    const gap = c.reviews - you.reviews + 1;
    if (gap > 0) {
      const per = Math.max(4, Math.ceil(gap / 6));
      out.push(`Reviews: collect ${plural(gap, 'more review')} to pass ${c.reviews}. About ${per} a month, every one answered, is roughly ${Math.ceil(gap / per)} months.`);
    } else out.push(`Reviews: you already have more (${you.reviews} vs ${c.reviews}). Keep asking so the lead stays.`);
  }
  if (c.rating != null && you.rating != null && c.rating - you.rating >= 0.1) out.push(`Rating: ${c.rating.toFixed(1)} vs your ${you.rating.toFixed(1)}. Fresh 5 star reviews and a reply to every low one close it.`);
  if (c.category && you.category && c.category.toLowerCase() !== you.category.toLowerCase()) out.push(`Category: they use "${c.category}". Yours is "${you.category}". Check yours is the one customers search for and add the right secondary categories.`);
  if (grid && grid.points && c.wins) out.push(`Map: they hold the top 3 in ${c.wins} of ${grid.points} spots, you hold ${grid.top3 ?? 0}. Pages and links aimed at those spots are how you take them.`);
  if (c.domain) out.push(`Website: they have one (${c.domain}). Match it with a page per service and city, and build links to those pages.`);
  out.push('Profile: match every field they fill in (services, description, photos, weekly posts). Distance and relevance also decide who shows first, so this narrows the gap and cannot guarantee a spot.');
  return out;
}

// The per job calculator: the owner's own numbers in, the monthly math out. An estimate, never a promise.
export function jobCalc({ ticket, jobs, monthly, setup = 0, closePct = null }) {
  const t = Math.max(0, Number(ticket) || 0);
  const j = Math.max(0, Number(jobs) || 0);
  const m = Math.max(0, Number(monthly) || 0);
  const s = Math.max(0, Number(setup) || 0);
  const revenue = t * j;
  const jobsToCover = t > 0 && m > 0 ? Math.ceil(m / t) : null;
  const firstToCover = t > 0 && (m + s) > 0 ? Math.ceil((m + s) / t) : null;
  return {
    revenue, yearly: revenue * 12,
    costPerJob: j > 0 && m > 0 ? m / j : null,
    multiple: m > 0 ? revenue / m : null,
    jobsToCover, firstToCover,
    net: m > 0 ? revenue - m : null,
    closePct,
  };
}

export const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

// The whole report. `quote` is the saved lead quote (or null). `opts.site` shows website findings (closer toggle, off by default).
export function buildAudit(lead = {}, { intel = null, listings = null, deepScan = null, quote = null, rep = '', at = Date.now() } = {}) {
  intel = parse(intel); listings = parseListings(listings); deepScan = parse(deepScan);
  const pack = buildPack(lead, { intel, listings, deepScan, at });
  if (!pack.ready) return { v: AUDIT_VERSION, ready: false, business: lead.business || '', reason: pack.reason };
  const L = intel.listing || {};
  const info = industryInfo(lead.industry, L.category || lead.category);
  const keyword = keywordFor(lead, intel);
  const rt = reviewTarget(intel);
  const you = pack.you;
  const grid = pack.grid;
  const probs = findProblems(intel, lead);

  // Scans: one per saved keyword (the deep scan), else the research grid.
  const deep = (deepScan?.scans || []).filter((s) => s?.cells?.length);
  const scans = deep.length
    ? deep.map((s) => ({ keyword: s.keyword, size: s.size, radiusMiles: s.radiusMiles, points: s.points, top10: s.top10 ?? top10Of(s), top3: s.top3 ?? 0, avg: s.avg ?? null, cells: s.cells.map((c) => (c.error ? -1 : c.rank ?? 0)), deep: true }))
    : grid ? [{ keyword: grid.keyword || keyword, size: grid.size, radiusMiles: grid.radiusMiles, points: grid.points, top10: grid.top10, top3: grid.top3, avg: grid.avg, cells: grid.cells, deep: false }] : [];

  const ls = listings?.results?.length ? listings : null;
  const wrong = ls ? (ls.counts?.mismatch || 0) + (ls.counts?.missing || 0) : 0;
  const ctx = { reviews: you.reviews ?? 0, gap: rt.gap, perMonth: rt.perMonth, leader: rt.leader || 'the leader', city: lead.city || 'your area', keyword, wrong, offPage: grid && grid.points ? grid.points - (grid.top10 || 0) : null, points: grid?.points ?? null };

  const competitors = pack.competitors.map((c) => ({ ...c, pass: passPlan(c, you, grid, pack.reviewMath) }));
  const fixes = probs.map((p) => solutionFor(p, ctx));
  if (wrong) fixes.push({ key: 'citations', severity: wrong >= 5 ? 'high' : 'medium', title: `${wrong} of ${ls.results.length} directories are wrong or missing`, detail: 'Google checks your name, address and phone across directories before it trusts you.', steps: ['Correct every directory listed in the citations table, starting with the red rows.', 'Use one exact name, address and phone everywhere, matching the Google profile.', 'Claim the listings so nobody else can change them, then recheck every month.'], site: false });

  const citations = ls ? {
    checked: ls.results.length, counts: ls.counts || {},
    rows: sortedListings(ls).map((r) => ({ name: r.name, status: r.status, label: LISTING_LABEL[r.status]?.[1] || '', tone: LISTING_LABEL[r.status]?.[0] || 'gray', note: r.notes?.length ? r.notes.join('. ') : r.status === 'missing' ? 'No listing found' : r.status === 'match' ? 'Name and details match' : r.status === 'found' ? 'Listed, check details' : r.error || '', url: r.url || '' })),
  } : null;

  const Q = quoteFor(lead, intel, quote);
  const services = Q.services.map((s) => ({ id: s.id, name: s.name, what: s.what, why: s.why, qty: s.qty, unit: s.unit || '', site: WEBSITE_SERVICE_IDS.includes(s.id), need: WEBSITE_NEED_IDS.includes(s.id) }));
  const qtyOf = (id) => Q.services.find((x) => x.id === id)?.qty;
  const nd = ninetyDayPlan(Q.plan, intel, lead, { posts: qtyOf('posts'), pages: qtyOf('pages') || 0, links: qtyOf('links') || 0 });
  const ref = refFor(Q.services.map((x) => ({ id: x.id, qty: x.qty })));

  const kws = [...new Set([...scans.map((s) => s.keyword), keyword].filter(Boolean))].slice(0, 5);
  const weakest = [...scans].sort((a, b) => (a.top10 / (a.points || 1)) - (b.top10 / (b.points || 1)))[0] || null;
  const summary = [
    grid ? `First page (top 10) in ${grid.top10} of ${grid.points} spots for "${grid.keyword || keyword}", top 3 in ${grid.top3}.` : `At the business address you show up ${rankText(intel.rank)} for "${keyword}".`,
    competitors[0] ? `${competitors[0].name} is the strongest competitor${competitors[0].reviews != null && you.reviews != null ? `, with ${competitors[0].reviews} reviews against your ${you.reviews}` : ''}.` : '',
    wrong ? `${wrong} of ${ls.results.length} directories Google checks are wrong or missing.` : ls ? `All ${ls.results.length} directories we checked match.` : '',
    fixes.filter((f) => f.severity === 'high').length ? `${plural(fixes.filter((f) => f.severity === 'high').length, 'high priority fix', 'high priority fixes')} found.` : '',
  ].filter(Boolean);

  return {
    v: AUDIT_VERSION, ready: true, at, rep,
    business: lead.business || '', contact: lead.contact_name || '', city: lead.city || '', state: lead.state || '', industry: info.label, ticket: info.ticket || 0,
    keyword, keywords: kws, headline: pack.headline, summary,
    profile: { name: L.title || lead.business, category: L.category || lead.category || info.label, phone: L.phone || lead.phone || '', address: L.address || '', website: L.url || lead.website || '', rating: you.rating, reviews: you.reviews, photos: you.photos, claimed: you.claimed },
    scans, weakest: weakest ? weakest.keyword : null,
    competitors, compare: pack.compare, reviewMath: pack.reviewMath, lost: pack.lost, urgency: pack.urgency,
    checklist: gbpChecklist(intel),
    citations, fixes,
    foundation: pack.foundation, growth: pack.growth,
    site: pack.site,
    services, ninety: nd.months, fixWeeks: nd.fixes.map((f) => ({ week: f.week, title: f.title })),
    plan: { name: ref.name, why: ref.why.filter((w) => !/website/i.test(w)), included: INCLUDED_ALL.map((i) => ({ name: i.name, what: i.what })), exit: EXIT_TERMS },
    quote: { setup: Q.setup, monthly: Q.monthly, anchor: Q.anchor, drop: Q.drop, saved: Q.saved },
    cadence: pack.cadence, note: pack.note,
  };
}

// Section list for the sticky nav. A section with nothing behind it is left out.
export function sectionsOf(a) {
  if (!a?.ready) return [];
  const s = [['summary', 'Summary'], ['scan', 'Map scan'], ['ahead', 'Who is ahead'], ['passing', 'How to pass them'], ['profile', 'Google profile'], ['citations', 'Citations'], ['fixes', 'Exact fixes'], ['plan', 'Game plan'], ['roadmap', '90 days']];
  return s.filter(([k]) => (k === 'scan' ? a.scans.length : k === 'ahead' || k === 'passing' ? a.competitors.length : k === 'citations' ? true : true));
}

export { whyThey };
