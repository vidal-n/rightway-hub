// Work schedule blocks. Pure (no browser or server calls) so the Worker, the Hub page and Node tests share it.
// A block is one stretch of a weekday: dow 1 to 7 (Monday is 1), start and end in minutes after midnight, a title, a kind, and an optional goal and note.

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Kinds drive the colour. goalUnit is what a goal number means for that kind.
export const KINDS = {
  dial: { label: 'Dialing', color: '#23B07E', goalUnit: 'dials' },
  meeting: { label: 'Meetings and closing', color: '#3B82F6', goalUnit: 'meetings' },
  deliver: { label: 'Client work', color: '#8B5CF6', goalUnit: 'tasks' },
  build: { label: 'Building the Hub', color: '#F59E0B', goalUnit: '' },
  coach: { label: 'Training and coaching', color: '#14B8A6', goalUnit: '' },
  admin: { label: 'Admin and follow up', color: '#64748B', goalUnit: '' },
  plan: { label: 'Planning and review', color: '#EC4899', goalUnit: '' },
  break: { label: 'Break', color: '#94A3B8', goalUnit: '' },
  other: { label: 'Other', color: '#A16207', goalUnit: '' },
};
export const KIND_KEYS = Object.keys(KINDS);

export const toMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
export const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export function fmtMin(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}
export const fmtSpan = (a, b) => `${fmtMin(a)} to ${fmtMin(b)}`;
export const hoursText = (mins) => { const h = mins / 60; return `${Number.isInteger(h) ? h : h.toFixed(1)} h`; };

// Check and clean a list of blocks from the editor. Returns { ok: true, blocks } or { ok: false, error }.
export function validateBlocks(list) {
  if (!Array.isArray(list)) return { ok: false, error: 'No schedule sent.' };
  if (list.length > 250) return { ok: false, error: 'That is more blocks than a week can hold.' };
  const out = [];
  for (const b of list) {
    const dow = Number(b?.dow), start = Number(b?.start_min), end = Number(b?.end_min);
    const title = String(b?.title || '').trim().slice(0, 80);
    if (!Number.isInteger(dow) || dow < 1 || dow > 7) return { ok: false, error: 'Pick a day for every block.' };
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440 || end <= start) return { ok: false, error: `${title || 'A block'} needs an end time after its start time.` };
    if (!title) return { ok: false, error: 'Give every block a name.' };
    const goal = b?.goal === '' || b?.goal == null ? null : Math.max(0, Math.min(9999, Math.round(Number(b.goal)) || 0));
    out.push({ dow, start_min: start, end_min: end, title, kind: KINDS[b?.kind] ? b.kind : 'other', goal: goal || null, note: String(b?.note || '').trim().slice(0, 600) });
  }
  out.sort((a, b) => a.dow - b.dow || a.start_min - b.start_min);
  for (let i = 1; i < out.length; i++) {
    const p = out[i - 1], c = out[i];
    if (p.dow === c.dow && c.start_min < p.end_min) return { ok: false, error: `${DAYS[c.dow - 1]}: "${c.title}" overlaps "${p.title}". Move one so they do not share time.` };
  }
  return { ok: true, blocks: out };
}

export const blocksOn = (blocks, dow) => blocks.filter((b) => b.dow === dow).sort((a, b) => a.start_min - b.start_min);

// What is happening at this moment and what comes next today. minute = minutes after midnight, dow 1 to 7.
export function nowAndNext(blocks, dow, minute) {
  const day = blocksOn(blocks, dow);
  const now = day.find((b) => b.start_min <= minute && minute < b.end_min) || null;
  const next = day.find((b) => b.start_min > minute) || null;
  return { now, next, left: now ? now.end_min - minute : null, until: next ? next.start_min - minute : null, dayStart: day[0]?.start_min ?? null, dayEnd: day[day.length - 1]?.end_min ?? null };
}

// JavaScript's Sunday-first weekday to our Monday-first one.
export const dowOf = (date = new Date()) => ((date.getDay() + 6) % 7) + 1;

// Minutes per kind for one day, and the goals added up (dials a day).
export function totals(blocks, dow = null) {
  const per = {}; let goalDials = 0, minutes = 0;
  for (const b of blocks) {
    if (dow && b.dow !== dow) continue;
    const len = b.end_min - b.start_min;
    if (b.kind !== 'break') minutes += len;
    per[b.kind] = (per[b.kind] || 0) + len;
    if (b.kind === 'dial') goalDials += b.goal || 0;
  }
  return { per, goalDials, minutes };
}

// Which of a person's days have anything planned.
export const plannedDays = (blocks) => [...new Set(blocks.map((b) => b.dow))].sort();

// ---------- starters ----------
const B = (dow, a, b, title, kind, goal, note) => ({ dow, start_min: toMin(a), end_min: toMin(b), title, kind, goal: goal || null, note: note || '' });

// V's week: the owner who sells, builds, delivers and scales the business. Starts 8:45, 200 dials a day, the day ends at 6 with a
// build block after dinner on weekdays (done by 8). Dial blocks sit where local owners pick up: early, lunch, and end of the day.
export function ownerWeek() {
  const out = [];
  const weekday = (d, mid, eve) => {
    out.push(
      B(d, '08:45', '09:00', 'Start up', 'admin', 0, 'Open the Hub dashboard: callbacks due, meetings today, wallet balances (Twilio, DataForSEO), who is online. Set the first dial list: Hot tab first, then Good.'),
      B(d, '09:00', '10:45', 'Power dial 1', 'dial', 75, 'Hot and callbacks first, then Best first. Owners are reachable before jobs get busy. Keys 1 to 9 log the result. Do not stop to fix things in here.'),
      B(d, '10:45', '11:00', 'Reset', 'admin', 0, 'Clear notes and dispositions, send texts to anyone who asked for info, book any audits you just set.'),
      B(d, '11:00', '12:30', 'Power dial 2', 'dial', 60, 'Keep going through the list. Mobile numbers and owner names known first. Lunch hour is when many owners sit down and answer.'),
      B(d, '12:30', '13:15', 'Lunch', 'break', 0, 'Away from the screen.'),
      B(d, '13:15', '15:15', 'Clarity calls and closing', 'meeting', 0, 'Run booked clarity audits and close. No meeting booked? Use it for callbacks, follow ups and the second pass on warm leads.'),
      mid,
      B(d, '16:00', '17:30', 'Power dial 3', 'dial', 65, 'End of day is when owners are off the job and pick up. Callbacks due today first.'),
      B(d, '17:30', '18:00', 'Wrap up', 'admin', 0, 'Finish dispositions, send booking confirmations, queue tomorrow\'s Hot list, check the day\'s numbers on the Dashboard (target 200 dials).'),
      eve,
    );
  };
  const delivery = (d) => B(d, '15:15', '16:00', 'Client work check', 'deliver', 0, 'My work: anything overdue or due today, client approvals, reports ready to send, client messages. Hand off what the team can do.');
  const coaching = (d) => B(d, '15:15', '16:00', 'Coach the team', 'coach', 0, 'Agents page: listen in or whisper on live calls, hear two recordings, give one note each. Check Kiron\'s dials and booked count.');
  weekday(1, delivery(1), B(1, '18:15', '19:45', 'Build the Hub', 'build', 0, 'One feature or fix at a time, shipped before you stop. Write down the next thing so tomorrow starts fast.'));
  weekday(2, coaching(2), B(2, '18:15', '19:45', 'Build the Hub', 'build', 0, 'Systems and automation that save the next hour: scripts, templates, reports.'));
  weekday(3, delivery(3), B(3, '18:15', '19:45', 'Build the Hub', 'build', 0, 'Features clients and the team asked for this week.'));
  weekday(4, coaching(4), B(4, '18:15', '19:45', 'Scale: hiring and training', 'build', 0, 'Job post, onboarding docs, training material, anything that lets someone else do a task the same way every time.'));
  weekday(5, delivery(5), B(5, '18:15', '19:30', 'Weekly review and plan', 'plan', 0, 'Dials, contacts, booked, closed, MRR, spend, cost per booked audit. What worked, what to change, the three outcomes for next week.'));
  out.push(
    B(6, '09:00', '11:30', 'Deep build', 'build', 0, 'The big feature or system for the week, uninterrupted.'),
    B(6, '11:30', '12:30', 'Pipeline cleanup', 'admin', 0, 'Import and scrub new lead lists, merge duplicates, clear dead numbers, set Hot lists for Monday.'),
    B(7, '18:00', '19:30', 'Plan the week', 'plan', 0, 'Pick the lists, check the calendar, line up client reports and content, and write down the one number that matters this week.'),
  );
  return out;
}

// A starting point for an appointment setter: one steady dial day. Optional. New teammates start with nothing unless this is loaded.
export function setterWeek() {
  const out = [];
  for (let d = 1; d <= 5; d++) {
    out.push(
      B(d, '09:00', '09:15', 'Start up', 'admin', 0, 'Check status is Available, open the dialer, read the script.'),
      B(d, '09:15', '11:30', 'Dial block 1', 'dial', 0, ''),
      B(d, '11:30', '12:00', 'Texts and follow up', 'admin', 0, ''),
      B(d, '12:00', '12:45', 'Lunch', 'break', 0, ''),
      B(d, '12:45', '15:00', 'Dial block 2', 'dial', 0, ''),
      B(d, '15:00', '15:15', 'Break', 'break', 0, ''),
      B(d, '15:15', '17:00', 'Dial block 3', 'dial', 0, ''),
      B(d, '17:00', '17:15', 'Wrap up', 'admin', 0, 'Finish dispositions and notes.'),
    );
  }
  return out;
}

export const STARTERS = { blank: () => [], owner: ownerWeek, setter: setterWeek };
