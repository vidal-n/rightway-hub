// Browser phone: calls go out and come in through the computer's mic and speakers (Twilio Voice JS SDK, vendored in /vendor).
// One Device per tab, created after login. A call bar floats over every page while a call is live.
import { api, esc, toast, makeDraggable } from './core.js';
import { prepareAudio, releaseAudio, watchDevices, awakeDuringCall, callMode, audioPanel, setDeviceGetter, warmAudio } from './audioset.js';

const SDK = '/vendor/twilio-voice-2.18.5.min.js';
const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const picon = {
  phone: P('<path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.8.7a2 2 0 011.8 2z"/>'),
  hang: P('<path d="M3.7 14.3l2.1-1.5a1.8 1.8 0 00.7-1.9l-.4-1.5a14 14 0 0111.8 0l-.4 1.5a1.8 1.8 0 00.7 1.9l2.1 1.5a1.8 1.8 0 002.4-.3l.6-.7a1.8 1.8 0 000-2.4C19.9 7.7 16.1 6 12 6s-7.9 1.7-11.3 4.9a1.8 1.8 0 000 2.4l.6.7a1.8 1.8 0 002.4.3z"/>'),
  mic: P('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0014 0M12 19v3"/>'),
  micOff: P('<path d="M2 2l20 20M9 9v1a3 3 0 005.1 2.1M15 9.3V5a3 3 0 00-5.9-.7"/><path d="M17 16.9A7 7 0 015 10M19 10a7 7 0 01-.1 1.2M12 19v3"/>'),
  pad: P('<circle cx="6" cy="5" r="1.3"/><circle cx="12" cy="5" r="1.3"/><circle cx="18" cy="5" r="1.3"/><circle cx="6" cy="11" r="1.3"/><circle cx="12" cy="11" r="1.3"/><circle cx="18" cy="11" r="1.3"/><circle cx="6" cy="17" r="1.3"/><circle cx="12" cy="17" r="1.3"/><circle cx="18" cy="17" r="1.3"/><circle cx="12" cy="22" r="1.3"/>'),
  ear: P('<path d="M6 8.5a6 6 0 1112 0c0 2.5-1.5 3.5-2.5 4.5S14 15 14 17a3 3 0 01-6 0"/><path d="M9 9a3 3 0 016 0"/>'),
  whisper: P('<path d="M21 12a8 8 0 01-11.8 7L4 20l1.1-4.4A8 8 0 1121 12z"/><path d="M9 11h6M9 14h3"/>'),
  barge: P('<path d="M3 11l18-8-8 18-2-8-8-2z"/>'),
  back: P('<path d="M21 5H9l-7 7 7 7h12a1 1 0 001-1V6a1 1 0 00-1-1z"/><path d="M17 9l-6 6M11 9l6 6"/>'),
};

export const pretty = (n) => { const d = String(n || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(n || ''); };
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// ---------- device ----------
const st = { status: 'off', reason: '', device: null, call: null, monAct: '' };
const listeners = new Set();
export const phoneState = () => ({ status: st.status, reason: st.reason, onCall: Boolean(st.call), monitoring: st.call ? st.monAct : '' });
export const phoneDevice = () => st.device;
setDeviceGetter(phoneDevice);
export function onPhoneState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => listeners.forEach((fn) => { try { fn(phoneState()); } catch { /* ignore */ } });
const setStatus = (status, reason = '') => { st.status = status; st.reason = reason; emit(); };

function loadSdk() {
  if (window.Twilio?.Device) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = SDK; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error('Could not load the phone. Check your connection and reload.'));
    document.head.appendChild(s);
  });
}

let starting = null;
export function startPhone() {
  if (st.device) return Promise.resolve(st.device);
  starting ||= (async () => {
    setStatus('loading');
    const t = await api('/api/voice/token');
    if (!t.ready) throw new Error(t.reason);
    await loadSdk();
    const d = new window.Twilio.Device(t.token, { codecPreferences: ['opus', 'pcmu'], closeProtection: 'You are on a call. Leave anyway?', logLevel: 'warn' });
    d.audio?.outgoing(false);
    d.on('tokenWillExpire', async () => { try { const n = await api('/api/voice/token'); if (n.ready) d.updateToken(n.token); } catch { /* retried on next expiry warning */ } });
    d.on('incoming', onIncoming);
    d.on('registered', () => setStatus('ready'));
    d.on('unregistered', () => { if (st.status === 'ready') setStatus('loading'); });
    d.on('error', (e) => { if (!st.call && /token/i.test(e?.message || '')) setStatus('error', 'The phone lost its sign in. Reload the page.'); });
    st.device = d;
    watchDevices(d);
    try { await d.register(); } catch { /* outgoing still works without registration */ }
    if (st.status !== 'ready') setStatus('ready');
    return d;
  })().catch((e) => { setStatus('error', e.message); throw e; }).finally(() => { starting = null; });
  return starting;
}

// ---------- ringback (only if the carrier sends no ringing sound of its own) ----------
let ring = null;
function ringback(on) {
  if (!on) { if (ring) { ring.stop(); ring = null; } return; }
  if (ring) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(ctx.destination);
    const oscs = [440, 480].map((f) => { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(gain); o.start(); return o; });
    let t = ctx.currentTime;
    const sched = () => { for (let i = 0; i < 10; i++) { gain.gain.setValueAtTime(0.08, t); gain.gain.setValueAtTime(0, t + 2); t += 6; } };
    sched();
    const timer = setInterval(sched, 55e3);
    ring = { stop: () => { clearInterval(timer); oscs.forEach((o) => { try { o.stop(); } catch { /* ignore */ } }); ctx.close().catch(() => {}); } };
  } catch { ring = null; }
}

// ---------- contact card (call window and power dial window) ----------
// Person first, business under it, then the facts a rep wants while talking: phone and their local time, the email the scrub found, phone type, place.
export const initialsOf = (t) => String(t || '').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '#';
export function contactRows(rows = []) {
  const list = rows.filter((r) => r && r.v);
  if (!list.length) return '';
  return `<div class="cb-info">${list.map((r) => `<div class="cb-row"><i>${esc(r.k)}</i><span>${r.href ? `<a href="${esc(r.href)}"${/^https?:/.test(r.href) ? ' target="_blank" rel="noopener"' : ''}>${esc(r.v)}</a>` : esc(r.v)}${r.tag ? `<em class="tag ${esc(r.tone || '')}">${esc(r.tag)}</em>` : ''}${r.copy ? `<button type="button" class="cb-copy" data-copy="${esc(r.copy)}" aria-label="Copy ${esc(r.k)}">Copy</button>` : ''}</span></div>`).join('')}</div>`;
}

// ---------- call bar ----------
let bar = null;
let tick = null;
function ensureBar() {
  if (bar && document.body.contains(bar)) return bar;
  bar = document.createElement('div');
  bar.className = 'callbar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Phone call');
  document.body.appendChild(bar);
  // Drag the call window by its top (the name area); it remembers where you left it. On a phone it stays docked.
  makeDraggable(bar, { grab: (e) => Boolean(e.target.closest('.cb-top, .cb-grip')), key: 'callbar', off: () => innerWidth <= 900 });
  bar.addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) navigator.clipboard?.writeText(c.dataset.copy).then(() => toast('Copied'));
  });
  return bar;
}
function hideBar(delay = 0) {
  setTimeout(() => { if (!st.call && bar) { bar.classList.add('out'); setTimeout(() => { if (!st.call) { bar?.remove(); bar = null; } }, 250); } }, delay);
}

// What the rep types and taps during a call survives the window redrawing and is read when the result popup opens.
let draft = { note: '', when: '' };
export const takeCallDraft = () => { const d = draft; draft = { note: '', when: '' }; return d; };
function syncTools(b, view) {
  let t = b.querySelector(':scope > .cb-tools');
  if (!view.tools) { t?.remove(); return; }
  if (t) return;
  const tl = view.tools;
  t = document.createElement('div');
  t.className = 'cb-tools';
  t.innerHTML = `<textarea class="cb-notein" rows="3" placeholder="Notes while you talk. They fill in the result box when you hang up." aria-label="Call notes"></textarea>
    ${tl.chips?.length ? `<div class="cb-sub">If they say call back</div><div class="cb-chips">${tl.chips.map(([n, v], i) => `<button type="button" class="cb-chip" data-chip="${i}" data-v="${esc(v)}">${esc(n)}</button>`).join('')}</div>` : ''}
    ${tl.actions?.length ? `<div class="cb-quick">${tl.actions.map(([n], i) => `<button type="button" class="cb-q" data-q="${i}">${esc(n)}</button>`).join('')}</div>` : ''}`;
  const note = t.querySelector('.cb-notein');
  note.value = draft.note;
  note.addEventListener('input', () => { draft.note = note.value; });
  t.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-chip]');
    if (chip) { const on = !chip.classList.contains('on'); t.querySelectorAll('.cb-chip').forEach((c) => c.classList.remove('on')); chip.classList.toggle('on', on); draft.when = on ? chip.dataset.v : ''; return; }
    const q = e.target.closest('[data-q]');
    if (q) tl.actions[Number(q.dataset.q)]?.[1]?.();
  });
  b.appendChild(t);
}
function renderBar(view) {
  const b = ensureBar();
  b.classList.remove('out');
  b.dataset.state = view.state;
  let main = b.querySelector(':scope > .cb-main');
  if (!main) { b.querySelectorAll(':scope > :not(.cb-tools)').forEach((n) => n.remove()); main = document.createElement('div'); main.className = 'cb-main'; b.prepend(main); }
  const live = view.state === 'live';
  const person = view.who?.known ? view.who.name : '';
  const longLabel = String(view.label || '').length > 14; // long messages go on their own line so the name is never squeezed out
  main.innerHTML = `
    <div class="cb-top">
      <div class="cb-av${view.state === 'ringing' || view.state === 'incoming' || view.state === 'dialing' ? ' pulse' : ''}">${person || view.name ? esc(initialsOf(person || view.name)) : picon.phone}</div>
      <div class="cb-who"><b>${esc(person || view.name || pretty(view.number))}</b>${person ? `<em class="cb-p">${esc(view.name || '')}${view.who.role ? ` <u>${esc(view.who.role)}</u>` : ''}</em>` : view.who ? `<em class="cb-p">${esc(view.who.line)}</em>` : ''}<span>${esc(view.name ? pretty(view.number) : '')}${view.from ? `${view.name ? ' · ' : ''}${view.incoming ? 'to' : 'from'} ${esc(pretty(view.from))}` : ''}</span></div>
      <div class="cb-status" aria-live="polite">${longLabel ? '' : esc(view.label)}</div>
    </div>
    ${longLabel ? `<div class="cb-note" aria-live="polite">${esc(view.label)}</div>` : ''}
    ${contactRows(view.info)}
    ${view.cat ? `<div class="cb-cat"><i class="cc cc-${esc(view.cat.id)}">${esc(view.cat.label)}</i><span>${esc(view.cat.lead)}</span></div>` : ''}
    ${view.recording && view.state !== 'ended' ? '<div class="cb-rec"><i></i>Recording</div>' : ''}
    ${live ? '<div class="cb-level" aria-hidden="true"><i></i></div>' : ''}
    ${live && view.pad ? `<div class="cb-pad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((k) => `<button type="button" data-dtmf="${k}">${k}</button>`).join('')}</div>` : ''}
    ${view.kind === 'monitor' && live ? `<div class="cb-modes">${[['listen', 'Listen', picon.ear], ['whisper', 'Whisper', picon.whisper], ['barge', 'Barge', picon.barge]].map(([m, n, ic]) => `<button type="button" class="cb-btn${view.mode === m ? ' on' : ''}" data-mode="${m}" aria-pressed="${view.mode === m}">${ic}<span>${n}</span></button>`).join('')}</div>
      <p class="cb-hint">${view.mode === 'listen' ? 'Nobody can hear you.' : view.mode === 'whisper' ? 'Only your rep hears you.' : 'Everyone on the call hears you.'}</p>` : ''}
    <div class="cb-actions">
      ${view.state === 'incoming' ? `<button type="button" class="cb-btn cb-decline" data-act="decline">${picon.hang}<span>Decline</span></button><button type="button" class="cb-btn cb-accept" data-act="accept">${picon.phone}<span>Answer</span></button>` : ''}
      ${live && view.kind !== 'monitor' ? `<button type="button" class="cb-btn${view.muted ? ' on' : ''}" data-act="mute" aria-pressed="${view.muted}">${view.muted ? picon.micOff : picon.mic}<span>${view.muted ? 'Unmute' : 'Mute'}</span></button>
        <button type="button" class="cb-btn${view.pad ? ' on' : ''}" data-act="pad" aria-pressed="${Boolean(view.pad)}">${picon.pad}<span>Keypad</span></button>` : ''}
      ${['dialing', 'ringing', 'live', 'incoming'].includes(view.state) && view.kind !== 'bridge' ? `<button type="button" class="cb-btn" data-act="audio" title="Mic, speaker and noise">${picon.mic}<span>Audio</span></button>` : ''}
      ${['dialing', 'ringing', 'live'].includes(view.state) ? `<button type="button" class="cb-btn cb-hang" data-act="hang">${picon.hang}<span>${view.kind === 'monitor' ? 'Leave' : view.kind === 'bridge' ? 'Done' : 'Hang up'}</span></button>` : ''}
    </div>`;
  syncTools(b, view);
}

const END_LABEL = { 'no-answer': 'No answer', busy: 'Busy', failed: 'Call failed', canceled: 'Call canceled' };
const MODE_LABEL = { listen: 'Listening', whisper: 'Whispering', barge: 'On the call' };

function track(call, view, { onEnd, act } = {}) {
  st.call = call;
  awakeDuringCall(true);
  emit();
  let started = 0;
  let answered = false;
  let endLabel = '';
  let poll = null;
  const draw = () => renderBar(view);
  const set = (patch) => { Object.assign(view, patch); draw(); };
  const end = (label) => {
    clearInterval(tick); tick = null; clearInterval(poll); poll = null;
    ringback(false);
    if (st.call !== call) return;
    st.call = null;
    awakeDuringCall(false);
    releaseAudio(st.device);
    emit();
    const secs = answered ? Math.round((Date.now() - started) / 1000) : 0;
    set({ state: 'ended', label: label || endLabel || (answered ? `Call ended ${clock(secs)}` : 'No answer') });
    hideBar(2200);
    onEnd?.({ answered, seconds: secs });
  };
  draw();
  call.on('ringing', (hasEarlyMedia) => { if (!answered) { set({ state: 'ringing', label: 'Ringing...' }); if (!hasEarlyMedia) ringback(true); } });
  const goLive = () => {
    answered = true; started = Date.now(); ringback(false);
    set({ state: 'live', label: '0:00' });
    clearInterval(tick);
    tick = setInterval(() => { const el = bar?.querySelector('.cb-status'); if (el && view.state === 'live') { view.label = clock(Math.round((Date.now() - started) / 1000)); el.textContent = view.label; } }, 1000);
  };
  call.on('accept', () => {
    if (view.kind === 'monitor') { answered = true; started = Date.now(); set({ state: 'live', label: MODE_LABEL[view.mode] || 'Listening' }); return; }
    if (view.kind !== 'out' || !act) return goLive();
    // Outbound runs in a conference: the rep is in the room now, the server reports when the other side rings and answers.
    set({ state: 'ringing', label: 'Ringing...' });
    let busyPoll = false;
    const polled0 = Date.now();
    let stuckShown = false;
    poll = setInterval(async () => {
      if (busyPoll || st.call !== call) return;
      busyPoll = true;
      try {
        const r = await api(`/api/voice/calls/${act}`);
        if (r.status === 'in-progress' && !answered) goLive();
        if (END_LABEL[r.status]) { endLabel = END_LABEL[r.status]; clearInterval(poll); poll = null; if (r.error) toast(r.error, true); }
        // The Hub never started the outside call: say so instead of sitting on "Ringing..."
        if (r.status === 'connecting' && Date.now() - polled0 > 12000 && !stuckShown) { stuckShown = true; toast('The Hub could not start the outside call. Hang up and try again. If it keeps happening, tell V.', true); }
      } catch { /* keep trying */ } finally { busyPoll = false; }
    }, 1000);
  });
  call.on('volume', (input) => { const el = bar?.querySelector('.cb-level i'); if (el) el.style.width = `${Math.min(100, Math.round(input * 220))}%`; });
  call.on('mute', (m) => set({ muted: m }));
  call.on('disconnect', () => end());
  call.on('cancel', () => end(view.incoming ? 'Missed call' : 'Call canceled'));
  call.on('reject', () => end('Declined'));
  call.on('error', (e) => {
    const code = e?.code;
    const msg = code === 31401 || code === 31208 ? 'The microphone is blocked. Open Audio (on the call bar or the dialer) for the steps to allow it, then call again.'
      : code === 31402 ? 'No microphone found. Plug in a headset or mic and try again.'
      : `Call problem: ${e?.message || 'unknown error'}`;
    toast(msg, true);
    if (st.call === call && !answered) end('Call failed');
  });
  ensureBar().onclick = (ev) => {
    const btn = ev.target.closest('button');
    if (!btn || st.call !== call) return;
    if (btn.dataset.dtmf) { call.sendDigits(btn.dataset.dtmf); return; }
    if (btn.dataset.mode && btn.dataset.mode !== view.mode) {
      const mode = btn.dataset.mode;
      api(`/api/voice/monitor/${act}`, { method: 'POST', body: { mode } }).then(() => set({ mode, label: MODE_LABEL[mode] })).catch((e) => toast(e.message, true));
      return;
    }
    const action = btn.dataset.act;
    if (action === 'audio') { audioPanel({ device: st.device }); return; }
    if (action === 'hang') call.disconnect();
    if (action === 'mute') call.mute(!call.isMuted());
    if (action === 'pad') set({ pad: !view.pad });
    if (action === 'accept') { warmAudio(); set({ state: 'dialing', label: 'Connecting...', incoming: true }); prepareAudio(st.device).catch(() => {}).finally(() => call.accept()); }
    if (action === 'decline') { call.reject(); end('Declined'); }
  };
}

// Outgoing: checks the number on the server, then connects through the browser.
export async function placeCall({ to, leadId, from, name, who, cat, info, tools, onEnd } = {}) {
  if (st.call) throw new Error('You are already on a call. Hang up first.');
  warmAudio();   // before any await: iPhone and iPad only start audio inside the tap that began the call
  // "Use my phone": the Hub rings your mobile, then connects the lead. Works with the screen locked or in another app.
  if (callMode() === 'phone' && leadId && !to) return bridgeCall({ leadId, from, name, who, cat, info, onEnd });
  draft = { note: '', when: '' };
  document.querySelector('.callbar > .cb-tools')?.remove();
  const prep = await api('/api/voice/prepare', { method: 'POST', body: { to, leadId, from } });
  const d = await startPhone();
  const view = { state: 'dialing', label: 'Calling...', name: name || prep.name, who, cat, info, tools, number: prep.to, from: prep.from, kind: 'out', recording: Boolean(prep.recording) };
  renderBar(view);
  st.call = { pending: true };
  let call;
  try { await prepareAudio(d); call = await d.connect({ params: { act: prep.activityId } }); }
  catch (e) { st.call = null; releaseAudio(d); emit(); renderBar({ ...view, state: 'ended', label: 'Call failed' }); hideBar(2000); throw e; }
  track(call, view, { onEnd: (r) => onEnd?.({ ...r, activityId: prep.activityId, leadId: prep.leadId || leadId || null, to: prep.to, name: view.name }), act: prep.activityId });
  return call;
}

// The ring-my-mobile route: the Hub calls the rep's saved mobile, and when it is answered it dials the lead.
const BRIDGE_END = { completed: 1, 'no-answer': 1, busy: 1, failed: 1, canceled: 1, you_busy: 1, 'you_no-answer': 1, you_failed: 1, you_canceled: 1 };
async function bridgeCall({ leadId, from, name, who, cat, info, onEnd }) {
  const r = await api('/api/dialer/call', { method: 'POST', body: { leadId, from } });
  const id = r.activityId;
  const view = { state: 'ringing', label: 'Your phone is ringing. Answer it.', name: name || 'Lead', who, cat, info, number: '', from: '', kind: 'bridge' };
  renderBar(view);
  let poll = null, done = false;
  const call = { bridge: true, disconnect: () => finish('') };
  st.call = call;
  awakeDuringCall(true);
  emit();
  const finish = (label, res = {}) => {
    if (done) return; done = true;
    clearInterval(poll);
    if (st.call === call) { st.call = null; awakeDuringCall(false); emit(); }
    renderBar({ ...view, state: 'ended', label: label || (res.answered ? `Call ended ${clock(res.duration || 0)}` : 'Call finished') });
    hideBar(2200);
    onEnd?.({ answered: Boolean(res.answered), seconds: res.duration || 0, activityId: id, leadId, name: view.name });
  };
  const bar = ensureBar();
  bar.onclick = (ev) => { if (ev.target.closest('[data-act="hang"]')) finish(''); };
  poll = setInterval(async () => {
    try {
      const s = await api(`/api/voice/calls/${id}`);
      if (s.status === 'connecting') { view.label = 'Connected to your phone. Calling the lead...'; renderBar(view); }
      if (BRIDGE_END[s.status] || s.status?.startsWith('you_')) {
        const mine = s.status.startsWith('you_');
        finish(mine ? 'Your phone did not answer' : '', { answered: !mine && s.duration > 0, duration: s.duration });
      }
    } catch { /* keep trying */ }
  }, 1500);
  return call;
}

// Owner only: join a rep's live call to listen, whisper or barge. The server checks the role again.
export async function joinCall({ act, mode = 'listen', name, number, rep } = {}) {
  if (st.call) throw new Error('You are already on a call. Hang up first.');
  const d = await startPhone();
  const view = { state: 'dialing', label: 'Joining...', kind: 'monitor', mode, name: `${rep || 'Rep'} with ${name || pretty(number)}`, number: '', from: '' };
  renderBar(view);
  st.call = { pending: true };
  let call;
  try { if (mode !== 'listen') await prepareAudio(d); call = await d.connect({ params: { monitor: act, mode } }); }
  catch (e) { st.call = null; emit(); renderBar({ ...view, state: 'ended', label: 'Could not join' }); hideBar(2000); throw e; }
  st.monAct = act;
  const clear = () => { if (st.monAct === act) { st.monAct = ''; emit(); } };
  try { call.once('disconnect', clear); call.once('cancel', clear); call.once('error', clear); } catch { /* older SDK */ }
  track(call, view, { act, onEnd: clear });
  return call;
}

function onIncoming(call) {
  const cp = call.customParameters || new Map();
  const ctx = cp.get('context') || '';
  const view = { state: 'incoming', label: ctx || 'Incoming call', incoming: true, name: cp.get('who') || '', number: cp.get('caller') || call.parameters?.From || '', from: cp.get('called') || '' };
  track(call, view);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification(ctx ? `Call back: ${view.name || pretty(view.number)}` : 'Incoming call', { body: view.name ? `${view.name} · ${pretty(view.number)}` : pretty(view.number), tag: 'rw-call', requireInteraction: true }); } catch { /* ignore */ }
  }
}

// Called once after a staff login so incoming calls ring in the browser too.
export function initPhone() {
  if (st.device || starting) return;
  setTimeout(() => { startPhone().catch(() => {}); }, 800);
}

export function hangUp() { if (st.call?.disconnect) st.call.disconnect(); }
