// The team appointment calendar, inside the Hub. Booked audits and client meetings show here on their own; anyone can add an
// appointment with the form (no Google account needed), and a private calendar link sends everything to Google, Apple or Outlook.
import { can } from '/js/jobs.js';
import { $, $$, esc, api, toast, busy, modal } from './core.js';
import { staffShell } from './shell.js';
import { icsCalendar, googleAddUrl } from '/js/ics.js';

const DAY = 864e5;
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const timeOf = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const p2 = (n) => String(n).padStart(2, '0');
const dval = (t) => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const tval = (t) => { const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const nextHour = () => { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return d.getTime(); };
const KIND = { audit: 'Audit', client: 'Client', event: 'Appointment' };
const hrefOf = (x) => (x.kind === 'audit' ? `#/pipeline/${x.id}` : `#/client/${x.id}/meetings`);

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
const icsFor = (x) => icsCalendar([{ uid: `${x.kind}-${x.id}`, title: x.title, start: x.start, minutes: x.minutes, description: [x.who && `With ${x.who}`, x.note].filter(Boolean).join('\n'), location: x.link || '' }]);
const gUrl = (x) => googleAddUrl({ title: x.title, start: x.start, minutes: x.minutes, details: [x.who && `With ${x.who}`, x.note].filter(Boolean).join('\n'), location: x.link || '' });

// The form for adding or changing an appointment. `ev` is an existing one; `day` pre-fills the date.
function eventModal({ ev, day, preset, onDone }) {
  const base = ev || preset || {};
  const t0 = ev ? ev.start : day ? new Date(day).setHours(10, 0, 0, 0) : nextHour();
  let leadId = base.lead_id || null;
  const clientId = base.client_id || null;
  const lens = [15, 20, 30, 45, 60, 90, 120];
  const m = modal(`<h2>${ev ? 'Edit appointment' : 'New appointment'}</h2>
    <form id="evf" class="form-grid" style="grid-template-columns:1fr 1fr">
      <label class="field" style="grid-column:1/-1"><span>Title</span><input name="title" required maxlength="160" placeholder="Call with Maria, Smile Dental" value="${esc(base.title || '')}"></label>
      <label class="field"><span>Date</span><input type="date" name="date" required value="${dval(t0)}"></label>
      <label class="field"><span>Start time</span><input type="time" name="time" required value="${tval(t0)}"></label>
      <label class="field"><span>Length</span><select name="minutes">${lens.map((n) => `<option value="${n}"${n === (ev?.minutes || 30) ? ' selected' : ''}>${n} minutes</option>`).join('')}</select></label>
      <label class="field"><span>Guest email (optional)</span><input type="email" name="guest_email" value="${esc(base.guest_email || '')}"></label>
      <label class="field" style="grid-column:1/-1"><span>Meeting link (optional)</span><input type="url" name="link" placeholder="https://" value="${esc(ev?.link || '')}"></label>
      <label class="field" style="grid-column:1/-1"><span>Lead (optional)</span><input name="lead" list="evleads" autocomplete="off" placeholder="Start typing a business name" value="${esc(base.lead_name || '')}"><datalist id="evleads"></datalist></label>
      <label class="field" style="grid-column:1/-1"><span>Notes</span><textarea name="note" rows="3">${esc(base.note || '')}</textarea></label>
      <label class="row small" style="grid-column:1/-1;gap:8px"><input type="checkbox" name="invite"> Email the guest an invite with the appointment attached</label>
      <div class="row" style="grid-column:1/-1;justify-content:space-between"><div class="row"><button class="btn btn-primary" type="submit">${ev ? 'Save' : 'Add appointment'}</button><button class="btn btn-ghost" type="button" data-close>Cancel</button></div>${ev ? '<button class="btn btn-ghost" type="button" id="evdel">Delete</button>' : ''}</div>
    </form>`);
  const f = $('#evf', m.el);
  const dl = $('#evleads', m.el);
  const found = new Map();
  let timer;
  f.lead.addEventListener('input', () => {
    const v = f.lead.value.trim();
    leadId = found.get(v) || (v ? leadId : null);
    if (!v) leadId = null;
    clearTimeout(timer);
    if (v.length < 2 || found.has(v)) return;
    timer = setTimeout(async () => {
      try {
        const r = await api(`/api/leads?q=${encodeURIComponent(v)}&limit=8`);
        found.clear();
        dl.innerHTML = r.leads.map((l) => { const label = `${l.business}${l.city ? `, ${l.city}` : ''}`; found.set(label, l.id); return `<option value="${esc(label)}"></option>`; }).join('');
      } catch { /* the field still works without suggestions */ }
    }, 250);
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type="submit"]', f);
    const start = new Date(`${f.date.value}T${f.time.value}`).getTime();
    busy(btn, true);
    try {
      const body = { title: f.title.value, start, minutes: Number(f.minutes.value), guest_email: f.guest_email.value, link: f.link.value, note: f.note.value, lead_id: leadId, client_id: clientId, invite: f.invite.checked && Boolean(f.guest_email.value.trim()) };
      const r = ev ? await api(`/api/events/${ev.id}`, { method: 'PUT', body }) : await api('/api/events', { method: 'POST', body });
      m.close();
      if (r.noEmail) toast('Saved. Email is not set up, so no invite went out.', true);
      else if (r.inviteError) toast(`Saved, but the invite failed: ${r.inviteError}`, true);
      else toast(r.invited ? 'Saved and invite sent' : 'Saved');
      onDone();
    } catch (err) { toast(err.message, true); busy(btn, false); }
  });
  $('#evdel', m.el)?.addEventListener('click', async () => {
    if (!confirm('Delete this appointment?')) return;
    try { await api(`/api/events/${ev.id}`, { method: 'DELETE' }); m.close(); toast('Deleted'); onDone(); } catch (err) { toast(err.message, true); }
  });
}

// From a lead or client page: the same form, filled in and tied to them.
export function quickAppointment(preset, onDone = () => {}) { eventModal({ preset, onDone }); }

// Where to point Google Calendar, iPhone or Outlook so appointments land there on their own.
async function feedPanel(box) {
  box.innerHTML = '<div class="skeleton"></div>';
  let f;
  try { f = await api('/api/me/calendar-feed'); } catch (e) { box.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  box.innerHTML = `<p class="small" style="margin:0 0 10px">With Google connected, the team calendar in Settings is the better way: every booking lands on one shared Google calendar. This link works without Google. Subscribe once and every appointment you can see (booked audits, client meetings, the ones you add here) shows up in your own calendar by itself. It is read only: add or change things here in the Hub.</p>
    <div class="row" style="gap:8px"><input id="feedurl" readonly value="${esc(f.url)}" style="flex:1 1 280px;font-family:var(--mono);font-size:12px"><button class="btn btn-primary btn-sm" id="feedcopy">Copy link</button><a class="btn btn-ghost btn-sm" href="${esc(f.webcal)}">Open in Apple Calendar</a></div>
    <ol class="small" style="margin:12px 0 0;padding-left:18px;display:grid;gap:4px">
      <li><b>Google Calendar</b> (computer): click the plus next to "Other calendars", choose <b>From URL</b>, paste the link, Add calendar. Google refreshes subscribed calendars on its own schedule, so new appointments can take hours to appear there.</li>
      <li><b>iPhone</b>: Settings, Calendar, Accounts, Add Account, Other, Add Subscribed Calendar, paste the link. Or tap Open in Apple Calendar above.</li>
      <li><b>Outlook</b>: Add calendar, Subscribe from web, paste the link.</li>
    </ol>
    <p class="small muted" style="margin:10px 0 0">Anyone with this link can see your appointments. <button class="btn btn-ghost btn-sm" id="feednew" type="button">Make a new link</button> if it gets shared by mistake. The old one stops working.</p>`;
  $('#feedcopy', box).addEventListener('click', async () => { try { await navigator.clipboard.writeText(f.url); toast('Copied'); } catch { $('#feedurl', box).select(); toast('Press Ctrl+C to copy', true); } });
  $('#feednew', box).addEventListener('click', async () => {
    if (!confirm('Make a new link? Calendars using the old one will stop updating.')) return;
    try { await api('/api/me/calendar-feed', { method: 'POST' }); toast('New link made. Subscribe again with it.'); feedPanel(box); } catch (e) { toast(e.message, true); }
  });
}

export async function apptCalendarPage(app, user, sub) {
  const view = staffShell(app, user, 'calendar');
  let cur = startOfMonth(new Date());
  let mode = sub === 'list' ? 'list' : 'month';
  let feedOpen = false;
  const draw = async () => {
    const gridStart = new Date(cur); gridStart.setDate(1 - gridStart.getDay());
    const from = mode === 'month' ? gridStart.getTime() : new Date().setHours(0, 0, 0, 0);
    const to = mode === 'month' ? from + 42 * DAY : from + 30 * DAY;
    view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Appointments</p><h1>${mode === 'month' ? esc(cur.toLocaleDateString([], { month: 'long', year: 'numeric' })) : 'Next 30 days'}</h1></div>
      <div class="row"><button class="btn btn-primary btn-sm" id="evnew" type="button">New appointment</button><div class="seg"><button type="button" data-m="month" class="${mode === 'month' ? 'is-on' : ''}">Month</button><button type="button" data-m="list" class="${mode === 'list' ? 'is-on' : ''}">List</button></div>
      ${mode === 'month' ? '<div class="seg"><button type="button" id="cprev">&larr;</button><button type="button" id="ctoday">Today</button><button type="button" id="cnext">&rarr;</button></div>' : ''}</div></div>
      <details class="card" id="feedcard" style="margin-bottom:14px"${feedOpen ? ' open' : ''}><summary style="cursor:pointer"><b>Send my appointments to my phone or Google Calendar</b></summary><div id="feedbox" style="margin-top:12px"></div></details>
      <div id="calb"><div class="skeleton"></div></div>`;
    $$('[data-m]', view).forEach((b) => b.addEventListener('click', () => { mode = b.dataset.m; draw(); }));
    $('#cprev', view)?.addEventListener('click', () => { cur = new Date(cur.getFullYear(), cur.getMonth() - 1, 1); draw(); });
    $('#cnext', view)?.addEventListener('click', () => { cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); draw(); });
    $('#ctoday', view)?.addEventListener('click', () => { cur = startOfMonth(new Date()); draw(); });
    $('#evnew', view).addEventListener('click', () => eventModal({ onDone: draw }));
    $('#feedcard', view).addEventListener('toggle', (e) => { feedOpen = e.target.open; if (feedOpen && !$('#feedbox', view).children.length) feedPanel($('#feedbox', view)); });
    if (feedOpen) feedPanel($('#feedbox', view));
    let d;
    try { d = await api(`/api/appointments?from=${from}&to=${to}`); } catch (e) { $('#calb', view).innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
    const byKey = new Map(d.items.map((x) => [`${x.kind}:${x.id}:${x.start}`, x]));
    const key = (x) => esc(`${x.kind}:${x.id}:${x.start}`);
    const tip = (x) => esc(x.kind === 'audit' ? `${x.title} · ${x.closer ? `${x.closer} runs it` : 'nobody assigned'} · booked by ${x.by}` : `${x.title} · ${x.by}`);
    const label = (x) => (x.kind === 'audit' && x.closer ? `${x.closer}: ${x.title}` : x.title);
    const chip = (x) => (x.kind === 'event'
      ? `<button type="button" class="ac-chip event${x.start < Date.now() ? ' past' : ''}" data-ev="${key(x)}" title="${tip(x)}"><b>${esc(timeOf(x.start))}</b> ${esc(x.title)}</button>`
      : `<${x.open ? 'a' : 'span'} class="ac-chip ${x.kind}${x.start < Date.now() ? ' past' : ''}" ${x.open ? `href="${esc(hrefOf(x))}"` : ''} title="${tip(x)}"><b>${esc(timeOf(x.start))}</b> ${esc(label(x))}</${x.open ? 'a' : 'span'}>`);
    const wire = () => {
      $$('[data-ev]', view).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const x = byKey.get(b.dataset.ev); if (x?.edit) eventModal({ ev: x, onDone: draw }); else toast('That one belongs to someone else.'); }));
      $$('[data-ics]', view).forEach((b) => b.addEventListener('click', () => { const x = byKey.get(b.dataset.ics); if (x) download(`${x.title.replace(/[^\w]+/g, '-').slice(0, 40) || 'appointment'}.ics`, icsFor(x)); }));
    };
    if (mode === 'list') {
      const days = new Map();
      for (const x of d.items) { const k = new Date(x.start).toDateString(); if (!days.has(k)) days.set(k, []); days.get(k).push(x); }
      $('#calb', view).innerHTML = days.size ? [...days.entries()].map(([k, xs]) => `<div class="card" style="margin-bottom:10px"><div class="card-head"><h3>${esc(new Date(k).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }))}</h3><span class="badge gray">${xs.length}</span></div>
        ${xs.map((x) => `<div class="row" style="flex-wrap:wrap;gap:12px;padding:8px 0;border-top:1px solid var(--line)"><span class="mono" style="min-width:76px">${esc(timeOf(x.start))}</span>
          <span class="badge ${x.kind === 'audit' ? '' : 'gray'}">${KIND[x.kind]}</span><b style="flex:1;min-width:140px">${x.open ? `<a href="${esc(hrefOf(x))}">${esc(x.title)}</a>` : x.kind === 'event' && x.edit ? `<a href="#" data-ev="${key(x)}">${esc(x.title)}</a>` : esc(x.title)}</b>
          <span class="small">${esc((x.kind === 'audit' ? [x.who, x.city, x.closer ? `${x.closer} runs it` : 'Nobody assigned', `booked by ${x.by}`] : [x.who, x.city, x.by]).filter(Boolean).join(' · '))}</span>${x.link ? `<a class="btn btn-ghost btn-sm" href="${esc(x.link)}" target="_blank" rel="noopener">Join</a>` : ''}
          ${x.kind === 'audit' && x.open && can(window.__rwUser, 'close') ? `<a class="btn btn-ghost btn-sm" href="/present.html#${esc(x.id)}" target="_blank" rel="noopener">Present</a>` : ''}
          <a class="btn btn-ghost btn-sm" href="${esc(gUrl(x))}" target="_blank" rel="noopener" title="Add this one to Google Calendar">+ Google</a><button class="btn btn-ghost btn-sm" type="button" data-ics="${key(x)}" title="Download a calendar file for Apple Calendar or Outlook">.ics</button></div>`).join('')}</div>`).join('')
        : '<div class="card empty"><h3>Nothing booked in the next 30 days</h3><p>Add an appointment above, or book audits from the dialer. They show here for the whole team.</p></div>';
      $$('a[data-ev]', view).forEach((a) => a.addEventListener('click', (e) => e.preventDefault()));
      wire();
      return;
    }
    const today = new Date();
    const cells = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
    $('#calb', view).innerHTML = `<div class="ac-grid">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => `<div class="ac-wd">${w}</div>`).join('')}
      ${cells.map((c) => { const xs = d.items.filter((x) => sameDay(new Date(x.start), c)); return `<div class="ac-day${c.getMonth() !== cur.getMonth() ? ' out' : ''}${sameDay(c, today) ? ' today' : ''}" data-day="${c.getTime()}" title="Click an empty spot to add an appointment"><span class="ac-n">${c.getDate()}</span>${xs.slice(0, 4).map(chip).join('')}${xs.length > 4 ? `<span class="small">+${xs.length - 4} more</span>` : ''}</div>`; }).join('')}</div>`;
    $$('.ac-day', view).forEach((cell) => cell.addEventListener('click', (e) => { if (e.target.closest('.ac-chip')) return; eventModal({ day: Number(cell.dataset.day), onDone: draw }); }));
    wire();
  };
  draw();
}
