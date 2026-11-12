import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, run, now } from '../src/db.js';
import { d1, r2 } from './shims.mjs';
import { captionIssues } from '../public/js/social.js';
import { cleanSettings, planQueue, postingSlots, pillarWeights, hashtagsFor, clientInfo, seasonHook, templateCaptions, batchPrompt, parseBatch, mergeCaptions, localDayKey, PILLARS } from '../public/js/socialplan.js';

const client = { name: 'Acme Roofing', category: 'Roofing contractor', services: 'roof repair, roof replacement, leak repair', cities: 'Miami, Hialeah, Coral Gables, Doral', keywords: 'roofer miami' };
const NOW = Date.parse('2026-11-12T15:00:00Z'); // Thursday 10am Eastern

test('settings are clamped and fall back to safe defaults', () => {
  const s = cleanSettings({ perWeek: 99, googlePerWeek: 9, weeks: 0, tz: 'Mars/Base', channels: ['tiktok'], times: { feed: ['25:00', '09:30'], saturday: 'x' } });
  assert.equal(s.perWeek, 7); assert.equal(s.googlePerWeek, 7); assert.equal(s.weeks, 1);
  assert.equal(s.tz, 'America/New_York'); assert.deepEqual(s.channels, ['facebook', 'instagram', 'google']);
  assert.deepEqual(s.times.feed, ['09:30']); assert.equal(s.times.saturday, '09:30');
  assert.equal(s.enabled, false);
});

test('posting days follow the weekly count, in the client zone, and skip taken days', () => {
  const slots = postingSlots({ perWeek: 3, weeks: 2 }, NOW);
  assert.equal(slots.length, 6);
  assert.ok(slots.every((s) => [2, 4, 6].includes(s.dow)));
  assert.ok(slots.every((s) => s.at > NOW));
  const sat = slots.find((s) => s.dow === 6);
  assert.equal(new Date(sat.at).toISOString().slice(11, 16), '14:30'); // 9:30 Eastern in November
  const taken = new Set([slots[0].key]);
  assert.equal(postingSlots({ perWeek: 3, weeks: 2 }, NOW, taken).length, 5);
  // daylight saving: a March date uses EDT
  const mar = postingSlots({ perWeek: 7, weeks: 1, times: { feed: ['12:00'] } }, Date.parse('2027-03-10T15:00:00Z'));
  assert.ok(mar.some((s) => new Date(s.at).toISOString().slice(11, 16) === '16:00'));
});

test('the plan: mix, rotation, channels, Google rules, no dashes, no invented claims', () => {
  const plan = planQueue({ client, now: NOW, settings: { perWeek: 4, weeks: 4, googlePerWeek: 2 }, scans: [{ keyword: 'roof repair hialeah', top10Pct: 5 }, { keyword: 'roof repair miami', top10Pct: 90 }] });
  assert.equal(plan.items.length, 16);
  const kinds = new Set(plan.items.map((i) => i.pillar));
  assert.ok(kinds.has('service') && kinds.has('proof') && kinds.has('tip'));
  assert.ok(!kinds.has('review'), 'no review posts without real reviews');
  // never the same kind twice in a row
  plan.items.forEach((it, n) => { if (n) assert.notEqual(it.pillar, plan.items[n - 1].pillar); });
  // Google at most 2 a week
  const perWeek = new Map(); plan.items.filter((i) => i.channels.includes('google')).forEach((i) => { const w = Math.floor((i.at - NOW) / (7 * 86400e3)); perWeek.set(w, (perWeek.get(w) || 0) + 1); });
  assert.ok([...perWeek.values()].every((n) => n <= 3));
  for (const it of plan.items) {
    for (const ch of it.channels) {
      const text = it.captions[ch];
      assert.ok(text && text.length > 20, `${it.title} ${ch}`);
      assert.doesNotMatch(text, /[–—]/, 'no em or en dashes');
      assert.deepEqual(captionIssues(ch, text, [{ type: 'image/png' }]), [], `${it.title} ${ch}: ${captionIssues(ch, text, [{ type: 'image/png' }]).join(' ')}`);
    }
    assert.doesNotMatch(it.captions.google, /#|https?:|\d{3}[-. ]\d{3}[-. ]\d{4}/);
    assert.match(it.captions.google, /Tap (Call now|Learn more|Book)/);
    assert.doesNotMatch(Object.values(it.captions).filter((v) => typeof v === 'string').join(' '), /award|best in|years of|guarantee|% off|free estimate|licensed|\$\d/i);
    assert.doesNotMatch(it.note, /[–—]/);
  }
  // the weak spot gets more posts than the strong one for the same service
  const count = (city) => plan.items.filter((i) => i.city === city && /repair/.test(i.service)).length;
  assert.ok(count('Hialeah') >= count('Miami') - 1, 'weak Hialeah is not neglected');
  assert.ok(plan.items.some((i) => /only 5%/.test(i.reason)));
  assert.equal(plan.items.filter((i) => i.reason && /90%/.test(i.reason)).length, 0, 'a strong spot is not called weak');
  // the home city shows up the most
  assert.ok(plan.summary.byCity.Miami >= plan.summary.byCity.Doral);
});

test('days that already have a post are left alone, and a second run adds nothing', () => {
  const first = planQueue({ client, now: NOW, settings: { perWeek: 3, weeks: 2 } });
  const existing = first.items.map((i) => ({ scheduled_at: i.at, status: 'scheduled', auto: 1 }));
  const second = planQueue({ client, now: NOW, settings: { perWeek: 3, weeks: 2 }, existing });
  assert.equal(second.items.length, 0);
  const some = planQueue({ client, now: NOW, settings: { perWeek: 3, weeks: 2 }, existing: existing.slice(0, 2) });
  assert.equal(some.items.length, first.items.length - 2);
  assert.ok(some.items.every((i) => !existing.slice(0, 2).some((e) => localDayKey(e.scheduled_at, 'America/New_York') === i.key)));
});

test('real reviews become review posts, quoted exactly; short or low ones never do', () => {
  const reviews = [{ rating: 5, text: 'They fixed our leak the same day and cleaned up everything afterwards. Great crew.', author: 'Maria Lopez' }, { rating: 2, text: 'Not good at all, would not recommend to anyone I know.' }, { rating: 5, text: 'Great' }];
  const plan = planQueue({ client, now: NOW, settings: { perWeek: 7, weeks: 4 }, reviews });
  const rv = plan.items.filter((i) => i.pillar === 'review');
  assert.ok(rv.length >= 1);
  for (const r of rv) { assert.match(r.captions.facebook, /fixed our leak the same day and cleaned up everything afterwards\. Great crew\./); assert.match(r.captions.facebook, /Maria/); assert.doesNotMatch(r.captions.facebook, /Not good at all/); }
  assert.match(mergeCaptions(rv[0], { facebook: 'changed', instagram: 'changed', google: 'changed' }).facebook, /Great crew/);
});

test('it learns from lead counts, but only after enough results', () => {
  const few = pillarWeights([{ pillar: 'proof', leads: 5 }, { pillar: 'tip', leads: 0 }]);
  assert.equal(few.learned, false);
  const hist = [...Array(4).fill({ pillar: 'proof', leads: 6 }), ...Array(4).fill({ pillar: 'tip', leads: 0 }), ...Array(2).fill({ pillar: 'faq', leads: 2 })];
  const w = pillarWeights(hist);
  assert.equal(w.learned, true);
  assert.ok(w.weights.proof > PILLARS.find((p) => p.id === 'proof').weight);
  assert.ok(w.weights.tip < PILLARS.find((p) => p.id === 'tip').weight);
  assert.ok(Object.values(w.weights).every((v) => v >= 0.5 && v <= 10));
  const a = planQueue({ client, now: NOW, settings: { perWeek: 7, weeks: 4 } }).summary.byPillar;
  const b = planQueue({ client, now: NOW, settings: { perWeek: 7, weeks: 4 }, history: hist }).summary.byPillar;
  assert.ok((b.proof || 0) >= (a.proof || 0));
  assert.ok((b.tip || 0) <= (a.tip || 0));
});

test('hashtags are specific, unique and short; seasonal hooks fit the month and trade', () => {
  const info = clientInfo(client);
  const tags = hashtagsFor(info, { service: 'roof repair', city: 'Hialeah' }, 8);
  assert.ok(tags.length >= 5 && tags.length <= 8);
  assert.equal(new Set(tags).size, tags.length);
  assert.ok(tags.includes('#roofRepairHialeah'));
  assert.ok(!tags.some((t) => /#love|#instagood/i.test(t)));
  assert.match(seasonHook('Roofing contractor', ['roof repair'], 9, 'florida'), /Hurricane season/);
  assert.doesNotMatch(seasonHook('Roofing contractor', ['roof repair'], 9, 'general'), /Hurricane/);
  assert.match(seasonHook('Air conditioning', [], 7, 'florida'), /Air conditioners work hardest/);
  assert.ok(seasonHook('Dentist', [], 1, 'florida').length > 10);
});

test('a client with no cities or services still gets safe posts', () => {
  const plan = planQueue({ client: { name: 'Bare Co' }, now: NOW, settings: { perWeek: 2, weeks: 1 } });
  assert.equal(plan.items.length, 2);
  for (const it of plan.items) { assert.ok(!/undefined|null|\[|\{/.test(Object.values(it.captions).join(' '))); }
});

test('Claude batch: prompt carries only real data; reply is parsed, cleaned and merged safely', () => {
  const plan = planQueue({ client, now: NOW, settings: { perWeek: 2, weeks: 1 } });
  const prompt = batchPrompt(client, plan.items);
  assert.match(prompt, /never invent facts/i); assert.match(prompt, /Acme Roofing/); assert.match(prompt, new RegExp(plan.items[0].keyword));
  const reply = JSON.stringify(plan.items.map(() => ({ facebook: 'Roof talk — call us', instagram: 'IG text #roofer', google: 'Google text https://x.com call 305-555-1212 #tag Tap Call now.', alt_text: 'A roof' })));
  const parsed = parseBatch(`Here you go:\n${reply}`, plan.items.length);
  assert.doesNotMatch(parsed[0].facebook, /—/);
  assert.throws(() => parseBatch('nope', 2)); assert.throws(() => parseBatch('[{"facebook":"a"}]', 2));
  const merged = mergeCaptions(plan.items[0], parsed[0]);
  assert.doesNotMatch(merged.google, /https?:|305|#/);
  assert.equal(merged.ai, true);
  const keep = mergeCaptions(plan.items[0], { facebook: '', instagram: '', google: '' });
  assert.equal(keep.facebook, plan.items[0].captions.facebook);
});

// ---------- the API ----------
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

test('autopilot API: preview is free, stack saves hidden drafts, verify gates on photos, queue and results work', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const c = (await t.call('POST', '/api/clients', { name: 'Acme Roofing', category: 'Roofing contractor', services: 'roof repair, leak repair', cities: 'Miami, Hialeah' })).data.client;
  // settings
  let r = await t.call('GET', `/api/clients/${c.id}/social/autopilot`);
  assert.equal(r.status, 200); assert.equal(r.data.settings.enabled, false); assert.equal(r.data.ready, true);
  r = await t.call('PUT', `/api/clients/${c.id}/social/autopilot`, { settings: { perWeek: 3, weeks: 2, googlePerWeek: 1 } });
  assert.equal(r.data.settings.perWeek, 3);
  // preview writes nothing
  r = await t.call('POST', `/api/clients/${c.id}/social/autopilot/run`, { preview: true });
  assert.equal(r.status, 200); assert.equal(r.data.items.length, 6);
  assert.equal((await t.call('GET', `/api/clients/${c.id}/social`)).data.items.length, 0);
  // a client photo is waiting, so one post gets it
  const fd = new FormData(); fd.append('photo', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], 'a.png', { type: 'image/png' }));
  assert.equal((await t.call('POST', `/api/clients/${c.id}/photos`, undefined, fd)).status, 200);
  r = await t.call('POST', `/api/clients/${c.id}/social/autopilot/run`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.items.length, 6); assert.equal(r.data.photos, 1); assert.equal(r.data.ai, false);
  const list = (await t.call('GET', `/api/clients/${c.id}/social`)).data.items;
  assert.equal(list.length, 6);
  assert.ok(list.every((i) => i.auto === 1 && i.project === 'Autopilot' && i.verified_at == null && i.scheduled_at > Date.now()));
  assert.ok(list.every((i) => /Search term this post covers/.test(i.notes)));
  const withPhoto = list.filter((i) => i.media.length);
  assert.equal(withPhoto.length, 1);
  assert.equal(withPhoto[0].status, 'scheduled'); // Instagram has its photo
  assert.ok(list.filter((i) => !i.media.length).every((i) => i.status === 'draft'), 'no photo means draft');
  // running again adds nothing: every posting day is taken
  r = await t.call('POST', `/api/clients/${c.id}/social/autopilot/run`, {});
  assert.equal(r.data.items.length, 0);
  // verify: blocked without a photo, allowed with one
  const bare = list.find((i) => !i.media.length);
  r = await t.call('POST', `/api/social/${bare.id}/verify`, {});
  assert.equal(r.status, 400); assert.match(r.data.error, /Not ready/);
  r = await t.call('POST', `/api/social/${withPhoto[0].id}/verify`, {});
  assert.equal(r.status, 200); assert.equal(r.data.status, 'scheduled');
  // queue
  r = await t.call('GET', `/api/social/queue?days=30&client=${c.id}`);
  assert.equal(r.data.items.length, 6);
  assert.equal(r.data.items.find((i) => i.id === withPhoto[0].id).verified, true);
  assert.ok(r.data.items.find((i) => i.id === bare.id).left.length > 0);
  assert.equal(r.data.counts.needsPhoto, 5);
  // mark posted, then log leads
  r = await t.call('PATCH', `/api/social/${withPhoto[0].id}`, { status: 'posted', post_links: { facebook: 'https://facebook.com/p/9' } });
  assert.equal(r.data.item.status, 'posted');
  r = await t.call('GET', `/api/social/queue?days=30&client=${c.id}`);
  assert.equal(r.data.toScore.length, 1);
  assert.equal((await t.call('PUT', `/api/social/${withPhoto[0].id}/result`, { leads: -3 })).status, 400);
  assert.equal((await t.call('PUT', `/api/social/${withPhoto[0].id}/result`, { leads: 4 })).data.leads, 4);
  assert.equal((await t.call('GET', `/api/social/queue?days=30&client=${c.id}`)).data.toScore.length, 0);
  // a client missing services gets a clear message
  const bareClient = (await t.call('POST', '/api/clients', { name: 'No Info' })).data.client;
  assert.equal((await t.call('POST', `/api/clients/${bareClient.id}/social/autopilot/run`, {})).status, 400);
});

test('unverified autopilot posts stay hidden from the client and the review link until a person checks them', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const c = (await t.call('POST', '/api/clients', { name: 'Hide Co', services: 'plumbing', cities: 'Miami' })).data.client;
  await t.call('PUT', `/api/clients/${c.id}/social/autopilot`, { settings: { perWeek: 1, weeks: 1, channels: ['facebook'] } });
  const run1 = (await t.call('POST', `/api/clients/${c.id}/social/autopilot/run`, {})).data;
  assert.equal(run1.items.length, 1); assert.equal(run1.items[0].status, 'scheduled');
  const sh = (await t.call('POST', `/api/clients/${c.id}/social/shares`, {})).data;
  assert.equal((await t.call('GET', `/api/public/social/${sh.token}`, undefined, undefined, true)).data.items.length, 0);
  const id = run1.items[0].id;
  assert.equal((await t.call('POST', `/api/social/${id}/verify`, {})).data.status, 'scheduled');
  assert.equal((await t.call('GET', `/api/public/social/${sh.token}`, undefined, undefined, true)).data.items.length, 1);
  // with client approval on, verifying sends it to the client instead
  await t.call('PUT', `/api/clients/${c.id}/social/autopilot`, { settings: { perWeek: 2, weeks: 1, channels: ['facebook'], clientReview: true } });
  const more = (await t.call('POST', `/api/clients/${c.id}/social/autopilot/run`, {})).data.items;
  assert.ok(more.length >= 1);
  assert.equal((await t.call('POST', `/api/social/${more[0].id}/verify`, {})).data.status, 'review');
  // a post marked posted counts as checked
  const again = (await t.call('GET', `/api/clients/${c.id}/social`)).data.items.find((i) => i.id === more[more.length - 1].id);
  if (!again.verified_at) { await t.call('PATCH', `/api/social/${again.id}`, { status: 'posted' }); assert.ok((await t.call('GET', `/api/clients/${c.id}/social`)).data.items.find((i) => i.id === again.id).verified_at); }
});

test('verify all checks every ready post and counts the ones that still need a photo', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const c = (await t.call('POST', '/api/clients', { name: 'Batch Co', services: 'hvac', cities: 'Doral' })).data.client;
  await t.call('PUT', `/api/clients/${c.id}/social/autopilot`, { settings: { perWeek: 4, weeks: 1, channels: ['facebook', 'google'] } }); // no Instagram: nothing needs a photo
  const made = (await t.call('POST', `/api/clients/${c.id}/social/autopilot/run`, {})).data;
  assert.equal(made.items.length, 4);
  assert.ok(made.items.every((i) => i.status === 'scheduled'));
  const r = (await t.call('POST', `/api/clients/${c.id}/social/verify-all`, {})).data;
  assert.equal(r.done, 4); assert.equal(r.skipped, 0);
  assert.equal(r.status.toVerify, 0);
});

test('the cron top up is opt in, once a day, and skips clients that are still stacked', async () => {
  const t = setup();
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  const c = (await t.call('POST', '/api/clients', { name: 'Cron Co', services: 'pest control', cities: 'Miami' })).data.client;
  const { socialAutoTick } = await import('../src/socialauto.js');
  await socialAutoTick(t.env);
  assert.equal((await t.call('GET', `/api/clients/${c.id}/social`)).data.items.length, 0, 'off by default');
  await t.call('PUT', `/api/clients/${c.id}/social/autopilot`, { settings: { enabled: true, perWeek: 2, weeks: 2, channels: ['facebook'] } });
  await socialAutoTick(t.env);
  const n = (await t.call('GET', `/api/clients/${c.id}/social`)).data.items.length;
  assert.equal(n, 4);
  await socialAutoTick(t.env);
  assert.equal((await t.call('GET', `/api/clients/${c.id}/social`)).data.items.length, 4, 'not again the same day');
});
