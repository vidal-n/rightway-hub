// Audio settings for the browser phone. Pure (no browser calls) so Node can test it.
// A person's settings live in localStorage on each device (an iPad on Bluetooth and a laptop on a USB headset need different ones).

// How much cleanup each choice does. ns = the browser's own noise suppression, hp = cut low rumble below this many Hz,
// gate = quiet-room gate strength from 0 (off) to 10 (cuts anything but a clear voice).
export const NOISE = {
  off: { label: 'Off', note: 'Raw mic. Best for a quiet room or a good headset.', ns: false, hp: 0, gate: 0 },
  light: { label: 'Light', note: 'The browser\'s own noise cleanup. Same as before.', ns: true, hp: 0, gate: 0 },
  standard: { label: 'Standard', note: 'Cleanup plus cutting fans, rumble and desk thumps.', ns: true, hp: 90, gate: 0 },
  strong: { label: 'Strong', note: 'Also mutes the line between words, for loud rooms and open offices.', ns: true, hp: 120, gate: 4 },
};

export const DEFAULTS = {
  mic: '', out: '', gain: 100, noise: 'light', gate: -1, echo: true, auto: true, wake: true, mode: 'browser',
};

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };

export function normalize(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    mic: typeof r.mic === 'string' ? r.mic : DEFAULTS.mic,
    out: typeof r.out === 'string' ? r.out : DEFAULTS.out,
    gain: num(r.gain, 20, 300, DEFAULTS.gain),
    noise: NOISE[r.noise] ? r.noise : DEFAULTS.noise,
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
  const hp = p.hp;
  return { ns: p.ns, echo: c.echo, auto: c.auto, hp, gate, gain: c.gain / 100, processor: hp > 0 || gate > 0 || c.gain !== 100 };
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
