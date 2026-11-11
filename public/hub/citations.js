// Citations and links tab: directory check (name, address, phone), the log of listings built and links earned against the
// monthly quota, local link prospects, and a check that live links still point at the client.
import { $, $$, esc, api, toast, modal, busy, fmt } from './core.js';

const AUDIT = { match: ['', 'Matches'], mismatch: ['bad', 'Details differ'], found: ['warn', 'Listed, check details'], missing: ['gray', 'Not listed'], error: ['gray', 'Could not check'] };
const ORDER = { mismatch: 0, missing: 1, found: 2, error: 3, match: 4 };
const STATUS = { prospect: 'Prospect', planned: 'Working on it', submitted: 'Submitted', live: 'Live', lost: 'Lost' };
const STATUS_CLS = { prospect: 'gray', planned: 'warn', submitted: 'warn', live: '', lost: 'bad' };
const TEAM = [['', 'Team status'], ['listed', 'Listed, correct'], ['fixed', 'Fixed'], ['created', 'Created'], ['n/a', 'Not for them']];
const CHECK = { ok: 'Checked, still there', gone: 'Page is gone', 'no-link': 'Link removed', 'no-listing': 'Listing removed', blocked: 'Site blocked our check', unreachable: 'Site did not answer' };
const money = (c) => (c ? `$${(c / 100).toFixed(2)}` : '');

function dirRow(x, i) { const a = x.audit; const [cls, label] = a ? AUDIT[a.status] || ['gray', a.status] : ['gray', x.site ? 'Not checked' : 'Check by hand']; return `<li class="item ci-row">
        <span class="badge ${cls}">${label}</span>
        <div><div class="item-title">${esc(x.name)} <span class="small muted">${esc(x.group)}</span></div>
          <div class="item-sub">${a?.notes?.length ? `<span class="bad-text">${esc(a.notes.join('. '))}.</span> ` : ''}${a?.snippet ? esc(a.snippet) : esc(x.why)}</div>
          <div class="row small" style="gap:10px;margin-top:6px;flex-wrap:wrap">${a?.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">Open listing</a>` : ''}${x.check ? `<a href="${esc(x.check)}" target="_blank" rel="noopener">Look it up</a>` : ''}<a href="${esc(x.url)}" target="_blank" rel="noopener">Claim or sign up</a><span class="muted">${esc(x.cost)}</span></div></div>
        <div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-end">
          <select class="ci-team" data-dir="${esc(x.name)}" aria-label="Team status for ${esc(x.name)}">${TEAM.map(([v, n]) => `<option value="${v}"${(x.team || '') === v ? ' selected' : ''}>${n}</option>`).join('')}</select>
          <button class="btn btn-ghost btn-sm" data-logdir="${i}">Log it</button></div></li>`; }

export async function citationsTab(el, c) {
  el.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/citations`); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const again = () => citationsTab(el, c);
  const counts = d.lastAudit?.counts || {};
  const dirs = [...d.directories].sort((a, b) => (a.audit ? ORDER[a.audit.status] ?? 5 : 6) - (b.audit ? ORDER[b.audit.status] ?? 5 : 6));
  const month = d.log.filter((x) => x.status === 'live' && x.live_at && fmt.month && new Date(x.live_at).toISOString().slice(0, 7) === d.quota.month);
  const pros = d.log.filter((x) => x.status === 'prospect' || (x.status === 'planned' && x.type === 'link'));
  const logged = d.log.filter((x) => !pros.includes(x));
  el.innerHTML = `
    <div class="card"><div class="card-head"><h2>Directory check</h2><button class="btn ${d.lastAudit ? 'btn-ghost' : 'btn-primary'} btn-sm" id="ciaudit">${d.lastAudit ? 'Check again' : 'Check directories'}<span class="cost-hint" data-cost="directory_check"></span></button></div>
      <p class="small muted">Searches Google for their listing on each directory and compares the name, address and phone it shows. About 5 cents a check.${d.demo ? ' DataForSEO is not connected, so results are demo data.' : ''}</p>
      ${d.lastAudit ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin:8px 0 4px">${['mismatch', 'missing', 'found', 'match'].map((k) => (counts[k] ? `<span class="badge ${AUDIT[k][0]}">${counts[k]} ${AUDIT[k][1].toLowerCase()}</span>` : '')).join('')}<span class="small muted">Checked ${esc(fmt.date(d.lastAudit.at))}</span></div>` : ''}
      <ul class="list" style="margin-top:10px">${dirs.map((x, i) => (x.site ? dirRow(x, i) : '')).join('')}</ul>
      ${dirs.some((x) => !x.site) ? `<details style="margin-top:12px"><summary class="small"><b>${dirs.filter((x) => !x.site).length} more to check by hand</b> (Apple, Bing, data aggregators, certifications)</summary>
        <ul class="list" style="margin-top:10px">${dirs.map((x, i) => (x.site ? '' : dirRow(x, i))).join('')}</ul></details>` : ''}</div>

    <div class="card"><div class="card-head"><h2>This month</h2>${d.quota.total ? `<span class="badge ${d.quota.done >= d.quota.total ? '' : 'warn'}">${d.quota.done} of ${d.quota.total} links or citations</span>` : ''}</div>
      ${month.length ? `<ul class="plain small">${month.map((x) => `<li>${x.type === 'link' ? 'Link' : 'Listing'}: ${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>` : esc(x.name)}</li>`).join('')}</ul>` : '<p class="muted">Nothing live yet this month. Each listing or link marked live counts toward the plan.</p>'}</div>

    <div class="card"><div class="card-head"><h2>Citations and links</h2><div class="row" style="gap:8px"><button class="btn btn-ghost btn-sm" id="cicheck">Check links</button><button class="btn btn-primary btn-sm" id="ciadd">Add</button></div></div>
      ${logged.length ? `<div class="table-wrap"><table class="small ci-table"><thead><tr><th>What</th><th>Status</th><th>Cost</th><th>Live since</th><th>Last check</th><th></th></tr></thead><tbody>
        ${logged.map((x) => `<tr data-id="${esc(x.id)}"><td><span class="badge gray">${x.type === 'link' ? 'Link' : 'Listing'}</span> ${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>` : esc(x.name)}${x.kind ? ` <span class="muted">${esc(x.kind)}</span>` : ''}${x.note ? `<div class="muted">${esc(x.note)}</div>` : ''}</td>
          <td><select class="ci-status" aria-label="Status">${Object.entries(STATUS).filter(([k]) => k !== 'prospect').map(([k, n]) => `<option value="${k}"${x.status === k ? ' selected' : ''}>${n}</option>`).join('')}</select></td>
          <td>${money(x.cost)}</td><td>${x.live_at ? esc(fmt.date(x.live_at)) : ''}</td><td>${x.check ? `<span class="${x.check === 'ok' ? '' : 'bad-text'}">${esc(CHECK[x.check] || x.check)}</span>` : ''}</td>
          <td><button class="btn btn-ghost btn-sm" data-del="${esc(x.id)}" aria-label="Remove">Remove</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">Log each listing you build or fix and each link you earn. BrightLocal Citation Builder orders go here too, with the cost.</p>'}</div>

    <div class="card"><div class="card-head"><h2>Link prospects</h2><button class="btn btn-ghost btn-sm" id="cipros">Find prospects<span class="cost-hint" data-cost="link_prospects"></span></button></div>
      <p class="small muted">Local sites that link to businesses: chambers, associations, "best of" lists, sponsorships. About 1 cent a search. Earn these by hand: never pay for links or use automated link building (Google penalizes it).</p>
      ${pros.length ? `<ul class="list" style="margin-top:10px">${pros.map((x) => `<li class="item ci-row" data-id="${esc(x.id)}"><span class="badge ${STATUS_CLS[x.status]}">${esc(x.kind || STATUS[x.status])}</span>
        <div><div class="item-title"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a></div><div class="item-sub">${esc(x.note || '')}</div></div>
        <div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-end">${x.status === 'prospect' ? '<button class="btn btn-ghost btn-sm" data-pro="planned">Working on it</button>' : '<span class="small muted">Working on it</span>'}
          <button class="btn btn-primary btn-sm" data-pro="live">Got the link</button><button class="btn btn-ghost btn-sm" data-pro="skip">Skip</button></div></li>`).join('')}</ul>` : '<p class="muted" style="margin-top:8px">No prospects yet.</p>'}</div>`;

  $('#ciaudit', el).addEventListener('click', async (e) => {
    busy(e.currentTarget, true, 'Checking, about 20 seconds');
    try { const r = await api(`/api/clients/${c.id}/citations/audit`, { method: 'POST' }); toast(`Checked. ${r.counts.mismatch || 0} need fixing, ${r.counts.missing || 0} not listed.`); again(); }
    catch (err) { busy(e.currentTarget, false); toast(err.message, true); }
  });
  $$('.ci-team', el).forEach((s) => s.addEventListener('change', async () => {
    try { await api(`/api/clients/${c.id}/onboarding/mark`, { method: 'PUT', body: { key: `cit:${s.dataset.dir}`, value: s.value } }); toast('Saved'); } catch (err) { toast(err.message, true); }
  }));
  $$('[data-logdir]', el).forEach((b) => b.addEventListener('click', () => {
    const x = dirs[Number(b.dataset.logdir)];
    const team = x.audit?.status === 'mismatch' ? 'fixed' : x.audit?.status === 'missing' || !x.audit ? 'created' : 'listed';
    logModal(c, { type: 'citation', name: x.name, url: x.audit?.url || '', status: x.audit?.status === 'match' ? 'live' : 'submitted', kind: x.group }, async () => {
      if (!x.team) await api(`/api/clients/${c.id}/onboarding/mark`, { method: 'PUT', body: { key: `cit:${x.name}`, value: team } }).catch(() => {});
      again();
    });
  }));
  $('#ciadd', el).addEventListener('click', () => logModal(c, {}, again));
  $('#cicheck', el).addEventListener('click', async (e) => {
    busy(e.currentTarget, true, 'Checking');
    try { const r = await api(`/api/clients/${c.id}/links/check`, { method: 'POST' }); toast(r.checked ? `Checked ${r.checked}. ${r.ok} still there${r.lost ? `, ${r.lost} lost` : ''}.` : 'No live listings or links with an address to check yet.'); again(); }
    catch (err) { busy(e.currentTarget, false); toast(err.message, true); }
  });
  $('#cipros', el).addEventListener('click', async (e) => {
    busy(e.currentTarget, true, 'Searching');
    try { const r = await api(`/api/clients/${c.id}/links/prospects`, { method: 'POST' }); toast(r.added ? `${r.added} new prospect${r.added === 1 ? '' : 's'}` : 'No new sites found'); again(); }
    catch (err) { busy(e.currentTarget, false); toast(err.message, true); }
  });
  $$('.ci-status', el).forEach((s) => s.addEventListener('change', async () => {
    try { const r = await api(`/api/links/${s.closest('tr').dataset.id}`, { method: 'PATCH', body: { status: s.value } }); toast(r.task ? 'Live. Counted toward this month.' : 'Saved'); again(); } catch (err) { toast(err.message, true); }
  }));
  $$('[data-del]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remove this from the log?')) return;
    try { await api(`/api/links/${b.dataset.del}`, { method: 'DELETE' }); again(); } catch (err) { toast(err.message, true); }
  }));
  $$('[data-pro]', el).forEach((b) => b.addEventListener('click', async () => {
    const id = b.closest('[data-id]').dataset.id;
    busy(b, true);
    try {
      if (b.dataset.pro === 'skip') await api(`/api/links/${id}`, { method: 'DELETE' });
      else { const r = await api(`/api/links/${id}`, { method: 'PATCH', body: { status: b.dataset.pro } }); if (r.task) toast('Live. Counted toward this month.'); }
      again();
    } catch (err) { busy(b, false); toast(err.message, true); }
  }));
}

function logModal(c, pre, done) {
  const m = modal(`<h2>Log a listing or link</h2><form id="cif" class="form-grid" style="grid-template-columns:1fr 1fr">
    <label class="field"><span>Type</span><select name="type"><option value="citation"${pre.type !== 'link' ? ' selected' : ''}>Directory listing</option><option value="link"${pre.type === 'link' ? ' selected' : ''}>Link from a website</option></select></label>
    <label class="field"><span>Status</span><select name="status">${Object.entries(STATUS).filter(([k]) => k !== 'prospect').map(([k, n]) => `<option value="${k}"${(pre.status || 'submitted') === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
    <label class="field span-all"><span>Directory or website</span><input name="name" required maxlength="120" value="${esc(pre.name || '')}" placeholder="Manta, Miami Chamber, Little League sponsor page"></label>
    <label class="field span-all"><span>Address of the listing or page</span><input name="url" maxlength="500" value="${esc(pre.url || '')}" placeholder="https://..."></label>
    <label class="field"><span>Kind</span><input name="kind" maxlength="40" value="${esc(pre.kind || '')}" placeholder="Chamber, sponsorship, directory"></label>
    <label class="field"><span>Cost ($)</span><input name="cost" inputmode="decimal" placeholder="3.20"></label>
    <label class="field span-all"><span>Note</span><input name="note" maxlength="1000" placeholder="Ordered through BrightLocal Citation Builder"></label>
    <div class="span-all row end" style="gap:8px"><button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save</button></div></form>`);
  $('#cif', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    busy($('button[type=submit]', f), true);
    try {
      const r = await api(`/api/clients/${c.id}/links`, { method: 'POST', body: Object.fromEntries(new FormData(f)) });
      m.close(); toast(r.task ? 'Saved. Counted toward this month.' : 'Saved'); done();
    } catch (err) { busy($('button[type=submit]', f), false); toast(err.message, true); }
  });
}
