# Rightway Hub

Internal software for Rightway Growth LLC (local SEO agency, Hollywood FL). Owner: Vidal Newton (V), non-developer.
The full plan lives in the Claude Doc "Rightway Hub: Build Plan" (https://claude.ai/artifact/Av9b3D9P7ZosEPatp1ZcJJ).
Its "Package build-out" tab maps every package item to a Hub module and phase (2 to 9); follow that order.

## Status
- Phase 1, scan tool (`/scan.html`): built (v2). Grid ranks from Google Local Finder by default (matches BrightLocal's Local Search
  Grid), Google Maps optional. Logged-in staff skip the access key, and `?client=<id>` pre-loads a client and enables "Save to client".
- Phases 2 and 3 core (`/`, the Hub app): built. Logins (owner setup with ACCESS_KEY, invites by link, roles admin/team/client),
  agency dashboard (all clients, MRR, work done), client pages (overview + work log, monthly task engine from plan quotas, reviews,
  posts, rankings, profile, client logins), team page. Client app (phone-first PWA): home stats, review requests sent from the
  client's own phone (sms:/mailto:/share, tracked `/r/<token>` links), counter QR code (`/r/k/<clientId>`), photo-to-post with
  Google/Facebook/Instagram captions (Claude if ANTHROPIC_API_KEY, templates otherwise), approve flow, rankings view.
- CRM and sales (built): pipeline board (`#/pipeline`, drag and drop stages), lead details with call outcomes that apply the
  playbook cadence (`applyOutcome` in `src/crm.js`), CSV import with header matching and phone dedupe, power dialer (`#/dialer`,
  queue limited to 8am to 8pm in the lead's time zone, keys 1 to 9 log outcomes, "Call from my phone" tel: links, optional
  Twilio bridge in `src/calls.js` that rings the rep then the lead, recording off), website form endpoint `/api/public/lead`
  (CORS for rightwaygrowth.com, honeypot), e-signed work orders (`src/workorders.js`, public `/sign.html#<token>`), Stripe
  (`src/billing.js`: signed webhook auto-wins the lead, creates the client, sets billing status and MRR; payment links per plan
  in Settings tagged with client_reference_id; client Billing tab; Stripe customer portal from the client app).
- Sales intelligence (built): lead research (`src/intel.js`: Google profile match, 3x3 Local Finder grid, website parse, PageSpeed, about $0.04),
  scoring, problems, plan pick, and the adaptive call script in `public/js/leadintel.js` (pure, shared by Worker, app, tests). Dedupe on import by
  phone, website domain, and name plus city or zip (DNC stays out). Pipeline time zone tabs, filters, board or grouped list, bulk actions, merge.
  Dialer call prep panel with auto research ahead. Presentation mode `/present.html#<leadId>` (14 slides, presenter view via BroadcastChannel,
  sends the work order with a QR). Google Calendar and Meet (`src/google.js`, refresh token sealed with AES-GCM), public booking page `/book.html`.
- Texting and inbound calls (built, `src/sms.js`, `public/hub/texts.js`): Inbox page (`#/inbox`, unread badge), Texts on each lead and in the dialer,
  templates, delivery status with plain error text (30034 = A2P not approved yet). Consent gate: texts only to leads who checked the form box,
  texted first, or got "They said yes to texts" logged by the rep. STOP/START handled, first text adds brand and "Reply STOP to opt out",
  8am to 8pm their time unless replying within 12 hours of their text. Unknown numbers that text in become leads. Twilio webhooks:
  Voice `/api/twilio/voice` (rings the admin's saved mobile, missed call message, no recording), Messaging `/api/twilio/sms`,
  status `/api/twilio/sms-status`. Business number (305) 507-3393.
- Onboarding (built): first month tasks created on convert, lead research becomes the client baseline, Onboarding tab (before vs now, fix list,
  Google profile checklist, citations list with status, review target, 90 day plan, uploads), client app Get started page (intake form, access steps).
- GoHighLevel can be cancelled once the website form posts to the Hub (rw site change) and any GHL numbers to keep are ported.
- Not built yet: publishing to Google and Meta (needs Google Business Profile API approval and Meta app review; until then posts
  are copied and marked posted), scheduled monthly scans and reports (Phase 4), Google data connections (Phase 5), content engine
  (6), call tracking (7), citations/links tracker (8), Market Leader extras (9). Follow the Package build-out tab.
- We do not build automated posting for backlinks (Google link-scheme policy).

## Stack
- Cloudflare Worker (`src/worker.js`) serves `/api/*` and `/r/*`; static app in `public/` (plain ES modules, no build step, no deps).
  Hub API in `src/hub.js` plus feature modules that register routes in `src/router.js` (public routes skip the x-rw check), auth in `src/auth.js` (PBKDF2 100k, SHA-256 hashed session tokens in an HttpOnly
  cookie, every write must send header `x-rw: 1` as the CSRF guard), plans and quotas in `src/plans.js`, captions in `src/captions.js`.
- Data: Cloudflare D1 (`DB`, database rightway-hub) with tables created on first use (`src/db.js`); photos in R2 (`MEDIA`, bucket
  rightway-media). Both bound in `wrangler.jsonc`.
- Deployed by Cloudflare Workers Builds from this GitHub repo with `npx wrangler deploy`.
- DataForSEO live/advanced. Grid: Local Finder ($0.002 per 10 results, we read 20) or Maps ($0.002). Business search and
  competitor details: Maps. Local Finder field names are handled defensively (`organicListings`, name-match fallback).
- Map: our own tile renderer in `public/js/map.js` (OpenStreetMap tiles, attribution required). QR codes: `public/js/qr.js`
  (own encoder, verified with OpenCV).
- Secrets live in Cloudflare's Build "Variables and secrets" (V's setup). `scripts/bake-secrets.mjs` copies them into the deployed
  Worker; runtime dashboard secrets override. Keys: DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD, ACCESS_KEY, PAGESPEED_KEY,
  ANTHROPIC_API_KEY, ANTHROPIC_MODEL (default claude-haiku-4-5-20251001), RESEND_API_KEY, EMAIL_FROM, STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. Keep `src/runtime-secrets.js`
  committed empty. `/api/health` reports what is connected (booleans only).

## Commands
- `npm test` runs unit tests (node:test, no installs needed).
- `npm run local` serves the app at http://localhost:8787 with in-memory D1/R2 stand-ins (`test/shims.mjs`, node:sqlite) and demo
  scan data. Set ACCESS_KEY=... to test owner setup.

## Conventions
- User-facing copy: plain, short, no em dashes or en dashes. Brand: ink #0F1B17, mint #9DEBCB, mint strong #23B07E,
  accent #0A6B4C, line #DCE6E1. Fonts Outfit (display), Instrument Sans (body), JetBrains Mono.
- Escape every external string before putting it in HTML (`esc()` in `public/app.js`).
- Never commit secrets. Never use leads or data from V's former employer.
- Keep `public/js/grid.js` and `public/js/analysis.js` pure so they stay testable in Node.
