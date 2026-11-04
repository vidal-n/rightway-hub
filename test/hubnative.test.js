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
  assert.ok(l.closer_id, 'round robin gave it to someone');
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

// ---------- closers, double booking and the shared team calendar ----------
test('team calendar: closers, double booking guard, invites from the closer, copies on the master calendar', async () => {
  const t = setup({ ...G, RESEND_API_KEY: 're_test' });
  await owner(t);
  await connectGoogle(t, 'openid email https://www.googleapis.com/auth/calendar');
  const me = (await t.call('GET', '/api/me')).data.user;
  // A teammate (the closer) with their own Google connected.
  const kid = 'u_kiron';
  await t.env.DB.prepare("INSERT INTO users (id, email, name, role, job, created_at, pass_hash) VALUES (?, 'kiron@rightwaygrowth.com', 'Kiron Lee', 'team', 'closer', ?, 'x')").bind(kid, Date.now()).run();
  await t.env.DB.prepare("UPDATE users SET google_token = ?, google_email = 'kiron@rightwaygrowth.com', google_scopes = 'openid email https://www.googleapis.com/auth/calendar' WHERE id = ?").bind(await seal(t.env, 'refresh-k'), kid).run();

  const made = [], patched = [], acl = [], master = [];
  let n = 0;
  const f = stubFetch((u, init) => {
    if (u.startsWith('https://oauth2.googleapis.com/token')) return jres({ access_token: `at${String(init.body).includes('refresh-k') ? 'k' : 'v'}`, expires_in: 3600 });
    if (u.includes('/calendars') && init.method === 'POST' && /\/calendars$/.test(u.split('?')[0])) return jres({ id: 'team@group.calendar.google.com', summary: 'Rightway Appointments' });
    if (u.includes('/users/me/calendarList') && init.method === 'POST') return jres({});
    if (u.includes('/acl')) { acl.push(JSON.parse(init.body)); return jres({}); }
    if (u.includes('/calendars/team%40group.calendar.google.com/events')) {
      if (init.method === 'DELETE') { master.push(['del', u]); return new Response(null, { status: 204 }); }
      master.push([init.method, JSON.parse(init.body || '{}')]);
      return jres({ id: `m${++n}` });
    }
    if (u.includes('/calendars/primary/events?conferenceDataVersion=1')) { made.push([init.headers.authorization, JSON.parse(init.body)]); return jres({ id: `ev${++n}`, hangoutLink: 'https://meet.google.com/kkk-kkkk-kkk' }); }
    if (/\/calendars\/primary\/events\/[^?]+\?sendUpdates=all/.test(u)) { patched.push(JSON.parse(init.body)); return jres({ id: 'ev1' }); }
    if (/\/calendars\/primary\/events\/[^?]+$/.test(u)) return jres({ id: 'ev1', attendees: [{ email: 'ana@coastal.com' }] });
    if (u.includes('/calendars/primary/events?')) return jres({ items: [] });
    if (u.includes('resend.com')) return jres({ id: 'e1' });
    return null;
  });
  try {
    // Set up the team calendar: made in the owner's Google, shared with the team.
    let r = await t.call('POST', '/api/team-cal', { name: 'Rightway Appointments' });
    assert.equal(r.status, 200, JSON.stringify(r.data));

    assert.deepEqual(acl.map((a) => [a.scope.value, a.role]), [['kiron@rightwaygrowth.com', 'reader']]);

    const a = (await t.call('POST', '/api/leads', { business: 'Coastal Roof Pros', contact_name: 'Ana Ruiz', phone: '9545550300', email: 'ana@coastal.com', state: 'FL' })).data.lead;
    const b = (await t.call('POST', '/api/leads', { business: 'Diaz Dental', contact_name: 'Bo Diaz', phone: '3055550111', email: 'bo@diaz.com', state: 'FL' })).data.lead;
    const at = new Date(Date.now() + 2 * 864e5); at.setUTCHours(15, 0, 0, 0);
    // The setter books it for Kiron: the invite comes from Kiron's calendar, the team calendar gets "Kiron: Coastal Roof Pros".
    r = await t.call('POST', `/api/leads/${a.id}/meeting`, { start: at.toISOString(), minutes: 30, closer_id: kid });
    assert.equal(r.status, 200);
    assert.equal(r.data.google, true);
    assert.equal(made[0][0], 'Bearer atk', 'sent from the closer’s own Google');
    assert.equal(made[0][1].attendees[0].email, 'ana@coastal.com');
    const copy = master.find(([m, body]) => m === 'POST' && /Coastal/.test(body.summary));
    assert.equal(copy[1].summary, 'Kiron: Coastal Roof Pros');
    assert.equal(copy[1].attendees, undefined, 'the copy invites nobody');
    let l = (await t.call('GET', `/api/leads/${a.id}`)).data.lead;
    assert.equal(l.closer_id, kid);
    assert.equal(l.meet_by, me.id);

    // Same time for Kiron again: refused, unless forced.
    r = await t.call('POST', `/api/leads/${b.id}/meeting`, { start: at.toISOString(), minutes: 30, closer_id: kid });
    assert.equal(r.status, 409);
    assert.equal(r.data.conflict, true);
    assert.match(r.data.error, /Kiron already has Coastal Roof Pros/);
    const free = await t.call('GET', `/api/closers/free?start=${at.getTime()}`);
    assert.ok(free.data.closers.find((c) => c.id === kid).clash);
    assert.equal(free.data.closers.find((c) => c.id === me.id).clash, null);
    // So it goes to the owner instead.
    r = await t.call('POST', `/api/leads/${b.id}/meeting`, { start: at.toISOString(), minutes: 30, closer_id: me.id });
    assert.equal(r.status, 200);

    // Hand Diaz Dental to Kiron: a clash, so it asks first.
    r = await t.call('PUT', `/api/leads/${b.id}/closer`, { closer_id: kid });
    assert.equal(r.status, 409);
    r = await t.call('PUT', `/api/leads/${b.id}/closer`, { closer_id: kid, force: true });
    assert.equal(r.status, 200);
    assert.ok(patched.some((p) => p.attendees.some((x) => x.email === 'kiron@rightwaygrowth.com')), 'Kiron was added to the invite');

    // Hub appointments go on the team calendar too, and leave it when deleted.
    const ev = await t.call('POST', '/api/events', { title: 'Walkthrough with Maria', start: at.getTime() + 3 * 3600e3, minutes: 30 });
    assert.ok(master.some(([m, body]) => m === 'POST' && body.summary === 'Vidal: Walkthrough with Maria'));
    await t.call('DELETE', `/api/events/${ev.data.id}`);
    assert.ok(master.some(([m]) => m === 'del'));

    // The cron keeps it in step: a lead marked lost drops off the team calendar.
    await t.env.DB.prepare("UPDATE leads SET stage = 'lost', meet_at = NULL WHERE id = ?").bind(a.id).run();
    r = await t.call('POST', '/api/team-cal/sync');
    assert.ok(r.data.synced >= 1);
    l = (await t.call('GET', `/api/leads/${a.id}`)).data.lead;
    const row = await t.env.DB.prepare('SELECT master_event_id FROM leads WHERE id = ?').bind(a.id).first();
    assert.equal(row.master_event_id, null);
    const st = await t.call('GET', '/api/team-cal');
    assert.equal(st.data.master.name, 'Rightway Appointments');
  } finally { f.done(); }
});

test('booking page round robin only offers a time to someone free, and books them', async () => {
  const t = setup();
  await owner(t);
  const me = (await t.call('GET', '/api/me')).data.user;
  await t.env.DB.prepare("INSERT INTO users (id, email, name, role, job, created_at, pass_hash) VALUES ('u_k', 'k@rightwaygrowth.com', 'Kiron Lee', 'team', 'closer', ?, 'x')").bind(Date.now()).run();
  await t.call('PUT', '/api/google/booking', { rep: 'rr' });
  let info = await t.anon('/api/public/book').then((x) => x.json());
  const slot = info.slots[0];
  const ok = { business: 'Ace Plumbing', email: 'a@ace.com', phone: '9545550101', city: 'Hollywood', state: 'FL' };
  let r = await t.call('POST', '/api/public/book', { ...ok, name: 'Al Ace', start: slot });
  assert.equal(r.status, 200);
  info = await t.anon('/api/public/book').then((x) => x.json());
  assert.ok(info.slots.includes(slot), 'still open: the other closer is free');
  r = await t.call('POST', '/api/public/book', { ...ok, business: 'Bee Roofing', email: 'b@bee.com', phone: '9545550102', name: 'Bea Bee', start: slot });
  assert.equal(r.status, 200);
  const leads = (await t.call('GET', '/api/leads')).data.leads.filter((l) => l.meet_at === slot);
  assert.deepEqual(new Set(leads.map((l) => l.closer_id)), new Set([me.id, 'u_k']), 'one each, nobody double booked');
  info = await t.anon('/api/public/book').then((x) => x.json());
  assert.ok(!info.slots.includes(slot), 'now everyone is busy then');
  r = await t.call('POST', '/api/public/book', { ...ok, business: 'Cee Co', email: 'c@cee.com', phone: '9545550103', name: 'Cy Cee', start: slot });
  assert.equal(r.status, 409);
});

test('automation sets: switching on texts later does not send late confirmations; a text that cannot go falls back to email', async () => {
  const t = setup({ RESEND_API_KEY: 're_test', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+13055073393' });
  await owner(t);
  let r = await t.call('GET', '/api/automations');
  assert.equal(r.data.set, 'email');
  assert.deepEqual(Object.keys(r.data.sets), ['email', 'sms', 'both']);
  const lead = (await t.call('POST', '/api/leads', { business: 'Coastal Roof Pros', contact_name: 'Ana Ruiz', phone: '9545550300', email: 'ana@coastal.com', state: 'FL' })).data.lead;
  const at = Date.now() + 2 * 864e5;
  await t.env.DB.prepare("UPDATE leads SET stage = 'audit_booked', meet_at = ?, meet_link = 'https://meet.google.com/abc-defg-hij', updated_at = ? WHERE id = ?").bind(at, Date.now() - 600e3, lead.id).run();
  r = await t.call('PUT', '/api/automations', { set: 'both' });
  assert.equal(r.data.set, 'both');
  const skipped = await t.env.DB.prepare("SELECT auto_id FROM automation_log WHERE lead_id = ? AND status = 'skipped'").bind(lead.id).all();
  assert.deepEqual(skipped.results.map((x) => x.auto_id), ['confirm_text_short'], 'already booked: no late text confirmation');
  // Run the cron: the email confirmation still goes (it was already in the email set, never sent yet).
  const sent = [];
  const f = stubFetch((u, init) => { if (u.includes('resend.com')) { sent.push(JSON.parse(init.body)); return jres({ id: 'e' }); } if (u.includes('twilio.com')) return jres({ sid: 'SM1', status: 'queued' }); return null; });
  const { automationTick } = await import('../src/automations.js');
  try { await automationTick(t.env); } finally { f.done(); }
  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /Join the Google Meet/);
  // 10 minutes before, no permission to text yet: the 10 minute text goes as an email.
  sent.length = 0;
  const f2 = stubFetch((u, init) => { if (u.includes('resend.com')) { sent.push(JSON.parse(init.body)); return jres({ id: 'e' }); } return null; });
  try { await automationTick(t.env, at - 9 * 60e3); } finally { f2.done(); }
  const log = await t.env.DB.prepare("SELECT auto_id, status, to_addr FROM automation_log WHERE lead_id = ? AND auto_id = 'ten_min_text'").bind(lead.id).first();
  assert.equal(log.status, 'sent');
  assert.match(log.to_addr, /ana@coastal\.com \(email/);
  assert.ok(sent.some((e) => /super excited to chat with you/.test(e.text)));
});

test('an expired Google sign in raises one alert, and signing in again clears it', async () => {
  const t = setup(G);
  await owner(t);
  await connectGoogle(t, 'openid email https://www.googleapis.com/auth/calendar');
  const { googleHealthTick } = await import('../src/googlecheck.js');
  const f = stubFetch((u) => (u.startsWith('https://oauth2.googleapis.com/token') ? jres({ error: 'invalid_grant' }, 400) : null));
  try {
    assert.equal(await googleHealthTick(t.env), 1);
    assert.equal(await googleHealthTick(t.env), 0, 'checked at most every 6 hours');
    assert.equal(await googleHealthTick(t.env, Date.now() + 7 * 3600e3), 0, 'one alert, not one every run');
  } finally { f.done(); }
  const alerts = (await t.call('GET', '/api/notifications')).data.notifications;
  assert.ok(alerts.some((n) => n.title === 'Google needs a new sign in'));
});

test('agents never reach owner areas: vault, money, exports, company files, automations, settings back end', async () => {
  const t = setup({ STRIPE_SECRET_KEY: 'rk_test' });
  await owner(t);
  const c = (await t.call('POST', '/api/clients', { name: 'Coastal Roof Pros', plan: 'growth' })).data;
  const cid = c.client?.id || c.id;
  await t.env.DB.prepare('UPDATE clients SET mrr_cents = 44900, stripe_customer_id = ? WHERE id = ?').bind('cus_123', cid).run();
  await t.call('POST', '/api/files?name=Contract.pdf&client=&folder=', new Uint8Array([1, 2]), { 'content-type': 'application/pdf' });
  const inv = await t.call('POST', '/api/team/invite', { email: 'kiron@rightwaygrowth.com', name: 'Kiron', role: 'team', job: 'closer' });
  await t.call('POST', '/api/auth/logout', {});
  const acc = await t.call('POST', '/api/auth/invite/accept', { token: inv.data.inviteUrl.split('/#/invite/')[1], name: 'Kiron', password: 'another long password' });
  assert.equal(acc.status, 200);
  for (const [m, path] of [['GET', '/api/vault/me'], ['GET', '/api/vault/items'], ['GET', '/api/payments'], ['GET', '/api/costs'], ['GET', '/api/balances'],
    ['GET', '/api/analytics/master'], ['GET', '/api/automations'], ['GET', '/api/automations/log'], ['GET', '/api/files?client='], ['GET', `/api/clients/${cid}/billing`],
    ['POST', '/api/google/sheets/export'], ['PUT', '/api/settings'], ['GET', '/api/stripe/setup'], ['GET', '/api/voice/setup']]) {
    const r = await t.call(m, path, m === 'GET' ? undefined : {});
    assert.ok([401, 403].includes(r.status), `${m} ${path} gave ${r.status}`);
  }
  const s = (await t.call('GET', '/api/settings')).data;
  assert.equal(s.links, undefined, 'no payment links');
  assert.equal(s.connected, undefined, 'no connection details');
  assert.ok('script' in s, 'the script still loads for the dialer');
  const list = (await t.call('GET', '/api/clients')).data.clients;
  assert.equal(list[0].mrr_cents, null);
  assert.equal(list[0].stripe_customer_id, null);
  assert.equal((await t.call('GET', `/api/clients/${cid}`)).data.client?.mrr_cents ?? null, null);
  assert.equal((await t.call('GET', '/api/dashboard')).data.clients.mrr, null);
  // Client folders stay open to the team.
  assert.equal((await t.call('GET', `/api/files?client=${cid}`)).status, 200);
});

// ---------- jobs: closer, scheduler, appointment setter ----------
test('jobs: setters book for closers, schedulers manage every appointment, only closers close and work with clients', async () => {
  const t = setup();
  await owner(t);
  const c = (await t.call('POST', '/api/clients', { name: 'Coastal Roof Pros', plan: 'growth' })).data;
  const cid = c.client?.id || c.id;
  const invite = async (name, job) => (await t.call('POST', '/api/team/invite', { email: `${name}@rightwaygrowth.com`, name, role: 'team', job })).data.inviteUrl.split('/#/invite/')[1];
  const tokens = { sam: await invite('sam'), sky: await invite('sky', 'scheduler'), cole: await invite('cole', 'closer') };
  const team = (await t.call('GET', '/api/team')).data.users;
  const id = (n) => team.find((u) => u.name === n).id;
  assert.equal(team.find((u) => u.name === 'sam').job, 'setter', 'no job picked means appointment setter');
  assert.equal((await t.call('PUT', `/api/users/${id('sam')}/job`, { job: 'boss' })).status, 400);
  const lead = (await t.call('POST', '/api/leads', { business: 'Smile Dental', phone: '3055550101', city: 'Miami' })).data.lead;
  const lead2 = (await t.call('POST', '/api/leads', { business: 'Bright Smiles', phone: '3055550102', city: 'Miami' })).data.lead;
  await t.call('POST', '/api/auth/logout', {});
  for (const [n, tok] of Object.entries(tokens)) assert.equal((await t.call('POST', '/api/auth/invite/accept', { token: tok, password: 'another long password' })).status, 200, n);
  const as = (n) => t.call('POST', '/api/auth/login', { email: `${n}@rightwaygrowth.com`, password: 'another long password' });

  // Appointment setter: calls and books, no client work, no closing, never runs the call.
  await as('sam');
  assert.equal((await t.call('GET', '/api/auth/state')).data.user.job, 'setter');
  for (const [m, path] of [['GET', '/api/clients'], ['GET', `/api/clients/${cid}`], ['GET', '/api/work'], ['PUT', `/api/leads/${lead.id}/quote`], ['POST', `/api/leads/${lead.id}/work-order`], ['POST', `/api/leads/${lead.id}/payment-link`], ['POST', `/api/leads/${lead.id}/convert`]]) {
    assert.equal((await t.call(m, path, m === 'GET' ? undefined : {})).status, 403, `${m} ${path}`);
  }
  assert.equal((await t.call('GET', '/api/clients', undefined, { 'x-view-as': cid })).status, 403, 'no client view either');
  const closers = (await t.call('GET', '/api/closers/free')).data.closers.map((x) => x.id);
  assert.ok(closers.includes(id('cole')) && !closers.includes(id('sam')) && !closers.includes(id('sky')), 'only closers and owners run calls');
  const start = Date.now() + 2 * 864e5;
  const b = await t.call('POST', `/api/leads/${lead.id}/meeting`, { start: new Date(start).toISOString(), minutes: 30 });
  assert.equal(b.status, 200);
  assert.equal(b.data.closer_id, id('cole'), 'a setter booking goes to the free closer');
  assert.equal((await t.call('POST', `/api/leads/${lead.id}/meeting`, { start: new Date(start).toISOString(), closer_id: id('sam') })).status, 400, 'a setter cannot run the call');

  // Scheduler: sees and hands over everyone's appointments.
  await as('sky');
  const up = (await t.call('GET', '/api/calendar/upcoming')).data.meetings || [];
  assert.ok(up.some((m) => m.id === lead.id), 'schedulers see appointments others booked');
  assert.equal((await t.call('GET', '/api/clients')).status, 403);
  const me = (await t.call('GET', '/api/me')).data.user;
  assert.equal(me.job, 'scheduler');

  // Another setter booked lead2; sam cannot move or hand over someone else's appointment.
  const b2 = await t.call('POST', `/api/leads/${lead2.id}/meeting`, { start: new Date(start + 3 * 3600e3).toISOString(), closer_id: id('cole') });
  assert.equal(b2.status, 200);
  await as('sam');
  assert.equal((await t.call('PUT', `/api/leads/${lead2.id}/closer`, { closer_id: id('cole') })).status, 403);
  assert.equal((await t.call('POST', `/api/leads/${lead2.id}/meeting`, { start: new Date(start + 5 * 3600e3).toISOString() })).status, 403);
  const mine = (await t.call('GET', '/api/calendar/upcoming')).data.meetings || [];
  assert.ok(mine.some((m) => m.id === lead.id) && !mine.some((m) => m.id === lead2.id), 'setters see only their own');
  await as('sky');
  assert.equal((await t.call('PUT', `/api/leads/${lead2.id}/closer`, { closer_id: null })).status, 200, 'schedulers hand over anyone');

  // Closer: client work and closing.
  await as('cole');
  assert.equal((await t.call('GET', '/api/clients')).status, 200);
  assert.equal((await t.call('GET', '/api/work')).status, 200);
  assert.notEqual((await t.call('PUT', `/api/leads/${lead.id}/quote`, { setup: 399, monthly: 399, services: [] })).status, 403);
});
