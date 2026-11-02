// Day-one fulfillment: citation list, Google profile checklist, review target, and the 90 day plan.
// Pure functions used by the client page, the client app, and the presentation.
import { findProblems, industryInfo } from './leadintel.js';

const enc = encodeURIComponent;

// Directories worth being on, in priority order: where to claim or sign up, what it costs, what it feeds, and a one-click check.
// Sources: BrightLocal and Whitespark citation research (general, service area, and industry lists), each site's own business pages.
// "sab" = accepts a hidden address for service area businesses (true, false, or null when unknown).
const C = (name, url, group, cost, why, extra = {}) => ({ name, url, group, cost, why, ...extra });
const HOME = /Roof|HVAC|Plumb|Electric|Landscap|Tree|Pest|Pool|Garage|Locksmith|Moving|Clean|Pressure|Junk|Paint|Remodel|Concrete|Fenc|Floor|Window|Solar|Handyman|Restoration|Appliance|Septic|Foundation/;
const MED = /Dental|Medical|Chiro|Physical|Med spa|Plastic|Veterinary/;

export function citations(c = {}) {
  const name = c.name || c.business || '';
  const loc = [c.city || (c.address || '').split(',').slice(-2, -1)[0] || '', c.state || ''].join(' ').trim();
  const q = enc(`${name} ${loc}`.trim());
  const g = (site) => `https://www.google.com/search?q=${enc(`${name} site:${site}`)}`;
  const t = industryInfo(c.category || c.industry).label;
  const list = [
    C('Apple Business Connect', 'https://businessconnect.apple.com/', 'Core', 'Free', 'Apple Maps, Siri, and Spotlight on every iPhone', { check: `https://maps.apple.com/?q=${q}`, sab: false }),
    C('Bing Places', 'https://www.bingplaces.com/', 'Core', 'Free', 'Bing Maps and Copilot. Can import straight from the Google profile', { check: `https://www.bing.com/maps?q=${q}`, sab: false }),
    C('Yelp', 'https://biz.yelp.com/', 'Core', 'Free (ads are optional)', 'Ranks on page one for most service searches; Yelp reviews also show in other apps', { check: `https://www.yelp.com/search?find_desc=${enc(name)}&find_loc=${enc(loc)}`, sab: true }),
    C('Facebook page', 'https://www.facebook.com/pages/create', 'Core', 'Free', 'Same name, address, phone, hours, and website as Google', { check: `https://www.facebook.com/search/pages?q=${q}`, sab: true }),
    C('Better Business Bureau', 'https://www.bbb.org/', 'Core', 'Free listing, accreditation is paid', 'Trust signal customers check before big jobs', { check: `https://www.bbb.org/search?find_text=${enc(name)}&find_loc=${enc(loc)}`, sab: true }),
    C('Nextdoor', 'https://business.nextdoor.com/', 'Core', 'Free', 'Neighbor recommendations in the exact areas they serve', { check: g('nextdoor.com'), sab: true }),
    C('LinkedIn company page', 'https://www.linkedin.com/company/setup/new/', 'Core', 'Free', 'Brand search result and trust signal', { check: g('linkedin.com/company'), sab: true }),
    C('Data Axle', 'https://www.data-axle.com/', 'Data', 'Paid submission (or via a citation service)', 'Data aggregator: feeds maps, apps, and hundreds of directories', { check: null, sab: null }),
    C('Localeze (Neustar)', 'https://www.neustarlocaleze.biz/', 'Data', 'Paid submission (or via a citation service)', 'Data aggregator: feeds search engines, GPS, and directories', { check: null, sab: null }),
    C('Foursquare', 'https://foursquare.com/', 'Data', 'Free to claim', 'Location data used by many apps and maps', { check: `https://foursquare.com/explore?q=${q}`, sab: null }),
    C('Yellow Pages (YP)', 'https://www.yellowpages.com/', 'Directory', 'Free basic listing', 'Old but trusted; often already has wrong info to fix', { check: `https://www.yellowpages.com/search?search_terms=${enc(name)}&geo_location_terms=${enc(loc)}`, sab: null }),
    C('Manta', 'https://www.manta.com/', 'Directory', 'Free basic listing', 'Strong small business directory', { check: `https://www.manta.com/search?search=${q}`, sab: true }),
    C('MapQuest', 'https://www.mapquest.com/', 'Directory', 'Fed by data partners', 'Fix through the aggregators if it is wrong', { check: `https://www.mapquest.com/search/${q}`, sab: null }),
    C('Hotfrog', 'https://www.hotfrog.com/', 'Directory', 'Free', 'General directory', { check: g('hotfrog.com'), sab: null }),
    C('Alignable', 'https://www.alignable.com/', 'Directory', 'Free', 'Local business network and referrals', { check: g('alignable.com'), sab: true }),
    C('Brownbook', 'https://www.brownbook.net/', 'Directory', 'Free', 'General directory', { check: g('brownbook.net'), sab: null }),
    C('Local chamber of commerce', `https://www.google.com/search?q=${enc(`${loc} chamber of commerce`)}`, 'Local link', 'Paid membership', 'A link from a trusted local site, plus events and referrals', { check: null, sab: null }),
  ];
  const add = (...rows) => list.push(...rows);
  if (HOME.test(t)) {
    add(C('Angi', 'https://www.angi.com/', 'Industry', 'Free profile, leads are paid', 'Biggest home services directory. HomeAdvisor now runs under Angi', { check: `https://www.angi.com/search?query=${q}`, sab: true }),
      C('Thumbtack', 'https://www.thumbtack.com/pro', 'Industry', 'Free profile, pay per lead', 'Home services marketplace', { check: g('thumbtack.com'), sab: true }),
      C('Houzz', 'https://www.houzz.com/pro', 'Industry', 'Free profile', 'Home improvement; high trust for remodel and exterior work', { check: `https://www.houzz.com/professionals/query/${q}`, sab: true }),
      C('Porch', 'https://pro.porch.com/', 'Industry', 'Free profile', 'Home services directory', { check: g('porch.com'), sab: true }),
      C('BuildZoom', 'https://www.buildzoom.com/', 'Industry', 'Free profile', 'Contractor profiles built from license and permit records', { check: g('buildzoom.com'), sab: true }),
      C('GuildQuality', 'https://www.guildquality.com/', 'Industry', 'Paid membership', 'Verified customer surveys and reviews for contractors', { check: g('guildquality.com'), sab: true }));
  }
  if (/Roof/.test(t)) add(C('GAF contractor locator', 'https://www.gaf.com/', 'Certified', 'Certified contractors only', 'Homeowners search it by zip. Only if they hold a GAF certification', { sab: true }),
    C('Owens Corning contractor network', 'https://www.owenscorning.com/', 'Certified', 'Network members only', 'Find a contractor tool on owenscorning.com', { sab: true }),
    C('CertainTeed find a pro', 'https://www.certainteed.com/', 'Certified', 'Credentialed contractors only', 'Contractor locator for CertainTeed credentials', { sab: true }));
  if (/HVAC/.test(t)) add(C('ACCA find a contractor', 'https://www.acca.org/', 'Certified', 'ACCA members only', 'Air Conditioning Contractors of America member directory', { sab: true }),
    C('Equipment brand dealer locator', `https://www.google.com/search?q=${enc(`${name} dealer locator`)}`, 'Certified', 'Factory dealers only', 'If they are a Carrier, Trane, Lennox, or other factory dealer, ask the brand to list them', { sab: true }));
  if (/Plumb/.test(t)) add(C('Best Plumbers', 'https://www.bestplumbers.com/', 'Industry', 'Free basic listing', 'Plumbing directory that accepts service area businesses', { check: g('bestplumbers.com'), sab: true }));
  if (/Tree/.test(t)) add(C('ISA find an arborist', 'https://www.treesaregood.org/findanarborist', 'Certified', 'ISA certified arborists only', 'The directory homeowners use to check credentials', { sab: true }),
    C('TCIA member directory', 'https://www.tcia.org/', 'Certified', 'Members only', 'Tree Care Industry Association', { sab: true }));
  if (/Pest/.test(t)) add(C('NPMA find a pro (PestWorld)', 'https://www.pestworld.org/', 'Certified', 'NPMA members only', 'National Pest Management Association consumer directory', { sab: true }));
  if (/Restoration/.test(t)) add(C('IICRC certified firm locator', 'https://www.iicrc.org/', 'Certified', 'Certified firms only', 'Insurance adjusters and homeowners check this', { sab: true }));
  if (/Solar/.test(t)) add(C('EnergySage', 'https://www.energysage.com/', 'Industry', 'Marketplace, fees apply', 'Solar shoppers compare installers here', { check: g('energysage.com'), sab: true }),
    C('SolarReviews', 'https://www.solarreviews.com/', 'Industry', 'Free profile', 'Installer reviews', { check: g('solarreviews.com'), sab: true }));
  if (/Moving/.test(t)) add(C('AMSA ProMover', 'https://www.moving.org/', 'Certified', 'Certified members only', 'American Moving and Storage Association certification and directory', { sab: true }),
    C('MyMovingReviews', 'https://www.mymovingreviews.com/', 'Industry', 'Free profile', 'Mover reviews', { check: g('mymovingreviews.com'), sab: true }));
  if (MED.test(t)) {
    add(C('Healthgrades', 'https://www.healthgrades.com/', 'Industry', 'Free profile update', 'Top medical directory on Google', { check: `https://www.healthgrades.com/usearch?what=${q}`, sab: false }),
      C('Vitals', 'https://www.vitals.com/', 'Industry', 'Free', 'Provider ratings', { check: g('vitals.com'), sab: true }),
      C('WebMD Care', 'https://doctor.webmd.com/', 'Industry', 'Free', 'Provider directory', { check: g('doctor.webmd.com'), sab: false }),
      C('RateMDs', 'https://www.ratemds.com/', 'Industry', 'Free', 'Provider reviews, accepts hidden addresses', { check: g('ratemds.com'), sab: true }),
      C('Zocdoc', 'https://www.zocdoc.com/join', 'Industry', 'Paid', 'Online booking marketplace', { check: g('zocdoc.com'), sab: false }),
      C('Wellness.com', 'https://www.wellness.com/', 'Industry', 'Free basic listing', 'Health and wellness directory', { check: g('wellness.com'), sab: null }));
    if (/Dental/.test(t)) add(C('ADA Find-a-Dentist', 'https://findadentist.ada.org/', 'Certified', 'ADA members only', 'American Dental Association directory', { sab: false }));
    if (/Chiro/.test(t)) add(C('ACA find a doctor', 'https://handsdownbetter.org/', 'Certified', 'ACA members only', 'American Chiropractic Association consumer site', { sab: false }));
    if (/Physical/.test(t)) add(C('ChoosePT find a PT', 'https://www.choosept.com/', 'Certified', 'APTA members only', 'American Physical Therapy Association directory', { sab: false }));
    if (/Med spa|Plastic/.test(t)) add(C('RealSelf', 'https://www.realself.com/', 'Industry', 'Free profile, paid upgrades', 'Where cosmetic patients research providers', { check: g('realself.com'), sab: false }));
  }
  if (/Law/.test(t)) add(
    C('Avvo', 'https://www.avvo.com/', 'Industry', 'Free to claim', 'Ranks for most lawyer searches; claim and fill the profile', { check: g('avvo.com'), sab: true }),
    C('Justia', 'https://lawyers.justia.com/', 'Industry', 'Free basic profile', 'Huge legal directory with strong Google rankings', { check: g('lawyers.justia.com'), sab: true }),
    C('FindLaw', 'https://lawyers.findlaw.com/', 'Industry', 'Free basic profile', 'Thomson Reuters legal directory', { check: g('lawyers.findlaw.com'), sab: null }),
    C('Martindale-Hubbell', 'https://www.martindale.com/', 'Industry', 'Free basic profile', 'Peer ratings, long trusted', { check: g('martindale.com'), sab: null }),
    C('Lawyers.com', 'https://www.lawyers.com/', 'Industry', 'Free basic profile', 'Sister site of Martindale', { check: g('lawyers.com'), sab: null }),
    C('HG.org', 'https://www.hg.org/', 'Industry', 'Free basic listing', 'Legal directory, accepts hidden addresses', { check: g('hg.org'), sab: true }),
    C('US Legal', 'https://lawyers.uslegal.com/', 'Industry', 'Free basic listing', 'Legal directory', { check: g('uslegal.com'), sab: true }),
    C('Super Lawyers', 'https://www.superlawyers.com/', 'Certified', 'Peer selected', 'Only if selected; worth listing when they are', { check: g('superlawyers.com'), sab: null }),
    C('State bar directory', `https://www.google.com/search?q=${enc(`${c.state || ''} state bar find a lawyer`)}`, 'Certified', 'Free for members', 'Make sure the bar record matches the firm name, address, and phone', { sab: null }));
  if (/Financial|Wealth/.test(t)) add(
    C('CFP Board: Let\'s Make a Plan', 'https://www.letsmakeaplan.org/', 'Certified', 'CFP professionals only', 'The CFP Board\'s consumer search', { sab: null }),
    C('NAPFA find an advisor', 'https://www.napfa.org/', 'Certified', 'Fee-only members', 'National Association of Personal Financial Advisors', { sab: null }),
    C('XY Planning Network', 'https://www.xyplanningnetwork.com/', 'Certified', 'Members only', 'Fee-only advisor network with a consumer search', { sab: null }),
    C('FINRA BrokerCheck and SEC adviser search', 'https://brokercheck.finra.org/', 'Certified', 'Regulatory record', 'Not a directory to sign up for, but the firm name and address there should match Google', { sab: null }));
  if (/Insurance/.test(t)) add(C('Trusted Choice', 'https://www.trustedchoice.com/', 'Certified', 'Independent agents', 'Independent insurance agent finder', { sab: null }),
    C('Insurance Journal agency directory', 'https://www.insurancejournal.com/', 'Industry', 'Free basic listing', 'Insurance industry directory, accepts hidden addresses', { sab: true }));
  if (/Tax|Account/.test(t)) add(
    C('TaxBuzz', 'https://www.taxbuzz.com/', 'Industry', 'Free profile, paid upgrades', 'Tax pro and CPA directory', { check: g('taxbuzz.com'), sab: null }),
    C('CPA Directory', 'https://www.cpadirectory.com/', 'Industry', 'Free basic listing', 'CPA firm directory', { check: g('cpadirectory.com'), sab: null }),
    C('IRS directory of tax preparers', 'https://irs.treasury.gov/rpo/rpo.jsf', 'Certified', 'Credentialed preparers', 'The IRS public list of preparers with credentials; check the details match', { sab: null }),
    C('NAEA find an EA', 'https://www.naea.org/', 'Certified', 'Enrolled agent members', 'National Association of Enrolled Agents', { sab: null }),
    C('State CPA society directory', `https://www.google.com/search?q=${enc(`${c.state || ''} CPA society find a CPA`)}`, 'Certified', 'Members only', 'Most state CPA societies run a find a CPA search', { sab: null }));
  if (/Auto|Towing/.test(t)) add(
    C('RepairPal', 'https://repairpal.com/', 'Certified', 'Certification program, fees apply', 'Fair price estimates and certified shop search', { check: g('repairpal.com'), sab: false }),
    C('AAA Approved Auto Repair', 'https://www.aaa.com/autorepair/', 'Certified', 'Approved shops only', 'AAA members are told to use approved shops', { sab: false }),
    C('ASE Blue Seal', 'https://www.ase.com/', 'Certified', 'Qualifying shops', 'For shops with enough ASE certified techs', { sab: false }),
    C('CARFAX', 'https://www.carfax.com/', 'Industry', 'Free shop listing', 'Service history and shop reviews', { check: g('carfax.com'), sab: false }));
  if (/Restaurant/.test(t)) add(C('TripAdvisor', 'https://www.tripadvisor.com/Owners', 'Industry', 'Free', 'Restaurant and travel reviews', { check: `https://www.tripadvisor.com/Search?q=${q}`, sab: false }),
    C('OpenTable', 'https://restaurant.opentable.com/', 'Industry', 'Paid', 'Reservations', { sab: false }),
    C('DoorDash', 'https://get.doordash.com/', 'Industry', 'Commission', 'Delivery and pickup', { sab: false }),
    C('Uber Eats', 'https://merchants.ubereats.com/', 'Industry', 'Commission', 'Delivery and pickup', { sab: false }));
  if (/Salon|Fitness/.test(t)) add(C('Booksy', 'https://biz.booksy.com/', 'Industry', 'Paid', 'Booking marketplace', { sab: false }), C('Vagaro', 'https://www.vagaro.com/pro', 'Industry', 'Paid', 'Booking marketplace', { sab: false }),
    C('StyleSeat', 'https://www.styleseat.com/', 'Industry', 'Paid', 'Beauty booking', { sab: false }), C('ClassPass', 'https://classpass.com/partners', 'Industry', 'Commission', 'Fitness and wellness bookings', { sab: false }));
  if (/Real estate/.test(t)) add(C('Zillow agent profile', 'https://www.zillow.com/agent-resources/', 'Industry', 'Free profile', 'Where buyers and sellers look up agents', { sab: true }),
    C('Realtor.com', 'https://www.realtor.com/', 'Industry', 'Free profile', 'Agent search', { sab: true }));
  return list.map((x, i) => ({ id: `cit_${i}`, check: null, sab: null, ...x }));
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
