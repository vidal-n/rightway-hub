import { cleanPerson, isPersonName, nameFromEmail, firstFromEmail } from './names.js';
export { isPersonName, cleanPerson, nameFromEmail, firstFromEmail };
// The lead scrubber, the part that needs no network. Pure, so the Worker, the browser and the tests share it.
// Cleans business names (SEO stuffing, legal endings, shouting), checks phones and emails, pulls emails, social pages and the
// owner's name out of a website, and scores how complete and usable a lead's data is.

const LEGAL = /[\s,]+(?:l\.?\s?l\.?\s?c\.?|inc\.?|incorporated|corp\.?|corporation|ltd\.?|limited|p\.?l\.?l\.?c\.?|l\.?l\.?p\.?|p\.?\s?a\.?|p\.?c\.?)$/i;
const CO = /,?\s+co\.?$/i;
// Words that mark the tail after a separator as SEO filler, not part of the name.
const FILLER = /\b(best|top|#\s?1|no\.?\s?1|number one|near me|24\s?\/\s?7|24 hours?|open 24|emergency|licensed|insured|bonded|affordable|cheap|certified|rated|reviews?|free (estimates?|quotes?)|same day|services? in|repair in|company in|serving|call now|call us|since \d{4}|family owned|locally owned)\b/i;
const SEP = /\s+[|–—:\/-]\s+|\s*\|\s*|:\s+/;
const SMALL = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'our', 'your', 'with']);
const KEEP_UPPER = new Set(['HVAC', 'AC', 'A/C', 'USA', 'US', 'DDS', 'DMD', 'MD', 'CPA', 'BBQ', 'RV', 'TV', 'II', 'III', 'IV', 'LED', 'ATM', 'DJ', 'PC', 'IT', 'ABC', 'EV', 'CBD', 'K9', 'NYC', 'LA', 'FL', 'TX', 'CA', 'NY', 'GA', 'NC', 'SC']);
const STATE = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/;

function titleCase(s) {
  return s.split(/(\s+)/).map((w, i) => {
    if (/^\s+$/.test(w)) return w;
    const bare = w.replace(/[^\w/&'-]/g, '');
    if (KEEP_UPPER.has(bare.toUpperCase()) || /\d/.test(w)) return w.toUpperCase();
    const low = w.toLowerCase();
    if (i > 0 && SMALL.has(low)) return low;
    if (bare.length <= 3 && w === w.toUpperCase() && !SMALL.has(low) && !/[aeiou]/i.test(bare)) return w; // initials like JT, KCS
    return low.replace(/(^|[\s'(&/-])([a-z])/g, (m, p, c) => p + c.toUpperCase()).replace(/'S\b/g, "'s");
  }).join('');
}

// "JOE'S PLUMBING LLC | Best Plumber in Miami FL 24/7" -> "Joe's Plumbing"
export function cleanName(raw, { city = '', state = '' } = {}) {
  const original = String(raw || '').trim();
  let s = original.normalize('NFKC')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[®™©℠]/g, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ').trim();
  if (!s) return { name: original, changed: false };
  // Parenthetical filler: "(Open 24 Hours)", "(Best in Tampa)"
  s = s.replace(/\s*\(([^)]*)\)/g, (m, inner) => (FILLER.test(inner) || (city && inner.toLowerCase().includes(city.toLowerCase())) ? '' : m)).trim();
  // SEO tail after a separator
  const parts = s.split(SEP);
  if (parts.length > 1 && parts[0].trim().length >= 3) {
    const head = parts[0].trim(), tail = parts.slice(1).join(' ').trim();
    const tl = tail.toLowerCase();
    const cityHit = city && tl.includes(String(city).toLowerCase());
    if (FILLER.test(tail) || cityHit || STATE.test(tail) || / in [A-Z]/.test(tail) || tail.split(/\s+/).length >= 4) s = head;
  }
  // ", Miami" / " - Miami FL" / " Miami, FL" at the end
  if (city) {
    const c = String(city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`(?:\\s*[,|-]\\s*|\\s+(?:in|of)\\s+)${c}(?:\\s*,?\\s*(?:${state || '[A-Z]{2}'}))?$`, 'i'), (m) => (/^\s+of\s+/i.test(m) ? m : '')).trim();
  }
  for (let i = 0; i < 2; i++) s = s.replace(LEGAL, '').trim();
  if (s.split(/\s+/).length >= 3) s = s.replace(CO, '').trim();
  s = s.replace(/[\s,;:|/-]+$/, '').trim();
  // Shouting or all lowercase: fix the case (mixed case is the owner's choice, left alone).
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 6 && (letters === letters.toUpperCase() || letters === letters.toLowerCase())) s = titleCase(s);
  if (s.length < 2) s = original;
  return { name: s, changed: s !== original };
}

const TOLL_FREE = /^(800|833|844|855|866|877|888)/;
// A US or Canada number: valid shape, toll free, premium. Problems use the same words as the import scrub.
export function phoneInfo(phone) {
  const d = String(phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  if (d.length !== 10) return { digits: d, valid: false, kind: null, problem: 'No valid phone number' };
  const area = d.slice(0, 3);
  if (/^[01]/.test(area) || /^\d11$/.test(area)) return { digits: d, valid: false, kind: null, problem: 'No valid phone number' };
  const e164 = `+1${d}`;
  const pretty = `(${area}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (TOLL_FREE.test(d)) return { digits: d, e164, pretty, valid: true, kind: 'toll_free', problem: 'Toll free number (a call center, not the owner)' };
  if (area === '900' || d.slice(3, 6) === '976') return { digits: d, e164, pretty, valid: true, kind: 'premium', problem: 'Premium rate number' };
  return { digits: d, e164, pretty, valid: true, kind: 'standard', problem: null };
}

const ROLE = /^(info|sales|office|contact|admin|support|hello|hi|service|services|team|billing|help|inquiries|inquiry|enquiries|frontdesk|front\.desk|appointments?|booking|bookings|marketing|mail|email|customerservice|customer\.service|cs|general|reception|orders|jobs|careers|hr|accounts|estimates?|quotes?|schedule|scheduling|dispatch)$/i;
const NOREPLY = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|abuse|webmaster|wordpress|root)$/i;
const FREE = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|mac|comcast|att|sbcglobal|bellsouth|verizon|cox|charter|earthlink|protonmail|proton|gmx|zoho|mail|yandex)\.(com|net|me|ch)$/i;
const DISPOSABLE = /^(mailinator|guerrillamail|10minutemail|tempmail|temp-mail|yopmail|trashmail|getnada|dispostable|sharklasers|maildrop)\./i;
const JUNK_DOMAIN = /(^|\.)(example|domain|yourdomain|yoursite|email|sentry|sentry-next|wixpress|wix|squarespace|godaddy|test|website|company|mysite|placeholder)\.(com|io|net|org)$/i;
const IMG = /\.(png|jpe?g|gif|webp|svg|bmp|ico|css|js)$/i;

// Is this a usable email? role (info@), free provider, disposable, placeholder.
export function emailInfo(email, siteHost = '') {
  const e = String(email || '').trim().toLowerCase().replace(/^mailto:/, '').split('?')[0];
  const m = e.match(/^([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,24})$/);
  if (!m) return { email: e, ok: false, problem: 'Not a valid email' };
  const [, local, domain] = m;
  if (IMG.test(e) || /@\dx\./.test(e) || JUNK_DOMAIN.test(domain)) return { email: e, local, domain, ok: false, problem: 'Placeholder from the website code' };
  if (NOREPLY.test(local)) return { email: e, local, domain, ok: false, problem: 'No reply address' };
  if (DISPOSABLE.test(domain)) return { email: e, local, domain, ok: false, problem: 'Throwaway email service' };
  const host = String(siteHost || '').toLowerCase().replace(/^www\./, '');
  return { email: e, local, domain, ok: true, role: ROLE.test(local), free: FREE.test(domain), own: Boolean(host) && (domain === host || domain.endsWith(`.${host}`) || host.endsWith(`.${domain}`)), problem: null };
}

// The best email to use: their own domain and a person (not info@) first.
export function pickEmail(list) {
  const rank = (x) => (x.mx === false ? 50 : 0) + (x.own ? 0 : x.free ? 10 : 20) + (x.role ? 5 : 0);
  return [...list].filter((x) => x.ok).sort((a, b) => rank(a) - rank(b))[0] || null;
}
export function emailStatus(x) {
  if (!x) return null;
  if (!x.ok) return 'bad';
  if (x.mx === false) return 'no_mail_server';
  if (x.role) return 'role';
  return x.mx ? 'valid' : 'unverified';
}

const decode = (s) => String(s).replace(/&#64;|&#x40;|\s\[at\]\s|\s\(at\)\s/gi, '@').replace(/&#46;|\s\[dot\]\s|\s\(dot\)\s/gi, '.').replace(/&amp;/g, '&');
const SOCIAL = [
  ['facebook', /https?:\/\/(?:www\.|m\.|business\.)?facebook\.com\/(?!sharer|share|dialog|plugins|tr\b|login|groups\/?$|events\/?$|pages\/?$|profile\.php\?id=$)[\w.\-/?=]+/i],
  ['instagram', /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel\/|explore\/|accounts\/)[\w.]+/i],
  ['linkedin', /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in)\/[\w\-%.]+/i],
  ['youtube', /https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/|user\/)[\w\-.]+/i],
  ['tiktok', /https?:\/\/(?:www\.)?tiktok\.com\/@[\w.]+/i],
  ['x', /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|home|search)[\w]{2,15}/i],
  ['yelp', /https?:\/\/(?:www\.)?yelp\.com\/biz\/[\w\-%]+/i],
  ['nextdoor', /https?:\/\/(?:www\.)?nextdoor\.com\/(?:pages|page)\/[\w\-%]+/i],
  ['google', /https?:\/\/(?:g\.page|maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.com\/maps\/place)\/[\w\-%+./@,]+/i],
];
// Owner and name finding. Every candidate must pass isPersonName (names.js): a known first name, no job title, no trade word.
// "Owner Operator", "Message From" or "Authorized Person" can never be saved as a person any more.
const TITLE = '(?:Co-?\\s?Owner|Owner\\s*(?:and|&|/)\\s*(?:Operator|Founder|President|CEO)|Owner|Founder\\s*(?:and|&)\\s*(?:Owner|CEO|President)|Co-?Founder|Founder|President|Proprietor|CEO|Principal|Managing\\s+(?:Member|Partner))';
const CAND = "([A-Z][A-Za-z'.-]{1,18}(?:\\s+[A-Z]\\.?)?(?:\\s+(?:De|Del|La|Van|Von|Di|Da|Mc|Mac)?\\s?[A-Z][A-Za-z'-]{1,22}){1,2})";
const OWNER_RES = [
  new RegExp(`"founder"\\s*:\\s*(?:\\[\\s*)?\\{[^}]*?"name"\\s*:\\s*"([^"]{4,40})"`, 'g'),
  new RegExp(`"founder"\\s*:\\s*"([^"]{4,40})"`, 'g'),
  new RegExp(`"name"\\s*:\\s*"([^"]{4,40})"[^}]{0,200}?"jobTitle"\\s*:\\s*"[^"]*(?:owner|founder|president|proprietor|principal)[^"]*"`, 'gi'),
  new RegExp(`"jobTitle"\\s*:\\s*"[^"]*(?:owner|founder|president|proprietor|principal)[^"]*"[^}]{0,200}?"name"\\s*:\\s*"([^"]{4,40})"`, 'gi'),
  new RegExp(`\\b${TITLE}\\s*[:\\-–—|,]?\\s+${CAND}`, 'g'),
  new RegExp(`${CAND}\\s*[,\\-–—|:(]?\\s*(?:the\\s+)?${TITLE}\\b`, 'g'),
  new RegExp(`\\b(?:founded|owned|started|run|operated|established)\\s+(?:in\\s+\\d{4}\\s+)?by\\s+${CAND}`, 'gi'),
  new RegExp(`\\b(?:I'm|I am|My name is|Hi,? I'm|Hello,? I'm)\\s+${CAND}(?=[^.]{0,120}\\b(?:owner|founder|own|started|founded)\\b)`, 'g'),
  new RegExp(`\\b${CAND}\\s+(?:is|was)\\s+(?:the\\s+)?(?:owner|founder|president|proprietor)`, 'g'),
  new RegExp(`\\bMeet\\s+${CAND}\\b`, 'g'),
];
// The first candidate on the page that is really a person, with the pattern that found it.
export function findOwner(html, text) {
  for (let i = 0; i < OWNER_RES.length; i++) {
    const src = i < 4 ? html : text;
    const re = OWNER_RES[i];
    re.lastIndex = 0;
    let m, guard = 0;
    // Matches may overlap ("Owner Operator Plumbing Owner: Mike Diaz"), so step one character past each start.
    while ((m = re.exec(src)) && guard++ < 200) {
      const n = cleanPerson(m[1]);
      if (n) return { name: n, via: i < 4 ? 'schema' : 'page' };
      re.lastIndex = m.index + 1;
    }
  }
  return null;
}

// Emails, social pages, phone numbers and the owner's name from one page of a website.
export function extractContacts(html, pageUrl = '') {
  const h = decode(String(html || '').slice(0, 1_500_000));
  let host = '';
  try { host = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch { host = ''; }
  const emails = new Set();
  for (const m of h.matchAll(/mailto:([^"'?\s>]+)/gi)) emails.add(decodeURIComponent(m[1]).toLowerCase());
  for (const m of h.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g)) emails.add(m[0].toLowerCase());
  const good = [...emails].map((e) => emailInfo(e, host)).filter((x) => x.ok).map((x) => x.email);
  const socials = {};
  for (const [k, re] of SOCIAL) {
    const g = new RegExp(re.source, 'gi');
    for (const m of h.matchAll(g)) { const u = m[0].replace(/[?#].*$/, '').replace(/\/+$/, ''); if (!socials[k] && u.split('/').length > 3) socials[k] = u; }
  }
  const phones = [...new Set([...h.matchAll(/href=["']tel:([^"']+)/gi)].map((m) => m[1].replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')).filter((d) => d.length === 10))];
  const text = h.replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const o = findOwner(h, text);
  return { emails: good.slice(0, 10), socials, phones: phones.slice(0, 5), owner: o?.name || null, ownerVia: o?.via || '', host };
}
export function mergeContacts(a, b) {
  return { emails: [...new Set([...a.emails, ...b.emails])].slice(0, 10), socials: { ...b.socials, ...a.socials }, phones: [...new Set([...a.phones, ...b.phones])].slice(0, 5), owner: a.owner || b.owner, ownerVia: a.owner ? a.ownerVia : b.ownerVia, host: a.host || b.host };
}
// Same site links to the contact, about and team pages (where emails and owner names live).
export function contactLinks(html, pageUrl) {
  let base;
  try { base = new URL(pageUrl); } catch { return []; }
  const out = [];
  for (const m of String(html || '').matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const label = `${m[1]} ${m[2].replace(/<[^>]+>/g, ' ')}`.toLowerCase();
    if (!/contact|about|our-story|our story|who-we-are|who we are|meet|team|owner/.test(label)) continue;
    let u;
    try { u = new URL(m[1], base); } catch { continue; }
    if (u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '') || !/^https?:$/.test(u.protocol)) continue;
    u.hash = '';
    const s = u.toString();
    if (s !== base.toString() && !out.includes(s)) out.push(s);
  }
  return out.sort((x, y) => (/contact/.test(y) ? 1 : 0) - (/contact/.test(x) ? 1 : 0)).slice(0, 3);
}

// How complete and usable the lead's data is, 0 to 100, and what is missing. Mobile numbers reach the owner more often.
export function dataScore(l) {
  const p = phoneInfo(l.phone_digits || l.phone);
  let socials = {};
  try { socials = typeof l.socials === 'string' ? JSON.parse(l.socials || '{}') : (l.socials || {}); } catch { socials = {}; }
  const parts = [
    ['Phone', p.valid && !p.problem ? 20 : 0, 20],
    ['Mobile number', l.phone_type === 'mobile' ? 15 : l.phone_type === 'landline' || l.phone_type === 'voip' ? 7 : 3, 15],
    ['Owner name', l.owner_name || l.contact_name ? 15 : 0, 15],
    ['Email', !l.email ? 0 : ['bad', 'no_mail_server'].includes(l.email_status) ? 0 : l.email_status === 'role' ? 8 : 15, 15],
    ['Website', l.website ? 10 : 0, 10],
    ['Google profile', l.cid || l.place_id ? 10 : 0, 10],
    ['Reviews', l.reviews != null ? 5 : 0, 5],
    ['Address', l.address || (l.city && l.state) ? 5 : 0, 5],
    ['Social pages', Object.keys(socials).length ? 5 : 0, 5],
  ];
  const score = parts.reduce((n, [, v]) => n + v, 0);
  return { score, grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D', missing: parts.filter(([, v, max]) => v < max).map(([k]) => k) };
}

export const PHONE_TYPE_LABEL = { mobile: 'Mobile', landline: 'Landline', voip: 'Internet phone', toll_free: 'Toll free', premium: 'Premium' };
export const EMAIL_STATUS_LABEL = { valid: 'Valid', unverified: 'Not checked', role: 'Shared inbox (info@)', no_mail_server: 'No mail server', bad: 'Bad' };
