import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { twilioSignature } from '../src/calls.js';
import { isStop, isStart, canText } from '../src/sms.js';
import { d1, r2 } from './shims.mjs';

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

function setup() {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+13055073393' };
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const h = { 'x-rw': '1', ...headers };
    if (cookie) h.cookie = cookie;
    let payload;
    if (typeof body === 'string') payload = body;
    else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload, redirect: 'manual' }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
  };
  return { env, call };
}
async function owner(t) {
  const r = await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', name: 'V', email: 'v@x.com', password: 'correct horse battery' });
  assert.equal(r.status, 200);
}
async function hook(t, path, params) {
  return t.call('POST', path, new URLSearchParams(params).toString(), { ...FORM, 'x-twilio-signature': await twilioSignature('tok', `https://hub.test${path}`, params) });
}

test('stop and start words', () => {
  assert.ok(isStop('STOP')); assert.ok(isStop(' stop. ')); assert.ok(isStop('Unsubscribe')); assert.ok(!isStop('please stop by'));
  assert.ok(isStart('START')); assert.ok(!isStart('no'));
  assert.match(canText({ sms_stop: 1 }, true), /STOP/);
  assert.match(canText({ sms_consent: 0 }, false), /permission/i);
  assert.equal(canText({ sms_consent: 1 }, false), null);
  assert.equal(canText({ sms_consent: 0 }, true), null);
});

test('texting: consent gate, first message opt-out line, STOP kills texting, inbound creates a lead', async () => {
  const t = setup(); await owner(t);
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.twilio.com') && String(url).includes('Messages')) { sent.push(new URLSearchParams(init.body)); return new Response(JSON.stringify({ sid: 'SM1', status: 'queued' }), { status: 201 }); }
    return realFetch(url, init);
  };
  try {
    const lead = (await t.call('POST', '/api/leads', { business: 'Bay Roofing', phone: '9545550123', state: 'FL' })).data.lead;
    let r = await t.call('POST', `/api/leads/${lead.id}/sms`, { text: 'Hi' });
    assert.equal(r.status, 409); assert.match(r.data.error, /permission/i);
    r = await t.call('POST', `/api/leads/${lead.id}/sms-consent`, { value: true });
    assert.equal(r.status, 200);
    // Force daytime in the lead's zone by faking the clock to 2pm Eastern.
    const RealDate = Date; const fixed = RealDate.parse('2026-11-03T19:00:00Z');
    globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
    try { r = await t.call('POST', `/api/leads/${lead.id}/sms`, { text: 'Your audit is ready.' }); } finally { globalThis.Date = RealDate; }
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(sent.length, 1);
    assert.match(sent[0].get('Body'), /^Rightway Growth: Your audit is ready\.\nReply STOP to opt out\.$/);
    assert.equal(sent[0].get('From'), '+13055073393');
    assert.equal(sent[0].get('To'), '+19545550123');
    // Delivery receipt with a carrier block shows a plain reason.
    r = await hook(t, '/api/twilio/sms-status', { MessageSid: 'SM1', MessageStatus: 'undelivered', ErrorCode: '30034' });
    assert.equal(r.status, 200);
    r = await t.call('GET', `/api/leads/${lead.id}/messages`);
    assert.match(r.data.messages[0].error_text, /not registered/i);
    // Unsigned webhook rejected.
    r = await t.call('POST', '/api/twilio/sms', new URLSearchParams({ From: '+19545550123', Body: 'hi' }).toString(), { ...FORM, 'x-twilio-signature': 'bad' });
    assert.equal(r.status, 403);
    // Inbound reply shows in the inbox as unread.
    r = await hook(t, '/api/twilio/sms', { From: '+19545550123', To: '+13055073393', Body: 'Sounds good', MessageSid: 'SM2' });
    assert.equal(r.status, 200);
    r = await t.call('GET', '/api/inbox');
    assert.equal(r.data.conversations.length, 1); assert.equal(r.data.conversations[0].unread, 1);
    assert.equal((await t.call('GET', '/api/inbox/unread')).data.unread, 1);
    await t.call('GET', `/api/leads/${lead.id}/messages`);
    assert.equal((await t.call('GET', '/api/inbox/unread')).data.unread, 0);
    // STOP ends it for good.
    await hook(t, '/api/twilio/sms', { From: '+19545550123', To: '+13055073393', Body: 'STOP', MessageSid: 'SM3' });
    r = await t.call('GET', `/api/leads/${lead.id}/messages`);
    assert.equal(r.data.stopped, true); assert.match(r.data.blocked, /STOP/);
    r = await t.call('POST', `/api/leads/${lead.id}/sms-consent`, { value: true });
    assert.equal(r.status, 409);
    // A stranger texting in becomes a lead we may reply to.
    await hook(t, '/api/twilio/sms', { From: '+13055550188', To: '+13055073393', Body: 'Do you do SEO?', MessageSid: 'SM4' });
    r = await t.call('GET', '/api/inbox');
    const stranger = r.data.conversations.find((c) => c.phone === '+13055550188');
    assert.ok(stranger); assert.match(stranger.business, /Unknown/);
    // We can reply right away even though their state (time zone) is unknown.
    r = await t.call('POST', `/api/leads/${stranger.id}/sms`, { text: 'Yes we do. When can we talk?' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(sent.at(-1).get('To'), '+13055550188');
  } finally { globalThis.fetch = realFetch; }
});

test('inbound call rings the owner phone, missed call plays a message', async () => {
  const t = setup(); await owner(t);
  await t.call('PUT', '/api/me/phone', { phone: '954 555 0001' });
  let r = await hook(t, '/api/twilio/voice', { From: '+13055550188', To: '+13055073393', CallSid: 'CA9' });
  assert.match(r.data, /<Number[^>]*>\+19545550001<\/Number>/); assert.match(r.data, /do-not-record/);
  const a = /a=(a_[^"&]+)/.exec(r.data)[1];
  r = await hook(t, `/api/twilio/voice-done?a=${a}`, { DialCallStatus: 'no-answer', DialCallDuration: '0' });
  // signature covers the full URL including the query, so the helper above signs without it: expect rejection, then sign properly.
  const url = `/api/twilio/voice-done?a=${a}`; const p = { DialCallStatus: 'no-answer', DialCallDuration: '0' };
  r = await t.call('POST', url, new URLSearchParams(p).toString(), { ...FORM, 'x-twilio-signature': await twilioSignature('tok', `https://hub.test${url}`, p) });
  assert.match(r.data, /Sorry we missed you/);
  assert.match(r.data, /<Record maxLength="120"/);
});
