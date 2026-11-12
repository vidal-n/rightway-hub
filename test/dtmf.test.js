import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The keypad tones are mixed into the mic audio because Twilio conferences drop the browser's own digits.
const src = readFileSync(new URL('../public/hub/audioset.js', import.meta.url), 'utf8');
const table = src.match(/const DTMF = (\{[^;]*\});/);

test('DTMF table has the 12 keys with the standard row and column tones', () => {
  assert.ok(table, 'DTMF table missing');
  const t = new Function(`return ${table[1]}`)();
  assert.equal(Object.keys(t).length, 12);
  assert.deepEqual(t[1], [697, 1209]);
  assert.deepEqual(t[5], [770, 1336]);
  assert.deepEqual(t['#'], [941, 1477]);
  assert.deepEqual(t['*'], [941, 1209]);
  assert.deepEqual(t[0], [941, 1336]);
});

test('outbound calls send tones in band, others send digits', () => {
  const phone = readFileSync(new URL('../public/hub/phone.js', import.meta.url), 'utf8');
  assert.match(phone, /view\.kind === 'out' && sendTone\(k\)/);
  assert.match(phone, /call\.sendDigits\(k\)/);
});
