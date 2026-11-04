// What each plan includes and the standard terms, shared by the Worker (work orders) and the presentation.

export const INCLUDES = {
  starter: ['Google Business Profile optimization', '4 Google Business Profile posts a month', 'One time citation cleanup on the major directories',
    '1 on-page fix a month', 'Review request link and QR code', 'Monthly ranking report', '30 minute monthly results review'],
  growth: ['Everything in Starter', 'Photos, Q&A, and review replies on your profile', '2 new local service or city pages a month',
    '3 to 5 local links or citations a month', 'Automated review requests', 'Competitor tracking', '45 minute monthly review and plan'],
  authority: ['Everything in Growth', '4 content pieces a month', 'Schema markup and technical fixes', 'Call tracking and a monthly lead report',
    '5 to 8 links or citations a month', 'Review monitoring and alerts', '60 minute monthly strategy call'],
  leader: ['Everything in Authority', 'Multiple locations or service areas', '6 content pieces a month', '8 to 12 links or citations a month',
    'Reputation reporting', 'Live results dashboard', '60 minute monthly strategy call plus a quarterly planning session'],
};

export const STANDARD_TERMS = [
  'Six month commitment, then month to month.',
  'Cancel any time with 30 days written notice by email. No cancellation fee and no remaining balance.',
  'Billing is automatic each month by card or bank account through Stripe. The setup fee is billed with the first month.',
  'Setup and monthly fees are non-refundable because work is scheduled and started as each month begins.',
  'No ranking guarantees. Google decides rankings. Rightway Growth commits to doing the work in this plan every month and reporting on it.',
  'You own your Google Business Profile, website content, and accounts. Rightway Growth works as a manager and removes its access if you leave.',
  'Ad spend, website builds, and work outside this plan are not included unless added in writing.',
];

export const PLAN_INFO = {
  starter: { name: 'Starter', price: 399, setup: 399, keywords: 10 },
  growth: { name: 'Growth', price: 449, setup: 449, keywords: 20 },
  authority: { name: 'Authority', price: 499, setup: 499, keywords: 30 },
  leader: { name: 'Market Leader', price: 599, setup: 599, keywords: 50 },
};

// Services the client sees. Plans stay internal (they set the monthly task load); the client only hears what they need.
// min = the smallest internal plan that includes it; core = always part of the work; fixes = problem keys from findProblems.
export const SERVICE_LIST = [
  { id: 'profile', name: 'Google Business Profile buildout', what: 'Categories, services, service areas, hours, photos and description set up the way Google wants them.', min: 'starter', core: true, fixes: ['not_found', 'unclaimed', 'no_hours', 'few_photos'] },
  { id: 'cleanup', name: 'Listing cleanup everywhere', what: 'Your name, address and phone made to match on Apple Maps, Bing, Yelp, Facebook, the BBB and the directories Google checks.', min: 'starter', core: true, fixes: ['grid_weak', 'not_top10'] },
  { id: 'posts', name: 'Weekly Google posts and fresh photos', what: 'Keeps your profile active, which Google watches.', min: 'starter', core: true, fixes: ['few_photos'] },
  { id: 'reviews', name: 'Review growth system', what: 'Your review link and counter QR code, a simple way to ask after every job, and every review answered.', min: 'starter', core: true, fixes: ['review_gap', 'few_reviews', 'low_rating'] },
  { id: 'onpage', name: 'Website fixes for Google', what: 'Titles with your service and city, tap to call, speed, a secure site and the code that ties your site to your profile.', min: 'starter', core: true, fixes: ['no_website', 'no_https', 'weak_title', 'no_schema', 'no_click_to_call', 'site_down', 'slow_site'] },
  { id: 'pages', name: 'Service and city pages', what: 'A page for each service and city you want to show up in, so Google has a reason to show you farther out.', min: 'growth', fixes: ['grid_weak', 'not_top10'] },
  { id: 'links', name: 'Local links every month', what: 'Trusted local sites pointing to you: chambers, associations, local lists.', min: 'growth', fixes: ['not_top10', 'not_top3', 'grid_weak'] },
  { id: 'competitors', name: 'Competitor tracking', what: 'We watch who is above you and what they do, so we know exactly what it takes to pass them.', min: 'growth', fixes: ['not_top3', 'review_gap'] },
  { id: 'content', name: 'Content every month', what: 'Articles that answer what your customers search before they call.', min: 'authority', fixes: ['not_top3'] },
  { id: 'tracking', name: 'Call tracking and lead report', what: 'A tracking number so you see every call Google sends you, answered and missed.', min: 'authority', fixes: [] },
  { id: 'reputation', name: 'Reputation monitoring', what: 'Every new review watched, bad ones flagged the same day, and what customers say about you each month.', min: 'authority', fixes: ['low_rating'] },
  { id: 'locations', name: 'Every location and service area covered', what: 'Each location gets its own profile work, scans and reports.', min: 'leader', fixes: [] },
  { id: 'report', name: 'Monthly map scan, report and meeting', what: 'A new map every month so you see exactly where you are climbing toward the top 10, plus a short meeting on what is next.', min: 'starter', core: true, fixes: [] },
];
export const PLAN_ORDER = ['starter', 'growth', 'authority', 'leader'];
