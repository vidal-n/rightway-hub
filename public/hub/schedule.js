// Schedule tab (under My work): each person's week as blocks. Computers show the week grid, phones show one day at a time.
// A person edits their own; owners can open anyone's. New teammates start blank.
import { $, $$, esc, api, toast, busy, modal } from './core.js';
import { DAYS, DAY_SHORT, KINDS, KIND_KEYS, toMin, toHHMM, fmtMin, fmtSpan, hoursText, validateBlocks, blocksOn, nowAndNext, totals, dowOf, plannedDays } from '/js/schedule.js';

const PX = 0.95; // pixels per minute in the week grid

export async function scheduleView(view, user, userId, tabsHtml) {
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Fulfillment</p><h1>My schedule</h1></div></div>${tabsHtml}<div class="skeleton"></div>`;
  let d;
  const load = async () => { d = await api(`/api/schedule${userId ? `?user=${encodeURIComponent(userId)}` : ''}`); };
  try { await load(); } catch (e) { view.querySelector('.skeleton')?.replaceWith(Object.assign(document.createElement('p'), { className: 'err-text', textContent: e.message })); return; }

  let editing = false;
  let day = dowOf();
  let dirty = false;
  let blocks = d.blocks.map((b) => ({ ...b }));
  let dials = null;
  const timer = setInterval(() => { if (!document.body.contains(view)) clearInterval(timer); else paintNow(); }, 30e3);
  if (d.isMe) api('/api/agents').then((a) => { const me = a.agents.find((x) => x.id === a.me); dials = me?.today?.dials ?? null; paintNow(); }).catch(() => {});

  const range = () => {
    const mins = blocks.flatMap((b) => [b.start_min, b.end_min]);
    const lo = Math.min(7 * 60, ...mins), hi = Math.max(18 * 60, ...mins);
    return [Math.floor(lo / 60) * 60, Math.ceil(hi / 60) * 60];
  };
  const chip = (b) => `<span class="sch-k" style="--k:${KINDS[b.kind]?.color || '#64748B'}">${esc(KINDS[b.kind]?.label || 'Other')}</span>`;
  const goalText = (b) => (b.goal ? `${b.goal} ${KINDS[b.kind]?.goalUnit || ''}`.trim() : '');

  function paintNow() {
    const box = $('#schnow', view); if (!box) return;
    if (!d.isMe) { box.innerHTML = ''; return; }
    const t = new Date();
    const r = nowAndNext(blocks, dowOf(t), t.getHours() * 60 + t.getMinutes());
    const dialGoal = totals(blocks, dowOf(t)).goalDials;
    const goal = dialGoal && dials != null ? `<span class="sch-goal"><b>${dials}</b> of ${dialGoal} dials today</span>` : '';
    if (!blocks.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="sch-now${r.now ? '' : ' idle'}">
      <div><p class="eyebrow">${r.now ? 'Right now' : r.next ? 'Next up' : 'Done for today'}</p>
        <h2>${r.now ? esc(r.now.title) : r.next ? esc(r.next.title) : 'Nothing else planned today'}</h2>
        <p class="small">${r.now ? `${esc(fmtSpan(r.now.start_min, r.now.end_min))} · ${esc(hoursText(r.left))} left${goalText(r.now) ? ` · goal ${esc(goalText(r.now))}` : ''}${r.next ? ` · then ${esc(r.next.title)} at ${esc(fmtMin(r.next.start_min))}` : ''}` : r.next ? `${esc(fmtMin(r.next.start_min))}, in ${esc(r.until >= 60 ? hoursText(r.until) : `${r.until} min`)}` : ''}</p>
        ${r.now?.note ? `<p class="sch-note">${esc(r.now.note)}</p>` : ''}</div>
      ${goal}</div>`;
  }

  function weekGrid() {
    const [lo, hi] = range();
    const hours = []; for (let m = lo; m < hi; m += 60) hours.push(m);
    const H = (hi - lo) * PX;
    return `<div class="sch-week" style="--h:${H}px"><div class="sch-gutter">${hours.map((m) => `<span style="top:${(m - lo) * PX}px">${esc(fmtMin(m))}</span>`).join('')}</div>
      ${DAYS.map((n, i) => {
        const dow = i + 1; const tt = totals(blocks, dow);
        return `<div class="sch-col${dow === dowOf() ? ' today' : ''}"><div class="sch-dh"><b>${DAY_SHORT[i]}</b><small>${tt.minutes ? hoursText(tt.minutes) : ''}${tt.goalDials ? ` · ${tt.goalDials} dials` : ''}</small></div>
          <div class="sch-lane" data-dow="${dow}" style="height:${H}px">${hours.map((m) => `<i style="top:${(m - lo) * PX}px"></i>`).join('')}
            ${blocksOn(blocks, dow).map((b) => { const idx = blocks.indexOf(b); const h = (b.end_min - b.start_min) * PX; return `<button type="button" class="sch-b${h < 26 ? ' short' : ''}" data-i="${idx}" style="top:${(b.start_min - lo) * PX}px;height:${Math.max(13, h - 2)}px;--k:${KINDS[b.kind]?.color || '#64748B'}" title="${esc(`${b.title}, ${fmtSpan(b.start_min, b.end_min)}${goalText(b) ? `, goal ${goalText(b)}` : ''}`)}"><b>${esc(b.title)}</b>${h > 34 ? `<small>${esc(fmtSpan(b.start_min, b.end_min))}</small>` : ''}${h > 62 && goalText(b) ? `<small class="g">${esc(goalText(b))}</small>` : ''}</button>`; }).join('')}</div></div>`;
      }).join('')}</div>`;
  }

  function dayList() {
    const list = blocksOn(blocks, day);
    const tt = totals(blocks, day);
    return `<div class="sch-days seg">${DAY_SHORT.map((n, i) => `<button type="button" data-day="${i + 1}" class="${day === i + 1 ? 'is-on' : ''}">${n}</button>`).join('')}</div>
      <div class="sch-list"><p class="small muted" style="margin:6px 2px">${esc(DAYS[day - 1])}${tt.minutes ? ` · ${esc(hoursText(tt.minutes))} planned` : ''}${tt.goalDials ? ` · ${tt.goalDials} dials` : ''}</p>
      ${list.map((b) => `<button type="button" class="sch-item" data-i="${blocks.indexOf(b)}" style="--k:${KINDS[b.kind]?.color || '#64748B'}"><span class="sch-time">${esc(fmtMin(b.start_min))}<small>${esc(fmtMin(b.end_min))}</small></span><span class="sch-body"><b>${esc(b.title)}</b>${chip(b)}${goalText(b) ? `<span class="small"> ${esc(goalText(b))}</span>` : ''}${b.note ? `<small>${esc(b.note)}</small>` : ''}</span></button>`).join('') || `<p class="muted" style="padding:14px 4px">Nothing planned${editing ? '. Tap Add a block.' : ' for this day.'}</p>`}</div>`;
  }

  function summary() {
    const tt = totals(blocks);
    const per = Object.entries(tt.per).filter(([k]) => k !== 'break').sort((a, b) => b[1] - a[1]);
    if (!per.length) return '';
    const days = plannedDays(blocks).length;
    return `<div class="sch-sum card"><div class="card-head"><h3>This week</h3><span class="small muted">${esc(hoursText(tt.minutes))} over ${days} day${days === 1 ? '' : 's'}</span></div>
      <div class="sch-bars">${per.map(([k, m]) => `<div><span class="sch-k" style="--k:${KINDS[k]?.color}">${esc(KINDS[k]?.label || k)}</span><i style="width:${Math.max(4, (100 * m) / tt.minutes)}%;background:${KINDS[k]?.color}"></i><b>${esc(hoursText(m))}</b></div>`).join('')}</div></div>`;
  }

  function draw() {
    view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Fulfillment</p><h1>${d.isMe ? 'My schedule' : `${esc(d.person.name)}'s schedule`}</h1></div>
        <div class="row">${d.owner && d.people.length > 1 ? `<select id="schwho" style="width:auto;min-height:38px" aria-label="Whose schedule">${d.people.map((p) => `<option value="${esc(p.id)}"${p.id === d.person.id ? ' selected' : ''}>${esc(p.name)}${p.id === d.person.id && d.isMe ? ' (me)' : ''}${p.blocks ? '' : ' · blank'}</option>`).join('')}</select>` : ''}
          ${editing ? `<button class="btn btn-ghost btn-sm" id="schadd">Add a block</button><button class="btn btn-primary btn-sm" id="schsave">${dirty ? 'Save changes' : 'Done'}</button>` : '<button class="btn btn-ghost btn-sm" id="schprint">Print</button><button class="btn btn-primary btn-sm" id="schedit">Edit schedule</button>'}</div></div>
      ${tabsHtml}
      <div id="schnow"></div>
      ${blocks.length ? `<div class="sch-wide">${weekGrid()}</div><div class="sch-narrow">${dayList()}</div>${summary()}`
        : `<div class="card empty"><h3>${d.isMe ? 'Your schedule is blank' : `${esc(d.person.name)} has no schedule yet`}</h3><p>Add blocks for the hours you work, what you do in each one, and a goal like dials. Or start from a ready made week and change it.</p>
          <div class="row" style="justify-content:center"><button class="btn btn-primary" id="schadd">Add the first block</button>${d.owner ? '<button class="btn btn-ghost" data-starter="owner">Use the owner week</button>' : ''}<button class="btn btn-ghost" data-starter="setter">Use a dial day starter</button></div></div>`}
      ${editing && blocks.length ? '<p class="small muted" style="margin-top:10px">Click a block to change it, or click an empty spot in a day to add one there. Changes are saved when you press Save.</p>' : ''}
      ${blocks.length ? `<details class="fold" style="margin-top:14px"><summary><span>Starters</span></summary><div class="fold-body"><p class="small muted" style="margin-top:0">Replaces the whole week with a ready made one. You can change everything after.</p><div class="row">${d.owner ? '<button class="btn btn-ghost btn-sm" data-starter="owner">Owner week</button>' : ''}<button class="btn btn-ghost btn-sm" data-starter="setter">Dial day starter</button><button class="btn btn-ghost btn-sm" data-starter="blank">Clear everything</button></div></div></details>` : ''}`;
    paintNow();
    wire();
  }

  async function persist() {
    const v = validateBlocks(blocks);
    if (!v.ok) { toast(v.error, true); return false; }
    try { const r = await api(`/api/schedule/${d.person.id}`, { method: 'PUT', body: { blocks: v.blocks } }); blocks = r.blocks.map((b) => ({ ...b })); dirty = false; return true; }
    catch (e) { toast(e.message, true); return false; }
  }

  function editBlock(i, preset = {}) {
    const b = i != null ? blocks[i] : { dow: preset.dow || day, start_min: preset.start || toMin('09:00'), end_min: preset.end || toMin('10:00'), title: '', kind: 'dial', goal: null, note: '' };
    const m = modal(`<div class="card-head"><h2>${i != null ? 'Change this block' : 'Add a block'}</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
      <form id="bf" class="form-grid" style="grid-template-columns:1fr 1fr;gap:12px">
        <label class="field" style="grid-column:1/-1"><span>What is it</span><input id="bt" maxlength="80" value="${esc(b.title)}" placeholder="Power dial, build the Hub, client calls..." required></label>
        <label class="field"><span>Starts</span><input id="bs" type="time" value="${toHHMM(b.start_min)}" required></label>
        <label class="field"><span>Ends</span><input id="be" type="time" value="${toHHMM(b.end_min)}" required></label>
        <label class="field"><span>Kind</span><select id="bk">${KIND_KEYS.map((k) => `<option value="${k}"${k === b.kind ? ' selected' : ''}>${esc(KINDS[k].label)}</option>`).join('')}</select></label>
        <label class="field"><span id="bgl">Goal${KINDS[b.kind].goalUnit ? ` (${KINDS[b.kind].goalUnit})` : ''}</span><input id="bg" inputmode="numeric" value="${b.goal || ''}" placeholder="Optional"></label>
        <div class="field" style="grid-column:1/-1"><span>Days${i != null ? ' (tick more days to copy it there, replacing the same block)' : ''}</span><div class="sch-dpick">${DAY_SHORT.map((n, k) => `<label><input type="checkbox" name="bd" value="${k + 1}"${(k + 1) === b.dow ? ' checked' : ''}><span>${n}</span></label>`).join('')}</div></div>
        <label class="field" style="grid-column:1/-1"><span>What to do in it (notes for yourself)</span><textarea id="bn" rows="3" maxlength="600" placeholder="The plan for this block">${esc(b.note || '')}</textarea></label>
        <div class="row" style="grid-column:1/-1;justify-content:space-between"><div class="row">${i != null ? '<button type="button" class="btn btn-danger btn-sm" id="bdel">Delete</button>' : ''}</div><button class="btn btn-primary" id="bok">${i != null ? 'Update block' : 'Add block'}</button></div>
      </form>`);
    const el = m.el;
    $('#bk', el).addEventListener('change', (e) => { $('#bgl', el).textContent = `Goal${KINDS[e.target.value].goalUnit ? ` (${KINDS[e.target.value].goalUnit})` : ''}`; });
    $('#bdel', el)?.addEventListener('click', () => { blocks.splice(i, 1); dirty = true; m.close(); draw(); });
    $('#bf', el).addEventListener('submit', (e) => {
      e.preventDefault();
      const days = $$('[name="bd"]:checked', el).map((x) => Number(x.value));
      if (!days.length) return toast('Pick a day.', true);
      const base = { title: $('#bt', el).value.trim(), start_min: toMin($('#bs', el).value), end_min: toMin($('#be', el).value), kind: $('#bk', el).value, goal: $('#bg', el).value.trim(), note: $('#bn', el).value.trim() };
      const orig = i != null ? blocks[i] : null;
      const same = (x) => orig && x.title === orig.title && x.start_min === orig.start_min && x.end_min === orig.end_min;
      const next = i != null ? blocks.filter((x, k) => k !== i && !(days.includes(x.dow) && same(x))) : [...blocks];
      for (const dow of days) next.push({ ...base, dow });
      const v = validateBlocks(next);
      if (!v.ok) return toast(v.error, true);
      blocks = v.blocks; dirty = true; if (days.length === 1) day = days[0]; m.close(); draw();
    });
  }

  function wire() {
    $('#schwho', view)?.addEventListener('change', (e) => { location.hash = e.target.value === user.id ? '#/work/schedule' : `#/work/schedule/${e.target.value}`; });
    $('#schedit', view)?.addEventListener('click', () => { editing = true; draw(); });
    $('#schprint', view)?.addEventListener('click', () => window.print());
    $('#schadd', view)?.addEventListener('click', () => { editing = true; editBlock(null); });
    $('#schsave', view)?.addEventListener('click', async (e) => {
      if (!dirty) { editing = false; draw(); return; }
      busy(e.currentTarget, true, 'Saving...');
      const ok = await persist();
      if (ok) { editing = false; toast('Schedule saved.'); draw(); } else busy(e.currentTarget, false);
    });
    $$('[data-day]', view).forEach((b) => b.addEventListener('click', () => { day = Number(b.dataset.day); draw(); }));
    $$('[data-i]', view).forEach((b) => b.addEventListener('click', () => {
      if (editing) editBlock(Number(b.dataset.i));
      else { const x = blocks[Number(b.dataset.i)]; modal(`<div class="card-head"><div><p class="eyebrow">${esc(DAYS[x.dow - 1])} · ${esc(fmtSpan(x.start_min, x.end_min))}</p><h2>${esc(x.title)}</h2></div><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
        <p>${chip(x)}${goalText(x) ? ` <b>Goal: ${esc(goalText(x))}</b>` : ''}</p>${x.note ? `<p style="white-space:pre-wrap">${esc(x.note)}</p>` : '<p class="muted">No notes.</p>'}`); }
    }));
    // Click an empty spot in a day (edit mode) to start a block there, snapped to 15 minutes.
    $$('.sch-lane', view).forEach((lane) => lane.addEventListener('click', (e) => {
      if (!editing || e.target.closest('.sch-b')) return;
      const [lo] = range();
      const y = e.clientY - lane.getBoundingClientRect().top;
      const start = Math.min(23 * 60, lo + Math.round(y / PX / 15) * 15);
      editBlock(null, { dow: Number(lane.dataset.dow), start, end: Math.min(1440, start + 60) });
    }));
    $$('[data-starter]', view).forEach((b) => b.addEventListener('click', async () => {
      const name = { owner: 'the owner week', setter: 'the dial day starter', blank: 'a blank week' }[b.dataset.starter];
      if (blocks.length && !confirm(`Replace the whole schedule with ${name}?`)) return;
      busy(b, true);
      try { const r = await api(`/api/schedule/${d.person.id}/starter`, { method: 'POST', body: { starter: b.dataset.starter } }); blocks = r.blocks.map((x) => ({ ...x })); dirty = false; editing = false; toast('Schedule loaded.'); draw(); }
      catch (e) { toast(e.message, true); busy(b, false); }
    }));
  }

  // Leaving with unsaved edits asks first.
  const guard = (e) => { if (dirty && document.body.contains(view)) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', guard);
  draw();
}
