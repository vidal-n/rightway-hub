// Meetings in the Phone tab: start a Google Meet now, join one by link or code, schedule one, and jump into today's booked meetings.
// Meet cannot run inside another site (Google blocks it), so it always opens in its own window beside the Hub.
import { can } from '/js/jobs.js';
import { $, $$, esc, api, toast, busy, icon } from './core.js';
import { staffShell } from './shell.js';
import { dialTabs } from './dialout.js';

const openMeet = (url) => {
  const w = window.open(url, 'rw-meet', `width=${Math.min(1200, screen.availWidth - 60)},height=${Math.min(800, screen.availHeight - 60)},left=30,top=30`);
  if (!w) window.open(url, '_blank');
};
// "abc-defg-hij", "meet.google.com/abc-defg-hij" or a full link: all go to the right room.
export function meetUrl(v) {
  const t = String(v || '').trim();
  const code = t.match(/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
  if (code) return `https://meet.google.com/${code[1].toLowerCase()}`;
  if (/^https:\/\/(meet\.google\.com|[\w.-]*zoom\.us)\//i.test(t)) return t;
  if (/^[a-z]{10}$/i.test(t)) return `https://meet.google.com/${t.slice(0, 3)}-${t.slice(3, 7)}-${t.slice(7)}`.toLowerCase();
  return null;
}

export async function meetPage(app, user) {
  const view = staffShell(app, user, 'dialer');
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Phone</p><h1>Meetings</h1></div></div>${dialTabs('meet', user)}
    <div class="ana-grid">
      <div class="card"><div class="card-head"><h3>Start a meeting now</h3><span class="badge">Google Meet</span></div>
        <form id="mnow" class="form-grid" style="grid-template-columns:1fr">
          <label class="field"><span>Title</span><input name="title" value="RightWay Growth meeting"></label>
          <label class="field"><span>Invite by email (optional, comma separated)</span><input name="invite" placeholder="owner@business.com"></label>
          <div class="row"><button class="btn btn-primary" type="submit">${icon.meet || icon.phone}Start meeting</button><span class="small muted">Opens in its own window. The link is copied for you.</span></div></form>
        <div id="mout"></div></div>
      <div class="card"><div class="card-head"><h3>Join a meeting</h3></div>
        <form id="mjoin" class="form-grid" style="grid-template-columns:1fr">
          <label class="field"><span>Meeting link or code</span><input name="code" placeholder="abc-defg-hij or https://meet.google.com/..." autocomplete="off"></label>
          <div class="row"><button class="btn btn-primary" type="submit">Join</button><a class="btn btn-ghost" href="https://meet.google.com/landing" target="_blank" rel="noopener">Open Google Meet</a></div></form></div>
      <div class="card"><div class="card-head"><h3>Schedule a meeting</h3></div>
        <form id="msch" class="form-grid">
          <label class="field span-all"><span>Title</span><input name="title" value="RightWay Growth meeting" required></label>
          <label class="field"><span>When</span><input name="start" type="datetime-local" required></label>
          <label class="field"><span>Length</span><select name="minutes"><option>15</option><option selected>30</option><option>45</option><option>60</option></select></label>
          <label class="field span-all"><span>Invite by email</span><input name="invite" placeholder="owner@business.com, kiron@..."></label>
          <div class="span-all row"><button class="btn btn-primary" type="submit">Schedule with a Meet link</button><a class="small" href="#/calendar">Team calendar</a></div></form></div>
    </div>
    <div class="card" style="margin-top:14px"><div class="card-head"><h3>Today and coming up</h3><a class="btn btn-ghost btn-sm" href="#/calendar/list">All appointments</a></div><div id="mup"><div class="skeleton"></div></div></div>`;
  const d = new Date(Date.now() + 3600e3); d.setMinutes(0, 0, 0);
  $('#msch', view).start.value = new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  const run = async (form, body) => {
    const btn = form.querySelector('[type=submit]'); busy(btn, true);
    const w = body.start ? null : window.open('about:blank', 'rw-meet', `width=${Math.min(1200, screen.availWidth - 60)},height=${Math.min(800, screen.availHeight - 60)},left=30,top=30`);
    try {
      const r = await api('/api/meet/now', { method: 'POST', body });
      const url = r.ok ? r.meet : r.fallback;
      if (w) w.location = url; else if (!body.start) openMeet(url);
      if (r.ok) { try { await navigator.clipboard.writeText(r.meet); } catch { /* ignore */ } }
      $('#mout', view).innerHTML = `<div class="card" style="box-shadow:none;background:var(--mint-soft);margin-top:12px">${r.ok ? `<b>${body.start ? 'Scheduled' : 'Meeting started'}</b>${r.invited ? ` · ${r.invited} invited by email` : ''}<div class="copybox" style="margin-top:6px"><code>${esc(r.meet)}</code></div>
        <div class="row" style="margin-top:8px"><button class="btn btn-ghost btn-sm" data-copy="${esc(r.meet)}">Copy link</button><a class="btn btn-ghost btn-sm" href="sms:?&body=${encodeURIComponent(`Join me on Google Meet: ${r.meet}`)}">Text it</a><button class="btn btn-ghost btn-sm" data-open="${esc(r.meet)}">Open again</button></div>`
        : `<p class="small" style="margin:0">${esc(r.reason)} Connect Google on the Google page to get links that invite people and land on your calendar.</p>`}</div>`;
      $$('[data-copy]', view).forEach((b) => b.addEventListener('click', () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Copied'))));
      $$('[data-open]', view).forEach((b) => b.addEventListener('click', () => openMeet(b.dataset.open)));
      if (body.start) toast(r.ok ? 'Scheduled and on your Google Calendar' : r.reason, !r.ok);
    } catch (e) { w?.close(); toast(e.message, true); }
    busy(btn, false);
  };
  $('#mnow', view).addEventListener('submit', (e) => { e.preventDefault(); run(e.target, { title: e.target.title.value, invite: e.target.invite.value }); });
  $('#msch', view).addEventListener('submit', (e) => { e.preventDefault(); const f = e.target; run(f, { title: f.title.value, invite: f.invite.value, start: new Date(f.start.value).toISOString(), minutes: Number(f.minutes.value) }); });
  $('#mjoin', view).addEventListener('submit', (e) => { e.preventDefault(); const u = meetUrl(e.target.code.value); if (!u) return toast('Paste a Meet link or a code like abc-defg-hij.', true); openMeet(u); });
  try {
    const from = new Date().setHours(0, 0, 0, 0);
    const r = await api(`/api/appointments?from=${from}&to=${from + 8 * 864e5}`);
    const items = r.items.filter((x) => x.start > Date.now() - 2 * 3600e3);
    $('#mup', view).innerHTML = items.length ? items.map((x) => `<div class="row" style="flex-wrap:nowrap;gap:12px;padding:9px 0;border-top:1px solid var(--line)">
      <span class="mono" style="min-width:150px">${esc(new Date(x.start).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</span>
      <b style="flex:1;min-width:0">${esc(x.title)}</b><span class="small">${esc([x.who, x.by].filter(Boolean).join(' · '))}</span>
      ${x.link ? `<button class="btn btn-primary btn-sm" data-join="${esc(x.link)}">Join</button>` : '<span class="small muted">No link yet</span>'}
      ${x.kind === 'audit' && x.open && can(window.__rwUser, 'close') ? `<a class="btn btn-ghost btn-sm" href="/present.html#${esc(x.id)}" target="_blank" rel="noopener">Present</a>` : ''}</div>`).join('')
      : '<p class="small muted" style="margin:0">Nothing booked in the next week.</p>';
    $$('[data-join]', view).forEach((b) => b.addEventListener('click', () => openMeet(b.dataset.join)));
  } catch (e) { $('#mup', view).innerHTML = `<p class="err-text">${esc(e.message)}</p>`; }
}
