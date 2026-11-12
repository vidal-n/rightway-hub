import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
import { cleanItem, captionIssues, readyForReview, fillCaptions, byDay, summary, templateIdeas, visibleToClient, shiftMonth, monthKey } from '../public/js/social.js';

function setup() {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123' };
  let cookie = '';
  const call = async (method, path, body, form, anon) => {
    const h = {};
    if (!anon) h['x-rw'] = '1';
    if (cookie && !anon) h.cookie = cookie;
    let payload = form;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set && !anon) cookie = set.split(';')[0];
    return { status: res.status, data: await res.clone().json().catch(() => null), res };
  };
  return { env, call };
}
const png = (n) => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, n, 1, 2, 3])], `p${n}.png`, { type: 'image/png' });

test('pure helpers: clean, issues, ready, fill, calendar', () => {
  const c = cleanItem({ title: ' Roof job ', channels: ['facebook', 'bogus', 'facebook', 'x'], captions: { facebook: 'Hi', nope: 'x', x: { text: 'a'.repeat(5), first_comment: 'link' } }, scheduled_at: 1764000000000 });
  assert.equal(c.title, 'Roof job');
  assert.deepEqual(c.channels, ['facebook', 'x']);
  assert.deepEqual(Object.keys(c.captions), ['facebook', 'x']);
  assert.throws(() => cleanItem({ status: 'nope' }));
  assert.throws(() => cleanItem({ scheduled_at: 5 }));
  assert.equal(cleanItem({ scheduled_at: '' }).scheduled_at, null);
  assert.ok(captionIssues('instagram', 'hello', []).some((i) => /photo or video/.test(i)));
  assert.ok(captionIssues('x', 'a'.repeat(300)).some((i) => /over the 280/.test(i)));
  assert.ok(captionIssues('google', 'Call 305-555-1212 today').some((i) => /phone numbers or links/.test(i)));
  assert.ok(captionIssues('google', 'See https://a.com').some((i) => /links/.test(i)));
  assert.ok(captionIssues('tiktok', 'hi', [{ type: 'image/png' }]).some((i) => /needs a video/.test(i)));
  assert.deepEqual(captionIssues('facebook', 'Fine post'), []);
  assert.ok(readyForReview({ title: '', channels: [] }).length >= 2);
  assert.deepEqual(readyForReview({ title: 'x', channels: ['facebook'], captions: { facebook: { text: 'ok' } }, media: [] }), []);
  const f = fillCaptions({ facebook: 'Great roof #roofing #miami', instagram: 'IG #roofing', google: 'Google post https://x.com' }, ['x', 'google', 'linkedin']);
  assert.ok(f.x.text.length <= 280 && !f.x.text.includes('#'));
  assert.ok(!f.google.text.includes('http'));
  assert.ok(!f.linkedin.text.includes('#'));
  const g = byDay([{ id: 1, scheduled_at: 1764000000000 }, { id: 2 }, { id: 3, scheduled_at: 1764000000000 - 3600e3 }]);
  assert.equal(g.get('').length, 1);
  assert.deepEqual([...g.values()].flat().length, 3);
  const s = summary([{ status: 'draft' }, { status: 'review' }, { status: 'posted' }, { status: 'approved', scheduled_at: 1 }]);
  assert.equal(s.review, 1); assert.equal(s.unscheduled, 2);
  assert.equal(templateIdeas({ services: 'Roof repair, Gutters', cities: 'Miami' }, 3).length, 3);
  assert.ok(visibleToClient('review') && !visibleToClient('draft') && !visibleToClient('idea'));
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.match(monthKey(Date.now()), /^\d{4}-\d{2}$/);
});

test('team plans a post, sends it, the client approves from the link', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const c = (await t.call('POST', '/api/clients', { name: 'Sunrise Roofing', services: 'Roof repair', cities: 'Miami' })).data.client;
  let r = await t.call('POST', `/api/clients/${c.id}/social`, { title: 'Roof before and after', project: 'November', channels: ['facebook', 'instagram'], scheduled_at: Date.now() + 86400e3, notes: 'internal only' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const id = r.data.item.id;
  assert.equal(r.data.item.status, 'draft');
  // Not ready: no captions and Instagram needs media.
  r = await t.call('PATCH', `/api/social/${id}`, { status: 'review' });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /Not ready/);
  // Media
  const fd = new FormData(); fd.append('file', png(1)); fd.append('file', png(2));
  r = await t.call('POST', `/api/social/${id}/media`, undefined, fd);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.item.media.length, 2);
  const bad = new FormData(); bad.append('file', new File(['x'], 'a.txt', { type: 'text/plain' }));
  assert.equal((await t.call('POST', `/api/social/${id}/media`, undefined, bad)).status, 400);
  const file = await t.call('GET', `/api/social/${id}/media/0`);
  assert.equal(file.res.headers.get('content-type'), 'image/png');
  // Captions by template (no key), then ready.
  r = await t.call('POST', `/api/social/${id}/ai`, {});
  assert.equal(r.status, 200);
  assert.ok(r.data.item.captions.facebook.text && r.data.item.captions.instagram.text);
  r = await t.call('PATCH', `/api/social/${id}`, { status: 'review' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // Review link
  const sh = (await t.call('POST', `/api/clients/${c.id}/social/shares`, { label: 'November' })).data;
  assert.ok(sh.token && sh.url.includes(sh.token));
  const pub = await t.call('GET', `/api/public/social/${sh.token}`, undefined, undefined, true);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.business, 'Sunrise Roofing');
  assert.equal(pub.data.items.length, 1);
  assert.equal(pub.data.items[0].notes, undefined);
  assert.equal(JSON.stringify(pub.data).includes('internal only'), false);
  const m = await t.call('GET', pub.data.items[0].media[0].url, undefined, undefined, true);
  assert.equal(m.status, 200);
  // A bad token and a draft are not reachable.
  assert.equal((await t.call('GET', '/api/public/social/nope', undefined, undefined, true)).status, 404);
  const hid = (await t.call('POST', `/api/clients/${c.id}/social`, { title: 'Hidden draft' })).data.item.id;
  assert.equal((await t.call('POST', `/api/public/social/${sh.token}/items/${hid}/approve`, { name: 'Pat' }, undefined, true)).status, 404);
  // Client asks for changes (needs a note and a name), then approves.
  assert.equal((await t.call('POST', `/api/public/social/${sh.token}/items/${id}/changes`, { name: 'Pat' }, undefined, true)).status, 400);
  assert.equal((await t.call('POST', `/api/public/social/${sh.token}/items/${id}/approve`, {}, undefined, true)).status, 400);
  r = await t.call('POST', `/api/public/social/${sh.token}/items/${id}/changes`, { name: 'Pat', body: 'Use the second photo first' }, undefined, true);
  assert.equal(r.data.item.status, 'changes');
  assert.equal(r.data.item.comments.length, 1);
  r = await t.call('POST', `/api/public/social/${sh.token}/items/${id}/approve`, { name: 'Pat' }, undefined, true);
  assert.equal(r.data.item.status, 'approved');
  assert.equal(r.data.item.approved_by, 'Pat');
  let staff = (await t.call('GET', `/api/clients/${c.id}/social`)).data;
  const it = staff.items.find((x) => x.id === id);
  assert.equal(it.status, 'approved'); assert.equal(it.comments, 1);
  // Staff reply, mark posted with a link, then the client can no longer change it.
  await t.call('POST', `/api/social/${id}/comments`, { body: 'Done, thanks' });
  r = await t.call('PATCH', `/api/social/${id}`, { status: 'posted', post_links: { facebook: 'https://facebook.com/p/1', instagram: 'javascript:alert(1)' } });
  assert.equal(r.data.item.status, 'posted'); assert.ok(r.data.item.posted_at);
  assert.deepEqual(Object.keys(r.data.item.post_links), ['facebook']);
  assert.equal((await t.call('POST', `/api/public/social/${sh.token}/items/${id}/approve`, { name: 'Pat' }, undefined, true)).status, 400);
  // Duplicate keeps captions and media, drops the date.
  r = await t.call('POST', `/api/social/${id}/duplicate`);
  assert.equal(r.data.item.status, 'draft'); assert.equal(r.data.item.scheduled_at, null); assert.equal(r.data.item.media.length, 2);
  // Ideas by template, then delete.
  r = await t.call('POST', `/api/clients/${c.id}/social/ideas`, { count: 3 });
  assert.equal(r.data.items.length, 3); assert.ok(r.data.items.every((x) => x.status === 'idea'));
  assert.equal((await t.call('DELETE', `/api/social/${id}`)).status, 200);
  assert.equal((await t.call('DELETE', `/api/social/shares/${sh.token}`)).status, 200);
  assert.equal((await t.call('GET', `/api/public/social/${sh.token}`, undefined, undefined, true)).status, 404);
});

test('staff only writes; share can be limited to a project', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const c = (await t.call('POST', '/api/clients', { name: 'A Co' })).data.client;
  const a = (await t.call('POST', `/api/clients/${c.id}/social`, { title: 'A', project: 'One', status: 'approved' })).data.item;
  await t.call('POST', `/api/clients/${c.id}/social`, { title: 'B', project: 'Two', status: 'approved' });
  const sh = (await t.call('POST', `/api/clients/${c.id}/social/shares`, { project: 'One' })).data;
  const pub = (await t.call('GET', `/api/public/social/${sh.token}`, undefined, undefined, true)).data;
  assert.deepEqual(pub.items.map((i) => i.title), ['A']);
  assert.equal((await t.call('POST', `/api/public/social/${sh.token}/items/${a.id}/explode`, { name: 'x' }, undefined, true)).status, 404);
});
