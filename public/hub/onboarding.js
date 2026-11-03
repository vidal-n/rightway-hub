// Onboarding and day-one fulfillment screens: the team's Onboarding tab and the client's "Get started" page.
import { $, $$, esc, api, toast, busy, fmt, PLAN_NAMES } from './core.js';
import { miniGrid } from './prep.js';
import { rankText } from '/js/leadintel.js';

const AGENCY_EMAIL = 'hello@rightwaygrowth.com';
const ACCESS = [
  ['gbp_access', 'Google Business Profile', `On your phone or computer, search your business name on Google (or open business.google.com). Open Business Profile settings, then People and access, then Add. Enter ${AGENCY_EMAIL}, choose Manager, and tap Invite.`],
  ['website_access', 'Website', `Add ${AGENCY_EMAIL} as an admin or editor. WordPress: Users, Add New. Wix: Settings, Roles and Permissions, Invite. Squarespace: Settings, Permissions, Invite. GoDaddy: Settings, Delegate access. Not sure? Tell us who built it.`],
  ['analytics_access', 'Google Analytics and Search Console', `Analytics: Admin, Property access management, the plus button, add ${AGENCY_EMAIL} as Editor. Search Console: Settings, Users and permissions, Add user, Full.`],
  ['facebook_access', 'Facebook and Instagram', 'Facebook Page settings, Page access (or Business settings, Pages), add Rightway Growth with task access for content and messages.'],
];
const FIELDS = [
  ['public_name', 'Business name as customers see it'], ['phone', 'Main business phone'], ['email', 'Email for customer messages'], ['address', 'Address (leave blank if you go to customers)'],
  ['service_area', 'Service area (cities, counties, or miles from you)'], ['hours', 'Hours'], ['top_services', 'Your 3 most profitable services'], ['services', 'Every service you offer (one per line)', 'ta'],
  ['cities', 'Cities you want more customers from (one per line)', 'ta'], ['description', 'What makes you different? (we use this in your profile and pages)', 'ta'],
  ['avg_job', 'Average job value'], ['capacity', 'How many more jobs a week can you handle?'], ['competitors', 'Competitors you watch'], ['review_contact', 'Who on your team asks for reviews?'],
  ['brand_colors', 'Brand colors (if any)'], ['notes', 'Anything else we should know', 'ta'],
];

export function intakeForm(el, c, intake, { onSaved } = {}) {
  el.innerHTML = `<form id="intk" class="form-grid">
      ${FIELDS.map(([k, n, t]) => `<label class="field${t === 'ta' ? ' span-all' : ''}"><span>${n}</span>${t === 'ta' ? `<textarea name="${k}" rows="3">${esc(intake[k] || '')}</textarea>` : `<input name="${k}" value="${esc(intake[k] || '')}">`}</label>`).join('')}
      <div class="span-all"><h3 style="margin-top:8px">Give us access</h3><p class="small">Each one takes about a minute. You stay the owner of everything.</p>
        <div class="access">${ACCESS.map(([k, n, how]) => `<label class="access-item"><input type="checkbox" name="${k}"${intake[k] ? ' checked' : ''}><span><b>${n}</b><span class="small">${esc(how)}</span></span></label>`).join('')}</div></div>
      <div class="span-all row end"><button class="btn btn-primary btn-xl" type="submit" style="width:auto">Save</button></div>
    </form>`;
  $('#intk', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = Object.fromEntries(FIELDS.map(([k]) => [k, f.get(k) || '']));
    for (const [k] of ACCESS) body[k] = f.get(k) === 'on';
    const btn = e.target.querySelector('button[type=submit]');
    busy(btn, true);
    try { const r = await api(`/api/clients/${c.id}/intake`, { method: 'PUT', body }); toast('Saved. Thank you!'); onSaved?.(r.intake); } catch (err) { toast(err.message, true); } finally { busy(btn, false); }
  });
}

export function uploader(el, clientId, { onDone, staff = false } = {}) {
  el.innerHTML = `<div class="row"><label class="btn btn-ghost">Upload photos<input type="file" accept="image/*" multiple hidden data-kind="photo"></label>
    <label class="btn btn-ghost">Upload logo<input type="file" accept="image/*,.svg" hidden data-kind="logo"></label>
    ${staff ? '<label class="btn btn-ghost">Upload a PDF<input type="file" accept="application/pdf" hidden data-kind="doc"></label>' : ''}<span class="small" id="upst"></span></div>`;
  $$('input[type=file]', el).forEach((inp) => inp.addEventListener('change', async () => {
    if (!inp.files.length) return;
    const fd = new FormData();
    fd.append('kind', inp.dataset.kind);
    [...inp.files].slice(0, 20).forEach((f) => fd.append('file', f));
    $('#upst', el).textContent = `Uploading ${inp.files.length}...`;
    try { const r = await api(`/api/clients/${clientId}/assets`, { method: 'POST', form: fd }); toast(`${r.ids.length} uploaded`); onDone?.(); } catch (err) { toast(err.message, true); } finally { $('#upst', el).textContent = ''; inp.value = ''; }
  }));
}

const gallery = (assets, staff) => (assets.length ? `<div class="gallery">${assets.map((a) => `<figure data-asset="${esc(a.id)}">${/^image\//.test(a.media_type) && !/svg/.test(a.media_type) ? `<img src="/api/assets/${esc(a.id)}" alt="${esc(a.name || a.kind)}" loading="lazy">` : `<a class="file" href="/api/assets/${esc(a.id)}?download=1">${esc(a.name || 'File')}</a>`}
  <figcaption>${esc(a.kind)}${staff ? ` <a href="/api/assets/${esc(a.id)}?download=1">Download</a> <button class="linkbtn" data-del="${esc(a.id)}">Delete</button>` : ''}</figcaption></figure>`).join('')}</div>` : '<p class="muted">Nothing uploaded yet.</p>');

const CIT_STATES = [['', 'Not checked'], ['ok', 'Listed, correct'], ['fixed', 'Fixed'], ['created', 'Created'], ['wrong', 'Wrong info'], ['na', 'Not needed']];

export async function onboardingTab(el, c) {
  el.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/onboarding`); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const b = d.baseline, now = d.latest, cmp = d.compare;
  const setupDone = d.setup.filter((t) => t.status === 'done').length;
  const gbpDone = d.gbp.filter((i) => i.done).length;
  const citDone = d.citations.filter((i) => ['ok', 'fixed', 'created', 'na'].includes(i.status)).length;
  const reload = () => onboardingTab(el, c);
  el.innerHTML = `
    <div class="stats">
      <div class="stat hero"><div class="stat-num">${setupDone}/${d.setup.length || 0}</div><div class="stat-label">setup tasks done</div></div>
      <div class="stat"><div class="stat-num">${gbpDone}/${d.gbp.length}</div><div class="stat-label">Google profile checklist</div></div>
      <div class="stat"><div class="stat-num">${citDone}/${d.citations.length}</div><div class="stat-label">citations checked</div></div>
      <div class="stat"><div class="stat-num">${d.intakeAt ? 'Done' : 'Waiting'}</div><div class="stat-label">client details form</div></div>
    </div>
    <div class="card"><div class="card-head"><h2>Baseline and progress</h2><button class="btn btn-ghost btn-sm" id="obres">${b ? 'Run progress check' : 'Run baseline audit'}</button></div>
      ${!b ? '<p class="muted">No baseline yet. Run it now so every report has a "before". It reads the Google profile, checks rank at 9 points, the website, and speed.</p>' : `
      <div class="split" style="grid-template-columns:minmax(0,1fr) auto;align-items:start">
        <div><p class="small">Baseline from ${esc(fmt.date(b.at))}${now ? `, latest check ${esc(fmt.date(now.at))}` : ''}. Keyword: "${esc(b.keyword || '')}"</p>
          ${cmp ? `<div class="table-wrap"><table><thead><tr><th></th><th>Before</th><th>Now</th><th>Change</th></tr></thead><tbody>
            <tr><td>Rank at their address</td><td>${esc(rankText(cmp.rank.before))}</td><td>${esc(rankText(cmp.rank.after))}</td><td>${cmp.rank.better ? '<span class="badge">Better</span>' : ''}</td></tr>
            ${cmp.top10 ? `<tr><td>First page spots in the grid (top 10)</td><td>${cmp.top10.before ?? '-'}</td><td>${cmp.top10.after ?? '-'}</td><td>${cmp.top10.change != null ? `${cmp.top10.change > 0 ? '+' : ''}${cmp.top10.change}` : ''}</td></tr>` : ''}
            <tr><td>Top 3 spots in the grid</td><td>${cmp.top3.before ?? '-'}</td><td>${cmp.top3.after ?? '-'}</td><td>${cmp.top3.change != null ? `${cmp.top3.change > 0 ? '+' : ''}${cmp.top3.change}` : ''}</td></tr>
            <tr><td>Google reviews</td><td>${cmp.reviews.before ?? '-'}</td><td>${cmp.reviews.after ?? '-'}</td><td>${cmp.reviews.change != null ? `${cmp.reviews.change > 0 ? '+' : ''}${cmp.reviews.change}` : ''}</td></tr>
            <tr><td>Rating</td><td>${cmp.rating.before ?? '-'}</td><td>${cmp.rating.after ?? '-'}</td><td></td></tr>
            <tr><td>Mobile speed</td><td>${cmp.speed.before ?? '-'}</td><td>${cmp.speed.after ?? '-'}</td><td>${cmp.speed.change != null ? `${cmp.speed.change > 0 ? '+' : ''}${cmp.speed.change}` : ''}</td></tr>
            <tr><td>Problems found</td><td>${cmp.problems.before}</td><td>${cmp.problems.after}</td><td></td></tr></tbody></table></div>`
            : `<p>Rank ${esc(rankText(b.rank))} · first page in ${b.grid ? (b.grid.top10 ?? (b.grid.cells || []).filter((x) => x.rank != null && x.rank <= 10).length) : '-'} of ${b.grid?.points ?? '-'} spots · ${b.listing?.reviews ?? '-'} reviews · speed ${b.speed?.score ?? '-'}</p>`}
          ${d.problems.length ? `<h3 style="margin-top:14px">Fix list from the baseline</h3><ul class="probs">${d.problems.map((p) => `<li class="prob sev-${p.severity}"><div class="item-title">${esc(p.title)}</div><div class="small">${esc(p.fix)}</div></li>`).join('')}</ul>` : ''}</div>
        <div>${miniGrid((now || b).grid)}</div></div>`}
    </div>
    <div class="card"><div class="card-head"><h2>Reviews target</h2></div><p style="font-size:18px">${esc(d.reviews.text)}</p></div>
    <div class="split" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
      <div class="card"><div class="card-head"><h2>Google profile checklist</h2></div>
        <ul class="list">${d.gbp.map((i) => `<li class="item${i.done ? ' is-done' : ''}"><button class="check${i.done ? ' on' : ''}" data-gbp="${esc(i.key)}" aria-label="Done">✓</button><div><div class="item-title">${esc(i.label)}</div>${i.state === false ? '<div class="small" style="color:var(--bad)">Research says this needs work</div>' : i.state === true ? '<div class="small">Research says this looks fine</div>' : ''}</div><span></span></li>`).join('')}</ul></div>
      <div class="card"><div class="card-head"><h2>First 90 days</h2></div>
        ${d.plan90.months.map((m) => `<h3>${esc(m.title)}</h3><ul class="plain">${m.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}
        ${d.plan90.fixes.length ? `<h3>Their fixes, in order</h3><ul class="plain">${d.plan90.fixes.map((f) => `<li><b>Week ${f.week}:</b> ${esc(f.title)}. ${esc(f.fix)}</li>`).join('')}</ul>` : ''}</div>
    </div>
    <div class="card"><div class="card-head"><h2>Citations</h2><span class="small">Name, address, and phone must match the Google profile exactly.</span></div>
      <p class="small">Start with Core, then the data aggregators (they push your details to hundreds of smaller sites), then the industry sites. "Certified" sites only list businesses that hold that membership or certification, so ask the client first.${c.address ? '' : ' For service area businesses, skip sites marked "Address must show".'}</p>
      <div class="table-wrap"><table class="cit-table"><thead><tr><th>Site</th><th>Type</th><th>Cost</th><th>Why it matters</th><th>Check</th><th>Status</th></tr></thead><tbody>
      ${d.citations.map((i) => `<tr><td><a href="${esc(i.url)}" target="_blank" rel="noopener"><b>${esc(i.name)}</b></a>${i.sab === false ? '<div class="small">Address must show</div>' : ''}</td><td><span class="badge ${i.group === 'Core' ? '' : 'gray'}">${esc(i.group)}</span></td>
        <td class="small">${esc(i.cost || '')}</td><td class="small">${esc(i.why)}</td><td>${i.check ? `<a class="btn btn-ghost btn-sm" href="${esc(i.check)}" target="_blank" rel="noopener">Look up</a>` : '<span class="small">-</span>'}</td>
        <td><select data-cit="${esc(i.name)}">${CIT_STATES.map(([k, n]) => `<option value="${k}"${(i.status || '') === k ? ' selected' : ''}>${n}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><div class="card-head"><h2>Logo and photos</h2></div><div id="obup"></div><div id="obgal" style="margin-top:14px">${gallery(d.assets, true)}</div></div>
    <div class="card"><div class="card-head"><h2>Client details</h2>${d.intakeAt ? `<span class="badge">Filled ${esc(fmt.ago(d.intakeAt))}</span>` : '<span class="badge warn">Not filled yet</span>'}</div>
      <p class="small">The client fills this in their app under Get started. You can fill or fix it here during the kickoff call.</p><div id="obintake"></div></div>`;
  $('#obres', el).addEventListener('click', async (e) => {
    busy(e.target, true, 'Running...');
    try { const r = await api(`/api/clients/${c.id}/research`, { method: 'POST' }); toast(r.baseline ? 'Baseline saved' : 'Progress check saved'); reload(); } catch (err) { toast(err.message, true); busy(e.target, false); }
  });
  $$('[data-gbp]', el).forEach((btn) => btn.addEventListener('click', async () => {
    const on = !btn.classList.contains('on');
    btn.classList.toggle('on', on); btn.closest('.item').classList.toggle('is-done', on);
    try { await api(`/api/clients/${c.id}/onboarding/mark`, { method: 'PUT', body: { key: `gbp:${btn.dataset.gbp}`, value: on } }); } catch (err) { toast(err.message, true); }
  }));
  $$('[data-cit]', el).forEach((s) => s.addEventListener('change', async () => {
    try { await api(`/api/clients/${c.id}/onboarding/mark`, { method: 'PUT', body: { key: `cit:${s.dataset.cit}`, value: s.value } }); toast('Saved'); } catch (err) { toast(err.message, true); }
  }));
  uploader($('#obup', el), c.id, { staff: true, onDone: reload });
  $$('[data-del]', el).forEach((x) => x.addEventListener('click', async () => { if (!confirm('Delete this file?')) return; try { await api(`/api/assets/${x.dataset.del}`, { method: 'DELETE' }); reload(); } catch (err) { toast(err.message, true); } }));
  intakeForm($('#obintake', el), c, d.intake, { onSaved: reload });
}

// Client app: Get started page.
export async function clientStart(v, c) {
  v.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/onboarding`); } catch (e) { v.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const reload = () => clientStart(v, c);
  v.innerHTML = `
    <div class="card"><h2>Welcome to Rightway Growth</h2><p>Three quick things and we can start on your ${esc(PLAN_NAMES[c.plan] || '')} plan. Your kickoff call covers anything you skip.</p>
      <ol class="plain"><li>Tell us about your business below</li><li>Give us Manager access to your Google profile</li><li>Upload your logo and your best job photos</li></ol></div>
    <div class="card"><h2>Logo and photos</h2><p class="small">Real photos of your work, team, trucks, and storefront help you rank and get calls. Upload as many as you like.</p><div id="csup"></div><div style="margin-top:12px">${gallery(d.assets, false)}</div></div>
    <div class="card"><h2>About your business</h2><div id="csform"></div></div>`;
  uploader($('#csup', v), c.id, { onDone: reload });
  intakeForm($('#csform', v), c, d.intake, { onSaved: () => { location.hash = '#/'; } });
}
