import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
import { permissionState, assetsFrom, problems, connectionLine, partnerSteps, fbDialogUrl, SCOPES, pageCanPost } from '../public/js/meta.js';
import { readSignedRequest, explainMeta } from '../src/meta.js';

const SECRET = 'abcdef0123456789abcdef0123456789';

function setup() {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body, anon, raw) => {
    const h = {};
    if (!anon) h['x-rw'] = '1';
    if (cookie && !anon) h.cookie = cookie;
    let payload = raw;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set && !anon) cookie = set.split(';')[0];
    return { status: res.status, data: await res.clone().json().catch(() => null), res };
  };
  return { env, call };
}

// A pretend Meta. `world` says who is signed in, what they ticked and what is still valid.
function fakeMeta(world) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname !== 'graph.facebook.com') return real(url, init);
    const path = u.pathname.replace(/^\/v[\d.]+/, '');
    calls.push({ path, method: init.method || 'GET', q: Object.fromEntries(u.searchParams) });
    const ok = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    const fail = (message, code = 190) => new Response(JSON.stringify({ error: { message, code } }), { status: 400, headers: { 'content-type': 'application/json' } });
    if (path === '/oauth/access_token') {
      if (u.searchParams.get('grant_type') === 'fb_exchange_token') return ok({ access_token: 'LONG', expires_in: 5184000 });
      if (u.searchParams.get('code') !== 'good-code') return fail('This authorization code has been used.', 100);
      return ok({ access_token: 'SHORT', expires_in: 3600 });
    }
    if (path === '/me') return ok({ id: world.uid, name: world.name });
    if (path === '/me/permissions') return ok({ data: world.perms });
    if (path === '/me/accounts') return ok({ data: world.pages });
    if (path === '/me/adaccounts') return ok({ data: world.ads || [] });
    if (path === '/debug_token') return world.valid === false ? ok({ data: { is_valid: false } }) : ok({ data: { is_valid: true, expires_at: 1900000000 } });
    if (path === `/${world.uid}/permissions` && init.method === 'DELETE') { world.removed = true; return ok({ success: true }); }
    if (/^\/\d+$/.test(path) && u.searchParams.get('access_token')?.includes('|')) return u.searchParams.get('access_token').endsWith(SECRET) ? ok({ name: 'Rightway Hub', id: path.slice(1) }) : fail('Error validating client secret.', 1);
    return fail(`unexpected ${path}`, 2);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const granted = (ids) => SCOPES.map((p) => ({ permission: p, status: ids.includes(p) ? 'granted' : 'declined' }));
const GOOD = () => ({
  uid: '1001', name: 'Sam Owner', perms: granted(SCOPES),
  pages: [{ id: 'P1', name: 'Sunrise Roofing', category: 'Roofing', tasks: ['CREATE_CONTENT', 'MANAGE'], access_token: 'PAGETOK', instagram_business_account: { id: 'IG1', username: 'sunriseroofing' } }],
  ads: [{ id: 'act_55', account_id: '55', name: 'Sunrise ads', account_status: 1 }],
});

async function owner(t) {
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  return (await t.call('POST', '/api/clients', { name: 'Sunrise Roofing', contact_name: 'Sam Owner' })).data.client;
}
async function saveApp(t) {
  return t.call('PUT', '/api/meta/app', { appId: '123456789', secret: SECRET, businessId: '998877665' });
}
// Walk the client's side: open the link, click the button, come back from Facebook.
async function clientConnects(t, link) {
  const start = await t.call('GET', `/api/public/meta/${link}/start`, undefined, true);
  assert.equal(start.status, 302);
  const to = new URL(start.res.headers.get('location'));
  assert.equal(to.hostname, 'www.facebook.com');
  const state = to.searchParams.get('state');
  const back = await t.call('GET', `/api/meta/callback?code=good-code&state=${state}`, undefined, true);
  return { to, back };
}

test('pure helpers: permissions, assets, problems, steps, dialog url', () => {
  const p = permissionState(granted(SCOPES.filter((x) => x !== 'pages_manage_posts' && x !== 'ads_management')));
  assert.deepEqual(p.missingNeeded, ['pages_manage_posts']);
  assert.ok(p.missing.includes('ads_management'));
  assert.equal(p.canPost, false);
  assert.deepEqual(permissionState(null).granted, []);
  assert.equal(pageCanPost(['ANALYZE']), false);
  assert.equal(pageCanPost(['CREATE_CONTENT']), true);
  const a = assetsFrom(GOOD().pages, GOOD().ads);
  assert.deepEqual(a.map((x) => x.kind), ['page', 'instagram', 'adaccount']);
  assert.equal(a[1].name, '@sunriseroofing');
  assert.equal(a[1].extra.page_id, 'P1');
  assert.deepEqual(problems(a, permissionState(granted(SCOPES))), []);
  assert.match(connectionLine(a, permissionState(granted(SCOPES))), /1 Facebook Page, 1 Instagram account, 1 ad account shared/);
  assert.match(problems([], permissionState(granted(SCOPES)))[0], /No Facebook Page/);
  const viewer = assetsFrom([{ id: 'P', name: 'X', tasks: ['ANALYZE'] }], []);
  assert.match(problems(viewer, permissionState(granted(SCOPES))).join(' '), /can not publish/);
  assert.match(problems(assetsFrom([{ id: 'P', name: 'X', tasks: ['MANAGE'] }], []), permissionState(granted(SCOPES))).join(' '), /No Instagram/);
  assert.match(partnerSteps('555', 'Rightway Growth').join(' '), /\(555\)/);
  const url = new URL(fbDialogUrl({ appId: '1', redirect: 'https://h/cb', state: 's' }));
  assert.equal(url.searchParams.get('auth_type'), 'rerequest');
  assert.ok(url.searchParams.get('scope').includes('pages_manage_posts'));
  assert.equal(new URL(fbDialogUrl({ appId: '1', redirect: 'https://h/cb', state: 's', configId: '77' })).searchParams.get('config_id'), '77');
  assert.match(explainMeta({ code: 190, message: 'x' }), /sign-in ended/);
  assert.match(explainMeta(new Error('Can\'t load URL')), /Valid OAuth Redirect/);
});

test('no dashes in client copy', async () => {
  const fs = await import('node:fs');
  for (const f of ['public/connect.js', 'public/connect.html', 'public/privacy.html', 'public/js/meta.js', 'public/hub/meta.js']) {
    const body = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const visible = body.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/[–—]/.test(visible), `${f} has an em or en dash`);
  }
});

test('app setup: owners only, secret checked with Meta, sealed, never returned', async () => {
  const t = setup(); const meta = fakeMeta(GOOD());
  try {
    const c = await owner(t);
    let r = await t.call('GET', '/api/meta/app');
    assert.equal(r.data.configured, false);
    r = await t.call('POST', `/api/clients/${c.id}/meta/link`, {});
    assert.equal(r.status, 400);
    assert.match(r.data.error, /Save the Meta app/);
    r = await t.call('PUT', '/api/meta/app', { appId: 'abc', secret: SECRET });
    assert.equal(r.status, 400);
    r = await t.call('PUT', '/api/meta/app', { appId: '123456789', secret: 'f'.repeat(32) });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /app id or secret/);
    r = await saveApp(t);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.appName, 'Rightway Hub');
    r = await t.call('GET', '/api/meta/app');
    assert.equal(r.data.configured, true);
    assert.equal(r.data.hasSecret, true);
    assert.ok(!JSON.stringify(r.data).includes(SECRET));
    assert.equal(r.data.redirect, 'https://hub.test/api/meta/callback');
    const row = await t.env.DB.prepare("SELECT v FROM settings WHERE k = 'meta_app_secret'").first();
    assert.ok(row.v && !row.v.includes(SECRET));
  } finally { meta.restore(); }
});

test('full connect: link, Facebook sign-in, assets saved, sealed tokens, staff see status', async () => {
  const t = setup(); const meta = fakeMeta(GOOD());
  try {
    const c = await owner(t); await saveApp(t);
    const mk = await t.call('POST', `/api/clients/${c.id}/meta/link`, { label: 'FB and IG' });
    assert.equal(mk.status, 200, JSON.stringify(mk.data));
    const link = mk.data.token;
    assert.match(mk.data.url, /^https:\/\/hub\.test\/connect\.html#/);
    // The client page data: no login, shows nothing private.
    let r = await t.call('GET', `/api/public/meta/${link}`, undefined, true);
    assert.equal(r.status, 200);
    assert.equal(r.data.business, 'Sunrise Roofing');
    assert.equal(r.data.configured, true);
    assert.equal(r.data.businessId, '998877665');
    assert.deepEqual(r.data.connected, []);
    const { to, back } = await clientConnects(t, link);
    assert.equal(to.searchParams.get('client_id'), '123456789');
    assert.equal(to.searchParams.get('redirect_uri'), 'https://hub.test/api/meta/callback');
    assert.equal(back.status, 302);
    assert.match(back.res.headers.get('location'), /connect\.html\?done=1#/);
    // Page now lists what they shared.
    r = await t.call('GET', `/api/public/meta/${link}`, undefined, true);
    assert.equal(r.data.connected.length, 1);
    assert.deepEqual(r.data.connected[0].assets.map((a) => a.kind), ['page', 'instagram', 'adaccount']);
    assert.ok(!JSON.stringify(r.data).includes('PAGETOK') && !JSON.stringify(r.data).includes('LONG'));
    // Staff view.
    r = await t.call('GET', `/api/clients/${c.id}/meta`);
    assert.equal(r.data.connections.length, 1);
    const conn = r.data.connections[0];
    assert.equal(conn.status, 'ok');
    assert.equal(conn.fb_name, 'Sam Owner');
    assert.equal(conn.assets.length, 3);
    assert.deepEqual(conn.problems, []);
    assert.ok(conn.assets.find((a) => a.kind === 'page').can_post);
    assert.ok(!JSON.stringify(r.data).includes('PAGETOK') && !JSON.stringify(r.data).includes('LONG'));
    assert.equal(r.data.links[0].views, 2);
    // Tokens are stored sealed.
    const sealed = await t.env.DB.prepare('SELECT user_token FROM meta_connections').first();
    assert.ok(sealed.user_token && !sealed.user_token.includes('LONG'));
    const pt = await t.env.DB.prepare("SELECT page_token FROM meta_assets WHERE kind = 'page'").first();
    assert.ok(pt.page_token && !pt.page_token.includes('PAGETOK'));
    const ig = await t.env.DB.prepare("SELECT page_token FROM meta_assets WHERE kind = 'instagram'").first();
    assert.ok(ig.page_token, 'Instagram publishes through its Page token');
    const { pageTokenFor } = await import('../src/meta.js');
    const aid = (await t.env.DB.prepare("SELECT id FROM meta_assets WHERE kind = 'instagram'").first()).id;
    assert.equal((await pageTokenFor(t.env, c.id, aid)).token, 'PAGETOK');
    // Connecting again does not duplicate.
    await clientConnects(t, link);
    r = await t.call('GET', `/api/clients/${c.id}/meta`);
    assert.equal(r.data.connections.length, 1);
    assert.equal(r.data.connections[0].assets.length, 3);
  } finally { meta.restore(); }
});

test('thin connections say what to fix: unticked boxes, view only Page, no Instagram', async () => {
  const w = GOOD();
  w.perms = granted(SCOPES.filter((x) => x !== 'pages_manage_posts' && x !== 'instagram_content_publish'));
  w.pages = [{ id: 'P1', name: 'Sunrise Roofing', tasks: ['ANALYZE'], access_token: 'PT' }];
  w.ads = [];
  const t = setup(); const meta = fakeMeta(w);
  try {
    const c = await owner(t); await saveApp(t);
    const link = (await t.call('POST', `/api/clients/${c.id}/meta/link`, {})).data.token;
    await clientConnects(t, link);
    const r = await t.call('GET', `/api/clients/${c.id}/meta`);
    const conn = r.data.connections[0];
    assert.equal(conn.status, 'thin');
    const text = conn.problems.join(' ');
    assert.match(text, /can not publish/);
    assert.match(text, /No Instagram/);
    assert.match(text, /Publish posts to your Facebook Page/i);
    assert.match(conn.line, /Missing/);
    const pub = await t.call('GET', `/api/public/meta/${link}`, undefined, true);
    assert.ok(pub.data.connected[0].problems.length >= 3);
  } finally { meta.restore(); }
});

test('cancelled, bad state, reused code, revoked and expired links are handled', async () => {
  const t = setup(); const meta = fakeMeta(GOOD());
  try {
    const c = await owner(t); await saveApp(t);
    const link = (await t.call('POST', `/api/clients/${c.id}/meta/link`, {})).data.token;
    // Client closes Facebook.
    const start = await t.call('GET', `/api/public/meta/${link}/start`, undefined, true);
    const state = new URL(start.res.headers.get('location')).searchParams.get('state');
    let back = await t.call('GET', `/api/meta/callback?error=access_denied&state=${state}`, undefined, true);
    assert.match(decodeURIComponent(back.res.headers.get('location')), /closed Facebook/);
    // That state is spent.
    back = await t.call('GET', `/api/meta/callback?code=good-code&state=${state}`, undefined, true);
    assert.match(decodeURIComponent(back.res.headers.get('location')), /took too long/);
    // Made up state.
    back = await t.call('GET', '/api/meta/callback?code=good-code&state=nope', undefined, true);
    assert.match(back.res.headers.get('location'), /err=/);
    assert.equal((await t.call('GET', `/api/clients/${c.id}/meta`)).data.connections.length, 0);
    // Bad code: plain error back on the page.
    const s2 = await t.call('GET', `/api/public/meta/${link}/start`, undefined, true);
    const st2 = new URL(s2.res.headers.get('location')).searchParams.get('state');
    back = await t.call('GET', `/api/meta/callback?code=old&state=${st2}`, undefined, true);
    assert.match(back.res.headers.get('location'), /connect\.html\?err=/);
    // Revoke.
    await t.call('DELETE', `/api/meta/links/${link}`);
    let r = await t.call('GET', `/api/public/meta/${link}`, undefined, true);
    assert.equal(r.status, 404);
    const s3 = await t.call('GET', `/api/public/meta/${link}/start`, undefined, true);
    assert.match(decodeURIComponent(s3.res.headers.get('location')), /not valid/);
    // Expired.
    const l2 = (await t.call('POST', `/api/clients/${c.id}/meta/link`, {})).data.token;
    await t.env.DB.prepare('UPDATE meta_links SET expires_at = ? WHERE token = ?').bind(Date.now() - 1000, l2).run();
    r = await t.call('GET', `/api/public/meta/${l2}`, undefined, true);
    assert.equal(r.status, 410);
    assert.match(r.data.error, /expired/);
    // Unknown token.
    assert.equal((await t.call('GET', '/api/public/meta/zzz', undefined, true)).status, 404);
  } finally { meta.restore(); }
});

test('check connection: valid stays ok, a dead sign-in turns to expired', async () => {
  const w = GOOD();
  const t = setup(); const meta = fakeMeta(w);
  try {
    const c = await owner(t); await saveApp(t);
    const link = (await t.call('POST', `/api/clients/${c.id}/meta/link`, {})).data.token;
    await clientConnects(t, link);
    let r = await t.call('POST', `/api/clients/${c.id}/meta/check`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.connections[0].status, 'ok');
    // The client removes a Page from the app on Facebook: it vanishes on the next check.
    w.pages = [];
    r = await t.call('POST', `/api/clients/${c.id}/meta/check`);
    assert.equal(r.data.connections[0].status, 'thin');
    assert.equal(r.data.connections[0].assets.filter((a) => a.kind === 'page').length, 0);
    w.valid = false;
    r = await t.call('POST', `/api/clients/${c.id}/meta/check`);
    assert.equal(r.data.connections[0].status, 'expired');
    assert.match(r.data.connections[0].note, /Send the link again/);
  } finally { meta.restore(); }
});

test('disconnect removes our rows and takes the app off their Facebook', async () => {
  const w = GOOD();
  const t = setup(); const meta = fakeMeta(w);
  try {
    const c = await owner(t); await saveApp(t);
    const link = (await t.call('POST', `/api/clients/${c.id}/meta/link`, {})).data.token;
    await clientConnects(t, link);
    const id = (await t.call('GET', `/api/clients/${c.id}/meta`)).data.connections[0].id;
    const r = await t.call('DELETE', `/api/meta/connections/${id}`);
    assert.equal(r.status, 200);
    assert.equal(w.removed, true);
    assert.equal((await t.call('GET', `/api/clients/${c.id}/meta`)).data.connections.length, 0);
    assert.equal((await t.env.DB.prepare('SELECT COUNT(*) n FROM meta_assets').first()).n, 0);
  } finally { meta.restore(); }
});

async function signed(payload, secret = SECRET) {
  const b64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const p = b64(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(p));
  return `${b64(sig)}.${p}`;
}

test('Meta deauthorize and data deletion callbacks verify the signature', async () => {
  const t = setup(); const meta = fakeMeta(GOOD());
  try {
    const c = await owner(t); await saveApp(t);
    const link = (await t.call('POST', `/api/clients/${c.id}/meta/link`, {})).data.token;
    await clientConnects(t, link);
    assert.deepEqual(await readSignedRequest(await signed({ user_id: '1001' }), SECRET), { user_id: '1001' });
    const forged = await signed({ user_id: '1001' }, 'f'.repeat(32));
    await assert.rejects(() => readSignedRequest(forged, SECRET));
    const form = (sr) => `signed_request=${encodeURIComponent(sr)}`;
    const post = (path, sr) => t.call('POST', path, undefined, true, new Blob([form(sr)], { type: 'application/x-www-form-urlencoded' }));
    // Forged request does nothing.
    let r = await post('/api/public/meta/deauth', await signed({ user_id: '1001' }, 'f'.repeat(32)));
    assert.equal(r.status, 400);
    assert.equal((await t.call('GET', `/api/clients/${c.id}/meta`)).data.connections[0].status, 'ok');
    // Real one: sign-in marked removed, tokens and assets gone.
    r = await post('/api/public/meta/deauth', await signed({ user_id: '1001' }));
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const state = (await t.call('GET', `/api/clients/${c.id}/meta`)).data.connections[0];
    assert.equal(state.status, 'revoked');
    assert.equal(state.assets.length, 0);
    assert.equal((await t.env.DB.prepare('SELECT user_token FROM meta_connections').first()).user_token, null);
    // Deletion removes the row and gives Meta a confirmation code and a status page.
    r = await post('/api/public/meta/delete', await signed({ user_id: '1001' }));
    assert.equal(r.status, 200);
    assert.ok(r.data.confirmation_code);
    assert.match(r.data.url, /^https:\/\/hub\.test\/connect\.html\?deleted=/);
    assert.equal((await t.env.DB.prepare('SELECT COUNT(*) n FROM meta_connections').first()).n, 0);
  } finally { meta.restore(); }
});

test('client app: progress, approve in the app, own connect link, report and activity feed', async () => {
  const { progress } = await import('../public/js/social.js');
  const nowMs = Date.UTC(2026, 10, 15, 12);
  const p = progress([
    { id: 'a', status: 'posted', channels: ['facebook', 'instagram'], posted_at: nowMs - 864e5, title: 'A' },
    { id: 'b', status: 'posted', channels: ['facebook'], posted_at: nowMs - 40 * 864e5, title: 'B' },
    { id: 'c', status: 'review', channels: ['facebook'] },
    { id: 'd', status: 'scheduled', channels: ['instagram'], scheduled_at: nowMs + 864e5, title: 'D' },
  ], nowMs);
  assert.equal(p.postedThisMonth, 1);
  assert.equal(p.postedTotal, 2);
  assert.deepEqual(p.byChannel.map((x) => `${x.id}:${x.n}`).sort(), ['facebook:1', 'instagram:1']);
  assert.equal(p.waiting, 1);
  assert.equal(p.upcoming, 1);
  assert.equal(p.next.id, 'd');
  assert.equal(p.months.length, 6);
  assert.equal(progress([]).postedTotal, 0);

  const t = setup(); const meta = fakeMeta(GOOD());
  try {
    const c = await owner(t); await saveApp(t);
    // A post with the client, then one that is posted.
    const mk = async (title, status) => (await t.call('POST', `/api/clients/${c.id}/social`, { title, channels: ['facebook'], captions: { facebook: { text: `Caption for ${title}` } }, status })).data.item;
    const waiting = await mk('Roof job', 'review');
    const posted = await mk('Fixed leak', 'draft');
    let r = await t.call('PATCH', `/api/social/${posted.id}`, { status: 'posted', post_links: { facebook: 'https://facebook.com/p/1' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const feed = await t.env.DB.prepare("SELECT text, link FROM log WHERE client_id = ? AND text LIKE 'Posted%'").bind(c.id).first();
    assert.match(feed.text, /Posted to Facebook: Fixed leak/);
    assert.equal(feed.link, 'https://facebook.com/p/1');
    // The client's own login, with its own session.
    const inv = await t.call('POST', `/api/clients/${c.id}/invite`, { name: 'Sam Owner', email: 'sam@sunrise.test' });
    assert.equal(inv.status, 200, JSON.stringify(inv.data));
    let ck = '';
    const as = async (method, path, body) => {
      const h = { 'x-rw': '1', ...(ck ? { cookie: ck } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) };
      const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }), t.env);
      const set = res.headers.get('set-cookie'); if (set) ck = set.split(';')[0];
      return { status: res.status, data: await res.clone().json().catch(() => null), res };
    };
    const acc = await as('POST', '/api/auth/invite/accept', { token: inv.data.inviteUrl.split('/').pop(), password: 'a long client password 1' });
    assert.equal(acc.status, 200, JSON.stringify(acc.data));
    // The client sees the same numbers and can act, but never drafts.
    const staff = t.call;
    t.call = as;
    // Staff view of the same overview works and hides drafts.
    r = await t.call('GET', `/api/clients/${c.id}/social/overview`);
    assert.equal(r.status, 200);
    assert.equal(r.data.items.length, 2);
    assert.equal(r.data.progress.waiting, 1);
    assert.equal(r.data.progress.postedThisMonth, 1);
    assert.equal(r.data.meta.configured, true);
    assert.equal(r.data.items.find((i) => i.id === waiting.id).media.length, 0);
    // Changes need a note. Approve works. Wrong client or draft is refused.
    r = await t.call('POST', `/api/clients/${c.id}/social/items/${waiting.id}/changes`, { body: '' });
    assert.equal(r.status, 400);
    r = await t.call('POST', `/api/clients/${c.id}/social/items/${waiting.id}/approve`, { body: 'Looks great' });
    assert.equal(r.status, 200);
    assert.equal(r.data.status, 'approved');
    const draft = (await staff('POST', `/api/clients/${c.id}/social`, { title: 'Hidden', channels: ['facebook'] })).data.item;
    assert.equal((await t.call('POST', `/api/clients/${c.id}/social/items/${draft.id}/approve`, {})).status, 404);
    // Own connect link from the app, then the report carries the social section.
    r = await t.call('POST', `/api/clients/${c.id}/meta/self-link`);
    assert.equal(r.status, 200);
    const { to } = await clientConnects(t, r.data.token);
    assert.equal(to.hostname, 'www.facebook.com');
    r = await t.call('GET', `/api/clients/${c.id}/social/overview`);
    assert.equal(r.data.meta.counts.pages, 1);
    assert.equal(r.data.meta.counts.instagram, 1);
    const log = await t.env.DB.prepare("SELECT text FROM log WHERE client_id = ? AND text LIKE 'Facebook and Instagram connected%'").bind(c.id).first();
    assert.ok(log);
    const { buildReport } = await import('../src/reports.js');
    const month = new Date().toISOString().slice(0, 7);
    const snap = await buildReport(t.env, await t.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(c.id).first(), month);
    assert.equal(snap.social.posted, 1);
    assert.equal(snap.social.connected.pages, 1);
    assert.equal(snap.social.items[0].link, 'https://facebook.com/p/1');
  } finally { meta.restore(); }
});
