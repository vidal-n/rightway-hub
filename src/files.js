// Files inside the Hub, no Google Drive needed: company files and a folder per client. Stored in R2 (files/<id>), listed from D1.
// Folders can nest, files can be renamed, moved and deleted, and any file can get a private share link for people outside the Hub.
import { HttpError, json } from './util.js';
import { all, first, run, newId, token, now } from './db.js';
import { requireStaff } from './auth.js';
// Company files (no client) are for owners; a client's folder is open to the whole team.
const scopeGuard = (user, client) => { if (!client && user.role !== 'admin') throw new HttpError('Company files are for owners.', 403); };
import { route } from './router.js';

const MAX = 25 * 1024 * 1024;
const cleanName = (s) => String(s || '').replace(/[\\/\u0000-\u001f]/g, ' ').trim().slice(0, 160);
const scopeOf = (v) => (v ? String(v) : null);
const where = (client, folder) => ({ sql: `${client ? 'client_id = ?' : 'client_id IS NULL'} AND ${folder ? 'folder_id = ?' : 'folder_id IS NULL'}`, args: [...(client ? [client] : []), ...(folder ? [folder] : [])] });
const noStore = () => { throw new HttpError('File storage is not connected yet. Create the R2 bucket in Cloudflare.', 503); };

async function crumbs(env, folderId) {
  const out = [];
  let id = folderId;
  for (let i = 0; id && i < 12; i++) {
    const f = await first(env, 'SELECT id, parent_id, name FROM file_folders WHERE id = ?', id);
    if (!f) break;
    out.unshift({ id: f.id, name: f.name });
    id = f.parent_id;
  }
  return out;
}
const fileRow = (f, users) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, at: f.created_at, by: users[f.owner_id] || '', shared: Boolean(f.share_token), token: f.share_token || null });

route('GET', '/api/files', async ({ env, user, url }) => {
  requireStaff(user);
  const client = scopeOf(url.searchParams.get('client'));
  scopeGuard(user, client);
  const folder = scopeOf(url.searchParams.get('folder'));
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const users = Object.fromEntries((await all(env, 'SELECT id, name, email FROM users')).map((u) => [u.id, (u.name || u.email || '').split(' ')[0]]));
  if (q) {
    const rows = await all(env, `SELECT * FROM hub_files WHERE ${client ? 'client_id = ?' : 'client_id IS NULL'} AND lower(name) LIKE ? ORDER BY created_at DESC LIMIT 100`, ...(client ? [client] : []), `%${q.replace(/[%_]/g, '')}%`);
    return json({ folders: [], files: rows.map((f) => fileRow(f, users)), crumbs: [], search: true });
  }
  const w = where(client, folder);
  const folders = await all(env, `SELECT id, name, created_at FROM file_folders WHERE ${client ? 'client_id = ?' : 'client_id IS NULL'} AND ${folder ? 'parent_id = ?' : 'parent_id IS NULL'} ORDER BY lower(name)`, ...w.args);
  const files = await all(env, `SELECT * FROM hub_files WHERE ${w.sql} ORDER BY created_at DESC LIMIT 500`, ...w.args);
  const counts = await all(env, `SELECT folder_id, COUNT(*) AS n FROM hub_files WHERE ${client ? 'client_id = ?' : 'client_id IS NULL'} AND folder_id IS NOT NULL GROUP BY folder_id`, ...(client ? [client] : []));
  const n = Object.fromEntries(counts.map((c) => [c.folder_id, c.n]));
  return json({ folders: folders.map((f) => ({ ...f, count: n[f.id] || 0 })), files: files.map((f) => fileRow(f, users)), crumbs: await crumbs(env, folder) });
});

// Every folder in a scope, flat, for the Move picker.
route('GET', '/api/files/folders', async ({ env, user, url }) => {
  requireStaff(user);
  const client = scopeOf(url.searchParams.get('client'));
  scopeGuard(user, client);
  const rows = await all(env, `SELECT id, parent_id, name FROM file_folders WHERE ${client ? 'client_id = ?' : 'client_id IS NULL'} ORDER BY lower(name)`, ...(client ? [client] : []));
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const path = (r) => { const p = []; let x = r; for (let i = 0; x && i < 12; i++) { p.unshift(x.name); x = byId[x.parent_id]; } return p.join(' / '); };
  return json({ folders: rows.map((r) => ({ id: r.id, name: path(r) })) });
});

route('POST', '/api/files/folder', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  scopeGuard(user, scopeOf(b.client_id));
  const name = cleanName(b.name);
  if (!name) throw new HttpError('Give the folder a name.');
  const id = newId('fd_');
  await run(env, 'INSERT INTO file_folders (id, client_id, parent_id, name, created_at) VALUES (?, ?, ?, ?, ?)', id, scopeOf(b.client_id), scopeOf(b.parent_id), name, now());
  return json({ id });
});

route('PATCH', '/api/files/folder/:id', async ({ env, user, params, body }) => {
  requireStaff(user);
  scopeGuard(user, (await first(env, 'SELECT client_id FROM file_folders WHERE id = ?', params.id))?.client_id);
  const b = await body();
  const name = cleanName(b.name);
  if (!name) throw new HttpError('Give the folder a name.');
  await run(env, 'UPDATE file_folders SET name = ? WHERE id = ?', name, params.id);
  return json({ ok: true });
});

route('DELETE', '/api/files/folder/:id', async ({ env, user, params }) => {
  requireStaff(user);
  scopeGuard(user, (await first(env, 'SELECT client_id FROM file_folders WHERE id = ?', params.id))?.client_id);
  const used = (await first(env, 'SELECT (SELECT COUNT(*) FROM hub_files WHERE folder_id = ?) + (SELECT COUNT(*) FROM file_folders WHERE parent_id = ?) AS n', params.id, params.id))?.n || 0;
  if (used) throw new HttpError('Empty the folder first, then delete it.');
  await run(env, 'DELETE FROM file_folders WHERE id = ?', params.id);
  return json({ ok: true });
});

// The browser sends the file itself as the request body: /api/files?name=...&client=...&folder=...
route('POST', '/api/files', async ({ env, user, url, request }) => {
  requireStaff(user);
  if (user.viewAs) throw new HttpError('Client view is read only.', 403);
  if (!env.MEDIA) noStore();
  scopeGuard(user, scopeOf(url.searchParams.get('client')));
  const name = cleanName(url.searchParams.get('name'));
  if (!name) throw new HttpError('That file has no name.');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) throw new HttpError('That file is empty.');
  if (bytes.length > MAX) throw new HttpError('That file is over 25 MB. Share big files by link instead.');
  const id = newId('f_');
  const mime = (request.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().slice(0, 100);
  await env.MEDIA.put(`files/${id}`, bytes, { httpMetadata: { contentType: mime } });
  await run(env, 'INSERT INTO hub_files (id, client_id, folder_id, name, mime, size, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, scopeOf(url.searchParams.get('client')), scopeOf(url.searchParams.get('folder')), name, mime, bytes.length, user.id, now());
  return json({ id });
});

route('PATCH', '/api/files/:id', async ({ env, user, params, body }) => {
  requireStaff(user);
  const f = await first(env, 'SELECT * FROM hub_files WHERE id = ?', params.id);
  if (!f) throw new HttpError('File not found.', 404);
  scopeGuard(user, f.client_id);
  const b = await body();
  const name = 'name' in b ? cleanName(b.name) : f.name;
  if (!name) throw new HttpError('Give the file a name.');
  const folder = 'folder_id' in b ? scopeOf(b.folder_id) : f.folder_id;
  if (folder) {
    const d = await first(env, 'SELECT client_id FROM file_folders WHERE id = ?', folder);
    if (!d || (d.client_id || null) !== (f.client_id || null)) throw new HttpError('That folder is somewhere else.');
  }
  await run(env, 'UPDATE hub_files SET name = ?, folder_id = ? WHERE id = ?', name, folder, f.id);
  return json({ ok: true });
});

route('DELETE', '/api/files/:id', async ({ env, user, params }) => {
  requireStaff(user);
  const f = await first(env, 'SELECT * FROM hub_files WHERE id = ?', params.id);
  if (!f) return json({ ok: true });
  scopeGuard(user, f.client_id);
  if (user.role !== 'admin' && f.owner_id !== user.id) throw new HttpError('Only the person who uploaded it, or an owner, can delete a file.', 403);
  if (env.MEDIA) await env.MEDIA.delete(`files/${f.id}`).catch(() => {});
  await run(env, 'DELETE FROM hub_files WHERE id = ?', f.id);
  return json({ ok: true });
});

async function send(env, f, inline) {
  if (!env.MEDIA) noStore();
  const obj = await env.MEDIA.get(`files/${f.id}`);
  if (!obj) throw new HttpError('The file is missing from storage.', 404);
  const safe = encodeURIComponent(f.name).replace(/['()]/g, escape);
  const show = inline && /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/plain)$/.test(f.mime || '');
  return new Response(obj.body, { headers: { 'content-type': show ? f.mime : 'application/octet-stream', 'content-disposition': `${show ? 'inline' : 'attachment'}; filename*=UTF-8''${safe}`, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=60' } });
}
route('GET', '/api/files/:id/download', async ({ env, user, params, url }) => {
  requireStaff(user);
  const f = await first(env, 'SELECT * FROM hub_files WHERE id = ?', params.id);
  if (!f) throw new HttpError('File not found.', 404);
  scopeGuard(user, f.client_id);
  return send(env, f, url.searchParams.get('view') === '1');
});

route('POST', '/api/files/:id/share', async ({ env, user, params, body }) => {
  requireStaff(user);
  const f = await first(env, 'SELECT * FROM hub_files WHERE id = ?', params.id);
  if (!f) throw new HttpError('File not found.', 404);
  scopeGuard(user, f.client_id);
  const b = await body();
  const t = b.on === false ? null : f.share_token || token(24);
  await run(env, 'UPDATE hub_files SET share_token = ? WHERE id = ?', t, f.id);
  return json({ token: t });
});

// Anyone with the long random link can download that one file. Turning sharing off ends the link.
route('GET', '/api/public/f/:token', async ({ env, params }) => {
  const t = String(params.token || '');
  const f = t.length >= 20 ? await first(env, 'SELECT * FROM hub_files WHERE share_token = ?', t) : null;
  if (!f) throw new HttpError('This link is not valid any more.', 404);
  return send(env, f, true);
}, { public: true });
