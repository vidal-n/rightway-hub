// The internal plan guide. Pure (Worker, Hub, presentation and Node tests share it).
// This is the chart V prices from: four plans, a monthly price each, and what each one covers. It tells the closer WHERE TO START a price
// so we never over or undercharge. It is a reference only:
//  - the client never sees these prices, the plan list or any comparison between plans;
//  - the slide shows the plan name very small, nothing else;
//  - the price a client pays is always the custom number the closer types.
// The Starter plan is the entry (loss leader). Everything above it, and the services sold separately, are the upsell after results.
import { cleanScope } from './scope.js';

export const PLAN_KEYS = ['starter', 'growth', 'authority', 'leader'];

const GBP = (posts, photos, extra = '') => ({ key: 'gbp', label: 'Google Business Profile management', detail: `${posts} posts and ${photos} photo uploads a month${extra}` });
const YELP = (n) => ({ key: 'yelp', label: 'Yelp profile management', detail: `${n} posts a month` });
const CLEAN = { key: 'cleanup', label: 'Citation cleanup and listings', detail: 'Main aggregators' };
const REVIEWS = { key: 'reviews', label: 'Review requests', detail: '' };
const SOCIAL = (n) => ({ key: 'social', label: 'Social media management', detail: `${n} posts a month` });
const REPORTING = { key: 'reporting', label: 'Reporting', detail: '' };
const LINKS = { key: 'links', label: 'Citation building and linking', detail: '' };
const SCHEMA = { key: 'schema', label: 'Schema markup', detail: '' };
const SITE = { key: 'site', label: 'Website management', detail: '' };
const OVERHAUL = { key: 'overhaul', label: 'Website overhaul', detail: '' };

export const PLAN_REF = {
  starter: { key: 'starter', name: 'Starter', monthly: 399, tagline: 'The foundation', items: [GBP(4, 20), YELP(4), CLEAN, REVIEWS] },
  growth: { key: 'growth', name: 'Growth', monthly: 549, tagline: 'See what is working', items: [GBP(6, 30), YELP(6), CLEAN, REVIEWS, SOCIAL(12), REPORTING] },
  authority: { key: 'authority', name: 'Authority', monthly: 749, tagline: 'Rank higher, look sharper', items: [GBP(8, 40, ', plus Q&A and review replies'), YELP(8), CLEAN, REVIEWS, SOCIAL(16), REPORTING, LINKS, SCHEMA, SITE] },
  leader: { key: 'leader', name: 'Market Leader', monthly: 998, tagline: 'The complete package', items: [GBP(12, 50, ', plus monthly profile audit'), YELP(12), CLEAN, REVIEWS, SOCIAL(20), REPORTING, LINKS, SCHEMA, SITE, OVERHAUL] },
};

// On every plan. These are part of the service, not priced on their own.
export const INCLUDED_ALL = [
  { id: 'competitor_analysis', name: 'Competitor analysis', what: 'Who is getting the calls above you and exactly why, kept up to date so you always know what it takes to pass them.' },
  { id: 'branding_call', name: 'Monthly branding call', what: 'A call every month with your manager to go over your map, what moved, and what comes next.' },
  { id: 'hub_app', name: 'Your Rightway app', what: 'Your rankings, every task we do, your reviews and a direct line to your manager, all in one place.' },
];

// The photo uploads that go with a number of Google posts a month (the chart: 4 posts = 20 photos, 6 = 30, 8 = 40, 12 = 50).
export const photosFor = (posts) => { const n = Number(posts) || 0; return n <= 4 ? 20 : n <= 6 ? 30 : n <= 8 ? 40 : 50; };

const planAt = (i) => PLAN_REF[PLAN_KEYS[Math.max(0, Math.min(PLAN_KEYS.length - 1, i))]];

// Which plan a researched scope sits closest to, and what pushed it there. services = [{ id, qty }].
// Drivers, in the chart's own terms: Google posts a month, then the work only the higher plans carry.
export function refFor(services = []) {
  const sc = cleanScope(services);
  const by = Object.fromEntries(sc.map((s) => [s.id, s.qty]));
  let level = 0;
  const why = [];
  const bump = (to, text) => { if (to > level) { level = to; why.length = 0; } if (to === level && text) why.push(text); };
  if (by.posts != null) { const to = by.posts <= 4 ? 0 : by.posts <= 6 ? 1 : by.posts <= 8 ? 2 : 3; bump(to, `${by.posts} Google posts and ${photosFor(by.posts)} photo uploads a month`); }
  if (by.competitors != null) bump(1, 'competitor tracking every month');
  if (by.pages != null) bump(1, `${by.pages} new service or city pages a month`);
  if (by.links != null) bump(2, `${by.links} local links and listings a month (citation building and linking)`);
  if (by.onpage != null && by.onpage >= 2) bump(2, `${by.onpage} website fixes a month with schema markup`);
  if (by.content != null) bump(2, `${by.content} content pieces a month`);
  if (by.tracking != null) bump(2, 'call tracking and lead report');
  if (by.reputation != null) bump(2, 'review monitoring and reputation report');
  if (by.locations != null) bump(3, 'more than one location or service area');
  const cur = planAt(level);
  const next = level < PLAN_KEYS.length - 1 ? planAt(level + 1) : null;
  return { key: cur.key, name: cur.name, monthly: cur.monthly, why, entry: PLAN_REF.starter, next, adds: next ? adds(cur, next) : [], items: cur.items };
}

// What the next plan carries that this one does not (a bigger amount counts too).
export function adds(from, to) {
  const have = Object.fromEntries(from.items.map((i) => [i.key, i.detail]));
  return to.items.filter((i) => !(i.key in have) || have[i.key] !== i.detail).map((i) => `${i.label}${i.detail ? `: ${i.detail}` : ''}`);
}

export const itemLine = (i) => `${i.label}${i.detail ? ` (${i.detail})` : ''}`;
export const refMoney = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

// Sold separately, after the foundation shows results. Local SEO comes first, so none of these are pitched on the first call.
export const UPSELL_AFTER = ['Website build or rebuild', 'Website SEO', 'Google Ads', 'Meta ads (Facebook and Instagram)', 'More social media', 'More content and local pages'];

// The closer's guide as plain lines, for the presenter notes and the lead panel.
export function refLines(services = []) {
  const r = refFor(services);
  const out = [
    `Start your price near ${refMoney(r.monthly)} a month (${r.name} on the plan guide). The buildout is yours to type.`,
    r.why.length ? `What puts this scope there: ${r.why.join('; ')}.` : 'Nothing in this scope pushes it above the entry plan.',
    r.key === 'starter' ? '' : `Entry plan if they push back (the loss leader): ${r.entry.name} at ${refMoney(r.entry.monthly)} a month, the foundation only.`,
    r.next ? `Upsell after results: ${r.next.name} at ${refMoney(r.next.monthly)} a month adds ${r.adds.join('; ')}.` : 'This is the top plan. Upsell after results is the separate services below.',
    `Also sold separately once they ask what is next: ${UPSELL_AFTER.join(', ')}.`,
    'Internal only. The client sees the services and the one custom price you type, never this guide.',
  ];
  return out.filter(Boolean);
}
