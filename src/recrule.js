// Recording clean up (Nov 2026, V: keep call recordings on the lead when we reached someone, delete the rest, triggered by the disposition).
// Modeled on the "delete recordings with no live conversation" rules in Dialpad and Aircall call recording settings.
// Rule: after the call has a result, the recording stays only when the owner or a gatekeeper (staff, answering service) picked up, or the
// result is Do Not Call (a recording of that request is proof). Voicemail, phone menu, no answer, dead line, wrong number, hang up with nobody
// identified and bad connection redials are deleted from Twilio and from our copy. Owners can switch it off (settings rec_autodelete = '0').
// The recording and the result can arrive in either order, so this runs when each one is saved and acts only when it has both.
import { first, run, getSettings } from './db.js';
import { answeredOf } from '../public/js/leaddb.js';
import { forgetRecording } from './audio.js';

export const KEEP_BY = ['owner', 'staff', 'service'];

// call: the activity row. acts: the built in result the disposition counts as ('' when unknown).
export function keepRecording(call, acts = '') {
  if (acts === 'dnc') return true;
  return KEEP_BY.includes(answeredOf(call));
}

export const autoDeleteOn = async (env) => (await getSettings(env).catch(() => ({}))).rec_autodelete !== '0';

const twAuth = (env) => `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`;

// Returns 'kept', 'deleted' or 'waiting' (no recording yet, or no result yet).
export async function applyRecordingRule(env, activityId, acts = '') {
  if (!activityId || !(await autoDeleteOn(env))) return 'kept';
  const a = await first(env, 'SELECT id, rec_sid, outcome, dispo, dispo_id, answered_by, answered_at, duration FROM activities WHERE id = ?', activityId);
  if (!a?.rec_sid || !(a.outcome || a.dispo)) return 'waiting';
  if (keepRecording(a, acts || a.outcome || '')) return 'kept';
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Recordings/${a.rec_sid}.json`, { method: 'DELETE', headers: { Authorization: twAuth(env) } }).catch(() => {});
  }
  await forgetRecording(env, a.rec_sid);
  await run(env, 'UPDATE activities SET rec_sid = NULL, rec_secs = NULL WHERE id = ?', a.id);
  return 'deleted';
}
