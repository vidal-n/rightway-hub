// Scope of work. Pure (no browser or server calls) so the Worker, the Hub and Node tests share it.
// There are no packages. Every client gets a scope built from the research: which services, and how much of each a month.
// The owner types the price. The scope also becomes the client's monthly tasks and an estimate of the delivery hours.
import { SERVICE_LIST, PLAN_ORDER } from './plancopy.js';
import { guideFor } from './guides.js';

// Per service: what a client can get a month (unit, default, min, max) and the tasks it turns into.
// monthly(n) returns [kind, title, count] rows. setup(n) returns one time checklist titles for the first month.
export const SCOPE = {
  profile: { monthly: () => [['qa', 'Check and answer Google Q&A', 1]], setup: () => [] },
  cleanup: { monthly: () => [], setup: () => [] },
  posts: { unit: 'posts a month', def: 4, min: 2, max: 12, monthly: (n) => [['post', 'Google profile post', n], ['photos', 'Upload new photos to the Google profile', 1]], setup: () => [] },
  reviews: { monthly: () => [['replies', 'Reply to every new review', 1]], setup: () => ['Review request system set up and tested'] },
  onpage: {
    unit: 'website fixes a month', def: 1, min: 1, max: 6,
    monthly: (n) => [['onpage', 'On-page fix on the website', n], ...(n >= 2 ? [['technical', 'Schema and technical fixes', 1]] : [])],
    setup: (n) => (n >= 2 ? ['Technical website audit', 'Schema markup added'] : []),
  },
  pages: { unit: 'new pages a month', def: 2, min: 1, max: 8, monthly: (n) => [['page', 'New local service or city page', n]], setup: () => ['Local page plan approved by the client'] },
  links: { unit: 'local links a month', def: 3, min: 1, max: 15, monthly: (n) => [['link', 'Local link or citation', n]], setup: () => [] },
  competitors: { monthly: () => [['competitors', 'Competitor tracking update', 1]], setup: () => [] },
  content: { unit: 'content pieces a month', def: 2, min: 1, max: 10, monthly: (n) => [['content', 'Content piece (page or article)', n]], setup: () => [] },
  tracking: { monthly: () => [['calls', 'Call tracking and lead report', 1]], setup: () => ['Technical website audit', 'Call tracking number set up and forwarding'] },
  reputation: { monthly: () => [['monitor', 'Review monitoring check', 1], ['reputation', 'Reputation report', 1]], setup: () => [] },
  locations: { monthly: () => [], setup: () => ['Every location added with its own keywords and baseline scan'], quarterly: [['planning', 'Quarterly planning session', 1]] },
  report: { monthly: () => [['report', 'Monthly ranking report', 1], ['meeting', 'Monthly results meeting', 1]], setup: () => [] },
};

// Setup every client gets, whatever the scope.
export const SETUP_BASE = [
  'Accept access invites with hello@rightwaygrowth.com (Google profile, website, Analytics, Search Console)',
  'Kickoff call done and Client Profile filled in',
  'Baseline map scan saved for the main keyword',
  'Keyword list set',
  'Citation scan: list every wrong name, address, or phone',
  'Google profile: categories, services, service area, description, hours, attributes',
  'Upload the best photos to the Google profile',
  'Review link and QR code sent to the client',
  'Fix flagged citations, starting with Apple Maps, Bing, Yelp, Facebook, BBB',
  'First on-page fix (main service and city in title and heading, click-to-call on mobile)',
  'First results meeting booked',
];

const byId = Object.fromEntries(SERVICE_LIST.map((s) => [s.id, s]));
export const SERVICE_IDS = SERVICE_LIST.map((s) => s.id);
export const unitOf = (id) => SCOPE[id]?.unit || '';
export const hasQty = (id) => Boolean(SCOPE[id]?.unit);
export function clampQty(id, n) {
  const c = SCOPE[id];
  if (!c?.unit) return 1;
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(c.max, Math.max(c.min, v)) : c.def;
}

// A scope is a list of { id, qty }. Accepts the stored JSON, a list of ids, or a list of objects.
export function cleanScope(raw, qtyMap = null) {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  if (v && !Array.isArray(v) && Array.isArray(v.services)) { qtyMap = qtyMap || v.qty || null; v = v.services; }
  if (!Array.isArray(v)) return [];
  const seen = new Set(), out = [];
  for (const x of v) {
    const id = typeof x === 'string' ? x : x?.id;
    if (!byId[id] || seen.has(id)) continue;
    seen.add(id);
    const q = typeof x === 'object' && x ? x.qty : qtyMap?.[id];
    out.push({ id, qty: q == null || q === '' ? (SCOPE[id].def || 1) : clampQty(id, q) });
  }
  // Keep the catalog order so lists always read the same.
  return out.sort((a, b) => SERVICE_IDS.indexOf(a.id) - SERVICE_IDS.indexOf(b.id));
}

// The internal workload tier a scope needs. Never shown to anyone: it only picks tabs (locations, reputation, quarterly) and guide steps.
export function tierOf(scope) {
  let top = 0;
  for (const s of cleanScope(scope)) {
    const rank = s.id === 'locations' ? PLAN_ORDER.length - 1 : PLAN_ORDER.indexOf(byId[s.id].min);
    if (rank > top) top = rank;
  }
  return PLAN_ORDER[top];
}

// Monthly tasks as [kind, title, count], the report and meeting last.
export function monthlyTasks(scope) {
  const rows = [];
  for (const s of cleanScope(scope)) for (const r of SCOPE[s.id].monthly(s.qty)) rows.push(r);
  const merged = [];
  for (const [kind, title, n] of rows) {
    const have = merged.find((m) => m[0] === kind);
    if (have) have[2] = Math.max(have[2], n); else merged.push([kind, title, n]);
  }
  const last = (k) => (k === 'report' ? 2 : k === 'meeting' ? 3 : 0);
  return merged.sort((a, b) => last(a[0]) - last(b[0]));
}

export function setupTasks(scope) {
  const out = [...SETUP_BASE];
  for (const s of cleanScope(scope)) for (const t of SCOPE[s.id].setup(s.qty)) if (!out.includes(t)) out.push(t);
  return out;
}

export const quarterlyTasks = (scope) => cleanScope(scope).flatMap((s) => SCOPE[s.id].quarterly || []);

// Estimated delivery time from the task guides (owners can change each guide's minutes). meetingMinutes replaces the guide's default.
// rows = [kind, title, count] monthly rows; setupCount = one time checklist items in the first month.
export function effortOf(rows, setupCount = 0, { saved = {}, meetingMinutes = null } = {}) {
  const mins = (kind) => guideFor(kind, saved).minutes;
  let monthly = 0;
  const list = rows.map(([kind, title, n]) => {
    const each = kind === 'meeting' && meetingMinutes ? meetingMinutes : mins(kind);
    monthly += each * n;
    return { kind, title, n, each, minutes: each * n };
  });
  return { monthly, setup: setupCount * mins('setup'), rows: list };
}
export const effort = (scope, opts = {}) => effortOf(monthlyTasks(scope), setupTasks(scope).length, opts);

export const hoursOf = (min) => { const h = min / 60; return h >= 10 ? Math.round(h) : Math.round(h * 10) / 10; };

// Human line for one service in the scope, in client words: "Weekly Google posts and fresh photos (4 a month)".
export function scopeLine(item) {
  const s = byId[item.id];
  if (!s) return '';
  return hasQty(item.id) ? `${s.name} (${item.qty} ${unitOf(item.id).replace(/ a month$/, '')} a month)` : s.name;
}

// The scope that matches an old plan, for clients that were signed before scopes existed.
export function scopeFromPlan(plan, planMonthly = []) {
  const rank = Math.max(0, PLAN_ORDER.indexOf(plan));
  const countOf = (kind) => planMonthly.find((r) => r[0] === kind)?.[2];
  return cleanScope(SERVICE_LIST.filter((s) => s.core || PLAN_ORDER.indexOf(s.min) <= rank).filter((s) => s.id !== 'locations' || plan === 'leader').map((s) => {
    const kind = { posts: 'post', pages: 'page', links: 'link', content: 'content', onpage: 'onpage' }[s.id];
    return { id: s.id, qty: kind ? countOf(kind) || SCOPE[s.id].def : 1 };
  }));
}

// Anything a person types as dollars: '' and null stay blank, bad input is null.
export function dollars(v) {
  if (v == null || v === '') return null;
  const n = Math.round(Number(String(v).replace(/[$,\s]/g, '')) * 100) / 100;
  return Number.isFinite(n) && n >= 0 ? n : null;
}
