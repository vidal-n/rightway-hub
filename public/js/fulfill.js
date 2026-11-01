// Day-one fulfillment: citation list, Google profile checklist, review target, and the 90 day plan.
// Pure functions used by the client page, the client app, and the presentation.
import { findProblems, industryInfo } from './leadintel.js';

const enc = encodeURIComponent;

// Directories worth being on, in priority order. Each has a search link so the team can check the listing in one click.
export function citations(c = {}) {
  const name = c.name || c.business || '';
  const loc = [c.city || (c.address || '').split(',').slice(-2, -1)[0] || '', c.state || ''].join(' ').trim();
  const q = enc(`${name} ${loc}`.trim());
  const info = industryInfo(c.category || c.industry);
  const list = [
    ['Apple Business Connect', 'https://businessconnect.apple.com/', 'Core', 'Apple Maps and Siri'],
    ['Bing Places', 'https://www.bingplaces.com/', 'Core', 'Bing, Copilot, and ChatGPT search'],
    ['Yelp', `https://www.yelp.com/search?find_desc=${enc(name)}&find_loc=${enc(loc)}`, 'Core', 'Feeds Apple Maps reviews'],
    ['Facebook', `https://www.facebook.com/search/pages?q=${q}`, 'Core', 'Page with the same name, address, phone'],
    ['Better Business Bureau', `https://www.bbb.org/search?find_text=${enc(name)}&find_loc=${enc(loc)}`, 'Core', 'Trust signal'],
    ['Nextdoor', 'https://business.nextdoor.com/', 'Core', 'Neighborhood recommendations'],
    ['Foursquare', `https://foursquare.com/explore?q=${q}`, 'Data', 'Feeds many apps and maps'],
    ['Data Axle', 'https://www.dataaxlegenie.com/', 'Data', 'Data aggregator'],
    ['Neustar Localeze', 'https://www.neustarlocaleze.biz/', 'Data', 'Data aggregator'],
    ['Yellow Pages', `https://www.yellowpages.com/search?search_terms=${enc(name)}&geo_location_terms=${enc(loc)}`, 'Directory', ''],
    ['Manta', `https://www.manta.com/search?search=${q}`, 'Directory', ''],
    ['MapQuest', `https://www.mapquest.com/search/${q}`, 'Directory', ''],
    ['Hotfrog', 'https://www.hotfrog.com/', 'Directory', ''],
    ['Local Chamber of Commerce', `https://www.google.com/search?q=${enc(`${loc} chamber of commerce`)}`, 'Local link', 'Membership link from a trusted local site'],
  ];
  const t = info.label;
  if (/Roof|HVAC|Plumb|Electric|Landscap|Tree|Pest|Pool|Garage|Locksmith|Moving|Clean|Pressure|Junk|Paint|Remodel|Concrete|Fenc|Floor|Window|Solar|Handyman|Restoration|Appliance/.test(t)) {
    list.push(['Angi', `https://www.angi.com/search?query=${q}`, 'Industry', 'Home services'], ['HomeAdvisor', 'https://pro.homeadvisor.com/', 'Industry', 'Home services'],
      ['Thumbtack', 'https://www.thumbtack.com/pro', 'Industry', 'Home services'], ['Houzz', `https://www.houzz.com/professionals/query/${q}`, 'Industry', 'Home improvement'],
      ['Porch', 'https://pro.porch.com/', 'Industry', 'Home services']);
  }
  if (/Dental|Medical|Chiro|Physical|Med spa|Veterinary/.test(t)) {
    list.push(['Healthgrades', `https://www.healthgrades.com/usearch?what=${q}`, 'Industry', 'Medical'], ['Zocdoc', 'https://www.zocdoc.com/join', 'Industry', 'Medical'],
      ['WebMD Care', 'https://doctor.webmd.com/', 'Industry', 'Medical'], ['Vitals', 'https://www.vitals.com/', 'Industry', 'Medical']);
  }
  if (/Law/.test(t)) list.push(['Avvo', 'https://www.avvo.com/', 'Industry', 'Legal'], ['Justia', 'https://lawyers.justia.com/', 'Industry', 'Legal'], ['FindLaw', 'https://lawyers.findlaw.com/', 'Industry', 'Legal'], ['Martindale', 'https://www.martindale.com/', 'Industry', 'Legal']);
  if (/Restaurant/.test(t)) list.push(['TripAdvisor', `https://www.tripadvisor.com/Search?q=${q}`, 'Industry', 'Restaurants'], ['OpenTable', 'https://restaurant.opentable.com/', 'Industry', 'Restaurants'], ['Uber Eats', 'https://merchants.ubereats.com/', 'Industry', 'Restaurants']);
  if (/Auto|Towing/.test(t)) list.push(['RepairPal', 'https://repairpal.com/shops', 'Industry', 'Auto'], ['CarFax Service', 'https://www.carfax.com/', 'Industry', 'Auto'], ['Mechanic Advisor', 'https://www.mechanicadvisor.com/', 'Industry', 'Auto']);
  if (/Salon|Fitness/.test(t)) list.push(['Booksy', 'https://biz.booksy.com/', 'Industry', 'Beauty and wellness'], ['Vagaro', 'https://www.vagaro.com/pro', 'Industry', 'Beauty and wellness'], ['ClassPass', 'https://classpass.com/partners', 'Industry', 'Fitness']);
  if (/Real estate|Insurance|Accounting/.test(t)) list.push(['Zillow', 'https://www.zillow.com/agent-resources/', 'Industry', 'Real estate'], ['Alignable', 'https://www.alignable.com/', 'Industry', 'Local business network']);
  return list.map(([name, url, group, why], i) => ({ id: `cit_${i}`, name, url, group, why }));
}

// Google profile checklist, pre-checked from what the research saw.
export function gbpChecklist(intel = null) {
  const L = intel?.listing || {};
  const has = (v) => (v == null ? null : Boolean(v));
  return [
    { key: 'claimed', label: 'Profile claimed and verified, Rightway added as Manager', state: L.claimed == null ? null : L.claimed },
    { key: 'category', label: 'Best primary category plus every relevant secondary category', state: L.additional_categories ? L.additional_categories.length >= 2 : null },
    { key: 'name', label: 'Business name matches real signage (no keyword stuffing)', state: null },
    { key: 'nap', label: 'Address or service area and phone match the website exactly', state: null },
    { key: 'hours', label: 'Regular hours, holiday hours, and special hours set', state: has(L.hours) },
    { key: 'services', label: 'Every service listed with a short description', state: null },
    { key: 'description', label: '750 character description with services and cities', state: null },
    { key: 'photos', label: 'At least 30 real photos: team, jobs, vehicles, storefront', state: L.photos == null ? null : L.photos >= 30 },
    { key: 'logo', label: 'Logo and cover photo set', state: null },
    { key: 'website', label: 'Website and booking links with tracking (UTM)', state: L.url ? true : intel ? false : null },
    { key: 'attributes', label: 'Attributes set (veteran owned, women owned, payments, accessibility)', state: null },
    { key: 'products', label: 'Products or services gallery with prices where possible', state: null },
    { key: 'faq', label: 'FAQ content on the website (Google Q&A was retired in 2025)', state: null },
    { key: 'reviews', label: 'Review link and QR code live, replies to every review', state: null },
    { key: 'posts', label: 'Weekly posts with a photo and a call to action', state: null },
  ];
}

// How many new reviews to pass the leader at the current pace, and per month over 6 months.
export function reviewTarget(intel = null) {
  const mine = intel?.listing?.reviews ?? 0;
  const top = intel?.competitors?.[0];
  if (!top || !top.reviews) return { mine, leader: null, gap: 0, perMonth: 8, text: 'Aim for 8 or more new reviews a month.' };
  const gap = Math.max(0, top.reviews - mine + 1);
  const perMonth = Math.max(4, Math.ceil(gap / 6));
  return { mine, leader: top.title, leaderReviews: top.reviews, gap, perMonth, text: gap ? `${gap} reviews to pass ${top.title}. That is about ${perMonth} a month over six months.` : `Already ahead of ${top.title}. Keep at least ${perMonth} a month.` };
}

const FIX_WEEK = { not_found: 1, unclaimed: 1, no_hours: 1, few_photos: 2, few_reviews: 1, review_gap: 1, low_rating: 1, no_website: 2, site_down: 1, no_https: 2, weak_title: 2, no_click_to_call: 2, no_schema: 3, slow_site: 4, not_top3: 4, grid_weak: 6 };

export function ninetyDayPlan(plan = 'growth', intel = null, lead = {}) {
  const probs = findProblems(intel, lead);
  const pages = { starter: 0, growth: 2, authority: 4, leader: 6 }[plan] ?? 2;
  const links = { starter: 0, growth: 4, authority: 6, leader: 10 }[plan] ?? 4;
  const m1 = ['Kickoff call and access to the Google profile, website, and Analytics', 'Baseline map scan saved (your "before")', 'Google profile fully optimized: categories, services, description, hours, photos',
    'Review link, text template, and counter QR code live', 'Citations fixed on Apple, Bing, Yelp, Facebook, BBB, and the data aggregators', 'First on-page fixes: titles, headings, tap-to-call'];
  const m2 = ['4 Google posts with real job photos', pages ? `${pages} new service or city pages` : 'On-page fix on the website', links ? `${links} local links or citations` : 'Citation cleanup continues',
    'Review replies within 48 hours', 'First monthly ranking report and results meeting'];
  const m3 = ['Second map scan compared to the baseline', 'Double down on the keywords and areas that moved', pages ? `${pages} more pages aimed at the weakest areas` : 'Next on-page fix', 'Competitor check: who moved and why', 'Plan for months 4 to 6'];
  const fixes = probs.map((p) => ({ week: FIX_WEEK[p.key] || 3, title: p.title, fix: p.fix })).sort((a, b) => a.week - b.week);
  return { months: [{ title: 'Month 1: Foundation', items: m1 }, { title: 'Month 2: Build', items: m2 }, { title: 'Month 3: Compound', items: m3 }], fixes };
}

// The "before vs now" comparison for reports.
export function compareIntel(before, after) {
  if (!before || !after) return null;
  const b = before.listing || {}, a = after.listing || {};
  const d = (x, y) => (x != null && y != null ? y - x : null);
  return {
    rank: { before: before.rank, after: after.rank, better: before.rank == null ? after.rank != null : after.rank != null && after.rank < before.rank },
    top3: { before: before.grid?.top3 ?? null, after: after.grid?.top3 ?? null, change: d(before.grid?.top3, after.grid?.top3) },
    reviews: { before: b.reviews ?? null, after: a.reviews ?? null, change: d(b.reviews, a.reviews) },
    rating: { before: b.rating ?? null, after: a.rating ?? null, change: d(b.rating, a.rating) },
    speed: { before: before.speed?.score ?? null, after: after.speed?.score ?? null, change: d(before.speed?.score, after.speed?.score) },
    problems: { before: findProblems(before).length, after: findProblems(after).length },
  };
}
