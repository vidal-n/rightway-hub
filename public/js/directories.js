// The directory list for the citation check (Nov 2026, V: more than 15, checked for wrong or missing info and against a competitor).
// Modeled on BrightLocal's Citation Tracker (a table of key directories with listed, name, phone and ZIP per site, and a competitor tab of
// the directories the businesses ahead use that you do not) and on Whitespark's top citation sources. Sources and URL notes: the research report
// "BrightLocal report interface spec". Pure, shared by the Worker, the report and tests.
//
// Each entry: id, name, domain (the Google `site:` search; `path` narrows it), cat, tier (1 must have, 2 important, 3 extras), trades (who it applies to;
// empty means every business), check ('site' = one Google search finds the listing; 'hand' = no public page per business, a person checks it).
// Honest limits: a `site:` search reads Google's preview of the listing. A listing Google has not indexed reads "not found" even if it exists, so the
// report says "not found by Google" and the fix list tells the rep to confirm by hand before claiming it is missing.

const D = (id, name, domain, cat, tier, trades = [], extra = {}) => ({ id, name, domain, cat, tier, trades, check: 'site', ...extra });
const H = (id, name, domain, cat, tier, why, trades = []) => ({ id, name, domain, cat, tier, trades, check: 'hand', why });

export const CATS = { core: 'Core platform', social: 'Social', review: 'Reviews', agg: 'Data aggregator', map: 'Maps and navigation', dir: 'Directory', trade: 'Industry', local: 'Local and chamber' };
export const TIERS = { 1: 'Must have', 2: 'Important', 3: 'Extra reach' };

export const DIRECTORIES = [
  // Tier 1
  D('facebook', 'Facebook', 'facebook.com', 'social', 1),
  D('yelp', 'Yelp', 'yelp.com/biz', 'review', 1),
  D('bbb', 'Better Business Bureau', 'bbb.org', 'review', 1),
  D('nextdoor', 'Nextdoor', 'nextdoor.com/pages', 'social', 1),
  D('foursquare', 'Foursquare', 'foursquare.com/v', 'agg', 1),
  D('yellowpages', 'Yellow Pages', 'yellowpages.com', 'dir', 1),
  D('manta', 'Manta', 'manta.com/c', 'dir', 1),
  D('mapquest', 'MapQuest', 'mapquest.com', 'map', 1),
  D('angi', 'Angi', 'angi.com/companylist', 'trade', 1, ['home']),
  D('thumbtack', 'Thumbtack', 'thumbtack.com', 'trade', 1, ['home', 'beauty', 'event']),
  D('healthgrades', 'Healthgrades', 'healthgrades.com', 'trade', 1, ['health']),
  // Tier 2
  D('superpages', 'Superpages', 'superpages.com', 'dir', 2),
  D('linkedin', 'LinkedIn company page', 'linkedin.com/company', 'social', 2),
  D('trustpilot', 'Trustpilot', 'trustpilot.com/review', 'review', 2),
  D('merchantcircle', 'Merchant Circle', 'merchantcircle.com', 'dir', 2),
  D('chamberofcommerce', 'Chamber of Commerce directory', 'chamberofcommerce.com', 'local', 2),
  D('dnb', 'Dun and Bradstreet', 'dnb.com/business-directory', 'agg', 2),
  D('whitepages', 'Whitepages', 'whitepages.com/business', 'dir', 2),
  D('alignable', 'Alignable', 'alignable.com', 'local', 2),
  D('houzz', 'Houzz', 'houzz.com/professionals', 'trade', 2, ['home']),
  D('porch', 'Porch', 'porch.com', 'trade', 2, ['home']),
  D('homeadvisor', 'HomeAdvisor', 'homeadvisor.com/rated', 'trade', 2, ['home']),
  D('buildzoom', 'BuildZoom', 'buildzoom.com/contractor', 'trade', 2, ['home']),
  D('vitals', 'Vitals', 'vitals.com', 'trade', 2, ['health']),
  D('ratemds', 'RateMDs', 'ratemds.com', 'trade', 2, ['health']),
  D('zocdoc', 'Zocdoc', 'zocdoc.com', 'trade', 2, ['health']),
  D('webmd', 'WebMD Care', 'doctor.webmd.com', 'trade', 2, ['health']),
  D('avvo', 'Avvo', 'avvo.com', 'trade', 2, ['legal']),
  D('justia', 'Justia', 'lawyers.justia.com', 'trade', 2, ['legal']),
  D('findlaw', 'FindLaw', 'lawyers.findlaw.com', 'trade', 2, ['legal']),
  D('repairpal', 'RepairPal', 'repairpal.com', 'trade', 2, ['auto']),
  D('carfax', 'CARFAX', 'carfax.com', 'trade', 3, ['auto']),
  D('realtor', 'Realtor.com', 'realtor.com', 'trade', 2, ['realestate']),
  D('zillowagent', 'Zillow profile', 'zillow.com/profile', 'trade', 2, ['realestate']),
  D('vagaro', 'Vagaro', 'vagaro.com', 'trade', 2, ['beauty']),
  D('styleseat', 'StyleSeat', 'styleseat.com', 'trade', 2, ['beauty']),
  D('tripadvisor', 'Tripadvisor', 'tripadvisor.com', 'review', 2, ['food']),
  // Tier 3
  D('instagram', 'Instagram', 'instagram.com', 'social', 3),
  D('brownbook', 'Brownbook', 'brownbook.net', 'dir', 3),
  D('hotfrog', 'Hotfrog', 'hotfrog.com', 'dir', 3),
  D('cylex', 'Cylex', 'cylex-usa.com', 'dir', 3),
  D('ezlocal', 'EZlocal', 'ezlocal.com', 'dir', 3),
  D('citysquares', 'CitySquares', 'citysquares.com', 'dir', 3),
  D('n49', 'n49', 'n49.com', 'dir', 3),
  D('opendi', 'Opendi', 'opendi.us', 'dir', 3),
  D('fyple', 'Fyple', 'fyple.com', 'dir', 3),
  D('2findlocal', '2FindLocal', '2findlocal.com', 'dir', 3),
  D('showmelocal', 'ShowMeLocal', 'showmelocal.com', 'dir', 3),
  D('yasabe', 'YaSabe', 'yasabe.com', 'dir', 3),
  D('kompass', 'Kompass', 'us.kompass.com', 'dir', 3),
  D('patch', 'Patch', 'patch.com', 'local', 3),
  D('bark', 'Bark', 'bark.com', 'trade', 3, ['home', 'beauty', 'event', 'legal']),
  D('elocal', 'eLocal', 'elocal.com', 'trade', 3, ['home']),
  D('homeguide', 'HomeGuide', 'homeguide.com', 'trade', 3, ['home']),
  D('networx', 'Networx', 'networx.com', 'trade', 3, ['home']),
  D('bestplumbers', 'Best Plumbers', 'bestplumbers.com', 'trade', 3, ['plumbing']),
  D('wellness', 'Wellness.com', 'wellness.com', 'trade', 3, ['health']),
  // No public page per business, so a person checks these by hand. They feed the sites above, so a wrong one here spreads.
  H('gbp', 'Google Business Profile', 'google.com', 'core', 1, 'The biggest local ranking source. Checked in the scan and the profile section.'),
  H('apple', 'Apple Business Connect', 'businessconnect.apple.com', 'map', 1, 'Apple Maps and Siri. Search the business in the Maps app.'),
  H('bing', 'Bing Places', 'bingplaces.com', 'core', 1, 'Bing, Copilot and many car and phone apps. Search the business in Bing Maps.'),
  H('dataaxle', 'Data Axle', 'data-axle.com', 'agg', 1, 'Feeds yellow pages, navigation and library directories. A wrong listing here spreads to many sites.'),
  H('transunion', 'TransUnion Digital Business Profile', 'transunion.com', 'agg', 1, 'Feeds more than 80 platforms, including Bing and Apple.'),
  H('waze', 'Waze', 'waze.com', 'map', 2, 'Navigation. Search the business name in the Waze app.'),
  H('tomtom', 'TomTom', 'tomtom.com', 'map', 2, 'Car navigation data.'),
  H('here', 'HERE', 'here.com', 'map', 2, 'Car navigation data.'),
  H('osm', 'OpenStreetMap', 'openstreetmap.org', 'map', 3, 'Open map data used by many apps.'),
];

// Which kind of business this is, from its category or industry text. Used to pick the industry directories.
export function tradeOf(text = '') {
  const t = String(text).toLowerCase();
  const out = [];
  if (/plumb|hvac|air condition|heating|roof|electric|landscap|lawn|pest|clean|paint|floor|remodel|contractor|handyman|garage door|fence|pool|tree|window|concrete|paver|junk|moving|carpet|restoration|water damage|mold|solar|insulation|locksmith|appliance|home service|siding|gutter|drywall|masonry|pressure wash/.test(t)) out.push('home');
  if (/plumb/.test(t)) out.push('plumbing');
  if (/dent|doctor|physician|clinic|chiropract|therap|medical|health|orthodont|optom|dermat|veterin|vet\b|pediatric|urgent care|med spa|surgeon|psych|counsel/.test(t)) out.push('health');
  if (/law|attorney|legal|lawyer/.test(t)) out.push('legal');
  if (/auto|car |tire|mechanic|body shop|collision|oil change|towing|detail/.test(t)) out.push('auto');
  if (/real estate|realtor|property|broker/.test(t)) out.push('realestate');
  if (/salon|barber|spa\b|nail|beauty|hair|tattoo|massage|lash|wax/.test(t)) out.push('beauty');
  if (/restaurant|cafe|coffee|bar\b|grill|pizza|bakery|food|catering/.test(t)) out.push('food');
  if (/photograph|wedding|dj\b|event|party|rental/.test(t)) out.push('event');
  return out;
}

// The directories to check for this business, best first. `kind` limits to 'site' (searchable) or 'hand'.
export function directoriesFor(text = '', { kind = null, maxTier = 3 } = {}) {
  const trades = tradeOf(text);
  return DIRECTORIES
    .filter((d) => d.tier <= maxTier && (!kind || d.check === kind) && (!d.trades.length || d.trades.some((t) => trades.includes(t))))
    .sort((a, b) => a.tier - b.tier);
}

export const DIRECTORY_PRICE = 0.002; // one Google search each (DataForSEO organic live advanced)
export const byName = (name) => DIRECTORIES.find((d) => d.name === name || d.id === name) || null;

// A siteable directory as the `SITES`-style query: site:domain "Business" City
export const queryFor = (d, name, city) => `site:${d.domain} "${name}"${city ? ` ${city}` : ''}`;

// ---------- the score ----------
// BrightLocal's Key Citation Score looks at listed, name, ZIP and phone on the sites that matter most, higher authority counting more
// (its weights are not published). Ours is the same idea with plain, published weights: tier 1 counts 3, tier 2 counts 2, tier 3 counts 1.
// Per site (the split of the points is ours, the four factors are BrightLocal's): not found 0; listed 0.4, name matched 0.2, ZIP 0.2 and phone 0.2
// (a detail scores 1 when it matches, 0.5 when Google's preview does not show it, 0 when it is wrong).
// Only searchable directories are scored. It is an estimate of what Google can see, not a promise.
export function listingScore(r) {
  if (!r || r.status === 'missing' || r.status === 'error') return 0;
  const f = (ok, bad) => (bad ? 0 : ok ? 1 : 0.5); // a detail that Google's preview does not show counts half
  return 0.4 + 0.2 + 0.2 * f(r.zipOk, r.zipBad) + 0.2 * f(r.phoneOk, r.phoneBad);
}
export function citationScore(results = []) {
  let got = 0, max = 0;
  for (const r of results) {
    if (!r || r.status === 'error' || r.check === 'hand') continue;
    const w = 4 - (Number(r.tier) || 3);
    got += listingScore(r) * w; max += w;
  }
  return max ? Math.round((got / max) * 100) : null;
}
export function scoreBand(n) { return n == null ? ['gray', 'Not checked'] : n >= 80 ? ['good', 'Good'] : n >= 55 ? ['warn', 'Needs work'] : ['bad', 'Poor']; }
// Rows for the competitor view: sites where the business ahead is listed and this one is not (BrightLocal's Competitor tab idea).
export function gapsVsRival(mine = [], rival = []) {
  const r = new Map((rival || []).map((x) => [x.name, x]));
  return (mine || []).filter((m) => m.status === 'missing' && ['found', 'match', 'mismatch'].includes(r.get(m.name)?.status)).map((m) => m.name);
}
