// Phone History and Texts in one workspace, modeled on the Zoom Phone app (History with Voicemail, Texts with a conversation list
// and the thread beside it). Every call in one list: ours going out, theirs coming in, missed and voicemail. Click a call to see
// who it is (business, person, number, email) with Call, Text, Email and Lead buttons, plus the voicemail or recording to play.
// Data: GET /api/phone/history (src/voicemail.js), GET /api/inbox (src/sms.js). Add to existing pages, never replace them.
import { $, $$, esc, api, toast, busy, modal, fmt, icon } from './core.js';
import { staffShell } from './staff.js';
import { dialTabs } from './dialout.js';
import { placeCall, pretty } from './phone.js';
import { textPanel, textModal } from './texts.js';

const SUBS = [['all', 'All calls'], ['missed', 'Missed'], ['voicemail', 'Voicemail'], ['inbound', 'Inbound'], ['outbound', 'Outbound']];
const wide = () => window.matchMedia('(min-width: 1280px)').matches;
const mins = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayLabel = (t) => {
  const d = new Date(t); const n = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, n)) return 'Today';
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (same(d, y)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
};
const initials = (s) => (String(s || '?').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
const ARROW = {
  in: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 7L7 17M7 9v8h8"/></svg>',
  out: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg>',
  missed: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 7L7 17M7 9v8h8"/></svg>',
  voicemail: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="12" r="3.5"/><circle cx="17" cy="12" r="3.5"/><path d="M7 15.5h10"/></svg>',
};
const KIND_TEXT = { in: 'Inbound', out: 'Outbound', missed: 'Missed', voicemail: 'Voicemail' };
const nameOf = (c) => c.lead?.business || c.pretty || 'Unknown caller';
const outcomeOf = (c) => {
  if (c.kind === 'voicemail') return `Voicemail${c.vmSecs ? ` ${mins(c.vmSecs)}` : ''}`;
  if (c.kind === 'missed') return 'Missed';
  if (c.dir === 'in') return c.duration ? `Answered ${mins(c.duration)}` : 'Answered';
  if (c.dispo) return c.dispo;
  return c.answered ? `Talked ${mins(c.duration) || ''}`.trim() : 'No answer';
};

// ---------- History ----------
export async function historyPage(app, user, sub = 'all') {
  const view = staffShell(app, user, 'phone');
  if (!SUBS.some(([k]) => k === sub)) sub = 'all';
  let d; let q = '';
  let sel = null;
  const load = async () => {
    try { d = await api(`/api/phone/history${sub === 'all' ? '' : `?filter=${sub}`}`); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return false; }
    return true;
  };
  const counts = async () => { try { return await api('/api/phone/history'); } catch { return null; } };
  if (!(await load())) return;
  const all = sub === 'all' ? d : await counts();
  const n = (k) => (all ? all.calls.filter((c) => (k === 'missed' ? ['missed', 'voicemail'].includes(c.kind) : k === 'voicemail' ? c.voicemail : k === 'inbound' ? c.dir === 'in' : k === 'outbound' ? c.dir === 'out' : true)).length : 0);

  const matches = (c) => !q || `${nameOf(c)} ${c.number || ''} ${c.pretty} ${c.rep} ${c.lead?.contact || ''}`.toLowerCase().includes(q);
  const rowsHtml = () => {
    const list = d.calls.filter(matches);
    if (!list.length) return `<div class="card empty"><h3>${sub === 'voicemail' ? 'No voicemails' : 'No calls here'}</h3><p>${sub === 'voicemail' ? 'When someone leaves a voicemail on one of your numbers it shows up here to play.' : 'Calls you make and take show up here, newest first.'}</p></div>`;
    let last = ''; let out = '';
    for (const c of list) {
      const dl = dayLabel(c.at);
      if (dl !== last) { out += `<div class="ph-day">${esc(dl)}</div>`; last = dl; }
      const unread = ['missed', 'voicemail'].includes(c.kind) && !c.seen;
      out += `<div class="ph-row${sel === c.id ? ' is-on' : ''}${unread ? ' is-new' : ''}" data-id="${esc(c.id)}" tabindex="0">
        <span class="ph-dir ph-${esc(c.kind)}" title="${esc(KIND_TEXT[c.kind])}">${ARROW[c.kind]}</span>
        <div class="ph-who"><b>${esc(nameOf(c))}</b><small>${esc([c.lead?.business ? c.pretty : '', outcomeOf(c), c.dir === 'out' && c.rep ? c.rep : ''].filter(Boolean).join(' · '))}</small>
          ${c.voicemail && sub === 'voicemail' ? `<audio controls preload="none" src="/api/voicemail/${esc(c.id)}/audio" data-vm="${esc(c.id)}"></audio>` : ''}</div>
        <span class="ph-time">${esc(clock(c.at))}${c.recording ? ' <i title="Recorded">&#9679;</i>' : ''}</span></div>`;
    }
    return out;
  };

  const draw = () => {
    view.innerHTML = `
      <div class="page-head"><div><p class="eyebrow">Phone</p><h1>History</h1></div>${d.unseen ? '<button class="btn btn-ghost btn-sm" id="seenall">Mark all heard</button>' : ''}</div>
      ${dialTabs('history', user)}
      <div class="ph-sub">${SUBS.map(([k, l]) => `<a class="${sub === k ? 'is-active' : ''}" href="#/phone/history${k === 'all' ? '' : `/${k}`}">${esc(l)}${k === 'all' ? '' : ` <small>${n(k)}</small>`}${k === 'missed' && d.unseen ? ` <b class="nbadge">${d.unseen}</b>` : ''}</a>`).join('')}
        <label class="ph-find">${icon.search}<input id="phq" type="search" placeholder="Search name or number" value="${esc(q)}"></label></div>
      <div class="ph-split"><div class="ph-list" id="phlist">${rowsHtml()}</div><aside class="ph-detail" id="phdetail"><div class="ph-empty"><p>Pick a call to see who it is, their email, and to call, text or email them.</p></div></aside></div>
      ${sub === 'voicemail' && user.role === 'admin' ? greetingCard(d) : ''}`;
    wire();
  };

  const redraw = () => { const l = $('#phlist', view); if (l) l.innerHTML = rowsHtml(); };

  const detail = async (c) => {
    sel = c.id;
    $$('.ph-row', view).forEach((r) => r.classList.toggle('is-on', r.dataset.id === c.id));
    const into = wide() ? $('#phdetail', view) : null;
    let host = into;
    let m = null;
    if (!host) { m = modal('<div id="phd"></div>', {}); host = $('#phd', m.el); }
    host.innerHTML = '<div class="skeleton" style="height:180px"></div>';
    let lead = null;
    if (c.lead?.id) { try { lead = (await api(`/api/leads/${c.lead.id}`)).lead; } catch { lead = null; } }
    const email = lead?.email || c.lead?.email || '';
    const person = lead?.contact_name || c.lead?.contact || '';
    const rows = [
      ['Business', c.lead?.business || ''], ['Person', person], ['Phone', c.pretty],
      ['Email', email ? `<a href="mailto:${esc(email)}" data-mail>${esc(email)}</a>` : (c.lead ? '<span class="muted">No email on file</span> <button class="linkbtn small" data-leadopen>Add it</button>' : '<span class="muted">Add them as a lead to save an email</span>')],
      ['Stage', lead?.stage ? lead.stage.replace(/_/g, ' ') : ''], ['Call', `${KIND_TEXT[c.kind]} · ${outcomeOf(c)}`],
      ['When', `${new Date(c.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${clock(c.at)}`], ['Taken by', c.rep || ''],
    ].filter(([, v]) => v);
    host.innerHTML = `<div class="ph-card">
      <div class="ph-head"><span class="ph-av">${esc(initials(nameOf(c)))}</span><div><h2>${esc(nameOf(c))}</h2><p class="small muted">${esc(c.pretty)}</p></div></div>
      <div class="row ph-acts">
        ${c.number ? `<button class="btn btn-mint" data-call>${icon.phone}Call</button>` : ''}
        ${c.lead ? '<button class="btn btn-ghost" data-text>Text</button>' : ''}
        ${email ? `<button class="btn btn-ghost" data-mail>${icon.mail}Email</button>` : ''}
        ${c.lead ? '<button class="btn btn-ghost" data-leadopen>Open lead</button>' : c.number ? '<button class="btn btn-ghost" data-addlead>Add as lead</button>' : ''}
      </div>
      ${c.voicemail ? `<div class="ph-audio"><b>Voicemail${c.vmSecs ? ` (${mins(c.vmSecs)})` : ''}</b><audio controls preload="metadata" src="/api/voicemail/${esc(c.id)}/audio"></audio><a class="small" href="/api/voicemail/${esc(c.id)}/audio?download=1" download>Download</a></div>` : ''}
      ${c.recording ? `<div class="ph-audio"><b>Recording</b><audio controls preload="none" src="/api/recordings/${esc(c.id)}/audio"></audio><a class="small" href="/api/recordings/${esc(c.id)}/audio?download=1" download>Download</a></div>` : ''}
      <dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${k === 'Email' ? v : esc(v)}</dd>`).join('')}</dl>
      ${['missed', 'voicemail'].includes(c.kind) ? `<button class="btn btn-ghost btn-sm" data-seen>${c.seen ? 'Mark as new' : 'Mark as heard'}</button>` : ''}
    </div>`;
    const on = (sel2, fn) => $$(sel2, host).forEach((b) => b.addEventListener('click', fn));
    on('[data-call]', () => { m?.close(); placeCall({ to: c.number, leadId: c.lead?.id, name: nameOf(c) }).catch((e) => toast(e.message, true)); });
    on('[data-text]', () => { const l = lead || { id: c.lead.id, business: c.lead.business, phone: c.number }; textModal(l, { rep: (user.name || '').split(' ')[0] }); });
    on('[data-mail]', async (e) => {
      e.preventDefault();
      const gmail = await import('./gstate.js').then((g) => g.hasGoogle('mail'));
      const arg = { to: email, subject: `${c.lead?.business || 'Your business'} and Rightway Growth` };
      if (gmail) import('./mail.js').then((x) => x.compose(arg)); else import('./hubmail.js').then((x) => x.compose({ ...arg, lead_id: c.lead?.id }));
    });
    on('[data-leadopen]', async () => { m?.close(); const { leadModal } = await import('./crm.js'); leadModal(c.lead.id, () => refresh()); });
    on('[data-addlead]', () => addLead(c, async () => { m?.close(); await refresh(); }));
    on('[data-seen]', async () => { try { await api(`/api/calls/inbound/${c.id}/seen`, { method: 'POST', body: { unseen: c.seen } }); await refresh(); } catch (e) { toast(e.message, true); } });
    if (['missed', 'voicemail'].includes(c.kind) && !c.seen && c.kind === 'missed') { api(`/api/calls/inbound/${c.id}/seen`, { method: 'POST', body: {} }).then(() => { c.seen = true; redraw(); import('./nav.js').then((x) => x.refreshBadges()); }).catch(() => {}); }
  };

  const refresh = async () => { if (await load()) draw(); };

  function wire() {
    $('#seenall', view)?.addEventListener('click', async () => { await api('/api/calls/inbound/seen-all', { method: 'POST' }); refresh(); import('./nav.js').then((x) => x.refreshBadges()); });
    const qi = $('#phq', view);
    qi?.addEventListener('input', () => { q = qi.value.trim().toLowerCase(); redraw(); });
    const list = $('#phlist', view);
    list.addEventListener('click', (e) => {
      if (e.target.closest('audio, a')) return;
      const r = e.target.closest('.ph-row'); if (!r) return;
      const c = d.calls.find((x) => x.id === r.dataset.id); if (c) detail(c);
    });
    list.addEventListener('keydown', (e) => { if (e.key !== 'Enter') return; const r = e.target.closest('.ph-row'); const c = r && d.calls.find((x) => x.id === r.dataset.id); if (c) detail(c); });
    list.addEventListener('play', (e) => { const a = e.target.closest('audio[data-vm]'); if (a) { const c = d.calls.find((x) => x.id === a.dataset.vm); if (c && !c.seen) { c.seen = true; import('./nav.js').then((x) => setTimeout(x.refreshBadges, 800)); a.closest('.ph-row')?.classList.remove('is-new'); } } }, true);
    $('#vmf', view)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/api/voicemail/settings', { method: 'PUT', body: Object.fromEntries(new FormData(e.target).entries()) }); toast('Saved'); refresh(); } catch (err) { toast(err.message, true); }
    });
    if (sel) { const c = d.calls.find((x) => x.id === sel); if (c && wide()) detail(c); }
    else if (wide() && d.calls[0]) { /* leave the pane empty until a call is picked */ }
  }
  draw();
}

function greetingCard(d) {
  return `<div class="card" style="margin-top:16px"><div class="card-head"><h2>Voicemail greeting</h2>${d.custom ? '<span class="badge">Custom</span>' : '<span class="badge gray">Default</span>'}</div>
    <form id="vmf" class="form-grid" style="grid-template-columns:1fr"><label class="field"><span>What callers hear (read by a voice)</span><textarea name="greeting" rows="3">${esc(d.greeting)}</textarea></label>
      <label class="field"><span>Email voicemails to (comma separated, empty = every owner)</span><input name="alertTo" value="${esc(d.alertTo)}"></label>
      <div class="row end"><button class="btn btn-primary btn-sm" type="submit">Save</button></div></form></div>`;
}

function addLead(c, done) {
  const m = modal(`<div class="card-head"><h2>Add as a lead</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <p class="small muted">${esc(c.pretty)}</p><label class="field"><span>Business name (optional)</span><input id="albiz" placeholder="Fill in later"></label>
    <div class="row end" style="margin-top:12px"><button class="btn btn-primary" id="alsave">Add</button></div>`, {});
  $('#alsave', m.el).addEventListener('click', async (e) => {
    busy(e.currentTarget, true);
    try { await api(`/api/calls/inbound/${c.id}/lead`, { method: 'POST', body: { business: $('#albiz', m.el).value.trim() } }); toast('Added as a lead'); m.close(); done(); }
    catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
  });
}

// ---------- Texts (conversation list with the thread beside it) ----------
export async function textsPage(app, user, openId = '') {
  const rep = (user?.name || '').split(' ')[0] || '';
  const view = staffShell(app, user, 'phone');
  let d; let q = ''; let sel = openId || null; let stop = () => {};
  const load = async () => { try { d = await api('/api/inbox'); return true; } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return false; } };
  if (!(await load())) return;
  const rows = () => {
    const list = d.conversations.filter((c) => !q || `${c.business} ${c.contact_name || ''} ${c.phone || ''} ${c.body}`.toLowerCase().includes(q));
    return list.length ? list.map((c) => `<div class="ph-row${sel === c.id ? ' is-on' : ''}${c.unread ? ' is-new' : ''}" data-id="${esc(c.id)}" tabindex="0">
      <span class="ph-av sm">${esc(initials(c.business))}</span>
      <div class="ph-who"><b>${esc(c.business)}</b><small>${c.direction === 'out' ? 'You: ' : ''}${esc(c.body.slice(0, 70))}</small></div>
      <span class="ph-time">${esc(fmt.ago(c.at))}${c.unread ? ` <b class="nbadge">${c.unread}</b>` : ''}</span></div>`).join('')
      : '<div class="card empty"><h3>No texts yet</h3><p>Replies and conversations show up here. Open a lead and tap Text to start one, after they agree on the call.</p></div>';
  };
  view.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">Phone</p><h1>Texts</h1></div></div>${dialTabs('texts', user)}
    ${!d.twilio ? '<p class="badge warn" style="margin-bottom:12px">Add the Twilio keys in Cloudflare to send and receive texts.</p>' : ''}
    <div class="ph-sub"><label class="ph-find">${icon.search}<input id="phq" type="search" placeholder="Search texts"></label></div>
    <div class="ph-split"><div class="ph-list" id="phlist">${rows()}</div><aside class="ph-detail" id="phdetail"><div class="ph-empty"><p>Pick a conversation to read and reply.</p></div></aside></div>`;
  const open = async (id) => {
    stop(); sel = id;
    $$('.ph-row', view).forEach((r) => r.classList.toggle('is-on', r.dataset.id === id));
    let lead;
    try { lead = (await api(`/api/leads/${id}`)).lead; } catch (e) { toast(e.message, true); return; }
    if (!wide()) { const m = textModal(lead, { rep, onChange: () => {} }); m.el.closest('.modal-bg')?.addEventListener('click', () => setTimeout(async () => { if (await load()) $('#phlist', view).innerHTML = rows(); }, 50)); return; }
    const host = $('#phdetail', view);
    host.innerHTML = `<div class="ph-card"><div class="ph-head"><span class="ph-av">${esc(initials(lead.business))}</span><div><h2>${esc(lead.business)}</h2>
      <p class="small">${lead.phone ? `<a href="tel:${esc(lead.phone)}" data-tel-lead="${esc(lead.id)}">${esc(lead.phone)}</a>` : ''}${lead.email ? ` · <a href="mailto:${esc(lead.email)}" id="tmail">${esc(lead.email)}</a>` : ' · <span class="muted">No email on file</span>'}</p></div></div>
      <div class="row ph-acts">${lead.phone ? `<button class="btn btn-mint btn-sm" id="tcall">${icon.phone}Call</button>` : ''}<button class="btn btn-ghost btn-sm" id="tlead">Open lead</button></div>
      <div id="tthread"></div></div>`;
    stop = textPanel($('#tthread', host), lead, { rep, onChange: () => {} });
    $('#tcall', host)?.addEventListener('click', () => placeCall({ to: lead.phone, leadId: lead.id, name: lead.business }).catch((e) => toast(e.message, true)));
    $('#tlead', host).addEventListener('click', async () => { const { leadModal } = await import('./crm.js'); leadModal(lead.id); });
    $('#tmail', host)?.addEventListener('click', async (e) => {
      e.preventDefault();
      const gmail = await import('./gstate.js').then((g) => g.hasGoogle('mail'));
      const arg = { to: lead.email, subject: `${lead.business} and Rightway Growth` };
      if (gmail) import('./mail.js').then((x) => x.compose(arg)); else import('./hubmail.js').then((x) => x.compose({ ...arg, lead_id: lead.id }));
    });
    api('/api/inbox').then((r) => { d = r; const l = $('#phlist', view); if (l) l.innerHTML = rows(); import('./nav.js').then((x) => setTimeout(x.refreshBadges, 600)); }).catch(() => {});
  };
  const list = $('#phlist', view);
  list.addEventListener('click', (e) => { const r = e.target.closest('.ph-row'); if (r) open(r.dataset.id); });
  list.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const r = e.target.closest('.ph-row'); if (r) open(r.dataset.id); } });
  const qi = $('#phq', view);
  qi.addEventListener('input', () => { q = qi.value.trim().toLowerCase(); list.innerHTML = rows(); });
  window.addEventListener('hashchange', () => stop(), { once: true });
  if (sel && wide()) open(sel);
}
