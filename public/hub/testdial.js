// Pretend versions of the dialer's windows for Test power dial and Warm up: text, book, full details, and the end of session score.
// Nothing here talks to the server, sends a text, books a calendar or changes a lead.
import { $, esc, toast, modal } from './core.js';
import { testTextReply } from '/js/testleads.js';
import { contactRows } from './phone.js';

export function testTextModal(lead, { onSent } = {}) {
  const log = [];
  const m = modal(`<div class="card-head"><div><h2 style="margin:0">Text ${esc(lead.business)}</h2><p class="small muted" style="margin:2px 0 0">Practice text. Nothing is sent. The pretend owner answers.</p></div><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <div class="pr-log" id="ttlog"><p class="muted">No texts yet.</p></div>
    <div class="pr-in"><textarea id="ttin" rows="2" placeholder="Type a text" aria-label="Text"></textarea>
      <div class="row" style="gap:8px"><button type="button" class="btn btn-primary btn-sm" id="ttsend">Send (pretend)</button><span class="small muted">First text should say who you are and "Reply STOP to opt out".</span></div></div>`, { win: true });
  const el = m.el;
  const paint = () => { $('#ttlog', el).innerHTML = log.map((t) => `<div class="pr-b ${t.me ? 'rep' : 'lead'}"><small>${t.me ? 'You' : esc(lead.contact_name || 'Owner')}</small>${esc(t.text)}</div>`).join('') || '<p class="muted">No texts yet.</p>'; const l = $('#ttlog', el); l.scrollTop = l.scrollHeight; };
  const send = () => {
    const t = ($('#ttin', el).value || '').trim(); if (!t) return;
    $('#ttin', el).value = ''; log.push({ me: true, text: t }); paint(); onSent?.(t);
    const r = testTextReply(lead, t);
    if (r) setTimeout(() => { if (!document.body.contains(el)) return; log.push({ me: false, text: r }); paint(); }, 1400);
  };
  $('#ttsend', el).addEventListener('click', send);
  $('#ttin', el).addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  return m;
}

export function testBookModal(lead, onDone) {
  const soon = new Date(Date.now() + 24 * 3600e3); soon.setHours(12, 0, 0, 0);
  const val = new Date(soon.getTime() - soon.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const m = modal(`<div class="card-head"><div><h2 style="margin:0">Book ${esc(lead.business)}</h2><p class="small muted" style="margin:2px 0 0">Practice booking. No calendar event, no Meet link, no email.</p></div><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <label class="field"><span>Their time</span><input type="datetime-local" id="tbwhen" value="${val}"></label>
    <label class="field"><span>Who runs the call</span><select id="tbwho"><option>First free closer</option><option>Me</option></select></label>
    <div class="row" style="gap:8px;margin-top:12px"><button type="button" class="btn btn-primary" id="tbgo">Book it (pretend)</button></div>`, { win: true });
  $('#tbgo', m.el).addEventListener('click', () => { const when = $('#tbwhen', m.el).value; if (!when) return toast('Pick a time.', true); m.close?.(); toast('Practice booking saved. Nothing was created.'); onDone?.(when); });
  return m;
}

export function testLeadModal(lead, history = []) {
  const rows = [['Phone', lead.phone], ['Owner or contact', lead.contact_name || 'Not known yet'], ['Email', lead.email || 'None'], ['Where', [lead.city, lead.state].filter(Boolean).join(', ')], ['Industry', lead.industry], ['Website', lead.website || 'None'], ['Google', lead.reviews != null ? `${lead.rating} stars, ${lead.reviews} reviews` : 'Unknown'], ['Their time', lead.local_time]];
  return modal(`<div class="card-head"><div><h2 style="margin:0">${esc(lead.business)}</h2><p class="small muted" style="margin:2px 0 0">Pretend lead. Grade ${esc(lead.grade)}.</p></div><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    ${contactRows(rows.map(([k, v]) => ({ k, v })))}
    <h3 style="margin-top:14px">This session</h3>${history.length ? `<ul class="small">${history.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : '<p class="small muted">No calls to this lead yet.</p>'}`);
}

// The card shown when the pretend queue runs out.
export function testSummaryHtml(log) {
  const calls = log.length;
  const talks = log.filter((x) => x.talk).length;
  const booked = log.filter((x) => x.booked).length;
  const by = {}; log.forEach((x) => { by[x.label] = (by[x.label] || 0) + 1; });
  const scores = log.map((x) => x.score).filter((n) => n != null);
  const avg = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
  return `<div class="card test-sum"><h3 style="margin-top:0">Warm up done</h3>
    <div class="row" style="gap:18px;flex-wrap:wrap"><span><b>${calls}</b> dials</span><span><b>${talks}</b> conversations</span><span><b>${booked}</b> booked</span>${avg != null ? `<span><b>${avg}</b> average practice score</span>` : ''}</div>
    ${calls ? `<p class="small" style="margin:10px 0 0">${Object.entries(by).map(([k, n]) => `${esc(k)}: ${n}`).join(' · ')}</p>` : '<p class="small muted">No results logged.</p>'}
    <div class="row" style="gap:8px;margin-top:12px"><button type="button" class="btn btn-primary" id="tsagain">Run it again</button><button type="button" class="btn btn-ghost" id="tsexit">Exit test</button></div></div>`;
}
