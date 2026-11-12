// AI practice owner: type or speak to a pretend business owner, then get coaching. Used in Training, Warm up and on the Test power dial.
import { $, esc, api, toast, modal } from './core.js';
import { PERSONAS, personaOf } from '/js/practice.js';

const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;

export function practiceView(host, { persona = 'friendly', lead = {}, fixed = false, compact = false, onFinish = null } = {}) {
  let turns = [];
  let pid = persona;
  let busyNow = false;
  let ended = false;
  let ai = null;
  let speak = false;
  let rec = null;
  const say = (text) => {
    if (!speak || !window.speechSynthesis) return;
    try { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.02; window.speechSynthesis.speak(u); } catch { /* ignore */ }
  };
  const bubbles = () => turns.map((t) => `<div class="pr-b ${t.role === 'rep' ? 'rep' : 'lead'}"><small>${t.role === 'rep' ? 'You' : esc(personaOf(pid).name)}</small>${esc(t.text)}</div>`).join('');
  const paint = () => {
    const p = personaOf(pid);
    host.innerHTML = `<div class="pr${compact ? ' compact' : ''}">
      ${fixed ? '' : `<label class="field"><span>Who are you calling?</span><select id="prp">${PERSONAS.map((x) => `<option value="${x.id}"${x.id === pid ? ' selected' : ''}>${esc(x.name)}, ${esc(x.role)} (${esc(x.level)})</option>`).join('')}</select></label>`}
      <p class="small muted pr-meta">${esc(p.name)}, ${esc(p.role)} (${esc(p.mood)}).${ai === false ? ' Basic mode: add an Anthropic key for the full AI owner.' : ''}</p>
      <div class="pr-log" id="prlog" aria-live="polite">${bubbles() || '<p class="muted">Calling...</p>'}</div>
      <div id="prfb" class="pr-fb" hidden></div>
      <div class="pr-in"${ended ? ' hidden' : ''}>
        <textarea id="prtext" rows="2" placeholder="Say your line. Enter sends." aria-label="Your line"></textarea>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary btn-sm" id="prsend">Send</button>
          ${Rec ? '<button type="button" class="btn btn-ghost btn-sm" id="prmic">Speak</button>' : ''}
          <label class="row small" style="gap:6px"><input type="checkbox" id="prtts"${speak ? ' checked' : ''}> Read replies aloud</label>
          <button type="button" class="btn btn-ghost btn-sm" id="prend" style="margin-left:auto">End call and get feedback</button>
        </div>
      </div>
      <div class="row" id="prdone" style="gap:8px;margin-top:10px"${ended ? '' : ' hidden'}>
        <button type="button" class="btn btn-primary btn-sm" id="pragain">Practice again</button>
        ${onFinish ? '<button type="button" class="btn btn-ghost btn-sm" id="prfinish">Finish the call</button>' : ''}
      </div></div>`;
    const log = $('#prlog', host); if (log) log.scrollTop = log.scrollHeight;
    wire();
  };
  const ask = async () => {
    busyNow = true;
    try {
      const r = await api('/api/practice/turn', { method: 'POST', body: { persona: pid, lead, turns } });
      ai = r.ai;
      turns.push({ role: 'lead', text: r.reply });
      say(r.reply);
    } catch (e) { toast(e.message, true); }
    busyNow = false; paint();
  };
  const send = () => {
    const el = $('#prtext', host); const text = (el?.value || '').trim();
    if (!text || busyNow || ended) return;
    turns.push({ role: 'rep', text }); paint(); ask();
  };
  const end = async () => {
    if (busyNow) return;
    window.speechSynthesis?.cancel?.(); rec?.stop?.();
    ended = true; busyNow = true; paint();
    const fb = $('#prfb', host); fb.hidden = false; fb.textContent = 'Reading the call...';
    try { const r = await api('/api/practice/coach', { method: 'POST', body: { persona: pid, lead, turns } }); fb.innerHTML = `<b>Coach${r.ai ? '' : ' (basic)'}</b><div class="pr-fbt">${esc(r.feedback)}</div>`; }
    catch (e) { fb.textContent = e.message; }
    busyNow = false;
  };
  const wire = () => {
    $('#prp', host)?.addEventListener('change', (e) => { pid = e.target.value; turns = []; ended = false; paint(); ask(); });
    $('#prsend', host)?.addEventListener('click', send);
    $('#prtext', host)?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    $('#prtts', host)?.addEventListener('change', (e) => { speak = e.target.checked; if (!speak) window.speechSynthesis?.cancel?.(); });
    $('#prend', host)?.addEventListener('click', end);
    $('#pragain', host)?.addEventListener('click', () => { turns = []; ended = false; paint(); ask(); });
    $('#prfinish', host)?.addEventListener('click', () => onFinish?.());
    $('#prmic', host)?.addEventListener('click', (e) => {
      if (rec) { rec.stop(); return; }
      rec = new Rec(); rec.lang = 'en-US'; rec.interimResults = false;
      e.currentTarget.textContent = 'Listening...';
      rec.onresult = (ev) => { const t = ev.results[0]?.[0]?.transcript || ''; const el = $('#prtext', host); if (el) el.value = t; };
      rec.onerror = () => toast('The microphone is blocked or not available. Type your line instead.', true);
      rec.onend = () => { rec = null; const b = $('#prmic', host); if (b) b.textContent = 'Speak'; if (($('#prtext', host)?.value || '').trim()) send(); };
      try { rec.start(); } catch { rec = null; }
    });
  };
  paint();
  ask();
  return { stop: () => { window.speechSynthesis?.cancel?.(); try { rec?.stop(); } catch { /* ignore */ } } };
}

// A pop up for the Test power dial: the pretend owner picks up when the pretend call connects.
export function practiceModal({ persona, lead, onFinish } = {}) {
  const m = modal(`<div class="card-head"><div><h2 style="margin:0">Practice call</h2><p class="small muted" style="margin:2px 0 0">The AI owner picked up. Say your opener.</p></div><button class="btn btn-ghost btn-sm" data-close>Close</button></div><div id="prhost"></div>`);
  const host = m.el?.querySelector('#prhost') || document.querySelector('.modal-bg:last-of-type #prhost');
  const v = practiceView(host, { persona, lead, fixed: true, compact: true, onFinish: () => { m.close?.(); onFinish?.(); } });
  return { ...m, stop: v.stop };
}
