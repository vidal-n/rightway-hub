// Citations and links (Phase 8): a directory check (is the business listed, and do the name, address and phone match),
// a log of citations built or fixed and links earned (counted against the month's link quota), local link prospects found
// by search, and a live check that logged links still point at the client. Links are earned by hand: no paid or automated
// link building (Google's link scheme rules).
import { HttpError, json } from './util.js';
import { all, first, run, newId, now, getSettings } from './db.js';
import { requireStaff, requireClientAccess } from './auth.js';
import { route } from './router.js';
import { monthKey } from './plans.js';
import { webSearch } from './dataforseo.js';
import { mockWeb } from './mock.js';
import { citations as directoryList } from '../public/js/fulfill.js';
import { industryInfo } from '../public/js/leadintel.js';

const isDemo = (env) => !env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD;
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const list = (s) => String(s || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

// Where each directory's listings live, for a Google "site:" search.
export const SITES = {
  Yelp: 'yelp.com', 'Facebook page': 'facebook.com', 'Better Business Bureau': 'bbb.org', Nextdoor: 'nextdoor.com', 'LinkedIn company page': 'linkedin.com/company',
  Foursquare: 'foursquare.com', 'Yellow Pages (YP)': 'yellowpages.com', Manta: 'manta.com', MapQuest: 'mapquest.com', Hotfrog: 'hotfrog.com', Alignable: 'alignable.com',
  Brownbook: 'brownbook.net', Angi: 'angi.com', Thumbtack: 'thumbtack.com', Houzz: 'houzz.com', Porch: 'porch.com', BuildZoom: 'buildzoom.com', GuildQuality: 'guildquality.com',
  'Best Plumbers': 'bestplumbers.com', Healthgrades: 'healthgrades.com', Vitals: 'vitals.com', 'WebMD Care': 'doctor.webmd.com', RateMDs: 'ratemds.com', Zocdoc: 'zocdoc.com',
  'Wellness.com': 'wellness.com', Avvo: 'avvo.com', Justia: 'lawyers.justia.com', FindLaw: 'lawyers.findlaw.com', 'Martindale-Hubbell': 'martindale.com', 'Lawyers.com': 'lawyers.com',
  'HG.org': 'hg.org', 'US Legal': 'uslegal.com', 'Super Lawyers': 'superlawyers.com', TaxBuzz: 'taxbuzz.com', 'CPA Directory': 'cpadirectory.com', RepairPal: 'repairpal.com',
  CARFAX: 'carfax.com', TripAdvisor: 'tripadvisor.com', EnergySage: 'energysage.com', SolarReviews: 'solarreviews.com', MyMovingReviews: 'mymovingreviews.com', RealSelf: 'realself.com',
  'Zillow agent profile': 'zillow.com', 'Realtor.com': 'realtor.com', Booksy: 'booksy.com', Vagaro: 'vagaro.com', StyleSeat: 'styleseat.com',
};
const BIG = /(^|\.)(yelp|facebook|google|youtube|instagram|linkedin|nextdoor|angi|thumbtack|homeadvisor|bbb|yellowpages|reddit|wikipedia|tripadvisor|indeed|amazon|pinterest|tiktok|x|twitter|houzz|porch|mapquest|apple|bing)\./i;

const STOP = new Set(['the', 'and', 'llc', 'inc', 'co', 'corp', 'company', 'of', 'services', 'service', 'group', 'pllc', 'pa', 'ltd']);
const tokens = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 1 && !STOP.has(w));

// Decide from Google's preview whether a directory lists the business and whether the details match. Pure.
export function judgeListing(results, client) {
  const want = tokens(client.name);
  const need = want.length <= 2 ? want.length : Math.ceil(want.length * 0.6);
  const hit = (results || []).find((r) => {
    const have = new Set(tokens(`${r.title} ${decodeURIComponent(r.url || '').replace(/[-_/]/g, ' ')}`));
    return want.length && want.filter((w) => have.has(w)).length >= need;
  });
  if (!hit) return { status: 'missing' };
  const text = `${hit.title} ${hit.snippet}`;
  const phone = digits(client.phone);
  const phones = [...text.matchAll(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g)].map((m) => digits(m[0])).filter((d) => d.length === 10);
  const zip = (String(client.address || '').match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/) || [])[1] || '';
  const street = (String(client.address || '').match(/^\s*(\d{2,6})\s/) || [])[1] || '';
  const zips = [...text.matchAll(/\b(\d{5})(?:-\d{4})?\b/g)].map((m) => m[1]).filter((z) => z !== street);
  const phoneOk = phone.length === 10 && phones.includes(phone);
  const phoneBad = phone.length === 10 && phones.length > 0 && !phoneOk;
  const zipOk = Boolean(zip) && zips.includes(zip);
  const zipBad = Boolean(zip) && zips.length > 0 && !zipOk;
  const streetOk = Boolean(street) && new RegExp(`\\b${street}\\b`).test(text);
  const notes = [phoneBad ? `Shows a different phone (${phones[0].replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3')})` : '', zipBad ? `Shows a different ZIP (${zips[0]})` : ''].filter(Boolean);
  const status = phoneBad || zipBad ? 'mismatch' : phoneOk || zipOk || streetOk ? 'match' : 'found';
  return { status, url: hit.url, title: hit.title, snippet: hit.snippet.slice(0, 240), notes };
}

async function search(env, q) {
  return isDemo(env) ? mockWeb(q) : webSearch(env, q, { depth: 10 });
}

async function clientOr404(env, id) {
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', id);
  if (!c) throw new HttpError('Client not found.', 404);
  return c;
}
const cityOf = (c) => list(c.cities)[0] || (String(c.address || '').split(',').slice(-2, -1)[0] || '').trim();
const stateOf = (c) => (String(c.address || '').match(/,\s*([A-Z]{2})\s*\d{5}/) || [])[1] || '';
const dirsFor = (c) => directoryList({ name: c.name, address: c.address, city: cityOf(c), state: stateOf(c), category: c.category });

// Check up to 25 directories in one go (one search each).
route('POST', '/api/clients/:id/citations/audit', async ({ env, user, params }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  if (!c.name) throw new HttpError('The client needs a name.');
  const city = cityOf(c);
  const dirs = dirsFor(c).filter((d) => SITES[d.name]).slice(0, 25);
  let cost = 0;
  const results = await Promise.all(dirs.map(async (d) => {
    try {
      const r = await search(env, `site:${SITES[d.name]} "${c.name}"${city ? ` ${city}` : ''}`);
      cost += r.cost || 0;
      return { name: d.name, ...judgeListing(r.results, c) };
    } catch (e) { return { name: d.name, status: 'error', error: e.message }; }
  }));
  if (results.length && results.every((r) => r.status === 'error')) throw new HttpError(results[0].error, 502);
  const counts = results.reduce((o, r) => ({ ...o, [r.status]: (o[r.status] || 0) + 1 }), {});
  const id = newId('ca_');
  await run(env, 'INSERT INTO citation_audits (id, client_id, results, counts, cost, demo, created_at, by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, c.id, JSON.stringify(results), JSON.stringify(counts), Math.round(cost * 10000) / 10000, isDemo(env) ? 1 : 0, now(), user.id);
  await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', newId('l_'), c.id,
    `Directory check: ${counts.match || 0} match, ${counts.mismatch || 0} need fixing, ${counts.missing || 0} not listed`, now(), user.id);
  return json({ ok: true, counts, cost });
});

const logOut = (r) => ({
  id: r.id, type: r.type, name: r.name, url: r.url || '', target: r.target || '', anchor: r.anchor || '', kind: r.kind || '', status: r.status, cost: r.cost_cents || 0,
  source: r.source || '', note: r.note || '', month: r.month, live_at: r.live_at || null, checked_at: r.checked_at || null, check: r.check_result || null, created_at: r.created_at,
});

route('GET', '/api/clients/:id/citations', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  const c = await clientOr404(env, params.id);
  const staff = user.role !== 'client';
  const month = monthKey();
  const [audit, logRows, quota, settings] = await Promise.all([
    first(env, 'SELECT * FROM citation_audits WHERE client_id = ? ORDER BY created_at DESC LIMIT 1', c.id),
    all(env, `SELECT * FROM link_log WHERE client_id = ? ${staff ? '' : "AND status = 'live'"} ORDER BY created_at DESC LIMIT 300`, c.id),
    first(env, "SELECT COUNT(*) AS total, SUM(status = 'done') AS done FROM tasks WHERE client_id = ? AND month = ? AND kind = 'link'", c.id, month),
    getSettings(env).catch(() => ({})),
  ]);
  const marks = parse(settings[`onb:${c.id}`]) || {};
  const found = new Map((parse(audit?.results) || []).map((r) => [r.name, r]));
  const directories = dirsFor(c).map((d) => ({ ...d, site: SITES[d.name] || null, team: marks[`cit:${d.name}`] || null, audit: found.get(d.name) || null }));
  return json({
    directories: staff ? directories : directories.filter((d) => d.team || d.audit?.status === 'match').map(({ name, group, audit: a, team }) => ({ name, group, listed: Boolean(team && team !== 'n/a') || a?.status === 'match', url: a?.url || null })),
    lastAudit: audit ? { at: audit.created_at, counts: parse(audit.counts) || {}, demo: Boolean(audit.demo) } : null,
    log: logRows.map(logOut), quota: { month, total: quota?.total || 0, done: quota?.done || 0 },
    website: c.website || '', demo: isDemo(env),
  });
});

// One open "link" task per month is checked off for each citation or link that goes live.
async function countIt(env, row, by) {
  const t = await first(env, "SELECT id FROM tasks WHERE client_id = ? AND month = ? AND kind = 'link' AND status != 'done' ORDER BY sort, created_at LIMIT 1", row.client_id, monthKey());
  if (!t) return null;
  await run(env, "UPDATE tasks SET status = 'done', done_at = ?, done_by = ?, link = COALESCE(link, ?), note = COALESCE(note, ?) WHERE id = ?", now(), by, row.url || null, row.name, t.id);
  await run(env, 'UPDATE link_log SET task_id = ? WHERE id = ?', t.id, row.id);
  return t.id;
}
const STATUSES = ['prospect', 'planned', 'submitted', 'live', 'lost'];
const clean = (b, prev = {}) => ({
  type: b.type === 'link' ? 'link' : b.type === 'citation' ? 'citation' : prev.type || 'citation',
  name: String(b.name ?? prev.name ?? '').trim().slice(0, 120),
  url: String(b.url ?? prev.url ?? '').trim().slice(0, 500) || null,
  target: String(b.target ?? prev.target ?? '').trim().slice(0, 500) || null,
  anchor: String(b.anchor ?? prev.anchor ?? '').trim().slice(0, 200) || null,
  kind: String(b.kind ?? prev.kind ?? '').trim().slice(0, 40) || null,
  status: STATUSES.includes(b.status) ? b.status : prev.status || 'planned',
  cost_cents: b.cost != null ? Math.max(0, Math.round(Number(String(b.cost).replace(/[$,]/g, '')) * 100) || 0) : prev.cost_cents || 0,
  note: String(b.note ?? prev.note ?? '').trim().slice(0, 1000) || null,
});

route('POST', '/api/clients/:id/links', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  const b = await body();
  const v = clean(b);
  if (!v.name) throw new HttpError('Name the directory or site.');
  if (v.url && !/^https?:\/\//i.test(v.url)) throw new HttpError('The address should start with https://');
  const id = newId('lk_');
  await run(env, `INSERT INTO link_log (id, client_id, type, name, url, target, anchor, kind, status, cost_cents, source, note, month, created_at, live_at, by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, c.id, v.type, v.name, v.url, v.target, v.anchor, v.kind, v.status, v.cost_cents,
  String(b.source || 'manual').slice(0, 20), v.note, monthKey(), now(), v.status === 'live' ? now() : null, user.id);
  const row = await first(env, 'SELECT * FROM link_log WHERE id = ?', id);
  const task = v.status === 'live' ? await countIt(env, row, user.id) : null;
  if (v.status === 'live') await run(env, 'INSERT INTO log (id, client_id, text, link, at, by) VALUES (?, ?, ?, ?, ?, ?)', newId('l_'), c.id, `${v.type === 'link' ? 'New link' : 'Listing live'}: ${v.name}`, v.url, now(), user.id);
  return json({ item: logOut(await first(env, 'SELECT * FROM link_log WHERE id = ?', id)), task });
});

route('PATCH', '/api/links/:id', async ({ env, user, params, body }) => {
  requireStaff(user);
  const row = await first(env, 'SELECT * FROM link_log WHERE id = ?', params.id);
  if (!row) throw new HttpError('Not found.', 404);
  const v = clean(await body(), row);
  if (v.url && !/^https?:\/\//i.test(v.url)) throw new HttpError('The address should start with https://');
  const goingLive = v.status === 'live' && row.status !== 'live';
  await run(env, 'UPDATE link_log SET type = ?, name = ?, url = ?, target = ?, anchor = ?, kind = ?, status = ?, cost_cents = ?, note = ?, live_at = CASE WHEN ? THEN ? ELSE live_at END WHERE id = ?',
    v.type, v.name, v.url, v.target, v.anchor, v.kind, v.status, v.cost_cents, v.note, goingLive ? 1 : 0, now(), row.id);
  const fresh = await first(env, 'SELECT * FROM link_log WHERE id = ?', row.id);
  const task = goingLive && !row.task_id ? await countIt(env, fresh, user.id) : null;
  if (goingLive) await run(env, 'INSERT INTO log (id, client_id, text, link, at, by) VALUES (?, ?, ?, ?, ?, ?)', newId('l_'), row.client_id, `${v.type === 'link' ? 'New link' : 'Listing live'}: ${v.name}`, v.url, now(), user.id);
  return json({ item: logOut(await first(env, 'SELECT * FROM link_log WHERE id = ?', row.id)), task });
});

route('DELETE', '/api/links/:id', async ({ env, user, params }) => {
  requireStaff(user);
  await run(env, 'DELETE FROM link_log WHERE id = ?', params.id);
  return json({ ok: true });
});

// Local link prospects: a few searches for chambers, associations, "best of" lists and sponsorships. Adds new sites only.
export function prospectQueries(c) {
  const city = cityOf(c);
  const state = stateOf(c);
  const label = industryInfo(c.category).label;
  const service = (list(c.services)[0] || label || 'service').toLowerCase();
  if (!city) return [];
  return [
    [`${city} chamber of commerce`, 'Chamber', 'Join, then ask for the member directory listing with a link to their site.'],
    [`${city} business association`, 'Association', 'Local business groups list members. Ask how to be added.'],
    [`${label} association ${state || city}`.trim(), 'Trade group', 'Trade groups often have a member finder that links out.'],
    [`best ${service} in ${city}`, 'Best of list', 'Ask the writer to look at them for the next update. Offer a photo or quote, never payment.'],
    [`${city} youth sports sponsorship`, 'Sponsorship', 'Sponsor a team or event. Sponsor pages usually link to sponsors.'],
    [`${city} community events sponsors`, 'Sponsorship', 'Local events list sponsors with links.'],
  ];
}

route('POST', '/api/clients/:id/links/prospects', async ({ env, user, params }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  const qs = prospectQueries(c);
  if (!qs.length) throw new HttpError('Add the city on the client profile first.');
  const have = new Set((await all(env, 'SELECT url FROM link_log WHERE client_id = ?', c.id)).map((r) => hostOf(r.url)).filter(Boolean));
  const own = hostOf(c.website ? (/^https?:/i.test(c.website) ? c.website : `https://${c.website}`) : '');
  let cost = 0, added = 0;
  const found = await Promise.all(qs.map(async ([q, kind, note]) => { try { const r = await search(env, q); cost += r.cost || 0; return { kind, note, q, results: r.results }; } catch { return { kind, note, q, results: [] }; } }));
  for (const f of found) {
    let n = 0;
    for (const r of f.results) {
      const h = hostOf(r.url);
      if (!h || have.has(h) || h === own || BIG.test(`.${h}`) || n >= 3) continue;
      have.add(h); n++;
      await run(env, `INSERT INTO link_log (id, client_id, type, name, url, kind, status, source, note, month, created_at, by) VALUES (?, ?, 'link', ?, ?, ?, 'prospect', 'prospects', ?, ?, ?, ?)`,
        newId('lk_'), c.id, (r.title || h).slice(0, 120), r.url, f.kind, `${f.note} (Found by searching "${f.q}".)`, monthKey(), now(), user.id);
      added++;
    }
  }
  return json({ added, cost: Math.round(cost * 10000) / 10000 });
});

// Does each live link still point at the client? Reads up to 15 pages.
route('POST', '/api/clients/:id/links/check', async ({ env, user, params }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  const own = hostOf(c.website ? (/^https?:/i.test(c.website) ? c.website : `https://${c.website}`) : '');
  const phone = digits(c.phone);
  const rows = await all(env, "SELECT * FROM link_log WHERE client_id = ? AND status IN ('live','lost') AND url IS NOT NULL ORDER BY checked_at IS NOT NULL, checked_at LIMIT 15", c.id);
  let ok = 0, lost = 0;
  await Promise.all(rows.map(async (r) => {
    let result;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(r.url, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; RightwayHub/1.0; +https://rightwaygrowth.com)' } }).finally(() => clearTimeout(t));
      const html = res.ok ? (await res.text()).slice(0, 1_500_000) : '';
      if (!res.ok) result = res.status === 403 || res.status === 429 ? 'blocked' : 'gone';
      else if (r.type === 'link') result = own && new RegExp(`href=["'][^"']*${own.replace(/\./g, '\\.')}`, 'i').test(html) ? 'ok' : 'no-link';
      else result = (phone.length === 10 && digits(html).includes(phone)) || tokens(c.name).every((w) => html.toLowerCase().includes(w)) ? 'ok' : 'no-listing';
    } catch { result = 'unreachable'; }
    const status = result === 'ok' ? 'live' : result === 'blocked' || result === 'unreachable' ? r.status : 'lost';
    if (status === 'live') ok++; else if (status === 'lost') lost++;
    await run(env, 'UPDATE link_log SET status = ?, check_result = ?, checked_at = ? WHERE id = ?', status, result, now(), r.id);
  }));
  return json({ checked: rows.length, ok, lost });
});

// For the monthly report: citations and links that went live that month.
export async function linksForMonth(env, clientId, a, b) {
  const rows = await all(env, "SELECT type, name FROM link_log WHERE client_id = ? AND status = 'live' AND live_at >= ? AND live_at < ? ORDER BY live_at", clientId, a, b).catch(() => []);
  return { citations: rows.filter((r) => r.type === 'citation').map((r) => r.name), links: rows.filter((r) => r.type === 'link').map((r) => r.name) };
}

// ---------- prospects: the real inconsistencies, for the clarity call ----------
// The same directory check, run on a lead before or during the call: which directories list them, which show a different
// phone or ZIP, and which are missing. One Google search per directory (about $0.002 each), 15 directories, saved on the lead.
export function leadAsClient(lead, intel) {
  const L = intel?.listing || {};
  const address = L.address || [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ');
  return { name: lead.business, phone: lead.phone || L.phone || '', address, city: lead.city || L.city || '', state: lead.state || '', category: L.category || lead.category || lead.industry || '' };
}

route('POST', '/api/leads/:id/listings', async ({ env, user, params }) => {
  requireStaff(user);
  const lead = await first(env, 'SELECT * FROM leads WHERE id = ?', params.id);
  if (!lead) throw new HttpError('Lead not found.', 404);
  const intel = parse(lead.intel);
  const c = leadAsClient(lead, intel);
  if (!c.name) throw new HttpError('The lead needs a business name.');
  const dirs = directoryList({ name: c.name, address: c.address, city: c.city, state: c.state, category: c.category }).filter((d) => SITES[d.name]).slice(0, 15);
  let cost = 0;
  const results = await Promise.all(dirs.map(async (d) => {
    try {
      const r = await search(env, `site:${SITES[d.name]} "${c.name}"${c.city ? ` ${c.city}` : ''}`);
      cost += r.cost || 0;
      return { name: d.name, site: SITES[d.name], ...judgeListing(r.results, c) };
    } catch (e) { return { name: d.name, site: SITES[d.name], status: 'error', error: e.message }; }
  }));
  if (results.length && results.every((r) => r.status === 'error')) throw new HttpError(results[0].error, 502);
  const counts = results.reduce((o, r) => ({ ...o, [r.status]: (o[r.status] || 0) + 1 }), {});
  const out = { at: now(), counts, results, phone: c.phone, address: c.address, google: { phone: intel?.listing?.phone || null, address: intel?.listing?.address || null }, cost: Math.round(cost * 10000) / 10000, demo: isDemo(env) };
  await run(env, 'UPDATE leads SET listings = ?, updated_at = ? WHERE id = ?', JSON.stringify(out), now(), lead.id);
  return json(out);
});
