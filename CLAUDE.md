# Rightway Hub

Internal software for Rightway Growth LLC (local SEO agency, Hollywood FL). Owner: Vidal Newton (V), non-developer.
The full plan lives in the Claude Doc "Rightway Hub: Build Plan" (https://claude.ai/artifact/Av9b3D9P7ZosEPatp1ZcJJ).
Its "Package build-out" tab maps every package item to a Hub module and phase (2 to 9); follow that order.

## Status
- Phase 1, scan tool: built (v2). Grid ranks from Google Local Finder by default (matches BrightLocal's Local Search Grid),
  Google Maps optional. Report: hero stats, clickable points ("from this spot" top 10), competitor map view, heat map,
  findings + fix-first list, share-of-local-voice leaderboard, head-to-head (details via Maps lookup), profile checklist,
  category gap, mobile speed, plan math, print to PDF, save/load scan JSON. Light and dark themes.
- Next: Phase 2, agency dashboard and client portal (Supabase for database, logins, uploads). Then review engine (email),
  rank tracking + monthly report, analytics + call tracking, Google profile manager, citations/links/social.
- GoHighLevel stays for sales (pipeline, dialer, prospect emails). BrightLocal Citation Builder stays pay-as-you-go.

## Stack
- Cloudflare Worker (`src/worker.js`) serves `/api/*`; static app in `public/` (plain ES modules, no build step, no dependencies).
- Deployed by Cloudflare Workers Builds from this GitHub repo with `npx wrangler deploy`. Config: `wrangler.jsonc`.
- Data: DataForSEO live/advanced. Grid: Local Finder ($0.002 per 10 results, we read 20) or Maps ($0.002). Business search and
  competitor details: Maps. PageSpeed Insights for speed. Local Finder response field names are handled defensively
  (`organicListings`, name-match fallback); verify against real responses if ranks look wrong.
- Map: our own tile renderer in `public/js/map.js` (OpenStreetMap tiles, attribution required). No Leaflet.
- Secrets (Cloudflare dashboard only): `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `ACCESS_KEY`, optional `PAGESPEED_KEY`.
  Without DataForSEO secrets the API returns demo data (`src/mock.js`) and the UI shows a banner.
  With DataForSEO secrets the API refuses to run unless `ACCESS_KEY` is set, and every call must send `x-access-key`.
  V's secrets live in Cloudflare's Build "Variables and secrets". `scripts/bake-secrets.mjs` (wrangler custom build) copies them
  into `src/runtime-secrets.js` inside the deployed Worker; runtime dashboard secrets override them. Keep the committed file empty.
  `/api/health` reports which secrets exist (booleans only).

## Commands
- `npm test` runs unit tests (node:test, no installs needed).
- `npm run local` serves the app at http://localhost:8787 in demo mode (Node only, no wrangler needed).

## Conventions
- User-facing copy: plain, short, no em dashes or en dashes. Brand: ink #0F1B17, mint #9DEBCB, mint strong #23B07E,
  accent #0A6B4C, line #DCE6E1. Fonts Outfit (display), Instrument Sans (body), JetBrains Mono.
- Escape every external string before putting it in HTML (`esc()` in `public/app.js`).
- Never commit secrets. Never use leads or data from V's former employer.
- Keep `public/js/grid.js` and `public/js/analysis.js` pure so they stay testable in Node.
