// "Pick up where you left off" for the power dialer (pure, tests in test/resumestate.test.js). One small record per device:
// the list being dialed (the Pipeline filter), how many calls the session made, the last lead called, and whether power dialing
// was still running when the page closed. Modeled on the resume prompts in Close.com and Outreach dialers, which reopen the
// same call list at the next lead instead of starting over.
export const KEY = 'rw-dial-last';
export const MAX_AGE = 48 * 3600e3;

// Merge a change into the saved record. A new power dial session starts a fresh count unless the last one was in the past 12 hours.
export function merge(rec, patch = {}, t = Date.now()) {
  const old = rec && typeof rec === 'object' ? rec : {};
  const fresh = patch.start && (!old.at || t - old.at > 12 * 3600e3);
  const base = fresh ? {} : old;
  const out = { ...base, ...patch, at: t };
  delete out.start;
  if (fresh) { out.calls = patch.calls || 0; out.startedAt = t; }
  if (patch.filter) out.filter = Object.fromEntries(Object.entries(patch.filter).filter(([k, v]) => v && ['tz', 'grade', 'state', 'industry', 'tag', 'city', 'data', 'stage', 'tier', 'cat'].includes(k)).map(([k, v]) => [k, String(v)]));
  return out;
}
// Worth offering: a session with at least one call, in the last 48 hours.
export function usable(rec, t = Date.now()) {
  return Boolean(rec && Number(rec.calls) > 0 && rec.at && t - rec.at < MAX_AGE);
}
export function lastLine(rec, t = Date.now(), tz = undefined) {
  const l = rec?.last;
  if (!l || !l.business) return '';
  const when = l.at ? new Date(l.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }) : '';
  const old = l.at && t - l.at > 20 * 3600e3 ? new Date(l.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz }) : '';
  return `${l.business}${when ? `, ${old ? `${old} ` : ''}${when}` : ''}`;
}
export function leftText(n) {
  if (n == null) return '';
  return n === 0 ? 'No one left in this list right now' : `${n} left to call in this list`;
}
