// Audio settings for the browser phone: pick the mic and speaker, mic volume, how much background noise to cut,
// Bluetooth plug and unplug, microphone permission help, keep the screen awake on a call, and "use my phone" mode.
// Settings are saved on this device (localStorage) and applied right before every call, so nothing holds the mic open between calls.
import { $, $$, esc, api, toast, modal } from './core.js';
import { NOISE, normalize, plan, constraintsFor, gateThreshold, gateStep, pickInput, deviceLabel, permissionHelp } from '/js/audiocfg.js';

const KEY = 'rw-audio';
const listeners = new Set();

export function loadAudio() {
  try { return normalize(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return normalize(memory || {}); }
}
export function saveAudio(patch) {
  const next = normalize({ ...loadAudio(), ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private window: settings last until reload */ memory = next; }
  listeners.forEach((fn) => { try { fn(next); } catch { /* ignore */ } });
  proc?.update(next);
  return next;
}
let memory = null;
export const callMode = () => loadAudio().mode;
export function onAudioChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ---------- the processor: high pass, quiet-room gate and mic volume, between the mic and the call ----------
class RwProcessor {
  constructor() { this.cfg = loadAudio(); this.ctx = null; this.timer = null; this.nodes = null; }
  update(cfg) {
    this.cfg = normalize(cfg);
    const n = this.nodes; if (!n) return;
    const p = plan(this.cfg);
    n.hp.frequency.value = p.hp || 10;
    n.gain.gain.setTargetAtTime(p.gain, this.ctx.currentTime, 0.02);
  }
  async createProcessedStream(stream) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return stream;
    const ctx = new Ctx();
    // iPhone and iPad keep an AudioContext asleep until it is resumed. If it will not wake, send the plain mic rather than silence.
    try { await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 700))]); } catch { /* checked below */ }
    if (ctx.state !== 'running') { ctx.close().catch(() => {}); return stream; }
    const src = ctx.createMediaStreamSource(stream);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.Q.value = 0.7;
    const gate = ctx.createGain();
    const gain = ctx.createGain();
    const an = ctx.createAnalyser(); an.fftSize = 512;
    const dest = ctx.createMediaStreamDestination();
    src.connect(hp); hp.connect(an); hp.connect(gate); gate.connect(gain); gain.connect(dest);
    this.ctx = ctx; this.nodes = { hp, gate, gain, an, src, dest };
    this.update(this.cfg);
    const buf = new Float32Array(an.fftSize);
    let state = { open: true, quiet: 0 };
    let last = performance.now();
    this.timer = setInterval(() => {
      const t = performance.now(); const dt = t - last; last = t;
      const p = plan(this.cfg);
      const thr = gateThreshold(p.gate);
      if (!thr) { if (!state.open) { state = { open: true, quiet: 0 }; gate.gain.setTargetAtTime(1, ctx.currentTime, 0.015); } else gate.gain.value = 1; return; }
      an.getFloatTimeDomainData(buf);
      let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      state = gateStep(state, Math.sqrt(s / buf.length), thr, dt);
      gate.gain.setTargetAtTime(state.open ? 1 : 0.04, ctx.currentTime, state.open ? 0.01 : 0.06);
    }, 25);
    return dest.stream;
  }
  async destroyProcessedStream(processed) {
    clearInterval(this.timer); this.timer = null;
    try { processed?.getTracks?.().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { await this.ctx?.close(); } catch { /* ignore */ }
    this.ctx = null; this.nodes = null;
  }
}
let proc = null;
let procOn = false;

// ---------- Twilio device ----------
// Called right before a call is placed or answered, inside the tap that started it (iPhone only allows audio set up from a tap).
export async function prepareAudio(device) {
  const cfg = loadAudio();
  const a = device?.audio;
  if (!a) return cfg;
  try { a.setAudioConstraints(constraintsFor({ ...cfg, mic: '' })); } catch { /* older SDK */ }
  const p = plan(cfg);
  try {
    if (p.processor && !procOn) { proc ||= new RwProcessor(); await a.addProcessor(proc); procOn = true; }
    else if (!p.processor && procOn && proc) { await a.removeProcessor(proc); procOn = false; }
  } catch { procOn = false; }
  proc?.update(cfg);
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
    } catch (e) { if (cfg.mic) toast('Could not use that microphone. Using the default one.', true); try { await a.unsetInputDevice(); } catch { /* ignore */ } usedInput = false; }
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
    document.dispatchEvent(new CustomEvent('rw-audio-devices'));
  });
}

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
export function audioPanel({ device = null } = {}) {
  let stopMeter = () => {};
  const { el, close } = modal(`<div class="aud"><div class="aud-head"><h2>Phone audio</h2><button type="button" class="btn btn-ghost btn-sm" data-close>Done</button></div><div id="audbody"><div class="skeleton" style="height:240px"></div></div></div>`, { onClose: () => stopMeter() });
  const paint = async () => {
    const cfg = loadAudio();
    let devs = [];
    try { devs = await navigator.mediaDevices.enumerateDevices(); } catch { /* none */ }
    const ins = devs.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications');
    const outs = devs.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'communications');
    const perm = await micPermission();
    const canOut = Boolean(device?.audio?.isOutputSelectionSupported ?? ('setSinkId' in HTMLMediaElement.prototype));
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    const p = plan(cfg);
    const gateShown = cfg.gate === -1 ? p.gate : cfg.gate;
    $('#audbody', el).innerHTML = `
      <section class="aud-sec"><h3>Microphone</h3>
        <select id="amic" aria-label="Microphone"><option value="">Default${ins[0]?.label ? ` (${esc(ins.find((d) => d.deviceId === 'default')?.label?.replace(/^Default - /, '') || ins[0].label)})` : ''}</option>
          ${ins.filter((d) => d.deviceId !== 'default').map((d, i) => `<option value="${esc(d.deviceId)}"${d.deviceId === cfg.mic ? ' selected' : ''}>${esc(deviceLabel(d, i))}</option>`).join('')}</select>
        <div class="aud-meter" aria-hidden="true"><i id="ameter"></i></div>
        <div class="row" style="gap:8px"><button type="button" class="btn btn-ghost btn-sm" id="atest">Test my mic</button><button type="button" class="btn btn-ghost btn-sm" id="aplay" hidden>Play back</button><span class="small muted" id="atesthint">Speak and watch the bar. Test records 4 seconds you can play back.</span></div>
        <label class="aud-row"><span>Mic volume <b id="agv">${cfg.gain}%</b></span><input type="range" id="again" min="20" max="300" step="5" value="${cfg.gain}"></label>
      </section>
      <section class="aud-sec"><h3>Background noise</h3>
        <div class="seg aud-seg" id="anoise">${Object.entries(NOISE).map(([k, v]) => `<button type="button" data-n="${k}" class="${k === cfg.noise ? 'is-on' : ''}">${esc(v.label)}</button>`).join('')}</div>
        <p class="small muted" id="anote">${esc(NOISE[cfg.noise].note)}</p>
        <label class="aud-row"><span>Cut quiet sound between words <b id="agtv">${gateShown ? gateShown : 'Off'}</b></span><input type="range" id="agate" min="0" max="10" step="1" value="${gateShown}"></label>
        <p class="small muted">Raise it if the other person still hears fans, a TV or people nearby. Lower it if your voice cuts in and out.</p>
        <div class="aud-checks"><label class="row small" style="gap:8px"><input type="checkbox" id="aecho"${cfg.echo ? ' checked' : ''}> Echo cancellation <span class="muted">(turn off with a headset that has its own)</span></label>
          <label class="row small" style="gap:8px"><input type="checkbox" id="aauto"${cfg.auto ? ' checked' : ''}> Auto level my voice</label></div>
      </section>
      <section class="aud-sec"><h3>Speaker</h3>
        ${canOut && !ios ? `<select id="aout" aria-label="Speaker"><option value="">Default</option>${outs.filter((d) => d.deviceId !== 'default').map((d, i) => `<option value="${esc(d.deviceId)}"${d.deviceId === cfg.out ? ' selected' : ''}>${esc(deviceLabel(d, i))}</option>`).join('')}</select>`
          : `<p class="small muted">${ios ? 'On iPhone and iPad the sound plays through whatever you pick in Control Center (swipe down, press the audio card) or the Bluetooth device you connected. Safari does not let a page choose it.' : 'This browser plays through the system speaker. Change it in your computer\'s sound settings.'}</p>`}
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
      <div class="row" style="justify-content:space-between;margin-top:6px"><button type="button" class="linkbtn" id="areset">Reset to default</button><span class="small muted">Saved on this device</span></div>`;
    wire(cfg);
    if (cfg.mode === 'phone') api('/api/me').then((m) => { const i = $('#aphone', el); if (i && m.user?.phone) i.value = m.user.phone; }).catch(() => {});
  };

  const set = (patch) => { const n = saveAudio(patch); return n; };
  const wire = (cfg0) => {
    const root = $('#audbody', el);
    $('#amic', root).addEventListener('change', async (e) => { set({ mic: e.target.value }); if (device?.audio && e.target.value) { try { await device.audio.setInputDevice(e.target.value); } catch { toast('Could not use that microphone.', true); } } startMeter(); });
    $('#aout', root)?.addEventListener('change', async (e) => { set({ out: e.target.value }); try { if (device?.audio?.isOutputSelectionSupported) { await device.audio.speakerDevices.set(e.target.value ? [e.target.value] : []); await device.audio.ringtoneDevices.set(e.target.value ? [e.target.value] : []); } } catch { toast('Could not switch the speaker.', true); } });
    $('#again', root).addEventListener('input', (e) => { $('#agv', root).textContent = `${e.target.value}%`; set({ gain: Number(e.target.value) }); });
    $('#agate', root).addEventListener('input', (e) => { const v = Number(e.target.value); $('#agtv', root).textContent = v || 'Off'; set({ gate: v }); });
    $$('#anoise [data-n]', root).forEach((b) => b.addEventListener('click', () => {
      set({ noise: b.dataset.n, gate: -1 });
      $$('#anoise button', root).forEach((x) => x.classList.toggle('is-on', x === b));
      $('#anote', root).textContent = NOISE[b.dataset.n].note;
      const g = plan(loadAudio()).gate; $('#agate', root).value = g; $('#agtv', root).textContent = g || 'Off';
      startMeter();
    }));
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
    $('#aphonesave', root).addEventListener('click', async (e) => { try { const r = await api('/api/me/phone', { method: 'PUT', body: { phone: $('#aphone', root).value } }); toast(r.phone ? `Saved. The Hub will ring ${r.phone}.` : 'Number removed.'); } catch (err) { toast(err.message, true); } });
    $('#areset', root).addEventListener('click', () => { saveAudio({ mic: '', out: '', gain: 100, noise: 'light', gate: -1, echo: true, auto: true, wake: true }); paint(); });
    $('#aallow', root).addEventListener('click', async () => { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); toast('Microphone allowed.'); } catch { toast('The browser blocked the microphone. Follow the steps below to allow it.', true); } paint(); });
    $('#atest', root).addEventListener('click', () => record(root));
    startMeter();
  };

  // Live level bar through the same cleanup a call would use.
  const startMeter = async () => {
    stopMeter(); stopMeter = () => {};
    const bar = $('#ameter', el); if (!bar) return;
    const cfg = loadAudio();
    let stream, ctx;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: constraintsFor(cfg) });
      const Ctx = window.AudioContext || window.webkitAudioContext;
      ctx = new Ctx(); await ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      const g = ctx.createGain(); const an = ctx.createAnalyser(); an.fftSize = 512;
      src.connect(g); g.connect(an);
      const buf = new Float32Array(an.fftSize);
      const t = setInterval(() => {
        g.gain.value = loadAudio().gain / 100;
        an.getFloatTimeDomainData(buf);
        let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
        const rms = Math.sqrt(s / buf.length);
        const gate = gateThreshold(plan(loadAudio()).gate);
        bar.style.width = `${Math.min(100, Math.round(rms * 400))}%`;
        bar.classList.toggle('cut', Boolean(gate) && rms < gate);
      }, 60);
      stopMeter = () => { clearInterval(t); stream.getTracks().forEach((x) => x.stop()); ctx.close().catch(() => {}); bar.style.width = '0'; };
    } catch { const h = $('#atesthint', el); if (h) h.textContent = 'The microphone is blocked or not found. Use Allow microphone below.'; }
  };

  const record = async (root) => {
    if (!window.MediaRecorder) return toast('This browser cannot record a test. Watch the level bar instead.');
    stopMeter(); stopMeter = () => {};
    const btn = $('#atest', root), hint = $('#atesthint', root), play = $('#aplay', root);
    btn.disabled = true; play.hidden = true;
    try {
      const cfg = loadAudio();
      const raw = await navigator.mediaDevices.getUserMedia({ audio: constraintsFor(cfg) });
      let stream = raw, p = null;
      if (plan(cfg).processor) { p = new RwProcessor(); stream = await p.createProcessedStream(raw); }
      const rec = new MediaRecorder(stream); const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      hint.textContent = 'Recording... say a sentence.';
      rec.start();
      await new Promise((r) => setTimeout(r, 4000));
      await new Promise((r) => { rec.onstop = r; rec.stop(); });
      raw.getTracks().forEach((t) => t.stop()); await p?.destroyProcessedStream(stream);
      const url = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || 'audio/mp4' }));
      play.hidden = false; hint.textContent = 'Tap Play back to hear what the other person hears.';
      play.onclick = async () => { const a = new Audio(url); const out = loadAudio().out; try { if (out && a.setSinkId) await a.setSinkId(out); } catch { /* default speaker */ } a.play().catch(() => toast('Tap again to play.')); };
    } catch { hint.textContent = 'Could not record. Allow the microphone below and try again.'; }
    btn.disabled = false; startMeter();
  };

  document.addEventListener('rw-audio-devices', function again() { if (!document.body.contains(el)) { document.removeEventListener('rw-audio-devices', again); return; } paint(); });
  paint();
  return { close };
}

// Any element with data-audio opens the panel (the dialer tab bar has one). The phone tells us which device is live.
let getDev = () => null;
export const setDeviceGetter = (fn) => { getDev = fn; };
document.addEventListener('click', (e) => { if (e.target.closest?.('[data-audio]')) audioPanel({ device: getDev() }); });
