import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScript, SCRIPT_GROUPS, unbold } from '../public/js/leadintel.js';
import { scriptSteps, PRINT_VARS, docHtml, markCues, boldHtml } from '../public/js/scriptprint.js';

test('Game Plan script: own group, filled with rep, company and business', () => {
  assert.ok(SCRIPT_GROUPS.find((g) => g[0] === 'plan'));
  const s = buildScript({ business: 'Joe Plumbing', contact_name: 'Joe Smith' }, null, { rep: 'Sam', voice: 'I' });
  const call = s.steps.find((x) => x.id === 'g_call').lines.join(' ');
  assert.match(call, /Hi Joe\? It's Sam with Rightway Growth\./);
  assert.match(call, /Joe Plumbing/);
  assert.match(call, /website audit/);
  assert.doesNotMatch(call, /Josh|Wavepoint/i);
  assert.equal(scriptSteps('plan').length, 3);
  assert.ok(PRINT_VARS.company && PRINT_VARS.rep);
});

import { applyOutcome } from '../src/crm.js';
test('phone menu outcome takes the lead off the list and tags it', () => {
  const set = applyOutcome({ stage: 'new', tags: 'roofing', attempts: 0 }, 'phone_menu');
  assert.equal(set.stage, 'lost');
  assert.equal(set.tags, 'roofing, phone menu');
  assert.equal(set.next_action_at, null);
  assert.equal(applyOutcome({ stage: 'new', tags: 'phone menu' }, 'phone_menu').tags, 'phone menu');
});

import worker from '../src/worker.js';
import { resetSchemaCache, setSetting } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
test('an older saved disposition list gets Phone menu added once', async () => {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1', ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) };
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env);
    const c = res.headers.get('set-cookie'); if (c) cookie = c.split(';')[0];
    return res.json();
  };
  await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  await setSetting(env, 'dispositions', JSON.stringify([{ id: 'no_answer', label: 'No answer', acts: 'no_answer' }]));
  await setSetting(env, 'dispo_pm', '');
  let r = await call('GET', '/api/dispositions');
  assert.ok(r.dispositions.some((d) => d.acts === 'phone_menu'));
  // Remove it: it stays removed.
  await call('PUT', '/api/dispositions', { dispositions: [{ id: 'no_answer', label: 'No answer', acts: 'no_answer' }] });
  r = await call('GET', '/api/dispositions');
  assert.equal(r.dispositions.some((d) => d.acts === 'phone_menu'), false);
});

test('Competitor analysis cold call is V\'s doc word for word, with rebuttals', () => {
  assert.ok(SCRIPT_GROUPS.find((g) => g[0] === 'analysis'));
  const s = buildScript({ business: 'Joe Plumbing', contact_name: 'Joe Smith', city: 'Miami', industry: 'Plumbing' }, null, { rep: 'Sam', voice: 'I' });
  const steps = s.steps.filter((x) => x.group === 'analysis');
  assert.deepEqual(steps.map((x) => x.id), ['a_call', 'a_set', 'a_disc', 'a_reb']);
  assert.deepEqual(steps.map((x) => x.title), ['The call', 'Once they give you a time', 'Discovery after booking (Optional)', 'Rebuttals']);
  const plain = (id) => steps.find((x) => x.id === id).lines.map(unbold);
  // Typos and odd spacing are his, so they stay.
  assert.deepEqual(plain('a_call'), [
    'Hey Is this [Name/Owner]', "It's [Name] with Rightway Growth:",
    'Just seeing how we could help , we used your info to create a free Competitor Analysis.',
    'I have two spots left for tomorrow to take care of any questions about the report.',
    'I have a 12PM or 5PM. Which works better for you?']);
  assert.equal(steps.find((x) => x.id === 'a_call').lines[2], 'Just seeing how we could help , we used your info to create a **free Competitor Analysis**.');
  assert.equal(plain('a_set').length, 3);
  assert.match(plain('a_set')[2], /keep you’re free for the appointment/);
  assert.match(plain('a_disc')[0], /^Is there anything you’ve been thinking about you would want me to take a look into before we meet \[time\/date\]\.$/);
  const reb = plain('a_reb');
  assert.equal(reb.length, 17);
  assert.equal(reb[0], '"What\'s this about?"');
  assert.match(reb[1], /throw  in and send a game plan report, so you know what to tweak with no guessing…Both are yours to keep\. So what time were your free for$/);
  assert.equal(reb[10], '“What can you do for me about (problem)?“');
  assert.equal(reb[12], '“What can you offer?”(broad)');
  assert.equal(reb[15], 'I bet you do you’re in [industry]');
  assert.doesNotMatch(reb.join(' '), /\{\w+\}/);
  assert.doesNotMatch(steps.flatMap((x) => x.lines).join(' '), /[–—]/);
  // The same text reads the same for owners and teammates (no I/we markers in it).
  const we = buildScript({ business: 'x' }, null, { rep: 'Sam', voice: 'we' }).steps.filter((x) => x.group === 'analysis').flatMap((x) => x.lines);
  assert.deepEqual(we, steps.flatMap((x) => x.lines));
  assert.equal(scriptSteps('analysis').length, 4);
});

test('doc layout: bold, notes, brackets and lowercase parentheses', () => {
  const html = docHtml('analysis');
  assert.match(html, /<h1 class="d-title">COLD CALL SCRIPT:<\/h1><h1 class="d-title">COMPETITOR ANALYSIS<\/h1>/);
  assert.match(html, /create a <b>free Competitor Analysis<\/b>\./);
  assert.match(html, /<span class="d-cue">\(Laugh\)<\/span> Honestly/);
  // Lowercase parentheses are his wording, not a note.
  assert.match(html, /company\(startup agency\)/);
  assert.match(html, /about \(problem\)\?/);
  assert.doesNotMatch(html, /\*\*/);
  assert.match(markCues('Say (Let them answer.) then (problem)'), /do-tag">Do<\/b>Let them answer\.<\/span> then \(problem\)/);
  assert.equal(boldHtml('a **b** c'), 'a <b>b</b> c');
  const cold = docHtml('cold', { voice: 'we', objections: true });
  assert.match(cold, /<h2 class="d-h">Objections:<\/h2>/);
  assert.doesNotMatch(cold, /I\/we|\*\*|\{\w+\}/);
  assert.match(docHtml('clarity'), /Screen: /);
  assert.doesNotMatch(docHtml('clarity'), /\[\[/);
});
