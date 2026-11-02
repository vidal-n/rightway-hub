// Dialer through Twilio: the Hub calls your phone, then connects you to the lead from the business number.
// Keys: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (your Twilio number, +1...). Recording stays off.
import { HttpError, json } from './util.js';
import { first, run, now } from './db.js';
import { requireStaff } from './auth.js';
import { e164, inCallingHours, logActivity } from './crm.js';
import { route } from './router.js';

const enc = new TextEncoder();
export const xml = (s) => String(s || '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
export const twiml = (inner) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, { headers: { 'content-type': 'text/xml; charset=utf-8' } });

export function twilioReady(env) {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM);
}

// Twilio signs each webhook: base64(HMAC-SHA1(auth token, full URL + sorted POST params)).
export async function twilioSignature(authToken, url, params) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const key = await crypto.subtle.importKey('raw', enc.encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return btoa(String.fromCharCode(...sig));
}

export async function verifiedParams(env, request) {
  const form = await request.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const expected = await twilioSignature(env.TWILIO_AUTH_TOKEN || '', request.url, params);
  if (!env.TWILIO_AUTH_TOKEN || request.headers.get('x-twilio-signature') !== expected) throw new HttpError('Bad signature.', 403);
  return params;
}

route('GET', '/api/me', async ({ env, user }) => {
  requireStaff(user);
  const u = await first(env, 'SELECT id, email, name, role, phone FROM users WHERE id = ?', user.id);
  return json({ user: u, twilio: twilioReady(env) });
});

route('PUT', '/api/me/phone', async ({ env, user, body }) => {
  requireStaff(user);
  const p = e164((await body()).phone);
  if (!p) throw new HttpError('Enter your mobile number with area code.');
  await run(env, 'UPDATE users SET phone = ? WHERE id = ?', p, user.id);
  return json({ phone: p });
});

route('POST', '/api/dialer/call', async ({ env, user, url, body }) => {
  requireStaff(user);
  if (!twilioReady(env)) throw new HttpError('Calling through the Hub needs Twilio. Use "Call from my phone" for now.', 503);
  const me = await first(env, 'SELECT phone FROM users WHERE id = ?', user.id);
  if (!me?.phone) throw new HttpError('Add your mobile number in the dialer first, so the Hub can ring you.');
  const lead = await first(env, 'SELECT * FROM leads WHERE id = ?', (await body()).leadId);
  if (!lead) throw new HttpError('Lead not found.', 404);
  if (lead.dnc) throw new HttpError('This lead is on Do Not Call.', 409);
  if (!e164(lead.phone)) throw new HttpError('This lead has no valid phone number.');
  if (!inCallingHours(lead.timezone)) throw new HttpError("It's outside 8am to 8pm in the lead's time zone. Call later.", 409);
  const activityId = await logActivity(env, { lead_id: lead.id, type: 'call', status: 'ringing_you', by: user.id });
  const params = new URLSearchParams({
    To: me.phone, From: env.TWILIO_FROM,
    Url: `${url.origin}/api/twilio/bridge?a=${activityId}`,
    StatusCallback: `${url.origin}/api/twilio/status?a=${activityId}`,
    StatusCallbackEvent: 'completed',
    Timeout: '25',
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    await run(env, "UPDATE activities SET status = 'failed', body = ? WHERE id = ?", `Twilio: ${data.message || res.status}`, activityId);
    throw new HttpError(`Twilio: ${data.message || `HTTP ${res.status}`}`, 502);
  }
  await run(env, 'UPDATE activities SET call_sid = ? WHERE id = ?', data.sid || null, activityId);
  await run(env, 'UPDATE leads SET last_call_at = ?, updated_at = ? WHERE id = ?', now(), now(), lead.id);
  return json({ ok: true, activityId });
});

// You answered: connect to the lead.
route('POST', '/api/twilio/bridge', async ({ env, request, url }) => {
  await verifiedParams(env, request);
  const a = await first(env, 'SELECT * FROM activities WHERE id = ?', url.searchParams.get('a') || '');
  const lead = a && (await first(env, 'SELECT * FROM leads WHERE id = ?', a.lead_id));
  const to = lead && e164(lead.phone);
  if (!to || lead.dnc) return twiml('<Say>This lead cannot be called.</Say><Hangup/>');
  await run(env, "UPDATE activities SET status = 'connecting' WHERE id = ?", a.id);
  return twiml(`<Say voice="Polly.Joanna">Calling ${xml(lead.business)}.</Say><Dial callerId="${xml(env.TWILIO_FROM)}" answerOnBridge="true" timeout="25" record="do-not-record" action="${xml(`${url.origin}/api/twilio/dial-done?a=${a.id}`)}"><Number>${xml(to)}</Number></Dial>`);
}, { public: true });

// The lead's side ended: save how long you talked.
route('POST', '/api/twilio/dial-done', async ({ env, request, url }) => {
  const p = await verifiedParams(env, request);
  const id = url.searchParams.get('a') || '';
  await run(env, 'UPDATE activities SET status = ?, duration = ? WHERE id = ?', p.DialCallStatus || 'completed', Number(p.DialCallDuration || 0), id);
  return twiml('<Hangup/>');
}, { public: true });

route('POST', '/api/twilio/status', async ({ env, request, url }) => {
  const p = await verifiedParams(env, request);
  const id = url.searchParams.get('a') || '';
  if (p.CallStatus && p.CallStatus !== 'completed') await run(env, "UPDATE activities SET status = ? WHERE id = ? AND status = 'ringing_you'", `you_${p.CallStatus}`, id);
  return twiml('');
}, { public: true });
