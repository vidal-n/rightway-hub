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
