// Company accounts and logins (pure, shared). V's rule (Nov 2026): every account we open with a tool or vendor, and every login we
// use to work on a client's accounts, is under info@rightwaygrowth.com, never a person's own address, so the work and the access
// stay with the company when someone leaves. Modeled on the shared team vault and ownership lists in 1Password Business and
// Google Workspace admin (accounts belong to the company, people are added to them).
import { AGENCY_EMAIL } from './agency.js';

export const isAgency = (email) => String(email || '').trim().toLowerCase() === AGENCY_EMAIL;
// ok = under info@, other = under another address (move it), unset = nobody has said yet.
export function loginState(email) {
  const e = String(email || '').trim();
  if (!e) return 'unset';
  return isAgency(e) ? 'ok' : 'other';
}
export const LOGIN_TEXT = { ok: 'Under info@', other: 'Not under info@', unset: 'Not checked' };

// The usual accounts for this business. "Add the usual ones" puts these on the list with no email filled in, because the code cannot
// know which address each one was really opened with: the owner types it, and anything that is not info@ shows in red.
export const VENDORS = [
  ['Cloudflare', 'Hosting, database and secrets for the Hub', 'https://dash.cloudflare.com'],
  ['GitHub', 'The Hub code', 'https://github.com'],
  ['Resend', 'Email sending (info@ is the sender)', 'https://resend.com'],
  ['Twilio', 'Calls, texts, A2P registration, phone numbers', 'https://console.twilio.com'],
  ['Stripe', 'Payments and subscriptions', 'https://dashboard.stripe.com'],
  ['DataForSEO', 'Scans, directory checks, Lead finder', 'https://app.dataforseo.com'],
  ['Anthropic', 'Claude for captions, drafts and Ask Claude', 'https://console.anthropic.com'],
  ['Google Cloud', 'OAuth app, Maps key, Business Profile API', 'https://console.cloud.google.com'],
  ['Google Workspace', 'Gmail, Calendar, Drive for the company', 'https://admin.google.com'],
  ['Google Business Profile manager', 'Manager access to client profiles', 'https://business.google.com'],
  ['Google Search Console and Analytics', 'Client reporting access', 'https://search.google.com/search-console'],
  ['Meta Business Suite', 'Facebook and Instagram partner access', 'https://business.facebook.com'],
  ['Slack', 'Team chat and client channels', 'https://api.slack.com/apps'],
  ['Domain registrar', 'rightwaygrowth.com', ''],
  ['Yelp for Business', 'Client Yelp pages', 'https://biz.yelp.com'],
  ['PageSpeed key (Google Cloud)', 'Speed tests', 'https://console.cloud.google.com'],
  ['Citation and directory sign ups', 'Listings opened for clients', ''],
];
