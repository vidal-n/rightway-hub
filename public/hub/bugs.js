// Settings, Bug reports (owners): what broke, for whom and where. Copy one and paste it to Claude to get it fixed.
import { $, $$, esc, api, toast } from './core.js';
import { staffShell, settingsTabs } from './staff.js';

const text = (r) => [`Bug report from the Rightway Hub`, `What: ${r.message}`, `Page: ${r.where_at}`, `Who: ${r.who || 'unknown'} (${r.role || 'no role'})`, `When: ${new Date(r.created_at).toISOString()}${r.count > 1 ? `, happened ${r.count} times` : ''}`, `Browser: ${r.ua}`, r.extra && r.extra !== '{}' ? `Details: ${r.extra}` : '', r.stack ? `Stack:\n${r.stack}` : ''].filter(Boolean).join('\n');

export async function bugsPage(app, user) {
  const view = staffShell(app, user, 'settings');
  const load = async () => {
    let d;
    try { d = await api('/api/crash'); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
    view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Settings</p><h1>Bug reports</h1></div>${d.reports.some((r) => r.status === 'fixed') ? '<button class="btn btn-ghost btn-sm" id="bclear">Clear fixed</button>' : ''}</div>${settingsTabs('bugs', user)}
      <p class="small muted" style="margin:0 0 12px">Whenever the Hub breaks, the person is asked if they want to report it. Reports show here. Press Copy and paste it to Claude to get it fixed. ${d.open} open.</p>
      ${d.reports.length ? d.reports.map((r) => `<div class="card bug${r.status === 'fixed' ? ' is-fixed' : ''}" data-id="${esc(r.id)}">
        <div class="row" style="justify-content:space-between;gap:10px;align-items:flex-start"><div style="min-width:0"><b style="overflow-wrap:anywhere">${esc(r.message)}</b>
          <div class="small muted">${esc(r.where_at || '')} · ${esc(r.who || '')} · ${esc(new Date(r.created_at).toLocaleString())}${r.count > 1 ? ` · ${r.count} times` : ''}</div></div>
          <div class="row" style="gap:6px"><button class="btn btn-primary btn-sm" data-copy>Copy for Claude</button><button class="btn btn-ghost btn-sm" data-fix>${r.status === 'fixed' ? 'Reopen' : 'Mark fixed'}</button></div></div>
        ${r.stack ? `<details style="margin-top:8px"><summary class="small">Details</summary><pre class="bug-pre">${esc(r.stack)}</pre></details>` : ''}</div>`).join('') : '<div class="card empty"><h3>No bug reports</h3><p>Nothing has broken, or nobody has sent a report.</p></div>'}`;
    $$('.bug', view).forEach((el) => {
      const r = d.reports.find((x) => x.id === el.dataset.id);
      $('[data-copy]', el).onclick = () => navigator.clipboard?.writeText(text(r)).then(() => toast('Copied. Paste it to Claude.'), () => toast('Could not copy.', true));
      $('[data-fix]', el).onclick = async () => { await api(`/api/crash/${r.id}`, { method: 'PUT', body: { status: r.status === 'fixed' ? 'new' : 'fixed' } }); load(); };
    });
    $('#bclear', view)?.addEventListener('click', async () => { await api('/api/crash', { method: 'DELETE' }); load(); });
  };
  load();
}
