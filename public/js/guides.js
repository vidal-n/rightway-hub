// Fulfillment playbook: a step-by-step guide for every kind of monthly task, when each task is due, what proof closes it,
// and which client access it needs. Pure, shared by the Worker (defaults, proof rules) and the browser (task panel).
// Owners can edit any guide in the Hub; their version is stored in the guides table and wins over these defaults.

// proof: 'link' (live URL), 'screenshot' (image), 'either' (link or image), 'note' (written note), 'none' (closes on its own or by hand).
// due: day of the month, or 'spread' to spread repeat tasks (like 4 posts) across the month.
export const DEFAULT_GUIDES = {
  post: {
    title: 'Google profile post', minutes: 15, proof: 'either', due: 'spread', access: ['gbp'],
    need: ['Manager access to their Google profile', 'An approved post in the Posts tab (photo and caption)'],
    steps: [
      'Open the client\'s Posts tab and pick the oldest approved post. If there is none, make one from their photos (Onboarding uploads) or ask them to send a job photo.',
      'If the Google profile is connected (Google profile tab), click Publish to Google on the post and skip to the last step.',
      'Otherwise: download the photo and copy the Google caption.',
      'Log in as hello@rightwaygrowth.com, open business.google.com, pick the client, and click Add update.',
      'Add the photo, paste the caption, and set the button to Call now (or Learn more with their service page).',
      'Publish. Open the post on Google, click Share, copy the link (or take a screenshot).',
      'Click Mark posted on the post, then attach the link or screenshot here and close the task.',
    ],
    done: 'The post is live on the Google profile and the link or screenshot is attached.',
  },
  photos: {
    title: 'Upload new photos to the Google profile', minutes: 15, proof: 'screenshot', due: 10, access: ['gbp'],
    need: ['Manager access to their Google profile', '5 to 10 real photos from the client (jobs, team, trucks, storefront)'],
    steps: [
      'Use photos from the client\'s Onboarding uploads or ask them for new job photos. Real photos only, no stock images.',
      'If the profile is connected, use Upload to Google in the Google profile tab.',
      'Otherwise open business.google.com, pick the client, Add photo, and upload 5 to 10 photos.',
      'Take a screenshot of the Photos section showing the new uploads and attach it here.',
    ],
    done: 'New photos are on the profile and a screenshot is attached.',
  },
  replies: {
    title: 'Reply to every new review', minutes: 20, proof: 'screenshot', due: 20, access: ['gbp'],
    need: ['Manager access to their Google profile'],
    steps: [
      'Open the Google profile tab (connected) or the Reputation tab to see reviews without a reply.',
      'Reply to each one. Thank them by first name, mention the service and the city naturally, and keep it short.',
      'For 1 to 3 stars: apologize, do not argue, and invite them to call the owner directly. Tell the client the same day.',
      'Never offer anything in exchange for reviews or changes to reviews.',
      'Attach a screenshot of the replied reviews (or note "no new reviews this month" and close).',
    ],
    done: 'Every review from this month has a reply.',
  },
  qa: {
    title: 'Check and answer Google Q&A', minutes: 10, proof: 'note', due: 20, access: ['gbp'],
    need: ['Manager access to their Google profile'],
    steps: [
      'Search the business on Google Maps and look for the Questions section on the profile.',
      'Answer any new question from the business account. Short and factual.',
      'If Google no longer shows Q&A on this profile, add the common customer questions to the website FAQ instead.',
      'Write what you did in the note and close.',
    ],
    done: 'New questions are answered, or the FAQ is updated. Note says which.',
  },
  page: {
    title: 'New local service or city page', minutes: 90, proof: 'link', due: 'spread', access: ['website'],
    need: ['Website login (WordPress connected in the Content tab)', 'Client facts: services, cities, prices or ranges, guarantees'],
    steps: [
      'Open the Content tab and pick the top idea (it is ranked by where the scans are weakest). Make the brief.',
      'Write the draft (Claude drafts when the key is set). Fill every [bracket] with real facts from the client. No invented reviews, prices or licenses.',
      'Edit for the reader: what the service is, the area served, why them, the price range, FAQ, and a clear call button.',
      'Send it to the client to approve in their app.',
      'When approved, publish to WordPress from the Content tab (or paste the HTML and click Mark live).',
      'Link to the new page from the home page or the services page.',
      'Attach the live link here.',
    ],
    done: 'The page is live on their site, linked from another page, and the link is attached.',
  },
  content: {
    title: 'Content piece (page or article)', minutes: 90, proof: 'link', due: 'spread', access: ['website'],
    need: ['Website login (WordPress connected in the Content tab)', 'Client facts for the topic'],
    steps: [
      'Open the Content tab and pick the top idea: service page, city page, or a cost or "signs you need" article.',
      'Make the brief and the draft. Fill every [bracket] with real facts. No invented numbers.',
      'Edit, send to the client to approve, then publish to WordPress (or Mark live).',
      'Add one link to it from an existing page.',
      'Attach the live link here.',
    ],
    done: 'The piece is live and the link is attached.',
  },
  link: {
    title: 'Local link or citation', minutes: 30, proof: 'link', due: 'spread', access: [],
    need: ['The business details block (name, address, phone, website, hours, description)', 'An email inbox for sign ups (hello@rightwaygrowth.com)'],
    steps: [
      'Open the Citations tab. Start with directories marked Not listed or Mismatch, highest value first.',
      'Sign up or claim the listing. Copy the business details exactly as the Hub shows them (same name, address and phone everywhere).',
      'For links instead of listings: use Find prospects (chamber, trade group, sponsorships, local "best of" lists) and reach out. Never pay for links or use link networks.',
      'Log it in the link log as Submitted. When it goes live, add the live URL and set it to Live (that also checks off a link task).',
      'Attach the live link here.',
    ],
    done: 'A new listing or link is live and its URL is attached.',
  },
  onpage: {
    title: 'On-page fix on the website', minutes: 30, proof: 'link', due: 15, access: ['website'],
    need: ['Website login (WordPress editor or admin)', 'The latest Site audit'],
    steps: [
      'Open the Site audit tab. Pick the most serious open issue on a page that makes money (home page, main service page).',
      'Fix it in WordPress: titles and descriptions in Rank Math or Yoast, headings and alt text in the page editor, phone as a click to call link.',
      'Log the fix in the Site audit tab with before and after. The next crawl marks it verified.',
      'Attach the page link here.',
    ],
    done: 'The fix is live, logged with before and after, and the page link is attached.',
  },
  technical: {
    title: 'Schema and technical fixes', minutes: 45, proof: 'either', due: 15, access: ['website'],
    need: ['Website login', 'Search Console access helps'],
    steps: [
      'In the Site audit tab, copy the LocalBusiness schema and add it to the home page (Rank Math schema, or a header code plugin).',
      'Test it at search.google.com/test/rich-results and fix any errors.',
      'Fix broken pages and redirect chains from the audit. Make sure http goes to https.',
      'Submit the sitemap in Search Console if it is not there yet.',
      'Log each fix in the Site audit tab. Attach the test result link or a screenshot.',
    ],
    done: 'Schema passes the test, technical issues are fixed and logged.',
  },
  competitors: {
    title: 'Competitor tracking update', minutes: 15, proof: 'note', due: 25, access: [],
    need: ['This month\'s ranking scan'],
    steps: [
      'Open the Rankings tab and look at "Who holds the top 10" for the main keyword.',
      'Note who moved up or down since last month, and how their reviews compare to the client\'s.',
      'Write one line on what changed and one action for next month in the note.',
    ],
    done: 'The note says who moved and what we do about it.',
  },
  calls: {
    title: 'Call tracking and lead report', minutes: 10, proof: 'none', due: 28, access: ['tracking'],
    need: ['A tracking number on the client (Calls tab)'],
    steps: [
      'Open the Calls tab. Check missed calls and voicemails, and tell the client about any they did not call back.',
      'This task checks itself off when the monthly report is sent (the report includes the calls).',
    ],
    done: 'Closes when the report with calls is sent.',
  },
  monitor: {
    title: 'Review monitoring check', minutes: 10, proof: 'note', due: 14, access: [],
    need: [],
    steps: [
      'Open the Reputation tab and refresh the reviews (or the Google profile tab if connected).',
      'Flag any new 1 to 3 star review to the client and make sure it gets a reply.',
      'Write what you found in the note.',
    ],
    done: 'New reviews are checked and bad ones are flagged.',
  },
  reputation: {
    title: 'Reputation report', minutes: 10, proof: 'none', due: 26, access: [],
    need: [],
    steps: [
      'Refresh the reviews in the Reputation tab a few days before the report goes out, so the report has the latest numbers.',
      'Check off this task once the refresh is done.',
    ],
    done: 'Reviews are refreshed before the report.',
  },
  reviews: {
    title: 'Check new reviews', minutes: 10, proof: 'note', due: 20, access: ['gbp'],
    need: ['Manager access to their Google profile'],
    steps: [
      'Look at new reviews on the Google profile (or the Reputation tab).',
      'Reply to any new ones and flag bad ones to the client.',
      'Write what you found in the note.',
    ],
    done: 'New reviews are checked and replied to.',
  },
  report: {
    title: 'Monthly ranking report', minutes: 10, proof: 'none', due: 28, access: [],
    need: [],
    steps: [
      'Automatic: the report is made when the monthly scans finish (or click Make in the Reports tab).',
      'Read it once, add a short note for the client, then Send. Sending checks off this task.',
    ],
    done: 'Closes when the report is sent.',
  },
  meeting: {
    title: 'Monthly results meeting', minutes: 45, proof: 'none', due: 25, access: [],
    need: ['The latest report', 'Google connected for the Meet link'],
    steps: [
      'Book it from the Meetings tab. The client gets a calendar invite with a Google Meet link.',
      'Before the call: open the report and the Rankings tab. The agenda fills in from their numbers.',
      'On the call: wins, where they stand in the top 10, what we did, what is next, and what we need from them.',
      'After: write the notes and a short summary for the client, then click Mark held. That checks off this task.',
    ],
    done: 'Closes when the meeting is marked held with notes.',
  },
  yelp: {
    title: 'Yelp page post', minutes: 15, proof: 'either', due: 'spread', access: ['yelp'],
    need: ['Business owner login for their Yelp page (or an invite to manage it)', 'A real photo and a short update from the client'],
    steps: [
      'Open the client\'s Yelp business page from biz.yelp.com. Check the name, address, phone, hours and website match the Hub\'s business details block exactly.',
      'Pick a real photo from their uploads and write a short update: a job, a service, a seasonal tip. No offers that break Yelp rules, and never ask for or pay for reviews.',
      'Add the update (Yelp calls these posts or updates) and add the photo.',
      'Open the page on Yelp and copy the link, or take a screenshot of the new post.',
      'Attach the link or screenshot here and close the task.',
    ],
    done: 'The Yelp post is live and the link or screenshot is attached.',
  },
  social: {
    title: 'Facebook and Instagram post', minutes: 15, proof: 'either', due: 'spread', access: ['social'],
    need: ['Access to their Facebook Page and Instagram (Facebook connect link, or a team login)', 'An approved post: the Social tab has captions and hashtags ready'],
    steps: [
      'Open My work, Posts to publish, or the client\'s Social tab. Pick the next post that is verified.',
      'Check the photo and the caption for each channel. Fix anything that is wrong or not true. Only real jobs, real reviews and real facts.',
      'Copy the caption, post it on Facebook and Instagram at the time shown, and add the first comment if there is one.',
      'Back in the Social tab, tap Mark posted and add the links.',
      'Attach the link or a screenshot here and close the task.',
    ],
    done: 'The post is live on the client\'s pages and marked posted with a link or screenshot.',
  },
  webcare: {
    title: 'Website hosting and care check', minutes: 30, proof: 'note', due: 12, access: ['website'],
    need: ['Website login', 'Hosting login'],
    steps: [
      'Open the site and check it loads fast on a phone. Check the contact form sends and the tap to call link works.',
      'In the hosting panel or WordPress: confirm the backup ran, update the core, theme and plugins, and check for security warnings.',
      'Make the small edits the client asked for this month (text, photos, hours, a new staff member).',
      'Check Search Console for new errors on the site.',
      'Write what you did in the note and close.',
    ],
    done: 'Backups, updates and the client\'s small edits are done. Note says what changed.',
  },
  planning: {
    title: 'Quarterly planning session', minutes: 60, proof: 'none', due: 20, access: [],
    need: ['Three months of scans and reports'],
    steps: [
      'Open the Quarterly plan tab and click Draft. Edit the goals, focus and monthly actions.',
      'Review it with the client on the call, then click Share. Sharing checks off this task.',
    ],
    done: 'Closes when the plan is shared with the client.',
  },
  setup: {
    title: 'Setup', minutes: 30, proof: 'none', due: 10, access: [],
    need: ['The Onboarding tab'],
    steps: [
      'Do what the task title says. The Onboarding tab has the details: Google profile checklist, citations, review target and the 90 day plan.',
      'Add a note or link when it helps the next person.',
    ],
    done: 'The setup item is done.',
  },
  custom: {
    title: 'Other task', minutes: 20, proof: 'none', due: 20, access: [],
    need: [],
    steps: ['Do what the task title says. Add a note or link when it helps.'],
    done: 'Done as described.',
  },
};

export const PROOF_LABEL = { link: 'Live link', screenshot: 'Screenshot', either: 'Live link or screenshot', note: 'Written note', none: 'No proof needed' };

// The saved guide wins, field by field, over the default.
export function guideFor(kind, saved = {}) {
  const base = DEFAULT_GUIDES[kind] || DEFAULT_GUIDES.custom;
  const s = saved[kind] || {};
  const pick = (k) => (s[k] != null && s[k] !== '' && !(Array.isArray(s[k]) && !s[k].length) ? s[k] : base[k]);
  return {
    kind, title: pick('title'), minutes: Number(pick('minutes')) || base.minutes, proof: PROOF_LABEL[s.proof] ? s.proof : base.proof,
    due: base.due, access: base.access, need: pick('need'), steps: pick('steps'), done: pick('done'), edited: Boolean(saved[kind]),
  };
}

// Clean an owner's edit before saving.
export function cleanGuide(b = {}) {
  const lines = (v, max) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((s) => String(s).replace(/^\s*(\d+[.)]|[*-])\s*/, '').trim()).filter(Boolean).slice(0, max).map((s) => s.slice(0, 400));
  const out = {};
  if (b.title != null) out.title = String(b.title).trim().slice(0, 120);
  if (b.minutes != null) out.minutes = Math.min(600, Math.max(1, Math.round(Number(b.minutes) || 0))) || undefined;
  if (b.proof != null && PROOF_LABEL[b.proof]) out.proof = b.proof;
  if (b.need != null) out.need = lines(b.need, 12);
  if (b.steps != null) out.steps = lines(b.steps, 20);
  if (b.done != null) out.done = String(b.done).trim().slice(0, 300);
  return out;
}

// What closes a task. Returns null when it can close, or the reason it cannot.
export function proofMissing(guide, task) {
  const link = /^https?:\/\/\S+$/i.test(String(task.link || '').trim());
  const shot = Boolean(task.proof_key);
  const note = String(task.note || '').trim().length >= 3;
  switch (guide.proof) {
    case 'link': return link ? null : 'Add the live link before closing this task.';
    case 'screenshot': return shot || link ? null : 'Attach a screenshot before closing this task.';
    case 'either': return link || shot ? null : 'Add the live link or a screenshot before closing this task.';
    case 'note': return note || link || shot ? null : 'Write a short note on what you did before closing this task.';
    default: return null;
  }
}

const pad = (n) => String(n).padStart(2, '0');
const daysIn = (month) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

// Due date (YYYY-MM-DD) for task number i (1 based) of n of this kind. Setup tasks in the first month are due 10 days after the start.
export function dueDate(kind, month, i = 1, n = 1, startDate = null) {
  const last = daysIn(month);
  const g = DEFAULT_GUIDES[kind] || DEFAULT_GUIDES.custom;
  let day;
  if (g.due === 'spread') day = Math.round((last * i) / (n + 1)) || 1;
  else day = Math.min(last, Number(g.due) || 20);
  if (kind === 'setup' && startDate && startDate.slice(0, 7) === month) day = Math.min(last, Number(startDate.slice(8, 10)) + 10);
  return `${month}-${pad(Math.max(1, Math.min(last, day)))}`;
}

// ---------- client access checklist ----------
export const ACCESS_ITEMS = [
  { key: 'gbp', label: 'Google profile manager access', plans: ['starter', 'growth', 'authority', 'leader'],
    how: 'The client adds hello@rightwaygrowth.com as a Manager: on their Google profile, open the three dot menu, Business profile settings, People and access (or Managers), Add.' },
  { key: 'website', label: 'Website login', plans: ['starter', 'growth', 'authority', 'leader'],
    how: 'WordPress: an Editor or Administrator user for hello@rightwaygrowth.com, then an application password saved in the Content tab. Other site builders: a team login.' },
  { key: 'domain', label: 'Domain and DNS', plans: ['authority', 'leader'],
    how: 'Delegate access at the registrar (GoDaddy, Namecheap, Cloudflare, Google Domains) so we can verify Search Console and fix redirects.' },
  { key: 'gsc', label: 'Google Search Console', plans: ['growth', 'authority', 'leader'],
    how: 'The client adds hello@rightwaygrowth.com as a Full user (Settings, Users and permissions), or we verify the site with DNS.' },
  { key: 'ga4', label: 'Google Analytics', plans: ['growth', 'authority', 'leader'],
    how: 'The client adds hello@rightwaygrowth.com as a Viewer (Admin, Property access management).' },
  { key: 'tracking', label: 'Call tracking number', plans: ['authority', 'leader'],
    how: 'Buy one in the Calls tab. Put it on the Google profile as the main number with their own line as an additional number.' },
  { key: 'yelp', label: 'Yelp business page', plans: [],
    how: 'Only if we manage their Yelp: the client claims the page at biz.yelp.com and adds hello@rightwaygrowth.com as a manager, or shares the login.' },
  { key: 'social', label: 'Facebook and Instagram', plans: [],
    how: 'Only if we share posts there: the client adds us under Page settings, Page access.' },
];
export const ACCESS_STATUS = { missing: 'Missing', requested: 'Asked for', granted: 'Have it', na: 'Not needed' };

// Combine saved marks with what the Hub can see on its own (WordPress saved, Search Console linked, and so on).
export function accessState(client, rows = [], auto = {}) {
  const saved = new Map(rows.map((r) => [r.item, r]));
  return ACCESS_ITEMS.map((it) => {
    const r = saved.get(it.key);
    const required = it.plans.includes(client.plan);
    let status = r?.status || 'missing';
    const detected = Boolean(auto[it.key]);
    if (detected && status !== 'na') status = 'granted';
    return { key: it.key, label: it.label, how: it.how, required, status, detected, note: r?.note || '', updated_at: r?.updated_at || null };
  });
}

// Required items the team does not have yet.
export function accessGaps(items) {
  return items.filter((i) => i.required && (i.status === 'missing' || i.status === 'requested'));
}

// Access a task kind needs that the client is missing (for the warning on the task).
export function blockedBy(kind, items) {
  const need = (DEFAULT_GUIDES[kind] || DEFAULT_GUIDES.custom).access || [];
  return items.filter((i) => need.includes(i.key) && (i.status === 'missing' || i.status === 'requested'));
}
