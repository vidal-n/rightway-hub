import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { twilioSignature } from '../src/calls.js';
import { voiceToken, identityFor } from '../src/voice.js';
import { d1, r2 } from './shims.mjs';

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
function setup() {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+13055073393' };
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const h = { 'x-rw': '1', ...headers };
    if (cookie) h.cookie = cookie;
    let payload;
    if (typeof body === 'string') payload = body;
    else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
  };
  return { env, call };
}
const hook = async (t, path, params) => t.call('POST', path, new URLSearchParams(params).toString(), { ...FORM, 'x-twilio-signature': await twilioSignature('tok', `https://hub.test${path}`, params) });

function mockTwilio() {
  const seen = [];
  const state = { cust: 'queued' };
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const s = String(u);
    seen.push({ url: s, body: init.body ? new URLSearchParams(init.body) : null });
    if (s.endsWith('/Keys.json')) return Response.json({ sid: 'SKkey1', secret: 'keysecret' }, { status: 201 });
    if (s.endsWith('/Applications.json')) return Response.json({ sid: 'APapp1' }, { status: 201 });
    if (s.includes('/Participants.json')) return Response.json({ call_sid: 'CAcust1', conference_sid: 'CFroom1' }, { status: 201 });
    if (/\/Participants\/CA[^/]+\.json$/.test(s)) return Response.json({ ok: true });
    if (/\/Conferences\/CF[^/]+\.json$/.test(s)) return Response.json({ status: 'completed' });
    if (/\/Calls\/CA[^/]+\.json$/.test(s)) return Response.json({ status: init.method === 'POST' ? 'canceled' : state.cust, duration: '7' });
    if (s.includes('/Conferences.json?')) return Response.json({ conferences: [{ sid: 'CFlost1' }] });
    if (/\/Recordings\/RE[^/]+\.mp3$/.test(s)) return new Response('ID3fakeaudio', { status: 200, headers: { 'content-type': 'audio/mpeg', 'content-length': '12' } });
    if (/\/Recordings\/RE[^/]+\.json$/.test(s)) return new Response(null, { status: 204 });
    if (/\/IncomingPhoneNumbers\/PN[^/]+\.json$/.test(s)) return Response.json({ sid: 'PN1' });
    if (s.includes('IncomingPhoneNumbers')) return Response.json({ incoming_phone_numbers: [{ sid: 'PN' + 'a'.repeat(32), phone_number: '+13055073393', capabilities: { voice: true }, voice_url: 'https://hub.test/api/twilio/voice', sms_url: '' }, { sid: 'PN' + 'b'.repeat(32), phone_number: '+19547374725', capabilities: { voice: true }, voice_url: '', sms_url: '' }] });
    return real(u, init);
  };
  return { seen, state, restore: () => { globalThis.fetch = real; } };
}

test('voice token is a Twilio access token signed with the key secret', async () => {
  const tok = await voiceToken({ accountSid: 'AC1', keySid: 'SK1', keySecret: 'sec', appSid: 'AP1', identity: 'rw_u1', at: 1000, ttl: 3600 });
  const [h, p, sig] = tok.split('.');
  const dec = (x) => JSON.parse(Buffer.from(x, 'base64url').toString());
  assert.deepEqual(dec(h), { alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' });
  const body = dec(p);
  assert.equal(body.iss, 'SK1'); assert.equal(body.sub, 'AC1'); assert.equal(body.exp, 4600);
  assert.equal(body.grants.identity, 'rw_u1');
  assert.equal(body.grants.voice.outgoing.application_sid, 'AP1');
  assert.equal(body.grants.voice.incoming.allow, true);
  const { createHmac } = await import('node:crypto');
  assert.equal(sig, createHmac('sha256', 'sec').update(`${h}.${p}`).digest('base64url'));
});

test('browser calling: owner token sets up Twilio once, prepared calls dial from the chosen number, others are refused', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const m = mockTwilio();
  try {
    let r = await t.call('GET', '/api/voice/token');
    assert.equal(r.data.ready, true);
    assert.match(r.data.identity, /^rw_/);
    assert.equal(m.seen.filter((x) => x.url.endsWith('/Keys.json')).length, 1);
    const appReq = m.seen.find((x) => x.url.endsWith('/Applications.json'));
    assert.equal(appReq.body.get('VoiceUrl'), 'https://hub.test/api/twilio/client-voice');
    // Second token: no new Twilio setup, same app
    r = await t.call('GET', '/api/voice/token');
    assert.equal(m.seen.filter((x) => x.url.endsWith('/Keys.json')).length, 1);
    const payload = JSON.parse(Buffer.from(r.data.token.split('.')[1], 'base64url').toString());
    assert.equal(payload.grants.voice.outgoing.application_sid, 'APapp1');
    assert.equal(payload.iss, 'SKkey1');
    const identity = r.data.identity;

    // Bad caller ID and premium numbers are refused before anything rings
    r = await t.call('POST', '/api/voice/prepare', { to: '9545550188', from: '+15555550000' });
    assert.equal(r.status, 400);
    r = await t.call('POST', '/api/voice/prepare', { to: '9005550188' });
    assert.equal(r.status, 400);

    r = await t.call('POST', '/api/voice/prepare', { to: '(954) 555-0188', from: '+19547374725' });
    assert.equal(r.status, 200);
    const act = r.data.activityId;
    // Someone else's browser cannot use this call id
    r = await hook(t, '/api/twilio/client-voice', { act, From: 'client:rw_someoneelse', CallSid: 'CA1' });
    assert.match(r.data, /could not be placed/);
    // Unsigned request refused
    r = await t.call('POST', '/api/twilio/client-voice', new URLSearchParams({ act, From: `client:${identity}` }).toString(), { ...FORM, 'x-twilio-signature': 'nope' });
    assert.equal(r.status, 403);
    // The rep's own browser joins a private conference room; nothing is recorded while recording is off
    r = await hook(t, '/api/twilio/client-voice', { act, From: `client:${identity}`, CallSid: 'CAagent1' });
    assert.match(r.data, new RegExp(`<Conference[^>]*>rw_${act}</Conference>`));
    assert.match(r.data, /endConferenceOnExit="true"/);
    assert.doesNotMatch(r.data, /record=/);
    // Same call id cannot be reused
    r = await hook(t, '/api/twilio/client-voice', { act, From: `client:${identity}`, CallSid: 'CA3' });
    assert.match(r.data, /could not be placed/);
    // Room starts: the Hub dials the number into it from the chosen caller ID, once
    r = await hook(t, `/api/twilio/conf-status?a=${act}`, { StatusCallbackEvent: 'conference-start', ConferenceSid: 'CFroom1' });
    r = await hook(t, `/api/twilio/conf-status?a=${act}`, { StatusCallbackEvent: 'conference-start', ConferenceSid: 'CFroom1' });
    const parts = m.seen.filter((x) => x.url.endsWith('/Conferences/CFroom1/Participants.json'));
    assert.equal(parts.length, 1);
    assert.equal(parts[0].body.get('From'), '+19547374725');
    assert.equal(parts[0].body.get('To'), '+19545550188');
    assert.equal(parts[0].body.get('EarlyMedia'), 'true');
    r = await t.call('GET', `/api/voice/calls/${act}`);
    assert.equal(r.data.status, 'connecting'); // Twilio still says queued
    await hook(t, `/api/twilio/cust-status?a=${act}`, { CallStatus: 'ringing' });
    assert.equal((await t.call('GET', `/api/voice/calls/${act}`)).data.status, 'ringing');
    await hook(t, `/api/twilio/cust-status?a=${act}`, { CallStatus: 'in-progress' });
    m.state.cust = 'in-progress';
    assert.equal((await t.call('GET', `/api/voice/calls/${act}`)).data.status, 'in-progress');
    // Owner sees it live and can join to listen, then switch to whisper and barge
    r = await t.call('GET', '/api/voice/live');
    assert.equal(r.data.calls.length, 1);
    r = await t.call('POST', `/api/voice/monitor/${act}`, { mode: 'whisper' });
    assert.equal(r.status, 409); // must join first
    r = await hook(t, '/api/twilio/client-voice', { monitor: act, mode: 'listen', From: `client:${identity}`, CallSid: 'CAboss1' });
    assert.match(r.data, /muted="true"/);
    assert.match(r.data, /endConferenceOnExit="false"/);
    r = await t.call('POST', `/api/voice/monitor/${act}`, { mode: 'whisper' });
    assert.equal(r.data.mode, 'whisper');
    const upd = m.seen.filter((x) => x.url.endsWith('/Conferences/CFroom1/Participants/CAboss1.json')).pop();
    assert.equal(upd.body.get('Coaching'), 'true');
    assert.equal(upd.body.get('CallSidToCoach'), 'CAagent1');
    r = await t.call('POST', `/api/voice/monitor/${act}`, { mode: 'barge' });
    assert.equal(m.seen.filter((x) => x.url.endsWith('/Participants/CAboss1.json')).pop().body.get('Muted'), 'false');
    // A non-owner identity cannot join
    r = await hook(t, '/api/twilio/client-voice', { monitor: act, mode: 'listen', From: 'client:rw_nobody', CallSid: 'CAx' });
    assert.match(r.data, /Only an owner/);
    // Call ends: duration saved, nothing live
    m.state.cust = 'completed';
    await hook(t, `/api/twilio/cust-status?a=${act}`, { CallStatus: 'completed', CallDuration: '95' });
    assert.equal((await t.call('GET', `/api/voice/calls/${act}`)).data.duration, 95);
    assert.equal((await t.call('GET', '/api/voice/live')).data.calls.length, 0);
    r = await t.call('GET', '/api/dialer/recent');
    assert.equal(r.data.calls.length, 1);

    // Webhooks lost: the Hub still finds the room, dials the number, and follows the call by asking Twilio
    m.state.cust = 'queued';
    const actL = (await t.call('POST', '/api/voice/prepare', { to: '7865550999' })).data.activityId;
    await hook(t, '/api/twilio/client-voice', { act: actL, From: `client:${identity}`, CallSid: 'CAagentL' });
    await new Promise((res) => setTimeout(res, 2600));
    r = await t.call('GET', `/api/voice/calls/${actL}`);
    assert.ok(m.seen.some((x) => x.url.endsWith('/Conferences/CFlost1/Participants.json')));
    await new Promise((res) => setTimeout(res, 1600));
    m.state.cust = 'ringing';
    assert.equal((await t.call('GET', `/api/voice/calls/${actL}`)).data.status, 'ringing');
    await new Promise((res) => setTimeout(res, 1600));
    m.state.cust = 'in-progress';
    assert.equal((await t.call('GET', `/api/voice/calls/${actL}`)).data.status, 'in-progress');
    await new Promise((res) => setTimeout(res, 1600));
    m.state.cust = 'completed';
    assert.equal((await t.call('GET', `/api/voice/calls/${actL}`)).data.status, 'completed');
    m.state.cust = 'queued';

    // Recording on: next call records from the start, and the finished recording is playable
    r = await t.call('PUT', '/api/voice/setup', { recording: true });
    assert.equal(r.data.recording, true);
    const act2 = (await t.call('POST', '/api/voice/prepare', { to: '7865550123' })).data.activityId;
    r = await hook(t, '/api/twilio/client-voice', { act: act2, From: `client:${identity}`, CallSid: 'CAagent2' });
    assert.match(r.data, /record="record-from-start"/);
    await hook(t, `/api/twilio/conf-status?a=${act2}`, { StatusCallbackEvent: 'conference-start', ConferenceSid: 'CFroom2' });
    await hook(t, `/api/twilio/cust-status?a=${act2}`, { CallStatus: 'in-progress' });
    await hook(t, `/api/twilio/cust-status?a=${act2}`, { CallStatus: 'completed', CallDuration: '40' });
    await hook(t, `/api/twilio/recording?a=${act2}`, { RecordingSid: 'RE111', RecordingDuration: '42', RecordingStatus: 'completed' });
    r = await t.call('GET', '/api/recordings');
    assert.equal(r.data.recordings.length, 1);
    r = await t.call('GET', `/api/recordings/${act2}/audio`);
    assert.equal(r.status, 200);
    // Unanswered call: its recording is deleted, not kept
    const act3 = (await t.call('POST', '/api/voice/prepare', { to: '7865550124' })).data.activityId;
    await hook(t, '/api/twilio/client-voice', { act: act3, From: `client:${identity}`, CallSid: 'CAagent3' });
    await hook(t, `/api/twilio/conf-status?a=${act3}`, { StatusCallbackEvent: 'conference-start', ConferenceSid: 'CFroom3' });
    await hook(t, `/api/twilio/cust-status?a=${act3}`, { CallStatus: 'no-answer' });
    assert.ok(m.seen.some((x) => x.url.endsWith('/Conferences/CFroom3.json') && x.body?.get('Status') === 'completed'));
    await hook(t, `/api/twilio/recording?a=${act3}`, { RecordingSid: 'RE222', RecordingDuration: '20', RecordingStatus: 'completed' });
    assert.equal((await t.call('GET', '/api/recordings')).data.recordings.length, 1);
    // Incoming calls get recorded too while it is on
    r = await hook(t, '/api/twilio/voice', { From: '+17865550199', To: '+13055073393', CallSid: 'CAin1' });
    assert.match(r.data, /record="record-from-answer-dual"/);

    // Phone setup lists numbers and connects them
    r = await t.call('GET', '/api/voice/setup');
    assert.equal(r.data.numbers.length, 2);
    assert.equal(r.data.numbers[0].calls, 'hub');
    assert.equal(r.data.numbers[1].calls, 'none');
    r = await t.call('POST', '/api/voice/connect-numbers', { sids: ['PN' + 'b'.repeat(32)] });
    assert.equal(r.data.connected, 1);
    const pn = m.seen.filter((x) => x.url.endsWith(`/IncomingPhoneNumbers/PN${'b'.repeat(32)}.json`)).pop();
    assert.equal(pn.body.get('VoiceUrl'), 'https://hub.test/api/twilio/voice');
    assert.equal(pn.body.get('SmsUrl'), 'https://hub.test/api/twilio/sms');

    // A team member: no live calls, no setup, only their own recordings
    const inv = await t.call('POST', '/api/team/invite', { email: 'rep@rightwaygrowth.com', name: 'Rep', role: 'team' });
    if (inv.status === 200 && inv.data.inviteUrl) {
      await t.call('POST', '/api/auth/logout', {});
      const tokenStr = inv.data.inviteUrl.split('/#/invite/')[1];
      const acc = await t.call('POST', '/api/auth/invite/accept', { token: tokenStr, name: 'Rep', password: 'another long password' });
      assert.equal(acc.status, 200, JSON.stringify(acc.data));
      assert.equal((await t.call('GET', '/api/voice/live')).status, 403);
      assert.equal((await t.call('GET', '/api/voice/setup')).status, 403);
      assert.equal((await t.call('GET', '/api/recordings')).data.recordings.length, 0);
      assert.equal((await t.call('GET', `/api/recordings/${act2}/audio`)).status, 404);
      assert.equal((await t.call('POST', `/api/voice/monitor/${act}`, { mode: 'listen' })).status, 403);
      await t.call('POST', '/api/auth/logout', {});
      await t.call('POST', '/api/auth/login', { email: 'v@rightwaygrowth.com', password: 'correct horse battery' });
    } else {
      assert.fail(`invite flow changed: ${inv.status} ${JSON.stringify(inv.data)}`);
    }

    // Lead calls follow DNC
    const lead = (await t.call('POST', '/api/leads', { business: 'Shore Plumbing', phone: '3055550142', state: 'FL' })).data.lead;
    await t.call('POST', `/api/leads/${lead.id}/outcome`, { outcome: 'dnc' });
    r = await t.call('POST', '/api/voice/prepare', { leadId: lead.id });
    assert.equal(r.status, 409);

    // Incoming calls ring the browser phone (no mobile saved), with the caller's number passed along
    r = await hook(t, '/api/twilio/voice', { From: '+17865550111', To: '+19547374725', CallSid: 'CA9' });
    assert.match(r.data, new RegExp(`<Client><Identity>${identity}</Identity>`));
    assert.match(r.data, /name="caller" value="\+17865550111"/);
    assert.match(r.data, /callerId="\+19547374725"/);
    assert.doesNotMatch(r.data, /<Number>/);
  } finally { m.restore(); }
});

test('identities are safe for Twilio', () => {
  assert.equal(identityFor('u_ab-c.d'), 'rw_u_abcd');
});

test('owner can promote a teammate to owner and back, not themselves', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const inv = await t.call('POST', '/api/team/invite', { email: 'kiron@rightwaygrowth.com', name: 'Kiron', role: 'team' });
  const { users } = (await t.call('GET', '/api/team')).data;
  const kiron = users.find((u) => u.email === 'kiron@rightwaygrowth.com');
  const me = users.find((u) => u.email === 'v@rightwaygrowth.com');
  assert.equal((await t.call('PUT', `/api/users/${me.id}/role`, { role: 'team' })).status, 400);
  assert.equal((await t.call('PUT', `/api/users/${kiron.id}/role`, { role: 'boss' })).status, 400);
  assert.equal((await t.call('PUT', `/api/users/${kiron.id}/role`, { role: 'admin' })).status, 200);
  assert.equal((await t.call('GET', '/api/team')).data.users.find((u) => u.id === kiron.id).role, 'admin');
  assert.equal((await t.call('PUT', `/api/users/${kiron.id}/role`, { role: 'team' })).status, 200);
  // a team member cannot change roles
  await t.call('POST', '/api/auth/logout', {});
  const acc = await t.call('POST', '/api/auth/invite/accept', { token: inv.data.inviteUrl.split('/#/invite/')[1], password: 'another long password' });
  assert.equal(acc.status, 200);
  assert.equal((await t.call('PUT', `/api/users/${me.id}/role`, { role: 'team' })).status, 403);
  assert.equal((await t.call('PUT', `/api/users/${kiron.id}/role`, { role: 'admin' })).status, 403);
});

test('custom dispositions: owner edits the list, results drive the lead, dial out popup can add a lead', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  let r = await t.call('GET', '/api/dispositions');
  assert.equal(r.data.dispositions.length, 16);
  assert.equal(r.data.dispositions.find((d) => d.id === "not_owner").acts, "gatekeeper");
  assert.equal(r.data.custom, false);
  // Bad lists are refused
  assert.equal((await t.call('PUT', '/api/dispositions', { dispositions: [] })).status, 400);
  assert.equal((await t.call('PUT', '/api/dispositions', { dispositions: [{ label: 'X', acts: 'explode' }] })).status, 400);
  r = await t.call('PUT', '/api/dispositions', { dispositions: [
    { label: 'Left voicemail #2', acts: 'voicemail' }, { label: 'Owner busy, call Tuesday', acts: 'callback' },
    { label: 'Already has an agency', acts: 'not_interested' }, { label: 'Wrong person', acts: 'none' }, { id: 'dnc', label: 'Do not call', acts: 'dnc' },
  ] });
  assert.equal(r.status, 200);
  const list = r.data.dispositions;
  assert.equal(list.length, 5);
  assert.ok(list.every((d) => d.id));
  assert.equal((await t.call('GET', '/api/dispositions')).data.custom, true);

  const lead = (await t.call('POST', '/api/leads', { business: 'Bay Roofing', phone: '9545550101', state: 'FL' })).data.lead;
  // Callback kind needs a time
  r = await t.call('POST', `/api/leads/${lead.id}/outcome`, { dispo: list[1].id });
  assert.equal(r.status, 400);
  r = await t.call('POST', `/api/leads/${lead.id}/outcome`, { dispo: list[1].id, callbackAt: '2030-01-08T10:00' });
  assert.equal(r.data.lead.stage, 'callback');
  // "Just log it" leaves the stage alone, history shows the custom name
  r = await t.call('POST', `/api/leads/${lead.id}/outcome`, { dispo: list[3].id, note: 'Spoke to the receptionist' });
  assert.equal(r.data.lead.stage, 'callback');
  r = await t.call('GET', `/api/leads/${lead.id}`);
  assert.ok(r.data.activities.some((a) => a.dispo === 'Wrong person'));
  // Old style built in names still work
  r = await t.call('POST', `/api/leads/${lead.id}/outcome`, { outcome: 'conversation' });
  assert.equal(r.data.lead.stage, 'follow_up');

  // Dial out popup: unknown number, add as a new lead with a callback
  const m = mockTwilio();
  try {
    await t.call('GET', '/api/voice/token');
    const prep = (await t.call('POST', '/api/voice/prepare', { to: '(305) 555-0777' })).data;
    r = await t.call('POST', `/api/voice/calls/${prep.activityId}/disposition`, { dispo: list[1].id, note: 'Wants pricing', callbackAt: '2030-02-01T15:00', newLead: { business: 'Keys Pool Care', contact: 'Ana', state: 'FL' } });
    assert.equal(r.status, 200);
    assert.ok(r.data.leadId);
    const nl = (await t.call('GET', `/api/leads/${r.data.leadId}`)).data;
    assert.equal(nl.lead.business, 'Keys Pool Care');
    assert.equal(nl.lead.stage, 'callback');
    assert.equal(nl.lead.phone_digits || nl.lead.phone.replace(/\D/g, '').slice(-10), '3055550777');
    // Unknown number, no lead: just labels the call
    const prep2 = (await t.call('POST', '/api/voice/prepare', { to: '(305) 555-0778' })).data;
    r = await t.call('POST', `/api/voice/calls/${prep2.activityId}/disposition`, { dispo: list[3].id });
    assert.equal(r.data.leadId, null);
    r = await t.call('GET', '/api/dialer/recent');
    assert.ok(r.data.calls.some((c) => c.dispo === 'Wrong person'));
  } finally { m.restore(); }

  // Reset to default
  r = await t.call('PUT', '/api/dispositions', { reset: true });
  assert.equal(r.data.dispositions.length, 16);
});

test('agents: status, presence, login time, live call, analytics with handle time and lead quality', async () => {
  const { callStats, statusTime, isConnect, handleSecs, bucketOf } = await import('../public/js/callstats.js');
  assert.equal(isConnect({ answered_at: 1, duration: 40, outcome: 'voicemail' }), false, 'a machine is not a contact');
  assert.equal(isConnect({ outcome: 'hung_up' }), true);
  assert.equal(handleSecs({ at: 0, answered_at: 5000, duration: 60, dispo_at: 95000 }), 95);
  assert.equal(handleSecs({ at: 0, answered_at: 5000, duration: 60, dispo_at: 5 * 3600e3 }), 60 + 900, 'a forgotten popup is capped');
  assert.equal(bucketOf(29), 0); assert.equal(bucketOf(400), 3);
  const s = callStats([
    { at: 0, by: 'u1', outcome: 'booked', answered_at: 1, duration: 420, source: 'csv', grade: 'A', hour: 10 },
    { at: 0, by: 'u1', outcome: 'no_answer', source: 'csv', grade: 'B', hour: 10 },
    { at: 0, by: 'u2', outcome: 'not_interested', answered_at: 1, duration: 25, source: 'web', grade: 'A', hour: 11 },
    { at: 0, status: 'inbound', duration: 100 },
  ], { users: [{ id: 'u1', name: 'Vidal' }] });
  assert.equal(s.total.dials, 3);
  assert.equal(s.total.connects, 2);
  assert.equal(s.total.booked, 1);
  assert.equal(s.agents[0].label, 'Vidal');
  assert.equal(s.grades.find((g) => g.key === 'A').booked, 1);
  assert.equal(s.buckets[3].booked, 1, '5 to 10 minute calls booked');
  assert.equal(statusTime([{ status: 'available', start_at: 0, end_at: 3600e3 }, { status: 'break', start_at: 3600e3, end_at: null }], 0, 4000e3).login, 4000);

  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  let r = await t.call('POST', '/api/me/presence');
  assert.equal(r.data.status, 'available', 'opening the Hub logs you in');
  r = await t.call('POST', '/api/me/status', { status: 'lunch' });
  assert.equal(r.status, 200);
  assert.equal((await t.call('POST', '/api/me/status', { status: 'napping' })).status, 400);
  r = await t.call('GET', '/api/agents');
  assert.equal(r.data.agents[0].status, 'lunch');
  assert.equal(r.data.agents[0].online, true);
  assert.equal(r.data.canMonitor, true);
  r = await t.call('GET', '/api/analytics/calls?days=7');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.inventory));
  await t.call('POST', '/api/auth/logout');
});

test('listen, whisper and barge: always explained, never silently missing', async () => {
  const { joinState } = await import('../src/agents.js');
  const boss = { id: 'u1', role: 'admin' }, rep = { id: 'u2', role: 'team' }, other = { id: 'u3', role: 'admin' };
  assert.deepEqual(joinState(boss, { by: 'u2', status: 'in-progress', conf_sid: 'CF1' }, rep), { ok: true, why: '' });
  assert.equal(joinState(boss, { by: 'u2', status: 'ringing', conf_sid: 'CF1' }, rep).ok, true, 'can listen while it rings');
  assert.match(joinState(boss, { by: 'u1', status: 'in-progress', conf_sid: 'CF1' }, boss).why, /your own/);
  assert.match(joinState(boss, { by: 'u3', status: 'in-progress', conf_sid: 'CF1' }, other).why, /Owners cannot/);
  const early = joinState(boss, { by: 'u2', status: 'connecting', conf_sid: null }, rep);
  assert.equal(early.ok, false); assert.equal(early.wait, true); assert.match(early.why, /Starting up/);
  assert.match(joinState(boss, { by: 'u2', status: 'in-progress', conf_sid: null }, rep).why, /phone number/);
  assert.equal(joinState(rep, { by: 'u3', status: 'in-progress', conf_sid: 'CF1' }, other).ok, false, 'teammates never monitor');
});

test('recordings play whole, seek with ranges, and download', async () => {
  const { serveRecording } = await import('../src/audio.js');
  const store = new Map();
  const env = { MEDIA: {
    async head(k) { const v = store.get(k); return v ? { size: v.length } : null; },
    async put(k, v) { store.set(k, new Uint8Array(v)); },
    async get(k, o) { const v = store.get(k); if (!v) return null; const r = o?.range; return { body: r ? v.slice(r.offset, r.offset + r.length) : v }; },
    async delete(k) { store.delete(k); },
  } };
  const mp3 = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
  const realFetch = globalThis.fetch;
  let hits = 0;
  globalThis.fetch = async () => { hits++; return new Response(mp3, { status: 200 }); };
  try {
    const ask = (range, download) => serveRecording(env, new Request('https://x.test/a', { headers: range ? { range } : {} }), { sid: 'RE1', twilioUrl: 'https://api.twilio.com/x.mp3', twilioAuth: 'Basic x', filename: 'call-1.mp3', download });
    let r = await ask();
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-length'), '1000');
    assert.equal(r.headers.get('accept-ranges'), 'bytes');
    assert.equal((await r.arrayBuffer()).byteLength, 1000);
    r = await ask('bytes=500-');
    assert.equal(r.status, 206);
    assert.equal(r.headers.get('content-range'), 'bytes 500-999/1000');
    assert.equal((await r.arrayBuffer()).byteLength, 500);
    r = await ask('bytes=0-99');
    assert.equal(r.headers.get('content-length'), '100');
    assert.equal((await ask('bytes=2000-')).status, 416);
    r = await ask(null, true);
    assert.match(r.headers.get('content-disposition'), /attachment; filename="call-1.mp3"/);
    assert.equal(hits, 1, 'Twilio is asked once, then the kept copy answers every seek');
  } finally { globalThis.fetch = realFetch; }
});
