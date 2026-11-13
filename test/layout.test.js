import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanUi, cleanLayout, layoutFor, mergeOrder, moveId, spanOf, nextSpan, withSpan, sizeSpan, isDefault } from '../public/js/layout.js';

test('cleanLayout keeps slugs and known sizes only', () => {
  const c = cleanLayout({ order: ['a', 'a', 'B!', 'ok_1'], hidden: ['x', 5], size: { a: 'c6', b: 'huge', 'bad id': 'c3' } });
  assert.deepEqual(c, { order: ['a', 'ok_1'], hidden: ['x'], size: { a: 'c6' } });
  assert.equal(cleanLayout('x'), null);
});

test('cleanUi patches one page and keeps the rest', () => {
  const a = cleanUi(null, { callScript: false, layouts: { dashboard: { order: ['x', 'y'], hidden: [], size: {} } } });
  assert.equal(a.callScript, false);
  const b = cleanUi(a, { layouts: { dialer: { order: ['q'], hidden: ['p'], size: {} } } });
  assert.deepEqual(Object.keys(b.layouts).sort(), ['dashboard', 'dialer']);
  assert.equal(b.callScript, false);
  const c = cleanUi(b, { layouts: { dashboard: null, nonsense: { order: ['z'] } } });
  assert.deepEqual(Object.keys(c.layouts), ['dialer']);
  assert.equal(cleanUi(null, undefined), null);
  assert.equal(cleanUi(c, { callScript: true }).callScript, true);
});

test('layoutFor returns an empty layout for a page with none', () => {
  assert.ok(isDefault(layoutFor({}, 'dashboard')));
  assert.deepEqual(layoutFor({ layouts: { dialer: { order: ['a'] } } }, 'dialer').order, ['a']);
});

test('mergeOrder keeps saved order, drops gone ids, slots new ones by default neighbour', () => {
  assert.deepEqual(mergeOrder(['a', 'b', 'c'], ['c', 'a', 'b']), ['c', 'a', 'b']);
  assert.deepEqual(mergeOrder(['a', 'b', 'c'], ['c', 'gone', 'a']), ['c', 'a', 'b']);
  assert.deepEqual(mergeOrder(['a', 'n', 'b'], ['b', 'a']), ['b', 'a', 'n']);
  assert.deepEqual(mergeOrder(['a', 'b'], []), ['a', 'b']);
});

test('moveId puts an id before another or at the end', () => {
  assert.deepEqual(moveId(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
  assert.deepEqual(moveId(['a', 'b', 'c'], 'a', null), ['b', 'c', 'a']);
  assert.deepEqual(moveId(['a', 'b', 'c'], 'a', 'missing'), ['b', 'c', 'a']);
});

test('span helpers read and swap the w-N class', () => {
  assert.equal(spanOf('card w-8 wc-blue'), 8);
  assert.equal(spanOf('card wc-blue'), null);
  assert.equal(withSpan('card w-8 wc-blue', 4), 'card wc-blue w-4');
  assert.equal(nextSpan(12), 3);
  assert.equal(nextSpan(4, [4, 8]), 8);
  assert.equal(sizeSpan('c6'), 6);
  assert.equal(sizeSpan('x'), null);
});
