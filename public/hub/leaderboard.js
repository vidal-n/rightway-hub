// Leaderboard widget (Nov 2026, V: the team's bookings get their own widget on the Dialer and the Dashboard, so the Coming up bar can stay
// his own). Modeled on the rep leaderboards in Close.com Reports and the Orum and Nooks team boards.
// Per person: booked, owner talks, booked per owner talk (the conversion rate), dials and the appointments they run. Online bookings with
// no rep behind them sit on their own row. Same counting rules as the dialer strip (src/leaderboard.js).
import { esc, api } from './core.js';
import { miniAvatar } from './avatar.js';

const KEY = 'rw-lb-days';
const LABEL = { 1: 'Today', 7: '7 days', 30: '30 days' };
const saved = () => { try { const n = Number(localStorage.getItem(KEY)); return LABEL[n] ? n : 1; } catch { return 1; } };
const save = (n) => { try { localStorage.setItem(KEY, String(n)); } catch { /* ignore */ } };

let cache = { days: 0, at: 0, data: null };
// Call after a booking so the next draw reads fresh numbers instead of the 45 second copy.
export const bustLeaderboard = () => { cache = { days: 0, at: 0, data: null }; };

const pct = (r) => (r == null ? '-' : `${r}%`);

export function leaderboardHtml(d, days) {
  const chips = Object.entries(LABEL).map(([n, t]) => `<button type="button" class="lb-chip${Number(n) === days ? ' on' : ''}" data-lbdays="${n}" aria-pressed="${Number(n) === days}">${t}</button>`).join('');
  const rows = d.agents.map((a, i) => `<tr class="${a.id === d.me ? 'me' : ''}">
      <td class="lb-who">${miniAvatar(a)}<span><b>${esc(a.name)}</b>${a.id === d.me ? '<em>You</em>' : i === 0 && a.booked > 0 ? '<em class="top">Most booked</em>' : ''}</span></td>
      <td class="num mono"><b>${a.booked}</b></td><td class="num mono">${a.talks}</td><td class="num mono"><b>${pct(a.rate)}</b></td><td class="num mono">${a.dials}</td><td class="num mono" title="Callbacks they set on a call">${a.callbacks || 0}</td><td class="num mono">${a.upcoming}</td></tr>`).join('');
  const other = d.other.booked || d.other.upcoming || d.other.callbacks
    ? `<tr class="oth"><td class="lb-who"><span class="mav gray">+</span><span><b>Online and unassigned</b><em>Not credited to anyone</em></span></td><td class="num mono"><b>${d.other.booked}</b></td><td class="num mono">-</td><td class="num mono">-</td><td class="num mono">-</td><td class="num mono">${d.other.callbacks || 0}</td><td class="num mono">${d.other.upcoming}</td></tr>` : '';
  return `<div class="card-head"><h2>Leaderboard</h2><div class="lb-chips" role="group" aria-label="Period">${chips}</div></div>
    ${d.agents.length ? `<div class="table-wrap"><table class="lb"><thead><tr><th>Agent</th><th class="num" title="Booked audits">Booked</th><th class="num" title="Conversations with an owner">Talks</th><th class="num" title="Booked audits divided by owner talks">Per talk</th><th class="num">Dials</th><th class="num" title="Callbacks set on a call (not bookings)">Callbacks</th><th class="num" title="Appointments they run that have not happened yet">Next</th></tr></thead>
      <tbody>${rows}${other}</tbody>
      <tfoot><tr><td>Team</td><td class="num mono">${d.team.booked}</td><td class="num mono">${d.team.talks}</td><td class="num mono">${pct(d.team.rate)}</td><td class="num mono">${d.team.dials}</td><td class="num mono">${d.team.callbacks || 0}</td><td class="num mono">${d.agents.reduce((s, a) => s + a.upcoming, 0) + d.other.upcoming}</td></tr></tfoot></table></div>
      <p class="small muted lb-note">Booked is audits booked. Talks are owner conversations. Per talk is booked audits divided by owner talks. Callbacks are times set to call back, and each one reminds the person who set it when it is due. Next is appointments they run that have not happened yet. ${d.handedOff ? `${d.handedOff} upcoming appointment${d.handedOff === 1 ? ' was' : 's were'} booked by one person and run by another, so it shows under the person who runs it.` : 'An appointment booked by one person and run by another shows under the person who runs it.'}</p>`
      : '<p class="muted">No agents yet.</p>'}`;
}

// Fills a card element (any element with a head and a body slot) and keeps its period buttons working.
export async function mountLeaderboard(box) {
  if (!box) return;
  const draw = (d, days) => {
    if (!document.body.contains(box)) return;
    box.innerHTML = leaderboardHtml(d, days);
    box.querySelectorAll('[data-lbdays]').forEach((b) => b.addEventListener('click', () => load(Number(b.dataset.lbdays), true)));
  };
  const load = async (days, force = false) => {
    save(days);
    if (!force && cache.data && cache.days === days && Date.now() - cache.at < 45e3) return draw(cache.data, days);
    if (cache.data && cache.days === days) draw(cache.data, days); // show the last numbers while the new ones load
    try {
      const since = new Date().setHours(0, 0, 0, 0);
      const d = await api(`/api/leaderboard?days=${days}&since=${since}`);
      cache = { days, at: Date.now(), data: d };
      draw(d, days);
    } catch (e) {
      if (document.body.contains(box)) box.innerHTML = `<div class="card-head"><h2>Leaderboard</h2></div><p class="err-text">${esc(e.message || 'Could not load')}</p>`;
    }
  };
  await load(saved());
}
