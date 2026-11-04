// Service balances card (owners): DataForSEO and Twilio prepaid balances, with links to top up.
import { esc, api } from './core.js';

const money = (n, c = 'USD') => `${c === 'USD' ? '$' : ''}${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${c !== 'USD' ? ` ${c}` : ''}`;

export async function balancesCard(box, { fresh = false } = {}) {
  if (!box) return;
  box.innerHTML = '<div class="card-head"><h2>Service balances</h2></div><div class="skeleton" style="height:60px"></div>';
  let d;
  try { d = await api(`/api/balances${fresh ? '?fresh=1' : ''}`); } catch (e) { box.innerHTML = `<div class="card-head"><h2>Service balances</h2></div><p class="err-text">${esc(e.message)}</p>`; return; }
  const row = (s) => {
    const state = !s.connected ? ['gray', 'Not connected'] : s.error ? ['bad', 'Could not read'] : s.empty ? ['bad', 'Empty'] : s.low ? ['warn', 'Low'] : ['', 'OK'];
    return `<li class="item"><span class="badge ${state[0]}">${state[1]}</span>
      <div><div class="item-title">${esc(s.name)}${s.balance != null ? ` <b style="margin-left:6px">${esc(money(s.balance, s.currency))}</b>` : ''}</div>
        <div class="item-sub">${esc(s.error ? s.error : s.note || '')}${s.low && !s.empty ? '. Top up soon so nothing stops.' : ''}${s.empty ? '. Top up now: this stops scans or calls.' : ''}</div></div>
      ${s.addUrl ? `<a class="btn ${s.low ? 'btn-primary' : 'btn-ghost'} btn-sm" href="${esc(s.addUrl)}" target="_blank" rel="noopener">Add funds</a>` : '<span></span>'}</li>`;
  };
  box.innerHTML = `<div class="card-head"><h2>Service balances</h2><button class="btn btn-ghost btn-sm" id="balref">Refresh</button></div>
    <ul class="list">${d.services.map(row).join('')}</ul>
    <p class="small muted" style="margin:10px 0 0">No balance feed: ${d.others.map((o) => `<a href="${esc(o.url)}" ${o.url.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}>${esc(o.name)}</a>`).join(', ')}.</p>`;
  box.querySelector('#balref').onclick = () => balancesCard(box, { fresh: true });
}
