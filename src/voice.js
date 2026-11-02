// Browser calling: the rep talks through the computer (mic and speakers), no phone involved.
// Twilio Voice JS SDK in the browser gets a short lived access token from here. The first time the owner opens the dialer,
// the Hub creates a Twilio API key and a TwiML App on the account by itself and stores them (the key secret sealed with AES-GCM).
// Optional overrides in Cloudflare: TWILIO_API_KEY, TWILIO_API_SECRET, TWILIO_TWIML_APP_SID.
// Flow: POST /api/voice/prepare checks the number and logs the call, the browser connects with that call id,
// Twilio asks /api/twilio/client-voice what to do, and we dial the number from the chosen caller ID. Recording stays off.
import { HttpError, json } from './util.js';
import { first, all, run, now, getSettings, setSetting } from './db.js';
import { requireStaff } from './auth.js';
import { e164, inCallingHours, logActivity } from './crm.js';
import { route } from './router.js';
import { twilioReady, verifiedParams, twiml, xml, pickFrom, manualTarget } from './calls.js';

const enc = new TextEncoder();
const b64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const identityFor = (userId) => `rw_${String(userId).replace(/[^A-Za-z0-9_]/g, '')}`;
const TOKEN_TTL = 3600;
const PREP_WINDOW = 120e3;

async function aesKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`rw-voice:${env.TWILIO_AUTH_TOKEN}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(text)));
  return `${b64(iv)}.${b64(ct)}`;
}
async function unseal(env, sealed) {
  const [iv, ct] = String(sealed || '').split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(ct));
  return new TextDecoder().decode(pt);
}

// Twilio Access Token: a JWT signed with the API key secret, with a Voice grant.
export async function voiceToken({ accountSid, keySid, keySecret, appSid, identity, ttl = TOKEN_TTL, at = Math.floor(Date.now() / 1000) }) {
  const header = { alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' };
  const payload = {
    jti: `${keySid}-${at}`, iss: keySid, sub: accountSid, iat: at, nbf: at, exp: at + ttl,
    grants: { identity, voice: { incoming: { allow: true }, outgoing: { application_sid: appSid } } },
  };
  const part = (o) => b64url(enc.encode(JSON.stringify(o)));
  const data = `${part(header)}.${part(payload)}`;
  const key = await crypto.subtle.importKey('raw', enc.encode(keySecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return `${data}.${b64url(sig)}`;
}

async function twilioPost(env, path, fields) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(`Twilio: ${data.message || `HTTP ${res.status}`}`, 502);
  return data;
}

const isLocal = (origin) => /\/\/(localhost|127\.|0\.0\.0\.0)/.test(origin);

// Returns { keySid, keySecret, appSid } or null. Creates them on Twilio when allowed (owner only) and nothing is stored yet.
let provisioning = null;
export async function voiceConfig(env, origin, { provision = false } = {}) {
  if (env.TWILIO_API_KEY && env.TWILIO_API_SECRET && env.TWILIO_TWIML_APP_SID) {
    return { keySid: env.TWILIO_API_KEY, keySecret: env.TWILIO_API_SECRET, appSid: env.TWILIO_TWIML_APP_SID };
  }
  const s = await getSettings(env);
  let cfg = null;
  if (s.voice_cfg) {
    try {
      const c = JSON.parse(s.voice_cfg);
      if (c.account === env.TWILIO_ACCOUNT_SID) cfg = { ...c, keySecret: await unseal(env, c.secret) };
    } catch { cfg = null; }
  }
  if (cfg) {
    // The Hub moved to a new address: point the TwiML App at it.
    if (provision && origin && cfg.origin !== origin && !isLocal(origin)) {
      await twilioPost(env, `Applications/${cfg.appSid}.json`, { VoiceUrl: `${origin}/api/twilio/client-voice`, VoiceMethod: 'POST' });
      await setSetting(env, 'voice_cfg', JSON.stringify({ ...JSON.parse(s.voice_cfg), origin }));
    }
    return cfg;
  }
  if (!provision) return null;
  if (isLocal(origin)) throw new HttpError('Browser calling turns on from the live Hub address, not a local preview.', 400);
  provisioning ||= (async () => {
    const key = await twilioPost(env, 'Keys.json', { FriendlyName: 'Rightway Hub browser calling' });
    const app = await twilioPost(env, 'Applications.json', { FriendlyName: 'Rightway Hub dialer', VoiceUrl: `${origin}/api/twilio/client-voice`, VoiceMethod: 'POST' });
    const stored = { account: env.TWILIO_ACCOUNT_SID, keySid: key.sid, secret: await seal(env, key.secret), appSid: app.sid, origin, at: now() };
    await setSetting(env, 'voice_cfg', JSON.stringify(stored));
    return { ...stored, keySecret: key.secret };
  })().finally(() => { provisioning = null; });
  return provisioning;
}

route('GET', '/api/voice/token', async ({ env, user, url }) => {
  requireStaff(user);
  if (!twilioReady(env)) return json({ ready: false, reason: 'Add the Twilio keys in Cloudflare to turn on calling.' });
  const cfg = await voiceConfig(env, url.origin, { provision: user.role === 'admin' });
  if (!cfg) return json({ ready: false, reason: 'Ask the owner to open the dialer once. That turns on browser calling for the team.' });
  const identity = identityFor(user.id);
  const token = await voiceToken({ accountSid: env.TWILIO_ACCOUNT_SID, keySid: cfg.keySid, keySecret: cfg.keySecret, appSid: cfg.appSid, identity });
  return json({ ready: true, token, identity, ttl: TOKEN_TTL });
});

// Check the number and log the call before the browser connects. Lead calls follow the queue rules.
route('POST', '/api/voice/prepare', async ({ env, user, body }) => {
  requireStaff(user);
  if (!twilioReady(env)) throw new HttpError('Add the Twilio keys in Cloudflare to turn on calling.', 503);
  const b = await body();
  const from = await pickFrom(env, b.from);
  if (b.leadId) {
    const lead = await first(env, 'SELECT * FROM leads WHERE id = ?', b.leadId);
    if (!lead) throw new HttpError('Lead not found.', 404);
    if (lead.dnc) throw new HttpError('This lead is on Do Not Call.', 409);
    const to = e164(lead.phone);
    if (!to) throw new HttpError('This lead has no valid phone number.');
    if (!inCallingHours(lead.timezone)) throw new HttpError("It's outside 8am to 8pm in the lead's time zone. Call later.", 409);
    const activityId = await logActivity(env, { lead_id: lead.id, type: 'call', status: 'ready', by: user.id });
    await run(env, 'UPDATE activities SET to_num = ?, from_num = ? WHERE id = ?', to, from, activityId);
    await run(env, 'UPDATE leads SET last_call_at = ?, updated_at = ? WHERE id = ?', now(), now(), lead.id);
    return json({ activityId, to, from, name: lead.business });
  }
  const { to, lead } = await manualTarget(env, b.to);
  const activityId = await logActivity(env, { lead_id: lead?.id || null, type: 'manual_call', status: 'ready', body: `Manual dial to ${to} from ${from}`, by: user.id });
  await run(env, 'UPDATE activities SET to_num = ?, from_num = ? WHERE id = ?', to, from, activityId);
  if (lead) await run(env, 'UPDATE leads SET last_call_at = ?, updated_at = ? WHERE id = ?', now(), now(), lead.id);
  return json({ activityId, to, from, name: lead?.business || null, leadId: lead?.id || null });
});

// Twilio asks what to do when the browser places a call. Only a call prepared by the same rep in the last 2 minutes goes through.
route('POST', '/api/twilio/client-voice', async ({ env, request, url }) => {
  const p = await verifiedParams(env, request);
  const no = (msg) => twiml(`<Say voice="Polly.Joanna">${xml(msg)}</Say><Hangup/>`);
  const a = p.act ? await first(env, 'SELECT * FROM activities WHERE id = ?', p.act) : null;
  if (!a || a.status !== 'ready' || !a.to_num || now() - a.at > PREP_WINDOW) return no('This call could not be placed. Try again from the Hub.');
  if (String(p.From || '') !== `client:${identityFor(a.by)}`) return no('This call could not be placed.');
  if (a.lead_id) {
    const lead = await first(env, 'SELECT dnc FROM leads WHERE id = ?', a.lead_id);
    if (lead?.dnc) return no('This number is on Do Not Call.');
  }
  await run(env, "UPDATE activities SET status = 'connecting', call_sid = ? WHERE id = ?", p.CallSid || null, a.id);
  return twiml(`<Dial callerId="${xml(a.from_num || env.TWILIO_FROM)}" answerOnBridge="true" timeout="30" record="do-not-record" action="${xml(`${url.origin}/api/twilio/dial-done?a=${a.id}`)}"><Number>${xml(a.to_num)}</Number></Dial>`);
}, { public: true });

// Staff the browser phone should ring for an incoming call (only once browser calling is set up).
export async function browserIdentities(env) {
  const s = await getSettings(env).catch(() => ({}));
  if (!s.voice_cfg && !(env.TWILIO_API_KEY && env.TWILIO_TWIML_APP_SID)) return [];
  const rows = await all(env, "SELECT id FROM users WHERE role IN ('admin','team') ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, created_at LIMIT 9").catch(() => []);
  return rows.map((r) => identityFor(r.id));
}
