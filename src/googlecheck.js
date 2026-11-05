// "Check connection" on the Google page: one small read per Google app with the asking person's own account, so a failure
// comes back as a plain reason and the fix (API turned off in Google Cloud, box not ticked on Google's screen, connection expired).
import { json } from './util.js';
import { first, all, run, now, getSettings, setSetting } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { accessToken, googleReady, hasScope, APP_SCOPES, calendarFull, calendarAny } from './google.js';
import { listParams } from './gdrive.js';

const CHECKS = [
  { app: 'calendar', label: 'Calendar', api: 'Google Calendar API', url: 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1', scope: (s) => calendarAny(s) },
  { app: 'mail', label: 'Gmail', api: 'Gmail API', url: 'https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=1&labelIds=INBOX' },
  // The same file list call the Drive page makes, so a check that passes means the page works.
  { app: 'drive', label: 'Drive', api: 'Google Drive API', url: `https://www.googleapis.com/drive/v3/files?${listParams({}).toString().replace('pageSize=60', 'pageSize=1')}` },
  // No document to read, so a made up id: 404 means the API answered (on); 403 with "disabled" means it is off.
  { app: 'docs', label: 'Docs', api: 'Google Docs API', url: 'https://docs.googleapis.com/v1/documents/rw-connection-check', okStatus: [404, 400] },
  { app: 'sheets', label: 'Sheets', api: 'Google Sheets API', url: 'https://sheets.googleapis.com/v4/spreadsheets/rw-connection-check', okStatus: [404, 400] },
  { app: 'gsc', label: 'Search Console', api: 'Google Search Console API', url: 'https://www.googleapis.com/webmasters/v3/sites' },
  { app: 'ga', label: 'Analytics', api: 'Google Analytics Admin API', url: 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=1' },
  { app: 'gbp', label: 'Business Profile', api: 'My Business Account Management API', url: 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts' },
];

// Turn Google's error into a plain reason and a fix. Pure, tested.
export function explain(check, status, body = {}) {
  const msg = String(body?.error?.message || body?.error_description || body?.error || '');
  const link = (msg.match(/https:\/\/console\.(?:developers|cloud)\.google\.com\/\S+/) || [])[0]?.replace(/[.,)]+$/, '') || null;
  if (/has not been used in project|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(msg)) {
    return { reason: `The ${check.api} is turned off in your Google Cloud project.`, fix: `Open the link, click Enable, wait a minute, then check again.`, link: link || 'https://console.cloud.google.com/apis/library' };
  }
  if (status === 403 && /insufficient|scope|PERMISSION_DENIED.*scope/i.test(msg)) {
    return { reason: `Google did not give the Hub access to ${check.label}.`, fix: `Click Turn on for ${check.label}. On Google's screen, tick its box (or Select all) before Continue.` };
  }
  if ((status === 429 || /quota/i.test(msg)) && /mybusiness|businessprofile|Business Profile/i.test(msg)) return { reason: 'Google is refusing Business Profile requests. A new Cloud project gets 0 requests per minute until Google approves Business Profile API access.', fix: 'Google Cloud, APIs and Services, My Business Account Management API, Quotas. If Requests per minute is 0, send the access form at support.google.com/business/contact/api_default with your project number. If it is above 0, wait a minute and check again.' };
  if (status === 429 || /quota/i.test(msg)) return { reason: 'Google says the quota is used up for now.', fix: 'Wait a few minutes and check again. If it keeps happening, raise the quota in Google Cloud.' };
  if (check.app === 'gbp' && status === 403) return { reason: 'Google has not approved Business Profile API access for your project yet.', fix: 'Apply on the Business Profile APIs access form. Until then posts are copied by hand.' };
  return { reason: msg || `Google answered with error ${status}.`, fix: 'Send this message to Claude.' };
}

route('GET', '/api/google/check', async ({ env, user }) => {
  requireStaff(user);
  if (!googleReady(env)) return json({ ready: false, results: [], summary: 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Cloudflare first.' });
  const me = await first(env, 'SELECT * FROM users WHERE id = ?', user.id);
  if (!me?.google_token) return json({ ready: true, connected: false, results: [], summary: 'You are not signed in to Google yet. Click Turn on for Calendar first.' });
  let token;
  try { token = await accessToken(env, me); } catch (e) {
    return json({ ready: true, connected: true, results: [], summary: `${e.message} If the Google app is still in Testing mode, Google ends the sign in after 7 days, so this is normal about once a week.` });
  }
  const granted = String(me.google_scopes || '');
  const results = await Promise.all(CHECKS.map(async (c) => {
    const has = c.scope ? c.scope(granted) : hasScope(granted, APP_SCOPES[c.app]);
    if (!has) return { app: c.app, label: c.label, on: false, ok: null, reason: 'Not turned on for your account.', fix: `Click Turn on for ${c.label} if you want it.` };
    // Older connections only had calendar.events: booking works, the calendar list does not. One more sign in fixes it.
    if (c.app === 'calendar' && !calendarFull(granted)) return { app: c.app, label: c.label, on: true, ok: false, reason: 'You signed in before the Hub asked for full Calendar access, so Google only lets it add events, not show your calendars.', fix: 'Click Turn on all (or Turn on for Calendar) and press Allow. This is a one time fix.' };
    try {
      const res = await fetch(c.url, { headers: { authorization: `Bearer ${token}` } });
      if (res.ok || (c.okStatus || []).includes(res.status)) return { app: c.app, label: c.label, on: true, ok: true, reason: 'Working.' };
      const body = await res.json().catch(() => ({}));
      return { app: c.app, label: c.label, on: true, ok: false, status: res.status, ...explain(c, res.status, body) };
    } catch (e) {
      return { app: c.app, label: c.label, on: true, ok: false, reason: e.message, fix: 'Check again in a minute.' };
    }
  }));
  const bad = results.filter((r) => r.ok === false).length;
  return json({ ready: true, connected: true, email: me.google_email, scopes: granted.split(/\s+/).filter(Boolean).length, results,
    summary: bad ? `${bad} Google app${bad === 1 ? ' needs' : 's need'} a fix. Each one says how.` : 'Every Google app you turned on is working.' });
});

// Every 6 hours: is each teammate's Google sign in still good? While the Google app is in Testing mode Google ends it every 7 days.
// When it ends, invites, Meet links and team calendar copies made with that account stop, so the person (and the owners, when it is the
// account the booking page or the team calendar uses) get one alert with the fix. Signing in again clears it.
export async function googleHealthTick(env, t = now()) {
  if (!googleReady(env)) return 0;
  const s = await getSettings(env);
  if (Number(s.google_health_at || 0) > t - 6 * 3600e3) return 0;
  await setSetting(env, 'google_health_at', String(t));
  let master = null;
  try { master = JSON.parse(s.master_cal || 'null'); } catch { master = null; }
  const rows = await all(env, "SELECT * FROM users WHERE google_token IS NOT NULL AND role IN ('admin','team')");
  const { notify } = await import('./notify.js');
  let n = 0;
  for (const u of rows) {
    try {
      await accessToken(env, u);
      if (u.google_alerted) await run(env, 'UPDATE users SET google_alerted = NULL WHERE id = ?', u.id);
    } catch (e) {
      if (u.google_alerted) continue;
      await run(env, 'UPDATE users SET google_alerted = ? WHERE id = ?', t, u.id);
      const shared = master?.owner === u.id || s.book_owner === u.id || (!s.book_owner && u.role === 'admin');
      const body = `${String(u.name || 'Your').split(' ')[0]}'s Google sign in ended. Invites and Meet links ${shared ? 'for bookings and the team calendar ' : ''}pause until they sign in again: Google page, Turn on all.`;
      await notify(env, { to: shared ? 'admins' : [u.id], kind: 'meeting', title: 'Google needs a new sign in', body, url: '/#/google', tag: `google-${u.id}` }).catch(() => {});
      if (shared && u.role !== 'admin') await notify(env, { to: [u.id], kind: 'meeting', title: 'Google needs a new sign in', body, url: '/#/google', tag: `google-${u.id}` }).catch(() => {});
      n++;
    }
  }
  return n;
}
