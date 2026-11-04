import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { cleanMessages } from '../src/assistant.js';
import { agreementSections, agreementHtml, SERVICES } from '../public/js/agreement.js';
import { d1, r2 } from './shims.mjs';

function setup(extra = {}) {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', ...extra };
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const h = { 'x-rw': '1', ...headers };
    if (cookie) h.cookie = cookie;
    let payload;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  return { env, call, logout: () => { cookie = ''; } };
}
const owner = (t) => t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', name: 'Vidal Newton', email: 'v@x.com', password: 'correct horse battery' });

test('agreement: one text for every plan, only the amounts change, blank copy has lines', () => {
  const a = JSON.stringify(agreementSections({ setupCents: 39900, monthlyCents: 39900 }));
  const b = JSON.stringify(agreementSections({ setupCents: 59900, monthlyCents: 59900 }));
  assert.match(a, /\$798\.00 \(due upon signing\)/);
  assert.match(b, /\$1,198\.00 \(due upon signing\)/);
  assert.equal(a.replace(/\$[\d,.]+/g, '$'), b.replace(/\$[\d,.]+/g, '$'));
  const blank = agreementSections({});
  assert.match(JSON.stringify(blank), /\$________/);
  assert.ok(SERVICES.some((s) => /Website/.test(s)));
  const html = agreementHtml({ sections: blank, business: '<b>Bad</b>' });
  assert.ok(!html.includes('<b>Bad</b>'), 'escapes the business name');
  assert.match(html, /Rightway Growth LLC/);
  assert.ok(!/[–—]/.test(html));
});

test('appointments: owners see every one, teammates only the ones they booked', async () => {
  const t = setup();
  await owner(t);
  const mk = async (business, phone) => (await t.call('POST', '/api/leads', { business, phone, state: 'FL' })).data.lead;
  const a = await mk('Owner Booked Roofing', '9545550401');
  const when = Date.now() + 2 * 864e5;
  // The owner logs a booked call with a time: it becomes their appointment.
  let r = await t.call('POST', `/api/leads/${a.id}/outcome`, { dispo: 'booked', callbackAt: new Date(when).toISOString() });
  assert.equal(r.status, 200);
  assert.equal(r.data.lead.meet_at, when);
  const inv = await t.call('POST', '/api/team/invite', { email: 'rep@x.com', name: 'Rep', role: 'team' });
  t.logout();
  await t.call('POST', '/api/auth/invite/accept', { token: inv.data.inviteUrl.split('/#/invite/')[1], password: 'another long password' });
  const b = await mk('Rep Booked Plumbing', '9545550402');
  r = await t.call('POST', `/api/leads/${b.id}/outcome`, { dispo: 'booked', callbackAt: new Date(when + 3600e3).toISOString() });
  assert.equal(r.data.lead.meet_at, when + 3600e3);
  // The rep sees only their own appointment everywhere.
  r = await t.call('GET', '/api/dashboard');
  assert.deepEqual(r.data.meetings.map((m) => m.business), ['Rep Booked Plumbing']);
  r = await t.call('GET', '/api/calendar/upcoming');
  assert.deepEqual(r.data.meetings.map((m) => m.business), ['Rep Booked Plumbing']);
  r = await t.call('GET', `/api/leads/${a.id}`);
  assert.equal(r.data.lead.meet_at, null, 'the owner\'s appointment is hidden from the rep');
  r = await t.call('GET', '/api/leads');
  assert.equal(r.data.leads.find((l) => l.id === a.id).meet_at, null);
  assert.equal(r.data.leads.find((l) => l.id === b.id).meet_at, when + 3600e3);
  // The owner sees both.
  t.logout();
  await t.call('POST', '/api/auth/login', { email: 'v@x.com', password: 'correct horse battery' });
  r = await t.call('GET', '/api/dashboard');
  assert.equal(r.data.meetings.length, 2);
  r = await t.call('GET', `/api/leads/${b.id}`);
  assert.equal(r.data.lead.meet_at, when + 3600e3);
});

test('assistant: needs a key, sends the client brief, keeps turns in order', async () => {
  assert.throws(() => cleanMessages([]), /Ask a question/);
  assert.deepEqual(cleanMessages([{ role: 'assistant', content: 'hi' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }]), [{ role: 'user', content: 'a\n\nb' }]);
  let t = setup();
  await owner(t);
  let r = await t.call('POST', '/api/assistant', { messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /ANTHROPIC_API_KEY/);

  t = setup({ ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_ASSIST_MODEL: 'claude-test' });
  await owner(t);
  const c = (await t.call('POST', '/api/clients', { name: 'Summit Roofing', plan: 'growth', services: 'roof repair, roof replacement', cities: 'Hollywood, Davie', keywords: 'roofer hollywood' })).data.client;
  const real = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (u, init) => {
    if (String(u).startsWith('https://api.anthropic.com/')) { sent = JSON.parse(init.body); return Response.json({ content: [{ type: 'text', text: 'Here is your post.' }] }); }
    return real(u, init);
  };
  try {
    r = await t.call('POST', '/api/assistant', { clientId: c.id, messages: [{ role: 'user', content: 'Write a Google post' }] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.reply, 'Here is your post.');
    assert.equal(sent.model, 'claude-test');
    assert.match(sent.system, /CLIENT: Summit Roofing/);
    assert.match(sent.system, /roof repair/);
    assert.match(sent.system, /Never invent facts/);
    assert.deepEqual(sent.messages, [{ role: 'user', content: 'Write a Google post' }]);
  } finally { globalThis.fetch = real; }
  // Clients cannot use it.
  t.logout();
  r = await t.call('POST', '/api/assistant', { messages: [{ role: 'user', content: 'x' }] });
  assert.ok([401, 403].includes(r.status));
});
