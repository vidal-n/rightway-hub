// Small interface sounds for the moments that matter (Nov 2026 overhaul). Modeled on the earned sounds of Slack (message), Superhuman
// and Apple's guidance ("use moderation, don't add sound just because you can"): no sound on navigation, hovers or typing.
// Made in the browser with Web Audio (no files): short, quiet, and every one has a visual partner (a toast or the call window).
// One switch in the command bar (speaker icon), remembered on this device. While a call is live only the "connected" blip plays.
let ctx = null, on = true, onCall = false;
try { on = localStorage.getItem('rw-sound') !== 'off'; } catch { on = true; }
import('./phone.js').then((p) => p.onPhoneState?.((s) => { onCall = Boolean(s.onCall); })).catch(() => {});

export const soundOn = () => on;
export function setSound(v) {
  on = Boolean(v);
  try { localStorage.setItem('rw-sound', on ? 'on' : 'off'); } catch { /* ignore */ }
  paintSoundBtn();
  if (on) play('confirm');
}

// Each sound: notes [frequency Hz, start s, length s], wave, volume.
const SOUNDS = {
  tick: { notes: [[1320, 0, 0.035]], wave: 'sine', vol: 0.05 },
  confirm: { notes: [[880, 0, 0.09], [1318.5, 0.07, 0.14]], wave: 'sine', vol: 0.11 },
  win: { notes: [[784, 0, 0.12], [987.8, 0.09, 0.12], [1318.5, 0.18, 0.28]], wave: 'triangle', vol: 0.13 },
  coin: { notes: [[1567.98, 0, 0.06], [2093, 0.05, 0.22]], wave: 'square', vol: 0.045 },
  connect: { notes: [[660, 0, 0.05], [990, 0.05, 0.08]], wave: 'sine', vol: 0.09, call: true },
  message: { notes: [[1046.5, 0, 0.07], [1396.9, 0.06, 0.1]], wave: 'sine', vol: 0.07 },
  error: { notes: [[196, 0, 0.16], [146.8, 0.08, 0.2]], wave: 'triangle', vol: 0.12 },
  swipe: { notes: [[520, 0, 0.04], [700, 0.02, 0.05]], wave: 'sine', vol: 0.035 },
};
export const SOUND_NAMES = Object.keys(SOUNDS);

export function play(name) {
  const s = SOUNDS[name];
  if (!s || !on || document.hidden) return;
  if (onCall && !s.call) return; // never over a live call
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + 0.01;
    const out = ctx.createGain();
    out.gain.value = s.vol;
    out.connect(ctx.destination);
    for (const [f, at, len] of s.notes) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = s.wave;
      o.frequency.setValueAtTime(f * (1 + (Math.random() - 0.5) * 0.008), t0 + at); // a hair of variation so repeats do not grate
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(1, t0 + at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
      o.connect(g); g.connect(out);
      o.start(t0 + at); o.stop(t0 + at + len + 0.02);
    }
  } catch { /* no audio here */ }
}

const SPK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/>';
export function paintSoundBtn() {
  const b = document.getElementById('sndbtn');
  if (!b) return;
  b.innerHTML = on ? `${SPK}<path d="M15.5 8.5a5 5 0 010 7"/><path d="M18.5 5.5a9 9 0 010 13"/></svg>` : `${SPK}<path d="M22 9l-6 6M16 9l6 6"/></svg>`;
  b.setAttribute('aria-pressed', String(on));
  b.title = on ? 'Sounds are on (bookings, signed work orders, payments, calls). Tap to mute.' : 'Sounds are off. Tap to turn them on.';
}
export function wireSoundBtn() {
  paintSoundBtn();
  const b = document.getElementById('sndbtn');
  if (b && !b.__rw) { b.__rw = true; b.addEventListener('click', () => setSound(!on)); }
}

// Picks the sound for a toast or a notification from its words, so existing pages get sounds without changes.
export function soundFor(text = '', isError = false) {
  if (isError) return 'error';
  const t = String(text).toLowerCase();
  if (/\b(signed|won|converted|new client)\b/.test(t)) return 'win';
  if (/\b(paid|payment received|invoice paid)\b/.test(t)) return 'coin';
  if (/\b(booked|audit set|appointment)\b/.test(t)) return 'confirm';
  return null;
}
