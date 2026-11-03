import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { resetSchemaCache, run, first } from '../src/db.js';
import { slackSignature, blocksFor, manifestFor, SCOPES } from '../src/slack.js';
import { notify } from '../src/notify.js';
import { d1, r2 } from './shims.mjs';

const SECRET = 'a'.repeat(32);
function setup(extra = {}) {
  resetSchemaCache();
  const env = { DB: d1(), MEDIA: r2(), ACCESS_KEY: 'owner-key-123', ...extra };
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const h = { 'x-rw': '1', ...headers };
    if (cookie) h.cookie = cookie;
    let payload;
    if (typeof body === 'string') payload = body;
    else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await worker.fetch(new Request(`https://hub.test${path}`, { method, headers: h, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
  };
  // A signed request from Slack.
  const slack = async (path, raw, { secret = SECRET, ts = Math.floor(Date.now() / 1000) } = {}) => {
    const res = await worker.fetch(new Request(`https://hub.test${path}`, {
      method: 'POST', body: raw,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-slack-request-timestamp': String(ts), 'x-slack-signature': await slackSignature(secret, ts, raw) },
    }), env);
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
  };
  return { env, call, slack, cookie: () => cookie, setCookie: (c) => { cookie = c; } };
}

// Fake Slack Web API: records calls, answers like Slack.
function fakeSlack() {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? (() => { try { return JSON.parse(init.body); } catch { return init.body; } })() : null;
    calls.push({ u, body, init });
    const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('/api/auth.test')) return j({ ok: true, team: 'Rightway Growth', team_id: 'T1', user_id: 'UBOT', url: 'https://rightway.slack.com/' });
    if (u.includes('/api/users.lookupByEmail')) return u.includes('v%40x.com') ? j({ ok: true, user: { id: 'UV', name: 'v', real_name: 'V' } }) : j({ ok: false, error: 'users_not_found' });
    if (u.includes('/api/users.info')) return j({ ok: true, user: { id: 'UK', profile: { email: 'kiron@x.com' } } });
    if (u.includes('/api/conversations.list')) return j({ ok: true, channels: [{ id: 'C01LEADS9', name: 'leads' }, { id: 'C02SUNRS9', name: 'client-sunrise' }, { id: 'G03OWNRS9', name: 'owners', is_private: true }], response_metadata: { next_cursor: '' } });
    if (u.includes('/api/chat.postMessage')) return j({ ok: true, ts: '1.1' });
    if (u.includes('/api/views.open')) return j({ ok: true });
    if (u.startsWith('https://hooks.slack.com/actions')) return new Response('ok');
    if (u.includes('api.twilio.com')) return j({ sid: 'SM1', status: 'queued' });
    return new Response('{}', { status: 404 });
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

async function owner(t) {
  await t.call('POST', '/api/auth/setup', { accessKey: 'owner-key-123', name: 'V', email: 'v@x.com', password: 'correct horse battery' });
}

test('manifest and message blocks', () => {
  const m = manifestFor('https://hub.example');
  assert.equal(m.features.slash_commands[0].url, 'https://hub.example/api/slack/command');
  assert.equal(m.settings.interactivity.request_url, 'https://hub.example/api/slack/interact');
  assert.deepEqual(m.oauth_config.scopes.bot, SCOPES);
  const b = blocksFor({ title: 'New lead: Bob <Roofing>', body: 'Call now & win', url: '/#/pipeline', actions: [{ text: 'Claim', action_id: 'lead_claim', value: 'l1', style: 'primary' }], origin: 'https://hub.example' });
  assert.match(b[0].text.text, /Bob &lt;Roofing&gt;/);
  assert.equal(b[1].elements[0].action_id, 'lead_claim');
  assert.equal(b[1].elements[1].url, 'https://hub.example/#/pipeline');
});

test('connect, routes, client channels, linking, and alerts going to channels and direct messages', async () => {
  const t = setup();
  await owner(t);
  const f = fakeSlack();
  try {
    let r = await t.call('GET', '/api/slack');
    assert.equal(r.data.connected, false);
    assert.match(r.data.createUrl, /^https:\/\/api\.slack\.com\/apps\?new_app=1&manifest_json=/);
    assert.equal((await t.call('POST', '/api/slack/connect', { token: 'nope', signing: SECRET })).status, 400);
    r = await t.call('POST', '/api/slack/connect', { token: 'xoxb-1-2-abc', signing: SECRET });
    assert.equal(r.data.team, 'Rightway Growth');
    assert.equal(r.data.linked, 1); // V matched by email
    const sealed = await first(t.env, "SELECT v FROM settings WHERE k = 'slack_bot'");
    assert.ok(!sealed.v.includes('xoxb'));
    r = await t.call('GET', '/api/slack/channels');
    assert.equal(r.data.channels.length, 3);
    assert.equal((await t.call('PUT', '/api/slack/routes', { routes: { lead: { id: 'bad', name: 'x' } } })).status, 400);
    await t.call('PUT', '/api/slack/routes', { routes: { lead: { id: 'C01LEADS9', name: 'leads' }, client: { id: 'C01LEADS9', name: 'leads' }, digest: { id: 'C01LEADS9', name: 'leads' } } });
    const c = (await t.call('POST', '/api/clients', { name: 'Sunrise Roofing', plan: 'growth' })).data.client;
    await t.call('PUT', `/api/clients/${c.id}/slack`, { channel: { id: 'C02SUNRS9', name: 'client-sunrise' } });
    f.calls.length = 0;
    // A team alert goes to its channel, with buttons.
    await notify(t.env, { to: 'staff', kind: 'lead', title: 'New audit request: Bob', url: '/#/pipeline', actions: [{ text: 'Claim', action_id: 'lead_claim', value: 'l1' }] });
    let posts = f.calls.filter((x) => x.u.includes('chat.postMessage'));
    assert.deepEqual(posts.map((p) => p.body.channel), ['C01LEADS9']);
    assert.equal(posts[0].body.blocks[1].elements[0].action_id, 'lead_claim');
    // A client alert goes to the client update channel and the client's own channel.
    f.calls.length = 0;
    await notify(t.env, { to: { client: c.id }, kind: 'client', title: 'Sunrise approved a post' });
    posts = f.calls.filter((x) => x.u.includes('chat.postMessage'));
    assert.deepEqual(posts.map((p) => p.body.channel).sort(), ['C01LEADS9', 'C02SUNRS9']);
    // Personal alerts go as a direct message (tasks are on by default), never to channels.
    const me = await first(t.env, "SELECT id FROM users WHERE email = 'v@x.com'");
    f.calls.length = 0;
    await notify(t.env, { to: [me.id], kind: 'task', title: 'New task for you', slack: false });
    posts = f.calls.filter((x) => x.u.includes('chat.postMessage'));
    assert.deepEqual(posts.map((p) => p.body.channel), ['UV']);
    // Turn task DMs off: nothing goes.
    await t.call('PUT', '/api/slack/prefs', { task: false, voicemail: true });
    f.calls.length = 0;
    await notify(t.env, { to: [me.id], kind: 'task', title: 'Another task', slack: false });
    assert.equal(f.calls.filter((x) => x.u.includes('chat.postMessage')).length, 0);
    // Morning summary to the digest channel.
    await run(t.env, "DELETE FROM settings WHERE k = 'digest_day'");
    const { digestTick } = await import('../src/notify.js');
    f.calls.length = 0;
    await digestTick(t.env, Date.UTC(2026, 10, 3, 14));
    assert.ok(f.calls.some((x) => x.u.includes('chat.postMessage') && x.body.channel === 'C01LEADS9' && /Good morning/.test(x.body.text)));
    // Test message and disconnect.
    assert.equal((await t.call('POST', '/api/slack/test')).data.ok, true);
    await t.call('DELETE', '/api/slack');
    assert.equal((await t.call('GET', '/api/slack')).data.connected, false);
  } finally { f.restore(); }
});

test('signed requests only: /hub command and buttons act in the Hub', async () => {
  const t = setup({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+13055073393' });
  await owner(t);
  const f = fakeSlack();
  try {
    await t.call('POST', '/api/slack/connect', { token: 'xoxb-1-2-abc', signing: SECRET });
    const c = (await t.call('POST', '/api/clients', { name: 'Sunrise Roofing', plan: 'growth', status: 'active' })).data.client;
    const me = await first(t.env, "SELECT id FROM users WHERE email = 'v@x.com'");
    await t.call('PUT', `/api/clients/${c.id}/owner`, { owner_id: me.id });
    await t.call('GET', '/api/work?who=me');
    // Bad signature and old requests are refused.
    assert.equal((await t.slack('/api/slack/command', 'user_id=UV&text=work', { secret: 'b'.repeat(32) })).status, 401);
    assert.equal((await t.slack('/api/slack/command', 'user_id=UV&text=work', { ts: Math.floor(Date.now() / 1000) - 600 })).status, 401);
    // /hub work lists my tasks with Start timer buttons.
    let r = await t.slack('/api/slack/command', 'user_id=UV&text=work');
    assert.equal(r.data.response_type, 'ephemeral');
    const startBtn = r.data.blocks.find((b) => b.accessory?.action_id === 'task_start').accessory;
    // /hub client and /hub help and /hub stats.
    r = await t.slack('/api/slack/command', 'user_id=UV&text=client sunrise');
    assert.match(JSON.stringify(r.data.blocks), /Sunrise Roofing/);
    assert.match(JSON.stringify(r.data.blocks), /tasks done/);
    r = await t.slack('/api/slack/command', 'user_id=UV&text=stats');
    assert.match(JSON.stringify(r.data.blocks), /Active clients/);
    r = await t.slack('/api/slack/command', 'user_id=UV&text=nonsense');
    assert.match(JSON.stringify(r.data.blocks), /hub lead/);
    // Unknown Slack user is matched by email; no Hub login means a polite no.
    r = await t.slack('/api/slack/command', 'user_id=UK&text=work');
    assert.match(r.data.text, /not linked/);
    // Start timer button.
    const action = (a, extra = {}) => `payload=${encodeURIComponent(JSON.stringify({ type: 'block_actions', user: { id: 'UV' }, response_url: 'https://hooks.slack.com/actions/1', actions: [a], ...extra }))}`;
    r = await t.slack('/api/slack/interact', action({ action_id: 'task_start', value: startBtn.value }));
    assert.equal(r.status, 200);
    assert.ok(await first(t.env, 'SELECT id FROM time_entries WHERE task_id = ? AND ended_at IS NULL', startBtn.value));
    // Claim a lead: owner set, message updated.
    await run(t.env, "INSERT INTO leads (id, business, phone, phone_digits, stage, created_at, updated_at) VALUES ('l1', 'Ocean Plumbing', '+13055550188', '3055550188', 'new', 0, 0)");
    f.calls.length = 0;
    r = await t.slack('/api/slack/interact', action({ action_id: 'lead_claim', value: 'l1' }, { container: { type: 'message' }, message: { blocks: [{ type: 'section' }, { type: 'actions' }] } }));
    assert.equal((await first(t.env, "SELECT owner_id FROM leads WHERE id = 'l1'")).owner_id, me.id);
    const upd = f.calls.find((x) => x.u.startsWith('https://hooks.slack.com/actions'));
    assert.equal(upd.body.replace_original, true);
    assert.match(upd.body.text, /Claimed by V/);
    // /hub lead finds it by phone.
    r = await t.slack('/api/slack/command', 'user_id=UV&text=lead 555-0188');
    assert.match(JSON.stringify(r.data.blocks), /Ocean Plumbing/);
    // Reply to a text: the button opens a form, sending it texts through the Hub with the same rules.
    await run(t.env, "INSERT INTO messages (id, lead_id, direction, body, from_num, to_num, at, read) VALUES ('m1', 'l1', 'in', 'Can you call me?', '+13055550188', '+13055073393', ?, 0)", Date.now() - 60e3);
    f.calls.length = 0;
    await t.slack('/api/slack/interact', action({ action_id: 'text_reply', value: 'l1' }, { trigger_id: 'tr1' }));
    const view = f.calls.find((x) => x.u.includes('views.open')).body;
    assert.equal(view.trigger_id, 'tr1');
    assert.match(JSON.stringify(view.view.blocks), /Can you call me/);
    const submit = `payload=${encodeURIComponent(JSON.stringify({ type: 'view_submission', user: { id: 'UV' }, view: { callback_id: 'text_reply', private_metadata: 'l1', state: { values: { b: { msg: { value: 'Calling you in 5 minutes.' } } } } } }))}`;
    r = await t.slack('/api/slack/interact', submit);
    assert.equal(r.data.response_action, 'clear');
    const sent = await first(t.env, "SELECT body FROM messages WHERE lead_id = 'l1' AND direction = 'out'");
    assert.match(sent.body, /Calling you in 5 minutes/);
    assert.match(sent.body, /Reply STOP to opt out/);
    // STOP is respected from Slack too.
    await run(t.env, "UPDATE leads SET sms_stop = 1 WHERE id = 'l1'");
    r = await t.slack('/api/slack/interact', submit);
    assert.equal(r.data.response_action, 'errors');
    assert.match(r.data.errors.b, /STOP/);
    // Mark a voicemail heard.
    await run(t.env, "INSERT INTO activities (id, type, status, at) VALUES ('a9', 'call', 'voicemail', ?)", Date.now());
    await t.slack('/api/slack/interact', action({ action_id: 'call_heard', value: 'a9' }, { message: { blocks: [] } }));
    assert.ok((await first(t.env, "SELECT seen_at FROM activities WHERE id = 'a9'")).seen_at);
  } finally { f.restore(); }
});

test('each person\'s own Slack: connect, read, send, files, share, private to them, events light up dots', async () => {
  const t = setup();
  await owner(t);
  const f = fakeSlack();
  const real = globalThis.fetch;
  const base = globalThis.fetch;
  // Extra user-token methods on top of the fake.
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('oauth.v2.access')) { f.calls.push({ u, body: String(init.body) }); return j({ ok: true, authed_user: { id: 'UV', access_token: 'xoxp-user-1' }, team: { id: 'T1', name: 'Rightway Growth' } }); }
    if (u.includes('users.conversations')) return j({ ok: true, channels: [{ id: 'C01LEADS9', name: 'leads', is_channel: true }, { id: 'D01KIRON9', is_im: true, user: 'UK' }], response_metadata: { next_cursor: '' } });
    if (u.includes('conversations.history')) return j({ ok: true, messages: [{ ts: '1700000002.000200', user: 'UK', text: 'Hey <@UV>, can you call *Ocean Plumbing*?', reply_count: 2 }, { ts: '1700000001.000100', user: 'UV', text: 'Morning' }], has_more: false });
    if (u.includes('conversations.replies')) return j({ ok: true, messages: [{ ts: '1700000002.000200', user: 'UK', text: 'parent' }, { ts: '1700000003.000300', user: 'UV', text: 'On it' }] });
    if (u.includes('conversations.mark')) return j({ ok: true });
    if (u.includes('users.info')) return j({ ok: true, user: { id: 'UK', name: 'kiron', real_name: 'Kiron', profile: { image_72: 'https://avatars.slack-edge.com/k.png', email: 'kiron@x.com' } } });
    if (u.includes('files.getUploadURLExternal')) { f.calls.push({ u, body: String(init.body) }); return j({ ok: true, upload_url: 'https://files.slack.com/upload/v1/abc', file_id: 'F1' }); }
    if (u.startsWith('https://files.slack.com/upload')) { f.calls.push({ u }); return new Response('OK'); }
    if (u.includes('files.completeUploadExternal')) { f.calls.push({ u, body: JSON.parse(init.body) }); return j({ ok: true }); }
    if (u.startsWith('https://files.slack.com/files-pri/')) return new Response('img', { headers: { 'content-type': 'image/png' } });
    if (u.includes('reactions.add') || u.includes('chat.update') || u.includes('chat.delete') || u.includes('auth.revoke')) { f.calls.push({ u, body: init.body }); return j({ ok: true }); }
    return base(url, init);
  };
  try {
    await t.call('POST', '/api/slack/connect', { token: 'xoxb-1-2-abc', signing: SECRET });
    let r = await t.call('GET', '/api/slack/me');
    assert.equal(r.data.connected, false);
    assert.equal(r.data.ready, false);
    assert.equal((await t.call('PUT', '/api/slack/app', { clientId: 'x', clientSecret: 'y' })).status, 400);
    await t.call('PUT', '/api/slack/app', { clientId: '123.456', clientSecret: 'f'.repeat(32) });
    // Sign in with Slack: start sends to Slack with the user scopes, callback stores this person's token.
    const startRes = await worker.fetch(new Request('https://hub.test/api/slack/oauth/start', { headers: { cookie: t.cookie() }, redirect: 'manual' }), t.env);
    assert.equal(startRes.status, 302);
    const loc = new URL(startRes.headers.get('location'));
    assert.equal(loc.host, 'slack.com');
    assert.match(loc.searchParams.get('user_scope'), /channels:history/);
    const st = await first(t.env, "SELECT state FROM oauth_states WHERE state LIKE 'sl_%'");
    const cb = await worker.fetch(new Request(`https://hub.test/api/slack/oauth/callback?state=${st.state}&code=abc`, { headers: { cookie: t.cookie() }, redirect: 'manual' }), t.env);
    assert.equal(cb.status, 302);
    assert.match(cb.headers.get('location'), /slack=ok/);
    const row = await first(t.env, "SELECT slack_token, slack_uid FROM users WHERE email = 'v@x.com'");
    assert.equal(row.slack_uid, 'UV');
    assert.ok(!row.slack_token.includes('xoxp'));
    assert.equal((await t.call('GET', '/api/slack/me')).data.connected, true);
    // Conversations: channels and DMs with names, and membership saved for events.
    r = await t.call('GET', '/api/slack/me/conversations');
    assert.deepEqual(r.data.conversations.map((c) => [c.kind, c.name]), [['channel', 'leads'], ['dm', 'Kiron']]);
    // An event from Slack: a DM to V lights up the dot and pushes; a retry is ignored; V's own messages do not count.
    const ev = (id, event) => JSON.stringify({ type: 'event_callback', event_id: id, event });
    r = await t.slack('/api/slack/events', JSON.stringify({ type: 'url_verification', challenge: 'xyz' }));
    assert.equal(r.data.challenge, 'xyz');
    await t.slack('/api/slack/events', ev('E1', { type: 'message', channel: 'D01KIRON9', channel_type: 'im', user: 'UK', text: 'You there?', ts: '1700000009.1' }));
    await t.slack('/api/slack/events', ev('E1', { type: 'message', channel: 'D01KIRON9', channel_type: 'im', user: 'UK', text: 'You there?', ts: '1700000009.1' }));
    await t.slack('/api/slack/events', ev('E2', { type: 'message', channel: 'C01LEADS9', channel_type: 'channel', user: 'UV', text: 'mine', ts: '1700000010.1' }));
    await t.slack('/api/slack/events', ev('E3', { type: 'message', channel: 'C01LEADS9', channel_type: 'channel', user: 'UK', text: 'new lead in', ts: '1700000011.1' }));
    r = await t.call('GET', '/api/slack/me/unreads');
    assert.deepEqual(r.data.unreads, { D01KIRON9: { count: 1, mentions: 1 }, C01LEADS9: { count: 1, mentions: 0 } });
    r = await t.call('GET', '/api/badges');
    assert.equal(r.data.slack, 2);
    assert.equal(r.data.slackMentions, 1);
    // Reading a conversation clears its dot and tells Slack it was read.
    r = await t.call('GET', '/api/slack/me/history?channel=C01LEADS9');
    assert.equal(r.data.messages[1].replies, 2);
    assert.equal(r.data.people.UK.name, 'Kiron');
    assert.equal((await t.call('GET', '/api/slack/me/unreads')).data.unreads.C01LEADS9, undefined);
    r = await t.call('GET', '/api/slack/me/replies?channel=C01LEADS9&ts=1700000002.000200');
    assert.equal(r.data.messages.length, 2);
    // Send, edit, delete, react.
    f.calls.length = 0;
    r = await t.call('POST', '/api/slack/me/send', { channel: 'C01LEADS9', text: 'Calling now', thread_ts: '1700000002.000200' });
    const post = f.calls.find((x) => x.u.includes('chat.postMessage'));
    assert.equal(post.init.headers.authorization, 'Bearer xoxp-user-1'); // posts as the person, not the bot
    assert.equal(post.body.thread_ts, '1700000002.000200');
    assert.equal((await t.call('POST', '/api/slack/me/send', { channel: 'bad', text: 'x' })).status, 400);
    await t.call('POST', '/api/slack/me/react', { channel: 'C01LEADS9', ts: '1700000002.000200', name: ':+1:' });
    await t.call('POST', '/api/slack/me/edit', { channel: 'C01LEADS9', ts: '1700000001.000100', text: 'Good morning' });
    await t.call('POST', '/api/slack/me/edit', { channel: 'C01LEADS9', ts: '1700000001.000100', remove: true });
    assert.ok(f.calls.some((x) => x.u.includes('reactions.add')) && f.calls.some((x) => x.u.includes('chat.update')) && f.calls.some((x) => x.u.includes('chat.delete')));
    // Files go up through Slack's upload flow.
    const form = new FormData();
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'proof.png', { type: 'image/png' }));
    form.append('channel', 'D01KIRON9'); form.append('comment', 'Here is the screenshot');
    const up = await worker.fetch(new Request('https://hub.test/api/slack/me/upload', { method: 'POST', body: form, headers: { 'x-rw': '1', cookie: t.cookie() } }), t.env);
    assert.equal(up.status, 200);
    const done = f.calls.find((x) => x.u.includes('files.completeUploadExternal'));
    assert.equal(done.body.channel_id, 'D01KIRON9');
    assert.equal(done.body.initial_comment, 'Here is the screenshot');
    // File proxy only fetches Slack files.
    assert.equal((await t.call('GET', `/api/slack/me/file?u=${encodeURIComponent('https://evil.example/x')}`)).status, 400);
    assert.equal((await t.call('GET', `/api/slack/me/file?u=${encodeURIComponent('https://files.slack.com/files-pri/T1-F1/a.png')}`)).status, 200);
    // Share a Hub item.
    const c = (await t.call('POST', '/api/clients', { name: 'Sunrise Roofing', plan: 'growth' })).data.client;
    f.calls.length = 0;
    await t.call('POST', '/api/slack/me/share', { channel: 'C01LEADS9', type: 'client', id: c.id, note: 'FYI' });
    assert.match(f.calls.find((x) => x.u.includes('chat.postMessage')).body.text, /FYI\n\*Client: Sunrise Roofing\*/);
    // Private: a teammate without their own Slack cannot read V's.
    const inv = await t.call('POST', '/api/team/invite', { email: 'kiron@x.com', name: 'Kiron', role: 'team' });
    const v = t.cookie();
    t.setCookie('');
    await t.call('POST', '/api/auth/invite/accept', { token: inv.data.inviteUrl.split('/').pop(), password: 'kiron password 1' });
    assert.equal((await t.call('GET', '/api/slack/me/conversations')).status, 409);
    assert.equal((await t.call('GET', '/api/slack/me/history?channel=D01KIRON9')).status, 409);
    t.setCookie(v);
    // Disconnect removes the token and dots.
    await t.call('POST', '/api/slack/me/disconnect');
    assert.equal((await t.call('GET', '/api/slack/me')).data.connected, false);
  } finally { globalThis.fetch = real; f.restore(); }
});

test('menu order per person and the dots endpoint', async () => {
  const t = setup();
  await owner(t);
  let r = await t.call('GET', '/api/me/nav');
  assert.equal(r.data.prefs, null);
  r = await t.call('PUT', '/api/me/nav', { order: ['slack', 'phone', 'home', 'BAD!'], hidden: ['google'] });
  assert.deepEqual(r.data.prefs, { order: ['slack', 'phone', 'home'], hidden: ['google'] });
  assert.deepEqual((await t.call('GET', '/api/me/nav')).data.prefs.hidden, ['google']);
  await t.call('PUT', '/api/me/nav', { reset: true });
  assert.equal((await t.call('GET', '/api/me/nav')).data.prefs, null);
  await run(t.env, "INSERT INTO leads (id, business, stage, attempts, created_at, updated_at) VALUES ('l1', 'A', 'audit_requested', 0, 0, 0)");
  r = await t.call('GET', '/api/badges');
  assert.equal(r.data.pipeline, 1);
  assert.equal(r.data.total >= 1, true);
});

test('client Messages: private channel per client, client writes from the app, team replies show with a dot and a buzz', async () => {
  const t = setup();
  await owner(t);
  const f = fakeSlack();
  const base = globalThis.fetch;
  const posted = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('conversations.create')) { f.calls.push({ u, body: JSON.parse(init.body) }); return j({ ok: true, channel: { id: 'G0CHATSUN1', name: 'chat-sunrise-roofing' } }); }
    if (u.includes('conversations.invite')) { f.calls.push({ u, body: JSON.parse(init.body) }); return j({ ok: true }); }
    if (u.includes('conversations.setPurpose')) { f.calls.push({ u, body: JSON.parse(init.body) }); return j({ ok: true }); }
    if (u.includes('chat.postMessage')) { const b = JSON.parse(init.body); posted.push({ b, auth: init.headers.authorization }); return j({ ok: true, ts: `17000001${posted.length}.0001` }); }
    if (u.includes('conversations.history')) return j({ ok: true, messages: [
      { ts: '1700000300.0003', user: 'UK', text: 'Got it, we will post it Friday.', reply_count: 1 },
      { ts: '1700000200.0002', bot_id: 'B1', username: 'Bob (Sunrise Roofing)', text: 'New roof photos attached', metadata: { event_type: 'rw_client_msg', event_payload: { hub_user: 'x' } }, files: [{ id: 'F0PIC', name: 'roof.jpg', mimetype: 'image/jpeg' }] },
      { ts: '1700000100.0001', subtype: 'channel_join', user: 'UK', text: 'joined' }] });
    if (u.includes('conversations.replies')) return j({ ok: true, messages: [{ ts: '1700000300.0003', user: 'UK', text: 'parent' }, { ts: '1700000400.0004', user: 'UV', text: 'Thread answer' }] });
    if (u.includes('users.info')) return j({ ok: true, user: { id: 'UK', name: 'kiron', real_name: 'Kiron', profile: {} } });
    if (u.includes('files.info')) return j({ ok: true, file: { id: 'F0PIC', groups: ['G0CHATSUN1'], url_private: 'https://files.slack.com/files-pri/T1-F0PIC/roof.jpg', thumb_480: 'https://files.slack.com/files-tmb/T1-F0PIC/roof_480.jpg' } });
    if (u.startsWith('https://files.slack.com/')) return new Response('img', { headers: { 'content-type': 'image/jpeg' } });
    return base(url, init);
  };
  try {
    await t.call('POST', '/api/slack/connect', { token: 'xoxb-1-2-abc', signing: SECRET });
    const c = (await t.call('POST', '/api/clients', { name: 'Sunrise Roofing', plan: 'growth', status: 'active', contact_name: 'Bob' })).data.client;
    // A new client gets their private chat right away: channel made, owners invited, a note for the team, a welcome for the client.
    let r = await t.call('GET', `/api/clients/${c.id}/chat`);
    assert.equal(r.data.ready, true);
    assert.equal(r.data.channelName, 'chat-sunrise-roofing');
    assert.equal(f.calls.find((x) => x.u.includes('conversations.create')).body.is_private, true);
    assert.equal(f.calls.find((x) => x.u.includes('conversations.invite')).body.users, 'UV');
    assert.match(f.calls.find((x) => x.u.includes('conversations.setPurpose')).body.purpose, /Keep internal talk/);
    const hello = posted.find((x) => x.b.metadata?.event_type === 'rw_hub_note');
    assert.match(hello.b.text, /Welcome to Rightway Growth, Bob/);
    assert.equal(hello.b.username, 'Rightway Growth');
    // With automatic chats off, a new client waits; the team can turn it on with a channel they pick.
    await t.call('PUT', '/api/chat/auto', { on: false });
    const c2 = (await t.call('POST', '/api/clients', { name: 'Quiet Co', plan: 'growth', status: 'active' })).data.client;
    assert.equal((await t.call('GET', `/api/clients/${c2.id}/chat`)).data.ready, false);
    r = await t.call('POST', `/api/clients/${c2.id}/chat/setup`, { channel: { id: 'G0QUIETCO1', name: 'quiet-co' } });
    assert.equal(r.data.channel.id, 'G0QUIETCO1');
    // The client logs in to their app and writes.
    const inv = await t.call('POST', `/api/clients/${c.id}/invite`, { email: 'bob@sunrise.test', name: 'Bob' });
    const staffCookie = t.cookie();
    t.setCookie('');
    await t.call('POST', '/api/auth/invite/accept', { token: inv.data.inviteUrl.split('/').pop(), password: 'client password 1' });
    posted.length = 0;
    r = await t.call('POST', `/api/clients/${c.id}/chat`, { text: 'Can you post the new roof?' });
    assert.equal(r.status, 200);
    const p = posted.find((x) => x.b.channel === 'G0CHATSUN1');
    assert.equal(p.b.username, 'Bob (Sunrise Roofing)');
    assert.equal(p.b.metadata.event_type, 'rw_client_msg');
    // The client sees the chat: their own message, the team's reply, and the thread answer inline; join notices hidden.
    r = await t.call('GET', `/api/clients/${c.id}/chat`);
    assert.deepEqual(r.data.messages.map((m) => [m.from, m.name]), [['client', 'Bob'], ['team', 'Kiron'], ['team', 'Kiron']]);
    assert.equal(r.data.messages[0].files[0].image, true);
    // Files only from their own channel.
    assert.equal((await t.call('GET', `/api/clients/${c.id}/chat/file/F0PIC?thumb=1`)).status, 200);
    // Another client cannot read this chat.
    assert.equal((await t.call('GET', '/api/clients/c_someone_else/chat')).status, 403);
    t.setCookie(staffCookie);
    // A team reply written in Slack: the client's dot lights up; the Hub's own posts are not counted twice.
    await t.slack('/api/slack/events', JSON.stringify({ type: 'event_callback', event_id: 'E9', event: { type: 'message', channel: 'G0CHATSUN1', channel_type: 'group', user: 'UK', text: 'Posted it!', ts: '1700000500.1' } }));
    await t.slack('/api/slack/events', JSON.stringify({ type: 'event_callback', event_id: 'E10', event: { type: 'message', channel: 'G0CHATSUN1', bot_id: 'B1', text: 'from the app', ts: '1700000600.1' } }));
    const bob = await first(t.env, "SELECT id FROM users WHERE email = 'bob@sunrise.test'");
    assert.equal((await first(t.env, 'SELECT count FROM slack_unread WHERE user_id = ? AND channel_id = ?', bob.id, 'G0CHATSUN1')).count, 1);
    // The team can answer from the client's Messages tab too: posted under the person's name.
    posted.length = 0;
    await t.call('POST', `/api/clients/${c.id}/chat`, { text: 'Anything else today?' });
    assert.equal(posted[0].b.username, 'V (Rightway Growth)');
    assert.equal((await first(t.env, 'SELECT count FROM slack_unread WHERE user_id = ? AND channel_id = ?', bob.id, 'G0CHATSUN1')).count, 2);
    t.setCookie('');
    await t.call('POST', '/api/auth/login', { email: 'bob@sunrise.test', password: 'client password 1' });
    assert.equal((await t.call('GET', '/api/client-badges')).data.messages, 2);
    await t.call('GET', `/api/clients/${c.id}/chat`);
    assert.equal((await t.call('GET', '/api/client-badges')).data.messages, 0);
  } finally { globalThis.fetch = base; f.restore(); }
});

test('full Slack on the Slack page: reconnect check, search, activity, channels, details, pins, links, reminders, unread, schedule, status, profiles', async () => {
  const t = setup();
  await owner(t);
  const f = fakeSlack();
  const base = globalThis.fetch;
  let scope = 'channels:history,channels:read';
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    const m = u.match(/slack\.com\/api\/([a-zA-Z0-9.]+)/)?.[1];
    const body = init.body ? (() => { try { return JSON.parse(init.body); } catch { return Object.fromEntries(new URLSearchParams(String(init.body))); } })() : Object.fromEntries(new URL(u).searchParams);
    if (m) calls.push({ m, body, auth: init.headers?.authorization });
    if (m === 'oauth.v2.access') return j({ ok: true, authed_user: { id: 'UV', access_token: 'xoxp-user-1', scope }, team: { id: 'T1', name: 'Rightway Growth' } });
    if (m === 'users.conversations') return j({ ok: true, channels: [{ id: 'C01LEADS9', name: 'leads' }, { id: 'G0CHATSUN1', name: 'chat-sunrise', is_private: true }, { id: 'D01KIRON9', is_im: true, user: 'UK' }], response_metadata: { next_cursor: '' } });
    if (m === 'users.info') return j({ ok: true, user: { id: body.user || 'UK', name: 'kiron', real_name: 'Kiron', tz: 'America/New_York', profile: { title: 'SEO lead', image_192: 'https://avatars.slack-edge.com/k192.png', status_text: 'Out', status_emoji: ':palm_tree:', email: 'kiron@x.com' } } });
    if (m === 'search.messages') return j({ ok: true, messages: { total: 1, paging: { pages: 1 }, matches: [{ ts: '1700000005.000500', user: 'UK', text: 'Ocean Plumbing called', permalink: 'https://rightway.slack.com/archives/C01LEADS9/p1700000005000500?thread_ts=1700000002.000200', channel: { id: 'C01LEADS9', name: 'leads' } }] } });
    if (m === 'emoji.list') return j({ ok: true, emoji: { rightway: 'https://emoji.slack-edge.com/T1/rightway/1.png', yay: 'alias:rightway', partyparrot: 'alias:tada' } });
    if (m === 'conversations.list') return j({ ok: true, channels: [{ id: 'C01LEADS9', name: 'leads', is_member: true, num_members: 4 }, { id: 'C09WINS99', name: 'wins', is_member: false, num_members: 7, purpose: { value: 'Good news' } }], response_metadata: { next_cursor: '' } });
    if (m === 'conversations.create') return j({ ok: true, channel: { id: 'C0NEWONE9', name: body.name } });
    if (m === 'conversations.info') return j({ ok: true, channel: { id: 'C01LEADS9', name: 'leads', topic: { value: 'Hot leads' }, purpose: { value: 'All leads' }, created: 1690000000, creator: 'UK', num_members: 2 } });
    if (m === 'conversations.members') return j({ ok: true, members: ['UV', 'UK'] });
    if (m === 'pins.list') return j({ ok: true, items: [{ type: 'message', message: { ts: '1700000001.000100', user: 'UK', text: 'Pinned rules', pinned_to: ['C01LEADS9'] } }] });
    if (m === 'files.list') return j({ ok: true, files: [{ id: 'F1', name: 'audit.pdf', mimetype: 'application/pdf', url_private: 'https://files.slack.com/files-pri/T1-F1/audit.pdf', user: 'UK', created: 1700000000 }] });
    if (m === 'chat.getPermalink') return j({ ok: true, permalink: 'https://rightway.slack.com/archives/C01LEADS9/p1700000001000100' });
    if (m === 'chat.scheduleMessage') return j({ ok: true, scheduled_message_id: 'Q1', post_at: body.post_at });
    if (m === 'chat.scheduledMessages.list') return j({ ok: true, scheduled_messages: [{ id: 'Q1', channel_id: 'C01LEADS9', post_at: 1900000000, text: 'Later' }] });
    if (m === 'users.profile.get') return j({ ok: true, profile: { real_name: 'V', image_72: 'https://avatars.slack-edge.com/v.png', status_text: '', status_emoji: '' } });
    if (m === 'users.getPresence') return j({ ok: true, presence: 'active', manual_away: false });
    if (m === 'dnd.info') return j({ ok: true, snooze_enabled: false });
    if (m === 'conversations.history') return j({ ok: true, messages: [{ ts: '1700000002.000200', user: 'UK', text: '', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*New lead* from the site' } }], attachments: [{ service_name: 'Example', title: 'Ocean Plumbing', title_link: 'https://ocean.example', text: 'Best plumber', image_url: 'https://ocean.example/a.png' }], pinned_to: ['C01LEADS9'] }], has_more: false });
    if (m && /^(conversations\.(join|leave|invite|setTopic|setPurpose|rename|mark)|pins\.(add|remove)|reminders\.add|chat\.(postMessage|deleteScheduledMessage)|users\.(profile\.set|setPresence)|dnd\.(setSnooze|endSnooze))$/.test(m)) return j({ ok: true, ts: '1700000099.000900' });
    return base(url, init);
  };
  try {
    await t.call('POST', '/api/slack/connect', { token: 'xoxb-1-2-abc', signing: SECRET });
    await t.call('PUT', '/api/slack/app', { clientId: '123.456', clientSecret: 'f'.repeat(32) });
    const connect = async () => {
      await worker.fetch(new Request('https://hub.test/api/slack/oauth/start', { headers: { cookie: t.cookie() }, redirect: 'manual' }), t.env);
      const st = await first(t.env, "SELECT state FROM oauth_states WHERE state LIKE 'sl_%' ORDER BY at DESC");
      await worker.fetch(new Request(`https://hub.test/api/slack/oauth/callback?state=${st.state}&code=abc`, { headers: { cookie: t.cookie() }, redirect: 'manual' }), t.env);
    };
    // Connected with only part of the access: the page asks to reconnect. With everything: no banner.
    await connect();
    let r = await t.call('GET', '/api/slack/me');
    assert.ok(r.data.missing.includes('search:read'));
    scope = (await import('../src/slack.js')).USER_SCOPES.join(',');
    await connect();
    assert.deepEqual((await t.call('GET', '/api/slack/me')).data.missing, []);
    // A client chat shows under the client's name, with the real channel name kept for #mentions.
    const c = (await t.call('POST', '/api/clients', { name: 'Sunrise Roofing', plan: 'growth', status: 'active' })).data.client;
    await run(t.env, 'UPDATE clients SET chat_channel = ? WHERE id = ?', 'G0CHATSUN1', c.id);
    r = await t.call('GET', '/api/slack/me/conversations');
    const chat = r.data.conversations.find((x) => x.id === 'G0CHATSUN1');
    assert.deepEqual([chat.kind, chat.name, chat.slackName, chat.clientId], ['client', 'Sunrise Roofing', 'chat-sunrise', c.id]);
    // Messages: blocks become text, link previews and pins come through.
    r = await t.call('GET', '/api/slack/me/history?channel=C01LEADS9');
    const msg = r.data.messages[0];
    assert.equal(msg.text, '*New lead* from the site');
    assert.equal(msg.attachments[0].title, 'Ocean Plumbing');
    assert.equal(msg.pinned, true);
    // Jumping to an older message loads up to it and does not mark the conversation read.
    calls.length = 0;
    await t.call('GET', '/api/slack/me/history?channel=C01LEADS9&latest=1700000002.000200');
    assert.equal(calls.find((x) => x.m === 'conversations.history').body.latest, '1700000002.000200');
    assert.ok(!calls.some((x) => x.m === 'conversations.mark'));
    // Search with the person's own token; thread results know their thread.
    r = await t.call('GET', '/api/slack/me/search?q=ocean');
    assert.equal(r.data.matches[0].thread_ts, '1700000002.000200');
    assert.equal(calls.find((x) => x.m === 'search.messages').auth, 'Bearer xoxp-user-1');
    // Workspace emoji: images, and aliases of standard ones.
    r = await t.call('GET', '/api/slack/me/emoji');
    assert.deepEqual(r.data.emoji, { rightway: 'https://emoji.slack-edge.com/T1/rightway/1.png', yay: 'https://emoji.slack-edge.com/T1/rightway/1.png', partyparrot: 'std:tada' });
    // Channels: browse, join, create with people, topic, rename, leave.
    r = await t.call('GET', '/api/slack/me/browse');
    assert.deepEqual(r.data.channels.map((x) => [x.name, x.member]), [['wins', false], ['leads', true]]);
    await t.call('POST', '/api/slack/me/channel', { action: 'join', channel: 'C09WINS99' });
    assert.ok(await first(t.env, "SELECT * FROM slack_members WHERE channel_id = 'C09WINS99'"));
    r = await t.call('POST', '/api/slack/me/channel', { action: 'create', name: 'Sales Team!', private: true, purpose: 'Sales talk', users: ['UK', 'bad'] });
    assert.equal(r.data.channel.name, 'sales-team');
    assert.equal(calls.find((x) => x.m === 'conversations.create').body.is_private, true);
    assert.equal(calls.find((x) => x.m === 'conversations.invite').body.users, 'UK');
    await t.call('POST', '/api/slack/me/channel', { action: 'topic', channel: 'C01LEADS9', text: 'Call within 5 minutes' });
    assert.equal(calls.find((x) => x.m === 'conversations.setTopic').body.topic, 'Call within 5 minutes');
    assert.equal((await t.call('POST', '/api/slack/me/channel', { action: 'rename', channel: 'C01LEADS9', name: '' })).status, 400);
    await t.call('POST', '/api/slack/me/channel', { action: 'leave', channel: 'C09WINS99' });
    assert.equal(await first(t.env, "SELECT * FROM slack_members WHERE channel_id = 'C09WINS99'"), null);
    // Details: about, members, pins, files.
    r = await t.call('GET', '/api/slack/me/details?channel=C01LEADS9');
    assert.equal(r.data.info.topic, 'Hot leads');
    assert.deepEqual(r.data.members, ['UV', 'UK']);
    assert.equal(r.data.pins[0].text, 'Pinned rules');
    assert.equal(r.data.files[0].name, 'audit.pdf');
    // Message actions: pin, copy link, forward, remind, mark unread.
    await t.call('POST', '/api/slack/me/pin', { channel: 'C01LEADS9', ts: '1700000001.000100' });
    assert.equal(calls.find((x) => x.m === 'pins.add').body.timestamp, '1700000001.000100');
    r = await t.call('GET', '/api/slack/me/permalink?channel=C01LEADS9&ts=1700000001.000100');
    assert.match(r.data.link, /archives\/C01LEADS9/);
    calls.length = 0;
    await t.call('POST', '/api/slack/me/forward', { from: 'C01LEADS9', ts: '1700000001.000100', to: 'D01KIRON9', note: 'Look' });
    const fwd = calls.find((x) => x.m === 'chat.postMessage');
    assert.equal(fwd.body.channel, 'D01KIRON9');
    assert.match(fwd.body.text, /^Look\nhttps:\/\/rightway\.slack\.com/);
    assert.equal((await t.call('POST', '/api/slack/me/remind', { channel: 'C01LEADS9', ts: '1700000001.000100', time: Math.floor(Date.now() / 1000) - 5 })).status, 400);
    await t.call('POST', '/api/slack/me/remind', { channel: 'C01LEADS9', ts: '1700000001.000100', time: Math.floor(Date.now() / 1000) + 3600 });
    assert.match(calls.find((x) => x.m === 'reminders.add').body.text, /^Look at this message: https:/);
    await t.call('POST', '/api/slack/me/unread', { channel: 'C01LEADS9', ts: '1700000001.000100', count: 3 });
    assert.equal(calls.find((x) => x.m === 'conversations.mark').body.ts, '1700000001.000099');
    assert.equal((await t.call('GET', '/api/slack/me/unreads')).data.unreads.C01LEADS9.count, 3);
    // Scheduled messages.
    assert.equal((await t.call('POST', '/api/slack/me/schedule', { channel: 'C01LEADS9', text: 'Later', post_at: 10 })).status, 400);
    const at = Math.floor(Date.now() / 1000) + 7200;
    r = await t.call('POST', '/api/slack/me/schedule', { channel: 'C01LEADS9', text: 'Later', post_at: at });
    assert.equal(r.data.id, 'Q1');
    r = await t.call('GET', '/api/slack/me/scheduled?channel=C01LEADS9');
    assert.equal(r.data.messages[0].text, 'Later');
    await t.call('POST', '/api/slack/me/scheduled/delete', { channel: 'C01LEADS9', id: 'Q1' });
    assert.equal(calls.find((x) => x.m === 'chat.deleteScheduledMessage').body.scheduled_message_id, 'Q1');
    // You: status, away, pause notifications (also quiets the Hub's Slack pushes), profiles.
    r = await t.call('GET', '/api/slack/me/status');
    assert.equal(r.data.presence, 'active');
    await t.call('POST', '/api/slack/me/status', { text: 'In a meeting', emoji: 'calendar', expires: 0 });
    assert.equal(calls.find((x) => x.m === 'users.profile.set').body.profile.status_emoji, ':calendar:');
    await t.call('POST', '/api/slack/me/presence', { away: true });
    assert.equal(calls.find((x) => x.m === 'users.setPresence').body.presence, 'away');
    await t.call('POST', '/api/slack/me/snooze', { minutes: 60 });
    assert.equal(calls.find((x) => x.m === 'dnd.setSnooze').body.num_minutes, '60');
    assert.ok((await first(t.env, "SELECT slack_snooze FROM users WHERE email = 'v@x.com'")).slack_snooze > Date.now());
    r = await t.call('GET', '/api/slack/me/profile?user=UK');
    assert.deepEqual([r.data.name, r.data.title, r.data.status.emoji, r.data.presence], ['Kiron', 'SEO lead', ':palm_tree:', 'active']);
    // Activity: a mention and a reply to V's thread are saved; thread replies do not add to the channel's dot.
    await t.call('POST', '/api/slack/me/snooze', { minutes: 0 });
    await run(t.env, 'DELETE FROM slack_unread');
    const ev = (id, event) => JSON.stringify({ type: 'event_callback', event_id: id, event });
    await t.slack('/api/slack/events', ev('EA1', { type: 'message', channel: 'C01LEADS9', channel_type: 'channel', user: 'UK', text: '<@UV> call Ocean back', ts: '1700000020.000100' }));
    await t.slack('/api/slack/events', ev('EA2', { type: 'message', channel: 'C01LEADS9', channel_type: 'channel', user: 'UK', text: 'Done', ts: '1700000021.000100', thread_ts: '1700000001.000100', parent_user_id: 'UV' }));
    r = await t.call('GET', '/api/slack/me/activity');
    assert.deepEqual(r.data.items.map((i) => i.kind).sort(), ['mention', 'reply']);
    assert.equal(r.data.unseen, 2);
    assert.equal((await t.call('GET', '/api/slack/me/unreads')).data.unreads.C01LEADS9.count, 1);
    await t.call('POST', '/api/slack/me/activity/seen');
    assert.equal((await t.call('GET', '/api/slack/me/unreads')).data.activity, 0);
  } finally { f.restore(); }
});

test('client chats: Hub updates for a client land in their chat, a new account manager is added', async () => {
  const t = setup();
  await owner(t);
  const f = fakeSlack();
  const base = globalThis.fetch;
  const posted = [];
  const invites = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('conversations.create')) return j({ ok: true, channel: { id: 'G0CHATSUN1', name: 'chat-sunrise-roofing' } });
    if (u.includes('conversations.invite')) { invites.push(JSON.parse(init.body)); return j({ ok: true }); }
    if (u.includes('conversations.setPurpose')) return j({ ok: true });
    if (u.includes('chat.postMessage')) { posted.push(JSON.parse(init.body)); return j({ ok: true, ts: `17000002${posted.length}.0001` }); }
    return base(url, init);
  };
  try {
    await t.call('POST', '/api/slack/connect', { token: 'xoxb-1-2-abc', signing: SECRET });
    await run(t.env, "INSERT INTO settings (k, v) VALUES ('hub_origin', 'https://hub.test') ON CONFLICT(k) DO UPDATE SET v = excluded.v");
    const c = (await t.call('POST', '/api/clients', { name: 'Sunrise Roofing', plan: 'growth', status: 'active', contact_name: 'Bob Lee' })).data.client;
    assert.equal((await first(t.env, 'SELECT chat_channel FROM clients WHERE id = ?', c.id)).chat_channel, 'G0CHATSUN1');
    const inv = await t.call('POST', `/api/clients/${c.id}/invite`, { email: 'bob@sunrise.test', name: 'Bob' });
    const staff = t.cookie();
    t.setCookie('');
    await t.call('POST', '/api/auth/invite/accept', { token: inv.data.inviteUrl.split('/').pop(), password: 'client password 1' });
    const bob = await first(t.env, "SELECT id FROM users WHERE email = 'bob@sunrise.test'");
    t.setCookie(staff);
    posted.length = 0;
    await notify(t.env, { to: { clientUsers: c.id }, kind: 'update', title: 'Your November report is ready', body: 'See where you show up.', url: '/report.html#abc', slack: false });
    const note = posted.find((p) => p.channel === 'G0CHATSUN1');
    assert.equal(note.username, 'Rightway Growth');
    assert.equal(note.metadata.event_type, 'rw_hub_note');
    assert.match(note.text, /\*Your November report is ready\*\nSee where you show up\.\n<https:\/\/hub\.test\/report\.html#abc\|Open it here>/);
    assert.equal((await first(t.env, 'SELECT count FROM slack_unread WHERE user_id = ? AND channel_id = ?', bob.id, 'G0CHATSUN1')).count, 1);
    // Chat messages themselves are not posted twice.
    posted.length = 0;
    await notify(t.env, { to: { clientUsers: c.id }, kind: 'update', title: 'New message from Rightway Growth', body: 'hi', url: '/#/messages', tag: `chat-${c.id}`, slack: false, list: false });
    assert.equal(posted.length, 0);
    // A new account manager with Slack linked is added to the chat.
    await run(t.env, "INSERT INTO users (id, email, name, role, pass_hash, created_at, slack_id) VALUES ('u_kir', 'kiron@x.com', 'Kiron', 'team', 'x', 1, 'UK')");
    invites.length = 0;
    await t.call('PUT', `/api/clients/${c.id}/owner`, { owner_id: 'u_kir' });
    assert.equal(invites[0].users, 'UK');
    // Clients from before get their chat from the cron, one at a time.
    await run(t.env, "INSERT INTO clients (id, name, plan, status, created_at) VALUES ('c_old', 'Old Co', 'growth', 'active', 1)");
    const { ensureClientChats } = await import('../src/chat.js');
    assert.equal(await ensureClientChats(t.env, 1), 1);
    assert.equal(await ensureClientChats(t.env, 1), 0);
  } finally { f.restore(); }
});
