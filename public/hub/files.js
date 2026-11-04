// Files in the Hub: company files and a folder per client, stored in the Hub itself (no Google Drive).
import { $, $$, esc, api, toast, modal, icon } from './core.js';
import { staffShell } from './shell.js';

const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const when = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
const viewable = (m) => /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/plain)$/.test(m || '');
const MAX = 25 * 1024 * 1024;

async function upload(file, client, folder) {
  if (file.size > MAX) throw new Error(`${file.name} is over 25 MB.`);
  const q = new URLSearchParams({ name: file.name, client: client || '', folder: folder || '' });
  const res = await fetch(`/api/files?${q}`, { method: 'POST', headers: { 'x-rw': '1', 'content-type': file.type || 'application/octet-stream' }, body: file, credentials: 'same-origin' });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `Upload failed (HTTP ${res.status}).`);
}

function ask(title, label, value, cta) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal(`<h2>${esc(title)}</h2><form id="askf" class="form-grid" style="grid-template-columns:1fr"><label class="field"><span>${esc(label)}</span><input name="v" required maxlength="160" value="${esc(value || '')}"></label>
      <div class="row"><button class="btn btn-primary" type="submit">${esc(cta)}</button><button class="btn btn-ghost" type="button" data-close>Cancel</button></div></form>`, { onClose: () => { if (!done) resolve(null); } });
    const f = $('#askf', m.el);
    f.v.focus(); f.v.select();
    f.addEventListener('submit', (e) => { e.preventDefault(); done = true; m.close(); resolve(f.v.value.trim()); });
  });
}

// The file browser. `client` is a client id for that client's folder, or '' for company files.
export async function filesWidget(box, { client = '' } = {}) {
  const S = { folder: '', q: '' };
  const draw = async () => {
    let d;
    try { d = await api(`/api/files?client=${encodeURIComponent(client)}&folder=${encodeURIComponent(S.folder)}&q=${encodeURIComponent(S.q)}`); }
    catch (e) { box.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
    const trail = d.crumbs.map((c, i) => `<span class="muted">/</span> <a href="#" data-crumb="${esc(c.id)}"${i === d.crumbs.length - 1 ? ' style="font-weight:600"' : ''}>${esc(c.name)}</a>`).join(' ');
    box.innerHTML = `<div class="row" style="gap:8px;margin-bottom:10px;align-items:center">
        <div style="flex:1 1 200px;min-width:0"><a href="#" data-crumb="">${client ? 'This client' : 'Company files'}</a> ${trail}</div>
        <input type="search" id="fq" placeholder="Search files" value="${esc(S.q)}" style="max-width:200px">
        <button class="btn btn-ghost btn-sm" id="fnew" type="button">${icon.folder}New folder</button>
        <button class="btn btn-primary btn-sm" id="fup" type="button">${icon.upload}Upload</button><input type="file" id="ffile" multiple hidden></div>
      <div id="fdrop" class="fl-drop">${d.folders.length || d.files.length ? `<div class="fl-list">
        ${d.folders.map((f) => `<div class="fl-row"><span class="fl-ico">${icon.folder}</span><a href="#" class="fl-name" data-open="${esc(f.id)}"><b>${esc(f.name)}</b></a><span class="small muted">${f.count} file${f.count === 1 ? '' : 's'}</span>
          <span class="fl-act"><button class="btn btn-ghost btn-sm" data-frename="${esc(f.id)}" data-name="${esc(f.name)}">Rename</button><button class="btn btn-ghost btn-sm" data-fdel="${esc(f.id)}">Delete</button></span></div>`).join('')}
        ${d.files.map((f) => `<div class="fl-row"><span class="fl-ico">${icon.doc}</span><a class="fl-name" href="/api/files/${esc(f.id)}/download${viewable(f.mime) ? '?view=1' : ''}" target="_blank" rel="noopener"><b>${esc(f.name)}</b></a>
          <span class="small muted">${fmtSize(f.size)} · ${when(f.at)}${f.by ? ` · ${esc(f.by)}` : ''}</span>${f.shared ? '<span class="badge">Shared</span>' : ''}
          <span class="fl-act"><a class="btn btn-ghost btn-sm" href="/api/files/${esc(f.id)}/download">Download</a><button class="btn btn-ghost btn-sm" data-link="${esc(f.id)}">${f.shared ? 'Copy link' : 'Share link'}</button>${f.shared ? `<button class="btn btn-ghost btn-sm" data-unshare="${esc(f.id)}">Stop sharing</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-rename="${esc(f.id)}" data-name="${esc(f.name)}">Rename</button><button class="btn btn-ghost btn-sm" data-move="${esc(f.id)}">Move</button><button class="icon-btn" data-del="${esc(f.id)}" aria-label="Delete" title="Delete">${icon.trash}</button></span></div>`).join('')}</div>`
      : `<div class="empty-note">${d.search ? 'No files match.' : 'Nothing here yet. Drop files here or press Upload.'}</div>`}</div>`;
    const go = (id) => { S.folder = id || ''; S.q = ''; draw(); };
    $$('[data-crumb]', box).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); go(a.dataset.crumb); }));
    $$('[data-open]', box).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); go(a.dataset.open); }));
    let t;
    $('#fq', box).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value.trim(); draw().then(() => { const i = $('#fq', box); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 300); });
    const send = async (files) => {
      let ok = 0;
      for (const f of files) { try { await upload(f, client, S.folder); ok++; } catch (e) { toast(e.message, true); } }
      if (ok) toast(ok === 1 ? 'Uploaded' : `${ok} files uploaded`);
      draw();
    };
    $('#fup', box).addEventListener('click', () => $('#ffile', box).click());
    $('#ffile', box).addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; send(fs); });
    const drop = $('#fdrop', box);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const fs = [...(e.dataTransfer?.files || [])]; if (fs.length) send(fs); });
    $('#fnew', box).addEventListener('click', async () => {
      const name = await ask('New folder', 'Folder name', '', 'Make folder');
      if (name) try { await api('/api/files/folder', { method: 'POST', body: { name, client_id: client || null, parent_id: S.folder || null } }); draw(); } catch (e) { toast(e.message, true); }
    });
    const act = (sel, fn) => $$(`[${sel}]`, box).forEach((b) => b.addEventListener('click', async () => { try { await fn(b); } catch (e) { toast(e.message, true); } }));
    act('data-frename', async (b) => { const name = await ask('Rename folder', 'Folder name', b.dataset.name, 'Save'); if (name) { await api(`/api/files/folder/${b.dataset.frename}`, { method: 'PATCH', body: { name } }); draw(); } });
    act('data-fdel', async (b) => { if (!confirm('Delete this folder?')) return; await api(`/api/files/folder/${b.dataset.fdel}`, { method: 'DELETE' }); draw(); });
    act('data-rename', async (b) => { const name = await ask('Rename file', 'File name', b.dataset.name, 'Save'); if (name) { await api(`/api/files/${b.dataset.rename}`, { method: 'PATCH', body: { name } }); draw(); } });
    act('data-del', async (b) => { if (!confirm('Delete this file for good?')) return; await api(`/api/files/${b.dataset.del}`, { method: 'DELETE' }); toast('Deleted'); draw(); });
    act('data-link', async (b) => {
      const r = await api(`/api/files/${b.dataset.link}/share`, { method: 'POST', body: {} });
      const url = `${location.origin}/api/public/f/${r.token}`;
      try { await navigator.clipboard.writeText(url); toast('Link copied. Anyone who has it can download this file.'); } catch { prompt('Copy this link', url); }
      draw();
    });
    act('data-unshare', async (b) => { await api(`/api/files/${b.dataset.unshare}/share`, { method: 'POST', body: { on: false } }); toast('Sharing is off. The old link no longer works.'); draw(); });
    act('data-move', async (b) => {
      const { folders } = await api(`/api/files/folders?client=${encodeURIComponent(client)}`);
      const m = modal(`<h2>Move file</h2><form id="mvf" class="form-grid" style="grid-template-columns:1fr"><label class="field"><span>To</span><select name="to"><option value="">${client ? 'This client (top level)' : 'Company files (top level)'}</option>${folders.map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}</select></label>
        <div class="row"><button class="btn btn-primary" type="submit">Move</button><button class="btn btn-ghost" type="button" data-close>Cancel</button></div></form>`);
      $('#mvf', m.el).addEventListener('submit', async (e) => { e.preventDefault(); try { await api(`/api/files/${b.dataset.move}`, { method: 'PATCH', body: { folder_id: e.target.to.value || null } }); m.close(); draw(); } catch (err) { toast(err.message, true); } });
    });
  };
  draw();
}

export async function clientFilesTab(el, c) {
  el.innerHTML = `<div class="card"><div class="card-head"><h2>Files for ${esc(c.name)}</h2></div><div id="fbox"><div class="skeleton" style="height:120px"></div></div></div>`;
  filesWidget($('#fbox', el), { client: c.id });
}

export async function filesPage(app, user, sub = '') {
  const view = staffShell(app, user, 'files');
  let clients = [];
  try { clients = (await api('/api/clients')).clients || []; } catch { /* company files still work */ }
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Team</p><h1>Files</h1></div>
      <label class="field" style="margin:0"><span class="small muted">Show</span><select id="fscope"><option value="">Company files</option>${clients.filter((c) => !c.sample).map((c) => `<option value="${esc(c.id)}"${c.id === sub ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label></div>
    <p class="small muted" style="margin:-8px 0 14px">Stored in the Hub. Drop files in, make folders, and share any file with a private link. Up to 25 MB each.</p>
    <div class="card" id="fbox"></div>`;
  filesWidget($('#fbox', view), { client: sub });
  $('#fscope', view).addEventListener('change', (e) => { location.hash = e.target.value ? `#/files/${e.target.value}` : '#/files'; });
}
