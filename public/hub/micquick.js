// Test mic: the quick check you can run from the Phone tab on any device. Live level, a 4 second recording that plays back, and a speaker beep.
// The full noise and mic settings stay under "Mic and noise".
import { $, esc, modal } from './core.js';
import { openMic, micProblem, loadAudio, warmAudio } from './audioset.js';

export function testMic() {
  const m = modal(`<div class="card-head"><h2>Test your mic</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <p class="small muted" style="margin:0 0 10px">Say something. The bar should move when you talk. Then record 4 seconds and play it back to hear what the other person hears.</p>
    <div class="mq-meter" aria-hidden="true"><i id="mqbar"></i></div>
    <p class="small" id="mqstate" aria-live="polite" style="margin:8px 0 12px">Starting the mic...</p>
    <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn btn-primary" id="mqrec" disabled>Record 4 seconds</button><button class="btn btn-ghost" id="mqplay" hidden>Play it back</button><button class="btn btn-ghost" id="mqbeep">Test my speaker</button></div>
    <p class="small muted" id="mqhint" style="margin:10px 0 0"></p>
    <p class="small" style="margin:12px 0 0"><button type="button" class="linkbtn" data-audio>More mic and noise settings</button></p>`);
  const el = m.el;
  const state = $('#mqstate', el), bar = $('#mqbar', el), hint = $('#mqhint', el), rec = $('#mqrec', el), play = $('#mqplay', el);
  let stream = null, ctx = null, raf = 0, peak = 0, url = null, dead = false;
  const stop = () => { if (dead) return; dead = true; obs.disconnect(); cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); try { ctx?.close()?.catch(() => {}); } catch { /* ignore */ } if (url) URL.revokeObjectURL(url); };
  const cfgOut = () => loadAudio().out;
  const sink = async (a) => { const out = cfgOut(); try { if (out && a.setSinkId) await a.setSinkId(out); } catch { /* default speaker */ } };
  const obs = new MutationObserver(() => { if (!document.body.contains(el)) stop(); });
  obs.observe(document.body, { childList: true });
  (async () => {
    try {
      warmAudio();
      const r = await openMic({ ...loadAudio(), lock: false });
      stream = r.stream;
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      await ctx.resume().catch(() => {});
      const an = ctx.createAnalyser(); an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const label = stream.getAudioTracks()[0]?.label || 'your microphone';
      state.textContent = `Listening on ${label}. Say something.`;
      rec.disabled = false;
      const tick = () => {
        if (dead) return;
        an.getByteTimeDomainData(buf);
        let mx = 0; for (let i = 0; i < buf.length; i++) mx = Math.max(mx, Math.abs(buf[i] - 128) / 128);
        peak = Math.max(peak * 0.995, mx);
        bar.style.width = `${Math.min(100, Math.round(mx * 140))}%`;
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) { state.textContent = micProblem(e); state.classList.add('err-text'); }
  })();
  rec.onclick = () => {
    if (!stream || typeof MediaRecorder === 'undefined') { hint.textContent = 'This browser cannot record a test. The bar above still shows if the mic hears you.'; return; }
    rec.disabled = true; play.hidden = true; peak = 0;
    const chunks = [];
    const mr = new MediaRecorder(stream);
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(new Blob(chunks, { type: mr.mimeType || 'audio/mp4' }));
      play.hidden = false; rec.disabled = false; rec.textContent = 'Record again';
      hint.textContent = peak < 0.03 ? 'It heard almost nothing. Check the mic is not muted, move it closer, or pick another mic under More mic and noise settings.' : peak < 0.12 ? 'It works, but it is quiet. Speak closer or raise the mic volume under More mic and noise settings.' : 'Your mic works. Play it back to hear how you sound.';
    };
    mr.start();
    let n = 4; rec.textContent = `Recording... ${n}`;
    const t = setInterval(() => { n--; if (n <= 0) { clearInterval(t); mr.stop(); } else rec.textContent = `Recording... ${n}`; }, 1000);
  };
  play.onclick = async () => { const a = new Audio(url); await sink(a); a.play().catch(() => { hint.textContent = 'The browser would not play it. Tap Play again.'; }); };
  $('#mqbeep', el).onclick = async () => {
    try {
      const c = new (window.AudioContext || window.webkitAudioContext)();
      await c.resume().catch(() => {});
      const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 523; g.gain.value = 0.15; o.connect(g);
      // Route through an audio element so the speaker you picked is used where the browser allows it.
      const dest = c.createMediaStreamDestination(); g.connect(dest);
      const a = new Audio(); a.srcObject = dest.stream; await sink(a); await a.play();
      o.start(); setTimeout(() => { o.stop(); c.close().catch(() => {}); a.pause(); }, 900);
      hint.textContent = 'You should hear a short beep. No sound? Check the volume, the silent switch on an iPhone, and that your headset is connected.';
    } catch { hint.textContent = 'The browser would not play a beep. Tap the button again.'; }
  };
}
