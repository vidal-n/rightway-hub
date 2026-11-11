import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, NOISE, normalize, plan, constraintsFor, gateThreshold, gateStep, pickInput, permissionHelp, deviceLabel } from '../public/js/audiocfg.js';

test('audio settings stay inside safe limits', () => {
  assert.deepEqual(normalize(undefined), DEFAULTS);
  const n = normalize({ gain: 9999, noise: 'weird', gate: 99, mic: 5, mode: 'x' });
  assert.equal(n.gain, 300); assert.equal(n.noise, 'light'); assert.equal(n.gate, 10); assert.equal(n.mic, ''); assert.equal(n.mode, 'browser');
  assert.equal(normalize({ gain: 1 }).gain, 20);
  assert.equal(normalize({ mode: 'phone' }).mode, 'phone');
});

test('noise levels decide what the phone does', () => {
  // Default is the browser cleanup alone: no extra audio processing in the way of a call.
  assert.equal(plan(DEFAULTS).processor, false);
  assert.equal(plan(DEFAULTS).ns, true);
  assert.equal(plan({ noise: 'off' }).ns, false);
  assert.equal(plan({ noise: 'standard' }).processor, true);
  assert.equal(plan({ noise: 'standard' }).hp, 90);
  assert.equal(plan({ noise: 'strong' }).gate, 4);
  assert.equal(plan({ noise: 'strong', gate: 8 }).gate, 8, 'the slider wins over the preset');
  assert.equal(plan({ noise: 'light', gain: 150 }).processor, true, 'mic volume needs the processor');
  assert.equal(plan({ gain: 150 }).gain, 1.5);
  assert.ok(Object.keys(NOISE).length === 4);
});

test('browser constraints follow the toggles and the chosen mic', () => {
  let c = constraintsFor({});
  assert.deepEqual(c, { noiseSuppression: true, echoCancellation: true, autoGainControl: true });
  c = constraintsFor({ noise: 'off', echo: false, auto: false, mic: 'abc' });
  assert.deepEqual(c, { noiseSuppression: false, echoCancellation: false, autoGainControl: false, deviceId: { exact: 'abc' } });
});

test('quiet room gate opens fast, closes after a hold, and is off at 0', () => {
  assert.equal(gateThreshold(0), 0);
  assert.ok(gateThreshold(10) > gateThreshold(1));
  assert.ok(gateThreshold(10) < 0.06, 'never cuts a normal voice');
  const thr = gateThreshold(4);
  let s = { open: true, quiet: 0 };
  s = gateStep(s, thr / 3, thr, 100); assert.equal(s.open, true, 'brief pause between words stays open');
  s = gateStep(s, thr / 3, thr, 100); s = gateStep(s, thr / 3, thr, 100); assert.equal(s.open, false, 'long quiet closes it');
  s = gateStep(s, thr * 1.1, thr, 25); assert.equal(s.open, false, 'needs a clear voice to reopen');
  s = gateStep(s, thr * 1.5, thr, 25); assert.equal(s.open, true);
  assert.equal(gateStep({ open: false, quiet: 999 }, 0, 0, 25).open, true, 'gate off = always open');
});

test('a missing Bluetooth mic falls back to default', () => {
  const list = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(pickInput(list, 'b'), { id: 'b', lost: false });
  assert.deepEqual(pickInput(list, 'gone'), { id: '', lost: true });
  assert.deepEqual(pickInput(list, ''), { id: '', lost: false });
  assert.equal(deviceLabel({ label: '' }, 1), 'Microphone 2');
});

test('permission help is specific to the device', () => {
  assert.match(permissionHelp('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari')[0], /Settings, then Safari/);
  assert.match(permissionHelp('Mozilla/5.0 (Linux; Android 14) Chrome/120')[0], /lock icon/);
  assert.match(permissionHelp('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit Version/17 Safari/605')[0], /Safari open Settings/);
  assert.match(permissionHelp('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537')[0], /Site settings/);
});
