// Slack on the Alerts page: owners connect the Slack app, pick a channel for each kind of alert and for each client, and link
// teammates. Everyone picks which alerts come to them as Slack direct messages.
import { $, $$, esc, api, toast, busy, copy } from './core.js';

export async function slackCards(box, user, again) {
  let d;
  try { d = await api('/api/slack'); } catch (e) { box.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const admin = user.role === 'admin';
  box.innerHTML = `${admin ? (d.connected ? connectedCard(d) : setupCard(d)) : ''}${d.connected ? mineCard(d) : admin ? '' : '<div class="card"><h2>Slack</h2><p class="small muted">An owner has not connected Slack yet.</p></div>'}`;
  wire(box, d, user, again);
  if (admin && d.connected) loadChannels(box, d);
}

function setupCard(d) {
  return `<div class="card slack-card"><div class="card-head"><h2>Slack</h2><span class="badge gray">Not connected</span></div>
    <p class="small">Connect the Rightway Hub app to your Slack: alerts go to the channels you pick, each person gets their own alerts as direct messages,
      buttons in Slack act in the Hub (start a timer, claim a lead, reply to a text), and <b>/hub</b> answers questions like "what's my work" or "how is Sunrise doing".</p>
    <ol class="steps small">
      <li><a class="btn btn-primary btn-sm" href="${esc(d.createUrl)}" target="_blank" rel="noopener">Create the Slack app</a> Slack opens with everything filled in. Pick your workspace, then Create.
        <button class="linkish" id="slk-copy" type="button">Copy the setup (manifest) instead</button></li>
      <li>In the app's page, open <b>Install App</b> (or OAuth and Permissions) and click <b>Install to Workspace</b>, then Allow.</li>
      <li>Copy the <b>Bot User OAuth Token</b> (starts with xoxb-) from OAuth and Permissions, and the <b>Signing Secret</b> from Basic Information. Paste both here.</li>
    </ol>
    <form id="slk-connect" class="form-grid">
      <label class="field"><span>Bot User OAuth Token</span><input name="token" placeholder="xoxb-..." autocomplete="off" required></label>
      <label class="field"><span>Signing Secret</span><input name="signing" type="password" autocomplete="off" required></label>
      <div class="span-all row end"><button class="btn btn-primary" type="submit">Connect Slack</button></div>
    </form>
    <p class="small muted">Both are stored encrypted and never shown again.</p>
    <details style="margin-top:10px"><summary class="small">Just want alerts in one channel? Use a webhook instead</summary>${webhookForm(d)}</details></div>`;
}

function webhookForm(d) {
  return `<form id="slk-hook" class="form-grid" style="margin-top:10px"><label class="field span-all"><span>Incoming webhook address</span><input name="webhook" type="url" placeholder="${d.webhook ? 'Saved. Paste a new one to replace it.' : 'https://hooks.slack.com/services/...'}" autocomplete="off"></label>
    <div class="span-all pref-list">${Object.entries(d.kinds).filter(([k]) => k !== 'digest').map(([k, l]) => `<label class="row small"><input type="checkbox" name="k_${esc(k)}"${d.webhookKinds.includes(k) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div>
    <div class="span-all row end">${d.webhook ? '<button class="btn btn-ghost btn-sm" type="button" id="slk-hookoff">Remove webhook</button>' : ''}<button class="btn btn-ghost btn-sm" type="submit">Save webhook</button></div></form>`;
}

function connectedCard(d) {
  const linked = d.people.filter((p) => p.slack_id).length;
  return `<div class="card slack-card"><div class="card-head"><div><p class="eyebrow">Slack</p><h2>${esc(d.team?.name || 'Connected')}</h2></div>
      <div class="row"><button class="btn btn-ghost btn-sm" id="slk-test">Send a test</button><button class="btn btn-ghost btn-sm" id="slk-off">Disconnect</button></div></div>
    <h3>Where alerts go</h3>
    <p class="small muted">Pick a channel for each kind of alert, or leave it off. For a private channel, invite the app there first (type /invite @Rightway Hub in the channel).</p>
    <div class="slk-routes" id="slk-routes">${Object.entries(d.kinds).map(([k, l]) => `<label class="row small slk-route"><span>${esc(l)}</span><select data-kind="${esc(k)}"><option value="">Off</option>${d.routes[k] ? `<option value="${esc(d.routes[k].id)}" selected>#${esc(d.routes[k].name)}</option>` : ''}</select></label>`).join('')}</div>
    <div class="row end" style="margin-top:10px"><button class="btn btn-primary btn-sm" id="slk-saveroutes">Save channels</button></div>
    <h3 style="margin-top:18px">Client channels</h3>
    <p class="small muted">Updates about one client (approvals, uploads, report views, new client) also go to that client's channel.</p>
    <div class="slk-routes" id="slk-clients">${d.clients.map((c) => `<label class="row small slk-route"><span>${esc(c.name)}</span><select data-client="${esc(c.id)}"><option value="">None</option>${c.slack_channel ? `<option value="${esc(c.slack_channel)}" selected>#${esc(c.slack_channel_name || c.slack_channel)}</option>` : ''}</select></label>`).join('') || '<p class="small muted">No active clients yet.</p>'}</div>
    <h3 style="margin-top:18px">Team in Slack</h3>
    <p class="small muted">${linked} of ${d.people.length} linked. People are matched by the email they use in Slack. Linked people get their own alerts as direct messages and can use the buttons and /hub.</p>
    <ul class="list">${d.people.map((p) => `<li class="item"><span class="badge ${p.slack_id ? '' : 'gray'}">${p.slack_id ? 'Linked' : 'Not linked'}</span><div><div class="item-title">${esc(p.name || p.email)}</div><div class="item-sub">${esc(p.email)}</div></div>
      ${p.slack_id ? `<button class="btn btn-ghost btn-sm" data-unlink="${esc(p.id)}">Unlink</button>` : `<button class="btn btn-ghost btn-sm" data-link="${esc(p.id)}" data-email="${esc(p.email)}">Link</button>`}</li>`).join('')}</ul>
    <h3 style="margin-top:18px">In Slack</h3>
    <p class="small"><b>/hub</b> your open tasks · <b>/hub client sunrise</b> a client's numbers · <b>/hub lead joe</b> find a lead · <b>/hub stats</b> agency numbers (owners)</p></div>`;
}

function mineCard(d) {
  return `<div class="card"><div class="card-head"><h2>My Slack messages</h2><span class="badge ${d.mine.linked ? '' : 'gray'}">${d.mine.linked ? 'Linked' : 'Not linked'}</span></div>
    ${d.mine.linked ? `<p class="small muted">Alerts meant for you come as a direct message from the Rightway Hub app. Pick which.</p>
      <form id="slk-mine" class="pref-list">${Object.entries(d.mine.kinds).map(([k, l]) => `<label class="row small"><input type="checkbox" name="${esc(k)}"${d.mine.prefs[k] ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</form>`
    : `<p class="small">Your Slack is not linked yet. If your Slack uses a different email than your Hub login, type it here.</p>
      <form id="slk-linkme" class="row"><input name="email" type="email" placeholder="Email you use in Slack" style="flex:1 1 200px"><button class="btn btn-primary btn-sm" type="submit">Link my Slack</button></form>`}</div>`;
}

async function loadChannels(box, d) {
  let channels;
  try { ({ channels } = await api('/api/slack/channels')); } catch (e) { toast(e.message, true); return; }
  const opts = (sel) => channels.map((c) => `<option value="${esc(c.id)}"${c.id === sel ? ' selected' : ''}>${c.private ? '🔒 ' : '#'}${esc(c.name)}</option>`).join('');
  $$('#slk-routes select', box).forEach((s) => { const cur = s.value; s.innerHTML = `<option value="">Off</option>${opts(cur)}`; });
  $$('#slk-clients select', box).forEach((s) => { const cur = s.value; s.innerHTML = `<option value="">None</option>${opts(cur)}`; });
  box.dataset.channels = JSON.stringify(channels);
}

function wire(box, d, user, again) {
  const chan = (id) => { const list = JSON.parse(box.dataset.channels || '[]'); const c = list.find((x) => x.id === id); return c ? { id: c.id, name: c.name } : null; };
  $('#slk-copy', box)?.addEventListener('click', () => copy(JSON.stringify(d.manifest, null, 2), 'Setup copied. In Slack: Create New App, From an app manifest, paste it.'));
  $('#slk-connect', box)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]'); busy(btn, true);
    try { const r = await api('/api/slack/connect', { method: 'POST', body: Object.fromEntries(new FormData(e.target).entries()) }); toast(`Connected to ${r.team}. ${r.linked} teammate${r.linked === 1 ? '' : 's'} linked by email.`); again(); }
    catch (err) { toast(err.message, true); busy(btn, false); }
  });
  $('#slk-hook', box)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const kinds = $$('input[type=checkbox]', f).filter((i) => i.checked).map((i) => i.name.slice(2));
    try { await api('/api/slack/webhook', { method: 'PUT', body: { webhook: f.webhook.value.trim(), kinds } }); toast('Webhook saved'); again(); } catch (err) { toast(err.message, true); }
  });
  $('#slk-hookoff', box)?.addEventListener('click', async () => { await api('/api/slack?what=webhook', { method: 'DELETE' }); again(); });
  $('#slk-test', box)?.addEventListener('click', async (e) => {
    busy(e.target, true);
    try { const r = await api('/api/slack/test', { method: 'POST' }); toast(r.errors?.length ? `Sent to ${r.sent}. Not sent: ${r.errors[0]}` : `Test sent to ${r.sent} place${r.sent === 1 ? '' : 's'}`, Boolean(r.errors?.length)); } catch (err) { toast(err.message, true); }
    busy(e.target, false);
  });
  $('#slk-off', box)?.addEventListener('click', async () => { if (!confirm('Disconnect Slack? Alerts stop going to Slack.')) return; await api('/api/slack', { method: 'DELETE' }); again(); });
  $('#slk-saveroutes', box)?.addEventListener('click', async (e) => {
    const routes = Object.fromEntries($$('#slk-routes select', box).map((s) => [s.dataset.kind, s.value ? chan(s.value) || d.routes[s.dataset.kind] : null]));
    busy(e.target, true);
    try { await api('/api/slack/routes', { method: 'PUT', body: { routes } }); toast('Channels saved'); } catch (err) { toast(err.message, true); }
    busy(e.target, false);
  });
  $$('#slk-clients select', box).forEach((s) => s.addEventListener('change', async () => {
    try { await api(`/api/clients/${s.dataset.client}/slack`, { method: 'PUT', body: { channel: s.value ? chan(s.value) : null } }); toast('Saved'); } catch (err) { toast(err.message, true); }
  }));
  $$('[data-link]', box).forEach((b) => b.addEventListener('click', async () => {
    const email = prompt('Email they use in Slack', b.dataset.email);
    if (!email) return;
    try { const r = await api('/api/slack/link', { method: 'POST', body: { user: b.dataset.link, email } }); toast(`Linked to ${r.name}`); again(); } catch (err) { toast(err.message, true); }
  }));
  $$('[data-unlink]', box).forEach((b) => b.addEventListener('click', async () => { await api('/api/slack/link', { method: 'POST', body: { user: b.dataset.unlink, unlink: true } }); again(); }));
  $('#slk-mine', box)?.addEventListener('change', async (e) => {
    const body = Object.fromEntries($$('input', e.currentTarget).map((i) => [i.name, i.checked]));
    try { await api('/api/slack/prefs', { method: 'PUT', body }); toast('Saved'); } catch (err) { toast(err.message, true); }
  });
  $('#slk-linkme', box)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const r = await api('/api/slack/link', { method: 'POST', body: { email: e.target.email.value.trim() || undefined } }); toast(`Linked to ${r.name}`); again(); } catch (err) { toast(err.message, true); }
  });
}
