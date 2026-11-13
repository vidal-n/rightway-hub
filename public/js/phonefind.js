// Find a business's phone number on its own website and make sure the site really is that business (pure, shared by the Worker, the Hub and tests).
// Used by the Import window for leads that came with no phone: no number we can confirm means the lead is dropped.
import { phoneInfo } from './scrub.js';

const SUFFIX = new Set(['llc', 'inc', 'corp', 'co', 'company', 'ltd', 'the', 'and', 'of', 'services', 'service', 'group', 'enterprises', 'solutions', 'pllc', 'pa']);
// Words every business in a trade shares: a match on these alone proves nothing.
const GENERIC = new Set(['plumbing', 'plumber', 'plumbers', 'roofing', 'roofer', 'roofers', 'roof', 'hvac', 'air', 'conditioning', 'heating', 'cooling', 'electric', 'electrical', 'electrician', 'electricians', 'landscaping', 'lawn', 'care', 'cleaning', 'pest', 'control', 'painting', 'painters', 'paint', 'construction', 'contractors', 'contractor', 'remodeling', 'repair', 'repairs', 'florida', 'south', 'miami', 'broward', 'fort', 'lauderdale', 'hollywood', 'best', 'pro', 'pros', 'express', 'quality', 'emergency', 'home', 'homes']);

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&amp;/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

export function nameTokens(business) {
  return [...new Set(norm(business).split(' ').filter((t) => t.length >= 3 && !SUFFIX.has(t)))];
}

// Does this page text belong to this business? Distinctive words (not "plumbing") must appear; a name of only trade words needs every word.
export function nameMatches(business, pageText, host = '') {
  const toks = nameTokens(business);
  if (!toks.length) return false;
  const hay = ` ${norm(pageText).slice(0, 60000)} ${norm(host)} `;
  const has = (t) => hay.includes(` ${t} `) || hay.includes(t);
  const distinct = toks.filter((t) => !GENERIC.has(t));
  if (!distinct.length) return toks.every(has);
  const hit = distinct.filter(has).length;
  return hit === distinct.length || (distinct.length > 2 && hit >= distinct.length - 1);
}

const strip = (h) => String(h || '').replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
export const pageText = (html) => strip(String(html || '').slice(0, 800000));

// Phone numbers on a page, best first: tel: links, then schema "telephone", then numbers written in the text. Only real, non toll free US numbers.
export function findPhones(html) {
  const h = String(html || '').slice(0, 800000);
  const out = [];
  const add = (raw) => { const p = phoneInfo(raw); if (p.valid && p.kind === 'standard' && !out.some((x) => x.digits === p.digits)) out.push({ digits: p.digits, pretty: p.pretty }); };
  for (const m of h.matchAll(/href=["']tel:([^"']+)/gi)) add(decodeURIComponent(m[1]));
  for (const m of h.matchAll(/"telephone"\s*:\s*"([^"]+)"/gi)) add(m[1]);
  for (const m of strip(h).matchAll(/(?<!\d)(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]{0,2}(\d{3})[\s.-](\d{4})(?!\d)/g)) add(`${m[1]}${m[2]}${m[3]}`);
  return out.slice(0, 5);
}
