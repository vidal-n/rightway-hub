import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { sendEmail } from '../src/email.js';
import { fromFor } from '../src/hubmail.js';
import { AGENCY_EMAIL, fromLine } from '../public/js/agency.js';
import { loginState } from '../public/js/accounts.js';
import { dueFor, AUTOMATION_SETS, RECOVERY, cleanAutomation, automationTick, showNudgeTick } from '../src/automations.js';
import { d1, r2 } from './shims.mjs';

function setup(extra = {}) {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', ...extra };
  let cookie = '';
  const raw = async (method, path, body) => {
    const h = { 'x-rw': '1' }; if (cookie) h.cookie = cookie;
    let payload; if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return res;
  };
  const call = async (method, path, body) => { const res = await raw(method, path, body); return { status: res.status, data: await res.json().catch(() => ({})) }; };
  return { env, call, raw };
}
const owner = (t) => t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', name: 'Vidal Newton', email: 'v@rightwaygrowth.com', password: 'correct horse battery' });
const stub = (fn) => { const real = globalThis.fetch; globalThis.fetch = async (u, init) => fn(String(u), init) || new Response('{}', { status: 404 }); return () => { globalThis.fetch = real; }; };
const ok = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

test('every email goes out from info@rightwaygrowth.com, whatever EMAIL_FROM says', async () => {
  assert.equal(AGENCY_EMAIL, 'info@rightwaygrowth.com');
  assert.equal(fromFor({ EMAIL_FROM: 'Old <hello@rightwaygrowth.com>' }, { name: 'Kiron Lee' }), 'Kiron Lee (Rightway Growth) <info@rightwaygrowth.com>');
  assert.equal(fromLine(''), 'Rightway Growth <info@rightwaygrowth.com>');
  const sent = [];
  const fetchImpl = async (u, init) => { sent.push(JSON.parse(init.body)); return ok({ id: 'e1' }); };
  await sendEmail({ RESEND_API_KEY: 'k', EMAIL_FROM: 'Other <x@y.com>' }, { to: 'a@b.com', subject: 's', text: 't' }, fetchImpl);
  assert.equal(sent[0].from, 'Rightway Growth <info@rightwaygrowth.com>');
});

test('company accounts: usual list, login state, info@ shortcut, audit of what to move', async () => {
  const t = setup(); await owner(t);
  let r = await t.call('POST', '/api/accounts/seed');
  assert.ok(r.data.added >= 10);
  assert.equal((await t.call('POST', '/api/accounts/seed')).data.added, 0, 'second press adds nothing');
  const list = (await t.call('GET', '/api/accounts')).data;
  assert.equal(list.counts.unset, list.accounts.length, 'nobody has said which email yet: nothing is claimed');
  const cf = list.accounts.find((a) => a.vendor === 'Cloudflare');
  await t.call('PUT', `/api/accounts/${cf.id}`, { login_email: 'kiron@dhalmedia.com' });
  const tw = list.accounts.find((a) => a.vendor === 'Twilio');
  await t.call('PUT', `/api/accounts/${tw.id}`, { login_email: 'INFO@rightwaygrowth.com' });
  assert.equal((await t.call('PUT', `/api/accounts/${tw.id}`, { login_email: 'nope' })).status, 400);
  const after = (await t.call('GET', '/api/accounts')).data;
  assert.equal(after.counts.ok, 1);
  assert.equal(after.counts.other, 1);
  const audit = (await t.call('GET', '/api/logins/audit')).data;
  assert.ok(audit.accounts.some((a) => a.vendor === 'Cloudflare' && a.state === 'other'));
  assert.ok(!audit.accounts.some((a) => a.vendor === 'Twilio'));
  assert.equal(loginState('info@rightwaygrowth.com'), 'ok');
  assert.equal(loginState(''), 'unset');
});

test('handover: manager and open tasks move, past work keeps its name, record survives removal, logins under their email are listed', async () => {
  const t = setup(); await owner(t);
  const me = (await t.call('GET', '/api/me')).data.user;
  const now = Date.now();
  await t.env.DB.prepare("INSERT INTO users (id, email, name, role, created_at, pass_hash) VALUES ('u_k', 'kiron@dhalmedia.com', 'Kiron Lee', 'team', ?, 'x')").bind(now).run();
  const c = (await t.call('POST', '/api/clients', { name: 'Dhal Unlimited', plan: 'growth', keywords: 'a' })).data.client;
  await t.env.DB.prepare('UPDATE clients SET owner_id = ? WHERE id = ?').bind('u_k', c.id).run();
  await t.env.DB.prepare("INSERT INTO tasks (id, client_id, month, kind, title, status, done_at, done_by, owner, sort, created_at) VALUES ('t_done', ?, '2026-10', 'posts', 'Google posts', 'done', ?, 'u_k', 'u_k', 1, ?)").bind(c.id, now - 5e5, now).run();
  await t.env.DB.prepare("INSERT INTO tasks (id, client_id, month, kind, title, status, owner, sort, created_at) VALUES ('t_open', ?, '2026-11', 'posts', 'Google posts', 'todo', 'u_k', 2, ?)").bind(c.id, now).run();
  await t.env.DB.prepare("INSERT INTO time_entries (id, task_id, client_id, user_id, started_at, minutes, created_at) VALUES ('te1', 't_done', ?, 'u_k', ?, 45, ?)").bind(c.id, now - 6e5, now).run();
  assert.equal((await t.call('PUT', `/api/clients/${c.id}/access/website`, { status: 'granted', login_email: 'kiron@dhalmedia.com' })).status, 200);
  assert.equal((await t.call('PUT', `/api/clients/${c.id}/access/gbp`, { status: 'granted', login_email: 'info@rightwaygrowth.com' })).status, 200);

  const holds = (await t.call('GET', '/api/handover/holds/u_k')).data;
  assert.equal(holds.clients.length, 1);
  assert.equal(holds.openTasks, 1);
  assert.equal(holds.doneBy[0].n, 1);
  assert.equal(holds.doneBy[0].minutes, 45);
  assert.deepEqual(holds.theirLogins.map((l) => l.item), ['website'], 'only the login under his own domain email');
  const found = (await t.call('GET', '/api/handover/clients?q=dhal')).data.clients;
  assert.equal(found.length, 1);
  assert.equal(found[0].manager, 'Kiron Lee');

  assert.equal((await t.call('POST', '/api/handover', { from: 'u_k', to: 'u_k', clients: 'all' })).status, 400);
  const r = await t.call('POST', '/api/handover', { from: 'u_k', to: me.id, clients: 'all' });
  assert.deepEqual([r.data.clients, r.data.tasks], [1, 1]);
  const row = await t.env.DB.prepare("SELECT owner_id FROM clients WHERE id = ?").bind(c.id).first();
  assert.equal(row.owner_id, me.id);
  const done = await t.env.DB.prepare("SELECT done_by, owner FROM tasks WHERE id = 't_done'").first();
  assert.deepEqual([done.done_by, done.owner], ['u_k', 'u_k'], 'finished work keeps who did it');
  assert.equal((await t.env.DB.prepare("SELECT owner FROM tasks WHERE id = 't_open'").first()).owner, me.id);
  assert.equal((await t.call('GET', '/api/handover/history')).data.history.length, 1);

  // Remove Kiron: the record still names him.
  assert.equal((await t.call('DELETE', '/api/users/u_k')).status, 200);
  const res = await t.raw('GET', `/api/clients/${c.id}/work-record?format=csv`);
  assert.equal(res.status, 200);
  const csv = await res.text();
  assert.match(csv, /Tasks,.*Kiron Lee \(removed\),2026-10 posts: Google posts,done/);
  assert.match(csv, /Time,.*Kiron Lee \(removed\)/);
  assert.match(csv, /Access,.*Login: kiron@dhalmedia\.com/);
  const rec = (await t.call('GET', `/api/clients/${c.id}/work-record`)).data;
  assert.equal(rec.tasksDoneBy['Kiron Lee (removed)'], 1);
  assert.ok(rec.rows.some((x) => x.section === 'Log' && /Account manager changed from Kiron Lee/.test(x.what)));
});

test('no show recovery: three emails at 30 minutes, a day and three days, only for a marked no show, branded with a booking button', async () => {
  for (const r of RECOVERY) cleanAutomation(r);
  assert.ok(AUTOMATION_SETS.email.list.filter((a) => a.trigger === 'after').every((a) => a.on && a.channel === 'email'));
  const min = 60e3, day = 864e5;
  const t0 = 1e12;
  const lead = { id: 'l', meet_at: t0, stage: 'no_show' };
  const ids = (t) => dueFor(RECOVERY, lead, t).map((a) => a.id);
  assert.deepEqual(ids(t0 + 40 * min), ['ns_email_1']);
  assert.deepEqual(ids(t0 + 5 * 3600e3), ['ns_email_1']);
  assert.deepEqual(ids(t0 + 10 * 3600e3), [], 'nothing between the steps');
  assert.deepEqual(ids(t0 + day + 3600e3), ['ns_email_2']);
  assert.deepEqual(ids(t0 + 3 * day + 3600e3), ['ns_email_3']);
  assert.deepEqual(ids(t0 + 4 * day), [], 'the sequence ends');
  assert.deepEqual(dueFor(RECOVERY, { ...lead, stage: 'audit_booked' }, t0 + 40 * min), [], 'someone who is not marked no show gets nothing');
  assert.deepEqual(dueFor(RECOVERY, { ...lead, stage: 'audit_booked', meet_at: t0 + 3 * day }, t0 + 40 * min), []);
  assert.ok(RECOVERY.every((a) => !/[–—]/.test(a.subject + a.body)), 'no dashes');
});

test('no show recovery end to end: marked no show sends the email from info@ with the booking button, once; do not contact is skipped; a missed call to the closer nudges once', async () => {
  const t = setup({ RESEND_API_KEY: 're_test' }); await owner(t);
  const me = (await t.call('GET', '/api/me')).data.user;
  await t.env.DB.prepare("INSERT INTO settings (k, v) VALUES ('hub_origin', 'https://hub.test') ON CONFLICT(k) DO UPDATE SET v = excluded.v").run();
  await t.call('PUT', '/api/automations', { set: 'email' });
  const lead = (await t.call('POST', '/api/leads', { business: 'Coastal Roof Pros', contact_name: 'Ana Ruiz', phone: '9545550300', email: 'ana@coastal.com', state: 'FL' })).data.lead;
  const at = Date.now() - 40 * 60e3;
  await t.env.DB.prepare("UPDATE leads SET stage = 'no_show', meet_at = ?, book_token = 'tok123' WHERE id = ?").bind(at, lead.id).run();
  const sent = [];
  const done = stub((u, init) => { if (u.includes('resend.com')) { sent.push(JSON.parse(init.body)); return ok({ id: 'e1' }); } return null; });
  try {
    await automationTick(t.env);
    await automationTick(t.env);
  } finally { done(); }
  const rec = sent.filter((e) => /Missed you today/.test(e.subject));
  assert.equal(rec.length, 1, 'once only');
  assert.match(rec[0].from, /<info@rightwaygrowth\.com>$/);
  assert.match(rec[0].html, /Pick a time that works/);
  assert.match(rec[0].html, /logo|RightWay|Rightway/i);

  // Marked and then the lead is on the do not contact list: nothing goes.
  const l2 = (await t.call('POST', '/api/leads', { business: 'Bee Roofing', contact_name: 'Bea Bee', phone: '9545550301', email: 'b@bee.com', state: 'FL' })).data.lead;
  await t.env.DB.prepare("UPDATE leads SET stage = 'no_show', meet_at = ?, dnc = 1 WHERE id = ?").bind(at, l2.id).run();
  sent.length = 0;
  const d2 = stub((u, init) => { if (u.includes('resend.com')) { sent.push(JSON.parse(init.body)); return ok({ id: 'e2' }); } return null; });
  try { await automationTick(t.env); } finally { d2(); }
  assert.equal(sent.length, 0);

  // Appointment passed 30 minutes ago and nobody marked it: one nudge to the closer.
  const l3 = (await t.call('POST', '/api/leads', { business: 'Cee Co', contact_name: 'Cy Cee', phone: '9545550302', email: 'c@cee.com', state: 'FL' })).data.lead;
  await t.env.DB.prepare("UPDATE leads SET stage = 'audit_booked', meet_at = ?, closer_id = ? WHERE id = ?").bind(Date.now() - 30 * 60e3, me.id, l3.id).run();
  assert.equal(await showNudgeTick(t.env), 1);
  assert.equal(await showNudgeTick(t.env), 0, 'only once per appointment');
  const n = await t.env.DB.prepare("SELECT title FROM notifications WHERE user_id = ? AND title LIKE 'Did Cee Co show%'").bind(me.id).first();
  assert.ok(n);
});

test('saved automation lists get the recovery emails added once', async () => {
  const t = setup(); await owner(t);
  const old = AUTOMATION_SETS.email.list.filter((a) => a.trigger !== 'after');
  await t.call('PUT', '/api/automations', { automations: old });
  const saved = (await t.call('GET', '/api/automations')).data.automations;
  assert.ok(saved.some((a) => a.id === 'ns_email_1' && a.on));
  // V turns one off on purpose: it stays off.
  const edited = saved.map((a) => (a.id === 'ns_email_3' ? { ...a, on: false } : a));
  await t.call('PUT', '/api/automations', { automations: edited });
  assert.equal((await t.call('GET', '/api/automations')).data.automations.find((a) => a.id === 'ns_email_3').on, false);
});

import { packet, numberStates, nextStep, isHelp, HELP_REPLY, CONSENT_TEXT, samples } from '../public/js/a2p.js';
import { readFileSync } from 'node:fs';

test('A2P packet: real wording, no dashes, number states and next step follow what Twilio shows', () => {
  const p = packet({ origin: 'https://hub.rightwaygrowth.com' });
  const all = JSON.stringify(p);
  assert.ok(!/[–—]/.test(all), 'no dashes');
  assert.match(all, /hub\.rightwaygrowth\.com\/privacy\.html/);
  assert.match(all, /hub\.rightwaygrowth\.com\/terms\.html/);
  assert.match(all, /Reply STOP to opt out or HELP for help/);
  assert.ok(p.campaign.find(([k]) => k === 'How people opt in (message flow)')[1].includes(CONSENT_TEXT), 'quotes the exact checkbox words');
  assert.ok(samples().every((s) => s.length <= 320));
  assert.ok(samples().slice(0, 2).every((s) => /Rightway Growth/.test(s) && /STOP/.test(s)), 'first texts carry the name and opt out');
  const nums = [{ number: '+13055073393' }, { number: '+17865550100' }, { number: '+19545550111' }];
  const services = [{ name: 'Rightway Growth', numbers: ['+13055073393', '+17865550100'], campaigns: [{ status: 'IN_PROGRESS' }] }];
  const st = numberStates(nums, services);
  assert.deepEqual(st.map((s) => s.state), ['pending', 'pending', 'unattached']);
  assert.match(nextStep({ brands: [], states: st }), /register the brand/);
  assert.match(nextStep({ brands: [{ status: 'APPROVED' }], states: st }), /Messaging Service/);
  const done = numberStates(nums.slice(0, 1), [{ name: 'S', numbers: ['+13055073393'], campaigns: [{ status: 'VERIFIED' }] }]);
  assert.equal(done[0].state, 'registered');
  assert.match(nextStep({ brands: [{ status: 'APPROVED' }], states: done }), /Everything is registered/);
});

test('HELP gets an answer with the company name; the booking page and the Terms and Privacy pages carry the SMS language', async () => {
  assert.ok(isHelp('HELP') && isHelp(' info ') && !isHelp('help me with pricing'));
  assert.match(HELP_REPLY, /Rightway Growth/);
  assert.match(HELP_REPLY, /info@rightwaygrowth\.com/);
  const t = setup({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+13055073393' }); await owner(t);
  const { twilioSignature } = await import('../src/calls.js');
  const params = { From: '+19545550300', To: '+13055073393', Body: 'HELP', MessageSid: 'SM9' };
  const url = 'https://hub.test/api/twilio/sms';
  const sig = await twilioSignature('tok', url, params);
  const res = await worker.fetch(new Request(url, { method: 'POST', headers: { 'x-twilio-signature': sig, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() }), t.env);
  const xml = await res.text();
  assert.match(xml, /<Message>Rightway Growth: For help email info@rightwaygrowth\.com/);
  const terms = readFileSync(new URL('../public/terms.html', import.meta.url), 'utf8');
  const priv = readFileSync(new URL('../public/privacy.html', import.meta.url), 'utf8');
  for (const [name, html] of [['terms', terms], ['privacy', priv]]) {
    assert.match(html, /STOP/, name);
    assert.match(html, /HELP/, name);
    assert.match(html, /Message and data rates may apply/, name);
    assert.ok(!/[–—]/.test(html), `${name}: no dashes`);
  }
  assert.match(priv, /do not share, sell or rent your mobile number/i);
  assert.match(readFileSync(new URL('../public/js/book.js', import.meta.url), 'utf8'), /CONSENT_TEXT/);
});

test('A2P page reads Twilio, one failing read does not hide the rest, owners only', async () => {
  const t = setup({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+13055073393' }); await owner(t);
  const done = stub((u) => {
    if (u.includes('IncomingPhoneNumbers')) return ok({ incoming_phone_numbers: [{ sid: 'PN1', phone_number: '+13055073393', friendly_name: 'Main' }, { sid: 'PN2', phone_number: '+17865550100', friendly_name: 'Line 2' }] });
    if (u.includes('a2p/BrandRegistrations')) return ok({ data: [{ sid: 'BN1', status: 'APPROVED', brand_type: 'STANDARD' }] });
    if (u.endsWith('/v1/Services?PageSize=20')) return ok({ services: [{ sid: 'MG1', friendly_name: 'Rightway Growth' }] });
    if (u.includes('/Services/MG1/PhoneNumbers')) return ok({ phone_numbers: [{ phone_number: '+13055073393' }] });
    if (u.includes('/Compliance/Usa2p')) return new Response(JSON.stringify({ message: 'Not authorized' }), { status: 403 });
    return null;
  });
  let r;
  try { r = await t.call('GET', '/api/a2p'); } finally { done(); }
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.numbers.map((n) => n.state), ['nocampaign', 'unattached']);
  assert.ok(r.data.errors.some((e) => /Campaigns in Rightway Growth/.test(e)));
  assert.match(r.data.next, /Messaging Service/);
  assert.ok(r.data.packet.campaign.length > 8);
});
