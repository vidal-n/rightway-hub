import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, run, first, all } from '../src/db.js';
import { analyzeReviews, reviewPace, slimReviews, collectPull } from '../src/reputation.js';
import { draftFrom, quarterOf, nextQuarter, quarterMonths } from '../src/quarterly.js';
import { runTick } from '../src/autoscan.js';
import { PLANS } from '../src/plans.js';
import { d1, r2 } from './shims.mjs';

function setup(extra = {}) {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', ...extra };
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
  return { env, call, cookie: () => cookie, setCookie: (c) => { cookie = c; } };
}
const DAY = 86400e3;
async function start(t, extra = {}) {
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  return (await t.call('POST', '/api/clients', { name: 'Sunrise Roofing', plan: 'leader', phone: '(954) 555-0142', lat: 26.0112, lng: -80.1495, cid: 'demo-target', keywords: 'roof repair, roofer', cities: 'Hollywood, Davie', services: 'Roof repair, Tile roofs', address: '2600 Hollywood Blvd, Hollywood, FL 33020', category: 'Roofing contractor', ...extra })).data.client;
}

test('review analysis: months, pace, reply rate, unanswered and themes', () => {
  const at = Date.UTC(2026, 10, 20);
  const reviews = [
    { rating: 5, text: 'Showed up on time, fair price, great job.', at: at - 2 * DAY, reply: true },
    { rating: 5, text: 'Very professional and friendly. Highly recommend.', at: at - 10 * DAY, reply: false },
    { rating: 1, text: 'They were late and never called back.', at: at - 15 * DAY, reply: false },
    { rating: 4, text: 'Good quality work.', at: at - 40 * DAY, reply: true },
    { rating: 2, text: 'Too expensive for what we got.', at: at - 70 * DAY, reply: true },
    { rating: 5, text: 'Old review', at: at - 150 * DAY, reply: false },
  ];
  const a = analyzeReviews(reviews, at);
  assert.equal(a.pulled, 6);
  assert.equal(a.months.length, 6);
  assert.equal(a.months[5].n, 3, 'three this month');
  assert.equal(a.last90, 5);
  assert.equal(a.perMonth, 1.7);
  assert.equal(a.replyRate, 50);
  assert.equal(a.unansweredCount, 1);
  assert.match(a.unanswered[0].text, /late/);
  const t = Object.fromEntries(a.themes.map((x) => [x.label, x]));
  assert.equal(t['Late or slow'].neg, 1);
  assert.equal(t['Price and value'].pos, 1);
  assert.equal(t['Price and value'].neg, 1);
  assert.ok(t['Would recommend'].pos >= 1);
  const pace = reviewPace([
    { at: at - 60 * DAY, reviews: 40, rating: 4.6, competitors: [{ key: 'a', title: 'Harborline', reviews: 200 }] },
    { at, reviews: 52, rating: 4.7, competitors: [{ key: 'a', title: 'Harborline', reviews: 212, rating: 4.9 }] },
  ]);
  assert.equal(pace.mine.perMonth, 6);
  assert.equal(pace.competitors[0].perMonth, 6);
  const slim = slimReviews([{ type: 'google_reviews_search', rating: { value: 5 }, review_text: 'Great', timestamp: '2026-10-01 14:00:00 +00:00', owner_answer: 'Thanks!' }, { type: 'google_reviews_search', rating: { value: 3 } }]);
  assert.deepEqual(slim, [{ rating: 5, text: 'Great', at: Date.UTC(2026, 9, 1, 14), reply: true, name: null, url: null }]);
});

test('quarter helpers and the plan draft', () => {
  assert.equal(quarterOf(new Date(Date.UTC(2026, 10, 2))), '2026-Q4');
  assert.equal(nextQuarter('2026-Q4'), '2027-Q1');
  assert.deepEqual(quarterMonths('2027-Q1').map((m) => m.label), ['January', 'February', 'March']);
  const d = draftFrom({
    keywords: [{ keyword: 'roof repair', top10Pct: 18, avgRank: 12.4 }, { keyword: 'roofer', top10Pct: 40 }],
    reviews: { count: 52, gap: 160, replyRate: 60, unanswered: 4 }, leader: { title: 'Harborline', reviews: 212 },
    calls: { total: 30, missed: 6 }, site: { score: 61, issues: [{ severity: 'high', title: 'Site is not on https' }, { severity: 'medium', title: 'Thin pages' }] },
    citations: { mismatch: 2, missing: 5 }, ideas: [{ title: 'Roof repair in Davie' }, { title: 'Tile roofs in Hollywood' }, { title: 'Roofer in Miramar' }],
    plan: PLANS.leader, months: quarterMonths('2027-Q1'),
  });
  assert.equal(d.goals[0].target, '33%');
  assert.ok(d.goals.some((g) => g.label === 'Google reviews' && g.target === String(52 + 27 * 3)));
  assert.ok(d.goals.some((g) => g.label === 'Website health score' && g.target === '90'));
  assert.match(d.focus[0], /roof repair/);
  assert.ok(d.focus.some((f) => /Harborline/.test(f)));
  assert.ok(d.focus.some((f) => /https/.test(f)));
  assert.equal(d.months.length, 3);
  assert.ok(d.months[0].items.some((i) => /New pages: Roof repair in Davie/.test(i)));
  assert.ok(d.months[0].items.some((i) => /Website fix: Site is not on https/.test(i)));
  assert.ok(!/[–—]/.test(JSON.stringify(d)));
});

test('locations: added under the main business, no plan tasks, left out of revenue, rolled up with their own scans', async () => {
  const t = setup();
  const c = await start(t);
  let r = await t.call('POST', `/api/clients/${c.id}/locations`, { name: 'Sunrise Roofing Davie', address: '1 Main St, Davie, FL 33314' });
  assert.equal(r.status, 200);
  const loc = r.data.client;
  assert.equal(loc.parent_id, c.id);
  await run(t.env, 'UPDATE clients SET lat = 26.06, lng = -80.23, cid = ? WHERE id = ?', 'demo-target', loc.id);
  assert.equal((await t.call('POST', `/api/clients/${loc.id}/locations`, { name: 'x' })).status, 400, 'no locations under a location');
  r = await t.call('POST', `/api/clients/${loc.id}/tasks/generate`, {});
  assert.equal(r.data.created, 0);
  assert.equal(r.data.location, true);
  r = await t.call('GET', '/api/dashboard');
  assert.equal(r.data.clients.active, 1, 'the location is not a second paying client');
  r = await t.call('GET', `/api/clients/${loc.id}`);
  assert.equal(r.data.client.parent.name, 'Sunrise Roofing');
  // scans for both, then the roll-up
  for (const id of [c.id, loc.id]) await t.call('POST', `/api/clients/${id}/autoscan`, { keywords: ['roof repair'] });
  for (let i = 0; i < 4; i++) await runTick(t.env);
  r = await t.call('GET', `/api/clients/${c.id}/locations`);
  const roll = r.data.rollup;
  assert.equal(roll.locations.length, 2);
  assert.ok(roll.locations[0].isMain);
  assert.ok(roll.locations.every((l) => l.top10Avg != null));
  assert.equal(roll.totals.count, 2);
  r = await t.call('GET', `/api/clients/${loc.id}/locations`);
  assert.equal(r.data.isLocation, true);
});

test('reputation: demo pull, report section, live dashboard, quarterly plan shared to the client', async () => {
  const t = setup();
  const c = await start(t);
  await t.call('POST', `/api/clients/${c.id}/autoscan`, { keywords: ['roof repair'] });
  for (let i = 0; i < 3; i++) await runTick(t.env);
  let r = await t.call('POST', `/api/clients/${c.id}/reputation/pull`);
  assert.equal(r.data.waiting, false);
  r = await t.call('GET', `/api/clients/${c.id}/reputation`);
  assert.ok(r.data.analysis.pulled > 30);
  assert.ok(r.data.analysis.themes.length > 3);
  assert.equal(r.data.pull.demo, true);
  assert.ok(r.data.pace.mine);
  // monthly report has a reputation section
  const rep = await t.call('POST', `/api/clients/${c.id}/reports`, {});
  const data = JSON.parse((await first(t.env, 'SELECT data FROM reports WHERE id = ?', rep.data.report.id)).data);
  assert.ok(data.reputation && data.reputation.themes.length);
  // live dashboard
  r = await t.call('GET', `/api/clients/${c.id}/live`);
  assert.equal(r.data.keywords[0].keyword, 'roof repair');
  assert.ok(r.data.reviews.replyRate != null);
  assert.ok(r.data.work.recent.length);
  // quarterly plan
  await run(t.env, "INSERT INTO tasks (id, client_id, month, kind, title, status, created_at) VALUES ('tq', ?, strftime('%Y-%m','now'), 'planning', 'Quarterly planning session', 'todo', 1)", c.id);
  r = await t.call('POST', `/api/clients/${c.id}/quarterly`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const plan = r.data.plan;
  assert.ok(plan.data.goals.length >= 2);
  assert.equal(plan.data.months.length, 3);
  r = await t.call('PUT', `/api/quarterly/${plan.id}`, { goals: [{ label: 'Reviews', now: '58', target: '90' }], focus: ['Win Davie — fast'], months: [{ items: ['One', ''] }, { items: [] }, { items: ['Three'] }], notes: 'See you soon' });
  assert.deepEqual(r.data.plan.data.goals, [{ label: 'Reviews', now: '58', target: '90' }]);
  assert.equal(r.data.plan.data.focus[0], 'Win Davie ,  fast');
  assert.deepEqual(r.data.plan.data.months[0].items, ['One']);
  r = await t.call('POST', `/api/quarterly/${plan.id}/share`);
  assert.equal(r.data.plan.status, 'shared');
  assert.equal((await first(t.env, "SELECT status FROM tasks WHERE id = 'tq'")).status, 'done');
  const tok = plan.url.split('#')[1];
  // client sees the shared plan and the dashboard, not drafts or staff tools
  const inv = await t.call('POST', `/api/clients/${c.id}/invite`, { email: 'maria@sunrise.example', name: 'Maria' });
  t.setCookie('');
  r = await t.call('GET', `/api/public/plan/${tok}`);
  assert.equal(r.data.client.name, 'Sunrise Roofing');
  assert.equal(r.data.data.notes, 'See you soon');
  await t.call('POST', '/api/auth/invite/accept', { token: inv.data.inviteUrl.split('/').pop(), password: 'correct horse battery' });
  r = await t.call('GET', `/api/clients/${c.id}/live`);
  assert.equal(r.data.plans.length, 1);
  r = await t.call('GET', `/api/clients/${c.id}/quarterly`);
  assert.equal(r.data.plans.length, 1);
  assert.equal((await t.call('POST', `/api/clients/${c.id}/quarterly`, {})).status, 403);
  assert.equal((await t.call('POST', `/api/clients/${c.id}/reputation/pull`)).status, 403);
});

test('reputation pull with DataForSEO: queued, then collected when ready', async () => {
  const t = setup({ DATAFORSEO_LOGIN: 'x', DATAFORSEO_PASSWORD: 'y' });
  const c = await start(t);
  const real = globalThis.fetch;
  let ready = false;
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = String(u);
    if (url.includes('/business_data/google/reviews/task_post')) { seen.push(JSON.parse(init.body)[0]); return Response.json({ status_code: 20000, tasks: [{ id: 'task-1', status_code: 20100, cost: 0.003 }] }); }
    if (url.includes('/business_data/google/reviews/task_get/task-1')) {
      if (!ready) return Response.json({ status_code: 20000, tasks: [{ id: 'task-1', status_code: 40602, status_message: 'Task In Queue.' }] });
      return Response.json({ status_code: 20000, tasks: [{ id: 'task-1', status_code: 20000, cost: 0.01, result: [{ rating: { value: 4.7 }, reviews_count: 61, items: [
        { type: 'google_reviews_search', rating: { value: 5 }, review_text: 'On time and fair price', timestamp: new Date(Date.now() - 3 * DAY).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' +00:00'), owner_answer: 'Thank you' },
        { type: 'google_reviews_search', rating: { value: 1 }, review_text: 'Rude and late', timestamp: new Date(Date.now() - 9 * DAY).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' +00:00') },
      ] }] }] });
    }
    return real(u, init);
  };
  try {
    let r = await t.call('POST', `/api/clients/${c.id}/reputation/pull`);
    assert.equal(r.data.waiting, true);
    assert.equal(seen[0].cid, undefined, 'demo ids are not sent');
    assert.equal(seen[0].keyword, 'Sunrise Roofing');
    assert.equal(seen[0].sort_by, 'newest');
    const pull = await first(t.env, 'SELECT * FROM review_pulls');
    assert.equal(await collectPull(t.env, pull), false, 'still in the queue');
    ready = true;
    assert.equal(await collectPull(t.env, pull), true);
    r = await t.call('GET', `/api/clients/${c.id}/reputation`);
    assert.equal(r.data.pull.rating, 4.7);
    assert.equal(r.data.pull.total, 61);
    assert.equal(r.data.analysis.replyRate, 50);
    assert.equal(r.data.analysis.unansweredCount, 1);
  } finally { globalThis.fetch = real; }
});
