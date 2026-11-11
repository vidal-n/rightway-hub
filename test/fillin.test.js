import test from 'node:test';
import assert from 'node:assert/strict';
import { fillItems, fillPlan } from '../public/js/fillin.js';
import { cleanName } from '../public/js/scrub.js';

const L = (o) => ({ id: o.id, stage: 'new', business: 'Joe Plumbing', state: 'FL', tz_known: true, ...o });
const leads = [
  L({ id: 1, website: 'a.com', phone: '1', has_socials: 0 }),
  L({ id: 2, website: '', phone: '2', owner_name: 'Al', email: 'x@y.com', has_socials: 1, phone_type: 'mobile' }),
  L({ id: 3, stage: 'dnc', website: 'c.com', phone: '3' }),
  L({ id: 4, website: 'd.com', phone: '4', tz_known: false, owner_name: 'B', email: 'e@d.com', has_socials: 1, phone_type: 'landline', business: 'ACME HVAC | Miami FL LLC' }),
];
const items = (o = {}) => fillItems(leads, { cleanName, twilio: true, owner: true, ...o });
const by = (its, id) => its.find((i) => i.id === id);

test('counts only open leads that lack the piece and can be looked up', () => {
  const it = items();
  assert.deepEqual(by(it, 'owner').leads.map((l) => l.id), [1]);       // 2 has one; 3 is DNC; 4 has one
  assert.deepEqual(by(it, 'email').leads.map((l) => l.id), [1]);       // 2 has no website but has an email
  assert.deepEqual(by(it, 'phone').leads.map((l) => l.id), [1]);
  assert.deepEqual(by(it, 'tz').leads.map((l) => l.id), [4]);
  assert.deepEqual(by(it, 'name').leads.map((l) => l.id), [4]);
});

test('time zone item is owner only', () => {
  assert.equal(by(items({ owner: false }), 'tz'), undefined);
});

test('plan joins ticked website items once and prices phone checks', () => {
  const it = items();
  const p = fillPlan(it, new Set(['owner', 'email', 'phone']));
  assert.equal(p.leads.length, 1);
  assert.equal(p.lookups, 1);
  assert.ok(Math.abs(p.usd - 0.008) < 1e-9);
  assert.equal(fillPlan(it, new Set(['tz'])).tz, true);
  assert.equal(fillPlan(it, new Set(['tz'])).leads.length, 0);
  assert.equal(fillPlan(it, new Set(['owner'])).usd, 0);
});
