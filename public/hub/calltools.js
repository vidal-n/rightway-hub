// Call training tools: recordings (reps hear their own, owners hear all), live calls with listen, whisper and barge (owners only),
// and phone setup (owners only): the recording switch and which Twilio numbers send calls and texts to the Hub.
import { $, $$, esc, api, toast, busy } from './core.js';
import { staffShell } from './staff.js';
import { dialTabs } from './dialout.js';
import { joinCall, onPhoneState, phoneState, picon, pretty } from './phone.js';

const when = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const mins = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '0:00');
const head = (title, eyebrow = 'Power dialer') => `<div class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1></div></div>`;

// ---------- recordings ----------
export async function recordingsPage(app, user) {
  const view = staffShell(app, user, 'dialer');
  let rep = '';
  const load = async () => {
    let d;
    try { d = await api(`/api/recordings${rep ? `?rep=${encodeURIComponent(rep)}` : ''}`); }
    catch (e) { view.innerHTML = `${head('Recordings')}${dialTabs('recordings', user)}<p class="err-text">${esc(e.message)}</p>`; return; }
    view.innerHTML = `${head('Recordings')}${dialTabs('recordings', user)}
      <div class="row" style="margin-bottom:14px;justify-content:space-between">
        <p class="small muted" style="margin:0">${d.canSeeAll ? 'Every recorded call. Reps only see their own.' : 'Your recorded calls. Listen back to sharpen your pitch.'}</p>
        ${d.canSeeAll ? `<label class="row small" style="gap:8px">Rep <select id="rrep"><option value="">Everyone</option>${d.reps.map((r) => `<option value="${esc(r.id)}"${r.id === rep ? ' selected' : ''}>${esc(r.name || r.email)}</option>`).join('')}</select></label>` : ''}
      </div>
      ${d.recordings.length ? `<div class="card rec-list">${d.recordings.map((r) => {
        const num = r.to_num || (r.body || '').replace(/^Incoming call from /, '');
        const dir = r.to_num ? 'Outbound' : 'Inbound';
        return `<div class="rec-row" data-id="${esc(r.id)}">
          <div class="rec-main"><b>${esc(r.business || pretty(num) || 'Unknown caller')}</b>
            <span class="small muted">${esc([r.business ? pretty(num) : '', dir, d.canSeeAll ? r.rep || (r.to_num ? '' : 'Answered in the Hub') : '', when(r.at)].filter(Boolean).join(' · '))}</span></div>
          <span class="badge gray">${mins(r.rec_secs || r.duration)}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-play>${picon.ear}Play</button>
          ${d.canSeeAll ? '<button type="button" class="linkbtn small" data-del>Delete</button>' : ''}
          <div class="rec-audio"></div>
        </div>`;
      }).join('')}</div>` : `<div class="card empty"><h3>No recordings yet</h3><p>${d.canSeeAll ? 'Turn recording on in Phone setup. Calls that connect will show up here.' : 'When the owner turns recording on, your calls that connect show up here.'}</p></div>`}`;
    $('#rrep', view)?.addEventListener('change', (e) => { rep = e.target.value; load(); });
    $$('.rec-row', view).forEach((row) => {
      $('[data-play]', row).addEventListener('click', (e) => {
        const box = $('.rec-audio', row);
        if (!box.firstChild) box.innerHTML = `<audio controls autoplay preload="none" src="/api/recordings/${encodeURIComponent(row.dataset.id)}/audio"></audio>`;
        e.currentTarget.remove();
      });
      $('[data-del]', row)?.addEventListener('click', async () => {
        if (!confirmInline(row)) return;
        try { await api(`/api/recordings/${row.dataset.id}`, { method: 'DELETE' }); row.remove(); toast('Recording deleted'); } catch (err) { toast(err.message, true); }
      });
    });
  };
  load();
}

// Two clicks to delete, no browser dialog.
function confirmInline(row) {
  const b = $('[data-del]', row);
  if (b.dataset.sure) return true;
  b.dataset.sure = '1'; b.textContent = 'Click again to delete';
  setTimeout(() => { if (document.body.contains(b)) { delete b.dataset.sure; b.textContent = 'Delete'; } }, 4000);
  return false;
}

// ---------- live calls ----------
export async function liveCallsPage(app, user) {
  const view = staffShell(app, user, 'dialer');
  if (user.role !== 'admin') { view.innerHTML = `${head('Live calls')}${dialTabs('live', user)}<p class="err-text">Only an owner can listen to live calls.</p>`; return; }
  view.innerHTML = `${head('Live calls')}${dialTabs('live', user)}
    <p class="small muted" style="margin:-4px 0 14px">Join any call your team is on. <b>Listen</b>: nobody hears you. <b>Whisper</b>: only the rep hears you. <b>Barge</b>: everyone hears you. Switch any time from the call bar.</p>
    <div id="live"></div>`;
  const box = $('#live', view);
  let timer = null;
  const draw = async () => {
    if (!document.body.contains(view)) { clearInterval(timer); return; }
    let d;
    try { d = await api('/api/voice/live'); } catch (e) { box.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
    const onCall = phoneState().onCall;
    box.innerHTML = d.calls.length ? `<div class="card rec-list">${d.calls.map((c) => {
      const secs = c.answered_at ? Math.round((Date.now() - c.answered_at) / 1000) : 0;
      return `<div class="rec-row">
        <div class="rec-main"><b>${esc(c.rep || 'Rep')} <span class="muted">with</span> ${esc(c.business || pretty(c.to_num))}</b>
          <span class="small muted">${esc([c.business ? pretty(c.to_num) : '', `from ${pretty(c.from_num)}`].filter(Boolean).join(' · '))}</span></div>
        <span class="badge${c.status === 'in-progress' ? '' : ' gray'}">${c.status === 'in-progress' ? `Talking ${mins(secs)}` : 'Ringing'}</span>
        ${c.mine ? `<span class="badge">You are ${esc(c.mon_mode === 'barge' ? 'on the call' : `${c.mon_mode}ing`)}</span>`
          : c.by === user.id ? '<span class="small muted">Your call</span>'
            : `<div class="row" style="gap:6px">${['listen', 'whisper', 'barge'].map((m) => `<button type="button" class="btn ${m === 'listen' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-join="${esc(c.id)}" data-mode="${m}"${onCall ? ' disabled' : ''}>${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>`}
      </div>`;
    }).join('')}</div>` : '<div class="card empty"><h3>No one is on a call right now</h3><p>Calls placed from the Hub show up here while they ring and while they talk. This page refreshes on its own.</p></div>';
    $$('[data-join]', box).forEach((b) => b.addEventListener('click', async () => {
      const c = d.calls.find((x) => x.id === b.dataset.join);
      busy(b, true);
      try { await joinCall({ act: c.id, mode: b.dataset.mode, name: c.business, number: c.to_num, rep: c.rep }); }
      catch (err) { toast(err.message, true); busy(b, false); }
    }));
  };
  draw();
  timer = setInterval(draw, 3000);
  const off = onPhoneState(() => { if (!document.body.contains(view)) { off(); clearInterval(timer); return; } draw(); });
}

// ---------- phone setup ----------
export async function phoneSetupPage(app, user) {
  const view = staffShell(app, user, 'dialer');
  if (user.role !== 'admin') { view.innerHTML = `${head('Phone setup')}${dialTabs('setup', user)}<p class="err-text">Only an owner can change phone settings.</p>`; return; }
  const load = async () => {
    let d;
    try { d = await api('/api/voice/setup'); } catch (e) { view.innerHTML = `${head('Phone setup')}${dialTabs('setup', user)}<p class="err-text">${esc(e.message)}</p>`; return; }
    if (!d.ready) { view.innerHTML = `${head('Phone setup')}${dialTabs('setup', user)}<div class="card"><p>Add the Twilio keys in Cloudflare first.</p></div>`; return; }
    const state = (v) => (v === 'hub' ? '<span class="badge">Hub</span>' : v === 'other' ? '<span class="badge warn">Somewhere else</span>' : '<span class="badge gray">Not set</span>');
    const todo = d.numbers.filter((n) => n.calls !== 'hub' || n.texts !== 'hub');
    view.innerHTML = `${head('Phone setup')}${dialTabs('setup', user)}
      <div class="card" style="max-width:760px">
        <div class="row" style="justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:nowrap">
          <div><h3 style="margin:0 0 6px">Record calls</h3>
            <p class="small muted" style="margin:0">Records calls placed from the Hub that connect, and incoming calls. Reps hear their own in Recordings, owners hear all. Calls nobody answers are not kept. Florida needs everyone on the call to know, so say it at the start: "Just so you know, this call is recorded."</p></div>
          <label class="switch"><input type="checkbox" id="srec"${d.recording ? ' checked' : ''}><span></span></label>
        </div>
      </div>
      <div class="card" style="max-width:760px;margin-top:14px">
        <h3 style="margin:0 0 6px">Your numbers</h3>
        <p class="small muted" style="margin:0 0 12px">Every number here shows up under "Call from" in the dialer. Connect a number so its incoming calls ring in the Hub and its texts land in the Inbox.</p>
        ${d.numbers.map((n) => `<div class="rec-row">
          <div class="rec-main"><b>${esc(pretty(n.number))}</b><span class="small muted">${n.number === d.main ? 'Main number' : esc(n.label && !/^[(+\d]/.test(n.label) ? n.label : '')}</span></div>
          <span class="small">Calls ${state(n.calls)}</span><span class="small">Texts ${state(n.texts)}</span>
          ${n.calls === 'hub' && n.texts === 'hub' ? '<span class="small muted">Connected</span>' : `<button type="button" class="btn btn-ghost btn-sm" data-sid="${esc(n.sid)}" data-other="${n.calls === 'other' || n.texts === 'other' ? '1' : ''}">Connect</button>`}
        </div>`).join('')}
        ${todo.length > 1 ? `<button type="button" class="btn btn-primary" id="sall" style="margin-top:14px">Connect all ${todo.length}</button>` : ''}
        <p class="small muted" style="margin:12px 0 0">Texts still need A2P approval before carriers deliver them. Calls work now.</p>
      </div>`;
    $('#srec', view).addEventListener('change', async (e) => {
      try { const r = await api('/api/voice/setup', { method: 'PUT', body: { recording: e.target.checked } }); toast(r.recording ? 'Recording is on' : 'Recording is off'); }
      catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; }
    });
    const connect = async (btn, sids) => {
      busy(btn, true);
      try { const r = await api('/api/voice/connect-numbers', { method: 'POST', body: { sids } }); toast(`${r.connected} connected`); load(); }
      catch (err) { toast(err.message, true); busy(btn, false); }
    };
    $$('[data-sid]', view).forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.other && !b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'This replaces where it points now. Click again'; return; }
      connect(b, [b.dataset.sid]);
    }));
    $('#sall', view)?.addEventListener('click', (e) => {
      const b = e.currentTarget;
      if (todo.some((n) => n.calls === 'other' || n.texts === 'other') && !b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Some point somewhere else now. Click again to connect all'; return; }
      connect(b, todo.map((n) => n.sid));
    });
  };
  load();
}
