// Auto set up card in Phone audio (Nov 2026, V: Kiron's mic picks up the room and a second phone's speaker; "auto fill the settings from the
// background noise and requirements, test it against his voice and dead silence"). Modeled on the room tone calibration in Krisp, NVIDIA
// Broadcast and Zoom's mic test. The maths is in public/js/autofit.js (pure, tested against a fan, a second voice and dead silence).
// Flow: 5 seconds of quiet (everything that normally leaks in stays on), 7 seconds of the person's voice, then the real cleanup engine is
// run offline over those two recordings with about 18 settings and the best one is saved. Undo and Hear before / after are on the result.
import { $, esc, toast } from './core.js';
import { openMic, micProblem, loadAudio, saveAudio, captureStart, recordBeep, isApple, micInUse, audioEnv } from './audioset.js';
import { personalPart } from '/js/audiocfg.js';
import { fit, describe, wavFrom, SILENCE_SECS, VOICE_SECS } from '/js/autofit.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let last = null;            // the last result, kept so the card comes back after the panel redraws
let before = null;          // settings before the auto set up, for Undo
let playing = null;

function play(f32, sr, btn) {
  try { playing?.pause(); } catch { /* ignore */ }
  const url = URL.createObjectURL(new Blob([wavFrom(f32, sr)], { type: 'audio/wav' }));
  const a = new Audio(url); playing = a;
  const out = loadAudio().out;
  (async () => { try { if (out && a.setSinkId) await a.setSinkId(out); } catch { /* default speaker */ } a.play().catch(() => toast('Tap again to play.')); })();
  a.onended = () => { URL.revokeObjectURL(url); if (btn) btn.textContent = btn.dataset.t; };
  if (btn) { btn.dataset.t ||= btn.textContent; btn.textContent = 'Playing...'; }
}

const dbText = (x) => (x >= 90 ? 'silent' : x <= 0 ? 'as loud as or louder than your voice' : `${Math.round(x)} dB under your voice`);

function resultHtml(r) {
  const a = r.after, b = r.before, an = r.analysis;
  const quiet = an.noiseRms < 1e-4;
  const rows = [
    ['Background', quiet ? 'Your room is already dead quiet. Nothing to remove.' : `The loudest background was ${dbText(b.separation)}. Now it is ${dbText(a.separation)}.`],
    ['Your voice', `${a.keptPct}% of your speech kept, level change ${a.voiceDb >= 0 ? '+' : ''}${a.voiceDb.toFixed(1)} dB.`],
    ['Tested', `${r.tested} settings against this recording.`],
  ];
  return `<div class="aud-ok"><b>Done. Set to: ${esc(describe(r))}.</b></div>
    <dl class="aud-diag">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${r.warnings.map((w) => `<p class="small aud-warn">${esc(w)}</p>`).join('')}
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px">
      <button type="button" class="btn btn-ghost btn-sm" id="afhb">Hear before</button>
      <button type="button" class="btn btn-ghost btn-sm" id="afha">Hear after</button>
      <button type="button" class="btn btn-ghost btn-sm" id="afundo">Undo</button>
      <button type="button" class="btn btn-primary btn-sm" id="afrun">Run it again</button>
    </div>
    <p class="small muted" style="margin:8px 0 0">Saved for you. The first 5 seconds of the recording are the quiet room, the next 7 are your voice. Run it again if you change headset, mic or room.</p>`;
}

export function mountAutoFit(host, { live = false, repaint = () => {} } = {}) {
  if (!host) return;
  const intro = '<b>Auto set up</b> <span class="muted small">(about 25 seconds)</span><p class="small muted" style="margin:4px 0 8px">Listens to your room for 5 seconds of quiet, then your voice for 7 seconds. It tests about 18 setups against that recording and fills in the cleanup, quiet gate, mic volume and My voice only for you.</p>';
  if (isApple()) { host.innerHTML = `${intro}<p class="small aud-warn-soft">Not on iPad and iPhone: calls there use the browser's own cleanup. Use Control Center, Mic Mode, Voice Isolation.</p>`; return; }
  const idle = () => {
    host.innerHTML = last
      ? `<b>Auto set up</b>${resultHtml(last)}`
      : `${intro}<div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-primary btn-sm" id="afrun"${live ? ' disabled' : ''}>Auto set up</button>${live ? '<span class="small muted">Not during a call.</span>' : ''}</div>`;
    $('#afrun', host)?.addEventListener('click', run);
    $('#afhb', host)?.addEventListener('click', (e) => { const both = new Float32Array(last.sil.length + last.voi.length); both.set(last.sil); both.set(last.voi, last.sil.length); play(both, last.analysis.sr, e.currentTarget); });
    $('#afha', host)?.addEventListener('click', (e) => { const both = new Float32Array(last.silOut.length + last.voiOut.length); both.set(last.silOut); both.set(last.voiOut, last.silOut.length); play(both, last.analysis.sr, e.currentTarget); });
    $('#afundo', host)?.addEventListener('click', () => { if (before) saveAudio(before); last = null; toast('Back to your old settings.'); repaint(); });
  };
  const say = (title, line, big = '') => { host.innerHTML = `<b>Auto set up</b><p class="aud-fit-step" style="margin:6px 0 2px"><b>${esc(title)}</b></p><p class="small" style="margin:0 0 4px">${line}</p><div class="aud-fit-big" aria-live="polite">${big}</div>`; };
  const count = async (secs, label) => { for (let i = secs; i > 0; i--) { const n = $('.aud-fit-big', host); if (n) n.textContent = `${label} ${i}`; await wait(1000); } };

  async function run() {
    const cfg = loadAudio();
    const rec = { ...cfg, noise: 'light', ns: 'on', auto: false, lock: false, headset: false, gain: 100 };   // the mic the way a call gets it
    let stream = null, cap = null;
    try {
      say('Getting the mic ready', 'Allow the microphone if the browser asks.');
      stream = (await openMic(rec)).stream;
      const label = micInUse() || stream.getAudioTracks()[0]?.label || 'your microphone';
      cap = await captureStart(stream);
      await wait(400);

      say('Step 1 of 2: dead silence', `Stay quiet. Leave on whatever normally leaks in: fans, the TV, the other phone's speaker. Mic: ${esc(label)}.`, '');
      await wait(1200);
      await recordBeep('start'); await wait(250);
      const s0 = cap.mark();
      await count(SILENCE_SECS, 'Quiet...');
      const s1 = cap.mark();
      recordBeep('stop');
      await wait(900);

      say('Step 2 of 2: your voice', 'Read this out loud at your normal call volume, again and again until the beep: <i>"Hi, this is [your name] with Rightway Growth, do you have a quick minute?"</i>', '');
      await wait(2800);
      await recordBeep('start'); await wait(250);
      const v0 = cap.mark();
      await count(VOICE_SECS, 'Talking...');
      const v1 = cap.mark();
      recordBeep('stop');
      const sil = cap.slice(s0, s1), voi = cap.slice(v0, v1), sr = cap.sr;
      cap.stop(); cap = null;
      stream.getTracks().forEach((t) => t.stop()); stream = null;

      say('Testing settings', 'Running the real cleanup over your two recordings, one setup at a time.', '');
      const src = await (await fetch('/js/denoise-worklet.js')).text();
      const r = await fit({
        src, sil, voi, sr, cfg, env: audioEnv(),
        onStep: async (i, n) => { const b = $('.aud-fit-big', host); if (b) b.textContent = `${i} of ${n}`; await wait(0); },
      });
      if (!r.ok) {
        host.innerHTML = `<b>Auto set up</b><p class="small aud-warn">${esc(r.text || 'It could not finish.')}</p><div class="row"><button type="button" class="btn btn-primary btn-sm" id="afrun">Try again</button></div>`;
        $('#afrun', host).addEventListener('click', run);
        return;
      }
      before = personalPart(loadAudio());
      saveAudio(r.patch);
      last = r;
      toast('Mic settings filled in.');
      idle();            // show the result here even if the panel does not redraw
      repaint();
    } catch (e) {
      try { cap?.stop(); stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
      host.innerHTML = `<b>Auto set up</b><p class="small aud-warn">${esc(/NotAllowed|Security|NotFound|NotReadable|Overconstrained/.test(e?.name || '') ? micProblem(e) : (e?.message || 'It could not finish.'))}</p><div class="row"><button type="button" class="btn btn-primary btn-sm" id="afrun">Try again</button></div>`;
      $('#afrun', host).addEventListener('click', run);
    }
  }
  idle();
}
