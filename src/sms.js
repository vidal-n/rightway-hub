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
import { browserIdentities, recordingOn } from './voice.js';
import { trackedAnswer } from './calltrack.js';
import { voicemailTwiml } from './voicemail.js';
import { notify, notifyLater } from './notify.js';

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

const wf = (env, type, p, defer) => import('./workflows.js').then((m) => m.fire(env, type, p, defer)).catch(() => {});
route('GET', '/api/inbox', async ({ env, user }) => {
  requireStaff(user);
  const rows = await all(env, `SELECT l.id, l.business, l.contact_name, l.phone, l.stage, l.sms_stop,
      m.body, m.direction, m.at, m.status, m.to_num, m.from_num,
      (SELECT COUNT(*) FROM messages u WHERE u.lead_id = l.id AND u.direction = 'in' AND u.read = 0) AS unread
    FROM leads l JOIN messages m ON m.id = (SELECT id FROM messages WHERE lead_id = l.id ORDER BY at DESC LIMIT 1)
    ORDER BY unread DESC, m.at DESC LIMIT 200`);
  const hide = await import('./lines.js').then((m) => m.hiddenLines(env, user));
  const ours = (r) => e164(r.direction === 'in' ? r.to_num : r.from_num);
  return json({ conversations: rows.filter((r) => !hide.has(ours(r))), twilio: twilioReady(env) });
});

route('GET', '/api/inbox/unread', async ({ env, user }) => {
  requireStaff(user);
  const r = await first(env, "SELECT COUNT(*) AS n FROM messages WHERE direction = 'in' AND read = 0");
  const v = await first(env, "SELECT COUNT(*) AS n FROM activities WHERE type = 'call' AND status IN ('voicemail','missed') AND seen_at IS NULL AND at > ?", now() - 30 * 864e5).catch(() => null);
  return json({ unread: (r?.n || 0) + (v?.n || 0), texts: r?.n || 0, calls: v?.n || 0 });
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

// One path for every outbound text (Hub, dialer, Slack reply), so the consent, STOP and calling hours rules always apply.
// opts.replyToCall: a workflow answering a call they just made to us (missed call text back). It counts as their own contact for
// ONE text within 30 minutes of the call, the industry practice for a consumer started contact; STOP and do not call still block it.
export async function sendText(env, lead, rawText, user, origin, opts = {}) {
  if (!twilioReady(env)) throw new HttpError('Texting needs the Twilio keys in Cloudflare.', 503);
  let text = String(rawText || '').trim().slice(0, 600);
  if (!text) throw new HttpError('Type a message first.');
  let inbound = await first(env, "SELECT MAX(at) AS at FROM messages WHERE lead_id = ? AND direction = 'in'", lead.id).then((r) => (r?.at ? r : null));
  if (!inbound && opts.replyToCall) {
    const call = await first(env, "SELECT MAX(at) AS at FROM activities WHERE lead_id = ? AND type = 'call' AND status IN ('missed','voicemail','inbound')", lead.id);
    const sent = await first(env, "SELECT 1 AS x FROM messages WHERE lead_id = ? AND direction = 'out' AND at > ?", lead.id, (call?.at || 0));
    if (call?.at && now() - call.at < 30 * 60e3 && !sent) inbound = { at: call.at };
  }
  const why = canText(lead, Boolean(inbound));
  if (why) throw new HttpError(why, 409);
  const to = e164(lead.phone);
  if (!to) throw new HttpError('This lead has no valid phone number.');
  // Replying within 12 hours of their own text is a conversation, not outreach, so the clock check is skipped.
  const replying = inbound && now() - inbound.at < 12 * 3600e3;
  if (!replying && !inCallingHours(lead.timezone, Date.now(), lead.tz_alt, lead.state)) throw new HttpError("It's outside 8am to 8pm in their time zone, or their state is missing. Text later.", 409);
  const prior = await first(env, "SELECT 1 AS x FROM messages WHERE lead_id = ? AND direction = 'out' LIMIT 1", lead.id);
  if (!prior) {
    if (!/rightway/i.test(text)) text = `Rightway Growth: ${text}`;
    text += '\nReply STOP to opt out.';
  }
  // Keep the thread on one number: reply from whichever of our numbers they last texted or heard from.
  const last = await first(env, "SELECT CASE WHEN direction = 'in' THEN to_num ELSE from_num END AS ours FROM messages WHERE lead_id = ? ORDER BY at DESC LIMIT 1", lead.id);
  const fromNum = e164(last?.ours) || env.TWILIO_FROM;
  const id = newId('m_');
  await run(env, "INSERT INTO messages (id, lead_id, direction, body, from_num, to_num, status, by, at, read) VALUES (?, ?, 'out', ?, ?, ?, 'queued', ?, ?, 1)", id, lead.id, text, fromNum, to, user?.id || null, now());
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: fromNum, Body: text, StatusCallback: `${origin}/api/twilio/sms-status` }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    await run(env, "UPDATE messages SET status = 'failed', error = ? WHERE id = ?", String(data.code || res.status), id);
    throw new HttpError(ERROR_HELP[data.code] || `Twilio: ${data.message || `HTTP ${res.status}`}`, 502);
  }
  await run(env, 'UPDATE messages SET sid = ?, status = ? WHERE id = ?', data.sid || null, data.status || 'queued', id);
  await logActivity(env, { lead_id: lead.id, type: 'sms', status: 'out', body: text, by: user?.id || null });
  return id;
}

route('POST', '/api/leads/:id/sms', async ({ env, user, url, params, body }) => {
  requireStaff(user);
  if (!twilioReady(env)) throw new HttpError('Texting needs the Twilio keys in Cloudflare.', 503);
  const lead = await leadOr404(env, params.id);
  const id = await sendText(env, lead, (await body()).text, user, url.origin);
  return json({ ok: true, id });
});

// Delivery receipts.
route('POST', '/api/twilio/sms-status', async ({ env, request }) => {
  const p = await verifiedParams(env, request);
  if (p.MessageSid) await run(env, 'UPDATE messages SET status = ?, error = ? WHERE sid = ?', p.MessageStatus || null, p.ErrorCode || null, p.MessageSid);
  return twiml('');
}, { public: true });

// A text arrived on the business number.
route('POST', '/api/twilio/sms', async ({ env, request, defer }) => {
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
    await wf(env, 'text_in', { leadId, text: body }, defer);
    const lineOwner = await import('./lines.js').then((m) => m.ownerOfLine(env, p.To)).catch(() => null);
    if (lineOwner) {
      // A personal line: only its owner hears about it, and it can forward to their mobile.
      if (lineOwner.fwd_texts && lineOwner.phone) {
        defer?.(fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
          method: 'POST', headers: { Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ To: lineOwner.phone, From: e164(p.To), Body: `Text from ${lead.business || from} (${from}): ${body}`.slice(0, 1500) }).toString(),
        }).catch(() => {}));
      }
      await notifyLater({ env, defer }, { to: [lineOwner.id], kind: 'text', title: `Text from ${lead.business || from}`, body: body.slice(0, 160), url: '/#/phone/texts', tag: `text-${leadId}`, slack: false });
      return twiml('');
    }
    await notifyLater({ env, defer }, { to: 'staff', kind: 'text', title: `Text from ${lead.business || from}`, body: body.slice(0, 160), url: `/#/phone/texts`, tag: `text-${leadId}`, actions: [{ text: 'Reply', action_id: 'text_reply', value: leadId, style: 'primary' }] });
  }
  return twiml(''); // Twilio sends the STOP and START confirmations itself.
}, { public: true });

// A call came in: ring every teammate's saved mobile at the same time as the open Hubs (up to 5 phones).
async function forwardNumbers(env) {
  const rows = await all(env, "SELECT phone FROM users WHERE phone IS NOT NULL AND phone != '' AND role IN ('admin','team') ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, created_at LIMIT 5").catch(() => []);
  return [...new Set(rows.map((r) => e164(r.phone)).filter(Boolean))];
}
const prettyNum = (n) => { const d = String(n || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : n || ''; };

route('POST', '/api/twilio/voice', async ({ env, request, url, defer }) => {
  const p = await verifiedParams(env, request);
  const tracked = await trackedAnswer(env, p, url.origin);
  if (tracked) return tracked;
  const from = e164(p.From);
  const lead = from && (await first(env, 'SELECT id, business FROM leads WHERE phone_digits = ? ORDER BY updated_at DESC LIMIT 1', digits(from)));
  const aid = await logActivity(env, { lead_id: lead?.id || null, type: 'call', status: 'inbound', body: from ? `Incoming call from ${from}` : 'Incoming call', call_sid: p.CallSid || null });
  await run(env, 'UPDATE activities SET from_num = ?, to_num = ? WHERE id = ?', from || p.From || null, e164(p.To) || null, aid);
  // Ring every open Hub (browser phone) and the saved mobile, if any, at the same time. First to answer gets it.
  // A personal line rings only its owner: their open Hub, plus their mobile when they turned call forwarding on.
  const lineOwner = await import('./lines.js').then((m) => m.ownerOfLine(env, p.To)).catch(() => null);
  let clients = await browserIdentities(env);
  let cells = await forwardNumbers(env);
  if (lineOwner) {
    clients = clients.filter((id) => id === `rw_${lineOwner.id}`);
    cells = lineOwner.fwd_calls && lineOwner.phone ? [e164(lineOwner.phone)].filter(Boolean) : [];
    await run(env, 'UPDATE activities SET by = ? WHERE id = ?', lineOwner.id, aid);
  }
  const who = lead?.business || prettyNum(from) || 'Unknown caller';
  if (!clients.length && !cells.length) {
    await run(env, "UPDATE activities SET status = 'missed' WHERE id = ?", aid);
    await missedFlow(env, aid, from, defer);
    return twiml(await voicemailTwiml(env, url.origin, aid));
  }
  // A callback: the rep sees who it is and when we last called them.
  const last = lead ? await first(env, "SELECT at FROM activities WHERE lead_id = ? AND type = 'call' AND status NOT IN ('inbound','missed','voicemail','inbound_answered') ORDER BY at DESC LIMIT 1", lead.id) : null;
  const back = last && now() - last.at < 30 * 864e5 ? `Calling back (you called ${agoText(last.at)})` : '';
  const param = (k, v) => (v ? `<Parameter name="${k}" value="${xml(v)}"/>` : '');
  const nouns = clients.map((id) => `<Client><Identity>${xml(id)}</Identity>${param('caller', from)}${param('who', lead?.business)}${param('called', e164(p.To))}${param('leadId', lead?.id)}${param('context', back)}</Client>`).join('')
    + cells.map((n) => `<Number>${xml(n)}</Number>`).join('');
  // Phones and tablets with notifications on light up and buzz while it rings; saved mobiles ring as a normal call.
  await notifyLater({ env, defer }, { to: lineOwner ? [lineOwner.id] : 'staff', kind: 'call', title: `Incoming call: ${who}`, body: [prettyNum(from), back].filter(Boolean).join(' · ') || 'Answer in the Hub', url: '/#/phone/calls', tag: `call-${aid}`, urgent: true, slack: false });
  const callerId = e164(p.To) || env.TWILIO_FROM;
  const rec = (await recordingOn(env))
    ? `record="record-from-answer-dual" recordingStatusCallback="${xml(`${url.origin}/api/twilio/recording?a=${aid}`)}" recordingStatusCallbackEvent="completed"`
    : 'record="do-not-record"';
  return twiml(`<Dial callerId="${xml(callerId)}" answerOnBridge="true" timeout="20" ${rec} action="${xml(`${url.origin}/api/twilio/voice-done?a=${aid}`)}">${nouns}</Dial>`);
}, { public: true });

// A missed call starts the "Missed call" workflows. A caller we do not know becomes a lead first, like an unknown texter does.
async function missedFlow(env, aid, from, defer) {
  const num = e164(from);
  if (!num) return;
  let lead = await first(env, 'SELECT id FROM leads WHERE phone_digits = ? ORDER BY updated_at DESC LIMIT 1', digits(num));
  if (!lead) {
    // Only when a missed call workflow is on (it needs a lead to text); otherwise "Add as lead" on the call list stays the way in.
    const wants = await first(env, "SELECT 1 AS x FROM workflows WHERE enabled = 1 AND trigger LIKE '%missed_call%'").catch(() => null);
    if (!wants) return;
    const id = await insertLead(env, { business: `Caller ${num}`, phone: num, phone_digits: digits(num), source: 'inbound call' });
    lead = { id };
    await run(env, 'UPDATE activities SET lead_id = ? WHERE id = ? AND lead_id IS NULL', id, aid);
  }
  await wf(env, 'missed_call', { leadId: lead.id }, defer);
}

function agoText(at) {
  const h = Math.round((now() - at) / 3600e3);
  if (h < 1) return 'less than an hour ago';
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

route('POST', '/api/twilio/voice-done', async ({ env, request, url, defer }) => {
  const p = await verifiedParams(env, request);
  const status = p.DialCallStatus || 'completed';
  const aid = url.searchParams.get('a') || '';
  await run(env, 'UPDATE activities SET status = ?, duration = ? WHERE id = ?', status === 'completed' ? 'inbound_answered' : 'missed', Number(p.DialCallDuration || 0), aid);
  if (status === 'completed') return twiml('<Hangup/>');
  const a = await first(env, 'SELECT a.from_num, l.business FROM activities a LEFT JOIN leads l ON l.id = a.lead_id WHERE a.id = ?', aid);
  await missedFlow(env, aid, a?.from_num, defer);
  await notifyLater({ env, defer }, { to: 'staff', kind: 'voicemail', title: `Missed call: ${a?.business || prettyNum(a?.from_num) || 'Unknown caller'}`, body: 'They may leave a voicemail. Tap to call back.', url: '/#/phone/calls', tag: `call-${aid}`, slack: false, actions: [{ text: 'Mark heard', action_id: 'call_heard', value: aid }] });
  return twiml(await voicemailTwiml(env, url.origin, aid));
}, { public: true });
