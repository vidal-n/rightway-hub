import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { icsCalendar, googleAddUrl, stamp } from '../public/js/ics.js';
import { bodyHtml, fromFor } from '../src/hubmail.js';
import { d1, r2 } from './shims.mjs';

function setup(extra = {}) {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', ...extra };
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const h = { 'x-rw': '1', ...headers };
    if (cookie) h.cookie = cookie;
    let payload;
    if (typeof body === 'string' || body instanceof Uint8Array) payload = body;
    else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text(), res };
  };
  const anon = (path) => worker.fetch(new Request(`https://hub.test${path}`), env);
  return { env, call, anon };
}
const owner = (t) => t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'Vidal Newton', password: 'correct horse battery' });

test('ics: escapes text, folds long lines, builds Google links', () => {
  const s = icsCalendar([{ uid: 'a1', title: 'Call, Smile; Dental', start: Date.UTC(2026, 10, 5, 15, 0), minutes: 45, description: 'x'.repeat(300), location: 'https://meet.example/abc' }]);
  assert.match(s, /^BEGIN:VCALENDAR\r\n/);
  assert.match(s, /SUMMARY:Call\\, Smile\\; Dental\r\n/);
  assert.match(s, /DTSTART:20261105T150000Z\r\nDTEND:20261105T154500Z/);
  assert.ok(s.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
  assert.match(icsCalendar([], { method: 'REQUEST' }), /METHOD:REQUEST/);
  assert.equal(stamp(Date.UTC(2026, 0, 2, 3, 4, 5)), '20260102T030405Z');
  const u = new URL(googleAddUrl({ title: 'Hi', start: Date.UTC(2026, 10, 5, 15), minutes: 30 }));
  assert.equal(u.searchParams.get('dates'), '20261105T150000Z/20261105T153000Z');
});

test('appointments: add, edit, feed link, invite with attachment, delete', async () => {
  const t = setup({ RESEND_API_KEY: 're_test' });
  await owner(t);
  const start = Date.now() + 2 * 864e5;
  assert.equal((await t.call('POST', '/api/events', { title: '', start })).status, 400);
  assert.equal((await t.call('POST', '/api/events', { title: 'x', start: 5 })).status, 400);
  assert.equal((await t.call('POST', '/api/events', { title: 'x', start, link: 'ftp://no' })).status, 400);

  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (String(url).includes('resend.com')) { sent.push(JSON.parse(init.body)); return Response.json({ id: 'e1' }); } return realFetch(url, init); };
  let id;
  try {
    const r = await t.call('POST', '/api/events', { title: 'Call with Maria', start, minutes: 30, guest_email: 'maria@smile.com', link: 'https://meet.google.com/abc', note: 'Bring the scan', invite: true });
    assert.equal(r.status, 200);
    assert.equal(r.data.invited, true);
    id = r.data.id;
  } finally { globalThis.fetch = realFetch; }
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['maria@smile.com']);
  assert.equal(sent[0].reply_to, 'v@rightwaygrowth.com');
  assert.match(sent[0].attachments[0].content_type, /text\/calendar/);
  assert.match(atob(sent[0].attachments[0].content), /METHOD:REQUEST[\s\S]*SUMMARY:Call with Maria/);

  let list = await t.call('GET', `/api/appointments?from=${start - 864e5}&to=${start + 864e5}`);
  assert.equal(list.data.items.length, 1);
  assert.equal(list.data.items[0].kind, 'event');
  assert.equal(list.data.items[0].edit, true);
  assert.equal((await t.call('PUT', `/api/events/${id}`, { title: 'Call with Maria (moved)', start: start + 36e5 })).status, 200);
  list = await t.call('GET', `/api/appointments?from=${start - 864e5}&to=${start + 864e5}`);
  assert.equal(list.data.items[0].title, 'Call with Maria (moved)');

  const feed = await t.call('GET', '/api/me/calendar-feed');
  assert.match(feed.data.url, /\/api\/public\/cal\/.{20,}\.ics$/);
  assert.match(feed.data.webcal, /^webcal:\/\//);
  const path = new URL(feed.data.url).pathname;
  const ics = await t.anon(path); // no login: calendar apps cannot log in
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get('content-type'), /text\/calendar/);
  assert.match(await ics.text(), /SUMMARY:Call with Maria \(moved\)/);
  assert.equal((await t.anon('/api/public/cal/nope.ics')).status, 404);
  const fresh = await t.call('POST', '/api/me/calendar-feed');
  assert.notEqual(fresh.data.url, feed.data.url);
  assert.equal((await t.anon(path)).status, 404);
  assert.equal((await t.anon(new URL(fresh.data.url).pathname)).status, 200);

  assert.equal((await t.call('DELETE', `/api/events/${id}`)).status, 200);
  assert.equal((await t.call('GET', `/api/appointments?from=${start - 864e5}&to=${start + 864e5}`)).data.items.length, 0);
});

test('files: upload, folders, move, share link, delete', async () => {
  const t = setup();
  await owner(t);
  assert.equal((await t.anon('/api/files')).status, 401);
  const up = await t.call('POST', '/api/files?name=Plan.pdf&client=&folder=', new Uint8Array([37, 80, 68, 70]), { 'content-type': 'application/pdf' });
  assert.equal(up.status, 200);
  const fd = await t.call('POST', '/api/files/folder', { name: 'Contracts' });
  let r = await t.call('GET', '/api/files?client=&folder=');
  assert.equal(r.data.files.length, 1);
  assert.equal(r.data.folders[0].name, 'Contracts');
  assert.equal((await t.call('PATCH', `/api/files/${up.data.id}`, { folder_id: fd.data.id })).status, 200);
  r = await t.call('GET', `/api/files?client=&folder=${fd.data.id}`);
  assert.equal(r.data.files[0].name, 'Plan.pdf');
  assert.equal(r.data.crumbs[0].name, 'Contracts');
  assert.equal((await t.call('DELETE', `/api/files/folder/${fd.data.id}`)).status, 400); // not empty
  assert.equal((await t.call('GET', '/api/files?client=&q=plan')).data.files.length, 1);
  assert.equal((await t.call('POST', '/api/files?name=a.txt&client=&folder=', new Uint8Array(0))).status, 400);

  const dl = await t.call('GET', `/api/files/${up.data.id}/download?view=1`);
  assert.equal(dl.status, 200);
  assert.equal(dl.res.headers.get('content-type'), 'application/pdf');
  const sh = await t.call('POST', `/api/files/${up.data.id}/share`, {});
  assert.ok(sh.data.token.length >= 20);
  const pub = await t.anon(`/api/public/f/${sh.data.token}`);
  assert.equal(pub.status, 200);
  assert.equal((await t.anon('/api/public/f/short')).status, 404);
  await t.call('POST', `/api/files/${up.data.id}/share`, { on: false });
  assert.equal((await t.anon(`/api/public/f/${sh.data.token}`)).status, 404);

  assert.equal((await t.call('DELETE', `/api/files/${up.data.id}`)).status, 200);
  assert.equal((await t.call('DELETE', `/api/files/folder/${fd.data.id}`)).status, 200);
});

test('mail: sends under your name with reply-to, logs it, needs email set up', async () => {
  assert.match(fromFor({ EMAIL_FROM: 'Rightway Growth <hello@rightwaygrowth.com>' }, { name: 'Vidal, "V" Newton' }), /^Vidal V Newton \(Rightway Growth\) <hello@rightwaygrowth\.com>$/);
  assert.match(bodyHtml('Hi <b>\n\nSee https://example.com/x.'), /&lt;b&gt;[\s\S]*<a href="https:\/\/example\.com\/x">/);

  const none = setup();
  await owner(none);
  assert.equal((await none.call('POST', '/api/mail/send', { to: 'a@b.com', subject: 's', body: 'b' })).status, 503);

  const t = setup({ RESEND_API_KEY: 're_test' });
  await owner(t);
  assert.equal((await t.call('POST', '/api/mail/send', { to: 'nope', subject: 's', body: 'b' })).status, 400);
  assert.equal((await t.call('POST', '/api/mail/send', { to: 'a@b.com', subject: '', body: 'b' })).status, 400);
  const lead = await t.call('POST', '/api/leads', { business: 'Smile Dental', phone: '9545550101', email: 'maria@smile.com' });
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (String(url).includes('resend.com')) { sent.push(JSON.parse(init.body)); return Response.json({ id: 'e1' }); } return realFetch(url, init); };
  let r;
  try { r = await t.call('POST', '/api/mail/send', { to: 'maria@smile.com, other@x.com', subject: 'Hello', body: 'Line one\n\nLine two' }); } finally { globalThis.fetch = realFetch; }
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.sent, ['maria@smile.com', 'other@x.com']);
  assert.equal(sent.length, 2); // one email each, nobody sees the other's address
  assert.equal(sent[0].reply_to, 'v@rightwaygrowth.com');
  assert.match(sent[0].from, /^Vidal Newton \(Rightway Growth\) </);
  const log = await t.call('GET', '/api/mail/sent?email=maria@smile.com');
  assert.equal(log.data.mail.length, 1);
  assert.equal(log.data.mail[0].status, 'sent');
  const id = lead.data.lead?.id || lead.data.id;
  const detail = await t.call('GET', `/api/leads/${id}`);
  assert.ok(JSON.stringify(detail.data).includes('Email sent: Hello'));
  const ppl = await t.call('GET', '/api/mail/people?q=smile');
  assert.equal(ppl.data.people[0].email, 'maria@smile.com');
});
