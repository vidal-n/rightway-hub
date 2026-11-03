import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, run, first } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
import {
  addr, addrList, decodeWord, encodeWord, bodyOf, attachmentsOf, safeMailHtml, buildRaw,
  replyTo, threadRow, fullMessage, decodeB64, b64url, headerOf,
} from '../public/js/gmailparse.js';

const enc = (s) => Buffer.from(s, 'utf8').toString('base64url');
const H = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));

// ---------- pure parsing ----------
test('addresses are split and named', () => {
  assert.deepEqual(addr('Jane Doe <Jane@X.com>'), { name: 'Jane Doe', email: 'jane@x.com' });
  assert.deepEqual(addr('bob@x.com'), { name: 'bob', email: 'bob@x.com' });
  assert.equal(addr('"Doe, Jane" <j@x.com>').name, 'Doe, Jane');
  const list = addrList('"Doe, Jane" <j@x.com>, bob@x.com');
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((a) => a.email), ['j@x.com', 'bob@x.com']);
});

test('encoded words come back as text', () => {
  assert.equal(decodeWord('=?UTF-8?B?SGVsbG8gd29ybGQ=?='), 'Hello world');
  assert.equal(decodeWord('=?UTF-8?Q?Caf=C3=A9?='), 'Café');
  assert.equal(encodeWord('plain subject'), 'plain subject');
  assert.equal(decodeWord(encodeWord('Café del Mar')), 'Café del Mar');
});

test('the body picks html over plain, and finds attachments', () => {
  const payload = {
    mimeType: 'multipart/mixed',
    parts: [
      { mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/plain; charset="UTF-8"', body: { data: enc('plain words') } },
        { mimeType: 'text/html; charset="UTF-8"', body: { data: enc('<p>rich words</p>') } },
      ] },
      { mimeType: 'application/pdf', filename: 'quote.pdf', body: { attachmentId: 'att1', size: 2048 }, headers: H({ 'Content-Disposition': 'attachment; filename="quote.pdf"' }) },
    ],
  };
  const b = bodyOf(payload);
  assert.equal(b.html, '<p>rich words</p>');
  assert.equal(b.text, 'plain words');
  const atts = attachmentsOf(payload);
  assert.equal(atts.length, 1);
  assert.equal(atts[0].name, 'quote.pdf');
  assert.equal(atts[0].id, 'att1');
});

test('plain-only mail becomes html with working links', () => {
  const b = bodyOf({ mimeType: 'text/plain', body: { data: enc('see https://rightwaygrowth.com now\nthanks') } });
  assert.match(b.html, /<a href="https:\/\/rightwaygrowth\.com">/);
  assert.match(b.html, /<br>/);
});

test('mail html drops scripts, handlers and remote pictures until asked', () => {
  const dirty = '<div onclick="steal()" style="position:fixed;color:red">hi</div><script>bad()</script><style>b{}</style><img src="https://track.example/p.gif"><a href="javascript:bad()">x</a>';
  const safe = safeMailHtml(dirty);
  assert.ok(!safe.includes('<script'));
  assert.ok(!safe.includes('<style'));
  assert.ok(!safe.includes('onclick'));
  assert.ok(!safe.includes('position:fixed'));
  assert.ok(safe.includes('color:red'));
  assert.ok(!safe.includes('track.example'), 'remote picture stays blocked');
  assert.ok(!/href\s*=\s*"javascript:/i.test(safe));
  assert.match(safe, /target="_blank"/);
  assert.ok(safeMailHtml(dirty, { images: true }).includes('track.example'));
});

test('a sent message is built as real MIME', () => {
  const raw = buildRaw({ from: 'V <v@rightwaygrowth.com>', to: 'Jane <jane@x.com>', cc: 'bob@x.com', subject: 'Café audit', html: '<p>Hi <b>Jane</b></p>' });
  const text = decodeB64(raw);
  assert.match(text, /^From: V <v@rightwaygrowth\.com>\r\n/);
  assert.match(text, /\r\nTo: Jane <jane@x\.com>\r\n/);
  assert.match(text, /\r\nCc: bob@x\.com\r\n/);
  assert.match(text, /Subject: =\?UTF-8\?B\?/, 'a subject with an accent is encoded');
  assert.match(text, /multipart\/alternative/);
  assert.ok(text.includes('text/plain'), 'a plain version rides along');
  assert.ok(decodeB64(text.split('\r\n\r\n')[2].split('\r\n--')[0]).includes('Hi Jane'), 'plain text is stripped from the html');
});

test('a reply keeps the thread and quotes the right people', () => {
  const msg = { from: 'Jane <jane@x.com>', to: 'v@rightwaygrowth.com, pal@y.com', cc: '', subject: 'Audit', messageId: '<abc@mail>', references: '<old@mail>' };
  const one = replyTo(msg, 'v@rightwaygrowth.com', false);
  assert.equal(one.to, 'jane@x.com');
  assert.equal(one.cc, '');
  assert.equal(one.subject, 'Re: Audit');
  assert.equal(one.inReplyTo, '<abc@mail>');
  assert.equal(one.references, '<old@mail> <abc@mail>');
  const all = replyTo(msg, 'v@rightwaygrowth.com', true);
  assert.equal(all.cc, 'pal@y.com', 'me is left off, the other person is kept');
  assert.equal(replyTo({ ...msg, subject: 'Re: Audit' }, 'v@x.com').subject, 'Re: Audit', 'Re: is not doubled');
});

test('a reply-to header wins over the from address', () => {
  const r = replyTo({ from: 'noreply@x.com', replyTo: 'Sales <sales@x.com>', subject: 'Hi' }, 'v@x.com');
  assert.equal(r.to, 'sales@x.com');
});

test('a thread row shows the other people, the count and the flags', () => {
  const mk = (from, to, subject, labels, id) => ({
    id, internalDate: '1700000000000', labelIds: labels, snippet: 'latest words',
    payload: { headers: H({ From: from, To: to, Subject: subject }) },
  });
  const t = { id: 't1', messages: [
    mk('Jane <jane@x.com>', 'v@rightwaygrowth.com', 'Audit', ['INBOX'], 'm1'),
    mk('V <v@rightwaygrowth.com>', 'jane@x.com', 'Re: Audit', ['SENT'], 'm2'),
    mk('Jane <jane@x.com>', 'v@rightwaygrowth.com', 'Re: Audit', ['INBOX', 'UNREAD', 'STARRED'], 'm3'),
  ] };
  const r = threadRow(t, 'v@rightwaygrowth.com');
  assert.equal(r.count, 3);
  assert.equal(r.who, 'Jane', 'my own name is left out when someone else is in the thread');
  assert.equal(r.subject, 'Re: Audit');
  assert.equal(r.unread, true);
  assert.equal(r.starred, true);
  assert.ok(r.emails.includes('jane@x.com'));
});

test('a full message carries what the reader needs', () => {
  const m = {
    id: 'm1', threadId: 't1', internalDate: '1700000000000', labelIds: ['INBOX'], snippet: 'hello',
    payload: { mimeType: 'text/html', headers: H({ From: 'Jane <jane@x.com>', To: 'v@x.com', Subject: '=?UTF-8?B?Q2Fmw6k=?=', 'Message-ID': '<a@b>' }), body: { data: enc('<p>hi <img src="https://x/y.png"></p>') } },
  };
  const f = fullMessage(m);
  assert.equal(f.subject, 'Café');
  assert.equal(f.messageId, '<a@b>');
  assert.equal(f.remoteImages, true);
  assert.equal(headerOf(m.payload, 'from'), 'Jane <jane@x.com>', 'header lookup ignores case');
});

// ---------- the routes, with Gmail faked ----------
function setup(extra = {}) {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csecret', ...extra };
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const h = { 'x-rw': '1', ...headers };
    if (cookie) h.cookie = cookie;
    let payload;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text(), res };
  };
  return { env, call };
}

function fakeGmail() {
  const calls = [];
  const real = globalThis.fetch;
  const msg = (id, from, to, subject, labels, html) => ({
    id, threadId: 't1', internalDate: '1700000000000', labelIds: labels, snippet: 'about the audit',
    payload: { mimeType: 'text/html', headers: H({ From: from, To: to, Subject: subject, 'Message-ID': `<${id}@mail>` }), body: { data: enc(html) } },
  });
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? (() => { try { return JSON.parse(init.body); } catch { return init.body; } })() : null;
    calls.push({ u, body, method: init.method || 'GET' });
    const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('oauth2.googleapis.com/token')) return j({ access_token: 'at1', expires_in: 3600 });
    if (u.includes('/users/me/labels/INBOX')) return j({ id: 'INBOX', threadsUnread: 3 });
    if (u.includes('/users/me/labels')) return j({ labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }, { id: 'Label_7', name: 'Prospects', type: 'user' }, { id: 'CHAT', name: 'CHAT', type: 'system' }] });
    if (u.includes('/users/me/threads/t1')) {
      return j({ id: 't1', messages: [msg('m1', 'Jane <jane@sunrise.com>', 'v@rightwaygrowth.com', 'Audit please', ['INBOX', 'UNREAD'], '<p>can you look at our maps ranking</p>')] });
    }
    if (u.includes('/users/me/threads?') || u.endsWith('/threads')) return j({ threads: [{ id: 't1', snippet: 'about the audit' }], nextPageToken: 'page2' });
    if (u.includes('/users/me/messages/send')) return j({ id: 'sent1', threadId: 't1' });
    if (u.includes('/attachments/')) return j({ data: enc('file contents') });
    if (u.includes('/modify') || u.includes('/trash')) return j({ ok: true });
    return j({});
  };
  return { calls, done: () => { globalThis.fetch = real; } };
}

async function owner(call, env, scopes = 'openid email https://www.googleapis.com/auth/gmail.modify') {
  await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', name: 'V', email: 'v@rightwaygrowth.com', password: 'correct horse battery' });
  const me = await first(env, 'SELECT * FROM users LIMIT 1');
  // A sealed refresh token, written the way the Google callback writes one.
  const { seal } = await import('../src/google.js');
  await run(env, 'UPDATE users SET google_token = ?, google_email = ?, google_scopes = ? WHERE id = ?', await seal(env, 'refresh-1'), 'v@rightwaygrowth.com', scopes, me.id);
  return me;
}

test('Gmail: labels, threads, reading and sending', async () => {
  const { env, call } = setup();
  const g = fakeGmail();
  try {
    const me = await owner(call, env);
    await run(env, 'INSERT INTO leads (id, business, contact_name, email, stage, attempts, dnc, sms_consent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?)',
      'l_1', 'Sunrise Plumbing', 'Jane', 'jane@sunrise.com', 'new', Date.now(), Date.now());

    const labels = await call('GET', '/api/google/mail/labels');
    assert.equal(labels.status, 200);
    assert.deepEqual(labels.data.labels.map((l) => l.name), ['Inbox', 'Prospects'], 'system ids get plain names and Chat is left out');

    const list = await call('GET', '/api/google/mail/threads?label=INBOX');
    assert.equal(list.data.threads.length, 1);
    assert.equal(list.data.threads[0].subject, 'Audit please');
    assert.equal(list.data.threads[0].unread, true);
    assert.equal(list.data.cursor, 'page2');

    const thread = await call('GET', '/api/google/mail/threads/t1');
    assert.equal(thread.data.messages[0].html, '<p>can you look at our maps ranking</p>');
    assert.equal(thread.data.leads[0].business, 'Sunrise Plumbing', 'the thread knows which lead it is');
    assert.ok(g.calls.some((c) => c.u.includes('/threads/t1/modify') && c.body.removeLabelIds.includes('UNREAD')), 'opening marks it read');

    const sent = await call('POST', '/api/google/mail/send', { to: 'jane@sunrise.com', subject: 'Your audit', html: '<p>Here it is</p>' });
    assert.equal(sent.status, 200);
    assert.equal(sent.data.logged, 1);
    const raw = decodeB64(g.calls.find((c) => c.u.includes('/messages/send')).body.raw);
    assert.match(raw, /To: jane@sunrise\.com/);
    assert.match(raw, /Subject: Your audit/);
    const act = await first(env, "SELECT * FROM activities WHERE type = 'email'");
    assert.equal(act.lead_id, 'l_1');
    assert.match(act.body, /Your audit/);

    const people = await call('GET', '/api/google/mail/people?q=sun');
    assert.equal(people.data.people[0].email, 'jane@sunrise.com');
    assert.equal(people.data.people[0].kind, 'Lead');

    const att = await call('GET', '/api/google/mail/att/m1/att1?name=quote.pdf');
    assert.equal(att.res.headers.get('content-disposition'), 'attachment; filename="quote.pdf"');
    assert.equal(att.data, 'file contents');
  } finally { g.done(); }
});

test('Gmail stays off until the person turns it on, and is never read for someone else', async () => {
  const { env, call } = setup();
  const g = fakeGmail();
  try {
    await owner(call, env, 'openid email https://www.googleapis.com/auth/calendar.events');
    const r = await call('GET', '/api/google/mail/threads');
    assert.equal(r.status, 400);
    assert.match(r.data.error, /Turn on Gmail/);
  } finally { g.done(); }
});

test('full Drive access counts as the narrow Sheets permission, and nothing else does', async () => {
  const { hasScope, APP_SCOPES, grantedApps } = await import('../src/google.js');
  assert.equal(hasScope('https://www.googleapis.com/auth/drive', APP_SCOPES.sheets), true);
  assert.equal(hasScope('https://www.googleapis.com/auth/drive.file', APP_SCOPES.drive), false, 'drive.file is not full Drive');
  assert.equal(hasScope('https://www.googleapis.com/auth/drive.file', APP_SCOPES.sheets), true);
  assert.ok(grantedApps('openid https://www.googleapis.com/auth/gmail.modify').includes('mail'));
  assert.ok(!grantedApps('openid https://www.googleapis.com/auth/gmail.modify').includes('drive'));
});
