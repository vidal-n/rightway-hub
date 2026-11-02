// Texting and inbound calls through the Twilio number (same keys as calls.js).
// Rules baked in: texts go only to people who agreed (checked box on the audit form, they texted first, or you logged a
// verbal yes), never to STOP replies, never outside 8am to 8pm in their time zone. Carriers block unregistered 10DLC
// traffic, so outbound texts fail with error 30034 until the A2P campaign is approved.
import { HttpError, json } from './util.js';
import { all, first, run, now, newId } from './db.js';
import { requireStaff } from './auth.js';
import { e164, digits, inCallingHours, insertLead, logActivity } from './crm.js';
import { route } from './router.js';
import { twilioReady, verifiedParams, twiml, xml } from './calls.js';
import { browserIdentities } from './voice.js';

const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);
const START_WORDS = new Set(['start', 'unstop', 'yes']);

export function isStop(body) { return STOP_WORDS.has(String(body || '').trim().toLowerCase().replace(/[^a-z]/g, '')); }
export function isStart(body) { return START_WORDS.has(String(body || '').trim().toLowerCase().replace(/[^a-z]/g, '')); }

export const ERROR_HELP = {
  30034: 'Blocked by carriers: the number is not registered for texting yet (A2P campaign pending).',
  30007: 'The carrier filtered this message.',
  30003: 'Phone is unreachable or off.',
  30005: 'Unknown destination, probably a landline.',
  21610: 'This person replied STOP.',
  21211: 'Not a valid phone number.',
};

async function leadOr404(env, id) {
  const l = await first(env, 'SELECT * FROM leads WHERE id = ?', id);
  if (!l) throw new HttpError('Lead not found.', 404);
  return l;
}

export function canText(lead, hasInbound) {
  if (lead.sms_stop) return 'This person replied STOP. Do not text them.';
  if (lead.dnc) return 'This lead is on Do Not Call.';
  if (!lead.sms_consent && !hasInbound) return 'No permission to text yet. Ask on the call, then tap "They said yes to texts".';
  return null;
}

route('GET', '/api/inbox', async ({ env, user }) => {
  requireStaff(user);
  const rows = await all(env, `SELECT l.id, l.business, l.contact_name, l.phone, l.stage, l.sms_stop,
      m.body, m.direction, m.at, m.status,
      (SELECT COUNT(*) FROM messages u WHERE u.lead_id = l.id AND u.direction = 'in' AND u.read = 0) AS unread
    FROM leads l JOIN messages m ON m.id = (SELECT id FROM messages WHERE lead_id = l.id ORDER BY at DESC LIMIT 1)
    ORDER BY unread DESC, m.at DESC LIMIT 200`);
  return json({ conversations: rows, twilio: twilioReady(env) });
});

route('GET', '/api/inbox/unread', async ({ env, user }) => {
  requireStaff(user);
  const r = await first(env, "SELECT COUNT(*) AS n FROM messages WHERE direction = 'in' AND read = 0");
  return json({ unread: r?.n || 0 });
});

route('GET', '/api/leads/:id/messages', async ({ env, user, params }) => {
  requireStaff(user);
  const lead = await leadOr404(env, params.id);
  const messages = await all(env, 'SELECT id, direction, body, status, error, at FROM messages WHERE lead_id = ? ORDER BY at ASC LIMIT 500', lead.id);
  await run(env, "UPDATE messages SET read = 1 WHERE lead_id = ? AND direction = 'in' AND read = 0", lead.id);
  const hasInbound = messages.some((m) => m.direction === 'in');
  return json({
    messages: messages.map((m) => ({ ...m, error_text: m.error ? ERROR_HELP[m.error] || `Twilio error ${m.error}` : null })),
    blocked: canText(lead, hasInbound), consent: Boolean(lead.sms_consent), stopped: Boolean(lead.sms_stop), twilio: twilioReady(env),
  });
});

route('POST', '/api/leads/:id/sms-consent', async ({ env, user, params, body }) => {
  requireStaff(user);
  const lead = await leadOr404(env, params.id);
  const yes = Boolean((await body()).value);
  if (yes && lead.sms_stop) throw new HttpError('They replied STOP. Only they can undo that by replying START.', 409);
  await run(env, 'UPDATE leads SET sms_consent = ?, updated_at = ? WHERE id = ?', yes ? 1 : 0, now(), lead.id);
  await logActivity(env, { lead_id: lead.id, type: 'note', body: yes ? 'Agreed to texts (logged by rep)' : 'Text permission removed', by: user.id });
  return json({ ok: true, consent: yes });
});

route('POST', '/api/leads/:id/sms', async ({ env, user, url, params, body }) => {
  requireStaff(user);
  if (!twilioReady(env)) throw new HttpError('Texting needs the Twilio keys in Cloudflare.', 503);
  const lead = await leadOr404(env, params.id);
  let text = String((await body()).text || '').trim().slice(0, 600);
  if (!text) throw new HttpError('Type a message first.');
  const inbound = await first(env, "SELECT MAX(at) AS at FROM messages WHERE lead_id = ? AND direction = 'in'", lead.id).then((r) => (r?.at ? r : null));
  const why = canText(lead, Boolean(inbound));
  if (why) throw new HttpError(why, 409);
  const to = e164(lead.phone);
  if (!to) throw new HttpError('This lead has no valid phone number.');
  // Replying within 12 hours of their own text is a conversation, not outreach, so the clock check is skipped.
  const replying = inbound && now() - inbound.at < 12 * 3600e3;
  if (!replying && !inCallingHours(lead.timezone)) throw new HttpError("It's outside 8am to 8pm in their time zone, or their state is missing. Text later.", 409);
  const prior = await first(env, "SELECT 1 AS x FROM messages WHERE lead_id = ? AND direction = 'out' LIMIT 1", lead.id);
  if (!prior) {
    if (!/rightway/i.test(text)) text = `Rightway Growth: ${text}`;
    text += '\nReply STOP to opt out.';
  }
  const id = newId('m_');
  await run(env, "INSERT INTO messages (id, lead_id, direction, body, from_num, to_num, status, by, at, read) VALUES (?, ?, 'out', ?, ?, ?, 'queued', ?, ?, 1)", id, lead.id, text, env.TWILIO_FROM, to, user.id, now());
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: text, StatusCallback: `${url.origin}/api/twilio/sms-status` }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    await run(env, "UPDATE messages SET status = 'failed', error = ? WHERE id = ?", String(data.code || res.status), id);
    throw new HttpError(ERROR_HELP[data.code] || `Twilio: ${data.message || `HTTP ${res.status}`}`, 502);
  }
  await run(env, 'UPDATE messages SET sid = ?, status = ? WHERE id = ?', data.sid || null, data.status || 'queued', id);
  await logActivity(env, { lead_id: lead.id, type: 'sms', status: 'out', body: text, by: user.id });
  return json({ ok: true, id });
});

// Delivery receipts.
route('POST', '/api/twilio/sms-status', async ({ env, request }) => {
  const p = await verifiedParams(env, request);
  if (p.MessageSid) await run(env, 'UPDATE messages SET status = ?, error = ? WHERE sid = ?', p.MessageStatus || null, p.ErrorCode || null, p.MessageSid);
  return twiml('');
}, { public: true });

// A text arrived on the business number.
route('POST', '/api/twilio/sms', async ({ env, request }) => {
  const p = await verifiedParams(env, request);
  const from = e164(p.From);
  const body = String(p.Body || '').slice(0, 1600);
  if (!from) return twiml('');
  let lead = await first(env, 'SELECT * FROM leads WHERE phone_digits = ? ORDER BY updated_at DESC LIMIT 1', digits(from));
  let leadId = lead?.id;
  if (!leadId) {
    leadId = await insertLead(env, { business: `Unknown ${from}`, phone: from, phone_digits: digits(from), source: 'inbound text', sms_consent: 1 });
    lead = { id: leadId };
  }
  await run(env, "INSERT INTO messages (id, lead_id, direction, body, from_num, to_num, sid, status, at, read) VALUES (?, ?, 'in', ?, ?, ?, ?, 'received', ?, 0)", newId('m_'), leadId, body, from, p.To || null, p.MessageSid || null, now());
  if (isStop(body)) {
    await run(env, 'UPDATE leads SET sms_stop = 1, sms_consent = 0, updated_at = ? WHERE id = ?', now(), leadId);
    await logActivity(env, { lead_id: leadId, type: 'note', body: 'Replied STOP. No more texts.' });
  } else if (isStart(body)) {
    await run(env, 'UPDATE leads SET sms_stop = 0, sms_consent = 1, updated_at = ? WHERE id = ?', now(), leadId);
  } else {
    await run(env, 'UPDATE leads SET updated_at = ? WHERE id = ?', now(), leadId);
    await logActivity(env, { lead_id: leadId, type: 'sms', status: 'in', body });
  }
  return twiml(''); // Twilio sends the STOP and START confirmations itself.
}, { public: true });

// A call came in: ring the owner's phone, else say a short message.
async function forwardNumber(env) {
  const row = await first(env, "SELECT phone FROM users WHERE phone IS NOT NULL AND phone != '' AND role IN ('admin','team') ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, created_at LIMIT 1").catch(() => null);
  return row?.phone || null;
}

route('POST', '/api/twilio/voice', async ({ env, request, url }) => {
  const p = await verifiedParams(env, request);
  const from = e164(p.From);
  const lead = from && (await first(env, 'SELECT id, business FROM leads WHERE phone_digits = ? ORDER BY updated_at DESC LIMIT 1', digits(from)));
  const aid = await logActivity(env, { lead_id: lead?.id || null, type: 'call', status: 'inbound', body: from ? `Incoming call from ${from}` : 'Incoming call', call_sid: p.CallSid || null });
  // Ring every open Hub (browser phone) and the saved mobile, if any, at the same time. First to answer gets it.
  const clients = await browserIdentities(env);
  const cell = await forwardNumber(env);
  if (!clients.length && !cell) return twiml('<Say voice="Polly.Joanna">Thanks for calling Rightway Growth. Please send us a text and we will get right back to you.</Say><Hangup/>');
  const param = (k, v) => (v ? `<Parameter name="${k}" value="${xml(v)}"/>` : '');
  const nouns = clients.map((id) => `<Client><Identity>${xml(id)}</Identity>${param('caller', from)}${param('who', lead?.business)}${param('called', e164(p.To))}${param('leadId', lead?.id)}</Client>`).join('')
    + (cell ? `<Number>${xml(cell)}</Number>` : '');
  const callerId = e164(p.To) || env.TWILIO_FROM;
  return twiml(`<Dial callerId="${xml(callerId)}" answerOnBridge="true" timeout="20" record="do-not-record" action="${xml(`${url.origin}/api/twilio/voice-done?a=${aid}`)}">${nouns}</Dial>`);
}, { public: true });

route('POST', '/api/twilio/voice-done', async ({ env, request, url }) => {
  const p = await verifiedParams(env, request);
  const status = p.DialCallStatus || 'completed';
  await run(env, 'UPDATE activities SET status = ?, duration = ? WHERE id = ?', status === 'completed' ? 'inbound_answered' : 'missed', Number(p.DialCallDuration || 0), url.searchParams.get('a') || '');
  if (status === 'completed') return twiml('<Hangup/>');
  return twiml('<Say voice="Polly.Joanna">Thanks for calling Rightway Growth. We missed you. Send us a text and we will get right back to you.</Say><Hangup/>');
}, { public: true });
