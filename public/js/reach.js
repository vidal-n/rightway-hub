// Owner reach tiers (Nov 2026): how likely a dial reaches the owner and not a receptionist, answering service or phone menu, worked out
// from what the Hub already knows about the lead. Pure, shared by the Worker, the Pipeline and the tests; nothing here is a prediction
// of a sale and nothing deletes a lead: a tier only decides order and where a lead sits on the board (T4 stays visible as "Gatekeeper likely").
// Modeled on Nooks Pickup Likelihood (a tier per number, lower tiers dialed last, never removed), Orum's phone field priority and Close's
// exclusive Smart Views for the tiers, HubSpot's fit plus engagement labels for the "B1 . T2" chip, and Apollo's separate reachability
// dimension. The research report "Owner direct lead detection" (kept outside the repo, sent to V) is the source of the design.
//
// HONESTY: only the +10 for a mobile line is anchored to a measurement (Nooks, +45% connect rate, B2B). Every other weight below is a
// HYPOTHESIS that V can test in Call insights (owner conversations per 100 dials by tier) and retune. Unknown adds nothing: a lead that
// was never checked is not treated as a bad lead, it just carries a lower confidence number and gets enrichment first.
// Works for every US state: nothing here depends on a state. Calling hours and state rules live in timezone.js and are gates, not scores.
import { likelyOwner } from './leadfilter.js';
import { isOwnerName, isFirstName } from './names.js';
import { unpackHours } from './hours.js';

export const TIERS = ['T1', 'T2', 'T3', 'T4'];
export const TIER_LABEL = {
  T1: 'Owner likely', T2: 'Owner probable', T3: 'Unknown', T4: 'Gatekeeper likely',
};
export const TIER_HELP = {
  T1: 'A named owner on a mobile or internet phone line, or an owner who already picked up. Dial these first.',
  T2: 'A named owner on a landline or an unchecked line, or a mobile with no name yet. Dial after T1.',
  T3: 'Not enough checked yet to tell. These get free enrichment first. Nothing is wrong with them.',
  T4: 'Looks like a front desk, answering service, chain or phone menu. Kept in the Pipeline, dialed last, re-checked later.',
};

// ---- Website signals (free, from the home page and contact pages the scrub already reads) ----
const FLAG_RES = [
  ['tracking', /callrail|calltrackingmetrics|ctm\.|invoca|dialogtech|whatconverts|marchex|phonewagon|ruler\s?analytics|swap_?number|dni\.js|call[- ]tracking/i],
  ['answering', /ruby\.com|smith\.ai|patlive|answerconnect|numa\.com|rosie\.ai|goodcall|allo\.ai|virtual receptionist|live answering|answering service|24\/7 live (?:agents?|answer|support)/i],
  ['chat', /tidio|livechat|intercom|drift\.com|podium|birdeye|tawk\.to|hubspot.{0,20}chat|chat with us|live chat/i],
  ['front_desk', /front desk|receptionist|office manager|patient portal|new patients? welcome|insurance accepted|request an appointment with our team/i],
  ['multi_loc', /store locator|find a location|our locations|\b(?:[2-9]|[1-9]\d)\s+locations\b|franchise (?:opportunit|owner)/i],
  ['owner_run', /family[- ]owned|locally owned|owner[- ]operated|veteran[- ]owned|woman[- ]owned|minority[- ]owned|small business owner/i],
  ['builder', /wixstatic|wix\.com|squarespace|godaddy\.com\/websites|websitebuilder|weebly|duda\.co|site123|webflow\.io|sites\.google\.com/i],
  ['booking', /housecallpro|jobber\.com|servicetitan|calendly|acuityscheduling|square\.site|booksy|vagaro|schedulicity/i],
];
// The flag names for one page's HTML (strings in a stable order). Pure; the scrub merges the pages and stores them in lead_reach.
export function siteFlags(html) {
  const h = String(html || '').slice(0, 1_500_000);
  const out = [];
  for (const [k, re] of FLAG_RES) if (re.test(h)) out.push(k);
  return out;
}
export const mergeFlags = (a, b) => [...new Set([...(a || []), ...(b || [])])];
export const flagsOf = (l) => (Array.isArray(l.rflags) ? l.rflags : String(l.rflags || '').split(/[\s,]+/).filter(Boolean));

// ---- Industry classes (what the trade is, from Google's category or the trade we saved) ----
const OWNER_RUN = /plumb|hvac|air condition|heating|roof|electric|paint|landscap|lawn|tree (?:service|trim|removal)|pest|exterminat|cleaning|maid|pressure wash|power wash|handyman|garage door|fenc|paver|concrete|masonry|flooring|tile|pool|junk|hauling|moving|detail|tint|auto repair|mechanic|body shop|towing|appliance|carpet|window|gutter|drywall|stucco|remodel|restoration|irrigation|sprinkler|septic|welding|insulation|solar|siding|deck|cabinet|countertop|mobile|grooming|dog walk|photograph/i;
const FRONT_DESK = /dentist|dental|orthodont|doctor|clinic|medical|physician|chiropract|optomet|ophthalm|dermatolog|pediatric|urgent care|hospital|pharmac|veterin|animal hospital|law (?:firm|office)|attorney|lawyer|accountant|cpa\b|tax prep|insurance|real estate (?:agen|broker)|property management|apartment|senior living|nursing|assisted living|school|church|bank|credit union|government|hotel|motel|university|daycare|day care|funeral/i;
const STAFFED = /car dealer|auto dealer|dealership|car rental|rental car|hotel|resort|supermarket|department store|mall\b|furniture store/i;
export function industryClass(l) {
  const t = `${l.category || ''} ${l.industry || ''}`;
  if (STAFFED.test(t)) return 'staffed';
  if (FRONT_DESK.test(t)) return 'front_desk';
  if (OWNER_RUN.test(t)) return 'owner_run';
  return 'other';
}

// A personal name in the business name ("Mike's Plumbing", "Carlos Diaz Roofing") is the sole operator pattern.
export function personalBusiness(business) {
  const w = String(business || '').trim().split(/\s+/);
  if (!w.length) return false;
  if (/^[A-Z][a-z]+(?:'s|’s)$/.test(w[0]) && isFirstName(w[0].replace(/(?:'s|’s)$/, ''))) return true;
  return w.length >= 3 && isFirstName(w[0]) && /^[A-Z][a-z'-]+$/.test(w[1]) && !isFirstName(w[1]);
}

const nz = (a, b) => (a != null ? a : b);
const is24h = (hrs) => {
  if (!hrs) return false;
  const w = unpackHours(hrs);
  if (!w) return false;
  let full = 0;
  for (let d = 1; d <= 7; d++) if ((w[d] || []).some(([s, e]) => s <= 0 && e >= 1430)) full++;
  return full >= 6;
};

// The score: 50 plus signed points, 0 to 100. Ten points is about 1.5 times the odds of reaching the owner (hypothesis).
// Returns { score, tier, conf, flags, why: [{k, pts, text}], unchecked: [text] }.
export function ownerReach(l = {}) {
  const sig = []; const unchecked = []; const flags = [];
  const add = (k, pts, text) => sig.push({ k, pts, text });
  const site = flagsOf(l);
  const pt = l.phone_type || '';
  const named = isOwnerName(l.owner_name || '');
  const ownerTalks = nz(l.owner_talks, l.r_owner) || 0;
  const staffTalks = nz(l.staff_talks, l.r_staff) || 0;
  const menus = nz(l.menus, l.r_menu) || 0;
  const services = nz(l.services, l.r_service) || 0;
  const dials = nz(l.dials, l.r_dials) || 0;
  const connects = nz(l.connects, l.r_connects) || 0;

  // Hard stops first. These are the same rules the dialer already enforces; the tier just names them.
  if (l.dnc || l.stage === 'dnc') return { score: 0, tier: 'X', conf: 1, flags: ['dnc'], why: [{ k: 'dnc', pts: -50, text: 'On the Do not call list' }], unchecked: [] };

  // Line type (number level). Mobile is the one measured effect (Nooks, +45% connect rate, B2B).
  if (pt === 'mobile') add('line', 10, 'Mobile line');
  else if (pt === 'voip') add('line', 3, 'Internet phone line');
  else if (pt === 'landline') add('line', -4, 'Landline (front desk more likely)');
  else if (pt === 'toll_free') { add('line', -20, 'Toll free number'); flags.push('toll_free'); }
  else if (['premium', 'voicemail', 'pager'].includes(pt)) { return { score: 0, tier: 'X', conf: 1, flags: [pt], why: [{ k: 'line', pts: -50, text: pt === 'premium' ? 'Premium rate number' : 'Not a person (voicemail or pager line)' }], unchecked: [] }; }
  else if (['uan', 'sharedCost', 'shared_cost'].includes(pt)) { add('line', -20, 'Routing or shared cost number'); flags.push('toll_free'); }
  else if (pt) add('line', 0, `Line type: ${pt}`);
  else unchecked.push('line type');

  // Owner name: a real person's name found by the scrub or typed by a rep.
  if (named) add('name', 8, 'Owner name known');
  else if (l.scrubbed_at) add('name', -3, 'Scrubbed, no owner name found');
  else unchecked.push('owner name');

  // Business name and class.
  if (personalBusiness(l.business)) add('personal', 6, 'Business is named after a person');
  const cls = industryClass(l);
  if (cls === 'owner_run') add('class', 6, 'Owner run trade');
  else if (cls === 'front_desk') add('class', -6, 'Front desk by design (medical, legal, office)');
  else if (cls === 'staffed') add('class', -10, 'Staffed desk business (dealer, hotel)');
  if (!likelyOwner({ ...l, reviews: null })) { add('chain', -25, 'Looks like a chain, franchise or toll free brand'); flags.push('chain'); }

  // Reviews: an established small shop reads best. Over 400 is a guess that it has staff.
  const rv = l.reviews;
  if (rv == null) unchecked.push('reviews');
  else if (rv >= 5 && rv <= 150) add('reviews', 4, 'Established small shop (5 to 150 reviews)');
  else if (rv > 400) add('reviews', -10, 'Over 400 reviews (likely staffed)');
  else if (rv > 150) add('reviews', -2, '151 to 400 reviews');

  // Hours: a business that says it is open all day every day usually has a dispatch line, not an owner.
  if (!l.hrs) unchecked.push('hours');
  else if (is24h(l.hrs)) { add('hours', -8, 'Open 24/7 (dispatch line)'); }

  // Website: no site is a one person shop; the page tells us about call tracking, answering services and front desks.
  const checkedSite = Boolean(l.scrubbed_at);
  if (!l.website) add('site', 4, 'No website (owner run shop)');
  else if (!checkedSite) unchecked.push('website read');
  if (site.includes('builder')) add('builder', 3, 'Do it yourself website builder');
  if (site.includes('owner_run')) add('ownertext', 3, 'Site says owner operated or family owned');
  if (site.includes('tracking')) { add('tracking', -8, 'Call tracking script (number may be a tracking line)'); flags.push('tracking'); }
  if (site.includes('answering')) { add('answering', -12, 'Answering service on the site'); flags.push('answering'); }
  if (site.includes('chat')) add('chat', -3, 'Live chat widget (someone is behind it)');
  if (site.includes('front_desk')) add('frontdesk', -8, 'Site mentions a front desk or office manager');
  if (site.includes('multi_loc')) { add('multi', -12, 'Several locations'); flags.push('multi_loc'); }

  // The same number on other leads (a shared line, a service or bad data). Counted by the server when it knows.
  if ((l.shared_n || 0) >= 3) { add('shared', -25, 'Same number on 3 or more leads'); flags.push('shared_number'); }
  else if ((l.shared_n || 0) === 2) add('shared', -15, 'Same number on another lead');

  // What our own calls say. This beats every guess above.
  if (ownerTalks > 0) add('owner_talk', 30, 'An owner picked up before');
  if (staffTalks > 0 && !ownerTalks) add('staff', -6, 'Staff picked up');
  if (menus + services >= 2 && !ownerTalks) { add('menu', -25, 'Phone menu or answering service twice'); flags.push('gatekeeper_number'); }
  else if (menus + services === 1 && !ownerTalks) add('menu', -10, 'Phone menu or answering service once');
  const unanswered = dials - connects;
  if (unanswered >= 3 && !connects) add('noans', -8, 'No answer on 3 or more tries');

  const raw = 50 + sig.reduce((n, s) => n + s.pts, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  // Confidence: how many of the five cheap checks have been made.
  const checks = [Boolean(pt), named || Boolean(l.scrubbed_at), rv != null, Boolean(l.hrs), checkedSite || !l.website];
  const conf = Math.round((checks.filter(Boolean).length / checks.length) * 100) / 100;

  const hard = flags.some((f) => ['chain', 'toll_free', 'answering', 'gatekeeper_number', 'multi_loc', 'shared_number'].includes(f));
  const direct = pt === 'mobile' || pt === 'voip';
  let tier;
  if (ownerTalks > 0) tier = 'T1';
  else if (hard) tier = 'T4';
  else if (named && direct && score >= 60) tier = 'T1';
  else if (score < 35) tier = 'T4';
  else if (named && score >= (pt === 'landline' ? 45 : 50)) tier = 'T2';
  else if (pt === 'mobile' && score >= 50) tier = 'T2';
  else tier = 'T3';
  // A lead with almost nothing checked stays T3 unless a call proved it.
  if (conf < 0.4 && !ownerTalks && tier === 'T2' && !named) tier = 'T3';

  const why = [...sig].sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts)).slice(0, 3).map((s) => ({ ...s }));
  return { score, tier, conf, flags, why, unchecked };
}

// One short chip text for lists: "T2 . 58".
export const tierChip = (r) => (r.tier === 'X' ? 'Do not call' : `${r.tier} ${r.score}`);
