// Audio settings for the browser phone. Pure (no browser calls) so Node can test it.
// A person's settings live in localStorage on each device (an iPad on Bluetooth and a laptop on a USB headset need different ones).

// How much cleanup each choice does. ns = the browser's own noise suppression, hp = cut low rumble below this many Hz,
// ai = strength (0 to 100) of the Hub's own voice cleanup that learns the room's steady noise and turns it down while you talk,
// gate = quiet-room gate strength from 0 (off) to 10 (cuts anything but a clear voice).
export const NOISE = {
  off: { label: 'Off', note: 'Raw mic. Best for a quiet room or a good headset.', ns: false, ai: 0, hp: 0, gate: 0 },
  light: { label: 'Light', note: 'The browser\'s own noise cleanup only. Safe on every device.', ns: true, ai: 0, hp: 0, gate: 0 },
  standard: { label: 'Standard', note: 'Adds the Hub\'s voice cleanup at medium strength and cuts fans and desk rumble. Good for most rooms.', ns: true, ai: 50, hp: 90, gate: 0 },
  strong: { label: 'Strong', note: 'High strength cleanup and mutes the line between words. For loud rooms and open offices.', ns: true, ai: 85, hp: 120, gate: 4 },
};

export const DEFAULTS = {
  mic: '', out: '', gain: 100, noise: 'light', ai: -1, ns: 'auto', lock: false, level: 0, strict: 6, headset: false, gate: -1, echo: true, auto: true, wake: true, mode: 'browser',
};

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };

export function normalize(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    mic: typeof r.mic === 'string' ? r.mic : DEFAULTS.mic,
    out: typeof r.out === 'string' ? r.out : DEFAULTS.out,
    gain: num(r.gain, 20, 300, DEFAULTS.gain),
    noise: NOISE[r.noise] ? r.noise : DEFAULTS.noise,
    ai: r.ai === -1 || r.ai === undefined ? -1 : num(r.ai, 0, 100, -1),
    ns: r.ns === 'on' || r.ns === 'off' ? r.ns : 'auto',
    lock: Boolean(r.lock),
    level: Number.isFinite(Number(r.level)) && Number(r.level) > 0 ? Math.min(1, Math.max(0.0005, Number(r.level))) : 0,
    strict: num(r.strict, 1, 10, DEFAULTS.strict),
    headset: Boolean(r.headset),
    gate: r.gate === -1 || r.gate === undefined ? -1 : num(r.gate, 0, 10, -1),
    echo: r.echo === undefined ? DEFAULTS.echo : Boolean(r.echo),
    auto: r.auto === undefined ? DEFAULTS.auto : Boolean(r.auto),
    wake: r.wake === undefined ? DEFAULTS.wake : Boolean(r.wake),
    mode: r.mode === 'phone' ? 'phone' : 'browser',
  };
}

// What the phone should actually do for these settings.
export function plan(cfg) {
  const c = normalize(cfg);
  const p = NOISE[c.noise];
  const gate = c.gate === -1 ? p.gate : c.gate;
  const ai = (c.ai === -1 ? p.ai : c.ai) / 100;
  let ns = c.ns === 'on' ? true : c.ns === 'off' ? false : p.ns;
  if (c.headset && c.ns === 'auto') ns = false;        // a noise cancelling headset already cleans the mic; doing it twice makes it watery
  const lockOn = c.lock && c.level > 0;
  const lockThr = lockOn ? lockThreshold(c.level, c.strict) : 0;
  const hp = p.hp;
  // Voice lock needs a steady level to compare against, so the browser's auto level (which pumps background up in pauses) is off.
  const auto = lockOn ? false : c.auto;
  return { ns, echo: c.echo, auto, hp, gate, ai, lock: lockThr, gain: c.gain / 100, processor: hp > 0 || gate > 0 || ai > 0 || lockThr > 0 || c.gain !== 100 };
}

// Voice lock: the level (RMS of the mic signal) a sound must reach to count as the person's own voice.
// level = how loud their voice normally is; strictness 1 (lets quieter sound through) to 10 (only their loudest speech).
export const lockThreshold = (level, strict = 6) => (level > 0 ? level * (0.2 + 0.055 * (Math.min(10, Math.max(1, strict)) - 1)) : 0);

// Learn a person's normal speaking level from frame levels (RMS values taken about every 25 ms while they read a sentence).
// Ignores the pauses (anything near the quietest tenth) and returns the median of the rest, or 0 when there was no clear speech.
export function learnLevel(frames) {
  const a = (Array.isArray(frames) ? frames : []).filter((x) => Number.isFinite(x) && x >= 0).sort((x, y) => x - y);
  if (a.length < 40) return 0;
  const floor = a[Math.floor(a.length * 0.1)];
  const voiced = a.filter((x) => x > Math.max(floor * 3, 0.004));
  if (voiced.length < 20 || voiced.length < a.length * 0.2) return 0;
  return voiced[Math.floor(voiced.length / 2)];
}

// getUserMedia constraints (the browser's own cleanup). deviceId is added only when a mic was picked.
export function constraintsFor(cfg) {
  const p = plan(cfg);
  const c = normalize(cfg);
  const a = { noiseSuppression: p.ns, echoCancellation: p.echo, autoGainControl: p.auto };
  if (c.mic) a.deviceId = { exact: c.mic };
  return a;
}

// Gate strength 1 to 10 -> the quietest level (0 to 1) that still counts as a voice.
export const gateThreshold = (g) => (g > 0 ? 0.003 * 1.35 ** (g - 1) : 0);

// One step of the quiet-room gate. Opens at once on a voice, closes only after it stayed quiet for holdMs (so word endings are not clipped).
export function gateStep(state, level, threshold, dtMs, holdMs = 280) {
  if (!threshold) return { open: true, quiet: 0 };
  if (level >= threshold * (state.open ? 1 : 1.3)) return { open: true, quiet: 0 };
  const quiet = (state.quiet || 0) + dtMs;
  return { open: state.open && quiet < holdMs, quiet };
}

// Keep the chosen device when it is still plugged in, else fall back to the default and say so.
export function pickInput(devices, wantedId) {
  const list = Array.isArray(devices) ? devices : [];
  if (!wantedId) return { id: '', lost: false };
  return list.some((d) => d.id === wantedId) ? { id: wantedId, lost: false } : { id: '', lost: true };
}

// Plain label for a device: browsers leave labels blank until the mic is allowed once.
export const deviceLabel = (d, i) => (d.label || '').trim() || `Microphone ${i + 1}`;

// Where the person turns "always allow" on, by device. Web pages cannot force it; this tells them exactly where.
export function permissionHelp(ua = '') {
  const u = String(ua);
  const ios = /iPhone|iPad|iPod/.test(u) || (/Macintosh/.test(u) && /Mobile/.test(u));
  if (ios) return ['Open Settings, then Safari, then Microphone, and choose Allow.', 'Or add the Hub to your Home Screen (Share, Add to Home Screen) and open it from there: it asks far less.', 'If you tapped Don\'t Allow before, open Settings, Safari, Advanced, Website Data, remove this site, then allow once more.'];
  if (/Android/.test(u)) return ['Tap the lock icon in the address bar, then Permissions, then Microphone, and choose Allow.'];
  if (/Safari/.test(u) && !/Chrome|Chromium|Edg/.test(u)) return ['In Safari open Settings, Websites, Microphone, find this site and choose Allow.'];
  if (/Firefox/.test(u)) return ['When the prompt appears, tick "Remember this decision" and choose Allow.'];
  return ['Click the lock icon in the address bar, then Site settings, then Microphone, and choose Allow.'];
}

// Constraints without the chosen device, for when the exact device is gone (unplugged, or Bluetooth reconnected under a new id).
export const constraintsAnyMic = (cfg) => constraintsFor({ ...normalize(cfg), mic: '' });

// Level (RMS 0 to 1) -> bar width 0 to 100 on a decibel scale, so quiet rooms and loud voices both show.
export function meterPct(rms) {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(100, Math.round(((db + 60) / 60) * 100)));
}

export const isIOS = (ua = '', touchPoints = 0) => /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
export const looksBluetooth = (label = '') => /airpods|bluetooth|hands-?free|headset|buds|jabra|bose|beats|plantronics|poly |sony wh|wf-|galaxy buds|pixel buds|jbl|sennheiser|hfp/i.test(String(label));

// Plain tips for what the person has plugged in.
export function advice({ ios = false, micLabel = '', outLabel = '' } = {}) {
  const tips = [];
  const bt = looksBluetooth(micLabel) || looksBluetooth(outLabel);
  if (bt) {
    tips.push('Bluetooth headsets drop to phone quality sound while the mic is on. That is normal, not a bug.');
    tips.push('Connect the headset before you open the dialer. If it connects mid call, tap Audio and pick it, or hang up and call again.');
    tips.push('If your voice sounds thin to them, set the cleanup to Light and turn mic volume up a little.');
  }
  if (ios) {
    tips.push('On iPhone and iPad, tap the Hub icon on your Home Screen instead of using Safari, and keep the screen on during calls (the Hub does this for you).');
    tips.push('For the strongest cleanup on iPhone or iPad, swipe down Control Center while on a call, tap Mic Mode and choose Voice Isolation. That is Apple\'s own Krisp style cleanup and works with any app.');
    tips.push('Use Light or Standard on iPhone and iPad. Strong works but uses more battery.');
  }
  return tips;
}

// A short chime as a WAV file, for the speaker test. Two soft tones so the person can tell left from silence.
export function toneWav(sampleRate = 22050, notes = [[660, 0.35], [880, 0.45]], volume = 0.35) {
  const gap = Math.round(sampleRate * 0.06);
  const lens = notes.map(([, s]) => Math.round(sampleRate * s));
  const total = lens.reduce((a, b) => a + b, 0) + gap * (notes.length - 1);
  const buf = new ArrayBuffer(44 + total * 2);
  const v = new DataView(buf);
  const w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + total * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, total * 2, true);
  let pos = 0;
  notes.forEach(([f], n) => {
    for (let i = 0; i < lens[n]; i++) {
      const t = i / sampleRate, edge = Math.min(1, i / (sampleRate * 0.02), (lens[n] - i) / (sampleRate * 0.06));
      v.setInt16(44 + (pos + i) * 2, Math.round(Math.sin(2 * Math.PI * f * t) * volume * edge * 32767), true);
    }
    pos += lens[n] + gap;
  });
  return new Uint8Array(buf);
}
