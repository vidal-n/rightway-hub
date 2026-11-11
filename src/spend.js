// Spending control (owners). Two protections for money that is spent without anyone clicking:
//  1. Every background job that can cost money has its own switch, off until an owner turns it on.
//  2. A daily limit in dollars. When today's DataForSEO, Claude and lead data spend reaches it, every background job pauses
//     until tomorrow. Things a person clicks (a lead search, a scan, a draft) are not blocked: they were chosen on purpose.
import { json, HttpError } from './util.js';
import { first, getSettings, setSetting } from './db.js';
import { requireAdmin } from './auth.js';
import { route } from './router.js';
import { dayOf } from './costs.js';
import { PRICES, researchUsd } from '../public/js/pricing.js';
import { RESEARCH_DEPTHS } from '../public/js/freedata.js';

export const DEFAULT_DAY_CAP = 5;
const VENDORS = ['dataforseo', 'claude', 'leads'];   // Twilio is read live from Twilio, not logged here

export async function daySpendCap(env) {
  const s = await getSettings(env);
  const v = s.spend_cap_day;
  return v == null || v === '' ? DEFAULT_DAY_CAP : Math.max(0, Number(v) || 0);   // 0 = no limit
}
export async function spentOn(env, day = dayOf()) {
  const r = await first(env, `SELECT SUM(micro) AS m FROM cost_daily WHERE day = ? AND vendor IN (${VENDORS.map(() => '?').join(',')})`, day, ...VENDORS).catch(() => null);
  return Math.round(Number(r?.m || 0)) / 1e6;
}
export async function spentMonth(env) {
  const prefix = dayOf().slice(0, 7);
  const r = await first(env, `SELECT SUM(micro) AS m FROM cost_daily WHERE day LIKE ? AND vendor IN (${VENDORS.map(() => '?').join(',')})`, `${prefix}-%`, ...VENDORS).catch(() => null);
  return Math.round(Number(r?.m || 0)) / 1e6;
}
// Background jobs ask before every paid call. { ok, spent, cap }
export async function bgOk(env) {
  const cap = await daySpendCap(env);
  if (!cap) return { ok: true, spent: 0, cap: 0 };
  const spent = await spentOn(env);
  return { ok: spent < cap, spent, cap };
}

route('GET', '/api/spend', async ({ env, user }) => {
  requireAdmin(user);
  const [cap, today, month, s] = await Promise.all([daySpendCap(env), spentOn(env), spentMonth(env), getSettings(env)]);
  return json({ cap, today, month, paused: cap > 0 && today >= cap, prices: PRICES, depths: RESEARCH_DEPTHS, lookup: s.scrub_lookup === '1' });
});

route('PUT', '/api/spend', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  if ('cap' in b) {
    const n = Number(b.cap);
    if (!Number.isFinite(n) || n < 0 || n > 10000) throw new HttpError('Type a daily limit in dollars, from 0 to 10000. 0 means no limit.');
    await setSetting(env, 'spend_cap_day', String(Math.round(n * 100) / 100));
  }
  return json({ ok: true, cap: await daySpendCap(env) });
});

export { researchUsd };
