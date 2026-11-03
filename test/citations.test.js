import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, run, first, all } from '../src/db.js';
import { judgeListing, prospectQueries, SITES } from '../src/citations.js';
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
const CLIENT = { name: 'Sunrise Roofing LLC', plan: 'growth', phone: '(954) 555-0142', address: '2600 Hollywood Blvd, Hollywood, FL 33020', category: 'Roofing contractor', cities: 'Hollywood, Davie', services: 'Roof repair', website: 'https://sunriseroofing.example' };
async function start(t) {
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  return (await t.call('POST', '/api/clients', CLIENT)).data.client;
}

test('listing judge: match, different phone, listed without details, and not listed', () => {
  const r = (title, snippet, url = 'https://www.yelp.com/biz/sunrise-roofing-hollywood') => [{ title, snippet, url }];
  assert.equal(judgeListing(r('Sunrise Roofing - Hollywood, FL', 'Call (954) 555-0142 today.'), CLIENT).status, 'match');
  assert.equal(judgeListing(r('Sunrise Roofing', '2600 Hollywood Blvd, Hollywood, FL 33020'), CLIENT).status, 'match');
  const bad = judgeListing(r('Sunrise Roofing', 'Phone: 954-555-9999. Hollywood FL 33021'), CLIENT);
  assert.equal(bad.status, 'mismatch');
  assert.match(bad.notes.join(' '), /\(954\) 555-9999/);
  assert.match(bad.notes.join(' '), /33021/);
  assert.equal(judgeListing(r('Sunrise Roofing reviews', 'See photos and reviews.'), CLIENT).status, 'found');
  assert.equal(judgeListing(r('Bluewater Roof Co', 'Call (954) 555-0142', 'https://www.yelp.com/biz/bluewater'), CLIENT).status, 'missing', 'a different business is not a listing');
  assert.equal(judgeListing([], CLIENT).status, 'missing');
  assert.ok(SITES.Yelp && SITES['Better Business Bureau']);
  assert.equal(prospectQueries(CLIENT)[0][0], 'Hollywood chamber of commerce');
  assert.deepEqual(prospectQueries({ name: 'X' }), []);
});

test('citations: directory check, log with the monthly quota, prospects, and the link check', async () => {
  const t = setup();
  const c = await start(t);
  await run(t.env, "INSERT INTO tasks (id, client_id, month, kind, title, status, created_at) VALUES ('l1', ?, strftime('%Y-%m','now'), 'link', 'Local link or citation', 'todo', 1), ('l2', ?, strftime('%Y-%m','now'), 'link', 'Local link or citation', 'todo', 2)", c.id, c.id);
  let r = await t.call('POST', `/api/clients/${c.id}/citations/audit`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const total = Object.values(r.data.counts).reduce((a, b) => a + b, 0);
  assert.ok(total >= 15, `checked ${total}`);
  r = await t.call('GET', `/api/clients/${c.id}/citations`);
  const checked = r.data.directories.filter((d) => d.audit);
  assert.equal(checked.length, total);
  assert.ok(checked.some((d) => d.audit.status === 'missing') && checked.some((d) => d.audit.status !== 'missing'));
  assert.ok(r.data.directories.some((d) => d.name === 'Apple Business Connect' && !d.audit), 'Apple cannot be searched, so it is not checked');
  assert.equal(r.data.quota.total, 2);
  // log a citation built, then a link earned
  r = await t.call('POST', `/api/clients/${c.id}/links`, { type: 'citation', name: 'Manta', url: 'https://www.manta.com/c/sunrise', status: 'submitted', cost: '3.20' });
  assert.equal(r.data.item.cost, 320);
  assert.equal(r.data.task, null);
  r = await t.call('PATCH', `/api/links/${r.data.item.id}`, { status: 'live' });
  assert.equal(r.data.task, 'l1');
  r = await t.call('POST', `/api/clients/${c.id}/links`, { type: 'link', name: 'Hollywood Chamber member page', url: 'https://hollywoodchamber.example/members', kind: 'Chamber', status: 'live' });
  assert.equal(r.data.task, 'l2');
  assert.equal((await t.call('POST', `/api/clients/${c.id}/links`, { name: 'X', url: 'ftp://x' })).status, 400);
  r = await t.call('GET', `/api/clients/${c.id}/citations`);
  assert.equal(r.data.quota.done, 2);
  // prospects
  r = await t.call('POST', `/api/clients/${c.id}/links/prospects`);
  assert.ok(r.data.added >= 6);
  const again = await t.call('POST', `/api/clients/${c.id}/links/prospects`);
  assert.equal(again.data.added, 0, 'no duplicates');
  const pros = await all(t.env, "SELECT * FROM link_log WHERE status = 'prospect'");
  assert.ok(pros.every((p) => /Found by searching/.test(p.note)));
  // link check: chamber page still links, Manta listing is gone
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    if (url.startsWith('https://hollywoodchamber.example')) return new Response('<a href="https://sunriseroofing.example/">Sunrise</a>', { headers: { 'content-type': 'text/html' } });
    if (url.startsWith('https://www.manta.com')) return new Response('Not found', { status: 404 });
    return real(u, init);
  };
  try {
    r = await t.call('POST', `/api/clients/${c.id}/links/check`);
    assert.deepEqual([r.data.checked, r.data.ok, r.data.lost], [2, 1, 1]);
  } finally { globalThis.fetch = real; }
  const rows = await all(t.env, "SELECT name, status, check_result FROM link_log WHERE status IN ('live','lost') ORDER BY name");
  assert.deepEqual(rows.map((x) => [x.name, x.status, x.check_result]), [['Hollywood Chamber member page', 'live', 'ok'], ['Manta', 'lost', 'gone']]);
  // the report for this month lists what went live
  const rep = await t.call('POST', `/api/clients/${c.id}/reports`, {});
  const data = JSON.parse((await first(t.env, 'SELECT data FROM reports WHERE id = ?', rep.data.report.id)).data);
  assert.deepEqual(data.links.links, ['Hollywood Chamber member page']);
  // clients see only live entries and listed directories
  const inv = await t.call('POST', `/api/clients/${c.id}/invite`, { email: 'maria@sunrise.example', name: 'Maria' });
  t.setCookie('');
  await t.call('POST', '/api/auth/invite/accept', { token: inv.data.inviteUrl.split('/').pop(), password: 'correct horse battery' });
  r = await t.call('GET', `/api/clients/${c.id}/citations`);
  assert.ok(r.data.log.every((x) => x.status === 'live'));
  assert.ok(r.data.directories.every((d) => d.audit === undefined && 'listed' in d));
  assert.equal((await t.call('POST', `/api/clients/${c.id}/citations/audit`)).status, 403);
});
