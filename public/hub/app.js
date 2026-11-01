// Rightway Hub: one app for the team and for clients. Routes by role.
import { $, esc, api, toast, busy } from './core.js';
import { dashboard, clientPage, teamPage } from './staff.js';
import { portal } from './portal.js';

const app = $('#app');
const state = { user: null, users: true, ai: false, email: false };

function logos() {
  return '<img class="logo-light" src="/brand/rightway-logo-light.svg" alt="Rightway Growth" width="185" height="30"><img class="logo-dark" src="/brand/rightway-logo-dark.svg" alt="Rightway Growth" width="185" height="30">';
}

function authCard(inner) {
  app.innerHTML = `<div class="auth"><div class="auth-card">${logos()}${inner}</div></div>`;
}

function loginView() {
  authCard(`
    <div><h1 style="font-size:30px">Log in</h1><p class="muted" style="margin:0">Rightway Hub for clients and the Rightway team.</p></div>
    <form id="lf" class="form-grid" style="grid-template-columns:1fr">
      <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
      <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn btn-primary btn-xl" type="submit">Log in</button>
      <p class="err-text" id="lerr" role="alert"></p>
    </form>
    <p class="small">Forgot your password? Ask the Rightway team for a new login link.</p>`);
  $('#lf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    busy(btn, true);
    try {
      await api('/api/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target).entries()) });
      location.hash = '#/';
      boot();
    } catch (err) { $('#lerr').textContent = err.message; busy(btn, false); }
  });
}

function setupView() {
  authCard(`
    <div><h1 style="font-size:30px">Set up Rightway Hub</h1><p class="muted" style="margin:0">Create the owner login. You need the ACCESS_KEY from Cloudflare to prove it's you.</p></div>
    <form id="sf" class="form-grid" style="grid-template-columns:1fr">
      <label class="field"><span>Access key</span><input name="accessKey" type="password" required></label>
      <label class="field"><span>Your name</span><input name="name" autocomplete="name" required></label>
      <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
      <label class="field"><span>New password (10+ characters)</span><input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
      <button class="btn btn-primary btn-xl" type="submit">Create owner login</button>
      <p class="err-text" id="serr" role="alert"></p>
    </form>`);
  $('#sf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    busy(btn, true);
    try {
      await api('/api/auth/setup', { method: 'POST', body: Object.fromEntries(new FormData(e.target).entries()) });
      toast('Welcome to Rightway Hub');
      location.hash = '#/';
      boot();
    } catch (err) { $('#serr').textContent = err.message; busy(btn, false); }
  });
}

async function inviteView(token) {
  let info;
  try { info = await api(`/api/auth/invite/${encodeURIComponent(token)}`); } catch (e) {
    authCard(`<h1 style="font-size:28px">Link expired</h1><p class="muted">${esc(e.message)}</p><a class="btn btn-primary" href="#/login">Go to log in</a>`);
    return;
  }
  authCard(`
    <div><h1 style="font-size:30px">Welcome${info.name ? `, ${esc(info.name.split(' ')[0])}` : ''}</h1><p class="muted" style="margin:0">Set a password for ${esc(info.email)}.</p></div>
    <form id="if" class="form-grid" style="grid-template-columns:1fr">
      <label class="field"><span>New password (10+ characters)</span><input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
      <label class="field"><span>Type it again</span><input name="again" type="password" autocomplete="new-password" minlength="10" required></label>
      <button class="btn btn-primary btn-xl" type="submit">Save and continue</button>
      <p class="err-text" id="ierr" role="alert"></p>
    </form>`);
  $('#if').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.password.value !== f.again.value) { $('#ierr').textContent = "Those passwords don't match."; return; }
    const btn = f.querySelector('button');
    busy(btn, true);
    try {
      await api('/api/auth/invite/accept', { method: 'POST', body: { token, password: f.password.value } });
      location.hash = '#/';
      boot();
    } catch (err) { $('#ierr').textContent = err.message; busy(btn, false); }
  });
}

function notConnected(msg) {
  authCard(`<h1 style="font-size:28px">Almost ready</h1><p class="muted">${esc(msg)}</p><a class="btn btn-ghost" href="/scan.html">Open the scan tool</a>`);
}

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'invite' && parts[1]) return inviteView(parts[1]);
  if (!state.users) return setupView();
  if (!state.user) return loginView();
  const u = state.user;
  if (u.role === 'client') return portal(app, u, parts[0] || 'home', state);
  if (parts[0] === 'team') return teamPage(app, u);
  if (parts[0] === 'client' && parts[1]) return clientPage(app, u, parts[1], parts[2] || 'overview', state);
  return dashboard(app, u);
}

async function boot() {
  try {
    const s = await api('/api/auth/state');
    Object.assign(state, s);
  } catch (e) {
    if (e.status === 503) return notConnected(e.message);
    return notConnected('Could not reach the Hub. Check your connection and reload.');
  }
  route();
}

window.addEventListener('hashchange', () => (state.user || location.hash.startsWith('#/invite') ? route() : boot()));
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
