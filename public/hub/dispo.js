// Call dispositions: the list (owners can customize it), the popup after each call, and the editor in Phone setup.
import { $, $$, esc, api, toast, busy, modal } from './core.js';

let cache = null;
export async function loadDispos(force = false) {
  if (!cache || force) cache = api('/api/dispositions').catch((e) => { cache = null; throw e; });
  return cache;
}
export const clearDispos = () => { cache = null; };

// Each disposition gets a number key 1 to 9 in list order.
export const keyed = (list) => list.map((d, i) => ({ ...d, key: i < 9 ? String(i + 1) : '' }));
export const needsTime = (d) => d && (d.acts === 'callback' || d.acts === 'booked');

// The popup after a call ends. onSave gets { dispo, note, callbackAt, newLead } and does the saving; it may throw to keep the popup open.
export async function dispositionModal({ title = 'How did the call go?', sub = '', answered = false, askLead = false, number = '', person = '', business = '', facts = [], note = '', callbackAt = '', onSave, onSkip } = {}) {
  let list;
  try { list = keyed((await loadDispos()).dispositions); } catch (e) { toast(e.message, true); return; }
  // A callback time tapped during the call picks the callback result for them.
  const suggest = callbackAt ? (list.find((d) => d.acts === 'callback') || {}).id : answered ? '' : (list.find((d) => d.acts === 'no_answer') || {}).id;
  let pick = suggest || '';
  const initials = String(person || business || '#').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '#';
  const m = modal(`
    <div class="card-head"><div class="dp-who">${person || business ? `<span class="pd-av">${esc(initials)}</span>` : ''}<div style="min-width:0"><h2 style="margin:0">${esc(person || title)}</h2>${person || business ? `<div class="pd-biz">${esc(person ? business || title : '')}</div>` : ''}${sub ? `<p class="small muted" style="margin:4px 0 0">${esc(sub)}</p>` : ''}</div></div><button class="btn btn-ghost btn-sm" data-close>Skip</button></div>
    ${facts.filter((f) => f && f.v).length ? `<div class="dp-facts">${facts.filter((f) => f && f.v).map((f) => `<span><i>${esc(f.k)}</i>${esc(f.v)}</span>`).join('')}</div>` : ''}
    <div class="dispo-grid">${list.map((d) => `<button type="button" class="dispo-btn${d.id === pick ? ' on' : ''}" data-d="${esc(d.id)}">${d.key ? `<span class="kbd">${d.key}</span>` : ''}${esc(d.label)}</button>`).join('')}</div>
    <label class="field dispo-when" style="margin-top:12px${needsTime(list.find((d) => d.id === pick)) ? '' : ';display:none'}"><span>Callback or audit time</span><input type="datetime-local" id="dpwhen" value="${esc(callbackAt)}"></label>
    <label class="field" style="margin-top:12px"><span>Note</span><textarea id="dpnote" rows="3" placeholder="What they said, job value, who handles marketing">${esc(note)}</textarea></label>
    ${askLead ? `<details class="dispo-lead" style="margin-top:12px"><summary>Add ${esc(number || 'this number')} as a new lead</summary>
      <div class="form-grid" style="margin-top:10px"><label class="field"><span>Business name</span><input id="dpbiz" placeholder="Shore Plumbing"></label>
      <label class="field"><span>Contact</span><input id="dpcontact" placeholder="Mike"></label><label class="field"><span>State</span><input id="dpstate" placeholder="FL" maxlength="20"></label></div></details>` : ''}
    <div class="row end" style="margin-top:16px"><button type="button" class="btn btn-primary" id="dpsave"${pick ? '' : ' disabled'}>Save</button></div>`,
  { onClose: () => { document.removeEventListener('keydown', onKey); if (!saved) onSkip?.(); } });
  let saved = false;
  const el = m.el;
  el.classList.add('dispo-modal');
  const choose = (id) => {
    pick = id;
    $$('.dispo-btn', el).forEach((b) => b.classList.toggle('on', b.dataset.d === id));
    $('.dispo-when', el).style.display = needsTime(list.find((d) => d.id === id)) ? '' : 'none';
    $('#dpsave', el).disabled = false;
  };
  $$('.dispo-btn', el).forEach((b) => b.addEventListener('click', () => choose(b.dataset.d)));
  const onKey = (e) => {
    if (!document.body.contains(el) || /input|textarea|select/i.test(e.target.tagName)) return;
    const d = list.find((x) => x.key && x.key === e.key);
    if (d) { e.preventDefault(); choose(d.id); }
    if (e.key === 'Enter' && pick) { e.preventDefault(); $('#dpsave', el).click(); }
  };
  document.addEventListener('keydown', onKey);
  $('#dpsave', el).addEventListener('click', async (e) => {
    const d = list.find((x) => x.id === pick);
    const when = $('#dpwhen', el).value;
    if (d.acts === 'callback' && !when) return toast('Pick the callback time.', true);
    const biz = $('#dpbiz', el)?.value.trim();
    busy(e.currentTarget, true);
    try {
      await onSave({ dispo: d.id, acts: d.acts, label: d.label, note: $('#dpnote', el).value.trim(), callbackAt: when || null,
        newLead: biz ? { business: biz, contact: $('#dpcontact', el).value.trim(), state: $('#dpstate', el).value.trim() } : null });
      saved = true;
      m.close();
    } catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
  });
  return m;
}

// Owner editor (Phone setup).
export async function dispoEditor(box) {
  let d;
  try { d = await loadDispos(true); } catch (e) { box.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  let rows = d.dispositions.map((x) => ({ ...x }));
  const actsOpts = (sel) => Object.entries(d.acts).map(([k, n]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(n)}</option>`).join('');
  const draw = () => {
    box.innerHTML = `
      <h3 style="margin:0 0 6px">Call dispositions</h3>
      <p class="small muted" style="margin:0 0 12px">These show in the popup after every call and in the call queue. The first 9 get number keys. "What it does" decides the lead's next step.</p>
      <div class="dispo-rows">${rows.map((r, i) => `<div class="dispo-row" data-i="${i}">
        <span class="kbd">${i < 9 ? i + 1 : ''}</span>
        <input class="dr-label" value="${esc(r.label)}" maxlength="40" aria-label="Name">
        <select class="dr-acts" aria-label="What it does">${actsOpts(r.acts)}</select>
        <div class="dr-move"><button type="button" class="btn btn-ghost btn-sm" data-up ${i ? '' : 'disabled'} aria-label="Move up">↑</button><button type="button" class="btn btn-ghost btn-sm" data-down ${i < rows.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button></div>
        <button type="button" class="linkbtn small" data-rm ${rows.length > 1 ? '' : 'disabled'}>Remove</button>
      </div>`).join('')}</div>
      <div class="row" style="margin-top:12px;justify-content:space-between">
        <div class="row"><button type="button" class="btn btn-ghost btn-sm" id="dradd">Add disposition</button>${d.custom ? '<button type="button" class="linkbtn small" id="drreset">Reset to default</button>' : ''}</div>
        <button type="button" class="btn btn-primary btn-sm" id="drsave">Save dispositions</button>
      </div>`;
    const sync = () => $$('.dispo-row', box).forEach((row) => { const r = rows[Number(row.dataset.i)]; r.label = $('.dr-label', row).value; r.acts = $('.dr-acts', row).value; });
    $$('.dispo-row', box).forEach((row) => {
      const i = Number(row.dataset.i);
      $('[data-up]', row).addEventListener('click', () => { sync(); [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; draw(); });
      $('[data-down]', row).addEventListener('click', () => { sync(); [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; draw(); });
      $('[data-rm]', row).addEventListener('click', () => { sync(); rows.splice(i, 1); draw(); });
    });
    $('#dradd', box).addEventListener('click', () => { sync(); rows.push({ id: '', label: '', acts: 'none' }); draw(); $$('.dr-label', box).pop().focus(); });
    $('#drreset', box)?.addEventListener('click', async () => {
      try { const r = await api('/api/dispositions', { method: 'PUT', body: { reset: true } }); clearDispos(); d = await loadDispos(true); rows = r.dispositions.map((x) => ({ ...x })); draw(); toast('Back to the default list'); }
      catch (err) { toast(err.message, true); }
    });
    $('#drsave', box).addEventListener('click', async (e) => {
      sync();
      busy(e.currentTarget, true);
      try { const r = await api('/api/dispositions', { method: 'PUT', body: { dispositions: rows } }); clearDispos(); d = await loadDispos(true); rows = r.dispositions.map((x) => ({ ...x })); draw(); toast('Dispositions saved'); }
      catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
    });
  };
  draw();
}
