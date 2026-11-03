// Messages between a client and the team. The client sees it in their app; the team sees it in the client's Messages tab
// and in the client's private Slack channel. Text, photos and files both ways.
import { $, esc, api, toast, busy, icon, resizeImage } from './core.js';
import { slackHtml } from './slacktext.js';

const when = (ts) => new Date(Number(ts) * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');

export async function chatView(el, clientId, { staff = false } = {}) {
  el.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${clientId}/chat`); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  if (!d.ready) return staff ? setupCard(el, clientId, d) : (el.innerHTML = '<div class="card empty"><h3>Messages are on the way</h3><p>Your Rightway team will turn on Messages soon. Until then, call or text us.</p></div>');
  el.innerHTML = `<div class="chat${staff ? ' is-staff' : ''}">
    ${staff ? `<p class="small muted chat-note">Everything here is also in the private Slack channel <b>#${esc(d.channelName || 'chat')}</b>, and everything written there shows in the client's app.</p>` : ''}
    <div class="chat-msgs" id="chat-msgs"></div>
    <form class="chat-compose" id="chat-f"><label class="icon-btn" title="Send a photo or file">${icon.clip}<input type="file" name="file" hidden></label>
      <textarea name="text" rows="1" placeholder="${staff ? 'Message the client' : 'Message your team'}" aria-label="Message"></textarea>
      <button class="btn btn-primary" type="submit" aria-label="Send">${icon.send}</button></form>
    <div class="small muted chat-file" id="chat-file"></div></div>`;
  let sig = '';
  const draw = (msgs, force) => {
    const s = JSON.stringify(msgs.map((m) => [m.ts, m.text, m.files.length]));
    if (s === sig && !force) return;
    sig = s;
    const box = $('#chat-msgs', el);
    if (!box) return;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.innerHTML = msgs.length ? msgs.map((m) => {
      // Updates from the Hub (report ready, page to check, meeting booked) show as a card in the middle.
      if (m.note) return `<div class="chat-update"><div class="chat-who small">Rightway Growth · ${esc(when(m.ts))}</div><div>${slackHtml(m.text)}</div></div>`;
      const mine = staff ? m.from === 'team' : m.from === 'client';
      return `<div class="chat-row${mine ? ' mine' : ''}">${mine ? '' : (m.image ? `<img class="chat-av" src="${esc(m.image)}" alt="">` : `<span class="chat-av">${esc(initials(m.name))}</span>`)}
        <div class="chat-bub"><div class="chat-who small">${esc(mine ? 'You' : m.name)} · ${esc(when(m.ts))}</div>${m.text ? `<div>${slackHtml(m.text)}</div>` : ''}
        ${m.files.map((f) => (f.image ? `<a href="/api/clients/${esc(clientId)}/chat/file/${esc(f.id)}" target="_blank" rel="noopener"><img class="chat-img" src="/api/clients/${esc(clientId)}/chat/file/${esc(f.id)}?thumb=1" alt="${esc(f.name)}" loading="lazy"></a>`
          : `<a class="chat-doc" href="/api/clients/${esc(clientId)}/chat/file/${esc(f.id)}?dl=1">${icon.clip}<span>${esc(f.name)}</span></a>`)).join('')}</div></div>`;
    }).join('') : `<p class="muted small" style="text-align:center;padding:24px">${staff ? 'No messages yet.' : 'Say hi. Questions, photos of new jobs, anything you need: your team sees it right away.'}</p>`;
    if (atBottom || force) box.scrollTop = box.scrollHeight;
  };
  draw(d.messages, true);
  const reload = async (force) => { try { const r = await api(`/api/clients/${clientId}/chat`); if (r.ready) draw(r.messages, force); } catch { /* keep */ } };
  const timer = setInterval(() => { if (!document.getElementById('chat-msgs')) return clearInterval(timer); if (!document.hidden) reload(false); }, 5000);
  window.addEventListener('hashchange', () => clearInterval(timer), { once: true });
  const f = $('#chat-f', el);
  const ta = f.text;
  const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(160, ta.scrollHeight)}px`; };
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.innerWidth > 700) { e.preventDefault(); f.requestSubmit(); } });
  f.file.addEventListener('change', () => { $('#chat-file', el).textContent = f.file.files[0] ? `Ready to send: ${f.file.files[0].name}` : ''; });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    let file = f.file.files[0];
    if (!text && !file) return;
    const btn = f.querySelector('button[type=submit]'); busy(btn, true);
    try {
      if (file) {
        if (/^image\//.test(file.type)) file = await resizeImage(file, 2000, 0.85);
        const form = new FormData(); form.append('file', file); if (text) form.append('comment', text);
        await api(`/api/clients/${clientId}/chat/upload`, { method: 'POST', form });
        f.file.value = ''; $('#chat-file', el).textContent = '';
      } else await api(`/api/clients/${clientId}/chat`, { method: 'POST', body: { text } });
      ta.value = ''; grow();
      await reload(true);
    } catch (err) { toast(err.message, true); }
    busy(btn, false);
  });
}

async function setupCard(el, clientId, d) {
  el.innerHTML = `<div class="card"><div class="card-head"><h2>Messages with this client</h2></div>
    <p>Messages is the client's chat with the team: they write from their app, send photos and files, and get your replies and Hub updates with a notification. It runs through a private Slack channel, so the team can answer from Slack or from here. The client does not need Slack.</p>
    <p class="small muted">New active clients get it automatically once the Slack app is connected. Turn it on here for a client that did not (a location, a paused client, or with automatic chats off).</p>
    ${d.connected ? `<div class="row"><button class="btn btn-primary" id="ch-make">Turn on Messages</button><span class="small muted">Makes a private channel and invites the account manager and owners.</span></div>
      <details style="margin-top:12px"><summary class="small">Or use a channel you already have</summary><div class="row" style="margin-top:8px"><select id="ch-pick"><option value="">Loading channels...</option></select><button class="btn btn-ghost btn-sm" id="ch-use">Use it</button></div>
      <p class="small muted">Everything in that channel will show in the client's app.</p></details>`
    : '<p class="badge warn">Connect the Slack app on the Alerts page first.</p>'}</div>`;
  $('#ch-make', el)?.addEventListener('click', async (e) => {
    busy(e.target, true);
    try { const r = await api(`/api/clients/${clientId}/chat/setup`, { method: 'POST', body: {} }); toast(`Messages are on (#${r.channel.name})`); chatView(el, clientId, { staff: true }); } catch (err) { toast(err.message, true); busy(e.target, false); }
  });
  if (d.connected) {
    api('/api/slack/channels').then(({ channels }) => {
      $('#ch-pick', el).innerHTML = `<option value="">Pick a channel</option>${channels.map((c) => `<option value="${esc(c.id)}" data-name="${esc(c.name)}">${c.private ? '🔒 ' : '#'}${esc(c.name)}</option>`).join('')}`;
    }).catch(() => { $('#ch-pick', el).innerHTML = '<option value="">Could not load channels</option>'; });
    $('#ch-use', el)?.addEventListener('click', async () => {
      const s = $('#ch-pick', el);
      if (!s.value) return toast('Pick a channel first', true);
      try { await api(`/api/clients/${clientId}/chat/setup`, { method: 'POST', body: { channel: { id: s.value, name: s.selectedOptions[0].dataset.name } } }); chatView(el, clientId, { staff: true }); } catch (err) { toast(err.message, true); }
    });
  }
}
