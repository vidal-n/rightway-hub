// What the Hub costs to run (owners only): a daily ledger of DataForSEO and Claude spend written at the call site, Twilio's own
// usage records read live, fixed monthly subscriptions the owner lists, and a monthly budget with a heads up at 80% and 100%.
// Everything is in dollars on the way out. The ledger stores micro dollars so a $0.002 search is not lost to rounding.
import { json, HttpError } from './util.js';
import { all, first, run, now, getSettings, setSetting } from './db.js';
import { requireAdmin } from './auth.js';
import { route } from './router.js';

const TZ = 'America/New_York';
// Lead data is its own line: lead finder and lead research spend (kinds starting "lead ") and lists or other lead costs entered by hand.
// Twilio lookups are already in Twilio's own usage, so they are not logged here again.
export const VENDORS = [['dataforseo', 'DataForSEO'], ['claude', 'Claude'], ['twilio', 'Twilio'], ['leads', 'Lead data']];
export const dayOf = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ });
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const usd = (micro) => Math.round(Number(micro || 0)) / 1e6;
const r2 = (n) => Math.round(n * 100) / 100;

// Written by the code that spends the money. Never throws: a missed ledger line must not break a scan or a reply.
export async function logCost(env, vendor, kind, dollars, n = 1) {
  if (!env?.DB || !(dollars > 0)) return;
  if (/^lead /.test(String(kind || ''))) vendor = 'leads';
  try {
    await run(env, `INSERT INTO cost_daily (day, vendor, kind, micro, n) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(day, vendor, kind) DO UPDATE SET micro = micro + excluded.micro, n = n + excluded.n`, dayOf(), vendor, kind, Math.round(dollars * 1e6), n);
  } catch { /* ledger is best effort */ }
}

// Anthropic list prices per million tokens (input, output). An estimate: the model name decides the tier.
const PRICE = [[/haiku/i, 1, 5], [/sonnet/i, 3, 15], [/opus/i, 5, 25], [/fable|mythos/i, 10, 50]];
export function claudeCost(model, usage = {}) {
  const [, pin, pout] = PRICE.find(([re]) => re.test(String(model || ''))) || [null, 1, 5];
  const inTok = Number(usage.input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0) * 1.25 + Number(usage.cache_read_input_tokens || 0) * 0.1;
  return (inTok * pin + Number(usage.output_tokens || 0) * pout) / 1e6;
}
export async function logClaude(env, model, data, kind = 'other') {
  if (!data?.usage) return;
  await logCost(env, 'claude', kind, claudeCost(model, data.usage));
}

// ---------- Twilio (their numbers, not ours) ----------
let twCache = null;
async function twilioUsage(env, from, to, fetchImpl = fetch) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return null;
  if (twCache && twCache.key === `${from}|${to}` && Date.now() - twCache.at < 10 * 60e3) return twCache.data;
  const base = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Usage/Records`;
  const headers = { authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}` };
  try {
    const [d, m] = await Promise.all([
      fetchImpl(`${base}/Daily.json?Category=totalprice&StartDate=${from}&EndDate=${to}&PageSize=400`, { headers }).then((r) => r.json()),
      fetchImpl(`${base}/ThisMonth.json?PageSize=200`, { headers }).then((r) => r.json()),
    ]);
    const daily = {};
    for (const x of d.usage_records || []) daily[x.start_date] = (daily[x.start_date] || 0) + Math.abs(Number(x.price || 0));
    const pick = (c) => Math.abs(Number((m.usage_records || []).find((x) => x.category === c)?.price || 0));
    const data = { daily, month: { calls: pick('calls'), sms: pick('sms'), numbers: pick('phonenumbers'), recordings: pick('recordings'), total: pick('totalprice') } };
    twCache = { key: `${from}|${to}`, at: Date.now(), data };
    return data;
  } catch { return null; }
}

const monthStart = (day) => `${day.slice(0, 7)}-01`;
const daysIn = (day) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0).getDate();
const addDays = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export async function costSettings(env) {
  const s = await getSettings(env);
  const b = parse(s.costs_budget, {}) || {};
  const fixed = (parse(s.costs_fixed, []) || []).filter((f) => f && f.name).map((f) => ({ name: String(f.name).slice(0, 60), monthly: Math.max(0, Number(f.monthly) || 0) }));
  return { budget: { monthly: Math.max(0, Number(b.monthly) || 0), vendors: Object.fromEntries(VENDORS.map(([k]) => [k, Math.max(0, Number(b.vendors?.[k]) || 0)])) }, fixed };
}

// The whole picture for the Settings tab and the Dashboard card.
export async function costSummary(env, days = 30, fetchImpl = fetch) {
  const today = dayOf();
  days = Math.min(120, Math.max(7, Number(days) || 30));
  const prevStart = monthStart(addDays(monthStart(today), -1));
  const from = [addDays(today, -(days - 1)), prevStart].sort()[0];
  const cfg = await costSettings(env);
  const rows = await all(env, 'SELECT day, vendor, kind, micro, n FROM cost_daily WHERE day >= ? ORDER BY day', from).catch(() => []);
  const tw = await twilioUsage(env, from, today, fetchImpl);
  const per = {}; // day -> vendor -> dollars
  const put = (day, v, x) => { (per[day] ||= {})[v] = (per[day][v] || 0) + x; };
  for (const r of rows) put(r.day, r.vendor, usd(r.micro));
  if (tw) for (const [day, x] of Object.entries(tw.daily)) put(day, 'twilio', x);
  const series = [];
  for (let d = addDays(today, -(days - 1)); d <= today; d = addDays(d, 1)) series.push({ day: d, ...Object.fromEntries(VENDORS.map(([k]) => [k, r2(per[d]?.[k] || 0)])) });
  const mStart = monthStart(today), dayNo = Number(today.slice(8, 10)), dim = daysIn(today);
  const sum = (pred, v) => Object.entries(per).filter(([d]) => pred(d)).reduce((n, [, o]) => n + (v ? o[v] || 0 : Object.values(o).reduce((a, b) => a + b, 0)), 0);
  const mtdBy = Object.fromEntries(VENDORS.map(([k]) => [k, r2(sum((d) => d >= mStart, k))]));
  const usage = r2(Object.values(mtdBy).reduce((a, b) => a + b, 0));
  const fixed = r2(cfg.fixed.reduce((n, f) => n + f.monthly, 0));
  const prevUsage = r2(sum((d) => d >= prevStart && d < mStart));
  const projected = r2((usage / dayNo) * dim + fixed);
  const kinds = {};
  for (const r of rows) if (r.day >= mStart) { const k = `${r.vendor}:${r.kind}`; kinds[k] = kinds[k] || { vendor: r.vendor, kind: r.kind, usd: 0, n: 0 }; kinds[k].usd += usd(r.micro); kinds[k].n += r.n; }
  const searches = rows.filter((r) => r.vendor === 'dataforseo' && r.day >= mStart).reduce((a, r) => ({ usd: a.usd + usd(r.micro), n: a.n + r.n }), { usd: 0, n: 0 });
  const mrr = (await first(env, "SELECT COALESCE(SUM(mrr_cents), 0) AS c, COUNT(*) AS n FROM clients WHERE status = 'active' AND sample = 0 AND parent_id IS NULL").catch(() => null)) || { c: 0, n: 0 };
  const monthMs = new Date(`${mStart}T00:00:00-05:00`).getTime();
  const booked = (await first(env, "SELECT COUNT(*) AS n FROM activities WHERE outcome = 'booked' AND at >= ?", monthMs).catch(() => null))?.n || 0;
  const total = r2(usage + fixed);
  const b = cfg.budget.monthly;
  return {
    days, series, month: { start: mStart, day: dayNo, days: dim, usage, fixed, total, by: mtdBy, prev: prevUsage, projected, twilio: tw ? tw.month : null, twilioConnected: Boolean(tw) },
    budget: { ...cfg.budget, pct: b ? Math.round((100 * total) / b + 1e-9) : null, projectedPct: b ? Math.round((100 * projected) / b + 1e-9) : null, left: b ? r2(b - total) : null },
    kinds: Object.values(kinds).map((k) => ({ ...k, usd: r2(k.usd) })).sort((a, z) => z.usd - a.usd),
    fixedList: cfg.fixed,
    unit: { search: searches.n ? Math.round((searches.usd / searches.n) * 10000) / 10000 : 0, searches: searches.n },
    revenue: { mrr: r2(mrr.c / 100), clients: mrr.n, costPerClient: mrr.n ? r2(total / mrr.n) : null, costPct: mrr.c ? Math.round((100 * total) / (mrr.c / 100)) : null, margin: r2(mrr.c / 100 - total), perBooked: booked ? r2(usage / booked) : null, booked },
  };
}

route('GET', '/api/costs', async ({ env, user, url }) => {
  requireAdmin(user);
  return json(await costSummary(env, url.searchParams.get('days')));
});

// A lead expense entered by hand (a list bought, a data tool paid for). Counted today, on the Lead data line.
route('POST', '/api/costs/entry', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  const name = String(b.name || '').trim().slice(0, 60);
  const amt = Number(b.dollars);
  if (!name) throw new HttpError('Name the expense.');
  if (!Number.isFinite(amt) || amt <= 0 || amt > 1e6) throw new HttpError('Enter a dollar amount above zero.');
  await logCost(env, 'leads', `bought: ${name}`, Math.round(amt * 100) / 100);
  return json(await costSummary(env, 30));
});

route('PUT', '/api/costs/budget', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  const num = (v) => { const n = Number(v); if (v === '' || v == null) return 0; if (!Number.isFinite(n) || n < 0 || n > 1e6) throw new HttpError('Enter a dollar amount.'); return Math.round(n * 100) / 100; };
  const cur = await costSettings(env);
  if ('monthly' in b || 'vendors' in b) {
    await setSetting(env, 'costs_budget', JSON.stringify({ monthly: 'monthly' in b ? num(b.monthly) : cur.budget.monthly, vendors: Object.fromEntries(VENDORS.map(([k]) => [k, b.vendors && k in b.vendors ? num(b.vendors[k]) : cur.budget.vendors[k]])) }));
  }
  if (Array.isArray(b.fixed)) {
    if (b.fixed.length > 30) throw new HttpError('That is a lot of subscriptions. Keep it to 30.');
    await setSetting(env, 'costs_fixed', JSON.stringify(b.fixed.filter((f) => String(f?.name || '').trim()).map((f) => ({ name: String(f.name).trim().slice(0, 60), monthly: num(f.monthly) }))));
  }
  return json(await costSummary(env, 30));
});

// Cron: tell the owners once a month at 80% and again at 100% of the budget.
export async function costTick(env) {
  const cfg = await costSettings(env);
  if (!cfg.budget.monthly) return;
  const sum = await costSummary(env, 7);
  const level = sum.budget.pct >= 100 ? 100 : sum.budget.pct >= 80 ? 80 : 0;
  if (!level) return;
  const key = `${sum.month.start.slice(0, 7)}:${String(level).padStart(3, '0')}`;
  const s = await getSettings(env);
  if (s.costs_alerted && s.costs_alerted >= key) return;
  await setSetting(env, 'costs_alerted', key);
  const { notify } = await import('./notify.js');
  await notify(env, { to: 'admins', kind: 'money', title: level === 100 ? 'Hub budget reached' : 'Hub budget at 80%', body: `$${sum.month.total.toFixed(2)} of $${cfg.budget.monthly.toFixed(2)} this month. Projected $${sum.month.projected.toFixed(2)}.`, url: '/#/settings/budget', tag: 'budget', slack: false });
}
