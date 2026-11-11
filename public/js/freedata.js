// Free lead data (pure, shared by the Worker and Node tests): OpenStreetMap discovery through the free Overpass API, the Florida Sunbiz
// business registry (owner and officer names, date filed, status), and a wider read of a business's own website (services, areas served,
// years in business, license number, hours, team names, about text). None of this costs a cent. It is thinner than Google Maps data:
// OpenStreetMap has no reviews or ratings, and many small contractors are missing or have no phone there.

// ---------- OpenStreetMap ----------
// What a keyword means in OpenStreetMap tags. Anything not listed is found by name only.
const TAGS = [
  [/roof/, ['craft=roofer']], [/plumb/, ['craft=plumber']], [/hvac|\bac\b|air ?condition|heating|cooling|a\/c/, ['craft=hvac']], [/electric/, ['craft=electrician']],
  [/paint/, ['craft=painter']], [/landscap|lawn|garden|tree/, ['craft=gardener', 'craft=tree_surgeon', 'shop=garden_centre']],
  [/contractor|construction|remodel|builder|general contractor/, ['craft=builder', 'craft=carpenter', 'craft=plasterer', 'craft=tiler', 'craft=handyman']],
  [/handyman/, ['craft=handyman']], [/carpent/, ['craft=carpenter']], [/floor/, ['craft=floorer', 'shop=flooring']], [/window|glass/, ['craft=glaziery']],
  [/pool/, ['craft=pool_contractor', 'shop=swimming_pool']], [/clean|maid|janitor/, ['craft=cleaning', 'shop=dry_cleaning']], [/locksmith/, ['craft=locksmith', 'shop=locksmith']],
  [/restaurant|food|dining/, ['amenity=restaurant']], [/cafe|coffee/, ['amenity=cafe']], [/bar\b|pub/, ['amenity=bar', 'amenity=pub']],
  [/dentist|dental/, ['amenity=dentist', 'healthcare=dentist']], [/doctor|physician|clinic|medical/, ['amenity=doctors', 'amenity=clinic', 'healthcare=doctor']],
  [/chiropract/, ['healthcare=chiropractor', 'healthcare=alternative']], [/veterin|vet\b|animal hospital/, ['amenity=veterinary']],
  [/lawyer|attorney|law firm/, ['office=lawyer']], [/account|tax|bookkeep/, ['office=accountant', 'office=tax_advisor']], [/real estate|realtor/, ['office=estate_agent']],
  [/insurance/, ['office=insurance']], [/salon|hair/, ['shop=hairdresser']], [/barber/, ['shop=hairdresser']], [/nail|spa|beauty/, ['shop=beauty']],
  [/auto repair|mechanic|car repair/, ['shop=car_repair']], [/auto body|collision/, ['shop=car_repair']], [/tire/, ['shop=tyres']], [/car wash/, ['amenity=car_wash']],
  [/gym|fitness/, ['leisure=fitness_centre']], [/pet|groom/, ['shop=pet', 'shop=pet_grooming']], [/photograph/, ['craft=photographer', 'shop=photo']],
  [/moving|mover/, ['office=moving_company']], [/storage/, ['shop=storage_rental']], [/hotel|motel/, ['tourism=hotel', 'tourism=motel']],
];
const STOP = new Set(['near', 'me', 'in', 'the', 'and', 'for', 'best', 'company', 'companies', 'service', 'services', 'contractor', 'contractors', 'shop', 'shops', 'local', 'repair', 'installation', 'install']);

export function osmFilters(keyword) {
  const k = String(keyword || '').toLowerCase();
  const tags = [];
  for (const [re, list] of TAGS) if (re.test(k)) for (const t of list) if (!tags.includes(t)) tags.push(t);
  return tags;
}
// A word stem to look for in business names: "roofing contractor" -> "roof", "plumbers" -> "plumb".
export function nameStem(keyword) {
  const words = String(keyword || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
  const w = words[0];
  if (!w) return '';
  return w.replace(/(ing|ers|er|ors|or|ists|ist|ies|es|s)$/, '').slice(0, 12) || w;
}

// One Overpass query: everything within `miles` of a point that matches the keyword's tags or has the keyword in its name.
export function overpassQuery({ keyword, lat, lng, miles = 5 }, limit = 400) {
  const m = Math.round(Math.min(30, Math.max(0.3, Number(miles) || 5)) * 1609);
  const at = `(around:${m},${Number(lat).toFixed(5)},${Number(lng).toFixed(5)})`;
  const parts = osmFilters(keyword).map((t) => { const [k, v] = t.split('='); return `nwr${at}[${k}=${v}][name];`; });
  const stem = nameStem(keyword);
  if (stem) parts.push(`nwr${at}["name"~"${stem.replace(/[^a-z0-9]/g, '')}",i];`);
  if (!parts.length) return '';
  return `[out:json][timeout:25];(${parts.join('')});out center tags ${limit};`;
}

const tagOf = (t, ...keys) => { for (const k of keys) if (t[k] && String(t[k]).trim()) return String(t[k]).trim(); return ''; };
const pretty = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
// An OpenStreetMap element -> the same record shape the Google Maps source makes, with the extras OSM carries.
export function osmRecord(el) {
  const t = el?.tags || {};
  const title = tagOf(t, 'name');
  if (!title) return null;
  const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
  const cat = ['craft', 'shop', 'office', 'amenity', 'healthcare', 'leisure', 'tourism'].map((k) => (t[k] ? pretty(t[k]) : '')).find(Boolean) || '';
  const site = tagOf(t, 'website', 'contact:website', 'url');
  const street = [tagOf(t, 'addr:housenumber'), tagOf(t, 'addr:street')].filter(Boolean).join(' ');
  const city = tagOf(t, 'addr:city'), state = tagOf(t, 'addr:state'), zip = tagOf(t, 'addr:postcode');
  const hours = tagOf(t, 'opening_hours');
  const social = {};
  const fb = tagOf(t, 'contact:facebook', 'facebook'), ig = tagOf(t, 'contact:instagram', 'instagram');
  if (fb) social.facebook = /^https?:/.test(fb) ? fb : `https://www.facebook.com/${fb.replace(/^@/, '')}`;
  if (ig) social.instagram = /^https?:/.test(ig) ? ig : `https://www.instagram.com/${ig.replace(/^@/, '')}`;
  let domain = '';
  try { domain = site ? new URL(/^https?:/.test(site) ? site : `https://${site}`).hostname.replace(/^www\./, '') : ''; } catch { domain = ''; }
  return {
    title, cid: '', place_id: '', category: cat, cats: [], rating: null, reviews: null,
    address: [street, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), city, state, zip,
    phone: tagOf(t, 'phone', 'contact:phone', 'contact:mobile', 'mobile'), website: site, domain,
    lat: Number.isFinite(Number(lat)) ? Number(lat) : null, lng: Number.isFinite(Number(lng)) ? Number(lng) : null,
    claimed: null, photos: null, hours: Boolean(hours), hours_text: hours.slice(0, 200),
    email: tagOf(t, 'email', 'contact:email').toLowerCase().slice(0, 120), socials: Object.keys(social).length ? social : null,
    description: tagOf(t, 'description').slice(0, 300), osm: `${el.type || 'node'}/${el.id}`, source: 'osm',
  };
}

// ---------- Florida Sunbiz ----------
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'");
// Lines of visible text, one per element, so section headings and values can be found whatever the markup is.
export function textLines(html) {
  return decode(String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<\/(p|div|tr|li|h\d|label|span|td|th|a|dt|dd|br)\s*>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .split(/\n+/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// The words of a business name that identify it. "Bayside Roofing & Sheet Metal, LLC" -> "bayside roofing sheet metal".
export const entityName = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|ltd|pllc|pa|p\.a|pl|lp|llp|dba|of|the|and)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
export const sunbizSearchUrl = (name) => `https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults/EntityName/${encodeURIComponent(String(name || '').trim().replace(/[.,]/g, ''))}/Page1?searchNameOrder=${encodeURIComponent(String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40))}`;

// The search results page: one row per entity with a link to its detail page.
export function parseSunbizResults(html) {
  const out = [];
  const rows = String(html || '').split(/<tr\b/i).slice(1);
  for (const r of rows) {
    const a = /<a[^>]+href="([^"]*SearchResultDetail[^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(r);
    if (!a) continue;
    const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => decode(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
    const name = decode(a[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const status = cells.find((c) => /^(ACTIVE|INACTIVE|INACT|ADMIN DISSOLVED|REVOKED|CANCELLED|WITHDRAWN|DISSOLVED)/i.test(c)) || cells[cells.length - 1] || '';
    out.push({ name, url: decode(a[1]), status: status.toUpperCase(), active: /^ACTIVE/i.test(status) });
  }
  return out;
}

// Best matching entity for a lead: the business name must match closely, active ones first.
export function pickEntity(results, lead) {
  const want = entityName(lead?.business_raw || lead?.business);
  if (!want) return null;
  const wset = new Set(want.split(' '));
  let best = null, bestScore = 0;
  for (const r of results || []) {
    const have = entityName(r.name);
    if (!have) continue;
    const hset = new Set(have.split(' '));
    const common = [...wset].filter((w) => hset.has(w)).length;
    const score = have === want ? 10 : common / Math.max(wset.size, hset.size);
    const total = score + (r.active ? 0.25 : 0);
    if (score >= 0.66 && total > bestScore) { best = r; bestScore = total; }
  }
  return best;
}

const TITLES = { P: 'President', PRES: 'President', PRESIDENT: 'President', VP: 'Vice President', V: 'Vice President', 'V.P.': 'Vice President', S: 'Secretary', SEC: 'Secretary', SECRETARY: 'Secretary', T: 'Treasurer', TREAS: 'Treasurer', D: 'Director', DIR: 'Director', DIRECTOR: 'Director', CEO: 'CEO', CFO: 'CFO', MGR: 'Manager', MANAGER: 'Manager', AMBR: 'Authorized Member', MGRM: 'Managing Member', MEMBER: 'Member', MBR: 'Member', AP: 'Authorized Person', 'AUTH REP': 'Authorized Representative' };
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b([a-z])([a-z']*)/g, (m, a, b) => a.toUpperCase() + b.replace(/'([a-z])/g, (x, c) => `'${c.toUpperCase()}`)).replace(/\b(Llc|Inc|Iii|Ii|Iv)\b/g, (x) => x.toUpperCase());
// "SMITH, JOHN A" -> "John A Smith"
export function personName(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s || /\b(LLC|INC|CORP|LTD|TRUST|LP|LLP|COMPANY|HOLDINGS|GROUP|PA|PLLC)\b\.?$/i.test(s)) return '';
  const m = /^([^,]+),\s*(.+)$/.exec(s);
  return titleCase(m ? `${m[2]} ${m[1]}` : s);
}

// A detail page: filing facts, addresses, the registered agent and the people on the record.
export function parseSunbizDetail(html) {
  const lines = textLines(html);
  const idx = (re, from = 0) => { for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i; return -1; };
  const out = { name: '', kind: '', docNo: '', ein: '', filed: '', state: '', status: '', principal: '', mailing: '', agent: { name: '', address: '' }, people: [], annualReports: [] };
  const nameAt = idx(/^(Detail by (Entity|FEI|Document))/i);
  if (nameAt >= 0) { out.kind = lines[nameAt + 1] || ''; out.name = lines[nameAt + 2] || ''; if (/^Florida|^Foreign|Corporation$|Company$/i.test(out.name) && lines[nameAt + 3]) { out.kind = out.name; out.name = lines[nameAt + 3]; } }
  const val = (label) => { const i = idx(new RegExp(`^${label}\\b:?\\s*`, 'i')); if (i < 0) return ''; const inline = lines[i].replace(new RegExp(`^${label}\\b:?\\s*`, 'i'), '').trim(); return inline || lines[i + 1] || ''; };
  out.docNo = val('Document Number'); out.ein = val('FEI/EIN Number'); out.filed = val('Date Filed'); out.state = val('State'); out.status = val('Status');
  const block = (re, stop) => { const i = idx(re); if (i < 0) return []; const res = []; for (let k = i + 1; k < lines.length && !stop.test(lines[k]); k++) res.push(lines[k]); return res; };
  const STOPS = /^(Principal Address|Mailing Address|Registered Agent|Officer\/Director|Authorized Person|Annual Report|Document Images|Name & Address|Title\b|Filing Information|Other Address|Manager|Fictitious)/i;
  out.principal = block(/^Principal Address/i, /^(Mailing Address|Registered Agent|Officer\/Director|Authorized Person|Annual Report|Document Images|Changed:)/i).filter((l) => !/^Changed:/i.test(l)).join(', ');
  out.mailing = block(/^Mailing Address/i, /^(Registered Agent|Officer\/Director|Authorized Person|Annual Report|Document Images|Changed:)/i).filter((l) => !/^Changed:/i.test(l)).join(', ');
  const ag = block(/^Registered Agent/i, /^(Officer\/Director|Authorized Person|Annual Report|Document Images|Changed:)/i).filter((l) => !/^(Name & Address|Name Changed|Address Changed)/i.test(l));
  out.agent = { name: personName(ag[0]) || String(ag[0] || '').trim(), address: ag.slice(1).filter((l) => !/^Name Changed|^Address Changed/i.test(l)).join(', ') };
  // People: "Title MGR" then the name, then the address lines (which start with a number or P.O. box).
  const pi = idx(/^(Officer\/Director Detail|Authorized Person\(s\) Detail)/i);
  if (pi >= 0) {
    const end = idx(/^(Annual Report|Document Images)/i, pi + 1);
    const seg = lines.slice(pi + 1, end < 0 ? lines.length : end);
    for (let i = 0; i < seg.length; i++) {
      const t = /^Title\s*(.*)$/i.exec(seg[i]);
      if (!t) continue;
      const code = (t[1] || '').trim().toUpperCase();
      const nameLine = seg[i + 1] && !/^Title\b/i.test(seg[i + 1]) ? seg[i + 1] : '';
      const nm = personName(nameLine);
      if (nm) out.people.push({ name: nm, title: TITLES[code] || titleCase(code) || '' });
    }
    // The summarized layout, "Robert Flowers, President"
    if (!out.people.length) for (const l of seg) { const m = /^([A-Za-z][A-Za-z .'-]+),\s*([A-Za-z./ ]{2,30})$/.exec(l); if (m && !/^Name/i.test(m[1])) out.people.push({ name: titleCase(m[1]), title: TITLES[m[2].trim().toUpperCase()] || m[2].trim() }); }
  }
  lines.forEach((l, i) => { const m = /^(20\d\d)(?:\s+\d\d\/\d\d\/20\d\d)?$/.exec(l); if (m && (l.length > 4 || /^\d\d\/\d\d\/20\d\d$/.test(lines[i + 1] || ''))) out.annualReports.push(m[1]); });
  return out;
}

// Years since the date filed, from "01/19/1976".
export function yearsSince(filed, nowMs = Date.now()) {
  const m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(String(filed || '').trim());
  if (!m) return null;
  const y = (nowMs - Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]))) / (365.25 * 864e5);
  return y >= 0 && y < 200 ? Math.floor(y) : null;
}

// The person most likely to be the owner: manager or president first, then the first person who is not a registered agent service.
const RANK = ['Manager', 'Managing Member', 'Authorized Member', 'President', 'CEO', 'Member', 'Director', 'Authorized Person', 'Vice President', 'Treasurer', 'Secretary'];
export function pickOwner(detail) {
  const ppl = (detail?.people || []).filter((p) => p.name && p.name.split(' ').length >= 2 && !/registered agent|incorporat|corporate|services|legalzoom|northwest|csc|ct corp/i.test(p.name));
  if (!ppl.length) return null;
  const rank = (p) => { const i = RANK.indexOf(p.title); return i < 0 ? 50 : i; };
  return [...ppl].sort((a, b) => rank(a) - rank(b))[0];
}

export const licenseSearchUrl = () => 'https://www2.myfloridalicense.com/wl11.asp?mode=0&SID=&brd=&typ=';

// ---------- a wider read of the business's own website ----------
const SERVICE_WORDS = /\b(roof(?:ing)?(?: repair| replacement| installation| inspection)?|shingle|tile roof|metal roof|flat roof|gutter|leak repair|storm damage|plumbing|drain cleaning|water heater|pipe repair|repipe|leak detection|ac repair|air conditioning|hvac|heating|duct|installation|maintenance|electrical|panel upgrade|rewiring|lighting|landscaping|lawn care|tree service|irrigation|pressure washing|painting|remodeling|kitchen|bathroom|flooring|windows|doors|cabinets|pest control|termite|pool service|pool cleaning|pool repair|cleaning|moving|towing|auto repair|body work|detailing|dental|implants|whitening|orthodont\w+|family law|personal injury|estate planning|tax preparation|bookkeeping|real estate|property management|insurance|security|alarm|fencing|concrete|paving|demolition|restoration|water damage|mold|fire damage)\b/gi;

// Facts a business states about itself. Everything is optional; nothing is guessed.
export function extractProfile(html) {
  const raw = String(html || '');
  const text = decode(raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const out = { description: '', services: [], areas: [], years: null, founded: null, license: '', hours: '', team: [], family: false, emergency: false, freeEstimate: false, financing: false, warranty: false, cms: '', hasForm: false, hasChat: false, hasBooking: false, reviewsOnSite: false };
  const meta = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{20,300})["']/i.exec(raw) || /<meta[^>]+content=["']([^"']{20,300})["'][^>]+name=["']description["']/i.exec(raw) || /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{20,300})["']/i.exec(raw);
  if (meta) out.description = decode(meta[1]).trim();
  const scan = `${out.description} ${text}`;
  const svc = new Map();
  for (const m of text.matchAll(SERVICE_WORDS)) { const k = m[1].toLowerCase(); svc.set(k, (svc.get(k) || 0) + 1); }
  out.services = [...svc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k);
  // Areas served: "serving Miami, Hialeah and Coral Gables", "service areas: ..."
  const areaSet = new Set();
  for (const m of text.matchAll(/(?:[Ss]erv(?:ing|es)|[Ss]ervice [Aa]reas?|[Aa]reas? [Ww]e [Ss]erve|[Pp]roudly [Ss]erving|[Ww]e [Ss]erve)\s*:?\s*((?:[A-Z][a-zA-Z'-]+(?: [A-Z][a-zA-Z'-]+)?(?:,? (?:and |& )?)?){1,10})/g)) {
    for (const p of m[1].split(/,|\band\b|&/)) { const c = p.trim().replace(/\.$/, ''); if (c.length >= 3 && c.length <= 28 && !/^(The|Our|All|Florida|County|Area|Areas|Residential|Commercial)$/i.test(c)) areaSet.add(c); }
  }
  out.areas = [...areaSet].slice(0, 12);
  const yrs = /(?:over|more than|for|with)?\s*(\d{1,2})\+?\s*(?:years?)\s*(?:of\s+)?(?:experience|in business|serving|of service|strong)/i.exec(scan) || /(?:in business|serving [A-Za-z ,]{3,40}) (?:for|since)\s*(\d{1,2}) years/i.exec(scan);
  if (yrs && Number(yrs[1]) >= 1 && Number(yrs[1]) <= 90) out.years = Number(yrs[1]);
  const since = /\b(?:since|established|est\.?|founded(?: in)?)\s*(19[5-9]\d|20[0-2]\d)\b/i.exec(scan);
  if (since) out.founded = Number(since[1]);
  const lic = /\b(?:license|lic\.?|licence|cgc|ccc|crc|cac|cpc|ec|er|cfc)\s*(?:#|no\.?|number|:)?\s*((?:CGC|CCC|CRC|CAC|CPC|CFC|EC|ER|RC|RB|RR|CBC|CUC|FRO)?\s?\d{5,8})\b/i.exec(text);
  if (lic) out.license = lic[1].replace(/\s+/g, '').toUpperCase();
  const hrs = new RegExp(`\\b((?:Mon(?:day)?|Monday)[ \\-\u2013to]{1,6}(?:Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)[^.]{0,40}?\\d{1,2}(?::\\d\\d)?\\s?(?:am|pm|AM|PM)[^.]{0,20}?\\d{1,2}(?::\\d\\d)?\\s?(?:am|pm|AM|PM))`, 'i').exec(text);
  if (hrs) out.hours = hrs[1].replace(/\s+/g, ' ').slice(0, 90);
  const team = new Set();
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?: [A-Z]\.)? [A-Z][a-z'-]+),?\s*[-\u2013|,]?\s*(Owner|Founder|Co-Founder|President|CEO|General Manager|Project Manager|Operations Manager|Lead Technician|Master Plumber|Master Electrician|Office Manager)\b/g)) team.add(`${m[1]} (${m[2]})`);
  out.team = [...team].slice(0, 6);
  out.family = /\bfamily[- ](?:owned|operated|business)\b/i.test(scan);
  out.emergency = /\b(24\/7|24 hour|24-hour|emergency service|same[- ]day)\b/i.test(text);
  out.freeEstimate = /\bfree (?:estimate|quote|inspection|consultation)s?\b/i.test(text);
  out.financing = /\bfinancing (?:available|options)|\bpayment plans?\b/i.test(text);
  out.warranty = /\b(?:warranty|warranties|guarantee[ds]?)\b/i.test(text);
  out.reviewsOnSite = /\b(testimonials?|what our (?:customers|clients) say|customer reviews)\b/i.test(text);
  out.hasForm = /<form\b/i.test(raw);
  out.hasChat = /(tawk\.to|livechat|intercom|drift\.com|tidio|crisp\.chat|hs-scripts|podium)/i.test(raw);
  out.hasBooking = /(calendly|housecallpro|jobber|servicetitan|acuityscheduling|setmore|squareup\.com\/appointments)/i.test(raw);
  out.cms = /wp-content|wordpress/i.test(raw) ? 'WordPress' : /wixstatic|wix\.com/i.test(raw) ? 'Wix' : /squarespace/i.test(raw) ? 'Squarespace' : /godaddy|secureserver|websitebuilder/i.test(raw) ? 'GoDaddy' : /shopify/i.test(raw) ? 'Shopify' : /weebly/i.test(raw) ? 'Weebly' : /webflow/i.test(raw) ? 'Webflow' : '';
  return out;
}
export function mergeProfiles(a, b) {
  if (!a) return b; if (!b) return a;
  const uniq = (x, y, n) => [...new Set([...(x || []), ...(y || [])])].slice(0, n);
  return {
    ...a, description: a.description || b.description, services: uniq(a.services, b.services, 10), areas: uniq(a.areas, b.areas, 12), years: a.years ?? b.years, founded: a.founded ?? b.founded,
    license: a.license || b.license, hours: a.hours || b.hours, team: uniq(a.team, b.team, 6), family: a.family || b.family, emergency: a.emergency || b.emergency, freeEstimate: a.freeEstimate || b.freeEstimate,
    financing: a.financing || b.financing, warranty: a.warranty || b.warranty, cms: a.cms || b.cms, hasForm: a.hasForm || b.hasForm, hasChat: a.hasChat || b.hasChat, hasBooking: a.hasBooking || b.hasBooking, reviewsOnSite: a.reviewsOnSite || b.reviewsOnSite,
  };
}
