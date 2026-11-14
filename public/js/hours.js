// Business hours (Nov 2026, V: add hours of operation to the scrubber so I know if I am calling during business hours, and Saturday lists).
// Modeled on how Google Places (regularOpeningHours periods), OpenStreetMap (opening_hours) and Outscraper (working_hours text) describe a week,
// and on schema.org openingHoursSpecification. Pure: shared by the Worker, the browser and the Node tests.
//
// One shape everywhere: { 1: [[startMin, endMin], ...], ..., 7: [...] }, Monday = 1 to Sunday = 7 (the same as users.avail).
// A day that is missing is closed. Overnight hours (6pm to 2am) are split at midnight. 0 to 1440 is open all day.
// Stored packed as text: "1:480-1020;2:480-1020;6:540-780" ('' = not known).
import { dtf } from './fmtcache.js';

const DAYS = [null, 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FULL = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };
const OSM = { mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6, su: 7 };

const clampMin = (n) => Math.max(0, Math.min(1440, Math.round(n)));

// Add one range to a week, splitting overnight hours at midnight.
function add(week, day, s, e) {
  if (!(day >= 1 && day <= 7) || s == null || e == null) return;
  s = clampMin(s); e = clampMin(e);
  if (e === s) { if (s === 0) (week[day] ||= []).push([0, 1440]); return; }
  if (e > s) { (week[day] ||= []).push([s, e]); return; }
  (week[day] ||= []).push([s, 1440]);
  if (e > 0) (week[day === 7 ? 1 : day + 1] ||= []).push([0, e]);
}

// Merge overlapping ranges, sort, drop empty days. Returns null when nothing is left.
export function cleanHours(week) {
  if (!week || typeof week !== 'object') return null;
  const out = {};
  for (let d = 1; d <= 7; d++) {
    const list = (Array.isArray(week[d]) ? week[d] : []).map(([s, e]) => [clampMin(Number(s)), clampMin(Number(e))]).filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of list) { const last = merged[merged.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]); }
    if (merged.length) out[d] = merged.slice(0, 4);
  }
  return Object.keys(out).length ? out : null;
}

export function packHours(week) {
  const w = cleanHours(week);
  if (!w) return '';
  return Object.keys(w).map((d) => `${d}:${w[d].map(([s, e]) => `${s}-${e}`).join(',')}`).join(';');
}
export function unpackHours(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const week = {};
  for (const part of s.split(';')) {
    const m = /^([1-7]):(.+)$/.exec(part.trim());
    if (!m) continue;
    week[m[1]] = m[2].split(',').map((r) => r.split('-').map(Number)).filter((r) => r.length === 2);
  }
  return cleanHours(week);
}

// ---------- sources ----------

// DataForSEO Google Maps and My Business Info: work_hours.timetable { monday: [{ open: { hour, minute }, close: { hour, minute } }] | null }.
export function fromDataForSeo(wh) {
  const t = wh && wh.timetable;
  if (!t || typeof t !== 'object') return null;
  const week = {};
  for (const [name, list] of Object.entries(t)) {
    const d = FULL[String(name).toLowerCase()];
    if (!d || !Array.isArray(list)) continue;
    for (const r of list) {
      const s = r?.open ? (Number(r.open.hour) || 0) * 60 + (Number(r.open.minute) || 0) : null;
      const e = r?.close ? (Number(r.close.hour) || 0) * 60 + (Number(r.close.minute) || 0) : null;
      if (s != null && e == null) add(week, d, s, 1440);
      else add(week, d, s, e);
    }
  }
  return cleanHours(week);
}
// 'temporarily_closed' or 'closed_forever' from DataForSEO (current_status), else ''.
export function statusFromDataForSeo(wh) {
  const s = String(wh?.current_status || '').toLowerCase();
  return s === 'temporarily_closed' || s === 'closed_forever' ? s : '';
}

// OpenStreetMap opening_hours: "Mo-Fr 08:00-17:00; Sa 09:00-13:00; Su off", "24/7", "Mo,We 08:00-12:00,13:00-17:00".
// Public holiday rules (PH) and anything we cannot read are skipped.
export function fromOsm(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (/^24\/7$/.test(s)) { const w = {}; for (let d = 1; d <= 7; d++) w[d] = [[0, 1440]]; return w; }
  const week = {};
  let any = false;
  for (const rule of s.split(';')) {
    const r = rule.trim();
    if (!r || /^(PH|SH)\b/i.test(r)) continue;
    const m = /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?\s*,?\s*)+)?\s*(.*)$/i.exec(r);
    if (!m) continue;
    const days = m[1] ? osmDays(m[1]) : [1, 2, 3, 4, 5, 6, 7];
    const rest = m[2].trim();
    if (/^(off|closed)$/i.test(rest)) { for (const d of days) week[d] = []; any = true; continue; }
    const times = [...rest.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)];
    if (!times.length) continue;
    for (const d of days) week[d] = [];
    for (const d of days) for (const t of times) add(week, d, +t[1] * 60 + +t[2], +t[3] * 60 + +t[4]);
    any = true;
  }
  return any ? cleanHours(week) : null;
}
function osmDays(spec) {
  const out = new Set();
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map((x) => OSM[x.trim().toLowerCase().slice(0, 2)]);
    if (!a) continue;
    if (!b) { out.add(a); continue; }
    for (let d = a; ; d = d === 7 ? 1 : d + 1) { out.add(d); if (d === b) break; }
  }
  return [...out];
}

// schema.org in a page's JSON-LD: openingHoursSpecification [{ dayOfWeek, opens, closes }] or openingHours "Mo-Fr 08:00-17:00".
export function fromSchema(html) {
  const blocks = [...String(html || '').matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const week = {};
  let any = false;
  const hm = (v) => { const m = /(\d{1,2}):(\d{2})/.exec(String(v || '')); return m ? +m[1] * 60 + +m[2] : null; };
  const walk = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 6) return;
    if (Array.isArray(o)) { o.forEach((x) => walk(x, depth + 1)); return; }
    const spec = o.openingHoursSpecification;
    if (spec) {
      for (const sp of [].concat(spec)) {
        const days = [].concat(sp?.dayOfWeek || []).map((d) => FULL[String(d).split('/').pop().toLowerCase()]).filter(Boolean);
        const s = hm(sp?.opens), e = hm(sp?.closes);
        if (!days.length || s == null || e == null) continue;
        for (const d of days) add(week, d, s, e === 0 && s > 0 ? 1440 : e);
        any = true;
      }
    }
    if (o.openingHours && !spec) {
      const w = fromOsm([].concat(o.openingHours).join('; '));
      if (w) { for (const [d, list] of Object.entries(w)) for (const [s, e] of list) add(week, +d, s, e); any = true; }
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, depth + 1);
  };
  for (const b of blocks) { try { walk(JSON.parse(b.trim())); } catch { /* not JSON */ } }
  return any ? cleanHours(week) : null;
}

// Plain text the way people write hours on a website, a Google listing or an Outscraper export:
// "Monday - Friday: 8:00 AM - 5:00 PM", "Mon-Sat 8am-6pm, Sun closed", "Saturday: Closed", "Open 24 hours", "Daily 9 to 5".
const DAY = '(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\\.?';
const DAYX = `${DAY}(?:\\s*(?:-|–|—|to|through|thru)\\s*${DAY})?`;
const TIME = '(?:\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)?|noon|midnight)';
const RANGE = `${TIME}\\s*(?:-|–|—|to|until|till)\\s*${TIME}`;
const DAYWORD = '(weekdays?|weekends?|daily|every\\s*day|7\\s*days(?:\\s*a\\s*week)?|mon(?:day)?\\s*-\\s*sun(?:day)?)';
const RE_LINE = new RegExp(`(${DAYX}(?:\\s*(?:,|&|and|/)\\s*${DAYX})*|${DAYWORD})\\s*[:,]?\\s*(closed|${RANGE}(?:\\s*(?:,|&|and|/)\\s*${RANGE})?)`, 'gi');
const dayNum = (s) => { const k = String(s || '').toLowerCase().replace(/\./g, ''); for (const [name, n] of Object.entries(FULL)) if (k && name.startsWith(k.slice(0, 3))) return n; return null; };

function parseTime(raw) {
  const t = String(raw).toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
  if (t === 'noon') return { m: 720, mer: 'pm' };
  if (t === 'midnight') return { m: 1440, mer: 'am' };
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(t);
  if (!m) return null;
  let h = +m[1]; const min = +(m[2] || 0);
  if (h > 24 || min > 59) return null;
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return { m: h * 60 + min, mer: m[3] || '' };
}
function parseRange(text) {
  const parts = String(text).split(/\s*(?:-|–|—|to|until|till)\s*/i).filter(Boolean);
  if (parts.length !== 2) return null;
  const a = parseTime(parts[0]), b = parseTime(parts[1]);
  if (!a || !b) return null;
  let s = a.m, e = b.m;
  // "8-5", "8am-5": an end without am or pm that is not after the start is in the afternoon.
  if (!b.mer && e <= s && e < 720) e += 720;
  // "8-5pm" keeps the start in the morning (8am), which is what a start without am or pm already means.
  if (e === 1440 && s === 0) return [0, 1440];
  return [s, e];
}
function expandDays(spec) {
  const k = spec.toLowerCase();
  if (/weekend/.test(k)) return [6, 7];
  if (/weekday/.test(k)) return [1, 2, 3, 4, 5];
  if (/daily|every\s*day|7\s*days|mon(day)?\s*-\s*sun/.test(k)) return [1, 2, 3, 4, 5, 6, 7];
  const out = new Set();
  for (const piece of k.split(/\s*(?:,|&|\band\b|\/)\s*/)) {
    const m = new RegExp(`^${DAY}(?:\\s*(?:-|–|—|to|through|thru)\\s*${DAY})?$`, 'i').exec(piece.trim());
    if (!m) continue;
    const a = dayNum(m[1]), b = dayNum(m[2]);
    if (!a) continue;
    if (!b) { out.add(a); continue; }
    for (let d = a; ; d = d === 7 ? 1 : d + 1) { out.add(d); if (d === b) break; }
  }
  return [...out];
}
export function fromText(raw) {
  const text = String(raw || '').replace(/[   ]/g, ' ').replace(/[{}"\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (/\b(open )?24\s*(hours|hrs|\/\s*7)\b/i.test(text) && !new RegExp(RANGE, 'i').test(text)) { const w = {}; for (let d = 1; d <= 7; d++) w[d] = [[0, 1440]]; return w; }
  const week = {};
  let any = false;
  for (const m of text.matchAll(RE_LINE)) {
    const days = expandDays(m[1]);
    if (!days.length) continue;
    const what = m[m.length - 1] || '';
    if (/^closed$/i.test(what.trim())) { for (const d of days) week[d] = []; any = true; continue; }
    const ranges = [...what.matchAll(new RegExp(RANGE, 'gi'))].map((x) => parseRange(x[0])).filter(Boolean);
    if (!ranges.length) continue;
    for (const d of days) week[d] = [];
    for (const d of days) for (const [s, e] of ranges) add(week, d, s, e);
    any = true;
  }
  return any ? cleanHours(week) : null;
}

// Any of the above, best first: a week object, packed text, DataForSEO object, schema in HTML, OSM syntax, then plain text.
export function parseAny(v) {
  if (!v) return null;
  if (typeof v === 'object') return v.timetable ? fromDataForSeo(v) : cleanHours(v);
  const s = String(v);
  if (/^[1-7]:\d/.test(s)) return unpackHours(s);
  if (/<script/i.test(s)) return fromSchema(s);
  if (/^\s*(24\/7|(?:(?:Mo|Tu|We|Th|Fr|Sa|Su)[a-z]?[\s,-]*)+\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})/.test(s) && !/\b(am|pm)\b/i.test(s)) return fromOsm(s) || fromText(s);
  return fromText(s);
}

// The hours part of a web page's text: looks only near the word "hours" so prices or phone numbers elsewhere are never read as times.
export function hoursFromPage(html) {
  const schema = fromSchema(html);
  if (schema) return { week: schema, how: 'schema' };
  const text = String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|tr|td|h\d)>/gi, ' \n ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&ndash;|&#8211;/g, '-').replace(/&mdash;|&#8212;/g, '-').replace(/\s+/g, ' ');
  const spots = [...text.matchAll(/\b(hours|open|business hours|opening hours|office hours|store hours|hours of operation)\b/gi)].map((m) => m.index).slice(0, 8);
  for (const at of spots) {
    const week = fromText(text.slice(at, at + 400));
    if (week) return { week, how: 'text' };
  }
  return { week: null, how: '' };
}

// ---------- reading a week ----------

// Day of the week (1 Monday to 7 Sunday) and minute of the day in a time zone.
export function clockIn(tz, at = Date.now()) {
  try {
    const parts = dtf('en-US', { timeZone: tz || 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    const d = DAYS.indexOf(get('weekday'));
    return { day: d > 0 ? d : null, min: (+get('hour') % 24) * 60 + +get('minute') };
  } catch { return { day: null, min: null }; }
}
// true open, false closed, null when the hours or the time zone are not known.
export function openAt(week, tz, at = Date.now()) {
  const w = typeof week === 'string' ? unpackHours(week) : week;
  if (!w || !tz) return null;
  const { day, min } = clockIn(tz, at);
  if (!day) return null;
  return (w[day] || []).some(([s, e]) => min >= s && min < e);
}
export function openOn(week, day) {
  const w = typeof week === 'string' ? unpackHours(week) : week;
  if (!w) return null;
  return Boolean(w[day] && w[day].length);
}
export const openSaturday = (week) => openOn(week, 6);
export const openSunday = (week) => openOn(week, 7);

const clock = (m) => {
  if (m === 0 || m === 1440) return 'midnight';
  if (m === 720) return 'noon';
  const h = Math.floor(m / 60) % 24, mm = m % 60;
  return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
};
const dayRanges = (list) => (list && list.length ? list.map(([s, e]) => (s === 0 && e === 1440 ? 'open all day' : `${clock(s)} to ${clock(e)}`)).join(', ') : 'closed');
// "Mon to Fri 8am to 5pm, Sat 9am to 1pm, Sun closed". Days with the same hours are grouped.
export function hoursText(week) {
  const w = typeof week === 'string' ? unpackHours(week) : week;
  if (!w) return '';
  const all = [1, 2, 3, 4, 5, 6, 7].map((d) => dayRanges(w[d]));
  if (all.every((x) => x === 'open all day')) return 'Open 24 hours';
  const out = [];
  for (let d = 1; d <= 7; d++) {
    let e = d; while (e < 7 && all[e] === all[d - 1]) e++;
    out.push(`${e > d ? `${DAYS[d]} to ${DAYS[e]}` : DAYS[d]} ${all[d - 1]}`);
    d = e;
  }
  return out.join(', ');
}
// Short text for a list cell: "Open now", "Closed now", "Opens 8am", "Closed today".
export function nowText(week, tz, at = Date.now()) {
  const w = typeof week === 'string' ? unpackHours(week) : week;
  if (!w || !tz) return '';
  const { day, min } = clockIn(tz, at);
  if (!day) return '';
  const today = w[day] || [];
  const cur = today.find(([s, e]) => min >= s && min < e);
  if (cur) return cur[1] === 1440 ? 'Open now' : `Open until ${clock(cur[1])}`;
  const next = today.find(([s]) => s > min);
  if (next) return `Opens ${clock(next[0])}`;
  return 'Closed today';
}

// Where hours came from, best first: typed by a rep from the listing, Google, the business website, OpenStreetMap.
export const HOURS_RANK = { hand: 4, google: 3, site: 2, import: 2, osm: 1 };
export const HOURS_SRC = { hand: 'typed from the listing', google: 'Google', site: 'their website', import: 'the imported file', osm: 'OpenStreetMap' };
