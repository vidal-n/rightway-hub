// Pipeline filters. Pure so the tests can run it in Node.
import { nicheOf, saturdayOk, SAT_SKIP } from './niches.js';
import { personOf } from './leadintel.js';

// Does the business have a Google profile? 'yes' when we hold Google facts for it (Lead finder place id, reviews, rating, a map rank),
// 'none' when research looked and found nothing, 'unknown' when nobody has checked yet. After the research check, nothing found means no profile found.
export function gbpState(l) {
  if (l.has_place || l.reviews != null || l.rating != null || l.map_rank != null) return 'yes';
  return l.researched ? 'none' : 'unknown';
}

// Phone menus and gatekeepers are mostly national brands, franchises, institutions and toll free numbers.
// This is a best guess from what we know, not a promise that an owner picks up. Names are typed from memory and not complete.
const BIG_NAMES = /\b(home depot|lowe'?s|walmart|target|costco|best buy|sears|roto-?rooter|mr\.? rooter|rescue rooter|ars\b|aire serv|one hour|benjamin franklin|mister sparky|servpro|servicemaster|stanley steemer|chem-?dry|molly maid|merry maids|orkin|terminix|rollins|truly nolen|trugreen|lawn doctor|jiffy lube|midas|meineke|pep boys|firestone|goodyear|valvoline|autozone|o'?reilly|advance auto|napa|enterprise|hertz|avis|marriott|hilton|hyatt|wyndham|state farm|allstate|geico|farmers insurance|bank of america|wells fargo|chase|regions bank|publix|walgreens|cvs|7-?eleven|mcdonald'?s|starbucks|subway|domino'?s|pizza hut|kfc|burger king|wendy'?s|taco bell|planet fitness|anytime fitness|la fitness|orangetheory|great clips|sport clips|supercuts|h&r block|jackson hewitt|liberty tax|ups store|fedex|u-?haul|public storage|extra space|cubesmart|life storage|hospital|medical center|health system|university|college|school district|county of|city of|department of)\b/i;
const TOLL_FREE = /^\+?1?(800|833|844|855|866|877|888)/;
export function likelyOwner(l) {
  const name = `${l.business || ''}`;
  if (BIG_NAMES.test(name) || BIG_NAMES.test(l.business_raw || '')) return false;
  const digits = String(l.phone_digits || l.phone || '').replace(/\D/g, '');
  if (TOLL_FREE.test(digits)) return false;
  if ((l.reviews ?? 0) > 400) return false;
  return true;
}
export function filterLeads(leads, p) {
  const f = p.f || {};
  // Time zones are one or several, saved as 'ET,CT'. '?' means unknown.
  const zs = String(p.tz || '').split(',').map((z) => z.trim()).filter(Boolean);
  const q = (f.q || '').toLowerCase().trim();
  const inc = (v, want) => !want || String(v || '').toLowerCase().includes(String(want).toLowerCase().trim());
  return leads.filter((l) => {
    if (zs.length && !zs.some((z) => (z === '?' ? !l.tz_short : l.tz_short === z))) return false;
    if (q && ![l.business, l.contact_name, l.phone, l.email, l.city, l.industry, l.category, l.zip, l.tags].some((v) => String(v || '').toLowerCase().includes(q))) return false;
    if (f.grades?.length && !f.grades.includes(l.grade)) return false;
    if (f.state && l.state !== f.state) return false;
    if (!inc(l.city, f.city) || !inc(`${l.industry || ''} ${l.category || ''}`, f.industry) || !inc(l.tags, f.tag)) return false;
    if (f.source && l.source !== f.source) return false;
    if (f.stage && l.stage !== f.stage) return false;
    if (f.site === 'yes' && !l.website) return false;
    if (f.site === 'no' && l.website) return false;
    if (f.researched === 'yes' && !l.researched) return false;
    if (f.researched === 'no' && l.researched) return false;
    if (f.minReviews !== '' && f.minReviews != null && (l.reviews ?? -1) < Number(f.minReviews)) return false;
    if (f.maxReviews !== '' && f.maxReviews != null && (l.reviews ?? 1e9) > Number(f.maxReviews)) return false;
    if (f.maxRating !== '' && f.maxRating != null && (l.rating ?? 0) > Number(f.maxRating)) return false;
    if (f.minScore && (l.score || 0) < Number(f.minScore)) return false;
    if (f.notTop3 && l.map_rank != null && l.map_rank <= 3) return false;
    if (f.notTop10 && l.map_rank != null && l.map_rank <= 10) return false;
    if (f.gbp && gbpState(l) !== f.gbp) return false;
    if (f.small && !likelyOwner(l)) return false;
    if (f.callable && !l.callable_now) return false;
    // Business hours (public/js/hours.js via leadlive.js) and owner direct niche templates (public/js/niches.js).
    if (f.hours && !hoursMatch(l, f.hours)) return false;
    if (f.niche && !nicheMatch(l, f.niche)) return false;
    // Scrubbed data: phone line type, email, owner name, data score.
    if (f.phoneType && (f.phoneType === 'unknown' ? l.phone_type : l.phone_type !== f.phoneType)) return false;
    const goodEmail = Boolean(l.email) && !['bad', 'no_mail_server'].includes(l.email_status);
    if (f.email === 'yes' && !goodEmail) return false;
    if (f.email === 'person' && (!goodEmail || l.email_status === 'role')) return false;
    if (f.email === 'no' && goodEmail) return false;
    // A real person's name only: a job title, a business name or "Owner" in the name fields does not count (personOf).
    if (f.owner === 'yes' && !personOf(l)) return false;
    if (f.owner === 'no' && personOf(l)) return false;
    if (f.scrubbed === 'yes' && !l.scrubbed_at) return false;
    if (f.scrubbed === 'no' && l.scrubbed_at) return false;
    if (f.minData && (l.data_score || 0) < Number(f.minData)) return false;
    return true;
  });
}

// Hours filter values: open, closed, sat (open Saturday), satok (Saturday call list: Saturday hours, or a Saturday niche with no hours),
// sun, known, unknown, gone (Google says closed for now or for good).
export const HOURS_FILTERS = [['open', 'Open right now'], ['closed', 'Closed right now'], ['sat', 'Open on Saturday'], ['satok', 'Good Saturday call'], ['sun', 'Open on Sunday'],
  ['known', 'Hours known'], ['unknown', 'Hours not known'], ['gone', 'Closed on Google (for now or for good)']];
export function hoursMatch(l, v) {
  switch (v) {
    case 'open': return l.hours_state === 'open';
    case 'closed': return l.hours_state === 'closed' || l.hours_state === 'gone';
    case 'sat': return l.open_sat === true;
    case 'satok': return l.hours_state !== 'gone' && saturdayOk(l);
    case 'sun': return l.open_sun === true;
    case 'known': return Boolean(l.hours_known);
    case 'unknown': return !l.hours_known;
    case 'gone': return l.hours_state === 'gone';
    default: return true;
  }
}
// Niche filter: a template id (garage, pool, ...), 'owner' (any owner direct template), 'satniche' (a Saturday template), 'satskip' (call Monday instead).
export function nicheMatch(l, v) {
  if (v === 'satskip') return SAT_SKIP.test(`${l.industry || ''} ${l.category || ''} ${l.business || ''}`);
  const n = nicheOf(l);
  if (v === 'owner') return Boolean(n);
  if (v === 'satniche') return Boolean(n && n.day !== 'weekday');
  return Boolean(n && n.id === v);
}
