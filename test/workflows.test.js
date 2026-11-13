import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, run, all } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
import { cleanWorkflow, triggerMatches, problems, fillText, varsFor, RECIPES, CHECK_MAP, stepLine, cleanStep } from '../public/js/workflows.js';
import { workflowTick } from '../src/workflows.js';

test('workflows: cleaning, triggers, checks and recipes', () => {
  const w = cleanWorkflow({ name: 'X—Y', trigger: { type: 'stage_changed', to: 'no_show' }, steps: [{ type: 'wait', amount: 9999, unit: 'weeks' }, { type: 'bogus' }, { type: 'webhook', url: 'http://x.test' }] });
  assert.equal(w.name, 'X, Y');
  assert.equal(w.steps.length, 2);
  assert.equal(w.steps[0].amount, 365);
  assert.equal(w.steps[0].unit, 'minutes');
  assert.equal(w.steps[1].url, '');
  assert.ok(problems(w).some((p) => /https/.test(p)));
  assert.ok(triggerMatches({ type: 'text_in', contains: 'C' }, { type: 'text_in', text: 'c.' }));
  assert.ok(!triggerMatches({ type: 'text_in', contains: 'C' }, { type: 'text_in', text: 'call me' }));
  assert.ok(triggerMatches({ type: 'lead_created', sources: ['web form'] }, { type: 'lead_created', source: 'Web Form' }));
  assert.ok(!triggerMatches({ type: 'lead_created', sources: ['web form'] }, { type: 'lead_created', source: 'import' }));
  assert.ok(triggerMatches({ type: 'call_result', outcomes: ['not_now'] }, { type: 'call_result', outcome: 'not_now' }));
  assert.equal(fillText('Hi {first}, {nope}', varsFor({ owner_name: 'Ana Ruiz' })), 'Hi Ana, {nope}');
  assert.equal(fillText('Hi {first}', varsFor({})), 'Hi there');
  assert.ok(CHECK_MAP.has_tag.test({ lead: { tags: 'Hot, new' } }, 'hot'));
  assert.ok(!CHECK_MAP.can_text.test({ lead: { sms_stop: 1, sms_consent: 1 }, event: {} }));
  for (const r of RECIPES) { const c = cleanWorkflow(r); assert.deepEqual(problems(c), [], r.id); assert.ok(!/[–—]/.test(JSON.stringify(r)), r.id); }
  assert.match(stepLine(cleanStep({ type: 'wait', amount: 1, unit: 'days' })), /Wait 1 day$/);
});

function setup() {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' };
    if (cookie) h.cookie = cookie;
    let payload;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { env, call };
}

test('workflows end to end: a form starts speed to lead, waits, the cron finishes it; dry runs change nothing; inbox lists it', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'Vidal Newton', password: 'correct horse battery' });
  const made = await t.call('POST', '/api/workflows', { recipe: 'speed_to_lead' });
  assert.equal(made.status, 200);
  const id = made.data.id;
  const on = await t.call('PUT', `/api/workflows/${id}`, { enabled: true });
  assert.equal(on.status, 200);
  const bad = await t.call('POST', '/api/workflows', { name: 'Empty' });
  assert.equal((await t.call('PUT', `/api/workflows/${bad.data.id}`, { enabled: true })).status, 400, 'a workflow with no steps cannot be turned on');

  const form = await worker.fetch(new Request('https://hub.test/api/public/lead', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://rightwaygrowth.com' },
    body: JSON.stringify({ business: 'Sparkle Plumbing', name: 'Ana Ruiz', phone: '(305) 555-0188', email: 'ana@sparkle.test', city: 'Miami', state: 'FL' }) }), t.env);
  assert.ok(form.status < 300, `form ${form.status}`);
  let runs = await all(t.env, 'SELECT * FROM wf_runs WHERE wf_id = ?', id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'waiting');
  assert.equal(runs[0].step, 4, 'text, task and alert ran, then it waits 5 minutes');
  const log = JSON.parse(runs[0].log);
  assert.match(log[0].line, /did not work|Texted/); // no Twilio keys in tests: the error is logged and the workflow goes on
  const lead = (await all(t.env, 'SELECT * FROM leads'))[0];
  assert.match(lead.next_action, /speed to lead/i);
  // Same lead again within a day: no second run.
  await import('../src/workflows.js').then((m) => m.emit(t.env, 'form_submitted', { leadId: lead.id }));
  assert.equal((await all(t.env, 'SELECT id FROM wf_runs WHERE wf_id = ?', id)).length, 1);
  // Five minutes later the cron runs the rest: nobody called, so owners get the alert and it finishes.
  await run(t.env, 'UPDATE wf_runs SET next_at = ? WHERE id = ?', Date.now() - 1000, runs[0].id);
  assert.equal(await workflowTick(t.env), 1);
  runs = await all(t.env, 'SELECT * FROM wf_runs WHERE wf_id = ?', id);
  assert.equal(runs[0].status, 'done');
  assert.ok(JSON.parse(runs[0].log).some((x) => /Nobody has called|Alerted owners/.test(x.line)));
  const notes = await all(t.env, "SELECT title FROM notifications WHERE title LIKE 'Nobody has called%'");
  assert.ok(notes.length >= 1);

  // Dry run: tag recipe on the same lead changes nothing.
  const tagWf = await t.call('POST', '/api/workflows', { name: 'Tag', trigger: { type: 'tag_added', tag: 'x' }, steps: [{ type: 'add_tag', tag: 'tested' }, { type: 'set_stage', stage: 'follow_up' }] });
  const dry = await t.call('POST', `/api/workflows/${tagWf.data.id}/test`, { leadId: lead.id });
  assert.equal(dry.status, 200);
  assert.ok(dry.data.log.some((x) => /Would add tag tested/.test(x.line)));
  const after = (await all(t.env, 'SELECT tags, stage FROM leads WHERE id = ?', lead.id))[0];
  assert.ok(!/tested/.test(after.tags || ''));
  assert.notEqual(after.stage, 'follow_up');

  // Stop when they reply: a waiting run ends the moment they text in.
  const wait = await t.call('POST', '/api/workflows', { name: 'Nurture', trigger: { type: 'tag_added' }, stopOnReply: true, steps: [{ type: 'wait', amount: 2, unit: 'days' }, { type: 'note', text: 'Follow up' }] });
  await t.call('PUT', `/api/workflows/${wait.data.id}`, { enabled: true });
  await t.call('PATCH', `/api/leads/${lead.id}`, { tags: 'hot' });
  let w2 = await all(t.env, 'SELECT * FROM wf_runs WHERE wf_id = ?', wait.data.id);
  assert.equal(w2[0].status, 'waiting');
  await import('../src/workflows.js').then((m) => m.emit(t.env, 'text_in', { leadId: lead.id, text: 'yes' }));
  w2 = await all(t.env, 'SELECT * FROM wf_runs WHERE wf_id = ?', wait.data.id);
  assert.equal(w2[0].status, 'stopped');

  // Inbox: the form request and the note show in one conversation.
  await t.call('POST', `/api/conversations/${lead.id}/note`, { text: 'Called her cell, left a message' });
  const inbox = await t.call('GET', '/api/conversations');
  assert.equal(inbox.status, 200);
  const c = inbox.data.conversations.find((x) => x.id === lead.id);
  assert.ok(c && c.channels.includes('form'));
  const th = await t.call('GET', `/api/conversations/${lead.id}`);
  assert.ok(th.data.items.some((i) => i.kind === 'note' && /left a message/.test(i.body)));
  const list = await t.call('GET', '/api/workflows');
  assert.ok(list.data.workflows.find((w) => w.id === id).runs >= 1);
});
