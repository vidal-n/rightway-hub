import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
import { rollup, reachScore, engageScore, whereFor, cleanFilter, cleanQual, qualCount, anum, insights, answeredOf, defaultAnswered, comboLabel, FILTERS } from '../public/js/leaddb.js';

test('answeredOf fills older calls from their result', () => {
  assert.equal(answeredOf({ outcome: 'voicemail' }), 'voicemail');
  assert.equal(answeredOf({ outcome: 'phone_menu' }), 'menu');
  assert.equal(answeredOf({ outcome: 'gatekeeper' }), 'staff');
  assert.equal(answeredOf({ outcome: 'bad_number', dispo_id: 'wrong_number' }), 'wrong');
  assert.equal(answeredOf({ outcome: 'conversation', answered_by: 'service' }), 'service');
  assert.equal(answeredOf({ answered_at: 1, duration: 40 }), 'someone');
  assert.equal(defaultAnswered('not_owner', 'gatekeeper'), 'staff');
});

test('rollup counts who answered, talk, fast hang ups and dials to the owner', () => {
  const t = 10 * 864e5;
  const r = rollup([
    { at: 1, outcome: 'no_answer' }, { at: 2, outcome: 'phone_menu' }, { at: 3, outcome: 'gatekeeper', answered_at: 3, duration: 20 },
    { at: 4, outcome: 'hung_up', answered_at: 4, duration: 4 }, { at: 5, outcome: 'conversation', answered_at: 5, duration: 190, objection: 'has_agency' },
    { at: 6, status: 'ready' },
  ], t);
  assert.equal(r.r_dials, 5);
  assert.equal(r.r_connects, 3);
  assert.equal(r.r_owner, 1);
  assert.equal(r.r_staff, 1);
  assert.equal(r.r_menu, 1);
  assert.equal(r.r_noans, 1);
  assert.equal(r.r_fast_hangs, 1);
  assert.equal(r.r_talk, 214);
  assert.equal(r.r_longest, 190);
  assert.equal(r.r_to_owner, 5);
  assert.equal(r.r_obj, 'has_agency');
  assert.equal(r.r_last_by, 'owner');
});

test('scores: reach rewards mobiles and owners, punishes menus and dead lines; engagement decays', () => {
  const base = { phone_type: 'mobile', owner_known: true, likely_owner: true };
  assert.ok(reachScore(base) > reachScore({ phone_type: 'landline' }));
  assert.ok(reachScore({ ...base, r_owner: 1, r_connects: 1 }) > reachScore(base));
  assert.ok(reachScore({ r_menu: 2, r_dials: 2 }) < 40);
  assert.equal(reachScore({ r_dead: 1, r_dials: 1 }), 0);
  assert.equal(reachScore({ dnc: 1 }), 0);
  assert.ok(reachScore({ phone_type: 'toll_free' }) === 0);
  const now = 400 * 864e5;
  const hot = { r_owner: 1, r_convs: 1, r_talk: 200, stage: 'callback', r_owner_at: now - 864e5 };
  assert.equal(engageScore(hot, now), 40);
  assert.ok(engageScore(hot, now) > engageScore({ ...hot, r_owner_at: now - 100 * 864e5 }, now));
  assert.ok(engageScore({ stage: 'audit_requested' }) >= 40);
  assert.equal(engageScore({ r_obj: 'has_agency' }), 0);
  assert.equal(comboLabel('B', 45), 'B1');
  assert.equal(comboLabel('D', 5), 'D3');
});

test('whereFor only puts catalog SQL in the text and binds every value', () => {
  const w = whereFor({ q: "x'); DROP TABLE leads; --", phone_type: ['mobile', '__null'], reviews: { min: 10, max: 'abc' }, never: true, bogus: 1, qual_spend: ['500'] }, { now: 1000 });
  assert.ok(!w.where.includes('DROP'));
  assert.ok(!w.where.includes('bogus'));
  assert.equal(w.vals.filter((v) => String(v).includes('DROP')).length, 1);
  assert.match(w.where, /phone_type IN \(\?\)/);
  assert.match(w.where, /phone_type IS NULL/);
  assert.match(w.where, /json_extract\(qual, '\$\.spend'\) IN \(\?\)/);
  assert.equal(cleanFilter({ reviews: { min: '', max: '' } }).reviews, undefined);
  for (const f of FILTERS) assert.ok(!/\$\{|;/.test(f.sql), f.k);
});

test('qualification: cleans values and reads ANUM', () => {
  const q = cleanQual({ dm: 'owner', spend: '500', urgency: 'later', sources: ['google', 'nope', 'referral'], job_value: '$1,200', tried: 'Yelp ads — burned', bad: 'x', wants_more: 'maybe' });
  assert.deepEqual(q.sources, ['google', 'referral']);
  assert.equal(q.job_value, 1200);
  assert.equal(q.wants_more, undefined);
  assert.ok(!q.tried.includes('—'));
  assert.equal(qualCount(q), 6);
  assert.deepEqual(anum(q), { authority: true, need: null, urgency: false, money: true });
});

test('insights: pickup by hour and attempt, objections and shortest calls', () => {
  const rows = [
    { id: 'a', at: 1, hour: 9, dow: 1, attempt_no: 1, outcome: 'no_answer', industry: 'Plumber', phone_type: 'landline' },
    { id: 'b', at: 2, hour: 9, dow: 1, attempt_no: 2, outcome: 'conversation', answered_at: 2, duration: 120, industry: 'Plumber', phone_type: 'mobile', business: 'A' },
    { id: 'c', at: 3, hour: 14, dow: 2, attempt_no: 1, outcome: 'hung_up', answered_at: 3, duration: 3, hangup_stage: 'opener', industry: 'Roofer', business: 'B' },
    { id: 'd', at: 4, hour: 14, dow: 2, attempt_no: 1, outcome: 'not_interested', answered_at: 4, duration: 40, objection: 'has_agency', industry: 'Roofer', business: 'C' },
    { id: 'e', at: 5, hour: 15, dow: 3, attempt_no: 1, outcome: 'phone_menu', industry: 'Dentist' },
  ];
  const s = insights(rows, { minDials: 1 });
  assert.equal(s.total.dials, 5);
  assert.equal(s.total.human, 3);
  assert.equal(s.total.menu, 1);
  assert.equal(s.total.fast, 1);
  assert.equal(s.byHour.find((h) => h.key === 9).owner, 1);
  assert.equal(s.byAttempt.find((a) => a.key === 2).owner, 1);
  assert.equal(s.objections[0].key, 'has_agency');
  assert.equal(s.objectionGroups.find((g) => g.key === 'existing').n, 1);
  assert.equal(s.shortest[0].business, 'B');
  assert.equal(s.longest[0].business, 'A');
  assert.equal(s.hangupStages[0].key, 'opener');
  assert.equal(s.total.conv, 1);
  assert.equal(s.total.businesses, 0);
  assert.equal(s.total.fillRate, 1);
});

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
    const type = res.headers.get('content-type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json().catch(() => null) : await res.text() };
  };
  return { env, call };
}

test('lead database end to end: results with detail roll up, search, insights, qualification, dial cap', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'Vidal Newton', password: 'correct horse battery' });
  const imp = await t.call('POST', '/api/leads/import', { rows: [
    { business: 'Sparkle Plumbing', phone: '(305) 555-0188', city: 'Miami', state: 'FL', industry: 'Plumber' },
    { business: 'Harbor Roofing', phone: '(954) 555-0101', city: 'Hollywood', state: 'FL', industry: 'Roofer' },
  ], source: 'import' });
  assert.equal(imp.status, 200);
  const leads = (await t.call('GET', '/api/leads')).data.leads;
  const sp = leads.find((l) => l.business === 'Sparkle Plumbing');
  const hb = leads.find((l) => l.business === 'Harbor Roofing');
  let r = await t.call('POST', `/api/leads/${sp.id}/outcome`, { dispo: 'phone_menu', detail: { menu_path: 'Press 2, then 0' } });
  assert.equal(r.status, 200);
  r = await t.call('POST', `/api/leads/${hb.id}/outcome`, { dispo: 'not_interested', detail: { answered_by: 'owner', hangup_stage: 'pitch', objection: 'has_agency' } });
  assert.equal(r.status, 200);

  const s1 = await t.call('GET', `/api/leaddb/search?f=${encodeURIComponent(JSON.stringify({ menu: true }))}`);
  assert.equal(s1.status, 200);
  assert.equal(s1.data.total, 1);
  assert.equal(s1.data.rows[0].menu_path, 'Press 2, then 0');
  const s2 = await t.call('GET', `/api/leaddb/search?f=${encodeURIComponent(JSON.stringify({ reached_owner: true, r_obj: ['has_agency'] }))}&sort=reach_score`);
  assert.equal(s2.data.total, 1);
  assert.equal(s2.data.rows[0].business, 'Harbor Roofing');
  assert.equal(s2.data.rows[0].r_owner, 1);

  const ins = await t.call('GET', '/api/leaddb/insights?days=30');
  assert.equal(ins.status, 200);
  assert.equal(ins.data.total.dials, 2);
  assert.equal(ins.data.objections[0].key, 'has_agency');
  assert.equal(ins.data.answered.find((a) => a.key === 'menu').n, 1);

  const q = await t.call('PUT', `/api/leads/${hb.id}/qual`, { qual: { dm: 'owner', spend: '500', current_help: 'agency' } });
  assert.equal(q.data.qual_n, 3);
  const s3 = await t.call('GET', `/api/leaddb/search?f=${encodeURIComponent(JSON.stringify({ qual_current_help: ['agency'] }))}`);
  assert.equal(s3.data.total, 1);

  const h = await t.call('GET', '/api/leaddb/health');
  assert.equal(h.data.health.total, 2);
  assert.equal(h.data.health.reached_owner, 1);

  const rb = await t.call('POST', '/api/leaddb/rebuild', {});
  assert.equal(rb.data.done, 2);
  const csv = await t.call('GET', '/api/leaddb/export');
  assert.match(csv.data, /Harbor Roofing/);

  // Saved searches and "Dial this search".
  const sv = await t.call('PUT', '/api/leaddb/saved', { saved: [{ name: 'Menus', f: { menu: true, nope: 1 }, sort: 'r_dials' }] });
  assert.deepEqual(sv.data.saved[0].f, { menu: true });
  await t.call('PUT', '/api/leaddb/dial', { f: { q: 'Harbor' } });
  // A Tuesday at 11am in Florida, so both leads are inside calling hours.
  const real = Date.now;
  const at = new Date('2026-11-10T16:00:00Z').getTime();
  Date.now = () => at;
  try {
  await t.env.DB.prepare("UPDATE leads SET next_action_at = NULL, last_call_at = NULL, stage = 'new'").run();
  const qd = await t.call('GET', '/api/dialer/queue?db=1');
  assert.equal(qd.status, 200);
  assert.deepEqual(qd.data.queue.map((l) => l.business), ['Harbor Roofing']);
  // Three dials in 24 hours: the lead waits (Florida 3 per 24 hours).
  for (let i = 0; i < 2; i++) await t.call('POST', `/api/leads/${hb.id}/outcome`, { dispo: 'no_answer' });
  await t.env.DB.prepare("UPDATE leads SET next_action_at = NULL, last_call_at = NULL, stage = 'new'").run();
  const qc = await t.call('GET', '/api/dialer/queue?db=1');
  assert.equal(qc.data.queue.length, 0);
  } finally { Date.now = real; }
});
