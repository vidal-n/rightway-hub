import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, first, all } from '../src/db.js';
import { twilioSignature } from '../src/calls.js';
import { d1, r2 } from './shims.mjs';

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const PN = 'PN' + 'a'.repeat(32);
function setup(extra = {}) {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+13055073393', ...extra };
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
  return { env, call, cookie: () => cookie, setCookie: (c) => { cookie = c; } };
}
const hook = async (t, path, params) => t.call('POST', path, new URLSearchParams(params).toString(), { ...FORM, 'x-twilio-signature': await twilioSignature('tok', `https://hub.test${path}`, params) });

function fakeTwilio() {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const url = String(u);
    if (url.includes('api.resend.com')) { seen.push({ url, method: 'POST', body: JSON.parse(init.body) }); return Response.json({ id: 'em' }); }
    if (!url.startsWith('https://api.twilio.com')) return real(u, init);
    const method = init.method || 'GET';
    const body = init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : {};
    seen.push({ url, method, body });
    if (url.includes('/AvailablePhoneNumbers/')) return Response.json({ available_phone_numbers: [{ phone_number: '+19545550199', locality: 'Hollywood', region: 'FL' }] });
    if (url.endsWith('/IncomingPhoneNumbers.json') && method === 'POST') return Response.json({ sid: PN, phone_number: body.PhoneNumber });
    if (url.includes('/IncomingPhoneNumbers.json')) return Response.json({ incoming_phone_numbers: [
      { sid: 'PN' + 'b'.repeat(32), phone_number: '+13055073393', friendly_name: 'Main', capabilities: { voice: true } },
      { sid: PN, phone_number: '+19545550199', friendly_name: 'Rightway: Sunrise', capabilities: { voice: true } },
    ] });
    if (url.includes(`/IncomingPhoneNumbers/${PN}.json`)) return method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ sid: PN, phone_number: '+19545550199' });
    if (url.includes('/Recordings/')) return new Response('MP3DATA', { headers: { 'content-type': 'audio/mpeg' } });
    return Response.json({ message: `unexpected ${method} ${url}` }, { status: 400 });
  };
  return { seen, restore: () => { globalThis.fetch = real; } };
}

test('call tracking: number set up, calls forward and are logged, missed calls get voicemail and an alert, stats add up', async () => {
  const t = setup({ RESEND_API_KEY: 're_test' });
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const c = (await t.call('POST', '/api/clients', { name: 'Sunrise Roofing', plan: 'authority', phone: '(954) 555-0142', contact_email: 'maria@sunrise.example' })).data.client;
  const tw = fakeTwilio();
  try {
    let r = await t.call('GET', '/api/calltrack/available?area=954');
    assert.equal(r.data.numbers[0].pretty, '(954) 555-0199');
    r = await t.call('POST', `/api/clients/${c.id}/tracking-numbers`, { number: '+19545550199', source: 'Google profile' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.number.forward_to, '+19545550142', 'defaults to the client phone');
    const buy = tw.seen.find((s) => s.method === 'POST' && s.url.endsWith('/IncomingPhoneNumbers.json'));
    assert.equal(buy.body.VoiceUrl, 'https://hub.test/api/twilio/track-voice');
    assert.equal(buy.body.PhoneNumber, '+19545550199');
    // cannot forward to a tracking number
    assert.equal((await t.call('POST', `/api/clients/${c.id}/tracking-numbers`, { number: '+19545550100', forward_to: '+19545550199' })).status, 400);
    // agency dialer and phone setup leave it out
    r = await t.call('GET', '/api/dialer/numbers');
    assert.deepEqual(r.data.numbers.map((n) => n.number), ['+13055073393']);
    r = await t.call('GET', '/api/voice/setup');
    assert.equal(r.data.numbers.length, 1);
    assert.equal(r.data.tracking, 1);

    // a first time caller, nobody answers, leaves a voicemail
    r = await hook(t, '/api/twilio/track-voice', { CallSid: 'CA1', From: '+13055551212', To: '+19545550199', FromCity: 'MIAMI', FromState: 'FL' });
    assert.match(r.data, /<Dial[^>]*record="do-not-record"[^>]*><Number>\+19545550142<\/Number><\/Dial>/);
    assert.ok(!/may be recorded/.test(r.data));
    const call1 = await first(t.env, "SELECT * FROM tracked_calls WHERE call_sid = 'CA1'");
    assert.equal(call1.first_time, 1);
    assert.equal(call1.source, 'Google profile');
    r = await hook(t, `/api/twilio/track-done?c=${call1.id}`, { CallSid: 'CA1', DialCallStatus: 'no-answer' });
    assert.match(r.data, /Thanks for calling Sunrise Roofing/);
    assert.match(r.data, /<Record /);
    const alert = tw.seen.find((s) => s.url.includes('resend'));
    assert.deepEqual(alert.body.to, ['maria@sunrise.example']);
    assert.match(alert.body.subject, /Missed call from \(305\) 555-1212/);
    r = await hook(t, `/api/twilio/track-recording?c=${call1.id}&k=vm`, { RecordingSid: 'RE1', RecordingDuration: '14' });
    assert.equal((await first(t.env, 'SELECT status, vm_secs FROM tracked_calls WHERE id = ?', call1.id)).status, 'voicemail');
    // same caller again, answered this time
    r = await hook(t, '/api/twilio/track-voice', { CallSid: 'CA2', From: '+13055551212', To: '+19545550199' });
    const call2 = await first(t.env, "SELECT * FROM tracked_calls WHERE call_sid = 'CA2'");
    assert.equal(call2.first_time, 0);
    await hook(t, `/api/twilio/track-done?c=${call2.id}`, { CallSid: 'CA2', DialCallStatus: 'completed', DialCallDuration: '95' });
    // a call to the tracking number that lands on the agency webhook still goes to the client
    r = await hook(t, '/api/twilio/voice', { CallSid: 'CA3', From: '+17865550000', To: '+19545550199' });
    assert.match(r.data, /<Number>\+19545550142<\/Number>/);

    r = await t.call('GET', `/api/clients/${c.id}/calls`);
    assert.equal(r.data.stats.total, 3);
    assert.equal(r.data.stats.answered, 1);
    assert.equal(r.data.stats.voicemail, 1);
    assert.equal(r.data.stats.firstTime, 2);
    assert.equal(r.data.stats.avgSecs, 95);
    assert.deepEqual(r.data.stats.bySource, [{ source: 'Google profile', n: 3 }]);
    const vm = r.data.calls.find((x) => x.voicemail);
    assert.equal(vm.city, 'MIAMI, FL');
    r = await t.call('GET', `/api/tracked-calls/${vm.id}/audio?k=vm`);
    assert.equal(r.status, 200);
    assert.equal((await t.call('GET', `/api/tracked-calls/${vm.id}/audio`)).status, 404, 'no call recording, recording was off');

    // recording on: callers hear the notice first
    const num = (await t.call('GET', `/api/clients/${c.id}/calls`)).data.numbers[0];
    r = await t.call('PATCH', `/api/tracking-numbers/${num.id}`, { record: true, source: 'Website' });
    assert.equal(r.data.number.record, true);
    r = await hook(t, '/api/twilio/track-voice', { CallSid: 'CA4', From: '+13055559999', To: '+19545550199' });
    assert.match(r.data, /^<\?xml[^]*<Say[^>]*>This call may be recorded\.<\/Say><Dial[^>]*record="record-from-answer-dual"/);
    assert.match(r.data, /track-recording\?c=tc_[0-9a-f]+&amp;k=rec/);

    // release: number goes back to Twilio and stops answering
    r = await t.call('DELETE', `/api/tracking-numbers/${num.id}`);
    assert.equal(r.data.ok, true);
    assert.ok(tw.seen.some((s) => s.method === 'DELETE' && s.url.includes(PN)));
    r = await hook(t, '/api/twilio/track-voice', { CallSid: 'CA5', From: '+13055558888', To: '+19545550199' });
    assert.match(r.data, /not in service/);
  } finally { tw.restore(); }
});

test('call tracking: webhooks need a valid Twilio signature, and only owners buy numbers', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const c = (await t.call('POST', '/api/clients', { name: 'Sunrise', plan: 'authority', phone: '9545550142' })).data.client;
  const bad = await t.call('POST', '/api/twilio/track-voice', 'To=%2B19545550199', { ...FORM, 'x-twilio-signature': 'nope' });
  assert.equal(bad.status, 403);
  const inv = await t.call('POST', `/api/clients/${c.id}/invite`, { email: 'maria@sunrise.example', name: 'Maria' });
  const owner = t.cookie();
  t.setCookie('');
  await t.call('POST', '/api/auth/invite/accept', { token: inv.data.inviteUrl.split('/').pop(), password: 'correct horse battery' });
  assert.equal((await t.call('POST', `/api/clients/${c.id}/tracking-numbers`, { number: '+19545550199' })).status, 403);
  const mine = await t.call('GET', `/api/clients/${c.id}/calls`);
  assert.equal(mine.status, 200, 'clients see their own calls');
  assert.equal(mine.data.twilio, undefined);
  t.setCookie(owner);
});
