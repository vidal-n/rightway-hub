// Google Calendar inside the Hub: month, week and day views, drag to make an event, Meet links,
// invites pulled from leads and clients, and a side list of what is next.
import { $, $$, esc, api, toast, busy, icon, modal, copy } from './core.js';
import { staffShell } from './staff.js';
import { googleTabs } from './googleapps.js';
import {
  DAY, startOfDay, startOfWeek, addDays, addMonths, sameDay, monthGrid, weekGrid,
  eventsOn, allDayOn, layoutDay, clockLabel, spanLabel, inputValue, freeGaps,
} from '../js/calgrid.js';

const S = { view: 'month', at: Date.now(), cals: [], on: new Set(), events: [], leads: [], clients: [], email: '' };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const range = () => {
  if (S.view === 'month') { const g = monthGrid(S.at); return [g[0].day, g[41].day + DAY]; }
  if (S.view === 'week') return [startOfWeek(S.at), startOfWeek(S.at) + 7 * DAY];
  return [startOfDay(S.at), startOfDay(S.at) + DAY];
};
const title = () => {
  if (S.view === 'month') return `${MONTHS[new Date(S.at).getMonth()]} ${new Date(S.at).getFullYear()}`;
  if (S.view === 'week') { const s = startOfWeek(S.at); const e = addDays(s, 6); return `${MONTHS[new Date(s).getMonth()].slice(0, 3)} ${new Date(s).getDate()} to ${MONTHS[new Date(e).getMonth()].slice(0, 3)} ${new Date(e).getDate()}`; }
  return new Date(S.at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
};

export async function calendarPage(app, user, sub = '') {
  const view = staffShell(app, user, 'google');
  if (['month', 'week', 'day'].includes(sub)) S.view = sub;
  view.innerHTML = `${googleTabs('calendar')}<div class="skeleton" style="height:420px"></div>`;
  let c;
  try { c = await api('/api/google/cal/calendars'); }
  catch (e) {
    view.innerHTML = `${googleTabs('calendar')}<div class="card"><h2>Calendar is not on yet</h2><p>${esc(e.message)}</p><a class="btn btn-primary" href="/api/google/connect?back=google">Turn on Calendar</a></div>`;
    return;
  }
  S.cals = c.calendars; S.email = c.email || '';
  if (!S.on.size) S.cals.filter((x) => x.selected).slice(0, 6).forEach((x) => S.on.add(x.id));
  if (!S.on.size && S.cals[0]) S.on.add(S.cals[0].id);
  view.innerHTML = `${googleTabs('calendar')}
    <div class="cal-head">
      <div class="row" style="gap:8px">
        <button class="btn btn-primary btn-sm" id="cal-new">${icon.plus} New event</button>
        <button class="btn btn-ghost btn-sm" id="cal-today">Today</button>
        <button class="icon-btn" id="cal-prev" aria-label="Back">${icon.back}</button>
        <button class="icon-btn" id="cal-next" aria-label="Forward">${icon.next}</button>
        <h1 id="cal-title" style="font-size:22px;margin:0">${esc(title())}</h1>
      </div>
      <div class="row" style="gap:6px">
        <div class="seg" id="cal-views">${['month', 'week', 'day'].map((v) => `<button data-view="${v}" class="${S.view === v ? 'is-on' : ''}">${v[0].toUpperCase()}${v.slice(1)}</button>`).join('')}</div>
        <button class="btn btn-ghost btn-sm" id="cal-pick">Calendars</button>
      </div>
    </div>
    <div class="cal-wrap"><div id="cal-body"></div><aside class="cal-side" id="cal-side"></aside></div>`;
  $('#cal-new', view).addEventListener('click', () => editEvent({ start: suggestStart() }));
  $('#cal-today', view).addEventListener('click', () => { S.at = Date.now(); load(); });
  $('#cal-prev', view).addEventListener('click', () => { S.at = step(-1); load(); });
  $('#cal-next', view).addEventListener('click', () => { S.at = step(1); load(); });
  $('#cal-pick', view).addEventListener('click', pickCalendars);
  $$('[data-view]', view).forEach((b) => b.addEventListener('click', () => {
    S.view = b.dataset.view;
    location.hash = `#/google/calendar/${S.view}`;
    $$('[data-view]').forEach((x) => x.classList.toggle('is-on', x.dataset.view === S.view));
    load();
  }));
  document.addEventListener('keydown', onKeys);
  await load();
}

function onKeys(e) {
  if (!location.hash.startsWith('#/google/calendar') || e.target.matches('input, textarea, [contenteditable]')) return;
  if (e.key === 'm') { S.view = 'month'; load(); }
  if (e.key === 'w') { S.view = 'week'; load(); }
  if (e.key === 'd') { S.view = 'day'; load(); }
  if (e.key === 't') { S.at = Date.now(); load(); }
}
const step = (n) => (S.view === 'month' ? addMonths(S.at, n) : addDays(S.at, n * (S.view === 'week' ? 7 : 1)));
function suggestStart() {
  const base = sameDay(S.at, Date.now()) ? Date.now() : startOfDay(S.at) + 9 * 36e5;
  return Math.ceil(base / (30 * 60e3)) * 30 * 60e3;
}

async function load() {
  const box = $('#cal-body');
  if (!box) return;
  $('#cal-title').textContent = title();
  $$('[data-view]').forEach((x) => x.classList.toggle('is-on', x.dataset.view === S.view));
  box.innerHTML = '<div class="skeleton" style="height:420px"></div>';
  const [from, to] = range();
  const colors = S.cals.filter((c) => S.on.has(c.id)).map((c) => `${c.id}|${c.color}`).join(',');
  let d;
  try { d = await api(`/api/google/cal/events?${new URLSearchParams({ from: String(from), to: String(to), cals: [...S.on].join(','), colors })}`); }
  catch (e) { box.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  S.events = d.events; S.leads = d.leads; S.clients = d.clients;
  const bad = Object.values(d.errors || {});
  box.innerHTML = (bad.length ? `<p class="small err-text">${esc(bad[0])}</p>` : '') + (S.view === 'month' ? monthView() : dayish());
  wire(box);
  side();
}

// ---------- month ----------
function monthView() {
  const cells = monthGrid(S.at);
  return `<div class="cal-month">
    ${DOW.map((d) => `<div class="cal-dow">${d}</div>`).join('')}
    ${cells.map((c) => {
      const list = eventsOn(S.events, c.day);
      const show = list.slice(0, 3);
      return `<div class="cal-cell${c.inMonth ? '' : ' is-out'}${sameDay(c.day, Date.now()) ? ' is-today' : ''}" data-day="${c.day}">
        <button class="cal-num" data-open-day="${c.day}">${new Date(c.day).getDate()}</button>
        ${show.map((e) => `<button class="cal-pill${e.allDay ? ' is-all' : ''}" data-ev="${esc(e.id)}" style="--c:${esc(e.color || '#23B07E')}">
          ${e.allDay ? '' : `<span class="cal-t">${esc(clockLabel(e.start, false))}</span>`}${esc(e.title)}</button>`).join('')}
        ${list.length > show.length ? `<button class="cal-more" data-open-day="${c.day}">${list.length - show.length} more</button>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

// ---------- week and day ----------
function dayish() {
  const days = S.view === 'week' ? weekGrid(S.at) : [{ day: startOfDay(S.at) }];
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const nowPct = ((Date.now() - startOfDay(Date.now())) / DAY) * 100;
  return `<div class="cal-time" style="--cols:${days.length}">
    <div class="cal-gut"></div>
    ${days.map((d) => `<div class="cal-colhead${sameDay(d.day, Date.now()) ? ' is-today' : ''}"><b>${DOW[new Date(d.day).getDay()]}</b><span>${new Date(d.day).getDate()}</span></div>`).join('')}
    <div class="cal-gut"></div>
    ${days.map((d) => `<div class="cal-allday">${allDayOn(S.events, d.day).map((e) => `<button class="cal-pill is-all" data-ev="${esc(e.id)}" style="--c:${esc(e.color || '#23B07E')}">${esc(e.title)}</button>`).join('')}</div>`).join('')}
    <div class="cal-gut cal-hours">${hours.map((h) => `<span>${h === 0 ? '' : clockLabel(startOfDay(0) + h * 36e5, false)}</span>`).join('')}</div>
    ${days.map((d) => `<div class="cal-col" data-day="${d.day}">
      ${hours.map((h) => `<div class="cal-slot" data-hour="${h}"></div>`).join('')}
      ${sameDay(d.day, Date.now()) ? `<div class="cal-now" style="top:${nowPct}%"></div>` : ''}
      ${layoutDay(S.events, d.day).map((e) => `<button class="cal-ev${e.height < 0.028 ? ' is-short' : ''}" data-ev="${esc(e.id)}" style="--c:${esc(e.color || '#23B07E')};top:${(e.top * 100).toFixed(3)}%;height:${(e.height * 100).toFixed(3)}%;left:${((e.col / e.of) * 100).toFixed(2)}%;width:${(100 / e.of).toFixed(2)}%">
        <b>${esc(e.title)}</b><span>${esc(spanLabel(e))}</span></button>`).join('')}
    </div>`).join('')}
  </div>`;
}

function wire(box) {
  $$('[data-ev]', box).forEach((b) => b.addEventListener('click', () => {
    const e = S.events.find((x) => x.id === b.dataset.ev);
    if (e) showEvent(e);
  }));
  $$('[data-open-day]', box).forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    S.at = Number(b.dataset.openDay); S.view = 'day'; load();
  }));
  $$('.cal-slot', box).forEach((s) => s.addEventListener('click', () => {
    const day = Number(s.closest('[data-day]').dataset.day);
    editEvent({ start: day + Number(s.dataset.hour) * 36e5 });
  }));
  $$('.cal-cell', box).forEach((c) => c.addEventListener('dblclick', () => editEvent({ start: Number(c.dataset.day) + 9 * 36e5 })));
  const col = $('.cal-col.is-today, .cal-col', box);
  if (col && S.view !== 'month') col.closest('.cal-time').scrollTop = Math.max(0, (new Date().getHours() - 2) * 56);
}

// ---------- side list ----------
function side() {
  const el = $('#cal-side');
  if (!el) return;
  const soon = S.events.filter((e) => e.end > Date.now()).sort((a, b) => a.start - b.start).slice(0, 8);
  const gaps = freeGaps(S.events, S.view === 'month' ? Date.now() : S.at);
  const dayName = sameDay(S.view === 'month' ? Date.now() : S.at, Date.now()) ? 'today' : new Date(S.at).toLocaleDateString('en-US', { weekday: 'long' });
  el.innerHTML = `
    <div class="card"><h3 style="margin:0 0 10px">What is next</h3>
      ${soon.length ? `<ul class="list">${soon.map((e) => `<li class="item"><span class="cal-dot" style="background:${esc(e.color || '#23B07E')}"></span>
        <div><div class="item-title">${esc(e.title)}</div><div class="small muted">${esc(new Date(e.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))}, ${esc(spanLabel(e))}${e.meet ? ' · Meet' : ''}</div></div>
        <button class="btn btn-ghost btn-sm" data-soon="${esc(e.id)}">Open</button></li>`).join('')}</ul>` : '<p class="small muted">Nothing coming up.</p>'}</div>
    <div class="card" style="margin-top:14px"><h3 style="margin:0 0 10px">Free ${esc(dayName)}</h3>
      ${gaps.length ? `<div class="row" style="gap:6px">${gaps.slice(0, 6).map((g) => `<button class="btn btn-ghost btn-sm" data-gap="${g.start}">${esc(clockLabel(g.start))}</button>`).join('')}</div>
        <p class="small muted" style="margin:10px 0 0">9am to 5pm. Click a time to put something there.</p>` : '<p class="small muted">Nothing free between 9am and 5pm.</p>'}</div>`;
  $$('[data-soon]', el).forEach((b) => b.addEventListener('click', () => showEvent(S.events.find((x) => x.id === b.dataset.soon))));
  $$('[data-gap]', el).forEach((b) => b.addEventListener('click', () => editEvent({ start: Number(b.dataset.gap) })));
}

// ---------- one event ----------
function showEvent(e) {
  if (!e) return;
  const lead = S.leads.find((l) => l.id === e.leadId);
  const client = S.clients.find((c) => c.id === e.clientId);
  const m = modal(`<div class="cal-view">
    <div class="card-head"><h2 style="margin:0">${esc(e.title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon.close}</button></div>
    <p class="muted" style="margin:4px 0 14px">${esc(new Date(e.start).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }))} · ${esc(spanLabel(e))}</p>
    ${e.where ? `<p><b>Where:</b> ${esc(e.where)}</p>` : ''}
    ${lead ? `<p><a class="chip" href="#/pipeline/${esc(lead.id)}">Lead: ${esc(lead.business)}</a></p>` : ''}
    ${client ? `<p><a class="chip" href="#/clients/${esc(client.id)}">Client: ${esc(client.name)}</a></p>` : ''}
    ${e.attendees.length ? `<p><b>Who is coming:</b> ${e.attendees.map((a) => `${esc(a.name || a.email)}${a.reply === 'accepted' ? ' (yes)' : a.reply === 'declined' ? ' (no)' : ''}`).join(', ')}</p>` : ''}
    ${e.notes ? `<div class="cal-notes">${esc(e.notes).replace(/\n/g, '<br>')}</div>` : ''}
    <div class="row" style="gap:8px;margin-top:16px">
      ${e.meet ? `<a class="btn btn-primary btn-sm" href="${esc(e.meet)}" target="_blank" rel="noopener">Join the Meet</a><button class="btn btn-ghost btn-sm" id="ce-copy">Copy the link</button>` : ''}
      <button class="btn btn-ghost btn-sm" id="ce-edit">Change</button>
      <button class="btn btn-ghost btn-sm" id="ce-del">Delete</button>
      ${e.link ? `<a class="btn btn-ghost btn-sm" href="${esc(e.link)}" target="_blank" rel="noopener">Open in Google</a>` : ''}
    </div></div>`);
  $('#ce-copy', m.el)?.addEventListener('click', () => copy(e.meet, 'Meet link copied'));
  $('#ce-edit', m.el).addEventListener('click', () => { m.close(); editEvent(e); });
  $('#ce-del', m.el).addEventListener('click', async (ev) => {
    busy(ev.currentTarget, true);
    try { await api(`/api/google/cal/events/${encodeURIComponent(e.id)}?calendarId=${encodeURIComponent(e.calendarId)}`, { method: 'DELETE' }); m.close(); toast('Deleted'); load(); }
    catch (err) { toast(err.message, true); busy(ev.currentTarget, false); }
  });
}

function editEvent(e = {}) {
  const isNew = !e.id;
  const start = e.start || suggestStart();
  const end = e.end || start + 30 * 60e3;
  const writable = S.cals.filter((c) => c.canWrite);
  const picked = e.calendarId || (writable.find((c) => c.primary) || writable[0] || {}).id || 'primary';
  const invited = (e.attendees || []).map((a) => a.email);
  const m = modal(`<div class="cal-edit">
    <div class="card-head"><h2 style="margin:0">${isNew ? 'New event' : 'Change event'}</h2><button class="icon-btn" data-close aria-label="Close">${icon.close}</button></div>
    <label class="field"><span>What is it</span><input id="ce-title" value="${esc(e.title || '')}" placeholder="Audit call with ..."></label>
    <div class="form-grid">
      <label class="field"><span>Starts</span><input id="ce-start" type="datetime-local" value="${inputValue(start)}"></label>
      <label class="field"><span>Ends</span><input id="ce-end" type="datetime-local" value="${inputValue(end)}"></label>
    </div>
    <div class="row" style="gap:14px;margin:4px 0 10px">
      <label class="row small" style="gap:6px"><input type="checkbox" id="ce-allday"${e.allDay ? ' checked' : ''}> All day</label>
      <label class="row small" style="gap:6px"><input type="checkbox" id="ce-meet"${isNew || e.meet ? ' checked' : ''}${e.meet && !isNew ? ' disabled' : ''}> Google Meet link</label>
    </div>
    <label class="field"><span>Calendar</span><select id="ce-cal">${writable.map((c) => `<option value="${esc(c.id)}"${c.id === picked ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label class="field" style="position:relative"><span>Invite people</span><input id="ce-who" placeholder="Start typing a lead, client or teammate" autocomplete="off"><div class="gm-sug" id="ce-sug" hidden></div></label>
    <div class="gm-files" id="ce-chips"></div>
    <label class="field"><span>Where</span><input id="ce-where" value="${esc(e.where || '')}" placeholder="Google Meet, phone, or an address"></label>
    <label class="field"><span>Notes</span><textarea id="ce-notes" rows="4">${esc(e.notes || '')}</textarea></label>
    <div class="row end" style="gap:8px;margin-top:14px"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="ce-save">${isNew ? 'Add it' : 'Save'}</button></div>
  </div>`);
  const el = m.el;
  const people = [...invited];
  let link = { leadId: e.leadId || null, clientId: e.clientId || null };
  const chips = () => {
    $('#ce-chips', el).innerHTML = people.map((p, i) => `<span class="gm-file">${esc(p)} <button type="button" data-rm="${i}" aria-label="Remove">${icon.close}</button></span>`).join('');
    $$('[data-rm]', el).forEach((b) => b.addEventListener('click', () => { people.splice(Number(b.dataset.rm), 1); chips(); }));
  };
  chips();
  const who = $('#ce-who', el); const sug = $('#ce-sug', el);
  let timer;
  who.addEventListener('input', () => {
    clearTimeout(timer);
    const q = who.value.trim();
    if (q.length < 2) { sug.hidden = true; return; }
    timer = setTimeout(async () => {
      try {
        const r = await api(`/api/google/cal/people?q=${encodeURIComponent(q)}`);
        if (!r.people.length) { sug.hidden = true; return; }
        sug.innerHTML = r.people.map((p) => `<button type="button" data-email="${esc(p.email)}" data-client="${esc(p.clientId || '')}"><b>${esc(p.name)}</b> <span class="small muted">${esc(p.email)}</span><em class="badge gray">${esc(p.kind)}</em></button>`).join('');
        sug.hidden = false;
        $$('[data-email]', sug).forEach((b) => b.addEventListener('click', () => {
          if (!people.includes(b.dataset.email)) people.push(b.dataset.email);
          if (b.dataset.client) link.clientId = b.dataset.client;
          who.value = ''; sug.hidden = true; chips(); who.focus();
        }));
      } catch { sug.hidden = true; }
    }, 220);
  });
  who.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || !who.value.includes('@')) return;
    ev.preventDefault();
    people.push(who.value.trim()); who.value = ''; chips();
  });
  who.addEventListener('blur', () => setTimeout(() => { sug.hidden = true; }, 180));
  $('#ce-start', el).addEventListener('change', () => {
    const s = Date.parse($('#ce-start', el).value);
    const en = Date.parse($('#ce-end', el).value);
    if (s && (!en || en <= s)) $('#ce-end', el).value = inputValue(s + 30 * 60e3);
  });
  $('#ce-save', el).addEventListener('click', async (ev) => {
    const payload = {
      calendarId: $('#ce-cal', el).value || 'primary',
      title: $('#ce-title', el).value, where: $('#ce-where', el).value, notes: $('#ce-notes', el).value,
      start: Date.parse($('#ce-start', el).value), end: Date.parse($('#ce-end', el).value),
      allDay: $('#ce-allday', el).checked, meet: $('#ce-meet', el).checked && !e.meet,
      attendees: people, ...link,
    };
    if (!payload.start) { toast('When does it start?', true); return; }
    busy(ev.currentTarget, true);
    try {
      if (isNew) await api('/api/google/cal/events', { method: 'POST', body: payload });
      else await api(`/api/google/cal/events/${encodeURIComponent(e.id)}`, { method: 'PATCH', body: payload });
      m.close(); toast(isNew ? 'On your calendar' : 'Saved'); load();
    } catch (err) { toast(err.message, true); busy(ev.currentTarget, false); }
  });
}

function pickCalendars() {
  const m = modal(`<div><div class="card-head"><h2 style="margin:0">Calendars</h2><button class="icon-btn" data-close aria-label="Close">${icon.close}</button></div>
    <p class="small muted">Up to 6 at a time.</p>
    <div class="cal-pick">${S.cals.map((c) => `<label class="row small cal-pick-row" style="gap:8px"><input type="checkbox" value="${esc(c.id)}"${S.on.has(c.id) ? ' checked' : ''}>
      <span class="cal-dot" style="background:${esc(c.color)}"></span> ${esc(c.name)}${c.canWrite ? '' : ' <em class="small muted">(read only)</em>'}</label>`).join('')}</div>
    <div class="row end" style="margin-top:14px"><button class="btn btn-primary btn-sm" id="cp-save">Show these</button></div></div>`);
  $('#cp-save', m.el).addEventListener('click', () => {
    const picked = $$('input:checked', m.el).map((i) => i.value).slice(0, 6);
    if (!picked.length) { toast('Pick at least one', true); return; }
    S.on = new Set(picked); m.close(); load();
  });
}
