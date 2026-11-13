// Workflows: triggers, actions, conditions and ready made recipes (Nov 2026). Pure, shared by the builder page, the Worker
// (src/workflows.js) and tests. Modeled on GoHighLevel Workflows (trigger, then a list of actions with waits and if/else
// filters, templates called recipes), HubSpot workflows (enrollment rules, re-enrollment off by default, "unenroll when they
// reply") and Zapier's step editor. Every text goes through the Hub's texting rules (consent, STOP, 8am to 8pm their time),
// every email through the same sender as the Hub composer, and nothing here can call anyone: calls stay human.

export const TRIGGERS = [
  { id: 'lead_created', label: 'New lead added', group: 'Leads', help: 'A lead is added by hand, by import, by the Lead finder or by a form.',
    fields: [{ k: 'sources', label: 'Only these sources (blank = any)', type: 'tags', placeholder: 'web form, booking page, inbound text' }] },
  { id: 'form_submitted', label: 'Website form filled in', group: 'Leads', help: 'Someone asked for an audit on rightwaygrowth.com or the booking page.', fields: [] },
  { id: 'missed_call', label: 'Missed call', group: 'Phone', help: 'Someone called one of our numbers and nobody answered.', fields: [] },
  { id: 'text_in', label: 'Text received', group: 'Phone', help: 'A lead texted one of our numbers (STOP and START are handled before this).',
    fields: [{ k: 'contains', label: 'Only when the text says (blank = any text)', type: 'text', placeholder: 'C' }] },
  { id: 'call_result', label: 'Call result saved', group: 'Phone', help: 'A rep saved a result after a call.',
    fields: [{ k: 'outcomes', label: 'Only these results (blank = any)', type: 'outcomes' }] },
  { id: 'appointment_booked', label: 'Audit booked', group: 'Calendar', help: 'An audit or meeting was booked by a rep or online.', fields: [] },
  { id: 'stage_changed', label: 'Pipeline stage changed', group: 'Leads', help: 'A lead moved to another stage, by hand or by a call result.',
    fields: [{ k: 'to', label: 'Only when it moves to', type: 'stage', any: true }] },
  { id: 'tag_added', label: 'Tag added', group: 'Leads', help: 'A tag was added to a lead.', fields: [{ k: 'tag', label: 'Tag', type: 'text', placeholder: 'hot' }] },
  { id: 'work_order_signed', label: 'Work order signed', group: 'Sales', help: 'A client e-signed a work order.', fields: [] },
  { id: 'payment_received', label: 'Payment received', group: 'Sales', help: 'Stripe reported a successful payment.', fields: [] },
  { id: 'client_created', label: 'New client', group: 'Clients', help: 'A lead became a client.', fields: [] },
];
export const TRIGGER_MAP = Object.fromEntries(TRIGGERS.map((t) => [t.id, t]));

export const ACTIONS = [
  { id: 'send_text', label: 'Send a text', group: 'Talk to them', icon: 'msg', help: 'Goes from our number with the Hub texting rules. The first text adds our name and "Reply STOP to opt out".',
    fields: [{ k: 'text', label: 'Message', type: 'textarea', max: 480, placeholder: 'Hi {first}, this is {rep} with Rightway Growth...' }] },
  { id: 'send_email', label: 'Send an email', group: 'Talk to them', icon: 'mail', help: 'Sent through the Hub email (Resend). Replies go to the person named as the sender.',
    fields: [{ k: 'subject', label: 'Subject', type: 'text', max: 160 }, { k: 'body', label: 'Message', type: 'textarea', max: 4000 }] },
  { id: 'wait', label: 'Wait', group: 'Timing', icon: 'clock', help: 'Pauses this lead in the workflow.',
    fields: [{ k: 'amount', label: 'How long', type: 'number', min: 1, max: 365, def: 5 }, { k: 'unit', label: 'Unit', type: 'select', options: [['minutes', 'Minutes'], ['hours', 'Hours'], ['days', 'Days']], def: 'minutes' }] },
  { id: 'condition', label: 'Continue only if', group: 'Timing', icon: 'check', help: 'Stops the workflow for this lead when the check is not true (GoHighLevel\'s If/Else with the No branch ending).',
    fields: [{ k: 'check', label: 'Check', type: 'select', options: () => CHECKS.map((c) => [c.id, c.label]) }, { k: 'value', label: 'Value (when the check needs one)', type: 'text' }] },
  { id: 'task', label: 'Set a call task', group: 'Team', icon: 'phone', help: 'Puts the lead at the top of the dialer with a next step due in N minutes.',
    fields: [{ k: 'title', label: 'Next step', type: 'text', def: 'Call now (speed to lead)' }, { k: 'minutes', label: 'Due in minutes', type: 'number', min: 0, max: 10080, def: 5 }] },
  { id: 'notify', label: 'Alert the team', group: 'Team', icon: 'bell', help: 'A Hub notification (and Slack, if connected).',
    fields: [{ k: 'to', label: 'Who', type: 'select', options: [['owner', 'The lead\'s rep (owners if none)'], ['owners', 'Owners'], ['staff', 'Everyone on the team']], def: 'owner' }, { k: 'title', label: 'Title', type: 'text', def: 'Needs you: {business}' }, { k: 'body', label: 'Details', type: 'text' }] },
  { id: 'assign', label: 'Assign a rep', group: 'Team', icon: 'users', help: 'Round robin gives it to the teammate with the fewest open leads.',
    fields: [{ k: 'user', label: 'Rep', type: 'user', rr: true }] },
  { id: 'set_stage', label: 'Move pipeline stage', group: 'Lead', icon: 'chart', fields: [{ k: 'stage', label: 'Stage', type: 'stage' }] },
  { id: 'add_tag', label: 'Add a tag', group: 'Lead', icon: 'pin', fields: [{ k: 'tag', label: 'Tag', type: 'text' }] },
  { id: 'remove_tag', label: 'Remove a tag', group: 'Lead', icon: 'pin', fields: [{ k: 'tag', label: 'Tag', type: 'text' }] },
  { id: 'note', label: 'Add a note', group: 'Lead', icon: 'note', fields: [{ k: 'text', label: 'Note', type: 'textarea', max: 1000 }] },
  { id: 'webhook', label: 'Send to another app', group: 'Other apps', icon: 'send', help: 'POSTs the lead as JSON to a URL (Zapier, Make, n8n catch hooks).',
    fields: [{ k: 'url', label: 'Webhook URL (https)', type: 'text', placeholder: 'https://hooks.zapier.com/...' }] },
];
export const ACTION_MAP = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));

// Checks for "Continue only if". Each reads the run context: { lead, event, startedAt, replied, called }.
export const CHECKS = [
  { id: 'not_replied', label: 'They have not replied by text yet', test: (c) => !c.replied },
  { id: 'replied', label: 'They replied by text', test: (c) => Boolean(c.replied) },
  { id: 'not_called', label: 'Nobody has called them yet (since this started)', test: (c) => !c.called },
  { id: 'not_booked', label: 'No audit booked yet', test: (c) => !(c.lead?.meet_at > Date.now()) && c.lead?.stage !== 'audit_booked' },
  { id: 'stage_is', label: 'Stage is (value)', needs: true, test: (c, v) => c.lead?.stage === v },
  { id: 'stage_not', label: 'Stage is not (value)', needs: true, test: (c, v) => c.lead?.stage !== v },
  { id: 'has_tag', label: 'Has the tag (value)', needs: true, test: (c, v) => tagList(c.lead?.tags).includes(String(v || '').toLowerCase()) },
  { id: 'no_tag', label: 'Does not have the tag (value)', needs: true, test: (c, v) => !tagList(c.lead?.tags).includes(String(v || '').toLowerCase()) },
  { id: 'has_email', label: 'Has an email address', test: (c) => /@/.test(c.lead?.email || '') },
  { id: 'can_text', label: 'We may text them (consent, no STOP)', test: (c) => Boolean(c.lead) && !c.lead.dnc && !c.lead.sms_stop && (Boolean(c.lead.sms_consent) || Boolean(c.replied) || c.event?.type === 'missed_call' || c.event?.type === 'text_in') },
  { id: 'text_says', label: 'Their text says (value)', needs: true, test: (c, v) => norm(c.event?.text) === norm(v) },
];
export const CHECK_MAP = Object.fromEntries(CHECKS.map((c) => [c.id, c]));

const norm = (s) => String(s || '').trim().toLowerCase().replace(/[.!\s]+$/, '');
export const tagList = (t) => String(t || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

// ---------- recipes ----------
// GoHighLevel's highest leverage automations, rebuilt on Hub data. All off until an owner turns one on.
export const RECIPES = [
  { id: 'speed_to_lead', name: 'Speed to lead', why: 'Leads called within 5 minutes were 21 times more likely to qualify than at 30 minutes (InsideSales and Oldroyd, 2007; measured qualification, not closed deals).',
    trigger: { type: 'form_submitted' }, stopOnReply: false,
    steps: [
      { type: 'send_text', text: 'Hi {first}, this is {rep} with Rightway Growth. Got your request for the Google audit. I will call you in a few minutes from this number. Is now still good?' },
      { type: 'task', title: 'Call now (speed to lead)', minutes: 0 },
      { type: 'notify', to: 'staff', title: 'New audit request: {business}', body: 'Call within 5 minutes. {phone}' },
      { type: 'wait', amount: 5, unit: 'minutes' },
      { type: 'condition', check: 'not_called' },
      { type: 'notify', to: 'owners', title: 'Nobody has called {business} yet', body: 'The audit request is 5 minutes old.' },
    ] },
  { id: 'missed_call', name: 'Missed call text back', why: 'Answers a caller we missed while they still want help. One text, only to the number that just called us.',
    trigger: { type: 'missed_call' }, stopOnReply: true,
    steps: [
      { type: 'send_text', text: 'Hi, this is Rightway Growth. Sorry we missed your call. How can we help? You can also pick a time here: {book_link}' },
      { type: 'task', title: 'Call back (missed call)', minutes: 10 },
      { type: 'notify', to: 'staff', title: 'Missed call texted: {phone}', body: 'We texted them back. Call back when you can.' },
    ] },
  { id: 'confirm_reply', name: 'Two way confirm (reply C)', why: 'Lets the lead confirm by text. Pair it with a reminder that says "Reply C to confirm or R to pick a new time".',
    trigger: { type: 'text_in', contains: 'C' }, stopOnReply: false,
    steps: [
      { type: 'add_tag', tag: 'confirmed' },
      { type: 'send_text', text: 'Thanks {first}, you are confirmed. Talk soon.' },
      { type: 'notify', to: 'owner', title: '{business} confirmed by text', body: 'They replied C.' },
    ] },
  { id: 'reschedule_reply', name: 'Two way reschedule (reply R)', why: 'Sends the booking link the moment they ask for a new time, so the audit is not lost.',
    trigger: { type: 'text_in', contains: 'R' }, stopOnReply: false,
    steps: [
      { type: 'send_text', text: 'No problem {first}. Pick a new time here: {book_link}' },
      { type: 'add_tag', tag: 'rescheduling' },
      { type: 'notify', to: 'owner', title: '{business} wants a new time', body: 'We sent the booking link.' },
    ] },
  { id: 'no_show', name: 'No show recovery', why: 'Most no shows still want the audit. A same day text and a next day email win many back.',
    trigger: { type: 'stage_changed', to: 'no_show' }, stopOnReply: true,
    steps: [
      { type: 'send_text', text: 'Hi {first}, we missed you for the Google audit today. Want to pick a new time? {book_link}' },
      { type: 'wait', amount: 1, unit: 'days' },
      { type: 'condition', check: 'not_booked' },
      { type: 'send_email', subject: 'Your Google audit for {business}', body: 'Hi {first},\n\nWe had your audit ready yesterday. It shows where {business} shows up on Google Maps around you and who is ahead. You keep it either way.\n\nPick a time that works: {book_link}\n\n{rep}\nRightway Growth' },
      { type: 'task', title: 'Call to rebook (no show)', minutes: 60 },
    ] },
  { id: 'not_now', name: 'Not now nurture', why: 'Timing objections are not a no. Come back in a month with a call task, no automatic calls.',
    trigger: { type: 'call_result', outcomes: ['not_now'] }, stopOnReply: true,
    steps: [
      { type: 'wait', amount: 30, unit: 'days' },
      { type: 'condition', check: 'stage_is', value: 'not_now' },
      { type: 'task', title: 'Check back (they said not now a month ago)', minutes: 0 },
    ] },
  { id: 'new_client', name: 'New client welcome', why: 'Fast onboarding lowers early churn: the client hears from us the day they sign.',
    trigger: { type: 'work_order_signed' }, stopOnReply: false,
    steps: [
      { type: 'send_email', subject: 'Welcome to Rightway Growth, {first}', body: 'Hi {first},\n\nThank you for trusting us with {business}. Your account manager will reach out today to book your kickoff.\n\nOpen your Rightway app any time to see the work as it happens.\n\nRightway Growth' },
      { type: 'notify', to: 'owners', title: 'Signed: {business}', body: 'Book the kickoff and start onboarding.' },
    ] },
];
export const RECIPE_MAP = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

// ---------- cleaning ----------
const str = (v, n = 200) => String(v ?? '').replace(/[–—]/g, ', ').slice(0, n);
export function cleanStep(s = {}) {
  const a = ACTION_MAP[s.type];
  if (!a) return null;
  const out = { id: String(s.id || Math.random().toString(36).slice(2, 10)).replace(/[^a-z0-9_]/gi, '').slice(0, 16), type: a.id };
  for (const f of a.fields) {
    let v = s[f.k];
    if (f.type === 'number') { v = Number(v ?? f.def); if (!Number.isFinite(v)) v = f.def ?? 0; v = Math.max(f.min ?? 0, Math.min(f.max ?? 1e6, Math.round(v))); }
    else if (f.type === 'select') { const opts = typeof f.options === 'function' ? f.options() : f.options; if (!opts.some(([k]) => k === v)) v = f.def ?? opts[0][0]; }
    else v = str(v ?? f.def ?? '', f.max || 300);
    out[f.k] = v;
  }
  if (a.id === 'webhook' && out.url && !/^https:\/\//i.test(out.url)) out.url = '';
  return out;
}
export function cleanTrigger(t = {}) {
  const d = TRIGGER_MAP[t.type] || TRIGGER_MAP.lead_created;
  const out = { type: d.id };
  for (const f of d.fields) {
    const v = t[f.k];
    if (f.type === 'tags' || f.type === 'outcomes') out[f.k] = (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => str(x, 40).trim()).filter(Boolean).slice(0, 12);
    else out[f.k] = str(v, 80).trim();
  }
  return out;
}
export function cleanWorkflow(w = {}) {
  return {
    name: str(w.name || 'Untitled workflow', 80).trim() || 'Untitled workflow',
    trigger: cleanTrigger(w.trigger || {}),
    steps: (Array.isArray(w.steps) ? w.steps : []).slice(0, 40).map(cleanStep).filter(Boolean),
    stopOnReply: Boolean(w.stopOnReply),
    reenter: Boolean(w.reenter),
  };
}

// Does this workflow start for this event? event: { type, lead, text, outcome, stage, tag, source }
export function triggerMatches(trigger = {}, ev = {}) {
  if (!trigger || trigger.type !== ev.type) return false;
  switch (trigger.type) {
    case 'lead_created': return !trigger.sources?.length || trigger.sources.some((s) => norm(s) === norm(ev.source));
    case 'text_in': return !trigger.contains || norm(ev.text) === norm(trigger.contains);
    case 'call_result': return !trigger.outcomes?.length || trigger.outcomes.includes(ev.outcome) || trigger.outcomes.includes(ev.dispo);
    case 'stage_changed': return !trigger.to || trigger.to === ev.stage;
    case 'tag_added': return !trigger.tag || norm(trigger.tag) === norm(ev.tag);
    default: return true;
  }
}

// Fills {first}, {business}, {phone}, {rep}, {book_link}, {city} from the lead. Unknown words stay as they are so a typo is visible.
export function fillText(text, v = {}) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] != null && v[k] !== '' ? String(v[k]) : k === 'first' ? 'there' : m));
}
export function varsFor(lead = {}, extra = {}) {
  const person = lead.owner_name || lead.contact_name || '';
  return { first: person.split(/\s+/)[0] || '', name: person, business: lead.business || '', phone: lead.phone || '', city: lead.city || '', ...extra };
}
export const waitMs = (s) => (s?.type === 'wait' ? s.amount * ({ minutes: 60e3, hours: 3600e3, days: 864e5 }[s.unit] || 60e3) : 0);
export function stepLine(s) {
  const a = ACTION_MAP[s?.type];
  if (!a) return 'Unknown step';
  if (s.type === 'wait') return `Wait ${s.amount} ${s.amount === 1 ? s.unit.replace(/s$/, '') : s.unit}`;
  if (s.type === 'condition') return `Continue only if: ${CHECK_MAP[s.check]?.label || s.check}${CHECK_MAP[s.check]?.needs && s.value ? ` (${s.value})` : ''}`;
  if (s.type === 'send_text') { const t = String(s.text || ''); return `Text: ${t.length > 80 ? `${t.slice(0, 80).replace(/\s+\S*$/, '')}...` : t}`; }
  if (s.type === 'send_email') return `Email: ${s.subject || '(no subject)'}`;
  if (s.type === 'task') return `Call task: ${s.title} (${s.minutes ? `in ${s.minutes} min` : 'now'})`;
  if (s.type === 'notify') return `Alert ${s.to === 'owners' ? 'owners' : s.to === 'staff' ? 'the team' : 'the rep'}: ${s.title}`;
  if (s.type === 'add_tag' || s.type === 'remove_tag') return `${a.label}: ${s.tag || '(none)'}`;
  if (s.type === 'set_stage') return `Move to ${s.stage || '(pick a stage)'}`;
  if (s.type === 'assign') return `Assign: ${s.user === 'rr' ? 'round robin' : 'a rep'}`;
  return a.label;
}
// Problems an owner should fix before turning a workflow on.
export function problems(w) {
  const out = [];
  if (!w.steps.length) out.push('Add at least one step.');
  w.steps.forEach((s, i) => {
    const n = `Step ${i + 1}`;
    if (s.type === 'send_text' && !s.text.trim()) out.push(`${n}: write the text.`);
    if (s.type === 'send_email' && (!s.subject.trim() || !s.body.trim())) out.push(`${n}: add a subject and a message.`);
    if ((s.type === 'add_tag' || s.type === 'remove_tag') && !s.tag.trim()) out.push(`${n}: name the tag.`);
    if (s.type === 'set_stage' && !s.stage) out.push(`${n}: pick a stage.`);
    if (s.type === 'webhook' && !s.url) out.push(`${n}: add an https webhook URL.`);
    if (s.type === 'condition' && CHECK_MAP[s.check]?.needs && !String(s.value || '').trim()) out.push(`${n}: the check needs a value.`);
  });
  if (w.steps.at(-1)?.type === 'wait') out.push('The last step is a wait: it does nothing after it.');
  return out;
}
