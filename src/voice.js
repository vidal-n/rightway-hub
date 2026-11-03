// Browser calling: the rep talks through the computer (mic and speakers), no phone involved.
// Outbound calls run in a private Twilio conference (rw_<activityId>): the rep joins first, the Hub then dials the number into the room.
// That lets an owner listen, whisper (only the rep hears) or barge in, and lets the call be recorded when recording is on.
// Whisper needs "Agent Conference" turned on in the Twilio console (Voice settings). Reps disclose recording verbally.
// Twilio Voice JS SDK in the browser gets a short lived access token from here. The first time the owner opens the dialer,
// the Hub creates a Twilio API key and a TwiML App on the account by itself and stores them (the key secret sealed with AES-GCM).
// Optional overrides in Cloudflare: TWILIO_API_KEY, TWILIO_API_SECRET, TWILIO_TWIML_APP_SID.
// Flow: POST /api/voice/prepare checks the number and logs the call, the browser connects with that call id,
// Twilio asks /api/twilio/client-voice what to do, and we dial the number from the chosen caller ID. Recording stays off.
import { HttpError, json } from './util.js';
import { first, all, run, now, getSettings, setSetting } from './db.js';
import { requireStaff, requireAdmin } from './auth.js';
import { e164, inCallingHours, logActivity, recordOutcome, insertLead, cleanLead } from './crm.js';
import { resolveDispo } from './dispo.js';
import { route } from './router.js';
import { twilioReady, verifiedParams, twiml, xml, pickFrom, manualTarget, ownedNumbers, resetNumberCache } from './calls.js';
import { trackingSet } from './calltrack.js';

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

const twAuth = (env) => `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`;
async function twilioPost(env, path, fields) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/${path}`, {
    method: 'POST',
    headers: { Authorization: twAuth(env), 'content-type': 'application/x-www-form-urlencoded' },
    body: (fields instanceof URLSearchParams ? fields : new URLSearchParams(fields)).toString(),
  });
  if (res.status === 204) return {};
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
    return json({ activityId, to, from, name: lead.business, recording: await recordingOn(env) });
  }
  const { to, lead } = await manualTarget(env, b.to);
  const activityId = await logActivity(env, { lead_id: lead?.id || null, type: 'manual_call', status: 'ready', body: `Manual dial to ${to} from ${from}`, by: user.id });
  await run(env, 'UPDATE activities SET to_num = ?, from_num = ? WHERE id = ?', to, from, activityId);
  if (lead) await run(env, 'UPDATE leads SET last_call_at = ?, updated_at = ? WHERE id = ?', now(), now(), lead.id);
  return json({ activityId, to, from, name: lead?.business || null, leadId: lead?.id || null, recording: await recordingOn(env) });
});

export async function recordingOn(env) {
  return (await getSettings(env).catch(() => ({}))).call_recording === '1';
}
const room = (id) => `rw_${id}`;
const LIVE = ['connecting', 'ringing', 'in-progress'];
const MODES = ['listen', 'whisper', 'barge'];

async function userForIdentity(env, from) {
  const ident = String(from || '').replace(/^client:/, '');
  if (!ident.startsWith('rw_')) return null;
  const u = await first(env, 'SELECT id, role, name FROM users WHERE id = ?', ident.slice(3));
  return u && identityFor(u.id) === ident ? u : null;
}

// Twilio asks what to do when a browser places a call: a prepared outbound call, or an owner joining a live call to coach.
route('POST', '/api/twilio/client-voice', async ({ env, request, url }) => {
  const p = await verifiedParams(env, request);
  const no = (msg) => twiml(`<Say voice="Polly.Joanna">${xml(msg)}</Say><Hangup/>`);

  if (p.monitor) {
    const u = await userForIdentity(env, p.From);
    if (!u || u.role !== 'admin') return no('Only an owner can listen to calls.');
    const a = await first(env, 'SELECT * FROM activities WHERE id = ?', p.monitor);
    if (!a || !a.conf_sid || !LIVE.includes(a.status)) return no('That call has ended.');
    const mode = MODES.includes(p.mode) ? p.mode : 'listen';
    await run(env, 'UPDATE activities SET mon_sid = ?, mon_by = ?, mon_mode = ? WHERE id = ?', p.CallSid || null, u.id, mode, a.id);
    const coach = mode === 'whisper' && a.call_sid ? ` coach="${xml(a.call_sid)}"` : '';
    return twiml(`<Dial><Conference beep="false" startConferenceOnEnter="false" endConferenceOnExit="false" muted="${mode === 'listen'}"${coach} participantLabel="coach" waitUrl="">${room(a.id)}</Conference></Dial>`);
  }

  const a = p.act ? await first(env, 'SELECT * FROM activities WHERE id = ?', p.act) : null;
  if (!a || a.status !== 'ready' || !a.to_num || now() - a.at > PREP_WINDOW) return no('This call could not be placed. Try again from the Hub.');
  if (String(p.From || '') !== `client:${identityFor(a.by)}`) return no('This call could not be placed.');
  if (a.lead_id) {
    const lead = await first(env, 'SELECT dnc FROM leads WHERE id = ?', a.lead_id);
    if (lead?.dnc) return no('This number is on Do Not Call.');
  }
  await run(env, "UPDATE activities SET status = 'connecting', call_sid = ? WHERE id = ?", p.CallSid || null, a.id);
  const rec = (await recordingOn(env))
    ? ` record="record-from-start" recordingStatusCallback="${xml(`${url.origin}/api/twilio/recording?a=${a.id}`)}" recordingStatusCallbackEvent="completed"`
    : '';
  // The rep joins the room first. When the room starts, /conf-status dials the number into it (they hear it ring).
  return twiml(`<Dial><Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="true" waitUrl="" participantLabel="agent"${rec} statusCallback="${xml(`${url.origin}/api/twilio/conf-status?a=${a.id}`)}" statusCallbackEvent="start end leave">${room(a.id)}</Conference></Dial>`);
}, { public: true });

async function endConference(env, confSid) {
  if (confSid) await twilioPost(env, `Conferences/${confSid}.json`, { Status: 'completed' }).catch(() => {});
}

// Dial the number into the room. Safe to call twice (webhook and fallback): only the first caller dials.
async function startCustomer(env, a, confSid, origin) {
  const claim = await run(env, "UPDATE activities SET cust_sid = 'dialing' WHERE id = ? AND cust_sid IS NULL", a.id);
  if (!claim?.meta?.changes) return;
  const f = new URLSearchParams({
    From: a.from_num || env.TWILIO_FROM, To: a.to_num, EarlyMedia: 'true', Beep: 'false', EndConferenceOnExit: 'true', Timeout: '30', Label: 'customer',
    StatusCallback: `${origin}/api/twilio/cust-status?a=${a.id}`,
  });
  for (const e of ['initiated', 'ringing', 'answered', 'completed']) f.append('StatusCallbackEvent', e);
  try {
    const part = await twilioPost(env, `Conferences/${confSid}/Participants.json`, f);
    await run(env, 'UPDATE activities SET cust_sid = ?, conf_sid = ? WHERE id = ?', part.call_sid || 'unknown', confSid, a.id);
  } catch (e) {
    await run(env, "UPDATE activities SET status = 'failed', body = ? WHERE id = ?", String(e.message).slice(0, 300), a.id);
    await endConference(env, confSid);
  }
}

// One place that turns the outside line's Twilio status into our call status.
async function applyCustStatus(env, a, s, duration = 0, sip = '') {
  if (s === 'ringing') await run(env, "UPDATE activities SET status = 'ringing' WHERE id = ? AND status = 'connecting'", a.id);
  else if (s === 'in-progress') await run(env, "UPDATE activities SET status = 'in-progress', answered_at = COALESCE(answered_at, ?) WHERE id = ? AND status IN ('connecting','ringing','in-progress')", now(), a.id);
  else if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(s)) {
    const fresh = await first(env, 'SELECT status, answered_at FROM activities WHERE id = ?', a.id);
    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(fresh?.status)) return;
    const status = s === 'completed' && fresh?.answered_at ? 'completed' : s === 'completed' ? 'no-answer' : s;
    await run(env, 'UPDATE activities SET status = ?, duration = ? WHERE id = ?', status, Number(duration || 0), a.id);
    if (status === 'failed') await run(env, 'UPDATE activities SET body = ? WHERE id = ?', `The line would not connect${sip ? ` (code ${sip})` : ''}. Check the number.`, a.id);
    if (status !== 'completed') await endConference(env, a.conf_sid);
  }
}

route('POST', '/api/twilio/conf-status', async ({ env, request, url }) => {
  const p = await verifiedParams(env, request);
  const a = await first(env, 'SELECT * FROM activities WHERE id = ?', url.searchParams.get('a') || '');
  if (!a) return twiml('');
  const ev = p.StatusCallbackEvent;
  if (ev === 'conference-start') {
    await run(env, 'UPDATE activities SET conf_sid = ? WHERE id = ?', p.ConferenceSid || null, a.id);
    await startCustomer(env, a, p.ConferenceSid, url.origin);
  } else if (ev === 'conference-end') {
    // The rep hung up while it was still ringing: stop the outside call too.
    if (a.cust_sid && a.cust_sid.startsWith('CA') && !a.answered_at) {
      await twilioPost(env, `Calls/${a.cust_sid}.json`, { Status: 'canceled' }).catch(() => twilioPost(env, `Calls/${a.cust_sid}.json`, { Status: 'completed' }).catch(() => {}));
    }
    await run(env, `UPDATE activities SET status = CASE WHEN status IN ('connecting','ringing') THEN 'canceled' WHEN status = 'in-progress' THEN 'completed' ELSE status END, mon_sid = NULL WHERE id = ?`, a.id);
  } else if (ev === 'participant-leave' && p.CallSid && p.CallSid === a.mon_sid) {
    await run(env, 'UPDATE activities SET mon_sid = NULL, mon_by = NULL, mon_mode = NULL WHERE id = ?', a.id);
  }
  return twiml('');
}, { public: true });

// Status of the outside line: ringing, answered, then how it ended and how long it lasted.
route('POST', '/api/twilio/cust-status', async ({ env, request, url }) => {
  const p = await verifiedParams(env, request);
  const a = await first(env, 'SELECT * FROM activities WHERE id = ?', url.searchParams.get('a') || '');
  if (a) await applyCustStatus(env, { ...a, conf_sid: a.conf_sid || p.ConferenceSid }, p.CallStatus, p.CallDuration, p.SipResponseCode);
  return twiml('');
}, { public: true });

// A finished recording. Calls nobody answered have nothing worth keeping, so those are deleted.
route('POST', '/api/twilio/recording', async ({ env, request, url }) => {
  const p = await verifiedParams(env, request);
  const a = await first(env, 'SELECT * FROM activities WHERE id = ?', url.searchParams.get('a') || '');
  if (!a || !p.RecordingSid || (p.RecordingStatus && p.RecordingStatus !== 'completed')) return twiml('');
  const inbound = a.status === 'inbound' || a.status === 'inbound_answered' || a.type === 'call' && !a.to_num;
  if (!a.answered_at && !inbound && a.status !== 'completed') {
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Recordings/${p.RecordingSid}.json`, { method: 'DELETE', headers: { Authorization: twAuth(env) } }).catch(() => {});
    return twiml('');
  }
  await run(env, 'UPDATE activities SET rec_sid = ?, rec_secs = ? WHERE id = ?', p.RecordingSid, Number(p.RecordingDuration || 0), a.id);
  return twiml('');
}, { public: true });

// The rep's own call status (the call bar polls this), or any call for an owner.
const lastSync = new Map();
route('GET', '/api/voice/calls/:id', async ({ env, user, params, url }) => {
  requireStaff(user);
  let a = await first(env, 'SELECT * FROM activities WHERE id = ?', params.id);
  if (!a || (a.by !== user.id && user.role !== 'admin')) throw new HttpError('Call not found.', 404);
  // Webhooks can be late or lost, so while the call is live we also ask Twilio directly (at most every 1.5 seconds per call).
  const live = ['connecting', 'ringing', 'in-progress'].includes(a.status);
  if (live && a.to_num && a.call_sid && now() - a.at < 3600e3 && now() - (lastSync.get(a.id) || 0) > 1500) {
    lastSync.set(a.id, now());
    if (lastSync.size > 200) lastSync.clear();
    try {
      if (!a.cust_sid && now() - a.at > 2500) {
        const q = new URLSearchParams({ FriendlyName: room(a.id), Status: 'in-progress' });
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Conferences.json?${q}`, { headers: { Authorization: twAuth(env) } });
        const conf = (await res.json().catch(() => ({}))).conferences?.[0];
        if (conf?.sid) { await run(env, 'UPDATE activities SET conf_sid = ? WHERE id = ?', conf.sid, a.id); await startCustomer(env, a, conf.sid, url.origin); }
      } else if (a.cust_sid?.startsWith('CA')) {
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls/${a.cust_sid}.json`, { headers: { Authorization: twAuth(env) } });
        const c = await res.json().catch(() => ({}));
        if (res.ok && c.status && c.status !== 'queued') await applyCustStatus(env, a, c.status, c.duration, '');
      }
    } catch { /* the webhooks may still catch up */ }
    a = await first(env, 'SELECT * FROM activities WHERE id = ?', params.id);
  }
  return json({ status: a.status, answeredAt: a.answered_at, duration: a.duration, coached: Boolean(a.mon_by), error: a.status === 'failed' ? a.body || '' : '' });
});

// After the call: the disposition popup. Moves the lead along, or just labels the call when the number is not a lead.
// "Add as a new lead" creates the lead from the dialed number first.
route('POST', '/api/voice/calls/:id/disposition', async ({ env, user, params, body }) => {
  requireStaff(user);
  const a = await first(env, 'SELECT * FROM activities WHERE id = ?', params.id);
  if (!a || (a.by !== user.id && user.role !== 'admin')) throw new HttpError('Call not found.', 404);
  const b = await body();
  const d = await resolveDispo(env, b.dispo);
  if (!d) throw new HttpError('Pick a disposition.');
  const note = b.note ? String(b.note).trim().slice(0, 2000) : '';
  const callbackAt = b.callbackAt ? Number(new Date(b.callbackAt)) || null : null;
  let leadId = a.lead_id;
  if (!leadId && b.newLead?.business && a.to_num) {
    const business = String(b.newLead.business).trim().slice(0, 120);
    if (business) {
      const fields = { business, phone: a.to_num, source: 'dial out' };
      if (b.newLead.contact) fields.contact_name = b.newLead.contact;
      if (b.newLead.state) fields.state = b.newLead.state;
      leadId = await insertLead(env, cleanLead(fields), user.id);
      if (leadId) await run(env, 'UPDATE activities SET lead_id = ? WHERE id = ?', leadId, a.id);
    }
  }
  if (leadId) {
    const lead = await first(env, 'SELECT * FROM leads WHERE id = ?', leadId);
    if (lead) {
      if (d.acts === 'callback' && !callbackAt) throw new HttpError('Pick the callback time.');
      await recordOutcome(env, lead, { dispo: d.id, note, callbackAt, by: user.id, activityId: a.id });
      return json({ ok: true, leadId, dispo: d });
    }
  }
  await run(env, 'UPDATE activities SET outcome = ?, dispo = ?, note = ? WHERE id = ?', d.acts, d.label, note || null, a.id);
  return json({ ok: true, leadId: null, dispo: d });
});

// ---------- owner tools: live calls, listen, whisper, barge ----------
route('GET', '/api/voice/live', async ({ env, user }) => {
  requireAdmin(user);
  const rows = await all(env, `SELECT a.id, a.at, a.status, a.answered_at, a.to_num, a.from_num, a.by, a.mon_by, a.mon_mode, u.name AS rep, l.business
    FROM activities a LEFT JOIN users u ON u.id = a.by LEFT JOIN leads l ON l.id = a.lead_id
    WHERE a.conf_sid IS NOT NULL AND a.status IN ('connecting','ringing','in-progress') AND a.at > ? ORDER BY a.at DESC LIMIT 30`, now() - 4 * 3600e3);
  return json({ calls: rows.map((r) => ({ ...r, mine: r.mon_by === user.id })) });
});

route('POST', '/api/voice/monitor/:id', async ({ env, user, params, body }) => {
  requireAdmin(user);
  const mode = (await body()).mode;
  if (!MODES.includes(mode)) throw new HttpError('Pick listen, whisper or barge.');
  const a = await first(env, 'SELECT * FROM activities WHERE id = ?', params.id);
  if (!a || !LIVE.includes(a.status)) throw new HttpError('That call has ended.', 409);
  if (!a.mon_sid || !a.conf_sid || a.mon_by !== user.id) throw new HttpError('Join the call first.', 409);
  const f = mode === 'listen' ? { Muted: 'true', Coaching: 'false' }
    : mode === 'whisper' ? { Muted: 'false', Coaching: 'true', CallSidToCoach: a.call_sid }
      : { Muted: 'false', Coaching: 'false' };
  try { await twilioPost(env, `Conferences/${a.conf_sid}/Participants/${a.mon_sid}.json`, f); }
  catch (e) {
    if (/16000|agent conference|coach/i.test(e.message)) throw new HttpError('Whisper needs Agent Conference turned on in Twilio: Voice, Settings, Conferences.', 400);
    throw e;
  }
  await run(env, 'UPDATE activities SET mon_mode = ? WHERE id = ?', mode, a.id);
  return json({ ok: true, mode });
});

// ---------- recordings: owners hear every call, reps hear their own ----------
route('GET', '/api/recordings', async ({ env, user, url }) => {
  requireStaff(user);
  const rep = user.role === 'admin' ? url.searchParams.get('rep') || '' : user.id;
  const rows = await all(env, `SELECT a.id, a.at, a.type, a.status, a.duration, a.rec_secs, a.to_num, a.from_num, a.body, a.by, u.name AS rep, l.business, l.id AS lead_id
    FROM activities a LEFT JOIN users u ON u.id = a.by LEFT JOIN leads l ON l.id = a.lead_id
    WHERE a.rec_sid IS NOT NULL ${rep ? 'AND a.by = ?' : ''} ORDER BY a.at DESC LIMIT 200`, ...(rep ? [rep] : []));
  const reps = user.role === 'admin' ? await all(env, "SELECT id, name, email FROM users WHERE role IN ('admin','team') ORDER BY name") : [];
  return json({ recordings: rows, reps, canSeeAll: user.role === 'admin' });
});

async function recordingFor(env, user, id) {
  const a = await first(env, 'SELECT id, by, rec_sid FROM activities WHERE id = ?', id);
  if (!a?.rec_sid || (user.role !== 'admin' && a.by !== user.id)) throw new HttpError('Recording not found.', 404);
  return a;
}

route('GET', '/api/recordings/:id/audio', async ({ env, user, params, request }) => {
  requireStaff(user);
  const a = await recordingFor(env, user, params.id);
  const headers = { Authorization: twAuth(env) };
  const range = request.headers.get('range');
  if (range) headers.Range = range;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Recordings/${a.rec_sid}.mp3`, { headers });
  if (!res.ok && res.status !== 206) throw new HttpError('Twilio did not return the recording. It may have been deleted.', 502);
  const out = new Headers({ 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=3600', 'accept-ranges': 'bytes' });
  for (const h of ['content-length', 'content-range']) { const v = res.headers.get(h); if (v) out.set(h, v); }
  return new Response(res.body, { status: res.status, headers: out });
});

route('DELETE', '/api/recordings/:id', async ({ env, user, params }) => {
  requireAdmin(user);
  const a = await recordingFor(env, user, params.id);
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Recordings/${a.rec_sid}.json`, { method: 'DELETE', headers: { Authorization: twAuth(env) } }).catch(() => {});
  await run(env, 'UPDATE activities SET rec_sid = NULL, rec_secs = NULL WHERE id = ?', a.id);
  return json({ ok: true });
});

// ---------- owner setup: recording switch and which numbers send calls and texts to the Hub ----------
route('GET', '/api/voice/setup', async ({ env, user, url }) => {
  requireAdmin(user);
  if (!twilioReady(env)) return json({ ready: false, recording: false, numbers: [] });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json?PageSize=50`, { headers: { Authorization: twAuth(env) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(`Twilio: ${data.message || `HTTP ${res.status}`}`, 502);
  const voiceUrl = `${url.origin}/api/twilio/voice`;
  const smsUrl = `${url.origin}/api/twilio/sms`;
  const { sids: trackingSids } = await trackingSet(env);
  const numbers = (data.incoming_phone_numbers || []).filter((n) => !trackingSids.has(n.sid)).map((n) => ({
    sid: n.sid, number: n.phone_number, label: n.friendly_name,
    calls: n.voice_url === voiceUrl ? 'hub' : n.voice_url || n.voice_application_sid || n.trunk_sid ? 'other' : 'none',
    texts: n.sms_url === smsUrl ? 'hub' : n.sms_url || n.sms_application_sid ? 'other' : 'none',
  }));
  return json({ ready: true, recording: await recordingOn(env), numbers, main: env.TWILIO_FROM, tracking: trackingSids.size });
});

route('PUT', '/api/voice/setup', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  if ('recording' in b) await setSetting(env, 'call_recording', b.recording ? '1' : '0');
  return json({ ok: true, recording: await recordingOn(env) });
});

route('POST', '/api/voice/connect-numbers', async ({ env, user, url, body }) => {
  requireAdmin(user);
  if (!twilioReady(env)) throw new HttpError('Add the Twilio keys in Cloudflare first.', 503);
  if (isLocal(url.origin)) throw new HttpError('Connect numbers from the live Hub address, not a local preview.', 400);
  const sids = (await body()).sids;
  if (!Array.isArray(sids) || !sids.length) throw new HttpError('Pick at least one number.');
  const done = [];
  const { sids: trackingSids } = await trackingSet(env);
  for (const sid of sids.slice(0, 50)) {
    if (!/^PN[0-9a-f]{32}$/i.test(sid) || trackingSids.has(sid)) continue;
    await twilioPost(env, `IncomingPhoneNumbers/${sid}.json`, {
      VoiceUrl: `${url.origin}/api/twilio/voice`, VoiceMethod: 'POST', VoiceApplicationSid: '',
      SmsUrl: `${url.origin}/api/twilio/sms`, SmsMethod: 'POST',
    });
    done.push(sid);
  }
  resetNumberCache();
  return json({ ok: true, connected: done.length });
});

// Staff the browser phone should ring for an incoming call (only once browser calling is set up).
export async function browserIdentities(env) {
  const s = await getSettings(env).catch(() => ({}));
  if (!s.voice_cfg && !(env.TWILIO_API_KEY && env.TWILIO_TWIML_APP_SID)) return [];
  const rows = await all(env, "SELECT id FROM users WHERE role IN ('admin','team') ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, created_at LIMIT 9").catch(() => []);
  return rows.map((r) => identityFor(r.id));
}
