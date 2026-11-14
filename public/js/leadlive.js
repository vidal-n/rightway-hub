// The time based fields of a lead, worked out in the browser (Nov 2026: the Pipeline keeps every lead in a local cache, so these must
// never come from the server or they go stale). Pure; the same rules as decorate() in src/crm.js.
import { ZONE_SHORT, canCallNow } from './timezone.js';
import { dtf } from './fmtcache.js';

export function localTime(tz, at = Date.now()) {
  try { return dtf('en-US', { timeZone: tz || 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(at); } catch { return ''; }
}
// Tens of thousands of leads share a handful of zones: work each zone out once a minute.
let memoMin = -1; const memo = new Map();
const once = (key, at, fn) => { const m = Math.floor(at / 60e3); if (m !== memoMin) { memoMin = m; memo.clear(); } if (!memo.has(key)) memo.set(key, fn()); return memo.get(key); };
export function liveLead(l, at = Date.now()) {
  const tz = l.timezone || null;
  l.scrubbed = Boolean(l.scrubbed_at);
  l.researched = Boolean(l.intel_at);
  l.tz_short = ZONE_SHORT[tz] || null;
  l.tz_alt_short = ZONE_SHORT[l.tz_alt] || null;
  l.local_time = tz ? once(`t|${tz}`, at, () => localTime(tz, at)) : '';
  l.callable_now = !l.dnc && once(`c|${tz}|${l.tz_alt || ''}|${String(l.state || '').toUpperCase() === 'MD' ? 'MD' : ''}`, at, () => canCallNow(tz, l.tz_alt, at, l.state));
  l.tz_known = Boolean(tz);
  return l;
}
// A packed page ({cols, rows}) back into lead objects.
export const unpack = (d) => {
  const cols = d.cols || []; const n = cols.length;
  return (d.rows || []).map((r) => { const o = {}; for (let i = 0; i < n; i++) o[cols[i]] = r[i]; return o; });
};
