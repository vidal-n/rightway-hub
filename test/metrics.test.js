import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METRICS, metricFor, lowSample } from '../public/js/metrics.js';

test('metrics: labels across the Hub find their explainer', () => {
  const cases = { 'dials today, goal 60': 'dials_today', 'owner conversations today': 'owner_conv', 'audits booked today': 'audits_booked', 'Dials per audit': 'dials_per_audit',
    'Dials to reach an owner': 'tries_owner', 'A person picked up': 'pickup', 'Reached the owner': 'owner_rate', 'monthly recurring revenue': 'mrr', 'collected this month': 'collected',
    'of the area sees you on the first page (top 10)': 'top10', 'Best hours, their time': 'best_hours', 'Conversion funnel': 'funnel', 'Dials': 'dials', 'Hung up in 10s': 'fast_hang',
    'projected by month end at this pace': 'projected', 'revenue per hour worked': 'rev_hour', 'leads you can call now (0 A grade open)': 'callable_now' };
  for (const [label, k] of Object.entries(cases)) assert.equal(metricFor(label)?.k, k, label);
  assert.equal(metricFor('Save this search'), null);
});

test('metrics: every entry answers all seven questions in plain words', () => {
  for (const m of METRICS) {
    for (const f of ['name', 'what', 'formula', 'scope', 'bench', 'why', 'misleads']) assert.ok(m[f] && m[f].length > 3, `${m.k}.${f}`);
    assert.ok(!/[\u2013\u2014]/.test(JSON.stringify(m)), `${m.k} has no long dashes`);
  }
  assert.equal(new Set(METRICS.map((m) => m.k)).size, METRICS.length);
  assert.ok(lowSample(12) && !lowSample(30) && !lowSample(0));
});
