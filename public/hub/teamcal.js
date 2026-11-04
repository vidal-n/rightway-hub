// Settings card: the shared team calendar on Google. Every appointment booked in the Hub is copied there with who runs it.
import { $, esc, api, toast, busy } from './core.js';

export async function teamCalCard(box, user) {
  box.innerHTML = '<div class="skeleton" style="height:90px"></div>';
  let d;
  try { d = await api('/api/team-cal'); } catch (e) { box.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const admin = user.role === 'admin';
  const again = () => teamCalCard(box, user);
  const head = `<div class="card-head"><h2>Team calendar on Google</h2><span class="badge ${d.master ? '' : 'gray'}">${d.master ? 'On' : 'Off'}</span></div>`;
  if (d.master) {
    const m = d.master;
    box.innerHTML = `${head}
      <p>Every appointment booked in the Hub (dialer, lead page, booking page, and the Hub calendar) is copied to <b>${esc(m.name)}</b> in ${esc(m.owner || 'the owner')}'s Google, titled with who runs it, like "Kiron: Coastal Roof Pros". Everyone sees who has what, and the Hub will not give a closer two calls at once.</p>
      ${m.ownerOk ? `<p class="small muted">${m.pending ? `${m.pending} upcoming appointment${m.pending === 1 ? ' is' : 's are'} still being copied (a few each minute).` : 'Everything upcoming is on it.'}</p>`
        : `<p class="err-text">${esc(m.owner || 'The owner')} needs to sign in to Google again (Google page, Turn on all). Copies are paused until then.</p>`}
      <div class="row" style="gap:6px"><a class="btn btn-ghost btn-sm" href="${esc(m.link)}" target="_blank" rel="noopener">Open in Google Calendar</a>
        <button class="btn btn-ghost btn-sm" type="button" id="tcsync">Sync now</button>
        ${admin ? '<button class="btn btn-ghost btn-sm" type="button" id="tcshare">Share with the team again</button><button class="btn btn-ghost btn-sm" type="button" id="tcoff">Stop copying</button>' : ''}</div>
      <p class="small muted" style="margin:10px 0 0">Teammates get an email from Google to add it (new teammates: press Share again). Owners can change events in it, teammates can see them. Book and move appointments in the Hub so the lead's invite and the copy stay in step.</p>`;
    $('#tcsync', box).addEventListener('click', async (e) => { busy(e.target, true); try { const r = await api('/api/team-cal/sync', { method: 'POST' }); toast(r.synced ? `${r.synced} updated` : 'Already up to date'); again(); } catch (err) { toast(err.message, true); busy(e.target, false); } });
    $('#tcshare', box)?.addEventListener('click', async (e) => {
      busy(e.target, true);
      try { const r = await api('/api/team-cal/share', { method: 'POST' }); const bad = r.shared.filter((x) => !x.ok); toast(bad.length ? `Could not share with ${bad.map((x) => x.email).join(', ')}` : `Shared with ${r.shared.length} teammate${r.shared.length === 1 ? '' : 's'}`, Boolean(bad.length)); } catch (err) { toast(err.message, true); }
      busy(e.target, false);
    });
    $('#tcoff', box)?.addEventListener('click', async () => { if (!confirm('Stop copying appointments to this calendar? The calendar itself stays in Google.')) return; try { await api('/api/team-cal', { method: 'DELETE' }); again(); } catch (err) { toast(err.message, true); } });
    return;
  }
  if (!admin) { box.innerHTML = `${head}<p class="muted">An owner can turn this on here, so every booking lands on one shared Google calendar.</p>`; return; }
  if (!d.canSetUp) {
    box.innerHTML = `${head}<p class="muted">One shared Google calendar with every appointment the team books, titled with who runs it. First connect your Google with full Calendar access: Google page, Turn on all, then come back here.</p><a class="btn btn-primary btn-sm" href="#/google">Open the Google page</a>`;
    return;
  }
  box.innerHTML = `${head}
    <p class="muted">Makes one shared Google calendar in your account and copies every appointment the team books onto it, titled with who runs it. Your teammates get it shared with them, and it shows next to your own calendar in Google.</p>
    <form id="tcnew" class="row" style="gap:8px"><input name="name" value="Rightway Appointments" style="flex:1 1 220px" maxlength="80"><button class="btn btn-primary btn-sm" type="submit">Make the team calendar</button></form>
    ${d.calendars.length ? `<form id="tcpick" class="row" style="gap:8px;margin-top:10px"><select name="id" style="flex:1 1 220px">${d.calendars.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select><button class="btn btn-ghost btn-sm" type="submit">Use this calendar instead</button></form>` : ''}`;
  const go = async (e, body) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    busy(btn, true, 'Setting up...');
    try {
      const r = await api('/api/team-cal', { method: 'POST', body });
      const bad = r.shared.filter((x) => !x.ok);
      toast(`Team calendar ready. Shared with ${r.shared.length - bad.length} teammate${r.shared.length - bad.length === 1 ? '' : 's'}${bad.length ? `, could not share with ${bad.map((x) => x.email).join(', ')}` : ''}.`, Boolean(bad.length));
      again();
    } catch (err) { toast(err.message, true); busy(btn, false); }
  };
  $('#tcnew', box).addEventListener('submit', (e) => go(e, { name: e.target.name.value }));
  $('#tcpick', box)?.addEventListener('submit', (e) => go(e, { id: e.target.id.value }));
}
