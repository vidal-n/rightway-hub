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

test('google: unticked boxes are named, API errors become plain fixes', async () => {
  const { missingText } = await import('../src/google.js');
  const { explain } = await import('../src/googlecheck.js');
  assert.equal(missingText('openid email https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.modify', ['mail']), '');
  assert.match(missingText('openid email', ['mail', 'drive']), /Calendar, Gmail, Drive/);
  const off = explain({ app: 'mail', label: 'Gmail', api: 'Gmail API' }, 403, { error: { message: 'Gmail API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=123 then retry.' } });
  assert.match(off.reason, /Gmail API is turned off/);
  assert.equal(off.link, 'https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=123');
  assert.match(explain({ app: 'drive', label: 'Drive', api: 'Google Drive API' }, 403, { error: { message: 'Request had insufficient authentication scopes.' } }).fix, /tick its box/);
});

test('quotes: services and price on the fly, custom work order, website order, font signature', async () => {
  const t = setup();
  await owner(t);
  const lead = (await t.call('POST', '/api/leads', { business: 'Coastal Roof Pros', contact_name: 'Ana Ruiz', email: 'ana@coastal.com', phone: '9545550111', state: 'FL' })).data.lead;
  let r = await t.call('PUT', `/api/leads/${lead.id}/quote`, { plan: 'growth', setup: '$525', monthly: '425', services: ['profile', 'pages', 'bogus'] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.quote.services, ['profile', 'pages']);
  assert.equal(r.data.quote.setup, 525);
  // Work order uses the quote: custom amounts, the plan stays internal.
  r = await t.call('POST', `/api/leads/${lead.id}/work-order`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const tok = r.data.url.split('#')[1];
  r = await t.call('GET', `/api/public/wo/${tok}`);
  assert.equal(r.data.order.setup_cents, 52500);
  assert.equal(r.data.order.monthly_cents, 42500);
  assert.equal(r.data.order.kind, 'seo');
  const text = JSON.stringify(r.data.order.sections);
  assert.match(text, /\$950\.00 \(due upon signing\)/);
  assert.match(text, /Website recommendations/);
  assert.ok(!/Website design, updates/.test(text));
  r = await t.call('POST', `/api/public/wo/${tok}/sign`, { agree: true, font: 'Great Vibes', initialsFont: 'Allura' });
  assert.equal(r.data.order.status, 'signed');
  assert.equal(r.data.order.signed_name, 'Ana Ruiz', 'name auto filled from the lead');
  assert.equal(r.data.order.signed_font, 'Great Vibes');
  assert.equal(r.data.order.initials, 'AR');
  assert.equal(r.data.order.initials_font, 'Allura');
  // Website is its own order with its own agreement.
  r = await t.call('POST', `/api/leads/${lead.id}/work-order`, { kind: 'website', setup: '1500' });
  assert.equal(r.status, 400);
  r = await t.call('POST', `/api/leads/${lead.id}/work-order`, { kind: 'website', setup: '1500', monthly: '49', scope: '5 page website\nContact form' });
  const wt = r.data.url.split('#')[1];
  r = await t.call('GET', `/api/public/wo/${wt}`);
  assert.equal(r.data.order.kind, 'website');
  assert.equal(r.data.order.title, 'Website Design Agreement');
  assert.match(JSON.stringify(r.data.order.sections), /5 page website.*Contact form/);
  assert.match(JSON.stringify(r.data.order.sections), /\$1,500\.00 \(due upon signing\)/);
});

test('signed copy is emailed to the client and the owners after signing', async () => {
  const t = setup({ RESEND_API_KEY: 're_test' });
  await owner(t);
  const lead = (await t.call('POST', '/api/leads', { business: 'Coastal Roof Pros', contact_name: 'Ana Ruiz', email: 'ana@coastal.com', phone: '9545550111', state: 'FL' })).data.lead;
  const tok = (await t.call('POST', `/api/leads/${lead.id}/work-order`, { plan: 'growth', setup: 449, monthly: 449 })).data.url.split('#')[1];
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (u, init) => {
    if (String(u).startsWith('https://api.resend.com/')) { sent.push(JSON.parse(init.body)); return Response.json({ id: 'em_1' }); }
    return real(u, init);
  };
  try {
    const r = await t.call('POST', `/api/public/wo/${tok}/sign`, { agree: true, font: 'Allura', initialsFont: 'Great Vibes' });
    assert.equal(r.data.order.emailed, 'ana@coastal.com');
    for (let i = 0; i < 50 && sent.length < 2; i++) await new Promise((res) => setTimeout(res, 10));
  } finally { globalThis.fetch = real; }
  assert.deepEqual(sent.map((m) => m.to[0]).sort(), ['ana@coastal.com', 'v@x.com']);
  assert.match(sent[0].subject, /Signed: Digital Marketing Service Agreement for Coastal Roof Pros/);
  assert.match(sent[0].html, /Signed and complete/);
  assert.match(sent[0].html, /\$898\.00 \(due upon signing\)/);
  assert.match(sent[0].html, /sign\.html#/);
  assert.ok(!/[–—]/.test(sent[0].html + sent[0].text));
});
