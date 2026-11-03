// Google Drive inside the Hub: browse, search, make folders, docs and sheets, upload, share, download.
import { $, $$, esc, api, toast, busy, icon, modal, copy } from './core.js';
import { staffShell } from './staff.js';
import { googleTabs } from './googleapps.js';

const S = { folder: 'root', q: '', files: [], crumbs: [], cursor: null, email: '' };
const KIND = {
  folder: ['Folder', '#E8A33D'], doc: ['Google Doc', '#3B82F6'], sheet: ['Google Sheet', '#23B07E'],
  slides: ['Slides', '#E8A33D'], image: ['Picture', '#8B5CF6'], pdf: ['PDF', '#D64545'], file: ['File', '#61716B'],
};
const size = (n) => (!n ? '' : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (ms) => (!ms ? '' : new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }));

export async function drivePage(app, user, sub = '') {
  const view = staffShell(app, user, 'google');
  if (sub) S.folder = sub;
  view.innerHTML = `${googleTabs('drive')}<div class="skeleton" style="height:360px"></div>`;
  try { await load(view, true); }
  catch (e) {
    view.innerHTML = `${googleTabs('drive')}<div class="card"><h2>Drive is not on yet</h2><p>${esc(e.message)}</p><a class="btn btn-primary" href="/api/google/connect?back=google&apps=drive">Turn on Drive</a></div>`;
  }
}

async function load(view, first = false) {
  const d = await api(`/api/google/drive/files?${new URLSearchParams({ folder: S.folder, q: S.q })}`);
  S.files = d.files; S.crumbs = d.crumbs || []; S.cursor = d.cursor; S.email = d.email || '';
  if (first) {
    view.innerHTML = `${googleTabs('drive')}
      <div class="page-head"><div><p class="eyebrow">Google</p><h1>Drive</h1></div>
        <div class="row" style="gap:6px">
          <button class="btn btn-primary btn-sm" id="dr-new">${icon.plus} New</button>
          <button class="btn btn-ghost btn-sm" id="dr-up">Upload</button>
          <input type="file" id="dr-file" multiple hidden>
        </div></div>
      <div class="dr-bar"><input id="dr-q" type="search" placeholder="Search all of your Drive" value="${esc(S.q)}" autocomplete="off">
        <nav class="dr-crumbs" id="dr-crumbs"></nav></div>
      <div id="dr-list"></div>`;
    $('#dr-new', view).addEventListener('click', newThing);
    $('#dr-up', view).addEventListener('click', () => $('#dr-file', view).click());
    $('#dr-file', view).addEventListener('change', uploadFiles);
    const q = $('#dr-q', view);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { S.q = q.value.trim(); paint(); load(view); } });
  }
  paint();
}

function paint() {
  const crumbs = $('#dr-crumbs');
  if (crumbs) {
    crumbs.innerHTML = S.q
      ? `<button data-go="root">Clear the search</button>`
      : [['root', 'My Drive'], ...S.crumbs.map((c) => [c.id, c.name])]
        .map(([id, name], i, arr) => `<button data-go="${esc(id)}"${i === arr.length - 1 ? ' class="is-here"' : ''}>${esc(name)}</button>`).join('<span>/</span>');
    $$('[data-go]', crumbs).forEach((b) => b.addEventListener('click', () => open(b.dataset.go)));
  }
  const box = $('#dr-list');
  if (!box) return;
  box.innerHTML = S.files.length ? `<div class="dr-grid">${S.files.map(card).join('')}</div>`
    : `<div class="card"><p class="muted" style="margin:0">${S.q ? 'Nothing matched that.' : 'This folder is empty.'}</p></div>`;
  $$('.dr-card', box).forEach((c) => {
    c.addEventListener('click', (e) => {
      if (e.target.closest('[data-act]')) return;
      const f = S.files.find((x) => x.id === c.dataset.id);
      if (f.kind === 'folder') open(f.id);
      else if (f.link) window.open(f.link, '_blank', 'noopener');
    });
    $$('[data-act]', c).forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const f = S.files.find((x) => x.id === c.dataset.id);
      if (b.dataset.act === 'share') share(f);
      if (b.dataset.act === 'rename') rename(f);
      if (b.dataset.act === 'del') remove(f);
      if (b.dataset.act === 'get') window.location.href = `/api/google/drive/files/${encodeURIComponent(f.id)}/download`;
    }));
  });
}

const card = (f) => {
  const [label, color] = KIND[f.kind] || KIND.file;
  return `<div class="dr-card" data-id="${esc(f.id)}" tabindex="0">
    <span class="dr-ico" style="--c:${color}">${f.kind === 'folder' ? icon.folder : icon.doc}</span>
    <div class="dr-main"><div class="dr-name">${esc(f.name)}</div>
      <div class="small muted">${esc(label)}${f.size ? ` · ${size(f.size)}` : ''}${f.at ? ` · ${when(f.at)}` : ''}${f.shared ? ' · Shared' : ''}</div></div>
    <div class="dr-tools">
      <button class="icon-btn" data-act="share" aria-label="Share" title="Share">${icon.users}</button>
      ${f.kind === 'folder' ? '' : `<button class="icon-btn" data-act="get" aria-label="Download" title="Download">${icon.down}</button>`}
      <button class="icon-btn" data-act="rename" aria-label="Rename" title="Rename">${icon.edit}</button>
      <button class="icon-btn" data-act="del" aria-label="Move to the bin" title="Move to the bin">${icon.trash}</button>
    </div></div>`;
};

function open(id) {
  S.folder = id; S.q = '';
  const el = $('#dr-q'); if (el) el.value = '';
  location.hash = `#/google/drive${id === 'root' ? '' : `/${id}`}`;
  $('#dr-list').innerHTML = '<div class="skeleton" style="height:200px"></div>';
  load();
}

function newThing() {
  const m = modal(`<div><div class="card-head"><h2 style="margin:0">Make something new</h2><button class="icon-btn" data-close aria-label="Close">${icon.close}</button></div>
    <label class="field"><span>Name</span><input id="dn-name" placeholder="Untitled"></label>
    <label class="field"><span>What is it</span><select id="dn-kind">
      <option value="doc">Google Doc</option><option value="sheet">Google Sheet</option>
      <option value="slides">Slides</option><option value="folder">Folder</option></select></label>
    <div class="row end" style="gap:8px;margin-top:14px"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="dn-go">Make it</button></div></div>`);
  setTimeout(() => $('#dn-name', m.el).focus(), 60);
  $('#dn-go', m.el).addEventListener('click', async (e) => {
    busy(e.currentTarget, true);
    try {
      const r = await api('/api/google/drive/new', { method: 'POST', body: { name: $('#dn-name', m.el).value || 'Untitled', kind: $('#dn-kind', m.el).value, parent: S.folder } });
      m.close(); toast('Made it');
      if (r.file.link) window.open(r.file.link, '_blank', 'noopener');
      load();
    } catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
  });
}

async function uploadFiles(e) {
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) {
    if (f.size > 20e6) { toast(`${f.name} is bigger than 20 MB`, true); continue; }
    toast(`Uploading ${f.name}`);
    const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(f); });
    try { await api('/api/google/drive/upload', { method: 'POST', body: { name: f.name, type: f.type || 'application/octet-stream', data, parent: S.folder } }); }
    catch (err) { toast(err.message, true); }
  }
  toast('Uploaded');
  load();
}

function rename(f) {
  const m = modal(`<div><div class="card-head"><h2 style="margin:0">Rename</h2><button class="icon-btn" data-close aria-label="Close">${icon.close}</button></div>
    <label class="field"><span>Name</span><input id="dr-rn" value="${esc(f.name)}"></label>
    <div class="row end" style="gap:8px;margin-top:14px"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="dr-rngo">Save</button></div></div>`);
  $('#dr-rngo', m.el).addEventListener('click', async (e) => {
    busy(e.currentTarget, true);
    try { await api(`/api/google/drive/files/${encodeURIComponent(f.id)}`, { method: 'PATCH', body: { name: $('#dr-rn', m.el).value } }); m.close(); toast('Renamed'); load(); }
    catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
  });
}

async function remove(f) {
  if (!confirm(`Move "${f.name}" to the bin in Drive?`)) return;
  try { await api(`/api/google/drive/files/${encodeURIComponent(f.id)}`, { method: 'DELETE' }); toast('In the bin'); load(); }
  catch (err) { toast(err.message, true); }
}

export function share(f) {
  const m = modal(`<div class="dr-share"><div class="card-head"><h2 style="margin:0">Share ${esc(f.name)}</h2><button class="icon-btn" data-close aria-label="Close">${icon.close}</button></div>
    <div class="dr-who" id="dr-who"><div class="skeleton" style="height:50px"></div></div>
    <div class="form-grid" style="margin-top:12px">
      <label class="field"><span>Email address</span><input id="ds-email" placeholder="name@business.com" autocomplete="off"></label>
      <label class="field"><span>What they can do</span><select id="ds-role"><option value="reader">View</option><option value="commenter">Comment</option><option value="writer">Edit</option></select></label>
    </div>
    <div class="row" style="gap:8px;margin-top:10px">
      <button class="btn btn-primary btn-sm" id="ds-go">Share</button>
      <button class="btn btn-ghost btn-sm" id="ds-link">Anyone with the link can view</button>
      ${f.link ? `<button class="btn btn-ghost btn-sm" id="ds-copy">Copy the link</button>` : ''}
    </div></div>`);
  const el = m.el;
  const who = async () => {
    try {
      const r = await api(`/api/google/drive/files/${encodeURIComponent(f.id)}/who`);
      $('#dr-who', el).innerHTML = r.people.length
        ? `<ul class="list">${r.people.map((p) => `<li class="item"><span></span><div><div class="item-title">${esc(p.who)}</div></div><span class="badge gray">${esc(p.role === 'writer' ? 'Can edit' : p.role === 'commenter' ? 'Can comment' : 'Can view')}</span></li>`).join('')}</ul>`
        : '<p class="small muted">Only you so far.</p>';
    } catch (e) { $('#dr-who', el).innerHTML = `<p class="small muted">${esc(e.message)}</p>`; }
  };
  who();
  $('#ds-copy', el)?.addEventListener('click', () => copy(f.link, 'Link copied'));
  $('#ds-go', el).addEventListener('click', async (e) => {
    busy(e.currentTarget, true);
    try { await api(`/api/google/drive/files/${encodeURIComponent(f.id)}/share`, { method: 'POST', body: { email: $('#ds-email', el).value, role: $('#ds-role', el).value } }); $('#ds-email', el).value = ''; toast('Shared'); who(); load(); }
    catch (err) { toast(err.message, true); } finally { busy(e.currentTarget, false); }
  });
  $('#ds-link', el).addEventListener('click', async (e) => {
    busy(e.currentTarget, true);
    try { await api(`/api/google/drive/files/${encodeURIComponent(f.id)}/share`, { method: 'POST', body: { anyone: true, role: 'reader' } }); toast('Anyone with the link can view it'); who(); }
    catch (err) { toast(err.message, true); } finally { busy(e.currentTarget, false); }
  });
}

// The client's own Drive folder, shown on their page.
export async function clientDriveTab(el, c) {
  el.innerHTML = '<div class="skeleton" style="height:120px"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/drive`); }
  catch (e) {
    el.innerHTML = `<div class="card"><h2>Drive</h2><p>${esc(e.message)}</p><a class="btn btn-ghost btn-sm" href="#/google">Google setup</a></div>`;
    return;
  }
  el.innerHTML = `<div class="card"><div class="card-head"><h2>Files for ${esc(c.name)}</h2>
      <div class="row" style="gap:6px"><button class="btn btn-ghost btn-sm" id="cd-up">Upload</button>
        <a class="btn btn-ghost btn-sm" href="#/google/drive/${esc(d.folder)}">Open the folder</a>
        <input type="file" id="cd-file" multiple hidden></div></div>
    ${d.files.length ? `<ul class="list">${d.files.map((f) => `<li class="item"><span></span>
      <div><div class="item-title">${esc(f.name)}</div><div class="small muted">${esc((KIND[f.kind] || KIND.file)[0])}${f.at ? ` · ${when(f.at)}` : ''}</div></div>
      ${f.link ? `<a class="btn btn-ghost btn-sm" href="${esc(f.link)}" target="_blank" rel="noopener">Open</a>` : ''}</li>`).join('')}</ul>`
      : '<p class="muted">Nothing in this client\'s folder yet. Anything you send to Docs from here lands in it.</p>'}</div>`;
  $('#cd-up', el).addEventListener('click', () => $('#cd-file', el).click());
  $('#cd-file', el).addEventListener('change', async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    for (const f of files) {
      if (f.size > 20e6) { toast(`${f.name} is bigger than 20 MB`, true); continue; }
      const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(f); });
      try { await api('/api/google/drive/upload', { method: 'POST', body: { name: f.name, type: f.type || 'application/octet-stream', data, parent: d.folder } }); }
      catch (err) { toast(err.message, true); }
    }
    toast('Uploaded'); clientDriveTab(el, c);
  });
}

// "Send to Google Docs" from a page draft.
export async function sendToDocs(clientId, { contentId, html, what }) {
  const r = await api(`/api/clients/${clientId}/to-doc`, { method: 'POST', body: { contentId, html, what } });
  toast('In your Drive');
  if (r.file.link) window.open(r.file.link, '_blank', 'noopener');
  return r.file;
}
