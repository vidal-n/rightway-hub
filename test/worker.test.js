import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { rankAtPoint, searchBusinesses, slim } from '../src/dataforseo.js';

const post = (path, body, headers = {}) =>
  new Request(`http://x${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('health reports demo mode without credentials', async () => {
  const res = await worker.fetch(new Request('http://x/api/health'), {});
  const h = await res.json();
  assert.equal(h.ok, true);
  assert.equal(h.demo, true);
  assert.equal(h.keyRequired, false);
  assert.deepEqual(h.secrets, { DATAFORSEO_LOGIN: false, DATAFORSEO_PASSWORD: false, ACCESS_KEY: false });
});

test('demo search and grid point work end to end', async () => {
  const s = await (await worker.fetch(post('/api/business-search', { name: 'Test Roofing', location: 'Hollywood, FL' }), {})).json();
  assert.equal(s.demo, true);
  const t = s.results[0];
  assert.equal(t.title, 'Test Roofing');
  const g = await (await worker.fetch(post('/api/grid-point', { keyword: 'roofer', lat: t.lat, lng: t.lng, zoom: 13, cid: t.cid }), {})).json();
  assert.ok(g.rank === null || (g.rank >= 1 && g.rank <= 20));
  assert.equal(g.top.length, 20);
});

test('real mode refuses to run without ACCESS_KEY', async () => {
  const env = { DATAFORSEO_LOGIN: 'l', DATAFORSEO_PASSWORD: 'p' };
  const res = await worker.fetch(post('/api/business-search', { name: 'a', location: 'b' }), env);
  assert.equal(res.status, 503);
});

test('wrong access key is rejected', async () => {
  const env = { DATAFORSEO_LOGIN: 'l', DATAFORSEO_PASSWORD: 'p', ACCESS_KEY: 'secret' };
  const res = await worker.fetch(post('/api/business-search', { name: 'a', location: 'b' }, { 'x-access-key': 'nope' }), env);
  assert.equal(res.status, 401);
});

test('validation errors are 400 with a message', async () => {
  const res = await worker.fetch(post('/api/grid-point', { keyword: 'roofer', lat: 200, lng: 0, cid: 'x' }), {});
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Latitude/);
});

// DataForSEO client against a fake fetch that mimics the documented response shape.
function fakeFetch(items, check) {
  return async (url, init) => {
    check?.(url, init);
    return new Response(JSON.stringify({
      status_code: 20000, status_message: 'Ok.', cost: 0.002,
      tasks: [{ status_code: 20000, status_message: 'Ok.', cost: 0.002, result: [{ items }] }],
    }), { status: 200 });
  };
}
const item = (rank, cid, extra = {}) => ({
  type: 'maps_search', rank_group: rank, rank_absolute: rank, title: `Biz ${cid}`, cid, place_id: `p-${cid}`,
  rating: { rating_type: 'Max5', value: 4.7, votes_count: 100 + rank, rating_max: 5 },
  category: 'Roofing contractor', additional_categories: ['Gutter service'], latitude: 26, longitude: -80,
  is_claimed: true, total_photos: 40, work_hours: { timetable: { monday: [] }, current_status: 'open' }, url: 'https://e.com', domain: 'e.com',
  ...extra,
});

test('rankAtPoint uses Local Finder by default, skips ads, and finds the target by cid', async () => {
  const env = { DATAFORSEO_LOGIN: 'user', DATAFORSEO_PASSWORD: 'pass' };
  let sent;
  const items = [item(1, '111'), { type: 'local_pack', is_paid: true, title: 'Ad', cid: '999' }, item(2, '222'), item(3, '333'), item(4, '444')];
  const out = await rankAtPoint(env, { keyword: 'roofer', lat: 26.0112, lng: -80.1495, zoom: 13, cid: '333', place_id: '', source: 'local', device: 'desktop' },
    fakeFetch(items, (url, init) => { sent = { url, init }; }));
  assert.equal(out.rank, 3);
  assert.equal(out.top.length, 4);
  assert.ok(!out.top.some((t) => t.cid === '999'));
  assert.equal(out.cost, 0.002);
  const body = JSON.parse(sent.init.body);
  assert.equal(body.length, 1);
  assert.equal(body[0].location_coordinate, '26.0112000,-80.1495000');
  assert.equal(body[0].depth, 20);
  assert.equal(sent.init.headers.Authorization, `Basic ${btoa('user:pass')}`);
  assert.match(sent.url, /serp\/google\/local_finder\/live\/advanced$/);
});

test('rankAtPoint can use Google Maps with zoom', async () => {
  const env = { DATAFORSEO_LOGIN: 'u', DATAFORSEO_PASSWORD: 'p' };
  let sent;
  await rankAtPoint(env, { keyword: 'roofer', lat: 1, lng: 2, zoom: 14, cid: 'x', source: 'maps', device: 'mobile' },
    fakeFetch([item(1, 'x')], (url, init) => { sent = { url, init }; }));
  assert.match(sent.url, /maps\/live\/advanced$/);
  const body = JSON.parse(sent.init.body)[0];
  assert.equal(body.location_coordinate, '1.0000000,2.0000000,14z');
  assert.equal(body.device, 'mobile');
});

test('target without matching ids falls back to exact name', async () => {
  const env = { DATAFORSEO_LOGIN: 'u', DATAFORSEO_PASSWORD: 'p' };
  const items = [item(1, 'a'), { type: 'local_pack', title: 'Orale Mexican Restaurant' }];
  const out = await rankAtPoint(env, { keyword: 'k', lat: 1, lng: 1, zoom: 13, cid: 'zz', title: 'Orale Mexican Restaurant', source: 'local' }, fakeFetch(items));
  assert.equal(out.rank, 2);
});

test('rankAtPoint returns null when the target is not in the results', async () => {
  const env = { DATAFORSEO_LOGIN: 'u', DATAFORSEO_PASSWORD: 'p' };
  const out = await rankAtPoint(env, { keyword: 'roofer', lat: 1, lng: 1, zoom: 13, cid: 'zzz', place_id: 'p-zzz' }, fakeFetch([item(1, '1')]));
  assert.equal(out.rank, null);
});

test('searchBusinesses maps fields and DataForSEO errors surface clearly', async () => {
  const env = { DATAFORSEO_LOGIN: 'u', DATAFORSEO_PASSWORD: 'p' };
  const out = await searchBusinesses(env, { name: 'Biz', location: 'Miami, FL' }, fakeFetch([item(1, '9')]));
  assert.equal(out.results[0].reviews, 101);
  assert.equal(out.results[0].hours, true);
  const broke = async () => new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 40200, status_message: 'Payment Required.' }] }), { status: 200 });
  await assert.rejects(searchBusinesses(env, { name: 'Biz', location: 'x' }, broke), /balance is empty/);
});

test('slim handles missing fields', () => {
  const s = slim({ type: 'maps_search', title: 'X' });
  assert.equal(s.rating, null);
  assert.equal(s.reviews, 0);
  assert.equal(s.hours, false);
  assert.deepEqual(s.additional_categories, []);
});

test('build-time secrets fill gaps but runtime secrets win', async () => {
  const { withSecrets } = await import('../src/worker.js');
  const e = withSecrets({ ACCESS_KEY: 'runtime' }, { ACCESS_KEY: 'build', DATAFORSEO_LOGIN: 'l' });
  assert.equal(e.ACCESS_KEY, 'runtime');
  assert.equal(e.DATAFORSEO_LOGIN, 'l');
});

test('check-key accepts the right key and rejects the wrong one', async () => {
  const env = { DATAFORSEO_LOGIN: 'l', DATAFORSEO_PASSWORD: 'p', ACCESS_KEY: 'secret' };
  assert.equal((await worker.fetch(post('/api/check-key', {}, { 'x-access-key': 'secret' }), env)).status, 200);
  assert.equal((await worker.fetch(post('/api/check-key', {}, { 'x-access-key': 'nope' }), env)).status, 401);
  const h = await (await worker.fetch(new Request('http://x/api/health'), env)).json();
  assert.deepEqual(h.fromRuntime, ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD', 'ACCESS_KEY']);
});
