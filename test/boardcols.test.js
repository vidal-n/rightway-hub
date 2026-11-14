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
    const all = boardColumns(mode, rows, {}).flatMap((c) => c.leads.map((l) => l.id));
    assert.equal(all.length, rows.length, mode);
    assert.equal(new Set(all).size, rows.length, mode);
  }
});
test('Not contacted yet is the first column in all modes and holds only never called, open leads', () => {
  for (const mode of ['stage', 'result', 'grade']) {
    const c = boardColumns(mode, rows, {})[0];
    assert.equal(c.key, 'fresh');
    assert.deepEqual(ids(c), ['fresh1', 'fresh2']);
  }
  assert.equal(isFresh(L('x', { stage: 'won' })), false);
  assert.equal(isFresh(L('y', { dnc: 1 })), false);
});
test('result mode groups by the last disposition and moves won and dead aside', () => {
  const cols = boardColumns('result', rows, {});
  const vm = cols.find((c) => c.key === 'result:Voicemail');
  assert.deepEqual(ids(vm), ['vm', 'vm2']);
  assert.equal(cols[1].key, 'result:Voicemail', 'biggest result first');
  assert.deepEqual(ids(cols.find((c) => c.key === 'dead')), ['dead', 'dnc']);
  assert.deepEqual(ids(cols.find((c) => c.key === 'won')), ['won']);
});
test('grade mode has A to D plus not graded', () => {
  const cols = boardColumns('grade', rows, {});
  assert.deepEqual(ids(cols.find((c) => c.key === 'grade:B')), ['vm', 'vm2']);
  assert.deepEqual(ids(cols.find((c) => c.key === 'grade:none')), ['na']);
  assert.deepEqual(ids(cols.find((c) => c.key === 'grade:A')), ['cb']);
});
test('stage mode keeps drag targets and can load every open column', () => {
  const cols = boardColumns('stage', rows, { attempting: 'Attempting' });
  assert.equal(cols.find((c) => c.key === 'stage:attempting').drop, 'attempting');
  assert.equal(cols[0].drop, 'new');
  assert.equal(loadable('fresh'), true);
  assert.equal(loadable('dead'), false);
  assert.equal(loadable('stage:won'), false);
});
