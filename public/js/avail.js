// Available slots: the days and hours a person takes calls, how many a day, and the gap between calls.
// Pure and shared (Worker, Hub, tests). No availability saved = no limits.
const DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DEFAULT_TZ = 'America/New_York';
const num = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

// days: { "1": [[540, 1020]], ... } minutes from midnight in `tz`, Monday = 1. max: calls a day (0 = no limit). gap: minutes between calls.
export function cleanAvail(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const days = {};
  for (let d = 1; d <= 7; d++) {
    const spans = Array.isArray(raw.days?.[d]) ? raw.days[d] : [];
    const ok = spans.map((s) => [num(s?.[0], 0, 1440, 0), num(s?.[1], 0, 1440, 0)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]).slice(0, 4);
    if (ok.length) days[d] = ok;
  }
  let tz = DEFAULT_TZ;
  try { if (typeof raw.tz === 'string' && raw.tz.length < 64) { new Intl.DateTimeFormat('en-US', { timeZone: raw.tz }); tz = raw.tz; } } catch { /* default */ }
  return { tz, days, max: num(raw.max, 0, 30, 0), gap: num(raw.gap, 0, 120, 0) };
}

// The weekday (1 = Monday), minutes from midnight and calendar day of a moment in a zone.
export function wall(t, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(t).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return { dow: DOW[p.weekday], min: Number(p.hour) * 60 + Number(p.minute), day: `${p.year}-${p.month}-${p.day}` };
}
export const clock = (m) => { const h = Math.floor(m / 60) % 24; const mi = m % 60; return `${h % 12 || 12}${mi ? `:${String(mi).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };

// Does a call of `minutes` starting at `t` sit inside the person's open hours? Returns a plain reason or null.
export function outsideHours(av, t, minutes = 30) {
  if (!av) return null;
  const hasAny = Object.keys(av.days || {}).length > 0;
  if (!hasAny) return null;                       // hours never filled in: nothing to enforce
  const a = wall(t, av.tz);
  const b = wall(t + minutes * 60e3 - 1, av.tz);
  const spans = av.days[a.dow] || [];
  if (a.day !== b.day) return `That call runs past midnight in ${av.tz.replace(/_/g, ' ')}.`;
  if (!spans.length) return `${DAY_NAMES[a.dow - 1]} is not one of their days.`;
  if (!spans.some(([s, e]) => a.min >= s && b.min < e)) return `${DAY_NAMES[a.dow - 1]} they take calls ${spans.map(([s, e]) => `${clock(s)} to ${clock(e)}`).join(' and ')}.`;
  return null;
}
// The calls already booked that day count against the limit. `others` = start times of their other calls.
export function overLimit(av, t, others = []) {
  if (!av?.max) return null;
  const day = wall(t, av.tz).day;
  const n = others.filter((o) => wall(o, av.tz).day === day).length;
  return n >= av.max ? `They already have ${n} call${n === 1 ? '' : 's'} that day (limit ${av.max}).` : null;
}
// Is another call too close, counting the gap they want between calls?
export function tooClose(av, t, minutes, others = [], minutesOf = 30) {
  if (!av?.gap) return null;
  const gap = av.gap * 60e3;
  const hit = others.find((o) => o < t + minutes * 60e3 + gap && o + minutesOf * 60e3 + gap > t);
  return hit ? `That is closer than ${av.gap} minutes to another call.` : null;
}
export function availText(av) {
  if (!av || !Object.keys(av.days || {}).length) return 'No hours set. Any time can be booked.';
  const parts = [];
  for (let d = 1; d <= 7; d++) if (av.days[d]) parts.push(`${DAY_NAMES[d - 1].slice(0, 3)} ${av.days[d].map(([s, e]) => `${clock(s)} to ${clock(e)}`).join(', ')}`);
  return `${parts.join(' · ')}${av.max ? ` · up to ${av.max} a day` : ''}${av.gap ? ` · ${av.gap} min between calls` : ''}`;
}
