// Call setup on the Pipeline (Nov 2026, V: choose who to call and the script on the Pipeline; the dialer only runs the list).
// Pick from every stage (not just new leads), narrow by quality, call type and data, choose the script, then save the list for the day.
// Modeled on the call list builders in Close.com Smart Views and Outreach's dial lists: build the list first, then dial it.
import { $, $$, esc, api, toast, busy } from './core.js';
import { campaignRows, campaignPool, poolCounts, followResults, calledBefore, cleanStages, CAMPAIGN_STAGES, DEFAULT_STAGES, TIERS, MAX_CAMPAIGN } from '/js/campaign.js';
import { CALL_CATS } from '/js/leadintel.js';
import { DIAL_SCRIPTS } from '/js/scripttest.js';
import { loadScriptTest, currentTest, pickedScript, setPicked, scriptName } from './scriptpick.js';

const DATA = [['', 'Any'], ['mobile', 'Mobile numbers'], ['owner', 'Owner name known'], ['email', 'Has an email']];

// Is a script chosen for today? A split test that reps cannot opt out of counts as chosen.
export function scriptReady() {
  const t = currentTest();
  return Boolean(pickedScript()) || (t.on && !t.allowPick);
}

// Load a set of leads as this person's call list and open the dialer (used by the setup box below and by each column's Load button).
// Returns false when it could not (no script picked, nothing left after other agents' leads are left out).
export async function loadList(ids, label, { skipped = 0 } = {}) {
  await loadScriptTest();
  if (!scriptReady()) { toast('Pick the script for today first. It is the last box in Set up the call list.', true); return false; }
  try {
    const r = await api('/api/dialer/campaign', { method: 'PUT', body: { ids: ids.slice(0, MAX_CAMPAIGN), label } });
    try { localStorage.setItem('rw-dial-filter', JSON.stringify({ campaign: '1', label })); } catch { /* ignore */ }
    const left = (r.taken || 0) + skipped;
    if (left) toast(`List loaded: ${r.total} leads. ${left} left out because ${r.takenBy?.length ? r.takenBy.map((x) => x.name).join(' and ') : 'another agent'} already ${r.takenBy?.length === 1 || !r.takenBy?.length ? 'has' : 'have'} them on a list.`);
    location.hash = '#/phone';
    return true;
  } catch (err) { toast(err.message, true); return false; }
}

// host: the box inside step 4. rows: the leads the Pipeline filters let through. selected: ids ticked in the list view.
export function mountCallSetup(host, { rows, p, selected, stageLabel, save, mine = 0 }) {
  const cs = (p.call = { stages: [...DEFAULT_STAGES], kind: 'fresh', results: [], tier: '', cat: '', data: '', mine: false, ...(p.call || {}) });
  cs.stages = cleanStages(cs.stages);
  if (!cs.stages.length) cs.stages = [...DEFAULT_STAGES];
  const draw = () => {
    if (!document.body.contains(host)) return;
    const pool = campaignPool(rows, { stages: cs.stages });
    const only = cs.mine && selected.size ? new Set(selected) : null;
    const counts = poolCounts(campaignRows(rows, { stages: cs.stages, kind: cs.kind, results: cs.results, only }));
    const freshN = pool.filter((l) => !calledBefore(l)).length, followN = pool.length - freshN, byResult = followResults(pool);
    cs.results = cs.results.filter((r) => byResult.some(([k]) => k === r));
    const list = campaignRows(rows, { ...cs, only });
    const heldN = rows.filter((l) => l.held && l.phone && cs.stages.includes(l.stage)).length;
    const ready = list.filter((l) => l.callable_now).length;
    const stageN = (s) => rows.filter((l) => !l.dnc && l.phone && l.stage === s).length;
    const t = currentTest();
    const today = pickedScript(); const last = pickedScript({ anyDay: true });
    const forced = t.on && !t.allowPick;
    const scripts = `<option value="">${last && last !== 'test' ? `Choose a script (last used: ${esc(scriptName(last))})` : 'Choose a script'}</option>
      ${t.on ? `<option value="test"${today === 'test' || forced ? ' selected' : ''}>Follow the split test: ${t.variants.map((k) => esc(scriptName(k))).join(' vs ')}</option>` : ''}
      ${forced ? '' : DIAL_SCRIPTS.map((k) => `<option value="${k}"${today === k ? ' selected' : ''}>${esc(scriptName(k))}</option>`).join('')}`;
    const label = [`${list.length} leads`, cs.kind === 'follow' ? `follow ups${cs.results.length ? `: ${cs.results.join(', ')}` : ''}` : cs.kind === 'all' ? 'fresh and follow ups' : 'fresh leads', cs.stages.length === DEFAULT_STAGES.length && cs.stages.every((s) => DEFAULT_STAGES.includes(s)) ? '' : cs.stages.map((s) => stageLabel[s] || s).join(', '),
      cs.tier ? TIERS.find((x) => x[0] === cs.tier)?.[1] : '', cs.cat ? CALL_CATS.find((c) => c.id === cs.cat)?.label : '', only ? 'ticked by hand' : ''].filter(Boolean).join(' · ');
    host.innerHTML = `
      <div class="cs-grid">
        <div class="cs-col cs-wide"><span class="cs-h">Which leads</span>
          <div class="seg cs-kind" role="group" aria-label="Fresh leads or follow ups">${[['fresh', `Fresh, never called (${freshN})`], ['follow', `Follow ups, already called (${followN})`], ['all', 'Both']].map(([k, n]) => `<button type="button" data-ckind="${k}" class="${cs.kind === k ? 'is-on' : ''}" aria-pressed="${cs.kind === k}">${esc(n)}</button>`).join('')}</div>
          <p class="small muted" style="margin:6px 0 0">Anyone on the team already dialed shows up under Follow ups, by what happened on the last call, so nobody calls the same lead cold twice. Do not call, dead, bad number and phone menu leads never show here for anyone.</p>
          ${cs.kind === 'follow' ? `<div class="chips cs-results" aria-label="Last result">${byResult.length ? byResult.map(([r, n]) => `<button type="button" class="chip${cs.results.includes(r) ? ' on' : ''}" data-cres="${esc(r)}" aria-pressed="${cs.results.includes(r)}">${esc(r)} <b>${n}</b></button>`).join('') : '<span class="small muted">No follow ups in this view.</span>'}</div><p class="small muted" style="margin:4px 0 0">Tick none to take every follow up.</p>` : ''}</div>
        <div class="cs-col cs-wide"><span class="cs-h">Which stages</span>
          <div class="chips cs-stages" aria-label="Stages to call">${CAMPAIGN_STAGES.map((s) => `<button type="button" class="chip${cs.stages.includes(s) ? ' on' : ''}" data-cstage="${s}" aria-pressed="${cs.stages.includes(s)}">${esc(stageLabel[s] || s)} <b>${stageN(s)}</b></button>`).join('')}</div>
          <p class="small muted" style="margin:6px 0 0">Every stage is open to you, not just new leads. Won clients and Do not call never go on a list.</p></div>
        <label class="field"><span>Quality</span><select id="cs-tier">${[['', 'Best first', Object.values(counts.tiers).reduce((a, b) => a + b, 0)], ...TIERS.map(([k, n]) => [k, n, counts.tiers[k]])].map(([k, n, c]) => `<option value="${k}"${cs.tier === k ? ' selected' : ''}>${esc(n)} (${c})</option>`).join('')}</select></label>
        <label class="field"><span>Call type</span><select id="cs-cat">${[['', 'All', Object.values(counts.cats).reduce((a, b) => a + b, 0)], ...CALL_CATS.filter((c) => counts.cats[c.id] || cs.cat === c.id).map((c) => [c.id, c.label, counts.cats[c.id] || 0])].map(([k, n, c]) => `<option value="${k}"${cs.cat === k ? ' selected' : ''}>${esc(n)} (${c})</option>`).join('')}</select></label>
        <label class="field"><span>Data</span><select id="cs-data">${DATA.map(([k, n]) => `<option value="${k}"${cs.data === k ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
        <label class="field"><span>Script for today</span><select id="cs-script" aria-label="Script for today">${scripts}</select></label>
      </div>
      ${selected.size ? `<label class="row small" style="gap:6px;margin-top:8px"><input type="checkbox" id="cs-mine"${cs.mine ? ' checked' : ''}> Only the ${selected.size} lead${selected.size === 1 ? '' : 's'} I ticked in the list</label>` : '<p class="small muted" style="margin:8px 0 0">To hand pick leads, switch to List view and tick the ones you want.</p>'}
      <div class="cs-foot"><p class="cs-sum" id="cs-sum"><b>${list.length}</b> lead${list.length === 1 ? '' : 's'} on this list${list.length > MAX_CAMPAIGN ? ` (first ${MAX_CAMPAIGN} are saved)` : ''} · <b>${ready}</b> callable right now.${heldN ? ` <b>${heldN}</b> more ${heldN === 1 ? 'is' : 'are'} on other agents' lists and left out.` : ''} The dialer takes callbacks and audit requests first, then the best scores. Time zones, call lists and filters above all carry over.</p>
        <button type="button" class="btn btn-mint" id="csgo"${list.length ? '' : ' disabled'}>Load this list and open the dialer</button></div>`;
    $$('[data-ckind]', host).forEach((b) => b.addEventListener('click', () => { cs.kind = b.dataset.ckind; save(); draw(); }));
    $$('[data-cres]', host).forEach((b) => b.addEventListener('click', () => { const r = b.dataset.cres; cs.results = cs.results.includes(r) ? cs.results.filter((x) => x !== r) : [...cs.results, r]; save(); draw(); }));
    $$('[data-cstage]', host).forEach((b) => b.addEventListener('click', () => { const s = b.dataset.cstage; cs.stages = cs.stages.includes(s) ? cs.stages.filter((x) => x !== s) : [...cs.stages, s]; if (!cs.stages.length) cs.stages = [...DEFAULT_STAGES]; save(); draw(); }));
    $('#cs-tier', host).addEventListener('change', (e) => { cs.tier = e.target.value; save(); draw(); });
    $('#cs-cat', host).addEventListener('change', (e) => { cs.cat = e.target.value; save(); draw(); });
    $('#cs-data', host).addEventListener('change', (e) => { cs.data = e.target.value; save(); draw(); });
    $('#cs-script', host).addEventListener('change', (e) => { if (e.target.value) setPicked(e.target.value); draw(); });
    $('#cs-mine', host)?.addEventListener('change', (e) => { cs.mine = e.target.checked; save(); draw(); });
    $('#csgo', host).addEventListener('click', async (e) => {
      if (!list.length) return toast('No leads match. Change the stages or filters.', true);
      if (!scriptReady()) { toast('Pick the script for today first.', true); $('#cs-script', host)?.focus(); return; }
      if (mine && !confirm(`Replace the ${mine} leads on your list with these ${list.length}? Your old list closes out and those leads go back to the pool.`)) return;
      const btn = e.currentTarget; busy(btn, true);
      const ok = await loadList(list.map((l) => l.id), label);
      if (!ok) busy(btn, false);
    });
  };
  draw();
  loadScriptTest().then(draw);
  return { refresh: draw, focus: () => host.scrollIntoView({ behavior: 'smooth', block: 'center' }) };
}
