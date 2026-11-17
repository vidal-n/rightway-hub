// Leaderboard widget (Nov 2026, V: the team's bookings get their own widget on the Dialer and the Dashboard, so the Coming up bar can stay
// his own). Modeled on the rep leaderboards in Close.com Reports and the Orum and Nooks team boards.
// Per person: booked, owner talks, booked per owner talk (the conversion rate), dials, callbacks and the appointments they run. Online bookings with
// no rep behind them sit on their own row. Same counting rules as the dialer strip (src/leaderboard.js).
// Outside the team (friendly competition): owners type the numbers straight into the table (Nov 2026, V: no form, edit the table, the
// percentage works itself out). A number typed is the total for the period on screen. Never counted in the Hub's analytics.
// Inline cell editing is modeled on Airtable and Google Sheets grids.
import { esc, api, toast } from './core.js';
import { miniAvatar } from './avatar.js';

const KEY = 'rw-lb-days';
const LABEL = { 1: 'Today', 7: '7 days', 30: '30 days' };
const FIELDS = ['booked', 'talks', 'dials', 'callbacks'];
const saved = () => { try { const n = Number(localStorage.getItem(KEY)); return LABEL[n] ? n : 1; } catch { return 1; } };
const save = (n) => { try { localStorage.setItem(KEY, String(n)); } catch { /* ignore */ } };

let cache = { days: 0, at: 0, data: null };
// Call after a booking so the next draw reads fresh numbers instead of the 45 second copy.
export const bustLeaderboard = () => { cache = { days: 0, at: 0, data: null }; };

export const rateOf = (booked, talks) => (talks > 0 ? Math.round((1000 * booked) / talks) / 10 : null);
const pct = (r) => (r == null ? '-' : `${r}%`);
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
const sinceNow = () => new Date().setHours(0, 0, 0, 0);

// The outside rows sit in the same table as the team (their own section), so the columns line up.
function outsideParts(d, canEdit) {
  const o = d.outside || { list: [], total: { dials: 0, talks: 0, booked: 0, callbacks: 0, rate: null } };
  if (!o.list.length && !canEdit) return { body: '', below: '' };
  const cell = (r, f) => (canEdit
    ? `<td class="num"><input class="lb-in mono" type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" data-rv="${esc(r.id)}" data-f="${f}" value="${r[f]}" aria-label="${esc(r.name)} ${f}"></td>`
    : `<td class="num mono">${f === 'booked' ? `<b>${r[f]}</b>` : r[f]}</td>`);
  const rows = o.list.map((r) => `<tr data-row="${esc(r.id)}">
      <td><div class="lb-who"><span class="mav gray">${esc(initials(r.name))}</span><span><b>${esc(r.name)}</b></span>${canEdit ? `<button type="button" class="lb-rm" data-rv-del="${esc(r.id)}" data-name="${esc(r.name)}" title="Remove ${esc(r.name)}" aria-label="Remove ${esc(r.name)}">×</button>` : ''}</div></td>
      ${cell(r, 'booked')}${cell(r, 'talks')}<td class="num mono" data-rate><b>${pct(r.rate)}</b></td>${cell(r, 'dials')}${cell(r, 'callbacks')}<td class="num mono muted">-</td></tr>`).join('');
  const t = o.total;
  const team = d.team || {};
  const body = o.list.length ? `<tbody class="lb-out"><tr class="lb-sec"><th colspan="7">Outside the team <span title="Friendly competition. Typed in by hand, never counted in the Hub's numbers.">(for fun, not in our numbers)</span></th></tr>${rows}
      <tr class="lb-tot"><td>Outside total</td><td class="num mono" data-tot="booked">${t.booked}</td><td class="num mono" data-tot="talks">${t.talks}</td><td class="num mono" data-tot="rate">${pct(t.rate)}</td><td class="num mono" data-tot="dials">${t.dials}</td><td class="num mono" data-tot="callbacks">${t.callbacks}</td><td></td></tr></tbody>` : '';
  const below = `${o.list.length ? `<p class="lb-versus"><b>Rightway</b> ${team.booked || 0} booked, ${pct(team.rate)} per talk <span class="vs">vs</span> <b>Outside</b> <span data-vs-booked>${t.booked}</span> booked, <span data-vs-rate>${pct(t.rate)}</span> per talk</p>` : ''}
      ${canEdit ? `<form class="lb-add" data-rv-addform><input name="newname" maxlength="80" placeholder="Add someone outside the team" aria-label="Name to add"><button type="submit" class="btn btn-ghost btn-sm">Add</button></form>` : ''}`;
  return { body, below };
}

export function leaderboardHtml(d, days) {
  const chips = Object.entries(LABEL).map(([n, t]) => `<button type="button" class="lb-chip${Number(n) === days ? ' on' : ''}" data-lbdays="${n}" aria-pressed="${Number(n) === days}">${t}</button>`).join('');
  const rows = d.agents.map((a, i) => `<tr class="${a.id === d.me ? 'me' : ''}">
      <td><div class="lb-who">${miniAvatar(a)}<span><b>${esc(a.name)}</b>${a.id === d.me ? '<em>You</em>' : i === 0 && a.booked > 0 ? '<em class="top">Most booked</em>' : ''}</span></div></td>
      <td class="num mono"><b>${a.booked}</b></td><td class="num mono">${a.talks}</td><td class="num mono"><b>${pct(a.rate)}</b></td><td class="num mono">${a.dials}</td><td class="num mono">${a.callbacks || 0}</td><td class="num mono">${a.upcoming}</td></tr>`).join('');
  const other = d.other.booked || d.other.upcoming || d.other.callbacks
    ? `<tr class="oth"><td><div class="lb-who"><span class="mav gray">+</span><span><b>Online and unassigned</b><em>Not credited to anyone</em></span></div></td><td class="num mono"><b>${d.other.booked}</b></td><td class="num mono">-</td><td class="num mono">-</td><td class="num mono">-</td><td class="num mono">${d.other.callbacks || 0}</td><td class="num mono">${d.other.upcoming}</td></tr>` : '';
  const out = outsideParts(d, Boolean(d.canEdit));
  return `<div class="card-head"><h2>Leaderboard</h2><div class="lb-chips" role="group" aria-label="Period">${chips}</div></div>
    ${d.agents.length ? `<div class="table-wrap"><table class="lb"><thead><tr><th>Agent</th><th class="num" title="Audits booked">Booked</th><th class="num" title="Conversations with an owner">Talks</th><th class="num" title="Booked divided by owner talks">Per talk</th><th class="num">Dials</th><th class="num" title="Callbacks set on a call. Each one reminds the person who set it when it is due.">Callbacks</th><th class="num" title="Appointments they run that have not happened yet">Next</th></tr></thead>
      <tbody>${rows}${other}<tr class="lb-tot"><td>Team</td><td class="num mono">${d.team.booked}</td><td class="num mono">${d.team.talks}</td><td class="num mono">${pct(d.team.rate)}</td><td class="num mono">${d.team.dials}</td><td class="num mono">${d.team.callbacks || 0}</td><td class="num mono">${d.agents.reduce((s, a) => s + a.upcoming, 0) + d.other.upcoming}</td></tr></tbody>
      ${out.body}</table></div>${out.below}`
      : '<p class="muted">No agents yet.</p>'}`;
}

// Fills a card element and keeps its period buttons and the outside table editing working.
export async function mountLeaderboard(box) {
  if (!box) return;
  const draw = (d, days) => {
    if (!document.body.contains(box)) return;
    box.innerHTML = leaderboardHtml(d, days);
    box.querySelectorAll('[data-lbdays]').forEach((b) => b.addEventListener('click', () => load(Number(b.dataset.lbdays), true)));
    if (d.canEdit) wireOutside(d, days);
  };
  // Recount one row's per talk, the outside totals and the "vs" line from what is in the boxes right now.
  const recount = (d) => {
    const list = d.outside?.list || [];
    const tot = { dials: 0, talks: 0, booked: 0, callbacks: 0 };
    for (const r of list) {
      const tr = box.querySelector(`tr[data-row="${CSS.escape(r.id)}"]`);
      if (!tr) continue;
      for (const f of FIELDS) {
        const inp = tr.querySelector(`input[data-f="${f}"]`);
        const n = inp ? Math.max(0, Math.round(Number(inp.value) || 0)) : r[f];
        r[f] = n; tot[f] += n;
      }
      r.rate = rateOf(r.booked, r.talks);
      const rc = tr.querySelector('[data-rate] b'); if (rc) rc.textContent = pct(r.rate);
    }
    const rate = rateOf(tot.booked, tot.talks);
    d.outside.total = { ...tot, rate };
    for (const f of FIELDS) { const c = box.querySelector(`[data-tot="${f}"]`); if (c) c.textContent = tot[f]; }
    const rc = box.querySelector('[data-tot="rate"]'); if (rc) rc.textContent = pct(rate);
    const vb = box.querySelector('[data-vs-booked]'); if (vb) vb.textContent = tot.booked;
    const vr = box.querySelector('[data-vs-rate]'); if (vr) vr.textContent = pct(rate);
  };
  const wireOutside = (d, days) => {
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
      try { await api(`/api/rivals/${b.dataset.rvDel}`, { method: 'DELETE' }); toast(`${b.dataset.name} removed`); bustLeaderboard(); load(days, true); }
      catch (err) { toast(err.message, true); }
    }));
    box.querySelectorAll('input.lb-in').forEach((inp) => {
      let last = inp.value;
      inp.addEventListener('focus', () => inp.select());
      inp.addEventListener('input', () => { inp.value = inp.value.replace(/[^0-9]/g, '').slice(0, 6); recount(d); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } if (e.key === 'Escape') { inp.value = last; recount(d); inp.blur(); } });
      inp.addEventListener('change', async () => {
        const v = Math.max(0, Math.round(Number(inp.value) || 0));
        inp.value = String(v);
        if (String(v) === last) return;
        inp.classList.add('saving');
        try {
          await api(`/api/rivals/${inp.dataset.rv}/totals`, { method: 'PUT', body: { days, since: sinceNow(), [inp.dataset.f]: v } });
          last = String(v);
          inp.classList.remove('saving'); inp.classList.add('saved'); setTimeout(() => inp.classList.remove('saved'), 900);
          if (cache.data === d) cache.at = Date.now();
        } catch (err) { inp.classList.remove('saving'); inp.value = last; recount(d); toast(err.message, true); }
      });
    });
  };
  const load = async (days, force = false) => {
    save(days);
    // Never redraw under someone typing in the table.
    if (box.contains(document.activeElement) && document.activeElement.matches('input')) return;
    if (!force && cache.data && cache.days === days && Date.now() - cache.at < 45e3) return draw(cache.data, days);
    if (cache.data && cache.days === days) draw(cache.data, days); // show the last numbers while the new ones load
    try {
      const d = await api(`/api/leaderboard?days=${days}&since=${sinceNow()}`);
      cache = { days, at: Date.now(), data: d };
      draw(d, days);
    } catch (e) {
      if (document.body.contains(box)) box.innerHTML = `<div class="card-head"><h2>Leaderboard</h2></div><p class="err-text">${esc(e.message || 'Could not load')}</p>`;
    }
  };
  await load(saved());
}
