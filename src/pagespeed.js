// Mobile speed. First choice is Google PageSpeed Insights (free; PAGESPEED_KEY avoids the shared keyless quota, which runs out daily).
// When Google refuses (quota, outage) the scan tool falls back to our own page check, so the card always gives the rep something real.
import { HttpError } from './util.js';

const isQuota = (m) => /quota|RESOURCE_EXHAUSTED|rate limit|429/i.test(String(m || ''));

export async function pageSpeed(env, url, fetchImpl = fetch, { fallback = false } = {}) {
  const api = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  api.searchParams.set('url', url);
  api.searchParams.set('strategy', 'mobile');
  api.searchParams.set('category', 'performance');
  if (env.PAGESPEED_KEY) api.searchParams.set('key', env.PAGESPEED_KEY);

  let msg = '';
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetchImpl(api.toString());
      const data = await res.json().catch(() => null);
      if (res.ok && data?.lighthouseResult) {
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
      msg = data?.error?.message || `HTTP ${res.status}`;
    } catch (e) { msg = e.message; }
    if (isQuota(msg)) break; // a daily quota does not clear in a few seconds
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (fallback) {
    const basic = await quickCheck(url, fetchImpl).catch(() => null);
    if (basic) return { ...basic, googleError: isQuota(msg) ? (env.PAGESPEED_KEY ? 'Google speed test quota is used up for today.' : 'Google speed test is out of free tests for today. Add a PAGESPEED_KEY to get your own quota.') : msg };
  }
  const hint = isQuota(msg) && !env.PAGESPEED_KEY ? ' Add a PAGESPEED_KEY (free, Google Cloud, PageSpeed Insights API) so the Hub has its own quota instead of the shared one.' : '';
  throw new HttpError(`PageSpeed could not test that site: ${msg}${hint}`, 502);
}

// Our own check: what a phone has to download before the page can show. Not a Google score, so score stays null.
const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')) || [])[2] ?? (tag.match(new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`, 'i')) || [])[1] ?? null;
const has = (tag, name) => new RegExp(`\\s${name}(\\s|=|>|/)`, 'i').test(tag);

export async function quickCheck(url, fetchImpl = fetch) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  const t0 = Date.now();
  let res;
  try {
    res = await fetchImpl(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', accept: 'text/html', 'accept-encoding': 'gzip, br' } });
  } catch (e) { clearTimeout(timer); throw new HttpError('The site did not answer.', 502); }
  const ttfb = Date.now() - t0;
  const html = await res.text().catch(() => '');
  clearTimeout(timer);
  const total = Date.now() - t0;
  if (!res.ok && !html) throw new HttpError(`The site answered with ${res.status}.`, 502);
  const head = (html.match(/<head[\s\S]*?<\/head>/i) || [''])[0];
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
  const external = scripts.filter((s) => attr(s, 'src'));
  const blocking = [...head.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]).filter((s) => attr(s, 'src') && !has(s, 'async') && !has(s, 'defer') && !/type\s*=\s*["']module/i.test(s));
  const styles = [...html.matchAll(/<link\b[^>]*rel\s*=\s*["']?stylesheet[^>]*>/gi)];
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const noSize = imgs.filter((i) => !(has(i, 'width') && has(i, 'height')));
  const notLazy = imgs.slice(2).filter((i) => !/loading\s*=\s*["']?lazy/i.test(i));
  const viewport = /<meta[^>]+name\s*=\s*["']viewport["']/i.test(html);
  const htmlKb = Math.round(new TextEncoder().encode(html).length / 1024);
  const enc = res.headers.get('content-encoding') || '';
  const finalUrl = res.url || url;
  const notes = [];
  const add = (level, text) => notes.push({ level, text });
  if (!/^https:/i.test(finalUrl)) add('high', 'The site does not load over https. Phones show a "Not secure" warning.');
  if (!viewport) add('high', 'No mobile viewport tag, so phones show a tiny desktop page.');
  if (ttfb > 1800) add('high', `The server took ${(ttfb / 1000).toFixed(1)} seconds to start answering.`);
  else if (ttfb > 800) add('medium', `The server took ${(ttfb / 1000).toFixed(1)} seconds to start answering.`);
  if (blocking.length >= 3) add('high', `${blocking.length} scripts in the head stop the page from showing until they load.`);
  else if (blocking.length) add('medium', `${blocking.length} script${blocking.length === 1 ? '' : 's'} in the head hold up the first paint.`);
  if (external.length > 25) add('medium', `${external.length} script files load on the page.`);
  if (styles.length > 8) add('medium', `${styles.length} stylesheets load before the page can show.`);
  if (htmlKb > 300) add('medium', `The page code alone is ${htmlKb} KB.`);
  if (!enc && htmlKb > 30) add('medium', 'The page is not compressed (no gzip or brotli).');
  if (noSize.length >= 3) add('medium', `${noSize.length} images have no width and height, so the page jumps around as they load.`);
  if (notLazy.length >= 5) add('low', `${notLazy.length} images below the top load right away instead of when scrolled to.`);
  if (!notes.length) add('good', 'Nothing slows the first load down in the page code. Google\'s lab test may still find heavy images or scripts.');
  const bad = notes.filter((n) => n.level === 'high').length, mid = notes.filter((n) => n.level === 'medium').length;
  const verdict = bad ? 'Slow' : mid >= 2 ? 'Needs work' : mid ? 'Okay, with fixes' : 'Looks fine';
  return {
    url, basic: true, score: null, lcp: '', cls: '', tbt: '', speedIndex: '',
    verdict, ttfb, loadMs: total, htmlKb, scripts: external.length, blocking: blocking.length, styles: styles.length, images: imgs.length, notes,
  };
}
