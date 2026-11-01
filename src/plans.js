// Package definitions: what each plan includes every month, and the one-time setup checklist.
// Monthly items become tasks for that client each month (the task engine).

export const PLANS = {
  starter: {
    name: 'Starter', price: 597, setup: 397, meetingMinutes: 30, keywords: 10,
    monthly: [
      ['post', 'Google profile post', 4],
      ['onpage', 'On-page fix on the website', 1],
      ['reviews', 'Check new reviews', 1],
      ['report', 'Monthly ranking report', 1],
      ['meeting', 'Monthly results meeting (30 min)', 1],
    ],
  },
  growth: {
    name: 'Growth', price: 997, setup: 997, meetingMinutes: 45, keywords: 20,
    monthly: [
      ['post', 'Google profile post', 4],
      ['photos', 'Upload new photos to the Google profile', 1],
      ['replies', 'Reply to every new review', 1],
      ['qa', 'Check and answer Google Q&A', 1],
      ['page', 'New local service or city page', 2],
      ['link', 'Local link or citation (target 3 to 5)', 3],
      ['onpage', 'On-page fix on the website', 1],
      ['competitors', 'Competitor tracking update', 1],
      ['report', 'Monthly ranking report', 1],
      ['meeting', 'Monthly review and plan (45 min)', 1],
    ],
  },
  authority: {
    name: 'Authority', price: 1497, setup: 997, meetingMinutes: 60, keywords: 30,
    monthly: [
      ['post', 'Google profile post', 4],
      ['photos', 'Upload new photos to the Google profile', 1],
      ['replies', 'Reply to every new review', 1],
      ['qa', 'Check and answer Google Q&A', 1],
      ['content', 'Content piece (page or article)', 4],
      ['technical', 'Schema and technical fixes', 1],
      ['link', 'Link or citation (target 5 to 8)', 5],
      ['onpage', 'On-page fix on the website', 1],
      ['competitors', 'Competitor tracking update', 1],
      ['calls', 'Call tracking and lead report', 1],
      ['monitor', 'Review monitoring check', 1],
      ['report', 'Monthly ranking report', 1],
      ['meeting', 'Monthly strategy call (60 min)', 1],
    ],
  },
  leader: {
    name: 'Market Leader', price: 2497, setup: 1497, meetingMinutes: 60, keywords: 50,
    monthly: [
      ['post', 'Google profile post (each location)', 4],
      ['photos', 'Upload new photos to each Google profile', 1],
      ['replies', 'Reply to every new review', 1],
      ['qa', 'Check and answer Google Q&A', 1],
      ['content', 'Content piece (page or article)', 6],
      ['technical', 'Schema and technical fixes', 1],
      ['link', 'Link or citation (target 8 to 12)', 8],
      ['onpage', 'On-page fix on the website', 1],
      ['competitors', 'Competitor tracking update', 1],
      ['calls', 'Call tracking and lead report', 1],
      ['monitor', 'Review monitoring check', 1],
      ['reputation', 'Reputation report', 1],
      ['report', 'Monthly ranking report (each location)', 1],
      ['meeting', 'Monthly strategy call (60 min)', 1],
    ],
    quarterly: [['planning', 'Quarterly planning session', 1]],
  },
};

const SETUP_COMMON = [
  ['setup', 'Accept access invites with hello@rightwaygrowth.com (Google profile, website, Analytics, Search Console)'],
  ['setup', 'Kickoff call done and Client Profile filled in'],
  ['setup', 'Baseline map scan saved for the main keyword'],
  ['setup', 'Keyword list set for the plan'],
  ['setup', 'Citation scan: list every wrong name, address, or phone'],
  ['setup', 'Google profile: categories, services, service area, description, hours, attributes'],
  ['setup', 'Upload the best photos to the Google profile'],
  ['setup', 'Review link and QR code sent to the client'],
  ['setup', 'Fix flagged citations, starting with Apple Maps, Bing, Yelp, Facebook, BBB'],
  ['setup', 'First on-page fix (main service and city in title and heading, click-to-call on mobile)'],
  ['setup', 'First results meeting booked'],
];
const SETUP_EXTRA = {
  growth: [['setup', 'Local page plan approved by the client'], ['setup', 'Review request system set up and tested']],
  authority: [['setup', 'Local page plan approved by the client'], ['setup', 'Review request system set up and tested'],
    ['setup', 'Technical website audit'], ['setup', 'Call tracking number set up and forwarding'], ['setup', 'Schema markup added']],
  leader: [['setup', 'Local page plan approved by the client'], ['setup', 'Review request system set up and tested'],
    ['setup', 'Technical website audit'], ['setup', 'Call tracking numbers set up for each location'], ['setup', 'Schema markup added'],
    ['setup', 'Every location added with its own keywords and baseline scan']],
};

export function planOf(id) {
  return PLANS[id] || PLANS.growth;
}

function monthsBetween(startIso, month) {
  if (!startIso) return null;
  const [sy, sm] = startIso.slice(0, 7).split('-').map(Number);
  const [y, m] = month.split('-').map(Number);
  return (y - sy) * 12 + (m - sm);
}

// Tasks for one client for one month. Setup tasks are added in the client's first month.
export function tasksForMonth(client, month) {
  const plan = planOf(client.plan);
  const out = [];
  const since = monthsBetween(client.start_date, month);
  if (since === 0 || (since == null && !client.has_setup)) {
    for (const [kind, title] of [...SETUP_COMMON, ...(SETUP_EXTRA[client.plan] || [])]) out.push({ kind, title });
  }
  for (const [kind, title, n] of plan.monthly) {
    for (let i = 1; i <= n; i++) out.push({ kind, title: n > 1 ? `${title} (${i} of ${n})` : title });
  }
  if (plan.quarterly && since != null && since % 3 === 0) {
    for (const [kind, title] of plan.quarterly) out.push({ kind, title });
  }
  return out;
}

export function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
