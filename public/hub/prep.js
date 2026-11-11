// Call prep: research snapshot, problems with talk tracks, the adaptive script, objections, booking, and presenting.
import { $, $$, esc, api, toast, busy, modal, fmt } from './core.js';
import { parseListings, listingsLine, listingsTable } from '/js/listings.js';
import { markCues } from '/js/scriptprint.js';
import { canRunCalls, can } from '/js/jobs.js';
import { buildScript, findProblems, scoreLead, recommendPlan, industryInfo, rankText, top10Of, quoteFor, scopeOfQuote } from '/js/leadintel.js';
import { effort, hoursOf } from '/js/scope.js';

let customCache = null;
export async function scriptSettings() {
  if (!customCache) customCache = api('/api/settings').then((s) => ({ script: s.script || {}, objections: s.objections || null, number: s.number || '' })).catch(() => ({ script: {}, objections: null, number: '' }));
  return customCache;
}
export function clearScriptCache() { customCache = null; }

export function gradeBadge(grade, score) {
  if (!grade) return '<span class="badge gray" title="Not scored yet">-</span>';
  const cls = grade === 'A' ? 'grade-a' : grade === 'B' ? 'grade-b' : grade === 'C' ? 'grade-c' : grade === 'W' ? 'grade-a' : 'grade-d';
  return `<span class="grade ${cls}" title="Lead score ${score ?? ''}">${esc(grade)}${score != null && grade !== 'W' && grade !== 'X' ? `<small>${score}</small>` : ''}</span>`;
}

export function miniGrid(grid) {
  if (!grid?.cells?.length) return '';
  const size = grid.size || Math.sqrt(grid.cells.length);
  const band = (c) => (c.error ? 'err' : c.rank == null ? 'none' : c.rank <= 3 ? 'top3' : c.rank <= 10 ? 'top10' : 'top20');
  return `<div class="minigrid" style="grid-template-columns:repeat(${size},1fr)">${grid.cells.map((c) => `<span class="mg ${band(c)}" title="${c.rank ? `#${c.rank}` : 'not in top 20'}">${c.error ? '!' : c.rank ?? '20+'}</span>`).join('')}</div>`;
}

function snapshot(lead, intel) {
  if (!intel) return '';
  const L = intel.listing || {};
  const top = intel.competitors?.[0];
  const cells = [
    ['Map rank', intel.found ? rankText(intel.rank) : 'No profile', intel.keyword ? `"${intel.keyword}" at their address` : ''],
    ['First page coverage', intel.grid ? `${top10Of(intel.grid)} of ${intel.grid.points}` : '-', intel.grid ? `${intel.grid.radiusMiles} mile grid, top 3 in ${intel.grid.top3}` : ''],
    ['Reviews', L.reviews != null ? `${L.reviews}${L.rating ? ` · ${L.rating.toFixed(1)}★` : ''}` : '-', top ? `#1 ${top.title}: ${top.reviews ?? '?'}` : ''],
    ['Mobile speed', intel.speed?.score != null ? `${intel.speed.score}/100` : intel.website?.blocked ? 'Blocked' : L.url || lead.website ? '-' : 'No site', intel.website?.platform || ''],
  ];
  return `<div class="snap">${cells.map(([k, v, s]) => `<div><div class="snap-k">${esc(k)}</div><div class="snap-v">${esc(v)}</div><div class="snap-s">${esc(s)}</div></div>`).join('')}</div>`;
}

// Renders the full prep panel into el. Returns nothing; wires its own buttons.
// "Or:" lines are alternatives, "(" lines are coaching notes, everything else is what you say.
function scriptLine(l) {
  if (/^\(SCREEN:/.test(l)) return `<p class="say-screen"><b>Screen</b> ${esc(l.replace(/^\(SCREEN:\s*/, '').replace(/\)$/, ''))}</p>`;
  if (/^\(.*\)$/.test(l)) return `<p class="say-note"><b class="do-tag">Do</b>${esc(l.slice(1, -1))}</p>`;
  if (/^Or:/i.test(l)) return `<p class="say-alt"><span class="badge gray">Or</span> ${markCues(esc(l.replace(/^Or:\s*/i, '')))}</p>`;
  return `<p class="say-line">${markCues(esc(l))}</p>`;
}

// Collapsible section. Open or closed is remembered per section on this device, so the page opens the way the rep left it.
const foldOpen = (key, dflt) => { try { const v = localStorage.getItem(`rw-fold-${key}`); return v === null ? dflt : v === '1'; } catch { return dflt; } };
export const fold = (key, title, body, dflt = true, count = null) => `<details class="fold" data-fold="${esc(key)}"${foldOpen(key, dflt) ? ' open' : ''}><summary><span>${esc(title)}</span>${count != null ? `<b class="fold-n">${count}</b>` : ''}</summary><div class="fold-body">${body}</div></details>`;
export function wireFolds(root) {
  $$('details.fold', root).forEach((d) => d.addEventListener('toggle', () => { try { localStorage.setItem(`rw-fold-${d.dataset.fold}`, d.open ? '1' : '0'); } catch { /* ignore */ } }));
  $$('[data-folds]', root).forEach((b) => b.addEventListener('click', () => $$('details.fold', root).forEach((d) => { d.open = b.dataset.folds === 'open'; })));
}

export async function prepPanel(el, lead, intel, { rep = '', voice = 'I', onResearched, compact = false } = {}) {
  const custom = await scriptSettings();
  const probs = findProblems(intel, lead);
  const sc = scoreLead(lead, intel);
  const rec = recommendPlan(lead, intel);
  const info = industryInfo(lead.industry, intel?.listing?.category || lead.category);
  const Q = quoteFor(lead, intel, lead.quote);
  const E = effort(scopeOfQuote(Q));
  const s = buildScript(lead, intel, { rep, voice }, custom);
  const age = intel?.at ? fmt.ago(intel.at) : null;
  // The dialer opens on the cold call; a booked lead (or the lead page with a meeting) opens on the clarity call.
  const startGroup = lead.stage === 'audit_booked' || (lead.meet_at && lead.meet_at > Date.now() - 3 * 3600e3) ? 'clarity' : 'cold';
  const firstStep = Math.max(0, s.steps.findIndex((x) => x.group === startGroup));
  el.innerHTML = `
    <div class="prep">
      <div class="prep-head">
        ${gradeBadge(sc.grade, sc.score)}
        <div style="min-width:0"><div class="item-title">${intel ? `Scope from the research: ${Q.services.length} services` : 'Scope: research first'} <span class="small">(about ${esc(hoursOf(E.monthly))} h a month to deliver. You set the price.)</span></div>
          <div class="small">${esc(rec.why.join(' · '))}</div></div>
        <div class="row" style="margin-left:auto">
          <button class="btn btn-ghost btn-sm" data-act="research">${intel ? 'Refresh research' : 'Research now'}<span class="cost-hint" data-cost="research_call"></span></button>
          ${can(window.__rwUser, 'close') ? `<a class="btn btn-ghost btn-sm" href="/present.html#${esc(lead.id)}" target="_blank" rel="noopener">Present</a>
          <a class="btn btn-ghost btn-sm" href="/scan.html?lead=${esc(lead.id)}" target="_blank" rel="noopener">Scan tool</a>` : ''}
          <button class="btn btn-ghost btn-sm" data-act="book">Book meeting</button>
          <button class="btn btn-ghost btn-sm" data-act="meetnow" title="Starts a Google Meet now, invites them by email, and opens it beside the Hub">Google Meet now</button>
        </div>
      </div>
      ${!intel ? `<div class="caption" style="margin:12px 0">Not researched yet. Research finds their Google profile, checks where they rank around their address, reads their website, and tests mobile speed. About 4 cents.</div>` : intel.demo ? '<p class="badge warn" style="margin:10px 0 0">Demo data: DataForSEO is not connected</p>' : ''}
      <div class="fold-bar"><button type="button" class="linkbtn" data-folds="open">Open all</button><button type="button" class="linkbtn" data-folds="close">Close all</button></div>
      ${fold('script', 'Script', `<div class="seg script-groups" role="tablist">${s.groups.map((g) => `<button type="button" class="${g.key === startGroup ? 'is-on' : ''}" data-group="${g.key}">${esc(g.name)}</button>`).join('')}</div>
      <label class="row small script-notes-sw" style="gap:8px;margin:8px 0 0"><input type="checkbox" id="scnotes"> Show coaching notes</label>
      <div class="seg script-tabs" role="tablist">${s.steps.map((st, i) => `<button type="button" role="tab" class="${i === firstStep ? 'is-on' : ''}" data-step="${i}" data-g="${st.group}"${st.group === startGroup ? '' : ' hidden'}>${esc(st.title)}</button>`).join('')}</div>
      <div class="script-body hide-notes">${s.steps.map((st, i) => {
        const sib = s.steps.map((x, j) => [x, j]).filter(([x]) => x.group === st.group), at = sib.findIndex(([, j]) => j === i);
        const back = sib[at - 1], next = sib[at + 1];
        return `<div class="script-step" data-body="${i}"${i === firstStep ? '' : ' hidden'}>${st.lines.map(scriptLine).join('')}<div class="script-nav">${back ? `<button type="button" class="btn btn-ghost btn-sm" data-go="${back[1]}">Back</button>` : '<span></span>'}${next ? `<button type="button" class="btn btn-primary btn-sm" data-go="${next[1]}">Next: ${esc(next[0].title)}</button>` : ''}</div></div>`;
      }).join('')}</div>`, true)}
      ${intel ? fold('snapshot', 'Their numbers', `<div class="prep-grid">
        <div>${snapshot(lead, intel)}</div>
        ${intel.grid ? `<div class="prep-map">${miniGrid(intel.grid)}<div class="small" style="text-align:center">Rank around them</div></div>` : ''}
      </div>
      <div class="small" style="margin-top:6px">${esc(info.label)}${intel.listing?.category ? ` · Google category: ${esc(intel.listing.category)}` : ''}${age ? ` · researched ${esc(age)}` : ''}</div>
      ${intel.competitors?.length ? `<div class="comps">${intel.competitors.slice(0, 3).map((c, i) => `<span class="badge gray">#${i + 1} ${esc(c.title)}${c.reviews != null ? ` · ${c.reviews} reviews` : ''}${c.rating ? ` · ${c.rating}★` : ''}</span>`).join('')}</div>` : ''}`, true)
      + fold('problems', 'Problems to pitch', probs.length ? `<ul class="probs">${probs.map((p) => `<li class="prob sev-${p.severity}"><div class="item-title">${esc(p.title)}</div><div class="small">${esc(p.detail)}</div><div class="say">Say: ${esc(p.talk)}</div></li>`).join('')}</ul>` : '<p class="muted" style="margin:0">No major problems found. Pitch protecting their spot and growing into more keywords and areas.</p>', false, probs.length) : ''}
      ${fold('listings', 'Listings Google double checks', '<div class="prep-lst" id="preplst"></div>', false)}
      ${compact ? '' : fold('objections', 'Objections', `<div class="objs">${s.objections.map((o) => `<details class="obj"><summary>${esc(o.q)}</summary><p>${markCues(esc(o.a))}</p></details>`).join('')}</div>
      <details class="obj playbook"><summary>Why the script works (the playbook)</summary><ul>${s.playbook.map((p) => `<li><b>${esc(p.name)}</b> <span class="small">${esc(p.from)}</span><div class="small">${esc(p.use)}</div></li>`).join('')}</ul></details>`, false)}
    </div>`;
  wireFolds(el);
  $$('[data-group]', el).forEach((b) => b.addEventListener('click', () => {
    $$('[data-group]', el).forEach((x) => x.classList.toggle('is-on', x === b));
    const tabs = $$('[data-step]', el);
    tabs.forEach((t) => { t.hidden = t.dataset.g !== b.dataset.group; });
    tabs.find((t) => !t.hidden)?.click();
  }));
  const notes = $('#scnotes', el);
  try { notes.checked = localStorage.getItem('rw-script-notes') === '1'; } catch { /* ignore */ }
  const paintNotes = () => { $('.script-body', el).classList.toggle('hide-notes', !notes.checked); try { localStorage.setItem('rw-script-notes', notes.checked ? '1' : '0'); } catch { /* ignore */ } };
  notes.addEventListener('change', paintNotes); paintNotes();
  $$('[data-go]', el).forEach((b) => b.addEventListener('click', () => { $(`[data-step="${b.dataset.go}"]`, el)?.click(); $('.script-tabs', el)?.scrollIntoView({ block: 'nearest' }); }));
  $$('[data-step]', el).forEach((b) => b.addEventListener('click', () => {
    $$('[data-step]', el).forEach((x) => x.classList.toggle('is-on', x === b));
    $$('[data-body]', el).forEach((x) => { x.hidden = x.dataset.body !== b.dataset.step; });
  }));
  $('[data-act="research"]', el).addEventListener('click', async (e) => {
    busy(e.target, true, 'Researching...');
    try {
      const r = await api(`/api/leads/${lead.id}/research`, { method: 'POST', body: { force: Boolean(intel) } });
      toast(`Research done${r.intel?.cost ? ` ($${r.intel.cost.toFixed(3)})` : ''}`);
      const next = { ...lead, score: r.score ?? lead.score, grade: r.grade ?? lead.grade, plan: lead.plan || r.plan };
      onResearched?.(next, r.intel);
      prepPanel(el, next, r.intel, { rep, voice, onResearched, compact });
    } catch (err) { toast(err.message, true); busy(e.target, false); }
  });
  $('[data-act="book"]', el).addEventListener('click', () => bookModal(lead));
  // Meet will not run inside another site (Google blocks it), so it opens in its own window next to the Hub.
  $('[data-act="meetnow"]', el)?.addEventListener('click', async (e) => {
    const b = e.currentTarget; busy(b, true);
    const win = window.open('about:blank', 'rw-meet', `width=${Math.min(1100, screen.availWidth - 80)},height=${Math.min(760, screen.availHeight - 80)},left=40,top=40`);
    try {
      const r = await api(`/api/leads/${lead.id}/meet-now`, { method: 'POST' });
      if (win) win.location = r.meet; else window.open(r.meet, '_blank');
      try { await navigator.clipboard.writeText(r.meet); } catch { /* ignore */ }
      toast(r.invited ? 'Meet started. Invite emailed, link copied.' : 'Meet started. Link copied: text it to them.');
    } catch (err) { win?.close(); toast(err.message, true); }
    busy(b, false);
  });
  // The real listing check: which directories show wrong info or none at all. The "inconsistencies" in the pitch, for this business.
  const lst = $('#preplst', el);
  const drawLst = (L) => {
    lst.innerHTML = `${L ? `<p class="small" style="margin:0 0 8px">${esc(listingsLine(L))} <span class="muted">Checked ${esc(fmt.ago(L.at))}${L.demo ? ' (demo data)' : ''}.</span></p>${listingsTable(L, { max: 15 })}` : '<p class="small muted" style="margin:0 0 8px">Not checked yet. Searches 15 directories for this business and flags wrong phone numbers, wrong ZIP codes and missing listings. About 3 cents.</p>'}
      <button class="btn btn-ghost btn-sm" data-act="lst" style="margin-top:8px">${L ? 'Check again' : 'Check listings'}<span class="cost-hint" data-cost="listing_check"></span></button>`;
    $('[data-act="lst"]', lst).addEventListener('click', async (e) => {
      busy(e.target, true, 'Checking 15 directories...');
      try { const r = await api(`/api/leads/${lead.id}/listings`, { method: 'POST' }); lead.listings = r; drawLst(r); toast('Listings checked'); }
      catch (err) { toast(err.message, true); busy(e.target, false); }
    });
  };
  drawLst(parseListings(lead.listings));
}

// Book a meeting with a Google Meet link and calendar invite.
export async function bookModal(lead, onDone) {
  let g = null;
  try { g = await api('/api/google/status'); } catch { g = null; }
  const noGoogle = !g?.ready || (!g.connected && !g.booking?.ownerEmail);
  let team = [];
  // Only closers and owners run the call. A setter or scheduler books for the first free closer unless they pick one.
  try { team = ((await api('/api/team')).users || []).filter(canRunCalls); } catch { team = []; }
  const me = window.__rwUser?.id;
  const pickId = lead.closer_id || (canRunCalls(window.__rwUser) ? me : 'auto');
  const d = new Date(Date.now() + 864e5); d.setHours(10, 0, 0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  const m = modal(`<div class="card-head"><h2>Book the Google clarity audit: ${esc(lead.business)}</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    ${noGoogle ? '<p class="muted">Google Calendar is not connected, so this books it in the Hub. Paste a Zoom or Meet link if you have one, then send them the invite text below.</p>' : `<p class="muted">The lead gets a Google invite with a Meet link from the calendar of whoever runs the call (or ${esc(g.email || g.booking.ownerEmail)} if they have not connected Google), and it goes on the team calendar.</p>`}
    <form id="bkf" class="form-grid">
      <label class="field"><span>Date and time (your time)</span><input type="datetime-local" name="start" value="${local}" required></label>
      <label class="field"><span>Who runs the call</span><select name="closer_id"><option value="auto"${pickId === 'auto' ? ' selected' : ''}>First free closer</option>${team.map((u) => `<option value="${esc(u.id)}"${u.id === pickId ? ' selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}</select></label>
      <p class="small span-all" id="bkfree" style="margin:-4px 0 0"></p>
      <label class="field"><span>Length</span><select name="minutes"><option value="20">20 minutes</option><option value="30" selected>30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select></label>
      <label class="field span-all"><span>Their email${noGoogle ? ' (optional)' : ' for the invite'}</span><input type="email" name="email" value="${esc(lead.email || '')}"${noGoogle ? '' : ' required'}></label>
      ${noGoogle ? '<label class="field span-all"><span>Meeting link (optional: Zoom, Meet, or leave blank for a phone call)</span><input name="link" inputmode="url" placeholder="https://"></label>' : ''}
      <label class="field span-all"><span>Note in the invite (optional)</span><input name="note" placeholder="Anything they should have ready"></label>
      <div class="span-all row end"><button class="btn btn-primary" type="submit">${noGoogle ? 'Book it' : 'Book with Google Meet'}</button></div>
    </form><div id="bkout"></div>`);
  // Who is free at that time: busy people are marked, and the chosen person's clash is spelled out before booking.
  const bf = $('#bkf', m.el);
  const checkFree = async () => {
    const t = new Date(bf.start.value).getTime();
    if (!t || !bf.closer_id) return;
    try {
      const r = await api(`/api/closers/free?start=${t}&minutes=${bf.minutes.value}&lead=${encodeURIComponent(lead.id)}`);
      const by = new Map(r.closers.map((c) => [c.id, c]));
      [...bf.closer_id.options].forEach((o) => { const c = by.get(o.value); o.textContent = `${c?.name || o.textContent.replace(/ \(busy\)$/, '')}${c?.clash ? ' (busy)' : ''}`; });
      if (bf.closer_id.value === 'auto') { const free = r.closers.filter((x) => !x.clash); $('#bkfree', m.el).innerHTML = free.length ? `<span class="muted">${free.length} free then. The one with the fewest calls gets it.</span>` : '<span class="err-text">Every closer is busy then. Pick another time.</span>'; return; }
      const c = by.get(bf.closer_id.value);
      $('#bkfree', m.el).innerHTML = c?.clash ? `<span class="err-text">${esc(c.clash)}</span>` : `<span class="muted">${esc((c?.name || 'They').split(' ')[0])} is free then.</span>`;
    } catch { /* booking still works */ }
  };
  ['start', 'closer_id', 'minutes'].forEach((k) => bf[k]?.addEventListener('change', checkFree));
  checkFree();
  $('#bkf', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    const btn = e.target.querySelector('button[type=submit]');
    busy(btn, true, 'Booking...');
    try {
      let r;
      try { r = await api(`/api/leads/${lead.id}/meeting`, { method: 'POST', body: { ...f, start: new Date(f.start).toISOString() } }); }
      catch (err) {
        if (err.status !== 409 || !confirm(`${err.message}\n\nBook it anyway?`)) throw err;
        r = await api(`/api/leads/${lead.id}/meeting`, { method: 'POST', body: { ...f, start: new Date(f.start).toISOString(), force: true } });
      }
      const when = new Date(r.start).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const invite = `Hi ${(lead.contact_name || '').split(' ')[0] || 'there'}, this is ${r.rep || 'your rep'} with RightWay Growth. You're booked for your free Google clarity audit on ${when}.${r.meet ? ` Join here: ${r.meet}` : ' I will call you at this number and send the screen share link.'} Talk soon!`;
      $('#bkout', m.el).innerHTML = `<div class="card" style="box-shadow:none;background:var(--mint-soft);margin-top:12px"><h3>Booked for ${esc(when)}</h3>
        ${r.meet ? `<div class="copybox"><code>${esc(r.meet)}</code></div>` : ''}
        <p class="small">${r.google === false ? 'Saved in the Hub. Send them the invite:' : 'Invite sent. The lead moved to Audit booked. Open Present before the call.'}</p>
        ${r.google === false ? `<div class="copybox"><code style="white-space:normal">${esc(invite)}</code></div><div class="row" style="gap:6px;margin-top:8px">
          ${lead.phone ? `<a class="btn btn-ghost btn-sm" href="sms:${esc(String(lead.phone).replace(/[^\d+]/g, ''))}?&body=${encodeURIComponent(invite)}">Text it</a>` : ''}
          ${f.email ? `<a class="btn btn-ghost btn-sm" href="mailto:${esc(f.email)}?subject=${encodeURIComponent('Your Google clarity audit')}&body=${encodeURIComponent(invite)}">Email it</a>` : ''}
          <button class="btn btn-ghost btn-sm" type="button" id="bkcopy">Copy</button></div>` : ''}</div>`;
      $('#bkcopy', m.el)?.addEventListener('click', () => navigator.clipboard?.writeText(invite).then(() => toast('Copied')));
      toast('Meeting booked');
      onDone?.(r);
    } catch (err) { toast(err.message, true); } finally { busy(btn, false); }
  });
}
