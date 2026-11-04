// Email from the Hub (no Google needed): write, send under your name, replies go to your own inbox. Sent mail is logged on the
// lead's or client's timeline. The page lists what you sent; Gmail is still where you read replies.
import { $, $$, esc, api, toast, busy, modal } from './core.js';
import { staffShell } from './shell.js';

const when = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const gmailUrl = ({ to, subject, body }) => `https://mail.google.com/mail/?${new URLSearchParams({ view: 'cm', fs: '1', to: to || '', su: subject || '', body: body || '' })}`;
const sig = (user) => `\n\n${user?.name || ''}\nRightway Growth`.replace(/\n\n\nRightway/, '\n\nRightway');

// The form, used on the Mail page and in a pop-up from a lead or client.
function formHtml(user, { to = '', subject = '', body = '' }) {
  return `<form id="mf" class="form-grid" style="grid-template-columns:1fr">
      <label class="field"><span>To</span><input name="to" list="mpeople" autocomplete="off" required placeholder="name@business.com" value="${esc(to)}"><datalist id="mpeople"></datalist></label>
      <label class="field"><span>Subject</span><input name="subject" required maxlength="200" value="${esc(subject)}"></label>
      <label class="field"><span>Message</span><textarea name="body" rows="9" required>${esc(body || sig(user))}</textarea></label>
      <div class="row"><button class="btn btn-primary" type="submit">Send</button><button class="btn btn-ghost" type="button" id="mgmail">Open in Gmail instead</button></div>
      <p class="small muted" style="margin:0">Goes out as ${esc(user?.name || 'you')} (Rightway Growth). When they reply, it lands in your own inbox (${esc(user?.email || '')}).</p>
    </form>`;
}
function wireForm(root, { user, lead_id = null, client_id = null, onSent }) {
  const f = $('#mf', root);
  let timer;
  f.to.addEventListener('input', () => {
    const v = f.to.value.split(/[\s,;]+/).pop();
    clearTimeout(timer);
    if (!v || v.length < 2) return;
    timer = setTimeout(async () => {
      try {
        const r = await api(`/api/mail/people?q=${encodeURIComponent(v)}`);
        const head = f.to.value.slice(0, f.to.value.length - v.length);
        $('#mpeople', root).innerHTML = r.people.map((p) => `<option value="${esc(head + p.email)}">${esc(p.label)}</option>`).join('');
      } catch { /* typing still works */ }
    }, 250);
  });
  $('#mgmail', root).addEventListener('click', () => window.open(gmailUrl({ to: f.to.value, subject: f.subject.value, body: f.body.value }), '_blank', 'noopener'));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type="submit"]', f);
    busy(btn, true, 'Sending');
    try {
      const r = await api('/api/mail/send', { method: 'POST', body: { to: f.to.value, subject: f.subject.value, body: f.body.value, lead_id, client_id } });
      toast(r.failed?.length ? `Sent to ${r.sent.length}. Failed: ${r.failed.map((x) => x.to).join(', ')}` : 'Sent', Boolean(r.failed?.length));
      onSent?.();
    } catch (err) { toast(err.message, true); busy(btn, false); }
  });
}

// Pop-up composer for the Email buttons on a lead or client.
export function compose({ to = '', subject = '', body = '', lead_id = null, client_id = null } = {}) {
  const user = window.__rwUser || {};
  const m = modal(`<h2>New email</h2>${formHtml(user, { to, subject, body })}`);
  wireForm(m.el, { user, lead_id, client_id, onSent: () => m.close() });
}

function listHtml(mail) {
  return mail.length ? mail.map((x) => `<details style="border-top:1px solid var(--line);padding:8px 0"><summary style="cursor:pointer"><b>${esc(x.subject || '(no subject)')}</b> <span class="small muted">to ${esc(x.to)} · ${esc(when(x.at))}${x.by ? ` · ${esc(x.by)}` : ''}</span> ${x.status === 'failed' ? '<span class="badge warn">Failed</span>' : ''}</summary>
      ${x.error ? `<p class="small err-text">${esc(x.error)}</p>` : ''}<pre style="white-space:pre-wrap;font-family:inherit;margin:8px 0 0">${esc(x.body || '')}</pre></details>`).join('') : '<p class="muted small">Nothing sent from the Hub yet.</p>';
}

// "Emails sent to this person", for the lead and client pages.
export async function mailWith(box, email, { name = '' } = {}) {
  let r;
  try { r = await api(`/api/mail/sent?email=${encodeURIComponent(email)}`); } catch { box.remove(); return; }
  box.innerHTML = `<div class="card-head"><h3>Emails sent to ${esc(name || email)}</h3></div>${listHtml(r.mail)}`;
}

export async function mailPage(app, user) {
  window.__rwUser = user;
  const view = staffShell(app, user, 'mail');
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Team</p><h1>Mail</h1></div></div>
    <div class="split" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
      <div class="card"><div class="card-head"><h2>New email</h2></div>${formHtml(user, { to: q.get('to') || '', subject: q.get('subject') || '' })}</div>
      <div class="card"><div class="card-head"><h2>Sent from the Hub</h2></div><div id="sent"><div class="skeleton"></div></div>
        <p class="small muted" style="margin:12px 0 0">Replies come to your own inbox, so read them in Gmail. <a href="https://mail.google.com" target="_blank" rel="noopener">Open Gmail</a></p></div></div>`;
  const load = async () => { try { $('#sent', view).innerHTML = listHtml((await api('/api/mail/sent')).mail); } catch (e) { $('#sent', view).innerHTML = `<p class="err-text">${esc(e.message)}</p>`; } };
  wireForm(view, { user, onSent: () => { $('#mf', view).reset(); $('#mf', view).body.value = sig(user).trimStart() ? sig(user) : ''; load(); } });
  load();
}
