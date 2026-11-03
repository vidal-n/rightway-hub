import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, run, first, all } from '../src/db.js';
import { suggestTopics, buildBrief, parseDraft, templateDraft, wpBase } from '../src/content.js';
import { cleanHtml, wordCount, slugify } from '../public/js/sanitize.js';
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
  return { env, call, setCookie: (c) => { cookie = c; }, getCookie: () => cookie, logout: () => { cookie = ''; } };
}
const CLIENT = { name: 'Sunrise Roofing', plan: 'growth', phone: '(954) 555-0142', website: 'https://sunriseroofing.example', address: '2600 Hollywood Blvd, Hollywood, FL 33020',
  category: 'Roofing contractor', services: 'Roof repair, roof replacement, tile roofs', cities: 'Hollywood, Pembroke Pines, Hallandale Beach', keywords: 'roof repair, roofer' };
async function start(t) {
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  return (await t.call('POST', '/api/clients', CLIENT)).data.client;
}
const LONG = `<h2>Roof repair in Hollywood</h2><p>${'Real words about fixing roofs in Hollywood. '.repeat(20)}</p>`;

test('sanitizer keeps page tags and drops anything risky', () => {
  const dirty = `<h1 class="x">Title</h1><script>alert(1)</script><p onclick="x()">Hi <b>there</b> <a href="javascript:alert(1)">bad</a> <a href="https://ok.com" target=_blank>ok</a> <a href="tel:+19545550142">call</a></p>
    <img src=x onerror=alert(1)><iframe src="https://evil"></iframe><style>p{}</style><div><span>text</span></div> 3 < 5 <svg onload=alert(1)><p>— dash</p>`;
  const c = cleanHtml(dirty);
  assert.ok(!/script|onclick|onerror|iframe|style|javascript|svg|<img|<div|<span/i.test(c), c);
  assert.ok(c.includes('<h2>Title</h2>'));
  assert.ok(c.includes('<strong>there</strong>'));
  assert.ok(c.includes('<a href="https://ok.com">ok</a>'));
  assert.ok(c.includes('<a href="tel:+19545550142">call</a>'));
  assert.ok(c.includes('3 &lt; 5'));
  assert.ok(!/[–—]/.test(c));
  assert.equal(slugify('Roof Repair in Hollywood, FL?'), 'roof-repair-in-hollywood-fl');
  assert.equal(wordCount('<p>one two</p><p>three</p>'), 3);
});

test('ideas come from services, cities and weak rankings, and skip pages already made', () => {
  const scans = new Map([['roof repair', { keyword: 'roof repair', top3Pct: 6 }], ['roofer', { keyword: 'roofer', top3Pct: 70 }]]);
  const ideas = suggestTopics(CLIENT, [{ keyword: 'roof replacement hollywood' }], scans);
  assert.ok(ideas.length >= 6);
  assert.equal(ideas[0].keyword, 'roof repair hollywood');
  assert.match(ideas[0].reason, /6%/);
  assert.ok(!ideas.some((i) => i.keyword === 'roof replacement hollywood'));
  assert.ok(ideas.some((i) => i.kind === 'city' && i.city === 'Pembroke Pines'));
  assert.ok(ideas.some((i) => i.kind === 'article' && /cost/.test(i.keyword)));
  const b = buildBrief(CLIENT, ideas[0], { competitors: ['Harborline Roofing'] });
  assert.equal(b.slug, 'roof-repair-in-hollywood');
  assert.ok(b.metaTitle.length <= 60);
  assert.ok(b.metaDescription.length <= 155);
  assert.ok(b.outline.length >= 5 && b.faqs.length >= 3);
  assert.equal(b.facts.phone, '(954) 555-0142');
  const draft = templateDraft(CLIENT, b);
  assert.equal(draft.ai, false);
  assert.ok(draft.html.includes('<h2>'));
  assert.ok(draft.html.includes('tel:9545550142'));
});

test('a Claude reply is parsed and cleaned', () => {
  const reply = `TITLE: Roof Repair in Hollywood\nMETA_TITLE: Roof Repair in Hollywood | Sunrise\nMETA_DESCRIPTION: Fast roof repair.\nSLUG: roof-repair-hollywood\nHTML:\n\`\`\`html\n${LONG}<script>x</script>\n\`\`\``;
  const d = parseDraft(reply);
  assert.equal(d.title, 'Roof Repair in Hollywood');
  assert.equal(d.slug, 'roof-repair-hollywood');
  assert.ok(!d.html.includes('script') && !d.html.includes('```'));
  assert.throws(() => parseDraft('TITLE: x\nHTML:\n<p>short</p>'), /too short/);
  assert.equal(wpBase('sunriseroofing.example/wp-admin/'), 'https://sunriseroofing.example');
  assert.throws(() => wpBase('http://x.com'), /https/);
});

test('page flow: idea, AI draft, edit, client asks for changes, approves, WordPress publish checks off the page task', async () => {
  const t = setup({ ANTHROPIC_API_KEY: 'sk-test' });
  const c = await start(t);
  await run(t.env, "INSERT INTO tasks (id, client_id, month, kind, title, status, created_at) VALUES ('tp', ?, strftime('%Y-%m','now'), 'page', 'New local service or city page', 'todo', 1)", c.id);
  let r = await t.call('GET', `/api/clients/${c.id}/content/ideas`);
  assert.ok(r.data.ideas.length > 3);
  const idea = r.data.ideas[0];
  r = await t.call('POST', `/api/clients/${c.id}/content`, idea);
  const id = r.data.item.id;
  assert.equal(r.data.item.status, 'idea');
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const url = String(u);
    seen.push({ url, init });
    if (url.includes('api.anthropic.com')) {
      const prompt = JSON.parse(init.body).messages[0].content;
      assert.match(prompt, /Never invent years in business/);
      assert.match(prompt, /\(954\) 555-0142/);
      return Response.json({ content: [{ type: 'text', text: `TITLE: Roof Repair in Hollywood, FL\nMETA_TITLE: Roof Repair Hollywood FL | Sunrise\nMETA_DESCRIPTION: Leaks fixed fast.\nSLUG: roof-repair-hollywood-fl\nHTML:\n${LONG}` }] });
    }
    if (url.startsWith('https://sunriseroofing.example/wp-json/wp/v2/users/me')) {
      assert.match(init.headers.Authorization, /^Basic /);
      assert.equal(atob(init.headers.Authorization.slice(6)), 'admin:abcdefghijkl');
      return Response.json({ id: 1, name: 'Admin', capabilities: { publish_pages: true, edit_pages: true } });
    }
    if (url.startsWith('https://sunriseroofing.example/wp-json/wp/v2/pages')) {
      const b = JSON.parse(init.body);
      return Response.json({ id: 77, status: b.status, link: b.status === 'publish' ? 'https://sunriseroofing.example/roof-repair-hollywood-fl/' : 'https://sunriseroofing.example/?page_id=77' });
    }
    return real(u, init);
  };
  try {
    r = await t.call('POST', `/api/content/${id}/draft`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.ai, true);
    assert.equal(r.data.item.status, 'draft');
    assert.equal(r.data.item.slug, 'roof-repair-hollywood-fl');
    r = await t.call('PUT', `/api/content/${id}`, { html: `${LONG}<p onclick="x">Edited by V</p>`, title: 'Roof Repair in Hollywood' });
    assert.ok(r.data.item.html.includes('<p>Edited by V</p>'));
    r = await t.call('POST', `/api/content/${id}/review`);
    assert.equal(r.data.item.status, 'review');
    // a client login sees it, asks for a change, then approves after the fix
    const inv = await t.call('POST', `/api/clients/${c.id}/invite`, { email: 'maria@sunrise.example', name: 'Maria' });
    const owner = t.getCookie();
    const tok = (inv.data.inviteUrl || '').split('/').pop();
    t.logout();
    let cl = await t.call('POST', '/api/auth/invite/accept', { token: tok, password: 'correct horse battery' });
    assert.equal(cl.status, 200, JSON.stringify(cl.data));
    cl = await t.call('GET', `/api/clients/${c.id}/content`);
    assert.equal(cl.data.items.length, 1);
    assert.equal(cl.data.items[0].brief, undefined);
    assert.equal(cl.data.wordpress, undefined);
    cl = await t.call('GET', `/api/content/${id}`);
    assert.ok(cl.data.item.html.includes('Edited by V'));
    assert.equal((await t.call('POST', `/api/content/${id}/draft`)).status, 403);
    cl = await t.call('POST', `/api/content/${id}/changes`, { note: 'Add that we do tile roofs' });
    assert.equal(cl.data.item.status, 'changes');
    const clientCookie = t.getCookie();
    t.setCookie(owner);
    await t.call('POST', `/api/content/${id}/review`);
    t.setCookie(clientCookie);
    cl = await t.call('POST', `/api/content/${id}/approve`);
    assert.equal(cl.data.item.status, 'approved');
    t.setCookie(owner);
    // WordPress: connect, send as draft, then publish live
    r = await t.call('PUT', `/api/clients/${c.id}/wordpress`, { url: 'https://sunriseroofing.example/wp-admin/', user: 'admin', password: 'abcd efgh ijkl' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const row = await first(t.env, 'SELECT wp_pass FROM clients WHERE id = ?', c.id);
    assert.ok(row.wp_pass && !row.wp_pass.includes('abcd'), 'password stored sealed');
    assert.equal((await t.call('GET', `/api/clients/${c.id}`)).data.client.wp_pass, undefined);
    r = await t.call('POST', `/api/content/${id}/publish`, { status: 'draft' });
    assert.equal(r.data.item.wp_id, '77');
    assert.equal(r.data.item.status, 'approved');
    assert.equal((await first(t.env, "SELECT status FROM tasks WHERE id = 'tp'")).status, 'todo');
    r = await t.call('POST', `/api/content/${id}/publish`, { status: 'publish' });
    assert.equal(r.data.item.status, 'published');
    assert.equal(r.data.item.live_url, 'https://sunriseroofing.example/roof-repair-hollywood-fl/');
    assert.ok(seen.some((s) => s.url.endsWith('/wp-json/wp/v2/pages/77')), 'second publish updates the same page');
    const task = await first(t.env, "SELECT * FROM tasks WHERE id = 'tp'");
    assert.equal(task.status, 'done');
    assert.equal(task.link, 'https://sunriseroofing.example/roof-repair-hollywood-fl/');
  } finally { globalThis.fetch = real; }
});

test('without an API key the draft is an outline to fill in, and hand-off publishing works without WordPress', async () => {
  const t = setup();
  const c = await start(t);
  let r = await t.call('POST', `/api/clients/${c.id}/content`, { kind: 'city', title: 'Roof repair in Pembroke Pines', keyword: 'roof repair pembroke pines', city: 'Pembroke Pines', service: 'Roof repair' });
  const id = r.data.item.id;
  r = await t.call('POST', `/api/content/${id}/draft`);
  assert.equal(r.data.ai, false);
  assert.match(r.data.item.html, /\[Write 2 to 4 short paragraphs/);
  const blocked = await t.call('POST', `/api/content/${id}/review`);
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /brackets/);
  assert.equal((await t.call('POST', `/api/content/${id}/publish`, { status: 'publish' })).status, 400, 'no WordPress connected');
  r = await t.call('POST', `/api/content/${id}/publish`, { manual: true, url: 'https://site.example/pembroke-pines/' });
  assert.equal(r.data.item.status, 'published');
  assert.equal((await t.call('POST', `/api/content/${id}/publish`, { manual: true, url: 'javascript:x' })).status, 400);
});
