// Free lead data: OpenStreetMap discovery (Overpass API), the Florida Sunbiz registry (owner and officer names, date filed) and the owner's
// switch between paid and free lead data. Nothing here costs money. These are public websites with no keys, so every call is polite
// (identifying User-Agent, short timeouts, one endpoint after another) and every failure just means "no data", never a broken lead.
import { HttpError, json } from './util.js';
import { getSettings, setSetting } from './db.js';
import { requireAdmin } from './auth.js';
import { route } from './router.js';
import { stateCode, registryFor, openDataUrl, normalizeRows } from '../public/js/registries.js';
import { overpassQuery, osmRecord, sunbizSearchUrl, parseSunbizResults, pickEntity, parseSunbizDetail, pickOwner, yearsSince, entityName } from '../public/js/freedata.js';

const UA = 'RightwayHub/1.0 (hello@rightwaygrowth.com)';
export const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

export async function leadMode(env) {
  const s = await getSettings(env).catch(() => ({}));
  return { mode: s.lead_mode === 'free' ? 'free' : 'paid', sunbiz: s.sunbiz_auto !== '0' };
}
export const isFreeMode = async (env) => (await leadMode(env)).mode === 'free';

const withTimeout = async (fetchImpl, url, init, ms) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetchImpl(url, { ...init, signal: ctrl.signal }); } finally { clearTimeout(t); }
};

// One keyword in one area from OpenStreetMap. Same record shape as the Google Maps source, cost always 0.
export async function osmSearch(env, task, fetchImpl = fetch) {
  const q = overpassQuery({ keyword: task.keyword, lat: task.lat, lng: task.lng, miles: task.radius || 5 });
  if (!q) throw new HttpError(`OpenStreetMap has no category for "${task.keyword}". Use a more common trade or business type, like "roofing" or "plumber".`);
  let lastErr = 'no answer';
  for (const url of OVERPASS) {
    try {
      const res = await withTimeout(fetchImpl, url, { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: `data=${encodeURIComponent(q)}` }, 30000);
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
      const data = await res.json().catch(() => null);
      if (!data || !Array.isArray(data.elements)) { lastErr = 'unreadable answer'; continue; }
      const seen = new Set();
      const results = [];
      for (const el of data.elements) { const r = osmRecord(el); if (r && !seen.has(r.osm)) { seen.add(r.osm); results.push(r); } }
      return { results, cost: 0 };
    } catch (e) { lastErr = e.name === 'AbortError' ? 'timed out' : e.message; }
  }
  throw new HttpError(`OpenStreetMap's free servers are busy (${lastErr}). It retries on its own.`, 502);
}

// Sunbiz: find the lead's company on the Florida registry and read the people on it. Florida leads only.
export async function sunbizLookup(lead, fetchImpl = fetch) {
  const st = String(lead.state || '').trim().toUpperCase();
  if (st && st !== 'FL' && st !== 'FLORIDA') return { skipped: 'not Florida' };
  const words = entityName(lead.business_raw || lead.business).split(' ').filter(Boolean);
  if (!words.length) return { skipped: 'no name' };
  const term = words.slice(0, 3).join(' ');
  const get = async (url) => {
    const res = await withTimeout(fetchImpl, url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; RightwayHub/1.0; +https://rightwaygrowth.com)', accept: 'text/html' } }, 12000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  };
  try {
    const list = parseSunbizResults(await get(sunbizSearchUrl(term)));
    const hit = pickEntity(list, lead);
    if (!hit) return { found: false, searched: term, at: Date.now() };
    const url = /^https?:/.test(hit.url) ? hit.url : `https://search.sunbiz.org${hit.url.startsWith('/') ? '' : '/'}${hit.url}`;
    const d = parseSunbizDetail(await get(url));
    const owner = pickOwner(d);
    return {
      found: true, at: Date.now(), url, name: d.name || hit.name, kind: d.kind, status: d.status || hit.status, active: /^ACTIVE/i.test(d.status || hit.status), docNo: d.docNo, filed: d.filed,
      years: yearsSince(d.filed), principal: d.principal, agent: d.agent?.name || '', people: d.people.slice(0, 8), owner: owner?.name || '', ownerTitle: owner?.title || '', annualReports: d.annualReports.slice(-3),
    };
  } catch (e) { return { found: false, error: e.message.slice(0, 120), at: Date.now() }; }
}

// Every state: Florida reads Sunbiz (officers too), CO, OR, CT, NY and PA read their open data, the rest return the state's official search
// page so the rep can check by hand. Nothing here ever invents a match: no match is reported as "not found", a state with no open data as a link.
export async function registryLookup(lead, fetchImpl = fetch) {
  const code = stateCode(lead.state) || (String(lead.state || '').trim() ? '' : 'FL');   // a blank state is treated as Florida, the home market
  const reg = registryFor(code);
  if (!reg) return { skipped: 'unknown state' };
  const base = { code: reg.code, state: reg.state, registry: reg.registry, searchUrl: reg.url };
  if (reg.code === 'FL') {
    const r = await sunbizLookup(lead, fetchImpl);
    return r.skipped ? r : { ...base, source: 'sunbiz', ...r };
  }
  if (reg.mode === 'link') return { ...base, source: 'link', linkOnly: true };
  const url = openDataUrl(reg.code, lead.business_raw || lead.business);
  if (!url) return { skipped: 'no name' };
  try {
    const res = await withTimeout(fetchImpl, url, { headers: { 'user-agent': UA, accept: 'application/json' } }, 12000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = normalizeRows(reg.code, await res.json());
    const hit = pickEntity(rows, lead);
    if (!hit) return { ...base, source: 'open', found: false, at: Date.now() };
    return { ...base, source: 'open', found: true, at: Date.now(), name: hit.name, id: hit.id, kind: hit.kind, status: hit.status, active: hit.active, filed: hit.filed, years: hit.years, agent: hit.agent, city: hit.city };
  } catch (e) { return { ...base, source: 'open', found: false, error: String(e.message || e).slice(0, 120), at: Date.now() }; }
}

// ---------- the switch ----------
route('GET', '/api/lead-mode', async ({ env, user }) => {
  requireAdmin(user);
  return json({ ...(await leadMode(env)), paidReady: Boolean(env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD) });
});

route('PUT', '/api/lead-mode', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  if ('mode' in b) { if (!['free', 'paid'].includes(b.mode)) throw new HttpError('Mode must be free or paid.'); await setSetting(env, 'lead_mode', b.mode); }
  if ('sunbiz' in b) await setSetting(env, 'sunbiz_auto', b.sunbiz ? '1' : '0');
  return json({ ...(await leadMode(env)), paidReady: Boolean(env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD) });
});
