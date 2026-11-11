// What things cost (pure, shared by the Worker, the app and the tests). Dollars. These are list prices and estimates:
// DataForSEO reports the real cost of each search and the Budget tab shows the real totals.
export const PRICES = {
  research_free: { label: 'Lead research, free depth', usd: 0, per: 'lead', note: 'Website, ads and details you type in. No paid call.' },
  research_lite: { label: 'Lead research, lite', usd: 0.003, per: 'lead', note: 'One Google Maps check at the business.' },
  research_standard: { label: 'Lead research, standard', usd: 0.02, per: 'lead', note: '3 x 3 map check from Maps.' },
  research_full: { label: 'Lead research, full', usd: 0.04, per: 'lead', note: '3 x 3 from Local Finder. Used for client onboarding.' },
  finder_view: { label: 'Lead finder (Google Maps)', usd: 0.002, per: 'map search', note: 'OpenStreetMap searches are free.' },
  scan_point: { label: 'Ranking scan (Local Finder)', usd: 0.004, per: 'grid spot', note: 'Reads 20 results at $0.002 per 10. A 7 x 7 grid is 49 spots.' },
  scan_point_maps: { label: 'Ranking scan (Maps)', usd: 0.002, per: 'grid spot', note: '' },
  listing_check: { label: 'Listing check', usd: 0.03, per: 'business', note: '15 directories, one Google search each.' },
  directory_check: { label: 'Directory check', usd: 0.05, per: 'client', note: 'Up to 25 Google searches.' },
  link_prospects: { label: 'Find link prospects', usd: 0.012, per: 'run', note: '6 Google searches.' },
  reviews_pull: { label: 'Google reviews pull', usd: 0.01, per: 'pull', note: 'Newest 100 reviews. An estimate.' },
  phone_lookup: { label: 'Phone type check (Twilio Lookup)', usd: 0.008, per: 'number', note: 'Mobile or landline.' },
  claude_small: { label: 'Claude draft or reply', usd: 0.01, per: 'draft', note: 'Captions, review replies, Ask Claude messages. Cents at most.' },
  claude_page: { label: 'Claude page draft', usd: 0.03, per: 'page', note: 'A full service or city page.' },
  twilio_call: { label: 'Twilio call', usd: 0.014, per: 'minute', note: 'US outbound. Twilio sets the rate.' },
  twilio_text: { label: 'Twilio text', usd: 0.008, per: 'text', note: 'US. Carrier fees can add more.' },
  twilio_number: { label: 'Twilio phone number', usd: 1.15, per: 'month', note: 'Local number. Twilio sets the rate.' },
  free: { label: 'Website read, scrub, site audit, registry lookups, reports', usd: 0, per: '', note: 'No outside bill.' },
};

export function money(n) {
  const v = Number(n) || 0;
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(3)}`;
  if (v < 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(v < 100 ? 2 : 0)}`;
}
// "about $0.02 per lead", or "Free"
export function priceText(id, n = 1) {
  const p = PRICES[id];
  if (!p) return '';
  if (!p.usd) return 'Free';
  return n > 1 ? `about ${money(p.usd * n)} (${money(p.usd)} each)` : `about ${money(p.usd)}${p.per ? ` per ${p.per}` : ''}`;
}
// Dollars for one research depth (the id used by RESEARCH_DEPTHS).
export const researchUsd = (depth) => PRICES[`research_${depth}`]?.usd ?? 0;
