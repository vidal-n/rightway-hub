// Spending and background jobs (owners, top of Settings). Every job that can spend money without a click has a switch here,
// off until you turn it on, with its price. A daily limit in dollars stops all of them for the rest of the day.
import { esc, api, toast } from './core.js';
import { PRICES, money, priceText } from '/js/pricing.js';

const bar = (spent, cap) => {
  if (!cap) return '';
  const pct = Math.min(100, Math.round((spent / cap) * 100));
  return `<div class="budget-bar" style="height:8px;border-radius:99px;background:var(--line);overflow:hidden;margin:8px 0"><div style="width:${pct}%;height:100%;background:${pct >= 100 ? '#d0453a' : pct >= 80 ? '#e0a21a' : 'var(--mint-strong, #23B07E)'}"></div></div>`;
};

export async function spendCard(box) {
  if (!box) return;
  box.innerHTML = '<div class="card-head"><h2>Spending and background jobs</h2></div><div class="skeleton" style="height:90px"></div>';
  let sp, rs, scan, sc;
  try {
    [sp, rs, scan, sc] = await Promise.all([api('/api/spend'), api('/api/research/status'), api('/api/autoscan').catch(() => null), api('/api/scrub/status').catch(() => null)]);
  } catch (e) { box.innerHTML = `<div class="card-head"><h2>Spending and background jobs</h2></div><p class="err-text">${esc(e.message)}</p>`; return; }
  const depths = rs.depths;
  const depthCost = (d) => (depths[d]?.cost ? depths[d].cost + 0.002 : 0);
  const sw = (id, on, dis = false) => `<label class="switch"><input type="checkbox" id="${id}"${on ? ' checked' : ''}${dis ? ' disabled' : ''}><span></span></label>`;
  const job = (title, cost, body, ctl) => `<li class="item" style="display:flex;align-items:flex-start;gap:12px"><div style="flex:1;min-width:0"><div class="item-title">${title} <span class="badge ${cost === 'Free' ? '' : 'warn'}">${esc(cost)}</span></div><div class="item-sub" style="white-space:normal">${body}</div></div><div style="flex:none;margin-left:auto">${ctl}</div></li>`;

  box.innerHTML = `<div class="card-head"><h2>Spending and background jobs</h2><a class="small" href="#/settings/budget">Full cost report</a></div>
    <div class="row" style="gap:24px;flex-wrap:wrap;align-items:flex-end">
      <div><div class="small muted">Spent today</div><div class="mono" style="font-size:26px">${money(sp.today)}</div></div>
      <div><div class="small muted">This month</div><div class="mono" style="font-size:26px">${money(sp.month)}</div></div>
      <label class="field" style="flex:0 1 220px;margin:0"><span>Daily limit for background jobs ($)</span><input id="spcap" type="number" min="0" step="1" value="${sp.cap}" aria-label="Daily limit in dollars"></label>
      <button class="btn btn-primary btn-sm" id="spsave">Save limit</button></div>
    ${bar(sp.today, sp.cap)}
    ${sp.paused ? `<p class="bad-text" style="margin:0 0 8px"><b>Paused for today.</b> Spending reached the ${money(sp.cap)} limit, so research, scans and Google Maps lead searches wait until tomorrow. Raise the limit to carry on.</p>` : ''}
    <p class="small muted" style="margin:0 0 14px">${sp.cap ? `When today's spend on DataForSEO, Claude and lead data reaches ${money(sp.cap)}, every background job below stops until tomorrow.` : 'No limit is set, so background jobs run until you turn them off.'} Things you click yourself (a lead search, a scan, a draft) are not blocked. Their prices are in the table at the bottom. Twilio is billed by Twilio and is not in these totals.</p>
    <ul class="list">
      ${job('Research new leads automatically', rs.on ? (rs.depth === 'free' ? 'Free' : `about ${money(depthCost(rs.depth))} a lead`) : 'Off', `Looks up each new lead on Google and scores it. ${rs.left} lead${rs.left === 1 ? '' : 's'} waiting. ${rs.on ? '' : 'Nothing is researched until you switch this on. You can still research one lead by hand.'}
        <div class="row" style="gap:12px;margin-top:8px;flex-wrap:wrap">
          <label class="field" style="flex:1 1 220px;margin:0"><span>Depth for automatic research</span><select id="spdepth">${Object.entries(depths).map(([k, v]) => `<option value="${k}"${rs.depth === k ? ' selected' : ''}>${esc(v.label)} (${v.cost ? `about ${money(v.cost + 0.002)} a lead` : 'free'})</option>`).join('')}</select></label>
          <label class="field" style="flex:1 1 220px;margin:0"><span>When a rep opens one lead</span><select id="spcall">${Object.entries(depths).map(([k, v]) => `<option value="${k}"${rs.callDepth === k ? ' selected' : ''}>${esc(v.label)} (${v.cost ? `about ${money(v.cost + 0.002)}` : 'free'})</option>`).join('')}</select></label>
          <label class="field" style="flex:0 1 140px;margin:0"><span>Most leads a day</span><input id="spleads" type="number" min="0" max="5000" value="${rs.cap}"></label></div>
        <div class="small muted" id="spest" style="margin-top:6px"></div>`, sw('spresearch', rs.on))}
      ${scan ? job('Monthly ranking scans for clients', scan.config.enabled ? `about ${money(scan.monthlyCost)} a month` : 'Off', `${scan.clients} active client${scan.clients === 1 ? '' : 's'}, ${scan.config.keywords} keyword${scan.config.keywords === 1 ? '' : 's'} each, ${scan.config.size} x ${scan.config.size} grid, every ${scan.config.everyDays} days. Change the grid and schedule in the card below.`, sw('spscan', scan.config.enabled)) : ''}
      ${sc ? job('Phone type check (mobile or landline)', sc.lookup ? `${money(PRICES.phone_lookup.usd)} a number` : 'Off', `Twilio Lookup on each scrubbed lead. ${sc.twilio ? '' : 'Needs Twilio connected.'}`, sw('splook', sc.lookup, !sc.twilio)) : ''}
      ${sc ? job('Scrub new leads automatically', 'Free', 'Cleans names, reads the website for owner and email, checks the email domain. No outside bill.', sw('spscrub', sc.auto)) : ''}
    </ul>
    <p class="small muted" style="margin:10px 0 0">Not automatic, so not listed above: Lead finder searches, "Scan all clients now", citations checks, review pulls and Claude drafts run only when someone clicks them, and show their price first.</p>
    <details style="margin-top:14px"><summary class="small" style="cursor:pointer"><b>What things cost</b></summary>
      <table class="table" style="margin-top:8px"><thead><tr><th>Thing</th><th>Price</th><th>Notes</th></tr></thead><tbody>
      ${Object.entries(PRICES).map(([id, p]) => `<tr><td>${esc(p.label)}</td><td class="mono">${esc(priceText(id))}</td><td class="small muted">${esc(p.note)}</td></tr>`).join('')}
      </tbody></table>
      <p class="small muted">List prices and estimates. The Budget tab shows what was actually billed.</p></details>`;

  const q = (s) => box.querySelector(s);
  const est = () => {
    const d = depthCost(q('#spdepth').value), n = Number(q('#spleads').value || 0);
    const most = d * n, cap = sp.cap;
    q('#spest').textContent = d ? `At most ${n} leads a day is about ${money(most)} a day${cap && most > cap ? `, and the ${money(cap)} daily limit stops it sooner` : ''}.` : 'Free depth: no paid searches.';
  };
  est();
  box.addEventListener('input', (e) => { if (e.target.matches('#spdepth, #spleads')) est(); });
  const run = async (fn, done = 'Saved') => { try { await fn(); toast(done); spendCard(box); } catch (e) { toast(e.message, true); spendCard(box); } };
  q('#spsave').onclick = () => run(() => api('/api/spend', { method: 'PUT', body: { cap: Number(q('#spcap').value) } }));
  const saveResearch = (on) => run(() => api('/api/research/settings', { method: 'PUT', body: { on, depth: q('#spdepth').value, callDepth: q('#spcall').value, cap: Number(q('#spleads').value) } }), on ? 'Automatic research is on' : 'Automatic research is off');
  q('#spresearch').onchange = (e) => saveResearch(e.target.checked);
  for (const id of ['#spdepth', '#spcall', '#spleads']) q(id).onchange = () => saveResearch(q('#spresearch').checked);
  if (q('#spscan')) q('#spscan').onchange = (e) => run(() => api('/api/autoscan', { method: 'PUT', body: { enabled: e.target.checked } }), e.target.checked ? 'Monthly scans are on' : 'Monthly scans are off');
  if (q('#splook')) q('#splook').onchange = (e) => run(() => api('/api/scrub/settings', { method: 'PUT', body: { lookup: e.target.checked } }));
  if (q('#spscrub')) q('#spscrub').onchange = (e) => run(() => api('/api/scrub/settings', { method: 'PUT', body: { auto: e.target.checked } }));
}
