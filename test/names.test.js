import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
import { isPersonName, cleanPerson, nameFromEmail, firstFromEmail } from '../public/js/names.js';
import { extractContacts } from '../public/js/scrub.js';
import { whoIs } from '../public/js/leadintel.js';
import { pickOwner } from '../public/js/freedata.js';

test('titles, headings and trades are never people', () => {
  for (const bad of ['Owner Operator', 'Operator Plumbing', 'Elect Message', 'Message From', 'Owner Mike', 'Head Plumber', 'Authorized Person', 'Managing Member', 'Vice President', 'Registered Agent', 'Mark Your', 'Will Call', 'Chase Bank', 'General Manager', 'Family Owner', 'Our Team', 'Contact Us'])
    assert.equal(isPersonName(bad), false, bad);
  for (const good of ['Mike Diaz', 'John A Smith', 'Maria De La Cruz', 'Rosa Martinez', 'Jose Luis Rodriguez', "Sean O'Brien", 'Anna Cruz'])
    assert.equal(isPersonName(good), true, good);
  assert.equal(cleanPerson('Dr. Jane Doe, DDS'), 'Jane Doe');
  assert.equal(cleanPerson('Mike Diaz Owner'), 'Mike Diaz');
  assert.equal(cleanPerson('Joe Doe Plumbing'), 'Joe Doe');
  assert.equal(cleanPerson('Owner Operator'), '');
});

test('website owner finding skips titles and finds the real name', () => {
  const owner = (h) => extractContacts(h).owner;
  for (const h of ['<p>Owner Operator Plumbing since 1999</p>', '<p>President Elect Message</p>', '<p>CEO Message From The Desk</p>', '<p>Meet Owner Mike</p>', '<p>Head Plumber, Owner</p>', '<p>Contact Owner Directly</p>', '<p>Meet The Owner</p>'])
    assert.equal(owner(h), null, h);
  assert.equal(owner('<p>Owner: Mike Diaz</p>'), 'Mike Diaz');
  assert.equal(owner('<p>Mike Diaz - Owner and Operator</p>'), 'Mike Diaz');
  assert.equal(owner("<p>Hi, I'm Daniel Perez, the owner of Perez Roofing</p>"), 'Daniel Perez');
  assert.equal(owner('<script type="application/ld+json">{"employee":{"name":"Anna Cruz","jobTitle":"Owner"}}</script>'), 'Anna Cruz');
  // a junk match first does not hide a real name later on the page
  assert.equal(owner('<p>Owner Operator Plumbing</p><p>Owner: Mike Diaz</p>'), 'Mike Diaz');
});

test('email names: first.last on their own domain only', () => {
  assert.equal(nameFromEmail('mike.diaz@canyon.com'), 'Mike Diaz');
  assert.equal(nameFromEmail('mike.diaz@gmail.com'), '');
  assert.equal(nameFromEmail('info.team@canyon.com'), '');
  assert.equal(firstFromEmail('mike@canyon.com'), 'Mike');
  assert.equal(firstFromEmail('info@canyon.com'), '');
});

test('state registry officers must be people', () => {
  assert.equal(pickOwner({ people: [{ name: 'Authorized Person', title: 'MGR' }, { name: 'Managing Member', title: '' }] }), null);
  assert.equal(pickOwner({ people: [{ name: 'Authorized Person', title: '' }, { name: 'Carlos Mena', title: 'Manager' }] }).name, 'Carlos Mena');
});

test('old wrong owner names are ignored by whoIs', () => {
  assert.equal(whoIs({ owner_name: 'Operator Plumbing', contact_name: 'Operator Plumbing' }).known, false);
  assert.equal(whoIs({ owner_name: 'Operator Plumbing', contact_name: 'Mike' }).name, 'Mike');
  assert.equal(whoIs({ owner_name: 'Mike Diaz' }).role, 'Owner');
});

test('fix-names clears only non people and returns the ids to scrub again', async () => {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' }; if (cookie) h.cookie = cookie;
    let payload; if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'Vidal Newton', password: 'correct horse battery' });
  const ids = [];
  for (const [b, p, o, c] of [['A Co', '3055550101', 'Owner Operator', 'Owner Operator'], ['B Co', '3055550102', 'Mike Diaz', 'Mike Diaz'], ['C Co', '3055550103', 'Authorized Person', 'Sam'], ['D Co', '3055550104', '', '']]) {
    const r = await call('POST', '/api/leads', { business: b, phone: p, contact_name: c });
    ids.push(r.data.lead?.id || r.data.id);
    await env.DB.prepare('UPDATE leads SET owner_name = ? WHERE id = ?').bind(o || null, ids[ids.length - 1]).run();
  }
  const r = await call('POST', '/api/scrub/fix-names', {});
  assert.equal(r.data.fixed, 2);
  assert.equal(r.data.ids.length, 2);
  const row = (id) => env.DB.prepare('SELECT owner_name, contact_name FROM leads WHERE id = ?').bind(id).first();
  assert.equal((await row(ids[0])).owner_name, null);
  assert.equal((await row(ids[0])).contact_name, null, 'the contact that only copied the bad owner is cleared too');
  assert.equal((await row(ids[1])).owner_name, 'Mike Diaz', 'a real name stays');
  assert.equal((await row(ids[2])).contact_name, 'Sam', 'a contact someone typed stays');
});
