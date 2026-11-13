// Script tests (Nov 2026, V): every call carries the script the rep dialed with (activities.script plus script_v, the version of its words),
// owners can run a split test where the Hub picks the script per lead, and /api/scripts/stats shows which script books more meetings.
// Modeled on Outreach's A/B testing (even split per prospect, restart after an edit) and Orum's conversation metric. Math in public/js/scripttest.js.
import { HttpError, json } from './util.js';
import { all, run, getSettings, setSetting } from './db.js';
import { requireStaff, requireAdmin } from './auth.js';
import { route } from './router.js';
import { SCRIPT_GROUPS } from '../public/js/leadintel.js';
import { DIAL_SCRIPTS, cleanTest, funnel, verdict, wilson, sampleSize, MIN_CONVS, MIN_DAYS } from '../public/js/scripttest.js';

export const cleanScript = (s) => (DIAL_SCRIPTS.includes(String(s || '')) ? String(s) : null);
export const cleanVersion = (v) => (/^[a-z0-9]{1,8}$/.test(String(v || '')) ? String(v) : null);

// Stamp a call with its script. Never overwrites: the script a call started with is the one it is counted under.
export async function tagScript(env, activityId, script, version, how = null) {
  const s = cleanScript(script);
  if (!activityId || !s) return;
  // how: 'split' (the owner's split test picked it for this lead) or 'pick' (the rep chose it).
  await run(env, 'UPDATE activities SET script = COALESCE(script, ?), script_v = COALESCE(script_v, ?), script_how = COALESCE(script_how, ?) WHERE id = ?', s, cleanVersion(version), how === 'split' ? 'split' : 'pick', activityId);
}

export async function getTest(env) {
  const raw = (await getSettings(env).catch(() => ({}))).script_test;
  try { return cleanTest(raw ? JSON.parse(raw) : {}); } catch { return cleanTest({}); }
}

route('GET', '/api/scripts/test', async ({ env, user }) => {
  requireStaff(user);
  return json({ test: await getTest(env), scripts: DIAL_SCRIPTS, minConvs: MIN_CONVS, minDays: MIN_DAYS });
});

route('PUT', '/api/scripts/test', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  const old = await getTest(env);
  const next = cleanTest({ on: b.on, variants: b.variants, allowPick: b.allowPick });
  if (b.on && next.variants.length < 2) throw new HttpError('Pick at least two scripts to split test.');
  // A new test starts whenever it is switched on or the scripts change, so old calls never mix into it.
  const same = old.on && next.on && old.variants.join() === next.variants.join();
  const test = next.on ? { ...next, id: same ? old.id : `t${Date.now().toString(36)}`, started_at: same ? old.started_at : Date.now() } : { ...next, id: old.id, started_at: old.started_at };
  await setSetting(env, 'script_test', JSON.stringify(test));
  return json({ test });
});

// Results. ?days=30 (default 90), ?rep=<userId>, ?test=1 (only the running test's scripts since it started), ?versions=1 (split by version).
route('GET', '/api/scripts/stats', async ({ env, user, url }) => {
  requireStaff(user);
  const q = url.searchParams;
  const test = await getTest(env);
  const onlyTest = q.get('test') === '1' && test.started_at;
  const since = onlyTest ? test.started_at : Date.now() - Math.min(365, Math.max(1, Number(q.get('days')) || 90)) * 864e5;
  const rep = q.get('rep');
  const args = [since];
  let where = "a.type IN ('call','manual_call') AND a.script IS NOT NULL AND a.at > ? AND NOT (a.status = 'ready' AND a.outcome IS NULL)";
  if (rep) { where += ' AND a.by = ?'; args.push(rep); }
  // The split test counts only calls the test assigned, so a rep's own choice never tilts it. ?how=pick shows only reps' own choices.
  if (onlyTest) { where += ` AND a.script_how = 'split' AND a.script IN (${test.variants.map(() => '?').join(',')})`; args.push(...test.variants); }
  else if (q.get('how') === 'pick' || q.get('how') === 'split') { where += ' AND COALESCE(a.script_how, \'pick\') = ?'; args.push(q.get('how')); }
  const rows = await all(env, `SELECT a.lead_id, a.script, a.script_v, a.outcome, a.answered_by, a.answered_at, a.duration, a.objection, a.by, a.at,
    (SELECT 1 FROM activities m WHERE m.lead_id = a.lead_id AND m.type = 'meeting' AND (m.body LIKE 'Audit booked for%' OR m.body LIKE 'Booked%') AND m.at BETWEEN a.at AND a.at + 7200000 LIMIT 1) AS bk,
    l.stage, l.meet_at, l.client_id FROM activities a LEFT JOIN leads l ON l.id = a.lead_id WHERE ${where} ORDER BY a.at LIMIT 20000`, ...args);
  const stats = funnel(rows, { byVersion: q.get('versions') === '1' }).map((s) => ({ ...s, range: wilson(s.booked, s.convs) }));
  const nameOf = (k) => { const [key, ver] = String(k).split('@'); return `${SCRIPT_GROUPS.find((g) => g[0] === key)?.[1] || key}${ver ? ` (version ${ver})` : ''}`; };
  const v = verdict(stats, { name: nameOf });
  // Per rep: the same rep's numbers on each script (a rep who only dials one script can make it look better or worse).
  const reps = {};
  for (const r of rows) {
    if (!r.by) continue;
    (reps[r.by] ||= []).push(r);
  }
  const perRep = Object.entries(reps).map(([id, list]) => ({ id, scripts: funnel(list).map((s) => ({ key: s.key, dials: s.dials, convs: s.convs, booked: s.booked })) }));
  const base = stats.length ? stats.reduce((a, s) => a + s.booked, 0) / Math.max(1, stats.reduce((a, s) => a + s.convs, 0)) : 0.12;
  const p1 = Math.min(0.9, Math.max(0.02, base || 0.12));
  return json({ test, since, stats, verdict: { ...v, ranked: undefined }, perRep, need: { at: p1, to: Math.min(0.95, p1 * 1.5), each: sampleSize(p1, Math.min(0.95, p1 * 1.5)) } });
});
