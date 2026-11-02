// Monthly reports: the client's Reports tab in the Hub (make, check, add a note, send) and the list in the client app.
import { $, $$, esc, api, toast, copy, modal, busy, fmt } from './core.js';

const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

export async function reportsTab(el, c) {
  el.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/reports`); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  el.innerHTML = `<div class="card"><div class="card-head"><h2>Monthly reports</h2>
      <form id="rpnew" class="row" style="gap:8px;flex-wrap:wrap"><input type="month" name="month" value="${thisMonth()}" max="${thisMonth()}" aria-label="Month" style="width:auto">
        <button class="btn btn-primary btn-sm" type="submit">Make report</button></form></div>
    <p class="muted">A report is made on its own when this client's monthly scans finish. Open it, add a note if you want, then send it.${d.email ? '' : ' Email is not set up, so you copy the link and send it yourself.'}</p>
    ${d.reports.length ? `<ul class="list" style="margin-top:12px">${d.reports.map((r) => `<li class="item" data-id="${esc(r.id)}">
        <span class="badge ${r.status === 'sent' ? '' : 'warn'}">${r.status === 'sent' ? 'Sent' : 'Draft'}</span>
        <div><div class="item-title">${esc(r.monthLabel)}</div>
          <div class="item-sub">${r.keywords} keyword${r.keywords === 1 ? '' : 's'}, ${r.work} task${r.work === 1 ? '' : 's'} done${r.sent_at ? `. Sent ${esc(fmt.date(r.sent_at))}${r.sent_to ? ` to ${esc(r.sent_to)}` : ''}` : ''}${r.views ? `. Opened ${r.views} time${r.views === 1 ? '' : 's'}` : ''}</div></div>
        <div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-end">
          <a class="btn btn-ghost btn-sm" href="${esc(r.url)}" target="_blank" rel="noopener">Open</a>
          <button class="btn btn-ghost btn-sm" data-act="copy">Copy link</button>
          ${r.status === 'sent' ? '' : '<button class="btn btn-ghost btn-sm" data-act="refresh">Update</button>'}
          <button class="btn ${r.status === 'sent' ? 'btn-ghost' : 'btn-primary'} btn-sm" data-act="send">${r.status === 'sent' ? 'Send again' : 'Send'}</button>
        </div></li>`).join('')}</ul>` : '<p class="muted" style="margin-top:12px">No reports yet. Make one, or run a scan on the Rankings tab first so it has fresh maps.</p>'}
  </div>`;
  const again = () => reportsTab(el, c);
  $('#rpnew', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', e.currentTarget);
    busy(btn, true, 'Making');
    try { await api(`/api/clients/${c.id}/reports`, { method: 'POST', body: { month: e.currentTarget.month.value } }); toast('Report ready'); again(); }
    catch (err) { busy(btn, false); toast(err.message, true); }
  });
  $$('[data-act]', el).forEach((b) => b.addEventListener('click', async () => {
    const r = d.reports.find((x) => x.id === b.closest('[data-id]').dataset.id);
    const full = `${location.origin}${r.url}`;
    if (b.dataset.act === 'copy') return copy(full, 'Report link copied');
    if (b.dataset.act === 'refresh') {
      busy(b, true);
      try { await api(`/api/clients/${c.id}/reports`, { method: 'POST', body: { month: r.month, refresh: true } }); toast('Updated with the latest numbers'); again(); }
      catch (err) { busy(b, false); toast(err.message, true); }
      return;
    }
    sendModal(c, r, full, d.email, again);
  }));
}

function sendModal(c, r, full, canEmail, done) {
  const m = modal(`<h2>Send the ${esc(r.monthLabel)} report</h2>
    <form id="rps" class="form-grid" style="grid-template-columns:1fr">
      <label class="field"><span>Note at the top of the report (optional)</span><textarea name="note" rows="4" maxlength="2000" placeholder="Great month. Next we are adding two service pages.">${esc(r.note || '')}</textarea></label>
      ${canEmail ? `<label class="field"><span>Send to</span><input name="to" type="email" value="${esc(c.contact_email || '')}" placeholder="client@business.com" required></label>`
        : `<div><p class="small muted">Email is not set up in the Hub. Copy the link, text or email it to ${esc(c.contact_name || 'the client')}, then mark it as sent.</p>
          <div class="copybox"><code>${esc(full)}</code><button class="btn btn-ghost btn-sm" type="button" id="rpcopy">Copy</button></div></div>`}
      <div class="row end" style="gap:8px"><button class="btn btn-ghost" type="button" data-close>Cancel</button>
        <button class="btn btn-primary" type="submit">${canEmail ? 'Send email' : 'Mark as sent'}</button></div>
    </form>`);
  $('#rpcopy', m.el)?.addEventListener('click', () => copy(full, 'Report link copied'));
  $('#rps', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget, btn = $('button[type=submit]', f);
    busy(btn, true, canEmail ? 'Sending' : 'Saving');
    try {
      await api(`/api/reports/${r.id}`, { method: 'PATCH', body: { note: f.note.value } });
      await api(`/api/reports/${r.id}/send`, { method: 'POST', body: canEmail ? { to: f.to.value } : { manual: true } });
      m.close();
      toast(canEmail ? 'Report sent' : 'Marked as sent');
      done();
    } catch (err) { busy(btn, false); toast(err.message, true); }
  });
}

// Client app: sent reports, newest first. Returns '' when there are none.
export async function clientReportsCard(clientId) {
  try {
    const { reports } = await api(`/api/clients/${clientId}/reports`);
    if (!reports.length) return '';
    return `<div class="card"><div class="card-head"><h2>Monthly reports</h2></div><ul class="list">${reports.map((r) => `<li class="item">
      <span class="badge">${esc(r.monthLabel.split(' ')[0].slice(0, 3))}</span><div><div class="item-title">${esc(r.monthLabel)}</div>
      <div class="item-sub">Your rankings, reviews and the work done</div></div>
      <a class="btn btn-ghost btn-sm" href="${esc(r.url)}" target="_blank" rel="noopener">Open</a></li>`).join('')}</ul></div>`;
  } catch { return ''; }
}
