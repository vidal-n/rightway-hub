// Reads CSV files from the Instant Data Scraper browser extension run on a Google Maps results list (pure, shared by the Hub import and tests).
// Its headers are Google's own CSS class names (hfpxzc href, xxVWCe, MW4etd, UY7F9, W4Efsd ...) that change over time, so rows are read by what each cell looks like,
// not by header. The Maps list has no phone or website unless Google showed them on the card, and no city: callers pass a state.
const PHONE = /^\+?1?[ -.]?\(?\d{3}\)?[ -.]?\d{3}[ -.]?\d{4}$/;
const BAD_HOST = /(^|\.)(google\.[a-z.]+|gstatic\.com|googleusercontent\.com|googleapis\.com|ggpht\.com)$/i;

export function isMapsScrape(head, body = []) {
  if (head.some((h) => /^hfpxzc/i.test(String(h).trim()))) return true;
  return body.slice(0, 5).some((r) => r.some((c) => /^https?:\/\/(www\.)?google\.[a-z.]+\/maps\/place\//i.test(String(c).trim())));
}

const cleanSite = (u) => {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol) || BAD_HOST.test(x.hostname)) return '';
    return `${x.origin}${x.pathname === '/' ? '' : x.pathname.replace(/\/$/, '')}`;
  } catch { return ''; }
};

export function mapsScrapeRows(head, body, { state = '' } = {}) {
  const nameCol = head.findIndex((h) => /^xxVWCe$/i.test(String(h).trim()));
  return body.map((r) => {
    const cells = r.map((c) => String(c ?? '').trim());
    const li = cells.findIndex((c) => /^https?:\/\/(www\.)?google\.[a-z.]+\/maps\/place\//i.test(c));
    let ni = nameCol >= 0 ? nameCol : li >= 0 ? li + 1 : -1;
    const business = ni >= 0 ? cells[ni] : '';
    if (!business || /^https?:\/\//i.test(business)) return null;
    const o = { business };
    const rest = cells.map((c, i) => [c, i]).filter(([, i]) => i !== ni && i !== li);
    const rating = rest.find(([c]) => /^\d\.\d$/.test(c)); if (rating) o.rating = rating[0];
    const rev = rest.find(([c]) => /^\(\s*[\d,]+\s*\)$/.test(c)); if (rev) o.reviews = rev[0].replace(/[^\d]/g, '');
    const phone = rest.find(([c]) => PHONE.test(c)); if (phone) o.phone = phone[0];
    const site = rest.map(([c]) => (/^https?:\/\//i.test(c) ? cleanSite(c) : '')).find(Boolean); if (site) o.website = site;
    const after = rev ? rest.filter(([, i]) => i > rev[1]) : rest;
    const cat = after.find(([c]) => c && c.length < 60 && !/^[·.\-⋅\s]+$/.test(c) && !/\d/.test(c) && !/^https?:/i.test(c) && !/^(open|closed|opens|closes)\b/i.test(c) && !/^(website|directions)$/i.test(c));
    if (cat) o.category = cat[0];
    const addr = rest.find(([c]) => /^\d+\s+\S/.test(c) && !PHONE.test(c) && !/\bhours?\b/i.test(c) && !/^\d+(\.\d)?$/.test(c));
    if (addr) o.address = addr[0];
    if (state) o.state = state.toUpperCase();
    return o;
  }).filter(Boolean);
}

// Duplicates inside one file: same phone, same website, or same name at the same address or place. The first row wins and keeps any detail the later ones add.
import { dupKeys } from './leadintel.js';
export function dedupeRows(rows) {
  const seen = new Map();
  const out = [];
  let removed = 0;
  for (const r of rows) {
    const keys = dupKeys({ ...r, city: r.city || '', zip: r.zip || r.address || '' });
    const hit = keys.map((k) => seen.get(k)).find(Boolean);
    if (hit) {
      for (const [k, v] of Object.entries(r)) if (v && !hit[k]) hit[k] = v;
      for (const k of keys) if (!seen.has(k)) seen.set(k, hit);
      removed++;
      continue;
    }
    for (const k of keys) seen.set(k, r);
    out.push(r);
  }
  return { rows: out, removed };
}
