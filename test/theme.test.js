import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaFor, cleanMode, nextMode } from '../public/js/theme.js';

test('forced dark makes dark rules always apply and switches light rules off', () => {
  assert.equal(mediaFor('(prefers-color-scheme: dark)', 'dark'), '(min-width: 0px)');
  assert.equal(mediaFor('(prefers-color-scheme: light)', 'dark'), 'not all');
  assert.equal(mediaFor('(min-width: 900px) and (prefers-color-scheme: dark)', 'dark'), '(min-width: 900px) and (min-width: 0px)');
});
test('forced light switches dark rules off, auto leaves them alone', () => {
  assert.equal(mediaFor('(prefers-color-scheme: dark)', 'light'), 'not all');
  assert.equal(mediaFor('(prefers-color-scheme: dark)', 'auto'), '(prefers-color-scheme: dark)');
  assert.equal(mediaFor('(max-width: 600px)', 'dark'), '(max-width: 600px)');
});
test('mode helpers', () => {
  assert.equal(cleanMode('nope'), 'auto');
  assert.equal(cleanMode('dark'), 'dark');
  assert.notEqual(nextMode('auto'), 'auto');
});
