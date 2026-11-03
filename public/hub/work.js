// My work: every open task across all clients (owner, due date, client), the task panel (guide steps, proof, timer and the
// tools for that kind of task), hours per client and person, and the editable guides. Also the client Access checklist tab.
import { $, $$, esc, api, toast, copy, fmt, icon, busy, modal, resizeImage, KIND_LABEL, PLAN_NAMES } from './core.js';
import { staffShell } from './staff.js';

const PROOF_TXT = { link: 'Live link', screenshot: 'Screenshot', either: 'Live link or screenshot', note: 'Written note', none: 'No proof needed' };
export const mins = (m) => { m = Math.round(m || 0); if (m < 60) return `${m} min`; const h = Math.floor(m / 60), r = m % 60; return `${h} h${r ? ` ${r} min` : ''}`; };
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const dueLabel = (iso) => { if (!iso) return 'No date'; const d = new Date(`${iso}T12:00:00`); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
const initials = (n) => String(n || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');
const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(x).padStart(2, '0')}`; };
let ticker = null;

function tabsHtml(active) {
  return `<nav class="tabs">${[['', 'My work'], ['hours', 'Hours'], ['guides', 'Guides']].map(([k, n]) => `<a href="#/work${k ? `/${k}` : ''}" class="${active === k ? 'is-active' : ''}">${n}</a>`).join('')}</nav>`;
}

export async function workPage(app, user, sub = '', param = '') {
  const view = staffShell(app, user, 'work');
  if (sub === 'hours') return hoursView(view, user);
  if (sub === 'guides') return guidesView(view, user, param);
  await queueView(view, user);
  if (sub === 'task' && param) openTask(param, user, { onChange: () => queueView(view, user) });
}

// ---------- the queue ----------
const prefs = { who: 'me', client: '' };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('rw-work') || '{}')); } catch { /* defaults */ }
const savePrefs = () => { try { localStorage.setItem('rw-work', JSON.stringify(prefs)); } catch { /* ignore */ } };

async function queueView(view, user) {
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Fulfillment</p><h1>My work</h1></div></div>${tabsHtml('')}<div class="skeleton"></div>`;
  let d;
  try { d = await api(`/api/work?who=${encodeURIComponent(prefs.who)}${prefs.client ? `&client=${encodeURIComponent(prefs.client)}` : ''}`); } catch (e) { view.insertAdjacentHTML('beforeend', `<p class="err-text">${esc(e.message)}</p>`); return; }
  const today = todayIso(), week = addDays(today, 7);
  const groups = [['Overdue', (t) => t.due && t.due < today], ['Today', (t) => t.due === today], ['Next 7 days', (t) => t.due > today && t.due <= week], ['Later', (t) => t.due > week], ['No date', (t) => !t.due]];
  const team = new Map(d.team.map((u) => [u.id, u]));
  const clients = [...new Map(d.tasks.map((t) => [t.client_id, t.client_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const overdue = d.tasks.filter((t) => t.due && t.due < today).length;
  const dueWeek = d.tasks.filter((t) => t.due && t.due <= week).length;
  const day = new Date().getDate();
  const row = (t) => {
    const est = d.est[t.kind]?.minutes || 20;
    const owner = team.get(t.owner);
    return `<li class="item work-row${t.status === 'doing' ? ' is-doing' : ''}" data-id="${esc(t.id)}">
      <input type="checkbox" class="wsel" aria-label="Select task" data-sel="${esc(t.id)}">
      <div class="work-main" data-open="${esc(t.id)}" tabindex="0" role="button">
        <div class="item-title">${esc(t.title)}</div>
        <div class="item-sub"><a href="#/client/${esc(t.client_id)}/tasks" data-stop>${esc(t.client_name)}</a> · ${esc(KIND_LABEL[t.kind] || t.kind)} · ${esc(dueLabel(t.due))}${t.status === 'doing' ? ' · <b>In progress</b>' : ''}${t.proof_key || t.link ? ' · proof added' : ''}</div>
      </div>
      <span class="small muted work-time" title="Logged vs the guide's estimate">${t.logged ? `${mins(t.logged)} / ` : ''}${mins(est)}</span>
      <span class="avatar${owner ? '' : ' empty'}" title="${esc(owner ? owner.name || owner.email : 'Nobody yet')}">${owner ? esc(initials(owner.name || owner.email)) : '?'}</span>
      <button class="icon-btn" data-play="${esc(t.id)}" title="${d.running?.task_id === t.id ? 'Stop timer' : 'Start timer'}">${d.running?.task_id === t.id ? icon.stop : icon.play}</button>
    </li>`;
  };
  view.innerHTML = `
    <div class="page-head"><div><p class="eyebrow">Fulfillment</p><h1>My work</h1></div>
      <div class="row"><select id="wwho" aria-label="Whose work">
        <option value="me"${prefs.who === 'me' ? ' selected' : ''}>Mine</option><option value="none"${prefs.who === 'none' ? ' selected' : ''}>Nobody assigned</option><option value="all"${prefs.who === 'all' ? ' selected' : ''}>Everyone</option>
        ${d.team.filter((u) => u.id !== user.id).map((u) => `<option value="${esc(u.id)}"${prefs.who === u.id ? ' selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}</select>
        <select id="wclient" aria-label="Client"><option value="">All clients</option>${clients.map(([id, n]) => `<option value="${esc(id)}"${prefs.client === id ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div></div>
    ${tabsHtml('')}
    ${d.running ? `<div class="timer-bar" id="tbar"><span class="dot"></span><div><b>${esc(d.running.title)}</b><div class="small">${esc(d.running.client_name)}</div></div><span class="spacer"></span><b class="mono" id="tclock">${clock(Date.now() - d.running.started_at)}</b><button class="btn btn-sm" data-play="${esc(d.running.task_id)}">${icon.stop}Stop</button></div>` : ''}
    <div class="stats">
      <div class="stat hero"><div class="stat-num">${d.stats.open}</div><div class="stat-label">open tasks${prefs.who === 'me' ? ' assigned to you' : ''}</div></div>
      <div class="stat"><div class="stat-num${overdue ? ' bad-text' : ''}">${overdue}</div><div class="stat-label">overdue</div></div>
      <div class="stat"><div class="stat-num">${dueWeek}</div><div class="stat-label">due in the next 7 days</div></div>
      <div class="stat"><div class="stat-num">${mins(d.stats.minutesThisMonth)}</div><div class="stat-label">logged this month, ${d.stats.doneThisMonth} tasks done</div></div>
    </div>
    <div id="wpush"></div>
    ${d.access.length ? `<div class="card warn-card"><div class="card-head"><h2>Missing access</h2><span class="small muted">${day >= 24 ? 'Next month starts soon. Get these first.' : 'Tasks that need these are blocked.'}</span></div>
      <ul class="list">${d.access.map((a) => `<li class="item"><div><div class="item-title">${esc(a.name)}</div><div class="item-sub">${a.gaps.map((g) => `${esc(g.label)}${g.status === 'requested' ? ' (asked)' : ''}`).join(', ')}</div></div><a class="btn btn-ghost btn-sm" href="#/client/${esc(a.client_id)}/accesslist">Open checklist</a></li>`).join('')}</ul></div>` : ''}
    ${d.meetings.length ? `<div class="card"><div class="card-head"><h2>Client meetings this week</h2></div><ul class="list">${d.meetings.map((m) => `<li class="item"><span class="badge gray">${esc(new Date(m.start_at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</span>
      <div><div class="item-title">${esc(m.client_name)}</div><div class="item-sub">${esc(m.title)}</div></div>${m.meet_link ? `<a class="btn btn-primary btn-sm" href="${esc(m.meet_link)}" target="_blank" rel="noopener">Join</a>` : `<a class="btn btn-ghost btn-sm" href="#/client/${esc(m.client_id)}/meetings">Open</a>`}</li>`).join('')}</ul></div>` : ''}
    <div class="bulk-bar" id="bulk" hidden><b id="bcount">0 selected</b><select id="bowner"><option value="">Assign to...</option>${d.team.map((u) => `<option value="${esc(u.id)}">${esc(u.name || u.email)}</option>`).join('')}<option value="-">Nobody</option></select>
      <input type="date" id="bdue" aria-label="Due date"><button class="btn btn-primary btn-sm" id="bapply">Apply</button></div>
    ${d.tasks.length ? groups.map(([label, f]) => { const list = d.tasks.filter(f); return list.length ? `<div class="group-title">${label} · ${list.length}</div><ul class="list work-list">${list.map(row).join('')}</ul>` : ''; }).join('')
      : `<div class="card empty"><h3>Nothing open${prefs.who === 'me' ? ' for you' : ''}</h3><p>${prefs.who === 'me' ? 'Pick "Nobody assigned" to grab work, or set an account manager on a client so its tasks come to them.' : 'Every task is done or there are no active clients yet.'}</p></div>`}`;
  import('./alerts.js').then((m) => m.pushPrompt($('#wpush', view), 'Calls, texts, voicemails, new tasks and client updates on this device.')).catch(() => {});
  clearInterval(ticker);
  if (d.running) ticker = setInterval(() => { const el = $('#tclock'); if (!el) return clearInterval(ticker); el.textContent = clock(Date.now() - d.running.started_at); }, 1000);
  const reload = () => queueView(view, user);
  $('#wwho', view).addEventListener('change', (e) => { prefs.who = e.target.value; savePrefs(); reload(); });
  $('#wclient', view).addEventListener('change', (e) => { prefs.client = e.target.value; savePrefs(); reload(); });
  const sel = new Set();
  const syncBulk = () => { $('#bulk', view).hidden = !sel.size; $('#bcount', view).textContent = `${sel.size} selected`; };
  view.addEventListener('change', (e) => { const id = e.target.dataset?.sel; if (!id) return; if (e.target.checked) sel.add(id); else sel.delete(id); syncBulk(); });
  $('#bapply', view).addEventListener('click', async (e) => {
    const body = { ids: [...sel] };
    const o = $('#bowner', view).value, due = $('#bdue', view).value;
    if (o) body.owner = o === '-' ? null : o;
    if (due) body.due = due;
    if (!('owner' in body) && !body.due) return toast('Pick a person or a date', true);
    busy(e.target, true);
    try { await api('/api/work/bulk', { method: 'POST', body }); toast('Updated'); reload(); } catch (err) { toast(err.message, true); busy(e.target, false); }
  });
  view.onclick = async (e) => {
    if (e.target.closest('[data-stop]')) return;
    const play = e.target.closest('[data-play]');
    if (play) {
      const id = play.dataset.play;
      try { await api(`/api/tasks/${id}/timer`, { method: 'POST', body: { action: d.running?.task_id === id ? 'stop' : 'start' } }); reload(); } catch (err) { toast(err.message, true); }
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open) openTask(open.dataset.open, user, { onChange: reload });
  };
  view.onkeydown = (e) => { const open = e.target.closest?.('[data-open]'); if (open && e.key === 'Enter') openTask(open.dataset.open, user, { onChange: reload }); };
}

// ---------- the task panel ----------
export async function openTask(id, user, { onChange } = {}) {
  const m = modal('<div class="skeleton"></div>', { onClose: () => { clearInterval(m?.tick); if (changed) onChange?.(); } });
  let changed = false;
  const load = async () => {
    let d;
    try { d = await api(`/api/tasks/${id}`); } catch (e) { m.el.innerHTML = `<p class="err-text">${esc(e.message)}</p><button class="btn btn-ghost" data-close>Close</button>`; return; }
    const { task: t, guide: g, time, blocked, tools, running } = d;
    const team = (await api('/api/team').catch(() => ({ users: [] }))).users.filter((u) => u.role !== 'client');
    const logged = time.filter((x) => x.ended_at).reduce((s, x) => s + (x.minutes || 0), 0);
    const mine = running?.task_id === t.id;
    const checks = new Set(t.checks || []);
    m.el.classList.add('task-panel');
    m.el.innerHTML = `
      <div class="card-head"><div><p class="eyebrow">${esc(KIND_LABEL[t.kind] || t.kind)} · <a href="#/client/${esc(t.client_id)}/tasks" data-close>${esc(t.client_name)}</a></p><h2>${esc(t.title)}</h2></div><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
      <div class="form-grid tp-meta">
        <label class="field"><span>Owner</span><select name="owner"><option value="">Nobody yet</option>${team.map((u) => `<option value="${esc(u.id)}"${t.owner === u.id ? ' selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}</select></label>
        <label class="field"><span>Due</span><input type="date" name="due" value="${esc(t.due || '')}"></label>
        <div class="field"><span>Status</span><div class="row"><span class="badge ${t.status === 'done' ? '' : t.status === 'doing' ? 'warn' : 'gray'}">${t.status === 'doing' ? 'In progress' : t.status === 'done' ? 'Done' : t.status === 'skipped' ? 'Skipped' : 'To do'}</span></div></div>
      </div>
      <div class="timer-box${mine ? ' on' : ''}"><button class="btn ${mine ? 'btn-danger' : 'btn-primary'}" id="tp-timer">${mine ? `${icon.stop}Stop timer` : `${icon.play}Start timer`}</button>
        <b class="mono" id="tp-clock">${mine ? clock(Date.now() - running.started_at) : mins(logged)}</b><span class="small muted">${mine ? 'running' : 'logged'} · guide says about ${mins(g.minutes)}</span>
        <span class="spacer"></span><form id="tp-add" class="row"><input name="m" type="number" min="1" max="600" placeholder="Min" style="width:76px" aria-label="Minutes"><button class="btn btn-ghost btn-sm" type="submit">Add time</button></form></div>
      ${blocked.length ? `<div class="warn-card card"><b>Waiting on access:</b> ${blocked.map((b) => esc(b.label)).join(', ')}.<p class="small">${esc(blocked[0].how)}</p><a class="small" href="#/client/${esc(t.client_id)}/accesslist" data-close>Open the access checklist</a></div>` : ''}
      ${toolsHtml(tools, t)}
      <details class="tp-guide" open><summary><b>How to do it</b> <span class="small muted">${esc(PROOF_TXT[g.proof])} to close</span></summary>
        ${g.need.length ? `<p class="small"><b>You need:</b> ${g.need.map(esc).join('; ')}</p>` : ''}
        <ol class="steps">${g.steps.map((s, i) => `<li><label><input type="checkbox" data-check="${i}"${checks.has(i) ? ' checked' : ''}> <span>${esc(s)}</span></label></li>`).join('')}</ol>
        <p class="small"><b>Done looks like:</b> ${esc(g.done)}</p>
        ${user.role === 'admin' ? `<a class="small" href="#/work/guides/${esc(t.kind)}" data-close>Edit this guide</a>` : ''}</details>
      <div class="card" style="box-shadow:none">
        <h3>Proof and notes</h3>
        <div class="form-grid" style="grid-template-columns:1fr">
          <label class="field"><span>Live link (post, page, listing, test result)</span><input name="link" type="url" placeholder="https://" value="${esc(t.link || '')}"></label>
          <div class="field"><span>Screenshot</span><div class="row">${t.proof_key ? `<a href="/api/tasks/${esc(t.id)}/proof" target="_blank" rel="noopener"><img class="proof-thumb" src="/api/tasks/${esc(t.id)}/proof?v=${Date.now()}" alt="Screenshot"></a><button class="btn btn-ghost btn-sm" id="tp-rmshot" type="button">Remove</button>` : ''}
            <label class="btn btn-ghost btn-sm">${icon.upload}${t.proof_key ? 'Replace' : 'Attach'} screenshot<input type="file" id="tp-shot" accept="image/*" hidden></label></div></div>
          <label class="field"><span>Note (what was done)</span><textarea name="note" rows="3">${esc(t.note || '')}</textarea></label>
          <label class="row small" style="gap:6px"><input type="checkbox" name="cv"${t.client_visible ? ' checked' : ''}> The client can see this task in their app and report</label>
        </div>
      </div>
      ${time.length ? `<details><summary class="small">Time log (${time.length})</summary><ul class="list">${time.map((x) => `<li class="item"><span class="badge gray">${x.ended_at ? mins(x.minutes) : 'running'}</span><div class="item-sub">${esc(x.who || '')} · ${esc(fmt.date(x.started_at))}${x.manual ? ' · added by hand' : ''}${x.note ? ` · ${esc(x.note)}` : ''}</div><button class="icon-btn" data-deltime="${esc(x.id)}" title="Remove">${icon.trash}</button></li>`).join('')}</ul></details>` : ''}
      <div class="row end tp-foot">${t.status !== 'done' ? '<button class="btn btn-ghost" id="tp-skip">Skip</button>' : '<button class="btn btn-ghost" id="tp-reopen">Reopen</button>'}
        <button class="btn btn-ghost" id="tp-save">Save</button>${t.status !== 'done' ? `<button class="btn btn-primary" id="tp-done">${icon.check}Mark done</button>` : ''}</div>`;
    clearInterval(m.tick);
    if (mine) m.tick = setInterval(() => { const el = $('#tp-clock', m.el); if (el) el.textContent = clock(Date.now() - running.started_at); }, 1000);
    const fields = () => ({ owner: $('[name=owner]', m.el).value || null, due: $('[name=due]', m.el).value || null, link: $('[name=link]', m.el).value.trim(), note: $('[name=note]', m.el).value, client_visible: $('[name=cv]', m.el).checked });
    const save = async (extra = {}) => { await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { ...fields(), ...extra } }); changed = true; };
    $('#tp-timer', m.el).addEventListener('click', async (e) => { busy(e.currentTarget, true); try { await api(`/api/tasks/${t.id}/timer`, { method: 'POST', body: { action: mine ? 'stop' : 'start' } }); changed = true; load(); } catch (err) { toast(err.message, true); busy(e.currentTarget, false); } });
    $('#tp-add', m.el).addEventListener('submit', async (e) => { e.preventDefault(); try { await api(`/api/tasks/${t.id}/time`, { method: 'POST', body: { minutes: Number(e.target.m.value) } }); changed = true; toast('Time added'); load(); } catch (err) { toast(err.message, true); } });
    $$('[data-check]', m.el).forEach((cb) => cb.addEventListener('change', async () => {
      if (cb.checked) checks.add(Number(cb.dataset.check)); else checks.delete(Number(cb.dataset.check));
      try { await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { checks: [...checks] } }); } catch (err) { toast(err.message, true); }
    }));
    $('#tp-shot', m.el).addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const form = new FormData(); form.append('file', await resizeImage(f, 2000, 0.85));
      try { await save(); await api(`/api/tasks/${t.id}/proof`, { method: 'POST', form }); changed = true; toast('Screenshot attached'); load(); } catch (err) { toast(err.message, true); }
    });
    $('#tp-rmshot', m.el)?.addEventListener('click', async () => { try { await api(`/api/tasks/${t.id}/proof`, { method: 'DELETE' }); changed = true; load(); } catch (err) { toast(err.message, true); } });
    $('#tp-save', m.el).addEventListener('click', async (e) => { busy(e.target, true); try { await save(); toast('Saved'); load(); } catch (err) { toast(err.message, true); busy(e.target, false); } });
    $('#tp-done', m.el)?.addEventListener('click', async (e) => {
      busy(e.currentTarget, true);
      try { if (mine) await api(`/api/tasks/${t.id}/timer`, { method: 'POST', body: { action: 'stop' } }); await save({ status: 'done' }); toast('Done'); m.close(); }
      catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
    });
    $('#tp-skip', m.el)?.addEventListener('click', async () => { try { await save({ status: 'skipped' }); toast('Skipped'); m.close(); } catch (err) { toast(err.message, true); } });
    $('#tp-reopen', m.el)?.addEventListener('click', async () => { try { await save({ status: 'todo' }); load(); } catch (err) { toast(err.message, true); } });
    m.el.onclick = async (e) => {
      const b = e.target.closest('[data-act]');
      const del = e.target.closest('[data-deltime]');
      if (del) { try { await api(`/api/time/${del.dataset.deltime}`, { method: 'DELETE' }); changed = true; load(); } catch (err) { toast(err.message, true); } return; }
      if (!b) return;
      await toolAction(b, t, m, () => { changed = true; load(); });
    };
    const fixForm = $('#tp-fix', m.el);
    fixForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(fixForm).entries());
      try { await api(`/api/clients/${t.client_id}/site/fixes`, { method: 'POST', body: { ...f, kind: t.kind === 'technical' ? 'technical' : 'onpage' } }); changed = true; toast('Fix logged. The next crawl checks it.'); if (f.page && !$('[name=link]', m.el).value) $('[name=link]', m.el).value = f.page; fixForm.reset(); }
      catch (err) { toast(err.message, true); }
    });
  };
  load();
  return m;
}

function toolsHtml(tools, t) {
  const cid = esc(t.client_id);
  const k = tools.kind;
  if (k === 'post') {
    return `<div class="card tool-card"><div class="card-head"><h3>Posts ready to go</h3><a class="small" href="#/client/${cid}/posts" data-close>Posts tab</a></div>
      ${tools.posts.length ? `<ul class="list">${tools.posts.map((p) => `<li class="item tool-post">${p.media_key ? `<img src="/api/media/${esc(p.id)}" alt="" loading="lazy">` : '<span class="badge gray">No photo</span>'}
        <div><span class="badge ${p.status === 'approved' ? '' : 'gray'}">${p.status === 'approved' ? 'Approved' : 'Draft'}</span><div class="item-sub">${esc((p.google_text || '').slice(0, 140))}</div>
        <div class="row" style="margin-top:6px"><button class="btn btn-ghost btn-sm" data-act="copycap" data-text="${esc(p.google_text || '')}">Copy caption</button>${p.media_key ? `<a class="btn btn-ghost btn-sm" href="/api/media/${esc(p.id)}?download=1">Download photo</a>` : ''}
        ${tools.gbp ? `<button class="btn btn-primary btn-sm" data-act="gbppost" data-post="${esc(p.id)}">Publish to Google</button>` : `<button class="btn btn-primary btn-sm" data-act="posted" data-post="${esc(p.id)}">Mark posted</button>`}</div></div></li>`).join('')}</ul>`
        : `<p class="muted small">No approved posts. Make one in the Posts tab from the client's photos.</p>`}
      ${tools.gbp ? '' : '<p class="small muted">Open business.google.com as hello@rightwaygrowth.com, Add update, paste, publish. Then put the post link or a screenshot below.</p>'}</div>`;
  }
  if (k === 'photos') return tools.gbp ? `<div class="card tool-card"><p class="small">The profile is connected: upload photos from the <a href="#/client/${cid}/gbp" data-close>Google profile tab</a>.</p></div>` : '';
  if (k === 'link' || (k === 'setup' && /citation|listing/i.test(t.title))) {
    const all = tools.details.map((x) => `${x.label}: ${x.value}`).join('\n');
    return `<div class="card tool-card"><div class="card-head"><h3>Business details to copy</h3><button class="btn btn-ghost btn-sm" data-act="copycap" data-text="${esc(all)}">Copy all</button></div>
      <dl class="kv">${tools.details.map((x) => `<dt>${esc(x.label)}</dt><dd><span>${esc(x.value)}</span> <button class="linkish" data-act="copycap" data-text="${esc(x.value)}">Copy</button></dd>`).join('')}</dl>
      ${tools.missing?.length ? `<p class="small"><b>Not listed or wrong:</b> ${tools.missing.map((x) => `${esc(x.name)}${x.status === 'mismatch' ? ' (wrong details)' : ''}`).join(', ')}</p>` : ''}
      ${tools.submitted?.length ? `<p class="small"><b>Submitted, waiting to go live:</b> ${tools.submitted.map((x) => esc(x.name)).join(', ')}</p>` : ''}
      <a class="small" href="#/client/${cid}/citations" data-close>Open the Citations tab (directories, link log, prospects)</a></div>`;
  }
  if (k === 'onpage' || k === 'technical') {
    return `<div class="card tool-card"><div class="card-head"><h3>From the site audit</h3><a class="small" href="#/client/${cid}/site" data-close>Site audit tab</a></div>
      ${tools.audit ? `<p class="small">Health score ${tools.audit.score}. Top issues:</p><ul class="list">${tools.audit.issues.map((i) => `<li class="item"><span class="badge ${i.severity === 'high' ? 'bad' : i.severity === 'medium' ? 'warn' : 'gray'}">${esc(i.severity)}</span><div><div class="item-title">${esc(i.title)}</div><div class="item-sub">${esc(i.fix || '')}${i.pages?.length ? ` · ${i.pages.map(esc).join(', ')}` : ''}</div></div></li>`).join('') || '<li class="muted small">No open issues of this kind.</li>'}</ul>`
        : '<p class="small muted">No crawl yet. Run one from the Site audit tab.</p>'}
      <form id="tp-fix" class="form-grid" style="margin-top:10px"><label class="field span-all"><span>Log a fix: what you changed</span><input name="what" required placeholder="Home page title now has the main service and city"></label>
        <label class="field"><span>Page</span><input name="page" type="url" placeholder="https://"></label><label class="field"><span>Before</span><input name="before"></label><label class="field"><span>After</span><input name="after"></label>
        <div class="span-all row end"><button class="btn btn-ghost btn-sm" type="submit">Log fix</button></div></form></div>`;
  }
  if (k === 'page' || k === 'content') {
    return `<div class="card tool-card"><div class="card-head"><h3>Pages in progress</h3><a class="small" href="#/client/${cid}/content" data-close>Content tab</a></div>
      ${tools.content.length ? `<ul class="list">${tools.content.map((c) => `<li class="item"><span class="badge ${c.status === 'approved' ? '' : 'gray'}">${esc(c.status)}</span><div class="item-title">${esc(c.title)}</div><a class="btn btn-ghost btn-sm" href="#/client/${cid}/content/${esc(c.id)}" data-close>Open</a></li>`).join('')}</ul>` : '<p class="small muted">Nothing in progress. Pick an idea in the Content tab.</p>'}
      ${tools.wp ? '<p class="small">WordPress is connected: publish from the Content tab.</p>' : '<p class="small muted">WordPress is not connected for this client yet (Content tab, Website settings).</p>'}</div>`;
  }
  if (['replies', 'reviews', 'monitor', 'reputation'].includes(k)) {
    const list = tools.reviews?.unanswered || [];
    return `<div class="card tool-card"><div class="card-head"><h3>Reviews without a reply</h3><a class="small" href="#/client/${cid}/${tools.gbp ? 'gbp' : 'reputation'}" data-close>${tools.gbp ? 'Google profile tab' : 'Reputation tab'}</a></div>
      ${tools.gbp ? '<p class="small">The profile is connected: reply right from the Google profile tab.</p>' : ''}
      ${list.length ? `<ul class="list">${list.map((r, i) => `<li class="item"><span class="badge ${r.rating <= 3 ? 'bad' : ''}">${r.rating}★</span><div><div class="item-sub">${esc(r.name || 'Customer')} · ${esc(fmt.date(r.at))}</div><div>${esc((r.text || '(no text)').slice(0, 220))}</div>
        <div class="row" style="margin-top:6px"><button class="btn btn-ghost btn-sm" data-act="draft" data-i="${i}" data-name="${esc(r.name || '')}" data-stars="${r.rating}" data-text="${esc((r.text || '').slice(0, 1200))}">Draft a reply</button>${r.url ? `<a class="btn btn-ghost btn-sm" href="${esc(r.url)}" target="_blank" rel="noopener">Open on Google</a>` : ''}</div><div class="draft-out" id="draft-${i}"></div></div></li>`).join('')}</ul>`
        : `<p class="small muted">${tools.reviews?.at ? 'Every review in the last pull has a reply.' : 'No reviews pulled yet. Use Get their Google reviews in the Reputation tab.'}</p>`}</div>`;
  }
  if (k === 'report' || k === 'calls') return `<div class="card tool-card"><p class="small">${tools.report ? `This month's report is <b>${esc(tools.report.status)}</b>. <a href="${esc(tools.report.url)}" target="_blank" rel="noopener">Open it</a>.` : 'No report for this month yet.'} <a href="#/client/${cid}/reports" data-close>Reports tab</a></p></div>`;
  if (k === 'meeting') return `<div class="card tool-card"><p class="small">${tools.meeting ? `Booked for <b>${esc(new Date(tools.meeting.start_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</b>${tools.meeting.meet_link ? `. <a href="${esc(tools.meeting.meet_link)}" target="_blank" rel="noopener">Meet link</a>` : ''}.` : 'Not booked yet.'} <a href="#/client/${cid}/meetings" data-close>Meetings tab</a></p></div>`;
  return '';
}

async function toolAction(b, t, m, refresh) {
  const act = b.dataset.act;
  try {
    if (act === 'copycap') return copy(b.dataset.text, 'Copied');
    if (act === 'posted') {
      const live = prompt('Paste the live post link (or leave empty and attach a screenshot below)', '');
      if (live === null) return;
      busy(b, true);
      await api(`/api/posts/${b.dataset.post}`, { method: 'PATCH', body: { status: 'posted', live_url: live.trim() } });
      if (live.trim()) toast('Posted and this task is done'); else toast('Marked posted. Attach a screenshot to close the task.');
      return refresh();
    }
    if (act === 'gbppost') {
      busy(b, true);
      const r = await api(`/api/posts/${b.dataset.post}/gbp`, { method: 'POST' });
      toast(r.url ? 'Published to Google' : 'Sent to Google');
      return refresh();
    }
    if (act === 'draft') {
      busy(b, true);
      const r = await api(`/api/clients/${t.client_id}/review-reply`, { method: 'POST', body: { name: b.dataset.name, stars: Number(b.dataset.stars), text: b.dataset.text } });
      const out = $(`#draft-${b.dataset.i}`, m.el);
      out.innerHTML = `<textarea rows="4">${esc(r.reply)}</textarea><button class="btn btn-ghost btn-sm" data-act="copydraft">Copy reply</button>`;
      busy(b, false);
      return;
    }
    if (act === 'copydraft') return copy(b.previousElementSibling.value, 'Reply copied');
  } catch (err) { toast(err.message, true); busy(b, false); }
}

// ---------- hours ----------
async function hoursView(view, user, month) {
  const now = new Date();
  month ||= `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Fulfillment</p><h1>Hours</h1></div><input type="month" id="hm" value="${esc(month)}" aria-label="Month"></div>${tabsHtml('hours')}<div class="skeleton"></div>`;
  let d;
  try { d = await api(`/api/work/hours?month=${month}`); } catch (e) { view.insertAdjacentHTML('beforeend', `<p class="err-text">${esc(e.message)}</p>`); return; }
  const money = d.revenue != null;
  view.querySelector('.skeleton').outerHTML = `
    <div class="stats">
      <div class="stat hero"><div class="stat-num">${mins(d.total)}</div><div class="stat-label">logged in ${esc(fmt.month(month))}</div></div>
      ${money ? `<div class="stat"><div class="stat-num">${d.perHour != null ? fmt.money(d.perHour) : '-'}</div><div class="stat-label">revenue per hour worked</div></div><div class="stat"><div class="stat-num">${fmt.money(d.revenue)}</div><div class="stat-label">monthly revenue from active clients</div></div>` : ''}
      <div class="stat"><div class="stat-num">${d.perUser.length}</div><div class="stat-label">people logged time</div></div>
    </div>
    <div class="card"><div class="card-head"><h2>Per client</h2><span class="small muted">Planned = the plan's monthly tasks times each guide's time</span></div>
      <div class="table-wrap"><table><thead><tr><th>Client</th><th>Plan</th><th>Logged</th><th>Planned</th>${money ? '<th>Monthly</th><th>Per hour</th>' : ''}</tr></thead><tbody>
      ${d.perClient.map((c) => `<tr><td><a href="#/client/${esc(c.id)}/tasks">${esc(c.name)}</a></td><td>${esc(PLAN_NAMES[c.plan] || c.plan)}</td><td><b>${mins(c.minutes)}</b></td><td>${mins(c.planned)}</td>${money ? `<td>${fmt.money(c.revenue)}</td><td class="${c.perHour != null && c.perHour < 50 ? 'bad-text' : ''}">${c.perHour != null ? fmt.money(c.perHour) : '-'}</td>` : ''}</tr>`).join('') || '<tr><td colspan="6" class="muted">No active clients.</td></tr>'}</tbody></table></div></div>
    <div class="split" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
      <div class="card"><h2>Per person</h2><ul class="list">${d.perUser.map((u) => `<li class="item"><span class="avatar">${esc(initials(u.name))}</span><div class="item-title">${esc(u.name)}</div><span class="small"><b>${mins(u.minutes)}</b> on ${u.tasks} task${u.tasks === 1 ? '' : 's'}</span></li>`).join('') || '<li class="muted small">No time logged yet. Start a timer on any task.</li>'}</ul></div>
      <div class="card"><h2>Per kind of task</h2><div class="table-wrap"><table><thead><tr><th>Kind</th><th>Average</th><th>Guide says</th></tr></thead><tbody>
        ${d.perKind.map((k) => `<tr><td>${esc(KIND_LABEL[k.kind] || k.kind)}</td><td><b>${mins(k.avg)}</b> <span class="muted small">(${k.tasks})</span></td><td class="${k.avg > k.estimate * 1.5 ? 'bad-text' : ''}">${mins(k.estimate)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nothing yet.</td></tr>'}</tbody></table></div>
        <p class="small muted">If a kind runs well over the guide, fix the guide or the price.</p></div>
    </div>`;
  $('#hm', view).addEventListener('change', (e) => hoursView(view, user, e.target.value));
}

// ---------- guides ----------
async function guidesView(view, user, focus) {
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Fulfillment</p><h1>Guides</h1></div></div>${tabsHtml('guides')}<div class="skeleton"></div>`;
  let d;
  try { d = await api('/api/guides'); } catch (e) { view.insertAdjacentHTML('beforeend', `<p class="err-text">${esc(e.message)}</p>`); return; }
  const admin = user.role === 'admin';
  view.querySelector('.skeleton').outerHTML = `<p class="muted">Every task opens with its guide. ${admin ? 'Edit a guide and everyone sees the new steps on their next task.' : 'Owners can edit these.'}</p>
    <div class="guides">${d.guides.map((g) => `<div class="card guide${focus === g.kind ? ' is-focus' : ''}" id="g-${esc(g.kind)}"><div class="card-head"><div><p class="eyebrow">${esc(KIND_LABEL[g.kind] || g.kind)}${g.edited ? ' · edited' : ''}</p><h3>${esc(g.title)}</h3></div>
      ${admin ? `<button class="btn btn-ghost btn-sm" data-edit="${esc(g.kind)}">Edit</button>` : ''}</div>
      <p class="small">About ${mins(g.minutes)} · ${esc(PROOF_TXT[g.proof])} to close</p>
      <ol class="steps small">${g.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol><p class="small"><b>Done:</b> ${esc(g.done)}</p></div>`).join('')}</div>`;
  if (focus) $(`#g-${focus}`, view)?.scrollIntoView({ block: 'center' });
  view.onclick = (e) => {
    const k = e.target.closest('[data-edit]')?.dataset.edit;
    if (!k) return;
    const g = d.guides.find((x) => x.kind === k);
    const m = modal(`<div class="card-head"><h2>Edit guide: ${esc(KIND_LABEL[k] || k)}</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
      <form id="gf" class="form-grid" style="grid-template-columns:1fr 1fr">
        <label class="field span-all"><span>Name</span><input name="title" value="${esc(g.title)}"></label>
        <label class="field"><span>Minutes it should take</span><input name="minutes" type="number" min="1" max="600" value="${g.minutes}"></label>
        <label class="field"><span>Proof to close</span><select name="proof">${Object.entries(PROOF_TXT).map(([v, l]) => `<option value="${v}"${g.proof === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field span-all"><span>What you need (one per line)</span><textarea name="need" rows="3">${esc(g.need.join('\n'))}</textarea></label>
        <label class="field span-all"><span>Steps (one per line)</span><textarea name="steps" rows="9">${esc(g.steps.join('\n'))}</textarea></label>
        <label class="field span-all"><span>What done looks like</span><input name="done" value="${esc(g.done)}"></label>
        <div class="span-all row end">${g.edited ? '<button class="btn btn-ghost" type="button" id="greset">Back to the default</button>' : ''}<button class="btn btn-primary" type="submit">Save guide</button></div></form>`);
    $('#gf', m.el).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try { await api(`/api/guides/${k}`, { method: 'PUT', body: Object.fromEntries(new FormData(ev.target).entries()) }); toast('Guide saved'); m.close(); guidesView(view, user, k); } catch (err) { toast(err.message, true); }
    });
    $('#greset', m.el)?.addEventListener('click', async () => { try { await api(`/api/guides/${k}`, { method: 'DELETE' }); m.close(); guidesView(view, user, k); } catch (err) { toast(err.message, true); } });
  };
}

// ---------- client Access checklist tab ----------
export async function accessListTab(el, c) {
  el.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/access`); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const ask = d.items.filter((i) => i.required && i.status === 'missing');
  const msg = `Hi${c.contact_name ? ` ${c.contact_name.split(' ')[0]}` : ''}, to start the work we need a few accesses:\n\n${ask.map((i, n) => `${n + 1}. ${i.label}: ${i.how}`).join('\n')}\n\nUse hello@rightwaygrowth.com for each. Thank you!`;
  el.innerHTML = `<div class="card"><div class="card-head"><h2>Access checklist</h2>${d.gaps ? `<span class="badge warn">${d.gaps} missing</span>` : '<span class="badge">All set</span>'}</div>
    <p class="muted small">What the team needs from ${esc(c.name)} to do the work. Items the Hub can see on its own (WordPress saved, Search Console linked, Google profile connected, tracking number) check themselves.</p>
    <ul class="list">${d.items.map((i) => `<li class="item access-row" data-item="${esc(i.key)}"><span class="badge ${i.status === 'granted' ? '' : i.status === 'na' ? 'gray' : i.required ? 'warn' : 'gray'}">${esc(d.statuses[i.status])}</span>
      <div><div class="item-title">${esc(i.label)}${i.required ? '' : ' <span class="small muted">(optional for this plan)</span>'}${i.detected ? ' <span class="small muted">· seen by the Hub</span>' : ''}</div><div class="item-sub">${esc(i.how)}</div>
        <input class="small" data-note placeholder="Note (who sent it, login location)" value="${esc(i.note)}" style="margin-top:6px;width:100%"></div>
      <select data-status aria-label="Status">${Object.entries(d.statuses).map(([k, l]) => `<option value="${k}"${i.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select></li>`).join('')}</ul>
    ${ask.length ? `<div class="row" style="margin-top:12px"><button class="btn btn-ghost btn-sm" id="acopy">Copy a message asking for what is missing</button>${c.contact_email ? `<a class="btn btn-ghost btn-sm" href="mailto:${esc(c.contact_email)}?subject=${encodeURIComponent('Access we need to start')}&body=${encodeURIComponent(msg)}">${icon.mail}Email it</a>` : ''}</div>` : ''}</div>`;
  $('#acopy', el)?.addEventListener('click', () => copy(msg, 'Message copied'));
  $$('.access-row', el).forEach((row) => {
    const put = async (body) => { try { await api(`/api/clients/${c.id}/access/${row.dataset.item}`, { method: 'PUT', body }); toast('Saved'); } catch (err) { toast(err.message, true); } };
    $('[data-status]', row).addEventListener('change', async (e) => { await put({ status: e.target.value }); accessListTab(el, c); });
    $('[data-note]', row).addEventListener('change', (e) => put({ note: e.target.value }));
  });
}
