// Who may call a lead back, and when (Nov 2026, V: do not let another agent call back a callback someone else set, and leave leads that did not
// answer or went to voicemail alone for 24 hours, so nobody gets sued). Pure, shared by the Worker (dialer queue, prepare, call-check) and the tests.
// Modeled on the callback ownership and retry spacing rules in Close.com and Outreach dial lists.
export const WAIT_OUTCOMES = ['no_answer', 'voicemail', 'hung_up', 'gatekeeper']; // no real conversation: wait before the next dial
export const RETRY_MS = 24 * 3600e3;

// lead: {stage, owner_id}; facts: {last: {outcome, by, at}, callbackBy}; user: {id, role}. Returns null when the call is allowed,
// else {code, why} with a plain sentence for the rep.
export function callRule(lead, facts, user, at = Date.now(), names = {}) {
  const last = facts?.last || null;
  if (last && WAIT_OUTCOMES.includes(last.outcome) && at - last.at < RETRY_MS) {
    const left = Math.max(1, Math.ceil((RETRY_MS - (at - last.at)) / 3600e3));
    return { code: 'wait24', why: `They did not answer on the last call. This lead can be called again in about ${left} hour${left === 1 ? '' : 's'} (24 hours between tries).` };
  }
  if (lead?.stage === 'callback' && user?.role !== 'admin') {
    const owner = facts?.callbackBy || lead.owner_id || null;
    if (!owner || owner !== user?.id) return { code: 'callback', why: `${owner && names[owner] ? names[owner] : 'Another teammate'} set this callback, so only they call it back.` };
  }
  return null;
}

// Pick the facts for each lead out of recent call activities (newest first): the latest result, and who set the latest callback.
export function factsFrom(rows) {
  const out = new Map();
  for (const r of rows) {
    const f = out.get(r.lead_id) || {};
    if (!f.last && r.outcome !== 'glitch') f.last = { outcome: r.outcome, by: r.by || null, at: r.at };
    if (!f.callbackBy && ['callback', 'conversation'].includes(r.outcome) && r.by) f.callbackBy = r.by;
    out.set(r.lead_id, f);
  }
  return out;
}
