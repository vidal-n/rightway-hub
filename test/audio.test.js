import test from 'node:test';
import { DEFAULTS, NOISE, normalize, personalPart, mergeDevice, plan, constraintsFor, gateThreshold, gateStep, pickInput, permissionHelp, deviceLabel, lockThreshold, learnLevel, meterPct, isIOS, looksBluetooth, advice, toneWav, constraintsAnyMic } from '../public/js/audiocfg.js';
import assert from 'node:assert/strict';

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
  assert.ok(permissionHelp('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit Safari').some((t) => /aA/.test(t) && /Website Settings/.test(t)));
  assert.match(permissionHelp('Mozilla/5.0 (Linux; Android 14) Chrome/120')[0], /lock icon/);
  assert.match(permissionHelp('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit Version/17 Safari/605')[0], /Safari open Settings/);
  assert.match(permissionHelp('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537')[0], /Site settings/);
});

test('cleanup levels map to the voice engine', () => {
  assert.equal(plan({ noise: 'light' }).ai, 0, 'light is the browser cleanup alone');
  assert.equal(plan({ noise: 'standard' }).ai, 0.5);
  assert.equal(plan({ noise: 'strong' }).ai, 0.85);
  assert.equal(plan({ noise: 'strong', ai: 20 }).ai, 0.2, 'the slider wins over the preset');
  assert.equal(plan({ noise: 'off', ai: 40 }).processor, true);
  assert.equal(normalize({ ai: 999 }).ai, 100);
  assert.equal(normalize({ ai: 'x' }).ai, -1);
});

test('headset mode skips the browser cleanup unless told otherwise', () => {
  assert.equal(plan({ noise: 'standard', headset: true }).ns, false);
  assert.equal(plan({ noise: 'standard', headset: true, ns: 'on' }).ns, true);
  assert.equal(constraintsFor({ headset: true }).noiseSuppression, false);
});

test('voice lock needs a learned level and turns auto level off', () => {
  assert.equal(plan({ lock: true }).lock, 0, 'no learned level yet, so nothing is locked');
  const p = plan({ lock: true, level: 0.1, strict: 6 });
  assert.ok(p.lock > 0 && p.lock < 0.1);
  assert.equal(p.auto, false);
  assert.equal(p.processor, true);
  assert.equal(plan({ lock: false, level: 0.1 }).lock, 0);
  assert.equal(constraintsFor({ lock: true, level: 0.1 }).autoGainControl, false);
  assert.ok(lockThreshold(0.1, 10) > lockThreshold(0.1, 1), 'stricter means a higher bar');
  assert.equal(lockThreshold(0, 5), 0);
  assert.equal(normalize({ level: -4 }).level, 0);
  assert.equal(normalize({ strict: 99 }).strict, 10);
});

test('learnLevel takes the median of the speech and ignores pauses', () => {
  const frames = [];
  for (let i = 0; i < 80; i++) frames.push(0.003);                         // room
  for (let i = 0; i < 120; i++) frames.push(0.08 + (i % 10) * 0.004);        // speech around 0.1
  const l = learnLevel(frames);
  assert.ok(l > 0.08 && l < 0.13, String(l));
  assert.equal(learnLevel(new Array(100).fill(0.003)), 0, 'a silent room teaches nothing');
  assert.equal(learnLevel([0.1, 0.2]), 0);
  assert.equal(learnLevel(undefined), 0);
});

test('meter, device and tip helpers', () => {
  assert.equal(meterPct(0), 0);
  assert.equal(meterPct(1), 100);
  assert.ok(meterPct(0.01) > 30 && meterPct(0.01) < 40);
  assert.equal(isIOS('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'), true);
  assert.equal(isIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 5), true, 'iPad pretending to be a Mac');
  assert.equal(isIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 0), false);
  assert.equal(looksBluetooth('AirPods Pro'), true);
  assert.equal(looksBluetooth('MacBook Pro Microphone'), false);
  assert.ok(advice({ micLabel: 'Jabra Evolve2 (Bluetooth)' }).length >= 2);
  assert.ok(advice({ ios: true }).some((t) => /Voice Isolation/.test(t)));
  assert.deepEqual(advice({}), []);
  assert.equal(constraintsAnyMic({ mic: 'abc' }).deviceId, undefined);
});

test('speaker test tone is a valid WAV', () => {
  const w = toneWav();
  assert.equal(String.fromCharCode(...w.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...w.slice(8, 12)), 'WAVE');
  const v = new DataView(w.buffer);
  assert.equal(v.getUint32(4, true), w.length - 8);
  assert.equal(v.getUint32(40, true), w.length - 44);
  let peak = 0; for (let i = 44; i < w.length; i += 2) peak = Math.max(peak, Math.abs(v.getInt16(i, true)));
  assert.ok(peak > 3000 && peak < 20000, 'audible but not loud');
});

test('no em or en dashes in audio copy', async () => {
  const fs = await import('node:fs');
  for (const f of ['public/js/audiocfg.js', 'public/hub/audioset.js', 'public/js/denoise-worklet.js']) {
    const t = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(!/[\u2013\u2014]/.test(t), f);
  }
});

test('mic settings follow the person, but each computer keeps its own mic and speaker', () => {
  const laptop = { mic: 'usb-mic-1', out: 'speakers-a', gain: 150, noise: 'strong', lock: true, level: 0.02, mode: 'phone' };
  const shared = personalPart(laptop);
  assert.equal(shared.mic, undefined);
  assert.equal(shared.out, undefined);
  assert.equal(shared.gain, 150);
  assert.equal(shared.noise, 'strong');
  assert.equal(shared.level, 0.02);
  // a teammate's computer gets the same voice and levels, with its own devices
  const desk = mergeDevice(shared, { mic: 'desk-mic', out: 'desk-out' });
  assert.equal(desk.mic, 'desk-mic');
  assert.equal(desk.out, 'desk-out');
  assert.equal(desk.gain, 150);
  assert.equal(desk.lock, true);
  assert.equal(desk.mode, 'phone');
  // nothing saved on the server yet: this computer's own values stay
  assert.equal(mergeDevice(null, { mic: 'x', out: '', gain: 90 }).mic, 'x');
  // the server copy is cleaned on the way in
  assert.equal(personalPart({ gain: 9999, noise: 'junk', mic: 'x' }).gain, 300);
  assert.equal(personalPart({ noise: 'junk' }).noise, 'light');
});
