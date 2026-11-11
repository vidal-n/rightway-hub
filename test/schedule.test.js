import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBlocks, ownerWeek, setterWeek, STARTERS, nowAndNext, totals, blocksOn, toMin, fmtMin, dowOf, hoursText } from '../public/js/schedule.js';

test('V\'s week: starts 8:45, 200 dials every weekday, ends between 6 and 8 pm, nothing overlaps', () => {
  const v = validateBlocks(ownerWeek());
  assert.equal(v.ok, true, v.error);
  const blocks = v.blocks;
  for (let d = 1; d <= 5; d++) {
    const day = blocksOn(blocks, d);
    assert.equal(day[0].start_min, toMin('08:45'), `day ${d} starts at 8:45`);
    const end = day[day.length - 1].end_min;
    assert.ok(end >= toMin('18:00') && end <= toMin('20:00'), `day ${d} ends between 6 and 8 pm`);
    assert.equal(totals(blocks, d).goalDials, 200, `day ${d} dial goal`);
    assert.ok(totals(blocks, d).per.dial >= 4.5 * 60, 'about four and a half hours on the phone');
    assert.ok(day.some((b) => b.kind === 'build' || b.kind === 'plan'), 'build time every weekday evening, a review on Friday');
    assert.ok(day.some((b) => b.kind === 'meeting'), 'meetings window every weekday');
  }
  // Building, scaling and planning have homes outside dial hours too.
  assert.ok(blocksOn(blocks, 6).some((b) => b.kind === 'build'));
  assert.ok(blocksOn(blocks, 7).some((b) => b.kind === 'plan'));
  assert.ok(blocks.some((b) => /hiring|Scale/.test(b.title)), 'scaling block');
});

test('a new teammate starts blank, with an optional setter starter', () => {
  assert.deepEqual(STARTERS.blank(), []);
  assert.equal(validateBlocks([]).ok, true);
  const s = validateBlocks(setterWeek());
  assert.equal(s.ok, true, s.error);
  assert.ok(s.blocks.every((b) => b.dow <= 5));
});

test('the editor refuses overlaps, backwards times and nameless blocks', () => {
  const ok = { dow: 1, start_min: 540, end_min: 600, title: 'Dial', kind: 'dial' };
  assert.equal(validateBlocks([ok, { ...ok, start_min: 599, end_min: 660, title: 'Other' }]).ok, false);
  assert.match(validateBlocks([ok, { ...ok, start_min: 599, end_min: 660, title: 'Other' }]).error, /overlaps/);
  assert.equal(validateBlocks([ok, { ...ok, dow: 2, start_min: 599, end_min: 660 }]).ok, true, 'same time on another day is fine');
  assert.equal(validateBlocks([ok, { ...ok, start_min: 600, end_min: 660, title: 'Next' }]).ok, true, 'back to back is fine');
  assert.equal(validateBlocks([{ ...ok, end_min: 540 }]).ok, false);
  assert.equal(validateBlocks([{ ...ok, title: ' ' }]).ok, false);
  assert.equal(validateBlocks([{ ...ok, dow: 9 }]).ok, false);
  const clean = validateBlocks([{ ...ok, kind: 'weird', goal: '12', note: 'x'.repeat(900), title: 'y'.repeat(200) }]).blocks[0];
  assert.equal(clean.kind, 'other'); assert.equal(clean.goal, 12); assert.equal(clean.note.length, 600); assert.equal(clean.title.length, 80);
});

test('now and next, times and weekdays', () => {
  const blocks = validateBlocks(ownerWeek()).blocks;
  let r = nowAndNext(blocks, 1, toMin('09:30'));
  assert.equal(r.now.title, 'Power dial 1'); assert.equal(r.left, 75); assert.equal(r.next.title, 'Reset');
  r = nowAndNext(blocks, 1, toMin('08:00'));
  assert.equal(r.now, null); assert.equal(r.next.title, 'Start up'); assert.equal(r.until, 45);
  r = nowAndNext(blocks, 1, toMin('22:00'));
  assert.equal(r.now, null); assert.equal(r.next, null);
  assert.equal(fmtMin(525), '8:45 AM'); assert.equal(fmtMin(780), '1 PM'); assert.equal(fmtMin(0), '12 AM');
  assert.equal(dowOf(new Date(2026, 10, 9)), 1, 'Monday'); assert.equal(dowOf(new Date(2026, 10, 15)), 7, 'Sunday');
  assert.equal(hoursText(90), '1.5 h'); assert.equal(hoursText(120), '2 h');
});

// ---------- the API ----------
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';

function setup() {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' };
    if (cookie) h.cookie = cookie;
    let payload;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text() };
  };
  return { call, logout: () => { cookie = ''; } };
}

test('schedule API: the owner week fills in once, teammates start blank, owners can see everyone', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  let r = await t.call('GET', '/api/schedule');
  assert.equal(r.status, 200);
  assert.ok(r.data.blocks.length > 40, 'the owner week is there');
  assert.equal(r.data.blocks.filter((b) => b.dow === 1 && b.kind === 'dial').reduce((n, b) => n + b.goal, 0), 200);
  const me = r.data.person.id;
  // Overlap is refused and nothing changes
  const bad = [{ dow: 1, start_min: 540, end_min: 600, title: 'A', kind: 'dial' }, { dow: 1, start_min: 570, end_min: 630, title: 'B', kind: 'build' }];
  r = await t.call('PUT', `/api/schedule/${me}`, { blocks: bad });
  assert.equal(r.status, 400); assert.match(r.data.error, /overlaps/);
  assert.ok((await t.call('GET', '/api/schedule')).data.blocks.length > 40);
  // Clearing sticks: the week does not come back by itself
  r = await t.call('PUT', `/api/schedule/${me}`, { blocks: [] });
  assert.equal(r.data.blocks.length, 0);
  assert.equal((await t.call('GET', '/api/schedule')).data.blocks.length, 0);
  // Load the owner week again on purpose
  r = await t.call('POST', `/api/schedule/${me}/starter`, { starter: 'owner' });
  assert.ok(r.data.blocks.length > 40);

  // A teammate starts blank, edits only their own, and cannot load the owner week or read anyone else's
  const inv = await t.call('POST', '/api/team/invite', { email: 'kiron@x.com', name: 'Kiron', role: 'team' });
  t.logout();
  await t.call('POST', '/api/auth/invite/accept', { token: inv.data.inviteUrl.split('/#/invite/')[1], password: 'another long password' });
  r = await t.call('GET', '/api/schedule');
  assert.equal(r.status, 200); assert.equal(r.data.blocks.length, 0); assert.equal(r.data.owner, false); assert.deepEqual(r.data.people, []);
  const kiron = r.data.person.id;
  r = await t.call('PUT', `/api/schedule/${kiron}`, { blocks: [{ dow: 2, start_min: 540, end_min: 660, title: 'Dial', kind: 'dial', goal: 80, note: 'Hot list' }] });
  assert.equal(r.status, 200); assert.equal(r.data.blocks.length, 1);
  assert.equal((await t.call('POST', `/api/schedule/${kiron}/starter`, { starter: 'owner' })).status, 403);
  assert.equal((await t.call('GET', `/api/schedule?user=${me}`)).status, 403);
  assert.equal((await t.call('PUT', `/api/schedule/${me}`, { blocks: [] })).status, 403);
  assert.equal((await t.call('POST', `/api/schedule/${kiron}/starter`, { starter: 'setter' })).data.blocks.length, 40);

  // The owner can open and change a teammate's week
  t.logout();
  await t.call('POST', '/api/auth/login', { email: 'v@rightwaygrowth.com', password: 'correct horse battery' });
  r = await t.call('GET', `/api/schedule?user=${kiron}`);
  assert.equal(r.status, 200); assert.equal(r.data.isMe, false); assert.equal(r.data.blocks.length, 40);
  assert.equal(r.data.people.length, 2);
  r = await t.call('POST', `/api/schedule/${kiron}/starter`, { starter: 'blank' });
  assert.equal(r.data.blocks.length, 0);
});
