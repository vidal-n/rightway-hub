import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, run, first } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
import { slimFile, GOOGLE_TYPE } from '../src/gdrive.js';

test('a Drive file is slimmed down to what the page shows', () => {
  const folder = slimFile({ id: 'f1', name: 'Sunrise Plumbing', mimeType: GOOGLE_TYPE.folder, modifiedTime: '2026-11-01T10:00:00Z' });
  assert.equal(folder.kind, 'folder');
  assert.equal(folder.google, true);
  const sheet = slimFile({ id: 's1', name: 'Leads', mimeType: GOOGLE_TYPE.sheet, shared: true, webViewLink: 'https://docs/x' });
  assert.equal(sheet.kind, 'sheet');
  assert.equal(sheet.shared, true);
  const pdf = slimFile({ id: 'p1', name: 'Work order.pdf', mimeType: 'application/pdf', size: '20480' });
  assert.equal(pdf.kind, 'pdf');
  assert.equal(pdf.size, 20480);
  assert.equal(pdf.google, false);
  assert.equal(slimFile({ id: 'i1', name: 'shop.jpg', mimeType: 'image/jpeg' }).kind, 'image');
  assert.equal(slimFile({ id: 'x1', mimeType: 'text/plain' }).name, '(no name)');
  assert.equal(slimFile({ id: 'r1', mimeType: 'text/plain', capabilities: { canEdit: false } }).canEdit, false);
});

function setup() {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csecret' };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' };
    if (cookie) h.cookie = cookie;
    let payload;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
  };
  return { env, call };
}

function fakeDrive() {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    let body = init.body || null;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* urlencoded */ } }
    else if (body instanceof Uint8Array) body = new TextDecoder().decode(body);
    calls.push({ u, body, method: init.method || 'GET' });
    const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('oauth2.googleapis.com/token')) return j({ access_token: 'at1', expires_in: 3600 });
    if (u.startsWith('https://www.googleapis.com/upload/drive')) return j({ id: 'up1', name: 'uploaded', mimeType: 'application/pdf' });
    if (u.includes('/permissions') && init.method === 'POST') return j({ id: 'perm1' });
    if (u.includes('/permissions')) return j({ permissions: [{ id: 'p1', type: 'user', role: 'writer', emailAddress: 'jane@sunriseplumbing.com' }] });
    if (u.includes('/files?') && init.method === 'POST') return j({ id: 'new1', name: 'Notes', mimeType: GOOGLE_TYPE.doc, webViewLink: 'https://docs/new1' });
    if (u.includes('alt=media') || u.includes('/export')) return new Response('bytes here', { status: 200, headers: { 'content-type': 'application/pdf' } });
    if (/\/files\/[^/?]+\?/.test(u) && (init.method || 'GET') === 'GET') {
      const id = u.match(/\/files\/([^/?]+)/)[1];
      if (id === 'sub') return j({ id: 'sub', name: 'Reports', parents: ['f1'] });
      if (id === 'f1') return j({ id: 'f1', name: 'Sunrise Plumbing', parents: ['root'] });
      return j({ id, name: 'Work order.pdf', mimeType: 'application/pdf' });
    }
    if (/\/files\/[^/?]+/.test(u) && init.method === 'PATCH') return j({ id: 'f9', name: body?.name || 'renamed', mimeType: 'application/pdf' });
    if (u.includes('/files?')) {
      if (u.includes('mimeType+%3D') || u.includes(encodeURIComponent(GOOGLE_TYPE.folder))) {
        return j({ files: u.includes('Sunrise') && u.includes('name+%3D') ? [{ id: 'cf1', name: 'Sunrise Plumbing', mimeType: GOOGLE_TYPE.folder }] : [
          { id: 'f1', name: 'Sunrise Plumbing', mimeType: GOOGLE_TYPE.folder, modifiedTime: '2026-11-01T10:00:00Z' },
          { id: 'd1', name: 'Pitch notes', mimeType: GOOGLE_TYPE.doc, modifiedTime: '2026-11-02T10:00:00Z', webViewLink: 'https://docs/d1' },
        ] });
      }
      return j({ files: [{ id: 'd1', name: 'Pitch notes', mimeType: GOOGLE_TYPE.doc, webViewLink: 'https://docs/d1' }], nextPageToken: 'p2' });
    }
    return j({});
  };
  return { calls, done: () => { globalThis.fetch = real; } };
}

async function owner(call, env, scopes = 'openid email https://www.googleapis.com/auth/drive') {
  await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', name: 'V', email: 'v@rightwaygrowth.com', password: 'correct horse battery' });
  const me = await first(env, 'SELECT * FROM users LIMIT 1');
  const { seal } = await import('../src/google.js');
  await run(env, 'UPDATE users SET google_token = ?, google_email = ?, google_scopes = ? WHERE id = ?', await seal(env, 'r1'), 'v@rightwaygrowth.com', scopes, me.id);
  return me;
}

test('Drive: browse, make, rename, share, upload and download', async () => {
  const { env, call } = setup();
  const g = fakeDrive();
  try {
    await owner(call, env);

    const list = await call('GET', '/api/google/drive/files');
    assert.equal(list.status, 200);
    assert.equal(list.data.files.length, 2);
    assert.equal(list.data.files[0].kind, 'folder');

    const inside = await call('GET', '/api/google/drive/files?folder=sub');
    assert.deepEqual(inside.data.crumbs.map((c) => c.name), ['Sunrise Plumbing', 'Reports'], 'the trail goes back up to the top');

    const made = await call('POST', '/api/google/drive/new', { name: 'Notes', kind: 'doc' });
    assert.equal(made.data.file.kind, 'doc');
    const post = g.calls.find((c) => c.method === 'POST' && c.u.includes('/drive/v3/files?'));
    assert.equal(post.body.mimeType, GOOGLE_TYPE.doc);

    const renamed = await call('PATCH', '/api/google/drive/files/d1', { name: 'Pitch notes v2' });
    assert.equal(renamed.data.file.name, 'Pitch notes v2');

    const shared = await call('POST', '/api/google/drive/files/d1/share', { email: 'jane@sunriseplumbing.com', role: 'writer' });
    assert.equal(shared.status, 200);
    const perm = g.calls.find((c) => c.u.includes('/permissions') && c.method === 'POST');
    assert.equal(perm.body.emailAddress, 'jane@sunriseplumbing.com');
    assert.equal(perm.body.role, 'writer');

    const who = await call('GET', '/api/google/drive/files/d1/who');
    assert.equal(who.data.people[0].who, 'jane@sunriseplumbing.com');

    const up = await call('POST', '/api/google/drive/upload', { name: 'order.pdf', type: 'application/pdf', data: Buffer.from('hello').toString('base64') });
    assert.equal(up.status, 200);
    const sent = g.calls.find((c) => c.u.startsWith('https://www.googleapis.com/upload/drive'));
    assert.match(String(sent.body), /multipart|order\.pdf/, 'the name rides along with the bytes');
    assert.match(sent.body, /hello/);

    const got = await call('GET', '/api/google/drive/files/x1/download');
    assert.equal(got.data, 'bytes here');

    const binned = await call('DELETE', '/api/google/drive/files/d1');
    assert.equal(binned.status, 200);
    assert.ok(g.calls.some((c) => c.method === 'PATCH' && c.body?.trashed === true), 'delete puts it in the bin, it does not wipe it');
  } finally { g.done(); }
});

test('a share with no email address is refused', async () => {
  const { env, call } = setup();
  const g = fakeDrive();
  try {
    await owner(call, env);
    const r = await call('POST', '/api/google/drive/files/d1/share', { email: 'not an address' });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /Which email/);
  } finally { g.done(); }
});

test('a client page draft becomes a Google Doc in that client\'s folder', async () => {
  const { env, call } = setup();
  const g = fakeDrive();
  try {
    await owner(call, env);
    await run(env, 'INSERT INTO clients (id, name, plan, status, created_at) VALUES (?,?,?,?,?)', 'c_1', 'Sunrise Plumbing', 'growth', 'active', Date.now());
    await run(env, 'INSERT INTO content (id, client_id, kind, title, html, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      'ct_1', 'c_1', 'service', 'Drain cleaning in Hollywood', '<h2>Why it matters</h2><p>Words.</p>', 'approved', Date.now(), Date.now());

    const r = await call('POST', '/api/clients/c_1/to-doc', { contentId: 'ct_1' });
    assert.equal(r.status, 200);
    const sent = g.calls.find((c) => c.u.startsWith('https://www.googleapis.com/upload/drive'));
    assert.match(sent.body, /Drain cleaning in Hollywood/);
    assert.match(sent.body, /vnd\.google-apps\.document/, 'Google converts the HTML into a real doc');
    const client = await first(env, 'SELECT drive_folder FROM clients WHERE id = ?', 'c_1');
    assert.ok(client.drive_folder, 'the client keeps its folder for next time');

    const tab = await call('GET', '/api/clients/c_1/drive');
    assert.equal(tab.status, 200);
    assert.ok(Array.isArray(tab.data.files));
  } finally { g.done(); }
});

test('Drive stays off until the person turns it on', async () => {
  const { env, call } = setup();
  const g = fakeDrive();
  try {
    await owner(call, env, 'openid email https://www.googleapis.com/auth/drive.file');
    const r = await call('GET', '/api/google/drive/files');
    assert.equal(r.status, 400);
    assert.match(r.data.error, /Turn on Google Drive/);
  } finally { g.done(); }
});
