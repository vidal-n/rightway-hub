import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { looseName, isOwnerName, isPersonName, cleanOwner } from '../public/js/names.js';
import { extractContacts } from '../public/js/scrub.js';
import { ownerReach, siteFlags, industryClass, personalBusiness } from '../public/js/reach.js';
import { boardColumns } from '../public/js/boardcols.js';
import { fillItems } from '../public/js/fillin.js';
import { d1, r2 } from './shims.mjs';

function setup() {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
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
const html = (body, url) => { const r = new Response(body, { status: 200, headers: { 'content-type': 'text/html' } }); Object.defineProperty(r, 'url', { value: url }); return r; };

test('owner names from a labeled spot do not need a first name from our list, titles and headings still fail', () => {
  assert.equal(isPersonName('Yusimi Alvarez'), false, 'not on the typed first name list');
  assert.equal(looseName('Yusimi Alvarez'), true);
  assert.equal(isOwnerName('Thuy Tran'), true);
  for (const bad of ['Our Team', 'Free Estimate', 'Quality Service', 'Message Us', 'Owner Operator', 'Learn More', 'Blue Sky', 'Contact Us', 'Authorized Person']) assert.equal(isOwnerName(bad), false, bad);
  assert.equal(cleanOwner('Yusimi Alvarez, Owner'), 'Yusimi Alvarez');
  // The labeled patterns use the loose check, the bare "Meet ..." heading stays strict.
  assert.equal(extractContacts('<p>Owner: Yusimi Alvarez</p>', 'https://x.com').owner, 'Yusimi Alvarez');
  assert.equal(extractContacts('<h2>Meet Yusimi Alvarez</h2>', 'https://x.com').owner, null);
  assert.equal(extractContacts('<h2>Meet Mike Diaz</h2>', 'https://x.com').owner, 'Mike Diaz');
});

test('a site that blocks the first browser identity is read on the retry, About pages are tried by path, and the owner is saved', async () => {
  const t = setup();
  await owner(t);
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); seen.push(u);
    const ua = String(init.headers?.['user-agent'] || '');
    if (u.startsWith('https://cloudflare-dns.com')) return new Response(JSON.stringify({ Status: 3 }), { headers: { 'content-type': 'application/json' } });
    if (!u.includes('alvarezroofing.com')) throw new Error(`unexpected ${u}`);
    if (ua.includes('Macintosh')) return new Response('blocked', { status: 403 });          // the first try is turned away
    if (u === 'https://alvarezroofing.com/' || u === 'https://alvarezroofing.com') return html('<h1>Alvarez Roofing</h1><script src="//cdn.callrail.com/companies/1/swap.js"></script>', 'https://alvarezroofing.com/');
    if (u === 'https://alvarezroofing.com/contact') return html('<p>Owner: Yusimi Alvarez</p>', u);
    return new Response('not found', { status: 404 });
  };
  try {
    const imp = await t.call('POST', '/api/leads/import', { rows: [{ business: 'Alvarez Roofing', phone: '(305) 555-0188', website: 'alvarezroofing.com', city: 'Miami', state: 'FL' }] });
    assert.equal(imp.data.imported, 1);
    const lead = (await t.call('GET', '/api/leads')).data.leads[0];
    const r = await t.call('POST', `/api/leads/${lead.id}/scrub`);
    assert.equal(r.status, 200);
    assert.equal(r.data.lead.owner_name, 'Yusimi Alvarez');
    assert.equal(r.data.scrub.site.ok, true);
    const row = (await t.call('GET', '/api/leads')).data.leads.find((l) => l.id === lead.id);
    assert.match(String(row.rflags), /tracking/, 'call tracking found on the site is saved for the tier');
    assert.ok(seen.filter((u) => u.includes('alvarezroofing.com')).length >= 3, 'retried and tried a contact path');
  } finally { globalThis.fetch = real; }
});

test('owner reach tiers: named mobile is T1, a gatekeeper sign is T4, unknown stays T3, a Do not call lead is X', () => {
  const named = { business: "Mike's Plumbing", phone_type: 'mobile', owner_name: 'Mike Diaz', reviews: 40, scrubbed_at: 1, website: 'x.com', category: 'Plumber' };
  assert.equal(ownerReach(named).tier, 'T1');
  assert.equal(ownerReach({ ...named, phone_type: 'landline' }).tier, 'T2');
  assert.equal(ownerReach({ ...named, rflags: 'answering' }).tier, 'T4');
  assert.equal(ownerReach({ ...named, business: 'Home Depot' }).tier, 'T4');
  assert.equal(ownerReach({ business: 'ABC Roofing', phone: '3055550100' }).tier, 'T3', 'nothing checked is unknown, not bad');
  assert.ok(ownerReach({ business: 'ABC Roofing', phone: '3055550100' }).unchecked.includes('owner name'));
  assert.equal(ownerReach({ business: 'Smile Dental', category: 'Dentist', scrubbed_at: 1, phone_type: 'landline', reviews: 300, website: 'a.com', rflags: 'front_desk' }).tier, 'T4');
  assert.equal(ownerReach({ ...named, dnc: 1 }).tier, 'X');
  // Our own calls beat every guess: an owner who picked up once is T1 even with flags, two menus demote the number.
  assert.equal(ownerReach({ ...named, phone_type: 'landline', rflags: 'tracking', owner_talks: 1 }).tier, 'T1');
  assert.equal(ownerReach({ ...named, menus: 1, services: 1 }).tier, 'T4');
  assert.deepEqual(ownerReach(named).why.length, 3);
});

test('site flags and industry classes are read from plain HTML and Google categories', () => {
  assert.deepEqual(siteFlags('<script src="https://cdn.callrail.com/x.js"></script> live answering service 24/7 live agents'), ['tracking', 'answering']);
  assert.ok(siteFlags('Family owned since 1999. Built with Wix <img src="https://static.wixstatic.com/a.png">').includes('builder'));
  assert.equal(industryClass({ category: 'Plumber' }), 'owner_run');
  assert.equal(industryClass({ category: 'Dentist' }), 'front_desk');
  assert.equal(industryClass({ category: 'Car dealer' }), 'staffed');
  assert.equal(personalBusiness("Mike's Plumbing"), true);
  assert.equal(personalBusiness('Blue Wave Plumbing'), false);
});

test('the Pipeline can lay the board out by owner reach tier and Fill in missing info counts leads with no owner name', () => {
  const leads = [
    { id: 'a', business: "Mike's Plumbing", stage: 'new', phone_type: 'mobile', owner_name: 'Mike Diaz', rtier: 'T1' },
    { id: 'b', business: 'Front Desk Dental', stage: 'new', rtier: 'T4', website: 'd.com', contact_name: 'Anna Lopez', scrubbed_at: 1 },
    { id: 'c', business: 'Mystery Co', stage: 'new' },
  ];
  const cols = boardColumns('rtier', leads, { stageLabel: (s) => s });
  const labels = cols.map((c) => c.label);
  assert.ok(labels.includes('T1 Owner likely') && labels.includes('T4 Gatekeeper likely') && labels.includes('Not scored'));
  const items = fillItems(leads, { cleanName: () => ({ changed: false }), twilio: false, owner: false });
  const own = items.find((i) => i.id === 'owner');
  assert.deepEqual(own.leads.map((l) => l.id).sort(), ['b', 'c'], 'a contact name is not an owner name');
});
