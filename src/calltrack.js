// Call tracking (Phase 7): Twilio numbers per client that forward to the client's own line. Every call is logged with where it
// came from (the number's source, like "Google profile" or "Website"), answered or missed, and a new caller or not. Missed calls go to a
// short voicemail and an email alert. Recording is off by default; when on, callers hear "This call may be recorded" first (Florida law).
import { HttpError, json } from './util.js';
import { all, first, run, newId, now } from './db.js';
import { requireStaff, requireAdmin, requireClientAccess } from './auth.js';
import { route } from './router.js';
import { e164 } from './crm.js';
import { verifiedParams, twiml, xml, twilioReady, resetNumberCache } from './calls.js';
import { canEmail, sendEmail } from './email.js';

const tw = (env) => `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}`;
const auth = (env) => `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`;
const isLocal = (origin) => /\/\/(localhost|127\.|0\.0\.0\.0)/.test(origin);
const pretty = (n) => { const d = String(n || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : n || ''; };
export const SOURCES = ['Google profile', 'Website', 'Google Ads', 'Facebook', 'Print or signs', 'Other'];

async function twGet(env, path) {
  const res = await fetch(`${tw(env)}/${path}`, { headers: { Authorization: auth(env) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(`Twilio: ${data.message || `HTTP ${res.status}`}`, 502);
  return data;
}
async function twPost(env, path, fields) {
  const res = await fetch(`${tw(env)}/${path}`, { method: 'POST', headers: { Authorization: auth(env), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(`Twilio: ${data.message || `HTTP ${res.status}`}`, 502);
  return data;
}

// Numbers that belong to clients, so the agency dialer and "Connect all" leave them alone.
export async function trackingSet(env) {
  const rows = await all(env, "SELECT number, sid FROM tracking_numbers WHERE status = 'active'").catch(() => []);
  return { numbers: new Set(rows.map((r) => r.number)), sids: new Set(rows.map((r) => r.sid).filter(Boolean)) };
}

const monthRange = (m) => { const [y, mo] = m.split('-').map(Number); return [Date.UTC(y, mo - 1, 1), Date.UTC(y, mo, 1)]; };
const thisMonth = () => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

export async function callStats(env, clientId, a, b) {
  const rows = await all(env, 'SELECT status, duration, first_time, source FROM tracked_calls WHERE client_id = ? AND started_at >= ? AND started_at < ?', clientId, a, b);
  const answered = rows.filter((r) => r.status === 'answered');
  const by = new Map();
  for (const r of rows) by.set(r.source || 'Other', (by.get(r.source || 'Other') || 0) + 1);
  return {
    total: rows.length, answered: answered.length, missed: rows.filter((r) => r.status === 'missed' || r.status === 'voicemail').length,
    voicemail: rows.filter((r) => r.status === 'voicemail').length, firstTime: rows.filter((r) => r.first_time).length,
    avgSecs: answered.length ? Math.round(answered.reduce((s, r) => s + (r.duration || 0), 0) / answered.length) : 0,
    bySource: [...by.entries()].map(([source, n]) => ({ source, n })).sort((x, y) => y.n - x.n),
  };
}

// ---------- the call itself ----------
// Answers a call to a tracking number. Also used by /api/twilio/voice if a tracking number ever points there.
export async function trackedAnswer(env, p, origin) {
  const to = e164(p.To);
  const num = to && await first(env, "SELECT * FROM tracking_numbers WHERE number = ? AND status = 'active'", to);
  if (!num) return null;
  const from = e164(p.From) || p.From || '';
  let call = p.CallSid ? await first(env, 'SELECT id FROM tracked_calls WHERE call_sid = ?', p.CallSid) : null;
  if (!call) {
    const seen = from ? await first(env, 'SELECT id FROM tracked_calls WHERE client_id = ? AND from_num = ? LIMIT 1', num.client_id, from) : null;
    const id = newId('tc_');
    await run(env, `INSERT INTO tracked_calls (id, client_id, number_id, call_sid, from_num, from_city, from_state, to_num, source, status, started_at, first_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ringing', ?, ?)`, id, num.client_id, num.id, p.CallSid || null, from, p.FromCity || p.CallerCity || null, p.FromState || p.CallerState || null,
    to, num.source, now(), seen ? 0 : 1);
    call = { id };
  }
  const notice = num.record ? '<Say voice="Polly.Joanna">This call may be recorded.</Say>' : '';
  const recCb = `${origin}/api/twilio/track-recording?c=${call.id}&k=rec`;
  const rec = num.record ? `record="record-from-answer-dual" recordingStatusCallback="${xml(recCb)}" recordingStatusCallbackEvent="completed"` : 'record="do-not-record"';
  return twiml(`${notice}<Dial timeout="25" answerOnBridge="true" ${rec} action="${xml(`${origin}/api/twilio/track-done?c=${call.id}`)}"><Number>${xml(num.forward_to)}</Number></Dial>`);
}

route('POST', '/api/twilio/track-voice', async ({ env, request, url }) => {
  const p = await verifiedParams(env, request);
  const res = await trackedAnswer(env, p, url.origin);
  return res || twiml('<Say voice="Polly.Joanna">Sorry, this number is not in service.</Say><Hangup/>');
}, { public: true });

async function missedAlert(env, call, client, num) {
  const to = num?.alert_to || client?.contact_email;
  if (!to || !canEmail(env)) return false;
  const when = new Date(call.started_at).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' });
  await sendEmail(env, {
    to, subject: `Missed call from ${pretty(call.from_num) || 'a caller'}`,
    text: `You missed a call at ${when} from ${pretty(call.from_num) || 'an unknown number'}${call.from_city ? ` (${call.from_city}${call.from_state ? `, ${call.from_state}` : ''})` : ''}.\nIt came in on your ${num?.source || 'tracking'} number.\n\nCall them back soon: most people call the next business on the list. If they leave a voicemail it shows up in your Rightway app.\n\nRightway Growth`,
  });
  return true;
}

route('POST', '/api/twilio/track-done', async ({ env, request, url }) => {
  const p = await verifiedParams(env, request);
  const call = await first(env, 'SELECT * FROM tracked_calls WHERE id = ?', url.searchParams.get('c') || '');
  if (!call) return twiml('<Hangup/>');
  const answered = p.DialCallStatus === 'completed';
  await run(env, 'UPDATE tracked_calls SET status = ?, duration = ?, ended_at = ? WHERE id = ?', answered ? 'answered' : 'missed', answered ? Number(p.DialCallDuration || 0) : 0, now(), call.id);
  if (answered) return twiml('<Hangup/>');
  const [client, num] = await Promise.all([
    first(env, 'SELECT id, name, contact_email FROM clients WHERE id = ?', call.client_id),
    first(env, 'SELECT * FROM tracking_numbers WHERE id = ?', call.number_id),
  ]);
  await missedAlert(env, call, client, num).catch((e) => console.error('missed call alert', e));
  const vmCb = `${url.origin}/api/twilio/track-recording?c=${call.id}&k=vm`;
  return twiml(`<Say voice="Polly.Joanna">Thanks for calling ${xml(client?.name || 'us')}. Sorry we missed you. Please leave your name, number, and what you need after the tone, and we will call you back.</Say>`
    + `<Record maxLength="120" playBeep="true" trim="trim-silence" action="${xml(`${url.origin}/api/twilio/track-vm-done`)}" recordingStatusCallback="${xml(vmCb)}" recordingStatusCallbackEvent="completed"/>`);
}, { public: true });

route('POST', '/api/twilio/track-vm-done', async ({ env, request }) => {
  await verifiedParams(env, request);
  return twiml('<Hangup/>');
}, { public: true });

route('POST', '/api/twilio/track-recording', async ({ env, request, url }) => {
  const p = await verifiedParams(env, request);
  const id = url.searchParams.get('c') || '';
  const secs = Number(p.RecordingDuration || 0);
  if (url.searchParams.get('k') === 'vm') {
    if (secs >= 2) await run(env, "UPDATE tracked_calls SET vm_sid = ?, vm_secs = ?, status = 'voicemail' WHERE id = ?", p.RecordingSid || null, secs, id);
  } else {
    await run(env, 'UPDATE tracked_calls SET rec_sid = ?, rec_secs = ? WHERE id = ?', p.RecordingSid || null, secs, id);
  }
  return new Response('', { status: 204 });
}, { public: true });

// ---------- managing numbers ----------
async function clientOr404(env, id) {
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', id);
  if (!c) throw new HttpError('Client not found.', 404);
  return c;
}
const numOut = (n) => ({ id: n.id, number: n.number, pretty: pretty(n.number), source: n.source, forward_to: n.forward_to, forwardPretty: pretty(n.forward_to), record: Boolean(n.record), alert_to: n.alert_to || '', status: n.status, created_at: n.created_at });
const callOut = (c) => ({
  id: c.id, from: c.from_num, fromPretty: pretty(c.from_num), city: [c.from_city, c.from_state].filter(Boolean).join(', '), source: c.source,
  status: c.status, duration: c.duration || 0, at: c.started_at, firstTime: Boolean(c.first_time), recording: Boolean(c.rec_sid), voicemail: Boolean(c.vm_sid), vmSecs: c.vm_secs || 0,
});

route('GET', '/api/clients/:id/calls', async ({ env, user, params, url }) => {
  requireClientAccess(user, params.id);
  const staff = user.role !== 'client';
  const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : thisMonth();
  const [a, b] = monthRange(month);
  const [nums, calls, stats] = await Promise.all([
    all(env, "SELECT * FROM tracking_numbers WHERE client_id = ? AND status = 'active' ORDER BY created_at", params.id),
    all(env, 'SELECT * FROM tracked_calls WHERE client_id = ? AND started_at >= ? AND started_at < ? ORDER BY started_at DESC LIMIT 300', params.id, a, b),
    callStats(env, params.id, a, b),
  ]);
  return json({ month, numbers: nums.map(numOut), calls: calls.map(callOut), stats, ...(staff ? { twilio: twilioReady(env), sources: SOURCES, email: canEmail(env) } : {}) });
});

// Search numbers to buy, near the client's area code.
route('GET', '/api/calltrack/available', async ({ env, user, url }) => {
  requireAdmin(user);
  if (!twilioReady(env)) throw new HttpError('Add the Twilio keys in Cloudflare first.', 503);
  const area = (url.searchParams.get('area') || '').replace(/\D/g, '').slice(0, 3);
  const q = new URLSearchParams({ VoiceEnabled: 'true', PageSize: '8', ...(area.length === 3 ? { AreaCode: area } : {}) });
  const d = await twGet(env, `AvailablePhoneNumbers/US/Local.json?${q}`);
  return json({ numbers: (d.available_phone_numbers || []).map((n) => ({ number: n.phone_number, pretty: pretty(n.phone_number), city: [n.locality, n.region].filter(Boolean).join(', ') })) });
});

route('POST', '/api/clients/:id/tracking-numbers', async ({ env, user, params, url, body }) => {
  requireAdmin(user);
  if (!twilioReady(env)) throw new HttpError('Add the Twilio keys in Cloudflare first.', 503);
  if (isLocal(url.origin)) throw new HttpError('Set up tracking numbers from the live Hub address, not a local preview.', 400);
  const c = await clientOr404(env, params.id);
  const b = await body();
  const forward = e164(b.forward_to || c.phone);
  if (!forward) throw new HttpError('Enter the client\'s phone number to forward calls to.');
  const mine = await trackingSet(env);
  if (mine.numbers.has(forward)) throw new HttpError('Calls cannot forward to another tracking number.');
  const source = SOURCES.includes(b.source) ? b.source : 'Other';
  const hooks = { VoiceUrl: `${url.origin}/api/twilio/track-voice`, VoiceMethod: 'POST', VoiceApplicationSid: '', FriendlyName: `Rightway: ${c.name} (${source})`.slice(0, 64) };
  let bought;
  if (b.sid) {
    if (!/^PN[0-9a-f]{32}$/i.test(b.sid)) throw new HttpError('That number is not valid.');
    if (mine.sids.has(b.sid)) throw new HttpError('That number already tracks calls for a client.');
    bought = await twPost(env, `IncomingPhoneNumbers/${b.sid}.json`, hooks);
  } else {
    const want = e164(b.number);
    if (!want) throw new HttpError('Pick a number.');
    bought = await twPost(env, 'IncomingPhoneNumbers.json', { PhoneNumber: want, ...hooks });
  }
  const id = newId('tn_');
  await run(env, `INSERT INTO tracking_numbers (id, client_id, number, sid, source, forward_to, record, alert_to, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    id, c.id, bought.phone_number, bought.sid, source, forward, b.record ? 1 : 0, String(b.alert_to || '').trim().slice(0, 200) || null, now());
  resetNumberCache();
  await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', newId('l_'), c.id, `Call tracking number ${pretty(bought.phone_number)} set up for ${source}`, now(), user.id);
  return json({ number: numOut(await first(env, 'SELECT * FROM tracking_numbers WHERE id = ?', id)) });
});

route('PATCH', '/api/tracking-numbers/:id', async ({ env, user, params, body }) => {
  requireStaff(user);
  const n = await first(env, 'SELECT * FROM tracking_numbers WHERE id = ?', params.id);
  if (!n) throw new HttpError('Number not found.', 404);
  const b = await body();
  const forward = 'forward_to' in b ? e164(b.forward_to) : n.forward_to;
  if (!forward) throw new HttpError('Enter a phone number to forward to.');
  if (forward !== n.forward_to && (await trackingSet(env)).numbers.has(forward)) throw new HttpError('Calls cannot forward to another tracking number.');
  await run(env, 'UPDATE tracking_numbers SET source = ?, forward_to = ?, record = ?, alert_to = ? WHERE id = ?',
    SOURCES.includes(b.source) ? b.source : n.source, forward, 'record' in b ? (b.record ? 1 : 0) : n.record, 'alert_to' in b ? (String(b.alert_to || '').trim().slice(0, 200) || null) : n.alert_to, n.id);
  return json({ number: numOut(await first(env, 'SELECT * FROM tracking_numbers WHERE id = ?', n.id)) });
});

// Release gives the number back to Twilio (billing stops). Keep stops tracking but leaves the number on the account.
route('DELETE', '/api/tracking-numbers/:id', async ({ env, user, params, url }) => {
  requireAdmin(user);
  const n = await first(env, 'SELECT * FROM tracking_numbers WHERE id = ?', params.id);
  if (!n) throw new HttpError('Number not found.', 404);
  if (n.sid && twilioReady(env)) {
    if (url.searchParams.get('keep') === '1') await twPost(env, `IncomingPhoneNumbers/${n.sid}.json`, { VoiceUrl: '', FriendlyName: n.number }).catch(() => null);
    else {
      const res = await fetch(`${tw(env)}/IncomingPhoneNumbers/${n.sid}.json`, { method: 'DELETE', headers: { Authorization: auth(env) } });
      if (!res.ok && res.status !== 404) throw new HttpError(`Twilio would not release the number (HTTP ${res.status}).`, 502);
    }
  }
  await run(env, "UPDATE tracking_numbers SET status = 'released', released_at = ? WHERE id = ?", now(), n.id);
  resetNumberCache();
  return json({ ok: true });
});

// Recording or voicemail audio, streamed from Twilio. The client can play their own calls.
route('GET', '/api/tracked-calls/:id/audio', async ({ env, user, params, url, request }) => {
  const c = await first(env, 'SELECT * FROM tracked_calls WHERE id = ?', params.id);
  if (!c) throw new HttpError('Call not found.', 404);
  requireClientAccess(user, c.client_id);
  const sid = url.searchParams.get('k') === 'vm' ? c.vm_sid : c.rec_sid;
  if (!sid) throw new HttpError('No audio for this call.', 404);
  const headers = { Authorization: auth(env) };
  const range = request.headers.get('range');
  if (range) headers.Range = range;
  const res = await fetch(`${tw(env)}/Recordings/${sid}.mp3`, { headers });
  if (!res.ok && res.status !== 206) throw new HttpError('Twilio did not return the audio. It may have been deleted.', 502);
  const out = new Headers({ 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=3600', 'accept-ranges': 'bytes' });
  for (const h of ['content-length', 'content-range']) { const v = res.headers.get(h); if (v) out.set(h, v); }
  return new Response(res.body, { status: res.status, headers: out });
});
