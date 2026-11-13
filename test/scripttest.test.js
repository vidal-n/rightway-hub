// Script tests: the math, the per lead split, version fingerprints, the new scripts, and calls counted by script end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
import { sampleSize, chanceBetter, zTest, wilson, assign, versionOf, funnel, verdict, callFacts, cleanTest } from '../public/js/scripttest.js';
import { discoveryFor } from '../public/js/discovery.js';
import { CATALOG, ML, catalogRows } from '../public/js/rebuttals.js';
import { buildScript, DEFAULT_OBJECTIONS, SCRIPT_GROUPS } from '../public/js/leadintel.js';

test('sample sizes match the research table (alpha 0.05, power 0.8)', () => {
  assert.equal(sampleSize(0.1, 0.2), 199);
  assert.equal(sampleSize(0.15, 0.25), 250);
  assert.ok(Math.abs(sampleSize(0.02, 0.03) - 3825) <= 1);
  assert.equal(sampleSize(0.1, 0.1), Infinity);
});

test('chance better, z test and the 95% range', () => {
  assert.ok(chanceBetter(20, 200, 40, 200) > 0.99);
  assert.ok(Math.abs(chanceBetter(20, 200, 20, 200) - 0.5) < 1e-9);
  assert.ok(zTest(20, 200, 40, 200).p < 0.01);
  const [lo, hi] = wilson(12, 100);
  assert.ok(lo > 0.06 && lo < 0.08 && hi > 0.19 && hi < 0.21);
});

test('split: the same lead always gets the same script, both scripts get used', () => {
  const v = ['analysis', 'question'];
  assert.equal(assign('t1', 'lead-1', v), assign('t1', 'lead-1', v));
  const counts = { analysis: 0, question: 0 };
  for (let i = 0; i < 400; i++) counts[assign('t1', `lead-${i}`, v)]++;
  assert.ok(counts.analysis > 150 && counts.question > 150, JSON.stringify(counts));
  assert.equal(assign('t1', 'x', []), null);
  assert.equal(versionOf(['a  b', 'c']), versionOf(['a b', 'c']), 'spacing does not make a new version');
  assert.notEqual(versionOf(['a b']), versionOf(['a c']));
  assert.equal(cleanTest({ on: true, variants: ['analysis'] }).on, false, 'a test needs two scripts');
});

test('what a call counts as, and the verdict waits for enough data', () => {
  assert.equal(callFacts({ outcome: 'no_answer' }).connect, false);
  assert.equal(callFacts({ outcome: 'booked' }).conv, true);
  assert.equal(callFacts({ outcome: 'gatekeeper', answered_by: 'staff' }).owner, false);
  assert.equal(callFacts({ outcome: 'not_interested', answered_by: 'owner', duration: 20 }).conv, true);
  assert.equal(callFacts({ outcome: 'conversation', bk: 1 }).booked, true, 'a booking made from the call counts');
  const at = Date.now() - 30 * 864e5;
  const rows = [];
  for (let i = 0; i < 300; i++) rows.push({ script: 'analysis', outcome: i < 30 ? 'booked' : 'not_interested', answered_by: 'owner', at: at + i * 6e6, lead_id: `a${i}`, by: 'u1' });
  for (let i = 0; i < 300; i++) rows.push({ script: 'question', outcome: i < 66 ? 'booked' : 'not_interested', answered_by: 'owner', at: at + i * 6e6, lead_id: `q${i}`, by: 'u1' });
  const stats = funnel(rows);
  assert.equal(stats.find((s) => s.key === 'question').booked, 66);
  const v = verdict(stats);
  assert.equal(v.state, 'winner');
  assert.equal(v.leader, 'question');
  const early = verdict(funnel(rows.filter((r, i) => i % 10 === 0)));
  assert.equal(early.state, 'collecting', 'no winner on 30 conversations each');
});

test('question opener script: V\'s opener, a trade question, labels, time ask', () => {
  assert.ok(SCRIPT_GROUPS.find((g) => g[0] === 'question'));
  const s = buildScript({ business: 'Paws Spa', industry: 'Pet grooming', city: 'Miami' }, null, { rep: 'Sam', voice: 'we' });
  const q = s.steps.filter((x) => x.group === 'question');
  const text = q.flatMap((x) => x.lines).join('\n');
  assert.match(text, /The reason for the call is I have a question for you about Paws Spa/);
  assert.match(text, /live strategy in your pocket/);
  assert.match(text, /How are you getting more customers in the door right now\?/);
  assert.match(text, /It sounds like there are a few ways I could help you get more quality jobs in the door/);
  assert.match(text, /could be some low hanging fruit/, 'no research, so it stays a maybe');
  assert.doesNotMatch(text, /[–—]/, 'no dashes');
  assert.doesNotMatch(text, /\{\w+\}/, 'every blank filled');
  assert.equal(discoveryFor('HVAC contractor').q, 'How are you keeping the trucks busy outside the summer rush?');
  assert.equal(discoveryFor('', 'something odd').generic, true);
});

test('every objection has a mirror, a label and a question; the catalog has 46', () => {
  for (const [q] of DEFAULT_OBJECTIONS) assert.ok(ML[q], `mirror and label for "${q}"`);
  for (const m of Object.values(ML)) { assert.match(m.label, /^(It sounds|It seems|It looks|Fair\. It sounds)/); assert.doesNotMatch(m.ask, /(^|[.?!] )why\b/i, "no why questions"); }
  assert.equal(CATALOG.length, 46);
  const rows = catalogRows((t) => t.replace('{slot1}', 'today at 4pm').replace('{slot2}', 'tomorrow at 11am'));
  assert.ok(rows.every((r) => !/guarantee (you|first|number)/i.test(r.say) || /isn't being straight|nobody can promise/i.test(r.say)), 'never promise a spot');
  assert.ok(rows.every((r) => !/[–—]/.test(`${r.say}${r.yes}${r.no}${r.dodge}${r.exit}`)));
  const s = buildScript({ business: 'Joe Plumbing', city: 'Miami', industry: 'Plumbing' }, null, { rep: 'Sam' });
  assert.equal(s.catalog.length, 46);
  assert.ok(s.objections.every((o) => o.ml));
});

test('calls are counted by script end to end', async () => {
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
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  await call('POST', '/api/leads/import', { rows: [1, 2, 3, 4].map((i) => ({ business: `Shop ${i} Plumbing`, phone: `305-555-01${20 + i}`, state: 'FL', city: 'Miami' })) });
  const leads = (await call('GET', '/api/leads')).data.leads;
  await call('POST', `/api/leads/${leads[0].id}/outcome`, { dispo: 'booked', script: 'question', scriptV: 'abc123', callbackAt: new Date(Date.now() + 864e5).toISOString() });
  await call('POST', `/api/leads/${leads[1].id}/outcome`, { dispo: 'not_interested', script: 'question', scriptV: 'abc123', detail: { answered_by: 'owner' } });
  await call('POST', `/api/leads/${leads[2].id}/outcome`, { dispo: 'no_answer', script: 'analysis' });
  await call('POST', `/api/leads/${leads[3].id}/outcome`, { dispo: 'not_interested', script: 'nonsense' });
  let r = await call('GET', '/api/scripts/stats?days=30');
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.data.stats.map((s) => [s.key, s]));
  assert.equal(by.question.dials, 2);
  assert.equal(by.question.booked, 1);
  assert.equal(by.analysis.dials, 1);
  assert.equal(by.analysis.connects, 0);
  assert.equal(by.nonsense, undefined, 'unknown scripts are not stored');
  assert.equal(r.data.verdict.state, 'collecting');
  // Owner starts a split test; two scripts needed.
  r = await call('PUT', '/api/scripts/test', { on: true, variants: ['analysis'] });
  assert.equal(r.status, 400);
  r = await call('PUT', '/api/scripts/test', { on: true, variants: ['analysis', 'question'] });
  assert.equal(r.data.test.on, true);
  const id = r.data.test.id;
  r = await call('PUT', '/api/scripts/test', { on: true, variants: ['analysis', 'question'] });
  assert.equal(r.data.test.id, id, 'saving the same scripts keeps the test');
  r = await call('PUT', '/api/scripts/test', { on: true, variants: ['analysis', 'cold'] });
  assert.notEqual(r.data.test.id, id, 'changing the scripts starts a new test');
  r = await call('GET', '/api/scripts/test');
  assert.deepEqual(r.data.test.variants, ['analysis', 'cold']);
  assert.equal(r.data.test.allowPick, true, 'reps may pick their own script by default');
  // A call the test assigned counts in the test; a rep's own pick counts only under Reps' own picks and All.
  await call('POST', '/api/leads/import', { rows: [{ business: 'Split Shop Roofing', phone: '305-555-0190', state: 'FL', city: 'Miami' }, { business: 'Own Pick Roofing', phone: '305-555-0191', state: 'FL', city: 'Miami' }] });
  const more = (await call('GET', '/api/leads')).data.leads;
  const byName = (n) => more.find((l) => l.business === n).id;
  await call('POST', `/api/leads/${byName('Split Shop Roofing')}/outcome`, { dispo: 'not_interested', script: 'cold', scriptHow: 'split' });
  await call('POST', `/api/leads/${byName('Own Pick Roofing')}/outcome`, { dispo: 'not_interested', script: 'cold', scriptHow: 'pick' });
  r = await call('GET', '/api/scripts/stats?test=1');
  assert.equal(r.data.stats.reduce((a, x) => a + x.dials, 0), 1, 'only the split call is in the test');
  r = await call('GET', '/api/scripts/stats?how=pick&days=30');
  assert.equal(r.data.stats.find((x) => x.key === 'cold').dials, 1);
  r = await call('PUT', '/api/scripts/test', { on: true, variants: ['analysis', 'cold'], allowPick: false });
  assert.equal(r.data.test.allowPick, false);
});

test('price is never named on a cold call, and no pet puns', () => {
  const s = buildScript({ business: 'Happy Tails Grooming', industry: 'Pet grooming', city: 'Miami' }, null, { rep: 'Sam' });
  const cold = s.steps.filter((x) => ['question', 'cold', 'plan'].includes(x.group)).flatMap((x) => x.lines).join('\n');
  assert.doesNotMatch(cold, /\$\s?\d/, 'no dollar amounts');
  assert.match(cold, /performance based/);
  assert.doesNotMatch(cold, /paws|pups/i);
  const cost = s.catalog.find((x) => x.id === 'cost');
  assert.match(cost.say, /only matters if it gets you results/);
  assert.doesNotMatch(JSON.stringify(s.catalog), /\$\s?\d/);
});

test('cold calling and the meeting audit are two categories, and clarity stays out of cold calling', async () => {
  const { COLD_GROUPS, MEETING_GROUPS, groupKind } = await import('../public/js/leadintel.js');
  const { readFileSync } = await import('node:fs');
  assert.deepEqual(COLD_GROUPS, ['analysis', 'question', 'cold', 'plan']);
  assert.deepEqual(MEETING_GROUPS, ['clarity']);
  assert.equal(groupKind('clarity'), 'meeting');
  assert.equal(groupKind('question'), 'cold');
  const s = buildScript({ business: 'Joe Plumbing', city: 'Miami', industry: 'Plumbing' }, null, { rep: 'Sam' });
  assert.ok(s.groups.every((g) => g.kind === groupKind(g.key)));
  const cold = s.steps.filter((x) => x.kind === 'cold');
  assert.ok(cold.length > 10 && cold.every((x) => COLD_GROUPS.includes(x.group)));
  assert.ok(s.steps.filter((x) => x.kind === 'meeting').every((x) => x.group === 'clarity'));
  assert.doesNotMatch(cold.flatMap((x) => x.lines).join('\n'), /clarity/i, 'no clarity audit wording in any cold call script');
  const coldObj = s.objections.filter((o) => o.kind === 'cold');
  assert.equal(coldObj.length, 7);
  assert.doesNotMatch(JSON.stringify(coldObj), /clarity/i);
  assert.ok(coldObj.every((o) => !/^Cold: /.test(o.q)));
  assert.ok(s.objections.filter((o) => o.kind === 'meeting').length > 20);
  // Screens that belong to cold calling never mention it, and never offer the clarity group.
  for (const f of ['public/hub/scriptpane.js', 'public/hub/scriptpick.js', 'public/hub/phone.js', 'public/hub/dispo.js']) assert.doesNotMatch(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), /clarity/i, f);
  const prep = readFileSync(new URL('../public/hub/prep.js', import.meta.url), 'utf8');
  const cut = prep.slice(prep.indexOf('export async function prepPanel'), prep.indexOf('export function scriptFold'));
  assert.doesNotMatch(cut, /clarity/i, 'call prep holds cold scripts only');
});
