// The services we offer (in the client's words), shared by the Worker (work orders) and the presentation.
// There are no packages: public/js/scope.js turns a chosen set of these services into a client's monthly work.

// Services the client sees. core = always part of the work; fixes = problem keys from findProblems.
// min = the workload tier the service needs (internal only: it picks tabs and guide steps, never a price).
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
