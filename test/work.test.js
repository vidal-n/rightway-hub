import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, run, first, all } from '../src/db.js';
import { twilioSignature } from '../src/calls.js';
import { guideFor, cleanGuide, proofMissing, dueDate, accessState, accessGaps, blockedBy } from '../public/js/guides.js';
import { encryptPayload, vapidHeader, vapidKeys, notify, digestTick, meetingReminders } from '../src/notify.js';
import { agendaText } from '../src/meetings.js';
import { sumMetrics, reviewOut, profileChecks, replyTemplate } from '../src/gbp.js';
import { ensureMonthTasks } from '../src/work.js';
import { d1, r2 } from './shims.mjs';

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
function setup(extra = {}) {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', ...extra };
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const h = { 'x-rw': '1', ...headers };
    if (cookie) h.cookie = cookie;
    let payload;
    if (typeof body === 'string' || body instanceof FormData) payload = body;
    else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload, redirect: 'manual' }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
  };
  return { env, call, setCookie: (c) => { cookie = c; }, getCookie: () => cookie };
}
async function start(t, extra = {}) {
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', email: 'v@rightwaygrowth.com', name: 'V', password: 'correct horse battery' });
  return (await t.call('POST', '/api/clients', { name: 'Sunrise Roofing', plan: 'growth', monthly: '449', status: 'active', phone: '(954) 555-0142', contact_email: 'owner@sunrise.test', start_date: '2026-10-05', ...extra })).data.client;
}
const thisMonth = () => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

test('guides: defaults, owner edits win, proof rules, due dates', () => {
  const g = guideFor('post');
  assert.equal(g.proof, 'either');
  assert.ok(g.steps.length >= 5);
  const edited = guideFor('post', { post: cleanGuide({ minutes: '25', steps: '1. Open the profile\n2) Post it\n\n- Done', proof: 'link' }) });
  assert.equal(edited.minutes, 25);
  assert.deepEqual(edited.steps, ['Open the profile', 'Post it', 'Done']);
  assert.equal(edited.proof, 'link');
  assert.equal(edited.done, g.done); // untouched fields keep the default
  assert.match(proofMissing(g, { note: 'did it' }), /live link or a screenshot/);
  assert.equal(proofMissing(g, { link: 'https://g.page/x' }), null);
  assert.equal(proofMissing(g, { proof_key: 'proof/x' }), null);
  assert.equal(proofMissing(guideFor('report'), {}), null);
  assert.match(proofMissing(guideFor('competitors'), {}), /note/);
  assert.equal(dueDate('post', '2026-11', 1, 4), '2026-11-06');
  assert.equal(dueDate('post', '2026-11', 4, 4), '2026-11-24');
  assert.equal(dueDate('report', '2026-02'), '2026-02-28');
  assert.equal(dueDate('setup', '2026-11', 1, 1, '2026-11-12'), '2026-11-22');
});

test('access checklist: plan rules, what the Hub sees on its own, blocked tasks', () => {
  const items = accessState({ plan: 'growth' }, [{ item: 'gbp', status: 'requested' }, { item: 'domain', status: 'na' }], { website: true });
  const by = Object.fromEntries(items.map((i) => [i.key, i]));
  assert.equal(by.website.status, 'granted');
  assert.equal(by.website.detected, true);
  assert.equal(by.domain.required, false); // domain is required on Authority and up
  const gaps = accessGaps(items).map((i) => i.key);
  assert.ok(gaps.includes('gbp') && gaps.includes('gsc') && gaps.includes('ga4'));
  assert.ok(!gaps.includes('website'));
  assert.deepEqual(blockedBy('post', items).map((i) => i.key), ['gbp']);
  assert.deepEqual(blockedBy('onpage', items), []);
});

test('task engine, queue, owners, proof, timer, hours, guides and access over the API', async () => {
  const t = setup();
  const c = await start(t);
  const me = (await t.call('GET', '/api/team')).data.users[0];
  await t.call('PUT', `/api/clients/${c.id}/owner`, { owner_id: me.id });
  // The queue fills this month's tasks on its own, owned by the account manager, with due dates.
  let r = await t.call('GET', '/api/work?who=me');
  assert.equal(r.status, 200);
  assert.ok(r.data.tasks.length > 10);
  assert.ok(r.data.tasks.every((x) => x.owner === me.id && /^\d{4}-\d{2}-\d{2}$/.test(x.due)));
  assert.equal(await ensureMonthTasks(t.env), 0); // never twice
  const post = r.data.tasks.find((x) => x.kind === 'post');
  // Task panel: guide, tools, no access yet so the post is blocked on the Google profile.
  r = await t.call('GET', `/api/tasks/${post.id}`);
  assert.equal(r.data.guide.kind, 'post');
  assert.ok(r.data.blocked.some((b) => b.key === 'gbp'));
  assert.equal(r.data.tools.kind, 'post');
  // Proof before close.
  r = await t.call('PATCH', `/api/tasks/${post.id}`, { status: 'done' });
  assert.equal(r.status, 400);
  const form = new FormData();
  form.append('file', new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' }));
  r = await t.call('POST', `/api/tasks/${post.id}/proof`, form);
  assert.equal(r.status, 200);
  r = await t.call('GET', `/api/tasks/${post.id}/proof`);
  assert.equal(r.status, 200);
  r = await t.call('PATCH', `/api/tasks/${post.id}`, { status: 'done' });
  assert.equal(r.data.task.status, 'done');
  // Skipping needs a reason.
  const other = (await t.call('GET', '/api/work?who=me')).data.tasks.find((x) => x.kind === 'qa');
  assert.equal((await t.call('PATCH', `/api/tasks/${other.id}`, { status: 'skipped' })).status, 400);
  // Timer: start moves the task to doing, one timer at a time, stop logs minutes; manual time too.
  r = await t.call('POST', `/api/tasks/${other.id}/timer`, { action: 'start' });
  assert.equal(r.data.running.task_id, other.id);
  await run(t.env, 'UPDATE time_entries SET started_at = started_at - 1800000 WHERE ended_at IS NULL');
  r = await t.call('POST', `/api/tasks/${other.id}/timer`, { action: 'stop' });
  assert.equal(r.data.running, null);
  await t.call('POST', `/api/tasks/${other.id}/time`, { minutes: 15, note: 'phone call with client' });
  const entries = await all(t.env, 'SELECT minutes FROM time_entries WHERE task_id = ?', other.id);
  assert.deepEqual(entries.map((e) => e.minutes).sort((a, b) => a - b), [15, 30]);
  assert.equal((await first(t.env, 'SELECT status FROM tasks WHERE id = ?', other.id)).status, 'doing');
  r = await t.call('GET', `/api/work/hours?month=${thisMonth()}`);
  const row = r.data.perClient.find((x) => x.id === c.id);
  assert.equal(row.minutes, 45);
  assert.ok(row.planned > 200);
  assert.ok(row.perHour > 0); // owners see revenue per hour
  // Guides: owners edit, reset.
  r = await t.call('PUT', '/api/guides/qa', { minutes: 5, steps: 'Look\nAnswer' });
  assert.equal(r.data.guide.minutes, 5);
  assert.equal((await t.call('GET', '/api/guides')).data.guides.find((g) => g.kind === 'qa').steps.length, 2);
  await t.call('DELETE', '/api/guides/qa');
  // Access: marking it granted clears the gap and logs it.
  r = await t.call('GET', '/api/work');
  assert.ok(r.data.access.some((a) => a.client_id === c.id));
  for (const item of ['gbp', 'website', 'gsc', 'ga4']) await t.call('PUT', `/api/clients/${c.id}/access/${item}`, { status: 'granted' });
  r = await t.call('GET', `/api/clients/${c.id}/access`);
  assert.equal(r.data.gaps, 0);
  assert.ok(await first(t.env, "SELECT id FROM log WHERE client_id = ? AND text LIKE 'Access received%'", c.id));
  // Bulk: unassign two tasks.
  const ids = (await t.call('GET', '/api/work?who=me')).data.tasks.slice(0, 2).map((x) => x.id);
  await t.call('POST', '/api/work/bulk', { ids, owner: null });
  assert.equal((await t.call('GET', '/api/work?who=none')).data.tasks.length, 2);
});

test('marking a post posted with a link closes a post task; the report shows proof and the ladder', async () => {
  const t = setup();
  const c = await start(t);
  await t.call('GET', '/api/work?who=all');
  const pid = 'p_test1';
  await run(t.env, "INSERT INTO posts (id, client_id, google_text, status, created_at) VALUES (?, ?, 'New roof in Davie', 'approved', ?)", pid, c.id, Date.now());
  await t.call('PATCH', `/api/posts/${pid}`, { status: 'posted', live_url: 'https://posts.gle/abc' });
  const done = await first(t.env, "SELECT * FROM tasks WHERE client_id = ? AND kind = 'post' AND status = 'done'", c.id);
  assert.equal(done.link, 'https://posts.gle/abc');
  const r = await t.call('POST', `/api/clients/${c.id}/reports`, { month: thisMonth() });
  const rep = await first(t.env, 'SELECT data, token FROM reports WHERE id = ?', r.data.report.id);
  const data = JSON.parse(rep.data);
  assert.ok(data.work.proof.some((p) => p.link === 'https://posts.gle/abc'));
});

test('web push: encrypted payload decrypts with the device key, VAPID header is signed', async () => {
  // A pretend browser: its own key pair and auth secret.
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPub = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const b64u = (u) => Buffer.from(u).toString('base64url');
  const body = await encryptPayload('{"title":"Hi"}', b64u(uaPub), b64u(auth));
  // Decrypt like the browser does (RFC 8291).
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const hk = async (s, ikm, info, n) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const te = new TextEncoder();
  const ikm = await hk(auth, shared, new Uint8Array([...te.encode('WebPush: info\0'), ...uaPub, ...asPub]), 32);
  const cek = await hk(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hk(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
  assert.equal(new TextDecoder().decode(pt.slice(0, -1)), '{"title":"Hi"}');
  assert.equal(pt[pt.length - 1], 2);
  const t = setup();
  await start(t);
  const keys = await vapidKeys(t.env);
  assert.equal(Buffer.from(keys.pub, 'base64url').length, 65);
  assert.equal((await vapidKeys(t.env)).pub, keys.pub); // made once, kept
  const h = await vapidHeader(t.env, 'https://fcm.googleapis.com/fcm/send/abc', keys);
  const [, jwt] = /t=([^,]+)/.exec(h);
  const [head, claims, sig] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(claims, 'base64url')).aud, 'https://fcm.googleapis.com');
  const pubKey = await crypto.subtle.importKey('raw', Buffer.from(keys.pub, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, Buffer.from(sig, 'base64url'), te.encode(`${head}.${claims}`)));
});

test('notify: alert list, push to devices, prefs, Slack, assignment pings, digest and meeting reminders', async () => {
  const t = setup();
  const c = await start(t);
  const me = (await t.call('GET', '/api/team')).data.users[0];
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = Buffer.from(await crypto.subtle.exportKey('raw', ua.publicKey)).toString('base64url');
  let r = await t.call('POST', '/api/notify/subscribe', { endpoint: 'https://push.example/dev1', keys: { p256dh, auth: Buffer.from(new Uint8Array(16)).toString('base64url') } });
  assert.equal(r.status, 200);
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), init }); return new Response('', { status: String(url).includes('push.example/gone') ? 410 : 201 }); };
  try {
    r = await t.call('POST', '/api/notify/test');
    assert.equal(r.data.pushed, 1);
    assert.equal(sent[0].init.headers['Content-Encoding'], 'aes128gcm');
    assert.match(sent[0].init.headers.Authorization, /^vapid t=/);
    // Prefs: texts off means no push, but the alert is still listed.
    await t.call('PUT', '/api/notify/prefs', { text: false });
    sent.length = 0;
    await notify(t.env, { to: 'staff', kind: 'text', title: 'Text from Bob', url: '/#/inbox' });
    assert.equal(sent.length, 0);
    r = await t.call('GET', '/api/notifications');
    assert.ok(r.data.notifications.some((n) => n.title === 'Text from Bob'));
    assert.ok(r.data.unread >= 2);
    await t.call('POST', '/api/notifications/read', {});
    assert.equal((await t.call('GET', '/api/notifications/unread')).data.unread, 0);
    // Slack: only real webhook addresses, stored sealed, posts for the kinds picked.
    assert.equal((await t.call('PUT', '/api/slack/webhook', { webhook: 'https://evil.example/x' })).status, 400);
    r = await t.call('PUT', '/api/slack/webhook', { webhook: 'https://hooks.slack.com/services/T1/B2/abc', kinds: ['lead'] });
    assert.equal(r.data.ok, true);
    assert.equal((await t.call('GET', '/api/slack')).data.webhook, true);
    const stored = await first(t.env, "SELECT v FROM settings WHERE k = 'slack_hook'");
    assert.ok(!stored.v.includes('hooks.slack.com'));
    sent.length = 0;
    await notify(t.env, { to: 'staff', kind: 'lead', title: 'New audit request: Bob <Roofing>', url: '/#/pipeline' });
    const slack = sent.find((s) => s.url.startsWith('https://hooks.slack.com'));
    assert.ok(slack);
    assert.match(JSON.parse(slack.init.body).text, /Bob &lt;Roofing&gt;/);
    sent.length = 0;
    await notify(t.env, { to: 'staff', kind: 'money', title: 'x' });
    assert.ok(!sent.some((s) => s.url.startsWith('https://hooks.slack.com'))); // money not picked
    // A dead device is removed.
    await run(t.env, 'UPDATE push_subs SET endpoint = ? WHERE user_id = ?', 'https://push.example/gone', me.id);
    await notify(t.env, { to: [me.id], kind: 'task', title: 'y' });
    assert.equal((await first(t.env, 'SELECT COUNT(*) AS n FROM push_subs')).n, 0);
    // Morning digest: once a day, after 8am New York, for tasks due today or late.
    await t.call('GET', '/api/work?who=all');
    await t.call('PUT', `/api/clients/${c.id}/owner`, { owner_id: me.id, apply: true });
    await run(t.env, "UPDATE tasks SET due = '2026-01-01' WHERE client_id = ?", c.id);
    const nineAm = Date.UTC(2026, 10, 3, 14);
    assert.equal(await digestTick(t.env, nineAm), 1);
    assert.equal(await digestTick(t.env, nineAm + 3600e3), 0);
    // Meeting reminder 15 minutes before.
    await run(t.env, "INSERT INTO meetings (id, client_id, title, start_at, minutes, status, created_by, created_at) VALUES ('mt1', ?, 'Results', ?, 30, 'scheduled', ?, ?)", c.id, Date.now() + 10 * 60e3, me.id, Date.now());
    assert.equal(await meetingReminders(t.env), 1);
    assert.equal(await meetingReminders(t.env), 0);
  } finally { globalThis.fetch = realFetch; }
});

test('meetings: book with a pasted link, agenda from the numbers, mark held closes the meeting task, client sees the summary', async () => {
  const t = setup();
  const c = await start(t);
  await t.call('GET', '/api/work?who=all');
  let r = await t.call('GET', `/api/clients/${c.id}/meetings`);
  assert.equal(r.data.google, false);
  assert.match(r.data.agenda, /What we did this month/);
  r = await t.call('POST', `/api/clients/${c.id}/meetings`, { start: Date.now() + 864e5 });
  assert.equal(r.status, 400); // no Google and no link
  assert.equal((await t.call('POST', `/api/clients/${c.id}/meetings`, { start: Date.now() + 864e5, link: 'http://x.test' })).status, 400);
  r = await t.call('POST', `/api/clients/${c.id}/meetings`, { start: Date.now() + 864e5, link: 'https://meet.google.com/abc-defg-hij' });
  const m = r.data.meeting;
  assert.equal(m.meet, 'https://meet.google.com/abc-defg-hij');
  assert.equal((await t.call('PATCH', `/api/meetings/${m.id}`, { status: 'held' })).status, 400); // notes first
  r = await t.call('PATCH', `/api/meetings/${m.id}`, { status: 'held', notes: 'Wants more Davie calls', summary: 'We will add a Davie page this month.' });
  assert.equal(r.data.meeting.status, 'held');
  const task = await first(t.env, "SELECT status FROM tasks WHERE client_id = ? AND kind = 'meeting'", c.id);
  assert.equal(task.status, 'done');
  // The client sees the summary but not the private notes.
  const inv = await t.call('POST', `/api/clients/${c.id}/invite`, { email: 'owner@sunrise.test', name: 'Bob' });
  const tok = inv.data.inviteUrl.split('/').pop();
  const staffCookie = t.getCookie();
  t.setCookie('');
  await t.call('POST', '/api/auth/invite/accept', { token: tok, password: 'client password 1' });
  r = await t.call('GET', `/api/clients/${c.id}/meetings`);
  assert.equal(r.data.meetings[0].summary, 'We will add a Davie page this month.');
  assert.equal(r.data.meetings[0].notes, undefined);
  t.setCookie(staffCookie);
  assert.match(agendaText({ name: 'X' }, { keywords: [{ keyword: 'roofer', now: { top10Pct: 40, centerRank: 4 }, before: { top10Pct: 30 } }] }, { done: 3, total: 10 }), /first page \(top 10\) in 40% of your area \(was 30%\), #4 at your address/);
});

test('voicemail: missed call records, voicemail lands on the call, inbox lists it, callers become leads', async () => {
  const t = setup({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+13055073393' });
  await start(t);
  const hook = async (path, params) => t.call('POST', path, new URLSearchParams(params).toString(), { ...FORM, 'x-twilio-signature': await twilioSignature('tok', `https://hub.test${path}`, params) });
  // Nobody can pick up (no Hub open, no saved mobile): straight to voicemail.
  let r = await hook('/api/twilio/voice', { From: '+13055550188', To: '+13055073393', CallSid: 'CA1' });
  assert.match(r.data, /<Record maxLength="120"/);
  const aid = /a=(a_[^"&]+)/.exec(r.data)[1];
  r = await hook(`/api/twilio/vm-recording?a=${aid}`, { RecordingSid: 'RE1', RecordingDuration: '14' });
  assert.equal(r.status, 204);
  r = await t.call('GET', '/api/calls/inbound');
  assert.equal(r.data.calls[0].status, 'voicemail');
  assert.equal(r.data.calls[0].vmSecs, 14);
  assert.equal(r.data.unseen, 1);
  assert.equal((await t.call('GET', '/api/inbox/unread')).data.calls, 1);
  r = await t.call('POST', `/api/calls/inbound/${aid}/lead`, { business: 'Ocean Plumbing' });
  const lead = await first(t.env, 'SELECT business, source FROM leads WHERE id = ?', r.data.leadId);
  assert.equal(lead.business, 'Ocean Plumbing');
  await t.call('POST', `/api/calls/inbound/${aid}/seen`, {});
  assert.equal((await t.call('GET', '/api/calls/inbound')).data.unseen, 0);
  // Callbacks: the browser ring says we called them recently.
  await run(t.env, "INSERT INTO activities (id, lead_id, type, status, at) VALUES ('a_out', ?, 'call', 'completed', ?)", r.data.leadId, Date.now() - 2 * 3600e3);
  await run(t.env, "INSERT INTO settings (k, v) VALUES ('voice_clients', '[]') ON CONFLICT(k) DO NOTHING");
  await t.call('PUT', '/api/me/phone', { phone: '954 555 0001' });
  r = await hook('/api/twilio/voice', { From: '+13055550188', To: '+13055073393', CallSid: 'CA2' });
  assert.match(r.data, /<Number[^>]*>\+19545550001<\/Number>/);
  await t.call('PUT', '/api/voicemail/settings', { greeting: 'Hi, you reached <b>Rightway</b>.' });
  r = await hook('/api/twilio/voice', { From: '+13055550199', To: '+13055073393', CallSid: 'CA3' });
  assert.match(r.data, /<Number[ >]/); // still rings the mobile
});

test('Google profile helpers: metrics, reviews, checks and reply drafts', () => {
  const m = sumMetrics({ multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [
    { dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [{ value: '3' }, { value: '4' }] } },
    { dailyMetric: 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', timeSeries: { datedValues: [{ value: '100' }] } },
    { dailyMetric: 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', timeSeries: { datedValues: [{ value: '20' }, {}] } },
  ] }] });
  assert.deepEqual(m, { calls: 7, website: 0, directions: 0, views: 120 });
  const r = reviewOut({ reviewId: 'r1', starRating: 'TWO', comment: 'Late', reviewer: { displayName: 'Ana P' }, createTime: '2026-10-01T10:00:00Z' });
  assert.equal(r.stars, 2);
  assert.equal(r.reply, null);
  const checks = profileChecks({ profile: { description: 'short' }, websiteUri: 'https://x.test', phoneNumbers: { primaryPhone: '1' } });
  assert.equal(checks.find((x) => x.key === 'description').ok, false);
  assert.equal(checks.find((x) => x.key === 'website').ok, true);
  assert.match(replyTemplate({ name: 'Ana P', stars: 2, business: 'Sunrise', phone: '(954) 555-0142' }), /^Ana, we are sorry.*\(954\) 555-0142/);
  assert.match(replyTemplate({ name: 'A Google user', stars: 5, business: 'Sunrise' }), /^Thank you! .*Sunrise/);
  assert.ok(!/[–—]/.test(replyTemplate({ name: 'x', stars: 3, business: 'y' })));
});

test('Google profile over the API with Google faked: link, read, publish a post, reply', async () => {
  const t = setup({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' });
  const c = await start(t);
  const { seal } = await import('../src/google.js');
  const me = (await t.call('GET', '/api/team')).data.users[0];
  await run(t.env, 'UPDATE users SET google_token = ?, google_scopes = ? WHERE id = ?', await seal(t.env, 'refresh'), 'openid https://www.googleapis.com/auth/business.manage', me.id);
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ u, init });
    const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('oauth2.googleapis.com/token')) return j({ access_token: 'at', expires_in: 3600 });
    if (u.includes('/v1/accounts?')) return j({ accounts: [{ name: 'accounts/11', accountName: 'Rightway' }] });
    if (u.includes('/accounts/11/locations?')) return j({ locations: [{ name: 'locations/22', title: 'Sunrise Roofing', phoneNumbers: { primaryPhone: '(954) 555-0142' } }] });
    if (u.includes(':fetchMultiDailyMetricsTimeSeries')) return j({ multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [{ dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [{ value: '5' }] } }] }] });
    if (u.includes('/reviews?')) return j({ averageRating: 4.7, totalReviewCount: 50, reviews: [{ reviewId: 'rv1', starRating: 'FIVE', comment: 'Great', reviewer: { displayName: 'Joe' } }] });
    if (u.includes('/reviews/rv1/reply')) return j({ comment: 'Thanks' });
    if (u.includes('/localPosts')) return j({ name: 'accounts/11/locations/22/localPosts/9', searchUrl: 'https://local.google.com/place?post=9', state: 'LIVE' });
    if (u.includes('mybusinessbusinessinformation.googleapis.com/v1/locations/22')) return j({ title: 'Sunrise Roofing', profile: { description: 'Roofs' }, websiteUri: 'https://sunrise.test', categories: { primaryCategory: { displayName: 'Roofing contractor' } } });
    return new Response('{}', { status: 404 });
  };
  try {
    let r = await t.call('GET', '/api/gbp/locations');
    assert.equal(r.data.locations[0].location, 'locations/22');
    assert.equal((await t.call('PUT', `/api/clients/${c.id}/gbp`, { account: 'accounts/11', location: 'nope' })).status, 400);
    r = await t.call('PUT', `/api/clients/${c.id}/gbp`, { account: 'accounts/11', location: 'locations/22', title: 'Sunrise Roofing' });
    assert.equal(r.data.linked, true);
    assert.equal((await first(t.env, "SELECT status FROM client_access WHERE client_id = ? AND item = 'gbp'", c.id)).status, 'granted');
    r = await t.call('GET', `/api/clients/${c.id}/gbp`);
    assert.equal(r.data.metrics.last30.calls, 5);
    assert.equal(r.data.reviews.list[0].who, 'Joe');
    assert.equal(r.data.profile.category, 'Roofing contractor');
    await t.call('GET', '/api/work?who=all');
    await run(t.env, "INSERT INTO posts (id, client_id, google_text, status, media_key, media_type, created_at) VALUES ('p9', ?, 'Fresh tile roof', 'approved', 'k/p9', 'image/jpeg', ?)", c.id, Date.now());
    await t.env.MEDIA.put('k/p9', new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: 'image/jpeg' } });
    r = await t.call('POST', '/api/posts/p9/gbp');
    assert.equal(r.data.url, 'https://local.google.com/place?post=9');
    const body = JSON.parse(calls.find((x) => x.u.includes('/localPosts')).init.body);
    assert.equal(body.callToAction.actionType, 'CALL');
    // The photo link Google fetches is signed and works without a login.
    const src = new URL(body.media[0].sourceUrl);
    globalThis.fetch = realFetch;
    const img = await worker.fetch(new Request(`https://hub.test${src.pathname}`), t.env);
    assert.equal(img.status, 200);
    const bad = await worker.fetch(new Request(`https://hub.test${src.pathname.replace(/[0-9a-f]{4}$/, '0000')}`), t.env);
    assert.equal(bad.status, 403);
    const task = await first(t.env, "SELECT status, link FROM tasks WHERE client_id = ? AND kind = 'post' AND status = 'done'", c.id);
    assert.equal(task.link, 'https://local.google.com/place?post=9');
  } finally { globalThis.fetch = realFetch; }
});
