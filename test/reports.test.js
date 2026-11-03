import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, run, first, all } from '../src/db.js';
import { runTick } from '../src/autoscan.js';
import { reportEmail, buildReport } from '../src/reports.js';
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
  return { env, call, logout: () => { cookie = ''; } };
}
async function start(t) {
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const r = await t.call('POST', '/api/clients', { name: 'Demo Roofing', plan: 'growth', lat: 26.0112, lng: -80.1495, cid: 'demo-target', keywords: 'roof repair, roofer', contact_email: 'owner@demoroofing.com', contact_name: 'Maria Lopez' });
  return r.data.client;
}
async function scanAt(t, c, at) {
  await t.call('POST', `/api/clients/${c.id}/autoscan`, {});
  for (let i = 0; i < 5; i++) await runTick(t.env, { at });
}
const OCT = Date.UTC(2026, 9, 5), NOV = Date.UTC(2026, 10, 5);

test('reports: made when monthly scans finish, compare with the scan before, send marks the report task done', async () => {
  const t = setup();
  const c = await start(t);
  await run(t.env, "INSERT INTO tasks (id, client_id, month, kind, title, status, created_at) VALUES ('t1', ?, '2026-11', 'report', 'Monthly ranking report', 'todo', 1), ('t2', ?, '2026-11', 'post', 'Google profile post', 'done', 1)", c.id, c.id);
  await scanAt(t, c, OCT);
  await scanAt(t, c, NOV);
  let r = await t.call('GET', `/api/clients/${c.id}/reports`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.reports.map((x) => x.month), ['2026-11', '2026-10']);
  assert.ok(r.data.reports.every((x) => x.status === 'draft'));
  const nov = await first(t.env, "SELECT * FROM reports WHERE month = '2026-11'");
  const d = JSON.parse(nov.data);
  assert.equal(d.monthLabel, 'November 2026');
  assert.deepEqual(d.keywords.map((k) => k.keyword), ['roof repair', 'roofer']);
  assert.equal(d.keywords[0].now.ranks.length, 49);
  assert.ok(d.keywords[0].before, 'compares with October');
  assert.ok(d.keywords[0].start.ranks, 'where they started has ranks for the map');
  assert.equal(d.work.done, 1);
  assert.ok(d.leaders.some((l) => l.isTarget));
  assert.ok(d.next.length > 0);
  const oct = JSON.parse((await first(t.env, "SELECT data FROM reports WHERE month = '2026-10'")).data);
  assert.equal(oct.keywords[0].before, null, 'October scans do not see November');
  // note, public page, send by hand when email is not set up
  r = await t.call('PATCH', `/api/reports/${nov.id}`, { note: 'Great month. Next we add 2 service pages.' });
  assert.equal(r.data.report.note, 'Great month. Next we add 2 service pages.');
  r = await t.call('POST', `/api/reports/${nov.id}/send`, { to: 'owner@demoroofing.com' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Email is not set up/);
  r = await t.call('POST', `/api/reports/${nov.id}/send`, { manual: true });
  assert.equal(r.data.ok, true);
  assert.equal((await first(t.env, "SELECT status FROM tasks WHERE id = 't1'")).status, 'done');
  assert.equal((await first(t.env, 'SELECT status FROM reports WHERE id = ?', nov.id)).status, 'sent');
  assert.ok((await all(t.env, 'SELECT text FROM log WHERE client_id = ?', c.id)).some((l) => /November 2026 report sent/.test(l.text)));
  // a sent report is not rewritten by later scans
  const before = (await first(t.env, 'SELECT data FROM reports WHERE id = ?', nov.id)).data;
  await scanAt(t, c, NOV + 86400e3);
  assert.equal((await first(t.env, 'SELECT data FROM reports WHERE id = ?', nov.id)).data, before);
  t.logout();
  r = await t.call('GET', `/api/public/report/${nov.token}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.report.client.name, 'Demo Roofing');
  assert.equal(r.data.note, 'Great month. Next we add 2 service pages.');
  assert.equal((await first(t.env, 'SELECT views FROM reports WHERE id = ?', nov.id)).views, 1);
  assert.equal((await t.call('GET', '/api/public/report/nope-not-a-token')).status, 404);
  assert.ok([401, 403].includes((await t.call('GET', `/api/clients/${c.id}/reports`)).status));
});

test('reports: email goes out through Resend with the private link, and automatic sending works when the owner turns it on', async () => {
  const t = setup({ RESEND_API_KEY: 're_test', EMAIL_FROM: 'Rightway Growth <hello@rightwaygrowth.com>' });
  const c = await start(t);
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init) => { if (String(u).includes('api.resend.com')) { sent.push(JSON.parse(init.body)); return Response.json({ id: 'em_1' }); } return real(u, init); };
  try {
    await scanAt(t, c, NOV);
    const rep = await first(t.env, 'SELECT * FROM reports');
    let r = await t.call('POST', `/api/reports/${rep.id}/send`, { to: 'owner@demoroofing.com' });
    assert.equal(r.data.emailed, true);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['owner@demoroofing.com']);
    assert.match(sent[0].subject, /November 2026/);
    assert.ok(sent[0].html.includes(`https://hub.test/report.html#${rep.token}`));
    assert.ok(sent[0].text.includes('roof repair'));
    // automatic: on, then a new month's scans finish and the report goes out by itself
    await t.call('PUT', '/api/autoscan', { autoSend: true });
    await scanAt(t, c, Date.UTC(2026, 11, 5));
    assert.equal(sent.length, 2);
    assert.match(sent[1].subject, /December 2026/);
    assert.equal((await first(t.env, "SELECT status FROM reports WHERE month = '2026-12'")).status, 'sent');
  } finally { globalThis.fetch = real; }
});

test('report email escapes names and has no dashes in copy', async () => {
  const d = { monthLabel: 'November 2026', client: { name: 'Bob <script>' }, keywords: [{ keyword: 'a&b', now: { top3Pct: 20, top10Pct: 20, centerRank: 3 }, before: { top3Pct: 10, top10Pct: 10 } }], reviews: { count: 12, rating: 4.8 }, work: { done: 3 }, posts: 2 };
  const m = reportEmail(d, 'https://x.test/report.html#t', 'Note <b>');
  assert.ok(!m.html.includes('<script>'));
  assert.ok(m.html.includes('a&amp;b'));
  assert.ok(!/[–—]/.test(m.html + m.text + m.subject));
  assert.match(m.text, /up from 10%/);
});

test('a client with no scans still gets a report of the work done', async () => {
  const t = setup();
  const c = await start(t);
  const d = await buildReport(t.env, c, '2026-11');
  assert.deepEqual(d.keywords, []);
  assert.equal(d.reviews.count, null);
  const r = await t.call('POST', `/api/clients/${c.id}/reports`, { month: '2026-11' });
  assert.equal(r.status, 200);
  assert.equal((await t.call('POST', `/api/clients/${c.id}/reports`, { month: '2026-13' })).status, 400);
});
