// Client onboarding and day-one fulfillment: intake form, logo and photo uploads, baseline research,
// Google profile checklist, citation list, review target, 90 day plan, and before vs now.
import { HttpError, json } from './util.js';
import { all, first, run, newId, now, getSettings, setSetting } from './db.js';
import { requireStaff, requireClientAccess } from './auth.js';
import { route } from './router.js';
import { researchLead } from './intel.js';
import { findProblems } from '../public/js/leadintel.js';
import { citations, gbpChecklist, reviewTarget, ninetyDayPlan, compareIntel } from '../public/js/fulfill.js';

const MAX = 10 * 1024 * 1024;
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const text = (v, max = 2000) => (v == null ? null : String(v).replace(/\u0000/g, '').trim().slice(0, max) || null);

async function clientOr404(env, id) {
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', id);
  if (!c) throw new HttpError('Client not found.', 404);
  return c;
}

// The client record shaped like a lead, so the same research runs on it.
function asLead(c) {
  const [city, stateZip] = String(c.address || '').split(',').slice(-2).map((s) => s.trim());
  return { business: c.name, phone: c.phone, website: c.website, city: city || null, state: (stateZip || '').slice(0, 2) || null, industry: c.category, category: c.category, cid: c.cid, place_id: c.place_id, lat: c.lat, lng: c.lng };
}

route('GET', '/api/clients/:id/onboarding', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  const c = await clientOr404(env, params.id);
  const baseline = parse(c.baseline);
  const latest = parse((await getSettings(env))[`latest:${c.id}`]);
  const st = await getSettings(env);
  const done = parse(st[`onb:${c.id}`]) || {};
  const assets = await all(env, 'SELECT id, kind, name, media_type, created_at FROM assets WHERE client_id = ? ORDER BY created_at DESC LIMIT 200', c.id);
  const setup = await all(env, "SELECT id, title, status FROM tasks WHERE client_id = ? AND kind = 'setup' ORDER BY sort, created_at", c.id);
  const lead = asLead(c);
  return json({
    client: { id: c.id, name: c.name, plan: c.plan, start_date: c.start_date, logo: Boolean(c.logo_key) },
    intake: parse(c.intake) || {}, intakeAt: c.intake_at,
    baseline, latest, compare: compareIntel(baseline, latest),
    problems: findProblems(baseline, lead),
    gbp: gbpChecklist(latest || baseline).map((i) => ({ ...i, done: Boolean(done[`gbp:${i.key}`]) })),
    citations: citations({ ...c, ...lead }).map((i) => ({ ...i, status: done[`cit:${i.name}`] || null })),
    reviews: reviewTarget(latest || baseline),
    plan90: ninetyDayPlan(c.plan, baseline, lead),
    setup, assets,
  });
});

// Team checklist marks: Google profile items and citation status (listed, fixed, created, n/a).
route('PUT', '/api/clients/:id/onboarding/mark', async ({ env, user, params, body }) => {
  requireStaff(user);
  await clientOr404(env, params.id);
  const { key, value } = await body();
  if (!/^(gbp|cit):[\w .&'-]{1,80}$/.test(String(key || ''))) throw new HttpError('Unknown checklist item.');
  const st = await getSettings(env);
  const done = parse(st[`onb:${params.id}`]) || {};
  if (value == null || value === false || value === '') delete done[key]; else done[key] = typeof value === 'string' ? value.slice(0, 20) : true;
  await setSetting(env, `onb:${params.id}`, JSON.stringify(done));
  return json({ ok: true });
});

const INTAKE_FIELDS = ['legal_name', 'public_name', 'phone', 'email', 'address', 'service_area', 'hours', 'services', 'top_services', 'cities', 'description',
  'differentiators', 'avg_job', 'capacity', 'competitors', 'review_contact', 'gbp_access', 'website_access', 'website_login_note', 'facebook_access', 'analytics_access', 'brand_colors', 'notes'];

route('PUT', '/api/clients/:id/intake', async ({ env, user, params, body }) => {
  requireClientAccess(user, params.id);
  const c = await clientOr404(env, params.id);
  const b = await body();
  const prev = parse(c.intake) || {};
  const next = { ...prev };
  for (const f of INTAKE_FIELDS) if (f in b) next[f] = typeof b[f] === 'boolean' ? b[f] : text(b[f], f === 'description' ? 1200 : 1000);
  const done = Boolean(next.services && (next.cities || next.service_area));
  await run(env, `UPDATE clients SET intake = ?, intake_at = COALESCE(intake_at, ?), services = COALESCE(?, services), cities = COALESCE(?, cities),
    phone = COALESCE(phone, ?) WHERE id = ?`, JSON.stringify(next), done ? now() : null, next.services || null, next.cities || null, next.phone || null, c.id);
  await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', newId('l_'), c.id, 'Business details updated', now(), user.id);
  return json({ ok: true, intake: next });
});

route('POST', '/api/clients/:id/assets', async ({ env, user, params, request }) => {
  requireClientAccess(user, params.id);
  const c = await clientOr404(env, params.id);
  if (!env.MEDIA) throw new HttpError('Photo storage is not connected yet.', 503);
  let form;
  try { form = await request.formData(); } catch { throw new HttpError('Choose a file to upload.'); }
  const kind = ['logo', 'photo', 'doc'].includes(form.get('kind')) ? form.get('kind') : 'photo';
  const files = form.getAll('file').filter((f) => f && typeof f === 'object' && f.size);
  if (!files.length) throw new HttpError('Choose a file to upload.');
  if (files.length > 20) throw new HttpError('Upload up to 20 files at a time.');
  const ids = [];
  for (const f of files) {
    if (f.size > MAX) throw new HttpError(`${f.name} is too big (10 MB max).`);
    const type = f.type || 'application/octet-stream';
    if (!/^image\/|^application\/pdf$/.test(type)) throw new HttpError('Photos, logos, and PDFs only.');
    const id = newId('as_');
    const key = `assets/${c.id}/${id}.${(type.split('/')[1] || 'bin').replace('jpeg', 'jpg').replace('svg+xml', 'svg')}`;
    await env.MEDIA.put(key, new Uint8Array(await f.arrayBuffer()), { httpMetadata: { contentType: type } });
    await run(env, 'INSERT INTO assets (id, client_id, media_key, media_type, kind, name, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, c.id, key, type, kind, text(f.name, 120), user.id, now());
    if (kind === 'logo') await run(env, 'UPDATE clients SET logo_key = ? WHERE id = ?', key, c.id);
    ids.push(id);
  }
  await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', newId('l_'), c.id, `${ids.length} ${kind === 'logo' ? 'logo' : kind === 'doc' ? 'file' : 'photo'}${ids.length === 1 ? '' : 's'} uploaded`, now(), user.id);
  return json({ ok: true, ids });
});

route('GET', '/api/assets/:id', async ({ env, user, params, url }) => {
  const a = await first(env, 'SELECT * FROM assets WHERE id = ?', params.id);
  if (!a) throw new HttpError('Not found.', 404);
  requireClientAccess(user, a.client_id);
  const obj = await env.MEDIA?.get(a.media_key);
  if (!obj) throw new HttpError('Not found.', 404);
  const headers = { 'content-type': a.media_type || 'application/octet-stream', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' };
  if (/svg/.test(a.media_type || '') || url.searchParams.get('download')) headers['content-disposition'] = `attachment; filename="${(a.name || a.id).replace(/[^\w. -]/g, '')}"`;
  return new Response(obj.body, { headers });
});

route('DELETE', '/api/assets/:id', async ({ env, user, params }) => {
  requireStaff(user);
  const a = await first(env, 'SELECT * FROM assets WHERE id = ?', params.id);
  if (!a) throw new HttpError('Not found.', 404);
  await env.MEDIA?.delete(a.media_key);
  await run(env, 'DELETE FROM assets WHERE id = ?', a.id);
  return json({ ok: true });
});

// Run the research on the client. The first run becomes the baseline, later runs are "now".
route('POST', '/api/clients/:id/research', async ({ env, user, params }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  const intel = await researchLead(env, asLead(c), { gridSize: 3, radiusMiles: Number((await getSettings(env)).research_radius) || 2 });
  if (!c.baseline) {
    await run(env, 'UPDATE clients SET baseline = ?, cid = COALESCE(cid, ?), place_id = COALESCE(place_id, ?), lat = COALESCE(lat, ?), lng = COALESCE(lng, ?) WHERE id = ?',
      JSON.stringify(intel), intel.listing?.cid || null, intel.listing?.place_id || null, intel.listing?.lat ?? null, intel.listing?.lng ?? null, c.id);
  } else {
    await setSetting(env, `latest:${c.id}`, JSON.stringify(intel));
  }
  await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', newId('l_'), c.id, c.baseline ? 'Progress check run (rankings, reviews, site speed)' : 'Baseline audit saved', now(), user.id);
  return json({ ok: true, baseline: !c.baseline, intel });
});
