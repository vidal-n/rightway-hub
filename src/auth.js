// Logins: email + password (PBKDF2), session cookie, roles.
import { JOB_CAPS } from '../public/js/jobs.js';
// Roles: admin (owners), team (staff), client (sees only their own business).
import { HttpError } from './util.js';
import { all, first, run, newId, token, now } from './db.js';

const COOKIE = 'rw_s';
const SESSION_DAYS = 30;
const enc = new TextEncoder();

const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array(s.match(/.{2}/g).map((h) => parseInt(h, 16)));

export async function sha256(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function hashPassword(password, saltHex) {
  const salt = saltHex ? unhex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return { hash: hex(bits), salt: hex(salt) };
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function validPassword(p) {
  if (typeof p !== 'string' || p.length < 10) throw new HttpError('Use a password of at least 10 characters.');
  if (p.length > 200) throw new HttpError('That password is too long.');
  return p;
}

export function cleanEmail(e) {
  const v = String(e || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 200) throw new HttpError('Enter a valid email address.');
  return v;
}

function cookieValue(request) {
  const raw = request.headers.get('cookie') || '';
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function sessionCookie(value, maxAge, request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function createSession(env, userId, request) {
  const t = token(32);
  await run(env, 'INSERT INTO sessions (token_hash, user_id, expires, created_at) VALUES (?, ?, ?, ?)',
    await sha256(t), userId, now() + SESSION_DAYS * 864e5, now());
  await run(env, 'UPDATE users SET last_login = ? WHERE id = ?', now(), userId);
  return sessionCookie(t, SESSION_DAYS * 86400, request);
}

export async function currentUser(env, request) {
  if (!env.DB) return null;
  const t = cookieValue(request);
  if (!t) return null;
  const row = await first(env,
    `SELECT u.id, u.email, u.name, u.role, u.job, u.client_id, u.avatar_at, s.expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    await sha256(t));
  if (!row || row.expires < now()) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role, job: row.role === 'team' ? (JOB_CAPS[row.job] ? row.job : 'setter') : null, client_id: row.client_id, avatar_at: row.avatar_at || null };
}

export async function endSession(env, request) {
  const t = cookieValue(request);
  if (t && env.DB) await run(env, 'DELETE FROM sessions WHERE token_hash = ?', await sha256(t));
  return sessionCookie('', 0, request);
}

export async function login(env, { email, password }) {
  const e = cleanEmail(email);
  const since = now() - 15 * 60e3;
  const fails = await first(env, 'SELECT COUNT(*) AS n FROM login_fails WHERE email = ? AND at > ?', e, since);
  if ((fails?.n || 0) >= 10) throw new HttpError('Too many attempts. Wait 15 minutes and try again.', 429);
  const u = await first(env, 'SELECT * FROM users WHERE email = ?', e);
  const ok = u && u.pass_hash && safeEqual((await hashPassword(String(password || ''), u.pass_salt)).hash, u.pass_hash);
  if (!ok) {
    await run(env, 'INSERT INTO login_fails (email, at) VALUES (?, ?)', e, now());
    throw new HttpError('Wrong email or password.', 401);
  }
  return u;
}

export async function userCount(env) {
  return (await first(env, 'SELECT COUNT(*) AS n FROM users'))?.n || 0;
}

export async function createUser(env, { email, name, role, client_id, password, job }) {
  const e = cleanEmail(email);
  if (!['admin', 'team', 'client'].includes(role)) throw new HttpError('Unknown role.');
  if (role === 'client' && !client_id) throw new HttpError('A client login needs a client.');
  if (await first(env, 'SELECT id FROM users WHERE email = ?', e)) throw new HttpError('That email already has a login.', 409);
  const id = newId('u_');
  let hash = null, salt = null;
  if (password) ({ hash, salt } = await hashPassword(validPassword(password)));
  await run(env, `INSERT INTO users (id, email, name, role, job, client_id, pass_hash, pass_salt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, e, String(name || '').slice(0, 120) || null, role, role === 'team' ? (JOB_CAPS[job] ? job : 'setter') : null, role === 'client' ? client_id : null, hash, salt, now());
  return id;
}

// One-time invite (or password reset) link, valid 7 days.
export async function issueInvite(env, userId) {
  const t = token(24);
  await run(env, 'UPDATE users SET invite_hash = ?, invite_expires = ? WHERE id = ?', await sha256(t), now() + 7 * 864e5, userId);
  return t;
}

export async function acceptInvite(env, { token: t, password }) {
  if (typeof t !== 'string' || t.length < 20) throw new HttpError('That invite link is not valid.');
  const u = await first(env, 'SELECT * FROM users WHERE invite_hash = ?', await sha256(t));
  if (!u || (u.invite_expires || 0) < now()) throw new HttpError('That invite link has expired. Ask for a new one.', 410);
  const { hash, salt } = await hashPassword(validPassword(password));
  await run(env, 'UPDATE users SET pass_hash = ?, pass_salt = ?, invite_hash = NULL, invite_expires = NULL WHERE id = ?', hash, salt, u.id);
  await run(env, 'DELETE FROM sessions WHERE user_id = ?', u.id);
  return u;
}

export async function listUsers(env, clientId) {
  const cols = 'id, email, name, role, job, client_id, created_at, last_login, (pass_hash IS NOT NULL) AS active';
  return clientId
    ? all(env, `SELECT ${cols} FROM users WHERE client_id = ? ORDER BY created_at`, clientId)
    : all(env, `SELECT ${cols} FROM users WHERE role IN ('admin','team') ORDER BY created_at`);
}

export const isStaff = (u) => u && (u.role === 'admin' || u.role === 'team');

export function requireUser(user) {
  if (!user) throw new HttpError('Please log in.', 401);
  return user;
}
export function requireStaff(user) {
  requireUser(user);
  if (!isStaff(user)) throw new HttpError('Only the Rightway team can do that.', 403);
  return user;
}
export function requireAdmin(user) {
  requireUser(user);
  if (user.role !== 'admin') throw new HttpError('Only an owner can do that.', 403);
  return user;
}
export function requireClientAccess(user, clientId) {
  requireUser(user);
  if (isStaff(user)) return user;
  if (user.client_id !== clientId) throw new HttpError('You do not have access to that business.', 403);
  return user;
}
