// Booking slot math in any IANA time zone, with no libraries. Pure, so it runs in the Worker, the browser, and the tests.

function partsIn(tz, at) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  const o = {};
  for (const p of f.formatToParts(at)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, min: +o.minute, s: +o.second, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday) };
}

// Epoch ms for a wall clock time in a time zone (handles daylight saving).
export function zoned(y, m, d, h, min, tz) {
  let guess = Date.UTC(y, m - 1, d, h, min);
  for (let i = 0; i < 2; i++) {
    const p = partsIn(tz, guess);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    guess += Date.UTC(y, m - 1, d, h, min) - asUtc;
  }
  return guess;
}

export function wallDate(tz, at) {
  const p = partsIn(tz, at);
  return { y: p.y, m: p.m, d: p.d, wd: p.wd, h: p.h, min: p.min };
}

// Open slots: weekdays and hours in the booking time zone, minus busy times, buffer, and minimum notice.
export function openSlots({ from = Date.now(), days = 14, tz = 'America/New_York', weekdays = [1, 2, 3, 4, 5], startHour = 9, endHour = 17, minutes = 30, buffer = 15, noticeHours = 4, busy = [], step = 30, max = 200 } = {}) {
  const out = [];
  const earliest = from + noticeHours * 3600e3;
  const start = wallDate(tz, from);
  for (let i = 0; i < days && out.length < max; i++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    if (!weekdays.includes(day.getUTCDay())) continue;
    for (let mins = startHour * 60; mins + minutes <= endHour * 60; mins += step) {
      const s = zoned(y, m, d, Math.floor(mins / 60), mins % 60, tz);
      const e = s + minutes * 60e3;
      if (s < earliest) continue;
      const clash = busy.some(([bs, be]) => s < be + buffer * 60e3 && e > bs - buffer * 60e3);
      if (!clash) out.push(s);
      if (out.length >= max) break;
    }
  }
  return out;
}
