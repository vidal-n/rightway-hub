// Calls back to the agency numbers: missed calls go to voicemail, the team gets an email, and the Inbox lists every
// inbound call (answered, missed, voicemail) with the recording, who it is, and a Call back button.
import { HttpError, json } from './util.js';
import { all, first, run, now, getSettings, setSetting } from './db.js';
import { requireStaff, requireAdmin } from './auth.js';
import { serveRecording } from './audio.js';
import { route } from './router.js';
import { verifiedParams, twiml, xml } from './calls.js';
import { e164, digits, insertLead, logActivity } from './crm.js';
import { canEmail, sendEmail } from './email.js';
import { notify } from './notify.js';

export const DEFAULT_GREETING = 'Thanks for calling Rightway Growth. Sorry we missed you. Please leave your name, your number, and what you need after the tone, and we will call you right back.';
const pretty = (n) => { const d = String(n || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : n || ''; };
const twAuth = (env) => `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`;

export async function greeting(env) {
  const s = await getSettings(env);
  return (s.vm_greeting || '').trim() || DEFAULT_GREETING;
}

// The voicemail part of a call: greeting, beep, up to 2 minutes. The recording lands on the call's activity.
export async function voicemailTwiml(env, origin, aid) {
  const cb = `${origin}/api/twilio/vm-recording?a=${encodeURIComponent(aid)}`;
  return `<Say voice="Polly.Joanna">${xml(await greeting(env))}</Say>`
    + `<Record maxLength="120" playBeep="true" trim="trim-silence" action="${xml(`${origin}/api/twilio/vm-done`)}" recordingStatusCallback="${xml(cb)}" recordingStatusCallbackEvent="completed"/>`;
}

route('POST', '/api/twilio/vm-done', async ({ env, request }) => {
  await verifiedParams(env, request);
  return twiml('<Say voice="Polly.Joanna">Thank you. Goodbye.</Say><Hangup/>');
}, { public: true });

route('POST', '/api/twilio/vm-recording', async ({ env, request, url }) => {
  const p = await verifiedParams(env, request);
  const a = await first(env, 'SELECT * FROM activities WHERE id = ?', url.searchParams.get('a') || '');
  const secs = Number(p.RecordingDuration || 0);
  if (!a || secs < 2 || !p.RecordingSid) return new Response(null, { status: 204 });
  await run(env, "UPDATE activities SET status = 'voicemail', vm_sid = ?, vm_secs = ?, seen_at = NULL WHERE id = ?", p.RecordingSid, secs, a.id);
  // A voicemail on someone's personal line goes only to them.
  const lineOwner = await import('./lines.js').then((m) => m.ownerOfLine(env, a.to_num)).catch(() => null);
  if (!lineOwner) await alertTeam(env, a, secs, url.origin).catch((e) => console.error('voicemail alert', e));
  const lead = a.lead_id ? await first(env, 'SELECT business FROM leads WHERE id = ?', a.lead_id) : null;
  await notify(env, { to: lineOwner ? [lineOwner.id] : 'staff', kind: 'voicemail', title: `Voicemail: ${lead?.business || pretty(a.from_num) || 'Unknown caller'}`, body: `${secs} seconds. Tap to listen and call back.`, url: '/#/phone/calls', tag: `call-${a.id}`, actions: [{ text: 'Mark heard', action_id: 'call_heard', value: a.id }] }).catch((e) => console.error('notify', e));
  return new Response(null, { status: 204 });
}, { public: true });

async function alertTeam(env, a, secs, origin) {
  if (!canEmail(env)) return false;
  const s = await getSettings(env);
  const to = (s.vm_alert_to || '').trim() || (await all(env, "SELECT email FROM users WHERE role = 'admin'")).map((u) => u.email).join(',');
  if (!to) return false;
  const lead = a.lead_id ? await first(env, 'SELECT business, contact_name FROM leads WHERE id = ?', a.lead_id) : null;
  const who = lead ? `${lead.business}${lead.contact_name ? ` (${lead.contact_name})` : ''}` : pretty(a.from_num) || 'an unknown number';
  await sendEmail(env, {
    to: to.split(',').map((x) => x.trim()).filter(Boolean),
    subject: `New voicemail from ${who}`,
    text: `${who} left a ${secs} second voicemail${a.from_num ? ` from ${pretty(a.from_num)}` : ''}.\n\nListen and call back from the Hub: ${origin}/#/phone/calls\n\nRightway Hub`,
  });
  return true;
}

const callOut = (r) => ({
  id: r.id, at: r.at, status: r.status, from: r.from_num || null, fromPretty: pretty(r.from_num), to: r.to_num || null, duration: r.duration || 0,
  voicemail: Boolean(r.vm_sid), vmSecs: r.vm_secs || 0, seen: Boolean(r.seen_at), recording: Boolean(r.rec_sid),
  lead: r.lead_id ? { id: r.lead_id, business: r.business, contact: r.contact_name, stage: r.stage } : null,
  calledBack: Boolean(r.called_back),
});

route('GET', '/api/calls/inbound', async ({ env, user, url }) => {
  requireStaff(user);
  const f = url.searchParams.get('filter') || 'all';
  const extra = f === 'voicemail' ? " AND a.status = 'voicemail'" : f === 'missed' ? " AND a.status IN ('missed','voicemail')" : '';
  const rows = await all(env, `SELECT a.*, l.business, l.contact_name, l.stage,
      (SELECT COUNT(*) FROM activities o WHERE o.type = 'call' AND o.at > a.at AND o.status NOT IN ('inbound','missed','voicemail','inbound_answered')
        AND (o.lead_id = a.lead_id OR (a.from_num IS NOT NULL AND o.to_num = a.from_num))) AS called_back
    FROM activities a LEFT JOIN leads l ON l.id = a.lead_id
    WHERE a.type = 'call' AND a.status IN ('inbound','inbound_answered','missed','voicemail') AND a.at > ?${extra} ORDER BY a.at DESC LIMIT 200`, now() - 60 * 864e5);
  const s = await getSettings(env);
  const hide = await import('./lines.js').then((m) => m.hiddenLines(env, user));
  rows.splice(0, rows.length, ...rows.filter((r) => !hide.has(r.to_num)));
  return json({ calls: rows.map(callOut), unseen: rows.filter((r) => ['missed', 'voicemail'].includes(r.status) && !r.seen_at).length,
    greeting: await greeting(env), custom: Boolean((s.vm_greeting || '').trim()), alertTo: s.vm_alert_to || '' });
});

route('POST', '/api/calls/inbound/:id/seen', async ({ env, user, params, body }) => {
  requireStaff(user);
  const b = await body();
  await run(env, `UPDATE activities SET seen_at = ? WHERE id = ? AND type = 'call'`, b.unseen ? null : now(), params.id);
  return json({ ok: true });
});

route('POST', '/api/calls/inbound/seen-all', async ({ env, user }) => {
  requireStaff(user);
  await run(env, "UPDATE activities SET seen_at = ? WHERE type = 'call' AND status IN ('missed','voicemail') AND seen_at IS NULL", now());
  return json({ ok: true });
});

route('GET', '/api/voicemail/:id/audio', async ({ env, user, params, request, url }) => {
  requireStaff(user);
  const a = await first(env, 'SELECT id, vm_sid, to_num FROM activities WHERE id = ?', params.id);
  if (!a?.vm_sid) throw new HttpError('No voicemail on this call.', 404);
  if ((await import('./lines.js').then((m) => m.hiddenLines(env, user))).has(a.to_num)) throw new HttpError('No voicemail on this call.', 404);
  const res = await serveRecording(env, request, { sid: a.vm_sid, twilioUrl: `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Recordings/${a.vm_sid}.mp3`, twilioAuth: twAuth(env), filename: `voicemail-${a.id}.mp3`, download: Boolean(url.searchParams.get('download')), gone: 'Twilio did not return the voicemail. It may have been deleted.' });
  if (!request.headers.get('range')) await run(env, 'UPDATE activities SET seen_at = COALESCE(seen_at, ?) WHERE id = ?', now(), a.id);
  return res;
});

// Unknown caller: add them as a lead so the callback, texts and notes live somewhere.
route('POST', '/api/calls/inbound/:id/lead', async ({ env, user, params, body }) => {
  requireStaff(user);
  const a = await first(env, 'SELECT * FROM activities WHERE id = ?', params.id);
  if (!a) throw new HttpError('Call not found.', 404);
  if (a.lead_id) return json({ leadId: a.lead_id });
  const from = e164(a.from_num);
  if (!from) throw new HttpError('This caller had no number to save.');
  const existing = await first(env, 'SELECT id FROM leads WHERE phone_digits = ? LIMIT 1', digits(from));
  const b = await body();
  const leadId = existing?.id || await insertLead(env, { business: String(b.business || '').trim().slice(0, 120) || `Caller ${pretty(from)}`, phone: from, source: 'inbound call', stage: 'new' }, user.id);
  await run(env, 'UPDATE activities SET lead_id = ? WHERE lead_id IS NULL AND type = ? AND from_num = ?', leadId, 'call', a.from_num);
  await logActivity(env, { lead_id: leadId, type: 'note', body: 'Added from an inbound call', by: user.id });
  return json({ leadId });
});

route('PUT', '/api/voicemail/settings', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  if ('greeting' in b) await setSetting(env, 'vm_greeting', String(b.greeting || '').replace(/[<>]/g, '').trim().slice(0, 500));
  if ('alertTo' in b) {
    const list = String(b.alertTo || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (list.some((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) throw new HttpError('One of those emails does not look right.');
    await setSetting(env, 'vm_alert_to', list.join(', '));
  }
  return json({ ok: true, greeting: await greeting(env) });
});
