// Lead database and call intelligence (pure, shared by the Worker, the Hub and the tests).
// Modeled on the flagship B2B databases and dialers: Apollo.io and ZoomInfo search (filters in categories, saved searches, column picker, exclude filters),
// D&B and Outscraper style business records, Cognism and Apollo phone and email status, Orum, Gong and Nooks call results (who answered, how far the call got,
// objection type), HubSpot's separate fit and engagement scores (grade plus number, like "B2"), and ANUM, BANT, CHAMP, GPCTBA/C&I, FAINT for qualification.
// Research notes: reports/Lead database and call analytics.md (scratch copy outside the repo). Point values are starting guesses to tune on our own results.

// ---------- what we record on every call ----------
// Who (or what) picked up. `kind` human counts as a connect; `machine` and `none` do not.
export const ANSWERED_BY = [
  ['owner', 'Owner or decision maker', 'human'],
  ['staff', 'Staff or receptionist', 'human'],
  ['service', 'Answering service', 'human'],
  ['wrong', 'Wrong person or business', 'human'],
  ['someone', 'Someone (not marked)', 'human'],
  ['menu', 'Phone menu', 'machine'],
  ['voicemail', 'Voicemail', 'machine'],
  ['screening', 'Call screening', 'machine'],
  ['none', 'Nobody (no answer or busy)', 'none'],
  ['dead', 'Dead line (disconnected or fax)', 'none'],
];
export const ANSWERED_KEYS = ANSWERED_BY.map((a) => a[0]);
export const answeredLabel = (k) => (ANSWERED_BY.find((a) => a[0] === k) || [k, k || 'Not known'])[1];
export const isHuman = (k) => (ANSWERED_BY.find((a) => a[0] === k) || [])[2] === 'human';
// The choices the rep sees in the result window (machines and nobody come from the result itself).
export const PICKUP_CHOICES = ['owner', 'staff', 'service', 'wrong'];

// How far a call got before it ended (Orum: hang up in the first seconds, hook rejected, pitch rejected).
export const HANGUP_STAGES = [
  ['opener', 'Right away'], ['reason', 'After the reason for the call'], ['pitch', 'After the pitch'],
  ['price', 'At price or next step'], ['booking', 'While booking'], ['rep', 'We ended it'],
];
export const hangupLabel = (k) => (HANGUP_STAGES.find((a) => a[0] === k) || [k, k || ''])[1];

// Objection reasons, grouped the way Gong groups 300M cold calls: brush offs, situational, existing solution.
export const OBJECTION_GROUPS = { brush: 'Brush off', situation: 'Situation', existing: 'Already has help' };
export const OBJECTIONS = [
  ['brush_off', 'Not interested, no reason', 'brush'], ['busy', 'Too busy to talk', 'brush'], ['send_info', 'Send me info', 'brush'],
  ['has_agency', 'Has an agency or marketing person', 'existing'], ['diy', 'Does it themselves', 'existing'], ['contract', 'Under a contract', 'existing'],
  ['referrals', 'Gets work from referrals', 'existing'], ['partner_decides', 'Spouse or partner decides', 'situation'],
  ['enough_work', 'Has enough work', 'situation'], ['no_budget', 'No budget or too expensive', 'situation'], ['bad_timing', 'Bad timing or slow season', 'situation'],
  ['burned', 'Burned by an agency before', 'situation'], ['not_dm', 'Not the decision maker', 'situation'], ['not_fit', 'Not a fit (closing, franchise, too small)', 'situation'],
  ['other', 'Other', 'situation'],
];
export const objectionLabel = (k) => (OBJECTIONS.find((a) => a[0] === k) || [k, k || ''])[1];
export const objectionGroup = (k) => (OBJECTIONS.find((a) => a[0] === k) || [])[2] || '';

// Disposition (built in result `acts`, or the list id) to a default "who picked up". The rep can change it in the result window.
const BY_ACTS = { no_answer: 'none', voicemail: 'voicemail', phone_menu: 'menu', bad_number: 'dead', gatekeeper: 'staff', conversation: 'owner', booked: 'owner', callback: 'owner', not_interested: 'owner', won: 'owner', dnc: 'someone', hung_up: 'someone' };
const BY_ID = { wrong_number: 'wrong', not_owner: 'staff' };
export function defaultAnswered(dispoId, acts) {
  return BY_ID[dispoId] || BY_ACTS[acts] || null;
}
const OBJ_BY_ID = { has_agency: 'has_agency', not_fit: 'not_fit', send_info: 'send_info', not_owner: 'not_dm' };
export const defaultObjection = (dispoId) => OBJ_BY_ID[dispoId] || '';
// Which extra questions the result window asks for a given result.
export function asksFor(acts) {
  const human = ['conversation', 'booked', 'callback', 'not_interested', 'hung_up', 'gatekeeper', 'dnc', 'won'].includes(acts);
  return { pickup: human, stage: acts === 'hung_up' || acts === 'not_interested', objection: acts === 'not_interested' || acts === 'hung_up', menu: acts === 'phone_menu' };
}

// One call row (an activity) to who answered, filling in older calls from their result.
export function answeredOf(c) {
  if (c.answered_by && ANSWERED_KEYS.includes(c.answered_by)) return c.answered_by;
  const d = defaultAnswered(c.dispo_id || '', c.outcome || '');
  if (d) return d;
  if (/wrong number/i.test(c.dispo || '')) return 'wrong';
  if (/decision maker|gatekeeper/i.test(c.dispo || '')) return 'staff';
  if (c.answered_at && Number(c.duration || 0) >= 10) return 'someone';
  return c.outcome ? 'none' : (c.answered_at ? 'someone' : 'none');
}
export const FAST_HANGUP_SECS = 10; // Orum: a "hang up" is the first 5 to 10 seconds, before the intro ends
export const CONVO_SECS = 60; // Orum: a conversation is a call over one minute; we count it only with the owner

// Talk seconds of one call: only time with a person counts.
export const talkOf = (c) => (isHuman(answeredOf(c)) ? Math.max(0, Number(c.duration || 0)) : 0);

// ---------- per lead roll up ----------
// calls: that lead's outbound calls, any order. Returns the r_* columns saved on the lead.
export function rollup(calls = [], at = Date.now()) {
  const list = calls.filter((c) => !(c.status === 'ready' && !c.outcome)).sort((a, b) => a.at - b.at);
  const r = { r_dials: 0, r_connects: 0, r_owner: 0, r_staff: 0, r_menu: 0, r_vm: 0, r_noans: 0, r_dead: 0, r_wrong: 0, r_talk: 0, r_longest: 0,
    r_fast_hangs: 0, r_convs: 0, r_service: 0, r_shortest: null, r_last_by: null, r_last_dispo: null, r_last_secs: null, r_obj: null, r_first_at: null, r_owner_at: null, r_to_owner: null, r_24h: 0 };
  for (const c of list) {
    const by = answeredOf(c);
    const talk = talkOf(c);
    r.r_dials++;
    if (r.r_first_at == null) r.r_first_at = c.at;
    if (isHuman(by)) { r.r_connects++; r.r_talk += talk; r.r_longest = Math.max(r.r_longest, talk); r.r_shortest = r.r_shortest == null ? talk : Math.min(r.r_shortest, talk); }
    if (by === 'owner') { r.r_owner++; r.r_owner_at = c.at; if (r.r_to_owner == null) r.r_to_owner = r.r_dials; if (talk >= CONVO_SECS) r.r_convs++; }
    if (by === 'staff' || by === 'service') r.r_staff++;
    if (by === 'service') r.r_service++;
    if (by === 'menu') r.r_menu++;
    if (by === 'voicemail' || by === 'screening') r.r_vm++;
    if (by === 'none') r.r_noans++;
    if (by === 'dead') r.r_dead++;
    if (by === 'wrong') r.r_wrong++;
    if ((c.outcome === 'hung_up' || c.hangup_stage === 'opener') && (c.hangup_stage === 'opener' || talk < FAST_HANGUP_SECS)) r.r_fast_hangs++;
    if (c.objection) r.r_obj = c.objection;
    if (at - c.at < 864e5) r.r_24h++;
    r.r_last_by = by; r.r_last_dispo = c.dispo || c.outcome || null; r.r_last_secs = talk;
  }
  return r;
}

// ---------- qualification ----------
// stage: 'call' (2 to 10 minute cold call, ANUM order) or 'audit' (30 to 45 minute clarity audit). fw: the framework it comes from.
export const QUAL = [
  { k: 'dm', stage: 'call', fw: 'ANUM: Authority', label: 'Who we talked to', type: 'pick', options: [['owner', 'Owner'], ['partner', 'Co-owner or partner'], ['manager', 'Manager'], ['staff', 'Staff']] },
  { k: 'need', stage: 'call', fw: 'ANUM: Need', label: 'Biggest problem getting customers', type: 'text' },
  { k: 'wants_more', stage: 'call', fw: 'ANUM: Need', label: 'Wants more work?', type: 'pick', options: [['yes', 'Yes'], ['some', 'Some'], ['enough', 'Has enough'], ['seasonal', 'Only in the slow season']] },
  { k: 'sources', stage: 'call', fw: 'GPCTBA: Plans', label: 'Where customers come from now', type: 'multi', options: [['referral', 'Word of mouth'], ['google', 'Google search or Maps'], ['lsa', 'Google ads or LSA'], ['angi', 'Angi, HomeAdvisor, Thumbtack'], ['yelp', 'Yelp'], ['facebook', 'Facebook or Instagram'], ['nextdoor', 'Nextdoor'], ['repeat', 'Repeat customers'], ['other', 'Other']] },
  { k: 'current_help', stage: 'call', fw: 'Existing solution', label: 'Who does their marketing now', type: 'pick', options: [['none', 'Nobody'], ['self', 'They do it'], ['agency', 'An agency'], ['freelancer', 'A freelancer'], ['family', 'Family or friend'], ['platform', 'Lead platform only']] },
  { k: 'spend', stage: 'call', fw: 'ANUM: Money', label: 'Marketing spend a month', type: 'pick', options: [['0', 'Nothing'], ['lt500', 'Under $500'], ['500', '$500 to $1,500'], ['1500', '$1,500 to $3,000'], ['3000', '$3,000 or more'], ['unknown', 'Would not say']] },
  { k: 'urgency', stage: 'call', fw: 'ANUM: Urgency', label: 'When they would start', type: 'pick', options: [['now', 'Now'], ['30', 'Within 30 days'], ['90', 'Within 90 days'], ['later', 'Later'], ['unsure', 'Not sure']] },
  { k: 'best_time', stage: 'call', fw: 'Reach', label: 'Best time to reach the owner', type: 'text' },
  { k: 'goal', stage: 'audit', fw: 'GPCTBA: Goals', label: 'Goal for the next 12 months', type: 'text' },
  { k: 'tried', stage: 'audit', fw: 'GPCTBA: Plans', label: 'What they tried before', type: 'text' },
  { k: 'burned', stage: 'audit', fw: 'Situation', label: 'Burned by an agency before', type: 'pick', options: [['yes', 'Yes'], ['no', 'No']] },
  { k: 'contract_end', stage: 'audit', fw: 'Existing solution', label: 'Current contract ends', type: 'text' },
  { k: 'challenge', stage: 'audit', fw: 'GPCTBA: Challenges', label: 'What is in the way', type: 'text' },
  { k: 'job_value', stage: 'audit', fw: 'NEAT: Economic impact', label: 'Average job value ($)', type: 'num' },
  { k: 'jobs_month', stage: 'audit', fw: 'NEAT: Economic impact', label: 'Jobs a month now', type: 'num' },
  { k: 'capacity', stage: 'audit', fw: 'NEAT: Economic impact', label: 'More jobs they can take a month', type: 'num' },
  { k: 'cost_nothing', stage: 'audit', fw: 'C&I: Negative consequences', label: 'Cost of doing nothing', type: 'text' },
  { k: 'win', stage: 'audit', fw: 'C&I: Positive implications', label: 'What changes if it works', type: 'text' },
  { k: 'funds', stage: 'audit', fw: 'FAINT: Funds', label: 'Can fund it', type: 'pick', options: [['yes', 'Yes'], ['maybe', 'Maybe'], ['no', 'No']] },
  { k: 'deciders', stage: 'audit', fw: 'BANT: Authority', label: 'Who else decides', type: 'pick', options: [['solo', 'Just them'], ['partner', 'A partner'], ['spouse', 'Spouse'], ['manager', 'A manager']] },
  { k: 'timeline', stage: 'audit', fw: 'BANT: Timeline', label: 'Timeline to decide', type: 'pick', options: [['now', 'On this call'], ['week', 'This week'], ['month', 'This month'], ['later', 'Later']] },
  { k: 'gbp_access', stage: 'audit', fw: 'Readiness', label: 'Can give Google profile access', type: 'pick', options: [['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure who has it']] },
  { k: 'site_owner', stage: 'audit', fw: 'Readiness', label: 'Who controls the website', type: 'pick', options: [['them', 'They do'], ['designer', 'Web designer'], ['agency', 'An agency'], ['nobody', 'Nobody knows'], ['none', 'No website']] },
  { k: 'employees', stage: 'audit', fw: 'Firmographic', label: 'People on the team', type: 'pick', options: [['1', 'Just them'], ['2', '2 to 5'], ['6', '6 to 10'], ['11', '11 to 25'], ['26', '26 to 50'], ['51', 'Over 50']] },
  { k: 'years', stage: 'audit', fw: 'Firmographic', label: 'Years in business', type: 'num' },
  { k: 'service_area', stage: 'audit', fw: 'Firmographic', label: 'Service area', type: 'text' },
  { k: 'season', stage: 'audit', fw: 'Firmographic', label: 'Busy season', type: 'text' },
];
export const QUAL_KEYS = QUAL.map((q) => q.k);
const QMAP = Object.fromEntries(QUAL.map((q) => [q.k, q]));

// Keep only known fields with allowed values. Text 300 characters, numbers 0 to 10,000,000.
export function cleanQual(raw = {}) {
  const out = {};
  for (const q of QUAL) {
    const v = raw?.[q.k];
    if (v == null || v === '') continue;
    if (q.type === 'text') { const s = String(v).replace(/[–—]/g, ', ').trim().slice(0, 300); if (s) out[q.k] = s; }
    else if (q.type === 'num') { const n = Number(String(v).replace(/[$,\s]/g, '')); if (Number.isFinite(n) && n >= 0 && n <= 1e7) out[q.k] = Math.round(n); }
    else if (q.type === 'pick') { if (q.options.some((o) => o[0] === String(v))) out[q.k] = String(v); }
    else if (q.type === 'multi') { const l = (Array.isArray(v) ? v : String(v).split(',')).map(String).filter((x) => q.options.some((o) => o[0] === x)); if (l.length) out[q.k] = [...new Set(l)]; }
  }
  return out;
}
export const qualCount = (q) => Object.keys(q || {}).filter((k) => QMAP[k]).length;
// ANUM status on the cold call: which of authority, need, urgency, money are known, and whether it is a yes.
export function anum(q = {}) {
  return {
    authority: q.dm ? (q.dm === 'owner' || q.dm === 'partner') : null,
    need: q.wants_more ? q.wants_more !== 'enough' : (q.need ? true : null),
    urgency: q.urgency ? ['now', '30', '90'].includes(q.urgency) : null,
    money: q.spend ? q.spend !== '0' || q.funds === 'yes' : (q.funds ? q.funds !== 'no' : null),
  };
}
export function qualLine(q = {}) {
  const a = anum(q);
  return [['authority', 'Authority'], ['need', 'Need'], ['urgency', 'Urgency'], ['money', 'Money']].map(([k, n]) => `${n} ${a[k] == null ? '?' : a[k] ? 'yes' : 'no'}`).join(', ');
}

// ---------- scores ----------
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
// Reach: will a call get a live owner? Point table from the research (line type, owner name, likely owner, a person answered before, menus and dead lines).
export function reachScore(l = {}) {
  if (l.dnc || l.scrub || ((l.r_dead || 0) + (l.r_wrong || 0) > 0 && !(l.r_owner > 0))) return 0;
  const pt = l.phone_type || '';
  let s = pt === 'mobile' ? 30 : pt === 'landline' || pt === 'voip' ? 15 : pt === 'toll_free' ? -20 : 5;
  if (l.owner_known) s += 15;
  if (l.likely_owner === true) s += 15;
  if ((l.r_connects || 0) > 0) s += 20;
  if ((l.r_owner || 0) > 0) s += 10;
  const unanswered = (l.r_dials || 0) - (l.r_connects || 0);
  if (unanswered > 3) s -= 5 * (unanswered - 3);
  if ((l.r_menu || 0) > 0 || (l.r_service || 0) > 0) s -= 25;
  if ((l.r_fast_hangs || 0) > 1) s -= 10;
  return clamp(s);
}
// Engagement: what they have done with us. Halves every 90 days since the last sign of interest (HubSpot's example decay).
export function engageScore(l = {}, at = Date.now()) {
  let s = 0;
  if (['audit_requested'].includes(l.stage) || /form|book|website/i.test(l.source || '')) s += 40;
  if (['audit_booked', 'won'].includes(l.stage) || l.meet_at) s += 30;
  if (l.stage === 'callback') s += 20;
  if ((l.pack_views || 0) > 0) s += 10;
  if ((l.r_convs || 0) > 0) s += 10;
  if ((l.r_owner || 0) > 0 && (l.r_talk || 0) >= 180) s += 10;
  if ((l.qual_n || 0) >= 4) s += 10;
  if (l.stage === 'no_show') s -= 10;
  if (l.r_obj || l.stage === 'not_now') s -= 30;
  if (['lost', 'dnc'].includes(l.stage)) s -= 30;
  const last = Math.max(l.r_owner_at || 0, l.meet_at || 0);
  if (last && at - last > 90 * 864e5) s /= 2;
  return clamp(s);
}
// Fit letter plus engagement digit, like HubSpot's "C1": 1 is 40 or more, 2 is 10 to 39, 3 is under 10. Reach sorts inside each label.
export const engageTier = (n) => (n >= 40 ? 1 : n >= 10 ? 2 : 3);
export const reachTier = (n) => (n >= 60 ? 1 : n >= 35 ? 2 : 3);
export const comboLabel = (grade, engage) => `${grade || '?'}${engageTier(engage || 0)}`;

// ---------- search catalog ----------
// What the database can filter on. The Worker builds SQL only from this list (sql is a fixed column or expression, never user text).
// type: text (contains), pick (any of), range (min and max), bool (yes or no), qual (a qualification answer).
export const FILTER_CATS = [
  ['business', 'Business'], ['contact', 'Contact and data'], ['calls', 'Call history'], ['qual', 'Qualification'], ['scores', 'Scores'], ['comply', 'Compliance'],
];
export const FILTERS = [
  { k: 'q', cat: 'business', label: 'Name, phone or city', type: 'text', sql: "(business || ' ' || COALESCE(phone_digits,'') || ' ' || COALESCE(city,'') || ' ' || COALESCE(owner_name,''))" },
  { k: 'industry', cat: 'business', label: 'Industry or category', type: 'text', sql: "(COALESCE(industry,'') || ' ' || COALESCE(category,''))" },
  { k: 'state', cat: 'business', label: 'State', type: 'pick', sql: 'state', dynamic: true },
  { k: 'city', cat: 'business', label: 'City', type: 'text', sql: 'city' },
  { k: 'zip', cat: 'business', label: 'ZIP', type: 'text', sql: 'zip' },
  { k: 'stage', cat: 'business', label: 'Stage', type: 'pick', sql: 'stage', options: [['new', 'New lead'], ['attempting', 'Attempting'], ['callback', 'Callback'], ['follow_up', 'Following up'], ['audit_requested', 'Audit requested'], ['audit_booked', 'Audit booked'], ['no_show', 'No show'], ['not_now', 'Not now'], ['won', 'Won'], ['lost', 'Lost'], ['dnc', 'Do not call']] },
  { k: 'source', cat: 'business', label: 'Lead source', type: 'pick', sql: 'source', dynamic: true },
  { k: 'tags', cat: 'business', label: 'Tag', type: 'text', sql: 'tags' },
  { k: 'website', cat: 'business', label: 'Has a website', type: 'bool', sql: "(website IS NOT NULL AND website != '')" },
  { k: 'reviews', cat: 'business', label: 'Google reviews', type: 'range', sql: 'reviews' },
  { k: 'rating', cat: 'business', label: 'Google rating', type: 'range', sql: 'rating', step: 0.1 },
  { k: 'map_rank', cat: 'business', label: 'Map rank', type: 'range', sql: 'map_rank' },
  { k: 'owner_known', cat: 'contact', label: 'Owner name known', type: 'bool', sql: "(owner_name IS NOT NULL AND owner_name != '')" },
  { k: 'phone_type', cat: 'contact', label: 'Phone type', type: 'pick', sql: 'phone_type', options: [['mobile', 'Mobile'], ['landline', 'Landline'], ['voip', 'Internet phone'], ['toll_free', 'Toll free'], ['__null', 'Not checked']] },
  { k: 'email_status', cat: 'contact', label: 'Email', type: 'pick', sql: 'email_status', options: [['valid', 'Valid'], ['role', 'Shared inbox (info@)'], ['unverified', 'Not checked'], ['no_mail_server', 'No mail server'], ['bad', 'Bad'], ['__null', 'No email']] },
  { k: 'data_score', cat: 'contact', label: 'Data score', type: 'range', sql: 'data_score' },
  { k: 'scrubbed', cat: 'contact', label: 'Scrubbed', type: 'bool', sql: '(scrubbed_at IS NOT NULL)' },
  { k: 'researched', cat: 'contact', label: 'Researched', type: 'bool', sql: '(intel_at IS NOT NULL)' },
  { k: 'stale', cat: 'contact', label: 'Data older than 6 months', type: 'bool', sql: '(COALESCE(scrubbed_at, created_at) < @stale)' },
  { k: 'r_dials', cat: 'calls', label: 'Times dialed', type: 'range', sql: 'COALESCE(r_dials,0)' },
  { k: 'never', cat: 'calls', label: 'Never called', type: 'bool', sql: '(COALESCE(r_dials,0) = 0)' },
  { k: 'reached_owner', cat: 'calls', label: 'Reached the owner', type: 'bool', sql: '(COALESCE(r_owner,0) > 0)' },
  { k: 'staff_only', cat: 'calls', label: 'Only reached staff', type: 'bool', sql: '(COALESCE(r_staff,0) > 0 AND COALESCE(r_owner,0) = 0)' },
  { k: 'menu', cat: 'calls', label: 'Hit a phone menu', type: 'bool', sql: '(COALESCE(r_menu,0) > 0)' },
  { k: 'vm_only', cat: 'calls', label: 'Voicemail only', type: 'bool', sql: '(COALESCE(r_vm,0) > 0 AND COALESCE(r_connects,0) = 0)' },
  { k: 'fast_hang', cat: 'calls', label: 'Hung up on us fast', type: 'bool', sql: '(COALESCE(r_fast_hangs,0) > 0)' },
  { k: 'dead', cat: 'calls', label: 'Dead or wrong number', type: 'bool', sql: '(COALESCE(r_dead,0) + COALESCE(r_wrong,0) > 0)' },
  { k: 'r_talk', cat: 'calls', label: 'Total talk (minutes)', type: 'range', sql: '(COALESCE(r_talk,0) / 60.0)' },
  { k: 'r_longest', cat: 'calls', label: 'Longest call (minutes)', type: 'range', sql: '(COALESCE(r_longest,0) / 60.0)' },
  { k: 'r_last_by', cat: 'calls', label: 'Last call reached', type: 'pick', sql: 'r_last_by', options: ANSWERED_BY.map(([k, n]) => [k, n]) },
  { k: 'r_obj', cat: 'calls', label: 'Last objection', type: 'pick', sql: 'r_obj', options: OBJECTIONS.map(([k, n]) => [k, n]) },
  { k: 'called_days', cat: 'calls', label: 'Last called (days ago)', type: 'range', sql: '((@now - last_call_at) / 86400000.0)' },
  { k: 'qual_n', cat: 'qual', label: 'Qualification answers', type: 'range', sql: 'COALESCE(qual_n,0)' },
  ...['dm', 'wants_more', 'current_help', 'spend', 'urgency', 'funds', 'deciders', 'gbp_access', 'site_owner', 'employees'].map((k) => ({ k: `qual_${k}`, cat: 'qual', label: QMAP[k].label, type: 'pick', sql: `json_extract(qual, '$.${k}')`, options: QMAP[k].options })),
  { k: 'grade', cat: 'scores', label: 'Fit grade', type: 'pick', sql: 'grade', options: [['A', 'A (75+)'], ['B', 'B (60 to 74)'], ['C', 'C (45 to 59)'], ['D', 'D (under 45)'], ['X', 'X (lost or do not call)'], ['__null', 'Not scored']] },
  { k: 'score', cat: 'scores', label: 'Fit score', type: 'range', sql: 'score' },
  { k: 'reach_score', cat: 'scores', label: 'Reach score', type: 'range', sql: 'COALESCE(reach_score,0)' },
  { k: 'engage_score', cat: 'scores', label: 'Engagement score', type: 'range', sql: 'COALESCE(engage_score,0)' },
  { k: 'dnc', cat: 'comply', label: 'Do not call', type: 'bool', sql: '(dnc = 1)' },
  { k: 'sms_consent', cat: 'comply', label: 'Said yes to texts', type: 'bool', sql: '(sms_consent = 1)' },
  { k: 'calls_24h', cat: 'comply', label: '3 calls in the last 24 hours', type: 'bool', sql: '(COALESCE(r_24h,0) >= 3 AND last_call_at > @day)' },
];
export const FILTER_MAP = Object.fromEntries(FILTERS.map((f) => [f.k, f]));

// Columns the table can show and sort by. `sort` is the SQL used to sort (fixed text).
export const COLUMNS = [
  ['business', 'Business', 'business'], ['owner', 'Owner or contact', "COALESCE(owner_name, contact_name, '')"], ['phone', 'Phone', 'phone_digits'], ['phone_type', 'Phone type', 'phone_type'],
  ['email', 'Email', 'email'], ['city', 'City', 'city'], ['state', 'State', 'state'], ['industry', 'Industry', "COALESCE(industry, category, '')"], ['stage', 'Stage', 'stage'],
  ['combo', 'Grade', 'score'], ['reach_score', 'Reach', 'reach_score'], ['engage_score', 'Engagement', 'engage_score'], ['reviews', 'Reviews', 'reviews'], ['rating', 'Rating', 'rating'],
  ['map_rank', 'Map rank', 'map_rank'], ['r_dials', 'Dials', 'r_dials'], ['r_connects', 'Connects', 'r_connects'], ['r_owner', 'Owner reached', 'r_owner'],
  ['r_talk', 'Talk', 'r_talk'], ['r_longest', 'Longest call', 'r_longest'], ['r_last_by', 'Last reached', 'r_last_by'], ['r_last_dispo', 'Last result', 'r_last_dispo'],
  ['r_obj', 'Objection', 'r_obj'], ['last_call_at', 'Last called', 'last_call_at'], ['qual_n', 'Qualified', 'qual_n'], ['data_score', 'Data', 'data_score'],
  ['source', 'Source', 'source'], ['created_at', 'Added', 'created_at'],
];
export const DEFAULT_COLUMNS = ['business', 'owner', 'phone_type', 'industry', 'city', 'combo', 'reach_score', 'r_dials', 'r_owner', 'r_talk', 'r_last_by', 'r_last_dispo', 'last_call_at'];
export const COLUMN_MAP = Object.fromEntries(COLUMNS.map((c) => [c[0], c]));

// Ready-made searches, like Apollo's saved searches. f is a filter object.
export const PRESETS = [
  ['owners_pick_up', 'Owners pick up', { reached_owner: true, dnc: false }, 'engage_score'],
  ['never_called_mobile', 'Never called, mobile', { never: true, phone_type: ['mobile'], dnc: false }, 'score'],
  ['long_talks', 'Longest conversations', { r_talk: { min: 2 }, dnc: false }, 'r_talk'],
  ['fast_hangups', 'Hung up fast', { fast_hang: true }, 'last_call_at'],
  ['gatekept', 'Only reached staff', { staff_only: true, dnc: false }, 'r_dials'],
  ['phone_menus', 'Phone menus', { menu: true }, 'r_dials'],
  ['vm_only', 'Voicemail only, 3+ tries', { vm_only: true, r_dials: { min: 3 } }, 'r_dials'],
  ['dead', 'Dead or wrong numbers', { dead: true }, 'last_call_at'],
  ['qualified', 'ANUM answers on file', { qual_n: { min: 3 } }, 'qual_n'],
  ['stale', 'Data older than 6 months', { stale: true, dnc: false }, 'created_at'],
];

// Clean a filter object from the browser: only known keys, short values, at most 20 picks per filter.
export function cleanFilter(raw = {}) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const f = FILTER_MAP[k];
    if (!f || v == null || v === '') continue;
    if (f.type === 'text') { const s = String(v).trim().slice(0, 80); if (s) out[k] = s; }
    else if (f.type === 'bool') { if (v === true || v === 'yes' || v === 'true') out[k] = true; else if (v === false || v === 'no' || v === 'false') out[k] = false; }
    else if (f.type === 'range') {
      const min = v.min === '' || v.min == null ? null : Number(v.min), max = v.max === '' || v.max == null ? null : Number(v.max);
      const r = {};
      if (Number.isFinite(min)) r.min = min;
      if (Number.isFinite(max)) r.max = max;
      if (Object.keys(r).length) out[k] = r;
    } else if (f.type === 'pick') {
      const l = (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim().slice(0, 60)).filter(Boolean).slice(0, 20);
      if (l.length) out[k] = [...new Set(l)];
    }
  }
  return out;
}

// Filter object to a SQL WHERE clause and its values. Only catalog SQL goes into the text; every user value is a bound "?".
export function whereFor(filter = {}, { now = Date.now() } = {}) {
  const f = cleanFilter(filter);
  const parts = [], vals = [];
  const fill = (sql) => sql.replace(/@now/g, String(Math.round(now))).replace(/@day/g, String(Math.round(now - 864e5))).replace(/@stale/g, String(Math.round(now - 182 * 864e5)));
  for (const [k, v] of Object.entries(f)) {
    const d = FILTER_MAP[k];
    const sql = fill(d.sql);
    if (d.type === 'text') { parts.push(`${sql} LIKE ?`); vals.push(`%${v.replace(/[%_]/g, '')}%`); }
    else if (d.type === 'bool') parts.push(v ? sql : `NOT ${sql}`);
    else if (d.type === 'range') {
      if (v.min != null) { parts.push(`${sql} >= ?`); vals.push(v.min); }
      if (v.max != null) { parts.push(`${sql} <= ?`); vals.push(v.max); }
    } else if (d.type === 'pick') {
      const real = v.filter((x) => x !== '__null');
      const ors = [];
      if (real.length) { ors.push(`${sql} IN (${real.map(() => '?').join(',')})`); vals.push(...real); }
      if (v.includes('__null')) ors.push(`(${sql} IS NULL OR ${sql} = '')`);
      parts.push(`(${ors.join(' OR ')})`);
    }
  }
  return { where: parts.length ? parts.join(' AND ') : '1 = 1', vals, filter: f };
}
export const filterCount = (f = {}) => Object.keys(cleanFilter(f)).length;

// ---------- insights across every call ----------
export const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const TALK_BUCKETS = [[0, 10, 'Under 10s'], [10, 30, '10 to 30s'], [30, 60, '30s to 1m'], [60, 120, '1 to 2m'], [120, 300, '2 to 5m'], [300, Infinity, '5m and up']];
const reviewBand = (n) => (n == null ? 'Not known' : n < 10 ? 'Under 10' : n < 25 ? '10 to 24' : n < 50 ? '25 to 49' : n < 100 ? '50 to 99' : n < 250 ? '100 to 249' : '250 and up');
function seg() { return { dials: 0, human: 0, owner: 0, conv: 0, staff: 0, menu: 0, vm: 0, none: 0, dead: 0, booked: 0, positive: 0, talk: 0, fast: 0, logged: 0 }; }
const POSITIVE = ['booked', 'won', 'callback'];
function addSeg(s, c, by, talk) {
  s.dials++;
  if (isHuman(by)) { s.human++; s.talk += talk; }
  if (by === 'owner') { s.owner++; if (talk >= CONVO_SECS) s.conv++; }
  if (by === 'staff' || by === 'service') s.staff++;
  if (by === 'menu') s.menu++;
  if (by === 'voicemail' || by === 'screening') s.vm++;
  if (by === 'none') s.none++;
  if (by === 'dead' || by === 'wrong') s.dead++;
  if (c.outcome === 'booked' || c.outcome === 'won') s.booked++;
  if (POSITIVE.includes(c.outcome) || c.dispo_id === 'send_info') s.positive++;
  if (c.outcome) s.logged++;
  if (c.fast) s.fast++;
}
const rate = (n, d) => (d ? n / d : 0);
function finishSeg(key, s) {
  return { key, ...s, pickup: rate(s.human, s.dials), ownerRate: rate(s.owner, s.dials), menuRate: rate(s.menu, s.dials), convRate: rate(s.conv, s.owner), setRate: rate(s.booked, s.conv),
    fastRate: rate(s.fast, s.human), positiveRate: rate(s.positive, s.dials), fillRate: rate(s.logged, s.dials), bookRate: rate(s.booked, s.human), avgTalk: s.human ? Math.round(s.talk / s.human) : 0 };
}
// rows: outbound calls with lead fields. Each row may carry `hour` and `dow` (in the lead's own time zone), already worked out by the caller.
export function insights(rows = [], { minDials = 5 } = {}) {
  const total = seg();
  const groups = { hour: new Map(), dow: new Map(), industry: new Map(), phone_type: new Map(), attempt: new Map(), reviews: new Map(), state: new Map(), source: new Map(), grade: new Map(), rep: new Map() };
  const answered = new Map(), dispos = new Map(), objections = new Map(), stages = new Map();
  const talkB = TALK_BUCKETS.map(([, , label]) => ({ label, calls: 0, booked: 0 }));
  const short = [], long = [];
  const toOwner = [];
  const dialed = new Set(), reached = new Set(), ownered = new Set();
  for (const c0 of rows) {
    if (c0.status === 'ready' && !c0.outcome) continue;
    const by = answeredOf(c0);
    const talk = talkOf(c0);
    const c = { ...c0, fast: (c0.outcome === 'hung_up' || c0.hangup_stage === 'opener') && (c0.hangup_stage === 'opener' || talk < FAST_HANGUP_SECS) };
    addSeg(total, c, by, talk);
    const put = (g, k) => { const m = groups[g]; addSeg(m.get(k) || m.set(k, seg()).get(k), c, by, talk); };
    if (c.hour != null) put('hour', c.hour);
    if (c.dow != null) put('dow', c.dow);
    put('industry', c.industry || 'Not known');
    put('phone_type', c.phone_type || 'Not checked');
    put('attempt', c.attempt_no ? Math.min(c.attempt_no, 8) : 0);
    put('reviews', reviewBand(c.reviews));
    put('state', c.state || 'Not known');
    put('source', c.source || 'Not known');
    put('grade', c.grade || 'Not scored');
    put('rep', c.by || 'unknown');
    answered.set(by, (answered.get(by) || 0) + 1);
    const dl = c.dispo || c.outcome || 'No result';
    dispos.set(dl, (dispos.get(dl) || 0) + 1);
    if (c.objection) objections.set(c.objection, (objections.get(c.objection) || 0) + 1);
    if (c.hangup_stage) stages.set(c.hangup_stage, (stages.get(c.hangup_stage) || 0) + 1);
    if (isHuman(by)) {
      const bi = TALK_BUCKETS.findIndex(([a, b]) => talk >= a && talk < b);
      if (bi >= 0) { talkB[bi].calls++; if (c.outcome === 'booked' || c.outcome === 'won') talkB[bi].booked++; }
      const item = { id: c.id, lead_id: c.lead_id, business: c.business || '', at: c.at, secs: talk, by, dispo: dl, objection: c.objection || '', stage: c.hangup_stage || '' };
      short.push(item); long.push(item);
    }
    if (by === 'owner' && c.attempt_no) toOwner.push(c.attempt_no);
    if (c.lead_id) { dialed.add(c.lead_id); if (isHuman(by)) reached.add(c.lead_id); if (by === 'owner') ownered.add(c.lead_id); }
  }
  short.sort((a, b) => a.secs - b.secs || b.at - a.at);
  long.sort((a, b) => b.secs - a.secs || b.at - a.at);
  const list = (m, min = 0) => [...m.entries()].map(([k, s]) => finishSeg(k, s)).filter((s) => s.dials >= min);
  const objTotal = [...objections.values()].reduce((a, b) => a + b, 0);
  return {
    total: { ...finishSeg('all', total), businesses: dialed.size, reachedBiz: reached.size, ownerBiz: ownered.size, bizReach: rate(reached.size, dialed.size), dialsPerBooked: total.booked ? Math.round(total.dials / total.booked) : null },
    answered: ANSWERED_BY.map(([k, label, kind]) => ({ key: k, label, kind, n: answered.get(k) || 0 })).filter((a) => a.n),
    byHour: HOURS.map((h) => finishSeg(h, (groups.hour.get(h) || seg()))),
    byDay: DAYS.map((d, i) => finishSeg(d, (groups.dow.get(i) || seg()))),
    byIndustry: list(groups.industry, minDials).sort((a, b) => b.dials - a.dials).slice(0, 25),
    byPhoneType: list(groups.phone_type).sort((a, b) => b.dials - a.dials),
    byAttempt: list(groups.attempt).filter((s) => s.key).sort((a, b) => a.key - b.key),
    byReviews: ['Under 10', '10 to 24', '25 to 49', '50 to 99', '100 to 249', '250 and up', 'Not known'].map((k) => finishSeg(k, groups.reviews.get(k) || seg())).filter((s) => s.dials),
    byState: list(groups.state, minDials).sort((a, b) => b.dials - a.dials).slice(0, 20),
    bySource: list(groups.source).sort((a, b) => b.dials - a.dials),
    byGrade: list(groups.grade).sort((a, b) => String(a.key).localeCompare(String(b.key))),
    byRep: list(groups.rep).sort((a, b) => b.dials - a.dials),
    talk: talkB,
    dispositions: [...dispos.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n),
    objections: OBJECTIONS.map(([k, label, g]) => ({ key: k, label, group: g, n: objections.get(k) || 0, share: rate(objections.get(k) || 0, objTotal) })).filter((o) => o.n),
    objectionGroups: Object.entries(OBJECTION_GROUPS).map(([g, label]) => ({ key: g, label, n: OBJECTIONS.filter((o) => o[2] === g).reduce((s, o) => s + (objections.get(o[0]) || 0), 0) })),
    hangupStages: HANGUP_STAGES.map(([k, label]) => ({ key: k, label, n: stages.get(k) || 0 })).filter((s) => s.n),
    shortest: short.slice(0, 15),
    longest: long.slice(0, 15),
    triesToOwner: toOwner.length ? Math.round((toOwner.reduce((a, b) => a + b, 0) / toOwner.length) * 10) / 10 : null,
  };
}
// The best hours by owner reach, only hours with enough dials to mean something.
export function bestHours(byHour = [], min = 10) {
  return byHour.filter((h) => h.dials >= min).sort((a, b) => b.ownerRate - a.ownerRate || b.pickup - a.pickup).slice(0, 3);
}
