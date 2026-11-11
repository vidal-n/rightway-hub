// Audio settings for the browser phone: pick the mic and speaker, mic volume, how much background noise to cut,
// Bluetooth plug and unplug, microphone permission help, keep the screen awake on a call, and "use my phone" mode.
// Settings are saved on this device (localStorage) and applied right before every call, so nothing holds the mic open between calls.
import { $, $$, esc, api, toast, modal } from './core.js';
import { NOISE, normalize, plan, constraintsFor, constraintsAnyMic, gateThreshold, gateStep, pickInput, deviceLabel, permissionHelp, meterPct, isIOS, advice, toneWav, learnLevel } from '/js/audiocfg.js';

const KEY = 'rw-audio';
const listeners = new Set();

export function loadAudio() {
  try { return normalize(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return normalize(memory || {}); }
}
export function saveAudio(patch) {
  const next = normalize({ ...loadAudio(), ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private window: settings last until reload */ memory = next; }
  listeners.forEach((fn) => { try { fn(next); } catch { /* ignore */ } });
  for (const p of active) { try { p.update(next); } catch { /* ignore */ } }
  return next;
}
let memory = null;
export const callMode = () => loadAudio().mode;
export function onAudioChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ---------- the voice engine: one audio worklet between the mic and the call ----------
// The worklet (public/js/denoise-worklet.js) does the rumble filter, the room-noise cleanup, the quiet gate and the volume on the audio thread.
// If it cannot load, never starts, or stops beating mid call, the same stream is rewired to a plain filter + gate so the call is never silent.
const WORKLET_URL = '/js/denoise-worklet.js';
const active = new Set();           // every live processor, so a settings change reaches all of them
let sharedCtx = null;
const withModule = new WeakSet();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// One AudioContext for the page. It is made inside the tap that starts a call (iPhone only allows that) and reused afterwards.
function getCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedCtx || sharedCtx.state === 'closed') {
    try { sharedCtx = new Ctx({ latencyHint: 'interactive' }); } catch { try { sharedCtx = new Ctx(); } catch { sharedCtx = null; } }
    if (sharedCtx) sharedCtx.addEventListener?.('statechange', () => { if (sharedCtx && (sharedCtx.state === 'interrupted' || sharedCtx.state === 'suspended') && active.size) setTimeout(() => sharedCtx?.resume?.().catch(() => {}), 250); });
  }
  return sharedCtx;
}
export function warmAudio() { try { getCtx()?.resume?.().catch(() => {}); } catch { /* ignore */ } }

class RwProcessor {
  constructor() { this.cfg = loadAudio(); this.ctx = null; this.nodes = null; this.engine = 'none'; this.beat = 0; this.gateOpen = true; this.info = {}; this.timer = null; this.wake = null; }
  get label() { return { ai: 'Running', basic: 'Basic filter (backup)', none: 'Off', failed: 'Off (could not start)' }[this.engine] || 'Off'; }
  update(cfg) {
    this.cfg = normalize(cfg);
    const n = this.nodes; if (!n) return;
    const p = plan(this.cfg);
    if (n.voice) { try { n.voice.port.postMessage({ ai: p.ai, hp: p.hp, gateThr: gateThreshold(p.gate), gain: p.gain, lock: p.lock }); } catch { /* ignore */ } }
    if (n.hp) { n.hp.frequency.value = p.hp || 10; n.gain.gain.setTargetAtTime(p.gain, this.ctx.currentTime, 0.02); }
  }
  levels() {
    const n = this.nodes; if (!n) return { inp: 0, out: 0 };
    const rms = (an) => { const b = (an.buf ||= new Float32Array(an.fftSize)); an.getFloatTimeDomainData(b); let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length); };
    try { return { inp: rms(n.anIn), out: rms(n.anOut) }; } catch { return { inp: 0, out: 0 }; }
  }
  async createProcessedStream(stream) {
    this.teardown();
    const ctx = getCtx();
    if (!ctx) { this.engine = 'failed'; return stream; }
    // iPhone and iPad keep an AudioContext asleep until it is resumed. If it will not wake, send the plain mic rather than silence.
    try { await Promise.race([ctx.resume(), wait(900)]); } catch { /* checked below */ }
    if (ctx.state !== 'running') { this.engine = 'failed'; this.info = { why: 'The browser kept the audio engine asleep.' }; return stream; }
    this.ctx = ctx;
    const track = stream.getAudioTracks()[0];
    const set = track?.getSettings?.() || {};
    this.info = { label: track?.label || '', mic: set.deviceId || '', ns: set.noiseSuppression, echo: set.echoCancellation, agc: set.autoGainControl, micRate: set.sampleRate, ctxRate: ctx.sampleRate, ios: isIOS(navigator.userAgent, navigator.maxTouchPoints) };
    track?.addEventListener?.('ended', () => { if (this.nodes) document.dispatchEvent(new CustomEvent('rw-audio-lost')); });
    const src = ctx.createMediaStreamSource(stream);
    const anIn = ctx.createAnalyser(); anIn.fftSize = 1024;
    const anOut = ctx.createAnalyser(); anOut.fftSize = 1024;
    const dest = ctx.createMediaStreamDestination();
    anOut.connect(dest); src.connect(anIn);
    this.nodes = { src, anIn, anOut, dest, voice: null, hp: null, gate: null, gain: null };
    active.add(this);
    this.beat = 0; this.engine = 'none';
    let ok = false;
    if (ctx.audioWorklet && window.AudioWorkletNode) {
      try {
        if (!withModule.has(ctx)) { await Promise.race([ctx.audioWorklet.addModule(WORKLET_URL), wait(5000).then(() => { throw new Error('timeout'); })]); withModule.add(ctx); }
        const voice = new AudioWorkletNode(ctx, 'rw-voice', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
        voice.port.onmessage = (e) => { const d = e.data; if (d && d.hb) { this.beat = performance.now(); this.gateOpen = d.open !== false; this.inLevel = d.inLevel || 0; } };
        src.connect(voice); voice.connect(anOut);
        this.nodes.voice = voice;
        this.update(this.cfg);
        for (let i = 0; i < 30 && !this.beat; i++) await wait(40);   // wait up to 1.2 s for the first heartbeat
        ok = Boolean(this.beat);
      } catch { ok = false; }
    }
    if (ok) this.engine = 'ai'; else this.useBasic(ok === false && !ctx.audioWorklet ? 'This browser has no audio worklets.' : 'The voice engine did not start.');
    this.timer = setInterval(() => this.watch(), 1000);
    this.wake = () => { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); };
    ['visibilitychange', 'pageshow', 'touchend', 'click'].forEach((ev) => document.addEventListener(ev, this.wake, { passive: true }));
    return dest.stream;
  }
  // Plain high pass + volume + a timer-driven gate. Used only when the worklet cannot run.
  useBasic(why) {
    const n = this.nodes, ctx = this.ctx; if (!n || n.hp) return;
    if (n.voice) { try { n.src.disconnect(n.voice); n.voice.disconnect(); } catch { /* ignore */ } }   // only the worklet leg: the level meter on the mic stays connected
    n.voice = null;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.Q.value = 0.7;
    const gate = ctx.createGain(); const gain = ctx.createGain();
    n.src.connect(hp); hp.connect(gate); gate.connect(gain); gain.connect(n.anOut);
    Object.assign(n, { hp, gate, gain });
    this.engine = 'basic'; this.info.why = why || this.info.why;
    this.update(this.cfg);
    let state = { open: true, quiet: 0 }, last = performance.now();
    n.gateTimer = setInterval(() => {
      const t = performance.now(), dt = t - last; last = t;
      const pl = plan(this.cfg);
      const thr = pl.lock || gateThreshold(pl.gate);
      if (!thr) { gate.gain.value = 1; this.gateOpen = true; return; }
      state = gateStep(state, this.levels().inp, thr, dt);
      this.gateOpen = state.open;
      gate.gain.setTargetAtTime(state.open ? 1 : 0.04, ctx.currentTime, state.open ? 0.01 : 0.06);
    }, 25);
  }
  watch() {
    if (this.engine !== 'ai' || !this.ctx) return;
    if (this.ctx.state !== 'running') { this.ctx.resume().catch(() => {}); return; }
    if (performance.now() - this.beat > 3000) this.useBasic('The voice engine stopped, so the backup filter took over.');
  }
  teardown() {
    clearInterval(this.timer); this.timer = null;
    if (this.wake) { ['visibilitychange', 'pageshow', 'touchend', 'click'].forEach((ev) => document.removeEventListener(ev, this.wake)); this.wake = null; }
    const n = this.nodes;
    if (n) {
      clearInterval(n.gateTimer);
      for (const k of ['src', 'voice', 'hp', 'gate', 'gain', 'anIn', 'anOut', 'dest']) { try { n[k]?.disconnect(); } catch { /* ignore */ } }
      try { if (n.voice) n.voice.port.onmessage = null; } catch { /* ignore */ }
    }
    this.nodes = null; active.delete(this);
  }
  async destroyProcessedStream(processed) {
    try { processed?.getTracks?.().forEach((t) => t.stop()); } catch { /* ignore */ }
    this.teardown();
    this.engine = 'none';
    // Let go of the audio hardware between calls. Not on iPhone or iPad: they cannot wake it again without a tap, and power dialing has none.
    if (!active.size && !isIOS(navigator.userAgent, navigator.maxTouchPoints)) { try { await sharedCtx?.suspend(); } catch { /* ignore */ } }
  }
}
let proc = null;
let procOn = false;
let curDevice = null;

// What the cleanup is doing right now (the panel shows it).
export const engineState = () => (proc && procOn && proc.nodes ? { engine: proc.engine, label: proc.label, why: proc.info.why || '' } : null);
export const liveLevels = () => (proc && proc.nodes ? proc.levels() : null);

// Turn the processor on or off to match the settings (it is only in the way when nothing needs it).
async function syncProcessor(a, p) {
  try {
    if (p.processor && !procOn) { proc ||= new RwProcessor(); await a.addProcessor(proc); procOn = true; }
    else if (!p.processor && procOn && proc) { await a.removeProcessor(proc); procOn = false; }
  } catch { procOn = false; }
}
// A settings change in the middle of a call.
export async function applyLive(device) {
  const a = device?.audio; if (!a) return;
  await syncProcessor(a, plan(loadAudio()));
}

// ---------- the microphone ----------
// Open the mic with the saved device; if that exact device is gone, say so and fall back to the default one.
export async function openMic(cfg) {
  const gum = (c) => navigator.mediaDevices.getUserMedia({ audio: c });
  try { return { stream: await gum(constraintsFor(cfg)), fellBack: false }; }
  catch (e) {
    if (cfg.mic && /Overconstrained|NotFound/i.test(e?.name || '')) return { stream: await gum(constraintsAnyMic(cfg)), fellBack: true };
    throw e;
  }
}
export const micProblem = (e) => ({ NotAllowedError: 'The microphone is blocked. Allow it below.', SecurityError: 'The microphone is blocked. Allow it below.', NotFoundError: 'No microphone found. Plug one in or connect your headset.', NotReadableError: 'Another app is using the microphone. Close it and try again.', OverconstrainedError: 'That microphone is not available.' }[e?.name] || 'Could not open the microphone.');

// ---------- Twilio device ----------
// Called right before a call is placed or answered, inside the tap that started it (iPhone only allows audio set up from a tap).
export async function prepareAudio(device) {
  curDevice = device || curDevice;
  warmAudio();      // first thing, before any await: this is the part iPhone needs to happen inside the tap
  const cfg = loadAudio();
  const a = device?.audio;
  if (!a) return cfg;
  try { a.setAudioConstraints(constraintsFor({ ...cfg, mic: '' })); } catch { /* older SDK */ }
  const p = plan(cfg);
  await syncProcessor(a, p);
  for (const x of active) x.update(cfg);
  // Speaker (not on iPhone or iPad: Safari there plays through whatever Control Center or the Bluetooth device chose).
  try {
    if (a.isOutputSelectionSupported && cfg.out && a.availableOutputDevices?.has(cfg.out)) {
      await a.speakerDevices.set([cfg.out]); await a.ringtoneDevices.set([cfg.out]);
    }
  } catch { /* keep the default speaker */ }
  // Microphone: use the saved one when it is still connected, otherwise the default.
  const want = cfg.mic || (p.processor ? 'default' : '');
  if (want) {
    try {
      const list = [...(a.availableInputDevices?.values?.() || [])].map((d) => ({ id: d.deviceId }));
      const pick = want === 'default' ? { id: 'default', lost: false } : pickInput(list.length ? list : [{ id: want }], want);
      if (pick.lost) toast('Your saved microphone is not connected, so the default mic is being used.');
      await a.setInputDevice(pick.id || 'default');
      usedInput = true;
    } catch (e) {
      if (cfg.mic) toast('Could not use that microphone. Using the default one.', true);
      try { await a.unsetInputDevice(); } catch { /* ignore */ }
      usedInput = false;
    }
  }
  return cfg;
}
let usedInput = false;
// After a call: let go of the mic so the browser's recording dot goes away.
export async function releaseAudio(device) {
  if (!usedInput) return;
  usedInput = false;
  try { await device?.audio?.unsetInputDevice(); } catch { /* ignore */ }
}

// The mic vanished in the middle of a call (headset died, cable pulled): move to the default one instead of going silent.
let lostAt = 0;
document.addEventListener('rw-audio-lost', async () => {
  const d = curDevice; if (!d?.audio || !(d.calls?.length || d.activeCall) || Date.now() - lostAt < 3000) return;
  lostAt = Date.now();
  toast('Your microphone disconnected. Switching to the default one.', true);
  try { await d.audio.setInputDevice('default'); } catch { try { await d.audio.unsetInputDevice(); } catch { /* ignore */ } }
});

// Plug or unplug Bluetooth, headset or USB: tell the person and keep the list fresh.
let watching = false;
export function watchDevices(device) {
  if (watching || !navigator.mediaDevices?.addEventListener) return;
  watching = true;
  let before = null;
  const snap = async () => { try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput'); } catch { return []; } };
  snap().then((s) => { before = s; });
  navigator.mediaDevices.addEventListener('devicechange', async () => {
    const now = await snap();
    const prev = before || []; before = now;
    const had = new Set(prev.map((d) => d.deviceId + d.kind));
    const has = new Set(now.map((d) => d.deviceId + d.kind));
    const gone = prev.filter((d) => !has.has(d.deviceId + d.kind) && d.label);
    const added = now.filter((d) => !had.has(d.deviceId + d.kind) && d.label);
    const cfg = loadAudio();
    if (gone.some((d) => d.deviceId === cfg.mic || d.deviceId === cfg.out)) toast(`${gone[0].label} disconnected. The default is being used until it comes back.`);
    else if (added.length) toast(`${added[0].label} connected.`);
    // Mid call: move to the saved device again once it returns.
    if (cfg.mic && added.some((d) => d.deviceId === cfg.mic) && device?.audio) { try { await device.audio.setInputDevice(cfg.mic); } catch { /* ignore */ } }
    // A headset plugged in or connected in the middle of a call: follow the system default so they are heard on it.
    const live = Boolean(device?.calls?.length || device?.activeCall);
    if (live && !cfg.mic && added.some((d) => d.kind === 'audioinput') && Date.now() - lastSwap > 4000) {
      lastSwap = Date.now();
      await wait(700);
      try { await device.audio.setInputDevice('default'); toast('Switched your microphone to the new headset.'); } catch { /* keep the current one */ }
    }
    document.dispatchEvent(new CustomEvent('rw-audio-devices'));
  });
}
let lastSwap = 0;

// ---------- keep the screen awake on a call ----------
let lock = null;
export async function keepAwake(on) {
  try {
    if (!on) { await lock?.release(); lock = null; return; }
    if (!loadAudio().wake || !navigator.wakeLock || lock) return;
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch { lock = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wantLock) keepAwake(true); });
let wantLock = false;
export function awakeDuringCall(on) { wantLock = on; keepAwake(on); }

// ---------- microphone permission ----------
export async function micPermission() {
  try { const r = await navigator.permissions.query({ name: 'microphone' }); return r.state; } catch { return 'unknown'; }
}

// ---------- the panel ----------
const isLive = (device) => Boolean(device?.calls?.length || device?.activeCall);
const ENGINE_NOTE = { ai: 'Running: the Hub\'s voice cleanup is on the audio thread.', basic: 'Backup filter: the voice engine could not run here, so a simple filter is used. Your voice still goes through.', none: 'Off: nothing extra is added to your mic.', failed: 'Off: the browser would not start the audio engine, so your plain mic is used. Your voice still goes through.' };

export function audioPanel({ device = null } = {}) {
  let stopMeter = () => {};
  let probe = null;
  const { el, close } = modal(`<div class="aud"><div class="aud-head"><h2>Phone audio</h2><button type="button" class="btn btn-ghost btn-sm" data-close>Done</button></div><div id="audbody"><div class="skeleton" style="height:240px"></div></div></div>`, { onClose: () => { stopMeter(); } });
  const ios = isIOS(navigator.userAgent, navigator.maxTouchPoints);
  const paint = async () => {
    const cfg = loadAudio();
    let devs = [];
    try { devs = await navigator.mediaDevices.enumerateDevices(); } catch { /* none */ }
    const ins = devs.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications');
    const outs = devs.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'communications');
    const perm = await micPermission();
    const canOut = Boolean(device?.audio?.isOutputSelectionSupported ?? ('setSinkId' in HTMLMediaElement.prototype));
    const live = isLive(device);
    const p = plan(cfg);
    const gateShown = cfg.gate === -1 ? p.gate : cfg.gate;
    const aiShown = Math.round(p.ai * 100);
    const micLabel = (ins.find((d) => d.deviceId === (cfg.mic || 'default')) || ins[0] || {}).label || '';
    const outLabel = (outs.find((d) => d.deviceId === (cfg.out || 'default')) || outs[0] || {}).label || '';
    const tips = advice({ ios, micLabel, outLabel });
    $('#audbody', el).innerHTML = `
      <section class="aud-sec"><h3>Microphone</h3>
        <select id="amic" aria-label="Microphone"><option value="">Default${ins[0]?.label ? ` (${esc(ins.find((d) => d.deviceId === 'default')?.label?.replace(/^Default - /, '') || ins[0].label)})` : ''}</option>
          ${ins.filter((d) => d.deviceId !== 'default').map((d, i) => `<option value="${esc(d.deviceId)}"${d.deviceId === cfg.mic ? ' selected' : ''}>${esc(deviceLabel(d, i))}</option>`).join('')}</select>
        <div class="aud-meters">
          <div><span class="small muted">Your mic</span><div class="aud-meter" aria-hidden="true"><i id="ameterin"></i></div></div>
          <div><span class="small muted">What they hear</span><div class="aud-meter out" aria-hidden="true"><i id="ameter"></i></div></div>
        </div>
        <p class="small muted" id="atesthint">${live ? 'You are on a call. The bars show your live call audio.' : 'Speak and watch the bars. The lower bar is what the other person hears after cleanup.'}</p>
        <div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-ghost btn-sm" id="atest"${live ? ' disabled' : ''}>Test my mic (4 sec)</button><button type="button" class="btn btn-ghost btn-sm" id="aplay" hidden>Hear what they hear</button><button type="button" class="btn btn-ghost btn-sm" id="aplayraw" hidden>Hear without cleanup</button></div>
        <label class="aud-row"><span>Mic volume <b id="agv">${cfg.gain}%</b></span><input type="range" id="again" min="20" max="300" step="5" value="${cfg.gain}"></label>
      </section>
      <section class="aud-sec"><h3>Background noise</h3>
        <div class="seg aud-seg" id="anoise">${Object.entries(NOISE).map(([k, v]) => `<button type="button" data-n="${k}" class="${k === cfg.noise ? 'is-on' : ''}">${esc(v.label)}</button>`).join('')}</div>
        <p class="small muted" id="anote">${esc(NOISE[cfg.noise].note)}</p>
        <label class="aud-row"><span>Cleanup strength <b id="aaiv">${aiShown ? aiShown + '%' : 'Off'}</b></span><input type="range" id="aai" min="0" max="100" step="5" value="${aiShown}"></label>
        <p class="small muted">Learns steady noise like fans, air conditioning, hum and hiss, and turns it down while you talk. Higher cuts more but can make a voice sound thin.</p>
        <label class="aud-row"><span>Cut quiet sound between words <b id="agtv">${gateShown ? gateShown : 'Off'}</b></span><input type="range" id="agate" min="0" max="10" step="1" value="${gateShown}"></label>
        <div class="aud-lock ${cfg.lock && cfg.level ? 'on' : ''}">
          <label class="row" style="gap:8px"><input type="checkbox" id="alock"${cfg.lock ? ' checked' : ''}><b>My voice only</b></label>
          <p class="small muted">Teach it how loud you are on this mic. Anything quieter than you (a TV, coworkers, the room) is muted completely. Voices louder than yours, or talking at the same instant you do, can still leak through.</p>
          <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><button type="button" class="btn btn-primary btn-sm" id="alearn"${live ? ' disabled' : ''}>${cfg.level ? 'Teach it again' : 'Teach it my voice'}</button><span class="small muted" id="alearnhint">${cfg.level ? 'Learned for this mic. Re-teach it if you change headset or mic.' : 'Takes 6 seconds. You will read a short sentence.'}</span></div>
          <label class="aud-row"><span>How strict <b id="astv">${cfg.strict}</b></span><input type="range" id="astrict" min="1" max="10" step="1" value="${cfg.strict}"></label>
          <p class="small muted">Raise it if background still gets through. Lower it if your quiet words get cut.</p>
        </div>
        <div class="aud-checks">
          <label class="row small" style="gap:8px"><input type="checkbox" id="aheadset"${cfg.headset ? ' checked' : ''}> I use a noise cancelling headset or boom mic <span class="muted">(skips the browser's own cleanup so it is not done twice)</span></label>
          <label class="row small" style="gap:8px"><input type="checkbox" id="aecho"${cfg.echo ? ' checked' : ''}> Echo cancellation <span class="muted">(turn off with a headset that has its own)</span></label>
          <label class="row small" style="gap:8px"><input type="checkbox" id="aauto"${p.auto ? ' checked' : ''}${cfg.lock && cfg.level ? ' disabled' : ''}> Auto level my voice ${cfg.lock && cfg.level ? '<span class="muted">(off while My voice only is on)</span>' : ''}</label>
        </div>
      </section>
      <section class="aud-sec"><h3>Speaker</h3>
        ${canOut && !ios ? `<select id="aout" aria-label="Speaker"><option value="">Default</option>${outs.filter((d) => d.deviceId !== 'default').map((d, i) => `<option value="${esc(d.deviceId)}"${d.deviceId === cfg.out ? ' selected' : ''}>${esc(deviceLabel(d, i))}</option>`).join('')}</select>`
          : `<p class="small muted">${ios ? 'On iPhone and iPad the sound plays through whatever you pick in Control Center (swipe down, press the audio card) or the Bluetooth device you connected. Safari does not let a page choose it.' : 'This browser plays through the system speaker. Change it in your computer\'s sound settings.'}</p>`}
        <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><button type="button" class="btn btn-ghost btn-sm" id="aspk">Play test sound</button><span class="small muted" id="aspkhint">You should hear two soft tones.</span></div>
      </section>
      <section class="aud-sec"><h3>Microphone permission</h3>
        <p class="small"><b class="aud-perm ${perm}">${{ granted: 'Allowed', denied: 'Blocked', prompt: 'Not asked yet', unknown: 'Unknown' }[perm]}</b> ${perm === 'granted' ? 'The browser will not ask again on this device.' : perm === 'denied' ? 'Calls cannot hear you until you allow it.' : 'Allow it once and choose to remember.'}</p>
        <div class="row" style="gap:8px"><button type="button" class="btn btn-primary btn-sm" id="aallow">${perm === 'granted' ? 'Check again' : 'Allow microphone'}</button></div>
        <ul class="small muted aud-help">${permissionHelp(navigator.userAgent).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </section>
      <section class="aud-sec"><h3>On a call</h3>
        <label class="row small" style="gap:8px"><input type="checkbox" id="awake"${cfg.wake ? ' checked' : ''}> Keep the screen on during a call ${'wakeLock' in navigator ? '' : '<span class="muted">(this browser cannot)</span>'}</label>
        <div class="seg aud-seg" id="amode" style="margin-top:10px"><button type="button" data-m="browser" class="${cfg.mode === 'browser' ? 'is-on' : ''}">This device's mic</button><button type="button" data-m="phone" class="${cfg.mode === 'phone' ? 'is-on' : ''}">Use my phone</button></div>
        <p class="small muted" id="amodenote">${cfg.mode === 'phone' ? 'The Hub rings your mobile and connects you to the lead, like a normal phone call. It keeps working with the screen locked or in another app. This is the best choice on an iPhone.' : 'Calls use this device\'s microphone and speakers. On an iPhone, Safari pauses the mic when you leave the page, so use My phone if you need to switch apps.'}</p>
        <div id="amobile" ${cfg.mode === 'phone' ? '' : 'hidden'}><div class="row" style="gap:8px"><input id="aphone" type="tel" placeholder="Your mobile number" style="max-width:220px"><button type="button" class="btn btn-ghost btn-sm" id="aphonesave">Save number</button></div></div>
      </section>
      <section class="aud-sec"><h3>Details</h3>
        <dl class="aud-diag" id="adiag"><dt>Cleanup engine</dt><dd id="adeng">Checking...</dd></dl>
        ${tips.length ? `<ul class="small muted aud-help">${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      </section>
      <div class="row" style="justify-content:space-between;margin-top:6px"><button type="button" class="linkbtn" id="areset">Reset to default</button><span class="small muted">Saved on this device</span></div>`;
    wire(cfg);
    if (cfg.mode === 'phone') api('/api/me').then((m) => { const i = $('#aphone', el); if (i && m.user?.phone) i.value = m.user.phone; }).catch(() => {});
  };

  const set = (patch) => { const n = saveAudio(patch); if (isLive(device)) applyLive(device).catch(() => {}); return n; };
  const hint = (t) => { const h = $('#atesthint', el); if (h) h.textContent = t; };
  const wire = (cfg0) => {
    const root = $('#audbody', el);
    const refresh = () => { const c = loadAudio(); const pl = plan(c); const g = pl.gate; $('#agate', root).value = g; $('#agtv', root).textContent = g || 'Off'; const ai = Math.round(pl.ai * 100); $('#aai', root).value = ai; $('#aaiv', root).textContent = ai ? `${ai}%` : 'Off'; };
    $('#amic', root).addEventListener('change', async (e) => { set({ mic: e.target.value, level: 0, lock: false }); if (device?.audio && e.target.value) { try { await device.audio.setInputDevice(e.target.value); } catch { toast('Could not use that microphone.', true); } } paint(); });
    $('#aout', root)?.addEventListener('change', async (e) => { set({ out: e.target.value }); try { if (device?.audio?.isOutputSelectionSupported) { await device.audio.speakerDevices.set(e.target.value ? [e.target.value] : []); await device.audio.ringtoneDevices.set(e.target.value ? [e.target.value] : []); } } catch { toast('Could not switch the speaker.', true); } });
    $('#again', root).addEventListener('input', (e) => { $('#agv', root).textContent = `${e.target.value}%`; set({ gain: Number(e.target.value) }); });
    $('#agate', root).addEventListener('input', (e) => { const v = Number(e.target.value); $('#agtv', root).textContent = v || 'Off'; set({ gate: v }); });
    $('#aai', root).addEventListener('input', (e) => { const v = Number(e.target.value); $('#aaiv', root).textContent = v ? `${v}%` : 'Off'; set({ ai: v }); });
    $$('#anoise [data-n]', root).forEach((b) => b.addEventListener('click', () => {
      set({ noise: b.dataset.n, gate: -1, ai: -1 });
      $$('#anoise button', root).forEach((x) => x.classList.toggle('is-on', x === b));
      $('#anote', root).textContent = NOISE[b.dataset.n].note;
      refresh();
    }));
    $('#alock', root).addEventListener('change', (e) => {
      if (e.target.checked && !loadAudio().level) { e.target.checked = false; set({ lock: false }); toast('Tap Teach it my voice first.'); $('#alearn', root).focus(); return; }
      set({ lock: e.target.checked }); paint();
    });
    $('#astrict', root).addEventListener('input', (e) => { $('#astv', root).textContent = e.target.value; set({ strict: Number(e.target.value) }); });
    $('#aheadset', root).addEventListener('change', (e) => { set({ headset: e.target.checked }); startMeter(); });
    $('#aecho', root).addEventListener('change', (e) => { set({ echo: e.target.checked }); startMeter(); });
    $('#aauto', root).addEventListener('change', (e) => { set({ auto: e.target.checked }); startMeter(); });
    $('#awake', root).addEventListener('change', (e) => set({ wake: e.target.checked }));
    $$('#amode [data-m]', root).forEach((b) => b.addEventListener('click', () => {
      set({ mode: b.dataset.m });
      $$('#amode button', root).forEach((x) => x.classList.toggle('is-on', x === b));
      $('#amobile', root).hidden = b.dataset.m !== 'phone';
      $('#amodenote', root).textContent = b.dataset.m === 'phone' ? 'The Hub rings your mobile and connects you to the lead, like a normal phone call. It keeps working with the screen locked or in another app. This is the best choice on an iPhone.' : 'Calls use this device\'s microphone and speakers. On an iPhone, Safari pauses the mic when you leave the page, so use My phone if you need to switch apps.';
      if (b.dataset.m === 'phone') api('/api/me').then((m) => { const i = $('#aphone', root); if (i && m.user?.phone) i.value = m.user.phone; }).catch(() => {});
    }));
    $('#aphonesave', root).addEventListener('click', async () => { try { const r = await api('/api/me/phone', { method: 'PUT', body: { phone: $('#aphone', root).value } }); toast(r.phone ? `Saved. The Hub will ring ${r.phone}.` : 'Number removed.'); } catch (err) { toast(err.message, true); } });
    $('#areset', root).addEventListener('click', () => { saveAudio({ mic: '', out: '', gain: 100, noise: 'light', ai: -1, ns: 'auto', lock: false, level: 0, strict: 6, headset: false, gate: -1, echo: true, auto: true, wake: true }); paint(); });
    $('#aallow', root).addEventListener('click', async () => { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); toast('Microphone allowed.'); } catch (e) { toast(micProblem(e), true); } paint(); });
    $('#atest', root).addEventListener('click', () => record(root));
    $('#alearn', root).addEventListener('click', () => learn(root));
    $('#aspk', root).addEventListener('click', () => speakerTest(root));
    startMeter();
  };

  // Live bars: what the mic gives, and what the call would carry after cleanup. During a call they read the call's own audio.
  const startMeter = async () => {
    stopMeter(); stopMeter = () => {};
    const bIn = $('#ameterin', el), bOut = $('#ameter', el); if (!bOut) return;
    const diag = (info, engine) => {
      const d = $('#adeng', el); if (!d) return;
      const rows = [];
      if (info?.label) rows.push(['Microphone', info.label]);
      if (info?.ctxRate) rows.push(['Sample rate', `${info.ctxRate} Hz${info.micRate && info.micRate !== info.ctxRate ? ` (mic ${info.micRate} Hz)` : ''}`]);
      if (info) rows.push(['Browser cleanup', `noise cut ${info.ns ? 'on' : 'off'}, echo cancel ${info.echo ? 'on' : 'off'}, auto level ${info.agc ? 'on' : 'off'}`]);
      d.innerHTML = `${esc(ENGINE_NOTE[engine] || ENGINE_NOTE.none)}${info?.why ? `<br><span class="muted">${esc(info.why)}</span>` : ''}`;
      const dl = $('#adiag', el);
      dl.querySelectorAll('.extra').forEach((x) => x.remove());
      rows.forEach(([k, v]) => dl.insertAdjacentHTML('beforeend', `<dt class="extra">${esc(k)}</dt><dd class="extra">${esc(v)}</dd>`));
    };
    const draw = (lv, open) => { bIn.style.width = `${meterPct(lv.inp)}%`; bOut.style.width = `${meterPct(lv.out)}%`; bOut.classList.toggle('cut', open === false); };
    if (isLive(device)) {
      const t = setInterval(() => { const lv = liveLevels(); if (lv) draw(lv, proc?.gateOpen); const e = engineState(); diag(proc?.info, e?.engine || 'none'); }, 80);
      stopMeter = () => { clearInterval(t); bIn.style.width = '0'; bOut.style.width = '0'; };
      return;
    }
    let raw, pr;
    try {
      const m = await openMic(loadAudio()); raw = m.stream;
      if (m.fellBack) { hint('Your saved microphone is not connected, so the default one is being used.'); set({ mic: '' }); }
      warmAudio();
      pr = new RwProcessor(); probe = pr;
      const out = await pr.createProcessedStream(raw);
      const tid = setInterval(() => { draw(pr.nodes ? pr.levels() : { inp: 0, out: 0 }, pr.gateOpen); }, 60);
      diag(pr.info, pr.engine);
      stopMeter = () => { clearInterval(tid); raw.getTracks().forEach((x) => x.stop()); pr.destroyProcessedStream(out); bIn.style.width = '0'; bOut.style.width = '0'; if (probe === pr) probe = null; };
    } catch (e) { hint(micProblem(e)); raw?.getTracks().forEach((x) => x.stop()); }
  };

  // Record 4 seconds twice at once, with and without the Hub's cleanup, so the person can hear the difference.
  let urls = [];
  const record = async (root) => {
    if (!window.MediaRecorder) return toast('This browser cannot record a test. Watch the bars instead.');
    stopMeter(); stopMeter = () => {};
    const btn = $('#atest', root), play = $('#aplay', root), playRaw = $('#aplayraw', root);
    btn.disabled = true; play.hidden = true; playRaw.hidden = true;
    let raw, pr, clean;
    try {
      const m = await openMic(loadAudio()); raw = m.stream;
      warmAudio();
      pr = new RwProcessor(); clean = await pr.createProcessedStream(raw);
      const both = clean !== raw;
      const mk = (s) => { const rec = new MediaRecorder(s); const chunks = []; rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); }; return { rec, chunks }; };
      const A = mk(clean), B = both ? mk(raw) : null;
      hint('Recording... say a sentence, then stay quiet for a second.');
      A.rec.start(); B?.rec.start();
      await wait(4000);
      await Promise.all([A, B].filter(Boolean).map((x) => new Promise((r) => { x.rec.onstop = r; x.rec.stop(); })));
      urls.forEach((u) => URL.revokeObjectURL(u)); urls = [];
      const url = (x) => { const u = URL.createObjectURL(new Blob(x.chunks, { type: x.rec.mimeType || 'audio/mp4' })); urls.push(u); return u; };
      const playUrl = (u) => async () => { const a = new Audio(u); const out = loadAudio().out; try { if (out && a.setSinkId) await a.setSinkId(out); } catch { /* default speaker */ } a.play().catch(() => toast('Tap again to play.')); };
      play.hidden = false; play.onclick = playUrl(url(A));
      if (B) { playRaw.hidden = false; playRaw.onclick = playUrl(url(B)); }
      hint(B ? 'Play both and compare. The first is what the other person hears.' : 'Play it back to hear what the other person hears.');
    } catch (e) { hint(micProblem(e)); }
    raw?.getTracks().forEach((t) => t.stop()); await pr?.destroyProcessedStream(clean);
    btn.disabled = false; startMeter();
  };

  // Teach "My voice only": read a sentence for 6 seconds, keep the level of the speech, ignore the pauses.
  const learn = async (root) => {
    const btn = $('#alearn', root), h = $('#alearnhint', root);
    stopMeter(); stopMeter = () => {};
    btn.disabled = true;
    let raw, pr, out;
    try {
      const cfg0 = loadAudio();
      const m = await openMic({ ...cfg0, lock: true, level: 1 });   // lock on so the browser's auto level is off, like on a real call
      raw = m.stream; warmAudio();
      pr = new RwProcessor(); out = await pr.createProcessedStream(raw);
      const frames = [];
      const t0 = Date.now();
      h.textContent = 'Read this out loud at your normal call volume: "Hi, this is Vidal with Rightway Growth, do you have a quick minute?"';
      while (Date.now() - t0 < 6000) { await wait(25); if (pr.nodes) frames.push(pr.engine === 'ai' ? pr.inLevel : pr.levels().inp); }
      const level = learnLevel(frames);
      if (!level) h.textContent = 'It did not hear a clear voice. Move the mic closer, raise mic volume, and try again.';
      else { saveAudio({ level, lock: true }); h.textContent = 'Learned. My voice only is on. Test it with the bars, or tap Test my mic.'; }
    } catch (e) { h.textContent = micProblem(e); }
    raw?.getTracks().forEach((t) => t.stop()); await pr?.destroyProcessedStream(out);
    btn.disabled = false;
    if (loadAudio().level) paint(); else startMeter();
  };

  const speakerTest = async (root) => {
    const h = $('#aspkhint', root);
    try {
      const u = URL.createObjectURL(new Blob([toneWav()], { type: 'audio/wav' }));
      const a = new Audio(u); a.volume = 0.8;
      const out = loadAudio().out;
      if (out && a.setSinkId) { try { await a.setSinkId(out); } catch { h.textContent = 'That speaker is not available, so the default one is used.'; } }
      a.onended = () => URL.revokeObjectURL(u);
      await a.play();
      h.textContent = 'Playing... no sound? Check the volume, the silent switch on an iPhone, and that your headset is connected.';
    } catch { h.textContent = 'The browser would not play it. Tap the button again.'; }
  };

  document.addEventListener('rw-audio-devices', function again() { if (!document.body.contains(el)) { document.removeEventListener('rw-audio-devices', again); return; } paint(); });
  paint();
  return { close };
}

// Any element with data-audio opens the panel (the dialer tab bar has one). The phone tells us which device is live.
let getDev = () => null;
export const setDeviceGetter = (fn) => { getDev = fn; };
document.addEventListener('click', (e) => { if (e.target.closest?.('[data-audio]')) audioPanel({ device: getDev() }); });
