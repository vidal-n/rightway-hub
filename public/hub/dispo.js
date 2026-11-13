// Call dispositions: the list (owners can customize it), the popup after each call, and the editor in Phone setup.
import { $, $$, esc, api, toast, busy, modal } from './core.js';
import { PICKUP_CHOICES, ANSWERED_BY, HANGUP_STAGES, OBJECTIONS, OBJECTION_GROUPS, asksFor, defaultAnswered, defaultObjection } from '../js/leaddb.js';

let cache = null;
export async function loadDispos(force = false) {
  if (!cache || force) cache = api('/api/dispositions').catch((e) => { cache = null; throw e; });
  return cache;
}
export const clearDispos = () => { cache = null; };

// Each disposition gets a number key 1 to 9 in list order.
export const keyed = (list) => list.map((d, i) => ({ ...d, key: i < 9 ? String(i + 1) : '' }));
export const needsTime = (d) => d && (d.acts === 'callback' || d.acts === 'booked');
// A datetime-local value is the rep's own clock; send an exact moment so the Worker (UTC) never shifts it.
export const isoWhen = (v) => { const t = v ? new Date(v) : null; return t && !Number.isNaN(+t) ? t.toISOString() : null; };
const isInfo = (d) => Boolean(d) && (d.id === 'send_info' || /\binfo\b/i.test(d.label || ''));

// The result picker. It draws into any box: the popup (dispositionModal) or the call window itself (wrapUp in phone.js).
// onSave gets { dispo, note, callbackAt, newLead } and does the saving; it may throw to keep the panel open. onDone(saved) runs after Save or Skip.
// Returns { destroy, wasSaved } or null when the list could not load.
export async function dispoPanel(host, { title = 'How did the call go?', sub = '', answered = false, askLead = false, number = '', person = '', business = '', facts = [], note = '', callbackAt = '', foot = '', footBind, skipLabel = 'Skip', bare = false, lead = null, onSave, onSkip, onDone } = {}) {
  let list;
  try { list = keyed((await loadDispos()).dispositions); } catch (e) { toast(e.message, true); return null; }
  // A callback time tapped during the call picks the callback result for them.
  const suggest = callbackAt ? (list.find((d) => d.acts === 'callback') || {}).id : answered ? '' : (list.find((d) => d.acts === 'no_answer') || {}).id;
  let pick = suggest || '';
  let saved = false, gone = false;
  const initials = String(person || business || '#').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '#';
  host.innerHTML = `
    <div class="card-head"><div class="dp-who">${person || business ? `<span class="pd-av">${esc(initials)}</span>` : ''}<div style="min-width:0"><h2 style="margin:0">${esc(person || title)}</h2>${person || business ? `<div class="pd-biz">${esc(person ? business || title : '')}</div>` : ''}${sub ? `<p class="small muted" style="margin:4px 0 0">${esc(sub)}</p>` : ''}</div></div><button class="btn btn-ghost btn-sm"${bare ? ' data-skip' : ' data-close'}>${esc(skipLabel)}</button></div>
    ${facts.filter((f) => f && f.v).length ? `<div class="dp-facts">${facts.filter((f) => f && f.v).map((f) => `<span><i>${esc(f.k)}</i>${esc(f.v)}</span>`).join('')}</div>` : ''}
    <div class="dispo-grid">${list.map((d) => `<button type="button" class="dispo-btn${d.id === pick ? ' on' : ''}" data-d="${esc(d.id)}">${d.key ? `<span class="kbd">${d.key}</span>` : ''}${esc(d.label)}</button>`).join('')}</div>
    <div class="dp-more">
      <div class="dp-q" data-q="pickup" hidden><span>Who picked up</span>${PICKUP_CHOICES.map((k) => `<button type="button" class="chip" data-pick="${k}">${esc(ANSWERED_BY.find((a) => a[0] === k)[1])}</button>`).join('')}</div>
      <div class="dp-q" data-q="stage" hidden><span>Where it ended</span>${HANGUP_STAGES.map(([k, n]) => `<button type="button" class="chip" data-stage="${k}">${esc(n)}</button>`).join('')}</div>
      <label class="dp-q" data-q="objection" hidden><span>Why</span><select id="dpobj"><option value="">Pick the reason</option>${Object.entries(OBJECTION_GROUPS).map(([g, gn]) => `<optgroup label="${esc(gn)}">${OBJECTIONS.filter((o) => o[2] === g).map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('')}</optgroup>`).join('')}</select></label>
      <label class="dp-q" data-q="menu" hidden><span>Menu path</span><input id="dpmenu" maxlength="200" placeholder="Press 2, then 0 for the office" value="${esc(lead?.menu_path || '')}"></label>
    </div>
    <label class="field dispo-when" style="margin-top:12px${needsTime(list.find((d) => d.id === pick)) ? '' : ';display:none'}"><span id="dpwlabel">Callback or audit time</span><input type="datetime-local" id="dpwhen" value="${esc(callbackAt)}"></label>
    <div class="dp-info" style="display:none"></div>
    <label class="field" style="margin-top:12px"><span>Note</span><textarea id="dpnote" rows="2" placeholder="What they said, job value, who handles marketing">${esc(note)}</textarea></label>
    ${askLead ? `<details class="dispo-lead" style="margin-top:12px"><summary>Add ${esc(number || 'this number')} as a new lead</summary>
      <div class="form-grid" style="margin-top:10px"><label class="field"><span>Business name</span><input id="dpbiz" placeholder="Shore Plumbing"></label>
      <label class="field"><span>Contact</span><input id="dpcontact" placeholder="Mike"></label><label class="field"><span>State</span><input id="dpstate" placeholder="FL" maxlength="20"></label></div></details>` : ''}
    <div class="row end dp-actions" style="margin-top:16px"><button type="button" class="btn btn-primary" id="dpsave"${pick ? '' : ' disabled'}>Save</button></div>
    ${foot ? `<div class="dp-foot">${foot}</div>` : ''}`;
  const el = host;
  // "Wants info first": the email form opens right in the result window.
  let infoCtl = null, infoLoading = false, emailed = false;
  const showInfo = async (on) => {
    const box = $('.dp-info', el);
    box.style.display = on ? '' : 'none';
    el.classList.toggle('has-info', on);
    if (!on || infoCtl || infoLoading || !lead) return;
    infoLoading = true;
    try { const m = await import('./infomail.js'); infoCtl = await m.mountInfo(box, lead, () => $('#dpwhen', el).value); } catch (e) { box.innerHTML = `<div class="small err-text">${esc(e.message)}</div>`; }
    infoLoading = false;
  };
  // Lead database: who picked up, where it ended and why (Orum and Gong style). Shown only for the results that need them.
  const det = { pickup: '', stage: '' };
  const showMore = (dd) => {
    const a = asksFor(dd?.acts || '');
    for (const q of ['pickup', 'stage', 'objection', 'menu']) { const box = $(`.dp-q[data-q="${q}"]`, el); if (box) box.hidden = !a[q]; }
    det.pickup = a.pickup ? (defaultAnswered(dd.id, dd.acts) === 'someone' ? '' : defaultAnswered(dd.id, dd.acts) || '') : '';
    $$('[data-pick]', el).forEach((b) => b.classList.toggle('on', b.dataset.pick === det.pickup));
    if (!a.stage) { det.stage = ''; $$('[data-stage]', el).forEach((b) => b.classList.remove('on')); }
    const o = $('#dpobj', el); if (o) o.value = defaultObjection(dd?.id || '') || (a.objection ? o.value : '');
  };
  $$('[data-pick]', el).forEach((b) => b.addEventListener('click', () => { det.pickup = det.pickup === b.dataset.pick ? '' : b.dataset.pick; $$('[data-pick]', el).forEach((x) => x.classList.toggle('on', x.dataset.pick === det.pickup)); }));
  $$('[data-stage]', el).forEach((b) => b.addEventListener('click', () => { det.stage = det.stage === b.dataset.stage ? '' : b.dataset.stage; $$('[data-stage]', el).forEach((x) => x.classList.toggle('on', x.dataset.stage === det.stage)); }));
  const detailOf = (dd) => {
    const a = asksFor(dd.acts);
    return { answered_by: a.pickup ? (det.pickup || defaultAnswered(dd.id, dd.acts)) : defaultAnswered(dd.id, dd.acts), hangup_stage: a.stage ? det.stage || null : null,
      objection: a.objection ? ($('#dpobj', el)?.value || null) : null, menu_path: a.menu ? ($('#dpmenu', el)?.value.trim() || null) : null };
  };
  const choose = (id) => {
    pick = id;
    $$('.dispo-btn', el).forEach((b) => b.classList.toggle('on', b.dataset.d === id));
    const dd = list.find((d) => d.id === id);
    showMore(dd);
    const info = Boolean(lead) && isInfo(dd);
    $('.dispo-when', el).style.display = needsTime(dd) || info ? '' : 'none';
    $('#dpwlabel', el).textContent = info ? 'Callback time (optional, goes in the email)' : 'Callback or audit time';
    showInfo(info);
    $('#dpsave', el).disabled = false;
  };
  $$('.dispo-btn', el).forEach((b) => b.addEventListener('click', () => choose(b.dataset.d)));
  if (pick) showMore(list.find((d) => d.id === pick));
  const onKey = (e) => {
    if (!document.body.contains(el)) return destroy();
    if (/input|textarea|select/i.test(e.target.tagName)) return;
    const d = list.find((x) => x.key && x.key === e.key);
    if (d) { e.preventDefault(); choose(d.id); }
    if (e.key === 'Enter' && pick) { e.preventDefault(); $('#dpsave', el).click(); }
  };
  function destroy() { gone = true; document.removeEventListener('keydown', onKey); }
  document.addEventListener('keydown', onKey);
  if (foot) {
    footBind?.($('.dp-foot', el));
    // Book appointment sits beside Save so a dial is one glance and one tap (the listeners stay on the moved button).
    const bk = $('.dp-foot .cb-book', el);
    if (bk) { $('.dp-actions', el).prepend(bk); el.classList.add('has-book'); }
    const left = $('.dp-foot', el);
    if (left && !left.children.length && !left.textContent.trim()) left.remove();
  }
  $('[data-skip]', el)?.addEventListener('click', () => { if (gone) return; destroy(); onSkip?.(); onDone?.(false); });
  $('#dpsave', el).addEventListener('click', async (e) => {
    const d = list.find((x) => x.id === pick);
    const when = $('#dpwhen', el).value;
    if (d.acts === 'callback' && !when) return toast('Pick the callback time.', true);
    const biz = $('#dpbiz', el)?.value.trim();
    busy(e.currentTarget, true);
    try {
      // Send the info email first. A wrong address or a send problem stops here, so nothing is logged twice.
      if (lead && isInfo(d) && infoCtl && !emailed) {
        const m = infoCtl.get();
        if (m) {
          const r = await api(`/api/leads/${lead.id}/info-email`, { method: 'POST', body: { ...m, callbackAt: when ? new Date(when).toISOString() : null } });
          emailed = true; toast(`Email sent to ${r.to}`);
        }
      }
      await onSave({ dispo: d.id, acts: d.acts, label: d.label, note: $('#dpnote', el).value.trim(), callbackAt: when || null, detail: detailOf(d),
        newLead: biz ? { business: biz, contact: $('#dpcontact', el).value.trim(), state: $('#dpstate', el).value.trim() } : null });
      saved = true;
      destroy();
      onDone?.(true);
    } catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
  });
  return { destroy, wasSaved: () => saved };
}

// The popup version (calls that did not go through the dialer window, and the dial out dial pad).
export async function dispositionModal(opts = {}) {
  try { await loadDispos(); } catch (e) { toast(e.message, true); return; }
  let panel = null;
  const m = modal('<div class="dispo-host"></div>', { win: true, onClose: () => { panel?.destroy(); if (!panel?.wasSaved()) opts.onSkip?.(); } });
  m.el.classList.add('dispo-modal');
  panel = await dispoPanel($('.dispo-host', m.el), { ...opts, onDone: (saved) => { if (saved) m.close(); } });
  if (!panel) m.close();
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
