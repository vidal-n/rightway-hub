// The time based fields of a lead, worked out in the browser (Nov 2026: the Pipeline keeps every lead in a local cache, so these must
// never come from the server or they go stale). Pure; the same rules as decorate() in src/crm.js.
import { ZONE_SHORT, canCallNow, STATE_RULES } from './timezone.js';
import { dtf } from './fmtcache.js';
import { tradeOf } from './leadintel.js';
import { unpackHours, openAt, nowText, hoursText } from './hours.js';
import { ownerReach } from './reach.js';

export function localTime(tz, at = Date.now()) {
  try { return dtf('en-US', { timeZone: tz || 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(at); } catch { return ''; }
}
// Tens of thousands of leads share a handful of zones: work each zone out once a minute.
let memoMin = -1; const memo = new Map();
const once = (key, at, fn) => { const m = Math.floor(at / 60e3); if (m !== memoMin) { memoMin = m; memo.clear(); } if (!memo.has(key)) memo.set(key, fn()); return memo.get(key); };
export function liveLead(l, at = Date.now()) {
  const tz = l.timezone || null;
  l.industry = tradeOf(l) || l.industry; // never the search keyword when Google says otherwise
  l.scrubbed = Boolean(l.scrubbed_at);
  l.researched = Boolean(l.intel_at);
  l.tz_short = ZONE_SHORT[tz] || null;
  l.tz_alt_short = ZONE_SHORT[l.tz_alt] || null;
  l.local_time = tz ? once(`t|${tz}`, at, () => localTime(tz, at)) : '';
  l.callable_now = !l.dnc && once(`c|${tz}|${l.tz_alt || ''}|${STATE_RULES[String(l.state || '').toUpperCase()] ? String(l.state).toUpperCase() : ''}`, at, () => canCallNow(tz, l.tz_alt, at, l.state));
  l.tz_known = Boolean(tz);
  // Business hours (lead_hours, packed): open now in their zone, open on Saturday or Sunday, and the short text for list cells.
  // hours_state: 'open' | 'closed' | 'unknown' (no hours, or no time zone to read them in); 'gone' when Google says closed.
  const hrs = l.hrs || '';
  const week = hrs ? once(`w|${hrs}`, at, () => unpackHours(hrs)) : null;
  const open = week && tz ? once(`o|${hrs}|${tz}`, at, () => openAt(week, tz, at)) : null;
  l.hours_known = Boolean(week);
  l.open_now = open;
  l.hours_state = l.biz_status ? 'gone' : open == null ? 'unknown' : open ? 'open' : 'closed';
  l.open_sat = week ? Boolean(week[6] && week[6].length) : null;
  l.open_sun = week ? Boolean(week[7] && week[7].length) : null;
  l.hours_now = week && tz ? once(`n|${hrs}|${tz}`, at, () => nowText(week, tz, at)) : '';
  l.hours_text = week ? once(`x|${hrs}`, at, () => hoursText(week)) : '';
  // Owner reach tier (T1 to T4), worked out here from what the row already carries, so it never goes stale in the local cache.
  const r = ownerReach(l);
  l.rtier = r.tier; l.rscore = r.score; l.rconf = r.conf; l.rwhy = r.why; l.runchecked = r.unchecked; l.rflagsl = r.flags;
  return l;
}
// A packed page ({cols, rows}) back into lead objects.
export const unpack = (d) => {
  const cols = d.cols || []; const n = cols.length;
  return (d.rows || []).map((r) => { const o = {}; for (let i = 0; i < n; i++) o[cols[i]] = r[i]; return o; });
};
