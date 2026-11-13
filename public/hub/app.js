// Rightway Hub: one app for the team and for clients. Routes by role.
import './crash.js';
import './appfeel.js';
import { $, esc, api, toast, busy, VIEW } from './core.js';
import { can } from '/js/jobs.js';
import { playIntro } from './intro.js';
import { dashboard, clientPage, teamPage } from './staff.js';
import { portal } from './portal.js';
import { pipelinePage, dialerPage, settingsPage } from './crm.js';
import { dialOutPage } from './dialout.js';
import { initPhone } from './phone.js';
import { recordingsPage, liveCallsPage, phoneSetupPage } from './calltools.js';
import { paymentsPage } from './payments.js';
import { googlePage } from './googleapps.js';
import { inboxPage } from './texts.js';
import { homePage, clientViewPage } from './home.js';

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
  const parts = location.hash.replace(/^#\/?/, '').replace(/\?.*$/, '').split('/').filter(Boolean);
  if (parts[0] === 'invite' && parts[1]) return inviteView(parts[1]);
  if (!state.users) return setupView();
  if (!state.user) return loginView();
  const u = state.user;
  if (parts[0] !== 'present') document.body.classList.remove('presenting');
  if (u.role === 'client') {
    if (u.viewAs) previewBar(u);
    return portal(app, u, parts[0] || 'home', { ...state, sub: parts[1] });
  }
  initPhone();
  if (parts[0] === 'present' && parts[2] && can(u, 'close')) return import('./presentmode.js').then((m) => m.presentView(app, u, parts[1] === 'client' ? 'client' : 'lead', decodeURIComponent(parts[2]), parts[3] || ''));
  // Phone holds the dialer, texts, calls and voicemail. Old #/dialer and #/inbox links still work.
  if (parts[0] === 'phone' || parts[0] === 'dialer' || parts[0] === 'inbox') {
    const sub = parts[0] === 'inbox' ? (parts[1] === 'calls' ? 'calls' : 'texts') : parts[1] || '';
    if (sub === 'out') return dialOutPage(app, u);
    if (sub === 'recordings') return recordingsPage(app, u);
    if (sub === 'live') { location.replace('#/phone/agents'); return; }
    if (sub === 'agents') return import('./agents.js').then((m) => m.agentsPage(app, u, '', true));
    if (sub === 'setup') return phoneSetupPage(app, u);
    if (sub === 'line') return import('./lines.js').then((m) => m.linesPage(app, u));
    if (sub === 'meet') return import('./meet.js').then((m) => m.meetPage(app, u));
    if (sub === 'texts') return import('./phonehub.js').then((m) => m.textsPage(app, u, parts[0] === 'phone' ? decodeURIComponent(parts[2] || '') : ''));
    if (sub === 'history' || sub === 'calls' || sub === 'voicemail') return import('./phonehub.js').then((m) => m.historyPage(app, u, sub === 'voicemail' ? 'voicemail' : (parts[0] === 'phone' && sub === 'history' ? parts[2] : '') || 'all'));
    return dialerPage(app, u);
  }
  // Owner areas: agents are sent back to their dashboard (the server refuses these for them too).
  const ownerOnly = ['automations', 'vault', 'payments', 'finder'].includes(parts[0]) || (parts[0] === 'settings' && ['team', 'files', 'budget', 'bugs'].includes(parts[1])) || parts[0] === 'team';
  if (ownerOnly && u.role !== 'admin') { location.replace('#/'); return; }
  // Jobs: Clients and My work are for closers and owners (setters and schedulers work the phones and the calendar).
  if (['work', 'clients', 'client', 'clientview'].includes(parts[0]) && !can(u, 'deliver') && !(parts[0] === 'work' && parts[1] === 'schedule')) { location.replace('#/'); return; }
  if (parts[0] === 'conversations') return import('./convo.js').then((m) => m.conversationsPage(app, u, parts[1] || ''));
  if (parts[0] === 'finder') return import('./finder.js').then((m) => m.finderPage(app, u, parts[1] || ''));
  if (parts[0] === 'automations' && parts[1] === 'workflows') return import('./workflows.js').then((m) => m.workflowsPage(app, u, decodeURIComponent(parts[2] || '')));
  if (parts[0] === 'automations') return import('./automations.js').then((m) => m.automationsPage(app, u));
  if (parts[0] === 'calendar') return import('./apptcal.js').then((m) => m.apptCalendarPage(app, u, parts[1] || ''));
  if (parts[0] === 'vault') return import('./vault.js').then((m) => m.vaultPage(app, u));
  if (parts[0] === 'agents') return import('./agents.js').then((m) => m.agentsPage(app, u, parts[1] || ''));
  if (parts[0] === 'training') return import('./training.js').then((m) => m.trainingPage(app, u, parts[1] || '', parts[2] || ''));
  if (parts[0] === 'pipeline' && parts[1] === 'database') return import('./leaddb.js').then((m) => m.databasePage(app, u, parts[2] || ''));
  if (parts[0] === 'pipeline' && parts[1] === 'suppression') return import('./suppress.js').then((m) => m.suppressPage(app, u));
  if (parts[0] === 'pipeline' && parts[1] === 'insights') return import('./leadinsights.js').then((m) => m.insightsPage(app, u));
  if (parts[0] === 'pipeline' && parts[1] === 'stage' && parts[2]) return pipelinePage(app, u, null, { kind: 'stage', key: decodeURIComponent(parts[2]) });
  if (parts[0] === 'pipeline' && parts[1] === 'group' && parts[2] && parts[3] != null) return pipelinePage(app, u, null, { kind: 'group', field: decodeURIComponent(parts[2]), value: decodeURIComponent(parts[3]) });
  if (parts[0] === 'pipeline') return pipelinePage(app, u, parts[1]);
  if (parts[0] === 'team' || (parts[0] === 'settings' && parts[1] === 'team')) return teamPage(app, u);
  if (parts[0] === 'slack') return import('./slackapp.js').then((m) => m.slackPage(app, u, parts[1] || '', parts[2] || '', parts[3] || ''));
  if (parts[0] === 'work') return import('./work.js').then((m) => m.workPage(app, u, parts[1] || '', parts[2] || ''));
  if (parts[0] === 'alerts' || parts[0] === 'notifications') return import('./alerts.js').then((m) => m.alertsPage(app, u));
  if (parts[0] === 'payments') return paymentsPage(app, u);
  if (parts[0] === 'mail') return import('./gstate.js').then((g) => g.hasGoogle('mail')).then((gm) => (gm ? import('./mail.js').then((m) => m.mailPage(app, u, parts[1] || '', parts[2] || '')) : import('./hubmail.js').then((m) => m.mailPage(app, u))));
  if (parts[0] === 'files') { location.replace(`#/settings/files${parts[1] ? `/${parts[1]}` : ''}`); return; }
  if (parts[0] === 'google' && parts[1] === 'drive') return import('./gdrive.js').then((m) => m.drivePage(app, u, parts[2] || ''));
  if (parts[0] === 'google' && parts[1] === 'calendar') return import('./gcal.js').then((m) => m.calendarPage(app, u, parts[2] || ''));
  if (parts[0] === 'google' && parts[1] === 'mail') return import('./mail.js').then((m) => m.mailPage(app, u, parts[2] || '', parts[3] || ''));
  if (parts[0] === 'google') return googlePage(app, u);
  if (parts[0] === 'settings' && parts[1] === 'files') return import('./files.js').then((m) => m.filesPage(app, u, parts[2] || ''));
  if (parts[0] === 'settings' && parts[1] === 'budget') return import('./budget.js').then((m) => m.budgetPage(app, u));
  if (parts[0] === 'settings' && parts[1] === 'bugs') return import('./bugs.js').then((m) => m.bugsPage(app, u));
  if (parts[0] === 'settings') return settingsPage(app, u);
  if (parts[0] === 'client' && parts[1]) return clientPage(app, u, parts[1], parts[2] || 'overview', { ...state, sub: parts[3] });
  if (parts[0] === 'clients' && parts[1] === 'view') return clientViewPage(app, u, parts[2]);
  if (parts[0] === 'clients') return dashboard(app, u);
  if (parts[0] === 'clientview') return clientViewPage(app, u, parts[1]);
  return homePage(app, u);
}

// Client view: /?as=<clientId> loads the client app as that client sees it (team login required, read only).
const viewAs = new URLSearchParams(location.search).get('as');
if (viewAs) VIEW.as = viewAs;

function previewBar(u) {
  if (document.getElementById('cv-bar')) return;
  const inFrame = window.top !== window;
  if (inFrame) return; // the Client view page already says it is a preview
  const bar = document.createElement('div');
  bar.id = 'cv-bar';
  bar.className = 'cv-bar';
  bar.innerHTML = `<span>${inFrame ? 'Client view' : 'Client view, read only'}</span>${inFrame ? '' : `<a href="/#/clients/view/${esc(u.client_id)}">Back to the Hub</a>`}`;
  document.body.appendChild(bar);
}

async function boot() {
  try {
    const s = await api('/api/auth/state');
    if (s.user?.viewAs) {
      // Greet with the client's contact name, like their own login would.
      try { const { client } = await api(`/api/clients/${s.user.client_id}`); s.user.name = client.contact_name || client.name; } catch { /* keep */ }
    }
    Object.assign(state, s);
    if (s.user && !s.user.viewAs && !new URLSearchParams(location.search).has('as')) playIntro();
  } catch (e) {
    if (e.status === 503) return notConnected(e.message);
    return notConnected('Could not reach the Hub. Check your connection and reload.');
  }
  if (state.maintenance?.on && state.user && state.user.role !== 'admin') {
    return authCard(`<h1 style="font-size:28px">Quick maintenance</h1><p class="muted">${esc(state.maintenance.msg || 'The Hub is being updated. It will be back shortly.')}</p><button class="btn btn-ghost" onclick="location.reload()">Try again</button>`);
  }
  try { route(); } catch (e) { notConnected(`Something broke while opening this page: ${e.message}. Reload, or send this message to Claude.`); }
}

window.addEventListener('hashchange', () => (state.user || location.hash.startsWith('#/invite') ? route() : boot()));
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // A new version used to need two launches: the new service worker installs while the old files are on screen. When it takes over, reload once,
  // unless a call, a window or a field is in use (then the next launch picks it up).
  const hadWorker = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadWorker) return;
    try { if (sessionStorage.getItem('rw-sw-reload')) return; } catch {}
    if (document.querySelector('.callbar, .pd, .modal-bg') || document.activeElement?.matches?.('input, textarea, select, [contenteditable]')) return;
    try { sessionStorage.setItem('rw-sw-reload', '1'); } catch {}
    location.reload();
  });
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
boot();
