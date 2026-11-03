// Gmail inside the Hub: labels, threads, reading, replying, composing, search.
// Mail from a lead or client shows who they are with a link straight to their page.
import { $, $$, esc, api, toast, busy, icon, modal } from './core.js';
import { staffShell } from './staff.js';
import { googleTabs } from './googleapps.js';
import { safeMailHtml, addr, addrList, replyTo, quoted } from '../js/gmailparse.js';

const QUICK = [
  ['INBOX', 'Inbox', 'mail'], ['STARRED', 'Starred', 'star'], ['SENT', 'Sent', 'send'],
  ['DRAFT', 'Drafts', 'doc'], ['IMPORTANT', 'Important', 'flag'], ['SPAM', 'Spam', 'warn'], ['TRASH', 'Trash', 'trash'],
];
const S = { label: 'INBOX', q: '', threads: [], cursor: null, open: null, email: '', labels: [], images: new Set() };

const when = (ms) => {
  if (!ms) return '';
  const d = new Date(ms); const nowD = new Date();
  const sameDay = d.toDateString() === nowD.toDateString();
  if (sameDay) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === nowD.getFullYear()) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const longWhen = (ms) => (ms ? new Date(ms).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export async function mailPage(app, user, sub = '', subId = '') {
  const view = staffShell(app, user, 'google');
  view.innerHTML = `${googleTabs('mail')}<div class="gm-wrap"><div class="gm-side skeleton"></div><div class="gm-list skeleton"></div></div>`;
  let labels;
  try { labels = await api('/api/google/mail/labels'); }
  catch (e) {
    view.innerHTML = `${googleTabs('mail')}<div class="card"><h2>Gmail is not on yet</h2><p>${esc(e.message)}</p><a class="btn btn-primary" href="/api/google/connect?back=google&apps=mail">Turn on Gmail</a></div>`;
    return;
  }
  S.labels = labels.labels || [];
  S.email = labels.email || '';
  const pre = new URLSearchParams(location.search);
  if (sub === 't' && subId) S.open = subId;
  else if (sub) { S.label = sub.toUpperCase(); S.open = null; }
  view.innerHTML = `${googleTabs('mail')}
    <div class="gm-wrap${S.open ? ' is-open' : ''}" id="gmw">
      <aside class="gm-side">
        <button class="btn btn-primary gm-new" id="gm-new">${icon.plus} Write</button>
        <nav class="gm-labels" id="gm-labels"></nav>
      </aside>
      <section class="gm-list" id="gm-list"></section>
      <section class="gm-read" id="gm-read"></section>
    </div>`;
  paintLabels();
  $('#gm-new', view).addEventListener('click', () => compose({}));
  if (pre.get('to')) {
    compose({ to: pre.get('to'), subject: pre.get('subject') || '', html: pre.get('body') ? esc(pre.get('body')).replace(/\n/g, '<br>') : '' });
    history.replaceState(null, '', `${location.pathname}${location.hash}`);
  }
  await loadList();
  if (S.open) openThread(S.open);
}

function paintLabels() {
  const box = $('#gm-labels');
  if (!box) return;
  const have = new Set(S.labels.map((l) => l.id));
  const quick = QUICK.filter((q) => have.has(q[0]) || q[0] === 'INBOX');
  const mine = S.labels.filter((l) => !l.system);
  box.innerHTML = `
    <div class="gm-search"><label class="sr-only" for="gm-q">Search mail</label>
      <input id="gm-q" type="search" placeholder="Search mail" value="${esc(S.q)}" autocomplete="off"></div>
    ${quick.map(([id, name]) => `<button class="gm-lab${S.label === id && !S.q ? ' is-on' : ''}" data-label="${id}">${esc(name)}</button>`).join('')}
    <button class="gm-lab${S.label === 'ALL' ? ' is-on' : ''}" data-label="ALL">All mail</button>
    ${mine.length ? `<p class="gm-lab-head">Your labels</p>${mine.map((l) => `<button class="gm-lab${S.label === l.id ? ' is-on' : ''}" data-label="${esc(l.id)}">${esc(l.name)}</button>`).join('')}` : ''}
    <p class="small muted" style="padding:10px 10px 0">${esc(S.email)}</p>`;
  $$('[data-label]', box).forEach((b) => b.addEventListener('click', () => {
    S.label = b.dataset.label; S.q = ''; S.open = null; S.cursor = null;
    location.hash = `#/google/mail/${S.label.toLowerCase()}`;
    paintLabels(); loadList();
  }));
  const q = $('#gm-q', box);
  q.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    S.q = q.value.trim(); S.cursor = null; S.open = null;
    loadList();
  });
}

async function loadList(more = false) {
  const box = $('#gm-list');
  if (!box) return;
  if (!more) box.innerHTML = '<div class="skeleton" style="height:70px;margin:10px"></div>'.repeat(5);
  let d;
  try { d = await api(`/api/google/mail/threads?${new URLSearchParams({ label: S.label, q: S.q, ...(more && S.cursor ? { cursor: S.cursor } : {}) })}`); }
  catch (e) { box.innerHTML = `<p class="err-text" style="padding:16px">${esc(e.message)}</p>`; return; }
  S.threads = more ? [...S.threads, ...d.threads] : d.threads;
  S.cursor = d.cursor;
  paintList();
}

function paintList() {
  const box = $('#gm-list');
  if (!box) return;
  const title = S.q ? `Search: ${S.q}` : (QUICK.find((q) => q[0] === S.label) || [])[1] || (S.labels.find((l) => l.id === S.label) || {}).name || 'All mail';
  box.innerHTML = `
    <div class="gm-list-head"><h2>${esc(title)}</h2><button class="icon-btn" id="gm-refresh" aria-label="Refresh">${icon.refresh || icon.clock}</button></div>
    ${S.threads.length ? `<ul class="gm-rows">${S.threads.map(row).join('')}</ul>` : '<p class="muted" style="padding:20px">Nothing here.</p>'}
    ${S.cursor ? '<div class="row center" style="padding:14px"><button class="btn btn-ghost btn-sm" id="gm-more">Show older</button></div>' : ''}`;
  $('#gm-refresh', box).addEventListener('click', () => loadList());
  $('#gm-more', box)?.addEventListener('click', (e) => { busy(e.currentTarget, true); loadList(true); });
  $$('.gm-row', box).forEach((r) => {
    r.addEventListener('click', (e) => { if (!e.target.closest('[data-act]')) openThread(r.dataset.id); });
    $$('[data-act]', r).forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const t = S.threads.find((x) => x.id === r.dataset.id);
      const act = b.dataset.act;
      try {
        if (act === 'star') { const on = !t.starred; t.starred = on; await api(`/api/google/mail/threads/${t.id}/modify`, { method: 'POST', body: on ? { add: ['STARRED'] } : { remove: ['STARRED'] } }); paintList(); }
        if (act === 'archive') { await api(`/api/google/mail/threads/${t.id}/modify`, { method: 'POST', body: { remove: ['INBOX'] } }); S.threads = S.threads.filter((x) => x.id !== t.id); paintList(); toast('Archived'); }
        if (act === 'trash') { await api(`/api/google/mail/threads/${t.id}/trash`, { method: 'POST' }); S.threads = S.threads.filter((x) => x.id !== t.id); paintList(); toast('In the trash'); }
      } catch (err) { toast(err.message, true); }
    }));
  });
}

const row = (t) => `<li class="gm-row${t.unread ? ' is-unread' : ''}${S.open === t.id ? ' is-open' : ''}" data-id="${esc(t.id)}" tabindex="0">
  <button class="gm-star${t.starred ? ' is-on' : ''}" data-act="star" aria-label="Star">${icon.star}</button>
  <div class="gm-row-main">
    <div class="gm-row-top"><span class="gm-who">${esc(t.who)}${t.count > 1 ? ` <span class="gm-n">${t.count}</span>` : ''}</span><span class="gm-when">${esc(when(t.date))}</span></div>
    <div class="gm-subj">${esc(t.subject)}</div>
    <div class="gm-snip">${esc(t.snippet.slice(0, 140))}</div>
  </div>
  <div class="gm-row-tools">
    ${t.attach ? `<span class="gm-clip" aria-label="Has a file">${icon.chain}</span>` : ''}
    <button class="icon-btn" data-act="archive" aria-label="Archive">${icon.check}</button>
    <button class="icon-btn" data-act="trash" aria-label="Delete">${icon.trash}</button>
  </div></li>`;

async function openThread(id) {
  S.open = id;
  const box = $('#gm-read');
  $('#gmw')?.classList.add('is-open');
  paintList();
  box.innerHTML = '<div class="skeleton" style="height:120px;margin:16px"></div>';
  let d;
  try { d = await api(`/api/google/mail/threads/${id}`); }
  catch (e) { box.innerHTML = `<p class="err-text" style="padding:16px">${esc(e.message)}</p>`; return; }
  const t = S.threads.find((x) => x.id === id);
  if (t) { t.unread = false; paintList(); }
  const last = d.messages[d.messages.length - 1];
  const people = [...d.leads.map((l) => ['lead', l.id, l.business]), ...d.clients.map((c) => ['client', c.id, c.name])];
  box.innerHTML = `
    <div class="gm-read-head">
      <button class="icon-btn gm-back" id="gm-back" aria-label="Back">${icon.back}</button>
      <h2>${esc(last.subject || '(no subject)')}</h2>
      <div class="row" style="gap:4px">
        <button class="icon-btn" id="gm-arch" aria-label="Archive" title="Archive">${icon.check}</button>
        <button class="icon-btn" id="gm-unread" aria-label="Mark unread" title="Mark unread">${icon.mail}</button>
        <button class="icon-btn" id="gm-cal" aria-label="Put on my calendar" title="Put on my calendar">${icon.clock}</button>
        <button class="icon-btn" id="gm-del" aria-label="Delete" title="Delete">${icon.trash}</button>
      </div>
    </div>
    ${people.length ? `<div class="gm-chips">${people.map(([k, pid, name]) => `<a class="chip" href="#/${k === 'lead' ? `pipeline/${pid}` : `clients/${pid}`}">${k === 'lead' ? 'Lead' : 'Client'}: ${esc(name)}</a>`).join('')}</div>` : ''}
    <div class="gm-msgs" id="gm-msgs">${d.messages.map((m, i) => message(m, i === d.messages.length - 1, d.me)).join('')}</div>
    <div class="gm-reply">
      <button class="btn btn-primary btn-sm" id="gm-reply">${icon.reply} Reply</button>
      <button class="btn btn-ghost btn-sm" id="gm-replyall">Reply to all</button>
      <button class="btn btn-ghost btn-sm" id="gm-fwd">${icon.fwd} Forward</button>
    </div>`;
  $('#gm-back', box).addEventListener('click', () => { S.open = null; $('#gmw').classList.remove('is-open'); paintList(); });
  $('#gm-arch', box).addEventListener('click', async (e) => {
    busy(e.currentTarget, true);
    try { await api(`/api/google/mail/threads/${id}/modify`, { method: 'POST', body: { remove: ['INBOX'] } }); S.threads = S.threads.filter((x) => x.id !== id); S.open = null; $('#gmw').classList.remove('is-open'); box.innerHTML = ''; paintList(); toast('Archived'); }
    catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
  });
  $('#gm-unread', box).addEventListener('click', async () => {
    try { await api(`/api/google/mail/threads/${id}/modify`, { method: 'POST', body: { add: ['UNREAD'] } }); const x = S.threads.find((y) => y.id === id); if (x) x.unread = true; paintList(); toast('Marked unread'); }
    catch (err) { toast(err.message, true); }
  });
  $('#gm-del', box).addEventListener('click', async (e) => {
    busy(e.currentTarget, true);
    try { await api(`/api/google/mail/threads/${id}/trash`, { method: 'POST' }); S.threads = S.threads.filter((x) => x.id !== id); S.open = null; $('#gmw').classList.remove('is-open'); box.innerHTML = ''; paintList(); toast('In the trash'); }
    catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
  });
  $('#gm-cal', box).addEventListener('click', () => import('./gcal.js').then((x) => x.quickEvent({
    title: last.subject || 'Meeting',
    attendees: [...addrList(last.from), ...addrList(last.to)].map((a) => a.email).filter((e) => e && e !== d.me),
    notes: `From the email "${last.subject || ''}".`,
    clientId: d.clients[0]?.id || null, leadId: d.leads[0]?.id || null,
  })));
  $('#gm-reply', box).addEventListener('click', () => compose({ ...replyTo(last, d.me, false), html: '', threadId: id, quote: quoted(last) }));
  $('#gm-replyall', box).addEventListener('click', () => compose({ ...replyTo(last, d.me, true), html: '', threadId: id, quote: quoted(last) }));
  $('#gm-fwd', box).addEventListener('click', () => compose({ to: '', subject: /^fwd:/i.test(last.subject) ? last.subject : `Fwd: ${last.subject}`, html: '', quote: quoted(last) }));
  wireMessages(box, d.messages);
}

function message(m, open, me = '') {
  const from = addr(m.from);
  const mine = String(me || '').toLowerCase();
  const to = addrList(m.to).map((a) => (a.email === mine ? 'me' : a.name)).join(', ');
  const showImgs = S.images.has(m.id);
  return `<article class="gm-msg${open ? ' is-open' : ''}" data-id="${esc(m.id)}">
    <header class="gm-msg-head">
      <span class="avatar">${esc(initials(from.name))}</span>
      <div class="gm-msg-who"><b>${esc(from.name)}</b> <span class="small muted">${esc(from.email)}</span>
        <div class="small muted">to ${esc(to || 'me')}</div></div>
      <span class="small muted gm-msg-when">${esc(longWhen(m.date))}</span>
    </header>
    <div class="gm-msg-body">
      ${m.remoteImages && !showImgs ? '<div class="gm-imgbar">Pictures in this email are hidden. <button class="btn btn-ghost btn-sm" data-imgs>Show pictures</button></div>' : ''}
      <div class="gm-html">${safeMailHtml(m.html, { images: showImgs })}</div>
      ${m.attachments.length ? `<div class="gm-atts">${m.attachments.map((a) => `<span class="gm-att"><a href="/api/google/mail/att/${esc(m.id)}/${esc(a.id)}?name=${encodeURIComponent(a.name)}" download>${icon.chain}<span>${esc(a.name)}</span><em>${Math.max(1, Math.round(a.size / 1024))} KB</em></a>
        <button class="icon-btn" data-drive="${esc(a.id)}" data-name="${esc(a.name)}" data-type="${esc(a.type)}" aria-label="Keep in Drive" title="Keep in Drive">${icon.folder}</button></span>`).join('')}</div>` : ''}
    </div>
    <div class="gm-msg-shut">${esc(m.snippet.slice(0, 120))}</div>
  </article>`;
}

function wireMessages(box, messages) {
  $$('.gm-msg', box).forEach((el) => {
    $('.gm-msg-head', el).addEventListener('click', () => el.classList.toggle('is-open'));
    $('.gm-msg-shut', el).addEventListener('click', () => el.classList.add('is-open'));
    $('[data-imgs]', el)?.addEventListener('click', (e) => {
      e.stopPropagation();
      const m = messages.find((x) => x.id === el.dataset.id);
      S.images.add(m.id);
      $('.gm-html', el).innerHTML = safeMailHtml(m.html, { images: true });
      $('.gm-imgbar', el).remove();
    });
    $$('.gm-html a', el).forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    $$('[data-drive]', el).forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      busy(b, true);
      try {
        const r = await api(`/api/google/mail/att/${encodeURIComponent(el.dataset.id)}/${encodeURIComponent(b.dataset.drive)}/drive`, {
          method: 'POST', body: { msgId: el.dataset.id, attId: b.dataset.drive, name: b.dataset.name, type: b.dataset.type },
        });
        toast(`${r.file.name} is in your Drive`);
      } catch (err) { toast(err.message, true); } finally { busy(b, false); }
    }));
  });
}

// ---------- compose ----------
export function compose({ to = '', cc = '', bcc = '', subject = '', html = '', quote = '', threadId = '', inReplyTo = '', references = '' } = {}) {
  const files = [];
  const m = modal(`<div class="gm-compose">
    <div class="card-head"><h2>${esc(threadId ? 'Reply' : 'New email')}</h2><button class="icon-btn" data-close aria-label="Close">${icon.close}</button></div>
    <div class="gm-to"><label class="field"><span>To</span><input id="gmc-to" value="${esc(to)}" autocomplete="off" placeholder="name@business.com"><div class="gm-sug" id="gmc-sug" hidden></div></label>
      <button class="btn btn-ghost btn-sm" id="gmc-cc">Cc and Bcc</button></div>
    <div id="gmc-ccbox" hidden><label class="field"><span>Cc</span><input id="gmc-ccv" value="${esc(cc)}"></label><label class="field"><span>Bcc</span><input id="gmc-bcc" value="${esc(bcc)}"></label></div>
    <label class="field"><span>Subject</span><input id="gmc-subj" value="${esc(subject)}"></label>
    <div class="gm-tools">
      ${[['bold', 'B'], ['italic', 'I'], ['insertUnorderedList', 'List'], ['createLink', 'Link']].map(([c, n]) => `<button type="button" class="btn btn-ghost btn-sm" data-cmd="${c}">${n}</button>`).join('')}
      <button type="button" class="btn btn-ghost btn-sm" id="gmc-file">Attach a file</button>
      <button type="button" class="btn btn-ghost btn-sm" id="gmc-drive">From Drive</button>
      <input type="file" id="gmc-input" multiple hidden>
    </div>
    <div class="gm-editor" id="gmc-body" contenteditable="true" role="textbox" aria-label="Message">${html}</div>
    ${quote ? `<details class="gm-quoted"><summary>Earlier message</summary><div>${quote}</div></details>` : ''}
    <div class="gm-files" id="gmc-files"></div>
    <div class="row end" style="gap:8px;margin-top:14px"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="gmc-send">${icon.send} Send</button></div>
  </div>`);
  const el = m.el;
  const body = $('#gmc-body', el);
  setTimeout(() => (to ? body : $('#gmc-to', el)).focus(), 60);
  $('#gmc-cc', el).addEventListener('click', () => { const b = $('#gmc-ccbox', el); b.hidden = !b.hidden; });
  $$('[data-cmd]', el).forEach((b) => b.addEventListener('click', () => {
    body.focus();
    if (b.dataset.cmd === 'createLink') { const u = prompt('Link address'); if (u) document.execCommand('createLink', false, u); return; }
    document.execCommand(b.dataset.cmd, false, null);
  }));
  body.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    document.execCommand('insertText', false, text);
  });
  // Address suggestions from the Hub's own leads, clients and team.
  const toIn = $('#gmc-to', el); const sug = $('#gmc-sug', el);
  let timer;
  toIn.addEventListener('input', () => {
    clearTimeout(timer);
    const part = toIn.value.split(',').pop().trim();
    if (part.length < 2) { sug.hidden = true; return; }
    timer = setTimeout(async () => {
      try {
        const r = await api(`/api/google/mail/people?q=${encodeURIComponent(part)}`);
        if (!r.people.length) { sug.hidden = true; return; }
        sug.innerHTML = r.people.map((p) => `<button type="button" data-email="${esc(p.email)}"><b>${esc(p.name)}</b> <span class="small muted">${esc(p.email)}</span><em class="badge gray">${esc(p.kind)}</em></button>`).join('');
        sug.hidden = false;
        $$('[data-email]', sug).forEach((b) => b.addEventListener('click', () => {
          const parts = toIn.value.split(','); parts[parts.length - 1] = ` ${b.dataset.email}`;
          toIn.value = `${parts.join(',').replace(/^\s+/, '')}, `; sug.hidden = true; toIn.focus();
        }));
      } catch { sug.hidden = true; }
    }, 220);
  });
  toIn.addEventListener('blur', () => setTimeout(() => { sug.hidden = true; }, 180));
  // Attachments
  const input = $('#gmc-input', el);
  $('#gmc-file', el).addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    for (const f of [...input.files]) {
      if (f.size > 5e6) { toast(`${f.name} is bigger than 5 MB`, true); continue; }
      const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(f); });
      files.push({ name: f.name, type: f.type || 'application/octet-stream', data });
    }
    input.value = '';
    $('#gmc-files', el).innerHTML = files.map((f, i) => `<span class="gm-file">${esc(f.name)} <button type="button" data-rm="${i}" aria-label="Remove">${icon.close}</button></span>`).join('');
    $$('[data-rm]', el).forEach((b) => b.addEventListener('click', () => { files.splice(Number(b.dataset.rm), 1); b.closest('.gm-file').remove(); }));
  });
  // A Drive file goes in as a link, the way Google does it for big files.
  $('#gmc-drive', el).addEventListener('click', async () => {
    let r;
    try { r = await api('/api/google/drive/recent'); }
    catch (err) { toast(err.message, true); return; }
    if (!r.files.length) { toast('Nothing in your Drive yet', true); return; }
    const pick = modal(`<div id="gd-pick"><div class="card-head"><h2 style="margin:0">Attach from Drive</h2><button class="icon-btn" data-close aria-label="Close">${icon.close}</button></div>
      <ul class="list">${r.files.map((f) => `<li class="item"><span></span><div><div class="item-title">${esc(f.name)}</div></div>
        <button class="btn btn-ghost btn-sm" data-pick="${esc(f.id)}">Attach</button></li>`).join('')}</ul></div>`);
    $$('[data-pick]', pick.el).forEach((b) => b.addEventListener('click', () => {
      const f = r.files.find((x) => x.id === b.dataset.pick);
      body.focus();
      document.execCommand('insertHTML', false, `<p><a href="${esc(f.link || '')}">${esc(f.name)}</a></p>`);
      pick.close();
      toast('Link added. Share the file in Drive so they can open it.');
    }));
  });
  $('#gmc-send', el).addEventListener('click', async (e) => {
    const payload = {
      to: toIn.value, cc: $('#gmc-ccv', el).value, bcc: $('#gmc-bcc', el).value,
      subject: $('#gmc-subj', el).value, html: body.innerHTML + (quote || ''),
      threadId, inReplyTo, references, attachments: files,
    };
    if (!payload.to.trim()) { toast('Who is this going to?', true); return; }
    busy(e.currentTarget, true, 'Sending');
    try {
      const r = await api('/api/google/mail/send', { method: 'POST', body: payload });
      toast(r.logged ? 'Sent and logged on their timeline' : 'Sent');
      m.close();
      if (threadId && S.open === threadId) openThread(threadId); else loadList();
    } catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
  });
}

// Mail with one lead or client, for their page in the Hub.
export async function mailWith(box, email, { name = '' } = {}) {
  if (!email) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="skeleton" style="height:60px"></div>';
  let d;
  try { d = await api(`/api/google/mail/with?email=${encodeURIComponent(email)}`); }
  catch (e) { box.innerHTML = `<p class="small muted">${esc(e.message)}</p>`; return; }
  box.innerHTML = `<div class="card-head"><h2>Email</h2><button class="btn btn-ghost btn-sm" id="gmw-new">Write to ${esc(name || email)}</button></div>
    ${d.threads.length ? `<ul class="list">${d.threads.map((t) => `<li class="item"><span></span><div><div class="item-title">${esc(t.subject)}</div><div class="small muted">${esc(t.snippet.slice(0, 90))}</div></div><a class="btn btn-ghost btn-sm" href="#/google/mail/t/${esc(t.id)}">Open</a></li>`).join('')}</ul>`
      : '<p class="small muted">No email with them yet.</p>'}`;
  $('#gmw-new', box).addEventListener('click', () => compose({ to: email }));
}
