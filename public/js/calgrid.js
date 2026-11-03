// Calendar maths. Pure (no DOM, no network), so the Worker, the browser and Node tests all share it.
// Google hands back events as ISO times or all-day dates; these helpers turn a list into something a grid can draw.

export const DAY = 864e5;
export const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const startOfWeek = (ms, firstDay = 0) => { const d = new Date(startOfDay(ms)); d.setDate(d.getDate() - ((d.getDay() - firstDay + 7) % 7)); return d.getTime(); };
export const addDays = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };
export const addMonths = (ms, n) => { const d = new Date(ms); d.setDate(1); d.setMonth(d.getMonth() + n); return d.getTime(); };
export const sameDay = (a, b) => startOfDay(a) === startOfDay(b);

// Six rows of seven days covering the month that `ms` falls in.
export function monthGrid(ms, firstDay = 0) {
  const first = new Date(startOfDay(ms)); first.setDate(1);
  const start = startOfWeek(first.getTime(), firstDay);
  const month = first.getMonth();
  return Array.from({ length: 42 }, (_, i) => {
    const day = addDays(start, i);
    return { day, inMonth: new Date(day).getMonth() === month };
  });
}
export const weekGrid = (ms, firstDay = 0, days = 7) => Array.from({ length: days }, (_, i) => ({ day: addDays(startOfWeek(ms, firstDay), i), inMonth: true }));

// An all-day event's "end" date from Google is the day after it finishes.
export function eventTimes(e) {
  const allDay = Boolean(e.start?.date && !e.start?.dateTime);
  if (allDay) {
    const s = startOfDay(Date.parse(`${e.start.date}T00:00:00`));
    const raw = e.end?.date ? startOfDay(Date.parse(`${e.end.date}T00:00:00`)) : s + DAY;
    return { allDay: true, start: s, end: Math.max(raw, s + DAY) };
  }
  const s = Date.parse(e.start?.dateTime || e.start?.date || 0);
  const en = Date.parse(e.end?.dateTime || e.end?.date || 0) || s + 30 * 60e3;
  return { allDay: false, start: s, end: Math.max(en, s + 5 * 60e3) };
}

export function slimEvent(e, calendarId = '', calColor = '') {
  const t = eventTimes(e);
  const meet = e.hangoutLink || (e.conferenceData?.entryPoints || []).find((x) => x.entryPointType === 'video')?.uri || null;
  return {
    id: e.id, calendarId, color: calColor,
    title: e.summary || '(no title)', where: e.location || '', notes: e.description || '',
    start: t.start, end: t.end, allDay: t.allDay,
    meet, link: e.htmlLink || null, organizer: e.organizer?.email || '',
    attendees: (e.attendees || []).map((a) => ({ email: a.email, name: a.displayName || '', reply: a.responseStatus || 'needsAction' })),
    leadId: e.extendedProperties?.private?.rwLead || null,
    clientId: e.extendedProperties?.private?.rwClient || null,
    mine: Boolean(e.organizer?.self || e.creator?.self),
    busy: e.transparency !== 'transparent',
    recurring: Boolean(e.recurringEventId),
  };
}

// Events that touch a given day, all-day ones first, then by start time.
export function eventsOn(events, day) {
  const from = startOfDay(day); const to = from + DAY;
  return events.filter((e) => e.start < to && e.end > from)
    .sort((a, b) => (a.allDay === b.allDay ? a.start - b.start : (a.allDay ? -1 : 1)));
}

// Side-by-side columns for events that overlap in a day or week view.
export function layoutDay(events, day) {
  const from = startOfDay(day); const to = from + DAY;
  const timed = eventsOn(events, day).filter((e) => !e.allDay);
  const cols = [];
  const placed = timed.map((e) => {
    const top = Math.max(0, (e.start - from) / DAY);
    const height = Math.max(0.018, (Math.min(e.end, to) - Math.max(e.start, from)) / DAY);
    let col = cols.findIndex((end) => end <= e.start);
    if (col === -1) { col = cols.length; cols.push(0); }
    cols[col] = e.end;
    return { ...e, top, height, col };
  });
  // How many columns actually overlap each event, so widths are right.
  return placed.map((e) => {
    const group = placed.filter((o) => o.start < e.end && o.end > e.start);
    const width = Math.max(...group.map((o) => o.col)) + 1;
    return { ...e, of: width };
  });
}

export const allDayOn = (events, day) => eventsOn(events, day).filter((e) => e.allDay);

export function clockLabel(ms, withMinutes = true) {
  const d = new Date(ms);
  const h = d.getHours(); const m = d.getMinutes();
  const ampm = h < 12 ? 'am' : 'pm';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return !withMinutes && m === 0 ? `${hr}${ampm}` : `${hr}:${String(m).padStart(2, '0')}${ampm}`;
}
export const spanLabel = (e) => (e.allDay ? 'All day' : `${clockLabel(e.start)} to ${clockLabel(e.end)}`);

// "2026-11-03T14:30" for a datetime-local input, in the browser's own zone.
export function inputValue(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const dateValue = (ms) => inputValue(ms).slice(0, 10);

// Free gaps in working hours on one day, for "find a time".
export function freeGaps(events, day, { startHour = 9, endHour = 17, minutes = 30 } = {}) {
  const from = startOfDay(day) + startHour * 36e5;
  const to = startOfDay(day) + endHour * 36e5;
  const busy = eventsOn(events, day).filter((e) => !e.allDay && e.busy).map((e) => [e.start, e.end]).sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let at = from;
  for (const [s, e] of busy) {
    if (s > at) gaps.push([at, Math.min(s, to)]);
    at = Math.max(at, e);
    if (at >= to) break;
  }
  if (at < to) gaps.push([at, to]);
  return gaps.filter(([s, e]) => e - s >= minutes * 60e3).map(([s, e]) => ({ start: s, end: e }));
}
