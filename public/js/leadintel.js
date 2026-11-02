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
// One pitch from the first dial to the signature. The scan is the hook on the phone and the centerpiece of the meeting.
// Plain words only: say "Google Maps", "the top 3", "calls". Never "SEO", "citations", "NAP", or "algorithm" to an owner.
// Each step is one or more lines; lines that start with "Or:" are alternatives, "(" lines are coaching notes.
export const SCRIPT_KEYS = [
  ['opener', 'Opener'], ['hook', 'The scan hook'], ['discovery', 'Questions'], ['gap', 'Sum up the gap'],
  ['book', 'Book the screen share'], ['lock', 'Lock it in'], ['close', 'Close'], ['voicemail', 'Voicemail'], ['gatekeeper', 'Gatekeeper'],
];

export const DEFAULT_SCRIPT = {
  opener: [
    "Hey {first}, it's {rep} with Rightway Growth down in Hollywood. I know I'm catching you in the middle of your day, so I'll be quick. {opener_reason} Got 30 seconds?",
    "Or: Hey {first}, {rep} here with Rightway Growth. Honest answer, this is a cold call. Would it be a terrible idea if I took 30 seconds to tell you why I called, and you tell me if it's worth another minute?",
    '(Smile when you dial. Slow, low, certain voice. Stop talking after the question.)',
  ].join('\n'),
  hook: [
    '{scan_line}',
    '{hook_impact}',
    'Quick question: when a new customer finds you now, is it mostly referrals, or do they find you on Google?',
  ].join('\n'),
  discovery: [
    "What's a typical job worth to you, ballpark? (Starting guess for {industry}: {ticket}.)",
    'About how many new calls a week come from Google right now?',
    'If you got five more good calls a week, could your crew handle it, or are you booked out?',
    'What kind of jobs do you want more of?',
    'Who takes care of your Google profile and website today?',
    "If nothing changes on Google for the next six months, what does that cost you? (Let them do the math. Stay quiet.)",
    "(Label what you hear: \"It sounds like you've built this on referrals, and Google hasn't caught up to how good your work is.\")",
  ].join('\n'),
  gap: [
    "So if I'm hearing you right: you do great work, your jobs are worth about {ticket}, and right now {top_name_or_them} gets the first look on Google in most of {city}. Every week that stays the same, those calls go to them. Is that fair?",
    "(Wait for \"that's right\". If they correct you, thank them and sum it up again.)",
    'The good news is the reasons are fixable. {problems}',
  ].join('\n'),
  book: [
    "Here's what I'd suggest. Give me 15 minutes on a screen share. I'll show you the full map street by street, who's beating you and exactly why, and the three fixes that would move you up fastest. Even if we never work together, you'll know exactly where you stand.",
    'Does {slot1} or {slot2} work better?',
    'Or: Would it be crazy to grab 15 minutes {slot1}? I promise to keep it to 15.',
  ].join('\n'),
  lock: [
    "Perfect. I'm sending a calendar invite with the video link to {email_or_ask}. What's the best email?",
    "Is there anyone else who makes marketing decisions with you? Let's get them on the same call so they see the same map.",
    'Is it OK if I text you a reminder and the link? (If yes, tap "They said yes to texts".)',
    "Before the call, search \"{keyword}\" from your phone and see who comes up. We'll go over it together.",
  ].join('\n'),
  close: [
    "Based on everything we just looked at, {plan} is the right fit for you: {plan_why}.",
    "It's {price} a month and a one time {setup} to set it all up. Six months, then month to month. You see every task we do and a new map every month in your own app.",
    "Just imagine six months from now: someone in {city} searches \"{keyword}\" and the first name they see is {business}.",
    'Do you want the agreement sent to your phone or your email?',
    '(Then stop talking. The next person who speaks loses.)',
  ].join('\n'),
  voicemail: [
    "Hey {first}, it's {rep} with Rightway Growth. {vm_scan} Give me a call back at {my_number}. Again, {rep}, {my_number}.",
    '(Under 25 seconds. Say the number twice, slowly. Then text only if they gave permission or texted first.)',
  ].join('\n'),
  gatekeeper: [
    "Hi, this is {rep} with Rightway Growth. I'm calling for {first_or_owner} about how {business} shows up on Google Maps. Are they around?",
    'Or: Who handles the marketing and the Google listing there? ... Great, what is the best time to catch them?',
    '(Be friendly and brief. Get a name and a time, not a pitch.)',
  ].join('\n'),
};

export const DEFAULT_OBJECTIONS = [
  ["It's too expensive", "I hear you, it's real money. Can I ask, is it the price itself, or not being sure it'll pay you back? (Let them answer.) A typical job for you is about {ticket}. {breakeven_jobs} a month covers the whole plan. Right now {top_name_or_them} is getting those calls. If we only got you {breakeven}, would it be worth it?"],
  ['I need to think about it', "Totally fair, it's a real decision. It sounds like something's still not sitting right. Usually it's the money, the timing, or whether it'll actually work. Which one is it for you? (Answer that one. Then: \"If we sort that out, is there anything else stopping you?\")"],
  ['Just send me an email', "Happy to. So it doesn't get buried, what part should I focus on? (Let them answer.) Honestly, the map makes way more sense on screen than in an email, and it's 15 minutes. Does {slot1} or {slot2} work?"],
  ['Not interested', "No problem, I appreciate you being straight with me. Is it that more calls from Google isn't a priority right now, or that you've been burned by marketing people before? (Listen. If burned, use that answer.) Would it be a bad idea if I just sent you the map so you have it?"],
  ['We have enough work / word of mouth', "That's the best problem to have, it means you do good work. Here's the thing: most referrals still Google you before they call. When they do, {top_name_or_them} is sitting right there with more reviews. We make sure the referral you earned doesn't end up calling them. And is the work you're getting the work you want, or would you take more of the bigger jobs?"],
  ['We already have someone', "Good, that means you take it seriously. Quick question: do they show you a map like this every month? Right now you're in the top 3 in {top3_of_points} spots around you. Is that where you expected to be? Let me show you the scan as a free second opinion. If they're doing great, you'll know."],
  ["We tried SEO, it didn't work", "I get it, and a lot of owners we talk to felt the same way. They paid every month and never saw what was actually done. What they found with us is that everything is visible: every task in your app and a new map every month, so you can check our work yourself. What happened with the last company?"],
  ["I'm busy right now", "Totally get it, you're running a business. Is later today or tomorrow morning better for 2 minutes? I'll put it in my calendar and call right on time."],
  ['I need to talk to my partner', "Makes sense, this should be a joint decision. What do you think they'll ask? (Answer it now.) Let's get 15 minutes with both of you so they see the same map. Does {slot1} or {slot2} work?"],
  ['How long until I see results?', 'Honest answer: profile fixes and new reviews start moving things in the first 30 to 60 days. Pages and links build over 3 to 6 months. That is why the plan is six months, then month to month. You see the map every month, so you watch it happen.'],
  ['Can you guarantee number 1?', "Anybody who guarantees number 1 on Google isn't being straight with you, because Google decides. What we guarantee is the work: every task in your plan, every month, shown in your app, with the map to prove where you stand."],
  ['Are you with Google?', "No, we're an independent local marketing company in Hollywood, Florida. We help businesses show up better on Google Maps and search."],
  ['How did you get my number?', "Your business number is public on your listings. I came across {business} while scanning who shows up for \"{keyword}\" in {city}."],
  ['Can you just do a one time fix?', "I wish it worked that way. Google keeps re-ranking every week, and {top_name_or_them} keeps adding reviews and posts. A one time fix slides back. That's why the smallest plan, Starter, is {starter_price} a month: enough to keep you moving up, not just patched."],
  ['Call me back in a few months', "Sure, I can do that. Out of curiosity, what changes in a few months? (Listen.) The only thing I'd say is every month you wait, {top_name_or_them} adds more reviews, and the gap gets more expensive to close. Would it hurt to see the map now, so you have it when you're ready?"],
];

// The methods behind the script, so the team knows why each line is there. Ideas summarized in our own words.
export const PLAYBOOK = [
  ['Ask permission to pitch', 'Jeb Blount, Fanatical Prospecting', 'Name the interruption and ask for 30 seconds. People relax when they feel in control.'],
  ['Lead with something specific', 'Drew Eric Whitman, Cashvertising', 'Real numbers beat claims: "top 3 in 2 of 9 spots" lands harder than "you could rank better".'],
  ['Use the 8 core wants', 'Drew Eric Whitman, Cashvertising', 'Owners want to win, to beat the guy across town, to stop worrying about slow months, and to be approved of. Point at the competitor by name.'],
  ['Teach them something new', 'Dixon and Adamson, The Challenger Sale', 'The map shows them something about their own business they did not know. That earns the meeting.'],
  ['Find the gap', 'Keenan, Gap Selling', 'Current state, the cost of it, and the future they want. The bigger the gap, the easier the yes.'],
  ['Ask what it costs them', 'Neil Rackham, SPIN Selling', 'Implication questions ("what does six more months of this cost?") make the problem feel urgent in their own words.'],
  ['Label and sum up', 'Chris Voss, Never Split the Difference', '"It sounds like..." and a summary they can answer with "that\'s right" build trust faster than any pitch.'],
  ['No-oriented questions', 'Chris Voss, Never Split the Difference', '"Would it be a bad idea to..." feels safe to say no to, so people say yes.'],
  ['Just imagine', 'Phil Jones, Exactly What to Say', 'Paint the after picture: their name first on the map. Let them see it before they buy it.'],
  ['Certainty in three things', 'Jordan Belfort, Way of the Wolf', 'They need to trust the plan, trust you, and trust the company. The app and monthly map prove all three.'],
  ['Listen, acknowledge, explore, respond', 'Jeb Blount, Objections', 'Never fight an objection. Agree it is fair, ask what is behind it, then answer the real one.'],
  ['Feel, felt, found', 'Classic sales method', 'Others felt the same; here is what they found. Use it only with true stories.'],
  ['Alternative choice and silence', 'Zig Ziglar, Secrets of Closing the Sale', 'Offer two yeses ("Tuesday or Wednesday", "phone or email"), then stop talking.'],
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

// The one sentence the whole pitch hangs on: what the scan found, in numbers.
export function scanLine(lead = {}, intel = null) {
  const info = industryInfo(lead.industry, intel?.listing?.category || lead.category);
  const kw = keywordFor(lead, intel) || info.keyword || 'your service';
  const name = lead.business || 'your business';
  const g = intel?.grid;
  const top = intel?.competitors?.[0];
  if (g && g.points) {
    const where = `${g.points} spots around ${name}, up to ${g.radiusMiles} miles out`;
    if (!g.top3) return `I searched "${kw}" on Google from ${where}, like a customer would. You didn't show up in the top 3 in any of them.${top ? ` ${top.title} did in ${top.wins} of ${g.points}.` : ''}`;
    return `I searched "${kw}" on Google from ${where}, like a customer would. You were in the top 3 in ${g.top3} of ${g.points}.${top && top.wins > g.top3 ? ` ${top.title} was in ${top.wins}.` : ''}`;
  }
  if (intel?.found && intel.rank != null) return `When someone near your address searches "${kw}" on Google, you come up ${rankText(intel.rank)}.${top ? ` ${top.title} is above you.` : ''}`;
  if (intel?.found) return `When someone near your address searches "${kw}" on Google, you don't show up in the top 20.${top ? ` ${top.title} comes up first.` : ''}`;
  return `I was looking at who comes up on Google Maps when people search "${kw}" in ${lead.city || 'your area'}, and I wanted to see where ${name} lands.`;
}

export function scriptVars(lead = {}, intel = null, ctx = {}) {
  const info = industryInfo(lead.industry, intel?.listing?.category || lead.category);
  const rec = recommendPlan(lead, intel);
  const plan = ctx.plan || rec.plan;
  const [price, setup] = PRICES[plan] || PRICES.growth;
  const top = intel?.competitors?.[0];
  const probs = findProblems(intel, lead);
  const slots = nextSlots(ctx.at);
  const ticket = ctx.ticket || info.ticket;
  const g = intel?.grid;
  const kw = keywordFor(lead, intel) || '';
  const breakeven = Math.max(1, Math.ceil(price / Math.max(1, ticket)));
  const first = (lead.contact_name || '').split(' ')[0] || '';
  return {
    first,
    first_or_owner: first || 'the owner',
    rep: ctx.rep || '',
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
    reviews: intel?.listing?.reviews ?? lead.reviews ?? '',
    rating: intel?.listing?.rating ?? lead.rating ?? '',
    plan: PLAN_LABEL[plan],
    plan_why: rec.why.join(', ').toLowerCase(),
    price: money(price),
    setup: money(setup),
    starter_price: money(PRICES.starter[0]),
    ticket: money(ticket),
    breakeven,
    breakeven_jobs: `${breakeven} extra job${breakeven === 1 ? '' : 's'}`,
    scan_line: scanLine(lead, intel),
    // Only claim a scan when research actually ran.
    opener_reason: intel?.found ? `I ran ${lead.business || 'your business'} through our Google map scanner and found something you'll want to see.`
      : `I was looking at who shows up on Google Maps for ${kw ? `"${kw}"` : 'your service'} in ${lead.city || 'your area'}, and I have a quick question about ${lead.business || 'your business'}.`,
    hook_impact: g && g.top3 < g.points / 2 ? `That means when someone in ${lead.city || 'your area'} needs ${kw ? `"${kw}"` : 'what you do'} today, a lot of them are calling ${top?.title || 'someone else'} before they ever see you.`
      : g ? `You're strong close to home, but there are spots in ${lead.city || 'your area'} where customers see someone else first.`
      : 'Most people call one of the first three businesses they see on that map, so where you land decides who gets the call.',
    vm_scan: intel?.found ? `I ran a Google map scan on ${lead.business || 'your business'}. ${g ? (top && top.wins > g.top3 ? `${top.title} is showing up ahead of you in most of ${lead.city || 'your area'}.` : `You're in the top 3 in ${g.top3} of ${g.points} spots around you, and I see a few quick wins.`) : 'I found a few quick wins.'} I'd like to show you the map.`
      : `I was looking at ${lead.business || 'your business'} on Google Maps and have a couple of ideas to get you more calls from it.`,
    hook: probs[0] ? probs[0].talk : scanLine(lead, intel),
    problems: probs.slice(0, 3).map((p) => p.talk).join(' ') || 'A few gaps on your Google profile and website are holding you back.',
    slot1: slots[0], slot2: slots[1],
    email_or_phone: lead.email || lead.phone || 'your email',
    email_or_ask: lead.email || 'your email',
  };
}

const asLines = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => x.trim()).filter(Boolean);

export function buildScript(lead, intel, ctx = {}, custom = {}) {
  const S = { ...DEFAULT_SCRIPT, ...(custom.script || {}) };
  const objections = custom.objections?.length ? custom.objections : DEFAULT_OBJECTIONS;
  const v = scriptVars(lead, intel, { ...ctx, number: ctx.number || custom.number });
  return {
    vars: v,
    steps: SCRIPT_KEYS.map(([id, title]) => ({ id, title, lines: asLines(S[id]).map((q) => fill(q, v)) })),
    objections: objections.map(([q, a]) => ({ q, a: fill(a, v) })),
    playbook: PLAYBOOK.map(([name, from, use]) => ({ name, from, use })),
  };
}

// ---------- ROI ----------
export function roi({ ticket, jobs, plan = 'growth' }) {
  const [price] = PRICES[plan] || PRICES.growth;
  const monthly = Math.max(0, Number(ticket) || 0) * Math.max(0, Number(jobs) || 0);
  return { monthly, yearly: monthly * 12, price, multiple: price ? monthly / price : 0, breakeven: Math.ceil(price / Math.max(1, Number(ticket) || 1)) };
}
