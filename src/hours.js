// Business hours on leads (Nov 2026, V: add hours of operation to the scrubber so I know if I am calling during business hours).
// Modeled on how Outscraper and Scrap.io carry Google's working hours on every exported business, and on Google Places "open now".
// Sources, best first (HOURS_RANK): typed by a rep from the listing, Google (Lead finder, research, or the paid "Get Google hours" button),
// the business website (free scrub: schema.org JSON-LD, then text near the word "hours"), OpenStreetMap opening_hours.
// Stored in lead_hours (leads is near D1's 100 column limit); GET /api/leads returns it as hrs, hrs_src, biz_status.
import { json, HttpError } from './util.js';
import { first, all, run, batch, now } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { searchBusinesses, businessDetails } from './dataforseo.js';
import { packHours, parseAny, hoursText, unpackHours, HOURS_RANK, HOURS_SRC } from '../public/js/hours.js';
import { stateRuleText, callBlock } from '../public/js/timezone.js';

const isDemo = (env) => !env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD;
export const GOOGLE_HOURS_MAX = 10;

// Save hours unless a better source already holds them. `hours` is a week, packed text, a DataForSEO object or plain text.
export async function saveHours(env, leadId, hours, src, status = '', { force = false } = {}) {
  const packed = packHours(typeof hours === 'string' && /^[1-7]:\d/.test(hours) ? unpackHours(hours) : parseAny(hours));
  if (!leadId || (!packed && !status)) return false;
  if (!force) {
    const cur = await first(env, 'SELECT src, hours FROM lead_hours WHERE lead_id = ?', leadId).catch(() => null);
    if (cur?.hours && (HOURS_RANK[cur.src] || 0) > (HOURS_RANK[src] || 0)) return false;
  }
  await run(env, `INSERT INTO lead_hours (lead_id, hours, src, status, at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(lead_id) DO UPDATE SET hours = COALESCE(NULLIF(excluded.hours, ''), lead_hours.hours), src = CASE WHEN excluded.hours <> '' THEN excluded.src ELSE lead_hours.src END,
    status = excluded.status, at = excluded.at`, leadId, packed || '', src, status || '', now());
  return true;
}
// Many new leads at once (imports): one statement each, no rank check (they are new).
export async function saveHoursMany(env, rows) {
  const items = rows.filter((r) => r && r.id && r.hours).map((r) => ['INSERT OR REPLACE INTO lead_hours (lead_id, hours, src, status, at) VALUES (?, ?, ?, ?, ?)', r.id, r.hours, r.src || 'google', r.status || '', now()]);
  for (let i = 0; i < items.length; i += 100) await batch(env, items.slice(i, i + 100));
  return items.length;
}

export async function hoursOf(env, lead) {
  const h = await first(env, 'SELECT hours, src, status, at FROM lead_hours WHERE lead_id = ?', lead.id).catch(() => null);
  const st = String(lead.state || '').toUpperCase();
  return {
    hours: h?.hours || '', text: hoursText(h?.hours || ''), src: h?.src || '', from: HOURS_SRC[h?.src] || '', status: h?.status || '', at: h?.at || null,
    rule: stateRuleText(st), state: st, callNow: !callBlock(lead.timezone, lead.tz_alt, Date.now(), lead.state), why: callBlock(lead.timezone, lead.tz_alt, Date.now(), lead.state),
  };
}

route('GET', '/api/leads/:id/hours', async ({ env, user, params }) => {
  requireStaff(user);
  const lead = await first(env, 'SELECT id, state, timezone, tz_alt FROM leads WHERE id = ?', params.id);
  if (!lead) throw new HttpError('Lead not found', 404);
  return json(await hoursOf(env, lead));
});

// Typed by a rep ("Mon-Fri 8am-5pm, Sat 9-1"). Empty text clears the hours.
route('PUT', '/api/leads/:id/hours', async ({ env, user, params, body }) => {
  requireStaff(user);
  const lead = await first(env, 'SELECT id, state, timezone, tz_alt FROM leads WHERE id = ?', params.id);
  if (!lead) throw new HttpError('Lead not found', 404);
  const b = await body();
  const text = String(b?.text || '').slice(0, 300).trim();
  if (!text) { await run(env, 'DELETE FROM lead_hours WHERE lead_id = ?', lead.id); return json(await hoursOf(env, lead)); }
  const week = parseAny(text);
  if (!week) throw new HttpError('The Hub could not read those hours. Try "Mon-Fri 8am-5pm, Sat 9am-1pm, Sun closed".');
  await saveHours(env, lead.id, week, 'hand', '', { force: true });
  return json(await hoursOf(env, lead));
});

// Google hours on click (paid, one Google Maps search a lead, about $0.002, logged under Lead data). Up to 10 leads a request.
route('POST', '/api/leads/hours/google', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  const fetchImpl = undefined;
  const ids = [...new Set((Array.isArray(b?.ids) ? b.ids : []).map(String))].slice(0, GOOGLE_HOURS_MAX);
  if (!ids.length) throw new HttpError('Pick at least one lead.');
  const leads = await all(env, `SELECT id, business, city, state, zip, address, phone, cid, place_id, lat, lng, timezone, tz_alt FROM leads WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  const demo = isDemo(env);
  const { matchListing } = await import('./intel.js');
  const results = {};
  let cost = 0;
  for (const l of leads) {
    try {
      let biz = null;
      if (demo) {
        biz = { work_hours: demoWeek(l.id) };
      } else if (l.cid && l.lat != null && l.lng != null) {
        const d = await businessDetails(env, { title: l.business, cid: l.cid, place_id: l.place_id || '', lat: l.lat, lng: l.lng }, fetchImpl, 'lead hours (maps)');
        cost += d.cost || 0; biz = d.business;
      } else {
        const where = [l.city, l.state].filter(Boolean).join(' ');
        if (!l.business || !where) { results[l.id] = { ok: false, why: 'Needs a city and state to find it on Google.' }; continue; }
        const s = await searchBusinesses(env, { name: l.business, location: where }, fetchImpl, 'lead hours (maps)');
        cost += s.cost || 0; biz = matchListing(s.results, l);
      }
      if (!biz) { results[l.id] = { ok: false, why: 'Not found on Google.' }; continue; }
      const week = demo ? biz.work_hours : unpackHours(biz.hrs || '');
      const status = biz.status || '';
      if (!week && !status) { results[l.id] = { ok: false, why: 'Google lists no hours for this business.' }; continue; }
      await saveHours(env, l.id, week ? packHours(week) : '', 'google', status);
      results[l.id] = { ok: true, hours: packHours(week), text: hoursText(week), status };
    } catch (e) { results[l.id] = { ok: false, why: e.message || 'Lookup failed.' }; }
  }
  return json({ results, cost, demo });
});

// Demo mode (no DataForSEO): a believable week so the screens can be tried.
function demoWeek(id) {
  const n = [...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0);
  const w = {}; for (let d = 1; d <= 5; d++) w[d] = [[n % 2 ? 420 : 480, n % 3 ? 1020 : 1080]];
  if (n % 4) w[6] = [[540, n % 5 ? 780 : 900]];
  return w;
}
