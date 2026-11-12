// Social tab, "Facebook, Instagram and ads" card: send the client a connect link, see what they shared, check it still works.
// Owners also save the Meta app here (App ID and secret). Publishing is still by hand; this is the connection.
import { $, $$, esc, api, toast, copy, modal, busy } from './core.js';
import { KIND, PERMISSIONS } from '../js/meta.js';

const when = (ms) => (ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-');
const TONE = { ok: ['ok', 'Connected'], thin: ['warn', 'Needs a fix'], expired: ['bad', 'Sign-in ended'], revoked: ['bad', 'Removed by client'] };

export async function metaCard(host, c) {
  let d; let app = {};
  const load = async () => {
    [d, app] = await Promise.all([api(`/api/clients/${c.id}/meta`), api('/api/meta/app').catch(() => ({}))]);
  };
  const isOwner = () => 'appId' in app;

  const paint = () => {
    const live = d.connections.filter((x) => x.status !== 'revoked');
    const bad = live.some((x) => x.status !== 'ok');
    const badge = !live.length ? '<span class="badge gray">Not connected</span>' : bad ? '<span class="badge warn">Needs attention</span>' : '<span class="badge ok">Connected</span>';
    host.innerHTML = `<div class="card-head"><h2>Facebook, Instagram and ads</h2><div class="row" style="gap:8px">${badge}
        ${live.length ? '<button class="btn btn-ghost btn-sm" id="mtcheck">Check connection</button>' : ''}<button class="btn btn-primary btn-sm" id="mtlink"${d.configured ? '' : ' disabled'}>Send connect link</button></div></div>
      <p class="small muted">The client opens the link, signs in to Facebook and ticks their Page, Instagram and ad account. We keep the access, sealed. Posts are still put up by hand (copy, download, Mark posted); automatic publishing waits on Meta approving the Hub's app.</p>
      ${d.configured ? '' : `<p class="small err-text">${isOwner() ? 'Save the Meta app below first.' : 'An owner needs to save the Meta app first (below).'}</p>`}
      ${live.map(connection).join('')}
      ${d.links.length ? `<h3 style="margin:14px 0 6px">Links</h3><ul class="list">${d.links.map(linkRow).join('')}</ul>` : ''}
      ${isOwner() ? setup() : ''}`;
    $('#mtlink', host)?.addEventListener('click', makeLink);
    $('#mtcheck', host)?.addEventListener('click', async (e) => {
      busy(e.currentTarget, true, 'Checking');
      try { d = await api(`/api/clients/${c.id}/meta/check`, { method: 'POST' }); toast('Checked with Meta'); } catch (err) { toast(err.message, true); }
      paint();
    });
    $$('[data-copy]', host).forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy, 'Link copied')));
    $$('[data-copyval]', host).forEach((b) => b.addEventListener('click', () => copy(b.dataset.copyval)));
    $$('[data-revoke]', host).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Turn this link off? The client will not be able to open it.')) return;
      try { await api(`/api/meta/links/${b.dataset.revoke}`, { method: 'DELETE' }); await refresh(); } catch (e) { toast(e.message, true); }
    }));
    $$('[data-disc]', host).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Disconnect this login? We also remove the Hub from their Facebook account. To post again they need a new link.')) return;
      try { await api(`/api/meta/connections/${b.dataset.disc}`, { method: 'DELETE' }); await refresh(); toast('Disconnected'); } catch (e) { toast(e.message, true); }
    }));
    $('#mtapp', host)?.addEventListener('submit', saveApp);
  };
  const refresh = async () => { await load(); paint(); };

  const connection = (x) => {
    const [tone, label] = TONE[x.status] || TONE.ok;
    return `<div class="card" style="margin-top:10px;box-shadow:none"><div class="card-head"><div><b>${esc(x.fb_name || 'Facebook login')}</b><div class="small muted">Connected ${esc(when(x.created_at))}${x.checked_at ? `, checked ${esc(when(x.checked_at))}` : ''}${x.expires_at ? `, sign-in good until about ${esc(when(x.expires_at))}` : ''}</div></div>
        <div class="row" style="gap:8px"><span class="badge ${tone}">${esc(label)}</span><button class="btn btn-ghost btn-sm" data-disc="${esc(x.id)}">Disconnect</button></div></div>
      <p class="small" style="margin:6px 0">${esc(x.line)}</p>
      ${x.assets.length ? `<ul class="list">${x.assets.map((a) => `<li class="item"><div><div class="item-title">${esc(a.name)}</div><div class="item-sub">${esc(KIND[a.kind] || a.kind)}${a.kind === 'page' || a.kind === 'instagram' ? (a.can_post ? ', can publish' : ', can not publish') : ''}</div></div></li>`).join('')}</ul>` : ''}
      ${x.problems.length ? `<ul class="small err-text" style="margin:8px 0 0 18px">${x.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      ${x.status !== 'ok' && x.note && !x.problems.length ? `<p class="small err-text">${esc(x.note)}</p>` : ''}</div>`;
  };

  const linkRow = (l) => `<li class="item"><div><div class="item-title">${esc(l.label || 'Connect link')}</div><div class="item-sub">Made ${esc(when(l.created_at))}. ${l.revoked ? 'Turned off.' : l.expired ? 'Expired.' : `Good until ${esc(when(l.expires_at))}.`} Opened ${l.views} time${l.views === 1 ? '' : 's'}${l.last_seen ? `, last ${esc(when(l.last_seen))}` : ''}.</div></div>
    ${l.revoked || l.expired ? '' : `<div class="row" style="gap:6px"><button class="btn btn-ghost btn-sm" data-copy="${esc(l.url)}">Copy link</button><a class="btn btn-ghost btn-sm" href="${esc(l.url)}" target="_blank" rel="noopener">Open</a><button class="btn btn-ghost btn-sm" data-revoke="${esc(l.token)}">Turn off</button></div>`}</li>`;

  const rowCopy = (label, val) => `<div class="field"><span>${esc(label)}</span><div class="row" style="gap:6px"><input readonly value="${esc(val)}" style="flex:1"><button class="btn btn-ghost btn-sm" type="button" data-copyval="${esc(val)}">Copy</button></div></div>`;
  const setup = () => `<details style="margin-top:14px"${d.configured ? '' : ' open'}><summary><b>Meta app setup</b> <span class="small muted">(owners, once)</span></summary>
      <ol class="small" style="margin:8px 0 8px 18px">
        <li>In developers.facebook.com make an app (type Business) and add the products Facebook Login and Instagram.</li>
        <li>Under Facebook Login, Settings, paste the redirect address below into Valid OAuth Redirect URIs.</li>
        <li>Under App settings, Basic, paste the privacy, deauthorize and data deletion addresses below. Copy the App ID and App Secret here.</li>
        <li>Ask for Advanced Access on: ${PERMISSIONS.map((p) => esc(p.id)).join(', ')}. Meta needs business verification and app review for that. Until then only people added to the app as admins, developers or testers can connect.</li></ol>
      <div class="form-grid" style="grid-template-columns:1fr;gap:8px">
        ${rowCopy('Valid OAuth Redirect URI', app.redirect)}${rowCopy('Privacy policy URL', app.privacy)}${rowCopy('Deauthorize callback URL', app.deauth)}${rowCopy('Data deletion request URL', app.deletion)}
      </div>
      <form id="mtapp" class="form-grid" style="grid-template-columns:1fr 1fr;margin-top:10px">
        <label class="field"><span>App ID</span><input name="appId" value="${esc(app.appId || '')}" inputmode="numeric" required></label>
        <label class="field"><span>App Secret ${app.hasSecret ? '(saved, leave empty to keep)' : ''}</span><input name="secret" type="password" autocomplete="off" ${app.hasSecret ? '' : 'required'}></label>
        <label class="field"><span>Our Meta Business ID (for the partner option)</span><input name="businessId" value="${esc(app.businessId || '')}" inputmode="numeric"></label>
        <label class="field"><span>Configuration ID (optional, Facebook Login for Business)</span><input name="configId" value="${esc(app.configId || '')}" inputmode="numeric"></label>
        <div class="row end" style="grid-column:1/-1;gap:8px">${app.appName ? `<span class="small muted">Checked with Meta: ${esc(app.appName)}</span>` : ''}<button class="btn btn-primary" type="submit">Save and check with Meta</button></div></form></details>`;

  async function saveApp(e) {
    e.preventDefault();
    const fd = new FormData(e.target); const btn = e.submitter; busy(btn, true, 'Checking');
    try {
      await api('/api/meta/app', { method: 'PUT', body: { appId: fd.get('appId'), secret: fd.get('secret'), businessId: fd.get('businessId'), configId: fd.get('configId') } });
      toast('Saved. Meta accepted the app.'); await refresh();
    } catch (err) { busy(btn, false); toast(err.message, true); }
  }

  function makeLink() {
    const m = modal(`<div class="card-head"><h2>Send connect link</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
      <form id="mtf" class="form-grid" style="grid-template-columns:1fr"><label class="field"><span>Name (only we see it)</span><input name="label" maxlength="80" placeholder="Facebook and Instagram"></label>
      <div class="row end" style="gap:8px"><button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Make the link</button></div></form>`);
    $('#mtf', m.el).addEventListener('submit', async (e) => {
      e.preventDefault(); const btn = e.submitter; busy(btn, true);
      try {
        const r = await api(`/api/clients/${c.id}/meta/link`, { method: 'POST', body: { label: new FormData(e.target).get('label') } });
        const first = String(c.contact_name || '').trim().split(/\s+/)[0];
        const msg = `${first ? `Hi ${first}, ` : 'Hi, '}here is your link to connect ${c.name} to Facebook and Instagram. It takes about two minutes and you sign in yourself: ${r.url}`;
        m.el.innerHTML = `<div class="card-head"><h2>Link ready</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
          <p class="small">Copy it, or copy the message with the link in it. It works for 30 days.</p>
          <div class="field"><span>Link</span><input readonly value="${esc(r.url)}"></div>
          <div class="field"><span>Message</span><textarea readonly rows="6">${esc(msg)}</textarea></div>
          <div class="row end" style="gap:8px"><button class="btn btn-ghost" id="mtcl">Copy link</button><button class="btn btn-primary" id="mtcm">Copy message</button></div>`;
        $('#mtcl', m.el).addEventListener('click', () => copy(r.url, 'Link copied'));
        $('#mtcm', m.el).addEventListener('click', () => copy(msg, 'Message copied'));
        await refresh();
      } catch (err) { busy(btn, false); toast(err.message, true); }
    });
  }

  try { await load(); } catch (e) { host.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  paint();
}
