// Script follows the real trade (Google's category over the search keyword), stays open between calls, and the dialer only
// shows the script picked for the campaign.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { industryInfo, buildScript } from '../public/js/leadintel.js';
import { leadRow, industryFor } from '../public/js/finder.js';
import { discoveryFor } from '../public/js/discovery.js';

const src = (f) => readFileSync(new URL(`../public/hub/${f}`, import.meta.url), 'utf8');

test('Google category beats the search keyword', () => {
  assert.equal(industryInfo('landscaping company', 'General contractor').label, 'Remodeling');
  assert.equal(industryInfo('landscaping', '').label, 'Landscaping');
  assert.equal(industryInfo('', 'Landscaper').label, 'Landscaping');
  // an unknown category falls back to the industry
  assert.equal(industryInfo('landscaping', 'Business').label, 'Landscaping');
});

test('Lead finder rows keep the real trade', () => {
  const gc = { title: 'ABC Builders', category: 'General contractor', kw: 'landscaping company', phone: '3055550101' };
  assert.equal(industryFor(gc), 'General contractor');
  assert.equal(leadRow(gc).industry, 'General contractor');
  assert.equal(leadRow({ title: 'X', category: 'Establishment', kw: 'pool service' }).industry, 'pool service');
  assert.equal(leadRow({ title: 'X', category: 'Establishment', kw: 'pool service' }, { industry: 'Pools' }).industry, 'Pools');
});

test('the script for an old lead saved with the keyword is fixed at read time', () => {
  const lead = { id: 'a', business: 'ABC Builders', industry: 'landscaping company', category: 'General contractor', phone: '3055550101', city: 'Miami', state: 'FL' };
  const s = buildScript(lead, null, { rep: 'Sam', voice: 'I' }, {});
  const text = JSON.stringify(s.steps.map((x) => x.lines));
  assert.ok(!/landscap/i.test(text), 'no landscaping words for a general contractor');
  assert.equal(discoveryFor('General contractor', 'Remodeling', 'landscaping').generic, false);
});

test('script pane waits for the call window and only the newest lead paints', () => {
  const s = src('scriptpane.js');
  assert.match(s, /waitForBar/);
  assert.match(s, /token !== shown/);
  assert.ok(!/\|\| pane\) return/.test(s), 'the stale pane guard is gone');
});

test('dialer scripts are locked to the picked script', () => {
  const pane = src('scriptpane.js'), prep = src('prep.js'), crm = src('crm.js');
  assert.match(pane, /const only = COLD_GROUPS\.includes\(picked\)/);
  assert.match(prep, /only = lock && COLD_GROUPS\.includes\(picked\)/);
  assert.match(prep, /g\.key === only/);
  assert.match(crm, /lock: true/);
  assert.match(prep, /__prepSeq/);
});
