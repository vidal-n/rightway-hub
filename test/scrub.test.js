import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { scrubTick } from '../src/scrub.js';
import { cleanName, phoneInfo, emailInfo, pickEmail, extractContacts, contactLinks, dataScore } from '../public/js/scrub.js';
import { filterLeads } from '../public/js/leadfilter.js';
import { d1, r2 } from './shims.mjs';

function setup(extra = {}) {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', ...extra };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' };
    if (cookie) h.cookie = cookie;
    let payload;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { env, call };
}
const owner = (t) => t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'Vidal Newton', password: 'correct horse battery' });
function stubFetch(handler) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init = {}) => { const u = String(url); seen.push(u); const r = await handler(u, init); if (r) return r; throw new Error(`unexpected fetch ${u}`); };
  return { seen, done: () => { globalThis.fetch = real; } };
}
const html = (body, url) => { const r = new Response(body, { status: 200, headers: { 'content-type': 'text/html' } }); Object.defineProperty(r, 'url', { value: url }); return r; };

test('cleanName strips SEO stuffing, legal endings and shouting, and leaves real names alone', () => {
  const c = (n, city = 'Miami', state = 'FL') => cleanName(n, { city, state }).name;
  assert.equal(c("JOE'S PLUMBING LLC | Best Plumber in Miami FL 24/7"), "Joe's Plumbing");
  assert.equal(c('Bright Smile Dental - Miami'), 'Bright Smile Dental');
  assert.equal(c('A-1 Roofing, Inc.'), 'A-1 Roofing');
  assert.equal(c('Elite HVAC Services (Open 24 Hours)'), 'Elite HVAC Services');
  assert.equal(c('Rooter Pros: Drain Cleaning, Water Heaters & Emergency Plumbing'), 'Rooter Pros');
  assert.equal(c('JT ELECTRIC SERVICES LLC'), 'JT Electric Services');
  assert.equal(c('Smith & Sons - Plumbing', 'Tampa'), 'Smith & Sons - Plumbing', 'a short tail with no filler stays');
  assert.equal(c('Plumbers of Miami'), 'Plumbers of Miami', 'a city inside the brand stays');
  assert.equal(c('McAllister Roofing'), 'McAllister Roofing');
  assert.equal(cleanName('Coastal Roof Pros').changed, false);
});

test('phone and email checks', () => {
  assert.match(phoneInfo('(800) 555-1234').problem, /Toll free/);
  assert.equal(phoneInfo('305-555-0101').kind, 'standard');
  assert.equal(phoneInfo('+1 (954) 555-0201').e164, '+19545550201');
  assert.match(phoneInfo('123-456-7890').problem, /No valid/, 'area codes never start with 1');
  assert.equal(phoneInfo('900-555-1234').kind, 'premium');
  assert.equal(emailInfo('info@smile.com', 'smile.com').role, true);
  assert.equal(emailInfo('logo@2x.png').ok, false);
  assert.equal(emailInfo('noreply@smile.com').ok, false);
  assert.equal(emailInfo('x@mailinator.com').ok, false);
  const best = pickEmail([emailInfo('jane@gmail.com'), emailInfo('info@smile.com', 'smile.com'), emailInfo('jane@smile.com', 'smile.com')]);
  assert.equal(best.email, 'jane@smile.com', 'their own domain and a person first');
});

test('extractContacts finds emails, social pages, phones and the owner; contactLinks finds the contact page', () => {
  const h = `<a href="mailto:jane@smiledental.com">Email</a> <p>Owner: Jane Doe</p>
    <a href="https://www.facebook.com/smiledental/">fb</a><a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
    <a href="https://instagram.com/smile.dental?hl=en">ig</a><a href="/contact-us">Contact Us</a><a href="https://other.com/about">x</a>
    <a href="tel:+1 305 555 0199">call</a> sentry@sentry.wixpress.com <img src="logo@2x.png">`;
  const c = extractContacts(h, 'https://www.smiledental.com/');
  assert.deepEqual(c.emails, ['jane@smiledental.com']);
  assert.equal(c.socials.facebook, 'https://www.facebook.com/smiledental');
  assert.equal(c.socials.instagram, 'https://instagram.com/smile.dental');
  assert.deepEqual(c.phones, ['3055550199']);
  assert.equal(c.owner, 'Jane Doe');
  assert.deepEqual(contactLinks(h, 'https://www.smiledental.com/'), ['https://www.smiledental.com/contact-us']);
  assert.equal(extractContacts('<p>Founded in 2009 by Mike Rivera.</p>').owner, 'Mike Rivera');
  assert.equal(extractContacts('<p>Contact Us Owner Read More</p>').owner, null, 'menu words are not names');
  assert.equal(extractContacts('<script type="application/ld+json">{"founder":{"@type":"Person","name":"Ana Lopez"}}</script>').owner, 'Ana Lopez');
});

test('dataScore and the pipeline data filters', () => {
  const full = { phone_digits: '3055550101', phone_type: 'mobile', owner_name: 'Jane', email: 'jane@x.com', email_status: 'valid', website: 'x.com', cid: '1', reviews: 3, city: 'Miami', state: 'FL', socials: '{"facebook":"x"}' };
  assert.equal(dataScore(full).score, 100);
  const thin = dataScore({ phone_digits: '3055550101' });
  assert.ok(thin.score < 40 && thin.grade === 'D' && thin.missing.includes('Owner name'));
  const leads = [{ ...full, id: 'a', data_score: 100, scrubbed_at: 1 }, { id: 'b', phone_type: 'landline', email: 'info@y.com', email_status: 'role', data_score: 40 }, { id: 'c' }];
  assert.deepEqual(filterLeads(leads, { f: { phoneType: 'mobile' } }).map((l) => l.id), ['a']);
  assert.deepEqual(filterLeads(leads, { f: { email: 'person' } }).map((l) => l.id), ['a']);
  assert.deepEqual(filterLeads(leads, { f: { email: 'yes' } }).map((l) => l.id), ['a', 'b']);
  assert.deepEqual(filterLeads(leads, { f: { owner: 'no' } }).map((l) => l.id), ['b', 'c']);
  assert.deepEqual(filterLeads(leads, { f: { minData: 50 } }).map((l) => l.id), ['a']);
  assert.deepEqual(filterLeads(leads, { f: { scrubbed: 'no' } }).map((l) => l.id), ['b', 'c']);
});

test('scrubbing a lead: cleaned name, website emails and owner, email check, line type, data score; imports queue for the background', async () => {
  const t = setup({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok' });
  await owner(t);
  const site = 'https://www.smiledental.com/';
  const f = stubFetch((u) => {
    if (u.startsWith('https://smiledental.com') || u === site) return html('<h1>Smile</h1><a href="/contact">Contact</a><a href="https://www.facebook.com/smiledentalmiami">f</a>', site);
    if (u === 'https://www.smiledental.com/contact') return html('<p>Dr. Jane Doe, Owner</p><a href="mailto:jane@smiledental.com">mail</a> info@smiledental.com', u);
    if (u.startsWith('https://cloudflare-dns.com/dns-query')) return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 15, data: '10 mx.smiledental.com.' }] }), { headers: { 'content-type': 'application/dns-json' } });
    if (u.startsWith('https://lookups.twilio.com/')) return new Response(JSON.stringify({ line_type_intelligence: { type: 'mobile', carrier_name: 'T-Mobile USA' } }));
    return null;
  });
  try {
    const imp = await t.call('POST', '/api/leads/import', { rows: [{ business: 'SMILE DENTAL LLC | Best Dentist in Miami FL', phone: '(305) 555-0123', website: 'smiledental.com', city: 'Miami', state: 'FL' }, { business: 'Toll Free Co', phone: '800-555-0000' }] });
    assert.equal(imp.data.imported, 2);
    const list = (await t.call('GET', '/api/leads')).data.leads;
    const lead = list.find((l) => l.phone_digits === '3055550123');
    assert.equal(lead.business, 'Smile Dental', 'the name is cleaned at import');
    assert.equal(lead.business_raw, 'SMILE DENTAL LLC | Best Dentist in Miami FL');
    assert.equal((await t.env.DB.prepare('SELECT scrub_queued FROM leads WHERE id = ?').bind(lead.id).first()).scrub_queued, 1, 'queued for the full scrub');
    // An owner turns on line type, then the background scrub runs.
    await t.call('PUT', '/api/scrub/settings', { lookup: true });
    assert.ok((await scrubTick(t.env, 5)) >= 1);
    const r = (await t.call('GET', `/api/leads/${lead.id}`)).data;
    assert.equal(r.lead.email, 'jane@smiledental.com', 'a person at their own domain beats info@');
    assert.equal(r.lead.email_status, 'valid');
    assert.equal(r.lead.owner_name, 'Jane Doe');
    assert.equal(r.lead.contact_name, 'Jane Doe');
    assert.equal(r.lead.phone_type, 'mobile');
    assert.equal(JSON.parse(r.lead.socials).facebook, 'https://www.facebook.com/smiledentalmiami');
    assert.ok(r.lead.data_score >= 80, `data score ${r.lead.data_score}`);
    assert.ok(r.scrub.emails.some((e) => e.email === 'info@smiledental.com' && e.role));
    // On demand for one lead, a contact name the rep typed is never overwritten.
    await t.call('PATCH', `/api/leads/${lead.id}`, { contact_name: 'Janie' });
    const again = await t.call('POST', `/api/leads/${lead.id}/scrub`);
    assert.equal(again.status, 200);
    assert.equal(again.data.lead.contact_name, 'Janie');
    // Queue a selection and check the status.
    const q = await t.call('POST', '/api/scrub/queue', { ids: [lead.id] });
    assert.equal(q.data.queued, 1);
    assert.equal((await t.call('GET', '/api/scrub/status')).data.queued >= 1, true);
  } finally { f.done(); }
});
