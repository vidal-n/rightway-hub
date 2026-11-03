import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, run, first } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
import {
  DAY, startOfDay, startOfWeek, addDays, addMonths, sameDay, monthGrid, weekGrid,
  eventTimes, slimEvent, eventsOn, layoutDay, allDayOn, clockLabel, spanLabel, inputValue, freeGaps,
} from '../public/js/calgrid.js';

const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();

test('the month grid is six weeks that start on Sunday', () => {
  const g = monthGrid(at(2026, 11, 15));
  assert.equal(g.length, 42);
  assert.equal(new Date(g[0].day).getDay(), 0);
  assert.equal(new Date(g[0].day).getDate(), 1, 'November 2026 starts on a Sunday');
  assert.equal(g.filter((c) => c.inMonth).length, 30);
  assert.equal(g[41].inMonth, false);
});

test('week, day and month steps land where you expect', () => {
  assert.equal(new Date(startOfWeek(at(2026, 11, 4))).getDate(), 1);
  assert.equal(new Date(addDays(at(2026, 11, 30), 1)).getMonth(), 11);
  assert.equal(new Date(addMonths(at(2026, 1, 31), 1)).getMonth(), 1, 'the 31st does not spill past February');
  assert.equal(sameDay(at(2026, 11, 3, 1), at(2026, 11, 3, 23)), true);
  assert.equal(weekGrid(at(2026, 11, 4)).length, 7);
});

test('an all-day event covers the right days', () => {
  const t = eventTimes({ start: { date: '2026-11-03' }, end: { date: '2026-11-05' } });
  assert.equal(t.allDay, true);
  assert.equal(t.end - t.start, 2 * DAY);
  const one = eventTimes({ start: { date: '2026-11-03' }, end: { date: '2026-11-03' } });
  assert.equal(one.end - one.start, DAY, 'a same-day entry still fills its day');
  const timed = eventTimes({ start: { dateTime: new Date(at(2026, 11, 3, 9)).toISOString() }, end: { dateTime: new Date(at(2026, 11, 3, 10)).toISOString() } });
  assert.equal(timed.allDay, false);
  assert.equal(timed.end - timed.start, 36e5);
});

test('a Google event is slimmed down to what the page needs', () => {
  const e = slimEvent({
    id: 'e1', summary: 'Audit call', location: 'Google Meet', htmlLink: 'https://cal/e1',
    start: { dateTime: new Date(at(2026, 11, 3, 14)).toISOString() }, end: { dateTime: new Date(at(2026, 11, 3, 14, 30)).toISOString() },
    hangoutLink: 'https://meet.google.com/abc',
    attendees: [{ email: 'jane@x.com', displayName: 'Jane', responseStatus: 'accepted' }],
    organizer: { email: 'v@rightwaygrowth.com', self: true },
    extendedProperties: { private: { rwLead: 'l_1' } },
  }, 'primary', '#23B07E');
  assert.equal(e.title, 'Audit call');
  assert.equal(e.meet, 'https://meet.google.com/abc');
  assert.equal(e.leadId, 'l_1');
  assert.equal(e.mine, true);
  assert.equal(e.attendees[0].reply, 'accepted');
  assert.equal(e.color, '#23B07E');
});

test('events are picked per day, all-day first', () => {
  const mk = (s, e, allDay = false, title = '') => ({ id: title, title, start: s, end: e, allDay, busy: true });
  const events = [
    mk(at(2026, 11, 3, 14), at(2026, 11, 3, 15), false, 'afternoon'),
    mk(at(2026, 11, 3), at(2026, 11, 4), true, 'holiday'),
    mk(at(2026, 11, 2, 23), at(2026, 11, 3, 1), false, 'overnight'),
    mk(at(2026, 11, 5, 9), at(2026, 11, 5, 10), false, 'later'),
  ];
  const day = eventsOn(events, at(2026, 11, 3, 12));
  assert.deepEqual(day.map((e) => e.title), ['holiday', 'overnight', 'afternoon']);
  assert.deepEqual(allDayOn(events, at(2026, 11, 3)).map((e) => e.title), ['holiday']);
});

test('overlapping events sit side by side', () => {
  const mk = (h, h2, title) => ({ id: title, title, start: at(2026, 11, 3, h), end: at(2026, 11, 3, h2), allDay: false, busy: true });
  const laid = layoutDay([mk(9, 10, 'a'), mk(9, 11, 'b'), mk(10, 11, 'c'), mk(14, 15, 'alone')], at(2026, 11, 3));
  const by = Object.fromEntries(laid.map((e) => [e.title, e]));
  assert.equal(by.a.col, 0);
  assert.equal(by.b.col, 1);
  assert.equal(by.a.of, 2, 'a shares its hour with b');
  assert.equal(by.c.col, 0, 'c reuses the column a left');
  assert.equal(by.alone.of, 1, 'an event on its own takes the full width');
  assert.ok(Math.abs(by.a.top - 9 / 24) < 1e-9);
  assert.ok(Math.abs(by.a.height - 1 / 24) < 1e-9);
});

test('times read the way people say them', () => {
  assert.equal(clockLabel(at(2026, 11, 3, 14, 30)), '2:30pm');
  assert.equal(clockLabel(at(2026, 11, 3, 9, 0), false), '9am');
  assert.equal(clockLabel(at(2026, 11, 3, 0, 0)), '12:00am');
  assert.equal(spanLabel({ allDay: true }), 'All day');
  assert.equal(spanLabel({ start: at(2026, 11, 3, 9), end: at(2026, 11, 3, 9, 30) }), '9:00am to 9:30am');
  assert.equal(inputValue(at(2026, 11, 3, 9, 5)), '2026-11-03T09:05');
});

test('free gaps skip what is booked and ignore short slivers', () => {
  const mk = (h, h2, busy = true) => ({ id: `${h}`, start: at(2026, 11, 3, h), end: at(2026, 11, 3, h2), allDay: false, busy });
  const gaps = freeGaps([mk(10, 11), mk(13, 14), mk(14, 14, false)], at(2026, 11, 3));
  assert.deepEqual(gaps.map((g) => clockLabel(g.start)), ['9:00am', '11:00am', '2:00pm']);
  assert.equal(clockLabel(gaps[gaps.length - 1].end), '5:00pm');
  const packed = freeGaps([mk(9, 16)], at(2026, 11, 3), { minutes: 90 });
  assert.equal(packed.length, 0, 'the one free hour is too short for a 90 minute meeting');
});

// ---------- the routes, with Google faked ----------
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

function fakeCal() {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? (() => { try { return JSON.parse(init.body); } catch { return init.body; } })() : null;
    calls.push({ u, body, method: init.method || 'GET' });
    const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('oauth2.googleapis.com/token')) return j({ access_token: 'at1', expires_in: 3600 });
    if (u.includes('/calendarList')) return j({ items: [
      { id: 'primary', summary: 'V', primary: true, accessRole: 'owner', backgroundColor: '#23B07E', selected: true },
      { id: 'team@group.calendar.google.com', summary: 'Rightway team', accessRole: 'writer', backgroundColor: '#E8A33D', selected: true },
      { id: 'holidays', summary: 'Holidays', accessRole: 'reader', backgroundColor: '#888', selected: false },
    ] });
    if (u.includes('/events?') && (init.method || 'GET') === 'GET') {
      const mine = u.includes('primary');
      return j({ items: mine ? [{
        id: 'e1', summary: 'Audit call', status: 'confirmed',
        start: { dateTime: new Date(at(2026, 11, 3, 14)).toISOString() }, end: { dateTime: new Date(at(2026, 11, 3, 14, 30)).toISOString() },
        hangoutLink: 'https://meet.google.com/abc', organizer: { email: 'v@rightwaygrowth.com', self: true },
        extendedProperties: { private: { rwLead: 'l_1' } },
      }, { id: 'gone', status: 'cancelled', start: { dateTime: new Date().toISOString() }, end: { dateTime: new Date().toISOString() } }] : [] });
    }
    if (u.includes('/events') && init.method === 'POST') return j({ id: 'new1', summary: body.summary, start: body.start, end: body.end, hangoutLink: 'https://meet.google.com/new' });
    if (u.includes('/events/') && init.method === 'PATCH') return j({ id: 'e1', summary: body.summary || 'Audit call', start: body.start, end: body.end });
    if (u.includes('/events/') && init.method === 'DELETE') return new Response(null, { status: 200 });
    return j({});
  };
  return { calls, done: () => { globalThis.fetch = real; } };
}

async function owner(call, env) {
  await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', name: 'V', email: 'v@rightwaygrowth.com', password: 'correct horse battery' });
  const me = await first(env, 'SELECT * FROM users LIMIT 1');
  const { seal } = await import('../src/google.js');
  await run(env, 'UPDATE users SET google_token = ?, google_email = ?, google_scopes = ? WHERE id = ?',
    await seal(env, 'refresh-1'), 'v@rightwaygrowth.com', 'openid email https://www.googleapis.com/auth/calendar.events', me.id);
  return me;
}

test('Calendar: list calendars, read events, add, change and delete', async () => {
  const { env, call } = setup();
  const g = fakeCal();
  try {
    await owner(call, env);
    await run(env, 'INSERT INTO leads (id, business, stage, attempts, dnc, sms_consent, created_at, updated_at) VALUES (?,?,?,0,0,0,?,?)',
      'l_1', 'Sunrise Plumbing', 'new', Date.now(), Date.now());

    const cals = await call('GET', '/api/google/cal/calendars');
    assert.equal(cals.data.calendars.length, 3);
    assert.equal(cals.data.calendars[0].primary, true);
    assert.equal(cals.data.calendars[2].canWrite, false, 'a read-only calendar is marked');

    const evs = await call('GET', `/api/google/cal/events?from=${at(2026, 11, 1)}&to=${at(2026, 12, 1)}&cals=primary,team@group.calendar.google.com`);
    assert.equal(evs.data.events.length, 1, 'cancelled events are dropped');
    assert.equal(evs.data.events[0].meet, 'https://meet.google.com/abc');
    assert.equal(evs.data.leads[0].business, 'Sunrise Plumbing', 'the event names its lead');

    const made = await call('POST', '/api/google/cal/events', {
      title: 'Audit for Webb Roofing', start: at(2026, 11, 10, 15), end: at(2026, 11, 10, 15, 30),
      meet: true, attendees: ['marcus@webbroofing.com'], leadId: 'l_2', notes: 'Bring the grid',
    });
    assert.equal(made.status, 200);
    const post = g.calls.find((c) => c.method === 'POST' && c.u.includes('/events'));
    assert.equal(post.body.summary, 'Audit for Webb Roofing');
    assert.equal(post.body.attendees[0].email, 'marcus@webbroofing.com');
    assert.ok(post.body.conferenceData.createRequest, 'a Meet link is asked for');
    assert.equal(post.body.extendedProperties.private.rwLead, 'l_2');
    assert.ok(post.u.includes('sendUpdates=all'), 'guests get the invite');

    const moved = await call('PATCH', '/api/google/cal/events/e1', { move: true, start: at(2026, 11, 4, 9), end: at(2026, 11, 4, 9, 30), calendarId: 'primary' });
    assert.equal(moved.status, 200);
    const del = await call('DELETE', '/api/google/cal/events/e1?calendarId=primary');
    assert.equal(del.status, 200);
  } finally { g.done(); }
});

test('an all-day event is sent as plain dates', async () => {
  const { env, call } = setup();
  const g = fakeCal();
  try {
    await owner(call, env);
    await call('POST', '/api/google/cal/events', { title: 'Out of office', start: at(2026, 11, 20), end: at(2026, 11, 22), allDay: true });
    const post = g.calls.find((c) => c.method === 'POST' && c.u.includes('/events'));
    assert.equal(post.body.start.date, '2026-11-20');
    assert.ok(!post.body.start.dateTime);
  } finally { g.done(); }
});

test('an event with no start is refused', async () => {
  const { env, call } = setup();
  const g = fakeCal();
  try {
    await owner(call, env);
    const r = await call('POST', '/api/google/cal/events', { title: 'No when' });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /When does it start/);
  } finally { g.done(); }
});
