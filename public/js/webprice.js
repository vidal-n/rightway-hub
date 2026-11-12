// The website model. Pure (Worker, Hub, presentation and Node tests share it). Internal reference for the closer:
// where to START a website price so we never over or undercharge. The price a client pays is always the custom number the closer types.
//
// The model (V, Nov 2026): a low build fee brings more buyers, and the monthly care is the residual.
//  - Build fee at signing. The market floor is $798. Bigger sites price up from there, never far above the market.
//  - $149 a month for hosting and care (we host it, back it up, keep it updated, make small edits).
//  - After 12 months of care the client owns the site. Hosting still has to be paid wherever the site lives.
//  - If they want us to keep managing it, it stays $149 a month.
//  - Local SEO comes first. The website is pitched after results ("what is next"), and it can be bundled with the SEO monthly.
//
// `given` marks the numbers V set himself. The rest are suggested starting points, in between and above his two anchors, to be confirmed.

export const WEB_MIN = 798;
export const CARE_MONTHLY = 149;
export const OWN_AFTER_MONTHS = 12;

export const WEB_TIERS = [
  { id: 'launch', label: '1 to 3 pages', pages: [1, 3], build: 798, care: 149, given: { build: true, care: false }, note: 'The market floor. Home, services, contact.' },
  { id: 'small', label: '4 to 6 pages', pages: [4, 6], build: 1288, care: 149, given: { build: false, care: false }, note: 'Between the floor and the 7 to 10 page price.' },
  { id: 'business', label: '7 to 10 pages', pages: [7, 10], build: 1788, care: 149, given: { build: true, care: true }, note: 'The standard business site: a page for each main service and city.' },
  { id: 'large', label: '11 to 15 pages', pages: [11, 15], build: 2388, care: 149, given: { build: false, care: false }, note: 'More services or cities. Still priced near the market.' },
];
export const WEB_CUSTOM = 'More than 15 pages or custom features: type your own price, starting above the 11 to 15 page price.';

export const webTierFor = (pages) => {
  const n = Math.max(1, Math.round(Number(pages) || 1));
  return WEB_TIERS.find((t) => n >= t.pages[0] && n <= t.pages[1]) || (n > 15 ? null : WEB_TIERS[0]);
};
export const webTierById = (id) => WEB_TIERS.find((t) => t.id === id) || null;
export const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

// What one website is worth to us over time. months = how long they stay on care.
export function webValue(build, care = CARE_MONTHLY, months = 12) {
  const b = Number(build) || 0, c = Number(care) || 0, m = Math.max(0, Math.round(Number(months) || 0));
  return { build: b, care: c, months: m, careTotal: c * m, total: b + c * m, yearOne: b + c * 12, residualYear: c * 12 };
}

// Bundle: the SEO monthly plus website care (and where it fits, social posts) as one monthly number. No discount is built in; the closer types the price.
export function bundleFor(seoMonthly, care = CARE_MONTHLY) {
  const s = Number(seoMonthly) || 0, c = Number(care) || 0;
  return { seo: s, care: c, monthly: s + c, annual: (s + c) * 12 };
}

// The social average that goes with each plan in the chart, as a starting point where social fits the business.
export const SOCIAL_AVG = { starter: 0, growth: 12, authority: 16, leader: 20 };
export const YELP_AVG = { starter: 4, growth: 6, authority: 8, leader: 12 };

// Residual projection: websites sold each month, how many keep care, and SEO clients, month by month.
// Returns one row per month with the monthly recurring revenue at the end of that month, plus the build fees collected that month.
export function projection({ sitesPerMonth = 2, build = 1788, care = CARE_MONTHLY, careRate = 1, seoNew = 2, seoMonthly = 0, churn = 0, months = 12 } = {}) {
  const rows = [];
  let careClients = 0, seoClients = 0, cumulative = 0;
  for (let m = 1; m <= months; m++) {
    careClients = careClients * (1 - churn) + sitesPerMonth * careRate;
    seoClients = seoClients * (1 - churn) + seoNew;
    const builds = sitesPerMonth * build;
    const mrr = careClients * care + seoClients * seoMonthly;
    cumulative += builds + mrr;
    rows.push({ month: m, careClients, seoClients, builds, mrr, cumulative });
  }
  return rows;
}

// The closer's lines for a website of this many pages. Internal only.
export function webLines(pages = 8) {
  const t = webTierFor(pages);
  const v = webValue(t ? t.build : 0);
  const out = [];
  if (t) {
    out.push(`Website start price for ${t.label}: ${money(t.build)} to build and ${money(t.care)} a month for hosting and care.`);
    out.push(`Year one is ${money(v.yearOne)} (${money(t.build)} + 12 x ${money(t.care)}). Every month after that the ${money(t.care)} keeps coming.`);
    if (!(t.given.build && t.given.care)) out.push('Part of this price is a suggested starting point, not one of V\'s own numbers. Confirm it before you quote it.');
  } else out.push(WEB_CUSTOM);
  out.push(`The floor is ${money(WEB_MIN)}. Never go under it. Keep the build near the market so more buyers say yes, and let the monthly care be the residual.`);
  out.push(`Ownership: after ${OWN_AFTER_MONTHS} months of care they own the site. They still pay for hosting wherever it lives, and if they want us to keep managing it, it stays ${money(CARE_MONTHLY)} a month.`);
  out.push('Pitch the website after the local SEO shows results. Offer it as the next step, or bundle it into the SEO monthly.');
  return out;
}

// The ownership and hosting words, one place for the agreement, the scope lines and the guide.
export const OWNERSHIP_TEXT = `After ${OWN_AFTER_MONTHS} months of paid hosting and care, Client owns the website and Company hands over the site files and access on request. Hosting must stay paid wherever the site lives. If Client wants Company to keep managing the site, that continues month to month at the monthly care fee.`;
