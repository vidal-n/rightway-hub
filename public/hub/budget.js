// Budget and costs (owners): Settings tab with charts and a budget, and the small card on the Dashboard.
import { $, $$, esc, api, toast, busy } from './core.js';
import { staffShell, settingsTabs } from './staff.js';
import { stackBars, donut, legend } from '/js/charts.js';

export const usd = (n, d = 2) => `${n < 0 ? '-' : ''}$${Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const KEYS = ['dataforseo', 'claude', 'twilio', 'leads'];
const VENDOR = { dataforseo: ['DataForSEO', 'var(--c-blue)'], claude: ['Claude', 'var(--c-violet)'], twilio: ['Twilio', 'var(--c-coral)'], leads: ['Lead data', 'var(--c-green)'], fixed: ['Subscriptions', 'var(--c-amber)'] };
const WHAT = { dataforseo: 'Client scans, listing checks, reviews', claude: 'Ask Claude, captions, page drafts, replies', twilio: 'Calls, texts, numbers, phone type checks', leads: 'Lead finder searches, lead research, lists and tools you buy' };
const dayLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const tone = (pct) => (pct == null ? '' : pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : '');

const seriesOf = (d) => KEYS.map((k) => ({ name: VENDOR[k][0], color: VENDOR[k][1], values: d.series.map((x) => x[k] || 0) }));
const mkBar = (pct, cls = '') => `<div class="bgt ${cls}"><i style="width:${Math.min(100, Math.max(0, pct || 0))}%"></i></div>`;

// ---------- Dashboard widget ----------
export async function budgetCard(box) {
  if (!box) return;
  let d;
  try { d = await api('/api/costs?days=14'); } catch { box.remove(); return; }
  const b = d.budget, m = d.month;
  const S = seriesOf(d);
  box.innerHTML = `<div class="card-head"><h2>Budget and costs</h2><a class="btn btn-ghost btn-sm" href="#/settings/budget">Open</a></div>
    <div class="bg-top"><div><b class="big mono">${usd(m.total)}</b><span class="small muted">spent this month${m.fixed ? ` (${usd(m.fixed)} subscriptions)` : ''}</span></div>
      <div class="bg-proj"><b class="mono">${usd(m.projected)}</b><span class="small muted">projected by month end</span></div></div>
    ${b.monthly ? `<div class="bg-line"><span class="small">${b.pct}% of ${usd(b.monthly, 0)} budget</span><span class="badge ${tone(b.pct) || 'gray'}">${b.left >= 0 ? `${usd(b.left, 0)} left` : `${usd(-b.left, 0)} over`}</span></div>${mkBar(b.pct, tone(b.pct))}`
    : '<p class="small muted" style="margin:8px 0 0">No budget yet. <a href="#/settings/budget">Set one</a> and the Hub tells you at 80% and 100%.</p>'}
    <div class="bg-chart">${stackBars(d.series.map((x) => dayLabel(x.day)), S, { h: 150, pad: 28, fmt: (v) => `$${v}` })}</div>${legend(S)}`;
}

// ---------- Settings tab ----------
export async function budgetPage(app, user) {
  const view = staffShell(app, user, 'settings');
  if (user.role !== 'admin') { view.innerHTML = '<div class="card empty"><h3>Owners only</h3><p>Budget and costs are visible to owners.</p></div>'; return; }
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Settings</p><h1>Budget and costs</h1></div></div>${settingsTabs('budget', user)}<div class="skeleton"></div>`;
  let days = 30;
  const load = async () => {
    let d;
    try { d = await api(`/api/costs?days=${days}`); } catch (e) { view.insertAdjacentHTML('beforeend', `<p class="err-text">${esc(e.message)}</p>`); return; }
    draw(d);
  };
  const draw = (d) => {
    const m = d.month, b = d.budget, r = d.revenue;
    const S = seriesOf(d);
    const parts = [...KEYS.map((k) => ({ label: VENDOR[k][0], value: m.by[k], color: VENDOR[k][1] })), { label: VENDOR.fixed[0], value: m.fixed, color: VENDOR.fixed[1] }];
    const paceDaily = b.monthly ? Math.max(0, (b.monthly - m.fixed) / m.days) : 0;
    view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Settings</p><h1>Budget and costs</h1></div>
      <div class="seg" id="bg-range">${[14, 30, 60, 90].map((n) => `<button type="button" data-d="${n}" class="${d.days === n ? 'is-on' : ''}">${n} days</button>`).join('')}</div></div>
      ${settingsTabs('budget', user)}
      <div class="bg-stats">
        <div class="stat tint-blue"><div class="stat-num mono">${usd(m.total)}</div><div class="stat-label">spent this month${m.prev ? ` (last month ${usd(m.prev)} before subscriptions)` : ''}</div></div>
        <div class="stat tint-violet"><div class="stat-num mono">${usd(m.projected)}</div><div class="stat-label">projected by month end at this pace</div></div>
        <div class="stat tint-${tone(b.pct) === 'bad' ? 'coral' : tone(b.pct) === 'warn' ? 'amber' : 'green'}"><div class="stat-num mono">${b.monthly ? `${b.pct}%` : 'No budget'}</div><div class="stat-label">${b.monthly ? `of ${usd(b.monthly, 0)}, ${b.left >= 0 ? `${usd(b.left, 0)} left` : `${usd(-b.left, 0)} over`}` : 'set one below'}</div></div>
        <div class="stat tint-teal"><div class="stat-num mono">${r.costPerClient == null ? '$0' : usd(r.costPerClient)}</div><div class="stat-label">cost per active client${r.clients ? ` (${r.clients})` : ''}</div></div>
        <div class="stat tint-amber"><div class="stat-num mono">${d.unit.searches ? usd(d.unit.search, 4) : '$0'}</div><div class="stat-label">per search, ${d.unit.searches.toLocaleString()} searches this month</div></div>
        <div class="stat tint-green"><div class="stat-num mono">${r.mrr ? usd(r.margin, 0) : '$0'}</div><div class="stat-label">${r.mrr ? `left after costs on ${usd(r.mrr, 0)} monthly revenue (${r.costPct}% goes to costs)` : 'no client revenue yet'}</div></div>
      </div>
      <div class="bg-grid">
        <div class="card bg-wide"><div class="card-head"><h2>Spend by day</h2><span class="small muted">last ${d.days} days</span></div>
          ${stackBars(d.series.map((x) => dayLabel(x.day)), S, { h: 260, fmt: (v) => `$${v}`, cap: paceDaily })}${legend(S)}${paceDaily ? `<p class="small" style="margin:8px 0 0"><span class="pace-key"></span>Dashed line: ${usd(paceDaily)} a day, the pace that keeps usage inside your budget after subscriptions.</p>` : ''}
          <p class="small muted" style="margin:10px 0 0">DataForSEO and Claude are logged by the Hub as they are spent, so they start filling from the day this tab went live. Twilio comes from Twilio's own usage records and can trail by a few hours. Claude is estimated from token counts at list price.</p></div>
        <div class="card"><div class="card-head"><h2>Where this month went</h2></div>
          <div class="bg-donut">${donut(parts, { size: 170, thick: 24, center: usd(m.total, 0), sub: 'this month' })}
            <ul class="bg-leg">${parts.map((p) => `<li><i style="background:${p.color}"></i><span>${esc(p.label)}</span><b class="mono">${usd(p.value)}</b></li>`).join('')}</ul></div>
          ${!m.twilioConnected ? '<p class="small muted" style="margin:12px 0 0">Twilio is not connected, so its spend is not counted.</p>' : ''}</div>
        <div class="card"><div class="card-head"><h2>Monthly budget</h2><span class="badge ${tone(b.pct) || 'gray'}">${b.monthly ? `${b.pct}% used` : 'Not set'}</span></div>
          <form id="bg-form" class="bg-form">
            <label class="field"><span>Total for the month (usage plus subscriptions)</span><input name="monthly" type="number" min="0" step="1" inputmode="decimal" value="${b.monthly || ''}" placeholder="e.g. 300"></label>
            <div class="bg-caps">${KEYS.map((k) => `<label class="field"><span>${VENDOR[k][0]} cap</span><input name="v_${k}" type="number" min="0" step="1" inputmode="decimal" value="${b.vendors[k] || ''}" placeholder="optional"></label>`).join('')}</div>
            <div class="bg-vend">${KEYS.map((k) => { const cap = b.vendors[k]; const pct = cap ? Math.round((100 * m.by[k]) / cap) : null; return `<div><div class="bg-line"><span class="small"><i class="dot" style="background:${VENDOR[k][1]}"></i> ${VENDOR[k][0]}</span><span class="small mono">${usd(m.by[k])}${cap ? ` of ${usd(cap, 0)}` : ''}</span></div>${cap ? mkBar(pct, tone(pct)) : ''}</div>`; }).join('')}</div>
            <p class="small muted">The Hub sends an owner notification once at 80% and again at 100% of the monthly total.</p>
            <button class="btn btn-primary" type="submit">Save budget</button></form></div>
        <div class="card"><div class="card-head"><h2>Monthly subscriptions</h2><span class="badge gray mono">${usd(m.fixed)}</span></div>
          <p class="small muted" style="margin:0 0 10px">The flat bills that are not tied to usage: Cloudflare, Resend, Google Workspace, Slack, domains, and any lead list you pay for every month. They count toward the budget.</p>
          <p class="small muted" style="margin:0 0 10px"><b>Cloudflare Workers Paid is $5 a month.</b> That covers the Hub's requests and database reads and writes. Use beyond the included allowance is billed monthly on top, but normal use stays well inside it: about 5,000 requests a day, and roughly 300,000 database writes a month even at 1,000 new leads a day. Keep it here so the budget shows the real total.</p>
          <form id="fx-form"><div id="fx-rows" class="fx-rows"></div>
            <div class="row" style="margin-top:10px"><button type="button" class="btn btn-ghost btn-sm" id="fx-add">${'+'} Add a subscription</button><button class="btn btn-primary btn-sm" type="submit">Save subscriptions</button></div></form></div>
        <div class="card"><div class="card-head"><h2>Add a lead expense</h2><span class="badge gray mono">${usd(m.by.leads || 0)} this month</span></div>
          <p class="small muted" style="margin:0 0 10px">A one-off cost for finding or buying leads: a list, a tool, a data pull. It goes on the Lead data line for today. The Lead finder and lead research are counted automatically.</p>
          <form id="le-form" class="bg-form"><label class="field"><span>What it was</span><input name="name" maxlength="60" placeholder="e.g. Florida licensed HVAC list"></label>
            <label class="field"><span>Amount</span><input name="dollars" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="e.g. 49"></label>
            <div class="row"><button class="btn btn-primary btn-sm" type="submit">Add expense</button></div></form></div>
        <div class="card" id="balbox"></div>
        <div class="card bg-wide"><div class="card-head"><h2>What each cost is for</h2><span class="small muted">this month</span></div>
          ${d.kinds.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Service</th><th>What</th><th class="num">Calls</th><th class="num">Cost</th></tr></thead><tbody>${d.kinds.map((k) => `<tr><td><i class="dot" style="background:${VENDOR[k.vendor]?.[1] || 'var(--muted)'}"></i> ${esc(VENDOR[k.vendor]?.[0] || k.vendor)}</td><td>${esc(k.kind)}</td><td class="num mono">${k.n.toLocaleString()}</td><td class="num mono">${usd(k.usd, 4)}</td></tr>`).join('')}${m.twilioConnected ? `<tr><td><i class="dot" style="background:var(--c-coral)"></i> Twilio</td><td>Voice ${usd(m.twilio.calls)}, texts ${usd(m.twilio.sms)}, numbers ${usd(m.twilio.numbers)}, recordings ${usd(m.twilio.recordings)}</td><td class="num mono">-</td><td class="num mono">${usd(m.by.twilio, 4)}</td></tr>` : ''}</tbody></table></div>`
        : '<p class="muted">Nothing logged yet this month. Scans, research, Ask Claude and drafts show up here as they run.</p>'}</div>
      </div>`;
    $$('#bg-range [data-d]', view).forEach((x) => x.addEventListener('click', () => { days = Number(x.dataset.d); load(); }));
    $('#le-form', view).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget, btn = $('button[type=submit]', f);
      busy(btn, true, 'Adding...');
      try { await api('/api/costs/entry', { method: 'POST', body: { name: f.name.value, dollars: f.dollars.value } }); toast('Lead expense added'); load(); } catch (err) { toast(err.message, true); busy(btn, false); }
    });
    import('./balances.js').then((mod) => mod.balancesCard($('#balbox', view)));
    $('#bg-form', view).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget, btn = $('button[type=submit]', f);
      busy(btn, true, 'Saving...');
      try {
        await api('/api/costs/budget', { method: 'PUT', body: { monthly: f.monthly.value, vendors: { dataforseo: f.v_dataforseo.value, claude: f.v_claude.value, twilio: f.v_twilio.value, leads: f.v_leads.value } } });
        toast('Budget saved'); load();
      } catch (err) { toast(err.message, true); busy(btn, false); }
    });
    let fixed = d.fixedList.length ? d.fixedList.map((x) => ({ ...x })) : [{ name: 'Cloudflare Workers Paid', monthly: 5 }];
    const rows = () => {
      $('#fx-rows', view).innerHTML = fixed.map((x, i) => `<div class="fx-row"><input data-i="${i}" data-k="name" placeholder="Name" maxlength="60" value="${esc(x.name)}" aria-label="Name"><input data-i="${i}" data-k="monthly" type="number" min="0" step="0.01" inputmode="decimal" placeholder="$ per month" value="${esc(x.monthly)}" aria-label="Dollars per month"><button type="button" class="btn btn-ghost btn-sm" data-rm="${i}" aria-label="Remove">&times;</button></div>`).join('');
      $$('#fx-rows input', view).forEach((inp) => inp.addEventListener('input', () => { fixed[Number(inp.dataset.i)][inp.dataset.k] = inp.value; }));
      $$('[data-rm]', view).forEach((x) => x.addEventListener('click', () => { fixed.splice(Number(x.dataset.rm), 1); rows(); }));
    };
    rows();
    $('#fx-add', view).addEventListener('click', () => { fixed.push({ name: '', monthly: '' }); rows(); $$('#fx-rows input[data-k=name]', view).at(-1)?.focus(); });
    $('#fx-form', view).addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', e.currentTarget);
      busy(btn, true, 'Saving...');
      try { await api('/api/costs/budget', { method: 'PUT', body: { fixed } }); toast('Subscriptions saved'); load(); } catch (err) { toast(err.message, true); busy(btn, false); }
    });
  };
  load();
}
