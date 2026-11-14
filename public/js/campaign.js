// Call campaign (Nov 2026, V: set up who to call and the script on the Pipeline, the dialer only runs the list; pick from every
// stage, not just new leads, so a session can be planned for the day). Pure and shared by the Pipeline page, the Worker and the tests.
// Modeled on the call list builders in Close.com Smart Views and the dial lists in Outreach and Orum: build the list first, then dial it.
import { callCategory, personOf } from './leadintel.js';

// Stages a campaign may hold. Won (they are clients) and Do not call never are.
export const CAMPAIGN_STAGES = ['new', 'attempting', 'callback', 'audit_requested', 'no_show', 'follow_up', 'audit_booked', 'not_now', 'lost'];
// The stages that are ticked when nothing was chosen: everyone still being worked.
export const DEFAULT_STAGES = ['new', 'attempting', 'callback', 'audit_requested', 'no_show', 'follow_up'];
export const MAX_CAMPAIGN = 2000;

export const cleanStages = (list) => {
  const s = (Array.isArray(list) ? list : String(list || '').split(',')).map((x) => String(x).trim()).filter((x) => CAMPAIGN_STAGES.includes(x));
  return [...new Set(s)];
};

// Quality tabs, one definition for the Worker and the Pipeline: callbacks and booked follow ups are hot, not researched is its own bucket.
export function tierOf(l) {
  const researched = Boolean(l.intel_at || l.researched);
  if (['callback', 'audit_requested', 'no_show'].includes(l.stage)) return 'hot';
  if (!researched && !l.grade) return 'fresh';
  return { A: 'hot', B: 'good', C: 'maybe', D: 'low' }[l.grade] || (researched ? 'maybe' : 'fresh');
}
export const TIERS = [['hot', 'Hot', 'A grade, callbacks, audit requests'], ['good', 'Good', 'B grade'], ['maybe', 'Maybe', 'C grade'], ['low', 'Low', 'D grade'], ['fresh', 'Not researched', 'no research yet']];

const goodEmail = (l) => Boolean(l.email) && !['bad', 'no_mail_server'].includes(l.email_status);
export const dataOk = (l, d) => !d || (d === 'mobile' ? l.phone_type === 'mobile' : d === 'owner' ? Boolean(personOf(l)) : d === 'email' ? goodEmail(l) : true);

// Called before: anyone on the team dialed it (the roll up count, the attempts counter or a last call time).
export const calledBefore = (l) => (l.dials || 0) > 0 || (l.attempts || 0) > 0 || Boolean(l.last_call_at);
// Last result in the words the team saw when it was logged ("Callback", "Voicemail", a custom label).
export const resultOf = (l) => String(l.last_dispo || '').trim() || 'No result logged';
// Results that mean "stop": these leads are disqualified for everyone and never come back on a follow up list, whoever made the call.
export const DISQUALIFIED = /\b(dead|bad number|wrong number|phone menu|do not call|dnc)\b/i;
export const disqualified = (l) => Boolean(l.dnc) || l.stage === 'dnc' || DISQUALIFIED.test(l.last_dispo || '') || /\b(dead lead|phone menu)\b/i.test(l.tags || '');

// Everyone who could be called: has a number, is not on the Do not call list, sits in one of the chosen stages, and is not disqualified.
export function campaignPool(leads, { stages } = {}) {
  const st = cleanStages(stages);
  const use = st.length ? st : DEFAULT_STAGES;
  return (leads || []).filter((l) => l && l.phone && !disqualified(l) && use.includes(l.stage));
}
// kind: 'fresh' (never called, the default, so nobody dials a lead a teammate already worked), 'follow' (called before, narrowed by last result)
// or 'all'. `only` (a set of ids) restricts it to leads ticked by hand and ignores kind.
export function campaignRows(leads, { stages, kind = 'fresh', results = [], tier = '', cat = '', data = '', only = null } = {}) {
  return campaignPool(leads, { stages })
    .filter((l) => (only ? only.has(l.id) : kind === 'all' || (kind === 'follow' ? calledBefore(l) && (!results.length || results.includes(resultOf(l))) : !calledBefore(l))))
    .filter((l) => !tier || tierOf(l) === tier)
    .filter((l) => !cat || callCategory(l).id === cat)
    .filter((l) => dataOk(l, data));
}
// Follow ups grouped by what happened on the last call: [[result, count], ...] biggest first.
export function followResults(pool) {
  const m = new Map();
  for (const l of pool) if (calledBefore(l)) m.set(resultOf(l), (m.get(resultOf(l)) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
// How many of a pool fall in each quality tab and call type (what the drop downs show).
export function poolCounts(pool) {
  const tiers = { hot: 0, good: 0, maybe: 0, low: 0, fresh: 0 }; const cats = {};
  for (const l of pool) { tiers[tierOf(l)]++; const c = callCategory(l).id; cats[c] = (cats[c] || 0) + 1; }
  return { tiers, cats };
}
export const cleanIds = (ids) => [...new Set((Array.isArray(ids) ? ids : []).map((x) => String(x)).filter((x) => /^[\w-]{3,60}$/.test(x)))].slice(0, MAX_CAMPAIGN);
