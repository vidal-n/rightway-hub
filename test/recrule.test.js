import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, run, first } from '../src/db.js';
import { twilioSignature } from '../src/calls.js';
import { keepRecording, applyRecordingRule } from '../src/recrule.js';
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
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const s = String(u);
    seen.push({ url: s, method: init.method || 'GET' });
    if (s.endsWith('/Keys.json')) return Response.json({ sid: 'SKkey1', secret: 'keysecret' }, { status: 201 });
    if (s.endsWith('/Applications.json')) return Response.json({ sid: 'APapp1' }, { status: 201 });
    if (/\/Recordings\/RE[^/]+\.mp3$/.test(s)) return new Response('ID3fakeaudio', { status: 200, headers: { 'content-type': 'audio/mpeg', 'content-length': '12' } });
    if (/\/Recordings\/RE[^/]+\.json$/.test(s)) return new Response(null, { status: 204 });
    if (/\/Conferences\/CF[^/]+\.json$/.test(s)) return Response.json({ status: 'completed' });
    if (s.includes('/Participants.json')) return Response.json({ call_sid: 'CAcust1', conference_sid: 'CFroom1' }, { status: 201 });
    if (/\/Participants\//.test(s)) return Response.json({ ok: true });
    if (/\/Calls\/CA[^/]+\.json$/.test(s)) return Response.json({ status: 'completed', duration: '7' });
    if (s.includes('IncomingPhoneNumbers')) return Response.json({ incoming_phone_numbers: [] });
    return real(u, init);
  };
  return { seen, restore: () => { globalThis.fetch = real; } };
}
const deleted = (m, sid) => m.seen.some((x) => x.method === 'DELETE' && x.url.endsWith(`/Recordings/${sid}.json`));

test('keepRecording: owner, gatekeeper, answering service and DNC stay; the rest go', () => {
  assert.equal(keepRecording({ outcome: 'conversation' }), true);
  assert.equal(keepRecording({ outcome: 'booked' }), true);
  assert.equal(keepRecording({ outcome: 'gatekeeper' }), true);
  assert.equal(keepRecording({ outcome: 'dnc' }, 'dnc'), true);
  for (const o of ['voicemail', 'no_answer', 'phone_menu', 'bad_number', 'hung_up']) assert.equal(keepRecording({ outcome: o }), false, o);
});

async function dialed(t, to, sid) {
  const identity = (await t.call('GET', '/api/voice/token')).data.identity;
  const act = (await t.call('POST', '/api/voice/prepare', { to })).data.activityId;
  await hook(t, '/api/twilio/client-voice', { act, From: `client:${identity}`, CallSid: 'CA' + sid });
  await answered(t, act, sid);
  return act;
}
async function answered(t, act, sid) {
  await hook(t, `/api/twilio/conf-status?a=${act}`, { StatusCallbackEvent: 'conference-start', ConferenceSid: 'CF' + sid });
  await hook(t, `/api/twilio/cust-status?a=${act}`, { CallStatus: 'in-progress' });
  await hook(t, `/api/twilio/cust-status?a=${act}`, { CallStatus: 'completed', CallDuration: '40' });
}

test('recording rule: result first or recording first, kept when we reached someone, deleted when not', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const m = mockTwilio();
  try {
    await t.call('PUT', '/api/voice/setup', { recording: true });
    const list = (await t.call('GET', '/api/dispositions')).data.dispositions;
    const by = (acts) => list.find((d) => d.acts === acts)?.id;

    // Recording arrives first, then a voicemail result: deleted
    const a1 = await dialed(t, '7865550101', 'a1');
    await hook(t, `/api/twilio/recording?a=${a1}`, { RecordingSid: 'RE001', RecordingDuration: '30', RecordingStatus: 'completed' });
    assert.equal(deleted(m, 'RE001'), false, 'no result yet, so nothing is deleted');
    await t.call('POST', `/api/voice/calls/${a1}/disposition`, { dispo: by('voicemail') });
    assert.equal(deleted(m, 'RE001'), true);
    assert.equal((await first(t.env, 'SELECT rec_sid FROM activities WHERE id = ?', a1)).rec_sid, null);

    // Result first, then the recording: a gatekeeper call is kept
    const a2 = await dialed(t, '7865550102', 'a2');
    await t.call('POST', `/api/voice/calls/${a2}/disposition`, { dispo: by('gatekeeper') });
    await hook(t, `/api/twilio/recording?a=${a2}`, { RecordingSid: 'RE002', RecordingDuration: '45', RecordingStatus: 'completed' });
    assert.equal(deleted(m, 'RE002'), false);
    assert.equal((await first(t.env, 'SELECT rec_sid FROM activities WHERE id = ?', a2)).rec_sid, 'RE002');

    // Result first, then the recording: a phone menu is deleted
    const a3 = await dialed(t, '7865550103', 'a3');
    await t.call('POST', `/api/voice/calls/${a3}/disposition`, { dispo: by('phone_menu') });
    await hook(t, `/api/twilio/recording?a=${a3}`, { RecordingSid: 'RE003', RecordingDuration: '12', RecordingStatus: 'completed' });
    assert.equal(deleted(m, 'RE003'), true);

    // Owner conversation is kept
    const a4 = await dialed(t, '7865550104', 'a4');
    await hook(t, `/api/twilio/recording?a=${a4}`, { RecordingSid: 'RE004', RecordingDuration: '90', RecordingStatus: 'completed' });
    await t.call('POST', `/api/voice/calls/${a4}/disposition`, { dispo: by('conversation') });
    assert.equal(deleted(m, 'RE004'), false);

    // Kept recordings show in the Recordings list and can be searched
    let r = await t.call('GET', '/api/recordings');
    assert.equal(r.data.recordings.length, 2);
    r = await t.call('GET', '/api/recordings?q=7865550104');
    assert.equal(r.data.recordings.length, 1);
    r = await t.call('GET', '/api/recordings?q=zzzz');
    assert.equal(r.data.recordings.length, 0);

    // Switch off: nothing is deleted any more
    r = await t.call('PUT', '/api/voice/setup', { autoDelete: false });
    assert.equal(r.data.autoDelete, false);
    const a5 = await dialed(t, '7865550105', 'a5');
    await t.call('POST', `/api/voice/calls/${a5}/disposition`, { dispo: by('voicemail') });
    await hook(t, `/api/twilio/recording?a=${a5}`, { RecordingSid: 'RE005', RecordingDuration: '20', RecordingStatus: 'completed' });
    assert.equal(deleted(m, 'RE005'), false);
    assert.equal(await applyRecordingRule(t.env, a5), 'kept');
  } finally { m.restore(); }
});

test('lead page lists its kept recordings, and a lead search finds them by business and owner name', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const m = mockTwilio();
  try {
    await t.call('PUT', '/api/voice/setup', { recording: true });
    const lead = (await t.call('POST', '/api/leads', { business: 'Barajas Roofing', phone: '7865550166', owner_name: 'Luis Barajas', state: 'FL' })).data;
    const leadId = lead.id || lead.lead?.id;
    assert.ok(leadId);
    await run(t.env, 'UPDATE leads SET owner_name = ? WHERE id = ?', 'Luis Barajas', leadId);
    const identity = (await t.call('GET', '/api/voice/token')).data.identity;
    const act = (await t.call('POST', '/api/voice/prepare', { leadId })).data.activityId;
    await hook(t, '/api/twilio/client-voice', { act, From: `client:${identity}`, CallSid: 'CAb1' });
    await answered(t, act, 'b1');
    await hook(t, `/api/twilio/recording?a=${act}`, { RecordingSid: 'RE777', RecordingDuration: '120', RecordingStatus: 'completed' });
    const list = (await t.call('GET', '/api/dispositions')).data.dispositions;
    await t.call('POST', `/api/voice/calls/${act}/disposition`, { dispo: list.find((d) => d.acts === 'conversation').id });
    let r = await t.call('GET', `/api/leads/${leadId}/recordings`);
    assert.equal(r.status, 200);
    assert.equal(r.data.recordings.length, 1);
    for (const q of ['barajas', 'roofing', 'luis']) {
      r = await t.call('GET', `/api/recordings?q=${q}`);
      assert.equal(r.data.recordings.length, 1, q);
    }
  } finally { m.restore(); }
});
