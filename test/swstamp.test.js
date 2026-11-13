import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampFor, currentName } from '../scripts/stamp-sw.mjs';

// The service worker serves scripts from a cache named after a hash of public/. If this fails, run: node scripts/stamp-sw.mjs
test('service worker cache name matches the files in public/', () => {
  assert.equal(currentName(), stampFor(), 'run node scripts/stamp-sw.mjs and commit public/sw.js');
});
