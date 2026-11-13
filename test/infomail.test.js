import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
import { infoEmail, infoFacts, defaultIntro, tradeWord, EMAIL_RE } from '../public/js/infomail.js';

test('info email: branded, one button, callback line, honest facts, no dashes', () => {
  const m = infoEmail({ first: 'Mike', business: 'Shore Plumbing', industry: 'Plumbing', rep: 'Vidal Newton', bookUrl: 'https://hub.test/book.html?l=abc', logoUrl: 'https://hub.test/brand/rightway-logo-email.png', tz: 'America/New_York' });
  assert.match(m.html, /rightway-logo-email\.png/);
  assert.match(m.html, /Pick a time that works/);
  assert.match(m.html, /2001 Van Buren St/);
  assert.match(m.html, /Reply "stop"/);
  assert.match(m.text, /book\.html\?l=abc/);
  assert.match(m.text, /Rather have me call you/);
  assert.match(m.html, /plumbers/);
  assert.ok(!/[–—]/.test(m.html + m.text + m.subject), 'no em or en dashes');
  assert.ok(!/guarantee|#1|first page of google guaranteed/i.test(m.text));
  assert.match(m.text, /Nobody can promise a spot on Google/);
  // Callback time is named in their own zone.
  const cb = infoEmail({ first: 'Mike', business: 'Shore Plumbing', rep: 'V', callbackAt: Date.UTC(2026, 10, 13, 15, 0), tz: 'America/Chicago', bookUrl: 'https://h.test/b' });
  assert.match(cb.text, /I will call you .*9:00 AM.*CST/);
  assert.match(cb.html, /Your call back:/);
  // No logo URL falls back to a text wordmark, no http links become buttons.
  const plain = infoEmail({ business: 'X', bookUrl: 'http://insecure.test' });
  assert.ok(!/<img/.test(plain.html));
  assert.ok(!/Pick a time that works/.test(plain.html));
  // Typed text is escaped.
  assert.ok(!/<script>/.test(infoEmail({ business: '<script>x</script>', intro: '<script>y</script>' }).html));
});

test('info facts only say what the data shows', () => {
  assert.deepEqual(infoFacts({ business: 'A', reviews: 120, website: 'https://a.com' }, null), []);
  assert.match(infoFacts({ business: 'A', reviews: 4, website: 'https://a.com' }, null)[0], /4 reviews/);
  assert.match(infoFacts({ business: 'A', reviews: 1, website: 'https://a.com' }, null)[0], /1 review,/);
  assert.match(infoFacts({ business: 'A', reviews: 200, website: 'https://a.com' }, { rank: 7, keyword: 'plumber miami', found: true })[0], /spot 7/);
  assert.deepEqual(infoFacts({ business: 'A', reviews: 200, website: 'https://a.com' }, { rank: 7, keyword: 'plumber', rank_checked: false }), []);
  assert.deepEqual(infoFacts({ business: 'A', reviews: 200, website: 'https://a.com' }, { rank: 2, keyword: 'plumber' }), []);
  assert.match(defaultIntro({ business: 'A' }, { first: 'Sam', repFirst: 'V', facts: [] }), /^Hi Sam,/);
  assert.equal(tradeWord('HVAC'), 'HVAC companies');
  assert.ok(EMAIL_RE.test('a@b.co') && !EMAIL_RE.test('a@b') && !EMAIL_RE.test('a b@c.com'));
});

test('info email route: fills the form, fixes the address, sends once, logs it', async () => {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', RESEND_API_KEY: 're_test' };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' }; if (cookie) h.cookie = cookie;
    let payload; if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { if (String(url).includes('resend.com')) { sent.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ id: 'e1' }), { status: 200 }); } return realFetch(url, opts); };
  try {
    let r = await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'Vidal Newton', password: 'correct horse battery' });
    assert.equal(r.status, 200);
    r = await call('POST', '/api/leads/import', { rows: [{ business: 'Shore Plumbing', phone: '305-555-0131', state: 'FL', city: 'Miami', industry: 'plumbing', email: 'wrong@shore.com', contact_name: 'Mike Rivera' }] });
    assert.equal(r.data.imported, 1);
    const id = (await call('GET', '/api/leads')).data.leads[0].id;
    r = await call('GET', `/api/leads/${id}/info-email`);
    assert.equal(r.status, 200);
    assert.equal(r.data.to, 'wrong@shore.com');
    assert.equal(r.data.via, 'resend');
    assert.match(r.data.subject, /info you asked for/);
    // Bad address is refused, nothing sent.
    r = await call('POST', `/api/leads/${id}/info-email`, { to: 'not an email', subject: 's', intro: 'i' });
    assert.equal(r.status, 400); assert.equal(sent.length, 0);
    // Corrected address sends the branded email and is saved on the lead.
    r = await call('POST', `/api/leads/${id}/info-email`, { to: 'Mike@Shore.com', subject: 'Mike, the info you asked for', intro: 'Hi Mike,\n\nThanks for the call.', callbackAt: new Date(Date.now() + 864e5).toISOString() });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to[0] || sent[0].to, 'mike@shore.com');
    assert.match(sent[0].html, /Your call back:/);
    assert.match(sent[0].reply_to || sent[0].replyTo || '', /v@rightwaygrowth\.com/);
    const lead = (await call('GET', `/api/leads/${id}`)).data.lead;
    assert.equal(lead.email, 'mike@shore.com');
    // "Wants info first" with a callback time is a callback at that time.
    const at = new Date(Date.now() + 2 * 864e5).toISOString();
    r = await call('POST', `/api/leads/${id}/outcome`, { dispo: 'send_info', callbackAt: at });
    assert.equal(r.status, 200);
    assert.equal(r.data.lead.stage, 'callback');
    assert.equal(new Date(r.data.lead.next_action_at).toISOString(), at);
    // Without a time it stays the 2 day follow up.
    r = await call('POST', `/api/leads/${id}/outcome`, { dispo: 'send_info' });
    assert.equal(r.data.lead.stage, 'follow_up');
  } finally { globalThis.fetch = realFetch; }
});
