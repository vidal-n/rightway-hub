// Inbox, All conversations (#/conversations[/<leadId>]): every channel with one person in one thread (Nov 2026).
// Modeled on GoHighLevel Conversations (left views, conversation list, the thread, the contact panel, one composer for text, email
// and internal notes) and Front's views. Phones show the list, then the thread full screen with a back button and a swipe back.
import { $, $$, esc, api, toast, fmt, busy, icon } from './core.js';
import { staffShell } from './shell.js';
import { onSwipe } from './swipe.js';

const VIEWS = [['all', 'All'], ['unread', 'Unread'], ['mine', 'Mine'], ['texts', 'Texts'], ['calls', 'Calls'], ['email', 'Email'], ['forms', 'Forms and bookings']];
const CH = { text: ['Text', 'msg'], call: ['Call', 'phone'], email: ['Email', 'mail'], form: ['Form', 'doc'] };
const STAGE = { new: 'New lead', attempting: 'Attempting', callback: 'Callback set', audit_requested: 'Audit requested', audit_booked: 'Audit booked', no_show: 'No-show', follow_up: 'Following up', won: 'Won', not_now: 'Not now', lost: 'Lost', dnc: 'Do not call' };
const initials = (s) => String(s || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
const time = (t) => { const d = new Date(t), today = new Date(); return d.toDateString() === today.toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String((s || 0) % 60).padStart(2, '0')}`;

export async function conversationsPage(app, user, openId = '') {
  const view = staffShell(app, user, 'phone');
  let st = { view: 'all', q: '', open: decodeURIComponent(openId || ''), mode: 'text' };
  try { st.view = localStorage.getItem('rw-convo-view') || 'all'; st.mode = localStorage.getItem('rw-convo-mode') || 'text'; } catch { /* ignore */ }
  view.innerHTML = `<div class="cv${st.open ? ' has-open' : ''}">
    <aside class="cv-list"><div class="cv-head"><h1>Conversations</h1><span class="small muted" id="cvsum"></span></div>
      <div class="chips cv-views" aria-label="Show">${VIEWS.map(([k, n]) => `<button class="chip${st.view === k ? ' on' : ''}" data-view="${k}">${n} <b data-n="${k}"></b></button>`).join('')}</div>
      <input id="cvq" type="search" placeholder="Search a name, business or number" autocomplete="off">
      <div id="cvrows" class="cv-rows"><div class="skeleton"></div></div></aside>
    <section class="cv-thread" id="cvthread">${st.open ? '<div class="skeleton"></div>' : emptyThread()}</section>
  </div>`;
  const rowsBox = $('#cvrows', view), thread = $('#cvthread', view);
  let list = [], timer = null, gone = false;
  addEventListener('hashchange', () => { gone = true; clearInterval(timer); }, { once: true });

  const drawList = () => {
    rowsBox.innerHTML = list.length ? list.map((c) => `<button class="cv-row${c.id === st.open ? ' is-open' : ''}${c.unread ? ' unread' : ''}" data-id="${esc(c.id)}">
        <span class="cv-av">${esc(initials(c.person || c.business))}</span>
        <span class="cv-mid"><span class="cv-top"><b>${esc(c.person || c.business || c.phone)}</b><time>${esc(time(c.at))}</time></span>
          ${c.person ? `<span class="cv-biz">${esc(c.business || '')}</span>` : ''}
          <span class="cv-prev">${c.awaiting ? '<i class="cv-wait" title="They are waiting on a reply"></i>' : ''}${esc(c.preview || '')}</span>
          <span class="cv-ch">${c.channels.map((k) => `<i class="ch-${k}" title="${CH[k][0]}">${icon[CH[k][1]] || ''}</i>`).join('')}${c.stop ? '<em class="badge bad">STOP</em>' : ''}${c.unread ? `<em class="cv-n">${c.unread}</em>` : ''}</span></span></button>`).join('')
      : `<div class="empty"><p><b>Nothing here yet.</b></p><p class="small muted">Texts, calls coming in, missed calls, emails we sent and website requests from the last 90 days show up here.</p></div>`;
    $$('.cv-row', rowsBox).forEach((b) => b.addEventListener('click', () => open(b.dataset.id)));
  };
  const loadList = async () => {
    try {
      const d = await api(`/api/conversations?view=${st.view}`);
      list = d.conversations || [];
      if (st.q) { const q = st.q.toLowerCase(); list = list.filter((c) => `${c.business} ${c.person} ${c.phone} ${c.email}`.toLowerCase().includes(q)); }
      Object.entries(d.counts || {}).forEach(([k, n]) => { const el = view.querySelector(`[data-n="${k}"]`); if (el) el.textContent = n || ''; });
      $('#cvsum', view).textContent = d.counts?.unread ? `${d.counts.unread} waiting on you` : 'All caught up';
      drawList();
    } catch (e) { rowsBox.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; }
  };
  $$('[data-view]', view).forEach((b) => b.addEventListener('click', () => {
    st.view = b.dataset.view;
    try { localStorage.setItem('rw-convo-view', st.view); } catch { /* ignore */ }
    $$('[data-view]', view).forEach((x) => x.classList.toggle('on', x === b));
    loadList();
  }));
  let qt;
  $('#cvq', view).addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { st.q = e.target.value.trim(); loadList(); }, 160); });

  const open = (id) => {
    st.open = id;
    history.replaceState(null, '', `#/conversations/${encodeURIComponent(id)}`);
    $('.cv', view).classList.add('has-open');
    drawList();
    loadThread();
  };
  const back = () => { st.open = ''; history.replaceState(null, '', '#/conversations'); $('.cv', view).classList.remove('has-open'); thread.innerHTML = emptyThread(); drawList(); };

  const loadThread = async () => {
    if (!st.open) return;
    const id = st.open;
    let d;
    try { d = await api(`/api/conversations/${encodeURIComponent(id)}`); } catch (e) { thread.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
    if (id !== st.open || gone) return;
    const l = d.lead;
    const canText = !l.dnc && !l.sms_stop;
    thread.innerHTML = `<header class="cvt-head"><button class="cmd-ico cvt-back" id="cvback" aria-label="Back to the list">${icon.back || '&larr;'}</button>
        <span class="cv-av big">${esc(initials(l.owner_name || l.contact_name || l.business))}</span>
        <div class="cvt-who"><b>${esc(l.owner_name || l.contact_name || l.business)}</b><span class="small muted">${esc([l.owner_name || l.contact_name ? l.business : '', l.phone, STAGE[l.stage] || l.stage].filter(Boolean).join(' · '))}</span></div>
        <div class="cvt-acts"><a class="btn btn-ghost btn-sm" href="#/pipeline/${esc(l.id)}">Open lead</a><button class="btn btn-ghost btn-sm" id="cvwf">${icon.spark || ''}Add to workflow</button></div></header>
      <div class="cvt-body" id="cvbody">${d.items.length ? days(d.items) : '<p class="small muted" style="text-align:center;padding:30px">No messages yet. Say hello below.</p>'}</div>
      <form class="cvt-box" id="cvform">
        <div class="seg cvt-mode" role="tablist">${[['text', 'Text'], ['email', 'Email'], ['note', 'Internal note']].map(([k, n]) => `<button type="button" data-mode="${k}" class="${st.mode === k ? 'is-on' : ''}">${n}</button>`).join('')}</div>
        <div class="cvt-why small" id="cvwhy"></div>
        <input id="cvsubj" placeholder="Subject" maxlength="200">
        <textarea id="cvmsg" rows="3" maxlength="2000" placeholder="Write a reply"></textarea>
        <div class="row cvt-send"><span class="small muted" id="cvcount"></span><span class="spacer"></span><button class="btn btn-primary" type="submit" id="cvsend">Send</button></div>
      </form>`;
    const body = $('#cvbody', thread);
    body.scrollTop = body.scrollHeight;
    $('#cvback', thread).onclick = back;
    onSwipe(thread, (dir) => { if (dir === 'back' && matchMedia('(max-width: 900px)').matches) back(); }, { skip: 'input, textarea, select, .cvt-body' });
    const paintMode = () => {
      $$('[data-mode]', thread).forEach((b) => b.classList.toggle('is-on', b.dataset.mode === st.mode));
      $('#cvsubj', thread).hidden = st.mode !== 'email';
      const why = $('#cvwhy', thread);
      why.textContent = st.mode === 'text' ? (canText ? (l.sms_consent ? '' : 'Texts need their OK: they texted us, filled in the form, or said yes on a call. The Hub checks before sending.') : 'They replied STOP or are on do not call. No texts.')
        : st.mode === 'email' ? (l.email ? `To ${l.email}. Replies go to your own inbox.` : 'No email on this lead. Add one on the lead first.') : 'Only the team sees notes.';
      $('#cvsend', thread).disabled = (st.mode === 'text' && !canText) || (st.mode === 'email' && !l.email);
      $('#cvsend', thread).textContent = st.mode === 'note' ? 'Save note' : 'Send';
      $('#cvform', thread).dataset.mode = st.mode;
    };
    $$('[data-mode]', thread).forEach((b) => b.addEventListener('click', () => { st.mode = b.dataset.mode; try { localStorage.setItem('rw-convo-mode', st.mode); } catch { /* ignore */ } paintMode(); }));
    paintMode();
    const msg = $('#cvmsg', thread);
    msg.addEventListener('input', () => { $('#cvcount', thread).textContent = st.mode === 'text' && msg.value.length > 140 ? `${msg.value.length} letters, ${Math.ceil(msg.value.length / 153)} texts` : ''; });
    msg.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#cvform', thread).requestSubmit(); } });
    $('#cvform', thread).addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = msg.value.trim();
      if (!text) return;
      const btn = $('#cvsend', thread);
      busy(btn, true);
      try {
        if (st.mode === 'text') await api(`/api/leads/${l.id}/sms`, { method: 'POST', body: { text } });
        else if (st.mode === 'email') await api('/api/mail/send', { method: 'POST', body: { to: l.email, subject: $('#cvsubj', thread).value.trim() || `Rightway Growth: ${l.business}`, body: text, lead_id: l.id } });
        else await api(`/api/conversations/${l.id}/note`, { method: 'POST', body: { text } });
        toast(st.mode === 'note' ? 'Note saved' : 'Sent');
        msg.value = '';
        await loadThread();
        loadList();
      } catch (err) { busy(btn, false); toast(err.message, true); }
    });
    $('#cvwf', thread).onclick = () => addToWorkflow(l);
    if (list.find((c) => c.id === id)?.unread) api(`/api/conversations/${encodeURIComponent(id)}/read`, { method: 'POST' }).then(() => { loadList(); window.dispatchEvent(new Event('rw-badges')); }).catch(() => {});
  };

  await loadList();
  if (st.open) loadThread();
  timer = setInterval(() => { if (!document.hidden) { loadList(); } }, 15e3);
}

const emptyThread = () => `<div class="cvt-empty"><div class="cvt-empty-ic">${icon.msg || ''}</div><b>Pick a conversation</b><p class="small muted">Texts, calls, voicemails, emails and website requests with one person, in one place. Reply by text or email, or leave the team a note.</p></div>`;

function itemHtml(i) {
  const who = i.who ? `<span class="cvi-who">${esc(i.who)}</span>` : '';
  if (i.kind === 'text') return `<div class="cvi msg ${i.dir === 'in' ? 'in' : 'out'}"><p>${esc(i.body)}</p><span class="cvi-meta">${who}${esc(time(i.at))} ${i.dir === 'out' ? `· ${esc(i.status === 'failed' ? `Not delivered${i.error ? ` (${i.error})` : ''}` : i.status || 'sent')}` : ''}</span></div>`;
  if (i.kind === 'email') return `<div class="cvi msg out email"><b>${esc(i.subject || 'Email')}</b><p>${esc(String(i.body || '').slice(0, 600))}${String(i.body || '').length > 600 ? '...' : ''}</p><span class="cvi-meta">${who}Email to ${esc(i.to || '')} · ${esc(time(i.at))}${i.status === 'failed' ? ' · not sent' : ''}</span></div>`;
  if (i.kind === 'call') {
    const missed = ['missed', 'voicemail'].includes(i.status);
    const inbound = ['inbound', 'inbound_answered', 'missed', 'voicemail'].includes(i.status);
    const label = i.status === 'voicemail' ? `Voicemail${i.vm ? `, ${i.vm}s` : ''}` : missed ? 'Missed call' : inbound ? `Call in${i.secs ? `, ${mmss(i.secs)}` : ''}` : `Call out${i.outcome ? `: ${String(i.outcome).replace(/_/g, ' ')}` : ''}${i.secs ? `, ${mmss(i.secs)}` : ''}`;
    return `<div class="cvi event${missed ? ' missed' : ''}"><span>${icon.phone || ''}${esc(label)}</span><span class="cvi-meta">${who}${esc(time(i.at))}</span></div>`;
  }
  if (i.kind === 'note') return `<div class="cvi note"><p>${esc(i.body || '')}</p><span class="cvi-meta">${who}Note · ${esc(time(i.at))}</span></div>`;
  return `<div class="cvi event"><span>${esc(i.body || i.kind)}</span><span class="cvi-meta">${who}${esc(time(i.at))}</span></div>`;
}
function days(items) {
  let last = '';
  return items.map((i) => {
    const d = new Date(i.at).toDateString();
    const head = d !== last ? `<div class="cvi-day"><span>${esc(new Date(i.at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }))}</span></div>` : '';
    last = d;
    return head + itemHtml(i);
  }).join('');
}

async function addToWorkflow(l) {
  const { modal } = await import('./core.js');
  let list = [];
  try { list = (await api('/api/workflows')).workflows.filter((w) => w.enabled); } catch (e) { toast(e.message, true); return; }
  const m = modal(`<div class="card-head"><h2>Add ${esc(l.business)} to a workflow</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    ${list.length ? `<div class="list">${list.map((w) => `<button class="item wf-pick" data-id="${esc(w.id)}" style="width:100%;text-align:left"><div><div class="item-title">${esc(w.name)}</div><div class="item-sub">${esc(w.steps.length)} steps</div></div></button>`).join('')}</div>`
      : '<p class="muted">No workflow is turned on yet. Build one in Automate, Workflows.</p><a class="btn btn-primary" href="#/automations/workflows">Open Workflows</a>'}`);
  $$('.wf-pick', m.el).forEach((b) => b.addEventListener('click', async () => {
    try { const r = await api(`/api/leads/${l.id}/workflow`, { method: 'POST', body: { workflowId: b.dataset.id } }); toast(`Added. ${r.log?.at(-1)?.line || ''}`); m.close(); } catch (e) { toast(e.message, true); }
  }));
}
