// Settings card: my available slots. Bookings outside these hours, past the daily limit or too close together are flagged before they are made.
import { $, $$, esc, api, toast, busy } from './core.js';
import { DAY_NAMES, availText } from '/js/avail.js';
import { ZONE_CHOICES } from '/js/apptime.js';

const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const mins = (v) => { const t = /^(\d{2}):(\d{2})$/.exec(v || ''); return t ? Number(t[1]) * 60 + Number(t[2]) : null; };

export async function availCard(box) {
  box.innerHTML = '<div class="skeleton" style="height:120px"></div>';
  let d;
  try { d = await api('/api/me/availability'); } catch (e) { box.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const av = d.avail || { tz: 'America/New_York', days: {}, max: 0, gap: 0 };
  const zones = [...new Map([[av.tz, ''], ...ZONE_CHOICES]).keys()];
  const row = (n) => {
    const spans = av.days[n] || [];
    const [a, b] = spans.length ? [spans[0][0], spans[spans.length - 1][1]] : [540, 1020];
    const brk = spans.length === 2 ? [spans[0][1], spans[1][0]] : null;
    return `<div class="av-row" data-d="${n}"><label class="av-on"><input type="checkbox" data-on${spans.length ? ' checked' : ''}> ${DAY_NAMES[n - 1]}</label>
      <input type="time" data-a value="${hm(a)}" step="900" aria-label="${DAY_NAMES[n - 1]} start"> <span class="muted">to</span> <input type="time" data-b value="${hm(b)}" step="900" aria-label="${DAY_NAMES[n - 1]} end">
      <label class="av-brk small"><input type="checkbox" data-brk${brk ? ' checked' : ''}> Break</label>
      <input type="time" data-ba value="${hm(brk ? brk[0] : 720)}" step="900" aria-label="Break start"> <span class="muted">to</span> <input type="time" data-bb value="${hm(brk ? brk[1] : 780)}" step="900" aria-label="Break end"></div>`;
  };
  box.innerHTML = `<div class="card-head"><h2>My available slots</h2><span class="badge ${d.avail ? '' : 'gray'}">${d.avail ? 'On' : 'Off'}</span></div>
    <p class="muted">The days and hours you take calls. Anyone booking you outside them, past your daily limit, or too close to another call gets a warning first. Leave it off and any time can be booked.</p>
    <form id="avf">
      <div class="row small" style="gap:8px;margin-bottom:8px"><span>Your time zone</span><select name="tz" style="width:auto;min-height:34px">${zones.map((z) => `<option value="${esc(z)}"${z === av.tz ? ' selected' : ''}>${esc((ZONE_CHOICES.find(([v]) => v === z)?.[1] || z.replace(/^.*\//, '').replace(/_/g, ' ')))}</option>`).join('')}</select>
        <span class="av-presets"><button type="button" class="linkbtn" data-preset="work">Weekdays 9 to 5</button><button type="button" class="linkbtn" data-preset="mornings">Weekdays 9 to 1</button><button type="button" class="linkbtn" data-preset="none">Clear days</button></span></div>
      <div class="av-grid">${[1, 2, 3, 4, 5, 6, 7].map(row).join('')}</div>
      <div class="row" style="gap:16px;margin:12px 0;flex-wrap:wrap">
        <label class="field" style="max-width:190px"><span>Most calls in a day (0 = no limit)</span><input type="number" name="max" min="0" max="30" value="${av.max || 0}"></label>
        <label class="field" style="max-width:190px"><span>Minutes between calls</span><select name="gap">${[0, 10, 15, 30, 45, 60].map((v) => `<option value="${v}"${v === (av.gap || 0) ? ' selected' : ''}>${v ? `${v} minutes` : 'No gap'}</option>`).join('')}</select></label></div>
      <p class="small muted" id="avsum" style="margin:0 0 10px">${esc(d.text)}</p>
      <div class="row" style="gap:6px"><button class="btn btn-primary btn-sm" type="submit">Save my hours</button><button class="btn btn-ghost btn-sm" type="button" id="avoff">Turn off</button></div></form>`;
  const f = $('#avf', box);
  const sync = () => $$('.av-row', f).forEach((r) => { const on = $('[data-on]', r).checked; const brk = $('[data-brk]', r).checked; r.classList.toggle('off', !on); $$('[data-a],[data-b],[data-brk]', r).forEach((i) => { i.disabled = !on; }); $$('[data-ba],[data-bb]', r).forEach((i) => { i.disabled = !on || !brk; }); });
  const read = () => {
    const days = {};
    for (const r of $$('.av-row', f)) {
      if (!$('[data-on]', r).checked) continue;
      const a = mins($('[data-a]', r).value), b = mins($('[data-b]', r).value);
      if (a == null || b == null || b <= a) throw new Error(`${DAY_NAMES[Number(r.dataset.d) - 1]}: the end must be after the start.`);
      if ($('[data-brk]', r).checked) {
        const x = mins($('[data-ba]', r).value), y = mins($('[data-bb]', r).value);
        if (x == null || y == null || y <= x || x <= a || y >= b) throw new Error(`${DAY_NAMES[Number(r.dataset.d) - 1]}: the break must sit inside your hours.`);
        days[r.dataset.d] = [[a, x], [y, b]];
      } else days[r.dataset.d] = [[a, b]];
    }
    return { tz: f.tz.value, days, max: Number(f.max.value) || 0, gap: Number(f.gap.value) || 0 };
  };
  const preview = () => { try { $('#avsum', box).textContent = availText(read()); } catch (e) { $('#avsum', box).textContent = e.message; } };
  f.addEventListener('change', () => { sync(); preview(); });
  $$('[data-preset]', f).forEach((b) => b.addEventListener('click', () => {
    const end = b.dataset.preset === 'mornings' ? '13:00' : '17:00';
    $$('.av-row', f).forEach((r) => { const wk = Number(r.dataset.d) <= 5 && b.dataset.preset !== 'none'; $('[data-on]', r).checked = wk; $('[data-a]', r).value = '09:00'; $('[data-b]', r).value = end; $('[data-brk]', r).checked = false; });
    sync(); preview();
  }));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    let avail;
    try { avail = read(); } catch (err) { toast(err.message, true); return; }
    busy(btn, true);
    try { await api('/api/me/availability', { method: 'PUT', body: { avail } }); toast('Saved'); availCard(box); } catch (err) { toast(err.message, true); busy(btn, false); }
  });
  $('#avoff', box).addEventListener('click', async () => { try { await api('/api/me/availability', { method: 'PUT', body: { clear: true } }); toast('Turned off. Any time can be booked.'); availCard(box); } catch (err) { toast(err.message, true); } });
  sync();
}
