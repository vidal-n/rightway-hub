// Pipeline board columns (Nov 2026, V: see every lead organized in columns by disposition, grade and everything else we collect,
// for full control of call campaigns). Pure and shared by the Pipeline page and the tests.
// Modeled on the board "group by" in Close.com Smart Views, HubSpot boards and Attio views: pick any field, one column per value,
// one lead in exactly one column, and every column can be loaded as a call list.
import { calledBefore, resultOf, disqualified, tierOf, TIERS } from './campaign.js';
import { callCategory, personOf } from './leadintel.js';
import { gbpState } from './leadfilter.js';
import { objectionLabel } from './leaddb.js';

export const BOARD_STAGES = ['new', 'attempting', 'callback', 'audit_requested', 'audit_booked', 'no_show', 'follow_up', 'not_now', 'won', 'lost', 'dnc'];
const FINAL = ['won', 'lost', 'dnc'];
const DAY = 864e5;

// Never called by anyone, still open, not on a stop list: the pool a fresh call list is built from.
export const isFresh = (l) => !calledBefore(l) && !disqualified(l) && !FINAL.includes(l.stage);
export const isDead = (l) => disqualified(l) || l.stage === 'dnc';

const band = (v, cuts, none = 'Not known') => {
  if (v == null || v === '' || Number.isNaN(Number(v))) return none;
  const n = Number(v);
  for (const [max, label] of cuts) if (n <= max) return label;
  return cuts[cuts.length - 1][1];
};
const TZ_NAMES = { ET: 'Eastern (ET)', CT: 'Central (CT)', MT: 'Mountain (MT)', AZ: 'Arizona (AZ)', PT: 'Pacific (PT)', AK: 'Alaska (AK)', HI: 'Hawaii (HI)' };
const ago = (t, now) => {
  if (!t) return 'Never called';
  const d = (now - t) / DAY;
  return d < 1 ? 'Today' : d < 2 ? 'Yesterday' : d < 7 ? 'This week' : d < 30 ? '1 to 4 weeks ago' : d < 90 ? '1 to 3 months ago' : 'Over 3 months ago';
};
const due = (t, now) => {
  if (!t) return 'No next step';
  const d = (t - now) / DAY;
  return d < 0 ? 'Overdue' : d < 1 ? 'Due today' : d < 7 ? 'This week' : d < 30 ? 'This month' : 'Later';
};
const reached = (l) => {
  if (!calledBefore(l)) return 'Not called yet';
  if ((l.owner_talks || 0) > 0) return 'Talked to the owner';
  if ((l.staff_talks || 0) > 0) return 'Reached staff only';
  if ((l.menus || 0) > 0) return 'Phone menu';
  if ((l.voicemails || 0) > 0) return 'Voicemail only';
  if ((l.connects || 0) > 0) return 'Someone picked up';
  return 'Never picked up';
};
export const reachedOf = reached;
// Call coverage, the same four buckets as the Lead database donut: where every business stands.
export const COVERAGE = ['Never called', 'Called, owner not reached', 'Reached the owner', 'Do not call'];
export function coverageOf(l) {
  if (isDead(l)) return 'Do not call';
  if ((l.owner_talks || 0) > 0) return 'Reached the owner';
  return calledBefore(l) ? 'Called, owner not reached' : 'Never called';
}
const scoreBand = (v, none) => (v == null || v === '' ? none : band(v, [[24, 'Low (under 25)'], [49, 'Fair (25 to 49)'], [74, 'Good (50 to 74)'], [100, 'High (75 and up)']]));
const goodEmail = (l) => Boolean(l.email) && !['bad', 'no_mail_server'].includes(l.email_status);
const firstTag = (l) => String(l.tags || '').split(',').map((x) => x.trim()).filter(Boolean)[0] || 'No tag';

// Every way to lay out the board. group: the field. key(l, ctx) gives the column label. order: fixed column order (the rest by size).
// sales: these columns are about calling, so "Not contacted yet" splits out by default.
export const BOARD_MODES = [
  // Calling
  { id: 'coverage', label: 'Call coverage', group: 'Calling', key: coverageOf, order: COVERAGE },
  { id: 'stage', label: 'Stage', group: 'Calling', sales: true },
  { id: 'result', label: 'Last result (disposition)', group: 'Calling', sales: true },
  { id: 'reached', label: 'Who picked up', group: 'Calling', sales: true, key: reached,
    order: ['Not called yet', 'Talked to the owner', 'Reached staff only', 'Someone picked up', 'Voicemail only', 'Phone menu', 'Never picked up'] },
  { id: 'objection', label: 'Last objection', group: 'Calling', sales: true, key: (l) => (l.last_objection ? objectionLabel(l.last_objection) : calledBefore(l) ? 'No objection logged' : 'Not called yet') },
  { id: 'attempts', label: 'Times called', group: 'Calling', sales: true,
    key: (l) => { const n = Math.max(l.dials || 0, l.attempts || 0); return n === 0 ? (l.last_call_at ? '1 call' : 'Never called') : n === 1 ? '1 call' : n === 2 ? '2 calls' : n <= 4 ? '3 to 4 calls' : n <= 9 ? '5 to 9 calls' : '10 or more'; },
    order: ['Never called', '1 call', '2 calls', '3 to 4 calls', '5 to 9 calls', '10 or more'] },
  { id: 'lastcall', label: 'Last called', group: 'Calling', sales: true, key: (l, c) => ago(l.last_call_at, c.now),
    order: ['Never called', 'Today', 'Yesterday', 'This week', '1 to 4 weeks ago', '1 to 3 months ago', 'Over 3 months ago'] },
  { id: 'lastby', label: 'Last called by', group: 'Calling', sales: true, key: (l, c) => (l.last_by ? (c.users[l.last_by] || 'A teammate') : calledBefore(l) ? 'Not known' : 'Not called yet') },
  { id: 'next', label: 'Next step due', group: 'Calling', sales: true, key: (l, c) => due(l.next_action_at, c.now),
    order: ['Overdue', 'Due today', 'This week', 'This month', 'Later', 'No next step'] },
  { id: 'convs', label: 'Owner conversations', group: 'Calling', sales: true,
    key: (l) => ((l.convs || 0) > 0 ? 'Talked a minute or more' : (l.owner_talks || 0) > 0 ? 'Talked under a minute' : calledBefore(l) ? 'No owner conversation' : 'Not called yet'),
    order: ['Talked a minute or more', 'Talked under a minute', 'No owner conversation', 'Not called yet'] },
  { id: 'hangs', label: 'Hung up fast', group: 'Calling', sales: true,
    key: (l) => ((l.fast_hangs || 0) > 1 ? 'Hung up fast more than once' : (l.fast_hangs || 0) === 1 ? 'Hung up fast once' : calledBefore(l) ? 'Never hung up fast' : 'Not called yet'),
    order: ['Never hung up fast', 'Hung up fast once', 'Hung up fast more than once', 'Not called yet'] },
  { id: 'reach', label: 'Reach score', group: 'Calling', key: (l) => scoreBand(l.reach_score, 'Not scored yet'), order: ['High (75 and up)', 'Good (50 to 74)', 'Fair (25 to 49)', 'Low (under 25)', 'Not scored yet'] },
  { id: 'engage', label: 'Engagement score', group: 'Calling', key: (l) => scoreBand(l.engage_score, 'Not scored yet'), order: ['High (75 and up)', 'Good (50 to 74)', 'Fair (25 to 49)', 'Low (under 25)', 'Not scored yet'] },
  { id: 'qual', label: 'Qualification answers', group: 'Calling', key: (l) => ((l.qual_n || 0) >= 4 ? '4 or more answers' : (l.qual_n || 0) > 0 ? '1 to 3 answers' : 'None on file'), order: ['4 or more answers', '1 to 3 answers', 'None on file'] },
  { id: 'holder', label: 'Whose call list', group: 'Calling', key: (l) => (l.held ? `${l.held}'s list` : l.mine ? 'My list' : 'Not on a list'), order: ['My list', 'Not on a list'] },
  // Lead quality
  { id: 'grade', label: 'Grade', group: 'Lead quality', sales: true },
  { id: 'tier', label: 'Quality tab', group: 'Lead quality', key: (l) => (TIERS.find((t) => t[0] === tierOf(l)) || [0, 'Other'])[1], order: TIERS.map((t) => t[1]) },
  { id: 'cat', label: 'Call type', group: 'Lead quality', key: (l) => callCategory(l).label },
  { id: 'data', label: 'Data score', group: 'Lead quality', key: (l) => (l.data_score == null ? 'Not scrubbed' : band(l.data_score, [[39, 'Under 40'], [59, '40 to 59'], [79, '60 to 79'], [100, '80 and up']])),
    order: ['80 and up', '60 to 79', '40 to 59', 'Under 40', 'Not scrubbed'] },
  { id: 'phone', label: 'Phone type', group: 'Lead quality', key: (l) => ({ mobile: 'Mobile', landline: 'Landline', voip: 'Internet phone' }[l.phone_type] || 'Not checked'), order: ['Mobile', 'Landline', 'Internet phone', 'Not checked'] },
  { id: 'owner', label: 'Owner name', group: 'Lead quality', key: (l) => (personOf(l) ? 'Name known' : 'No name yet'), order: ['Name known', 'No name yet'] },
  { id: 'email', label: 'Email', group: 'Lead quality', key: (l) => (goodEmail(l) ? 'Has a good email' : l.email ? 'Email bounced or bad' : 'No email'), order: ['Has a good email', 'Email bounced or bad', 'No email'] },
  { id: 'site', label: 'Website', group: 'Lead quality', key: (l) => (l.website ? 'Has a website' : 'No website'), order: ['No website', 'Has a website'] },
  { id: 'gbp', label: 'Google profile', group: 'Lead quality', key: (l) => ({ yes: 'Has a profile', none: 'No profile found', unknown: 'Not checked' }[gbpState(l)] || 'Not checked'), order: ['No profile found', 'Has a profile', 'Not checked'] },
  { id: 'reviews', label: 'Google reviews', group: 'Lead quality', key: (l) => band(l.reviews, [[0, 'No reviews'], [9, '1 to 9'], [24, '10 to 24'], [49, '25 to 49'], [99, '50 to 99'], [1e9, '100 and up']]),
    order: ['No reviews', '1 to 9', '10 to 24', '25 to 49', '50 to 99', '100 and up', 'Not known'] },
  { id: 'rating', label: 'Google rating', group: 'Lead quality', key: (l) => (l.rating == null || l.rating === '' ? 'Not known' : band(l.rating, [[3.9, 'Under 4.0'], [4.2, '4.0 to 4.2'], [4.5, '4.3 to 4.5'], [4.7, '4.6 to 4.7'], [5, '4.8 to 5.0']])),
    order: ['Under 4.0', '4.0 to 4.2', '4.3 to 4.5', '4.6 to 4.7', '4.8 to 5.0', 'Not known'] },
  { id: 'rank', label: 'Map rank', group: 'Lead quality', key: (l) => (l.map_rank == null || l.map_rank === '' ? 'Not checked' : band(l.map_rank, [[3, 'Top 3'], [10, '4 to 10'], [20, '11 to 20'], [1e9, 'Not on page one']])),
    order: ['Top 3', '4 to 10', '11 to 20', 'Not on page one', 'Not checked'] },
  // Place
  { id: 'tz', label: 'Time zone', group: 'Place', key: (l) => TZ_NAMES[l.tz_short] || 'Time zone not known',
    order: ['Eastern (ET)', 'Central (CT)', 'Mountain (MT)', 'Arizona (AZ)', 'Pacific (PT)', 'Alaska (AK)', 'Hawaii (HI)', 'Time zone not known'] },
  { id: 'state', label: 'State', group: 'Place', key: (l) => String(l.state || '').toUpperCase() || 'No state' },
  { id: 'city', label: 'City', group: 'Place', key: (l) => (l.city ? `${l.city}${l.state ? `, ${String(l.state).toUpperCase()}` : ''}` : 'No city') },
  // Where it came from
  { id: 'industry', label: 'Industry', group: 'Where it came from', key: (l) => l.industry || l.category || 'No industry' },
  { id: 'source', label: 'Source', group: 'Where it came from', key: (l) => l.source || 'No source' },
  { id: 'tag', label: 'Tag (first tag)', group: 'Where it came from', key: firstTag },
  { id: 'added', label: 'Added', group: 'Where it came from', key: (l, c) => { const d = (c.now - (l.created_at || 0)) / DAY; return d < 1 ? 'Today' : d < 7 ? 'This week' : d < 30 ? 'This month' : d < 90 ? '1 to 3 months ago' : 'Older'; },
    order: ['Today', 'This week', 'This month', '1 to 3 months ago', 'Older'] },
];
export const modeOf = (id) => BOARD_MODES.find((m) => m.id === id) || BOARD_MODES[0];
// Groups for the "Columns by" menu.
export const modeGroups = () => [...new Set(BOARD_MODES.map((m) => m.group))].map((g) => [g, BOARD_MODES.filter((m) => m.group === g)]);
// The "Show" filter that runs before the columns: everyone, only leads nobody called yet, or only leads already called.
export const SHOW = [['all', 'All leads'], ['fresh', 'Not contacted yet only'], ['called', 'Already contacted only']];
export const showFilter = (leads, show) => (show === 'fresh' ? leads.filter(isFresh) : show === 'called' ? leads.filter((l) => !isFresh(l)) : leads);

const slug = (s) => String(s).replace(/\s+/g, ' ').trim();
// Columns for one mode. Every lead lands in exactly one column, so nothing shows twice and nothing is missing.
// opts: { stageLabel, users ({id: name}), split (true = "Not contacted yet" gets its own first column; default: on for calling modes), now }.
// Returns [{ key, label, hint, leads, drop }]. `drop` is the stage a card dropped there takes (stage mode only).
export function boardColumns(mode, leads, opts = {}) {
  const m = modeOf(mode);
  const ctx = { stageLabel: opts.stageLabel || {}, users: opts.users || {}, now: opts.now || Date.now() };
  const split = opts.split ?? Boolean(m.sales);
  const fresh = []; const dead = []; const won = []; const rest = [];
  for (const l of leads || []) {
    if (split && isFresh(l)) fresh.push(l);
    else if (['result', 'grade'].includes(m.id) && l.stage === 'won') won.push(l);
    else if (['result', 'grade'].includes(m.id) && isDead(l)) dead.push(l);
    else rest.push(l);
  }
  const cols = split ? [{ key: 'fresh', label: 'Not contacted yet', hint: 'Nobody has called these. Best grade first.', leads: fresh, drop: m.id === 'stage' ? 'new' : null }] : [];
  if (m.id === 'stage') {
    const by = {};
    for (const l of rest) (by[l.dnc ? 'dnc' : l.stage] ||= []).push(l);
    for (const s of BOARD_STAGES) {
      // "New lead" only shows when a lead sits there after a call (or when not split out); fresh ones are in the first column.
      if (s === 'new' && split && !(by.new || []).length) continue;
      cols.push({ key: `stage:${s}`, label: ctx.stageLabel[s] || s, hint: '', leads: by[s] || [], drop: s });
    }
    return cols;
  }
  if (m.id === 'grade') {
    const by = { A: [], B: [], C: [], D: [], none: [] };
    for (const l of rest) (by[by[l.grade] ? l.grade : 'none']).push(l);
    for (const g of ['A', 'B', 'C', 'D']) cols.push({ key: `grade:${g}`, label: `Grade ${g}`, hint: { A: '75 and up', B: '60 to 74', C: '45 to 59', D: 'under 45' }[g], leads: by[g], drop: null });
    cols.push({ key: 'grade:none', label: 'Not graded yet', hint: 'No research yet', leads: by.none, drop: null });
  } else if (m.id === 'result') {
    const map = new Map();
    for (const l of rest) { const r = resultOf(l); if (!map.has(r)) map.set(r, []); map.get(r).push(l); }
    const NONE = 'No result logged';
    [...map.entries()].sort((a, b) => (a[0] === NONE) - (b[0] === NONE) || b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .forEach(([r, ls]) => cols.push({ key: `result:${r}`, label: r, hint: 'Last call result', leads: ls, drop: null }));
  } else {
    const map = new Map();
    for (const l of rest) { const k = slug(m.key(l, ctx)); if (!map.has(k)) map.set(k, []); map.get(k).push(l); }
    const order = m.order || [];
    const pos = (k) => { const i = order.indexOf(k); return i < 0 ? 1e6 : i; };
    const tail = (k) => /^(no |not )/i.test(k);
    [...map.entries()].sort((a, b) => pos(a[0]) - pos(b[0]) || tail(a[0]) - tail(b[0]) || b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .forEach(([k, ls]) => cols.push({ key: `${m.id}:${k}`, label: k, hint: m.label, leads: ls, drop: null }));
    return cols;
  }
  cols.push({ key: 'won', label: 'Won (clients)', hint: '', leads: won, drop: null });
  cols.push({ key: 'dead', label: 'Do not call and dead', hint: 'Never called again, whoever finds them', leads: dead, drop: null });
  return cols;
}
// Columns whose leads may be loaded as a call list (the server still drops anyone on Do Not Call or another agent's list).
export const loadable = (key) => !['won', 'dead', 'stage:won', 'stage:lost', 'stage:dnc'].includes(key);
export const columnByKey = (mode, leads, key, opts) => boardColumns(mode, leads, opts).find((c) => c.key === key) || null;

// Two fields at once (rows by one, columns by the other), like a pivot table: every lead counted once in one cell.
// Default on the Pipeline: time zone by call coverage. Cells keep their leads so a cell can be loaded as a call list.
export function pivot(rowMode, colMode, leads, opts = {}) {
  const o = { ...opts, split: false };
  const rows = boardColumns(rowMode, leads, o);
  const colKeys = new Map();
  const out = rows.filter((r) => r.leads.length).map((r) => {
    const cells = new Map();
    for (const c of boardColumns(colMode, r.leads, o)) if (c.leads.length) { cells.set(c.label, c.leads); colKeys.set(c.label, (colKeys.get(c.label) || 0) + c.leads.length); }
    return { key: r.key, label: r.label, total: r.leads.length, cells };
  });
  // Column order: the mode's own order first (from a run over everyone), then the rest by size.
  const order = boardColumns(colMode, leads, o).map((c) => c.label);
  const cols = [...colKeys.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([label, total]) => ({ label, total }));
  return { rows: out, cols, total: leads.length };
}
