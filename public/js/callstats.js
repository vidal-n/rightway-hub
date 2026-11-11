// Call analytics, pure: the Agents page, the Analytics tab and the tests all use these. No dates from the clock, no DB.
// A call row: { at, answered_at, duration, ended_at, dispo_at, status, outcome, dispo, by, source, grade, industry, timezone }.

export const STATUSES = [
  ['available', 'Available', 'good'], ['break', 'Break', 'warn'], ['lunch', 'Lunch', 'warn'], ['training', 'Training', 'info'],
  ['meeting', 'Meeting', 'info'], ['admin', 'Admin work', 'info'], ['maintenance', 'Hub maintenance', 'maint'], ['offline', 'Offline', 'gray'],
];
// Hub maintenance is only for the primary owner (the person who set the Hub up).
export const statusesFor = (user) => STATUSES.filter(([k]) => k !== 'maintenance' || user?.primary);
export const STATUS_KEYS = STATUSES.map((s) => s[0]);
export const statusLabel = (k) => (k === 'on_call' ? 'On a call' : (STATUSES.find((s) => s[0] === k) || STATUSES[STATUSES.length - 1])[1]);
export const statusTone = (k) => (k === 'on_call' ? 'live' : (STATUSES.find((s) => s[0] === k) || STATUSES[STATUSES.length - 1])[2]);

const INBOUND = ['inbound', 'missed', 'voicemail', 'inbound_answered'];
const NOT_HUMAN = ['no_answer', 'voicemail', 'bad_number', 'phone_menu'];
const HUMAN = ['conversation', 'booked', 'callback', 'not_interested', 'gatekeeper', 'dnc', 'won', 'hung_up'];
const DECISION = ['conversation', 'booked', 'callback', 'not_interested', 'won'];

export const isOutbound = (c) => !INBOUND.includes(c.status || '');
// A real person picked up. The disposition wins over Twilio, because Twilio counts an answering machine as answered.
export function isConnect(c) {
  if (c.outcome && NOT_HUMAN.includes(c.outcome)) return false;
  if (c.outcome && HUMAN.includes(c.outcome)) return true;
  return Boolean(c.answered_at) && Number(c.duration || 0) >= 10;
}
export const isDecision = (c) => DECISION.includes(c.outcome || '');
export const isBooked = (c) => c.outcome === 'booked' || c.outcome === 'won';
export const talkSecs = (c) => (isConnect(c) || c.answered_at ? Math.max(0, Number(c.duration || 0)) : 0);
// Handle time: from dialing to the disposition saved (talk plus wrap up). Capped so a forgotten popup does not count for hours.
export function handleSecs(c) {
  const talk = talkSecs(c);
  const end = c.dispo_at || c.ended_at;
  if (end && c.at != null && end > c.at) return Math.min(Math.round((end - c.at) / 1000), talk + 15 * 60);
  return talk;
}

export const BUCKETS = [[0, 30, 'Under 30s'], [30, 120, '30s to 2m'], [120, 300, '2 to 5m'], [300, 600, '5 to 10m'], [600, 1200, '10 to 20m'], [1200, Infinity, '20m and up']];
export const bucketOf = (secs) => BUCKETS.findIndex(([a, b]) => secs >= a && secs < b);

function blank() { return { dials: 0, connects: 0, decision: 0, booked: 0, talk: 0, handle: 0, longest: 0 }; }
function add(t, c) {
  t.dials += 1;
  const talk = talkSecs(c);
  if (isConnect(c)) t.connects += 1;
  if (isDecision(c)) t.decision += 1;
  if (isBooked(c)) t.booked += 1;
  t.talk += talk;
  t.handle += handleSecs(c);
  t.longest = Math.max(t.longest, talk);
  return t;
}
function finish(t) {
  return {
    ...t,
    connectRate: t.dials ? t.connects / t.dials : 0,
    bookRate: t.connects ? t.booked / t.connects : 0,
    avgTalk: t.connects ? Math.round(t.talk / t.connects) : 0,
    avgHandle: t.dials ? Math.round(t.handle / t.dials) : 0,
  };
}

// Everything the Analytics tab shows, from one list of outbound calls.
export function callStats(calls = [], { users = [], dispos = [] } = {}) {
  const out = calls.filter(isOutbound);
  const total = blank();
  const byAgent = new Map(), bySource = new Map(), byGrade = new Map(), byIndustry = new Map(), byZone = new Map(), byDispo = new Map();
  const byHour = Array.from({ length: 24 }, () => blank());
  const buckets = BUCKETS.map(([, , label]) => ({ label, calls: 0, booked: 0, decision: 0 }));
  const group = (m, k, c) => add(m.get(k) || m.set(k, blank()).get(k), c);
  for (const c of out) {
    add(total, c);
    group(byAgent, c.by || 'unknown', c);
    group(bySource, c.source || 'Unknown', c);
    group(byGrade, c.grade || 'Not scored', c);
    group(byIndustry, c.industry || 'Unknown', c);
    group(byZone, c.timezone || 'Unknown', c);
    const label = c.dispo || (c.outcome ? (dispos.find((d) => d.acts === c.outcome)?.label || c.outcome) : 'No disposition');
    byDispo.set(label, (byDispo.get(label) || 0) + 1);
    if (c.hour != null) add(byHour[c.hour], c);
    if (isConnect(c)) {
      const b = buckets[bucketOf(talkSecs(c))];
      b.calls += 1; if (isBooked(c)) b.booked += 1; if (isDecision(c)) b.decision += 1;
    }
  }
  const name = (id) => users.find((u) => u.id === id)?.name || users.find((u) => u.id === id)?.email || 'Unknown';
  const rows = (m, label = (k) => k) => [...m.entries()].map(([k, t]) => ({ key: k, label: label(k), ...finish(t) })).sort((a, b) => b.dials - a.dials);
  return {
    total: finish(total),
    agents: rows(byAgent, name),
    sources: rows(bySource), grades: rows(byGrade).sort((a, b) => String(a.key).localeCompare(String(b.key))), industries: rows(byIndustry), zones: rows(byZone),
    dispos: [...byDispo.entries()].map(([label, n]) => ({ label, n, share: out.length ? n / out.length : 0 })).sort((a, b) => b.n - a.n),
    buckets: buckets.map((b) => ({ ...b, bookRate: b.calls ? b.booked / b.calls : 0 })),
    hours: byHour.map((t, h) => ({ hour: h, ...finish(t) })).filter((h) => h.dials),
  };
}

// Time in each status from the log, clipped to [from, to]. Open rows end at `openEnd` (now, or last seen for someone who went quiet).
export function statusTime(rows = [], from, to, openEnd = to) {
  const per = {};
  for (const r of rows) {
    const s = Math.max(from, r.start_at);
    const e = Math.min(to, r.end_at || openEnd);
    if (e > s) per[r.status] = (per[r.status] || 0) + Math.round((e - s) / 1000);
  }
  const login = Object.entries(per).filter(([k]) => k !== 'offline').reduce((a, [, v]) => a + v, 0);
  return { per, login };
}

export const clock = (secs) => {
  const s = Math.max(0, Math.round(Number(secs) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
export const pct = (v) => `${Math.round((Number(v) || 0) * 100)}%`;
