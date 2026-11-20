// A2P 10DLC page (owners): the numbers, the registration packet, and a read only look at Twilio's brand, Messaging Service and campaign
// status. The Hub never submits the registration: it needs the EIN and a person's authorization, so V does that in the Twilio console.
// Modeled on Twilio's Trust Hub A2P registration screens. The Twilio reads follow Twilio's Messaging API (a2p/BrandRegistrations,
// Services, Services/{sid}/PhoneNumbers, Services/{sid}/Compliance/Usa2p); never run against a live account from the build sandbox.
import { HttpError, json } from './util.js';
import { getSettings } from './db.js';
import { requireAdmin } from './auth.js';
import { route } from './router.js';
import { twilioReady } from './calls.js';
import { packet, numberStates, nextStep, CHECKLIST } from '../public/js/a2p.js';

const auth = (env) => `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`;
async function twGet(env, url) {
  const res = await fetch(url, { headers: { Authorization: auth(env) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}
const settle = async (fn, errors, label) => { try { return await fn(); } catch (e) { errors.push(`${label}: ${String(e.message || e).slice(0, 160)}`); return null; } };

route('GET', '/api/a2p', async ({ env, user, url }) => {
  requireAdmin(user);
  const s = await getSettings(env).catch(() => ({}));
  const origin = s.hub_origin || s.autoscan_origin || (/localhost|127\./.test(url.origin) ? '' : url.origin);
  const out = { packet: packet({ origin }), checklist: CHECKLIST, ready: twilioReady(env), numbers: [], brands: [], services: [], errors: [], next: '' };
  if (!out.ready) { out.next = nextStep({}); return json(out); }
  const sid = env.TWILIO_ACCOUNT_SID;
  const tracking = await import('./calltrack.js').then((m) => m.trackingSet?.(env)).catch(() => null);
  const nums = await settle(async () => (await twGet(env, `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=50`)).incoming_phone_numbers || [], out.errors, 'Numbers');
  const own = (nums || []).filter((n) => !(tracking?.sids?.has?.(n.sid)));
  const brands = await settle(async () => (await twGet(env, 'https://messaging.twilio.com/v1/a2p/BrandRegistrations?PageSize=20')).data || [], out.errors, 'Brands');
  out.brands = (brands || []).map((b) => ({ sid: b.sid, status: b.status, type: b.brand_type, name: b.a2p_profile_bundle_sid ? undefined : undefined, failure: b.failure_reason || (b.errors || []).join('; ') || '' }));
  const svcs = (await settle(async () => (await twGet(env, 'https://messaging.twilio.com/v1/Services?PageSize=20')).services || [], out.errors, 'Messaging Services')) || [];
  for (const sv of svcs.slice(0, 10)) {
    const pn = await settle(async () => (await twGet(env, `https://messaging.twilio.com/v1/Services/${sv.sid}/PhoneNumbers?PageSize=50`)).phone_numbers || [], out.errors, `Numbers in ${sv.friendly_name}`);
    const camps = await settle(async () => (await twGet(env, `https://messaging.twilio.com/v1/Services/${sv.sid}/Compliance/Usa2p?PageSize=10`)).data || [], out.errors, `Campaigns in ${sv.friendly_name}`);
    out.services.push({ sid: sv.sid, name: sv.friendly_name, numbers: (pn || []).map((p) => p.phone_number), campaigns: (camps || []).map((c) => ({ sid: c.sid, status: c.campaign_status, useCase: c.us_app_to_person_usecase, error: (c.errors || []).map((e) => e.description || e.error_code || e).join('; ') })) });
  }
  out.numbers = numberStates((own || []).map((n) => ({ number: n.phone_number, sid: n.sid, label: n.friendly_name })), out.services);
  out.next = nextStep({ brands: out.brands, states: out.numbers });
  return json(out);
});
