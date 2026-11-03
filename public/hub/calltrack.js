// Call tracking screens: the client's Calls tab in the Hub (numbers, this month, call log) and the client app's calls page.
import { $, $$, esc, api, toast, modal, busy, fmt } from './core.js';

const STATUS = { answered: ['', 'Answered'], missed: ['bad', 'Missed'], voicemail: ['warn', 'Voicemail'], ringing: ['gray', 'Ringing'] };
const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String((s || 0) % 60).padStart(2, '0')}`;
const when = (t) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

function statsRow(s) {
  return `<div class="stats" style="grid-template-columns:repeat(4,minmax(0,1fr));margin:0">
    <div class="stat hero"><div class="stat-num">${s.total}</div><div class="stat-label">calls</div></div>
    <div class="stat"><div class="stat-num">${s.firstTime}</div><div class="stat-label">new callers</div></div>
    <div class="stat"><div class="stat-num">${s.answered}</div><div class="stat-label">answered${s.avgSecs ? `, ${mmss(s.avgSecs)} average` : ''}</div></div>
    <div class="stat"><div class="stat-num${s.missed ? ' bad-text' : ''}">${s.missed}</div><div class="stat-label">missed${s.voicemail ? `, ${s.voicemail} voicemail${s.voicemail === 1 ? '' : 's'}` : ''}</div></div></div>`;
}

function callList(calls, empty) {
  if (!calls.length) return `<p class="muted">${empty}</p>`;
  return `<ul class="list">${calls.map((c) => { const [cls, label] = STATUS[c.status] || ['gray', c.status]; return `<li class="item ct-call">
    <span class="badge ${cls}">${label}${c.status === 'answered' ? ` ${mmss(c.duration)}` : c.status === 'voicemail' ? ` ${mmss(c.vmSecs)}` : ''}</span>
    <div><div class="item-title">${esc(c.fromPretty || 'Unknown caller')}${c.firstTime ? ' <span class="badge">New caller</span>' : ''}</div>
      <div class="item-sub">${esc(when(c.at))}${c.city ? `, ${esc(c.city)}` : ''}${c.source ? `. From ${esc(c.source)}` : ''}</div>
      ${c.voicemail ? `<audio controls preload="none" src="/api/tracked-calls/${esc(c.id)}/audio?k=vm"></audio>` : ''}
      ${c.recording ? `<audio controls preload="none" src="/api/tracked-calls/${esc(c.id)}/audio"></audio>` : ''}</div>
    ${c.from ? `<a class="btn btn-ghost btn-sm" href="tel:${esc(c.from)}">Call back</a>` : '<span></span>'}</li>`; }).join('')}</ul>`;
}

// ---------- Hub: Calls tab ----------
export async function callsTab(el, c, user, month = thisMonth()) {
  el.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/calls?month=${month}`); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const owner = user.role === 'admin';
  const again = (m = month) => callsTab(el, c, user, m);
  el.innerHTML = `
    <div class="card"><div class="card-head"><h2>Tracking numbers</h2>${owner && d.twilio ? '<button class="btn btn-primary btn-sm" id="ctget">Get a number</button>' : ''}</div>
      ${!d.twilio ? '<p class="muted">Add the Twilio keys in Cloudflare first.</p>' : ''}
      ${d.numbers.length ? `<ul class="list">${d.numbers.map((n) => `<li class="item"><span class="badge">${esc(n.source)}</span>
          <div><div class="item-title">${esc(n.pretty)}</div><div class="item-sub">Rings ${esc(n.forwardPretty)}. Recording ${n.record ? 'on (callers hear a notice)' : 'off'}. Missed call emails to ${esc(n.alert_to || c.contact_email || 'nobody yet')}.</div></div>
          <div class="row" style="gap:6px"><button class="btn btn-ghost btn-sm" data-edit="${esc(n.id)}">Edit</button>${owner ? `<button class="btn btn-ghost btn-sm" data-release="${esc(n.id)}">Release</button>` : ''}</div></li>`).join('')}</ul>
        <p class="small muted" style="margin-top:10px">Tip: put the Google profile number as the main phone on their Google profile and keep their real number as an additional phone, so name, address and phone stay consistent everywhere.</p>`
        : d.twilio ? `<p class="muted">No tracking number yet. Each number forwards to the client's phone and logs every call, so the monthly report can show the calls the work brings in.${owner ? '' : ' Ask an owner to get one.'}</p>` : ''}
    </div>
    <div class="card"><div class="card-head"><h2>Calls</h2><input type="month" id="ctmonth" value="${esc(d.month)}" max="${thisMonth()}" style="width:auto" aria-label="Month"></div>
      ${statsRow(d.stats)}
      ${d.stats.bySource.length > 1 ? `<div class="row" style="gap:6px;margin-top:12px;flex-wrap:wrap">${d.stats.bySource.map((x) => `<span class="badge gray">${esc(x.source)}: ${x.n}</span>`).join('')}</div>` : ''}
      <div style="margin-top:14px">${callList(d.calls, 'No calls this month yet.')}</div></div>`;
  $('#ctmonth', el).addEventListener('change', (e) => e.target.value && again(e.target.value));
  $('#ctget', el)?.addEventListener('click', () => getNumberModal(c, d, again));
  $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => editModal(d.numbers.find((n) => n.id === b.dataset.edit), d, c, again)));
  $$('[data-release]', el).forEach((b) => b.addEventListener('click', async () => {
    const n = d.numbers.find((x) => x.id === b.dataset.release);
    if (!confirm(`Release ${n.pretty}? It goes back to Twilio, stops billing, and calls to it stop working. Take it off their Google profile and website first.`)) return;
    busy(b, true);
    try { await api(`/api/tracking-numbers/${n.id}`, { method: 'DELETE' }); toast('Number released'); again(); } catch (err) { busy(b, false); toast(err.message, true); }
  }));
}

function numberFields(d, c, n = {}) {
  return `<label class="field"><span>Where this number will be shown</span><select name="source">${d.sources.map((s) => `<option${s === (n.source || 'Google profile') ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
    <label class="field"><span>Forward calls to</span><input name="forward_to" value="${esc(n.forward_to || c.phone || '')}" placeholder="Their business phone" required></label>
    <label class="field"><span>Email missed calls to</span><input name="alert_to" type="email" value="${esc(n.alert_to || '')}" placeholder="${esc(c.contact_email || 'client@business.com')}"></label>
    <label class="row small" style="gap:8px"><input type="checkbox" name="record"${n.record ? ' checked' : ''}> Record calls. Callers first hear "This call may be recorded" (Florida needs everyone's consent).</label>`;
}

function getNumberModal(c, d, done) {
  const area = String(c.phone || '').replace(/\D/g, '').replace(/^1/, '').slice(0, 3) || '954';
  const m = modal(`<h2>Get a tracking number</h2>
    <form id="ctsearch" class="row" style="gap:8px"><label class="field" style="flex:1"><span>Area code</span><input name="area" value="${esc(area)}" maxlength="3" inputmode="numeric"></label><button class="btn btn-ghost" type="submit" style="align-self:end">Search</button></form>
    <div id="ctnums" style="margin-top:10px"></div>
    <form id="ctbuy" class="form-grid" style="grid-template-columns:1fr;margin-top:12px">${numberFields(d, c)}
      <p class="small muted">About $1.15 a month per number on Twilio, plus about 2 cents a minute for forwarded calls.</p>
      <div class="row end" style="gap:8px"><button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit" disabled>Get this number</button></div></form>`);
  const list = $('#ctnums', m.el);
  const buyBtn = $('#ctbuy button[type=submit]', m.el);
  const search = async (a) => {
    list.innerHTML = '<div class="skeleton" style="height:60px"></div>';
    try {
      const r = await api(`/api/calltrack/available?area=${encodeURIComponent(a)}`);
      list.innerHTML = r.numbers.length ? `<div class="ct-pick">${r.numbers.map((n, i) => `<label class="ct-opt"><input type="radio" name="pick" value="${esc(n.number)}"${i === 0 ? ' checked' : ''}><b>${esc(n.pretty)}</b><span class="small muted">${esc(n.city)}</span></label>`).join('')}</div>`
        : '<p class="muted">No numbers left in that area code. Try a nearby one.</p>';
      buyBtn.disabled = !r.numbers.length;
    } catch (err) { list.innerHTML = `<p class="err-text">${esc(err.message)}</p>`; }
  };
  $('#ctsearch', m.el).addEventListener('submit', (e) => { e.preventDefault(); search(e.currentTarget.area.value); });
  search(area);
  $('#ctbuy', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const pick = $('input[name=pick]:checked', m.el)?.value;
    if (!pick) return;
    busy(buyBtn, true, 'Setting up');
    try {
      await api(`/api/clients/${c.id}/tracking-numbers`, { method: 'POST', body: { number: pick, source: f.source.value, forward_to: f.forward_to.value, alert_to: f.alert_to.value, record: f.record.checked } });
      m.close(); toast('Number ready. Calls to it ring the client now.'); done();
    } catch (err) { busy(buyBtn, false); toast(err.message, true); }
  });
}

function editModal(n, d, c, done) {
  const m = modal(`<h2>${esc(n.pretty)}</h2><form id="ctedit" class="form-grid" style="grid-template-columns:1fr">${numberFields(d, c, n)}
    <div class="row end" style="gap:8px"><button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save</button></div></form>`);
  $('#ctedit', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    busy($('button[type=submit]', f), true);
    try {
      await api(`/api/tracking-numbers/${n.id}`, { method: 'PATCH', body: { source: f.source.value, forward_to: f.forward_to.value, alert_to: f.alert_to.value, record: f.record.checked } });
      m.close(); toast('Saved'); done();
    } catch (err) { busy($('button[type=submit]', f), false); toast(err.message, true); }
  });
}

// ---------- client app ----------
export async function callsSummary(clientId) {
  try { const d = await api(`/api/clients/${clientId}/calls`); return d.numbers.length || d.stats.total ? d.stats : null; } catch { return null; }
}

export async function clientCalls(v, c) {
  v.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/calls`); } catch (e) { v.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  v.innerHTML = `${statsRow(d.stats).replace('repeat(4,minmax(0,1fr))', 'repeat(2,minmax(0,1fr))')}
    ${d.stats.missed ? '<p class="small" style="margin:0">Call missed callers back fast. Most people call the next business on the list.</p>' : ''}
    <div class="card">${callList(d.calls, 'Calls from your Google profile and website show up here.')}</div>`;
}
