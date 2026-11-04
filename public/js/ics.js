// Calendar files (.ics) and "Add to Google Calendar" links. Pure, shared by the Worker and the browser, tested in Node.
const text = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
export const stamp = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// Lines over 75 bytes are folded with a leading space, as the format requires.
function fold(line) {
  const out = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 74) {
    let cut = 70;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 74) cut -= 1;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}
export function icsEvent(e, { method } = {}) {
  const end = e.start + Math.max(5, Number(e.minutes) || 30) * 60e3;
  const lines = [
    'BEGIN:VEVENT', `UID:${e.uid}@rightway-hub`, `DTSTAMP:${stamp(e.now || Date.now())}`, `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${text(e.title)}`,
  ];
  if (e.description) lines.push(`DESCRIPTION:${text(e.description)}`);
  if (e.location) lines.push(`LOCATION:${text(e.location)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  if (e.organizer?.email) lines.push(`ORGANIZER;CN=${text(e.organizer.name || e.organizer.email)}:mailto:${e.organizer.email}`);
  for (const a of e.attendees || []) lines.push(`ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${a}`);
  lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(e.title)}`, 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT');
  return lines;
}
export function icsCalendar(events, { name = 'Rightway Hub', method } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rightway Growth//Hub//EN', 'CALSCALE:GREGORIAN'];
  if (method) lines.push(`METHOD:${method}`);
  else lines.push(`X-WR-CALNAME:${text(name)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H');
  for (const e of events) lines.push(...icsEvent(e));
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
export function googleAddUrl({ title, start, minutes = 30, details = '', location = '' }) {
  const end = start + Math.max(5, Number(minutes) || 30) * 60e3;
  const q = new URLSearchParams({ action: 'TEMPLATE', text: title || 'Appointment', dates: `${stamp(start)}/${stamp(end)}`, details, location });
  return `https://calendar.google.com/calendar/render?${q}`;
}
