// Quarterly plan builder (Phase 9, Market Leader): drafts goals, focus areas and a month by month plan from the client's own data
// (rankings, reviews, calls, site audit, directory check, content ideas, plan quotas). The team edits it, then shares a private link.
// Sharing checks off the quarter's planning task.
import { HttpError, json } from './util.js';
import { all, first, run, newId, token, now } from './db.js';
import { requireStaff, requireClientAccess } from './auth.js';
import { route } from './router.js';
import { monthKey, workloadOf } from './plans.js';
import { keywordTrend } from './leader.js';
import { reputationFor } from './reputation.js';
import { callStats } from './calltrack.js';
import { suggestTopics } from './content.js';

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function quarterOf(d = new Date()) { return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`; }
export function nextQuarter(q) { const [y, n] = q.split('-Q').map(Number); return n === 4 ? `${y + 1}-Q1` : `${y}-Q${n + 1}`; }
export function quarterMonths(q) { const [y, n] = q.split('-Q').map(Number); return [0, 1, 2].map((i) => ({ key: `${y}-${String((n - 1) * 3 + i + 1).padStart(2, '0')}`, label: MONTHS[(n - 1) * 3 + i] })); }
const validQ = (q) => /^\d{4}-Q[1-4]$/.test(String(q || ''));

// Pure: build the draft from the facts gathered below.
export function draftFrom(f) {
  const goals = [];
  for (const k of (f.keywords || []).slice(0, 3)) {
    const now10 = k.top10Pct ?? 0;
    goals.push({ label: `First page (top 10) coverage for "${k.keyword}"`, now: `${now10}%`, target: `${Math.min(100, Math.max(now10 + 15, Math.round(now10 * 1.4)))}%` });
  }
  const k0 = (f.keywords || [])[0];
  if (k0?.avgRank != null && k0.avgRank > 1.5) goals.push({ label: `Average spot for "${k0.keyword}"`, now: `#${Math.round(k0.avgRank)}`, target: `#${Math.max(1, Math.round(k0.avgRank - Math.max(2, k0.avgRank * 0.25)))}` });
  if (f.reviews?.count != null) {
    const pace = Math.max(4, Math.ceil(f.reviews.gap ? f.reviews.gap / 6 : 4));
    goals.push({ label: 'Google reviews', now: String(f.reviews.count), target: String(f.reviews.count + pace * 3) });
  }
  if (f.reviews?.replyRate != null && f.reviews.replyRate < 90) goals.push({ label: 'Reviews with a reply', now: `${f.reviews.replyRate}%`, target: '100% of new reviews' });
  if (f.calls) goals.push({ label: 'Calls from tracked numbers per month', now: String(f.calls.total), target: String(Math.max(f.calls.total + 5, Math.round(f.calls.total * 1.2))) });
  if (f.site?.score != null) goals.push({ label: 'Website health score', now: String(f.site.score), target: String(Math.max(90, f.site.score)) });

  const focus = [];
  const weakest = [...(f.keywords || [])].sort((a, b) => (a.top10Pct ?? 0) - (b.top10Pct ?? 0))[0];
  if (weakest) focus.push(`Lift "${weakest.keyword}": on the first page (top 10) in only ${weakest.top10Pct ?? 0}% of the area today.`);
  if (f.leader?.title && f.reviews?.gap) focus.push(`Close the review gap with ${f.leader.title}: ${f.reviews.gap} reviews behind.`);
  if (f.reviews?.unanswered) focus.push(`Reply to the ${f.reviews.unanswered} reviews of 3 stars or less that have no reply.`);
  for (const i of (f.site?.issues || []).filter((x) => x.severity === 'high').slice(0, 2)) focus.push(`Website: ${i.title.toLowerCase()}.`);
  if (f.citations?.mismatch) focus.push(`Fix ${f.citations.mismatch} directory listing${f.citations.mismatch === 1 ? '' : 's'} with the wrong details.`);
  if (f.citations?.missing) focus.push(`Get listed on ${Math.min(f.citations.missing, 6)} directories they are missing from.`);
  if (f.calls?.missed) focus.push(`Missed calls: ${f.calls.missed} last month. Set up a call back routine with the client.`);

  const ideas = [...(f.ideas || [])];
  const fixes = [...(f.site?.issues || [])];
  const per = f.plan?.monthly || [];
  const pages = per.filter(([k]) => k === 'page' || k === 'content').reduce((s, x) => s + x[2], 0);
  const months = (f.months || []).map((m, i) => {
    const items = [];
    for (const [kind, title, n] of per) {
      if (kind === 'page' || kind === 'content' || kind === 'report' || kind === 'meeting') continue;
      items.push(n > 1 ? `${n} x ${title}` : title);
    }
    const mine = ideas.splice(0, pages);
    if (mine.length) items.push(`New pages: ${mine.map((x) => x.title).join('; ')}`);
    const fix = fixes.shift();
    if (fix) items.push(`Website fix: ${fix.title}`);
    if (i === 0 && f.citations?.mismatch) items.push('Correct the directory listings with wrong details');
    if (i === 2) items.push('Quarter review: compare the maps, reviews and calls with the start of the quarter');
    return { key: m.key, label: m.label, items };
  });
  return { goals, focus: focus.slice(0, 6), months, notes: '' };
}

async function facts(env, c, q) {
  const d = new Date();
  const lastA = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1), lastB = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const [keywords, rep, tracked, audit, cit, existing] = await Promise.all([
    keywordTrend(env, c.id), reputationFor(env, c).catch(() => null),
    first(env, "SELECT COUNT(*) AS n FROM tracking_numbers WHERE client_id = ? AND status = 'active'", c.id).catch(() => null),
    first(env, "SELECT result FROM site_audits WHERE client_id = ? AND status = 'done' ORDER BY finished_at DESC LIMIT 1", c.id).catch(() => null),
    first(env, 'SELECT counts FROM citation_audits WHERE client_id = ? ORDER BY created_at DESC LIMIT 1', c.id).catch(() => null),
    all(env, 'SELECT keyword FROM content WHERE client_id = ?', c.id).catch(() => []),
  ]);
  const scanInfo = new Map(keywords.map((k) => [k.keyword.toLowerCase(), { keyword: k.keyword, top10Pct: k.top10Pct, top3Pct: k.top3Pct }]));
  const site = parse(audit?.result);
  const lead = rep?.pace?.competitors?.[0] || null;
  const count = rep?.pull?.total ?? rep?.pace?.mine?.reviews ?? null;
  return {
    keywords,
    reviews: count != null ? { count, gap: lead?.reviews && count != null ? Math.max(0, lead.reviews - count + 1) : 0, replyRate: rep?.analysis?.replyRate ?? null, unanswered: rep?.analysis?.unansweredCount || 0 } : null,
    leader: lead, calls: tracked?.n ? await callStats(env, c.id, lastA, lastB) : null,
    site: site ? { score: site.score, issues: site.issues || [] } : null,
    citations: parse(cit?.counts), ideas: suggestTopics(c, existing, scanInfo),
    plan: { monthly: workloadOf(c).monthly }, months: quarterMonths(q),
  };
}

const out = (p, staff = true) => ({ id: p.id, quarter: p.quarter, status: p.status, data: parse(p.data), url: `/plan.html#${p.token}`, updated_at: p.updated_at, shared_at: p.shared_at || null, staff });

route('GET', '/api/clients/:id/quarterly', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  const staff = user.role !== 'client';
  const rows = await all(env, `SELECT * FROM quarterly_plans WHERE client_id = ? ${staff ? '' : "AND status = 'shared'"} ORDER BY quarter DESC LIMIT 12`, params.id);
  const q = quarterOf();
  return json({ plans: rows.map((r) => out(r, staff)), current: q, next: nextQuarter(q) });
});

route('POST', '/api/clients/:id/quarterly', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', params.id);
  if (!c) throw new HttpError('Client not found.', 404);
  const b = await body();
  const q = b.quarter || nextQuarter(quarterOf());
  if (!validQ(q)) throw new HttpError('Pick a quarter.');
  const existing = await first(env, 'SELECT * FROM quarterly_plans WHERE client_id = ? AND quarter = ?', c.id, q);
  if (existing && !b.redraft) return json({ plan: out(existing) });
  const data = JSON.stringify(draftFrom(await facts(env, c, q)));
  if (existing) {
    await run(env, 'UPDATE quarterly_plans SET data = ?, updated_at = ? WHERE id = ?', data, now(), existing.id);
    return json({ plan: out(await first(env, 'SELECT * FROM quarterly_plans WHERE id = ?', existing.id)) });
  }
  const id = newId('qp_');
  await run(env, "INSERT INTO quarterly_plans (id, client_id, quarter, data, status, token, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)", id, c.id, q, data, token(18), now(), now());
  return json({ plan: out(await first(env, 'SELECT * FROM quarterly_plans WHERE id = ?', id)) });
});

const cleanText = (v, max) => String(v ?? '').replace(/[–—]/g, ', ').slice(0, max);
route('PUT', '/api/quarterly/:id', async ({ env, user, params, body }) => {
  requireStaff(user);
  const p = await first(env, 'SELECT * FROM quarterly_plans WHERE id = ?', params.id);
  if (!p) throw new HttpError('Plan not found.', 404);
  const b = await body();
  const prev = parse(p.data) || {};
  const data = {
    goals: Array.isArray(b.goals) ? b.goals.slice(0, 12).map((g) => ({ label: cleanText(g.label, 140), now: cleanText(g.now, 40), target: cleanText(g.target, 60) })).filter((g) => g.label) : prev.goals,
    focus: Array.isArray(b.focus) ? b.focus.map((x) => cleanText(x, 300)).filter(Boolean).slice(0, 12) : prev.focus,
    months: Array.isArray(b.months) ? (prev.months || []).map((m, i) => ({ ...m, items: (b.months[i]?.items || []).map((x) => cleanText(x, 300)).filter(Boolean).slice(0, 20) })) : prev.months,
    notes: 'notes' in b ? cleanText(b.notes, 3000) : prev.notes,
  };
  await run(env, 'UPDATE quarterly_plans SET data = ?, updated_at = ? WHERE id = ?', JSON.stringify(data), now(), p.id);
  return json({ plan: out(await first(env, 'SELECT * FROM quarterly_plans WHERE id = ?', p.id)) });
});

route('POST', '/api/quarterly/:id/share', async ({ env, user, params }) => {
  requireStaff(user);
  const p = await first(env, 'SELECT * FROM quarterly_plans WHERE id = ?', params.id);
  if (!p) throw new HttpError('Plan not found.', 404);
  await run(env, "UPDATE quarterly_plans SET status = 'shared', shared_at = COALESCE(shared_at, ?) WHERE id = ?", now(), p.id);
  await run(env, "UPDATE tasks SET status = 'done', done_at = ?, done_by = ? WHERE client_id = ? AND kind = 'planning' AND status != 'done' AND month >= ?", now(), user.id, p.client_id, monthKey(new Date(Date.now() - 62 * 86400e3)));
  await run(env, 'INSERT INTO log (id, client_id, text, link, at, by) VALUES (?, ?, ?, ?, ?, ?)', newId('l_'), p.client_id, `${p.quarter.replace('-', ' ')} plan shared`, `/plan.html#${p.token}`, now(), user.id);
  return json({ plan: out(await first(env, 'SELECT * FROM quarterly_plans WHERE id = ?', p.id)) });
});

route('DELETE', '/api/quarterly/:id', async ({ env, user, params }) => {
  requireStaff(user);
  await run(env, 'DELETE FROM quarterly_plans WHERE id = ?', params.id);
  return json({ ok: true });
});

route('GET', '/api/public/plan/:token', async ({ env, params }) => {
  const p = await first(env, 'SELECT * FROM quarterly_plans WHERE token = ?', params.token);
  if (!p) throw new HttpError('This plan link is not valid.', 404);
  const c = await first(env, 'SELECT name FROM clients WHERE id = ?', p.client_id);
  return json({ quarter: p.quarter, data: parse(p.data), client: { name: c?.name || '' }, shared: p.status === 'shared', updated_at: p.updated_at });
}, { public: true });
