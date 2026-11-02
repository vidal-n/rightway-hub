// Payments (owners only): Stripe revenue at a glance, a 6 month collected chart, what needs attention, and recent payments.
// Also the small snapshot card on the Dashboard.
import { $, $$, esc, api, fmt, icon } from './core.js';
import { staffShell } from './staff.js';

const money = (cents) => fmt.money((cents || 0) / 100);
const day = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const STATUS = { succeeded: ['', 'Paid'], failed: ['bad', 'Failed'], pending: ['warn', 'Pending'], refunded: ['gray', 'Refunded'] };

function notConnected() {
  return `<div class="card" style="max-width:640px"><h2>Connect Stripe</h2><p>Add <b>STRIPE_SECRET_KEY</b> in Cloudflare, Build, Variables and secrets, then rebuild. A restricted key with read access to Balance, Charges, Customers, Invoices, Payouts and Subscriptions is enough.</p></div>`;
}

// 6 month bar chart: one series, hover or focus a month for the exact amount, table under "Show numbers".
function chart(months) {
  const max = Math.max(1, ...months.map((m) => m.cents));
  const last = months.length - 1;
  return `<div class="paychart" role="img" aria-label="Money collected per month, last 6 months">
      <div class="pc-plot">${months.map((m, i) => {
        const h = m.cents ? Math.max(2, Math.round((100 * m.cents) / max)) : 0;
        return `<div class="pc-col" tabindex="0" data-tip="${esc(`${m.label}: ${money(m.cents)} from ${m.count} payment${m.count === 1 ? '' : 's'}`)}">
          ${i === last && m.cents ? `<span class="pc-val" style="bottom:calc(${h}% + 6px)">${esc(money(m.cents))}</span>` : ''}
          <span class="pc-bar" style="height:${h}%"></span></div>`;
      }).join('')}<div class="pc-tip" hidden></div></div>
      <div class="pc-axis">${months.map((m) => `<span>${esc(m.label)}</span>`).join('')}</div>
    </div>
    <details class="pc-table"><summary class="small">Show numbers</summary><table class="small"><thead><tr><th>Month</th><th>Collected</th><th>Payments</th></tr></thead>
      <tbody>${months.map((m) => `<tr><td>${esc(m.label)}</td><td>${esc(money(m.cents))}</td><td>${m.count}</td></tr>`).join('')}</tbody></table></details>`;
}
function bindChart(root) {
  const plot = $('.pc-plot', root);
  if (!plot) return;
  const tip = $('.pc-tip', plot);
  const show = (col) => {
    tip.textContent = col.dataset.tip; tip.hidden = false;
    const pr = plot.getBoundingClientRect(), cr = col.getBoundingClientRect();
    tip.style.left = `${Math.min(pr.width - 10, Math.max(10, cr.left - pr.left + cr.width / 2))}px`;
  };
  $$('.pc-col', plot).forEach((c) => {
    c.addEventListener('mouseenter', () => show(c)); c.addEventListener('focus', () => show(c));
    c.addEventListener('mouseleave', () => { tip.hidden = true; }); c.addEventListener('blur', () => { tip.hidden = true; });
  });
}

const errNote = (d, k) => (d.errors?.[k] ? `<p class="small err-text" style="margin:6px 0 0">${esc(d.errors[k])}</p>` : '');

export async function paymentsPage(app, user) {
  const view = staffShell(app, user, 'payments');
  if (user.role !== 'admin') { view.innerHTML = '<div class="page-head"><h1>Payments</h1></div><p class="err-text">Only an owner can see payments.</p>'; return; }
  const load = async (fresh = false) => {
    let d;
    try { d = await api(`/api/payments${fresh ? '?fresh=1' : ''}`); }
    catch (e) { view.innerHTML = `<div class="page-head"><h1>Payments</h1></div><p class="err-text">${esc(e.message)}</p>`; return; }
    if (!d.connected) { view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Stripe</p><h1>Payments</h1></div></div>${notConnected()}`; return; }
    const change = d.collectedLastMonth ? Math.round((100 * (d.collectedThisMonth - d.collectedLastMonth)) / d.collectedLastMonth) : null;
    const attention = [
      ...(d.pastDue || []).map((s) => ({ badge: ['bad', 'Past due'], who: s.customer, clientId: s.clientId, sub: `${money(s.monthly)}/mo subscription`, link: null })),
      ...(d.unpaid || []).map((i) => ({ badge: i.overdue ? ['bad', 'Overdue'] : ['warn', 'Unpaid'], who: i.customer, clientId: i.clientId, sub: `${money(i.amount)}${i.due ? ` due ${day(i.due)}` : ''}`, link: i.url })),
    ];
    view.innerHTML = `
      <div class="page-head"><div><p class="eyebrow">Stripe</p><h1>Payments</h1></div>
        <div class="row"><button class="btn btn-ghost btn-sm" id="prefresh">Refresh</button><a class="btn btn-ghost btn-sm" href="https://dashboard.stripe.com" target="_blank" rel="noopener">Open Stripe</a></div></div>
      <div class="stats">
        <div class="stat hero"><div class="stat-num">${d.mrr != null ? esc(money(d.mrr)) : 'n/a'}</div><div class="stat-label">monthly recurring revenue${d.activeSubs != null ? ` · ${d.activeSubs} active` : ''}</div>${errNote(d, 'active')}</div>
        <div class="stat"><div class="stat-num">${d.collectedThisMonth != null ? esc(money(d.collectedThisMonth)) : 'n/a'}</div><div class="stat-label">collected this month${change != null ? ` · ${change >= 0 ? 'up' : 'down'} ${Math.abs(change)}% vs last month` : ''}</div>${errNote(d, 'charges')}</div>
        <div class="stat"><div class="stat-num">${d.balance ? esc(money(d.balance.available)) : 'n/a'}</div><div class="stat-label">available in Stripe${d.balance ? ` · ${esc(money(d.balance.pending))} on the way` : ''}</div>${errNote(d, 'balance')}</div>
        <div class="stat"><div class="stat-num">${d.nextPayout ? esc(money(d.nextPayout.amount)) : d.payouts ? '$0' : 'n/a'}</div><div class="stat-label">${d.nextPayout ? `next payout, arrives ${esc(day(d.nextPayout.arrival))}` : 'no payout on the way'}</div>${errNote(d, 'payouts')}</div>
      </div>
      <div class="pay-grid">
        <div class="card"><div class="card-head"><h2>Collected per month</h2><span class="small muted">after refunds</span></div>${d.months ? chart(d.months) : errNote(d, 'charges')}</div>
        <div class="card"><div class="card-head"><h2>Needs attention</h2><span class="badge ${attention.length ? 'bad' : 'gray'}">${attention.length}</span></div>
          ${attention.length ? `<ul class="list">${attention.map((a) => `<li class="item"><span class="badge ${a.badge[0]}">${a.badge[1]}</span>
            <div><div class="item-title">${a.clientId ? `<a href="#/client/${esc(a.clientId)}/billing">${esc(a.who)}</a>` : esc(a.who)}</div><div class="item-sub">${esc(a.sub)}</div></div>
            ${a.link ? `<a class="btn btn-ghost btn-sm" href="${esc(a.link)}" target="_blank" rel="noopener">Invoice</a>` : '<span></span>'}</li>`).join('')}</ul>`
          : '<p class="muted">Nobody is behind. Past due subscriptions and unpaid invoices show up here.</p>'}
          ${d.failedThisMonth ? `<p class="small" style="margin-top:10px"><span class="badge bad">${d.failedThisMonth}</span> failed payment${d.failedThisMonth === 1 ? '' : 's'} this month. Stripe retries cards on its own.</p>` : ''}
          ${errNote(d, 'pastDue')}${errNote(d, 'open')}</div>
      </div>
      <div class="card" style="margin-top:18px"><div class="card-head"><h2>Recent payments</h2></div>
        ${d.recent?.length ? `<div class="table-wrap"><table class="ptable"><thead><tr><th>Date</th><th>Customer</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
          ${d.recent.map((p) => { const [cls, label] = STATUS[p.status] || ['gray', p.status]; return `<tr>
            <td>${esc(day(p.at))}</td>
            <td>${p.clientId ? `<a href="#/client/${esc(p.clientId)}/billing">${esc(p.customer)}</a>` : esc(p.customer)}${p.description ? `<div class="small muted">${esc(p.description)}</div>` : ''}</td>
            <td class="num">${esc(money(p.amount))}${p.refunded && p.status !== 'refunded' ? `<div class="small muted">${esc(money(p.refunded))} refunded</div>` : ''}</td>
            <td><span class="badge ${cls}">${esc(label)}</span>${p.status === 'failed' && p.reason ? `<div class="small muted">${esc(p.reason)}</div>` : ''}</td>
            <td>${p.receipt ? `<a class="small" href="${esc(p.receipt)}" target="_blank" rel="noopener">Receipt</a>` : ''}</td></tr>`; }).join('')}
        </tbody></table></div>` : `<p class="muted">No payments in the last 6 months yet.</p>${errNote(d, 'charges')}`}
      </div>
      <p class="small muted" style="margin-top:10px">Updated ${esc(new Date(d.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}. Numbers come straight from Stripe.</p>`;
    bindChart(view);
    $('#prefresh', view).addEventListener('click', () => load(true));
  };
  load();
}

// Dashboard snapshot (owners). Fills a placeholder card without slowing the rest of the page.
export async function paymentsSnapshot(box) {
  if (!box) return;
  let d;
  try { d = await api('/api/payments'); } catch (e) { box.innerHTML = `<div class="card-head"><h2>Payments</h2></div><p class="small err-text">${esc(e.message)}</p>`; return; }
  if (!d.connected) { box.innerHTML = '<div class="card-head"><h2>Payments</h2><a class="btn btn-ghost btn-sm" href="#/payments">Set up</a></div><p class="muted">Connect Stripe to see revenue, payouts and who is behind.</p>'; return; }
  const behind = (d.pastDue?.length || 0) + (d.unpaid?.filter((i) => i.overdue).length || 0);
  box.innerHTML = `<div class="card-head"><h2>Payments</h2><a class="btn btn-ghost btn-sm" href="#/payments">${icon.money}Open</a></div>
    <div class="mini3"><div><b>${d.mrr != null ? esc(money(d.mrr)) : 'n/a'}</b><span>recurring per month</span></div>
      <div><b>${d.collectedThisMonth != null ? esc(money(d.collectedThisMonth)) : 'n/a'}</b><span>collected this month</span></div>
      <div><b class="${behind ? 'bad-text' : ''}">${behind}</b><span>behind on payment</span></div></div>
    <p class="small" style="margin-top:12px">${d.nextPayout ? `Next payout ${esc(money(d.nextPayout.amount))} arrives ${esc(day(d.nextPayout.arrival))}.` : d.balance ? `${esc(money(d.balance.available))} available in Stripe.` : ''}</p>`;
}
