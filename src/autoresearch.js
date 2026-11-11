// Every imported lead gets researched on its own (Google profile, 3 x 3 map grid, website, speed), then scored and graded, so the dialer
// can split the queue by quality. One lead per cron run plus open dialer pages nudging it along; owners set a daily cap.
import { json } from './util.js';
import { first, run, now, getSettings, setSetting } from './db.js';
import { requireStaff, requireAdmin } from './auth.js';
import { route } from './router.js';
import { researchLead, leadFieldsFromIntel } from './intel.js';
import { isFreeMode } from './freedata.js';

const STAGES = ['new', 'attempting', 'callback', 'audit_requested', 'no_show', 'follow_up', 'not_now'];
const TOLL_FREE = /^(800|833|844|855|866|877|888)/;

// Leads that can never be worth a call are scrubbed out of the queue with a reason. Pure.
export function scrubReason(lead, intel) {
  const d = String(lead.phone_digits || '').replace(/^1(?=\d{10}$)/, '');
  if (!d || d.length !== 10) return 'No valid phone number';
  if (TOLL_FREE.test(d)) return 'Toll free number (a call center, not the owner)';
  const L = intel?.listing;
  if (L && /permanently/i.test(String(L.status || L.business_status || ''))) return 'Closed for good on Google';
  return null;
}

export async function researchSettings(env) {
  const s = await getSettings(env);
  return { on: s.auto_research !== '0', cap: Number(s.auto_research_cap) || 300, day: s.auto_research_day || '', done: Number(s.auto_research_done) || 0, radius: Number(s.research_radius) || 2 };
}

export async function researchTick(env, max = 1) {
  const cfg = await researchSettings(env);
  if (!cfg.on || !env.DATAFORSEO_LOGIN) return 0;
  if (await isFreeMode(env)) return 0;   // free lead data mode: nothing that costs money runs by itself
  const today = new Date().toISOString().slice(0, 10);
  let done = cfg.day === today ? cfg.done : 0;
  let n = 0;
  while (n < max && done < cfg.cap) {
    const lead = await first(env, `SELECT * FROM leads WHERE intel IS NULL AND dnc = 0 AND phone_digits IS NOT NULL AND stage IN (${STAGES.map(() => '?').join(',')})
      AND (research_tried IS NULL OR research_tried < ?) ORDER BY created_at DESC LIMIT 1`, ...STAGES, now() - 6 * 3600e3);
    if (!lead) break;
    await run(env, 'UPDATE leads SET research_tried = ? WHERE id = ?', now(), lead.id);
    try {
      const intel = await researchLead(env, lead, { gridSize: 3, radiusMiles: cfg.radius });
      const set = leadFieldsFromIntel(lead, intel);
      const why = scrubReason(lead, intel);
      if (why) Object.assign(set, { scrub: why, stage: 'lost', next_action: `Scrubbed: ${why}`, next_action_at: null });
      const cols = Object.keys(set);
      await run(env, `UPDATE leads SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => set[k]), lead.id);
    } catch (e) { console.error('auto research', lead.id, e.message); }
    n++; done++;
  }
  if (n) { await setSetting(env, 'auto_research_day', today); await setSetting(env, 'auto_research_done', String(done)); }
  return n;
}

// Free scrub at import time (no research needed): bad and toll free numbers never reach the queue.
export async function scrubImported(env, ids = []) {
  let n = 0;
  for (const id of ids.slice(0, 2000)) {
    const l = await first(env, 'SELECT id, phone_digits, stage FROM leads WHERE id = ?', id);
    const why = l && scrubReason(l, null);
    if (why) { await run(env, "UPDATE leads SET scrub = ?, stage = 'lost', next_action = ?, next_action_at = NULL WHERE id = ?", why, `Scrubbed: ${why}`, id); n++; }
  }
  return n;
}

route('GET', '/api/research/status', async ({ env, user }) => {
  requireStaff(user);
  const cfg = await researchSettings(env);
  const left = await first(env, `SELECT COUNT(*) AS n FROM leads WHERE intel IS NULL AND dnc = 0 AND phone_digits IS NOT NULL AND stage IN (${STAGES.map(() => '?').join(',')})`, ...STAGES);
  const scrubbed = await first(env, 'SELECT COUNT(*) AS n FROM leads WHERE scrub IS NOT NULL');
  return json({ ...cfg, left: left?.n || 0, scrubbed: scrubbed?.n || 0, connected: Boolean(env.DATAFORSEO_LOGIN), free: await isFreeMode(env) });
});

route('PUT', '/api/research/settings', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  if ('on' in b) await setSetting(env, 'auto_research', b.on ? '1' : '0');
  if ('cap' in b) await setSetting(env, 'auto_research_cap', String(Math.max(0, Math.min(5000, Number(b.cap) || 0))));
  return json({ ok: true, ...(await researchSettings(env)) });
});

// Open dialer and pipeline pages call this every 20 seconds while leads wait, so research moves faster than the 1 a minute cron.
route('POST', '/api/research/tick', async ({ env, user }) => {
  requireStaff(user);
  const n = await researchTick(env, 1);
  return json({ researched: n });
});
