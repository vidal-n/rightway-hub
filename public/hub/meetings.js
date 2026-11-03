// Client Meetings tab: book a Google Meet with a calendar invite, a ready agenda from their numbers, notes during the call,
// a short summary the client sees, and Mark held (checks off the month's meeting task).
import { $, $$, esc, api, toast, copy, busy, icon } from './core.js';

const when = (t) => new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const localInput = (t) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60e3); return d.toISOString().slice(0, 16); };
function nextSlot() { const d = new Date(Date.now() + 2 * 864e5); d.setHours(10, 0, 0, 0); while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1); return d.getTime(); }

export async function meetingsTab(el, c) {
  el.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/meetings`); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const upcoming = d.meetings.filter((m) => m.status === 'scheduled').sort((a, b) => a.start - b.start);
  const past = d.meetings.filter((m) => m.status !== 'scheduled');
  el.innerHTML = `
    <div class="card"><div class="card-head"><h2>Book a meeting</h2>${d.google ? `<span class="badge">${icon.meet}Google Meet from ${esc(d.googleEmail || 'your Google')}</span>` : '<span class="badge gray">Google not connected</span>'}</div>
      ${d.google ? '' : '<p class="small muted">Connect Google on the Google page to send a calendar invite with a Meet link. Until then, paste any meeting link and the Hub still tracks the meeting.</p>'}
      <form id="mf" class="form-grid">
        <label class="field"><span>When</span><input type="datetime-local" name="start" required value="${localInput(nextSlot())}"></label>
        <label class="field"><span>Minutes</span><input type="number" name="minutes" min="15" max="180" step="15" value="${d.minutes}"></label>
        <label class="field span-all"><span>Title (optional)</span><input name="title" placeholder="${esc(c.name)} and Rightway Growth: monthly results"></label>
        <label class="field span-all"><span>Invite (emails, comma separated)</span><input name="emails" value="${esc(d.email)}"></label>
        ${d.google ? '' : '<label class="field span-all"><span>Meeting link</span><input name="link" type="url" placeholder="https://meet.google.com/..." required></label>'}
        <label class="field span-all"><span>Agenda (filled in from their numbers, edit as you like)</span><textarea name="agenda" rows="9">${esc(d.agenda)}</textarea></label>
        <div class="span-all row end"><button class="btn btn-primary" type="submit">${d.google ? `${icon.meet}Book with Google Meet` : 'Save meeting'}</button></div>
      </form></div>
    <div class="card"><div class="card-head"><h2>Coming up</h2></div>
      ${upcoming.length ? `<ul class="list">${upcoming.map(item).join('')}</ul>` : '<p class="muted">No meetings booked.</p>'}</div>
    ${past.length ? `<div class="card"><div class="card-head"><h2>Past meetings</h2></div><ul class="list">${past.map(item).join('')}</ul></div>` : ''}`;
  $('#mf', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target).entries());
    b.start = new Date(b.start).getTime();
    const btn = e.target.querySelector('button[type=submit]');
    busy(btn, true);
    try { const r = await api(`/api/clients/${c.id}/meetings`, { method: 'POST', body: b }); toast(r.invited.length ? `Booked. Invite sent to ${r.invited.join(', ')}` : 'Meeting saved'); meetingsTab(el, c); }
    catch (err) { toast(err.message, true); busy(btn, false); }
  });
  $$('.meet-item', el).forEach((li) => wire(li, d.meetings.find((m) => m.id === li.dataset.id), () => meetingsTab(el, c)));
}

function item(m) {
  const st = m.status === 'held' ? '<span class="badge">Held</span>' : m.status === 'cancelled' ? '<span class="badge gray">Cancelled</span>' : `<span class="badge warn">${esc(when(m.start))}</span>`;
  return `<li class="item meet-item" data-id="${esc(m.id)}">${st}
    <div><div class="item-title">${esc(m.title)}</div><div class="item-sub">${esc(when(m.start))} · ${m.minutes} min${m.calendar ? ' · calendar invite sent' : ''}${m.attendees?.length ? ` · ${esc(m.attendees.join(', '))}` : ''}</div>
      <details${m.status === 'scheduled' && m.start - Date.now() < 3 * 3600e3 ? ' open' : ''}><summary class="small">Agenda, notes and summary</summary>
        <div class="form-grid" style="grid-template-columns:1fr;margin-top:8px">
          <label class="field"><span>Agenda</span><textarea data-f="agenda" rows="6">${esc(m.agenda)}</textarea></label>
          <label class="field"><span>Notes (private to the team)</span><textarea data-f="notes" rows="5" placeholder="What they said, what they want, follow ups">${esc(m.notes || '')}</textarea></label>
          <label class="field"><span>Summary for the client (shows in their app)</span><textarea data-f="summary" rows="3">${esc(m.summary || '')}</textarea></label>
          <div class="row"><button class="btn btn-ghost btn-sm" data-a="save">Save</button>${m.status === 'scheduled' ? `<button class="btn btn-primary btn-sm" data-a="held">${icon.check}Mark held</button>
            <label class="small row" style="gap:6px">Move to <input type="datetime-local" data-f="start" value="${localInput(m.start)}"></label><button class="btn btn-ghost btn-sm" data-a="move">Move</button>
            <button class="btn btn-danger btn-sm" data-a="cancel">Cancel meeting</button>` : ''}<button class="icon-btn" data-a="del" title="Delete">${icon.trash}</button></div>
        </div></details></div>
    <div class="item-actions">${m.meet && m.status === 'scheduled' ? `<a class="btn btn-primary btn-sm" href="${esc(m.meet)}" target="_blank" rel="noopener">${icon.meet}Join</a><button class="btn btn-ghost btn-sm" data-a="copy">Copy link</button>` : ''}</div></li>`;
}

function wire(li, m, refresh) {
  li.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const val = (f) => $(`[data-f="${f}"]`, li)?.value;
    const texts = { agenda: val('agenda'), notes: val('notes'), summary: val('summary') };
    try {
      if (b.dataset.a === 'copy') return copy(m.meet, 'Meeting link copied');
      busy(b, true);
      if (b.dataset.a === 'save') { await api(`/api/meetings/${m.id}`, { method: 'PATCH', body: texts }); toast('Saved'); busy(b, false); return; }
      if (b.dataset.a === 'held') { await api(`/api/meetings/${m.id}`, { method: 'PATCH', body: { ...texts, status: 'held' } }); toast('Marked held. The meeting task is checked off.'); }
      if (b.dataset.a === 'move') { await api(`/api/meetings/${m.id}`, { method: 'PATCH', body: { start: new Date(val('start')).getTime() } }); toast(m.calendar ? 'Moved. The client gets the updated invite.' : 'Moved'); }
      if (b.dataset.a === 'cancel') { if (!confirm('Cancel this meeting? The client gets a cancellation from Google Calendar.')) { busy(b, false); return; } await api(`/api/meetings/${m.id}`, { method: 'PATCH', body: { status: 'cancelled' } }); toast('Cancelled'); }
      if (b.dataset.a === 'del') { if (!confirm('Delete this meeting from the Hub?')) { busy(b, false); return; } await api(`/api/meetings/${m.id}`, { method: 'DELETE' }); }
      refresh();
    } catch (err) { toast(err.message, true); busy(b, false); }
  });
}

// Client app: the next meeting with a Join button, and the last summary.
export async function nextMeetingCard(clientId) {
  try {
    const { meetings } = await api(`/api/clients/${clientId}/meetings`);
    const next = meetings.filter((m) => m.status === 'scheduled' && m.start > Date.now() - 3600e3).sort((a, b) => a.start - b.start)[0];
    const last = meetings.find((m) => m.status === 'held' && m.summary);
    if (!next && !last) return '';
    return `<div class="card"><div class="card-head"><h2>Meetings</h2></div>
      ${next ? `<div class="row"><div><div class="item-title">${esc(when(next.start))}</div><div class="small muted">${esc(next.title)}</div></div><span class="spacer"></span>${next.meet ? `<a class="btn btn-primary btn-sm" href="${esc(next.meet)}" target="_blank" rel="noopener">${icon.meet}Join</a>` : ''}</div>` : ''}
      ${last ? `<p class="small" style="margin-top:10px"><b>From our last meeting:</b> ${esc(last.summary)}</p>` : ''}</div>`;
  } catch { return ''; }
}
