// Pipeline board columns (Nov 2026, V: see every lead organized in columns, new columns by disposition and grade, and an all leads
// column for who we have not contacted yet). Pure and shared by the Pipeline page and the tests.
// Modeled on the Smart Views and pipeline boards in Close.com and the list views in Outreach: one lead sits in exactly one column.
import { calledBefore, resultOf, disqualified } from './campaign.js';

export const BOARD_MODES = [['stage', 'Stage'], ['result', 'Last result'], ['grade', 'Grade']];
export const BOARD_STAGES = ['new', 'attempting', 'callback', 'audit_requested', 'audit_booked', 'no_show', 'follow_up', 'not_now', 'won', 'lost', 'dnc'];
const FINAL = ['won', 'lost', 'dnc'];

// Never called by anyone, still open, not on a stop list: the pool a fresh call list is built from.
export const isFresh = (l) => !calledBefore(l) && !disqualified(l) && !FINAL.includes(l.stage);
export const isDead = (l) => disqualified(l) || l.stage === 'dnc';

// Columns for one mode. Every lead lands in exactly one column, so nothing shows twice and nothing is missing.
// Returns [{ key, label, hint, leads, drop }]. `drop` is the stage a card dropped there takes (stage mode only).
export function boardColumns(mode, leads, stageLabel = {}) {
  const fresh = []; const dead = []; const won = [];
  const rest = [];
  for (const l of leads || []) {
    if (isFresh(l)) fresh.push(l);
    else if (mode !== 'stage' && l.stage === 'won') won.push(l);
    else if (mode !== 'stage' && isDead(l)) dead.push(l);
    else rest.push(l);
  }
  const cols = [{ key: 'fresh', label: 'Not contacted yet', hint: 'Nobody has called these. Best grade first.', leads: fresh, drop: mode === 'stage' ? 'new' : null }];
  if (mode === 'stage') {
    const by = {};
    for (const l of rest) (by[l.dnc ? 'dnc' : l.stage] ||= []).push(l);
    for (const s of BOARD_STAGES) {
      // "New lead" only shows when a lead sits there after a call (a redial or a bad connection); fresh ones are in the first column.
      if (s === 'new' && !(by.new || []).length) continue;
      cols.push({ key: `stage:${s}`, label: stageLabel[s] || s, hint: '', leads: by[s] || [], drop: s });
    }
    return cols;
  }
  if (mode === 'grade') {
    const by = { A: [], B: [], C: [], D: [], none: [] };
    for (const l of rest) (by[by[l.grade] ? l.grade : 'none']).push(l);
    for (const g of ['A', 'B', 'C', 'D']) cols.push({ key: `grade:${g}`, label: `Grade ${g}`, hint: { A: '75 and up', B: '60 to 74', C: '45 to 59', D: 'under 45' }[g], leads: by[g], drop: null });
    cols.push({ key: 'grade:none', label: 'Not graded yet', hint: 'No research yet', leads: by.none, drop: null });
  } else {
    const m = new Map();
    for (const l of rest) { const r = resultOf(l); if (!m.has(r)) m.set(r, []); m.get(r).push(l); }
    const NONE = 'No result logged';
    [...m.entries()].sort((a, b) => (a[0] === NONE) - (b[0] === NONE) || b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .forEach(([r, ls]) => cols.push({ key: `result:${r}`, label: r, hint: 'Last call result', leads: ls, drop: null }));
  }
  cols.push({ key: 'won', label: 'Won (clients)', hint: '', leads: won, drop: null });
  cols.push({ key: 'dead', label: 'Do not call and dead', hint: 'Never called again, whoever finds them', leads: dead, drop: null });
  return cols;
}
// Columns whose leads may be loaded as a call list.
export const loadable = (key) => !['won', 'dead', 'stage:won', 'stage:lost', 'stage:dnc'].includes(key);
export const columnByKey = (mode, leads, key, stageLabel) => boardColumns(mode, leads, stageLabel).find((c) => c.key === key) || null;
