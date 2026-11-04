// The team appointment calendar: every booked audit and client meeting, for everyone who is logged in. View only.
import { $, $$, esc, api } from './core.js';
import { staffShell } from './shell.js';

const DAY = 864e5;
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const timeOf = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export async function apptCalendarPage(app, user, sub) {
  const view = staffShell(app, user, 'calendar');
  let cur = startOfMonth(new Date());
  let mode = sub === 'list' ? 'list' : 'month';
  const draw = async () => {
    const gridStart = new Date(cur); gridStart.setDate(1 - gridStart.getDay());
    const from = mode === 'month' ? gridStart.getTime() : new Date().setHours(0, 0, 0, 0);
    const to = mode === 'month' ? from + 42 * DAY : from + 30 * DAY;
    view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Appointments</p><h1>${mode === 'month' ? esc(cur.toLocaleDateString([], { month: 'long', year: 'numeric' })) : 'Next 30 days'}</h1></div>
      <div class="row"><div class="seg"><button type="button" data-m="month" class="${mode === 'month' ? 'is-on' : ''}">Month</button><button type="button" data-m="list" class="${mode === 'list' ? 'is-on' : ''}">List</button></div>
      ${mode === 'month' ? '<div class="seg"><button type="button" id="cprev">&larr;</button><button type="button" id="ctoday">Today</button><button type="button" id="cnext">&rarr;</button></div>' : ''}</div></div>
      <p class="small muted" style="margin:-8px 0 14px">Every booked audit and client meeting, for the whole team. View only: book from a lead (Book meeting) or the booking page.</p>
      <div id="calb"><div class="skeleton"></div></div>`;
    $$('[data-m]', view).forEach((b) => b.addEventListener('click', () => { mode = b.dataset.m; draw(); }));
    $('#cprev', view)?.addEventListener('click', () => { cur = new Date(cur.getFullYear(), cur.getMonth() - 1, 1); draw(); });
    $('#cnext', view)?.addEventListener('click', () => { cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); draw(); });
    $('#ctoday', view)?.addEventListener('click', () => { cur = startOfMonth(new Date()); draw(); });
    let d;
    try { d = await api(`/api/appointments?from=${from}&to=${to}`); } catch (e) { $('#calb', view).innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
    const chip = (x) => `<${x.open ? 'a' : 'span'} class="ac-chip ${x.kind}${x.start < Date.now() ? ' past' : ''}" ${x.open ? `href="${x.kind === 'audit' ? `#/pipeline/${esc(x.id)}` : `#/client/${esc(x.id)}/meetings`}"` : ''} title="${esc(`${x.title} · ${x.by}`)}"><b>${esc(timeOf(x.start))}</b> ${esc(x.title)}</${x.open ? 'a' : 'span'}>`;
    if (mode === 'list') {
      const days = new Map();
      for (const x of d.items) { const k = new Date(x.start).toDateString(); if (!days.has(k)) days.set(k, []); days.get(k).push(x); }
      $('#calb', view).innerHTML = days.size ? [...days.entries()].map(([k, xs]) => `<div class="card" style="margin-bottom:10px"><div class="card-head"><h3>${esc(new Date(k).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }))}</h3><span class="badge gray">${xs.length}</span></div>
        ${xs.map((x) => `<div class="row" style="flex-wrap:nowrap;gap:12px;padding:8px 0;border-top:1px solid var(--line)"><span class="mono" style="min-width:76px">${esc(timeOf(x.start))}</span>
          <span class="badge ${x.kind === 'audit' ? '' : 'gray'}">${x.kind === 'audit' ? 'Audit' : 'Client'}</span><b style="flex:1;min-width:0">${x.open ? `<a href="${x.kind === 'audit' ? `#/pipeline/${esc(x.id)}` : `#/client/${esc(x.id)}/meetings`}">${esc(x.title)}</a>` : esc(x.title)}</b>
          <span class="small">${esc([x.who, x.city, x.by].filter(Boolean).join(' · '))}</span>${x.link ? `<a class="btn btn-ghost btn-sm" href="${esc(x.link)}" target="_blank" rel="noopener">Join</a>` : ''}
          ${x.kind === 'audit' && x.open ? `<a class="btn btn-ghost btn-sm" href="/present.html#${esc(x.id)}" target="_blank" rel="noopener">Present</a>` : ''}</div>`).join('')}</div>`).join('')
        : '<div class="card empty"><h3>Nothing booked in the next 30 days</h3><p>Book audits from the dialer. They show here for the whole team.</p></div>';
      return;
    }
    const today = new Date();
    const cells = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
    $('#calb', view).innerHTML = `<div class="ac-grid">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => `<div class="ac-wd">${w}</div>`).join('')}
      ${cells.map((c) => { const xs = d.items.filter((x) => sameDay(new Date(x.start), c)); return `<div class="ac-day${c.getMonth() !== cur.getMonth() ? ' out' : ''}${sameDay(c, today) ? ' today' : ''}"><span class="ac-n">${c.getDate()}</span>${xs.slice(0, 4).map(chip).join('')}${xs.length > 4 ? `<span class="small">+${xs.length - 4} more</span>` : ''}</div>`; }).join('')}</div>`;
  };
  draw();
}
