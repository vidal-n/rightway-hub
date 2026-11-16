// Scan tool shell (Nov 2026, V: the scan tool tab does not match the rest of the Hub). Draws the Hub v5 frame around the scan page:
// the ink rail of workspace tiles, the command bar with its workspace colour strip, and the workspace tab strip, from the SAME
// workspace list the Hub uses (public/js/workspaces.js), so a new Hub tab shows up here too. Modeled on the Hub shell (public/hub/shell.js).
import { WORKSPACES, wsTabs, wsList } from '/js/workspaces.js';
import { can } from '/js/jobs.js';
import { icon } from '/hub/core.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// Hub links are hash routes; from this page they live under "/".
const href = (h) => (String(h).startsWith('#') ? `/${h}` : h);
const HERE = 'sell', TAB = '/scan.html';

async function who() {
  try { const r = await fetch('/api/me', { credentials: 'same-origin' }); if (r.ok) { const j = await r.json(); return j.user || j; } } catch { /* key only */ }
  return null;
}

function paint(user) {
  // Without a login (access key only) show every page that does not need an owner or a job.
  const u = user && user.role ? user : { role: 'team', job: 'closer' };
  const list = wsList(u, can);
  const ws = WORKSPACES.find((w) => w[0] === HERE);
  document.documentElement.dataset.ws = HERE;
  const rail = document.getElementById('topnav');
  if (rail) {
    rail.innerHTML = `<div class="sx-railhead"><a class="sx-brand" href="/#/" aria-label="Rightway Growth, home"><img class="sx-full" src="/brand/rightway-logo-dark.svg" alt="Rightway Growth" width="140" height="24"><img class="sx-mark" src="/brand/rightway-mark-light.svg" alt="" width="30" height="30"></a></div>
      <nav aria-label="Main">${list.map(([k, label, ic]) => {
        const tabs = wsTabs(u, k, can);
        const on = k === HERE;
        return `<div class="sx-wsg${k === 'automate' || k === 'settings' ? ' util' : ''}${on ? ' is-open' : ''}" data-wsg="${k}"><a href="${esc(href(tabs[0][1]))}" class="sx-tile${on ? ' is-active' : ''}"${on ? ' aria-current="true"' : ''}>${icon[ic] || ''}<span>${esc(label)}</span></a>
          <div class="sx-wsg-tabs">${tabs.map(([n, h]) => `<a href="${esc(href(h))}" class="${h === TAB ? 'is-active' : ''}">${esc(n)}</a>`).join('')}</div></div>`;
      }).join('')}</nav>`;
  }
  const title = document.getElementById('sx-title');
  if (title && ws) title.innerHTML = `<small>${esc(ws[1])}</small><b>Scan tool</b>`;
  const strip = document.getElementById('sx-tabs');
  if (strip && ws) {
    strip.innerHTML = `<nav class="sx-wstabs" aria-label="${esc(ws[1])} pages">${wsTabs(u, HERE, can).map(([n, h]) => `<a href="${esc(href(h))}" class="${h === TAB ? 'is-active' : ''}"${h === TAB ? ' aria-current="page"' : ''}>${esc(n)}</a>`).join('')}</nav>`;
    strip.querySelector('.is-active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
}

paint(null);            // at once, so the frame never flashes empty
who().then((u) => { if (u) paint(u); });
