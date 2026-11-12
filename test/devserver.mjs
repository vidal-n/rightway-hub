// Local preview without Cloudflare: serves /public and routes /api/* to the Worker.
// Usage: node test/devserver.mjs [port]   (demo mode unless DATAFORSEO_LOGIN/PASSWORD are set)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/worker.js';
import { d1, r2 } from './shims.mjs';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const port = Number(process.argv[2] || 8787);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

// Stand-in for the Cloudflare static assets binding, so the Worker can serve the few files it gates (the pricing reference).
const assetFile = async (request) => {
  const rel = normalize(new URL(request.url).pathname).replace(/^(\.\.[/\\])+/, '');
  try { return new Response(await readFile(join(root, rel)), { headers: { 'content-type': types[extname(rel)] || 'application/octet-stream' } }); } catch { return new Response('Not found', { status: 404 }); }
};

const env = {
  ASSETS: { fetch: assetFile },
  DATAFORSEO_LOGIN: process.env.DATAFORSEO_LOGIN,
  DATAFORSEO_PASSWORD: process.env.DATAFORSEO_PASSWORD,
  ACCESS_KEY: process.env.ACCESS_KEY,
  PAGESPEED_KEY: process.env.PAGESPEED_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_FROM: process.env.TWILIO_FROM,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  GOOGLE_MAPS_KEY: process.env.GOOGLE_MAPS_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  // Local stand-ins for Cloudflare D1 and R2 (data lives in memory until the server stops).
  DB: process.env.NO_DB ? undefined : d1(process.env.DB_FILE || ':memory:'),
  MEDIA: process.env.NO_DB ? undefined : r2(),
};

// SEED_COSTS=1 fills the cost ledger with 40 days of sample spend so the Budget charts have something to draw.
if (process.env.SEED_COSTS && env.DB) {
  const { ensureSchema } = await import('../src/db.js');
  await ensureSchema(env);
  for (let i = 0; i < 40; i++) {
    const day = new Date(Date.now() - i * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const rows = [['dataforseo', 'grid (local finder)', (3 + ((i * 7) % 9)) * 0.45, 40 + ((i * 7) % 9) * 10], ['dataforseo', 'web search', 0.1 + (i % 4) * 0.05, 20], ['claude', 'Ask Claude', 0.08 + (i % 5) * 0.06, 6], ['claude', 'page drafts', i % 6 === 0 ? 0.42 : 0, 1]];
    for (const [v, k, usd, n] of rows) if (usd > 0) await env.DB.prepare('INSERT INTO cost_daily (day, vendor, kind, micro, n) VALUES (?, ?, ?, ?, ?)').bind(day, v, k, Math.round(usd * 1e6), n).run();
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/r/') || url.pathname.startsWith('/training/pricing/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const response = await worker.fetch(request, env);
    const headers = Object.fromEntries(response.headers);
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(root, rel));
    res.writeHead(200, { 'content-type': types[extname(rel)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(port, () => console.log(`Rightway Hub preview on http://localhost:${port}`));
