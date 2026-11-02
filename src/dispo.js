// Call dispositions. Owners can rename, add, reorder and remove them. Each one "counts as" a built in result that drives the lead's
// next step (cadence, callback, DNC), or "none" to just log it. Stored in settings `dispositions`; the built in list is the default.
import { HttpError, json } from './util.js';
import { getSettings, setSetting } from './db.js';
import { requireStaff, requireAdmin } from './auth.js';
import { route } from './router.js';

export const ACTS = {
  no_answer: 'No answer (try again later)', voicemail: 'Voicemail (try again later)', gatekeeper: 'Gatekeeper (try again later)',
  conversation: 'Talked (follow up in 2 days)', booked: 'Booked audit', callback: 'Callback at a set time', not_interested: 'Not interested (recycle in 90 days)',
  bad_number: 'Bad number (lost)', dnc: 'Do not call', none: 'Just log it (no change to the lead)',
};
export const BASE_DISPOS = [
  ['no_answer', 'No answer'], ['voicemail', 'Voicemail'], ['gatekeeper', 'Gatekeeper'], ['conversation', 'Talked, follow up'], ['booked', 'Booked audit'],
  ['callback', 'Callback'], ['not_interested', 'Not interested'], ['bad_number', 'Bad number'], ['dnc', 'Do not call'],
].map(([id, label]) => ({ id, label, acts: id }));

export async function getDispos(env) {
  const raw = (await getSettings(env).catch(() => ({}))).dispositions;
  if (raw) { try { const l = JSON.parse(raw); if (Array.isArray(l) && l.length) return l; } catch { /* fall back */ } }
  return BASE_DISPOS;
}

// A disposition id from the list, or a built in result name (older clients and the API).
export async function resolveDispo(env, idOrActs) {
  const list = await getDispos(env);
  return list.find((d) => d.id === idOrActs) || BASE_DISPOS.find((d) => d.id === idOrActs) || (idOrActs === 'won' ? { id: 'won', label: 'Won', acts: 'won' } : null);
}

export function cleanDispos(list) {
  if (!Array.isArray(list) || !list.length) throw new HttpError('Keep at least one disposition.');
  if (list.length > 20) throw new HttpError('Keep it to 20 dispositions or fewer.');
  const seen = new Set();
  return list.map((d, i) => {
    const label = String(d?.label || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!label) throw new HttpError(`Disposition ${i + 1} needs a name.`);
    const acts = String(d?.acts || '');
    if (!ACTS[acts]) throw new HttpError(`Pick what "${label}" does to the lead.`);
    let id = String(d?.id || '').replace(/[^a-z0-9_]/gi, '').slice(0, 40) || `d_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)}`;
    while (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    return { id, label, acts };
  });
}

route('GET', '/api/dispositions', async ({ env, user }) => {
  requireStaff(user);
  return json({ dispositions: await getDispos(env), acts: ACTS, custom: Boolean((await getSettings(env)).dispositions) });
});

route('PUT', '/api/dispositions', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  if (b.reset) { await setSetting(env, 'dispositions', ''); return json({ dispositions: BASE_DISPOS }); }
  const list = cleanDispos(b.dispositions);
  await setSetting(env, 'dispositions', JSON.stringify(list));
  return json({ dispositions: list });
});
