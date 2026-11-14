import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardColumns, isFresh, loadable } from '../public/js/boardcols.js';

const L = (id, o = {}) => ({ id, phone: '3055550100', stage: 'new', grade: 'A', ...o });
const rows = [
  L('fresh1'), L('fresh2', { grade: 'C' }),
  L('vm', { stage: 'attempting', dials: 1, last_dispo: 'Voicemail', grade: 'B' }),
  L('vm2', { stage: 'attempting', dials: 2, last_dispo: 'Voicemail', grade: 'B' }),
  L('na', { stage: 'attempting', dials: 1, last_dispo: 'No answer', grade: null }),
  L('cb', { stage: 'callback', dials: 1, last_dispo: 'Callback', grade: 'A' }),
  L('won', { stage: 'won', dials: 3, last_dispo: 'Booked audit' }),
  L('dnc', { stage: 'dnc', dnc: 1, dials: 1, last_dispo: 'Do not call' }),
  L('dead', { stage: 'lost', dials: 1, last_dispo: 'Dead lead (never call again)' }),
];
const ids = (c) => c.leads.map((l) => l.id).sort();

test('every lead sits in exactly one column in every mode', () => {
  for (const mode of ['stage', 'result', 'grade']) {
    const all = boardColumns(mode, rows, { split: true }).flatMap((c) => c.leads.map((l) => l.id));
    assert.equal(all.length, rows.length, mode);
    assert.equal(new Set(all).size, rows.length, mode);
  }
});
test('Not contacted yet is the first column in all modes and holds only never called, open leads', () => {
  for (const mode of ['stage', 'result', 'grade']) {
    const c = boardColumns(mode, rows, { split: true })[0];
    assert.equal(c.key, 'fresh');
    assert.deepEqual(ids(c), ['fresh1', 'fresh2']);
  }
  assert.equal(isFresh(L('x', { stage: 'won' })), false);
  assert.equal(isFresh(L('y', { dnc: 1 })), false);
});
test('result mode groups by the last disposition and moves won and dead aside', () => {
  const cols = boardColumns('result', rows);
  const vm = cols.find((c) => c.key === 'result:Voicemail');
  assert.deepEqual(ids(vm), ['vm', 'vm2']);
  assert.equal(cols[1].key, 'result:Voicemail', 'biggest result first');
  assert.deepEqual(ids(cols.find((c) => c.key === 'dead')), ['dead', 'dnc']);
  assert.deepEqual(ids(cols.find((c) => c.key === 'won')), ['won']);
});
test('grade mode has A to D plus not graded', () => {
  const cols = boardColumns('grade', rows);
  assert.deepEqual(ids(cols.find((c) => c.key === 'grade:B')), ['vm', 'vm2']);
  assert.deepEqual(ids(cols.find((c) => c.key === 'grade:none')), ['na']);
  assert.deepEqual(ids(cols.find((c) => c.key === 'grade:A')), ['cb']);
});
test('stage mode keeps drag targets and can load every open column', () => {
  const cols = boardColumns('stage', rows, { stageLabel: { attempting: 'Attempting' } });
  assert.equal(cols.find((c) => c.key === 'stage:attempting').drop, 'attempting');
  assert.equal(cols[0].drop, 'new');
  assert.equal(loadable('fresh'), true);
  assert.equal(loadable('dead'), false);
  assert.equal(loadable('stage:won'), false);
});

import { BOARD_MODES, showFilter, modeGroups } from '../public/js/boardcols.js';
const more = [
  ...rows,
  { id: 'pt1', phone: '1', stage: 'new', tz_short: 'PT', state: 'CA', city: 'Fresno', industry: 'roofing', phone_type: 'mobile', reviews: 5 },
  { id: 'pt2', phone: '1', stage: 'attempting', dials: 2, tz_short: 'PT', owner_talks: 1, connects: 1, last_objection: 'not_interested', last_call_at: Date.now() - 3600e3 },
];
test('every "Columns by" choice puts each lead in exactly one column, split or not', () => {
  assert.ok(BOARD_MODES.length >= 25, 'lots of ways to lay out the board');
  for (const m of BOARD_MODES) for (const split of [true, false]) {
    const ids = boardColumns(m.id, more, { split, users: { u1: 'Kiron' } }).flatMap((c) => c.leads.map((l) => l.id));
    assert.equal(ids.length, more.length, `${m.id} split=${split}`);
    assert.equal(new Set(ids).size, more.length, `${m.id} split=${split}`);
  }
  assert.ok(modeGroups().length >= 4);
});
test('time zone columns show every Pacific lead, and Show narrows before the columns', () => {
  const cols = boardColumns('tz', more, { split: false });
  assert.deepEqual(cols.find((c) => c.label === 'Pacific (PT)').leads.map((l) => l.id).sort(), ['pt1', 'pt2']);
  const fresh = boardColumns('tz', showFilter(more, 'fresh'), { split: false });
  assert.deepEqual(fresh.find((c) => c.label === 'Pacific (PT)').leads.map((l) => l.id), ['pt1']);
  assert.notEqual(boardColumns('tz', more)[0].key, 'fresh', 'place columns do not split out fresh leads unless asked');
  const reached = boardColumns('reached', more, { split: false });
  assert.deepEqual(reached.find((c) => c.label === 'Talked to the owner').leads.map((l) => l.id), ['pt2']);
  assert.ok(boardColumns('objection', more, { split: false }).some((c) => c.leads.some((l) => l.id === 'pt2') && c.label !== 'Not called yet'));
});

import { pivot, coverageOf } from '../public/js/boardcols.js';
test('call coverage buckets match the Lead database donut, and the pivot counts every lead once per time zone', () => {
  assert.equal(coverageOf({ stage: 'new' }), 'Never called');
  assert.equal(coverageOf({ stage: 'attempting', dials: 1 }), 'Called, owner not reached');
  assert.equal(coverageOf({ stage: 'attempting', dials: 2, owner_talks: 1 }), 'Reached the owner');
  assert.equal(coverageOf({ stage: 'dnc', dnc: 1, dials: 1 }), 'Do not call');
  const pv = pivot('tz', 'coverage', more);
  const pt = pv.rows.find((r) => r.label === 'Pacific (PT)');
  assert.equal(pt.total, 2);
  assert.equal(pt.cells.get('Never called').length, 1);
  assert.equal(pt.cells.get('Reached the owner').length, 1);
  assert.equal(pv.rows.reduce((n, r) => n + r.total, 0), more.length);
  assert.deepEqual(pv.cols.map((c) => c.label).slice(0, 2), ['Never called', 'Called, owner not reached'], 'coverage keeps its order');
});
