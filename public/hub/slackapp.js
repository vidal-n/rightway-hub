// Slack page: each person's own Slack inside the Hub. Channels and direct messages with unread dots, messages, threads,
// reactions, edit and delete, files, and sharing Hub items (client, lead, task, report). Polls while open; new message
// events from Slack keep the dots current when the page is closed.
import { $, $$, esc, api, toast, busy, modal, icon, fmt } from './core.js';
import { staffShell } from './staff.js';
import { refreshBadges } from './nav.js';
import { slackHtml, EMOJI } from './slacktext.js';

export { slackHtml };

const QUICK = ['+1', 'white_check_mark', 'eyes', 'heart', 'joy', 'tada'];
const emoji = (n) => EMOJI[n] || `:${n}:`;
const S = { convs: [], me: null, people: {}, open: null, thread: null, timer: null, listTimer: null, sig: '', tsig: '' };

const timeOf = (ts) => new Date(Number(ts) * 1000);
const clock = (ts) => timeOf(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dayOf = (ts) => timeOf(ts).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');
const avatar = (p, name) => (p?.image ? `<img class="sl-av" src="${esc(p.image)}" alt="">` : `<span class="sl-av">${esc(initials(name))}</span>`);
const fileUrl = (u) => `/api/slack/me/file?u=${encodeURIComponent(u)}`;

export async function slackPage(app, user, channel = '') {
  const view = staffShell(app, user, 'slack');
  clearInterval(S.timer); clearInterval(S.listTimer);
  const msg = new URLSearchParams(location.search).get('slack');
  if (msg) { toast(msg === 'ok' ? 'Slack connected' : msg, msg !== 'ok'); history.replaceState(null, '', `${location.pathname}${location.hash}`); }
  let st;
  try { st = await api('/api/slack/me'); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  if (!st.connected) return connectView(view, st);
  view.classList.add('sl-main');
  view.innerHTML = `<div class="sl ${channel ? 'has-open' : ''}" id="sl">
    <aside class="sl-list"><div class="sl-list-head"><b>${esc(st.team?.name || 'Slack')}</b><button class="icon-btn" id="sl-new" title="New message">${icon.plus}</button></div>
      <input class="sl-search" id="sl-find" placeholder="Find a channel or person" aria-label="Find a conversation"><div id="sl-convs"><div class="skeleton"></div></div>
      <button class="linkish sl-disc" id="sl-disc" type="button">Disconnect my Slack</button></aside>
    <section class="sl-pane" id="sl-pane"><div class="sl-empty"><p class="muted">Pick a conversation.</p></div></section>
    <aside class="sl-thread" id="sl-thread" hidden></aside></div>`;
  $('#sl-new', view).addEventListener('click', () => newMessage());
  $('#sl-find', view).addEventListener('input', () => drawList());
  $('#sl-disc', view).addEventListener('click', async () => { if (!confirm('Disconnect your Slack from the Hub?')) return; await api('/api/slack/me/disconnect', { method: 'POST' }); location.hash = '#/slack'; location.reload(); });
  await loadConvs();
  if (channel) openConv(channel);
  else if (window.innerWidth > 900 && S.convs[0]) openConv((S.convs.find((c) => c.unread) || S.convs.find((c) => c.kind === 'channel') || S.convs[0]).id, true);
  S.listTimer = setInterval(async () => {
    if (document.hidden || !document.getElementById('sl')) return clearInterval(S.listTimer);
    try { const { unreads } = await api('/api/slack/me/unreads'); S.convs.forEach((c) => { c.unread = c.id === S.open ? 0 : unreads[c.id]?.count || 0; c.mentions = c.id === S.open ? 0 : unreads[c.id]?.mentions || 0; }); drawList(); } catch { /* ignore */ }
  }, 15e3);
  window.addEventListener('hashchange', () => { clearInterval(S.timer); clearInterval(S.listTimer); }, { once: true });
}

function connectView(view, st) {
  const steps = st.admin && !st.ready ? `<h3>Owner setup (once)</h3>
    <ol class="steps small">
      <li>On the <a href="#/alerts">Alerts page</a>, connect the Slack app first (bot token and signing secret) if you have not.</li>
      <li>In the Slack app's page (api.slack.com/apps, Rightway Hub), open <b>App Manifest</b>, paste the new setup and save. <button class="linkish" id="sl-man" type="button">Copy the new setup</button> It adds what Slack inside the Hub needs.</li>
      <li>Open <b>Basic Information</b>, copy the <b>Client ID</b> and <b>Client Secret</b>, and paste them here.</li>
    </ol>
    <form id="sl-app" class="form-grid"><label class="field"><span>Client ID</span><input name="clientId" placeholder="1234567890.1234567890" autocomplete="off" required></label>
      <label class="field"><span>Client Secret</span><input name="clientSecret" type="password" autocomplete="off" required></label>
      <div class="span-all row end"><button class="btn btn-primary" type="submit">Save</button></div></form>` : '';
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Messages</p><h1>Slack</h1></div></div>
    <div class="card" style="max-width:720px"><h2>Your Slack, inside the Hub</h2>
      <p>Connect your own Slack account. You see your channels and direct messages, post as yourself, send files, and share Hub items like a client, lead, task or report. Nobody else in the Hub can read your Slack.</p>
      ${st.ready ? '<a class="btn btn-primary btn-xl" href="/api/slack/oauth/start">Connect my Slack</a>' : st.admin ? '' : '<p class="badge warn">An owner has to finish the Slack setup first.</p>'}
      ${steps}</div>`;
  $('#sl-man', view)?.addEventListener('click', async () => {
    const d = await api('/api/slack').catch(() => null);
    if (d?.manifest) { await navigator.clipboard.writeText(JSON.stringify(d.manifest, null, 2)).catch(() => {}); toast('Setup copied. Paste it in App Manifest and save.'); }
  });
  $('#sl-app', view)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); busy(btn, true);
    try { await api('/api/slack/app', { method: 'PUT', body: Object.fromEntries(new FormData(e.target).entries()) }); toast('Saved. Now connect your Slack.'); slackPage(document.getElementById('app'), { role: 'admin' }); location.reload(); }
    catch (err) { toast(err.message, true); busy(btn, false); }
  });
}

async function loadConvs() {
  try { const r = await api('/api/slack/me/conversations'); S.convs = r.conversations; S.me = r.me; } catch (e) { $('#sl-convs').innerHTML = `<p class="err-text small">${esc(e.message)}</p>`; return; }
  drawList();
}

function drawList() {
  const box = $('#sl-convs');
  if (!box) return;
  const q = ($('#sl-find')?.value || '').toLowerCase();
  const list = S.convs.filter((c) => !q || c.name.toLowerCase().includes(q));
  const sec = (title, items) => (items.length ? `<div class="sl-sec">${title}</div>${items.map((c) => `<a class="sl-conv${c.id === S.open ? ' is-open' : ''}${c.unread ? ' is-unread' : ''}" href="#/slack/${esc(c.id)}" data-c="${esc(c.id)}">
    ${c.kind === 'dm' ? avatar({ image: c.image }, c.name) : `<span class="sl-hash">${c.kind === 'private' ? '🔒' : '#'}</span>`}<span class="sl-name">${esc(c.name)}</span>${c.unread ? `<b class="nbadge${c.mentions ? '' : ' soft'}">${c.unread > 99 ? '99+' : c.unread}</b>` : ''}</a>`).join('')}` : '');
  const byName = (a, b) => (b.unread - a.unread) || a.name.localeCompare(b.name);
  box.innerHTML = sec('Channels', list.filter((c) => c.kind === 'channel' || c.kind === 'private').sort(byName))
    + sec('Direct messages', list.filter((c) => c.kind === 'dm' || c.kind === 'group').sort((a, b) => (b.unread - a.unread) || (b.updated - a.updated)))
    || '<p class="small muted">No conversations match.</p>';
}

async function openConv(id, quiet) {
  S.open = id; S.thread = null; S.sig = '';
  const c = S.convs.find((x) => x.id === id) || { id, name: 'Conversation', kind: 'channel' };
  c.unread = 0; c.mentions = 0;
  if (!quiet && location.hash !== `#/slack/${id}`) history.replaceState(null, '', `#/slack/${id}`);
  $('#sl')?.classList.add('has-open');
  drawList();
  $('#sl-thread').hidden = true;
  $('#sl-pane').innerHTML = `<header class="sl-head"><button class="icon-btn sl-back" id="sl-back" aria-label="Back">${icon.back}</button>
      <div><b>${c.kind === 'dm' ? '' : c.kind === 'private' ? '🔒 ' : '# '}${esc(c.name)}</b>${c.topic ? `<div class="small muted sl-topic">${esc(c.topic)}</div>` : ''}</div></header>
    <div class="sl-msgs" id="sl-msgs"><div class="skeleton"></div></div>${composer('main')}`;
  $('#sl-back').addEventListener('click', () => { $('#sl').classList.remove('has-open'); history.replaceState(null, '', '#/slack'); S.open = null; clearInterval(S.timer); });
  wireComposer($('#sl-pane'), () => ({ channel: id }), () => loadMsgs(true));
  await loadMsgs(true);
  refreshBadges(true);
  clearInterval(S.timer);
  S.timer = setInterval(() => { if (!document.hidden && document.getElementById('sl-msgs')) loadMsgs(false); }, 5000);
}

async function loadMsgs(scroll) {
  const id = S.open;
  if (!id) return;
  let r;
  try { r = await api(`/api/slack/me/history?channel=${encodeURIComponent(id)}`); } catch (e) { $('#sl-msgs').innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  if (id !== S.open) return;
  Object.assign(S.people, r.people); S.me = r.me;
  const sig = JSON.stringify(r.messages.map((m) => [m.ts, m.text, m.reactions, m.replies, m.edited]));
  if (sig === S.sig) return;
  S.sig = sig;
  const box = $('#sl-msgs');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = msgsHtml(r.messages, false) || '<p class="muted small" style="padding:16px">No messages yet. Say hello.</p>';
  if (scroll || atBottom) box.scrollTop = box.scrollHeight;
  wireMsgs(box, r.messages, id);
}

function msgsHtml(msgs, inThread) {
  let lastUser = null, lastTs = 0, lastDay = '';
  return msgs.map((m) => {
    const d = dayOf(m.ts);
    const p = S.people[m.user] || {};
    const name = p.name || m.botName || 'Someone';
    const compact = m.user === lastUser && Number(m.ts) - lastTs < 300 && d === lastDay;
    const sep = d !== lastDay ? `<div class="sl-day"><span>${esc(d)}</span></div>` : '';
    lastUser = m.user; lastTs = Number(m.ts); lastDay = d;
    if (m.subtype === 'channel_join' || m.subtype === 'channel_leave') return `${sep}<div class="sl-note small muted">${slackHtml(m.text, S.people)}</div>`;
    const mine = m.user && m.user === S.me;
    return `${sep}<div class="sl-msg${compact ? ' compact' : ''}" data-ts="${esc(m.ts)}">
      ${compact ? `<span class="sl-time-c">${clock(m.ts)}</span>` : avatar(p, name)}
      <div class="sl-body">${compact ? '' : `<div class="sl-meta"><b>${esc(name)}</b> <span class="small muted">${clock(m.ts)}</span></div>`}
        <div class="sl-text">${slackHtml(m.text, S.people)}${m.edited ? ' <span class="small muted">(edited)</span>' : ''}</div>
        ${m.files.map((f) => (f.thumb && /^image\//.test(f.mimetype) ? `<a href="${esc(fileUrl(f.url || f.thumb))}" target="_blank" rel="noopener"><img class="sl-img" src="${esc(fileUrl(f.thumb))}" alt="${esc(f.name)}" loading="lazy"></a>`
          : `<a class="sl-file" href="${esc(f.url ? fileUrl(f.url) : f.permalink || '#')}" target="_blank" rel="noopener">${icon.clip}<span>${esc(f.name)}</span></a>`)).join('')}
        ${m.reactions.length ? `<div class="sl-reacts">${m.reactions.map((x) => `<button class="sl-react${x.users.includes(S.me) ? ' mine' : ''}" data-react="${esc(x.name)}" data-on="${x.users.includes(S.me) ? 1 : 0}">${emoji(x.name)} ${x.count}</button>`).join('')}</div>` : ''}
        ${!inThread && m.replies ? `<button class="linkish sl-replies" data-thread="${esc(m.ts)}">${m.replies} repl${m.replies === 1 ? 'y' : 'ies'}</button>` : ''}
      </div>
      <div class="sl-tools"><button class="icon-btn" data-pick="${esc(m.ts)}" title="React">${icon.smile}</button>${inThread ? '' : `<button class="icon-btn" data-thread="${esc(m.ts)}" title="Reply in thread">${icon.reply}</button>`}
        ${mine ? `<button class="icon-btn" data-edit="${esc(m.ts)}" title="Edit">${icon.note}</button><button class="icon-btn" data-del="${esc(m.ts)}" title="Delete">${icon.trash}</button>` : ''}</div></div>`;
  }).join('');
}

function wireMsgs(box, msgs, channel, inThread = false) {
  box.onclick = async (e) => {
    const el = e.target.closest('[data-react],[data-pick],[data-thread],[data-edit],[data-del],[data-emoji]');
    if (!el) return;
    const ts = el.closest('.sl-msg')?.dataset.ts;
    try {
      if (el.dataset.react) { await api('/api/slack/me/react', { method: 'POST', body: { channel, ts, name: el.dataset.react, remove: el.dataset.on === '1' } }); S.sig = ''; S.tsig = ''; return refreshView(inThread); }
      if (el.dataset.emoji) { el.closest('.sl-pick')?.remove(); await api('/api/slack/me/react', { method: 'POST', body: { channel, ts, name: el.dataset.emoji } }); S.sig = ''; S.tsig = ''; return refreshView(inThread); }
      if (el.dataset.pick) {
        $$('.sl-pick', box).forEach((x) => x.remove());
        el.closest('.sl-msg').insertAdjacentHTML('beforeend', `<div class="sl-pick">${QUICK.map((n) => `<button data-emoji="${n}">${emoji(n)}</button>`).join('')}</div>`);
        return;
      }
      if (el.dataset.thread) return openThread(channel, el.dataset.thread);
      if (el.dataset.edit) {
        const m = msgs.find((x) => x.ts === el.dataset.edit);
        const text = prompt('Edit message', m?.text || '');
        if (text == null || text === m?.text) return;
        await api('/api/slack/me/edit', { method: 'POST', body: { channel, ts: el.dataset.edit, text } }); S.sig = ''; S.tsig = ''; return refreshView(inThread);
      }
      if (el.dataset.del) {
        if (!confirm('Delete this message for everyone?')) return;
        await api('/api/slack/me/edit', { method: 'POST', body: { channel, ts: el.dataset.del, remove: true } }); S.sig = ''; S.tsig = ''; return refreshView(inThread);
      }
    } catch (err) { toast(err.message, true); }
  };
}
const refreshView = (inThread) => (inThread && S.thread ? loadThread() : loadMsgs(false));

async function openThread(channel, ts) {
  S.thread = { channel, ts }; S.tsig = '';
  const pane = $('#sl-thread');
  pane.hidden = false;
  pane.innerHTML = `<header class="sl-head"><b>Thread</b><span class="spacer"></span><button class="icon-btn" id="sl-tclose" aria-label="Close thread">${icon.close}</button></header>
    <div class="sl-msgs" id="sl-tmsgs"><div class="skeleton"></div></div>${composer('thread')}`;
  $('#sl-tclose').addEventListener('click', () => { pane.hidden = true; S.thread = null; });
  wireComposer(pane, () => ({ channel, thread_ts: ts }), () => { S.tsig = ''; loadThread(); S.sig = ''; loadMsgs(false); });
  await loadThread();
}
async function loadThread() {
  if (!S.thread) return;
  const { channel, ts } = S.thread;
  try {
    const r = await api(`/api/slack/me/replies?channel=${encodeURIComponent(channel)}&ts=${encodeURIComponent(ts)}`);
    Object.assign(S.people, r.people);
    const sig = JSON.stringify(r.messages.map((m) => [m.ts, m.text, m.reactions]));
    if (sig === S.tsig) return;
    S.tsig = sig;
    const box = $('#sl-tmsgs');
    box.innerHTML = msgsHtml(r.messages, true);
    box.scrollTop = box.scrollHeight;
    wireMsgs(box, r.messages, channel, true);
  } catch (e) { $('#sl-tmsgs').innerHTML = `<p class="err-text">${esc(e.message)}</p>`; }
}

function composer(kind) {
  return `<form class="sl-compose" data-kind="${kind}"><textarea rows="1" name="text" placeholder="${kind === 'thread' ? 'Reply in the thread' : 'Write a message'}" aria-label="Message"></textarea>
    <div class="row sl-compose-row"><label class="icon-btn" title="Attach a file">${icon.clip}<input type="file" name="file" hidden></label>
      <button type="button" class="btn btn-ghost btn-sm" data-share>Share from the Hub</button><span class="small muted sl-filename"></span><span class="spacer"></span>
      <button class="btn btn-primary btn-sm" type="submit">${icon.send}Send</button></div></form>`;
}

function wireComposer(root, target, after) {
  const f = $('.sl-compose', root);
  const ta = $('textarea', f);
  const fileIn = $('input[type=file]', f);
  const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(200, ta.scrollHeight)}px`; };
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); f.requestSubmit(); } });
  fileIn.addEventListener('change', () => { $('.sl-filename', f).textContent = fileIn.files[0] ? fileIn.files[0].name : ''; });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    const file = fileIn.files[0];
    if (!text && !file) return;
    const btn = f.querySelector('button[type=submit]'); busy(btn, true);
    try {
      const t = target();
      if (file) {
        const form = new FormData();
        form.append('file', file); form.append('channel', t.channel); if (t.thread_ts) form.append('thread_ts', t.thread_ts); if (text) form.append('comment', text);
        await api('/api/slack/me/upload', { method: 'POST', form });
        fileIn.value = ''; $('.sl-filename', f).textContent = '';
      } else await api('/api/slack/me/send', { method: 'POST', body: { ...t, text } });
      ta.value = ''; grow();
      S.sig = ''; after();
    } catch (err) { toast(err.message, true); }
    busy(btn, false);
    ta.focus();
  });
  $('[data-share]', f).addEventListener('click', () => shareItem(target(), after));
}

function shareItem(t, after) {
  const m = modal(`<div class="card-head"><h2>Share from the Hub</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <input id="sh-q" placeholder="Search clients, leads, tasks, reports" style="width:100%"><ul class="list" id="sh-list" style="margin-top:10px"></ul>
    <label class="field" style="margin-top:10px"><span>Note (optional)</span><input id="sh-note"></label>`);
  const search = async () => {
    const { items } = await api(`/api/slack/me/items?q=${encodeURIComponent($('#sh-q', m.el).value)}`).catch(() => ({ items: [] }));
    $('#sh-list', m.el).innerHTML = items.map((x) => `<li class="item"><span class="badge gray">${esc(x.type)}</span><div class="item-title">${esc(x.label)}</div><button class="btn btn-primary btn-sm" data-type="${esc(x.type)}" data-id="${esc(x.id)}">Send</button></li>`).join('') || '<li class="muted small">Nothing found.</li>';
  };
  let tm;
  $('#sh-q', m.el).addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(search, 250); });
  $('#sh-list', m.el).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    busy(b, true);
    try { await api('/api/slack/me/share', { method: 'POST', body: { ...t, type: b.dataset.type, id: b.dataset.id, note: $('#sh-note', m.el).value } }); toast('Shared'); m.close(); S.sig = ''; after(); }
    catch (err) { toast(err.message, true); busy(b, false); }
  });
  search();
  $('#sh-q', m.el).focus();
}

async function newMessage() {
  const m = modal(`<div class="card-head"><h2>New message</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <input id="nm-q" placeholder="Find a person" style="width:100%"><ul class="list" id="nm-list" style="margin-top:10px"><li class="skeleton"></li></ul>`);
  let ppl = [];
  try { ppl = (await api('/api/slack/me/people')).people.filter((p) => p.id !== S.me); } catch (e) { $('#nm-list', m.el).innerHTML = `<li class="err-text">${esc(e.message)}</li>`; return; }
  const draw = () => {
    const q = $('#nm-q', m.el).value.toLowerCase();
    $('#nm-list', m.el).innerHTML = ppl.filter((p) => !q || p.name.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q)).slice(0, 40)
      .map((p) => `<li class="item" data-u="${esc(p.id)}" style="cursor:pointer">${avatar(p, p.name)}<div><div class="item-title">${esc(p.name)}</div><div class="item-sub">@${esc(p.handle)}</div></div></li>`).join('') || '<li class="muted small">No one found.</li>';
  };
  draw();
  $('#nm-q', m.el).addEventListener('input', draw);
  $('#nm-list', m.el).addEventListener('click', async (e) => {
    const li = e.target.closest('[data-u]');
    if (!li) return;
    try {
      const { channel } = await api('/api/slack/me/open', { method: 'POST', body: { users: [li.dataset.u] } });
      m.close();
      if (!S.convs.some((c) => c.id === channel)) { const p = ppl.find((x) => x.id === li.dataset.u); S.convs.unshift({ id: channel, kind: 'dm', name: p.name, image: p.image, unread: 0, mentions: 0, updated: Date.now() / 1000 }); }
      openConv(channel);
    } catch (err) { toast(err.message, true); }
  });
  $('#nm-q', m.el).focus();
}

// Shared from other pages: "Send in Slack" for a client, lead, task or report.
export async function sendToSlack(type, id) {
  let convs;
  try { ({ conversations: convs } = await api('/api/slack/me/conversations')); } catch (e) { toast(e.status === 409 ? 'Connect your Slack on the Slack page first.' : e.message, true); return; }
  const m = modal(`<div class="card-head"><h2>Send in Slack</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <input id="ss-q" placeholder="Find a channel or person" style="width:100%"><label class="field" style="margin-top:8px"><span>Note (optional)</span><input id="ss-note"></label><ul class="list" id="ss-list" style="margin-top:10px"></ul>`);
  const draw = () => {
    const q = $('#ss-q', m.el).value.toLowerCase();
    $('#ss-list', m.el).innerHTML = convs.filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 30).map((c) => `<li class="item"><span>${c.kind === 'dm' ? '@' : '#'}</span><div class="item-title">${esc(c.name)}</div><button class="btn btn-primary btn-sm" data-c="${esc(c.id)}">Send</button></li>`).join('');
  };
  draw();
  $('#ss-q', m.el).addEventListener('input', draw);
  $('#ss-list', m.el).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    busy(b, true);
    try { await api('/api/slack/me/share', { method: 'POST', body: { channel: b.dataset.c, type, id, note: $('#ss-note', m.el).value } }); toast('Sent in Slack'); m.close(); } catch (err) { toast(err.message, true); busy(b, false); }
  });
}
