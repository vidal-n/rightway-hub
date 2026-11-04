// The lead scrubber (our own Outscraper style cleanup). For each lead: clean the business name, check the phone (and its line type through
// Twilio Lookup when an owner turns it on, about $0.008 a number), read the website's home, contact and about pages for emails, social pages
// and the owner's name, check the email domain takes mail (DNS over HTTPS, free), then score how complete the data is. Runs on its own for
// new imports (a few per cron run, plus open pipeline pages nudging it along) and on demand for one lead or a selection.
import { HttpError, json } from './util.js';
import { all, first, run, now, getSettings, setSetting } from './db.js';
import { requireStaff, requireAdmin } from './auth.js';
import { route } from './router.js';
import { cleanName, phoneInfo, emailInfo, pickEmail, emailStatus, extractContacts, mergeContacts, contactLinks, dataScore } from '../public/js/scrub.js';

const UA = 'Mozilla/5.0 (compatible; RightwayHub/1.0; +https://rightwaygrowth.com)';
const OPEN = ['new', 'attempting', 'callback', 'follow_up', 'not_now', 'audit_requested', 'no_show'];

export async function scrubSettings(env) {
  const s = await getSettings(env);
  return { auto: s.scrub_auto !== '0', lookup: s.scrub_lookup === '1', twilio: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) };
}

async function fetchPage(url, fetchImpl) {
  let target;
  try { target = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); } catch { return { ok: false, error: 'Website address is not valid.' }; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetchImpl(target.toString(), { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'text/html' } });
    if (!res.ok) return { ok: false, status: res.status, url: res.url || target.toString(), error: res.status === 403 || res.status === 429 ? 'The site blocked our check.' : `The site returned an error (HTTP ${res.status}).` };
    return { ok: true, html: (await res.text()).slice(0, 1_500_000), url: res.url || target.toString() };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'The site took too long to load.' : 'The site did not respond.' };
  } finally { clearTimeout(timer); }
}

// Does the domain accept email? true, false, or null when we could not tell.
async function takesMail(domain, fetchImpl, cache) {
  if (cache.has(domain)) return cache.get(domain);
  let v = null;
  try {
    const r = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, { headers: { accept: 'application/dns-json' } });
    if (r.ok) { const d = await r.json(); v = d.Status === 3 ? false : Array.isArray(d.Answer) ? d.Answer.some((a) => a.type === 15) : false; }
  } catch { v = null; }
  cache.set(domain, v);
  return v;
}

// Mobile, landline or internet phone, from Twilio Lookup (line type intelligence).
async function lineType(env, e164, fetchImpl) {
  const r = await fetchImpl(`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}?Fields=line_type_intelligence`, {
    headers: { authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}` },
  });
  if (!r.ok) return null;
  const d = await r.json();
  const t = d.line_type_intelligence?.type;
  const type = t === 'mobile' ? 'mobile' : t === 'landline' ? 'landline' : /voip/i.test(t || '') ? 'voip' : t === 'tollFree' ? 'toll_free' : t ? String(t).slice(0, 20) : null;
  return type ? { type, carrier: String(d.line_type_intelligence?.carrier_name || '').slice(0, 80) || null } : null;
}

export async function scrubLead(env, lead, { fetchImpl = fetch, lookup = false } = {}) {
  const set = {};
  const report = { at: now() };
  // 1. The name the rep says on the call.
  const nm = cleanName(lead.business, { city: lead.city, state: lead.state });
  if (nm.changed) { set.business = nm.name; if (!lead.business_raw) set.business_raw = lead.business; }
  report.name = { raw: lead.business_raw || lead.business, clean: nm.name, changed: nm.changed };
  // 2. The phone.
  const ph = phoneInfo(lead.phone_digits || lead.phone);
  report.phone = ph;
  // 3. The website: home page, then up to two contact or about pages.
  let c = { emails: [], socials: {}, phones: [], owner: null, host: '' };
  if (lead.website) {
    const home = await fetchPage(lead.website, fetchImpl);
    report.site = { ok: home.ok, url: home.url || null, https: String(home.url || '').startsWith('https://'), error: home.error || null };
    if (home.ok) {
      c = extractContacts(home.html, home.url);
      for (const link of contactLinks(home.html, home.url).slice(0, 2)) {
        const pg = await fetchPage(link, fetchImpl);
        if (pg.ok) c = mergeContacts(c, extractContacts(pg.html, pg.url));
      }
    }
  }
  // 4. Emails: theirs and the site's, checked, best first.
  const cache = new Map();
  const emails = [...new Set([lead.email, ...c.emails].filter(Boolean).map((e) => String(e).toLowerCase()))].slice(0, 8).map((e) => emailInfo(e, c.host));
  for (const e of emails.filter((x) => x.ok).slice(0, 3)) e.mx = await takesMail(e.domain, fetchImpl, cache);
  const best = pickEmail(emails);
  report.emails = emails;
  report.socials = c.socials;
  report.owner = c.owner;
  report.sitePhones = c.phones;
  // 5. Line type (optional, paid).
  let lt = null;
  if (lookup && ph.valid && !ph.problem && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && !lead.phone_type) lt = await lineType(env, ph.e164, fetchImpl).catch(() => null);
  report.lookup = lt;
  // Save what we found. A rep's own entries are never overwritten.
  if (lt) { set.phone_type = lt.type; set.phone_carrier = lt.carrier; } else if (ph.kind === 'toll_free' || ph.kind === 'premium') set.phone_type = ph.kind;
  if (best && !lead.email) set.email = best.email;
  const chosen = lead.email ? emails.find((x) => x.email === String(lead.email).toLowerCase()) : best;
  set.email_status = emailStatus(chosen);
  if (c.owner) { set.owner_name = c.owner; if (!lead.contact_name) set.contact_name = c.owner; }
  if (Object.keys(c.socials).length) set.socials = JSON.stringify({ ...(safeJson(lead.socials) || {}), ...c.socials });
  if (report.site?.ok && report.site.url && lead.website && !/^https?:/i.test(lead.website)) set.website = report.site.url;
  const merged = { ...lead, ...set };
  const ds = dataScore(merged);
  Object.assign(set, { data_score: ds.score, scrub_data: JSON.stringify({ ...report, missing: ds.missing }), scrubbed_at: now(), scrub_queued: 0 });
  // Bad and toll free numbers leave the call queue with the reason, only if nobody has worked the lead yet.
  if (ph.problem && ['new', 'attempting'].includes(lead.stage) && !lead.scrub) Object.assign(set, { scrub: ph.problem, stage: 'lost', next_action: `Scrubbed: ${ph.problem}`, next_action_at: null });
  set.updated_at = now();
  const cols = Object.keys(set);
  await run(env, `UPDATE leads SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => set[k]), lead.id);
  return { ...report, data_score: ds.score, data_grade: ds.grade, missing: ds.missing, saved: set };
}
const safeJson = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

// Background: a few queued leads per run.
export async function scrubTick(env, max = 3, fetchImpl = fetch) {
  const cfg = await scrubSettings(env);
  let n = 0;
  while (n < max) {
    const lead = await first(env, `SELECT * FROM leads WHERE scrub_queued = 1 AND (scrub_tried IS NULL OR scrub_tried < ?) ORDER BY created_at DESC LIMIT 1`, now() - 3600e3);
    if (!lead) break;
    await run(env, 'UPDATE leads SET scrub_tried = ? WHERE id = ?', now(), lead.id);
    try { await scrubLead(env, lead, { fetchImpl, lookup: cfg.lookup }); } catch (e) { console.error('scrub', lead.id, e.message); await run(env, 'UPDATE leads SET scrub_queued = 0 WHERE id = ?', lead.id); }
    n++;
  }
  return n;
}

// New leads: the name is cleaned right away (free), the rest is queued when automatic scrubbing is on.
export function cleanNewLead(data) {
  if (!data?.business) return data;
  const nm = cleanName(data.business, { city: data.city, state: data.state });
  return nm.changed ? { ...data, business: nm.name, business_raw: data.business } : data;
}
export async function queueScrub(env, ids) {
  if (!ids?.length || !(await scrubSettings(env)).auto) return 0;
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    await run(env, `UPDATE leads SET scrub_queued = 1 WHERE id IN (${part.map(() => '?').join(',')}) AND scrubbed_at IS NULL`, ...part);
  }
  return ids.length;
}

route('POST', '/api/leads/:id/scrub', async ({ env, user, params }) => {
  requireStaff(user);
  const lead = await first(env, 'SELECT * FROM leads WHERE id = ?', params.id);
  if (!lead) throw new HttpError('Lead not found.', 404);
  const cfg = await scrubSettings(env);
  const r = await scrubLead(env, lead, { lookup: cfg.lookup });
  return json({ ok: true, scrub: r, lead: await first(env, 'SELECT id, business, business_raw, contact_name, email, email_status, owner_name, phone_type, phone_carrier, socials, data_score, website, stage, scrub FROM leads WHERE id = ?', lead.id) });
});

// Queue a selection (anyone on the team), or every open lead not scrubbed yet (owners).
route('POST', '/api/scrub/queue', async ({ env, user, body }) => {
  requireStaff(user);
  const b = await body();
  let n = 0;
  if (Array.isArray(b.ids) && b.ids.length) {
    const ids = b.ids.slice(0, 5000);
    for (let i = 0; i < ids.length; i += 200) {
      const part = ids.slice(i, i + 200);
      await run(env, `UPDATE leads SET scrub_queued = 1, scrub_tried = NULL WHERE id IN (${part.map(() => '?').join(',')})`, ...part);
    }
    n = ids.length;
  } else if (b.all) {
    requireAdmin(user);
    const r = await all(env, `SELECT id FROM leads WHERE scrubbed_at IS NULL AND dnc = 0 AND stage IN (${OPEN.map(() => '?').join(',')}) LIMIT 5000`, ...OPEN);
    for (let i = 0; i < r.length; i += 200) {
      const part = r.slice(i, i + 200).map((x) => x.id);
      await run(env, `UPDATE leads SET scrub_queued = 1, scrub_tried = NULL WHERE id IN (${part.map(() => '?').join(',')})`, ...part);
    }
    n = r.length;
  } else throw new HttpError('Pick some leads first.');
  return json({ ok: true, queued: n });
});

route('POST', '/api/scrub/tick', async ({ env, user }) => {
  requireStaff(user);
  const done = await scrubTick(env, 2);
  return json({ done, ...(await scrubStatus(env)) });
});

async function scrubStatus(env) {
  const q = await first(env, 'SELECT COUNT(*) AS n FROM leads WHERE scrub_queued = 1');
  const d = await first(env, 'SELECT COUNT(*) AS n FROM leads WHERE scrubbed_at IS NOT NULL');
  const open = await first(env, `SELECT COUNT(*) AS n FROM leads WHERE scrubbed_at IS NULL AND dnc = 0 AND stage IN (${OPEN.map(() => '?').join(',')})`, ...OPEN);
  return { queued: q?.n || 0, scrubbed: d?.n || 0, notYet: open?.n || 0 };
}
route('GET', '/api/scrub/status', async ({ env, user }) => {
  requireStaff(user);
  return json({ ...(await scrubSettings(env)), ...(await scrubStatus(env)) });
});
route('PUT', '/api/scrub/settings', async ({ env, user, body }) => {
  requireAdmin(user);
  const b = await body();
  if ('auto' in b) await setSetting(env, 'scrub_auto', b.auto ? '1' : '0');
  if ('lookup' in b) await setSetting(env, 'scrub_lookup', b.lookup ? '1' : '0');
  return json(await scrubSettings(env));
});
