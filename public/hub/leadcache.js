// Every lead, kept on this device (Nov 2026, V: the lead database will be in the tens of thousands and the Pipeline has to load all of it).
// The first visit downloads everything in packed pages; after that only what changed since the last visit (GET /api/leads?pack=1&since=),
// plus the leads deleted since then. Modeled on the local first sync in Linear and Superhuman: the list opens from the device straight away.
// Stored as ONE packed JSON string per person in IndexedDB (column names once, one array per lead): writing 20,000 separate objects took
// seconds, one string takes milliseconds. Per person because appointment times are hidden per person. Falls back to a plain download
// when the browser has no IndexedDB (private windows).
import { api } from './core.js';
import { liveLead, unpack } from '/js/leadlive.js';

const VERSION = 2; // bump when the stored shape changes
const FULL_EVERY = 12 * 3600e3; // a full download twice a day catches anything a sync stamp could miss
const OVERLAP = 5 * 60e3; // the database clock and the Worker clock can differ a little

function openDb(uid) {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('no IndexedDB'));
    const req = indexedDB.open(`rw-leads-${uid}`, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const n of [...db.objectStoreNames]) db.deleteObjectStore(n);
      db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const get = (db, key) => new Promise((resolve) => {
  try { const r = db.transaction('kv').objectStore('kv').get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(null); } catch { resolve(null); }
});
const put = (db, pairs) => new Promise((resolve) => {
  try { const t = db.transaction('kv', 'readwrite'); const s = t.objectStore('kv'); for (const [k, v] of pairs) s.put(v, k); t.oncomplete = () => resolve(true); t.onerror = () => resolve(false); t.onabort = () => resolve(false); } catch { resolve(false); }
});

async function download(since, onPage) {
  let after = ''; let first = null; const rows = []; let cols = null;
  for (;;) {
    const d = await api(`/api/leads?pack=1${since ? `&since=${since}` : ''}${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    if (!first) first = d;
    if (d.cols?.length) cols ||= d.cols;
    // A page could list its columns in another order (a deploy in between): turn it into the first page's order.
    if (d.rows?.length && d.cols.join() !== cols.join()) { const at = cols.map((k) => d.cols.indexOf(k)); for (const r of d.rows) rows.push(at.map((i) => (i < 0 ? null : r[i]))); }
    else if (d.rows) rows.push(...d.rows);
    onPage?.(rows.length, first.total);
    if (!d.next) break;
    after = d.next;
  }
  return { cols, rows, total: first.total, gone: first.gone || [], now: first.now };
}

// Returns every lead (live fields worked out for right now). onProgress(n, total, phase) while downloading.
export async function loadLeads(user, onProgress, { fresh = false } = {}) {
  const t = Date.now();
  let db = null;
  try { db = await openDb(user.id); } catch { /* no cache on this browser */ }
  const meta = (db && await get(db, 'meta')) || {};
  const full = !db || fresh || !meta.since || !meta.cols || !meta.fullAt || t - meta.fullAt > FULL_EVERY;
  let cols = meta.cols || null;
  const byId = new Map();
  if (!full) {
    const raw = await get(db, 'rows');
    try { const idx = cols.indexOf('id'); for (const r of JSON.parse(raw || '[]')) byId.set(r[idx], r); } catch { return loadLeads(user, onProgress, { fresh: true }); }
  }
  let d;
  try { d = await download(full ? 0 : meta.since - OVERLAP, (n, total) => onProgress?.(full ? n : byId.size, total, full ? 'download' : 'update')); }
  catch (e) { if (full) throw e; return loadLeads(user, onProgress, { fresh: true }); } // the change list failed: a plain full download still works
  if (full) cols = d.cols || cols || ['id'];
  else if (d.cols && d.cols.join() !== cols.join()) return loadLeads(user, onProgress, { fresh: true }); // the columns changed: start over
  const idx = cols.indexOf('id');
  for (const r of d.rows) byId.set(r[idx], r);
  for (const id of d.gone) byId.delete(id);
  // A count that does not match means something slipped past the stamps: download everything once.
  if (!full && byId.size !== d.total) return loadLeads(user, onProgress, { fresh: true });
  const packed = [...byId.values()];
  if (db) {
    // Saved after the page has drawn, so nobody waits for it.
    setTimeout(async () => { await put(db, [['rows', JSON.stringify(packed)], ['meta', { since: d.now, fullAt: full ? t : meta.fullAt, total: d.total, cols }]]); db.close(); }, 50);
  }
  return unpack({ cols, rows: packed }).map((l) => liveLead(l, t));
}
// Throw the copy away (the Pipeline's "Reload all").
export async function forgetLeads(user) {
  try { const db = await openDb(user.id); await put(db, [['meta', {}]]); db.close(); } catch { /* nothing kept */ }
}
