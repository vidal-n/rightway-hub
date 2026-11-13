// "Today" for the team. The Worker runs in UTC, so a plain midnight would end the day at 7 pm in New York
// and a rep's evening dials would vanish from the counters. Pure, so tests can use it.
import { dtf } from '../public/js/fmtcache.js';
export const TZ = 'America/New_York';

// Midnight in a time zone (New York unless told otherwise), as a timestamp.
export function dayStart(t = Date.now(), tz = TZ) {
  const p = Object.fromEntries(dtf('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const sinceMidnight = ((+p.hour * 60 + +p.minute) * 60 + +p.second) * 1000 + (t % 1000);
  return t - sinceMidnight;
}

// The start of the rep's day: what their browser sent (its own midnight) when that is sane, else midnight in New York.
// Sane = within the last 25 hours, so a wrong clock or a made up number cannot hide or invent dials.
export function dayFrom(raw, t = Date.now(), tz = TZ) {
  const n = Number(raw);
  if (Number.isFinite(n) && n <= t && n > t - 25 * 36e5) return n;
  return dayStart(t, tz);
}

// Today's date as YYYY-MM-DD in New York (task due dates are plain dates, so "due today" must use the team's day, not UTC's).
export const dayKey = (t = Date.now(), tz = TZ) => dtf('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
