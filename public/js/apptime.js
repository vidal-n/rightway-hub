// Appointment times across time zones. Pure and shared (Hub, Worker, tests).
// A booking is one moment in time. The rep types a wall clock time in a chosen zone (usually the lead's),
// we turn that into the moment, and every screen shows the moment in both zones, with the zone name.

const parts = (t, tz) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  .formatToParts(t).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));

// How far a zone is ahead of UTC at that moment, in ms.
export function offsetMs(t, tz) {
  const p = parts(t, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}

// The moment for a wall clock time in a zone: zonedToUtc(2026, 11, 11, 12, 45, 'America/New_York').
export function zonedToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz);       // second pass settles the hour around daylight saving changes
  return t;
}

// Parse "2026-11-11" and "12:45" typed in a zone into a moment (null when it is not a real time).
export function fromInputs(date, time, tz) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const t = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
  if (!d || !t || !tz) return null;
  const [y, mo, da] = [+d[1], +d[2], +d[3]];
  const [h, mi] = [+t[1], +t[2]];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null;
  const ms = zonedToUtc(y, mo, da, h, mi, tz);
  // Reject a time that does not exist (spring forward gap) instead of quietly moving it.
  const back = parts(ms, tz);
  if (back.hour !== h || back.minute !== mi) return null;
  return ms;
}

// The wall clock date and time a moment shows in a zone, for filling the form.
export function inputsIn(t, tz) {
  const p = parts(t, tz);
  const pad = (n) => String(n).padStart(2, '0');
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

// "12:45 PM EST" in a zone.
export function clockIn(t, tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(t);
}
// "Wed, Nov 11" in a zone.
export function dayIn(t, tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(t);
}
// "Wed, Nov 11, 12:45 PM EST" in a zone.
export function whenIn(t, tz) {
  return `${dayIn(t, tz)}, ${clockIn(t, tz)}`;
}
// Both zones at once: "12:45 PM EST (your time) · 9:45 AM PST (their time)". Same day or a day apart is spelled out.
export function bothTimes(t, theirTz, yourTz) {
  const mine = whenIn(t, yourTz);
  const theirs = whenIn(t, theirTz);
  if (!theirTz || theirTz === yourTz) return `${mine}`;
  return `${mine} (your time) · ${theirs} (their time)`;
}

// Zones the rep can pick for a lead, with the one the lead is in first.
export const ZONE_CHOICES = [
  ['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'],
  ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii'],
];
export function validZone(z) {
  if (!z || typeof z !== 'string' || z.length > 64) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return z; } catch { return null; }
}
