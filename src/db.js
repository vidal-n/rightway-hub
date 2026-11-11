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
  `CREATE TABLE IF NOT EXISTS site_audits (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, start_url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', data TEXT, result TEXT,
    pages INTEGER, score INTEGER, issues INTEGER, error TEXT, by TEXT, locked_until INTEGER, created_at INTEGER NOT NULL, finished_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS site_audits_client ON site_audits (client_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS site_audits_status ON site_audits (status, created_at)`,
  `CREATE TABLE IF NOT EXISTS site_fixes (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, issue_key TEXT, page_url TEXT, what TEXT NOT NULL, before_text TEXT, after_text TEXT, kind TEXT,
    status TEXT NOT NULL DEFAULT 'fixed', by TEXT, created_at INTEGER NOT NULL, checked_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS site_fixes_client ON site_fixes (client_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS tracking_numbers (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, number TEXT NOT NULL, sid TEXT, source TEXT, forward_to TEXT NOT NULL, record INTEGER NOT NULL DEFAULT 0,
    alert_to TEXT, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, released_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS tracking_numbers_num ON tracking_numbers (number, status)`,
  `CREATE TABLE IF NOT EXISTS tracked_calls (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, number_id TEXT, call_sid TEXT, from_num TEXT, from_city TEXT, from_state TEXT, to_num TEXT, source TEXT,
    status TEXT NOT NULL DEFAULT 'ringing', duration INTEGER, started_at INTEGER NOT NULL, ended_at INTEGER, first_time INTEGER NOT NULL DEFAULT 0,
    rec_sid TEXT, rec_secs INTEGER, vm_sid TEXT, vm_secs INTEGER)`,
  `CREATE INDEX IF NOT EXISTS tracked_calls_client ON tracked_calls (client_id, started_at)`,
  `CREATE INDEX IF NOT EXISTS tracked_calls_sid ON tracked_calls (call_sid)`,
  `CREATE TABLE IF NOT EXISTS citation_audits (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, results TEXT, counts TEXT, cost REAL, demo INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, by TEXT)`,
  `CREATE INDEX IF NOT EXISTS citation_audits_client ON citation_audits (client_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS link_log (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, url TEXT, target TEXT, anchor TEXT, kind TEXT,
    status TEXT NOT NULL DEFAULT 'planned', cost_cents INTEGER NOT NULL DEFAULT 0, source TEXT, note TEXT, month TEXT, task_id TEXT,
    check_result TEXT, checked_at INTEGER, created_at INTEGER NOT NULL, live_at INTEGER, by TEXT)`,
  `CREATE INDEX IF NOT EXISTS link_log_client ON link_log (client_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS review_pulls (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, task_id TEXT, status TEXT NOT NULL DEFAULT 'queued', reviews TEXT, rating REAL, total INTEGER,
    cost REAL NOT NULL DEFAULT 0, demo INTEGER NOT NULL DEFAULT 0, error TEXT, created_at INTEGER NOT NULL, finished_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS review_pulls_client ON review_pulls (client_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS quarterly_plans (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, quarter TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', token TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER, shared_at INTEGER)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS quarterly_client_q ON quarterly_plans (client_id, quarter)`,
  `CREATE TABLE IF NOT EXISTS guides (kind TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER, updated_by TEXT)`,
  `CREATE TABLE IF NOT EXISTS time_entries (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL, client_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT, started_at INTEGER NOT NULL, ended_at INTEGER,
    minutes INTEGER, manual INTEGER NOT NULL DEFAULT 0, note TEXT, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS time_client ON time_entries (client_id, started_at)`,
  `CREATE INDEX IF NOT EXISTS time_user ON time_entries (user_id, ended_at)`,
  `CREATE INDEX IF NOT EXISTS time_task ON time_entries (task_id)`,
  `CREATE TABLE IF NOT EXISTS client_photos (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, media_key TEXT NOT NULL, media_type TEXT, size INTEGER NOT NULL DEFAULT 0, note TEXT, post_id TEXT, created_by TEXT, created_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_client_photos_client ON client_photos (client_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS schedule_blocks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, dow INTEGER NOT NULL, start_min INTEGER NOT NULL, end_min INTEGER NOT NULL, title TEXT NOT NULL, kind TEXT, goal INTEGER, note TEXT, created_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_schedule_user ON schedule_blocks (user_id, dow, start_min)`,
  `CREATE TABLE IF NOT EXISTS client_access (
    client_id TEXT NOT NULL, item TEXT NOT NULL, status TEXT NOT NULL, note TEXT, updated_at INTEGER, updated_by TEXT, PRIMARY KEY (client_id, item))`,
  `CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, title TEXT NOT NULL, start_at INTEGER NOT NULL, minutes INTEGER NOT NULL DEFAULT 30, meet_link TEXT,
    event_id TEXT, event_link TEXT, event_owner TEXT, attendees TEXT, agenda TEXT, notes TEXT, summary TEXT, status TEXT NOT NULL DEFAULT 'scheduled',
    task_id TEXT, reminded_at INTEGER, created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS meetings_client ON meetings (client_id, start_at)`,
  `CREATE INDEX IF NOT EXISTS meetings_start ON meetings (start_at)`,
  `CREATE TABLE IF NOT EXISTS push_subs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, ua TEXT,
    created_at INTEGER NOT NULL, last_ok INTEGER, fails INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS push_user ON push_subs (user_id)`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, url TEXT, tag TEXT, read_at INTEGER, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS notif_user ON notifications (user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS slack_members (user_id TEXT NOT NULL, channel_id TEXT NOT NULL, PRIMARY KEY (user_id, channel_id))`,
  `CREATE INDEX IF NOT EXISTS slack_members_ch ON slack_members (channel_id)`,
  `CREATE TABLE IF NOT EXISTS slack_unread (user_id TEXT NOT NULL, channel_id TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, mentions INTEGER NOT NULL DEFAULT 0, last_ts TEXT, PRIMARY KEY (user_id, channel_id))`,
  `CREATE TABLE IF NOT EXISTS slack_people (id TEXT PRIMARY KEY, name TEXT, real_name TEXT, image TEXT, is_bot INTEGER NOT NULL DEFAULT 0, updated_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS slack_events (id TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS slack_activity (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, channel_id TEXT NOT NULL, ts TEXT NOT NULL, thread_ts TEXT, from_id TEXT, text TEXT, at INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS slack_activity_user ON slack_activity (user_id, at)`,
  `CREATE TABLE IF NOT EXISTS chat_posts (ts TEXT NOT NULL, channel TEXT NOT NULL, by TEXT, at INTEGER NOT NULL, PRIMARY KEY (channel, ts))`,
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
  `CREATE TABLE IF NOT EXISTS agent_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, status TEXT NOT NULL, start_at INTEGER NOT NULL, end_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS agent_log_user ON agent_log (user_id, start_at)`,
  `CREATE TABLE IF NOT EXISTS automation_log (id TEXT PRIMARY KEY, auto_id TEXT NOT NULL, lead_id TEXT NOT NULL, meet_at INTEGER NOT NULL, channel TEXT, status TEXT, error TEXT, to_addr TEXT, at INTEGER NOT NULL, UNIQUE (auto_id, lead_id, meet_at))`,
  `CREATE TABLE IF NOT EXISTS vault_keys (user_id TEXT PRIMARY KEY, salt TEXT NOT NULL, iters INTEGER NOT NULL, check_iv TEXT NOT NULL, check_ct TEXT NOT NULL, priv_iv TEXT NOT NULL, priv_ct TEXT NOT NULL, pub TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS vault_items (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, iv TEXT NOT NULL, ct TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS file_folders (id TEXT PRIMARY KEY, client_id TEXT, parent_id TEXT, name TEXT NOT NULL, created_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS hub_files (id TEXT PRIMARY KEY, client_id TEXT, folder_id TEXT, name TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL DEFAULT 0, owner_id TEXT, share_token TEXT, created_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_hub_files_scope ON hub_files (client_id, folder_id)`,
  `CREATE TABLE IF NOT EXISTS mail_log (id TEXT PRIMARY KEY, user_id TEXT, to_email TEXT NOT NULL, subject TEXT, body TEXT, lead_id TEXT, client_id TEXT, status TEXT, error TEXT, at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_mail_log_to ON mail_log (to_email, at)`,
  `CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, title TEXT NOT NULL, start_at INTEGER NOT NULL, minutes INTEGER NOT NULL DEFAULT 30, owner_id TEXT, lead_id TEXT, client_id TEXT, guest_email TEXT, link TEXT, note TEXT, created_at INTEGER, updated_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_events_start ON events (start_at)`,
  `CREATE TABLE IF NOT EXISTS cost_daily (day TEXT NOT NULL, vendor TEXT NOT NULL, kind TEXT NOT NULL, micro INTEGER NOT NULL DEFAULT 0, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, vendor, kind))`,
  `CREATE TABLE IF NOT EXISTS finder_jobs (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, keywords TEXT NOT NULL, areas TEXT NOT NULL, filters TEXT, auto_add INTEGER NOT NULL DEFAULT 0, tag TEXT,
    status TEXT NOT NULL DEFAULT 'queued', total INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0,
    found INTEGER NOT NULL DEFAULT 0, added INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0, error TEXT, demo INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER, created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finished_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS finder_jobs_status ON finder_jobs (status, created_at)`,
  `CREATE TABLE IF NOT EXISTS finder_results (job_id TEXT NOT NULL, rkey TEXT NOT NULL, data TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'new', lead_id TEXT, PRIMARY KEY (job_id, rkey))`,
  `CREATE TABLE IF NOT EXISTS vault_access (item_id TEXT NOT NULL, user_id TEXT NOT NULL, eph TEXT NOT NULL, wiv TEXT NOT NULL, wkey TEXT NOT NULL, PRIMARY KEY (item_id, user_id))`,
];

// Columns added after the first release. SQLite has no ADD COLUMN IF NOT EXISTS, so duplicates are ignored.
const ADD_COLUMNS = [
  ['clients', 'stripe_customer_id TEXT'], ['clients', 'stripe_subscription_id TEXT'], ['clients', 'billing_status TEXT'],
  ['clients', 'mrr_cents INTEGER'], ['clients', 'lead_id TEXT'], ['users', 'phone TEXT'],
  ['leads', 'intel TEXT'], ['leads', 'intel_at INTEGER'], ['leads', 'score INTEGER'], ['leads', 'grade TEXT'], ['leads', 'rating REAL'],
  ['leads', 'reviews INTEGER'], ['leads', 'category TEXT'], ['leads', 'map_rank INTEGER'], ['leads', 'problems INTEGER'], ['leads', 'address TEXT'],
  ['leads', 'zip TEXT'], ['leads', 'tags TEXT'], ['leads', 'meet_at INTEGER'], ['leads', 'meet_link TEXT'], ['leads', 'gcal_event_id TEXT'],
  ['leads', 'locations INTEGER'], ['leads', 'meet_by TEXT'], ['leads', 'quote TEXT'], ['leads', 'listings TEXT'], ['oauth_states', 'apps TEXT'], ['work_orders', 'kind TEXT'], ['work_orders', 'emailed TEXT'], ['work_orders', 'signed_font TEXT'], ['work_orders', 'initials TEXT'], ['work_orders', 'initials_font TEXT'],
  ['clients', 'baseline TEXT'], ['clients', 'wp_url TEXT'], ['clients', 'parent_id TEXT'], ['clients', 'wp_user TEXT'], ['clients', 'wp_pass TEXT'], ['clients', 'intake TEXT'], ['clients', 'intake_at INTEGER'], ['clients', 'logo_key TEXT'],
  ['users', 'google_token TEXT'], ['users', 'google_email TEXT'],
  ['leads', 'sms_stop INTEGER NOT NULL DEFAULT 0'], ['clients', 'sample INTEGER NOT NULL DEFAULT 0'],
  ['activities', 'to_num TEXT'], ['activities', 'from_num TEXT'], ['activities', 'conf_sid TEXT'], ['activities', 'cust_sid TEXT'],
  ['activities', 'answered_at INTEGER'], ['activities', 'rec_sid TEXT'], ['activities', 'rec_secs INTEGER'], ['activities', 'mon_sid TEXT'],
  ['activities', 'mon_by TEXT'], ['activities', 'mon_mode TEXT'], ['activities', 'dispo TEXT'], ['activities', 'note TEXT'],
  ['users', 'google_scopes TEXT'], ['clients', 'gsc_site TEXT'], ['clients', 'ga4_property TEXT'], ['clients', 'ads_customer TEXT'],
  ['tasks', 'owner TEXT'], ['tasks', 'due TEXT'], ['tasks', 'proof_key TEXT'], ['tasks', 'proof_type TEXT'], ['tasks', 'checks TEXT'],
  ['clients', 'owner_id TEXT'], ['clients', 'gbp_account TEXT'], ['clients', 'gbp_location TEXT'], ['clients', 'gbp_title TEXT'],
  ['posts', 'live_url TEXT'], ['posts', 'gbp_name TEXT'],
  ['activities', 'vm_sid TEXT'], ['activities', 'vm_secs INTEGER'], ['activities', 'seen_at INTEGER'], ['users', 'notify_prefs TEXT'],
  ['users', 'slack_id TEXT'], ['users', 'slack_prefs TEXT'], ['users', 'slack_token TEXT'], ['users', 'slack_uid TEXT'], ['users', 'slack_scopes TEXT'], ['users', 'slack_snooze INTEGER'], ['clients', 'chat_tried INTEGER'], ['users', 'nav_prefs TEXT'], ['clients', 'chat_channel TEXT'], ['clients', 'chat_channel_name TEXT'], ['clients', 'slack_channel TEXT'], ['clients', 'slack_channel_name TEXT'], ['clients', 'drive_folder TEXT'],
  ['clients', 'scope TEXT'],
  ['users', 'status TEXT'], ['users', 'status_at INTEGER'], ['users', 'last_seen INTEGER'], ['activities', 'ended_at INTEGER'], ['activities', 'dispo_at INTEGER'],
  ['leads', 'deep_scan TEXT'], ['finder_jobs', 'source TEXT'], ['users', 'training TEXT'], ['leads', 'research_tried INTEGER'], ['leads', 'scrub TEXT'],
  ['users', 'fwd_calls INTEGER'], ['users', 'fwd_texts INTEGER'], ['users', 'avatar_at INTEGER'], ['users', 'cal_token TEXT'], ['leads', 'book_token TEXT'], ['users', 'google_alerted INTEGER'], ['leads', 'closer_id TEXT'], ['leads', 'gcal_owner TEXT'], ['leads', 'gcal_cal TEXT'], ['leads', 'master_event_id TEXT'], ['leads', 'master_sig TEXT'], ['leads', 'invite_tried INTEGER'], ['events', 'master_event_id TEXT'], ['events', 'master_sig TEXT'], ['users', 'job TEXT'], ['leads', 'business_raw TEXT'], ['leads', 'manual_listing TEXT'], ['leads', 'phone_type TEXT'], ['leads', 'phone_carrier TEXT'], ['leads', 'email_status TEXT'], ['leads', 'owner_name TEXT'], ['leads', 'socials TEXT'], ['leads', 'data_score INTEGER'], ['leads', 'scrub_data TEXT'], ['leads', 'scrubbed_at INTEGER'], ['leads', 'scrub_queued INTEGER'], ['leads', 'scrub_tried INTEGER'],
];

let ready = null;

// A cold Worker used to run every CREATE and about 130 ALTER TABLE attempts (each a round trip to D1) before its first answer.
// Now the schema is stamped with a fingerprint of this file's table list in settings.schema_v. A matching stamp means one cheap
// read and nothing else. A changed list (new table or column in a deploy) migrates once, adding only the columns that are missing.
const fingerprint = () => { let h = 5381; for (const s of [...SCHEMA, ...ADD_COLUMNS.map((c) => c.join('.'))]) for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return `v${SCHEMA.length}.${ADD_COLUMNS.length}.${(h >>> 0).toString(36)}`; };
const SCHEMA_V = fingerprint();

async function migrate(env) {
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  const tables = [...new Set(ADD_COLUMNS.map((c) => c[0]))];
  const infos = await env.DB.batch(tables.map((t) => env.DB.prepare(`SELECT name FROM pragma_table_info('${t}')`)));
  const have = Object.fromEntries(tables.map((t, i) => [t, new Set((infos[i].results || []).map((r) => r.name))]));
  for (const [table, col] of ADD_COLUMNS) {
    if (have[table].has(col.split(' ')[0])) continue;
    try { await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${col}`).run(); } catch (e) {
      if (!/duplicate column/i.test(String(e?.message || e))) throw e; // another isolate got there first
    }
  }
  await env.DB.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind('schema_v', SCHEMA_V).run();
}

export function hasDb(env) {
  return Boolean(env.DB);
}

export async function ensureSchema(env) {
  if (!env.DB) throw new HttpError('The database is not connected yet. Create the D1 database in Cloudflare and send Claude its ID.', 503);
  if (!ready) {
    ready = (async () => {
      const stamp = await env.DB.prepare("SELECT v FROM settings WHERE k = 'schema_v'").first().catch(() => null);
      if (stamp?.v === SCHEMA_V) return;
      await migrate(env);
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
