// Google PageSpeed Insights, mobile. Free; PAGESPEED_KEY is optional but avoids shared rate limits.
import { HttpError } from './util.js';

export async function pageSpeed(env, url, fetchImpl = fetch) {
  const api = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  api.searchParams.set('url', url);
  api.searchParams.set('strategy', 'mobile');
  api.searchParams.set('category', 'performance');
  if (env.PAGESPEED_KEY) api.searchParams.set('key', env.PAGESPEED_KEY);

  const res = await fetchImpl(api.toString());
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.lighthouseResult) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new HttpError(`PageSpeed could not test that site: ${msg}`, 502);
  }
  const lh = data.lighthouseResult;
  const a = lh.audits || {};
  return {
    url,
    score: Math.round((lh.categories?.performance?.score ?? 0) * 100),
    lcp: a['largest-contentful-paint']?.displayValue || '',
    cls: a['cumulative-layout-shift']?.displayValue || '',
    tbt: a['total-blocking-time']?.displayValue || '',
    speedIndex: a['speed-index']?.displayValue || '',
  };
}
