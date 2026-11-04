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

// ---------- Google first booking, personal links, and the connection check ----------
import { seal } from '../src/google.js';
import { bookingProblem } from '../src/google.js';

const G = { GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'sec' };
const jres = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
async function connectGoogle(t, scopes) {
  await t.env.DB.prepare('UPDATE users SET google_token = ?, google_email = ?, google_scopes = ?').bind(await seal(t.env, 'refresh-1'), 'vidal@rightwaygrowth.com', scopes).run();
}
function stubFetch(handler) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init = {}) => { const u = String(url); seen.push([u, init]); const r = await handler(u, init); return r || real(url, init); };
  return { seen, done: () => { globalThis.fetch = real; } };
}

test('bookingProblem names the first missing or wrong field', () => {
  const ok = { name: 'Ana', business: 'Coastal', email: 'a@c.com', phone: '(954) 555-0100', city: 'Hollywood', state: 'Florida', start: 1 };
  assert.equal(bookingProblem(ok), null);
  assert.equal(bookingProblem({ ...ok, business: ' ' }).field, 'business');
  assert.equal(bookingProblem({ ...ok, phone: '1 954 555 0100' }), null);
  assert.equal(bookingProblem({ ...ok, phone: '555-0100' }).field, 'phone');
  assert.equal(bookingProblem({ ...ok, state: 'Narnia' }).field, 'state');
  assert.equal(bookingProblem({ ...ok, start: 0 }).field, 'time');
});

test('connection check: an old events-only sign in is told exactly how to fix Calendar', async () => {
  const t = setup(G);
  await owner(t);
  await connectGoogle(t, 'openid email https://www.googleapis.com/auth/calendar.events');
  const f = stubFetch((u) => (u.startsWith('https://oauth2.googleapis.com/token') ? jres({ access_token: 'at', expires_in: 3600 }) : jres({})));
  let r;
  try { r = await t.call('GET', '/api/google/check'); } finally { f.done(); }
  const cal = r.data.results.find((x) => x.app === 'calendar');
  assert.equal(cal.ok, false);
  assert.match(cal.reason, /full Calendar access/);
  assert.match(cal.fix, /Turn on all/);
  // After signing in again with the full scope, Calendar is checked against Google and works.
  await connectGoogle(t, 'openid email https://www.googleapis.com/auth/calendar');
  const f2 = stubFetch((u) => (u.startsWith('https://oauth2.googleapis.com/token') ? jres({ access_token: 'at', expires_in: 3600 }) : jres({ items: [] })));
  try { r = await t.call('GET', '/api/google/check'); } finally { f2.done(); }
  assert.equal(r.data.results.find((x) => x.app === 'calendar').ok, true);
  const st = await t.call('GET', '/api/google/status');
  assert.ok(st.data.apps.includes('calendar'));
});

test('an expired Google sign in says why (7 day Testing limit)', async () => {
  const t = setup(G);
  await owner(t);
  await connectGoogle(t, 'openid email https://www.googleapis.com/auth/calendar');
  const f = stubFetch((u) => (u.startsWith('https://oauth2.googleapis.com/token') ? jres({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400) : jres({})));
  let r;
  try { r = await t.call('GET', '/api/google/check'); } finally { f.done(); }
  assert.match(r.data.summary, /7 days/);
});

test('booking: personal link fills in, Google invite with Meet, rep assigned, confirmation sent at once', async () => {
  const t = setup({ ...G, RESEND_API_KEY: 're_test' });
  await owner(t);
  await connectGoogle(t, 'openid email https://www.googleapis.com/auth/calendar');
  await t.call('PUT', '/api/google/booking', { rep: 'rr', link: 'https://zoom.us/j/123' });
  assert.equal((await t.call('PUT', '/api/google/booking', { link: 'http://insecure' })).status, 400);
  const lead = (await t.call('POST', '/api/leads', { business: 'Coastal Roof Pros', contact_name: 'Ana Ruiz', phone: '9545550300', email: 'ana@coastal.com' })).data.lead;
  const link = (await t.call('GET', `/api/leads/${lead.id}/book-link`)).data.url;
  const tok = new URL(link).searchParams.get('l');
  assert.ok(tok.length >= 16);
  assert.equal((await t.call('GET', `/api/leads/${lead.id}/book-link`)).data.url, link, 'the same link every time');

  const emails = [];
  const f = stubFetch((u, init) => {
    if (u.startsWith('https://oauth2.googleapis.com/token')) return jres({ access_token: 'at', expires_in: 3600 });
    if (u.includes('/calendars/primary/events?conferenceDataVersion=1')) return jres({ id: 'ev1', htmlLink: 'https://calendar.google.com/x', hangoutLink: 'https://meet.google.com/abc-defg-hij' });
    if (u.includes('/calendars/primary/events?')) return jres({ items: [] });
    if (u.includes('resend.com')) { emails.push(JSON.parse(init.body)); return jres({ id: 'e1' }); }
    return null;
  });
  try {
    const info = await t.anon(`/api/public/book?l=${tok}`).then((x) => x.json());
    assert.equal(info.google, true);
    assert.equal(info.lead.name, 'Ana Ruiz');
    assert.equal(info.lead.business, 'Coastal Roof Pros');
    assert.equal(info.lead.city, '', 'missing details come back empty so the page asks for them');
    assert.deepEqual(info.required, ['name', 'business', 'email', 'phone', 'city', 'state']);
    const r = await t.call('POST', '/api/public/book', { lead_token: tok, name: 'Ana Ruiz', business: 'Coastal Roof Pros', email: 'ana@coastal.com', phone: '9545550300', city: 'Hollywood', state: 'FL', start: info.slots[0], tz: 'America/New_York', sms_consent: true });
    assert.equal(r.status, 200);
    assert.equal(r.data.google, true);
    assert.equal(r.data.meet, 'https://meet.google.com/abc-defg-hij');
  } finally { f.done(); }
  const d = (await t.call('GET', `/api/leads/${lead.id}`)).data;
  const l = d.lead || d;
  assert.equal(l.city, 'Hollywood', 'what they typed fills the gap');
  assert.equal(l.stage, 'audit_booked');
  assert.ok(l.meet_by, 'round robin gave it to someone');
  assert.equal(l.sms_consent, 1);
  const leads = (await t.call('GET', '/api/leads')).data.leads;
  assert.equal(leads.length, 1, 'the personal link books the same lead, no duplicate');
  // Google sent its own invite, so the confirmation email carries no second calendar file.
  const confirm = emails.find((e) => /booked/i.test(e.subject));
  assert.ok(confirm, 'confirmation email went out during the booking');
  assert.equal(confirm.attachments, undefined);
});

test('booking still works when Google fails, with the backup link and a calendar file', async () => {
  const t = setup({ ...G, RESEND_API_KEY: 're_test' });
  await owner(t);
  await connectGoogle(t, 'openid email https://www.googleapis.com/auth/calendar');
  await t.call('PUT', '/api/google/booking', { link: 'https://zoom.us/j/123' });
  const emails = [];
  const f = stubFetch((u, init) => {
    if (u.startsWith('https://oauth2.googleapis.com/token')) return jres({ error: 'invalid_grant' }, 400);
    if (u.includes('resend.com')) { emails.push(JSON.parse(init.body)); return jres({ id: 'e1' }); }
    return null;
  });
  let r;
  try {
    const info = await t.anon('/api/public/book').then((x) => x.json());
    r = await t.call('POST', '/api/public/book', { name: 'Bo Diaz', business: 'Diaz Dental', email: 'bo@diaz.com', phone: '3055550111', city: 'Miami', state: 'FL', start: info.slots[0] });
  } finally { f.done(); }
  assert.equal(r.status, 200);
  assert.equal(r.data.google, false);
  assert.equal(r.data.meet, 'https://zoom.us/j/123');
  const confirm = emails.find((e) => /booked/i.test(e.subject));
  assert.ok(confirm);
  assert.match(atob(confirm.attachments[0].content), /BEGIN:VEVENT[\s\S]*LOCATION:https:\/\/zoom\.us\/j\/123/);
  assert.match(confirm.text, /calendar\.google\.com\/calendar\/render/);
  const alerts = (await t.call('GET', '/api/notifications')).data.notifications;
  assert.ok(alerts.some((n) => /Google Calendar failed/.test(n.body || '')), 'the team is told Google failed');
});
