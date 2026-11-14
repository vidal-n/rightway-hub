import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignRows, campaignPool, followResults, calledBefore, disqualified, tierOf, cleanStages, cleanIds, DEFAULT_STAGES, CAMPAIGN_STAGES } from '../public/js/campaign.js';

const L = (o) => ({ id: o.id, phone: '(305) 555-0100', stage: 'new', business: 'Biz', ...o });
const leads = [
  L({ id: 'ld_a' }),
  L({ id: 'ld_b', stage: 'attempting', attempts: 2, last_call_at: 1, dials: 2, last_dispo: 'Voicemail' }),
  L({ id: 'ld_c', stage: 'callback', dials: 1, last_dispo: 'Callback' }),
  L({ id: 'ld_d', stage: 'not_now', dials: 1, last_dispo: 'Not interested' }),
  L({ id: 'ld_e', stage: 'lost', dials: 1, last_dispo: 'Bad number' }),
  L({ id: 'ld_f', stage: 'dnc', dnc: 1, dials: 1, last_dispo: 'Do not call' }),
  L({ id: 'ld_g', stage: 'attempting', dials: 3, last_dispo: 'Phone menu (press a number)' }),
  L({ id: 'ld_h', stage: 'follow_up', dials: 1, last_dispo: 'Dead lead (never call again)' }),
  L({ id: 'ld_i', stage: 'won' }),
  L({ id: 'ld_j', phone: '' }),
];
const ids = (r) => r.map((l) => l.id).sort();

test('the default list is fresh leads only, so a teammate never cold calls what was already worked', () => {
  assert.deepEqual(ids(campaignRows(leads, {})), ['ld_a']);
});
test('follow ups are the leads someone already called, grouped by the last result', () => {
  assert.deepEqual(ids(campaignRows(leads, { kind: 'follow' })), ['ld_b', 'ld_c']);
  assert.deepEqual(ids(campaignRows(leads, { kind: 'follow', results: ['Callback'] })), ['ld_c']);
  assert.deepEqual(followResults(campaignPool(leads, { stages: DEFAULT_STAGES })), [['Voicemail', 1], ['Callback', 1]]);
});
test('every stage can be chosen, including not now and lost, but never won or do not call', () => {
  assert.ok(CAMPAIGN_STAGES.includes('not_now') && CAMPAIGN_STAGES.includes('audit_booked'));
  assert.ok(!CAMPAIGN_STAGES.includes('won') && !CAMPAIGN_STAGES.includes('dnc'));
  assert.deepEqual(ids(campaignRows(leads, { kind: 'follow', stages: ['not_now'] })), ['ld_d']);
});
test('do not call, dead, bad number and phone menu leads are disqualified for everyone, even when ticked by hand', () => {
  for (const id of ['ld_e', 'ld_f', 'ld_g', 'ld_h']) assert.ok(disqualified(leads.find((l) => l.id === id)), id);
  const all = campaignRows(leads, { kind: 'all', stages: [...CAMPAIGN_STAGES] });
  assert.ok(!all.some((l) => ['ld_e', 'ld_f', 'ld_g', 'ld_h'].includes(l.id)));
  assert.deepEqual(ids(campaignRows(leads, { only: new Set(['ld_f', 'ld_a']) })), ['ld_a']);
});
test('leads with no number are left out, and ticked leads override fresh versus follow up', () => {
  assert.ok(!campaignRows(leads, { kind: 'all' }).some((l) => l.id === 'ld_j'));
  assert.deepEqual(ids(campaignRows(leads, { only: new Set(['ld_b', 'ld_a']) })), ['ld_a', 'ld_b']);
});
test('quality tiers match the Worker, and stages and ids are cleaned', () => {
  assert.equal(tierOf({ stage: 'callback' }), 'hot');
  assert.equal(tierOf({ stage: 'new' }), 'fresh');
  assert.equal(tierOf({ stage: 'new', researched: true, grade: 'B' }), 'good');
  assert.deepEqual(cleanStages(['new', 'won', 'dnc', 'new', 'lost']), ['new', 'lost']);
  assert.deepEqual(cleanIds(['ld_1', 'ld_1', 'x', 5, 'ld_2;drop']), ['ld_1']);
  assert.ok(calledBefore({ attempts: 1 }) && !calledBefore({}));
});
