// Voice cleanup for the browser phone. Runs on the browser's audio thread (an AudioWorklet), so it keeps working when the Hub tab
// is in the background, which timers on the page cannot promise. One node does everything between the mic and the call:
//   1. rumble filter (high pass)
//   2. adaptive noise suppression: learns the steady noise in the room (fans, air conditioning, hiss, road hum) bin by bin,
//      and turns those frequencies down while a voice is not using them (spectral Wiener filter with a decision directed
//      speech estimate, which is what keeps it from "bubbling")
//   3. quiet room gate (mutes the line between words) and mic volume
// It does not know voices from other voices, so a TV or people talking nearby come through quieter, not gone.
// No imports and no exports: the page loads this file as is, and Node tests run it with stand-ins for the worklet globals.
(function () {
  const N = 512;          // FFT size
  const HOP = 256;        // new samples per frame (50% overlap)
  const HALF = N / 2;
  const QUANTUM = 128;    // samples the browser hands a worklet at a time

  // In place radix 2 FFT. inverse = true divides by N.
  function makeFFT(n) {
    const bits = Math.round(Math.log2(n));
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
    const cs = new Float64Array(n / 2), sn = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cs[i] = Math.cos((2 * Math.PI * i) / n); sn[i] = Math.sin((2 * Math.PI * i) / n); }
    return function fft(re, im, inverse) {
      for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let start = 0; start < n; start += size) {
          for (let k = 0, w = 0; k < half; k++, w += step) {
            const wr = cs[w], wi = inverse ? sn[w] : -sn[w];
            const a = start + k, b = a + half;
            const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
            re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          }
        }
      }
      if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    };
  }
  const fft = makeFFT(N);

  // Same rule as gateStep in audiocfg.js: opens at once on a voice, closes only after it stayed quiet for holdMs.
  function gateStep(state, level, threshold, dtMs, holdMs) {
    if (!threshold) return { open: true, quiet: 0 };
    if (level >= threshold * (state.open ? 1 : 1.3)) return { open: true, quiet: 0 };
    const quiet = (state.quiet || 0) + dtMs;
    return { open: state.open && quiet < holdMs, quiet };
  }

  // ---------- the suppressor ----------
  class Suppressor {
    constructor(sampleRate) {
      this.sr = sampleRate;
      this.fps = sampleRate / HOP;                       // frames per second
      this.win = new Float32Array(N);
      for (let i = 0; i < N; i++) this.win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); // sqrt Hann both ways: overlap adds back to 1
      this.inBuf = new Float32Array(N);
      this.ola = new Float32Array(N);
      this.outQ = new Float32Array(8192); this.qr = 0; this.qw = 0;
      this.push(new Float32Array(HOP));                  // prime the output so the first quanta have something to read
      this.fill = 0;
      this.re = new Float64Array(N); this.im = new Float64Array(N);
      this.pn = new Float64Array(HALF + 1);              // smoothed power, for tracking the noise floor
      this.nz = new Float64Array(HALF + 1).fill(-1);     // noise power estimate per bin (-1 = not started)
      this.g = new Float32Array(HALF + 1).fill(1);       // last gain per bin
      this.post = new Float64Array(HALF + 1);            // last frame's gain squared times SNR, for the speech estimate
      this.gs = new Float32Array(HALF + 3);
      this.aNoise = Math.exp(-1 / Math.max(1.5, 0.04 * this.fps));
      this.kSpeech = Math.max(4, Math.min(HALF, Math.floor((4000 / sampleRate) * N)));
      this.frames = 0;                                   // frames seen so far (the first half second is spent learning the room)
      this.loud = 0;                                     // frames in a row where most of the voice band is far above the noise
      this.strength = 0.6;
    }
    setStrength(s) { this.strength = Math.min(1, Math.max(0, Number(s) || 0)); }
    push(a) { for (let i = 0; i < a.length; i++) { this.outQ[this.qw] = a[i]; this.qw = (this.qw + 1) & 8191; } }
    pull(out) { for (let i = 0; i < out.length; i++) { out[i] = this.outQ[this.qr]; this.qr = (this.qr + 1) & 8191; } }

    // One 128 sample block in, one out (the same samples, cleaned, a few milliseconds late).
    run(input, output) {
      this.inBuf.copyWithin(0, QUANTUM);
      this.inBuf.set(input, N - QUANTUM);
      this.fill += QUANTUM;
      if (this.fill >= HOP) { this.fill -= HOP; this.frame(); }
      this.pull(output);
    }

    frame() {
      const { re, im, win, pn, nz, g, post, gs } = this;
      const s = this.strength;
      const floor = 0.30 - 0.24 * s;                      // quietest a bin may be turned down to (0.30 .. 0.06)
      const over = 1 + 1.5 * s;                           // how much extra noise to assume (more = more cut)
      const bias = 1.35;                                  // the tracker follows the quiet dips, so it reads a bit low
      const rise = Math.pow(2, 1 / (2.0 * this.fps));     // noise may creep up 2x in 2 s while a voice is not in the way
      const rise2 = Math.pow(2, 1 / (1.2 * this.fps));    // and faster once the room has clearly gotten louder
      for (let i = 0; i < N; i++) { re[i] = this.inBuf[i] * win[i]; im[i] = 0; }
      fft(re, im, false);
      const aN = this.aNoise;
      const first = this.frames === 0, learning = this.frames < 0.5 * this.fps;
      this.frames++;
      let loudBins = 0;
      for (let k = 0; k <= HALF; k++) {
        const pw = re[k] * re[k] + im[k] * im[k] + 1e-12;
        pn[k] = first ? pw : aN * pn[k] + (1 - aN) * pw;
        if (nz[k] < 0 || learning) nz[k] = first || nz[k] < 0 ? pn[k] : 0.9 * nz[k] + 0.1 * pn[k];
        else if (pn[k] <= nz[k]) nz[k] = pn[k];
        else {
          const far = pn[k] > 4 * nz[k];
          if (!far) nz[k] *= rise;
          else if (this.loud > 1.5 * this.fps) nz[k] *= rise2;
        }
        if (k <= this.kSpeech && pn[k] > 4 * nz[k]) loudBins++;
      }
      this.loud = loudBins > 0.5 * this.kSpeech ? this.loud + 1 : 0;
      const alpha = 0.92;
      for (let k = 0; k <= HALF; k++) {
        const pw = re[k] * re[k] + im[k] * im[k] + 1e-12;
        const noise = nz[k] * bias * over;
        const gamma = pw / noise;
        const xi = alpha * post[k] + (1 - alpha) * Math.max(gamma - 1, 0);
        let G = xi / (1 + xi);
        if (G < floor) G = floor;
        post[k] = G * G * gamma;
        gs[k + 1] = G > g[k] ? G : 0.6 * g[k] + 0.4 * G;  // open fast on a voice, close a little slower
      }
      gs[0] = gs[1]; gs[HALF + 2] = gs[HALF + 1];
      for (let k = 0; k <= HALF; k++) {
        const G = 0.25 * gs[k] + 0.5 * gs[k + 1] + 0.25 * gs[k + 2];
        g[k] = gs[k + 1];
        re[k] *= G; im[k] *= G;
        if (k > 0 && k < HALF) { re[N - k] *= G; im[N - k] *= G; }
      }
      fft(re, im, true);
      for (let i = 0; i < N; i++) this.ola[i] += re[i] * win[i];
      this.push(this.ola.subarray(0, HOP));
      this.ola.copyWithin(0, HOP);
      this.ola.fill(0, N - HOP);
    }
  }

  // ---------- the node ----------
  class RwVoice extends AudioWorkletProcessor {
    constructor() {
      super();
      this.sup = new Suppressor(sampleRate);
      this.cfg = { ai: 0, hp: 0, gateThr: 0, gain: 1, lock: 0 };
      this.env = 0;                                      // smoothed input level (about 20 ms), what voice lock listens to
      this.lk = { open: false, quiet: 0 };
      this.hpC = null; this.hpX = [0, 0]; this.hpY = [0, 0];
      this.gate = { open: true, quiet: 0 };
      this.gg = 1;                                       // smoothed gate gain
      this.vg = 1;                                       // smoothed volume
      this.tmp = new Float32Array(QUANTUM);
      this.quanta = 0;
      this.port.onmessage = (e) => this.configure(e.data || {});
      this.configure({});
    }
    configure(c) {
      const cfg = this.cfg = { ...this.cfg, ...c };
      this.sup.setStrength(cfg.ai);
      if (cfg.hp > 0) {                                  // RBJ high pass, Q 0.707
        const w = (2 * Math.PI * cfg.hp) / sampleRate, cosw = Math.cos(w), al = Math.sin(w) / (2 * 0.7071);
        const a0 = 1 + al;
        this.hpC = { b0: (1 + cosw) / 2 / a0, b1: -(1 + cosw) / a0, b2: (1 + cosw) / 2 / a0, a1: (-2 * cosw) / a0, a2: (1 - al) / a0 };
      } else this.hpC = null;
    }
    process(inputs, outputs) {
      const out = outputs[0];
      if (!out || !out.length) return true;
      const inp = inputs[0] && inputs[0][0];
      const o = out[0];
      const n = o.length;
      if (!inp) { o.fill(0); this.beat(0); return true; }  // nothing connected yet
      const t = this.tmp.length === n ? this.tmp : (this.tmp = new Float32Array(n));
      const c = this.hpC;
      if (c) {
        let x1 = this.hpX[0], x2 = this.hpX[1], y1 = this.hpY[0], y2 = this.hpY[1];
        for (let i = 0; i < n; i++) {
          const x = inp[i];
          const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
          x2 = x1; x1 = x; y2 = y1; y1 = y; t[i] = y;
        }
        this.hpX[0] = x1; this.hpX[1] = x2; this.hpY[0] = y1; this.hpY[1] = y2;
      } else t.set(inp.length === n ? inp : inp.subarray(0, n));
      if (this.cfg.ai > 0) this.sup.run(t, o); else o.set(t);
      // Input level, smoothed over about 20 ms, measured before the cleanup so the gate can open a few milliseconds ahead of the delayed output.
      let si = 0; for (let i = 0; i < n; i++) si += t[i] * t[i];
      const ek = 1 - Math.exp(-n / sampleRate / 0.02);
      this.env += (si / n - this.env) * ek;
      const inLevel = Math.sqrt(this.env);
      let sum = 0; for (let i = 0; i < n; i++) sum += o[i] * o[i];
      const level = Math.sqrt(sum / n);
      const dt = (n / sampleRate) * 1000;
      let gTarget, gk;
      const lockThr = this.cfg.lock;
      if (lockThr > 0) {
        // Voice lock: only sound as loud as the person's own voice on their own mic gets through. Everything quieter is muted.
        this.lk = gateStep(this.lk, inLevel, lockThr, dt, 220);
        this.gate = { open: this.lk.open, quiet: this.lk.quiet };
        gTarget = this.lk.open ? 1 : 0.003;
        gk = 1 - Math.exp(-n / sampleRate / (this.lk.open ? 0.004 : 0.04));
      } else {
        this.gate = gateStep(this.gate, level, this.cfg.gateThr, dt, 280);
        gTarget = this.gate.open ? 1 : 0.04;
        gk = 1 - Math.exp(-n / sampleRate / (this.gate.open ? 0.008 : 0.05));
      }
      const vk = 1 - Math.exp(-n / sampleRate / 0.02);
      for (let i = 0; i < n; i++) {
        this.gg += (gTarget - this.gg) * gk;
        this.vg += (this.cfg.gain - this.vg) * vk;
        let v = o[i] * this.gg * this.vg;
        o[i] = v > 1 ? 1 : v < -1 ? -1 : v;               // never hand the call more than full scale
      }
      for (let ch = 1; ch < out.length; ch++) out[ch].set(o);
      this.beat(level);
      return true;
    }
    beat(level) {
      if (++this.quanta % 8 === 0) this.port.postMessage({ hb: this.quanta, level, inLevel: Math.sqrt(this.env), open: this.gate.open });
    }
  }
  registerProcessor('rw-voice', RwVoice);
})();
