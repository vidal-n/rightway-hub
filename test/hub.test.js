import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { tasksForMonth } from '../src/plans.js';
import { templateCaptions, parseCaptionJson, generateCaptions } from '../src/captions.js';
import { d1, r2 } from './shims.mjs';

function makeEnv() {
  resetSchemaCache();
  return { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
}

// Tiny client that keeps the session cookie like a browser.
function client(env) {
  let cookie = '';
  async function call(method, path, body, extra = {}) {
    const headers = { 'x-rw': '1', ...extra };
    if (cookie) headers.cookie = cookie;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers, body: payload, redirect: 'manual' }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, res, data: ct.includes('json') ? await res.json() : null };
  }
  return { call, get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
}

async function setupOwner(env) {
  const owner = client(env);
  const r = await owner.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return owner;
}

test('setup needs the access key and only works once', async () => {
  const env = makeEnv();
  const anon = client(env);
  let r = await anon.call('GET', '/api/auth/state');
  assert.equal(r.data.users, false);
  r = await anon.call('POST', '/api/auth/setup', { accessKey: 'wrong', email: 'a@b.co', password: 'x'.repeat(12) });
  assert.equal(r.status, 401);
  const owner = await setupOwner(env);
  r = await owner.call('GET', '/api/auth/state');
  assert.equal(r.data.user.role, 'admin');
  r = await anon.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'x@b.co', password: 'x'.repeat(12) });
  assert.equal(r.status, 409);
});

test('writes without the x-rw header are refused (CSRF guard)', async () => {
  const env = makeEnv();
  const owner = await setupOwner(env);
  const res = await worker.fetch(new Request('https://hub.test/api/clients', { method: 'POST', headers: { cookie: owner.cookie, 'content-type': 'application/json' }, body: '{"name":"X"}' }), env);
  assert.equal(res.status, 400);
});

test('login, wrong password lockout message, logout', async () => {
  const env = makeEnv();
  await setupOwner(env);
  const c = client(env);
  let r = await c.call('POST', '/api/auth/login', { email: 'V@rightwaygrowth.com', password: 'nope' });
  assert.equal(r.status, 401);
  r = await c.call('POST', '/api/auth/login', { email: 'v@rightwaygrowth.com', password: 'correct horse battery' });
  assert.equal(r.status, 200);
  r = await c.call('POST', '/api/auth/logout');
  r = await c.call('GET', '/api/clients');
  assert.equal(r.status, 401);
});

test('full client flow: create, invite, client sees only their own data', async () => {
  const env = makeEnv();
  const owner = await setupOwner(env);
  let r = await owner.call('POST', '/api/clients', { name: 'Orale Mexican Restaurant', plan: 'growth', place_id: 'ChIJabc', services: 'Tacos, Catering', cities: 'Hollywood, Hallandale', start_date: '2026-11-01' });
  assert.equal(r.status, 200);
  const c1 = r.data.client.id;
  r = await owner.call('POST', '/api/clients', { name: 'Other Biz', plan: 'starter' });
  const c2 = r.data.client.id;

  // Invite the client owner and accept.
  r = await owner.call('POST', `/api/clients/${c1}/invite`, { email: 'owner@orale.com', name: 'Maria' });
  const tok = r.data.inviteUrl.split('/invite/')[1];
  const cl = client(env);
  r = await cl.call('GET', `/api/auth/invite/${tok}`);
  assert.equal(r.data.email, 'owner@orale.com');
  r = await cl.call('POST', '/api/auth/invite/accept', { token: tok, password: 'short' });
  assert.equal(r.status, 400);
  r = await cl.call('POST', '/api/auth/invite/accept', { token: tok, password: 'maria password 1' });
  assert.equal(r.status, 200);
  assert.equal(r.data.role, 'client');

  // Client access rules
  assert.equal((await cl.call('GET', `/api/clients/${c1}`)).status, 200);
  assert.equal((await cl.call('GET', `/api/clients/${c2}`)).status, 403);
  assert.equal((await cl.call('GET', '/api/clients')).status, 403);
  assert.equal((await cl.call('PATCH', `/api/clients/${c1}`, { name: 'Hacked' })).status, 403);

  // Tasks: generate once, client sees only visible ones, staff can complete.
  r = await owner.call('POST', `/api/clients/${c1}/tasks/generate`, { month: '2026-11' });
  assert.ok(r.data.created > 20);
  r = await owner.call('POST', `/api/clients/${c1}/tasks/generate`, { month: '2026-11' });
  assert.equal(r.data.created, 0);
  r = await owner.call('GET', `/api/clients/${c1}/tasks?month=2026-11`);
  const t = r.data.tasks.find((x) => x.kind === 'post');
  // Proof before close: a post task needs the live link or a screenshot.
  let pr = await owner.call('PATCH', `/api/tasks/${t.id}`, { status: 'done', note: 'Posted the taco Tuesday photo' });
  assert.equal(pr.status, 400);
  assert.match(pr.data.error, /live link or a screenshot/);
  pr = await owner.call('PATCH', `/api/tasks/${t.id}`, { status: 'done', link: 'https://g.page/orale/post/1' });
  assert.equal(pr.data.task.status, 'done');
  const hidden = r.data.tasks.find((x) => x.kind === 'setup');
  await owner.call('PATCH', `/api/tasks/${hidden.id}`, { client_visible: false });
  r = await cl.call('GET', `/api/clients/${c1}/tasks?month=2026-11`);
  assert.ok(!r.data.tasks.some((x) => x.id === hidden.id));
  r = await cl.call('GET', `/api/clients/${c1}/activity`);
  assert.equal(r.data.activity[0].type, 'task');
  assert.equal((await cl.call('PATCH', `/api/tasks/${t.id}`, { status: 'todo' })).status, 403);

  // Review request from the client's phone, tracked redirect.
  r = await cl.call('POST', `/api/clients/${c1}/reviews`, { name: 'Jose Perez', contact: '+19545550100', channel: 'sms' });
  assert.equal(r.status, 200);
  assert.match(r.data.message, /Hi Jose, thank you for choosing Orale/);
  const path = new URL(r.data.link).pathname;
  const red = await worker.fetch(new Request(`https://hub.test${path}`, { redirect: 'manual' }), env);
  assert.equal(red.status, 302);
  assert.match(red.headers.get('location'), /writereview\?placeid=ChIJabc/);
  r = await cl.call('GET', `/api/clients/${c1}/reviews`);
  assert.equal(r.data.totals.sent, 1);
  assert.equal(r.data.totals.clicked, 1);
  const kit = await worker.fetch(new Request(`https://hub.test/r/k/${c1}`, { redirect: 'manual' }), env);
  assert.equal(kit.status, 302);

  // Photo post with template captions (no AI key), client approves, staff marks posted.
  const fd = new FormData();
  fd.set('note', 'Fresh birria tacos for the weekend');
  fd.set('photo', new File([new Uint8Array([255, 216, 255, 0, 1, 2])], 'p.jpg', { type: 'image/jpeg' }));
  r = await cl.call('POST', `/api/clients/${c1}/posts`, fd);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const post = r.data.post;
  assert.match(post.google_text, /Tacos/i);
  assert.ok(!/\d{3}[) -]?\d{3}-\d{4}/.test(post.google_text), 'no phone numbers in Google post');
  const img = await cl.call('GET', `/api/media/${post.id}`);
  assert.equal(img.status, 200);
  assert.equal((await client(env).call('GET', `/api/media/${post.id}`)).status, 401);
  r = await cl.call('PATCH', `/api/posts/${post.id}`, { status: 'approved' });
  assert.equal(r.data.post.status, 'approved');
  assert.equal((await cl.call('PATCH', `/api/posts/${post.id}`, { google_text: 'x' })).status, 403);
  r = await owner.call('PATCH', `/api/posts/${post.id}`, { status: 'posted' });
  assert.equal(r.data.post.status, 'posted');

  // Scans: staff saves, client reads summary and data.
  const scan = { keyword: 'mexican restaurant', size: 3, radius: 1, createdAt: '2026-11-01T00:00:00Z', target: { title: 'Orale' },
    points: Array.from({ length: 9 }, (_, i) => ({ row: Math.floor(i / 3), col: i % 3, lat: 26, lng: -80, status: 'done', rank: i < 3 ? 2 : 12, top: [] })) };
  r = await owner.call('POST', `/api/clients/${c1}/scans`, { scan });
  assert.equal(r.status, 200);
  r = await cl.call('GET', `/api/clients/${c1}/scans`);
  assert.equal(r.data.scans[0].top3Pct, 33);
  r = await cl.call('GET', `/api/clients/${c1}`);
  assert.equal(r.data.overview.lastScan.keyword, 'mexican restaurant');
  assert.equal(r.data.overview.reviews.sent, 1);
  assert.equal(r.data.overview.posts.posted, 1);
  assert.equal(r.data.client.notes, undefined);

  // Dashboard list for staff
  r = await owner.call('GET', '/api/clients?month=2026-11');
  assert.equal(r.data.clients.length, 2);
});

test('team invites: only admins invite staff; staff session unlocks the scan tool', async () => {
  const env = makeEnv();
  const owner = await setupOwner(env);
  let r = await owner.call('POST', '/api/team/invite', { email: 'kiron@rightwaygrowth.com', name: 'Kiron', role: 'admin' });
  const tok = r.data.inviteUrl.split('/invite/')[1];
  const k = client(env);
  await k.call('POST', '/api/auth/invite/accept', { token: tok, password: 'kiron password 1' });
  r = await k.call('GET', '/api/team');
  assert.equal(r.data.users.length, 2);
  env.DATAFORSEO_LOGIN = 'l'; env.DATAFORSEO_PASSWORD = 'p';
  // Scan tool check-key: no access key header, but a staff session.
  const res = await worker.fetch(new Request('https://hub.test/api/check-key', { method: 'POST', headers: { cookie: k.cookie, 'content-type': 'application/json' }, body: '{}' }), env);
  assert.equal(res.status, 200);
  const anon = await worker.fetch(new Request('https://hub.test/api/check-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), env);
  assert.equal(anon.status, 401);
});

test('hub reports a clear message when the database is not connected', async () => {
  resetSchemaCache();
  const res = await worker.fetch(new Request('https://hub.test/api/auth/state'), {});
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /database is not connected/);
});

test('plans: setup tasks in month one, quarterly planning for Market Leader', () => {
  const g1 = tasksForMonth({ plan: 'growth', start_date: '2026-11-03' }, '2026-11');
  assert.ok(g1.some((t) => t.kind === 'setup'));
  assert.equal(g1.filter((t) => t.kind === 'post').length, 4);
  assert.equal(g1.filter((t) => t.kind === 'page').length, 2);
  const g2 = tasksForMonth({ plan: 'growth', start_date: '2026-11-03' }, '2026-12');
  assert.ok(!g2.some((t) => t.kind === 'setup'));
  const l = tasksForMonth({ plan: 'leader', start_date: '2026-11-03' }, '2027-02');
  assert.ok(l.some((t) => t.kind === 'planning'));
  assert.equal(l.filter((t) => t.kind === 'content').length, 6);
});

test('captions: templates are local and clean; AI replies are parsed and dashes removed', async () => {
  const c = { name: 'Summit Roofing', services: 'Roof replacement, Roof repair', cities: 'Hollywood', keywords: 'roofer near me' };
  const t = templateCaptions(c, 'New shingle roof on a family home');
  assert.match(t.google, /Hollywood/);
  assert.ok(t.hashtags.includes('#hollywood'));
  assert.ok(t.hashtags.length <= 5);
  const p = parseCaptionJson('Sure! {"google":"Roof done — great","facebook":"f","instagram":"i","hashtags":["#a"],"keywords":["k"],"alt_text":"a roof"}');
  assert.equal(p.google, 'Roof done ,  great');
  let sent;
  const fake = async (url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"google":"g","facebook":"f","instagram":"i","hashtags":[],"keywords":[],"alt_text":"x"}' }] }), { status: 200 }); };
  const out = await generateCaptions({ ANTHROPIC_API_KEY: 'k' }, c, 'note', { base64: 'AAAA', mediaType: 'image/jpeg' }, fake);
  assert.equal(out.ai, true);
  assert.equal(sent.messages[0].content[0].type, 'image');
  assert.equal(sent.model, 'claude-haiku-4-5-20251001');
  const failed = await generateCaptions({ ANTHROPIC_API_KEY: 'k' }, c, 'note', null, async () => new Response('{}', { status: 500 }));
  assert.equal(failed.ai, false);
  assert.ok(failed.error);
});
