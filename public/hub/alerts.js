// Alerts: push notifications on this phone, tablet or computer, what each person wants to hear about, the alert list,
// ringing a saved mobile for incoming calls, and (owners) posting alerts to a Slack channel.
import { $, $$, esc, api, toast, busy, fmt, icon } from './core.js';
import { staffShell } from './staff.js';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const keyBytes = (b64) => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };

async function registration() {
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') throw new Error('Notifications need the Hub on https.');
  await navigator.serviceWorker.register('/sw.js').catch(() => {});
  return navigator.serviceWorker.ready;
}
export async function currentSub() {
  if (!supported()) return null;
  try { const reg = await registration(); return await reg.pushManager.getSubscription(); } catch { return null; }
}
export async function enablePush() {
  if (!supported()) throw new Error('This browser does not support notifications.');
  if (isIos() && !standalone()) throw new Error('On iPhone and iPad, add the Hub to your Home Screen first (Share, Add to Home Screen), then turn notifications on from there.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them for this site in the browser settings.');
  const { publicKey } = await api('/api/notify/config');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await api('/api/notify/subscribe', { method: 'POST', body: sub.toJSON() });
  return sub;
}
export async function disablePush() {
  const sub = await currentSub();
  if (!sub) return;
  await api('/api/notify/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export async function alertBadge(root = document) {
  try {
    const { unread } = await api('/api/notifications/unread');
    const a = $('a[href="#/alerts"]', root);
    if (a && unread) a.insertAdjacentHTML('beforeend', `<b class="nbadge">${unread > 99 ? '99+' : unread}</b>`);
  } catch { /* ignore */ }
}

// A small card that offers notifications once (client app home, staff dashboard).
export async function pushPrompt(box, text) {
  if (!box || !supported() || Notification.permission === 'denied') return;
  if (await currentSub()) return;
  try { if (localStorage.getItem('rw-push-skip')) return; } catch { /* ignore */ }
  box.innerHTML = `<div class="card push-card"><div class="row"><span class="push-ic">${icon.bell}</span><div><b>Turn on notifications</b><div class="small muted">${esc(text)}</div></div></div>
    <div class="row" style="margin-top:10px"><button class="btn btn-primary btn-sm" id="pp-on">Turn on</button><button class="btn btn-ghost btn-sm" id="pp-skip">Not now</button></div></div>`;
  $('#pp-on', box).addEventListener('click', async (e) => { busy(e.target, true); try { await enablePush(); box.innerHTML = ''; toast('Notifications are on'); } catch (err) { toast(err.message, true); busy(e.target, false); } });
  $('#pp-skip', box).addEventListener('click', () => { try { localStorage.setItem('rw-push-skip', '1'); } catch { /* ignore */ } box.innerHTML = ''; });
}

export async function alertsPage(app, user) {
  const view = staffShell(app, user, 'alerts');
  view.innerHTML = '<div class="page-head"><div><p class="eyebrow">Notifications</p><h1>Alerts</h1></div></div><div class="skeleton"></div>';
  let cfg, list, me;
  try { [cfg, list, me] = await Promise.all([api('/api/notify/config'), api('/api/notifications'), api('/api/me').catch(() => ({ user: {} }))]); } catch (e) { view.insertAdjacentHTML('beforeend', `<p class="err-text">${esc(e.message)}</p>`); return; }
  const sub = await currentSub();
  const admin = user.role === 'admin';
  const devTxt = !supported() ? 'This browser cannot get notifications.' : isIos() && !standalone() ? 'On iPhone and iPad: add the Hub to your Home Screen (Share, Add to Home Screen), open it from there, then turn notifications on.'
    : sub ? 'On for this device.' : Notification.permission === 'denied' ? 'Blocked for this site. Allow notifications in the browser settings, then come back.' : 'Off for this device.';
  view.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">Notifications</p><h1>Alerts</h1></div>${list.unread ? '<button class="btn btn-ghost btn-sm" id="readall">Mark all read</button>' : ''}</div>
    <div class="split" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
      <div class="card"><div class="card-head"><h2>This device</h2><span class="badge ${sub ? '' : 'gray'}">${sub ? 'On' : 'Off'}</span></div>
        <p class="small">${esc(devTxt)} Turn it on for each phone, tablet and computer you use. ${cfg.devices ? `${cfg.devices} device${cfg.devices === 1 ? '' : 's'} on for you now.` : ''}</p>
        <div class="row">${sub ? '<button class="btn btn-ghost btn-sm" id="poff">Turn off here</button><button class="btn btn-primary btn-sm" id="ptest">Send a test</button>' : supported() && Notification.permission !== 'denied' ? '<button class="btn btn-primary btn-sm" id="pon">Turn on here</button>' : ''}</div>
        <h3 style="margin-top:16px">Ring my phone for calls</h3>
        <p class="small muted">Incoming calls ring every open Hub and buzz devices with notifications on. To make your phone ring like a normal call even when the Hub is closed, save your mobile here. Every saved mobile rings at the same time; the first to answer gets the call.</p>
        <form id="cellf" class="row"><input name="phone" type="tel" placeholder="(954) 555-0123" value="${esc(me.user?.phone || '')}" style="flex:1 1 160px"><button class="btn btn-ghost btn-sm" type="submit">Save</button></form>
      </div>
      <div class="card"><div class="card-head"><h2>Notify me about</h2></div>
        <form id="prefs" class="pref-list">${Object.entries(cfg.kinds).map(([k, l]) => `<label class="row small"><input type="checkbox" name="${esc(k)}"${cfg.prefs[k] === false ? '' : ' checked'}> ${esc(l)}</label>`).join('')}</form>
        <p class="small muted" style="margin-top:8px">Everything still shows in the list below. These switches only decide what buzzes your devices.</p></div>
    </div>
    ${admin ? slackCard(cfg.slack) : ''}
    <div class="card"><div class="card-head"><h2>Recent</h2></div>
      ${list.notifications.length ? `<ul class="list">${list.notifications.map((n) => `<li class="item alert-row${n.read_at ? '' : ' is-new'}" data-id="${esc(n.id)}" data-url="${esc(n.url || '')}"><span class="badge ${n.read_at ? 'gray' : ''}">${esc(cfg.kinds[n.kind] ? cfg.kinds[n.kind].split(' ')[0] : n.kind)}</span>
        <div><div class="item-title">${esc(n.title)}</div>${n.body ? `<div class="item-sub">${esc(n.body)}</div>` : ''}</div><span class="small">${esc(fmt.ago(n.created_at))}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing yet. Calls, texts, voicemails, new tasks and client updates show up here.</p>'}</div>`;
  const again = () => alertsPage(app, user);
  $('#pon', view)?.addEventListener('click', async (e) => { busy(e.target, true); try { await enablePush(); toast('Notifications are on for this device'); again(); } catch (err) { toast(err.message, true); busy(e.target, false); } });
  $('#poff', view)?.addEventListener('click', async () => { await disablePush(); toast('Off for this device'); again(); });
  $('#ptest', view)?.addEventListener('click', async (e) => { busy(e.target, true); try { const r = await api('/api/notify/test', { method: 'POST' }); toast(r.pushed ? 'Sent. It should show in a few seconds.' : 'Saved, but no device took it. Turn notifications off and on again here.', !r.pushed); } catch (err) { toast(err.message, true); } busy(e.target, false); });
  $('#readall', view)?.addEventListener('click', async () => { await api('/api/notifications/read', { method: 'POST', body: {} }); again(); });
  $('#prefs', view).addEventListener('change', async (e) => {
    const body = Object.fromEntries($$('input', e.currentTarget).map((i) => [i.name, i.checked]));
    try { await api('/api/notify/prefs', { method: 'PUT', body }); toast('Saved'); } catch (err) { toast(err.message, true); }
  });
  $('#cellf', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/me/phone', { method: 'PUT', body: { phone: e.target.phone.value } }); toast(e.target.phone.value ? 'Saved. Your phone rings for incoming calls.' : 'Removed'); } catch (err) { toast(err.message, true); }
  });
  $$('.alert-row', view).forEach((r) => r.addEventListener('click', async () => {
    await api('/api/notifications/read', { method: 'POST', body: { ids: [r.dataset.id] } }).catch(() => {});
    const u = r.dataset.url;
    if (u.startsWith('/#/')) location.hash = u.slice(1); else if (u.startsWith('/')) window.open(u, '_blank'); else again();
  }));
  wireSlack(view, again);
}

function slackCard(s) {
  if (!s) return '';
  return `<div class="card"><div class="card-head"><h2>Slack</h2><span class="badge ${s.connected ? '' : 'gray'}">${s.connected ? 'Connected' : 'Not connected'}</span></div>
    <p class="small muted">Post Hub alerts to a Slack channel. In Slack: Apps, search "Incoming WebHooks" (or make a Slack app with Incoming Webhooks on), pick the channel, copy the webhook address and paste it here. It is stored encrypted and never shown again.</p>
    <form id="slackf" class="form-grid">
      <label class="field span-all"><span>Webhook address</span><input name="webhook" type="url" placeholder="${s.connected ? 'Saved. Paste a new one to replace it.' : 'https://hooks.slack.com/services/...'}" autocomplete="off"></label>
      <div class="span-all pref-list">${Object.entries(s.all).map(([k, l]) => `<label class="row small"><input type="checkbox" name="k_${esc(k)}"${s.kinds.includes(k) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div>
      <div class="span-all row end">${s.connected ? '<button class="btn btn-ghost btn-sm" type="button" id="slackoff">Disconnect</button><button class="btn btn-ghost btn-sm" type="button" id="slacktest">Send a test</button>' : ''}<button class="btn btn-primary btn-sm" type="submit">Save</button></div>
    </form></div>`;
}
function wireSlack(view, again) {
  const f = $('#slackf', view);
  if (!f) return;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const kinds = $$('input[type=checkbox]', f).filter((i) => i.checked).map((i) => i.name.slice(2));
    const btn = f.querySelector('button[type=submit]');
    busy(btn, true);
    try { await api('/api/slack', { method: 'PUT', body: { webhook: f.webhook.value.trim(), kinds } }); toast('Slack saved'); again(); } catch (err) { toast(err.message, true); busy(btn, false); }
  });
  $('#slacktest', view)?.addEventListener('click', async (e) => { busy(e.target, true); try { await api('/api/slack/test', { method: 'POST' }); toast('Sent to Slack'); } catch (err) { toast(err.message, true); } busy(e.target, false); });
  $('#slackoff', view)?.addEventListener('click', async () => { if (!confirm('Stop posting to Slack?')) return; await api('/api/slack', { method: 'DELETE' }); again(); });
}
