// Time zone for a lead from whatever we know about where it is (pure, shared by the Worker, the app and the tests).
// Order of trust: the state, then the address text, then the ZIP, then map coordinates. Split states (a state with two zones)
// use the ZIP's first three digits, then the city, and when neither settles it the lead gets a second possible zone (`alt`).
// A lead with `alt` is only callable when BOTH zones are inside calling hours. A lead with no zone at all is only callable
// in the window that is safe for the whole lower 48 (11am to 8pm Eastern). Results near a zone line are approximate on purpose.

import { dtf } from './fmtcache.js';

export const ZONES = { ET: 'America/New_York', CT: 'America/Chicago', MT: 'America/Denver', AZ: 'America/Phoenix', PT: 'America/Los_Angeles', AK: 'America/Anchorage', HI: 'Pacific/Honolulu' };
export const ZONE_SHORT = Object.fromEntries(Object.entries(ZONES).map(([k, v]) => [v, k]));

export const STATE_LIST = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'],
  ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'],
  ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];
const CODES = new Set(STATE_LIST.map((s) => s[0]));
export const NAME_TO_CODE = Object.fromEntries(STATE_LIST.map(([c, n]) => [n.toLowerCase(), c]));

// The main zone of each state. Split states are listed here under the zone most of the state is in, and refined by SPLIT below.
const MAIN = {
  ET: 'CT DE DC FL GA IN KY ME MD MA MI NH NJ NY NC OH PA RI SC VT VA WV'.split(' '),
  CT: 'AL AR IL IA KS LA MN MS MO NE ND OK SD TN TX WI'.split(' '),
  MT: 'CO MT NM UT WY ID'.split(' '),
  AZ: ['AZ'], PT: 'CA NV OR WA'.split(' '), AK: ['AK'], HI: ['HI'],
};
const MAIN_OF = {};
for (const [z, list] of Object.entries(MAIN)) for (const s of list) MAIN_OF[s] = z;

const words = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\bsaint\b/g, 'st').replace(/\s+/g, ' ').trim();

// States with more than one zone. other = the smaller part. otherZips / mixedZips are ZIP3 prefixes that sit wholly in the other zone,
// or on the line (either zone). otherCities and mainCities settle a lead that has no ZIP.
const SPLIT = {
  FL: { main: 'ET', other: 'CT', otherZips: ['324', '325'], mixedZips: [],
    otherCities: ['pensacola', 'panama city', 'panama city beach', 'fort walton beach', 'destin', 'crestview', 'niceville', 'milton', 'gulf breeze', 'navarre', 'pace', 'cantonment', 'mary esther', 'lynn haven', 'marianna', 'defuniak springs', 'bonifay', 'chipley', 'santa rosa beach', 'freeport', 'shalimar', 'valparaiso', 'callaway', 'parker', 'springfield', 'southport', 'inlet beach', 'rosemary beach', 'seaside', 'miramar beach'],
    mainCities: ['miami', 'orlando', 'tampa', 'jacksonville', 'fort lauderdale', 'st petersburg', 'hialeah', 'tallahassee', 'cape coral', 'fort myers', 'port st lucie', 'pembroke pines', 'hollywood', 'gainesville', 'miramar', 'coral springs', 'clearwater', 'palm bay', 'lakeland', 'west palm beach', 'pompano beach', 'davie', 'miami beach', 'boca raton', 'sarasota', 'naples', 'ocala', 'daytona beach', 'kissimmee', 'homestead', 'doral', 'plantation', 'sunrise', 'deerfield beach', 'boynton beach', 'delray beach', 'melbourne', 'palm coast', 'deltona', 'largo', 'brandon', 'spring hill' ] },
  TN: { main: 'CT', other: 'ET', otherZips: ['373', '374', '376', '377', '378', '379'], mixedZips: [],
    otherCities: ['knoxville', 'chattanooga', 'johnson city', 'kingsport', 'bristol', 'oak ridge', 'maryville', 'morristown', 'cleveland', 'sevierville', 'pigeon forge', 'gatlinburg', 'athens', 'greeneville', 'lenoir city', 'alcoa', 'farragut', 'hixson', 'ooltewah', 'collegedale', 'dayton', 'harriman', 'rockwood', 'jefferson city', 'elizabethton', 'jonesborough', 'newport', 'etowah', 'lafollette', 'clinton', 'oliver springs', 'powell', 'seymour'],
    mainCities: ['nashville', 'memphis', 'murfreesboro', 'franklin', 'clarksville', 'jackson', 'hendersonville', 'smyrna', 'brentwood', 'lebanon', 'columbia', 'bartlett', 'germantown', 'collierville', 'cookeville', 'gallatin', 'mount juliet', 'spring hill', 'dickson', 'tullahoma', 'manchester'] },
  KY: { main: 'ET', other: 'CT', otherZips: ['420', '421', '422', '423', '424'], mixedZips: ['427'],
    otherCities: ['bowling green', 'owensboro', 'paducah', 'hopkinsville', 'henderson', 'madisonville', 'glasgow', 'murray', 'mayfield', 'central city', 'russellville', 'franklin', 'morganfield', 'princeton', 'benton', 'fulton', 'cadiz', 'elkton', 'leitchfield', 'beaver dam', 'hartford', 'calhoun', 'sturgis', 'providence'],
    mainCities: ['louisville', 'lexington', 'covington', 'florence', 'richmond', 'georgetown', 'frankfort', 'nicholasville', 'jeffersontown', 'ashland', 'erlanger', 'independence', 'shively', 'danville', 'shelbyville', 'radcliff', 'elizabethtown', 'somerset', 'london', 'hazard', 'pikeville', 'winchester', 'paris', 'mount sterling', 'maysville', 'bardstown'] },
  IN: { main: 'ET', other: 'CT', otherZips: ['463', '464', '476', '477'], mixedZips: [],
    otherCities: ['gary', 'hammond', 'valparaiso', 'michigan city', 'portage', 'merrillville', 'crown point', 'munster', 'highland', 'east chicago', 'hobart', 'la porte', 'laporte', 'chesterton', 'schererville', 'dyer', 'griffith', 'lowell', 'whiting', 'lake station', 'evansville', 'newburgh', 'mount vernon', 'boonville', 'princeton', 'jasper county', 'rensselaer', 'knox', 'winamac', 'kentland', 'fowler', 'washington'],
    mainCities: ['indianapolis', 'fort wayne', 'carmel', 'fishers', 'bloomington', 'lafayette', 'south bend', 'muncie', 'noblesville', 'greenwood', 'anderson', 'terre haute', 'kokomo', 'elkhart', 'mishawaka', 'columbus', 'westfield', 'richmond', 'jeffersonville', 'new albany', 'plainfield', 'avon', 'brownsburg', 'goshen', 'lawrence', 'franklin', 'greenfield', 'zionsville'] },
  MI: { main: 'ET', other: 'CT', otherZips: [], mixedZips: ['498', '499'],
    otherCities: ['iron mountain', 'menominee', 'ironwood', 'iron river', 'kingsford', 'norway', 'iron river', 'bessemer', 'wakefield', 'stephenson', 'crystal falls', 'caspian'],
    mainCities: [] },
  TX: { main: 'CT', other: 'MT', otherZips: ['798', '799', '885'], mixedZips: [],
    otherCities: ['el paso', 'horizon city', 'socorro', 'san elizario', 'canutillo', 'anthony', 'fabens', 'sierra blanca', 'clint', 'tornillo'],
    mainCities: [] },
  KS: { main: 'CT', other: 'MT', otherZips: [], mixedZips: ['677'],
    otherCities: ['goodland', 'tribune', 'sharon springs', 'syracuse', 'leoti'], mainCities: [] },
  NE: { main: 'CT', other: 'MT', otherZips: ['693'], mixedZips: ['690', '691', '692'],
    otherCities: ['scottsbluff', 'gering', 'alliance', 'sidney', 'chadron', 'kimball', 'mccook', 'ogallala', 'bridgeport', 'gordon', 'harrisburg', 'hemingford', 'scottsbluff', 'mitchell', 'terrytown', 'valentine'],
    mainCities: ['omaha', 'lincoln', 'bellevue', 'grand island', 'kearney', 'fremont', 'hastings', 'norfolk', 'north platte', 'columbus', 'papillion', 'la vista', 'south sioux city', 'beatrice', 'lexington', 'york', 'blair', 'seward', 'nebraska city'] },
  SD: { main: 'CT', other: 'MT', otherZips: ['577'], mixedZips: ['575', '576'],
    otherCities: ['rapid city', 'spearfish', 'sturgis', 'box elder', 'belle fourche', 'custer', 'hot springs', 'lead', 'deadwood', 'box elder', 'newell', 'philip', 'wall', 'faith'],
    mainCities: ['sioux falls', 'aberdeen', 'brookings', 'watertown', 'mitchell', 'yankton', 'huron', 'vermillion', 'madison', 'brandon', 'harrisburg', 'tea', 'dell rapids', 'pierre'] },
  ND: { main: 'CT', other: 'MT', otherZips: ['586'], mixedZips: ['588'],
    otherCities: ['dickinson', 'bowman', 'hettinger', 'beach', 'medora', 'killdeer', 'new england', 'mott'],
    mainCities: ['fargo', 'bismarck', 'grand forks', 'minot', 'west fargo', 'mandan', 'williston'] },
  ID: { main: 'MT', other: 'PT', otherZips: ['835', '838'], mixedZips: [],
    otherCities: ['coeur d alene', 'lewiston', 'moscow', 'sandpoint', 'post falls', 'hayden', 'rathdrum', 'lewiston', 'orofino', 'grangeville', 'st maries', 'kellogg', 'wallace', 'bonners ferry', 'priest river', 'dalton gardens', 'spirit lake', 'osburn', 'pinehurst', 'smelterville'],
    mainCities: ['boise', 'meridian', 'nampa', 'idaho falls', 'pocatello', 'caldwell', 'twin falls', 'lewiston orchards', 'rexburg', 'eagle', 'kuna', 'ammon', 'chubbuck', 'hailey', 'ketchum', 'sun valley', 'burley', 'rupert', 'jerome', 'blackfoot', 'mountain home', 'star', 'emmett', 'middleton', 'garden city'] },
  OR: { main: 'PT', other: 'MT', otherZips: ['979'], mixedZips: [],
    otherCities: ['ontario', 'vale', 'nyssa', 'jordan valley', 'adrian', 'arock'], mainCities: [] },
};

// ZIP3 to state (first three digits). Ranges follow the USPS ZIP map. Only used when the state is missing or to cross check it.
const ZIP_RANGES = [
  [5, 5, 'NY'], [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'], [39, 49, 'ME'], [50, 59, 'VT'], [55, 55, 'MA'], [60, 69, 'CT'], [70, 89, 'NJ'],
  [100, 149, 'NY'], [150, 196, 'PA'], [197, 199, 'DE'], [200, 205, 'DC'], [206, 219, 'MD'], [220, 246, 'VA'], [247, 268, 'WV'], [270, 289, 'NC'],
  [290, 299, 'SC'], [300, 319, 'GA'], [320, 339, 'FL'], [341, 342, 'FL'], [344, 344, 'FL'], [346, 347, 'FL'], [349, 349, 'FL'], [350, 369, 'AL'],
  [370, 385, 'TN'], [386, 397, 'MS'], [398, 399, 'GA'], [400, 427, 'KY'], [430, 458, 'OH'], [460, 479, 'IN'], [480, 499, 'MI'], [500, 528, 'IA'],
  [530, 549, 'WI'], [550, 567, 'MN'], [570, 577, 'SD'], [580, 588, 'ND'], [590, 599, 'MT'], [600, 629, 'IL'], [630, 658, 'MO'], [660, 679, 'KS'],
  [680, 693, 'NE'], [700, 714, 'LA'], [716, 729, 'AR'], [730, 749, 'OK'], [750, 799, 'TX'], [800, 816, 'CO'], [820, 831, 'WY'], [832, 838, 'ID'],
  [840, 847, 'UT'], [850, 865, 'AZ'], [870, 884, 'NM'], [885, 885, 'TX'], [889, 898, 'NV'], [900, 961, 'CA'], [967, 968, 'HI'], [970, 979, 'OR'],
  [980, 994, 'WA'], [995, 999, 'AK'],
];
// Overlaps in the table above are settled by the later, narrower row (Massachusetts 055 and New York 005 are the odd ones).
export function stateFromZip(zip) {
  const m = String(zip || '').match(/^\s*(\d{5})(?:-\d{4})?\s*$/);
  if (!m) return '';
  const z3 = Number(m[1].slice(0, 3));
  let hit = '';
  for (const [a, b, s] of ZIP_RANGES) if (z3 >= a && z3 <= b) hit = s;
  // 200 and 202 to 205 are DC, but 201 is Virginia (Dulles).
  if (z3 === 201) return 'VA';
  return hit;
}

// "Tampa" and "tampa, fl 33602" both work. Looks for ", ST 12345", ", ST", and a full state name at the end.
export function stateFromAddress(addr) {
  const a = String(addr || '').trim();
  if (!a) return '';
  let m = a.match(/,\s*([A-Za-z]{2})\.?\s+\d{5}(?:-\d{4})?\b/);
  if (m && CODES.has(m[1].toUpperCase())) return m[1].toUpperCase();
  m = a.match(/,\s*([A-Za-z][A-Za-z .]+?)\s+\d{5}(?:-\d{4})?\b/);
  if (m && NAME_TO_CODE[m[1].toLowerCase().replace(/\./g, '').trim()]) return NAME_TO_CODE[m[1].toLowerCase().replace(/\./g, '').trim()];
  m = a.match(/,\s*([A-Za-z]{2})\.?\s*(?:,\s*(?:usa|us|united states))?\s*$/i);
  if (m && CODES.has(m[1].toUpperCase())) return m[1].toUpperCase();
  m = a.match(/,\s*([A-Za-z][A-Za-z .]+?)\s*(?:,\s*(?:usa|us|united states))?\s*$/i);
  if (m && NAME_TO_CODE[m[1].toLowerCase().replace(/\./g, '').trim()]) return NAME_TO_CODE[m[1].toLowerCase().replace(/\./g, '').trim()];
  return '';
}
export function zipFromAddress(addr) {
  const m = String(addr || '').match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/);
  return m ? m[1] : '';
}

export function stateFromName(input) {
  const v = String(input || '').trim();
  if (!v) return '';
  const up = v.toUpperCase().replace(/\./g, '');
  if (CODES.has(up)) return up;
  return NAME_TO_CODE[v.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ')] || '';
}

// Map coordinates for a lead with no state, ZIP or address. Lower 48 by longitude bands; a band that crosses a zone line gets two zones.
export function zoneFromLatLng(lat, lng) {
  const la = Number(lat), ln = Number(lng);
  if (lat == null || lng == null || lat === '' || lng === '' || !Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la >= 18 && la <= 23 && ln <= -154 && ln >= -161) return { tz: ZONES.HI, alt: null };
  if (la >= 51 && ln <= -130 && ln >= -180) return { tz: ZONES.AK, alt: null };
  if (la < 24 || la > 50 || ln > -66 || ln < -125) return null;
  if (ln >= -84) return { tz: ZONES.ET, alt: null };
  if (ln >= -89) return { tz: ZONES.ET, alt: ZONES.CT };
  if (ln >= -97) return { tz: ZONES.CT, alt: null };
  if (ln >= -104.5) return { tz: ZONES.CT, alt: ZONES.MT };
  if (ln >= -111) return { tz: ZONES.MT, alt: la < 37 ? ZONES.AZ : null };
  if (ln >= -117.6) return { tz: ZONES.MT, alt: ZONES.PT };
  return { tz: ZONES.PT, alt: null };
}

// The zone(s) for a state, refined by ZIP and city when the state has two. Returns { tz, alt, how } or null.
function zoneForState(code, zip, city) {
  const sp = SPLIT[code];
  if (!sp) return MAIN_OF[code] ? { tz: ZONES[MAIN_OF[code]], alt: null } : null;
  const main = ZONES[sp.main], other = ZONES[sp.other];
  const z3 = /^\d{5}/.test(String(zip || '')) ? String(zip).slice(0, 3) : '';
  if (z3) {
    if (sp.otherZips.includes(z3)) return { tz: other, alt: null, fine: true };
    if (sp.mixedZips.includes(z3)) return { tz: main, alt: other, fine: true };
    return { tz: main, alt: null, fine: true };
  }
  const c = words(city);
  if (c && sp.otherCities.includes(c)) return { tz: other, alt: null, fine: true };
  if (c && sp.mainCities.includes(c)) return { tz: main, alt: null, fine: true };
  return { tz: main, alt: other };
}

// resolveZone({ state, zip, address, city, lat, lng }) -> { tz, alt, state, how }.
// how: 'state', 'zip', 'address', 'map' (how the place was found), or '' when nothing was enough (tz is null).
export function resolveZone(l = {}) {
  let code = stateFromName(l.state), how = code ? 'state' : '';
  const zipRaw = String(l.zip || '').trim() || zipFromAddress(l.address);
  const zipOk = /^\d{5}/.test(zipRaw) ? zipRaw.slice(0, 5) : '';
  const zipState = zipOk ? stateFromZip(zipOk) : '';
  if (!code) {
    const a = stateFromAddress(l.address);
    if (a) { code = a; how = 'address'; }
    else if (zipState) { code = zipState; how = 'zip'; }
  }
  if (code) {
    const z = zoneForState(code, zipOk && (!zipState || zipState === code) ? zipOk : '', l.city);
    if (z) {
      let alt = z.alt || null;
      // A ZIP in a different state than the one typed: trust the state, but keep the ZIP's zone as a second possibility.
      if (zipState && zipState !== code) {
        const o = zoneForState(zipState, zipOk, l.city);
        if (o && o.tz !== z.tz && !alt) alt = o.tz;
      }
      return { tz: z.tz, alt: alt && alt !== z.tz ? alt : null, state: code, how };
    }
  }
  const m = zoneFromLatLng(l.lat, l.lng);
  if (m) return { tz: m.tz, alt: m.alt, state: code || '', how: 'map' };
  return { tz: null, alt: null, state: code || '', how: '' };
}

const hourIn = (tz, at) => {
  try { return Number(dtf('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(at)); } catch { return null; }
};
const inside = (h) => h != null && h >= 8 && h < 20;

// 8am to 8pm in the lead's zone (TCPA hours). With a second possible zone, both must be inside. With no zone, the window that is
// safe from Miami to Seattle: 11am to 8pm Eastern (8am Pacific is 11am Eastern).
export function canCallNow(tz, alt, at = Date.now()) {
  if (!tz) return inside(hourIn(ZONES.PT, at)) && inside(hourIn(ZONES.ET, at));
  if (!inside(hourIn(tz, at))) return false;
  return !alt || inside(hourIn(alt, at));
}
