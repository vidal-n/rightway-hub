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
- Team home and client view (built): Dashboard at `#/` (today's dials, meetings, callbacks due, pipeline, deals, clients; `GET /api/dashboard`),
  Clients list moved to `#/clients`. Client view `#/clientview/<id>` shows the client app in a phone frame via `/?as=<clientId>`; the `x-view-as`
  header makes the server treat a staff request as that client, GET only (writes return 403). Sample client (`src/sample.js`, `clients.sample = 1`,
  POST/DELETE `/api/sample-client`) with tasks, reviews, posts, 6 scans, onboarding; left out of revenue and work totals. Phone menu: hamburger
  drawer under 900px with iPhone safe-area padding; the scan tool has its own menu toggle.
- Browser phone (built, `src/voice.js`, `public/hub/phone.js`, SDK vendored at `public/vendor/twilio-voice-2.18.5.min.js` from twilio/twilio-voice.js dist):
  calls go out and come in through the computer's mic and speakers. `GET /api/voice/token` returns a Twilio access token; the first owner request
  creates a Twilio API key and TwiML App (Voice URL `/api/twilio/client-voice`) and stores them in settings `voice_cfg` (secret sealed with AES-GCM
  keyed on the auth token). Optional env overrides TWILIO_API_KEY, TWILIO_API_SECRET, TWILIO_TWIML_APP_SID. `POST /api/voice/prepare` validates
  (DNC, US only, no 900/976, lead calling hours, caller ID on the account) and logs the activity with to_num/from_num; the webhook only dials a
  call prepared by the same rep (identity `rw_<userId>`) within 2 minutes, answerOnBridge so ringing is heard, recording off. Floating call bar
  (ringing, timer, mute, keypad DTMF, hang up, mic level) survives navigation. Inbound `/api/twilio/voice` rings every staff browser (<Client>)
  plus the saved mobile if any. Dial out tab `#/dialer/out` has a dial pad and caller ID picker (numbers listed from Twilio); the queue's Call
  button uses the browser too. The old ring-my-mobile bridge (`/api/dialer/call`, `/api/dialer/dial`) stays in the API but is not in the UI.
- Call training (built): outbound browser calls run in a Twilio conference `rw_<activityId>`: the rep joins (endConferenceOnExit), `conf-status`
  on conference-start dials the number in as a participant (EarlyMedia so ringing is heard, caller ID from_num), `cust-status` tracks
  ringing/answered/ended (the call bar polls `GET /api/voice/calls/:id`). Owners (role admin only) see `#/dialer/live` and join with listen
  (muted), whisper (coach = agent CallSid; needs Agent Conference on in the Twilio console, error 16000 otherwise) or barge, switching via
  `POST /api/voice/monitor/:id` (participant update). Recording is an owner switch (`settings.call_recording`, `#/dialer/setup`): conference
  record-from-start for outbound, record-from-answer-dual for inbound; unanswered outbound recordings are deleted. `#/dialer/recordings`:
  reps hear only their own, owners hear all and can delete; audio is proxied from Twilio by `/api/recordings/:id/audio`. Reps disclose
  recording verbally (no automated announcement, V's call). Phone setup also lists every Twilio number and connects its Voice and SMS URLs
  to the Hub. Texts reply from whichever of our numbers the thread last used.
- Scan tool v3: up to 5 keywords per run (tabs plus a summary table, save all to a client), grids to 13 x 13, radius to 30 miles, bigger map
  with zoom buttons, drag, pinch, ctrl or trackpad zoom, and double click (`createMap` in `public/js/map.js`). A live feed shows each search as a
  phone result card while scanning, and "Replay the scan" re-runs it spot by spot for clients. Lead research now keeps the top 3 per grid spot,
  and the presentation's scan slide replays it the same way.
- Pitch (built): `public/js/leadintel.js` SCRIPT_KEYS, DEFAULT_SCRIPT, DEFAULT_OBJECTIONS, PLAYBOOK. One pitch from dial to signature with the scan
  as the hook; never claims a scan when no research ran. Presentation notes follow the same pitch. Citations in `public/js/fulfill.js` carry the
  sign up link, cost, why, lookup link, and hidden address support, with trade lists that apply only when certified.
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
