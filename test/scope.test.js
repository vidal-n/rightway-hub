import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { SCOPE, cleanScope, tierOf, monthlyTasks, setupTasks, quarterlyTasks, effort, hoursOf, scopeLine, scopeFromPlan, dollars, clampQty } from '../public/js/scope.js';
import { quoteFor, scopeOfQuote, roi } from '../public/js/leadintel.js';
import { PLANS } from '../src/plans.js';
import { d1, r2 } from './shims.mjs';

function setup() {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' };
    if (cookie) h.cookie = cookie;
    let payload;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload, redirect: 'manual' }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
  };
  return { env, call };
}
const login = (t) => t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
const month = () => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

test('scope: clean, clamp, order and money parsing', () => {
  assert.deepEqual(cleanScope(['report', 'profile', 'nope', 'profile']).map((x) => x.id), ['profile', 'report']);
  assert.equal(cleanScope(['posts'])[0].qty, SCOPE.posts.def);
  assert.equal(cleanScope([{ id: 'posts', qty: 99 }])[0].qty, SCOPE.posts.max);
  assert.equal(cleanScope([{ id: 'posts', qty: 0 }])[0].qty, SCOPE.posts.min);
  assert.equal(cleanScope(JSON.stringify({ services: ['pages'], qty: { pages: 5 } }))[0].qty, 5);
  assert.equal(cleanScope('not json').length, 0);
  assert.equal(clampQty('profile', 7), 1, 'services without a count are always 1');
  assert.equal(dollars('$1,250.50'), 1250.5);
  assert.equal(dollars(''), null);
  assert.equal(dollars('abc'), null);
  assert.equal(dollars(-5), null);
});

test('scope: the tasks, the setup list and the internal tier all follow the services picked', () => {
  const small = [{ id: 'profile', qty: 1 }, { id: 'posts', qty: 6 }, { id: 'report', qty: 1 }];
  const rows = monthlyTasks(small);
  assert.equal(rows.find((r) => r[0] === 'post')[2], 6);
  assert.deepEqual(rows.slice(-2).map((r) => r[0]), ['report', 'meeting'], 'report and meeting come last');
  assert.ok(!rows.some((r) => r[0] === 'page' || r[0] === 'link'));
  assert.ok(setupTasks(small).length >= 10);
  assert.ok(!setupTasks(small).includes('Call tracking number set up and forwarding'));
  const big = [...small, { id: 'tracking', qty: 1 }, { id: 'onpage', qty: 3 }, { id: 'locations', qty: 1 }];
  assert.ok(setupTasks(big).includes('Call tracking number set up and forwarding'));
  assert.ok(monthlyTasks(big).some((r) => r[0] === 'technical'), 'three website fixes a month adds the technical pass');
  assert.equal(quarterlyTasks(big).length, 1);
  assert.equal(quarterlyTasks(small).length, 0);
  assert.equal(tierOf(big), 'leader', 'locations need the heaviest internal tier');
  assert.notEqual(tierOf(small), 'leader');
  assert.equal(scopeLine({ id: 'posts', qty: 6 }), 'Weekly Google posts and fresh photos (6 posts a month)');
});

test('scope: hours come from the guides, so more work means more time', () => {
  const a = effort([{ id: 'profile', qty: 1 }, { id: 'posts', qty: 4 }, { id: 'report', qty: 1 }]);
  const b = effort([{ id: 'profile', qty: 1 }, { id: 'posts', qty: 8 }, { id: 'pages', qty: 4 }, { id: 'report', qty: 1 }]);
  assert.ok(a.monthly > 0 && b.monthly > a.monthly);
  assert.ok(a.setup > 0);
  const longer = effort([{ id: 'report', qty: 1 }], { meetingMinutes: 90 });
  const shorter = effort([{ id: 'report', qty: 1 }], { meetingMinutes: 30 });
  assert.ok(longer.monthly > shorter.monthly);
  assert.equal(hoursOf(90), 1.5);
  assert.equal(hoursOf(1200), 20);
});

test('scope: an old plan becomes a scope so nothing already sold is lost', () => {
  const s = scopeFromPlan('growth', PLANS.growth.monthly);
  assert.ok(s.length >= 5);
  assert.ok(s.find((x) => x.id === 'profile'));
  assert.ok(!s.find((x) => x.id === 'locations'));
  assert.ok(scopeFromPlan('leader', PLANS.leader.monthly).find((x) => x.id === 'locations'));
});

test('quote: the research picks the services and amounts, and never a price', () => {
  const lead = { business: 'Summit Roofing', category: 'Roofing contractor', city: 'Miami', state: 'FL', website: 'https://summit.test' };
  const bare = quoteFor(lead, null, {});
  assert.equal(bare.setup, null);
  assert.equal(bare.monthly, null);
  assert.equal(bare.anchor, null);
  assert.ok(bare.services.length >= 5, 'core services are always in');
  assert.ok(bare.services.some((s) => s.id === 'profile' && s.qty === 1));
  assert.ok(bare.services.find((s) => s.id === 'pages')?.qty >= 2);
  const typed = quoteFor(lead, null, { setup: 650, monthly: 525, services: ['profile', 'posts'], qty: { posts: 8 } });
  assert.equal(typed.setup, 650);
  assert.equal(typed.monthly, 525);
  assert.deepEqual(scopeOfQuote(typed).map((x) => [x.id, x.qty]), [['profile', 1], ['posts', 8]]);
  assert.equal(roi({ ticket: 500, jobs: 2 }).price, 0);
});

test('clients: a new one gets a scope from the work, and the owner types what they pay', async () => {
  const t = setup();
  await login(t);
  let r = await t.call('POST', '/api/clients', { name: 'Palm Plumbing', status: 'active', start_date: '2026-10-05', monthly: '375' });
  assert.equal(r.status, 200);
  const c = r.data.client;
  assert.equal(c.mrr_cents, 37500);
  r = await t.call('GET', `/api/clients/${c.id}`);
  assert.equal(r.data.client.plan_info.custom, true);
  assert.ok(r.data.client.plan_info.scope.length >= 5);
  assert.ok(r.data.client.plan_info.effort.monthly > 0);
  // The engine makes the month's tasks; editing the scope then keeps them in line.
  r = await t.call('POST', `/api/clients/${c.id}/tasks/generate`, { month: month() });
  assert.ok(r.data.created > 0);
  r = await t.call('PUT', `/api/clients/${c.id}/scope`, { services: [{ id: 'profile' }, { id: 'posts', qty: 8 }, { id: 'report' }] });
  assert.equal(r.status, 200);
  r = await t.call('GET', `/api/clients/${c.id}/tasks?month=${month()}`);
  const titles = r.data.tasks.map((x) => x.title);
  assert.equal(titles.filter((x) => /^Google profile post/.test(x)).length, 8);
  assert.ok(!titles.some((x) => /^New local service or city page/.test(x)), 'pages were dropped from the scope');
  // Start a post, then lower the count: the one being worked on stays.
  const post = r.data.tasks.find((x) => /^Google profile post/.test(x.title));
  await t.call('PATCH', `/api/tasks/${post.id}`, { status: 'doing' });
  r = await t.call('PUT', `/api/clients/${c.id}/scope`, { services: [{ id: 'profile' }, { id: 'posts', qty: 3 }, { id: 'report' }] });
  assert.equal(r.status, 200);
  r = await t.call('GET', `/api/clients/${c.id}/tasks?month=${month()}`);
  const posts = r.data.tasks.filter((x) => /^Google profile post/.test(x.title));
  assert.equal(posts.length, 3);
  assert.ok(posts.some((x) => x.id === post.id), 'worked on tasks are never deleted');
  // Bad input does not wipe the scope.
  r = await t.call('PUT', `/api/clients/${c.id}/scope`, { services: [] });
  assert.equal(r.status, 400);
});

test('prices: the work order and payment link refuse to guess an amount', async () => {
  const t = setup();
  await login(t);
  const lead = (await t.call('POST', '/api/leads', { business: 'Bay Air Pros', contact_name: 'Lee', email: 'lee@bayair.test', phone: '3055550133', state: 'FL' })).data.lead;
  let r = await t.call('POST', `/api/leads/${lead.id}/work-order`, {});
  assert.equal(r.status, 400);
  r = await t.call('PUT', `/api/leads/${lead.id}/quote`, { setup: 'free', monthly: '300', services: [{ id: 'profile' }] });
  assert.equal(r.status, 400, 'a bad amount is refused, not rounded to something else');
  r = await t.call('PUT', `/api/leads/${lead.id}/quote`, { setup: '300', monthly: '300', services: [{ id: 'profile' }, { id: 'nonsense' }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.quote.services, ['profile'], 'unknown services are dropped');
  r = await t.call('POST', `/api/leads/${lead.id}/work-order`, {});
  assert.equal(r.status, 200);
  const order = r.data;
  assert.ok(order.url);
  r = await t.call('GET', '/api/plans');
  assert.ok(r.status >= 400, 'the plans list is gone');
});
