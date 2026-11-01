# Rightway Hub

Internal software for Rightway Growth LLC (local SEO agency, Hollywood FL). Owner: Vidal Newton (V), non-developer.
The full plan lives in the Claude Doc "Rightway Hub: Build Plan" (https://claude.ai/artifact/Av9b3D9P7ZosEPatp1ZcJJ).

## Status
- Phase 1, scan tool: built. Find a business, run a map grid scan for a keyword, competitor table, Google profile checklist,
  category gap, mobile speed test, "the math" calculator, print to PDF, save/load scan JSON.
- Next: Phase 2, agency dashboard and client portal (Supabase for database, logins, uploads). Then review engine (email),
  rank tracking + monthly report, analytics + call tracking, Google profile manager, citations/links/social.
- GoHighLevel stays for sales (pipeline, dialer, prospect emails). BrightLocal Citation Builder stays pay-as-you-go.

## Stack
- Cloudflare Worker (`src/worker.js`) serves `/api/*`; static app in `public/` (plain ES modules, no build step, no dependencies).
- Deployed by Cloudflare Workers Builds from this GitHub repo with `npx wrangler deploy`. Config: `wrangler.jsonc`.
- Data: DataForSEO Google Maps SERP live/advanced ($0.002 per request, one task per request). PageSpeed Insights for speed.
- Map: our own tile renderer in `public/js/map.js` (OpenStreetMap tiles, attribution required). No Leaflet.
- Secrets (Cloudflare dashboard only): `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `ACCESS_KEY`, optional `PAGESPEED_KEY`.
  Without DataForSEO secrets the API returns demo data (`src/mock.js`) and the UI shows a banner.
  With DataForSEO secrets the API refuses to run unless `ACCESS_KEY` is set, and every call must send `x-access-key`.

## Commands
- `npm test` runs unit tests (node:test, no installs needed).
- `npm run local` serves the app at http://localhost:8787 in demo mode (Node only, no wrangler needed).

## Conventions
- User-facing copy: plain, short, no em dashes or en dashes. Brand: ink #0F1B17, mint #9DEBCB, mint strong #23B07E,
  accent #0A6B4C, line #DCE6E1. Fonts Outfit (display), Instrument Sans (body), JetBrains Mono.
- Escape every external string before putting it in HTML (`esc()` in `public/app.js`).
- Never commit secrets. Never use leads or data from V's former employer.
- Keep `public/js/grid.js` and `public/js/analysis.js` pure so they stay testable in Node.
