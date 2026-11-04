// Claude as a work assistant inside the Hub: the team asks questions or has it draft things while fulfilling a client's work.
// It is given the client's profile, plan, this month's tasks, the task guide (when opened from a task), the latest scans,
// the website check and recent reviews, so answers are about this client, not generic SEO advice.
// Needs ANTHROPIC_API_KEY. Model: ANTHROPIC_ASSIST_MODEL, else ANTHROPIC_CONTENT_MODEL, else ANTHROPIC_MODEL.
import { HttpError, json } from './util.js';
import { all, first } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { planOf, monthKey } from './plans.js';
import { INCLUDES } from '../public/js/plancopy.js';
import { guideFor } from '../public/js/guides.js';
import { savedGuides } from './work.js';

const API = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const parse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const cut = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export const SYSTEM = `You are the work assistant inside Rightway Hub, the internal software of Rightway Growth LLC, a local SEO agency in Hollywood, Florida.
You help a Rightway team member do the monthly work for one client: Google Business Profile posts, review replies, service and city pages, citations,
on-page fixes, reports and client meetings. You get that client's details below. Use them. If something you need is not in the details, say what is missing
and how to get it, instead of guessing.

Rules:
- Never invent facts about the client: years in business, licenses, awards, prices, guarantees, staff names, reviews or results. Leave a [bracket] for anything unknown.
- Follow Google's guidelines: no fake or incentivized reviews, no review gating, no keyword stuffing in the business name, no buying links or link schemes, no doorway pages.
- Never promise rankings or a spot on the map. Rank also depends on distance and relevance.
- Write like a person: plain, short sentences, no hype, no em dashes or en dashes. Match the client's brand voice when one is given.
- When asked for something to paste (a post, a reply, a description, a page section), give only that text first, ready to copy, then at most two short notes.
- When asked how to do a task, give numbered steps that follow the task guide, and point to the Hub tab or button to use.
- Keep answers tight. No intros, no recaps.`;

export async function clientBrief(env, clientId, taskId) {
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', clientId);
  if (!c) throw new HttpError('Client not found.', 404);
  const month = monthKey();
  const [tasks, scans, audit, reviews, task, saved] = await Promise.all([
    all(env, 'SELECT id, kind, title, status, note FROM tasks WHERE client_id = ? AND month = ? ORDER BY sort, created_at LIMIT 60', c.id, month).catch(() => []),
    all(env, 'SELECT keyword, summary, created_at FROM scans WHERE client_id = ? ORDER BY created_at DESC LIMIT 6', c.id).catch(() => []),
    first(env, "SELECT score, result, finished_at FROM site_audits WHERE client_id = ? AND status = 'done' ORDER BY created_at DESC LIMIT 1", c.id).catch(() => null),
    first(env, "SELECT reviews FROM review_pulls WHERE client_id = ? AND status = 'done' ORDER BY created_at DESC LIMIT 1", c.id).then((r) => (parse(r?.reviews, []) || []).slice(0, 8)).catch(() => []),
    taskId ? first(env, 'SELECT * FROM tasks WHERE id = ? AND client_id = ?', taskId, c.id).catch(() => null) : null,
    savedGuides(env).catch(() => ({})),
  ]);
  const intake = parse(c.intake, {}) || {};
  const plan = planOf(c.plan);
  const lines = [
    `CLIENT: ${c.name}`,
    `Plan: ${plan.name}. Includes: ${(INCLUDES[c.plan] || []).join('; ')}`,
    c.category && `Google category: ${c.category}`,
    c.services && `Services: ${cut(c.services, 500)}`,
    c.cities && `Cities served: ${cut(c.cities, 300)}`,
    c.keywords && `Target keywords: ${cut(c.keywords, 400)}`,
    c.brand_voice && `Brand voice: ${cut(c.brand_voice, 200)}`,
    c.website && `Website: ${c.website}`,
    c.phone && `Phone: ${c.phone}`,
    c.address && `Address: ${cut(c.address, 160)}`,
    c.review_url && `Review link: ${c.review_url}`,
    c.notes && `Team notes: ${cut(c.notes, 600)}`,
    Object.keys(intake).length && `Intake answers: ${cut(Object.entries(intake).filter(([, v]) => v && typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join('; '), 900)}`,
    tasks.length && `THIS MONTH (${month}) TASKS: ${tasks.map((t) => `${t.title} [${t.status}]`).join('; ')}`,
    scans.length && `LATEST SCANS: ${scans.map((s) => { const m = parse(s.summary, {}); return `"${s.keyword}" ${new Date(s.created_at).toISOString().slice(0, 10)}: first page in ${m.top10Pct ?? '?'}% of spots, top 3 in ${m.top3Pct ?? '?'}%, average rank ${m.avgRank ?? '?'}`; }).join('; ')}`,
    audit && `WEBSITE CHECK: score ${audit.score}. Open issues: ${cut((parse(audit.result, {})?.issues || []).slice(0, 12).map((i) => `${i.title || i.key}${i.page ? ` (${i.page})` : ''}`).join('; '), 900)}`,
    reviews.length && `RECENT REVIEWS: ${reviews.map((r) => `${r.rating} stars: "${cut(r.text, 160)}"${r.reply ? ' (replied)' : ' (no reply yet)'}`).join(' | ')}`,
  ];
  if (task) {
    const g = guideFor(task.kind, saved);
    lines.push(`OPEN TASK: ${task.title} [${task.status}]${task.note ? `. Note: ${cut(task.note, 300)}` : ''}`,
      `Task guide steps: ${(g.steps || []).map((s, i) => `${i + 1}. ${s}`).join(' ')}`, `Done means: ${g.done}`);
  }
  return { client: c, text: lines.filter(Boolean).join('\n') };
}

export async function askClaude(env, { system, messages, maxTokens = 1500 }, fetchImpl = fetch) {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError('The assistant needs ANTHROPIC_API_KEY. Add it in Cloudflare (Build variables and secrets), then rebuild.', 400);
  const res = await fetchImpl(API, {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.ANTHROPIC_ASSIST_MODEL || env.ANTHROPIC_CONTENT_MODEL || env.ANTHROPIC_MODEL || DEFAULT_MODEL, max_tokens: maxTokens, system, messages }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(`Claude: ${data?.error?.message || `HTTP ${res.status}`}`, 502);
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

// Keep the last turns, alternating user and assistant, starting with the user, and not too long.
export function cleanMessages(list) {
  const out = [];
  for (const m of (Array.isArray(list) ? list : []).slice(-16)) {
    const role = m?.role === 'assistant' ? 'assistant' : 'user';
    const content = String(m?.content || '').slice(0, 6000).trim();
    if (!content) continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += `\n\n${content}`;
    else out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (!out.length || out[out.length - 1].role !== 'user') throw new HttpError('Ask a question first.');
  return out;
}

route('POST', '/api/assistant', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const messages = cleanMessages(b.messages);
  let system = SYSTEM;
  let name = null;
  if (b.clientId) {
    const brief = await clientBrief(env, String(b.clientId), b.taskId ? String(b.taskId) : null);
    system += `\n\n${brief.text}`;
    name = brief.client.name;
  } else {
    system += '\n\nNo client is selected. Answer for the agency in general.';
  }
  system += `\n\nTeam member asking: ${user.name || 'a teammate'}. Today: ${new Date().toISOString().slice(0, 10)}.`;
  const reply = await askClaude(env, { system, messages });
  return json({ reply, client: name });
});

route('GET', '/api/assistant/status', async ({ env, user }) => {
  requireStaff(user);
  return json({ ready: Boolean(env.ANTHROPIC_API_KEY) });
});
