// Meta (Facebook and Instagram) connect: pure helpers shared by the Worker, the client page and the Hub.
// The client signs in with Facebook once. Meta then tells us which Pages, linked Instagram accounts and ad accounts they ticked.

export const GRAPH_VERSION = 'v23.0';

// What we ask for, and what each one lets us do, in words a business owner reads on the connect page.
export const PERMISSIONS = [
  { id: 'pages_show_list', why: 'See which Facebook Pages you manage', need: true },
  { id: 'pages_read_engagement', why: 'Read your Page posts and followers for reports', need: true },
  { id: 'pages_manage_posts', why: 'Publish posts to your Facebook Page', need: true },
  { id: 'pages_manage_engagement', why: 'Reply to comments on your Page', need: false },
  { id: 'instagram_basic', why: 'See your linked Instagram account', need: true },
  { id: 'instagram_content_publish', why: 'Publish posts to your Instagram account', need: true },
  { id: 'instagram_manage_insights', why: 'Read Instagram results for reports', need: false },
  { id: 'business_management', why: 'Work inside your Meta Business account', need: false },
  { id: 'ads_management', why: 'Set up and manage ads for you', need: false },
  { id: 'ads_read', why: 'Read ad results for reports', need: false },
];
export const SCOPES = PERMISSIONS.map((p) => p.id);

// Meta answers /me/permissions with [{permission, status: 'granted'|'declined'}]. Returns what was granted and what they unticked.
export function permissionState(rows) {
  const granted = []; const declined = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.permission) continue;
    (r.status === 'granted' ? granted : declined).push(r.permission);
  }
  const missing = PERMISSIONS.filter((p) => !granted.includes(p.id));
  return {
    granted, declined,
    missing: missing.map((p) => p.id),
    missingNeeded: missing.filter((p) => p.need).map((p) => p.id),
    canPost: granted.includes('pages_manage_posts'),
    canPostIg: granted.includes('instagram_content_publish'),
    canAds: granted.includes('ads_management'),
  };
}

export const permissionWhy = (id) => PERMISSIONS.find((p) => p.id === id)?.why || id;

// A Page row from /me/accounts. `tasks` lists what the person can do on that Page.
export function pageCanPost(tasks) {
  const t = Array.isArray(tasks) ? tasks : [];
  return t.includes('CREATE_CONTENT') || t.includes('MANAGE');
}

// Turn Meta's /me/accounts and /me/adaccounts answers into one flat asset list.
export function assetsFrom(pages, adAccounts) {
  const out = [];
  for (const p of Array.isArray(pages) ? pages : []) {
    if (!p?.id) continue;
    out.push({ kind: 'page', ext_id: String(p.id), name: String(p.name || 'Facebook Page'), extra: { category: p.category || null, tasks: Array.isArray(p.tasks) ? p.tasks : [] }, can_post: pageCanPost(p.tasks), has_token: Boolean(p.access_token) });
    const ig = p.instagram_business_account;
    if (ig?.id) out.push({ kind: 'instagram', ext_id: String(ig.id), name: ig.username ? `@${ig.username}` : String(ig.name || 'Instagram'), extra: { page_id: String(p.id), username: ig.username || null }, can_post: pageCanPost(p.tasks), has_token: Boolean(p.access_token) });
  }
  for (const a of Array.isArray(adAccounts) ? adAccounts : []) {
    if (!a?.id) continue;
    out.push({ kind: 'adaccount', ext_id: String(a.id), name: String(a.name || a.account_id || 'Ad account'), extra: { account_id: a.account_id || null, status: a.account_status ?? null, business: a.business?.name || null }, can_post: false, has_token: false });
  }
  return out;
}

export const KIND = { page: 'Facebook Page', instagram: 'Instagram', adaccount: 'Ad account' };

// A short, honest one line summary of what a connection lets us do.
export function connectionLine(assets, perms) {
  const n = (k) => assets.filter((a) => a.kind === k).length;
  const bits = [];
  if (n('page')) bits.push(`${n('page')} Facebook Page${n('page') === 1 ? '' : 's'}`);
  if (n('instagram')) bits.push(`${n('instagram')} Instagram account${n('instagram') === 1 ? '' : 's'}`);
  if (n('adaccount')) bits.push(`${n('adaccount')} ad account${n('adaccount') === 1 ? '' : 's'}`);
  if (!bits.length) return 'Signed in, but no Pages, Instagram or ad accounts were shared.';
  return `${bits.join(', ')} shared${perms && perms.missingNeeded?.length ? `. Missing: ${perms.missingNeeded.map(permissionWhy).join('; ').toLowerCase()}` : ''}.`;
}

// What to tell the client when the connection is thin. Plain fixes, no blame.
export function problems(assets, perms) {
  const out = [];
  const pages = assets.filter((a) => a.kind === 'page');
  if (!pages.length) out.push('No Facebook Page was shared. Run the link again and tick the Page on the "Choose the Pages" step.');
  else if (pages.every((p) => !p.can_post)) out.push('The Page was shared, but this Facebook login can not publish on it. The login needs full control of the Page (Page admin).');
  if (pages.length && !assets.some((a) => a.kind === 'instagram')) out.push('No Instagram account came through. Instagram must be a Business or Creator account linked to the Facebook Page (Instagram, Settings, Account type, then Connect a Page).');
  if (perms && perms.missingNeeded.length) out.push(`These were unticked: ${perms.missingNeeded.map(permissionWhy).join('; ')}. Run the link again and leave every box ticked.`);
  return out;
}

// Steps for a client who would rather not sign in: add us as a partner in their Meta Business account.
export function partnerSteps(businessId, businessName) {
  const who = businessName || 'Rightway Growth';
  return [
    'Open business.facebook.com/settings and pick your business.',
    'Go to Users, then Partners, then click Add.',
    `Choose "Give a partner access to your assets" and paste our Business ID${businessId ? ` (${businessId})` : ''}.`,
    `Tick your Facebook Page, Instagram account and ad account, turn on full control for each, and save. ${who} then shows up as a partner.`,
  ];
}

export const PAGE_STEPS = [
  'Open your Facebook Page and click Settings, then Page access (or "Page setup" on new Pages).',
  'Click Add new, search for the person we give you, and give them full control.',
  'Confirm with your password. They accept from their side.',
];

export const fbDialogUrl = ({ appId, redirect, state, scopes, version = GRAPH_VERSION, configId }) => {
  const q = new URLSearchParams({ client_id: appId, redirect_uri: redirect, state, response_type: 'code' });
  if (configId) q.set('config_id', configId);
  else { q.set('scope', (scopes || SCOPES).join(',')); q.set('auth_type', 'rerequest'); }
  return `https://www.facebook.com/${version}/dialog/oauth?${q}`;
};
