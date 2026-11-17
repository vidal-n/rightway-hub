import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';

// Leaderboard (V, Nov 2026): per person booked, owner talks and booked per talk, an online and unassigned row, and a Coming up list
// that holds only the viewer's own appointments.
test('leaderboard splits the team, keeps online bookings apart, and Coming up is only mine', async () => {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body) => {
    const h = { 'x-rw': '1' }; if (cookie) h.cookie = cookie;
    let payload; if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  await call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'Vidal Newton', password: 'correct horse battery' });
  const me = (await call('GET', '/api/me')).data.user.id;
  const db = env.DB;
  await db.prepare("INSERT INTO users (id, email, name, role, job, created_at, pass_hash) VALUES ('u_k', 'kiron@rightwaygrowth.com', 'Kiron Lee', 'team', 'closer', ?, 'x')").bind(Date.now()).run();
  const lead = async (n, extra = {}) => (await call('POST', '/api/leads', { business: `Biz ${n}`, phone: `30555505${String(n).padStart(2, '0')}`, city: 'Miami', state: 'FL', ...extra })).data.lead.id;
  const t = Date.now();
  const act = (by, type, outcome, body = null) => db.prepare('INSERT INTO activities (id, lead_id, type, outcome, body, at, by) VALUES (?, NULL, ?, ?, ?, ?, ?)').bind(`a_${Math.random().toString(36).slice(2)}`, type, outcome, body, t - 1000, by).run();
  // Vidal: 4 dials, 2 owner talks (a booked result is one), 1 booked. Kiron: 4 dials, 3 owner talks, 1 booked. An online booking has no rep.
  for (const o of ['no_answer', 'no_answer', 'conversation', 'booked']) await act(me, 'call', o);
  for (const o of ['no_answer', 'conversation', 'not_interested', 'booked']) await act('u_k', 'call', o);
  await act(null, 'meeting', null, 'Booked online for Tue');
  // Appointments: one mine, one Kiron's, one online (nobody).
  const a = await lead(1), b = await lead(2), c = await lead(3);
  const later = (h) => t + h * 3600e3;
  await db.prepare('UPDATE leads SET meet_at = ?, meet_by = ? WHERE id = ?').bind(later(30), me, a).run();
  await db.prepare('UPDATE leads SET meet_at = ?, meet_by = ?, closer_id = ? WHERE id = ?').bind(later(31), 'u_k', 'u_k', b).run();
  await db.prepare('UPDATE leads SET meet_at = ?, meet_by = NULL, closer_id = NULL WHERE id = ?').bind(later(32), c).run();

  const lb = (await call('GET', '/api/leaderboard?days=1')).data;
  const v = lb.agents.find((x) => x.id === me), k = lb.agents.find((x) => x.id === 'u_k');
  assert.deepEqual([v.dials, v.talks, v.booked, v.rate, v.upcoming], [4, 2, 1, 50, 1]);
  assert.deepEqual([k.dials, k.talks, k.booked, k.rate, k.upcoming], [4, 3, 1, 33.3, 1]);
  assert.deepEqual(lb.other, { booked: 1, upcoming: 1 });
  assert.equal(lb.team.booked, 2, 'online bookings are not credited to the team');
  assert.equal(lb.team.rate, 40);
  assert.equal(lb.agents[0].id, me, 'same booked, higher booked per talk first');
  // A day outside the window is not counted.
  assert.equal((await call('GET', '/api/leaderboard?days=7')).data.days, 7);
  assert.equal((await call('GET', '/api/leaderboard?days=99')).data.days, 1, 'unknown periods fall back to today');

  // Owners see every appointment; the dialer's Coming up asks for mine only.
  const all = (await call('GET', '/api/calendar/upcoming')).data.meetings.map((m) => m.id).sort();
  assert.deepEqual(all, [a, b, c].sort());
  const mine = (await call('GET', '/api/calendar/upcoming?mine=1')).data.meetings.map((m) => m.id);
  assert.deepEqual(mine, [a]);
});
