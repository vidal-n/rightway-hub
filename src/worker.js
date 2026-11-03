// Rightway Hub API. Static files in /public are served by Cloudflare before this runs;
// anything under /api/ lands here.
import { searchBusinesses, rankAtPoint, businessDetails } from './dataforseo.js';
import { pageSpeed } from './pagespeed.js';
import { mockSearch, mockRank, mockPageSpeed, mockDetails } from './mock.js';
import { HttpError, json, validateGridPoint, validateSearch, validateUrl, validateDetails, keyMatches } from './util.js';
import baked from './runtime-secrets.js';
import { handleHub, handleReviewRedirect } from './hub.js';
import { ensureSchema } from './db.js';
import { currentUser, isStaff } from './auth.js';
import { autoScanTick } from './autoscan.js';
import { auditTick, enqueueDueAudits } from './siteaudit.js';

// Runtime secrets (dashboard) win; build-time secrets fill any gaps.
export function withSecrets(env, extra = baked) {
  const out = { ...env };
  for (const [k, v] of Object.entries(extra || {})) if (!out[k]) out[k] = v;
  return out;
}

export default {
  // Cron trigger (every minute): work on the automatic scan queue.
  async scheduled(_event, rawEnv, ctx) {
    const env = withSecrets(rawEnv || {});
    if (!env.DB) return;
    ctx.waitUntil((async () => {
      await ensureSchema(env);
      // Scans first, then website crawls with what is left of the ~50 outside requests a run may make.
      const used = await autoScanTick(env).catch((e) => { console.error('autoscan', e); return 40; });
      await enqueueDueAudits(env).catch((e) => console.error('audit queue', e));
      if (used < 30) await auditTick(env, { budget: Math.min(15, 40 - used) }).catch((e) => console.error('audit', e));
    })());
  },
  async fetch(request, rawEnv) {
    const env = withSecrets(rawEnv || {});
    const url = new URL(request.url);
    if (url.pathname.startsWith('/r/')) {
      try {
        const r = await handleReviewRedirect(request, env, url);
        if (r) return r;
      } catch (err) {
        console.error(err);
        return new Response('Something went wrong with this link.', { status: 500 });
      }
    }
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }
    try {
      const hub = await handleHub(request, env, url);
      if (hub) return hub;
      const runtimeKeys = Object.keys(rawEnv || {}).filter((k) => typeof rawEnv[k] === 'string' && rawEnv[k]);
      return await handleApi(request, env, url, runtimeKeys);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      return json({ error: err.message || 'Server error' }, status);
    }
  },
};

// A logged-in Rightway team member can use the scan tool without typing the access key.
async function staffSession(request, env) {
  if (!env.DB) return false;
  try {
    await ensureSchema(env);
    return isStaff(await currentUser(env, request));
  } catch {
    return false;
  }
}

export function isDemo(env) {
  return !env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD;
}

async function handleApi(request, env, url, runtimeKeys = []) {
  const demo = isDemo(env);

  if (url.pathname === '/api/health') {
    // Booleans only, never the values. Shows which secrets the running app can see.
    return json({
      ok: true,
      demo,
      keyRequired: Boolean(env.ACCESS_KEY),
      db: Boolean(env.DB),
      media: Boolean(env.MEDIA),
      ai: Boolean(env.ANTHROPIC_API_KEY),
      email: Boolean(env.RESEND_API_KEY),
      secrets: {
        DATAFORSEO_LOGIN: Boolean(env.DATAFORSEO_LOGIN),
        DATAFORSEO_PASSWORD: Boolean(env.DATAFORSEO_PASSWORD),
        ACCESS_KEY: Boolean(env.ACCESS_KEY),
      },
      fromBuild: Object.keys(baked),
      fromRuntime: runtimeKeys,
    });
  }

  // Real scans spend money, so they never run without an access key.
  if (!demo && !env.ACCESS_KEY) {
    throw new HttpError('Server is missing ACCESS_KEY. Add it in Cloudflare before running real scans.', 503);
  }
  if (env.ACCESS_KEY && !keyMatches(request.headers.get('x-access-key'), env.ACCESS_KEY) && !(await staffSession(request, env))) {
    throw new HttpError('Wrong or missing access key.', 401);
  }
  if (request.method !== 'POST') throw new HttpError('Use POST.', 405);
  if (url.pathname === '/api/check-key') return json({ ok: true, demo });

  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError('Request body must be JSON.', 400);
  }

  switch (url.pathname) {
    case '/api/business-search': {
      const q = validateSearch(body);
      return json({ demo, ...(demo ? mockSearch(q) : await searchBusinesses(env, q)) });
    }
    case '/api/grid-point': {
      const q = validateGridPoint(body);
      return json({ demo, ...(demo ? mockRank(q) : await rankAtPoint(env, q)) });
    }
    case '/api/details': {
      const q = validateDetails(body);
      return json({ demo, ...(demo ? mockDetails(q) : await businessDetails(env, q)) });
    }
    case '/api/pagespeed': {
      const target = validateUrl(body.url);
      return json({ demo, ...(demo ? mockPageSpeed(target) : await pageSpeed(env, target)) });
    }
    default:
      throw new HttpError('Not found.', 404);
  }
}
