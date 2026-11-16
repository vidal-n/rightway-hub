// Auto set up for the phone's noise cleanup (Nov 2026, V: Kiron's mic picks up the room and a second phone's speaker, "auto fill the
// settings from the background noise and the voice, test it against his voice and dead silence").
// Pure (no browser calls), so Node tests it. Modeled on the room tone calibration in Krisp, NVIDIA Broadcast and Zoom's "test speaker
// and mic": record the room, record the voice, then pick the settings from what was heard.
//
// How it works: two recordings from the real mic, taken the way a call gets them (browser cleanup on, auto level off):
//   1. dead silence (the person stays quiet, whatever normally leaks in stays on: fans, TV, the other phone's speaker),
//   2. the person's voice at call volume.
// The Hub's own cleanup (public/js/denoise-worklet.js) is run OFFLINE on those same two recordings with every candidate setting, the
// real code, not a model of it. Each candidate is scored on how far the loudest background ends up under the voice, and how much of the
// voice survives. The least aggressive setting that flushes the background wins.
import { plan, lockThreshold, gateThreshold, learnLevel } from './audiocfg.js';

export const SILENCE_SECS = 5;
export const VOICE_SECS = 7;
const FRAME_MS = 20;

const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
export const rmsOf = (a, from = 0, to = a.length) => { let s = 0; const n = Math.max(1, to - from); for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / n); };
export const peakOf = (a) => { let m = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; };
export function frameLevels(a, sr, ms = FRAME_MS) {
  const n = Math.max(1, Math.round((sr * ms) / 1000)), out = [];
  for (let i = 0; i + n <= a.length; i += n) out.push(rmsOf(a, i, i + n));
  return out;
}
export const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))]; };

// Load the worklet source as is and return run(message, samples) which pushes samples through a fresh RwVoice, 128 at a time.
export function loadSim(src, sampleRate) {
  let Cls = null;
  class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage() {} }; } }
  const registerProcessor = (name, c) => { if (name === 'rw-voice') Cls = c; };
  // eslint-disable-next-line no-new-func
  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', src)(AudioWorkletProcessor, sampleRate, registerProcessor);
  if (!Cls) throw new Error('The voice engine file did not load.');
  return (msg, samples) => {
    const node = new Cls(); node.configure(msg);
    const out = new Float32Array(samples.length), o = new Float32Array(128), blk = new Float32Array(128);
    for (let i = 0; i + 128 <= samples.length; i += 128) {
      blk.set(samples.subarray(i, i + 128));
      node.process([[blk]], [[o]]);
      out.set(o, i);
    }
    return out;
  };
}

// What the two recordings say about the room and the voice.
export function analyze(sil, voi, sr) {
  if (!sil || !voi || sil.length < sr * 2 || voi.length < sr * 3) return { ok: false, error: 'short', text: 'The recording was too short. Try again.' };
  const noiseRms = rmsOf(sil);
  if (peakOf(sil) < 1e-5 && peakOf(voi) < 1e-5) return { ok: false, error: 'dead', text: 'The mic gave no signal at all. It may be muted or the wrong mic is picked. Check the microphone box and try again.' };
  const sf = frameLevels(sil, sr), vf = frameLevels(voi, sr, 25);
  const level = learnLevel(vf);
  if (!level) return { ok: false, error: 'no_voice', text: 'It did not hear a clear voice. Read the sentence out loud at call volume, move the mic closer, and try again.' };
  const voiced = vf.filter((x) => x > Math.max(pct(vf, 0.1) * 3, 0.004, level * 0.25));
  const bgPeak = pct(sf, 0.99), bgMid = pct(sf, 0.5);
  const vLow = pct(voiced, 0.3);
  const warnings = [];
  if (bgPeak > vLow * 0.7) warnings.push('Something in the room was nearly as loud as you (a second phone, TV or a person). It cannot be separated from your voice by loudness. Turn it down or move it farther from the mic.');
  else if (level < noiseRms * 2) warnings.push('Your voice was barely louder than the room. Move the mic closer to your mouth first, or no setting can fix it.');
  if (peakOf(voi) >= 0.97) warnings.push('Your voice hit the ceiling and clipped. Mic volume is being lowered.');
  return { ok: true, sr, noiseRms, bgPeak, bgMid, level, vLow, voicePeak: peakOf(voi), lockFeasible: bgPeak * 1.4 < vLow, warnings };
}

// Mic volume: leave it alone unless the voice clips or is very quiet (speech under about -34 dBFS is raised toward -26).
export function gainFor(a) {
  if (a.voicePeak > 0.9) return Math.max(40, Math.floor((80 / a.voicePeak) / 5) * 5);
  if (a.level < 0.02) return Math.min(300, Math.floor((0.9 / a.voicePeak) * 100 / 5) * 5, Math.round((0.05 / a.level) * 100 / 5) * 5);
  return 100;
}

// Voice lock fitted to this room: the threshold sits between the loudest background and the soft end of the voice.
// The lock opens at 1.3x the threshold and shuts below the threshold, so the target is sqrt(background peak x soft voice) / 1.3.
export function lockFor(a) {
  if (!a.lockFeasible) return null;
  const want = Math.sqrt(a.bgPeak * a.vLow) / 1.3;
  const ratio = want / a.level;
  const strict = Math.max(1, Math.min(10, Math.round((ratio - 0.2) / 0.055 + 1)));
  return { level: a.level, strict, thr: lockThreshold(a.level, strict), want };
}

export function candidates(a, gain) {
  const out = [];
  const steps = [[0, 'light'], [50, 'standard'], [70, 'strong'], [85, 'strong'], [95, 'strong']];
  const lock = lockFor(a);
  for (const [ai, noise] of steps) {
    for (const gate of ai ? [0, 4, 7] : [0]) out.push({ noise, ai: ai || -1, gate: gate || -1, lock: false, gain });
    // Voice lock mutes everything quieter than you, but a fan still sits under your voice while you talk, so it is paired with the
    // room cleanup unless the steady noise is already 30 dB or more under the voice.
    if (lock && (ai > 0 && ai < 95 || (!ai && db(a.level / Math.max(a.bgMid, 1e-9)) >= 30))) out.push({ noise, ai: ai || -1, gate: -1, lock: true, level: lock.level, strict: lock.strict, gain });
  }
  return out;
}

// Score one candidate from the input and output of both recordings.
export function score(a, sil, voi, silOut, voiOut, cand, sr) {
  const g = cand.gain / 100;
  const skip = Math.floor(sr * 0.6);                                   // the first 0.6 s is the engine learning the room
  const fo = frameLevels(silOut.subarray(skip), sr);
  const bgOut = pct(fo, 0.99);
  const vIn = frameLevels(voi, sr, 25), vOut = frameLevels(voiOut, sr, 25);
  const thr = Math.max(pct(vIn, 0.1) * 3, 0.004, a.level * 0.25);
  let n = 0, kept = 0; const diffs = [];
  for (let i = 0; i < vIn.length; i++) {
    if (vIn[i] <= thr) continue;
    n++;
    const o = Math.max(vOut[i] || 0, vOut[i + 1] || 0, vOut[i + 2] || 0);   // the cleanup answers a few ms late
    const r = o / Math.max(vIn[i] * g, 1e-9);
    diffs.push(db(r));
    if (r >= 0.5) kept++;
  }
  const voiceDb = diffs.length ? [...diffs].sort((x, y) => x - y)[Math.floor(diffs.length / 2)] : 0;
  const keptFrac = n ? kept / n : 0;
  const separation = Math.min(90, db(a.level * g) - db(bgOut));                       // dB between your voice and the loudest background left
  const harm = (cand.ai > 0 ? cand.ai : 0) + (cand.gate > 0 ? cand.gate * 2 : 0) + (cand.lock ? 70 : 0);
  let s = Math.min(50, separation);
  if (voiceDb < -3) s -= (-3 - voiceDb) * 6;
  s -= (1 - keptFrac) * 90;
  s -= harm * 0.04;
  return { score: s, separation, keptFrac, voiceDb, bgOutDb: db(bgOut), harm };
}

// Turn a candidate into the settings the Hub saves.
export const patchFor = (c) => ({ noise: c.noise, ai: c.ai, gate: c.gate, gain: c.gain, lock: Boolean(c.lock), level: c.lock ? c.level : 0, strict: c.lock ? c.strict : 6, ns: 'on', auto: false });

// The whole fit. src = the worklet file text, sil and voi = Float32Array recordings at sr, cfg = the person's current settings.
// onStep(done, total) lets the page draw progress and yield. Async only so the page can breathe between candidates.
export async function fit({ src, sil, voi, sr, cfg = {}, env = { nsSupported: true }, onStep = null }) {
  const a = analyze(sil, voi, sr);
  if (!a.ok) return a;
  const run = loadSim(src, sr);
  const gain = gainFor(a);
  const list = candidates(a, gain);
  const both = new Float32Array(sil.length + voi.length); both.set(sil); both.set(voi, sil.length);
  const results = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const p = plan({ ...cfg, ...patchFor(c), headset: false, mic: '' }, env);
    let sOut, vOut;
    if (!p.processor && c.gain === 100) { sOut = sil; vOut = voi; }       // plain Light: nothing of ours runs
    else {
      const o = run({ ai: p.ai, hp: p.hp, gateThr: gateThreshold(p.gate), gain: p.gain, lock: p.lock }, both);
      sOut = o.subarray(0, sil.length); vOut = o.subarray(sil.length);
    }
    results.push({ cand: c, ...score(a, sil, voi, sOut, vOut, c, sr), sOut, vOut });
    if (onStep) await onStep(i + 1, list.length);
  }
  const base = results.find((r) => r.cand.ai === -1 && !r.cand.lock) || results[0];
  const GOOD = 45;
  const ok = results.filter((r) => r.separation >= GOOD && r.keptFrac >= 0.92 && r.voiceDb >= -2.5);
  const best = (ok.length ? ok.sort((x, y) => x.harm - y.harm || y.separation - x.separation) : results.sort((x, y) => y.score - x.score))[0];
  return {
    ok: true, analysis: a, gain, tested: results.length, table: results.map((r) => `${r.cand.noise}/${r.cand.ai}/g${r.cand.gate}${r.cand.lock ? '/lock' + r.cand.strict : ''} sep ${r.separation.toFixed(0)} kept ${Math.round(r.keptFrac * 100)} v ${r.voiceDb.toFixed(1)}`), reached: ok.length > 0,
    patch: patchFor(best.cand), chosen: best.cand,
    before: { separation: base.separation, bgDb: base.bgOutDb },
    after: { separation: best.separation, bgDb: best.bgOutDb, voiceDb: best.voiceDb, keptPct: Math.round(best.keptFrac * 100) },
    warnings: [...a.warnings, ...(ok.length ? [] : ['Even the strongest setting left some background under your voice. Move the mic closer to your mouth or turn down what leaks in, then run it again.'])],
    sil, voi, silOut: best.sOut, voiOut: best.vOut,
  };
}

// Plain words for what was chosen.
export function describe(r) {
  const c = r.chosen, p = r.patch;
  const level = { light: 'Light', standard: 'Standard', strong: 'Strong' }[p.noise];
  const bits = [`${level} cleanup${c.ai > 0 ? ` at ${c.ai}%` : ''}`];
  if (c.gate > 0) bits.push(`quiet gate ${c.gate}`);
  if (c.lock) bits.push(`My voice only (strictness ${c.strict})`);
  if (c.gain !== 100) bits.push(`mic volume ${c.gain}%`);
  return bits.join(', ');
}

// 16 bit mono WAV for playing a recording back.
export function wavFrom(f32, sr) {
  const buf = new ArrayBuffer(44 + f32.length * 2), v = new DataView(buf);
  const w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + f32.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, f32.length * 2, true);
  for (let i = 0; i < f32.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, f32[i])) * 32767), true);
  return buf;
}
