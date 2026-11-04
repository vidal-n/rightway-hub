// Automations: booking confirmations and reminders by email and text. Owners edit, write with Claude, preview with a sample lead,
// send themselves a test, and see what went out.
import { $, $$, esc, api, toast, busy, icon, modal } from './core.js';
import { staffShell } from './shell.js';

const WHEN = (a) => (a.trigger === 'booked' ? 'Right after it is booked' : a.trigger === 'before' ? `${a.offset >= 1440 && a.offset % 1440 === 0 ? `${a.offset / 1440} day${a.offset === 1440 ? '' : 's'}` : a.offset >= 60 && a.offset % 60 === 0 ? `${a.offset / 60} hour${a.offset === 60 ? '' : 's'}` : `${a.offset} minutes`} before` : `${a.offset} minutes after a no show`);
const SAMPLE = { first: 'Mike', business: 'Sunrise Plumbing', date: 'Thursday, November 5', time: '10:00 AM Eastern', when: 'Thursday, November 5 at 10:00 AM Eastern', link: 'Join here: https://meet.google.com/abc-defg-hij', rep: 'Vidal, RightWay Growth', book: 'https://hub.rightwaygrowth.com/book.html', company: 'RightWay Growth' };
const fill = (t) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => SAMPLE[k] ?? m);

export async function automationsPage(app, user) {
  const view = staffShell(app, user, 'automations');
  let d, log;
  const load = async () => {
    try { [d, log] = await Promise.all([api('/api/automations'), api('/api/automations/log').catch(() => ({ log: [] }))]); }
    catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
    draw();
  };
  const save = async (list) => {
    try { const r = await api('/api/automations', { method: 'PUT', body: { automations: list } }); d.automations = r.automations; d.custom = true; toast('Saved'); draw(); }
    catch (e) { toast(e.message, true); }
  };
  const draw = () => {
    const off = [!d.email && 'Email is off: add RESEND_API_KEY in Cloudflare.', !d.sms && 'Texts are off: add the Twilio keys.'].filter(Boolean);
    view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Booking</p><h1>Automations</h1></div>
        ${d.canEdit ? `<div class="row"><button class="btn btn-ghost" id="au-reset">Reset to defaults</button><button class="btn btn-primary" id="au-new">${icon.plus}New automation</button></div>` : ''}</div>
      <p class="small muted" style="margin:-8px 0 16px">They run on their own every minute for every booked audit (Book meeting, a Booked result with a time, and the booking page). Texts follow the same consent, STOP and calling hours rules as every other text. Each one goes out once per appointment time.</p>
      ${off.length ? `<div class="card" style="border-color:#E8A33D;margin-bottom:14px">${off.map(esc).join(' ')}</div>` : ''}
      <div class="ana-grid">${d.automations.map((a, i) => `<div class="card au" data-i="${i}">
        <div class="card-head"><div><h3>${esc(a.name)}</h3><p class="small muted" style="margin:2px 0 0">${a.channel === 'email' ? 'Email' : 'Text'} · ${esc(WHEN(a))}</p></div>
          ${d.canEdit ? `<label class="row small" style="gap:6px"><input type="checkbox" data-on${a.on ? ' checked' : ''}> On</label>` : `<span class="badge ${a.on ? '' : 'gray'}">${a.on ? 'On' : 'Off'}</span>`}</div>
        ${a.subject ? `<p style="margin:0 0 6px"><b>${esc(fill(a.subject))}</b></p>` : ''}
        <p class="small" style="white-space:pre-wrap;margin:0;max-height:150px;overflow:hidden">${esc(fill(a.body))}</p>
        ${d.canEdit ? `<div class="row" style="margin-top:12px"><button class="btn btn-ghost btn-sm" data-edit>${icon.edit || ''}Edit</button><button class="btn btn-ghost btn-sm" data-test>${icon.send || ''}Send me a test</button><span class="spacer"></span><button class="linkbtn small" data-del>Delete</button></div>` : ''}
      </div>`).join('')}</div>
      <div class="card" style="margin-top:14px"><div class="card-head"><h3>What went out</h3><span class="small muted">Last 100</span></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Lead</th><th>Automation</th><th>To</th><th>Result</th></tr></thead><tbody>
        ${(log.log || []).map((r) => `<tr><td>${esc(new Date(r.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</td><td>${r.lead_id ? `<a href="#/pipeline/${esc(r.lead_id)}">${esc(r.business || 'Lead')}</a>` : ''}</td>
          <td>${esc((d.automations.find((a) => a.id === r.auto_id) || {}).name || r.auto_id)}</td><td class="small">${esc(r.to_addr || '')}</td><td>${r.status === 'sent' ? '<span class="badge">Sent</span>' : `<span class="badge bad" title="${esc(r.error || '')}">Failed</span> <span class="small">${esc(r.error || '')}</span>`}</td></tr>`).join('') || '<tr><td colspan="5" class="small muted">Nothing sent yet. Book an audit and the confirmation goes out within a minute.</td></tr>'}
        </tbody></table></div></div>`;
    $('#au-new', view)?.addEventListener('click', () => editor(null));
    $('#au-reset', view)?.addEventListener('click', async () => { try { const r = await api('/api/automations', { method: 'PUT', body: { reset: true } }); d.automations = r.automations; toast('Back to the defaults'); draw(); } catch (e) { toast(e.message, true); } });
    $$('.au', view).forEach((el) => {
      const i = Number(el.dataset.i), a = d.automations[i];
      $('[data-on]', el)?.addEventListener('change', (e) => save(d.automations.map((x, k) => (k === i ? { ...x, on: e.target.checked } : x))));
      $('[data-edit]', el)?.addEventListener('click', () => editor(i));
      $('[data-del]', el)?.addEventListener('click', () => { if (el.dataset.sure) save(d.automations.filter((_, k) => k !== i)); else { el.dataset.sure = '1'; $('[data-del]', el).textContent = 'Click again to delete'; } });
      $('[data-test]', el)?.addEventListener('click', async (e) => { busy(e.currentTarget, true); try { const r = await api('/api/automations/test', { method: 'POST', body: { automation: a } }); toast(`Test sent to ${r.to}`); } catch (err) { toast(err.message, true); } busy(e.currentTarget, false); });
    });
  };
  const editor = (i) => {
    const a = i == null ? { name: 'New automation', on: true, channel: 'email', trigger: 'before', offset: 120, subject: '', body: '' } : { ...d.automations[i] };
    const m = modal(`<div class="card-head"><h2>${i == null ? 'New automation' : 'Edit automation'}</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
      <form id="auf" class="form-grid">
        <label class="field span-all"><span>Name</span><input name="name" value="${esc(a.name)}" required></label>
        <label class="field"><span>Send by</span><select name="channel"><option value="email"${a.channel === 'email' ? ' selected' : ''}>Email</option><option value="sms"${a.channel === 'sms' ? ' selected' : ''}>Text</option></select></label>
        <label class="field"><span>When</span><select name="trigger">${Object.entries(d.triggers).map(([k, v]) => `<option value="${k}"${a.trigger === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label class="field" id="offw"><span>Minutes (60 = 1 hour, 1440 = 1 day)</span><input name="offset" type="number" min="5" value="${a.offset || 60}"></label>
        <div class="span-all card" style="box-shadow:none;background:var(--surface-2)">
          <b>Write it with ${d.ai ? 'Claude' : 'a template'}</b><div class="row" style="margin-top:8px"><input id="aipurpose" placeholder="What is it for? e.g. reminder the morning of the audit, friendly but firm" style="flex:1;min-width:220px">
          <button class="btn btn-mint btn-sm" type="button" id="aigo">${d.ai ? 'Write it' : 'Use the template'}</button></div></div>
        <label class="field span-all" id="subw"><span>Subject</span><input name="subject" value="${esc(a.subject || '')}"></label>
        <label class="field span-all"><span>Message</span><textarea name="body" rows="9">${esc(a.body)}</textarea></label>
        <div class="span-all row small" style="gap:6px">Insert: ${d.vars.map((v) => `<button type="button" class="badge gray" data-var="${v}" style="cursor:pointer">{${v}}</button>`).join('')}</div>
        <div class="span-all"><p class="small muted" style="margin:0 0 4px">Preview with a sample lead</p><div class="card" style="box-shadow:none;white-space:pre-wrap;font-size:14px" id="aupv"></div></div>
        <div class="span-all row end"><button class="btn btn-primary" type="submit">Save</button></div>
      </form>`);
    const f = $('#auf', m.el);
    const sync = () => {
      const sms = f.channel.value === 'sms';
      $('#subw', m.el).hidden = sms; $('#offw', m.el).hidden = f.trigger.value === 'booked';
      $('#aupv', m.el).textContent = `${!sms && f.subject.value ? `Subject: ${fill(f.subject.value)}\n\n` : ''}${fill(f.body.value)}${sms ? `\n\n(${fill(f.body.value).length} characters)` : ''}`;
    };
    f.addEventListener('input', sync); f.addEventListener('change', sync); sync();
    let lastFocus = f.body;
    f.subject.addEventListener('focus', () => { lastFocus = f.subject; }); f.body.addEventListener('focus', () => { lastFocus = f.body; });
    $$('[data-var]', m.el).forEach((b) => b.addEventListener('click', () => { const el = lastFocus; const p = el.selectionStart ?? el.value.length; el.value = `${el.value.slice(0, p)}{${b.dataset.var}}${el.value.slice(p)}`; el.focus(); sync(); }));
    $('#aigo', m.el).addEventListener('click', async (e) => {
      busy(e.currentTarget, true);
      try { const r = await api('/api/automations/draft', { method: 'POST', body: { channel: f.channel.value, purpose: $('#aipurpose', m.el).value || f.name.value } }); if (r.subject) f.subject.value = r.subject; f.body.value = r.body; sync(); }
      catch (err) { toast(err.message, true); }
      busy(e.currentTarget, false);
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const next = { ...a, name: f.name.value, channel: f.channel.value, trigger: f.trigger.value, offset: Number(f.offset.value) || 60, subject: f.subject.value, body: f.body.value };
      const list = i == null ? [...d.automations, next] : d.automations.map((x, k) => (k === i ? next : x));
      m.close(); save(list);
    });
  };
  load();
}
