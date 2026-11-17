// Leaderboard widget (Nov 2026, V: the team's bookings get their own widget on the Dialer and the Dashboard, so the Coming up bar can stay
// his own). Modeled on the rep leaderboards in Close.com Reports and the Orum and Nooks team boards.
// Per person: booked, owner talks, booked per owner talk (the conversion rate), dials, callbacks and the appointments they run. Online bookings with
// no rep behind them sit on their own row. Same counting rules as the dialer strip (src/leaderboard.js).
// Outside the team (friendly competition, owners type in each day's numbers): a second table that never counts in the Hub's analytics.
import { esc, api, toast } from './core.js';
import { miniAvatar } from './avatar.js';

const KEY = 'rw-lb-days';
const LABEL = { 1: 'Today', 7: '7 days', 30: '30 days' };
const saved = () => { try { const n = Number(localStorage.getItem(KEY)); return LABEL[n] ? n : 1; } catch { return 1; } };
const save = (n) => { try { localStorage.setItem(KEY, String(n)); } catch { /* ignore */ } };

let cache = { days: 0, at: 0, data: null };
// Call after a booking so the next draw reads fresh numbers instead of the 45 second copy.
export const bustLeaderboard = () => { cache = { days: 0, at: 0, data: null }; };
// The owner's entry form remembers who and which day it was on across redraws.
let keep = { rival: null, date: null };

const pct = (r) => (r == null ? '-' : `${r}%`);
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';

function outsideHtml(d, canEdit) {
  const o = d.outside || { list: [], total: { dials: 0, talks: 0, booked: 0, callbacks: 0, rate: null } };
  const rows = o.list.map((r) => `<tr>
      <td class="lb-who"><span class="mav gray">${esc(initials(r.name))}</span><span><b>${esc(r.name)}</b></span></td>
      <td class="num mono"><b>${r.booked}</b></td><td class="num mono">${r.talks}</td><td class="num mono"><b>${pct(r.rate)}</b></td><td class="num mono">${r.dials}</td><td class="num mono">${r.callbacks}</td>
      ${canEdit ? `<td class="num"><button type="button" class="lb-rm" data-rv-del="${esc(r.id)}" data-name="${esc(r.name)}">Remove</button></td>` : ''}</tr>`).join('');
  const t = o.total;
  const team = d.team || {};
  const head = `<tr><th>Name</th><th class="num" title="Booked audits">Booked</th><th class="num" title="Conversations with an owner">Talks</th><th class="num" title="Booked audits divided by owner talks">Per talk</th><th class="num">Dials</th><th class="num" title="Callbacks set on a call">Callbacks</th>${canEdit ? '<th></th>' : ''}</tr>`;
  const table = o.list.length
    ? `<div class="table-wrap"><table class="lb lb-out"><thead>${head}</thead><tbody>${rows}</tbody>
        <tfoot><tr><td>Outside total</td><td class="num mono">${t.booked}</td><td class="num mono">${t.talks}</td><td class="num mono">${pct(t.rate)}</td><td class="num mono">${t.dials}</td><td class="num mono">${t.callbacks}</td>${canEdit ? '<td></td>' : ''}</tr></tfoot></table></div>`
    : '<p class="muted">No outside players yet.</p>';
  const versus = o.list.length
    ? `<p class="lb-versus"><b>Rightway team</b> ${team.booked || 0} booked, ${pct(team.rate)} per talk &middot; <b>Outside</b> ${t.booked} booked, ${pct(t.rate)} per talk</p>`
    : '';
  const names = o.list.map((r) => `<option value="${esc(r.id)}"${keep.rival === r.id ? ' selected' : ''}>${esc(r.name)}</option>`).join('');
  const add = canEdit ? `<form class="lb-add" data-rv-addform>
      <input name="newname" maxlength="80" placeholder="Add a name, e.g. Josh" aria-label="Name to add">
      <button type="submit" class="btn small">Add</button></form>` : '';
  const enter = canEdit && o.list.length ? `<details class="lb-enter" data-rv-enter ${keep.rival ? 'open' : ''}>
      <summary>Enter a day's numbers</summary>
      <div class="lb-enter-grid">
        <label>Who<select data-rv-who>${names}</select></label>
        <label>Day<input type="date" data-rv-date value="${esc(keep.date || ymd())}"></label>
        <label>Dials<input type="number" min="0" data-rv-f="dials" value="0"></label>
        <label>Talks<input type="number" min="0" data-rv-f="talks" value="0"></label>
        <label>Booked<input type="number" min="0" data-rv-f="booked" value="0"></label>
        <label>Callbacks<input type="number" min="0" data-rv-f="callbacks" value="0"></label>
        <button type="button" class="btn small" data-rv-save>Save the day</button>
      </div></details>` : '';
  return `<div class="lb-outside">
      <h3>Outside the team</h3>
      <p class="small muted lb-note">Friendly competition only. These numbers are typed in by hand and never count in the Hub's reports, analytics, bookings or dials.</p>
      ${versus}${table}${add}${enter}
    </div>`;
}

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
      : '<p class="muted">No agents yet.</p>'}
    ${outsideHtml(d, Boolean(d.canEdit))}`;
}

// Fills a card element (any element with a head and a body slot) and keeps its period buttons and outside entry working.
export async function mountLeaderboard(box) {
  if (!box) return;
  const draw = (d, days) => {
    if (!document.body.contains(box)) return;
    box.innerHTML = leaderboardHtml(d, days);
    box.querySelectorAll('[data-lbdays]').forEach((b) => b.addEventListener('click', () => load(Number(b.dataset.lbdays), true)));
    wireOutside(d, days);
  };
  const wireOutside = (d, days) => {
    if (!d.canEdit) return;
    box.querySelector('[data-rv-addform]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = e.currentTarget.querySelector('input[name="newname"]');
      const name = String(input.value || '').trim();
      if (!name) return toast('Type a name.', true);
      try { await api('/api/rivals', { method: 'POST', body: { name } }); toast(`${name} added`); bustLeaderboard(); load(days, true); }
      catch (err) { toast(err.message, true); }
    });
    box.querySelectorAll('[data-rv-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`Remove ${b.dataset.name} and all their numbers?`)) return;
      try { await api(`/api/rivals/${b.dataset.rvDel}`, { method: 'DELETE' }); toast(`${b.dataset.name} removed`); keep = { rival: null, date: null }; bustLeaderboard(); load(days, true); }
      catch (err) { toast(err.message, true); }
    }));
    const who = box.querySelector('[data-rv-who]');
    const date = box.querySelector('[data-rv-date]');
    const fields = () => Object.fromEntries([...box.querySelectorAll('[data-rv-f]')].map((i) => [i.dataset.rvF, i]));
    // Shows what is already typed in for that person and day, so a correction starts from the saved numbers.
    const fill = async () => {
      if (!who || !date || !who.value || !date.value) return;
      keep = { rival: who.value, date: date.value };
      try {
        const r = await api(`/api/rivals/${who.value}/day?date=${date.value}`);
        const f = fields();
        for (const k of ['dials', 'talks', 'booked', 'callbacks']) f[k].value = r[k] || 0;
      } catch (err) { toast(err.message, true); }
    };
    who?.addEventListener('change', fill);
    date?.addEventListener('change', fill);
    box.querySelector('[data-rv-save]')?.addEventListener('click', async () => {
      if (!who?.value || !date?.value) return toast('Pick a name and a day.', true);
      const f = fields();
      const body = { date: date.value };
      for (const k of ['dials', 'talks', 'booked', 'callbacks']) body[k] = Number(f[k].value) || 0;
      if (body.talks > body.dials) return toast('Talks cannot be more than dials.', true);
      try {
        await api(`/api/rivals/${who.value}/day`, { method: 'PUT', body });
        keep = { rival: who.value, date: date.value };
        toast('Saved');
        bustLeaderboard();
        load(days, true);
      } catch (err) { toast(err.message, true); }
    });
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
