import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../public/js/denoise-worklet.js', import.meta.url), 'utf8');

// Load the worklet file with stand-ins for the worklet globals.
function load(sampleRate) {
  let Cls = null; const posted = [];
  class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage: (m) => posted.push(m) }; } }
  const ctx = { AudioWorkletProcessor, sampleRate, registerProcessor: (name, c) => { assert.equal(name, 'rw-voice'); Cls = c; }, Math, Float32Array, Float64Array, Uint32Array, Object };
  vm.runInNewContext(SRC, ctx);
  const node = new Cls();
  return { node, posted };
}

// deterministic noise
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 - 0.5; }; }

// run a signal through the node, 128 samples at a time
function run(node, sig) {
  const out = new Float32Array(sig.length);
  for (let i = 0; i + 128 <= sig.length; i += 128) {
    const o = new Float32Array(128);
    node.process([[sig.subarray(i, i + 128)]], [[o]]);
    out.set(o, i);
  }
  return out;
}
const rms = (a, from, to) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, to - from)); };
const db = (x) => 20 * Math.log10(x + 1e-12);

// A voiced-like signal: harmonics of a moving pitch with a syllable envelope.
function voice(sr, secs, level) {
  const n = Math.floor(sr * secs), a = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, f0 = 130 + 20 * Math.sin(2 * Math.PI * 3 * t);
    ph += (2 * Math.PI * f0) / sr;
    let v = 0; for (let h = 1; h <= 12; h++) v += Math.sin(h * ph) / h;
    const env = Math.max(0, Math.sin(2 * Math.PI * 2.5 * t)) ** 0.5;
    a[i] = level * v * env * 0.5;
  }
  return a;
}

for (const sr of [16000, 44100, 48000]) {
  test(`denoise: steady room noise drops a lot at ${sr} Hz`, () => {
    const { node } = load(sr);
    node.configure({ ai: 0.8, hp: 80, gateThr: 0, gain: 1 });
    const r = rng(7), n = sr * 6, sig = new Float32Array(n);
    // fan like noise: white plus a 120 Hz hum
    for (let i = 0; i < n; i++) sig[i] = 0.05 * r() * 2 + 0.02 * Math.sin((2 * Math.PI * 120 * i) / sr);
    const out = run(node, sig);
    const a = Math.floor(sr * 4);
    const cut = db(rms(sig, a, n)) - db(rms(out, a, n));
    assert.ok(cut > 12, `only cut ${cut.toFixed(1)} dB`);
    for (const v of out) assert.ok(Number.isFinite(v) && Math.abs(v) <= 1);
  });

  test(`denoise: voice over noise keeps most of the voice at ${sr} Hz`, () => {
    const { node } = load(sr);
    node.configure({ ai: 0.6, hp: 80, gateThr: 0, gain: 1 });
    const r = rng(11), n = sr * 8;
    const v = voice(sr, 8, 0.5), sig = new Float32Array(n);
    for (let i = 0; i < n; i++) sig[i] = 0.03 * r() * 2 + (i > sr * 2 ? v[i] : 0); // 2 s of room first, then talking
    const out = run(node, sig);
    // compare voice energy in the talking part with the clean voice, allowing for the few ms of delay
    const a = sr * 3, b = sr * 8, d = 256 + 128;
    let ref = 0, got = 0;
    for (let i = a; i < b - d; i++) { ref += v[i] * v[i]; got += out[i + d] * out[i + d]; }
    const keep = db(Math.sqrt(got)) - db(Math.sqrt(ref));
    assert.ok(keep > -3.5, `voice lost ${keep.toFixed(1)} dB`);
    // and the noise only part is quieter than it went in
    const quiet = db(rms(sig, sr, sr * 2)) - db(rms(out, sr, sr * 2));
    assert.ok(quiet > 6, `room only cut ${quiet.toFixed(1)} dB`);
  });
}

test('denoise: silence stays silent and finite', () => {
  const { node } = load(48000);
  node.configure({ ai: 1, hp: 100, gateThr: 0.01, gain: 2 });
  const out = run(node, new Float32Array(48000));
  for (const v of out) assert.ok(Number.isFinite(v));
  assert.ok(rms(out, 0, out.length) < 1e-4);
});

test('denoise: off means the sound passes straight through', () => {
  const { node } = load(48000);
  node.configure({ ai: 0, hp: 0, gateThr: 0, gain: 1 });
  const r = rng(3), sig = new Float32Array(48000).map(() => 0.2 * r());
  const out = run(node, sig);
  for (let i = 6000; i < 9000; i++) assert.ok(Math.abs(out[i] - sig[i]) < 1e-3);
});

test('denoise: strength steps are monotonic (more strength, more cut)', () => {
  const cuts = [];
  for (const ai of [0.2, 0.6, 1]) {
    const { node } = load(48000);
    node.configure({ ai, hp: 0, gateThr: 0, gain: 1 });
    const r = rng(5), n = 48000 * 4, sig = new Float32Array(n);
    for (let i = 0; i < n; i++) sig[i] = 0.05 * r();
    const out = run(node, sig);
    cuts.push(db(rms(sig, 144000, n)) - db(rms(out, 144000, n)));
  }
  assert.ok(cuts[0] < cuts[1] && cuts[1] < cuts[2], cuts.join(' '));
});

test('denoise: gate mutes a quiet line and reopens for a voice', () => {
  const { node } = load(48000);
  node.configure({ ai: 0, hp: 0, gateThr: 0.02, gain: 1 });
  const sr = 48000, n = sr * 3, sig = new Float32Array(n);
  for (let i = 0; i < n; i++) sig[i] = i < sr ? 0.002 * Math.sin(i / 7) : 0.3 * Math.sin(i / 20);
  const out = run(node, sig);
  assert.ok(rms(out, sr * 0.6 | 0, sr) < 0.0005, 'quiet part should be muted');
  assert.ok(rms(out, sr * 2, n) > 0.15, 'voice should come through');
});

test('denoise: volume is applied and output never clips past full scale', () => {
  const { node } = load(48000);
  node.configure({ ai: 0, hp: 0, gateThr: 0, gain: 3 });
  const sig = new Float32Array(48000).map((_, i) => 0.9 * Math.sin(i / 10));
  const out = run(node, sig);
  for (const v of out) assert.ok(Math.abs(v) <= 1);
  assert.ok(rms(out, 24000, 48000) > rms(sig, 24000, 48000));
});

test('denoise: sends a heartbeat and survives empty input', () => {
  const { node, posted } = load(48000);
  const o = new Float32Array(128);
  for (let i = 0; i < 20; i++) assert.equal(node.process([[]], [[o]]), true);
  assert.ok(posted.length > 0 && 'hb' in posted[0]);
  assert.equal(node.process([], [[]]), true);
});

test('denoise: stereo output gets the same sound on both channels', () => {
  const { node } = load(48000);
  node.configure({ ai: 0.5, hp: 80, gateThr: 0, gain: 1 });
  const a = new Float32Array(128), b = new Float32Array(128);
  const inp = new Float32Array(128).map((_, i) => 0.1 * Math.sin(i / 3));
  for (let k = 0; k < 10; k++) node.process([[inp]], [[a, b]]);
  assert.deepEqual(Array.from(a), Array.from(b));
});

test('voice lock: a close voice passes, quieter background voices and TV are muted', () => {
  const sr = 48000;
  const { node } = load(sr);
  const mine = voice(sr, 6, 1.0);                       // the person, loud on their own mic
  const tv = voice(sr, 6, 0.08);                        // someone else, much quieter
  const r = rng(9);
  const sig = new Float32Array(sr * 6);
  for (let i = 0; i < sig.length; i++) {
    const talking = i >= sr * 3;                        // first 3 s: only the TV, last 3 s: the person talks over it
    sig[i] = tv[(i * 7) % tv.length] + (talking ? mine[i] : 0) + 0.004 * r();
  }
  node.configure({ ai: 0.5, hp: 80, gateThr: 0, gain: 1, lock: 0.06 });
  const out = run(node, sig);
  const bg = db(rms(out, sr * 1, sr * 3)), speech = db(rms(out, sr * 4, sr * 6));
  assert.ok(bg < -70, `background still at ${bg.toFixed(1)} dBFS`);
  assert.ok(speech - bg > 40, `only ${(speech - bg).toFixed(1)} dB between voice and background`);
});

test('voice lock: opens before the first syllable ends (no clipped starts)', () => {
  const sr = 48000, { node } = load(sr);
  node.configure({ ai: 0, hp: 0, gateThr: 0, gain: 1, lock: 0.05 });
  const sig = new Float32Array(sr * 2);
  for (let i = sr; i < sr * 2; i++) sig[i] = 0.3 * Math.sin(i / 8);
  const out = run(node, sig);
  // within 25 ms of the onset the output is already at least half its final level
  assert.ok(rms(out, sr + 1200, sr + 2400) > 0.5 * rms(out, sr + 12000, sr + 24000));
});
