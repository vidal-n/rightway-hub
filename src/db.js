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
  `CREATE TABLE IF NOT EXISTS scan_jobs (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, keyword TEXT NOT NULL, size INTEGER NOT NULL, radius REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued', cursor INTEGER NOT NULL DEFAULT 0, batch TEXT, by TEXT, data TEXT, scan_id TEXT, error TEXT,
    locked_until INTEGER, created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS scan_jobs_status ON scan_jobs (status, created_at)`,
  `CREATE INDEX IF NOT EXISTS scan_jobs_client ON scan_jobs (client_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, month TEXT NOT NULL, token TEXT UNIQUE NOT NULL, data TEXT NOT NULL, note TEXT,
    status TEXT NOT NULL DEFAULT 'draft', views INTEGER NOT NULL DEFAULT 0, sent_at INTEGER, sent_to TEXT, sent_by TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS reports_client_month ON reports (client_id, month)`,
  `CREATE TABLE IF NOT EXISTS content (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, keyword TEXT, service TEXT, city TEXT, brief TEXT,
    html TEXT, meta_title TEXT, meta_description TEXT, slug TEXT, status TEXT NOT NULL DEFAULT 'idea', client_note TEXT, month TEXT, task_id TEXT,
    ai INTEGER NOT NULL DEFAULT 0, wp_id TEXT, wp_status TEXT, live_url TEXT, published_at INTEGER, created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS content_client ON content (client_id, updated_at)`,
  `CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY, business TEXT NOT NULL, contact_name TEXT, phone TEXT, phone_digits TEXT, email TEXT, website TEXT,
    city TEXT, state TEXT, timezone TEXT, industry TEXT, source TEXT, stage TEXT NOT NULL DEFAULT 'new', plan TEXT,
    next_action_at INTEGER, next_action TEXT, notes TEXT, owner_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_call_at INTEGER,
    dnc INTEGER NOT NULL DEFAULT 0, sms_consent INTEGER NOT NULL DEFAULT 0, client_id TEXT, place_id TEXT, cid TEXT, lat REAL, lng REAL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS leads_stage ON leads (stage, next_action_at)`,
  `CREATE INDEX IF NOT EXISTS leads_phone ON leads (phone_digits)`,
  `CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY, lead_id TEXT, client_id TEXT, type TEXT NOT NULL, outcome TEXT, body TEXT, duration INTEGER,
    call_sid TEXT, status TEXT, at INTEGER NOT NULL, by TEXT)`,
  `CREATE INDEX IF NOT EXISTS act_lead ON activities (lead_id, at)`,
  `CREATE TABLE IF NOT EXISTS work_orders (
    id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, lead_id TEXT, client_id TEXT, plan TEXT NOT NULL, monthly_cents INTEGER NOT NULL,
    setup_cents INTEGER NOT NULL, business TEXT, contact_name TEXT, email TEXT, terms TEXT, pay_url TEXT, status TEXT NOT NULL DEFAULT 'sent',
    signed_name TEXT, signed_at INTEGER, signed_ip TEXT, signed_ua TEXT, paid_at INTEGER, created_at INTEGER NOT NULL, created_by TEXT)`,
  `CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, type TEXT, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, media_key TEXT NOT NULL, media_type TEXT, kind TEXT, name TEXT, created_by TEXT, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS assets_client ON assets (client_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, lead_id TEXT NOT NULL, direction TEXT NOT NULL, body TEXT NOT NULL, from_num TEXT, to_num TEXT,
    sid TEXT, status TEXT, error TEXT, by TEXT, at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS msg_lead ON messages (lead_id, at)`,
  `CREATE INDEX IF NOT EXISTS msg_sid ON messages (sid)`,
  `CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, user_id TEXT NOT NULL, at INTEGER NOT NULL)`,
];

// Columns added after the first release. SQLite has no ADD COLUMN IF NOT EXISTS, so duplicates are ignored.
const ADD_COLUMNS = [
  ['clients', 'stripe_customer_id TEXT'], ['clients', 'stripe_subscription_id TEXT'], ['clients', 'billing_status TEXT'],
  ['clients', 'mrr_cents INTEGER'], ['clients', 'lead_id TEXT'], ['users', 'phone TEXT'],
  ['leads', 'intel TEXT'], ['leads', 'intel_at INTEGER'], ['leads', 'score INTEGER'], ['leads', 'grade TEXT'], ['leads', 'rating REAL'],
  ['leads', 'reviews INTEGER'], ['leads', 'category TEXT'], ['leads', 'map_rank INTEGER'], ['leads', 'problems INTEGER'], ['leads', 'address TEXT'],
  ['leads', 'zip TEXT'], ['leads', 'tags TEXT'], ['leads', 'meet_at INTEGER'], ['leads', 'meet_link TEXT'], ['leads', 'gcal_event_id TEXT'],
  ['leads', 'locations INTEGER'],
  ['clients', 'baseline TEXT'], ['clients', 'wp_url TEXT'], ['clients', 'wp_user TEXT'], ['clients', 'wp_pass TEXT'], ['clients', 'intake TEXT'], ['clients', 'intake_at INTEGER'], ['clients', 'logo_key TEXT'],
  ['users', 'google_token TEXT'], ['users', 'google_email TEXT'],
  ['leads', 'sms_stop INTEGER NOT NULL DEFAULT 0'], ['clients', 'sample INTEGER NOT NULL DEFAULT 0'],
  ['activities', 'to_num TEXT'], ['activities', 'from_num TEXT'], ['activities', 'conf_sid TEXT'], ['activities', 'cust_sid TEXT'],
  ['activities', 'answered_at INTEGER'], ['activities', 'rec_sid TEXT'], ['activities', 'rec_secs INTEGER'], ['activities', 'mon_sid TEXT'],
  ['activities', 'mon_by TEXT'], ['activities', 'mon_mode TEXT'], ['activities', 'dispo TEXT'], ['activities', 'note TEXT'],
  ['users', 'google_scopes TEXT'], ['clients', 'gsc_site TEXT'], ['clients', 'ga4_property TEXT'], ['clients', 'ads_customer TEXT'],
];

let ready = null;

export function hasDb(env) {
  return Boolean(env.DB);
}

export async function ensureSchema(env) {
  if (!env.DB) throw new HttpError('The database is not connected yet. Create the D1 database in Cloudflare and send Claude its ID.', 503);
  if (!ready) {
    ready = (async () => {
      await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
      for (const [table, col] of ADD_COLUMNS) {
        try { await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${col}`).run(); } catch (e) {
          if (!/duplicate column/i.test(String(e?.message || e))) throw e;
        }
      }
    })().catch((err) => { ready = null; throw err; });
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

export async function getSettings(env) {
  const rows = await all(env, 'SELECT k, v FROM settings');
  return Object.fromEntries(rows.map((r) => [r.k, r.v]));
}
export async function setSetting(env, k, v) {
  await run(env, 'INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, v);
}
