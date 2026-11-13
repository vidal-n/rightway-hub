// Dialer through Twilio: the Hub calls your phone, then connects you to the lead from the business number.
// Keys: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (your Twilio number, +1...). Recording stays off.
import { tagScript } from './scripttest.js';
import { HttpError, json } from './util.js';
import { first, all, run, now } from './db.js';
import { requireStaff } from './auth.js';
import { e164, inCallingHours, logActivity } from './crm.js';
import { route } from './router.js';
import { guardLead, blockedFor, blockedPhone, blockText } from './suppress.js';

const enc = new TextEncoder();
export const xml = (s) => String(s || '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
export const twiml = (inner) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, { headers: { 'content-type': 'text/xml; charset=utf-8' } });

export function twilioReady(env) {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM);
}

// The numbers on this Twilio account, for choosing a caller ID. Cached for 5 minutes. Falls back to TWILIO_FROM.
let numCache = { at: 0, list: null };
export const resetNumberCache = () => { numCache = { at: 0, list: null }; };
export async function ownedNumbers(env) {
  if (numCache.list && Date.now() - numCache.at < 300e3 && numCache.key === env.TWILIO_ACCOUNT_SID) return numCache.list;
  let list = [];
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json?PageSize=50`, {
      headers: { Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}` },
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) list = (data.incoming_phone_numbers || []).filter((n) => n.capabilities?.voice !== false).map((n) => ({ number: n.phone_number, label: n.friendly_name || n.phone_number }));
  } catch { /* use the fallback */ }
  // Client call tracking numbers are not agency caller IDs.
  const tracking = env.DB ? new Set((await all(env, "SELECT number FROM tracking_numbers WHERE status = 'active'").catch(() => [])).map((r) => r.number)) : new Set();
  list = list.filter((n) => !tracking.has(n.number));
  if (env.TWILIO_FROM && !list.some((n) => n.number === env.TWILIO_FROM)) list.unshift({ number: env.TWILIO_FROM, label: env.TWILIO_FROM });
  list.sort((a, b) => (a.number === env.TWILIO_FROM ? -1 : b.number === env.TWILIO_FROM ? 1 : 0));
  numCache = { at: Date.now(), list, key: env.TWILIO_ACCOUNT_SID };
  return list;
}

export async function pickFrom(env, wanted) {
  if (!wanted) return env.TWILIO_FROM;
  const list = await ownedNumbers(env);
  if (!list.some((n) => n.number === wanted)) throw new HttpError('That number is not on your Twilio account.');
  return wanted;
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
  const u = await first(env, 'SELECT id, email, name, role, phone, avatar_at FROM users WHERE id = ?', user.id);
  return json({ user: { ...u, job: user.job || null }, twilio: twilioReady(env) });
});

route('PUT', '/api/me/phone', async ({ env, user, body }) => {
  requireStaff(user);
  const raw = String((await body()).phone || '').trim();
  if (!raw) { await run(env, 'UPDATE users SET phone = NULL WHERE id = ?', user.id); return json({ phone: null }); }
  const p = e164(raw);
  if (!p) throw new HttpError('Enter your mobile number with area code.');
  await run(env, 'UPDATE users SET phone = ? WHERE id = ?', p, user.id);
  return json({ phone: p });
});

route('POST', '/api/dialer/call', async ({ env, user, url, body }) => {
  requireStaff(user);
  if (!twilioReady(env)) throw new HttpError('Calling through the Hub needs Twilio. Use "Call from my phone" for now.', 503);
  const me = await first(env, 'SELECT phone FROM users WHERE id = ?', user.id);
  if (!me?.phone) throw new HttpError('Add your mobile number in the dialer first, so the Hub can ring you.');
  const b = await body();
  const from = await pickFrom(env, b.from);
  const lead = await first(env, 'SELECT * FROM leads WHERE id = ?', b.leadId);
  if (!lead) throw new HttpError('Lead not found.', 404);
  if (lead.dnc) throw new HttpError('This lead is on Do Not Call.', 409);
  await guardLead(env, lead);
  if (!e164(lead.phone)) throw new HttpError('This lead has no valid phone number.');
  if (!inCallingHours(lead.timezone, Date.now(), lead.tz_alt, lead.state)) throw new HttpError("It's outside 8am to 8pm in the lead's time zone. Call later.", 409);
  const activityId = await logActivity(env, { lead_id: lead.id, type: 'call', status: 'ringing_you', by: user.id });
  await tagScript(env, activityId, b.script, b.scriptV, b.scriptHow);
  const params = new URLSearchParams({
    To: me.phone, From: env.TWILIO_FROM,
    Url: `${url.origin}/api/twilio/bridge?a=${activityId}&from=${encodeURIComponent(from)}`,
    StatusCallback: `${url.origin}/api/twilio/status?a=${activityId}`,
    StatusCallbackEvent: 'completed',
    Timeout: '25',
  });
  const data = await placeCall(env, params, activityId);
  await run(env, 'UPDATE activities SET call_sid = ? WHERE id = ?', data.sid || null, activityId);
  await run(env, 'UPDATE leads SET last_call_at = ?, updated_at = ? WHERE id = ?', now(), now(), lead.id);
  return json({ ok: true, activityId });
});

async function placeCall(env, params, activityId) {
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
  return data;
}

// A typed number: US or Canada only, no premium lines, not on Do Not Call. Returns the e164 number and any matching lead.
export async function manualTarget(env, raw) {
  const to = e164(raw);
  if (!to) throw new HttpError('Enter a full phone number with area code.');
  if (!to.startsWith('+1') || /^\+1(900|976)/.test(to)) throw new HttpError('Only US and Canada numbers can be dialed here.');
  const lead = await first(env, 'SELECT id, business, dnc FROM leads WHERE phone_digits = ? ORDER BY dnc DESC LIMIT 1', to.slice(2));
  if (lead?.dnc) throw new HttpError(`${lead.business} is on Do Not Call.`, 409);
  // A number on the Do Not Call list can be typed in too: it is refused whether or not a lead still holds it.
  const row = await blockedPhone(env, to.slice(2));
  if (row) throw new HttpError(blockText(row), 409);
  return { to, lead: lead || null };
}

route('GET', '/api/dialer/numbers', async ({ env, user }) => {
  requireStaff(user);
  if (!twilioReady(env)) return json({ numbers: [], default: null });
  const L = await import('./lines.js');
  const hide = await L.hiddenLines(env, user);
  const mine = await L.myLine(env, user);
  return json({ numbers: (await ownedNumbers(env)).filter((n) => !hide.has(n.number || n.phone_number || n)), default: mine || env.TWILIO_FROM });
});

// Manual dial out: type any number, pick which of your numbers shows as caller ID.
route('POST', '/api/dialer/dial', async ({ env, user, url, body }) => {
  requireStaff(user);
  if (!twilioReady(env)) throw new HttpError('Calling through the Hub needs Twilio keys in Cloudflare first.', 503);
  const me = await first(env, 'SELECT phone FROM users WHERE id = ?', user.id);
  if (!me?.phone) throw new HttpError('Add your mobile number in the dialer first, so the Hub can ring you.');
  const b = await body();
  const from = await pickFrom(env, b.from);
  const { to, lead } = await manualTarget(env, b.to);
  const activityId = await logActivity(env, { lead_id: lead?.id || null, type: 'manual_call', status: 'ringing_you', body: `Manual dial to ${to} from ${from}`, by: user.id });
  const params = new URLSearchParams({
    To: me.phone, From: from,
    Url: `${url.origin}/api/twilio/bridge?a=${activityId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    StatusCallback: `${url.origin}/api/twilio/status?a=${activityId}`,
    StatusCallbackEvent: 'completed',
    Timeout: '25',
  });
  const data = await placeCall(env, params, activityId);
  await run(env, 'UPDATE activities SET call_sid = ? WHERE id = ?', data.sid || null, activityId);
  if (lead) await run(env, 'UPDATE leads SET last_call_at = ?, updated_at = ? WHERE id = ?', now(), now(), lead.id);
  return json({ ok: true, activityId, lead: lead ? { id: lead.id, business: lead.business } : null });
});

route('GET', '/api/dialer/recent', async ({ env, user }) => {
  requireStaff(user);
  const rows = await all(env, `SELECT a.id, a.at, a.body, a.status, a.duration, a.lead_id, a.dispo, l.business FROM activities a LEFT JOIN leads l ON l.id = a.lead_id
    WHERE a.type = 'manual_call' AND a.by = ? ORDER BY a.at DESC LIMIT 15`, user.id);
  return json({ calls: rows });
});

// You answered: connect to the lead.
route('POST', '/api/twilio/bridge', async ({ env, request, url }) => {
  await verifiedParams(env, request);
  const a = await first(env, 'SELECT * FROM activities WHERE id = ?', url.searchParams.get('a') || '');
  const manualTo = a?.type === 'manual_call' ? e164(url.searchParams.get('to')) : null;
  const lead = a?.lead_id && (await first(env, 'SELECT * FROM leads WHERE id = ?', a.lead_id));
  const to = manualTo || (lead && e164(lead.phone));
  if (!a || !to || lead?.dnc || (lead && await blockedFor(env, lead)) || (manualTo && await blockedPhone(env, manualTo.slice(2)))) return twiml('<Say>This number cannot be called.</Say><Hangup/>');
  const callerId = url.searchParams.get('from') || env.TWILIO_FROM;
  await run(env, "UPDATE activities SET status = 'connecting' WHERE id = ?", a.id);
  return twiml(`<Say voice="Polly.Joanna">${manualTo ? 'Dialing.' : `Calling ${xml(lead.business)}.`}</Say><Dial callerId="${xml(callerId)}" answerOnBridge="true" timeout="25" record="do-not-record" action="${xml(`${url.origin}/api/twilio/dial-done?a=${a.id}`)}"><Number>${xml(to)}</Number></Dial>`);
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
