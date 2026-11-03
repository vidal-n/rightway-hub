import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, run, first, all } from '../src/db.js';
import { parsePage, findIssues, buildSchema, schemaType, auditTick, normUrl, scoreOf } from '../src/siteaudit.js';
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
  return { env, call };
}
const words = (n) => 'roof repair work done right in Hollywood '.repeat(Math.ceil(n / 7));
const page = ({ title = '', desc = '', h1 = '', body = '', extra = '' }) => `<!doctype html><html><head>${title ? `<title>${title}</title>` : ''}${desc ? `<meta name="description" content="${desc}">` : ''}
  <meta name="viewport" content="width=device-width">${extra}</head><body>${h1 ? `<h1>${h1}</h1>` : ''}${body}</body></html>`;
const SITE = {
  'https://sunrise.example/': page({ title: 'Sunrise Roofing', desc: 'Roofers.', h1: 'Sunrise Roofing', body: `<a href="tel:9545550142">(954) 555-0142</a> <a href="/roof-repair">Repair</a> <a href="/about/">About</a> <a href="/old-page">Old</a> <a href="https://facebook.com/x">FB</a> <img src="/a.jpg">${words(400)}` }),
  'https://sunrise.example/roof-repair': page({ title: 'Roof Repair in Hollywood FL | Sunrise Roofing', desc: 'Roof repair in Hollywood.', h1: 'Roof repair', body: `<h1>Second</h1>${words(500)}<a href="/">Home</a>` }),
  'https://sunrise.example/about': page({ title: 'Sunrise Roofing', desc: 'Roofers.', h1: 'About', body: 'Short page.', extra: '<meta name="robots" content="noindex">' }),
  'https://sunrise.example/robots.txt': 'User-agent: *\nAllow: /\nSitemap: https://sunrise.example/sitemap.xml',
  'https://sunrise.example/sitemap.xml': '<?xml version="1.0"?><urlset><url><loc>https://sunrise.example/</loc></url><url><loc>https://sunrise.example/roof-repair</loc></url></urlset>',
};
function fakeSite() {
  const hits = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    if (url.startsWith('http://sunrise.example')) { hits.push(url); const r = new Response(SITE['https://sunrise.example/'], { headers: { 'content-type': 'text/html' } }); Object.defineProperty(r, 'url', { value: 'https://sunrise.example/' }); return r; }
    if (!url.startsWith('https://sunrise.example')) return real(u, init);
    hits.push(url);
    const body = SITE[url];
    if (body == null) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(body, { headers: { 'content-type': /\.txt$/.test(url) ? 'text/plain' : /\.xml$/.test(url) ? 'application/xml' : 'text/html' } });
  };
  return { hits, restore: () => { globalThis.fetch = real; } };
}

test('page parser reads titles, headings, words, links, schema and the phone', () => {
  const p = parsePage(page({ title: 'A &amp; B', desc: 'D', h1: 'H', body: '<h1>Two</h1><img src=x alt="ok"><img src=y> <a href="/x?utm_source=a#top">x</a> <script type="application/ld+json">{"@graph":[{"@type":"RoofingContractor"}]}</script> call 954-555-0142' }), 'https://s.example/', { phone: '(954) 555-0142' });
  assert.equal(p.title, 'A & B');
  assert.equal(p.h1Count, 2);
  assert.equal(p.noAlt, 1);
  assert.deepEqual(p.links, ['https://s.example/x']);
  assert.deepEqual(p.schema, ['RoofingContractor']);
  assert.equal(p.phoneOnPage, true);
  assert.equal(normUrl('/a/', 'https://s.example/b'), 'https://s.example/a');
  assert.equal(normUrl('mailto:x@y.z', 'https://s.example/'), null);
});

test('schema builder makes LocalBusiness JSON-LD from the profile', () => {
  const s = buildSchema({ name: 'Sunrise Roofing', category: 'Roofing contractor', phone: '(954) 555-0142', website: 'sunrise.example', address: '2600 Hollywood Blvd, Hollywood, FL 33020', lat: 26.01, lng: -80.14, services: 'Roof repair, Tile roofs', cities: 'Hollywood, Davie', cid: '123456' });
  assert.equal(s.json['@type'], 'RoofingContractor');
  assert.equal(s.json.address.addressLocality, 'Hollywood');
  assert.equal(s.json.address.addressRegion, 'FL');
  assert.equal(s.json.address.postalCode, '33020');
  assert.equal(s.json.url, 'https://sunrise.example');
  assert.equal(s.json.areaServed.length, 2);
  assert.equal(s.json.hasOfferCatalog.itemListElement[1].itemOffered.name, 'Tile roofs');
  assert.deepEqual(s.json.sameAs, ['https://maps.google.com/?cid=123456']);
  assert.ok(s.html.startsWith('<script type="application/ld+json">'));
  assert.deepEqual(s.missing, []);
  assert.equal(schemaType('Mexican restaurant'), 'Restaurant');
  assert.equal(schemaType('Notary'), 'LocalBusiness');
  assert.ok(buildSchema({ name: 'X' }).missing.length >= 3);
});

test('crawl: reads the site a few pages per run, lists issues, logs a fix and the next crawl verifies it', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const c = (await t.call('POST', '/api/clients', { name: 'Sunrise Roofing', plan: 'growth', phone: '(954) 555-0142', website: 'https://sunrise.example', cities: 'Hollywood, Davie', services: 'Roof repair', category: 'Roofing contractor', address: '1 Main St, Hollywood, FL 33020' })).data.client;
  await run(t.env, "INSERT INTO tasks (id, client_id, month, kind, title, status, created_at) VALUES ('to', ?, strftime('%Y-%m','now'), 'onpage', 'On-page fix on the website', 'todo', 1)", c.id);
  const site = fakeSite();
  try {
    let r = await t.call('POST', `/api/clients/${c.id}/site/audit`);
    assert.equal(r.status, 200);
    let used = await auditTick(t.env, { budget: 6 });
    assert.ok(used <= 8);
    let row = await first(t.env, 'SELECT * FROM site_audits');
    assert.equal(row.status, 'running');
    for (let i = 0; i < 5 && row.status !== 'done'; i++) { await auditTick(t.env, { budget: 6 }); row = await first(t.env, 'SELECT * FROM site_audits'); }
    assert.equal(row.status, 'done', row.error);
    r = await t.call('GET', `/api/clients/${c.id}/site`);
    const a = r.data.audit;
    assert.equal(a.pages.length, 4, JSON.stringify(a.pages.map((p) => p.url)));
    const keys = a.issues.map((i) => i.key);
    for (const k of ['broken', 'title-dupe', 'h1-many', 'alt', 'noindex', 'schema', 'home-city']) assert.ok(keys.includes(k), `missing ${k}: ${keys}`);
    assert.ok(!keys.includes('https') && !keys.includes('http-redirect') && !keys.includes('sitemap') && !keys.includes('tel') && !keys.includes('nap-phone'));
    assert.ok(!keys.includes('thin'), 'the only short page is hidden from Google, so it is not flagged as thin');
    assert.equal(a.issues[0].severity, 'high');
    assert.ok(a.score < 100 && a.score >= 0);
    assert.equal(r.data.schema.json['@type'], 'RoofingContractor');
    // log a fix for the home page title; it checks off the on-page task
    const homeCity = a.issues.find((i) => i.key === 'home-city');
    r = await t.call('POST', `/api/clients/${c.id}/site/fixes`, { key: 'home-city', page: homeCity.pages[0].url, what: 'Home page title now mentions Hollywood', before: 'Sunrise Roofing', after: 'Roof Repair in Hollywood, FL | Sunrise Roofing' });
    assert.equal(r.data.task, 'to');
    assert.equal((await first(t.env, "SELECT status FROM tasks WHERE id = 'to'")).status, 'done');
    // the site gets fixed, the next crawl verifies it
    SITE['https://sunrise.example/'] = SITE['https://sunrise.example/'].replace('<title>Sunrise Roofing</title>', '<title>Roof Repair in Hollywood, FL | Sunrise Roofing</title>');
    await t.call('POST', `/api/clients/${c.id}/site/audit`);
    for (let i = 0; i < 6; i++) await auditTick(t.env, { budget: 10 });
    r = await t.call('GET', `/api/clients/${c.id}/site`);
    assert.equal(r.data.fixes[0].status, 'verified');
    assert.ok(!r.data.audit.issues.some((i) => i.key === 'home-city'));
    assert.ok(r.data.previous);
  } finally { site.restore(); }
});

test('issues for an insecure, unreadable site and the score', () => {
  const issues = findIssues({ https: false, sitemap: false, robotsBlocksAll: true, pages: [{ url: 'http://x.example/', status: 200, home: true, title: '', h1Count: 0, words: 50, noAlt: 0, schema: [], tel: false, viewport: false, phoneOnPage: false, noindex: false }] }, { phone: '1' });
  const keys = issues.map((i) => i.key);
  for (const k of ['https', 'robots', 'viewport', 'title-missing', 'nap-phone', 'sitemap', 'tel', 'h1-missing']) assert.ok(keys.includes(k), k);
  assert.equal(scoreOf([]), 100);
  assert.ok(scoreOf(issues) < 40);
  assert.ok(!/[–—]/.test(JSON.stringify(issues)));
});

test('a site that does not answer fails the crawl with a plain reason', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const c = (await t.call('POST', '/api/clients', { name: 'Gone', plan: 'starter', website: 'gone.example' })).data.client;
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init) => (String(u).includes('gone.example') ? Promise.reject(new TypeError('fetch failed')) : real(u, init));
  try {
    await t.call('POST', `/api/clients/${c.id}/site/audit`);
    await auditTick(t.env);
    const row = await first(t.env, 'SELECT * FROM site_audits');
    assert.equal(row.status, 'failed');
    assert.match(row.error, /did not respond/);
    const noSite = (await t.call('POST', '/api/clients', { name: 'NoSite', plan: 'starter' })).data.client;
    assert.equal((await t.call('POST', `/api/clients/${noSite.id}/site/audit`)).status, 400);
  } finally { globalThis.fetch = real; }
});
