// Phase 5: Google Business Profile through Google's APIs, with the Google sign-in the Hub already has (scope business.manage).
// Link a client to its profile, then from the Hub: publish posts and photos, read and reply to reviews, edit the description,
// phone and website, and read calls, direction requests, website clicks and views (Business Profile Performance API).
// Google must approve API access for the Cloud project first (the GBP API access form); until then calls fail with a clear message.
import { HttpError, json } from './util.js';
import { first, run, newId, now } from './db.js';
import { requireStaff, requireClientAccess } from './auth.js';
import { route } from './router.js';
import { googleReady } from './google.js';
import { userFor, gfetch } from './googleapps.js';
import { markAccess } from './work.js';

const INFO = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const ACCT = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const V4 = 'https://mybusiness.googleapis.com/v4';
const PERF = 'https://businessprofileperformance.googleapis.com/v1';
const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
export const METRICS = {
  CALL_CLICKS: 'calls', WEBSITE_CLICKS: 'website', BUSINESS_DIRECTION_REQUESTS: 'directions',
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: 'views', BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 'views', BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 'views', BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 'views',
};
const text = (v, max = 1500) => (v == null ? null : String(v).replace(/\u0000/g, '').trim().slice(0, max) || null);

async function g(env, user, url, opts = {}) {
  const row = await userFor(env, user || { id: null }, 'gbp');
  try { return await gfetch(env, row, url, { label: 'Google Business Profile', ...opts }); } catch (e) {
    if (/has not been used|is disabled|quota|PERMISSION_DENIED|403/i.test(e.message)) {
      throw new HttpError(`${e.message}. Google Business Profile API access must be approved for the Hub's Google Cloud project, and the APIs turned on.`, 400);
    }
    throw e;
  }
}

async function clientOr404(env, id) {
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', id);
  if (!c) throw new HttpError('Client not found.', 404);
  return c;
}
function linked(c) {
  if (!c.gbp_location || !c.gbp_account) throw new HttpError('Link this client to its Google profile first (Google profile tab).');
  return { loc: c.gbp_location, v4: `${c.gbp_account}/${c.gbp_location}` };
}

// ---------- signed photo links Google can fetch ----------
async function sign(env, s) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`rw-media:${env.ACCESS_KEY || env.GOOGLE_CLIENT_SECRET || 'rightway'}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(s)));
  return [...mac.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function signedMediaUrl(env, origin, kind, id, ttl = 6 * 3600e3) {
  const exp = now() + ttl;
  return `${origin}/api/public/m/${kind}/${id}/${exp}/${await sign(env, `${kind}:${id}:${exp}`)}`;
}
route('GET', '/api/public/m/:kind/:id/:exp/:sig', async ({ env, params }) => {
  if (Number(params.exp) < now() || params.sig !== await sign(env, `${params.kind}:${params.id}:${params.exp}`)) throw new HttpError('This link expired.', 403);
  const row = params.kind === 'post' ? await first(env, 'SELECT media_key, media_type FROM posts WHERE id = ?', params.id)
    : params.kind === 'asset' ? await first(env, 'SELECT media_key, media_type FROM assets WHERE id = ?', params.id) : null;
  const obj = row?.media_key && env.MEDIA ? await env.MEDIA.get(row.media_key) : null;
  if (!obj) throw new HttpError('Not found.', 404);
  return new Response(obj.body, { headers: { 'content-type': row.media_type || 'image/jpeg', 'cache-control': 'public, max-age=3600' } });
}, { public: true });

// ---------- reading ----------
const ymd = (t) => { const d = new Date(t); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }; };
export function sumMetrics(resp) {
  const out = { calls: 0, website: 0, directions: 0, views: 0 };
  for (const block of resp?.multiDailyMetricTimeSeries || []) {
    for (const s of block.dailyMetricTimeSeries || []) {
      const k = METRICS[s.dailyMetric];
      if (!k) continue;
      for (const v of s.timeSeries?.datedValues || []) out[k] += Number(v.value || 0);
    }
  }
  return out;
}
export async function gbpMetrics(env, user, c, from, to) {
  const { loc } = linked(c);
  const q = new URLSearchParams();
  for (const m of Object.keys(METRICS)) q.append('dailyMetrics', m);
  const a = ymd(from), b = ymd(to - 864e5);
  for (const [k, v] of Object.entries({ startDate: a, endDate: b })) for (const [p, n] of Object.entries(v)) q.set(`dailyRange.${k}.${p}`, String(n));
  return sumMetrics(await g(env, user, `${PERF}/${loc}:fetchMultiDailyMetricsTimeSeries?${q}`));
}

export function reviewOut(r) {
  return {
    id: r.reviewId, name: r.name, who: r.reviewer?.displayName || 'A Google user', stars: STARS[r.starRating] || null, text: r.comment || '',
    at: Date.parse(r.createTime || r.updateTime || '') || null, reply: r.reviewReply?.comment || null, replyAt: Date.parse(r.reviewReply?.updateTime || '') || null,
  };
}

export function profileChecks(p) {
  const out = [];
  const add = (key, label, ok, fix) => out.push({ key, label, ok: Boolean(ok), fix });
  add('description', 'Description (250+ characters)', (p.profile?.description || '').length >= 250, 'Write what they do, the main services and the area served.');
  add('categories', 'Secondary categories', (p.categories?.additionalCategories || []).length > 0, 'Add the secondary categories the top 10 use, where they match real services.');
  add('website', 'Website', p.websiteUri, 'Link the main website (or the city page for a location).');
  add('phone', 'Phone', p.phoneNumbers?.primaryPhone, 'Add the main phone (the tracking number, with their own line as an additional number).');
  add('hours', 'Hours', p.regularHours?.periods?.length, 'Add business hours so Google does not show them as closed.');
  add('area', 'Address or service area', p.storefrontAddress?.addressLines?.length || p.serviceArea?.places?.placeInfos?.length, 'Set the service area cities, or the shop address if customers visit.');
  return out;
}

// ---------- routes ----------
route('GET', '/api/gbp/locations', async ({ env, user }) => {
  requireStaff(user);
  const accts = await g(env, user, `${ACCT}/accounts?pageSize=20`);
  const out = [];
  for (const a of (accts.accounts || []).slice(0, 10)) {
    const r = await g(env, user, `${INFO}/${a.name}/locations?pageSize=100&readMask=name,title,storefrontAddress,phoneNumbers,websiteUri`).catch(() => ({ locations: [] }));
    for (const l of r.locations || []) {
      out.push({ account: a.name, accountName: a.accountName || '', location: l.name, title: l.title, address: (l.storefrontAddress?.addressLines || []).concat(l.storefrontAddress?.locality || []).join(', '), phone: l.phoneNumbers?.primaryPhone || '', website: l.websiteUri || '' });
    }
  }
  return json({ locations: out });
});

route('PUT', '/api/clients/:id/gbp', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  const b = await body();
  if (!b.location) {
    await run(env, 'UPDATE clients SET gbp_account = NULL, gbp_location = NULL, gbp_title = NULL WHERE id = ?', c.id);
    return json({ ok: true, linked: false });
  }
  if (!/^accounts\/\d+$/.test(b.account || '') || !/^locations\/\d+$/.test(b.location)) throw new HttpError('Pick a profile from the list.');
  await run(env, 'UPDATE clients SET gbp_account = ?, gbp_location = ?, gbp_title = ? WHERE id = ?', b.account, b.location, text(b.title, 160), c.id);
  await markAccess(env, c.id, 'gbp', 'granted', user.id);
  await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', newId('l_'), c.id, 'Google profile connected to the Hub', now(), user.id);
  return json({ ok: true, linked: true });
});

route('GET', '/api/clients/:id/gbp', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  const c = await clientOr404(env, params.id);
  const base = { ready: googleReady(env), linked: Boolean(c.gbp_location), title: c.gbp_title || null };
  if (!c.gbp_location || user.role === 'client') return json(base);
  const { loc, v4 } = linked(c);
  const errors = {};
  const tryIt = async (k, fn) => { try { return await fn(); } catch (e) { errors[k] = e.message; return null; } };
  const t = now();
  const [profile, perf, prev, reviews] = await Promise.all([
    tryIt('profile', () => g(env, user, `${INFO}/${loc}?readMask=name,title,phoneNumbers,websiteUri,categories,profile,regularHours,storefrontAddress,serviceArea,metadata`)),
    tryIt('metrics', () => gbpMetrics(env, user, c, t - 30 * 864e5, t)),
    tryIt('metrics', () => gbpMetrics(env, user, c, t - 60 * 864e5, t - 30 * 864e5)),
    tryIt('reviews', () => g(env, user, `${V4}/${v4}/reviews?pageSize=50&orderBy=${encodeURIComponent('updateTime desc')}`)),
  ]);
  return json({
    ...base,
    profile: profile ? {
      title: profile.title, phone: profile.phoneNumbers?.primaryPhone || '', website: profile.websiteUri || '', description: profile.profile?.description || '',
      category: profile.categories?.primaryCategory?.displayName || '', extraCategories: (profile.categories?.additionalCategories || []).map((x) => x.displayName),
      mapsUrl: profile.metadata?.mapsUri || null, reviewUrl: profile.metadata?.newReviewUri || null, checks: profileChecks(profile),
    } : null,
    metrics: perf ? { last30: perf, prev30: prev } : null,
    reviews: reviews ? { average: reviews.averageRating ?? null, total: reviews.totalReviewCount ?? null, list: (reviews.reviews || []).map(reviewOut) } : null,
    errors,
  });
});

route('PATCH', '/api/clients/:id/gbp/profile', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  const { loc } = linked(c);
  const b = await body();
  const mask = [];
  const patch = {};
  if ('description' in b) {
    const d = String(b.description || '').trim();
    if (d.length > 750) throw new HttpError('Google allows 750 characters in the description.');
    patch.profile = { description: d }; mask.push('profile.description');
  }
  if ('website' in b) {
    if (b.website && !/^https?:\/\//.test(b.website)) throw new HttpError('The website must start with https://');
    patch.websiteUri = b.website || ''; mask.push('websiteUri');
  }
  if ('phone' in b) { patch.phoneNumbers = { primaryPhone: String(b.phone || '').trim() }; mask.push('phoneNumbers.primaryPhone'); }
  if (!mask.length) throw new HttpError('Nothing to change.');
  await g(env, user, `${INFO}/${loc}?updateMask=${encodeURIComponent(mask.join(','))}`, { method: 'PATCH', body: patch });
  await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', newId('l_'), c.id, `Google profile updated: ${mask.map((m) => m.split('.').pop().replace('Uri', '').replace('primaryPhone', 'phone')).join(', ')}`, now(), user.id);
  return json({ ok: true });
});

// Publish a Hub post (photo plus Google caption) to the profile. Marks it posted and closes a post task with the live link.
route('POST', '/api/posts/:id/gbp', async ({ env, user, params, url }) => {
  requireStaff(user);
  const p = await first(env, 'SELECT * FROM posts WHERE id = ?', params.id);
  if (!p) throw new HttpError('Post not found.', 404);
  const c = await clientOr404(env, p.client_id);
  const { v4 } = linked(c);
  if (!p.google_text) throw new HttpError('Write the Google caption first.');
  const post = { languageCode: 'en-US', summary: p.google_text.slice(0, 1500), topicType: 'STANDARD', callToAction: c.phone ? { actionType: 'CALL' } : c.website ? { actionType: 'LEARN_MORE', url: c.website } : undefined };
  if (p.media_key) post.media = [{ mediaFormat: 'PHOTO', sourceUrl: await signedMediaUrl(env, url.origin, 'post', p.id) }];
  const res = await g(env, user, `${V4}/${v4}/localPosts`, { method: 'POST', body: post });
  const live = res.searchUrl || null;
  await run(env, "UPDATE posts SET status = 'posted', posted_at = ?, gbp_name = ?, live_url = COALESCE(?, live_url) WHERE id = ?", now(), res.name || null, live, p.id);
  const { closePostTask } = await import('./hub.js');
  if (p.status !== 'posted') await closePostTask(env, p, live, user.id);
  await run(env, 'INSERT INTO log (id, client_id, text, link, at, by) VALUES (?, ?, ?, ?, ?, ?)', newId('l_'), c.id, 'Google profile post published', live, now(), user.id);
  return json({ ok: true, url: live, state: res.state || null });
});

// Upload a client photo (from Onboarding uploads) to the profile.
route('POST', '/api/clients/:id/gbp/photos', async ({ env, user, params, body, url }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  const { v4 } = linked(c);
  const ids = (await body()).assets;
  const list = (Array.isArray(ids) ? ids : []).slice(0, 10);
  if (!list.length) throw new HttpError('Pick photos to upload.');
  let done = 0;
  const errors = [];
  for (const id of list) {
    const a = await first(env, "SELECT id, media_type FROM assets WHERE id = ? AND client_id = ? AND media_type LIKE 'image/%'", id, c.id);
    if (!a) continue;
    try {
      await g(env, user, `${V4}/${v4}/media`, { method: 'POST', body: { mediaFormat: 'PHOTO', locationAssociation: { category: 'ADDITIONAL' }, sourceUrl: await signedMediaUrl(env, url.origin, 'asset', a.id) } });
      done += 1;
    } catch (e) { errors.push(e.message); }
  }
  if (done) await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', newId('l_'), c.id, `${done} photo${done === 1 ? '' : 's'} added to the Google profile`, now(), user.id);
  return json({ uploaded: done, errors: errors.slice(0, 3) });
});

route('PUT', '/api/clients/:id/gbp/reviews/:reviewId/reply', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  const { v4 } = linked(c);
  const comment = text((await body()).comment, 4000);
  if (!comment) throw new HttpError('Write the reply first.');
  if (!/^[\w-]+$/.test(params.reviewId)) throw new HttpError('Unknown review.');
  await g(env, user, `${V4}/${v4}/reviews/${params.reviewId}/reply`, { method: 'PUT', body: { comment } });
  await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', newId('l_'), c.id, 'Replied to a Google review', now(), user.id);
  return json({ ok: true });
});

// ---------- review reply drafts (with or without the API) ----------
export function replyTemplate({ name, stars, business, phone }) {
  const first = String(name || '').trim().split(/\s+/)[0];
  const hi = first && !/google user/i.test(name) ? `${first}, ` : '';
  const call = phone ? ` at ${phone}` : '';
  if (stars >= 4) return `${hi ? `Thank you, ${first}!` : 'Thank you!'} We really appreciate you choosing ${business} and taking the time to share this. We are here whenever you need us again.`;
  if (stars === 3) return `${hi}thank you for the honest feedback. We want every job to be a five star experience, so we would like to hear what we could have done better. Please give us a call${call}.`;
  return `${hi}we are sorry about your experience. This is not the standard we hold ourselves to, and we would like to make it right. Please call us${call} so we can look into it directly.`;
}

route('POST', '/api/clients/:id/review-reply', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = await clientOr404(env, params.id);
  const b = await body();
  const stars = Math.min(5, Math.max(1, Number(b.stars) || 5));
  const fallback = replyTemplate({ name: b.name, stars, business: c.name, phone: c.phone });
  if (!env.ANTHROPIC_API_KEY || !b.text) return json({ reply: fallback, ai: false });
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 300,
        system: `You write short owner replies to Google reviews for ${c.name}${c.category ? ` (${c.category})` : ''}${c.cities ? ` serving ${c.cities}` : ''}. 2 to 4 sentences, warm and plain, first person plural. Use the reviewer's first name if given. For 3 stars or less: apologize without arguing and invite them to call${c.phone ? ` ${c.phone}` : ''}. Never offer discounts or anything for reviews. Never invent facts. No dashes, no emojis, no hashtags. Reply with the text only.`,
        messages: [{ role: 'user', content: `Reviewer: ${String(b.name || 'unknown').slice(0, 80)}\nStars: ${stars}\nReview: ${String(b.text).slice(0, 1500)}` }],
      }),
    });
    const d = await res.json();
    const reply = String(d.content?.[0]?.text || '').replace(/[–—]/g, ',').trim();
    return json({ reply: reply || fallback, ai: Boolean(reply) });
  } catch { return json({ reply: fallback, ai: false }); }
});
