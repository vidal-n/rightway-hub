// Owner direct niche templates (Nov 2026, V: the best leads to scrape where the owner answers, templates down to the industry and niche,
// and Saturday call lists). From the research report "Owner direct lead scraping" (templates section). Pure, shared by the Pipeline,
// the Lead finder plays and the Node tests. Modeled on Scrap.io and Outscraper category presets plus Apollo.io saved searches.
//
// Measured facts used in the angles: BrightLocal 2026 (47% skip a business under 20 reviews, 74% only read reviews from the last 3 months,
// 68% want 4 stars or more). Everything else here (call windows, review bands, which niches answer on Saturday) is practitioner opinion and
// our own judgment, to be checked against Call insights after about 200 owner conversations per niche.

// Shared Pipeline filter for every template: no big brands, toll free numbers or 400+ review chains (likelyOwner). Review ranges are left
// to the Lead finder (Google gives the counts there): in the Pipeline they would hide every lead whose count is not known yet.
export const SHARED = { small: true };

// match: tested against industry, category and business name. kw: Lead finder keywords. industries: the TARGET_INDUSTRIES keyword for plays.
export const NICHES = [
  { id: 'garage', name: 'Garage door', day: 'weekday', match: /garage door/i, kw: ['garage door repair', 'garage door spring repair', 'garage door opener installation'], industries: ['garage door repair'],
    window: '8 to 9:30am, 4 to 6pm their time', extra: 'A personal name in the business name is a plus.', angle: 'A broken spring gets searched from the driveway. The top 3 on the map get that call.' },
  { id: 'screen', name: 'Screen enclosures', day: 'weekday', match: /screen|lanai|pool cage|enclos/i, kw: ['pool screen repair', 'screen enclosure', 'lanai rescreening', 'pool cage'], industries: ['screen enclosure'],
    window: '9 to 11am, 3 to 5pm', extra: 'Broward and Miami-Dade first.', angle: 'Own the map before hurricane season and the rush after a storm.' },
  { id: 'pool', name: 'Pool service', day: 'both', match: /pool/i, kw: ['pool service', 'pool cleaning', 'pool repair', 'pool pump repair'], industries: ['pool service'], f: { maxReviews: 50 },
    window: '11:30am to 1pm, 4 to 6pm (Saturday 10am to noon)', extra: 'Service area, under 50 reviews, no website or a builder site.', angle: 'One new route stop is a year of monthly service. New homeowners pick from the map.' },
  { id: 'hvac', name: 'Small HVAC', day: 'weekday', match: /hvac|air cond|\bac\b|a\/c|heating|cooling/i, kw: ['ac repair', 'air conditioning service', 'ac installation'], industries: ['ac repair'], f: { minReviews: 20 },
    window: '8 to 9:30am, 4 to 6pm. Push December to May.', extra: '1 to 10 vans (about 20 to 150 reviews), skip brand names.', angle: 'Summer breakdown calls go to the top 3. Winter is when you build the rank.' },
  { id: 'plumb', name: 'Independent plumbing', day: 'weekday', match: /plumb|drain|water heater|rooter/i, kw: ['plumber', 'emergency plumber', 'drain cleaning', 'water heater repair'], industries: ['plumber'],
    window: '8 to 9:30am, 4 to 6pm', extra: 'A last review older than 90 days is the hook.', angle: '74% of people only read reviews from the last 3 months. When was your last one?' },
  { id: 'pressure', name: 'Pressure washing', day: 'both', match: /pressure wash|power wash|soft wash|roof clean|paver (seal|clean)/i, kw: ['pressure washing', 'roof cleaning', 'soft wash', 'paver sealing'], industries: ['pressure washing'],
    window: '9 to 10am, 4 to 6pm (Saturday 10am to noon, 3 to 5pm)', extra: 'Service area, mobile line.', angle: 'HOA and mildew work all year. Who shows up when a neighbor searches?' },
  { id: 'tree', name: 'Tree service', day: 'weekday', match: /\btrees?\b|stump|arborist/i, kw: ['tree removal', 'tree trimming', 'palm tree trimming', 'stump grinding'], industries: ['tree service'],
    window: '8 to 9:30am, 4 to 6pm', extra: 'Skip storm chasers with out of state numbers.', angle: 'Storm season work goes to whoever is on the map first.' },
  { id: 'appliance', name: 'Appliance repair', day: 'both', match: /appliance|refrigerator|fridge|washer|dryer/i, kw: ['appliance repair', 'refrigerator repair', 'washer repair', 'dryer repair'], industries: ['appliance repair'],
    window: '9 to 10:30am, 3 to 5pm (Saturday 10am to 1pm)', extra: 'Mobile line, owner name known.', angle: 'Same day need. Someone with a dead fridge calls the first 3 they see.' },
  { id: 'tint', name: 'Window tinting', day: 'both', match: /\btint/i, kw: ['window tinting', 'car window tint', 'home window tint'], industries: ['window tinting'],
    window: '10 to 11:30am, 2 to 4pm (Saturday 10 to 11am)', extra: 'Shop address, under 150 reviews.', angle: 'The map is your storefront. Under 20 reviews loses 47% of shoppers.' },
  { id: 'auto', name: 'Auto repair', day: 'weekday', match: /auto ?(repair|shop|service)|mechanic|brake|transmission|car repair/i, kw: ['auto repair', 'mechanic', 'brake repair', 'car ac repair'], industries: ['auto repair shop'],
    window: '1 to 3pm (owner out of the bay)', extra: 'Rating under 4.3 or under 20 reviews is the hook.', angle: '68% only use a 4 star or better shop. Here is where you sit.' },
  { id: 'fence', name: 'Fencing', day: 'weekday', match: /fenc/i, kw: ['fence installation', 'fence company', 'vinyl fence', 'aluminum fence'], industries: ['fence company'],
    window: '8 to 9:30am, 4 to 6pm', extra: 'Low competition areas first.', angle: 'High ticket, few strong competitors on the map. One job pays for months.' },
  { id: 'detail', name: 'Mobile detailing', day: 'saturday', match: /detail/i, kw: ['mobile detailing', 'car detailing'], industries: ['auto detailing'],
    window: 'Saturday 10 to 11am, before the rush', extra: 'Saturday hours listed.', angle: 'Saturday is your busiest search day. Are you in the top 3?' },
  { id: 'lawn', name: 'Lawn and landscaping (bigger crews)', day: 'saturday', match: /lawn|landscap/i, kw: ['landscaping', 'lawn service'], industries: ['landscaping company'], f: { minReviews: 20 },
    window: 'Saturday 10am to noon', extra: '20 or more reviews or a website, mobile line.', angle: 'New homeowners pick from the map on weekends.' },
  { id: 'handyman', name: 'Handyman', day: 'saturday', match: /handyman|handy man/i, kw: ['handyman'], industries: ['handyman'],
    window: 'Saturday 10am to 1pm', extra: 'Mobile line, owner name known.', angle: 'Weekend projects start with a search. Reviews from the last 3 months win.' },
  // Added Nov 2026 with the lead template builder steps (V: more templates). Census nonemployer shares and Google's Local Services Ads trade list are
  // the only trade facts used; windows and review bands are opinion to test in Call insights.
  { id: 'roof', name: 'Roofing (small crews)', day: 'weekday', match: /roof/i, kw: ['roofing contractor', 'roof repair', 'roof replacement', 'roof leak repair'], industries: ['roofing contractor'], f: { minReviews: 10 },
    window: '7:30 to 9am, 4 to 6pm', extra: 'Skip storm chasers with out of state numbers. Check the license by hand first.', angle: 'Roofing is on Google\'s Local Services Ads list, so some competitors may pay for the spot above the map. The map is the free spot under it.' },
  { id: 'electric', name: 'Independent electrician', day: 'weekday', match: /electrician|electrical (contractor|service|repair)|electric(al)? contractor/i, kw: ['electrician', 'emergency electrician', 'electrical repair', 'panel upgrade'], industries: ['electrician'], f: { minReviews: 10 },
    window: '8 to 9:30am, 4 to 6pm', extra: 'Census data lists about two thirds of electrical contractors as one person firms. Look for 20 to 120 reviews.', angle: 'A dead outlet or a tripped panel gets a call to the first few on the map. 74% only read reviews from the last 3 months. When was your last one?' },
  { id: 'paint', name: 'Painting contractor', day: 'weekday', match: /painter|painting/i, kw: ['painter', 'house painter', 'interior painting', 'exterior painting'], industries: ['painter'],
    window: '8 to 9:30am, 4 to 6pm', extra: 'Skip paint stores. Under 60 reviews is easier to move up.', angle: 'A whole house job is a big check, and people compare three painters from the map. 47% will not use a business with fewer than 20 reviews.' },
  { id: 'junk', name: 'Junk removal', day: 'both', match: /junk|haul/i, kw: ['junk removal', 'junk hauling', 'furniture removal', 'trash removal'], industries: ['junk removal'],
    window: '9 to 10:30am, 3 to 5pm (Saturday 10am to noon)', extra: 'Junk removal is on Google\'s Local Services Ads list. Mobile line, owner name known.', angle: 'People who need a haul away this week call the first few on the map.' },
  { id: 'carpet', name: 'Carpet and upholstery cleaning', day: 'both', match: /carpet|upholster/i, kw: ['carpet cleaning', 'upholstery cleaning', 'tile and grout cleaning', 'rug cleaning'], industries: ['carpet cleaning'], f: { minReviews: 20 },
    window: '11am to 1pm, 3 to 5pm (Saturday 10am to noon)', extra: 'Census data lists most as one person firms with small receipts, so aim for 20 or more reviews or a website.', angle: 'One happy customer comes back every year. 47% of people will not use a business with fewer than 20 reviews.' },
  { id: 'pest', name: 'Independent pest control', day: 'weekday', match: /pest|extermin|termite/i, kw: ['pest control', 'termite treatment', 'rodent control', 'mosquito control'], industries: ['pest control'], f: { minReviews: 20 },
    window: '8 to 9:30am, 4 to 6pm', extra: 'Skip the national brands. One to a few trucks, 20 to 150 reviews.', angle: 'Every customer pays again each month or quarter. The map decides who gets the next one.' },
  { id: 'concrete', name: 'Concrete and pavers', day: 'weekday', match: /concrete|paving|asphalt|paver/i, kw: ['concrete contractor', 'concrete driveway', 'paver installation', 'stamped concrete'], industries: ['concrete contractor'],
    window: '7:30 to 9am, 4 to 6pm', extra: 'Skip ready mix plants and big paving firms. Owner on site, so call early.', angle: 'Driveways and patios are big checks that people research on the map first.' },
  { id: 'floor', name: 'Flooring and epoxy', day: 'weekday', match: /floor|epoxy/i, kw: ['flooring installation', 'tile installation', 'epoxy flooring', 'hardwood floor refinishing'], industries: ['flooring'],
    window: '8 to 9:30am, 4 to 6pm', extra: 'Flooring is on Google\'s Local Services Ads list. Skip big box showrooms.', angle: 'A floor is a big check. The shops at the top of the map get the quotes.' },
  { id: 'remodel', name: 'Remodeling (small contractors)', day: 'weekday', match: /remodel|renovat|kitchen|bathroom|general contractor/i, kw: ['remodeling contractor', 'kitchen remodeling', 'bathroom remodeling', 'home renovation'], industries: ['remodeling contractor'], f: { minReviews: 10 },
    window: '8 to 9:30am, 4 to 6pm', extra: 'Owner run, 10 to 150 reviews. Skip design showrooms and big builders.', angle: 'People compare two or three remodelers from the map before they call. 68% only use one rated 4 stars or higher.' },
  { id: 'windows', name: 'Windows and doors (impact)', day: 'weekday', match: /window install|impact window|hurricane (window|shutter)|windows? (and|&) doors?|sliding (glass )?door/i, kw: ['impact windows', 'window installation', 'hurricane shutters', 'sliding glass door repair'], industries: ['window installation'],
    window: '8 to 9:30am, 4 to 6pm', extra: 'Florida and Gulf coast first. Skip national installers.', angle: 'Impact windows are a big check that people compare on the map before storm season. Where do you show up?' },
  { id: 'septic', name: 'Septic service', day: 'weekday', match: /septic/i, kw: ['septic service', 'septic tank pumping', 'septic repair', 'septic installation'], industries: ['septic service'],
    window: '8 to 9am, 4 to 5:30pm', extra: 'Owner run with a few trucks. Work is often outside the biggest cities, so use the time zone buttons for smaller markets.', angle: 'A failed tank is an emergency search. The first few on the map get the call.' },
];
export const nicheById = (id) => NICHES.find((n) => n.id === id) || null;

// Busy with customers on Saturday (salons, barbers, car washes) or closed (offices): call them Monday instead.
export const SAT_SKIP = /barber|salon|hair|nail|car wash|\bspa\b|lawyer|attorney|\blaw\b|cpa|account|bookkeep|dentist|dental|doctor|clinic|medical|insurance|financ|chiropr|physical therap|restaurant/i;
const textOf = (l) => `${l.industry || ''} ${l.category || ''} ${l.business || ''}`;

// The first template a lead fits (weekday set first), or null.
export function nicheOf(l) {
  const t = textOf(l);
  for (const n of NICHES) if (n.match.test(t)) return n;
  return null;
}
// A good Saturday call: Saturday hours are listed; or no hours are known and it is a Saturday niche (service area trades often list none).
// Never when the hours say closed Saturday, never a "skip on Saturday" business.
export function saturdayOk(l) {
  if (SAT_SKIP.test(textOf(l))) return false;
  if (l.hours_known) return Boolean(l.open_sat);
  const n = nicheOf(l);
  return Boolean(n && (n.day === 'saturday' || n.day === 'both'));
}
// Filters for the Pipeline when a template is picked.
export function nicheFilters(n) {
  return { ...SHARED, niche: n.id };
}
export const weekdayNiches = () => NICHES.filter((n) => n.day !== 'saturday');
export const saturdayNiches = () => NICHES.filter((n) => n.day !== 'weekday');
