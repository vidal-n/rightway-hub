// Prepaid balances for the services the Hub runs on, so scans and the dialer never stop by surprise.
// DataForSEO (scans, research, listing checks) and Twilio (calls, texts, tracking numbers). Owners only. 5 minute cache.
import { json } from './util.js';
import { requireAdmin } from './auth.js';
import { route } from './router.js';

export const LOW = { dataforseo: 5, twilio: 10 };
let cache = null;

async function dataforseo(env, fetchImpl) {
  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) return { key: 'dataforseo', name: 'DataForSEO', connected: false, note: 'Scans and lead research' };
  const res = await fetchImpl('https://api.dataforseo.com/v3/appendix/user_data', { headers: { authorization: `Basic ${btoa(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`)}` } });
  const d = await res.json().catch(() => ({}));
  const money = d?.tasks?.[0]?.result?.[0]?.money || {};
  if (!res.ok || money.balance == null) return { key: 'dataforseo', name: 'DataForSEO', connected: true, error: d?.status_message || `HTTP ${res.status}` };
  return { key: 'dataforseo', name: 'DataForSEO', connected: true, balance: Number(money.balance), currency: 'USD', addUrl: 'https://app.dataforseo.com/', note: 'Scans, lead research, listing checks' };
}

async function twilio(env, fetchImpl) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return { key: 'twilio', name: 'Twilio', connected: false, note: 'Calls and texts' };
  const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Balance.json`, { headers: { authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}` } });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.balance == null) return { key: 'twilio', name: 'Twilio', connected: true, error: d?.message || `HTTP ${res.status}` };
  return { key: 'twilio', name: 'Twilio', connected: true, balance: Number(d.balance), currency: d.currency || 'USD', addUrl: 'https://console.twilio.com/us1/billing/manage-billing/billing-overview', note: 'Calls, texts, tracking numbers' };
}

export async function balances(env, { fresh = false } = {}, fetchImpl = fetch) {
  if (!fresh && cache && cache.at > Date.now() - 300e3) return cache.data;
  const list = await Promise.all([dataforseo, twilio].map((f) => f(env, fetchImpl).catch((e) => ({ key: f.name, name: f.name, connected: true, error: e.message }))));
  const data = list.map((x) => ({ ...x, low: x.balance != null && x.balance < (LOW[x.key] ?? 5), empty: x.balance != null && x.balance <= 0.5 }));
  cache = { at: Date.now(), data };
  return data;
}

route('GET', '/api/balances', async ({ env, user, url }) => {
  requireAdmin(user);
  return json({ services: await balances(env, { fresh: url.searchParams.get('fresh') === '1' }), checked: Date.now(),
    others: [
      { name: 'Anthropic (Claude)', url: 'https://console.anthropic.com/settings/billing', note: 'Ask Claude, captions, page drafts' },
      { name: 'Stripe', url: '/#/payments', note: 'Your payouts and balance are on the Payments page' },
      { name: 'Resend', url: 'https://resend.com/overview', note: 'Emails (free up to 3,000 a month)' },
    ] });
});

// Everyone on the team gets a heads up (no amounts) when a balance is low, so the dialer and scans do not die mid shift.
route('GET', '/api/balances/status', async ({ env, user }) => {
  const { requireStaff } = await import('./auth.js');
  requireStaff(user);
  const list = await balances(env).catch(() => []);
  return json({ low: list.filter((s) => s.low).map((s) => ({ key: s.key, name: s.name, empty: s.empty })) });
});
