// Google Drive, Docs and Sheets inside the Hub: browse and search Drive, make folders, docs and sheets,
// upload and download files, share them, and keep a Drive folder per client so the work lives in one place.
import { HttpError, json } from './util.js';
import { first, run } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { accessToken } from './google.js';
import { ownFor } from './googleapps.js';

const API = 'https://www.googleapis.com/drive/v3';
const UP = 'https://www.googleapis.com/upload/drive/v3/files';
const FIELDS = 'id,name,mimeType,iconLink,webViewLink,modifiedTime,size,owners(displayName,emailAddress),shared,parents,trashed,capabilities(canEdit)';
export const GOOGLE_TYPE = {
  doc: 'application/vnd.google-apps.document',
  sheet: 'application/vnd.google-apps.spreadsheet',
  slides: 'application/vnd.google-apps.presentation',
  folder: 'application/vnd.google-apps.folder',
};
const MAX_UPLOAD = 20e6;

async function drive(env, row, path, { method = 'GET', body, base = API } = {}) {
  const t = await accessToken(env, row);
  const res = await fetch(`${base}${path}`, {
    method, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    if (res.status === 403 && /insufficient|scope/i.test(msg)) throw new HttpError('Drive needs to be turned on again on the Google page.', 400);
    throw new HttpError(`Google Drive: ${msg}`, res.status === 401 || res.status === 403 ? 400 : 502);
  }
  return data;
}

export function slimFile(f) {
  const kind = f.mimeType === GOOGLE_TYPE.folder ? 'folder'
    : f.mimeType === GOOGLE_TYPE.doc ? 'doc'
      : f.mimeType === GOOGLE_TYPE.sheet ? 'sheet'
        : f.mimeType === GOOGLE_TYPE.slides ? 'slides'
          : /^image\//.test(f.mimeType || '') ? 'image'
            : /pdf$/.test(f.mimeType || '') ? 'pdf' : 'file';
  return {
    id: f.id, name: f.name || '(no name)', kind, mime: f.mimeType || '',
    link: f.webViewLink || null, at: Date.parse(f.modifiedTime || 0) || 0,
    size: Number(f.size || 0), owner: f.owners?.[0]?.displayName || '', shared: Boolean(f.shared),
    canEdit: f.capabilities?.canEdit !== false,
    google: String(f.mimeType || '').startsWith('application/vnd.google-apps'),
  };
}
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

route('GET', '/api/google/drive/files', async ({ env, user, url }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'drive');
  const folder = url.searchParams.get('folder') || 'root';
  const q = (url.searchParams.get('q') || '').trim();
  const sort = url.searchParams.get('sort') === 'name' ? 'name' : 'modifiedTime desc';
  const where = q
    ? `name contains '${esc(q)}' and trashed = false`
    : `'${esc(folder)}' in parents and trashed = false`;
  const d = await drive(env, me, `/files?${new URLSearchParams({
    q: where, pageSize: '60', orderBy: q ? 'modifiedTime desc' : `mimeType = '${GOOGLE_TYPE.folder}' desc, ${sort}`,
    fields: `nextPageToken, files(${FIELDS})`, spaces: 'drive',
    ...(url.searchParams.get('cursor') ? { pageToken: url.searchParams.get('cursor') } : {}),
  })}`);
  let crumbs = [];
  if (!q && folder !== 'root') {
    // Walk up to five levels up so the person can see where they are.
    let at = folder;
    for (let i = 0; i < 5 && at && at !== 'root'; i += 1) {
      const f = await drive(env, me, `/files/${encodeURIComponent(at)}?fields=id,name,parents`).catch(() => null);
      if (!f) break;
      crumbs.unshift({ id: f.id, name: f.name });
      at = f.parents?.[0];
    }
  }
  return json({ files: (d.files || []).map(slimFile), cursor: d.nextPageToken || null, crumbs, email: me.google_email || null });
});

route('POST', '/api/google/drive/new', async ({ env, user, body }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'drive');
  const b = await body();
  const kind = ['folder', 'doc', 'sheet', 'slides'].includes(b.kind) ? b.kind : 'doc';
  const made = await drive(env, me, `/files?fields=${FIELDS}`, {
    method: 'POST',
    body: { name: String(b.name || 'Untitled').slice(0, 200), mimeType: GOOGLE_TYPE[kind], parents: [String(b.parent || 'root')] },
  });
  return json({ file: slimFile(made) });
});

route('PATCH', '/api/google/drive/files/:id', async ({ env, user, params, body }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'drive');
  const b = await body();
  const q = new URLSearchParams({ fields: FIELDS });
  if (b.parent) { q.set('addParents', String(b.parent)); if (b.from) q.set('removeParents', String(b.from)); }
  const made = await drive(env, me, `/files/${encodeURIComponent(params.id)}?${q}`, {
    method: 'PATCH', body: b.name ? { name: String(b.name).slice(0, 200) } : {},
  });
  return json({ file: slimFile(made) });
});

route('DELETE', '/api/google/drive/files/:id', async ({ env, user, params }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'drive');
  await drive(env, me, `/files/${encodeURIComponent(params.id)}`, { method: 'PATCH', body: { trashed: true } });
  return json({ ok: true });
});

route('POST', '/api/google/drive/files/:id/share', async ({ env, user, params, body }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'drive');
  const b = await body();
  const role = ['reader', 'commenter', 'writer'].includes(b.role) ? b.role : 'reader';
  if (b.anyone) {
    await drive(env, me, `/files/${encodeURIComponent(params.id)}/permissions`, { method: 'POST', body: { type: 'anyone', role } });
  } else {
    const email = String(b.email || '').trim();
    if (!email.includes('@')) throw new HttpError('Which email address?');
    await drive(env, me, `/files/${encodeURIComponent(params.id)}/permissions?sendNotificationEmail=${b.notify === false ? 'false' : 'true'}`, {
      method: 'POST', body: { type: 'user', role, emailAddress: email },
    });
  }
  const f = await drive(env, me, `/files/${encodeURIComponent(params.id)}?fields=${FIELDS}`);
  return json({ file: slimFile(f) });
});

route('GET', '/api/google/drive/files/:id/who', async ({ env, user, params }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'drive');
  const d = await drive(env, me, `/files/${encodeURIComponent(params.id)}/permissions?fields=permissions(id,type,role,emailAddress,displayName)`);
  return json({ people: (d.permissions || []).map((p) => ({ id: p.id, who: p.emailAddress || p.displayName || (p.type === 'anyone' ? 'Anyone with the link' : p.type), role: p.role, type: p.type })) });
});

// Upload: the bytes come up as base64 so one JSON request carries the file.
const bytesOf = (b64) => {
  const s = String(b64 || '').replace(/^data:[^,]*,/, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
async function upload(env, me, { name, mime, bytes, parent, convertTo }) {
  const t = await accessToken(env, me);
  const boundary = `rw${Math.random().toString(36).slice(2)}`;
  const meta = { name, parents: [parent || 'root'], ...(convertTo ? { mimeType: convertTo } : {}) };
  const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
  const all8 = new Uint8Array(head.length + bytes.length + tail.length);
  all8.set(head, 0); all8.set(bytes, head.length); all8.set(tail, head.length + bytes.length);
  const res = await fetch(`${UP}?uploadType=multipart&fields=${FIELDS}`, {
    method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': `multipart/related; boundary=${boundary}` }, body: all8,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(`Google Drive: ${data.error?.message || `HTTP ${res.status}`}`, 502);
  return data;
}

route('POST', '/api/google/drive/upload', async ({ env, user, body }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'drive');
  const b = await body();
  const bytes = bytesOf(b.data);
  if (!bytes.length) throw new HttpError('That file came through empty.');
  if (bytes.length > MAX_UPLOAD) throw new HttpError('That file is bigger than 20 MB. Upload it in Drive itself.');
  const made = await upload(env, me, {
    name: String(b.name || 'file').slice(0, 200), mime: String(b.type || 'application/octet-stream').slice(0, 120),
    bytes, parent: b.parent || 'root',
  });
  return json({ file: slimFile(made) });
});

// Hand a file back to the browser: Google files are exported, everything else is downloaded as it is.
const EXPORT_AS = {
  [GOOGLE_TYPE.doc]: ['application/pdf', 'pdf'],
  [GOOGLE_TYPE.sheet]: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  [GOOGLE_TYPE.slides]: ['application/pdf', 'pdf'],
};
route('GET', '/api/google/drive/files/:id/download', async ({ env, user, params }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'drive');
  const t = await accessToken(env, me);
  const meta = await drive(env, me, `/files/${encodeURIComponent(params.id)}?fields=id,name,mimeType`);
  const ex = EXPORT_AS[meta.mimeType];
  const url = ex
    ? `${API}/files/${encodeURIComponent(params.id)}/export?mimeType=${encodeURIComponent(ex[0])}`
    : `${API}/files/${encodeURIComponent(params.id)}?alt=media`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${t}` } });
  if (!res.ok) throw new HttpError(`Google Drive: HTTP ${res.status}`, 502);
  const name = `${String(meta.name || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120)}${ex ? `.${ex[1]}` : ''}`;
  return new Response(res.body, {
    headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'private, no-store' },
  });
});

// ---------- Docs: turn Hub writing into a real Google Doc ----------
export async function htmlToDoc(env, me, { name, html, parent }) {
  const bytes = new TextEncoder().encode(`<!doctype html><meta charset="utf-8"><title>${String(name || 'Document')}</title>${html || ''}`);
  const made = await upload(env, me, { name: String(name || 'Document').slice(0, 200), mime: 'text/html', bytes, parent: parent || 'root', convertTo: GOOGLE_TYPE.doc });
  return slimFile(made);
}

route('POST', '/api/google/docs', async ({ env, user, body }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'drive');
  const b = await body();
  const file = await htmlToDoc(env, me, { name: b.name, html: String(b.html || '').slice(0, 400000), parent: b.parent });
  return json({ file });
});

// A page draft, a report or a quarterly plan, sent to Docs so it can be shared or printed.
route('POST', '/api/clients/:id/to-doc', async ({ env, user, params, body }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'drive');
  const b = await body();
  const client = await first(env, 'SELECT * FROM clients WHERE id = ?', params.id);
  if (!client) throw new HttpError('No such client.', 404);
  let name = `${client.name} - ${b.what || 'document'}`;
  let html = String(b.html || '');
  if (b.contentId) {
    const row = await first(env, 'SELECT * FROM content WHERE id = ? AND client_id = ?', b.contentId, params.id);
    if (!row) throw new HttpError('No such page.', 404);
    name = `${client.name} - ${row.title || 'page'}`;
    html = `<h1>${row.title || ''}</h1>${row.html || ''}`;
  }
  if (!html.trim()) throw new HttpError('There is nothing to put in the doc yet.');
  const folder = await clientFolder(env, me, client);
  const file = await htmlToDoc(env, me, { name, html, parent: folder });
  return json({ file });
});

// Each client can have a Drive folder; it is made the first time something needs it.
export async function clientFolder(env, me, client) {
  if (client.drive_folder) return client.drive_folder;
  const found = await drive(env, me, `/files?${new URLSearchParams({
    q: `name = '${esc(client.name)}' and mimeType = '${GOOGLE_TYPE.folder}' and trashed = false`, pageSize: '1', fields: 'files(id)',
  })}`);
  const id = found.files?.[0]?.id || (await drive(env, me, '/files?fields=id', {
    method: 'POST', body: { name: client.name, mimeType: GOOGLE_TYPE.folder },
  })).id;
  await run(env, 'UPDATE clients SET drive_folder = ? WHERE id = ?', id, client.id);
  return id;
}

route('GET', '/api/clients/:id/drive', async ({ env, user, params }) => {
  const client = await first(env, 'SELECT * FROM clients WHERE id = ?', params.id);
  if (!client) throw new HttpError('No such client.', 404);
  requireStaff(user);
  const me = await ownFor(env, user, 'drive');
  const folder = await clientFolder(env, me, client);
  const d = await drive(env, me, `/files?${new URLSearchParams({
    q: `'${esc(folder)}' in parents and trashed = false`, pageSize: '50', orderBy: 'modifiedTime desc', fields: `files(${FIELDS})`,
  })}`);
  return json({ folder, files: (d.files || []).map(slimFile) });
});
