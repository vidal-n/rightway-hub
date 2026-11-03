// Texting: a thread for one lead (in a modal) and the inbox of all conversations.
import { $, $$, esc, api, toast, busy, modal, fmt, icon } from './core.js';
import { staffShell } from './staff.js';
import { dialTabs } from './dialout.js';

const templates = (l, rep) => {
  const first = (l.contact_name || '').split(' ')[0];
  const hi = first ? `Hi ${first}` : 'Hi';
  const me = rep ? `this is ${rep}` : 'this is your Rightway Growth contact';
  return [
    ['Audit link', `${hi}, ${me}. Here is where to pick a time for your free ranking audit: ${location.origin}/book.html`],
    ['Missed you', `${hi}, ${me}. Sorry I missed you. Is there a better time to talk today?`],
    ['Audit ready', `${hi}, your Google ranking audit for ${l.business} is ready. When is a good time to walk through it? It takes 15 minutes.`],
    ['Meeting reminder', `${hi}, a quick reminder about our call today. The video link is in your calendar invite.`],
  ];
};

const bubbleTime = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function textPanel(el, lead, { rep = '', onChange } = {}) {
  el.innerHTML = '<div class="skeleton"></div>';
  let alive = true;
  let timer = null;
  const load = async (keepDraft = true) => {
    if (!alive || !document.body.contains(el)) { alive = false; clearInterval(timer); return; }
    let d;
    try { d = await api(`/api/leads/${lead.id}/messages`); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
    const draft = keepDraft ? ($('#tmsg', el)?.value || '') : '';
    const sig = JSON.stringify([d.messages.map((m) => [m.id, m.status]), d.blocked, d.consent]);
    if (el.dataset.sig === sig && keepDraft) return;
    el.dataset.sig = sig;
    el.innerHTML = `
      <div class="thread" id="thread">${d.messages.map((m) => `<div class="bub ${m.direction}"><div>${esc(m.body)}</div>
        <small>${esc(bubbleTime(m.at))}${m.direction === 'out' ? ` · ${esc(m.status || '')}` : ''}</small>${m.error_text ? `<small class="bad-text">${esc(m.error_text)}</small>` : ''}</div>`).join('') || '<p class="muted">No texts yet.</p>'}</div>
      ${d.stopped ? '<p class="badge bad">They replied STOP. Do not text.</p>' : ''}
      ${!d.twilio ? '<p class="badge warn">Texting turns on when the Twilio keys are added in Cloudflare.</p>' : ''}
      ${d.blocked && !d.stopped ? `<div class="row" style="margin:8px 0"><p class="small" style="flex:1 1 220px;margin:0">${esc(d.blocked)}</p><button class="btn btn-mint btn-sm" id="tyes">They said yes to texts</button></div>` : ''}
      <div class="row" style="gap:6px;margin:8px 0">${templates(lead, rep).map(([n], i) => `<button class="btn btn-ghost btn-sm" data-tpl="${i}">${esc(n)}</button>`).join('')}</div>
      <form id="tform" class="row" style="align-items:flex-end;flex-wrap:nowrap">
        <textarea id="tmsg" rows="3" maxlength="600" placeholder="Type a message" style="flex:1" ${d.blocked ? 'disabled' : ''}></textarea>
        <button class="btn btn-primary" ${d.blocked ? 'disabled' : ''}>Send</button></form>
      <p class="small">Texts go only to people who agreed. The first one adds "Reply STOP to opt out". Sent 8am to 8pm their time.</p>`;
    const box = $('#tmsg', el); if (box) box.value = draft;
    const th = $('#thread', el); if (th) th.scrollTop = th.scrollHeight;
    $('#tyes', el)?.addEventListener('click', async () => {
      try { await api(`/api/leads/${lead.id}/sms-consent`, { method: 'POST', body: { value: true } }); toast('Saved'); onChange?.(); load(false); } catch (err) { toast(err.message, true); }
    });
    $$('[data-tpl]', el).forEach((b) => b.addEventListener('click', () => { const t = $('#tmsg', el); if (!t.disabled) { t.value = templates(lead, rep)[Number(b.dataset.tpl)][1]; t.focus(); } }));
    $('#tform', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = $('#tmsg', el).value.trim(); if (!text) return;
      const btn = e.target.querySelector('button'); busy(btn, true);
      try { await api(`/api/leads/${lead.id}/sms`, { method: 'POST', body: { text } }); toast('Sent'); onChange?.(); await load(false); } catch (err) { toast(err.message, true); busy(btn, false); }
    });
  };
  load(false);
  timer = setInterval(() => load(true), 8000);
  return () => { alive = false; clearInterval(timer); };
}

export function textModal(lead, opts = {}) {
  let stop = () => {};
  const m = modal(`<div class="card-head"><div><p class="eyebrow">Texts</p><h2>${esc(lead.business)}</h2><div class="small">${esc(lead.phone || '')}</div></div><button class="btn btn-ghost btn-sm" data-close>Close</button></div><div id="tbody"></div>`, { onClose: () => stop() });
  stop = textPanel($('#tbody', m.el), lead, opts);
  return m;
}

// Kept for older callers; the menu dots now come from nav.js.
export async function unreadBadge(root = document) {
  return;
  try {
    const { unread } = await api('/api/inbox/unread');
    const a = $('a[href="#/inbox"]', root);
    if (a && unread) a.insertAdjacentHTML('beforeend', `<b class="nbadge">${unread > 99 ? "99+" : unread}</b>`);
  } catch { /* ignore */ }
}


export async function inboxPage(app, user, sub) {
  const rep = (user?.name || '').split(' ')[0] || '';
  const view = staffShell(app, user, 'phone');
  if (sub === 'calls') return callsView(view, user);
  const draw = async () => {
    let d, u = {};
    try { [d, u] = await Promise.all([api('/api/inbox'), api('/api/inbox/unread').catch(() => ({}))]); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
    view.innerHTML = `
      <div class="page-head"><div><p class="eyebrow">Texts</p><h1>Phone</h1></div></div>${dialTabs('texts', user)}
      ${!d.twilio ? '<p class="badge warn" style="margin-bottom:12px">Add the Twilio keys in Cloudflare to send and receive texts.</p>' : ''}
      ${d.conversations.length ? `<ul class="list">${d.conversations.map((c) => `<li class="item inbox-row" data-id="${esc(c.id)}" tabindex="0">
        <span class="badge ${c.unread ? '' : 'gray'}">${c.unread ? `${c.unread} new` : c.direction === 'out' ? 'Sent' : 'Read'}</span>
        <div><div class="item-title">${esc(c.business)}</div><div class="item-sub">${esc(c.body.slice(0, 90))}</div></div>
        <span class="small">${esc(fmt.ago(c.at))}</span></li>`).join('')}</ul>`
        : '<div class="card empty"><h3>No texts yet</h3><p>Replies and conversations show up here. Open a lead and tap Texts to start one, after they agree on the call.</p></div>'}`;
    $$('.inbox-row', view).forEach((r) => {
      const open = async () => {
        const lead = (await api(`/api/leads/${r.dataset.id}`)).lead;
        textModal(lead, { rep, onChange: () => {} }).el.closest('.modal-bg').addEventListener('click', () => setTimeout(draw, 50));
      };
      r.addEventListener('click', open);
      r.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  };
  draw();
}

export const textIcon = icon.msg;

// Calls to our numbers: answered, missed and voicemail. Play the voicemail, call back from the browser, add unknown callers as leads.
async function callsView(view, user) {
  let d;
  try { d = await api('/api/calls/inbound'); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const label = { voicemail: ['Voicemail', 'bad'], missed: ['Missed', 'warn'], inbound_answered: ['Answered', ''], inbound: ['Ringing', 'gray'] };
  view.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">Calls and voicemail</p><h1>Phone</h1></div>${d.unseen ? '<button class="btn btn-ghost btn-sm" id="seenall">Mark all heard</button>' : ''}</div>
    ${dialTabs('calls', user)}
    <p class="small muted">Missed calls to your numbers go to voicemail. Every teammate with notifications on gets a buzz, and owners get an email for each voicemail${user.role === 'admin' ? '' : ''}.</p>
    ${d.calls.length ? `<ul class="list">${d.calls.map((c) => { const [l, tone] = label[c.status] || ['Call', 'gray']; return `<li class="item call-row${(c.status === 'voicemail' || c.status === 'missed') && !c.seen ? ' is-new' : ''}" data-id="${esc(c.id)}">
      <span class="badge ${tone}">${l}</span>
      <div><div class="item-title">${esc(c.lead?.business || c.fromPretty || 'Unknown caller')}</div>
        <div class="item-sub">${esc(c.fromPretty || '')} · ${esc(fmt.ago(c.at))}${c.duration ? ` · ${c.duration}s` : ''}${c.calledBack ? ' · called back' : ''}</div>
        ${c.voicemail ? `<audio controls preload="none" src="/api/voicemail/${esc(c.id)}/audio" style="width:100%;max-width:360px;margin-top:6px"></audio>` : ''}</div>
      <div class="item-actions">${c.from ? `<button class="btn btn-primary btn-sm" data-call="${esc(c.from)}" data-lead="${esc(c.lead?.id || '')}" data-name="${esc(c.lead?.business || c.fromPretty)}">${icon.phone}Call back</button>` : ''}
        ${c.lead ? `<button class="btn btn-ghost btn-sm" data-lead-open="${esc(c.lead.id)}">Lead</button>` : c.from ? '<button class="btn btn-ghost btn-sm" data-addlead>Add as lead</button>' : ''}
        ${(c.status === 'voicemail' || c.status === 'missed') && !c.seen ? '<button class="icon-btn" data-seen title="Mark heard">' + icon.check + '</button>' : ''}</div></li>`; }).join('')}</ul>`
      : '<div class="card empty"><h3>No calls yet</h3><p>Calls to your Twilio numbers show up here, with voicemails you can play.</p></div>'}
    ${user.role === 'admin' ? `<div class="card"><div class="card-head"><h2>Voicemail greeting</h2>${d.custom ? '<span class="badge">Custom</span>' : '<span class="badge gray">Default</span>'}</div>
      <form id="vmf" class="form-grid" style="grid-template-columns:1fr"><label class="field"><span>What callers hear (read by a voice)</span><textarea name="greeting" rows="3">${esc(d.greeting)}</textarea></label>
        <label class="field"><span>Email voicemails to (comma separated, empty = every owner)</span><input name="alertTo" value="${esc(d.alertTo)}"></label>
        <div class="row end"><button class="btn btn-primary btn-sm" type="submit">Save</button></div></form></div>` : ''}`;
  const again = () => callsView(view, user);
  $('#seenall', view)?.addEventListener('click', async () => { await api('/api/calls/inbound/seen-all', { method: 'POST' }); again(); });
  $('#vmf', view)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/voicemail/settings', { method: 'PUT', body: Object.fromEntries(new FormData(e.target).entries()) }); toast('Saved'); again(); } catch (err) { toast(err.message, true); }
  });
  view.onclick = async (e) => {
    const row = e.target.closest('.call-row');
    if (!row) return;
    const id = row.dataset.id;
    const callBtn = e.target.closest('[data-call]');
    try {
      if (callBtn) {
        await api(`/api/calls/inbound/${id}/seen`, { method: 'POST', body: {} }).catch(() => {});
        const { placeCall } = await import('./phone.js');
        return placeCall({ to: callBtn.dataset.call, leadId: callBtn.dataset.lead || undefined, name: callBtn.dataset.name });
      }
      const lo = e.target.closest('[data-lead-open]');
      if (lo) { const { leadModal } = await import('./crm.js'); return leadModal(lo.dataset.leadOpen, again); }
      if (e.target.closest('[data-seen]')) { await api(`/api/calls/inbound/${id}/seen`, { method: 'POST', body: {} }); return again(); }
      if (e.target.closest('[data-addlead]')) {
        const business = prompt('Business name (leave empty to fill in later)', '');
        if (business === null) return;
        await api(`/api/calls/inbound/${id}/lead`, { method: 'POST', body: { business } });
        toast('Added as a lead');
        return again();
      }
    } catch (err) { toast(err.message, true); }
  };
}
