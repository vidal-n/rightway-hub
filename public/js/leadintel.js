import { discoveryFor } from './discovery.js';
import { LISTEN, ANALYSIS_ML, ML, catalogRows, ML_RULES } from './rebuttals.js';
import { parseListings } from './listings.js';
import { isPersonName, titleLike } from './names.js';
import { SERVICE_LIST } from './plancopy.js';
import { SCOPE, unitOf, hasQty, clampQty, tierOf, dollars } from './scope.js';
import { refFor, photosFor } from './planref.js';
// Lead intelligence: scoring, problems found, the scope of work built from the research, call script, dedupe keys.
// Pure functions with no DOM or network, shared by the Worker, the Hub screens, and the tests.

// ---------- industries ----------
// ticket = typical value of one new customer, used only as an editable starting point on the ROI slide.
const INDUSTRIES = [
  [/roof/i, 'Roofing', 'roofing contractor', 8000],
  [/hvac|air cond|\bac\b|heating|cooling/i, 'HVAC', 'ac repair', 650],
  [/plumb/i, 'Plumbing', 'plumber', 450],
  [/electric/i, 'Electrical', 'electrician', 450],
  [/dent|orthodon/i, 'Dental', 'dentist', 1200],
  [/plastic surg|cosmetic surg/i, 'Plastic surgery', 'plastic surgeon', 8000],
  [/\bcpa\b|account|bookkeep/i, 'Accounting', 'cpa', 1500],
  [/\btax\b|tax prep/i, 'Tax preparation', 'tax preparer', 400],
  [/financ|wealth|investment advis|retirement plan/i, 'Financial advisor', 'financial advisor', 5000],
  [/septic/i, 'Septic', 'septic service', 600],
  [/foundation/i, 'Foundation repair', 'foundation repair', 8000],
  [/injury|accident lawyer|accident attorney/i, 'Personal injury law', 'personal injury lawyer', 15000],
  [/law|attorney|lawyer|legal/i, 'Law firm', 'lawyer', 5000],
  [/med ?spa|botox|aesthetic|laser/i, 'Med spa', 'med spa', 600],
  [/chiro/i, 'Chiropractic', 'chiropractor', 900],
  [/physical therap|\bpt\b/i, 'Physical therapy', 'physical therapy', 900],
  [/auto ?(repair|shop|body)|mechanic|collision|transmission/i, 'Auto repair', 'auto repair shop', 500],
  [/tow/i, 'Towing', 'towing service', 150],
  [/landscap|lawn/i, 'Landscaping', 'landscaping company', 300],
  [/tree/i, 'Tree service', 'tree service', 900],
  [/pest|extermin|termite/i, 'Pest control', 'pest control', 250],
  [/pool/i, 'Pool service', 'pool service', 300],
  [/garage door/i, 'Garage doors', 'garage door repair', 500],
  [/locksmith/i, 'Locksmith', 'locksmith', 150],
  [/mov(er|ing)/i, 'Moving', 'movers', 1200],
  [/clean|maid|janitor/i, 'Cleaning', 'cleaning service', 200],
  [/carpet/i, 'Carpet cleaning', 'carpet cleaning', 250],
  [/pressure wash|power wash/i, 'Pressure washing', 'pressure washing', 300],
  [/junk|haul/i, 'Junk removal', 'junk removal', 350],
  [/paint/i, 'Painting', 'painter', 3000],
  [/remodel|renovat|kitchen|bath|general contractor|construction/i, 'Remodeling', 'remodeling contractor', 15000],
  [/concrete|paving|asphalt/i, 'Concrete and paving', 'concrete contractor', 4000],
  [/fenc/i, 'Fencing', 'fence company', 4000],
  [/floor/i, 'Flooring', 'flooring', 3000],
  [/window|door/i, 'Windows and doors', 'window installation', 4000],
  [/solar/i, 'Solar', 'solar company', 20000],
  [/insur/i, 'Insurance', 'insurance agency', 1200],
  [/real estate|realtor|realty/i, 'Real estate', 'real estate agent', 8000],
  [/vet|animal hosp/i, 'Veterinary', 'veterinarian', 300],
  [/gym|fitness|crossfit|yoga|pilates/i, 'Fitness', 'gym', 600],
  [/salon|hair|barber|nail|spa/i, 'Salon and beauty', 'hair salon', 80],
  [/restaurant|cafe|pizza|grill|bar\b|taco|sushi|bakery|food/i, 'Restaurant', 'restaurant', 40],
  [/appliance/i, 'Appliance repair', 'appliance repair', 250],
  [/handyman/i, 'Handyman', 'handyman', 300],
  [/water damage|restoration|mold/i, 'Restoration', 'water damage restoration', 5000],
  [/storage/i, 'Self storage', 'storage units', 1000],
  [/accountant|cpa|tax|bookkeep/i, 'Accounting', 'accountant', 1500],
  [/doctor|clinic|medical|urgent care|dermatolog/i, 'Medical practice', 'doctor', 800],
];

// First page (top 10) spots in a lead's research grid. Older research has no top10 field, so count the cells.
export function top10Of(g) {
  if (!g) return 0;
  if (g.top10 != null) return g.top10;
  return (g.cells || []).filter((c) => !c.error && c.rank != null && c.rank <= 10).length;
}

// The industries the Hub knows how to score and pitch, for the Lead finder's picker: label, search keyword, typical ticket size and tier.
export const TARGET_INDUSTRIES = INDUSTRIES.map(([, label, keyword, ticket]) => ({ label, keyword, ticket, tier: ticket >= 3000 ? 'high' : ticket >= 400 ? 'mid' : 'low' }));
export function industryInfo(industry = '', category = '') {
  for (const text of [industry, category]) {
    if (!text) continue;
    for (const [re, label, keyword, ticket] of INDUSTRIES) {
      if (re.test(text)) return { label, keyword, ticket, tier: ticket >= 3000 ? 'high' : ticket >= 400 ? 'mid' : 'low' };
    }
  }
  const kw = String(category || industry || '').trim().toLowerCase();
  return { label: industry || category || 'Local business', keyword: kw || null, ticket: 500, tier: 'unknown' };
}

// The search phrase we check rankings for.
export function keywordFor(lead = {}, intel = null) {
  if (intel?.keyword) return intel.keyword;
  const info = industryInfo(lead.industry, intel?.listing?.category || lead.category);
  return info.keyword || String(lead.industry || '').toLowerCase() || null;
}

// ---------- dedupe ----------
const GENERIC_HOSTS = /(^|\.)(facebook|fb|instagram|google|goo|yelp|business\.site|linktr|linkedin|twitter|x|tiktok|youtube|wixsite|godaddysites|square|squareup|nextdoor|angi|homeadvisor|thumbtack|bbb|yellowpages|mapquest)\./i;

export function normDomain(url) {
  const s = String(url || '').trim().toLowerCase();
  if (!s) return null;
  const host = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].split(':')[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
  if (GENERIC_HOSTS.test(`${host}.`) || GENERIC_HOSTS.test(host)) return null;
  return host;
}

export function normName(name) {
  return String(name || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(the|llc|l l c|inc|incorporated|co|company|corp|corporation|ltd|pllc|pa|services?|group)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function dupKeys(l) {
  const keys = [];
  const d = String(l.phone_digits || l.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  if (d.length >= 10) keys.push(`p:${d}`);
  const dom = normDomain(l.website);
  if (dom) keys.push(`d:${dom}`);
  const n = normName(l.business);
  const where = String(l.zip || l.city || '').toLowerCase().trim();
  if (n && where) keys.push(`n:${n}|${where}`);
  // Same business written two ways: "Bayside Roofing LLC" and "Bayside Roofing | Miami Roofer" are one lead in the same place.
  const core = normName(String(l.business || '').split(/\s[|:\u2013\u2014-]\s|\s[|]\s|\s-\s/)[0].replace(/\b(llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|pllc|pa|lp|llp)\b/gi, ' '));
  if (core && where) keys.push(`m:${core}|${where}`);
  return keys;
}

// ---------- problems ----------
const SEV_ORDER = { high: 0, medium: 1, low: 2 };

export function rankText(rank) {
  return rank ? `#${rank}` : 'not in the top 20';
}

export function findProblems(intel, lead = {}) {
  if (!intel) return [];
  const out = [];
  const L = intel.listing || {};
  const top = (intel.competitors || [])[0];
  const kw = intel.keyword || keywordFor(lead, intel);
  const add = (key, severity, title, detail, talk, fix) => out.push({ key, severity, title, detail, talk, fix });

  if (!intel.found) {
    add('not_found', 'high', 'No Google profile found', `We searched Google Maps for ${lead.business || 'the business'} and could not find a matching profile.`,
      `When I searched for you on Google Maps, I couldn't find your profile at all. That means people searching for ${kw || 'what you do'} can't find you there.`,
      'Find or create the profile, verify it, and build it out fully.');
    return out;
  }
  if (L.claimed === false) {
    add('unclaimed', 'high', 'Google profile looks unclaimed', 'Google shows the "Own this business?" prompt, so nobody is managing the profile.',
      "Your Google profile looks unclaimed, which means anyone can suggest edits to it and you can't post or reply to reviews.",
      'Claim and verify the profile, then optimize every field.');
  }
  const rank = intel.rank ?? null;
  if (kw && (rank == null || rank > 10)) {
    add('not_top10', 'high', `Not on the first page for "${kw}"`, `At your own address you show up ${rankText(rank)}.${top ? ` ${top.title} is #1.` : ''}`,
      `I searched "${kw}" right from your address and you came up ${rankText(rank)}.${top ? ` ${top.title} is showing first.` : ''} Most people never look past the first page of the map.`,
      'Profile optimization, local pages, citations, and steady reviews to get onto the first page, then climb it.');
  } else if (kw && rank > 3) {
    add('not_top3', 'medium', `#${rank} for "${kw}" at your address`, `On the first page at your own address, with ${rank - 1} businesses above you.${top ? ` ${top.title} is #1.` : ''}`,
      `I searched "${kw}" right from your address and you came up ${rankText(rank)}.${top ? ` ${top.title} is showing first.` : ''} Every spot higher on that list gets more of the calls.`,
      'Reviews, local pages, and links to climb past the businesses above you.');
  }
  if (intel.grid && intel.grid.points > 1) {
    const share = top10Of(intel.grid);
    if (share / intel.grid.points < 0.5) {
      add('grid_weak', share === 0 ? 'high' : 'medium', `First page in only ${share} of ${intel.grid.points} nearby spots`,
        `We checked ${intel.grid.points} points within ${intel.grid.radiusMiles} miles of the business. Average rank ${intel.grid.avg ?? 'outside the top 20'}.`,
        `A mile or two from your shop, you drop off the first page in ${intel.grid.points - share} of the ${intel.grid.points} spots we checked. That's where your competitors are picking up your calls.`,
        'Service area pages, citations, and posts aimed at the weak areas.');
    }
  }
  const reviews = L.reviews ?? 0;
  if (top && top.reviews && top.reviews > Math.max(10, reviews * 1.5)) {
    const gap = top.reviews - reviews;
    add('review_gap', gap > 100 ? 'high' : 'medium', `${gap} reviews behind ${top.title}`, `${top.title} has ${top.reviews} reviews. You have ${reviews}.`,
      `${top.title} has ${top.reviews} reviews and you have ${reviews}. Google and customers both weigh that heavily.`,
      'Review request texts and the counter QR code so every happy customer gets asked.');
  } else if (reviews < 25) {
    add('few_reviews', 'medium', `Only ${reviews} Google reviews`, 'Under 25 reviews makes it hard to win the click even when you show up.',
      `You have ${reviews} reviews. Getting that past 50 is one of the fastest ways to win more of the calls you already show up for.`,
      'Review request system set up on day one.');
  }
  if (L.rating != null && L.rating < 4.3) {
    add('low_rating', L.rating < 4 ? 'high' : 'medium', `Rating ${L.rating.toFixed(1)}`, 'Below 4.3 stars loses clicks to higher rated competitors.',
      `Your rating is ${L.rating.toFixed(1)}. Most people filter for 4 stars and up, so a few more fresh 5-star reviews makes a real difference.`,
      'Steady new reviews and replies to every review.');
  }
  if (L.hours === false) add('no_hours', 'medium', 'Hours missing on Google', 'Profiles without hours rank and convert worse.', "Your hours aren't on your Google profile, so Google is less likely to show you when people search.", 'Add hours, holiday hours, and attributes.');
  if (L.photos != null && L.photos < 20) add('few_photos', 'low', `Only ${L.photos} photos on the profile`, 'Profiles with fresh photos get more actions.', `You have ${L.photos} photos up. Fresh job photos every month help you stand out.`, 'Monthly photo uploads and photo posts.');

  const W = intel.website;
  if (!L.url && !lead.website) {
    add('no_website', 'high', 'No website on the Google profile', 'No website link means less trust and fewer signals for Google.',
      "There's no website on your Google profile. Google uses your site to understand what you do and where, so that's holding you back.",
      'Connect a site or build simple service and city pages.');
  } else if (W && W.ok) {
    if (!W.https) add('no_https', 'medium', 'Website is not secure (no HTTPS)', 'Browsers show "Not secure".', 'Your website shows as "Not secure" in the browser, which scares some people off.', 'Turn on HTTPS.');
    if (!W.titleHasCity || !W.titleHasService) add('weak_title', 'medium', 'Homepage title misses the city or service', `Title: "${W.title || 'none'}"`, "Your homepage title doesn't say what you do and where, which is the first thing Google reads.", 'Rewrite titles and headings with service plus city.');
    if (!W.schema) add('no_schema', 'low', 'No local business schema', 'Structured data helps Google match the site to the profile.', "Your site is missing the code that tells Google your business name, address, and phone.", 'Add LocalBusiness schema.');
    if (!W.tel) add('no_click_to_call', 'medium', 'No click-to-call on the website', 'Mobile visitors cannot tap to call.', "On a phone, people can't tap to call you from your site. That loses calls every week.", 'Add tap-to-call buttons.');
  } else if (W && !W.ok && !W.blocked) {
    add('site_down', 'high', 'Website did not load', W.error || 'The site did not respond.', "When I tried to open your website, it didn't load. If customers see that, they call the next business.", 'Fix hosting or rebuild.');
  }
  if (intel.speed && intel.speed.score != null && intel.speed.score < 50) {
    add('slow_site', intel.speed.score < 30 ? 'high' : 'medium', `Mobile speed ${intel.speed.score} out of 100`, `Largest paint ${intel.speed.lcp || 'n/a'}.`,
      `Google scores your site ${intel.speed.score} out of 100 on mobile speed. Slow sites lose people before the page even loads.`,
      'Speed fixes and image compression.');
  }
  return out.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
}

// ---------- scoring ----------
export function scoreLead(lead = {}, intel = null) {
  const reasons = [];
  const add = (label, pts) => { if (pts) reasons.push({ label, pts }); return pts; };
  if (lead.dnc || lead.stage === 'dnc') return { score: 0, grade: 'X', reasons: [{ label: 'Do not call', pts: 0 }] };
  if (lead.stage === 'lost') return { score: 0, grade: 'X', reasons: [{ label: 'Lost or bad number', pts: 0 }] };
  if (lead.stage === 'won' || lead.client_id) return { score: 100, grade: 'W', reasons: [{ label: 'Client', pts: 100 }] };

  const info = industryInfo(lead.industry, intel?.listing?.category || lead.category);
  let s = 0;
  s += add(`${info.label}: ${info.tier === 'high' ? 'high' : info.tier === 'mid' ? 'solid' : info.tier === 'low' ? 'low' : 'unknown'} job value`, { high: 25, mid: 18, low: 9, unknown: 12 }[info.tier]);

  const reviews = intel?.listing?.reviews ?? (lead.reviews ?? null);
  const rating = intel?.listing?.rating ?? (lead.rating ?? null);
  const hasSite = Boolean(intel?.listing?.url || lead.website);

  // Need: how much room there is to help.
  if (intel && intel.found !== undefined) {
    const probs = findProblems(intel, lead);
    let need = 0;
    for (const p of probs) need += p.severity === 'high' ? 9 : p.severity === 'medium' ? 5 : 2;
    need = Math.min(35, need);
    if (intel.rank && intel.rank <= 3 && intel.grid && intel.grid.top3 >= intel.grid.points * 0.8) need = Math.min(need, 8);
    s += add(`${probs.length} problems found`, need);
  } else {
    let need = 15;
    if (reviews != null && reviews < 25) need += 6;
    if (rating != null && rating < 4.3) need += 4;
    if (!hasSite) need += 4;
    s += add('Room to grow (estimate, not researched yet)', Math.min(need, 25));
  }

  // Ability to pay: an established business.
  let able = 0;
  if (reviews != null) able += reviews >= 15 && reviews <= 600 ? 10 : reviews > 600 ? 6 : reviews >= 5 ? 6 : 2;
  else able += 6;
  if (hasSite) able += 5;
  if (rating == null || rating >= 3.5) able += 5;
  s += add('Established business', able);

  // Reach.
  const d = String(lead.phone_digits || lead.phone || '').replace(/\D/g, '');
  let reach = 0;
  if (d.length >= 10) reach += 5;
  if (lead.contact_name) reach += 2;
  if (lead.email) reach += 2;
  if (lead.timezone || lead.state) reach += 1;
  s += add('Contact details', reach);

  // Intent.
  let intent = 0;
  if (lead.source === 'website' || lead.source === 'booking') intent = 10;
  else if (lead.stage === 'audit_requested' || lead.stage === 'audit_booked') intent = 10;
  else if (lead.stage === 'callback') intent = 7;
  else if (lead.stage === 'follow_up' || lead.stage === 'no_show') intent = 5;
  s += add('Showed interest', intent);

  if ((lead.attempts || 0) >= 4) s += add('Hard to reach', -5);
  if (lead.stage === 'not_now') s += add('Said not now', -10);

  const score = Math.max(0, Math.min(100, Math.round(s)));
  const grade = score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 45 ? 'C' : 'D';
  return { score, grade, reasons };
}

// ---------- call categories ----------
// What to lead with on a call, worked out from what we already know about the business. Pure: it reads the lead row (Google rating,
// reviews, website, map rank if researched, stage, source), so a cold Finder lead has a category before anyone runs a scan.
export const CALL_CATS = [
  { id: 'asked', label: 'Asked for us', lead: 'They reached out or asked for the audit. Start with what they asked for.' },
  { id: 'followup', label: 'Following up', lead: 'You already talked. Pick up where it ended and ask for the next step.' },
  { id: 'no_site', label: 'No website', lead: 'No website. Lead with being found on Google and a simple site that turns searches into calls.' },
  { id: 'not_found', label: 'Not on Google', lead: 'Google could not find their profile. Lead with getting them found on the map at all.' },
  { id: 'off_page_one', label: 'Not on page one', lead: 'They are not on the first page of the map. Lead with the calls going to the businesses that are.' },
  { id: 'reviews', label: 'Few reviews', lead: 'Under 25 reviews. Lead with reviews: more trust and more clicks from the same searches.' },
  { id: 'rating', label: 'Low rating', lead: 'Rating under 4.3 stars. Lead with fixing the reputation and getting fresh reviews.' },
  { id: 'close', label: 'Close to the top', lead: 'On page one but below the top 3. Lead with how close they are to the spots that get the calls.' },
  { id: 'strong', label: 'Already strong', lead: 'They already rank well. Lead with holding the spot, more cities and more calls from the same work.' },
  { id: 'general', label: 'General', lead: 'No clear weak spot yet. Ask how they get customers today and where the phone is slow.' },
];
const CAT_BY_ID = Object.fromEntries(CALL_CATS.map((c) => [c.id, c]));

export function callCategory(lead = {}) {
  const researched = Boolean(lead.intel_at);
  const rank = researched && lead.map_rank != null ? Number(lead.map_rank) : null;
  const reviews = lead.reviews == null || lead.reviews === '' ? null : Number(lead.reviews);
  const rating = lead.rating == null || lead.rating === '' ? null : Number(lead.rating);
  const flags = {
    asked: lead.stage === 'audit_requested' || lead.source === 'website' || lead.source === 'booking',
    followup: ['callback', 'follow_up', 'no_show', 'not_now'].includes(lead.stage),
    no_site: !String(lead.website || '').trim(),
    not_found: researched && lead.map_rank == null,
    off_page_one: rank != null && rank > 10,
    reviews: reviews != null && reviews < 25,
    rating: rating != null && rating > 0 && rating < 4.3,
    close: rank != null && rank > 3 && rank <= 10,
    strong: rank != null && rank <= 3 && (reviews == null || reviews >= 25) && (rating == null || rating >= 4.3),
  };
  const id = CALL_CATS.find((c) => flags[c.id])?.id || 'general';
  const facts = [];
  if (reviews != null) facts.push(`${reviews} review${reviews === 1 ? '' : 's'}${rating ? `, ${rating} stars` : ''}`);
  else if (rating) facts.push(`${rating} stars`);
  if (rank != null) facts.push(rank > 20 ? 'not in the top 20' : `#${rank} on the map`);
  if (flags.no_site) facts.push('no website');
  const tags = CALL_CATS.filter((c) => flags[c.id] && c.id !== id).map((c) => ({ id: c.id, label: c.label }));
  const info = industryInfo(lead.industry, lead.category);
  if (info.tier === 'high') tags.push({ id: 'high_value', label: 'High value trade' });
  if (lead.phone_type === 'mobile') tags.push({ id: 'mobile', label: 'Mobile number' });
  return { id, label: CAT_BY_ID[id].label, lead: CAT_BY_ID[id].lead, facts, tags };
}

// Who to ask for. The owner when we know one, else the contact on file, else a plain prompt.
export function whoIs(lead = {}) {
  // An owner name that is not a person (a job title a scrub once saved) is ignored everywhere, so nobody asks for "Owner Operator".
  const rawOwner = String(lead.owner_name || '').trim();
  const owner = rawOwner && isPersonName(rawOwner) ? rawOwner : '';
  const rawContact = String(lead.contact_name || '').trim();
  // A contact that is a job title or the business name ("owner", "vice president", Outscraper columns) is not a person either.
  const contact = rawContact && ((rawContact === rawOwner && !owner) || titleLike(rawContact, lead.business)) ? '' : rawContact;
  const same = owner && contact && owner.toLowerCase() === contact.toLowerCase();
  if (owner) return { name: owner, role: 'Owner', also: contact && !same ? contact : '', line: `Ask for ${owner}`, known: true };
  if (contact) return { name: contact, role: 'Contact', also: '', line: `Ask for ${contact}`, known: true };
  return { name: '', role: '', also: '', line: 'Ask for the owner', known: false };
}

// The person's name to show or greet: the owner or contact when it reads as a person, else ''.
export const personOf = (lead = {}) => whoIs(lead).name;

// ---------- workload tier ----------
// Internal only (never shown, never priced): how heavy this lead's work looks, which sets the default tabs and guide steps.
export function recommendPlan(lead = {}, intel = null) {
  const info = industryInfo(lead.industry, intel?.listing?.category || lead.category);
  const probs = findProblems(intel, lead);
  const high = probs.filter((p) => p.severity === 'high').length;
  const topReviews = intel?.competitors?.[0]?.reviews || 0;
  const why = [];
  let plan = 'growth';
  if (/locations|multi/i.test(lead.notes || '') || (lead.locations || 0) > 1) {
    plan = 'leader'; why.push('More than one location or service area');
  } else if (info.tier === 'high' && (topReviews > 150 || high >= 3)) {
    plan = 'authority'; why.push(`High value jobs (${info.label})`, topReviews > 150 ? `Strong competitors (#1 has ${topReviews} reviews)` : `${high} serious problems to fix`);
  } else if (info.tier === 'low' && high <= 1 && topReviews < 80) {
    plan = 'starter'; why.push('Lighter competition', 'Mostly profile fixes needed');
  } else {
    why.push(high ? `${high} serious problems to fix` : 'Room to climb the first page', 'Needs pages, links, and reviews, not only profile work');
  }
  return { plan, why };
}

// ---------- services they need ----------
// No packages. The scope is built from the research: the core services always, the rest only where the research shows a gap,
// and how much of each a month (pages, links, content, website fixes) from how far they are from the first page.
// Everything is in the owner's hands: any service can be switched on or off and any amount changed. The price is typed, never defaulted.
const SITE_KEYS = ['no_website', 'no_https', 'weak_title', 'no_schema', 'no_click_to_call', 'site_down', 'slow_site'];

function describeServices(lead = {}, intel = null) {
  const info = industryInfo(lead.industry, intel?.listing?.category || lead.category);
  const probs = findProblems(intel, lead);
  const has = (...keys) => probs.some((p) => keys.includes(p.key));
  const high = probs.filter((p) => p.severity === 'high').length;
  const g = intel?.grid;
  const t10 = g ? top10Of(g) : null;
  const weak = g && g.points ? 1 - t10 / g.points : null; // share of nearby spots that are not on the first page
  const topReviews = intel?.competitors?.[0]?.reviews || 0;
  const strong = topReviews > 150;
  const multi = /locations|multi/i.test(lead.notes || '') || (lead.locations || 0) > 1;
  const bigJobs = info.tier === 'high' && (strong || high >= 3);
  const siteIssues = probs.filter((p) => SITE_KEYS.includes(p.key)).length;
  const researched = Boolean(intel);
  const on = {
    pages: !researched || weak == null || weak > 0.2 || has('not_top10', 'grid_weak', 'no_website'),
    links: !researched || strong || (weak ?? 1) > 0.2 || has('not_top10', 'not_top3', 'grid_weak'),
    competitors: !researched || strong || has('not_top3', 'not_top10', 'review_gap'),
    content: researched && (bigJobs || has('not_top3')),
    tracking: researched && bigJobs,
    reputation: researched && (bigJobs || has('low_rating')),
    locations: multi,
  };
  const qty = {
    posts: 4,
    pages: weak == null ? 2 : weak > 0.6 ? 4 : weak > 0.3 ? 3 : 2,
    links: strong || (weak ?? 0) > 0.6 ? 6 : (weak ?? 0) > 0.3 || topReviews > 60 ? 4 : 3,
    content: bigJobs && strong ? 4 : 2,
    onpage: siteIssues >= 3 ? 3 : siteIssues === 2 ? 2 : 1,
  };
  // Exact numbers from the research behind each service, so every line on the slide says what is needed and how much.
  const L = intel?.listing || {};
  const top = intel?.competitors?.[0];
  const gapRev = top && top.reviews ? Math.max(0, top.reviews - (L.reviews ?? 0) + 1) : 0;
  let ls = lead.listings;
  if (typeof ls === 'string') { try { ls = JSON.parse(ls); } catch { ls = null; } }
  const wrong = ls?.results?.length ? (ls.counts?.mismatch || 0) + (ls.counts?.missing || 0) : null;
  const offPage = g && g.points ? g.points - t10 : null;
  return SERVICE_LIST.map((s) => {
    const hit = probs.find((x) => s.fixes.includes(x.key));
    const n = qty[s.id] || SCOPE[s.id]?.def || 1;
    let why = hit ? hit.title : '';
    if ((s.id === 'pages' || s.id === 'links' || s.id === 'cleanup') && g) {
      why = t10 >= g.points * 0.8 ? `First page in ${t10} of ${g.points} spots today. This moves you up toward the top 3 and keeps you there.`
        : `First page (top 10) in ${t10} of ${g.points} spots today. This is what pushes you onto the first page in more of your area.`;
    }
    if (s.id === 'cleanup' && wrong != null) why = wrong ? `${wrong} of the ${ls.results.length} directories Google checks have your name, address or phone wrong or missing. We fix every one.` : `All ${ls.results.length} directories we checked match. We keep them that way.`;
    if (s.id === 'pages' && offPage > 0) why = `${n} new pages a month aimed at the ${offPage} of ${g.points} spots where you are not on the first page.`;
    if (s.id === 'links' && offPage > 0) why = `${n} local links a month to build the trust Google wants in the ${offPage} of ${g.points} spots where you are not on the first page.`;
    if (s.id === 'posts') why = `${n} posts and ${photosFor(n)} photo uploads a month.${L.photos != null ? ` Your profile has ${L.photos} photos today.` : ''}`;
    if (s.id === 'reviews' && gapRev > 0) why = `${gapRev} reviews to pass ${top.title}: about ${Math.max(4, Math.ceil(gapRev / 6))} new reviews a month over six months, every one answered.`;
    if (s.id === 'competitors' && top) why = `${top.title} holds ${top.wins || 0} top 3 spots${g?.points ? ` of the ${g.points} we checked` : ''}. We track them every month.`;
    if (s.id === 'report') why = g ? `Your starting point: first page in ${t10} of ${g.points} spots. You watch it climb.` : 'You see the climb month by month.';
    return {
      id: s.id, name: s.name, what: s.what, why, problem: Boolean(hit),
      rec: s.core || on[s.id] === true, qty: n, unit: unitOf(s.id),
    };
  });
}

// The services the research recommends, problems first. Used for the default scope.
export function servicesFor(lead = {}, intel = null) {
  return describeServices(lead, intel).filter((s) => s.rec).sort((a, b) => Number(b.problem) - Number(a.problem));
}

// Every service we offer with the research's suggested amount, for the pickers.
export const allServicesFor = (lead = {}, intel = null) => describeServices(lead, intel);

// A deal's quote: the services picked with amounts, and the buildout and monthly the owner typed. Prices stay blank until typed.
// anchor = the top number said first, drop = the lower number if they push back (both optional, owner's own).
export function quoteFor(lead = {}, intel = null, saved = null) {
  let q = saved;
  if (typeof q === 'string') { try { q = JSON.parse(q); } catch { q = null; } }
  const all = describeServices(lead, intel);
  const ids = Array.isArray(q?.services) && q.services.length ? q.services : all.filter((s) => s.rec).map((s) => s.id);
  const services = all.filter((s) => ids.includes(s.id)).map((s) => ({ ...s, qty: hasQty(s.id) && q?.qty?.[s.id] != null ? clampQty(s.id, q.qty[s.id]) : s.qty }));
  const pair = (o) => (o && (dollars(o.setup) != null || dollars(o.monthly) != null) ? { setup: dollars(o.setup), monthly: dollars(o.monthly) } : null);
  return {
    plan: tierOf(services),
    ref: refFor(services),
    setup: dollars(q?.setup),
    monthly: dollars(q?.monthly),
    anchor: pair(q?.anchor),
    drop: pair(q?.drop),
    services,
    all,
    saved: Boolean(q),
  };
}

// The scope as it would be saved: [{ id, qty }].
export const scopeOfQuote = (Q) => (Q.services || []).map((s) => ({ id: s.id, qty: s.qty }));

// ---------- call script ----------
// One pitch, used on every call and in every meeting: the Google clarity call. Same frame cold or booked:
// set the frame, discover, verify, show the clarity scan, search together, explain why, tell them who we are,
// walk the process and what we need from them, then a drop close: anchor at everything we offer, then only the services they need, priced on the spot.
// Plain words to the owner: "Google", "the map", "the first page", "calls". Never "SEO", "NAP", "citations" or "algorithm".
// Each step is one or more lines; lines that start with "Or:" are alternatives, "(" lines are coaching notes for the rep.
// Never claim a scan when no research ran: the {..._reason} and {scan_...} lines change on their own.
export const SCRIPT_VERSION = 10;

// Two scripts, one story. Cold call: earn 30 seconds, frame us as a small group agency, hook with the scan, qualify, book the
// clarity call (or start it right there). Clarity call: the screen share that ends in a signed work order.
export const SCRIPT_GROUPS = [
  ['analysis', 'Competitor analysis', ['a_call', 'a_set', 'a_disc', 'a_reb', 'a_ml']],
  ['question', 'Question opener', ['q_open', 'q_state', 'q_listen', 'q_sum', 'q_ask', 'q_lock', 'q_reb']],
  ['cold', 'Cold call', ['k_open', 'k_site', 'k_hook', 'k_why', 'k_ml', 'k_value', 'k_teach', 'k_book', 'k_after', 'k_lock', 'gatekeeper', 'voicemail']],
  ['plan', 'Game Plan (website audit)', ['g_call', 'g_ask', 'g_set']],
  ['clarity', 'Clarity audit', ['c_open', 'c_frame', 'c_discovery', 'c_verify', 'c_scan', 'c_live', 'c_why', 'c_listings', 'c_story', 'c_program', 'c_process', 'c_trial', 'c_price', 'c_close', 'c_post', 'c_onboard', 'c_book']],
];
export const SCRIPT_KEYS = [
  ['k_open', 'Cold: the owner picks up'], ['k_site', 'Cold: no website, the site I built'], ['k_hook', 'Cold: the pattern interrupt'], ['k_why', 'Cold: why I called'],
  ['k_value', 'Cold: on the fence'], ['k_teach', 'Cold: before you book'], ['k_book', 'Cold: book it on this call'], ['k_after', 'Cold: after booking, discovery'], ['k_lock', 'Cold: lock it in'],
  ['c_open', 'Opener: the Google clarity audit'], ['c_frame', 'Set the frame'], ['c_discovery', 'Discovery (write it down)'],
  ['c_verify', 'Verify the business'], ['c_scan', 'The clarity scan'], ['c_live', 'Search together'], ['c_why', 'Why they are up there (slow down)'],
  ['c_listings', 'Inconsistencies'], ['c_story', 'Why we are having this conversation'], ['c_program', 'What to expect'], ['c_process', 'Your app and your part'],
  ['c_trial', 'Trial close'], ['c_price', 'Price: the drop close'], ['c_close', 'Close'], ['c_post', 'Work order and payment'],
  ['g_call', 'The call'], ['g_ask', 'If they ask what it is'], ['g_set', 'Once they give you a time'],
  ['a_call', 'The call'], ['a_set', 'Once they give you a time'], ['a_disc', 'Discovery after booking (Optional)'], ['a_reb', 'Rebuttals'],
  ['a_ml', 'Mirror and label first'],
  ['q_open', 'The opener'], ['q_state', 'Their current state'], ['q_listen', 'Mirror and label what they say'], ['q_sum', 'Sum it up'], ['q_ask', 'Ask for time'], ['q_lock', 'Lock it in'], ['q_reb', 'Rebuttals (mirror, label, ask)'],
  ['k_ml', 'Cold: mirror and label'],
  ['c_onboard', 'Onboarding and homework'], ['c_book', 'Book the audit for later'], ['voicemail', 'Voicemail'], ['gatekeeper', 'Gatekeeper'],
];

export const DEFAULT_SCRIPT = {
  // Game Plan call (also run as a website audit): the lead asked for it, so this is a short call or text that books the walk through.
  g_call: [
    "Hi {first_or_owner}? It's {rep} with {company}.",
    "As requested, we have your **free Google Game Plan** finished for {business}.",
    "Or: As requested, we have your **free website audit** finished for {business}.",
    "I/we have two spots left for tomorrow to take care of any questions about the report.",
    "12pm or 4pm. Which works better for you?",
  ].join('\n'),
  g_ask: [
    "IF THEY ASK WHAT IS THIS ABOUT: It's your **free Google Game Plan**. It shows where you rank on Google and why.",
    "Or: It's your **free website audit**. It shows where you rank on Google and why.",
    "And we also threw in a **competitor analysis**, so you know what to tweak with no guessing.",
    "Both are yours to keep!",
    "12pm or 4pm?",
  ].join('\n'),
  g_set: [
    "Got it. You'll receive your email confirmation in the next few minutes.",
    "We recommend having a computer or tablet handy, so we can share our screen and walk you through the Game Plan in real time.",
    "Please make sure to keep your appointment, because we have limited availability.",
    "(Book it in the Hub first, so the confirmation email goes out.)",
  ].join('\n'),
  // Competitor analysis cold call, V's own script from his doc, word for word (typos and all). Only ** marks (bold) were added from the doc's bold type.
  a_call: [
    "Hey Is this [Name/Owner]",
    "It's [Name] with Rightway Growth:",
    "Just seeing how we could help , we used your info to create a **free Competitor Analysis**.",
    "I have two spots left for tomorrow to take care of any questions about the report.",
    "I have a 12PM or 5PM. Which works better for you?",
  ].join('\n'),
  a_set: [
    "Got it. I’ll shoot you a email/text an invite while we’re still on the phone.",
    "Also, if you have a computer or phone for the meeting so we can share our screen through the free analysis.",
    "Make sure you keep you’re free for the appointment, since we only have a few slots.",
  ].join('\n'),
  a_disc: [
    "Is there anything you’ve been thinking about you would want me to take a look into before we meet [time/date].",
  ].join('\n'),
  a_reb: [
    "\"What's this about?\"",
    "It's your free **Competitor Analysis** - shows where you rank on against your competitors and why. And then we also throw  in and send a **game plan report**, so you know what to tweak with no guessing…Both are yours to keep. So what time were your free for",
    "“Who are you?”",
    "We’re rightway growth, gotta be honest with you were a boutique marketing company(startup agency) and take on few clients so we can focus on quality. If we’re a good fit for each other we can help out. If not, you keep the report and strategy free…so which time did you say you were free with?",
    "“How much does this cost?”",
    "(Laugh) Honestly I don’t even know if there’s any way I could help you without getting to know you or where your gaps are,were performance based.  we can take a look at an analysis and if we can tailor something for you, we can get to work immediately. What time did you want to take a look at that?",
    "“I get these calls all the time.”",
    "I hear you boss me too, we’re business owners. Everyone’s gonna try to sell you something. But we also are looking for a good fit to work with which is why we’re reaching out. Let’s find out when we get on a call, so was either 12pm or 5pm good for you?",
    "“I’m not interested.”",
    "I’m sure. You probably have been burned before. We jumped ship from those guys too after seeing how business owners get treated like numbers. Which is why we’re boutique and focus on quality but I can only take on so many and we’re also selective if we can help. Would that be worth jumping on a meeting and see if we’re a good fit?",
    "“What can you do for me about (problem)?“",
    "Well there’s dozens of things we can provide for you, but I’m sure you can appreciate we can’t fix something unless we take a look at it first. If there was a chance we could fix the [problem] maybe bring more revenue would that be worth having a conversation about?",
    "“What can you offer?”(broad)",
    "Honestly we’re full service company, we can make your websites, run ads, organic marketing, even throw some ai in your business. But I wouldn’t sell you anything right now unless I knew I could help you. If you think there’s a chance we can help you grow, would that be worth having a conversation about?",
    "“I already have a company”",
    "I bet you do you’re in [industry]",
    "“Why not have a second pair of eyes to make sure he’s working for you and not just fleecing your pockets? It’s free to find out. You get a report to show him and if you think we could help, you’ll have your answer on the call, I can meet today or tomorrow at 12 or 5?”",
  ].join('\n'),
  // Question opener (Nov 2026, V's opener): a question about their business, get them talking about how work comes in now, mirror and label
  // what they say, sum it up until they say "that's right", then ask for time only. Research: report "Cold call scripts and split testing".
  q_open: [
    "Hey, is this {first_or_owner}? It's {rep} with Rightway Growth.",
    "The reason for the call is I have a question for you about {business}.",
    "Rightway Growth helps businesses get the leads they want at the peak of their interest, which is while they're on Google searching. Kind of like live strategy in your pocket.",
    "So I'm curious, how are you handling new leads for jobs right now?",
    "Or (shorter): The reason for the call is I have a question for you about {business}. We help {industry} businesses get calls from people on Google right now looking for what you do. So I'm curious, how are most new jobs coming in for you these days?",
    "Or (permission first): I know I'm calling out of the blue. Can I take 30 seconds to tell you why I called, and you tell me if I'm off base?",
    "(DO: Ask the question, then stop talking. Silence is fine. Let them answer.)",
  ].join('\n'),
  q_state: [
    "{industry_q}",
    "Then: {industry_f1}",
    "Then: {industry_f2}",
    "Then: Are you looking for more jobs, or better quality ones?",
    "(DO: The goal is to get them talking about where work comes from now. Listen for a problem you can help with. If it really works and they are happy, that is a fine answer: thank them and exit.)",
  ].join('\n'),
  q_listen: [
    "(DO: Mirror their last one to three words as a question, pause four seconds, then label it. One label, then one how or what question. Never why.)",
    ...LISTEN.map(([when, ml, q]) => `IF ${when}: ${ml} ${q}`),
  ].join('\n'),
  q_sum: [
    "So it sounds like most of your work comes from [your words for where work comes from], and [your words for the problem they named]. Did I get that right?",
    "(DO: Wait for \"That's right.\" If you hear \"You're right\", label it: It sounds like I missed something. What did I get wrong?)",
  ].join('\n'),
  q_ask: [
    "It sounds like there are a few ways I could help you get more quality jobs in the door that I'd love to show you.",
    "{fruit_line}",
    "Would it be crazy to grab a quick screen share, {slot1} or {slot2}?",
    "Or: Are you available today or tomorrow for a chat? I have {slot1} or {slot2}.",
    "(DO: Sell the time, nothing else. Price never comes up before the pitch. If they ask: there's a lot we can provide, but it only matters if it gets you results. We're performance based, so price comes after we know what you need.)",
  ].join('\n'),
  q_lock: [
    "Perfect. What's the best email for the invite?",
    "So {slot1}, and you'll be near a computer or your phone? (Wait for \"That's right.\")",
    "What could come up that would make that time a problem?",
    "(DO: Say the day and time back out loud. Book it in the Hub before you hang up.)",
  ].join('\n'),
  q_reb: [
    "(DO: Every answer starts with a mirror or a label, then one how or what question, then back to the time ask. Full list in Mirror and label below the script.)",
    "\"Not interested.\"",
    "Totally fair, you didn't ask for my call. It sounds like Google isn't a headache right now. How are most new customers finding you these days?",
    "\"Just send me an email.\"",
    "Some info? Happy to. So I don't send you junk, what would actually be useful to you?",
    "\"We already have someone.\"",
    "Already have someone? (pause) Good, so you already believe in it. How do you know it's working?",
    "\"We get enough from word of mouth.\"",
    "Word of mouth? Best kind of customer. When a friend says call {business}, what do you think they do first, dial straight or look you up?",
    "\"How much does it cost?\"",
    "How much? Fair question. Honestly, there's a lot we can provide, but it only matters if it gets you results. We're a performance based company, so I'd never put a price on it before we know what you actually need. That's what the screen share is for. {slot1} or {slot2}?",
    "\"We tried it before and it didn't work.\"",
    "It sounds like you paid and got nothing to show for it. What went wrong: you couldn't see the work, or the results never came?",
    "\"I'm busy.\"",
    "It sounds like I caught you mid job. Give me 20 seconds on why I called, then you decide if it's worth a callback?",
    "\"Is this a sales call?\"",
    "It is, and you can hang up in 30 seconds if it's off. Fair?",
  ].join('\n'),
  // Mirror and label first, then V's own rebuttal (a_reb) word for word. Added Nov 2026; the Competitor analysis text itself is unchanged.
  a_ml: [
    "(DO: When they push back, mirror or label FIRST, pause, then give the rebuttal above in your own words.)",
    ...ANALYSIS_ML.map(([q, ml]) => `${q} ${ml}`),
  ].join('\n'),
  k_ml: [
    "(DO: Whatever they say back, mirror their last few words as a question and pause. Then label it.)",
    "Already have a system? (pause) It sounds like you have a good system in place to get more calls in. What part of it brings in the jobs you want most?",
    "Word of mouth? (pause) It sounds like your reputation does the selling. When a friend sends someone your way, what do they do first, call you or look you up?",
    "Busy? (pause) It sounds like I caught you mid job. When are you off the tools?",
  ].join('\n'),
  k_open: [
    "Hey, is this {first_or_owner}?",
    "(Only if the line really cut out: 'You broke up there, is this {first_or_owner}?')",
  ].join('\n'),
  k_site: [
    "{site_intro}",
    "{site_who}",
    "{site_note}",
  ].join('\n'),
  k_hook: [
    "{open_line}",
    "{open_where}",
    "Perfect. Oh, I'm {rep} by the way, with RightWay Growth.",
  ].join('\n'),
  k_why: [
    "{strategy_note}",
    "{strategy_line} I can book you a plan today, completely **free**. Is that something you'd want?",
    "Or: If you're not interested, no worries. Or just give me 20 seconds and I can let you know what we can do for you?",
    "{found_say}",
  ].join('\n'),
  k_value: [
    "Hey look {first}, {value_line}. Happy to show you everything that's set up. I/we can get into the technical side if you want, but it'd be way easier if I/we just showed you, don't you think?",
    "(Already working with somebody?) Totally fine. Think of us as a second pair of eyes. If they're doing a great job, you'll know for sure.",
  ].join('\n'),
  k_teach: [
    "OK so hey {first}, here's what we're gonna do. We're gonna look into all your competitors. We'll break down all their reviews, all their websites, and see what they're doing compared to you. Then I/we will show you all of it, so even if we don't work together, you're still gonna walk away knowing all this new information.",
    "And if any of them are running ads, I/we will show you those too.",
  ].join('\n'),
  k_book: [
    "That's great, I/we would love to show you. I/we can have it all built today, but we have to share the screen to show you what we've got. Does {slot1} work for you, or is {slot2} better?",
    "(If they want more info first:) Totally, and that's exactly what we go over on the call. I/we will walk you through what we found and everything that's set up, live. Way easier than me reading it off to you. {slot1} or {slot2}?",
    "(Book it on this call.)",
  ].join('\n'),
  k_after: [
    "Perfect, you're locked in for [day and time]. What's the best email for the Google Meet link?",
    "And is this the best cell to text you a reminder? (If yes, tap 'They said yes to texts'.)",
    "So we can have everything ready and we don't waste any of your time, a few quick ones:",
    "1. Is anyone else part of decisions like this, a partner or a spouse? Have them hop on too.",
    "2. Ballpark, what's a typical job worth to you?",
    "3. What kind of jobs do you want more of? The ones that actually make you money.",
    "4. Where do most of your customers come from right now? Referrals, Google, something else?",
    "5. What areas or cities do you want to be known in?",
    "6. Are you working with anybody on marketing right now? How's that going?",
    "7. Do you have the logins for your Google profile and your website? (No stress if not, it just saves time.)",
    "(Type the answers into the lead notes.)",
  ].join('\n'),
  k_lock: [
    "Awesome. The Google Meet link is going to your email right now, and we'll send you a heads up the morning of and right before. Talk soon, {first}.",
    "(Log it as Booked.)",
  ].join('\n'),

  c_open: [
    "Hey, is this {first_or_owner}? ... Hey {first}, it's {rep}, with RightWay Growth. We're all set for your **Google clarity audit**.",
    "(Smile. Then:) Quick agenda so you know how this goes. I'm going to show you exactly what a customer sees when they look for you on Google, where the inconsistencies are, and what's causing them. At the end, we'll both decide if it makes sense to work together.",
    "And just so you know, we only take on **ten clients at a time**, so we can focus on the relationship, quality and results. So this is as much me seeing if you're a fit as you seeing if we are. Fair?",
    "(Slow, low, certain. You're the one who did the work. You don't need this deal. You're deciding who gets one of the ten spots.)",
  ].join('\n'),
  c_frame: [
    "I just want to confirm, is {email_or_ask} still the best email for you? Perfect. I'm sending you a link to my screen right now. That way you see the exact same thing I see, and nothing gets lost in translation, OK?",
    "(Send the link from the lead. Then:) It's coming from RightWay Growth. Let me know when you see it. Since we're on the phone, you don't need video or audio, just the screen.",
    "Here's what we'll do. First, I'll confirm your business info. Then I'll show you {frame_scan}, and we'll do a couple of searches together, live. But before I even start, I want a few minutes to get to know you and the business, because every business is different and we don't do cookie cutter.",
    '(SCREEN: share only the slideshow window. Cover slide, then the Agenda slide.)',
  ].join('\n'),
  c_discovery: [
    '(SCREEN: before the first question, switch to your Scan tool tab (opened from the Scan slide, "Run the full scan"). Their business and keyword are filled in. Add their other money searches, pick 9 x 9 or bigger, press Run scan, then switch back to the Agenda slide. It scans while you ask. Don\'t share the Scan tool tab yet.)',
    '(Ask while it scans. Write every answer down. Make it conversational: you are the first person who cared to know.)',
    '1. How long have you been in business?',
    "2. You a one man band, or you got a team working with you? (How many trucks or crews?)",
    "3. What do you do to get your name out there? Any other advertising right now? Google Ads, Yelp, Angi, mailers, another agency? ... How's that working for you?",
    '(Make sure they can see your screen and the map before you go on.)',
    '4. How far out do you want to service? What cities matter most to you?',
    '5. Do you have a website? ... Nice. You make it yourself, or did someone help you with that?',
    "6. What's a typical job worth to you, ballpark? (Starting guess for {industry}: {ticket}.) And what kind of jobs, what searches, do you want MORE of?",
    '7. How has business been lately? Busy, slow, up and down?',
    '8. Are you actively trying to take on more customers right now? Could your crew handle five more good calls a week?',
    '9. When a new customer finds you today, is it mostly referrals, or Google?',
    "10. If nothing changes on Google for the next six months, what does that cost you? (Let them do the math. Stay quiet.)",
    "(Label it back: \"So it sounds like you've built this on great work and referrals, and Google hasn't caught up to how good you actually are.\")",
  ].join('\n'),
  c_verify: [
    "That answers all my questions for right now. Thank you for going over that with me. We like to know every business we work with in detail, so we can actually help, not just guess.",
    "Let me quickly verify your information. I have {business}{city_suffix}. Is that the exact name customers know you by? Address and service area? Hours? And the best phone number for customers?",
    "Now, when a customer needs you, what would they search? (Write their keywords down. Then:) And {keyword}, is that one of your money searches?",
    '(Find what gets them excited. Ask more questions. The keywords they pick are the keywords you scan and pitch on.)',
      '(SCREEN: the "How customers find you" slide: their listing next to the top 3. Or open Google Maps on their listing.)',
  ].join('\n'),
  c_scan: [
    "OK, so we're all set to keep moving. {scan_intro} {scan_line}",
    '{scan_spread}',
    "This is the part most owners never see. Google doesn't show the same results to everybody. It changes block by block, depending on where your customer is standing. So you can look great at your shop and be invisible two miles down the road.",
    '{scan_meaning}',
      '(SCREEN: switch the share to the Scan tool tab. The scan finished during discovery. Press Replay the scan so they watch it spot by spot. Point at their address first, then the farthest red square. Click each keyword tab to show every money search. Then press Save to lead and switch back to the slideshow: the Scan slide now shows this deep scan.)',
  ].join('\n'),
  c_live: [
    "Now, we can reference the scan, but I also want to jump over to Google with these searches and see pretty much what a customer sees.",
    '(Run the most basic search, "{keyword}", near their immediate area, or a spot the scan showed them weak.)',
    "IF THEY ARE NOT ON THE FIRST PAGE: Are you familiar with any of these guys? (Point at them.) In the mind of a customer, if you're not up here, you're not in the game. These are the businesses getting the calls first. And if we're struggling to find you this close to home, it only gets worse the further out we go.",
    "IF THEY ARE ON THE FIRST PAGE: OK, perfect, there you are, right where you want to be. Now let's move out into your service area. (Search an area the scan shows them weak.) See what happens? A few miles out and you drop off. (No pause.) Again, these are the guys getting those calls first, and it only gets worse the further out we go.",
    "And you know, conservatively, let's say there are about 4 or 5 people searching for this every single week. If just half of them go with {top_name_or_them}, that's like 2 or 3 jobs every single week going to the competitor. And that's just in your zip code. I wouldn't even want to guess what that number looks like further out.",
    '(Try to get them to give you the numbers instead of telling them. Get them to feel the pain of not showing up.)',
      '(SCREEN: new tab, google.com. Search the keyword the way a customer would, then click Maps. Point at the top 3. Then back to the presentation, "You vs the leaders" slide: reviews, rating and category side by side.)',
  ].join('\n'),
  c_why: [
    '(SLOW DOWN. Stern, steady tone.)',
    "Now I want you to understand why these companies are up here. People think it's because they do better work than you. Or they're bigger. Or because Google likes them more.",
    "When someone searches {keyword}, Google looks at three things: how relevant your business is to that search, how close you are to the person searching, and how much Google trusts you. Trust comes from your Google profile being complete and active, your reviews, a website that backs it up, and your business information matching everywhere it shows up online.",
    "When those pieces don't line up, Google gets less sure about you, and it plays it safe by showing someone else. Does that make sense?",
    '{problems}',
      '(SCREEN: "What is holding you back" slide. One row at a time, plain words.)',
  ].join('\n'),
  c_listings: [
    "Here's what I mean by inconsistencies. Google checks your business against dozens of other sites: Apple Maps, Bing, Yelp, Facebook, the BBB, and a lot of directories you've probably never heard of. Most people never search on those. But Google uses them to double check you.",
    '{listings_say}',
    "If one says one phone number, another says an old address, and another has the name a little different, Google gets less sure which one is right. That doesn't fix itself with time either. Bad information gets copied from site to site.",
    "So the first thing we do is clean it up and make it match everywhere, so Google stops doubting you. The way I want you to see this: the more consistent references Google sees, the more it trusts you, and that's what moves you up and brings in more business. Does that make sense? PERFECT.",
      '(SCREEN: "Inconsistencies" slide: their real listing check. Point at each red row, then the yellow ones. Click a row to open that directory and show the wrong phone or address. Not checked yet? Press Run the listing check now. Then the "Your website" slide if it shows, slow on phones costs calls.)',
  ].join('\n'),
  c_story: [
    "And that's exactly why we're having this conversation. Whenever we audit a business and see inconsistencies like these, and we can see it's affecting where you show up and how far out you show up, then obviously we're going to offer you a way to fix it.",
    "It's our **local growth program**, and it's what we've just been going over. First we do a **data cleanup**: every listing with wrong or outdated information gets corrected, so the damage stops. Then we get you in front of every directory Google checks that doesn't know who you are yet, and we build out your Google profile the right way.",
    '(PAUSE)',
    "Now before I go any further, I want to make sure we're on the same page. Like I said at the start, we only take on **ten clients at a time**, so we can focus on the relationship, the quality and the results. And I'll be straight with you: I/our founder used to work inside the big marketing companies. Year long contracts, reports nobody could read, promises of number one on Google. RightWay was built to do the opposite. You see every task, you see the map every month, and after the first three months you can leave any time. Fair?",
    '(SCREEN: "What gets you results" slide: only the services they need. Point at each one as you say it. Drop or add one live if discovery says so.)',
  ].join('\n'),
  c_program: [
    "Now let me explain quickly what to expect, because I'd rather be straight with you than overpromise.",
    "Google ranks local businesses on three things: how relevant you are to the search, how close you are to the person searching, and how well known and trusted you are online. We can't move your address, so we work on the other two.",
    "The first 30 to 60 days are the foundation: your Google profile built out the right way, your listings cleaned up, reviews coming in. Directories update on their own schedules, so the cleanup takes a few weeks to show everywhere. That's usually when owners see the first movement, and it tends to show up closest to the shop first, because distance is part of Google's formula.",
    "From there it's months three to six: pages for your services and cities, more reviews, local links. That's what widens how far out you show up. It builds on itself. This is a marathon, not a sprint.",
    "And you don't have to take my word for it: every month we run this same scan, so you see exactly what moved. Does that make sense?",
    '(SCREEN: switch the share to the Scan tool tab. Point at their address: "this is where the first movement usually shows." Then the red squares further out: "this is what the next months of work go after." Then back to the slideshow, "What happens after you say yes". Never promise a spot or a date.)',
  ].join('\n'),
  c_process: [
    '(SLOW DOWN.)',
    "The last thing I want to go over quickly is your app. When you start, you get your own login. You can go on any time and keep track of everything we do.",
    "This is your home screen: the work we did this month and where you show up. This is **Rankings**: the map, month over month, compared to where you started today. **Reviews**: send a review request from your phone in five seconds. And **Post a photo**: snap a job, we write the post. We add new features every month, and you get them automatically.",
    "Every month you meet with us for 15 to 30 minutes on a screen share like today. We show you all the work that's been done, the new map, and what's next. But the main reason we meet: we can do all the work behind the scenes, but without you as the owner involved, the whole process goes nowhere fast.",
    "So as long as you send us photos of your jobs, let us know about any changes in the business, send your review link after a job, and meet with us for those 15 minutes, you will never be in the dark about what's going on. Can you do that?",
    "And {first}, here's the honest picture: most of your customers look you up on Google before they call, even the referrals. What we do is make sure your information is right everywhere Google checks, get you in front of more of the searches that matter to you, and widen how far out people find you. That's how you start getting the calls that are going to {top_name_or_them} right now.",
    '(SCREEN: "Your own Rightway app" slide. Tap through the live app as you say each part: Home, Rankings, Reviews, Post a photo. Then the "Reviews" slide if they trail the leader.)',
  ].join('\n'),
  c_trial: [
    "So after seeing exactly where you stand and doing a few searches, I'd say you're definitely a strong fit for one of our spots. How do you feel about it? Do you think it would help you grow?",
    '(Let them answer. Then:) OK, great. Obviously you think it will help. It really just comes down to cost at the end of the day, right?',
    '(SCREEN: "What a few more jobs a month means for you" slide. Type their job value and how many extra jobs a month.)',
  ].join('\n'),
  c_price: [
    "Perfect. Based on everything you told me, here's what gets you where you want to go: {services_list}. (Walk each one and why it gets them onto the first page in more of their area.)",
    "The program comes in two parts: a **one time buildout**, which is us setting everything up the right way, and then a **monthly** for the ongoing work that moves you up and keeps you there.",
    '{price_anchor}',
    "For what you need, the buildout is {setup} and the monthly is {price}. Total today is {today_total}, and your next payment isn't for 30 days.",
    "And look, you told me a typical job is worth about {ticket}. {breakeven_jobs} a month pays for the whole thing. Everything after that is yours. Honestly, I think not doing this costs you a lot more than doing it, just from the calls you're already missing in your own backyard.",
      '(SCREEN: "Your investment" slide. The amounts start blank: type the buildout and monthly you just decided. They save when you go to the next slide.)',
  ].join('\n'),
  c_close: [
    "So after looking at everything and hearing what your goals are, from where I'm sitting this is the right way to get you there. How do you feel about it? Wouldn't you agree?",
    '(Then stop talking. The next person who speaks loses.)',
    "Great. Do you want the work order sent to your phone or your email?",
  ].join('\n'),
  c_post: [
    "Perfect. Let me walk you through the next steps so you're all set. First I'm sending you a one page **work order**. It's a digital signature. It puts everything we just went over in writing: the work, the price, the three month minimum. It's also what gives us permission to start. We'll take care of it while we're on the phone.",
    "It takes about 60 seconds. Let me confirm the spelling of your first and last name, and the email. Remember, the total today is {today_total}: the buildout and your first month.",
    "(Send the work order from the lead: Send work order. Then:) OK, I just sent it. It comes from Rightway Growth. Open it and read it over. Your name, business and today's date are already filled in. Just pick your signature and initials, check the box, and sign. Let me know if anything doesn't open.",
    "(When it shows Signed:) Awesome, I see it signed. It takes you straight to the secure payment page by Stripe. That's the same card we use each month, and you can update it any time from your app or by asking your account manager.",
    '(When the payment goes through, the Hub marks the deal won and makes the client.) Payment went through. You will have a receipt in your email.',
    "Now remember, three months is the minimum because that's how long the buildout takes to really show. After that it's month to month. This is a marathon, not a sprint, so set your expectations for steady progress, not overnight. OK?",
      '(SCREEN: "Start this week" slide. Press Send the work order: they scan the QR code or you text or email the link.)',
  ].join('\n'),
  c_onboard: [
    "Last thing: let's book your onboarding call. This is THE most important appointment in the whole process. It's where we get access to your Google profile and website and set everything up. It takes 30 to 45 minutes, and I'd really recommend being at a computer for it. Do you prefer mornings or afternoons?",
    "It takes us a few business days to get everything organized before that first call, so you can hit the ground running.",
    "(After booking:) You're booked for [day and time]. Here's your homework before then. One, read the confirmation email, it walks you through the first call. Two, put your best work photos in one folder so we can add them right away. Three, sometimes Google asks a business to verify again. If that happens we'll need proof the business is yours, like your business license or LLC papers and a utility bill in the business name. Have them handy. It's the difference between fixing it in 1 or 2 days instead of 1 or 2 weeks.",
    "Alright {first}, you're all set. Anything else I can help with? Thank you for the vote of confidence. We're going to do great work for you, and you're going to see it.",
      '(SCREEN: stop sharing. Book the onboarding call from the client page, Meetings tab.)',
  ].join('\n'),
  c_book: [
    "(If they can't do the screen share right now.) No problem. The audit needs your eyes on the screen, it's 15 minutes. I have {slot1} or {slot2}. Which works better?",
    "Perfect. I'm sending the invite with the link to {email_or_ask}. Is anyone else involved in the marketing decisions? Have them on the screen too, because we only hold the spot once.",
    "Before we talk, search \"{keyword}\" from your phone and see who comes up. We'll go over it together.",
  ].join('\n'),
  voicemail: [
    "Hey {first}, it's {rep}, with RightWay Growth. {vm_line} Give me a call back at {my_number}. Again, {rep}, {my_number}.",
    "(Under 25 seconds. Number twice, slowly.)",
  ].join('\n'),
  gatekeeper: [
    "Hey, you guys are still open, right? ... Perfect. Is {first_or_owner} around?",
    "(They ask who's calling:) Oh, it's {rep}, with RightWay Growth. {gk_reason}",
    "Or: No worries. Who handles the Google stuff over there? ... Got it, when's the best time to catch them?",
    "(Get a name and a time. Log it as Gatekeeper.)",
  ].join('\n'),
};

// [objection, answer]. Before price, after price, then the closes. Write their discovery answers into these.
export const DEFAULT_OBJECTIONS = [
  ['Cold: Not interested', "No worries at all. Just give me 20 seconds and I'll tell you what we found, and if it's not for you, that's totally fine. (20 seconds: why you called. Then:) It's way easier to show you on a quick screen share. {slot1} or {slot2}?"],
  ["Cold: We're booked out", "That's the best problem to have. Is it the work you want though, or would you take more of the bigger jobs if they came in? (Listen.) That's exactly what the plan is built around. {slot1} or {slot2}?"],
  ['Cold: What is this about?', "I/we looked {business} up on Google and put together a plan to bring in more of the profitable jobs. It's **free**. We just need to share the screen to show you. {slot1} or {slot2}?"],
  ['Cold: Is this a sales call?', "Honestly, it's more of a show and tell. I/we put a plan together for you. If you like it, we can talk about doing it together. If not, you keep it. {slot1} or {slot2}?"],
  ['Cold: How much does it cost?', "Fair question. Honestly, there's a lot we can provide, but it only matters if it gets you results. We're a performance based company, so I'd never put a price on it before we know what you actually need. That's what the screen share is for, and the plan is **free** either way. {slot1} or {slot2}?"],
  ['Cold: Just send me something', "I can, but it's all built around your map and your competitors, and that's way easier to show than send. Quick screen share and you keep everything. {slot1} or {slot2}?"],
  ['Cold: I already have someone', "Totally fine. Think of us as a second pair of eyes. If they're doing a great job, the plan will show it, and you'll know for sure. {slot1} or {slot2}?"],
  ["I don't need another sales pitch", "Look, I completely understand. As a business owner you probably get more calls than you can count, all trying to sell you something you don't need. This is a clarity call. What I'm showing you is a problem that's already costing {business} calls every single month. If there's a way to fix it and get those calls back, it's at least worth a look, right?"],
  ["I know where this is going, I'm not buying anything today", "I hear you, and if I were in your shoes I'd be burnt out too. I'm not here to sell you a widget or a new website. I want to show you what's costing you calls and how it gets fixed, so at least you understand the problem AND the solution. If it all makes sense and it doesn't cost an arm and a leg, we'll probably end up working together. Fair?"],
  ['I already have someone handling my Google', "Good, that means you take it seriously. Quick question: do they show you a map like this every month? Right now you're on the first page in {top10_of_points} spots around you. Is that where you expected to be? (Let them answer.) I'm not going to talk badly about anyone. I'll just show you how we're different, and you decide. (Back to script.)"],
  ['My marketing company does this specifically', "Then I'd ask them one thing: where's my map? Usually it's one of two things. Either they're only working on the website, or they don't have a way to show you what's happening on the map. Based on what we just saw, I'd lean toward the second. I won't knock them, I'll just show you how we work. (Back to script.)"],
  ['I paid a company before and nothing happened', "Unfortunately I hear that every day, and it's exactly why I started Rightway. Just because you had a bad steak at one restaurant doesn't mean you never eat steak again. It means you don't go back to that restaurant, right? With us you see every task in your app and a new map every month. If we're not doing the work, you'll see it before I tell you. What happened with the last company? (Back to script.)"],
  ["I don't need more business", "That's a great problem to have. This isn't only about more business, it's about not losing the business you already earned. A lot of referrals Google you before they call. When they do, {top_name_or_them} is sitting right there. All I want to do is take the reputation you've built and put it out on the highway where everyone can see it. Make sense?"],
  ['All my business is word of mouth', "Don't take this the wrong way, but that's old school, and there's nothing wrong with that. If this were 20 years ago we wouldn't be having this conversation. But today even a referral looks you up on Google before they call. If they can't find you, or they find {top_name_or_them} first, that referral you earned just went to someone else. Let's make sure that doesn't happen. Follow along with me, OK? (Back to script.)"],
  ['How did my information get messed up?', "Just like Google, these sites pull from databases, any and all of them. An old listing, a data company, a site you've never heard of. Once it's out there it gets copied. The goal is to correct it everywhere, so Google sees one consistent business. (Back to script.)"],
  ['Can I just fix this myself?', "You could, and I'll respect it if you try. It's a lot of hours: every listing, every login, every verification, posts every week, photos, reviews, pages, links, and keeping it all matching as Google changes. Most owners start, get busy running the business, and it stops. Is that the best use of your time, or would you rather be on jobs? (Back to script.)"],
  ['I need to check with my website company first', "I hear you loud and clear. Most of the time they're working on the website, not the Google map. We do website work too, but this is different work. The good news is this doesn't get in the way of anything they're doing. If they could do this, they'd already be doing it, right?"],
  ["I'm already paying for website SEO, why do I need this?", "Great question. You're a local business. Your customers are within a few miles of you, and the map is what they see first, above the regular results. Website work helps, but if you're not on the map in your area, you're missing most of the local calls. You saw it on the scan. See how that's affecting the business?"],
  ['How long does this take to work?', "Honest answer: profile fixes and listing cleanup start moving things in the first 30 to 60 days. Pages, reviews and links build over three to six months. The hard part isn't getting you up, it's keeping you up there. That's why we meet every month for 15 to 30 minutes. Your feedback speeds it all up. Make sense?"],
  ['Why is there a setup fee and a monthly?', "Because most of the heavy lifting happens up front. The buildout is the profile, the cleanup on every listing, the first pages and the tracking. The monthly is the steady work that moves you up and keeps you there. We put in the work first. And I only keep you if it's working, because after three months you can leave any time."],
  ["What if I do this and it doesn't work?", "That's fair to ask. Here's what I can tell you: you'll see every task we do and the map every month, so you'll know if it's moving long before month three. And after the first three months you can leave any time with 30 days notice. You're never stuck paying for something that isn't working. Fair enough?"],
  ['Can you guarantee number one?', "Anybody who guarantees number one on Google isn't being straight with you, because Google decides, and where your customer is standing changes it. What I guarantee is the work: every task we agree on, every month, shown in your app, with the map to prove where you stand."],
  ["It's too expensive", "I get it, it's an expense you weren't planning on. Let me ask you this: what's one job worth to you? (They answer.) So all we need is {breakeven_jobs} a month and you're in the green. Everything after that is profit. If we only got you {breakeven}, would it be worth it?"],
  ["I can't afford it", "I understand, you weren't waving your card in the air waiting for my call. But look at the screen with me. When someone searches {keyword} near you, {top_name_or_them} is getting that call. Once we fix this, those calls start coming to you. If even two of them do business with you, does that cover {price}? Then in my opinion you can't afford not to do this, right?"],
  ["I can't afford it (drop)", '{drop_offer}'],
  ["I can't afford it (end)", "Are you telling me {price} is going to have you on the street corner with a soup can? (Smile.) If this takes food off your table, don't do it. But if it doesn't, why not make a move so next month the bills are paid and there's extra in the account? When this brings in one or two new customers a month, it pays for itself. (Drop close if they're still on.)"],
  ['I need to think about it', "If we were talking about a car loan at 10% for 60 months, I'd say think about it too. But this is a problem that's already costing you calls every month. Fixing it costs a few hundred dollars, and a job or two a month covers it. So what's left to think about, besides where you're taking the family on vacation this year? (Then drop close or soft close at the same price.)"],
  ['I need to think about it (2)', "Sure, it's smart to think about big decisions. Let me ask you: what makes more sense, losing your word of mouth referrals to the guy next door because they find his number when they look you up, or being the one taking the calls and taking more of the local market?"],
  ['I need to think about it (3)', "To be honest with you, we're talking about a few hundred dollars to reach the customers your business should have been getting since day one. What's the bigger risk: a few hundred dollars you'll easily make back, or letting the last six months repeat themselves for the next six?"],
  ['I need to think about it (end of the line)', "What do we really need to think about here? Do you need to sit in the armchair tonight and decide whether you want to make more money? Or is something about the plan not sitting right? (Then stop and listen.)"],
  ['No', "{first}, there are only three reasons someone in your shoes says no: fit, function or finance. It's not fit, you told me this would help the business. If you don't understand how it works, that's on me and I'll explain it better. So is it just the finances? (If yes, use the drop.)"],
  ["I'm not doing anything today", "Look, I'm totally fine if we don't work together. But a minute ago you told me {pain} is hurting your growth. Now that a real fix is in front of you, there's a wall up. I see it all the time. It's usually not the money or the plan, it's just making a change. Am I reading that wrong, or is that what's happening here?"],
  ["I'm not doing anything today (end of the road)", "Fair enough. It sounds like right now, staying exactly where you are is still more comfortable than changing it. And that's OK. I appreciate your time today. I'll send you the scan so you have it, and when you're ready, you know where to find me."],
  ['I need to talk to my partner or spouse', "Makes sense, this should be a joint decision. What do you think they'll ask? (Answer it now.) Let's get 15 minutes with both of you so they see the same map. Does {slot1} or {slot2} work?"],
  ['Just send me an email', "Happy to. So it doesn't get buried, what part should I focus on? (Let them answer.) Honestly, the map makes way more sense on the screen than in an email, and it's 15 minutes. Does {slot1} or {slot2} work?"],
  ["I'm busy right now", "Totally get it, you're running a business. The clarity scan takes 15 minutes on a screen share. Is later today or tomorrow morning better? I'll put it on my calendar and call right on time."],
  ['Are you with Google?', "No, we're an independent local marketing company in Miami and Fort Lauderdale. We help businesses show up better on Google and get more calls from it."],
  ['How did you get my number?', "Your business number is public on your Google listing. I came across {business} while checking who shows up for \"{keyword}\" in {city}."],
];

// The methods behind the script, so the team knows why each line is there. Ideas summarized in our own words.
export const PLAYBOOK = [
  ['The clarity call frame', 'Rightway Growth', 'Open as the analyst who checked their Google presence, not a salesperson asking for time. The scan is the reason for the call, so only claim one when research ran.'],
  ['Screen share first', 'Rightway Growth', 'Get them looking at the same screen early. People believe what they see on their own map more than anything you say.'],
  ['Discovery you can use later', 'Neil Rackham, SPIN Selling', 'Write down years in business, team size, other ads, area, job value and goals. Every objection gets answered with their own words.'],
  ['Teach them something new', 'Dixon and Adamson, The Challenger Sale', 'The block by block map shows them something about their business they did not know. That earns the rest of the call.'],
  ['Find the gap', 'Keenan, Gap Selling', 'Current state, what it costs them, and the future they want. The bigger the gap, the easier the yes.'],
  ['Slow down for the why', 'Classic tonality', 'When you explain why competitors are up there, slow down and lower your voice. It is the moment they stop thinking you are guessing.'],
  ['Tell them who you are', 'Rightway Growth', 'The story is true: you saw how agencies treat owners and built the opposite. Visible work, monthly map, month to month after three months. It answers "is this another scam?" before they ask.'],
  ['Trial close', 'Classic sales method', '"How do you feel about it? Do you think it would help you grow?" before any price. If they agree it helps, price is the only thing left.'],
  ['No packages, drop close', 'Classic sales method', 'There are no packages. Every client gets a scope built from the research and a price you set. Anchor at everything we offer (your top number), then drop to only the services their discovery justifies, priced on the spot. It shows you are fitting the work to them. Drop again only with a reason, by trimming services.'],
  ['Make the price small', 'Zig Ziglar, Secrets of Closing the Sale', 'Compare the monthly to one job. "Two calls cover it" lands better than any discount.'],
  ['Fit, function, finance', 'Classic sales method', 'A no is almost always one of three. Rule out the first two out loud, and the real one is left.'],
  ['Listen, acknowledge, explore, respond', 'Jeb Blount, Objections', 'Never fight an objection. Agree it is fair, ask what is behind it, then answer the real one.'],
  ['Label and sum up', 'Chris Voss, Never Split the Difference', '"It sounds like..." and a summary they can answer with "that\'s right" build trust faster than any pitch.'],
  ['Alternative choice and silence', 'Zig Ziglar, Secrets of Closing the Sale', 'Offer two yeses ("phone or email", "morning or afternoon"), then stop talking.'],
  ['Keep it true', 'Rightway Growth', 'Urgency comes from what the scan shows and what it costs them, never from fake deadlines, fake discounts or promised rankings.'],
];

// One script, two voices. The owner reads it as "I". Everyone else gets the "we" copy: same words, the owner's own claims said as the team.
// Source text marks those spots as "I/we" and "I/our founder".
export function voiceText(text, voice = 'I') {
  const we = voice === 'we';
  return String(text || '')
    .replace(/(^|[.!?]["')]?\s+|\n|\()I\/our founder/g, (m, a) => `${a}${we ? 'Our founder Vidal' : 'I'}`)
    .replace(/I\/our founder/g, we ? 'our founder Vidal' : 'I')
    .replace(/(^|[.!?]["')]?\s+|\n|\()I\/we/g, (m, a) => `${a}${we ? 'We' : 'I'}`)
    .replace(/I\/we/g, we ? 'we' : 'I');
}

export function fill(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null && vars[k] !== '' ? String(vars[k]) : `[${k.replace(/_/g, ' ')}]`));
}

function nextSlots(at = Date.now()) {
  const d = new Date(at);
  const clock = (h) => `${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}`;
  const weekday = (x) => x.getDay() !== 0 && x.getDay() !== 6;
  const out = [];
  if (weekday(d) && d.getHours() >= 7 && d.getHours() <= 15) out.push(`today at ${clock(d.getHours() + 2)}`);
  for (let i = 1; out.length < 2 && i < 10; i++) {
    const x = new Date(d.getTime() + i * 864e5);
    if (!weekday(x)) continue;
    out.push(`${i === 1 ? 'tomorrow' : x.toLocaleDateString('en-US', { weekday: 'long' })} at ${out.length ? '2pm' : '10am'}`);
  }
  return out;
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

// The one sentence the whole pitch hangs on: what the scan found, in numbers.
export function scanLine(lead = {}, intel = null) {
  const info = industryInfo(lead.industry, intel?.listing?.category || lead.category);
  const kw = keywordFor(lead, intel) || info.keyword || 'your service';
  const name = lead.business || 'your business';
  const g = intel?.grid;
  const top = intel?.competitors?.[0];
  if (g && g.points) {
    const where = `${g.points} spots around ${name}, up to ${g.radiusMiles} miles out`;
    const t10 = top10Of(g);
    if (!t10) return `I searched "${kw}" on Google from ${where}, like a customer would. You didn't show up on the first page in any of them.${top ? ` ${top.title} was near the top in ${top.wins} of ${g.points}.` : ''}`;
    return `I searched "${kw}" on Google from ${where}, like a customer would. You were on the first page in ${t10} of ${g.points}.${top && top.wins > g.top3 ? ` ${top.title} was near the top in ${top.wins}.` : ''}`;
  }
  if (intel?.found && intel.rank != null) return `When someone near your address searches "${kw}" on Google, you come up ${rankText(intel.rank)}.${top ? ` ${top.title} is above you.` : ''}`;
  if (intel?.found) return `When someone near your address searches "${kw}" on Google, you don't show up in the top 20.${top ? ` ${top.title} comes up first.` : ''}`;
  return `I was looking at who comes up on Google Maps when people search "${kw}" in ${lead.city || 'your area'}, and I wanted to see where ${name} lands.`;
}

// The discrepancy the clarity call is built on: how much their rank changes across the map for the same search.
export function spreadLine(lead = {}, intel = null) {
  const g = intel?.grid;
  const kw = keywordFor(lead, intel) || 'your main search';
  const name = lead.business || 'your business';
  const ok = (g?.cells || []).filter((c) => !c.error);
  if (!g || !ok.length) return `Let's run "${kw}" live together right now, so you see exactly what a customer sees.`;
  const half = (g.size - 1) / 2, step = g.radiusMiles / Math.max(1, half);
  const dirs = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  const where = (c) => {
    const east = (c.col - half) * step, north = (half - c.row) * step;
    const d = Math.hypot(east, north);
    if (d < 0.05) return 'right at your address';
    const ang = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
    return `about ${d < 1 ? d.toFixed(1) : Math.round(d)} mile${Math.round(d) === 1 ? '' : 's'} ${dirs[Math.round(ang / 45) % 8]}`;
  };
  const ranked = ok.filter((c) => c.rank != null).sort((a, b) => a.rank - b.rank);
  const missing = ok.filter((c) => c.rank == null);
  const best = ranked[0];
  const worst = missing[0] || ranked[ranked.length - 1];
  if (!best) return `Same search, ${ok.length} different spots around ${name}, and you didn't make the top 20 in any of them. Customers searching "${kw}" near you aren't seeing you at all.`;
  const worstText = worst && worst !== best ? (worst.rank == null ? `but ${where(worst)}, you don't show up at all` : `but ${where(worst)}, you drop to number ${worst.rank}`) : '';
  return `Same search, "${kw}". ${where(best)[0].toUpperCase()}${where(best).slice(1)}, you come up number ${best.rank}${worstText ? `, ${worstText}` : ''}. That's an inconsistency, and it means customers in part of your area see someone else first.`;
}

export function scriptVars(lead = {}, intel = null, ctx = {}) {
  const info = industryInfo(lead.industry, intel?.listing?.category || lead.category);
  const Q = ctx.quote || quoteFor(lead, intel, lead.quote);
  // Prices are typed by the owner, never defaulted. Until they are, the script shows [brackets] to fill in out loud.
  const price = Number(Q.monthly) > 0 ? Number(Q.monthly) : 0;
  const setup = Q.setup != null && Number.isFinite(Number(Q.setup)) ? Number(Q.setup) : null;
  const top = intel?.competitors?.[0];
  const probs = findProblems(intel, lead);
  const slots = nextSlots(ctx.at);
  const ticket = ctx.ticket || info.ticket;
  const g = intel?.grid;
  const kw = keywordFor(lead, intel) || '';
  const breakeven = price ? Math.max(1, Math.ceil(price / Math.max(1, ticket))) : 1;
  const anchor = Q.anchor || null;
  const drop = Q.drop || null;
  const t10 = g ? top10Of(g) : 0;
  const first = (personOf(lead) || '').split(' ')[0] || '';
  const L = parseListings(lead.listings);
  const lc = L?.counts || {};
  const lbad = (lc.mismatch || 0) + (lc.missing || 0);
  const worst = (L?.results || []).find((r) => r.status === 'mismatch') || (L?.results || []).find((r) => r.status === 'missing');
  const D = discoveryFor(lead.industry, intel?.listing?.category || lead.category, info.label);
  const realGaps = probs.length > 0 || lbad > 0;
  return {
    industry_q: D.q, industry_f1: D.f1, industry_f2: D.f2, cust_word: D.word,
    // "Low hanging fruit" only when research actually found something; otherwise it stays a maybe.
    fruit_line: realGaps ? `It seems like there's some low hanging fruit here. I'd love to show you how the ${info.label.toLowerCase()} shops at the top of the map near you are getting their calls.`
      : `It seems like there could be some low hanging fruit here. I'd love to show you how the ${info.label.toLowerCase()} shops at the top of the map near you get their calls.`,
    first,
    listings_hook: L?.results?.length && lbad ? `I also checked the directories Google uses to double check you, and ${lbad} of ${L.results.length} have you wrong or missing${worst ? `, ${worst.name} for one` : ''}.` : '',
    listings_say: L?.results?.length ? (lbad ? `And this isn't theory. On ${lead.business || 'your business'}, ${lbad} of the ${L.results.length} directories I checked have you wrong or missing. Let me show you.` : `Good news on yours: the ${L.results.length} directories I checked mostly line up, so we protect that and build on it.`) : '',
    first_or_owner: first || 'the owner',
    ...coldVars(lead, intel, { kw, top, first, L, lbad, worst }),
    rep: ctx.rep || '',
    company: ctx.company || 'Rightway Growth',
    my_number: ctx.number || '',
    business: lead.business || '',
    city: lead.city || intel?.listing?.city || '',
    industry: info.label.toLowerCase(),
    keyword: kw,
    service_phrase: kw ? `"${kw}"` : `a ${info.label.toLowerCase()} company`,
    rank: intel ? rankText(intel.rank) : '',
    top_name: top?.title || '',
    top_name_or_them: top?.title || 'your top competitor',
    top_reviews: top?.reviews ?? '',
    top3_of_points: g ? `${g.top3} of ${g.points}` : 'only a few of the',
    top10_of_points: g ? `${top10Of(g)} of ${g.points}` : 'only a few of the',
    reviews: intel?.listing?.reviews ?? lead.reviews ?? '',
    rating: intel?.listing?.rating ?? lead.rating ?? '',
    price: price ? money(price) : '[your monthly]',
    setup: setup != null ? money(setup) : '[your buildout]',
    today_total: price && setup != null ? money(price + setup) : '[buildout + first month]',
    city_suffix: lead.city ? ` in ${lead.city}` : '',
    pain: probs[0] ? probs[0].title.toLowerCase() : 'not showing up on Google',
    scan_spread: spreadLine(lead, intel),
    services_list: (Q.services || []).map((x) => x.name).join(', ') || 'your Google profile, your listings and steady monthly work',
    price_anchor: anchor?.monthly && price && price >= anchor.monthly ? ''
      : `If we did everything we offer, every service and every area, it would be ${anchor?.setup != null ? money(anchor.setup) : '[your top buildout]'} to build out and ${anchor?.monthly ? money(anchor.monthly) : '[your top monthly]'} a month. (Pause.) But based on what you told me, you don't need all of that. I'm not going to sell you things you don't need. That's the whole reason I started this company.`,
    frame_scan: intel?.found ? `the clarity scan we ran on ${lead.business || 'your business'}` : `what Google shows when customers look for ${lead.business || 'you'}`,
    scan_meaning: !g ? 'Most owners have never seen this. Let\'s find out together where you really land.'
      : `And honestly${first ? `, ${first}` : ''}, ${t10 === 0 ? 'this is a lot lower than I expected' : t10 < g.points / 2 ? 'this is lower than I expected' : 'this is better than most, but there are still holes'}. Usually what this tells me is that people who already know your name can find you, but people searching for the service, the ones who have never heard of you, are finding someone else.`,
    drop_offer: drop?.monthly && price && price <= drop.monthly
      ? `I hear you. This is already as lean as we go, and it's priced so about one job covers it. Let me ask you: what's one new customer worth to you over a whole year, with repeat work and referrals? (Let them answer.) So one customer pays for the whole year. Does it make sense to keep losing those to ${top?.title || 'the competition'}?`
      : `OK, then let's right size it. I'd rather start you on what fits than not start you at all. We start with the core: your Google profile buildout, the listing cleanup, weekly posts, reviews and the monthly map. That's ${drop?.setup != null ? money(drop.setup) : '[your lower buildout]'} to build out and ${drop?.monthly ? money(drop.monthly) : '[your lower monthly]'} a month. We add the rest when the calls start coming. Does that work better?`,
    ticket: money(ticket),
    breakeven,
    breakeven_jobs: price ? `${breakeven} extra job${breakeven === 1 ? '' : 's'}` : 'a job or two',
    scan_line: scanLine(lead, intel),
    scan_intro: intel?.found ? `Here's the clarity scan we ran on ${lead.business || 'your business'}.` : `Let me pull up Google and show you what a customer sees when they look for ${lead.business || 'you'}.`,
    // Only claim a scan when research actually ran.
    opener_reason: intel?.found ? `We ran a Google clarity audit on ${lead.business || 'your business'} and found some inconsistencies in where you show up for ${kw ? `"${kw}"` : 'your main service'}.`
      : `We're running free Google clarity audits for ${info.label.toLowerCase()} businesses in ${lead.city || 'your area'}.`,
    hook_impact: g && top10Of(g) < g.points / 2 ? `That means when someone in ${lead.city || 'your area'} needs ${kw ? `"${kw}"` : 'what you do'} today, a lot of them are calling ${top?.title || 'someone else'} before they ever see you.`
      : g ? `You're strong close to home, but there are spots in ${lead.city || 'your area'} where customers see someone else first.`
      : 'Most people call one of the first businesses they see on that map, so every spot higher gets more of the calls.',
    vm_scan: intel?.found ? `I already ran part of yours. ${g ? (top && top.wins > g.top3 ? `${top.title} is showing up ahead of you in most of ${lead.city || 'your area'}.` : `You're on the first page in ${top10Of(g)} of ${g.points} spots around you, and I see a few quick wins.`) : 'I found a few quick wins.'}`
      : '',
    hook: probs[0] ? probs[0].talk : scanLine(lead, intel),
    problems: probs.slice(0, 3).map((p) => p.talk).join(' ') || 'A few gaps on your Google profile and website are holding you back.',
    slot1: slots[0], slot2: slots[1],
    email_or_phone: lead.email || lead.phone || 'your email',
    email_or_ask: lead.email || 'your email',
  };
}

// The cold call lines that change with what we know: no website, hours missing on Google, research run or not.
function coldVars(lead, intel, { kw, top, first, L, lbad, worst }) {
  const info = industryInfo(lead.industry, intel?.listing?.category || lead.category);
  const city = lead.city || intel?.listing?.city || '';
  const hasSite = Boolean(intel?.listing?.url || lead.website);
  const noHours = intel?.listing?.hours === false;
  const found = Boolean(intel?.found);
  const them = first || 'the owner';
  const jobs = 'more of the specific, profitable jobs you actually want';
  return {
    site_intro: hasSite ? '' : `IF THEY HAVE NO WEBSITE: Hey ${first || 'there'}, look, so I/we actually couldn't find your website online, so I/we decided to sit down and just built you one... look${first ? ` ${first}` : ''}, it's already done. You wanna see it?`,
    site_who: hasSite ? '' : "(If they ask who this is:) Oh my bad, I'm {rep}, with RightWay Growth. We build websites for {industry} businesses around {city}.",
    site_note: hasSite ? '' : '(Only when their demo site is built and the link is ready.)',
    open_line: noHours ? "Hey, you guys are open today, right? Google doesn't show your hours, so I wasn't sure." : 'Hey, you guys are still open, right?',
    open_where: noHours ? "(If they ask where:) On Google. Your hours aren't on your listing, so people can't tell if you're open." : "(If they ask why:) Just wanted to make sure I caught you before you closed.",
    strategy_note: found ? '' : '(No research yet? Say it this way:)',
    strategy_line: found ? `So I/we actually looked you guys up and used your info to build an **automated, tailored strategy** to help bring in ${jobs}.`
      : `So we've been putting together **tailored strategies** for ${info.label.toLowerCase()} businesses around ${city || 'here'} to help bring in ${jobs}.`,
    found_say: found ? `(If they ask what you found:) ${scanLine(lead, intel)}${L?.results?.length && lbad ? ` And ${lbad} of ${L.results.length} directories Google checks have you wrong or missing${worst ? `, ${worst.name} for one` : ''}.` : ''}` : '',
    value_line: top?.title ? `we can help you get more of the calls${kw ? ` from people searching "${kw}"` : ''} that are going to ${top.title} right now` : `we can help you get more of the calls from people searching for what you do around ${city || 'you'}`,
    gk_reason: found ? `I/we looked ${lead.business || 'the business'} up on Google and put something together for ${them}. It's quick.` : `We're putting together free Google plans for a few ${info.label.toLowerCase()} businesses around ${city || 'here'} and wanted to show ${them}.`,
    vm_line: found ? `I/we looked ${lead.business || 'you'} up on Google and put together a plan to bring in more of the profitable jobs.` : `We've been putting together free Google plans for ${info.label.toLowerCase()} businesses around ${city || 'here'} and we'd like to show you what we'd do for ${lead.business || 'you'}.`,
  };
}

// ** marks bold in script text (V's doc bolds the offer, like "free Competitor Analysis"). Screens that show script text as HTML turn it into <b>; plain text uses unbold.
export const unbold = (t) => String(t).replace(/\*\*/g, '');

const asLines = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => x.trim()).filter(Boolean);

export function buildScript(lead, intel, ctx = {}, custom = {}) {
  const S = { ...DEFAULT_SCRIPT, ...(custom.script || {}) };
  const objections = custom.objections?.length ? custom.objections : DEFAULT_OBJECTIONS;
  const v = scriptVars(lead, intel, { ...ctx, number: ctx.number || custom.number });
  // A line that is only a variable with nothing in it (no website, no research) is left out.
  const keep = (q) => { const m = q.match(/^\{(\w+)\}$/); return !m || (v[m[1]] != null && v[m[1]] !== ''); };
  return {
    vars: v,
    steps: SCRIPT_KEYS.map(([id, title]) => ({ id, title: title.replace(/^Cold: /, ''), group: SCRIPT_GROUPS.find((g) => g[2].includes(id))?.[0] || 'clarity', lines: asLines(S[id]).filter(keep).map((q) => voiceText(fill(fill(q, v), v), ctx.voice)).filter((q) => q.trim()) })).filter((st) => st.lines.length),
    groups: SCRIPT_GROUPS.map(([key, name]) => ({ key, name })),
    objections: objections.map(([q, a]) => ({ q: voiceText(q, ctx.voice), a: voiceText(fill(a, v), ctx.voice), ml: ML[q] ? { mirror: ML[q].mirror, label: voiceText(fill(ML[q].label, v), ctx.voice), ask: voiceText(fill(ML[q].ask, v), ctx.voice) } : null })),
    // Mirror and label catalog (46 objections with the funnel for yes, no and a dodge): public/js/rebuttals.js.
    catalog: catalogRows((t) => voiceText(fill(t, v), ctx.voice)),
    mlRules: ML_RULES,
    playbook: PLAYBOOK.map(([name, from, use]) => ({ name, from, use })),
  };
}

// ---------- ROI ----------
export function roi({ ticket, jobs, price: given }) {
  const price = Number(given) > 0 ? Number(given) : 0;
  const monthly = Math.max(0, Number(ticket) || 0) * Math.max(0, Number(jobs) || 0);
  return { monthly, yearly: monthly * 12, price, multiple: price ? monthly / price : 0, breakeven: price ? Math.ceil(price / Math.max(1, Number(ticket) || 1)) : 1 };
}
