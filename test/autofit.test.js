import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fit, analyze, gainFor, lockFor, candidates, describe, wavFrom, frameLevels, rmsOf } from '../public/js/autofit.js';
import { plan } from '../public/js/audiocfg.js';

const SRC = fs.readFileSync(new URL('../public/js/denoise-worklet.js', import.meta.url), 'utf8');
const sr = 48000;
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 - 0.5; }; }
function voice(secs, level, f0b = 130, seed = 1) {
  const n = Math.floor(sr * secs), a = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / sr, f0 = f0b + 20 * Math.sin(2 * Math.PI * 3 * t); ph += 2 * Math.PI * f0 / sr; let v = 0; for (let h = 1; h <= 12; h++) v += Math.sin(h * ph) / h; a[i] = level * v * Math.max(0, Math.sin(2 * Math.PI * 2.5 * t + seed)) ** 0.5 * 0.5; }
  return a;
}
function fan(secs, level, seed = 7) { const r = rng(seed), n = Math.floor(sr * secs), a = new Float32Array(n); let lp = 0; for (let i = 0; i < n; i++) { lp += 0.15 * (r() - lp); a[i] = (lp * 3 + r() * 0.3 + 0.25 * Math.sin(2 * Math.PI * 120 * i / sr)) * level; } return a; }
const add = (...xs) => { const o = new Float32Array(Math.min(...xs.map((x) => x.length))); for (const x of xs) for (let i = 0; i < o.length; i++) o[i] += x[i]; return o; };

test('autofit: a fan in the room is flushed and the voice stays', async () => {
  const r = await fit({ src: SRC, sil: fan(5, 0.03), voi: add(fan(7, 0.03), voice(7, 0.25)), sr });
  assert.equal(r.ok, true);
  assert.ok(r.after.separation - r.before.separation >= 30, `separation ${r.before.separation} to ${r.after.separation}`);
  assert.ok(r.after.keptPct >= 92);
  assert.ok(r.after.voiceDb > -2.5);
  assert.ok(r.chosen.ai > 0, 'steady noise is handled by the room cleanup');
  assert.equal(r.chosen.lock, false, 'no voice lock for steady noise alone');
  assert.equal(r.patch.ns, 'on');
  assert.equal(r.patch.auto, false);
});

test('autofit: a quieter second voice (the other phone speaker) needs My voice only', async () => {
  const sil = add(fan(5, 0.03), voice(5, 0.06, 190, 2));
  const voi = add(fan(7, 0.03), voice(7, 0.25), voice(7, 0.06, 190, 2));
  const r = await fit({ src: SRC, sil, voi, sr });
  assert.equal(r.ok, true);
  assert.equal(r.chosen.lock, true);
  assert.equal(r.patch.lock, true);
  assert.ok(r.patch.level > 0 && r.patch.strict >= 1 && r.patch.strict <= 10);
  assert.ok(r.after.separation >= 45, `separation ${r.after.separation}`);
  assert.ok(r.after.separation - r.before.separation >= 30);
  assert.ok(r.after.keptPct >= 92, 'the person is never muted');
  assert.ok(r.chosen.ai > 0, 'the fan under the voice is still cleaned while talking');
});

test('autofit: dead silence needs nothing', async () => {
  const r = await fit({ src: SRC, sil: new Float32Array(5 * sr), voi: voice(7, 0.25), sr });
  assert.equal(r.ok, true);
  assert.equal(r.chosen.ai, -1);
  assert.equal(r.chosen.lock, false);
  assert.equal(r.patch.noise, 'light');
  assert.ok(r.after.keptPct >= 92);
});

test('autofit: no voice, or a dead mic, is refused with a plain reason', async () => {
  const none = await fit({ src: SRC, sil: fan(5, 0.03), voi: fan(7, 0.03), sr });
  assert.equal(none.ok, false); assert.equal(none.error, 'no_voice');
  const dead = await fit({ src: SRC, sil: new Float32Array(5 * sr), voi: new Float32Array(7 * sr), sr });
  assert.equal(dead.ok, false); assert.equal(dead.error, 'dead');
  const short = await fit({ src: SRC, sil: new Float32Array(100), voi: new Float32Array(100), sr });
  assert.equal(short.error, 'short');
});

test('autofit: a voice that clips lowers the mic volume, a very quiet one raises it', async () => {
  const loud = analyze(fan(5, 0.01), add(fan(7, 0.01), voice(7, 1.8)).map((v) => Math.max(-1, Math.min(1, v))), sr);
  assert.ok(gainFor(loud) < 100);
  const quiet = analyze(fan(5, 0.002), add(fan(7, 0.002), voice(7, 0.05)), sr);
  assert.ok(gainFor(quiet) > 100 && gainFor(quiet) <= 300);
  const normal = analyze(fan(5, 0.01), add(fan(7, 0.01), voice(7, 0.25)), sr);
  assert.equal(gainFor(normal), 100);
});

test('autofit: a second voice as loud as the person cannot be separated, and the person is told', async () => {
  const sil = add(fan(5, 0.02), voice(5, 0.2, 190, 2));
  const voi = add(fan(7, 0.02), voice(7, 0.25), voice(7, 0.2, 190, 2));
  const r = await fit({ src: SRC, sil, voi, sr });
  assert.equal(r.ok, true);
  assert.equal(r.reached, false);
  assert.ok(r.warnings.some((w) => /nearly as loud as you/.test(w)));
  assert.equal(lockFor(r.analysis), null, 'no lock when it would cut the person too');
});

test('autofit: every candidate is a real setting the Hub can run', () => {
  const a = analyze(fan(5, 0.03), add(fan(7, 0.03), voice(7, 0.25)), sr);
  const list = candidates(a, 100);
  assert.ok(list.length >= 10 && list.length <= 30);
  for (const c of list) {
    const p = plan({ noise: c.noise, ai: c.ai, gate: c.gate, gain: c.gain, lock: c.lock, level: c.level || 0, strict: c.strict || 6 });
    assert.ok(p.ai >= 0 && p.ai <= 1);
    if (c.lock) assert.ok(p.lock > 0);
  }
});

test('autofit: describe and wav helpers', () => {
  assert.match(describe({ chosen: { ai: 50, gate: 4, lock: true, strict: 4, gain: 120 }, patch: { noise: 'standard' } }), /Standard cleanup at 50%, quiet gate 4, My voice only \(strictness 4\), mic volume 120%/);
  const w = wavFrom(new Float32Array(100), 48000);
  assert.equal(w.byteLength, 44 + 200);
  assert.equal(new DataView(w).getUint32(24, true), 48000);
  assert.equal(frameLevels(new Float32Array(960), 48000).length, 1);
  assert.equal(rmsOf(new Float32Array(10)), 0);
});
