// Automate, Workflows (#/automations/workflows[/<id>]): the drag and drop workflow builder (Nov 2026).
// Modeled on GoHighLevel's workflow builder (trigger card on top, actions stacked below with + between them, a side panel to edit the
// picked step, recipes to start from) and Zapier's editor (test before turning on). Drag an action from the left onto any + gap, drag a
// step to move it, or tap: tap an action to add it after the picked step, tap + to insert there, use the arrows to move on a phone.
import { $, $$, esc, api, toast, modal, busy, icon, fmt } from './core.js';
import { staffShell } from './shell.js';
import { TRIGGERS, TRIGGER_MAP, ACTIONS, ACTION_MAP, CHECKS, CHECK_MAP, RECIPES, cleanWorkflow, cleanStep, stepLine, problems } from '../js/workflows.js';

const STAGES = [['new', 'New lead'], ['attempting', 'Attempting'], ['callback', 'Callback set'], ['audit_requested', 'Audit requested'], ['audit_booked', 'Audit booked'], ['no_show', 'No-show'],
  ['follow_up', 'Following up'], ['won', 'Won'], ['not_now', 'Not now'], ['lost', 'Lost']];
const VARS = ['{first}', '{business}', '{rep}', '{book_link}', '{phone}', '{city}'];
const STATUS = { waiting: ['Waiting', 'warn'], done: ['Finished', 'ok'], stopped: ['Stopped', 'gray'], failed: ['Failed', 'bad'] };
const tabs = (cur) => `<nav class="tabs"><a href="#/automations/workflows" class="${cur === 'wf' ? 'is-active' : ''}">Workflows</a><a href="#/automations" class="${cur === 'rem' ? 'is-active' : ''}">Booking reminders</a></nav>`;
const sw = (on, attrs = '') => `<label class="switch"${attrs}><input type="checkbox"${on ? ' checked' : ''}><span></span></label>`;
const trigLine = (t) => { const d = TRIGGER_MAP[t?.type]; if (!d) return 'Pick a trigger'; const extra = t.to ? `: ${STAGES.find((s) => s[0] === t.to)?.[1] || t.to}` : t.contains ? `: "${t.contains}"` : t.tag ? `: ${t.tag}` : t.outcomes?.length ? `: ${t.outcomes.join(', ')}` : t.sources?.length ? `: ${t.sources.join(', ')}` : ''; return d.label + extra; };

export async function workflowsPage(app, user, id = '') {
  if (id) return builder(app, user, id);
  const view = staffShell(app, user, 'automations');
  view.innerHTML = `<div class="page-head"><div><h1>Workflows</h1><p class="small muted" style="margin:4px 0 0">When something happens (a form, a missed call, a reply, a call result), the Hub does the next steps for you: texts, emails, tasks, alerts, tags.</p></div>
    <button class="btn btn-primary" id="wfnew">${icon.plus}New workflow</button></div>${tabs('wf')}<div id="wfbox"><div class="skeleton"></div></div>`;
  const draw = async () => {
    let d;
    try { d = await api('/api/workflows'); } catch (e) { $('#wfbox', view).innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
    const have = new Set(d.workflows.map((w) => w.name));
    $('#wfbox', view).innerHTML = `
      ${d.workflows.length ? `<div class="wf-list">${d.workflows.map((w) => `<div class="wf-card${w.enabled ? ' on' : ''}" data-id="${esc(w.id)}">
          <div class="wf-card-top">${sw(w.enabled, ` data-toggle="${esc(w.id)}" title="${w.enabled ? 'Turn off' : 'Turn on'}"`)}<a href="#/automations/workflows/${esc(w.id)}" class="wf-name">${esc(w.name)}</a></div>
          <p class="wf-trig"><span class="wf-when">When</span> ${esc(trigLine(w.trigger))}</p>
          <ol class="wf-mini">${w.steps.slice(0, 4).map((s) => `<li>${esc(stepLine(s))}</li>`).join('')}${w.steps.length > 4 ? `<li class="muted">and ${w.steps.length - 4} more</li>` : ''}</ol>
          <div class="wf-stats"><span><b>${fmt.int(w.waiting)}</b> in progress</span><span><b>${fmt.int(w.done30)}</b> finished, 30 days</span><span><b>${fmt.int(w.runs)}</b> started</span></div>
          ${w.problems.length ? `<p class="small err-text">${esc(w.problems[0])}</p>` : ''}</div>`).join('')}</div>` : ''}
      <h2 class="wf-sec">Start from a recipe</h2>
      <p class="small muted" style="margin:-4px 0 12px">Ready made automations for a sales team, built on your Hub data. They start turned off so you can read and test them first.</p>
      <div class="wf-recipes">${RECIPES.map((r) => `<div class="wf-recipe"><b>${esc(r.name)}</b><p class="small">${esc(r.why)}</p>
        <p class="wf-trig small"><span class="wf-when">When</span> ${esc(trigLine(r.trigger))}</p><ol class="wf-mini small">${r.steps.map((s) => `<li>${esc(stepLine(cleanStep(s)))}</li>`).join('')}</ol>
        <button class="btn ${have.has(r.name) ? 'btn-ghost' : 'btn-mint'} btn-sm" data-recipe="${r.id}">${have.has(r.name) ? 'Add another copy' : 'Use this recipe'}</button></div>`).join('')}</div>`;
    $$('[data-toggle]', view).forEach((l) => l.querySelector('input').addEventListener('change', async (e) => {
      try { await api(`/api/workflows/${l.dataset.toggle}`, { method: 'PUT', body: { enabled: e.target.checked } }); toast(e.target.checked ? 'Workflow is on' : 'Workflow is off'); draw(); }
      catch (err) { e.target.checked = !e.target.checked; toast(err.message, true); }
    }));
    $$('[data-recipe]', view).forEach((b) => b.addEventListener('click', async () => {
      busy(b, true);
      try { const r = await api('/api/workflows', { method: 'POST', body: { recipe: b.dataset.recipe } }); location.hash = `#/automations/workflows/${r.id}`; } catch (e) { busy(b, false); toast(e.message, true); }
    }));
  };
  $('#wfnew', view).addEventListener('click', async () => {
    try { const r = await api('/api/workflows', { method: 'POST', body: { name: 'New workflow', trigger: { type: 'form_submitted' }, steps: [] } }); location.hash = `#/automations/workflows/${r.id}`; } catch (e) { toast(e.message, true); }
  });
  draw();
}

async function builder(app, user, id) {
  const view = staffShell(app, user, 'automations');
  view.innerHTML = '<div class="skeleton"></div>';
  let d, meta = { users: [], dispositions: [] };
  try { [d, meta] = await Promise.all([api(`/api/workflows/${encodeURIComponent(id)}`), api('/api/workflows/meta').catch(() => meta)]); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  let wf = cleanWorkflow(d.workflow);
  let enabled = d.workflow.enabled, sel = -1, dirty = false, fresh = null;
  view.innerHTML = `<div class="wfb">
    <div class="wfb-bar"><a class="btn btn-ghost btn-sm" href="#/automations/workflows">${icon.back || ''}All workflows</a>
      <input id="wfname" class="wfb-name" maxlength="80" value="${esc(wf.name)}" aria-label="Workflow name">
      <span class="spacer"></span>
      <span class="wfb-state" id="wfstate"></span>
      <button class="btn btn-ghost btn-sm" id="wftest">Test on a lead</button>
      <button class="btn btn-primary btn-sm" id="wfsave">Save</button>
      <label class="wfb-on">${sw(enabled, ' id="wfon"')}<span>On</span></label></div>
    <div class="wfb-grid">
      <aside class="wfb-pal" aria-label="Actions"><p class="wfb-cap">Drag a step in, or tap to add it</p>
        ${[...new Set(ACTIONS.map((a) => a.group))].map((g) => `<div class="wfb-grp"><span>${esc(g)}</span>${ACTIONS.filter((a) => a.group === g).map((a) => `<button type="button" class="wfb-act" draggable="true" data-add="${a.id}">${icon[a.icon] || icon.plus}${esc(a.label)}</button>`).join('')}</div>`).join('')}</aside>
      <section class="wfb-canvas" id="wfcanvas" aria-label="Workflow steps"></section>
      <aside class="wfb-side" id="wfside"></aside>
    </div>
    <div class="card wfb-runs"><div class="card-head"><h2>Recent runs</h2><span class="small muted">Each lead's trip through this workflow, step by step</span></div><div id="wfruns"></div></div></div>`;
  const canvas = $('#wfcanvas', view), side = $('#wfside', view);
  const mark = (on = true) => { dirty = on; paintState(); };
  const paintState = () => {
    const p = problems(wf);
    $('#wfstate', view).innerHTML = dirty ? '<span class="badge warn">Not saved</span>' : enabled ? '<span class="badge ok">On</span>' : '<span class="badge gray">Off</span>';
    $('#wfstate', view).title = p[0] || '';
  };
  const gap = (i) => `<div class="wfb-gap" data-gap="${i}"><button type="button" class="wfb-plus" data-plus="${i}" aria-label="Add a step here">${icon.plus}</button></div>`;
  const drawCanvas = () => {
    canvas.innerHTML = `<div class="wfb-node trig${sel === -1 ? ' is-sel' : ''}" data-sel="-1"><span class="wfb-kind">When this happens</span><b>${esc(trigLine(wf.trigger))}</b>
        <span class="small muted">${esc(TRIGGER_MAP[wf.trigger.type]?.help || '')}</span></div>
      ${gap(0)}${wf.steps.map((s, i) => `<div class="wfb-node${sel === i ? ' is-sel' : ''}${fresh === s.id ? ' fresh' : ''} k-${s.type}" data-sel="${i}" draggable="true" data-move="${i}">
          <span class="wfb-num">${i + 1}</span><span class="wfb-ic">${icon[ACTION_MAP[s.type]?.icon] || ''}</span>
          <div class="wfb-txt"><span class="wfb-kind">${esc(ACTION_MAP[s.type]?.label || s.type)}</span><b>${esc(stepLine(s))}</b></div>
          <span class="wfb-tools"><button type="button" data-up="${i}" aria-label="Move up" ${i ? '' : 'disabled'}>&uarr;</button><button type="button" data-down="${i}" aria-label="Move down" ${i < wf.steps.length - 1 ? '' : 'disabled'}>&darr;</button><button type="button" data-del="${i}" aria-label="Remove">&times;</button></span></div>${gap(i + 1)}`).join('')}
      <div class="wfb-end">${wf.steps.length ? 'End' : 'Drag your first step here, or tap the +'}</div>`;
    fresh = null;
    $$('[data-sel]', canvas).forEach((n) => n.addEventListener('click', (e) => { if (e.target.closest('button')) return; sel = Number(n.dataset.sel); drawCanvas(); drawSide(); }));
    $$('[data-up]', canvas).forEach((b) => b.addEventListener('click', () => move(Number(b.dataset.up), Number(b.dataset.up) - 1)));
    $$('[data-down]', canvas).forEach((b) => b.addEventListener('click', () => move(Number(b.dataset.down), Number(b.dataset.down) + 2)));
    $$('[data-del]', canvas).forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.del); wf.steps.splice(i, 1); sel = Math.min(sel, wf.steps.length - 1); mark(); drawCanvas(); drawSide(); }));
    $$('[data-plus]', canvas).forEach((b) => b.addEventListener('click', () => pickAction(Number(b.dataset.plus))));
    // Drag and drop (mouse, trackpad and iPad): actions from the palette, steps to move.
    $$('[data-move]', canvas).forEach((n) => {
      n.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', `move:${n.dataset.move}`); e.dataTransfer.effectAllowed = 'move'; n.classList.add('dragging'); canvas.classList.add('dragging'); });
      n.addEventListener('dragend', () => { n.classList.remove('dragging'); canvas.classList.remove('dragging'); });
    });
    $$('[data-gap]', canvas).forEach((g) => {
      g.addEventListener('dragover', (e) => { e.preventDefault(); g.classList.add('over'); });
      g.addEventListener('dragleave', () => g.classList.remove('over'));
      g.addEventListener('drop', (e) => {
        e.preventDefault(); g.classList.remove('over'); canvas.classList.remove('dragging');
        const v = e.dataTransfer.getData('text/plain'), at = Number(g.dataset.gap);
        if (v.startsWith('new:')) add(v.slice(4), at);
        else if (v.startsWith('move:')) move(Number(v.slice(5)), at);
      });
    });
  };
  const add = (type, at = wf.steps.length) => {
    const s = cleanStep({ type });
    if (!s) return;
    wf.steps.splice(at, 0, s);
    sel = at; fresh = s.id; mark(); drawCanvas(); drawSide();
    import('./sound.js').then((m) => m.play('tick')).catch(() => {});
  };
  const move = (from, to) => {
    if (from < 0 || from >= wf.steps.length) return;
    const [s] = wf.steps.splice(from, 1);
    const at = Math.max(0, Math.min(wf.steps.length, to > from ? to - 1 : to));
    wf.steps.splice(at, 0, s);
    sel = at; mark(); drawCanvas(); drawSide();
  };
  const pickAction = (at) => {
    const m = modal(`<div class="card-head"><h2>Add a step</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
      <div class="wfb-pick">${ACTIONS.map((a) => `<button type="button" class="wfb-act" data-pick="${a.id}">${icon[a.icon] || ''}<span><b>${esc(a.label)}</b><small>${esc(a.help || a.group)}</small></span></button>`).join('')}</div>`);
    $$('[data-pick]', m.el).forEach((b) => b.addEventListener('click', () => { m.close(); add(b.dataset.pick, at); }));
  };
  $$('[data-add]', view).forEach((b) => {
    b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', `new:${b.dataset.add}`); e.dataTransfer.effectAllowed = 'copy'; canvas.classList.add('dragging'); });
    b.addEventListener('dragend', () => canvas.classList.remove('dragging'));
    b.addEventListener('click', () => add(b.dataset.add, sel >= 0 ? sel + 1 : wf.steps.length));
  });

  // ---------- side panel: edit the picked step, or the trigger and settings ----------
  const field = (f, v) => {
    const name = `f_${f.k}`;
    if (f.type === 'textarea') return `<label class="field"><span>${esc(f.label)}</span><textarea name="${name}" rows="5" maxlength="${f.max || 2000}" placeholder="${esc(f.placeholder || '')}">${esc(v ?? '')}</textarea>
      <div class="wfb-vars">${VARS.map((x) => `<button type="button" class="chip" data-var="${x}" data-for="${name}">${x}</button>`).join('')}</div></label>`;
    if (f.type === 'number') return `<label class="field"><span>${esc(f.label)}</span><input name="${name}" type="number" min="${f.min ?? 0}" max="${f.max ?? 99999}" value="${esc(v ?? f.def ?? '')}"></label>`;
    if (f.type === 'select') { const opts = typeof f.options === 'function' ? f.options() : f.options; return `<label class="field"><span>${esc(f.label)}</span><select name="${name}">${opts.map(([k, n]) => `<option value="${k}"${v === k ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`; }
    if (f.type === 'stage') return `<label class="field"><span>${esc(f.label)}</span><select name="${name}">${f.any ? '<option value="">Any stage</option>' : '<option value="">Pick a stage</option>'}${STAGES.map(([k, n]) => `<option value="${k}"${v === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;
    if (f.type === 'user') return `<label class="field"><span>${esc(f.label)}</span><select name="${name}"><option value="rr">Round robin (fewest open leads)</option>${meta.users.map((u) => `<option value="${esc(u.id)}"${v === u.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>`;
    if (f.type === 'outcomes') { const on = new Set(v || []); return `<div class="field"><span>${esc(f.label)}</span><div class="wfb-checks">${(meta.dispositions.length ? meta.dispositions : [{ id: 'booked', label: 'Booked' }, { id: 'not_now', label: 'Not now' }, { id: 'callback', label: 'Callback' }]).map((dd) => `<label><input type="checkbox" name="${name}" value="${esc(dd.id)}"${on.has(dd.id) ? ' checked' : ''}> ${esc(dd.label)}</label>`).join('')}</div></div>`; }
    if (f.type === 'tags') return `<label class="field"><span>${esc(f.label)}</span><input name="${name}" value="${esc((v || []).join(', '))}" placeholder="${esc(f.placeholder || '')}"></label>`;
    return `<label class="field"><span>${esc(f.label)}</span><input name="${name}" maxlength="${f.max || 300}" value="${esc(v ?? '')}" placeholder="${esc(f.placeholder || '')}"></label>`;
  };
  const read = (form, fields) => {
    const out = {};
    for (const f of fields) {
      const name = `f_${f.k}`;
      if (f.type === 'outcomes') out[f.k] = $$(`[name="${name}"]:checked`, form).map((i) => i.value);
      else if (f.type === 'tags') out[f.k] = String(form[name]?.value || '').split(',').map((x) => x.trim()).filter(Boolean);
      else out[f.k] = form[name]?.value ?? '';
    }
    return out;
  };
  const drawSide = () => {
    if (sel === -1) {
      const t = TRIGGER_MAP[wf.trigger.type];
      side.innerHTML = `<form class="wfb-form" id="wfform"><h3>Trigger</h3>
        <label class="field"><span>Start this workflow when</span><select name="trig">${[...new Set(TRIGGERS.map((x) => x.group))].map((g) => `<optgroup label="${esc(g)}">${TRIGGERS.filter((x) => x.group === g).map((x) => `<option value="${x.id}"${x.id === t.id ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</optgroup>`).join('')}</select></label>
        <p class="small muted">${esc(t.help)}</p>${t.fields.map((f) => field(f, wf.trigger[f.k])).join('')}
        <h3 style="margin-top:18px">Settings</h3>
        <label class="row small"><input type="checkbox" name="stop"${wf.stopOnReply ? ' checked' : ''}> Stop for a lead when they text back</label>
        <label class="row small"><input type="checkbox" name="reenter"${wf.reenter ? ' checked' : ''}> Let a lead go through again (off: once a day at most, never twice at the same time)</label></form>`;
      const form = $('#wfform', side);
      form.trig.addEventListener('change', () => { wf.trigger = { type: form.trig.value }; mark(); drawCanvas(); drawSide(); });
      form.addEventListener('input', (e) => {
        if (e.target.name === 'trig') return;
        wf.trigger = { type: t.id, ...read(form, t.fields) };
        wf.stopOnReply = form.stop.checked; wf.reenter = form.reenter.checked;
        mark(); drawCanvas();
      });
      return;
    }
    const s = wf.steps[sel];
    const a = ACTION_MAP[s?.type];
    if (!a) { side.innerHTML = ''; return; }
    const chk = s.type === 'condition' ? CHECK_MAP[s.check] : null;
    side.innerHTML = `<form class="wfb-form" id="wfform"><h3>Step ${sel + 1}: ${esc(a.label)}</h3>${a.help ? `<p class="small muted">${esc(a.help)}</p>` : ''}
      ${a.fields.map((f) => (s.type === 'condition' && f.k === 'value' && !chk?.needs ? '' : field(f, s[f.k]))).join('')}
      ${s.type === 'send_text' ? '<p class="small muted">Texts only go to people who said yes, texted us, or (for a missed call) just called us, between 8am and 8pm their time. STOP always wins.</p>' : ''}
      <div class="row" style="margin-top:12px"><button type="button" class="btn btn-ghost btn-sm" id="wfdup">Duplicate</button><button type="button" class="btn btn-danger btn-sm" id="wfdel">Remove step</button></div></form>`;
    const form = $('#wfform', side);
    form.addEventListener('input', () => {
      wf.steps[sel] = cleanStep({ ...s, ...read(form, a.fields), id: s.id });
      if (s.type === 'condition' && CHECK_MAP[wf.steps[sel].check]?.needs !== Boolean(chk?.needs)) { mark(); drawCanvas(); drawSide(); return; }
      mark(); drawCanvas();
    });
    $$('[data-var]', side).forEach((b) => b.addEventListener('click', () => {
      const ta = form[b.dataset.for];
      const p = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, p) + b.dataset.var + ta.value.slice(ta.selectionEnd ?? p);
      ta.focus(); ta.selectionStart = ta.selectionEnd = p + b.dataset.var.length;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }));
    $('#wfdup', side).onclick = () => { const c = cleanStep({ ...s, id: '' }); wf.steps.splice(sel + 1, 0, c); sel++; fresh = c.id; mark(); drawCanvas(); drawSide(); };
    $('#wfdel', side).onclick = () => { wf.steps.splice(sel, 1); sel = Math.min(sel, wf.steps.length - 1); mark(); drawCanvas(); drawSide(); };
  };

  const save = async (patch = {}) => {
    wf.name = $('#wfname', view).value.trim() || wf.name;
    const r = await api(`/api/workflows/${encodeURIComponent(id)}`, { method: 'PUT', body: { ...wf, ...patch } });
    enabled = r.workflow.enabled; mark(false);
    return r;
  };
  $('#wfname', view).addEventListener('input', () => mark());
  $('#wfsave', view).addEventListener('click', async (e) => { busy(e.currentTarget, true); try { await save(); toast('Saved'); } catch (err) { toast(err.message, true); } busy(e.currentTarget, false); });
  $('#wfon', view).querySelector('input').addEventListener('change', async (e) => {
    try { await save({ enabled: e.target.checked }); toast(e.target.checked ? 'On. It starts with the next matching event.' : 'Off. Leads waiting in it were stopped.'); }
    catch (err) { e.target.checked = !e.target.checked; toast(err.message, true); }
  });
  $('#wftest', view).addEventListener('click', () => testModal(id, async () => { if (dirty) await save(); }));
  addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); }, { once: true });

  const drawRuns = () => {
    const box = $('#wfruns', view);
    box.innerHTML = d.runs.length ? `<div class="list">${d.runs.map((r) => `<details class="wfr"><summary><span class="badge ${STATUS[r.status]?.[1] || 'gray'}">${esc(STATUS[r.status]?.[0] || r.status)}</span>
        <b>${esc(r.business || 'Lead')}</b><span class="small muted">${esc(fmt.ago(r.created_at))}${r.status === 'waiting' && r.next_at ? `, next step ${esc(new Date(r.next_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}` : ''}${r.note ? `, ${esc(r.note)}` : ''}</span>
        ${r.status === 'waiting' ? `<button class="btn btn-ghost btn-sm" data-stop="${esc(r.id)}">Stop</button>` : ''}</summary>
        <ol class="wfr-log">${r.log.map((x) => `<li><time>${esc(new Date(x.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</time>${esc(x.line)}</li>`).join('') || '<li class="muted">Nothing ran yet.</li>'}</ol></details>`).join('')}</div>`
      : '<p class="small muted">No lead has gone through yet. Turn it on, or use Test on a lead to see what it would do.</p>';
    $$('[data-stop]', box).forEach((b) => b.addEventListener('click', async (e) => { e.preventDefault(); try { await api(`/api/workflow-runs/${b.dataset.stop}/stop`, { method: 'POST' }); toast('Stopped for that lead'); d = await api(`/api/workflows/${encodeURIComponent(id)}`); drawRuns(); } catch (err) { toast(err.message, true); } }));
  };
  drawCanvas(); drawSide(); paintState(); drawRuns();
}

// Dry run on a real lead: every step is worked out (texts written, checks answered) but nothing is sent or changed.
async function testModal(id, before) {
  await before?.();
  const m = modal(`<div class="card-head"><h2>Test on a lead</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
    <p class="small muted">Nothing is sent or changed. Waits are skipped. You see each step as it would happen for this lead.</p>
    <input id="tq" type="search" placeholder="Search a lead by name or phone" autocomplete="off"><div id="tl" class="list" style="margin-top:8px"></div><div id="tout"></div>`);
  const find = async () => {
    const q = $('#tq', m.el).value.trim();
    const d = await api(`/api/leads?q=${encodeURIComponent(q)}&limit=8`).catch(() => ({ leads: [] }));
    $('#tl', m.el).innerHTML = (d.leads || []).slice(0, 8).map((l) => `<button class="item" data-lead="${esc(l.id)}" style="width:100%;text-align:left"><div><div class="item-title">${esc(l.business)}</div><div class="item-sub">${esc([l.contact_name, l.phone, l.city].filter(Boolean).join(' · '))}</div></div></button>`).join('');
    $$('[data-lead]', m.el).forEach((b) => b.addEventListener('click', async () => {
      try {
        const r = await api(`/api/workflows/${encodeURIComponent(id)}/test`, { method: 'POST', body: { leadId: b.dataset.lead } });
        $('#tout', m.el).innerHTML = `<h3 style="margin-top:14px">What would happen</h3><ol class="wfr-log">${r.log.map((x) => `<li>${esc(x.line)}</li>`).join('') || '<li>No steps.</li>'}</ol><p class="small muted">Ends: ${esc(r.ended)}</p>`;
      } catch (e) { toast(e.message, true); }
    }));
  };
  let t;
  $('#tq', m.el).addEventListener('input', () => { clearTimeout(t); t = setTimeout(find, 200); });
  find();
}
