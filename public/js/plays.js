// Lead plays (Nov 2026, V: the best lead scraping strategy for what we sell, with templates, guides and budgets).
// A play is a ready-made search: which trades, which filters, how wide, how much it costs, and a plain explanation of who it finds,
// why they tend to buy local SEO, and how to open the call. Pure (no browser or server calls) so the page and Node tests share it.
//
// Built after (the concepts, not their code):
//  - Scrap.io: filter a whole market by claimed or unclaimed profile, rating, review count, website and social presence, then export.
//  - Apify "Local SEO Lead Finder": score every profile for weakness and list the weakest first (the best prospects for a local SEO offer).
//  - Agency prospecting guides (dev.to "Find businesses without websites", Prospeo "Google Maps lead scraper"): no website is the strongest need signal,
//    low rating with enough reviews, owners who ignore reviews, filter for need first, then enrich and verify before outreach, reach owners not info@ inboxes.
//  - Apollo.io saved searches: save a search once, run it again with one click (My plays).
// Meters and "expect" lines are guidance from how these businesses behave, NOT measured statistics. Tag every run and compare tags in the Pipeline.
import { estimate } from './finder.js';

export const TOOLS = [
  { name: 'Scrap.io', url: 'https://scrap.io', what: 'claimed or unclaimed, rating, reviews and website filters across a whole market' },
  { name: 'Outscraper', url: 'https://outscraper.com', what: 'Google Maps export with enrichment (email, owner) added after the scrape' },
  { name: 'Apify Local SEO Lead Finder', url: 'https://apify.com/acebuilds/local-seo-lead-finder', what: 'scores profile weakness and lists the weakest first' },
  { name: 'Prospeo guide to Google Maps lead scrapers', url: 'https://prospeo.io/s/google-maps-lead-scraper', what: 'filter for need, enrich, verify, reach owners not info@ inboxes' },
  { name: 'Apollo.io', url: 'https://www.apollo.io', what: 'saved searches you run again with one click' },
];

// Home turf first: Miami and Fort Lauderdale are where the team is, so calls are local and meetings are easy.
export const SOUTH_FLORIDA = ['Miami', 'Fort Lauderdale', 'Hollywood', 'Hialeah', 'Pembroke Pines', 'Miramar', 'Coral Springs', 'Pompano Beach', 'Boca Raton', 'West Palm Beach', 'Doral', 'Homestead'];

// Budget levels every play offers. `places` is how many cities, `size` the grid per city (3 x 3, 5 x 5, 7 x 7 map views).
export const BUDGETS = [
  { id: 'lean', label: 'Lean', places: 3, size: 3, what: 'Test the play on three cities. Small spend, results in minutes.' },
  { id: 'standard', label: 'Standard', places: 5, size: 5, what: 'Five cities, a full grid each. A real week of calls.' },
  { id: 'deep', label: 'Deep', places: 10, size: 7, what: 'Ten cities, a dense grid. When the play has proven itself.' },
];

// Trades where one new customer is worth months of our fee, and trades where the phone rings at the moment of need.
const HIGH = ['roofing contractor', 'ac repair', 'plumber', 'electrician', 'foundation repair', 'solar company', 'water damage restoration', 'garage door repair', 'remodeling contractor', 'concrete contractor'];
const URGENT = ['towing service', 'locksmith', 'water damage restoration', 'plumber', 'ac repair', 'garage door repair', 'pest control', 'tree service'];
const SMALL = ['handyman', 'painter', 'pressure washing', 'landscaping company', 'cleaning service', 'junk removal', 'tree service', 'pool service', 'fence company', 'carpet cleaning'];
const PRACTICE = ['dentist', 'chiropractor', 'physical therapy', 'med spa', 'plastic surgeon', 'personal injury lawyer', 'cpa'];
const BASICS = ['roofing contractor', 'ac repair', 'plumber', 'electrician', 'pest control', 'garage door repair', 'landscaping company', 'cleaning service'];

const CHAINS = ['Home Depot', "Lowe's", 'Walmart', 'Target', 'Best Buy', 'Costco', "Sam's Club", 'Menards', 'Ace Hardware', 'Sherwin-Williams', 'Staples', 'Harbor Freight'];
const f = (o) => ({ minReviews: null, maxReviews: null, minRating: null, maxRating: null, website: 'any', phone: 'has', claimed: 'any', category: '', exclude: CHAINS.join(', '), ...o });

export const PLAYS = [
  {
    id: 'almost', name: 'Almost page one', badge: 'Best for booking', goals: ['book'],
    who: 'Established local businesses with real customers and a website, sitting just below the map pack.',
    why: 'They already have proof (reviews, a rating, a site) and an owner who cares, so the Google clarity audit lands. Weakness is in how they are set up, not in the business. This is the audience our scan and ranking grid were built for.',
    expect: 'Medium volume. The most conversations that turn into a booked audit. Research them at Lite after you add them, then use the Pipeline list "Not on page one" to call the ones ranked 4 to 15 first.',
    open: 'Lead with the map: "You show up at number 7 around Doral. The three above you have fewer years than you." Offer the free competitor analysis.',
    after: ['Add to the Pipeline', 'Research (Lite) the ones you will call', 'Call list: Not on page one'],
    industries: BASICS, filters: f({ minReviews: 15, maxReviews: 120, minRating: 4, website: 'has' }), source: 'google', list: 'page2',
    meters: { book: 3, reach: 2, deal: 3, volume: 2 }, refs: ['Scrap.io', 'Apify Local SEO Lead Finder'],
  },
  {
    id: 'nosite', name: 'Profile but no website', badge: 'Strongest need signal', goals: ['book', 'reach'],
    who: 'Businesses with a Google profile and real reviews but no website.',
    why: 'No website is the strongest "needs help" signal in agency prospecting guides, and it still shows they have customers (reviews). Easy to explain, easy to prove: search their name and show what is missing.',
    expect: 'Medium volume, usually smaller shops where the owner answers. Deal size is smaller at first. Website is sold as its own service after results, so open with the Google profile and a free look at the website gap.',
    open: '"I looked you up on Google and noticed you have great reviews but no website. When people search for you, where do they go?"',
    after: ['Add to the Pipeline', 'Call list: No website', 'Use the Game Plan script (website audit)'],
    industries: HIGH.slice(0, 8), filters: f({ minReviews: 10, minRating: 3.8, website: 'none' }), source: 'google', list: 'nosite',
    meters: { book: 3, reach: 3, deal: 2, volume: 2 }, refs: ['Scrap.io', 'Apify Local SEO Lead Finder', 'Prospeo guide to Google Maps lead scrapers'],
  },
  {
    id: 'unclaimed', name: 'Unclaimed profile', badge: 'Easiest opener', goals: ['reach', 'book'],
    who: 'Businesses whose Google profile nobody has claimed.',
    why: 'Claimed versus unclaimed is a core filter in market scrapers like Scrap.io. An unclaimed profile means the owner has never touched it, so the gap is obvious and the first fix (claim and verify it) is something they cannot argue with.',
    expect: 'Lower volume (most profiles are claimed) but a very clear opener. Google does not always report claimed status, so businesses with an unknown status are left out rather than guessed.',
    open: '"Your Google profile is not claimed, which means anyone can suggest changes to it. Has someone on your team set it up?"',
    after: ['Add to the Pipeline', 'Research (Lite)', 'Call list: Likely owner picks up'],
    industries: BASICS, filters: f({ minReviews: 3, claimed: 'unclaimed' }), source: 'google', list: 'small',
    meters: { book: 2, reach: 3, deal: 2, volume: 1 }, refs: ['Scrap.io'],
  },
  {
    id: 'hightrade', name: 'High ticket trades', badge: 'Biggest deals', goals: ['book'],
    who: 'Roofing, HVAC, plumbing, electrical, foundation, solar, restoration and remodeling companies with some reviews.',
    why: 'One new job is worth thousands, so our monthly fee pays for itself with one extra customer. That makes the math easy on the call. These trades also spend on marketing already.',
    expect: 'Medium volume. Owners are busy and gatekeepers are common, so expect more voicemails. Best when you can say one specific number from their scan.',
    open: '"One roofing job covers a year of this. Right now three companies take the calls you could be getting around Hialeah."',
    after: ['Add to the Pipeline', 'Research (Standard) the A leads', 'Call list: Likely owner picks up'],
    industries: HIGH, filters: f({ minReviews: 10, maxReviews: 150, minRating: 3.8 }), source: 'google', list: 'small',
    meters: { book: 2, reach: 2, deal: 3, volume: 3 }, refs: ['Scrap.io', 'Outscraper'],
  },
  {
    id: 'emergency', name: 'Emergency and urgent', badge: 'Easy to reach', goals: ['reach'],
    who: 'Towing, locksmith, restoration, plumbing, AC, garage door, pest and tree services.',
    why: 'People search these at the moment of need and call the first few results, so ranking in the top three is worth the most here. These owners answer their phones all day because missed calls cost them jobs, which also helps with phone menus.',
    expect: 'High volume and the best pick up rate. Some are franchises or dispatch companies that bounce you around, so use the "Likely owner picks up" list.',
    open: '"When someone floods their kitchen at 9 at night they call whoever is on top. Where do you show up on the map for that?"',
    after: ['Add to the Pipeline', 'Call list: Likely owner picks up', 'Call mornings and early evenings'],
    industries: URGENT, filters: f({ minReviews: 5, maxReviews: 120 }), source: 'google', list: 'small',
    meters: { book: 2, reach: 3, deal: 2, volume: 3 }, refs: ['Scrap.io'],
  },
  {
    id: 'reputation', name: 'Reputation gap', badge: 'Clear pain', goals: ['book'],
    who: 'Businesses with enough reviews to matter but a rating under 4.3.',
    why: 'Low rating with a real review count is a concrete, felt problem. Prospecting guides also flag owners who never reply to reviews as the strongest signal of an absent owner.',
    expect: 'Lower volume. Conversations are more sensitive, so lead with how to get more happy customers to review, not with what is wrong. Check their review replies by hand before calling.',
    open: '"Your work looks solid. Most reviews are 5 stars, but a few older ones drag the average to 4.1. Want to see how to push that up?"',
    after: ['Add to the Pipeline', 'Research (Lite)', 'Open their Google reviews before the call'],
    industries: BASICS, filters: f({ minReviews: 15, maxRating: 4.2 }), source: 'google', list: 'few',
    meters: { book: 2, reach: 2, deal: 2, volume: 1 }, refs: ['Apify Local SEO Lead Finder', 'Prospeo guide to Google Maps lead scrapers'],
  },
  {
    id: 'smallshops', name: 'Owner run basics', badge: 'Cheap and quick', goals: ['reach', 'cheap'],
    who: 'One truck and one crew trades: handyman, painting, pressure washing, landscaping, cleaning, junk removal, pool and fencing.',
    why: 'The owner picks up their own phone, so you skip phone menus and gatekeepers. Fewer reviews means they are easy to move up.',
    expect: 'High volume, fastest conversations, smaller budgets. Good for warming up a new rep and for filling the day.',
    open: '"Quick question, are you the owner? I ran a quick check on how you show up around Miramar and wanted to show you what I found."',
    after: ['Add to the Pipeline', 'Call list: Mobile numbers', 'Use the cold call script'],
    industries: SMALL, filters: f({ minReviews: 5, maxReviews: 60 }), source: 'google', list: 'mobile',
    meters: { book: 2, reach: 3, deal: 1, volume: 3 }, refs: ['Scrap.io', 'Outscraper'],
  },
  {
    id: 'fresh', name: 'New and growing', badge: 'Open to help', goals: ['reach'],
    who: 'Newer profiles with a few great reviews and a strong rating, still building.',
    why: 'They have just started, are the most open to a plan, and have no old agency. Few reviews means the starting gap is easy to show.',
    expect: 'Medium volume, small budgets at first. Pair with the free "New businesses (state filings)" card further down for states that publish filings.',
    open: '"Congrats on getting started. You have strong early reviews. Most new businesses need about three things in place to get found. Do you have a minute?"',
    after: ['Add to the Pipeline', 'Call list: Under 20 reviews', 'Check the state filings card for brand new companies'],
    industries: BASICS.concat(['painter', 'handyman']), filters: f({ minReviews: 1, maxReviews: 20, minRating: 4.5 }), source: 'google', list: 'few',
    meters: { book: 2, reach: 2, deal: 1, volume: 2 }, refs: ['Scrap.io'],
  },
  {
    id: 'practices', name: 'Health and professional', badge: 'Highest lifetime value', goals: ['book'],
    who: 'Dentists, chiropractors, physical therapy, med spas, plastic surgeons, injury lawyers and CPAs with a decent review count.',
    why: 'A single new patient or client is worth a lot over time and local search drives most of their new customers. Owners think in terms of new patients a month, which makes the offer easy to price.',
    expect: 'Medium volume. Front desks screen calls, so ask for the owner or practice manager by name once the scrub has it. Longer sales cycle, bigger retainers.',
    open: '"I help practices around Fort Lauderdale get more new patient calls from Google. I ran a quick check on yours and found three things."',
    after: ['Add to the Pipeline', 'Run Fill in missing info for owner names', 'Call list: Owner name known'],
    industries: PRACTICE, filters: f({ minReviews: 10, maxReviews: 200, minRating: 3.8 }), source: 'google', list: 'owner',
    meters: { book: 2, reach: 1, deal: 3, volume: 2 }, refs: ['Scrap.io', 'Outscraper'],
  },
  {
    id: 'nogbp', name: 'No Google profile (free hunt)', badge: 'Free search', goals: ['cheap', 'reach'],
    who: 'Businesses that may not be on Google at all, found on OpenStreetMap.',
    why: 'Google Maps searches can only return businesses that are on Google, so they can never find the ones that are not. These are the biggest gap of all.',
    expect: 'The search is free but thin: no ratings, and many small businesses are missing. After you add them, run Research (Lite) on the ones you plan to call (about $0.002 to $0.004 each). Anything Google does not find becomes "None found" in the Pipeline Google profile filter.',
    open: '"When I search for your company on Google Maps I could not find a profile. Do customers ever tell you they cannot find you online?"',
    after: ['Add to the Pipeline', 'Research (Lite) the ones you will call', 'Pipeline filter: Google profile, None found'],
    industries: SMALL.slice(0, 4).concat(['roofing contractor', 'plumber']), filters: f({ website: 'any' }), source: 'osm', list: 'nogbp',
    meters: { book: 2, reach: 2, deal: 2, volume: 1 }, refs: ['Apollo.io'],
  },
];
export const playById = (id) => PLAYS.find((p) => p.id === id);

// How many cities a budget level searches, and what it costs for a play.
export function planFor(play, budgetId, { states = 1 } = {}) {
  const b = BUDGETS.find((x) => x.id === budgetId) || BUDGETS[0];
  const osm = play.source === 'osm';
  const size = osm ? { 3: 1, 5: 3, 7: 3 }[b.size] : b.size;
  const places = b.places * Math.max(1, states);
  const e = estimate({ areas: places, size, keywords: play.industries.length, source: play.source });
  return { budget: b, size, places, requests: e.requests, cost: e.cost, free: osm };
}
// Cities for a budget level: South Florida first, then each state's own biggest cities.
export const southFloridaAreas = (n) => SOUTH_FLORIDA.slice(0, n).map((c) => `${c}, FL`);

// ---------- weakness: how much a profile needs help (higher = better prospect) ----------
// Follows the idea of weakest first ranking: missing website, unclaimed, few reviews, a weak rating, few photos and no hours are gaps we can fix.
export function weakness(r) {
  let score = 0; const why = [];
  const reviews = Number(r.reviews) || 0;
  if (!r.website) { score += 30; why.push('no website'); }
  if (r.claimed === false) { score += 15; why.push('not claimed'); }
  if (r.source !== 'osm') {
    if (reviews < 10) { score += 15; why.push('under 10 reviews'); } else if (reviews < 25) { score += 10; why.push('under 25 reviews'); } else if (reviews < 50) score += 5;
    if (r.rating != null && reviews >= 5 && r.rating < 4) { score += 15; why.push(`rating ${r.rating.toFixed(1)}`); } else if (r.rating != null && reviews >= 5 && r.rating < 4.4) { score += 8; why.push(`rating ${r.rating.toFixed(1)}`); }
    if (r.photos != null && r.photos < 5) { score += 10; why.push('few photos'); }
  }
  return { score: Math.min(100, score), why };
}
// A business only counts as a prospect when it has some life (reviews or a website) so empty junk listings do not float to the top.
export const gapLabel = (s) => (s >= 60 ? 'Big gap' : s >= 35 ? 'Gap' : 'Small gap');

// ---------- guide lines: what the picks will likely give you ----------
export function readFilters(filters, source = 'google') {
  const c = { minReviews: null, maxReviews: null, minRating: null, maxRating: null, website: 'any', claimed: 'any', ...filters };
  const out = [];
  if (source === 'osm') {
    out.push('OpenStreetMap has no ratings, reviews or claimed status, so those filters do nothing here. You get a free, wide list of businesses, many of which may not be on Google. Check them with Research (Lite) after adding.');
    if (c.website === 'none') out.push('No website: the strongest need signal.');
    return out;
  }
  if (c.website === 'none') out.push('No website: the strongest need signal. Smaller shops, owners often answer. Easy to prove on the call.');
  if (c.website === 'has') out.push('Has a website: more established, and you can read their site for services and owner names.');
  if (c.claimed === 'unclaimed') out.push('Not claimed: a clear opener, but fewer results because most profiles are claimed.');
  const lo = c.minReviews, hi = c.maxReviews;
  if (hi != null && hi <= 25) out.push('Up to 25 reviews: newer or quiet profiles, easy to move up, smaller budgets.');
  else if (lo != null && lo >= 15 && (hi == null || hi <= 150)) out.push('15 to 150 reviews: established businesses with proof, the sweet spot for our audit.');
  else if (lo != null && lo >= 100) out.push('100 or more reviews: strong profiles, usually already ranking. Harder to show a gap, more likely to have an agency.');
  if (c.maxRating != null && c.maxRating <= 4.3) out.push('Rating 4.3 or less: a felt reputation problem. Lead gently.');
  if (c.minRating != null && c.minRating >= 4.5) out.push('Rating 4.5 or more: happy customers, newer or very small. Good momentum to build on.');
  if (!out.length) out.push('Wide open filters: the biggest list, but the least targeted. Add at least a review range and a website choice so calls go to people who need us.');
  return out;
}
export function readIndustries(keywords = []) {
  const k = keywords.map((x) => String(x).toLowerCase());
  const hit = (list) => list.filter((x) => k.includes(x)).length;
  const out = [];
  if (!k.length) return ['Pick the trades you want to call. High ticket trades, emergency trades and health practices each give a different kind of conversation.'];
  if (hit(HIGH) >= Math.max(1, Math.ceil(k.length / 2))) out.push('High ticket trades: one new job covers months of our fee. Owners are busy, so keep the call short.');
  if (hit(URGENT) >= Math.max(1, Math.ceil(k.length / 2))) out.push('Emergency trades: they answer phones all day and feel every missed call.');
  if (hit(PRACTICE) >= Math.max(1, Math.ceil(k.length / 2))) out.push('Practices: very high lifetime value per client, but front desks screen calls.');
  if (hit(SMALL) >= Math.max(1, Math.ceil(k.length / 2))) out.push('One crew trades: the owner picks up. Smaller deals, quick conversations.');
  if (k.length > 10) out.push(`${k.length} industries start as ${Math.ceil(k.length / 10)} searches. Fewer industries means less to review.`);
  return out.length ? out : ['A mix of trades. That is fine, but a play with one kind of trade is easier to call and to compare later.'];
}

// ---------- my plays (saved on this device) ----------
export function cleanMine(p = {}) {
  const s = (v, n) => String(v || '').trim().slice(0, n);
  const ok = (v, list, d) => (list.includes(v) ? v : d);
  const arr = (v, n) => (Array.isArray(v) ? v.map((x) => s(x, 60)).filter(Boolean).slice(0, n) : []);
  return {
    id: s(p.id, 40) || `mine-${Date.now().toString(36)}`, name: s(p.name, 60) || 'My play', mine: true, badge: 'Mine', goals: [],
    who: s(p.who, 300) || 'A search you saved.', why: '', expect: '', open: '', after: ['Add to the Pipeline'],
    industries: arr(p.industries, 40), filters: f(p.filters || {}), source: ok(p.source, ['google', 'osm'], 'google'),
    areas: arr(p.areas, 60), size: ok(Number(p.size), [1, 3, 5, 7, 9], 5), list: '', meters: { book: 0, reach: 0, deal: 0, volume: 0 }, refs: [],
  };
}
