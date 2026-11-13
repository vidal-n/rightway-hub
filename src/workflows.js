// Workflow engine (Nov 2026). Modeled on GoHighLevel Workflows and HubSpot workflows: an event (new lead, missed call, text in, call
// result, booking, stage change, tag, signed work order, payment, new client) starts every turned on workflow whose trigger matches,
// once per lead unless re-entry is on. Steps run right away until a Wait, then the cron (`workflowTick`) picks the run up again when
// it is due. "Stop when they reply" ends a lead's waiting runs the moment they text back. Every run keeps a log a person can read.
// Catalogs, recipes and cleaning live in public/js/workflows.js (pure). Calls are never placed by a workflow; texts go through
// sendText (consent, STOP, 8am to 8pm their time), so an automation can never text someone a rep could not.
import { HttpError, json } from './util.js';
import { all, first, run, newId, now, getSettings } from './db.js';
import { requireAdmin, requireStaff } from './auth.js';
import { route } from './router.js';
import { cleanWorkflow, triggerMatches, CHECK_MAP, fillText, varsFor, waitMs, stepLine, problems, tagList, RECIPE_MAP } from '../public/js/workflows.js';

const parse = (s, d) => { try { return JSON.parse(s || ''); } catch { return d; } };
const row = (w) => ({ id: w.id, name: w.name, enabled: Boolean(w.enabled), trigger: parse(w.trigger, {}), steps: parse(w.steps, []), stopOnReply: Boolean(w.stop_on_reply), reenter: Boolean(w.reenter),
  runs: w.runs || 0, last_run_at: w.last_run_at || null, created_at: w.created_at, updated_at: w.updated_at });

let cache = null, cacheAt = 0;
const forget = () => { cache = null; };
async function activeWorkflows(env) {
  if (!cache || Date.now() - cacheAt > 20e3) {
    cache = (await all(env, 'SELECT * FROM workflows WHERE enabled = 1').catch(() => [])).map(row);
    cacheAt = Date.now();
  }
  return cache;
}

// ---------- events ----------
// p: { leadId, clientId, text, outcome, dispo, stage, tag, source, depth }. Returns the ids of runs started.
export async function emit(env, type, p = {}) {
  if ((p.depth || 0) > 2) return []; // a workflow that tags or moves a lead can start another, but not forever
  if (type === 'text_in' && p.leadId) {
    await run(env, `UPDATE wf_runs SET status = 'stopped', note = 'They replied by text', updated_at = ? WHERE lead_id = ? AND status = 'waiting'
      AND wf_id IN (SELECT id FROM workflows WHERE stop_on_reply = 1)`, now(), p.leadId).catch(() => {});
  }
  const list = await activeWorkflows(env);
  if (!list.length) return [];
  let leadId = p.leadId || null;
  if (!leadId && p.clientId) leadId = (await first(env, 'SELECT id FROM leads WHERE client_id = ? ORDER BY updated_at DESC LIMIT 1', p.clientId))?.id || null;
  const lead = leadId ? await first(env, 'SELECT id, source, stage, tags FROM leads WHERE id = ?', leadId) : null;
  const ev = { type, source: p.source || lead?.source || '', text: p.text || '', outcome: p.outcome || '', dispo: p.dispo || '', stage: p.stage || '', tag: p.tag || '', depth: p.depth || 0 };
  const started = [];
  for (const w of list) {
    if (!triggerMatches(w.trigger, ev)) continue;
    const subject = leadId || p.clientId;
    if (!subject) continue;
    if (!w.reenter) {
      const dup = await first(env, "SELECT 1 AS x FROM wf_runs WHERE wf_id = ? AND lead_id = ? AND (status = 'waiting' OR created_at > ?)", w.id, subject, now() - 864e5);
      if (dup) continue;
    }
    const id = newId('wr_');
    await run(env, `INSERT INTO wf_runs (id, wf_id, lead_id, client_id, event, step, status, next_at, log, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 'waiting', ?, '[]', ?, ?)`,
      id, w.id, subject, p.clientId || null, JSON.stringify(ev), now(), now(), now());
    await run(env, 'UPDATE workflows SET runs = COALESCE(runs, 0) + 1, last_run_at = ? WHERE id = ?', now(), w.id);
    started.push(id);
  }
  if (started.length) await processRuns(env, started);
  return started;
}
// For callers that must not fail or wait (webhooks, imports): never throws.
export function fire(env, type, p = {}, defer = null) {
  const job = emit(env, type, p).catch((e) => { console.error('workflow', type, e?.message || e); return []; });
  return defer ? defer(job) : job;
}

// ---------- running ----------
async function context(env, r, ev) {
  const lead = r.lead_id ? await first(env, 'SELECT * FROM leads WHERE id = ?', r.lead_id) : null;
  const replied = lead ? Boolean(await first(env, "SELECT 1 AS x FROM messages WHERE lead_id = ? AND direction = 'in' AND at > ?", lead.id, r.created_at)) : false;
  const called = lead ? Boolean(await first(env, "SELECT 1 AS x FROM activities WHERE lead_id = ? AND type IN ('call','manual_call') AND at > ? AND (status IS NULL OR status NOT IN ('inbound','missed','voicemail','inbound_answered'))", lead.id, r.created_at)) : false;
  return { lead, event: ev, replied: replied || ev.type === 'text_in', called, startedAt: r.created_at };
}
async function repOf(env, lead) {
  if (lead?.owner_id) { const u = await first(env, 'SELECT id, name, email FROM users WHERE id = ?', lead.owner_id); if (u) return u; }
  return first(env, "SELECT id, name, email FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1");
}
async function textVars(env, lead, rep, s) {
  let book = '';
  try {
    const { bookToken } = await import('./automations.js');
    const origin = String(s.hub_origin || s.autoscan_origin || '').replace(/\/$/, '');
    if (lead && origin) book = `${origin}/book.html?l=${await bookToken(env, lead)}`;
  } catch { book = ''; }
  return varsFor(lead || {}, { rep: String(rep?.name || 'the team').split(/\s+/)[0], book_link: book || 'our booking page' });
}

// One step. Returns { line, stop, wait } and never throws (errors become log lines).
async function doStep(env, st, ctx, { dry, depth }) {
  const { lead } = ctx;
  const need = () => { if (!lead) throw new Error('No lead for this run.'); };
  const s = await getSettings(env);
  const rep = await repOf(env, lead);
  const v = await textVars(env, lead, rep, s);
  const say = (t) => fillText(t, v);
  switch (st.type) {
    case 'wait': return { line: stepLine(st), wait: waitMs(st) };
    case 'condition': {
      const c = CHECK_MAP[st.check];
      const ok = c ? c.test(ctx, st.value) : true;
      return { line: `${stepLine(st)}: ${ok ? 'yes, continuing' : 'no, stopped here'}`, stop: !ok };
    }
    case 'send_text': {
      need();
      const body = say(st.text);
      if (dry) return { line: `Would text ${lead.phone || '(no phone)'}: ${body}` };
      const { sendText } = await import('./sms.js');
      await sendText(env, lead, body, rep ? { id: rep.id } : null, String(s.hub_origin || ''), { replyToCall: ctx.event.type === 'missed_call' });
      return { line: `Texted: ${body.slice(0, 120)}` };
    }
    case 'send_email': {
      need();
      if (!/@/.test(lead.email || '')) return { line: 'Email skipped: no email address on the lead.' };
      if (lead.dnc || await import('./suppress.js').then((m) => m.emailBlocked(env, lead))) return { line: 'Email skipped: do not contact.' };
      const subject = say(st.subject), body = say(st.body);
      if (dry) return { line: `Would email ${lead.email}: ${subject}` };
      const { sendEmail, canEmail } = await import('./email.js');
      if (!canEmail(env)) throw new Error('Email is not set up (RESEND_API_KEY).');
      const { bodyHtml, fromFor } = await import('./hubmail.js');
      await sendEmail(env, { to: lead.email, subject, text: body, html: bodyHtml(body), replyTo: rep?.email, from: fromFor(env, rep || {}) });
      await run(env, 'INSERT INTO mail_log (id, user_id, to_email, subject, body, lead_id, status, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', newId('m_'), rep?.id || null, lead.email, subject, body, lead.id, 'sent', now());
      const { logActivity } = await import('./crm.js');
      await logActivity(env, { lead_id: lead.id, type: 'email', body: `Email sent (workflow): ${subject}` });
      return { line: `Emailed ${lead.email}: ${subject}` };
    }
    case 'task': {
      need();
      const due = now() + st.minutes * 60e3;
      if (!dry) await run(env, 'UPDATE leads SET next_action = ?, next_action_at = ?, updated_at = ? WHERE id = ?', say(st.title), due, now(), lead.id);
      return { line: `${dry ? 'Would set' : 'Set'} call task: ${say(st.title)}` };
    }
    case 'notify': {
      const to = st.to === 'staff' ? 'staff' : st.to === 'owners' ? 'admins' : lead?.owner_id ? [lead.owner_id] : 'admins';
      if (!dry) {
        const { notify } = await import('./notify.js');
        await notify(env, { to, kind: 'lead', title: say(st.title), body: say(st.body || ''), url: lead ? `/#/pipeline/${lead.id}` : '/#/', urgent: /speed|now|missed/i.test(st.title) });
      }
      return { line: `${dry ? 'Would alert' : 'Alerted'} ${to === 'staff' ? 'the team' : to === 'admins' ? 'owners' : 'the rep'}: ${say(st.title)}` };
    }
    case 'assign': {
      need();
      let uid = st.user;
      if (!uid || uid === 'rr') {
        const pick = await first(env, `SELECT u.id, u.name, (SELECT COUNT(*) FROM leads l WHERE l.owner_id = u.id AND l.stage NOT IN ('won','lost','dnc','not_now')) AS n
          FROM users u WHERE u.role IN ('admin','team') ORDER BY n ASC, u.created_at ASC LIMIT 1`);
        uid = pick?.id;
      }
      if (!uid) return { line: 'Assign skipped: nobody on the team.' };
      if (!dry) await run(env, 'UPDATE leads SET owner_id = ?, updated_at = ? WHERE id = ?', uid, now(), lead.id);
      const u = await first(env, 'SELECT name, email FROM users WHERE id = ?', uid);
      return { line: `${dry ? 'Would assign' : 'Assigned'} to ${u?.name || u?.email || 'a teammate'}` };
    }
    case 'set_stage': {
      need();
      if (lead.stage === st.stage) return { line: `Already in ${st.stage}` };
      if (!dry) {
        await run(env, 'UPDATE leads SET stage = ?, updated_at = ? WHERE id = ?', st.stage, now(), lead.id);
        const { logActivity } = await import('./crm.js');
        await logActivity(env, { lead_id: lead.id, type: 'stage', body: `Moved to ${st.stage.replace(/_/g, ' ')} (workflow)` });
        lead.stage = st.stage;
        await emit(env, 'stage_changed', { leadId: lead.id, stage: st.stage, depth: depth + 1 });
      }
      return { line: `${dry ? 'Would move' : 'Moved'} to ${st.stage}` };
    }
    case 'add_tag': case 'remove_tag': {
      need();
      const tags = tagList(lead.tags);
      const t = st.tag.trim().toLowerCase();
      const next = st.type === 'add_tag' ? [...new Set([...tags, t])] : tags.filter((x) => x !== t);
      if (!dry) {
        await run(env, 'UPDATE leads SET tags = ?, updated_at = ? WHERE id = ?', next.join(', '), now(), lead.id);
        lead.tags = next.join(', ');
        if (st.type === 'add_tag' && !tags.includes(t)) await emit(env, 'tag_added', { leadId: lead.id, tag: t, depth: depth + 1 });
      }
      return { line: `${dry ? 'Would ' : ''}${st.type === 'add_tag' ? 'add' : 'remove'} tag ${t}` };
    }
    case 'note': {
      need();
      if (!dry) { const { logActivity } = await import('./crm.js'); await logActivity(env, { lead_id: lead.id, type: 'note', body: say(st.text) }); }
      return { line: `${dry ? 'Would note' : 'Noted'}: ${say(st.text).slice(0, 100)}` };
    }
    case 'webhook': {
      if (!/^https:\/\//i.test(st.url)) return { line: 'Webhook skipped: needs an https URL.' };
      if (dry) return { line: `Would send the lead to ${new URL(st.url).host}` };
      const data = { event: ctx.event.type, lead: lead ? { id: lead.id, business: lead.business, contact: lead.owner_name || lead.contact_name, phone: lead.phone, email: lead.email, city: lead.city, state: lead.state, stage: lead.stage, tags: lead.tags, source: lead.source } : null, at: new Date().toISOString() };
      const res = await fetch(st.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout?.(8000) });
      return { line: `Sent to ${new URL(st.url).host}: HTTP ${res.status}` };
    }
    default: return { line: `Unknown step ${st.type}` };
  }
}

// Runs (or continues) these runs until each one waits, stops or ends. dry: no texts, emails or changes, waits are skipped.
export async function processRuns(env, ids, { dry = false, maxSteps = 15 } = {}) {
  const out = [];
  for (const id of ids) {
    const r = await first(env, 'SELECT * FROM wf_runs WHERE id = ?', id);
    if (!r || (r.status !== 'waiting' && !dry)) continue;
    const w = await first(env, 'SELECT * FROM workflows WHERE id = ?', r.wf_id);
    const log = parse(r.log, []);
    if (!w || (!w.enabled && !dry)) { await run(env, "UPDATE wf_runs SET status = 'stopped', note = 'Workflow turned off', updated_at = ? WHERE id = ?", now(), id); continue; }
    const steps = parse(w.steps, []);
    const ev = parse(r.event, {});
    let i = r.step, status = 'waiting', next = null;
    for (let n = 0; n < maxSteps; n++) {
      if (i >= steps.length) { status = 'done'; break; }
      const st = steps[i];
      const ctx = await context(env, r, ev);
      let res;
      try { res = await doStep(env, st, ctx, { dry, depth: ev.depth || 0 }); } catch (e) { res = { line: `${stepLine(st)}: did not work (${String(e?.message || e).slice(0, 160)})` }; }
      log.push({ at: now(), step: i, line: res.line });
      i++;
      if (res.stop) { status = 'stopped'; break; }
      if (res.wait) { if (dry) { continue; } next = now() + res.wait; break; }
    }
    if (status === 'waiting' && !next && i >= steps.length) status = 'done';
    if (!dry) {
      await run(env, 'UPDATE wf_runs SET step = ?, status = ?, next_at = ?, log = ?, updated_at = ? WHERE id = ?', i, status, next || now() + 60e3, JSON.stringify(log.slice(-60)), now(), id);
    }
    out.push({ id, status, log });
  }
  return out;
}

// Cron: continue runs whose wait is over. Each run is claimed first so two Workers never send the same text.
export async function workflowTick(env, max = 15) {
  const due = await all(env, "SELECT id, next_at FROM wf_runs WHERE status = 'waiting' AND next_at <= ? ORDER BY next_at LIMIT ?", now(), max).catch(() => []);
  const mine = [];
  for (const d of due) {
    const r = await run(env, 'UPDATE wf_runs SET next_at = ? WHERE id = ? AND next_at = ?', now() + 120e3, d.id, d.next_at);
    if (r?.meta?.changes) mine.push(d.id);
  }
  if (mine.length) await processRuns(env, mine);
  return mine.length;
}

// ---------- routes (owners build; anyone on the team can put a lead into a workflow) ----------
route('GET', '/api/workflows', async ({ env, user }) => {
  requireStaff(user);
  const list = (await all(env, 'SELECT * FROM workflows ORDER BY enabled DESC, updated_at DESC')).map(row);
  const counts = await all(env, "SELECT wf_id, SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) AS waiting, SUM(CASE WHEN status = 'done' AND updated_at > ? THEN 1 ELSE 0 END) AS done30 FROM wf_runs GROUP BY wf_id", now() - 30 * 864e5);
  const by = Object.fromEntries(counts.map((c) => [c.wf_id, c]));
  return json({ workflows: list.map((w) => ({ ...w, waiting: by[w.id]?.waiting || 0, done30: by[w.id]?.done30 || 0, problems: problems(w) })) });
});
route('GET', '/api/workflows/meta', async ({ env, user }) => {
  requireStaff(user);
  const users = await all(env, "SELECT id, name, email FROM users WHERE role IN ('admin','team') ORDER BY name");
  const { getDispos } = await import('./dispo.js');
  const dispos = await getDispos(env).catch(() => []);
  return json({ users: users.map((u) => ({ id: u.id, name: u.name || u.email })), dispositions: dispos.map((d) => ({ id: d.id, label: d.label, acts: d.acts })) });
});
route('GET', '/api/workflows/:id', async ({ env, user, params }) => {
  requireStaff(user);
  const w = await first(env, 'SELECT * FROM workflows WHERE id = ?', params.id);
  if (!w) throw new HttpError('Workflow not found.', 404);
  const runs = await all(env, `SELECT r.id, r.lead_id, r.status, r.step, r.next_at, r.note, r.log, r.created_at, r.updated_at, l.business FROM wf_runs r LEFT JOIN leads l ON l.id = r.lead_id
    WHERE r.wf_id = ? ORDER BY r.created_at DESC LIMIT 40`, w.id);
  return json({ workflow: { ...row(w), problems: problems(row(w)) }, runs: runs.map((r) => ({ ...r, log: parse(r.log, []) })) });
});
route('POST', '/api/workflows', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  const base = b.recipe && RECIPE_MAP[b.recipe] ? { ...RECIPE_MAP[b.recipe], name: RECIPE_MAP[b.recipe].name } : b;
  const w = cleanWorkflow(base);
  const id = newId('wf_');
  await run(env, 'INSERT INTO workflows (id, name, enabled, trigger, steps, stop_on_reply, reenter, created_by, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)',
    id, w.name, JSON.stringify(w.trigger), JSON.stringify(w.steps), w.stopOnReply ? 1 : 0, w.reenter ? 1 : 0, user.id, now(), now());
  forget();
  return json({ id });
});
route('PUT', '/api/workflows/:id', async ({ env, user, params, body }) => {
  requireAdmin(user);
  const old = await first(env, 'SELECT * FROM workflows WHERE id = ?', params.id);
  if (!old) throw new HttpError('Workflow not found.', 404);
  const b = await body();
  const w = cleanWorkflow({ ...row(old), ...b });
  const enabled = b.enabled == null ? Boolean(old.enabled) : Boolean(b.enabled);
  const p = problems(w);
  if (enabled && p.length) throw new HttpError(`Fix this first: ${p[0]}`, 400);
  await run(env, 'UPDATE workflows SET name = ?, enabled = ?, trigger = ?, steps = ?, stop_on_reply = ?, reenter = ?, updated_at = ? WHERE id = ?',
    w.name, enabled ? 1 : 0, JSON.stringify(w.trigger), JSON.stringify(w.steps), w.stopOnReply ? 1 : 0, w.reenter ? 1 : 0, now(), old.id);
  if (!enabled && old.enabled) await run(env, "UPDATE wf_runs SET status = 'stopped', note = 'Workflow turned off', updated_at = ? WHERE wf_id = ? AND status = 'waiting'", now(), old.id);
  forget();
  return json({ workflow: { ...row(await first(env, 'SELECT * FROM workflows WHERE id = ?', old.id)), problems: p } });
});
route('DELETE', '/api/workflows/:id', async ({ env, user, params }) => {
  requireAdmin(user);
  await run(env, "UPDATE wf_runs SET status = 'stopped', note = 'Workflow deleted', updated_at = ? WHERE wf_id = ? AND status = 'waiting'", now(), params.id);
  await run(env, 'DELETE FROM workflows WHERE id = ?', params.id);
  forget();
  return json({ ok: true });
});
// Test on a lead: runs every step without sending or changing anything, waits skipped, and shows what would happen.
route('POST', '/api/workflows/:id/test', async ({ env, user, params, body }) => {
  requireAdmin(user);
  const b = await body();
  const w = await first(env, 'SELECT * FROM workflows WHERE id = ?', params.id);
  if (!w) throw new HttpError('Workflow not found.', 404);
  const lead = b.leadId ? await first(env, 'SELECT id FROM leads WHERE id = ?', b.leadId) : await first(env, 'SELECT id FROM leads ORDER BY updated_at DESC LIMIT 1');
  if (!lead) throw new HttpError('Add a lead first, then test on it.');
  const id = newId('wr_');
  const ev = { type: parse(w.trigger, {}).type || 'manual', text: b.text || '', depth: 0 };
  await run(env, "INSERT INTO wf_runs (id, wf_id, lead_id, event, step, status, next_at, log, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'test', ?, '[]', ?, ?)", id, w.id, lead.id, JSON.stringify(ev), now(), now(), now());
  const [res] = await processRuns(env, [id], { dry: true, maxSteps: 40 });
  await run(env, 'DELETE FROM wf_runs WHERE id = ?', id);
  return json({ lead: lead.id, log: res?.log || [], ended: res?.status || 'done' });
});
route('POST', '/api/workflow-runs/:id/stop', async ({ env, user, params }) => {
  requireStaff(user);
  await run(env, "UPDATE wf_runs SET status = 'stopped', note = ?, updated_at = ? WHERE id = ? AND status = 'waiting'", `Stopped by ${user.name || user.email}`, now(), params.id);
  return json({ ok: true });
});
// Put one lead into a workflow by hand (GoHighLevel "Add to workflow").
route('POST', '/api/leads/:id/workflow', async ({ env, user, params, body }) => {
  requireStaff(user);
  const b = await body();
  const w = await first(env, 'SELECT * FROM workflows WHERE id = ? AND enabled = 1', b.workflowId || '');
  if (!w) throw new HttpError('Pick a workflow that is turned on.');
  const lead = await first(env, 'SELECT id FROM leads WHERE id = ?', params.id);
  if (!lead) throw new HttpError('Lead not found.', 404);
  const id = newId('wr_');
  await run(env, "INSERT INTO wf_runs (id, wf_id, lead_id, event, step, status, next_at, log, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'waiting', ?, '[]', ?, ?)",
    id, w.id, lead.id, JSON.stringify({ type: 'manual', by: user.id, depth: 0 }), now(), now(), now());
  await run(env, 'UPDATE workflows SET runs = COALESCE(runs, 0) + 1, last_run_at = ? WHERE id = ?', now(), w.id);
  const [res] = await processRuns(env, [id]);
  return json({ id, status: res?.status, log: res?.log || [] });
});
route('GET', '/api/leads/:id/workflows', async ({ env, user, params }) => {
  requireStaff(user);
  const rows = await all(env, `SELECT r.id, r.status, r.step, r.next_at, r.note, r.created_at, w.name FROM wf_runs r JOIN workflows w ON w.id = r.wf_id WHERE r.lead_id = ? ORDER BY r.created_at DESC LIMIT 20`, params.id);
  return json({ runs: rows });
});
