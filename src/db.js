// Cloudflare D1 (SQLite) access. The schema is created on first use, so there is no migration step.
import { HttpError } from './util.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, role TEXT NOT NULL,
    client_id TEXT, pass_hash TEXT, pass_salt TEXT, invite_hash TEXT, invite_expires INTEGER,
    created_at INTEGER NOT NULL, last_login INTEGER)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_fails (email TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
    start_date TEXT, contact_name TEXT, contact_email TEXT, phone TEXT, website TEXT, address TEXT,
    place_id TEXT, cid TEXT, lat REAL, lng REAL, category TEXT, services TEXT, cities TEXT, keywords TEXT,
    brand_voice TEXT, review_url TEXT, notes TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, month TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo', note TEXT, link TEXT, client_visible INTEGER NOT NULL DEFAULT 1,
    done_at INTEGER, done_by TEXT, sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS tasks_client_month ON tasks (client_id, month)`,
  `CREATE TABLE IF NOT EXISTS log (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, text TEXT NOT NULL, link TEXT, at INTEGER NOT NULL, by TEXT)`,
  `CREATE INDEX IF NOT EXISTS log_client ON log (client_id, at)`,
  `CREATE TABLE IF NOT EXISTS review_requests (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, token TEXT UNIQUE NOT NULL, customer_name TEXT, contact TEXT,
    channel TEXT, created_by TEXT, created_at INTEGER NOT NULL, clicks INTEGER NOT NULL DEFAULT 0, clicked_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS rr_client ON review_requests (client_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS kit_scans (client_id TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, media_key TEXT, media_type TEXT, note TEXT,
    google_text TEXT, facebook_text TEXT, instagram_text TEXT, hashtags TEXT, keywords TEXT, alt_text TEXT,
    status TEXT NOT NULL DEFAULT 'draft', ai INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at INTEGER NOT NULL,
    approved_at INTEGER, posted_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS posts_client ON posts (client_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS scans (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, keyword TEXT, created_at INTEGER NOT NULL, summary TEXT, data TEXT)`,
  `CREATE INDEX IF NOT EXISTS scans_client ON scans (client_id, created_at)`,
];

let ready = null;

export function hasDb(env) {
  return Boolean(env.DB);
}

export async function ensureSchema(env) {
  if (!env.DB) throw new HttpError('The database is not connected yet. Create the D1 database in Cloudflare and send Claude its ID.', 503);
  if (!ready) {
    ready = env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))).catch((err) => { ready = null; throw err; });
  }
  await ready;
}

// Tests swap databases; this lets them reset the one-time schema check.
export function resetSchemaCache() {
  ready = null;
}

const clean = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

export async function all(env, sql, ...args) {
  const r = await env.DB.prepare(sql).bind(...args.map(clean)).all();
  return r.results || [];
}
export async function first(env, sql, ...args) {
  return (await env.DB.prepare(sql).bind(...args.map(clean)).first()) || null;
}
export async function run(env, sql, ...args) {
  return env.DB.prepare(sql).bind(...args.map(clean)).run();
}
export async function batch(env, items) {
  if (!items.length) return [];
  return env.DB.batch(items.map(([sql, ...args]) => env.DB.prepare(sql).bind(...args.map(clean))));
}

export function newId(prefix = '') {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return prefix + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function token(bytes = 24) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const now = () => Date.now();
