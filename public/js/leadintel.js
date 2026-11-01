// Lead intelligence: scoring, problems found, plan recommendation, call script, dedupe keys.
// Pure functions with no DOM or network, shared by the Worker, the Hub screens, and the tests.

// ---------- industries ----------
// ticket = typical value of one new customer, used only as an editable starting point on the ROI slide.
const INDUSTRIES = [
  [/roof/i, 'Roofing', 'roofing contractor', 8000],
  [/hvac|air cond|\bac\b|heating|cooling/i, 'HVAC', 'ac repair', 650],
  [/plumb/i, 'Plumbing', 'plumber', 450],
  [/electric/i, 'Electrical', 'electrician', 450],
  [/dent|orthodon/i, 'Dental', 'dentist', 1200],
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
  if (kw && (rank == null || rank > 3)) {
    add('not_top3', 'high', `Not in the top 3 for "${kw}"`, `At your own address you show up ${rankText(rank)}.${top ? ` ${top.title} is #1.` : ''}`,
      `I searched "${kw}" right from your address and you came up ${rankText(rank)}.${top ? ` ${top.title} is showing first.` : ''} Most calls go to the top 3.`,
      'Profile optimization, local pages, citations, and review velocity to move into the 3-pack.');
  }
  if (intel.grid && intel.grid.points > 1) {
    const share = intel.grid.top3;
    if (share / intel.grid.points < 0.5) {
      add('grid_weak', share === 0 ? 'high' : 'medium', `Top 3 in only ${share} of ${intel.grid.points} nearby spots`,
        `We checked ${intel.grid.points} points within ${intel.grid.radiusMiles} miles of the business. Average rank ${intel.grid.avg ?? 'outside the top 20'}.`,
        `A mile or two from your shop, you drop out of the top 3 in ${intel.grid.points - share} of the ${intel.grid.points} spots we checked. That's where your competitors are picking up your calls.`,
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

// ---------- plan ----------
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
    why.push(high ? `${high} serious problems to fix` : 'Room to move into the top 3', 'Needs pages, links, and reviews, not only profile work');
  }
  return { plan, why };
}

// ---------- call script ----------
export const DEFAULT_SCRIPT = {
  opener: "Hey {first}, this is {rep} with Rightway Growth. I'll be honest, this is a cold call. Can I take 30 seconds to tell you why I called, and you tell me if it's worth talking?",
  reason: '{hook} We help {industry} businesses in {city} get into the top 3 on Google Maps so the phone rings more. Is getting more calls from Google something you care about right now?',
  discovery: [
    'Where do most of your new customers come from right now?',
    'Roughly how many calls a week come from Google?',
    "What's a typical job worth to you?",
    'Could you handle more work right now, or are you booked out?',
    'Who takes care of your Google profile and website today?',
    'Have you worked with anyone on SEO before? How did it go?',
  ],
  pitch: "Here's what I found. {problems} The good news is these are all fixable. On our {plan} plan we fix the profile, build the pages and citations Google looks for, and set you up to get reviews every week. You get an app that shows every ranking and every task we do.",
  book: "What I'd like to do is show you a 15 minute screen share: where you show up across {city}, who's beating you, and exactly what we'd fix. Does {slot1} or {slot2} work better?",
  close: "Based on everything we looked at, {plan} is the right fit. It's {price} a month plus a one time {setup} setup, six months then month to month. I can send the agreement now. You sign on your phone, and we start this week. Want me to send it to {email_or_phone}?",
};

export const DEFAULT_OBJECTIONS = [
  ['Too expensive', "Totally fair. Let me ask: what's one new {industry} customer worth to you? About {ticket}? If we get you just {breakeven} extra jobs a month, the plan pays for itself. Would that be worth it?"],
  ['We get enough work / word of mouth', "That's great, it means you do good work. Word of mouth people still Google you before they call. When they search \"{keyword}\" they see {top_name} first with {top_reviews} reviews. Want to make sure they find you instead?"],
  ['Already have someone', 'Good, then you know it matters. Quick check: right now you show up {rank} for "{keyword}" at your own address. Are you happy with that? I can show you the map so you can compare.'],
  ['Send me an email', "Happy to. So it's useful and not junk, can I take 15 minutes on a screen share to walk you through your own map? Then I'll send everything after. {slot1} or {slot2}?"],
  ['Not interested', "No problem. Before I go, one question: if I could show you that {top_name} is getting calls that should be yours, would that be worth 15 minutes?"],
  ["I'm busy", "I get it, you're running a business. When's a better time for a 2 minute call back? I'll put it in my calendar."],
  ["Tried SEO, it didn't work", "That happens a lot. Usually nobody showed what they did. We show every task in your app and send a ranking map every month, and you can cancel with 30 days notice after six months."],
  ['Need to talk to my partner', 'Makes sense. Can we set 15 minutes with both of you so they see the same map and numbers? {slot1} or {slot2}?'],
  ['How long until results?', 'Profile fixes and reviews start showing in the first 30 to 60 days. Pages and links build over 3 to 6 months. That is why it is six months, then month to month.'],
  ['Do you guarantee rankings?', "Nobody honest can, Google decides rankings. What we guarantee is the work: every task in your plan, every month, and you see it in your app."],
  ['Are you with Google?', "No, we're an independent local marketing company in Hollywood, Florida. We help businesses show up better on Google."],
];

export function fill(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null && vars[k] !== '' ? String(vars[k]) : `[${k.replace(/_/g, ' ')}]`));
}

function nextSlots(at = Date.now()) {
  const out = [];
  const d = new Date(at);
  for (let i = 1; out.length < 2 && i < 10; i++) {
    const x = new Date(d.getTime() + i * 864e5);
    if (x.getDay() === 0 || x.getDay() === 6) continue;
    out.push(`${x.toLocaleDateString('en-US', { weekday: 'long' })} at ${out.length ? '2' : '10'}${out.length ? 'pm' : 'am'}`);
  }
  return out;
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const PRICES = { starter: [597, 397], growth: [997, 997], authority: [1497, 997], leader: [2497, 1497] };
const PLAN_LABEL = { starter: 'Starter', growth: 'Growth', authority: 'Authority', leader: 'Market Leader' };

export function scriptVars(lead = {}, intel = null, ctx = {}) {
  const info = industryInfo(lead.industry, intel?.listing?.category || lead.category);
  const plan = ctx.plan || recommendPlan(lead, intel).plan;
  const [price, setup] = PRICES[plan] || PRICES.growth;
  const top = intel?.competitors?.[0];
  const probs = findProblems(intel, lead);
  const slots = nextSlots(ctx.at);
  const ticket = ctx.ticket || info.ticket;
  return {
    first: (lead.contact_name || '').split(' ')[0] || '',
    rep: ctx.rep || '',
    business: lead.business || '',
    city: lead.city || intel?.listing?.city || '',
    industry: info.label.toLowerCase(),
    keyword: keywordFor(lead, intel) || '',
    rank: intel ? rankText(intel.rank) : '',
    top_name: top?.title || '',
    top_reviews: top?.reviews ?? '',
    reviews: intel?.listing?.reviews ?? lead.reviews ?? '',
    rating: intel?.listing?.rating ?? lead.rating ?? '',
    plan: PLAN_LABEL[plan],
    price: money(price),
    setup: money(setup),
    ticket: money(ticket),
    breakeven: Math.max(1, Math.ceil(price / Math.max(1, ticket))),
    hook: probs[0] ? probs[0].talk : `I was looking at ${info.keyword || 'businesses like yours'} in ${lead.city || 'your area'} on Google Maps and you came up.`,
    problems: probs.slice(0, 3).map((p) => p.talk).join(' ') || 'There are a few gaps on your Google profile and site.',
    slot1: slots[0], slot2: slots[1],
    email_or_phone: lead.email || lead.phone || 'your email',
  };
}

export function buildScript(lead, intel, ctx = {}, custom = {}) {
  const S = { ...DEFAULT_SCRIPT, ...(custom.script || {}) };
  const objections = custom.objections?.length ? custom.objections : DEFAULT_OBJECTIONS;
  const v = scriptVars(lead, intel, ctx);
  const disc = Array.isArray(S.discovery) ? S.discovery : String(S.discovery || '').split('\n').filter(Boolean);
  return {
    vars: v,
    steps: [
      { id: 'opener', title: 'Opener', lines: [fill(S.opener, v)] },
      { id: 'reason', title: 'Reason for the call', lines: [fill(S.reason, v)] },
      { id: 'discovery', title: 'Discovery', lines: disc.map((q) => fill(q, v)) },
      { id: 'pitch', title: 'What we found', lines: [fill(S.pitch, v)] },
      { id: 'book', title: 'Book the audit', lines: [fill(S.book, v)] },
      { id: 'close', title: 'Close', lines: [fill(S.close, v)] },
    ],
    objections: objections.map(([q, a]) => ({ q, a: fill(a, v) })),
  };
}

// ---------- ROI ----------
export function roi({ ticket, jobs, plan = 'growth' }) {
  const [price] = PRICES[plan] || PRICES.growth;
  const monthly = Math.max(0, Number(ticket) || 0) * Math.max(0, Number(jobs) || 0);
  return { monthly, yearly: monthly * 12, price, multiple: price ? monthly / price : 0, breakeven: Math.ceil(price / Math.max(1, Number(ticket) || 1)) };
}
