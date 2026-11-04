# Rightway Hub

Internal software for Rightway Growth LLC (local SEO agency, Miami and Fort Lauderdale FL). Owner: Vidal Newton (V), non-developer.
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
  Clients list moved to `#/clients`. Client view (Clients tab, `#/clients/view/<id>`) shows the client app in a phone frame via `/?as=<clientId>`; the `x-view-as`
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
  to the Hub. Texts reply from whichever of our numbers the thread last used. Owners promote or demote teammates on the Team page
  (`PUT /api/users/:id/role`, not yourself, owner role is the only gate for live calls, all recordings and phone setup).
- Dispositions (built, `src/dispo.js`, `public/hub/dispo.js`): popup after every outbound browser call (queue and dial out; dial out can add the
  number as a lead). Owners edit the list in Dialer, Phone setup (settings `dispositions`): name plus "what it does" (a built in result that
  drives `applyOutcome`, or `none` to just log). `recordOutcome` in `src/crm.js` is the one path; activities keep `outcome` (built in) plus
  `dispo` (label) and `note`. `POST /api/voice/calls/:id/disposition` for dial out. First 9 get number keys.
- Payments (built, owners only, `src/payments.js`, `public/hub/payments.js`, nav item filtered by role): Stripe MRR from active subscriptions,
  collected this month and per month (6 months, net of refunds), balance, next payout, past due and unpaid invoices, recent payments. Each Stripe
  read is separate so a restricted key missing one permission blanks one section. 60s cache. Snapshot card on the Dashboard for owners.
- Stripe setup (built, owners only, `src/stripesetup.js`, `src/stripekeys.js`, `public/hub/stripesetup.js`, top of Settings): one click "Set up Stripe" makes the webhook
  (signing secret returned once, stored sealed in settings `stripe_webhook_secret`, AES-GCM keyed on STRIPE_SECRET_KEY; `STRIPE_WEBHOOK_SECRET` in Cloudflare still wins),
  five payment links (product per plan, monthly price plus one time setup price, first charge = setup + month so `FIRST_CHARGE_CENTS` recognizes the plan), and the client
  billing portal (invoices, card and contact updates, no cancelling; its id is stored and passed when opening a portal session). Ids kept in settings `stripe_setup`,
  Stripe idempotency keys, per step error isolation, existing links left alone unless "replace" is ticked. Needs a restricted key with Write on Products, Prices,
  Payment Links, Webhook Endpoints, Customer portal. `POST /api/stripe/setup` `{steps?, replace?, webhookSecret?}`, `GET /api/stripe/setup` (status, no Stripe calls).
- Automatic scans (built, Phase 4 part 1, `src/autoscan.js`, `public/hub/scans.js`): queue table `scan_jobs`; cron trigger every minute (`triggers.crons`
  in wrangler.jsonc, `scheduled()` in `src/worker.js`) works up to 40 grid points per run (Worker subrequest limit), saving partial progress in the job.
  Finished jobs become normal `scans` rows (`auto: true`, Local Finder, desktop) plus a log line; under 75% of spots back = job failed, nothing saved.
  Owner settings (`settings.autoscan`: enabled off by default, size, radius, keywords per client from the profile's target keywords, everyDays) in a
  Settings card with a cost estimate, "Scan all clients now", and recent jobs. Due clients are checked every 30 minutes. Client Rankings tab: "Run scan now",
  progress strip, and a keyword trend card (latest vs previous scan). Open pages call `POST /api/autoscan/tick` every 6s while jobs wait, so scans
  move even without the cron. Locking with `locked_until` stops two runs working the same job.
- Monthly reports (built, Phase 4 part 2, `src/reports.js`, `public/hub/reports.js`, public page `/report.html#<token>` with `public/report.js`):
  table `reports` (one per client per month, long random token, snapshot JSON). Made automatically when a client's last scan job of a run finishes
  (draft for that month; sent reports are never rewritten unless refreshed on purpose). Snapshot: up to 5 keywords (profile keywords first) with now,
  before (previous scan) and start (first scan) incl. rank grids, reviews now vs start (from the scan target), review requests, tasks done by kind,
  posts posted, QR scans, who holds the top 3, next month's plan items. Client Reports tab (make for any month, Update, Open, Copy link, Send with
  a note); Send emails through Resend (`reportEmail`, inline styled HTML plus text) or, without email, "Mark as sent". Sending marks the month's
  `report` task done and logs it. Owner option `autoscan.autoSend` emails reports when ready (needs `settings.autoscan_origin`, saved from owner requests).
  Settings card lists drafts waiting to send. Client app shows sent reports above its scans. `GET /api/public/report/:token` counts views.
- Content engine (built, Phase 6 part 1, `src/content.js`, `public/hub/content.js`, sanitizer `public/js/sanitize.js` shared by Worker and browser):
  table `content` (kind service/city/article, brief JSON, html, meta, slug, status idea, draft, review, changes, approved, published, wp_id, live_url).
  Ideas from the profile's services x cities plus cost and "signs you need" articles, ranked up when the latest scan for a matching keyword is weak.
  Brief (outline, FAQs, must include, facts from profile and intake, competitors from the scan leaderboard, internal links). Draft by Claude
  (`ANTHROPIC_CONTENT_MODEL` or `ANTHROPIC_MODEL`, delimited TITLE/META/SLUG/HTML reply, strict no invented facts) or a bracketed outline without a key;
  sending to the client is blocked while [brackets] remain. Editor in the client's Content tab (contenteditable with H2, H3, bold, list, link, HTML view,
  paste as plain text). Client app `#/content` to approve or ask for changes (home card when pages wait). WordPress: per client site, username and
  application password (sealed AES-GCM keyed on ACCESS_KEY, never returned), REST `wp/v2/pages` or `posts`, draft or publish, updates the same post.
  Otherwise Copy HTML, Download, "Mark live". Going live checks off the month's `page` or `content` task with the live link.
- Site audit, fix log, schema (built, Phase 6 part 2, `src/siteaudit.js`, `public/hub/siteaudit.js`, client tab "Site audit"): own crawler, no DataForSEO.
  Table `site_audits` (queue like scans: first run reads home page, robots.txt, http to https check and the sitemap, then up to 40 same-host pages,
  15 fetches per run, partial state in `data`, `locked_until`). The cron runs scans first, then crawls with what is left (stays under ~50 outside
  requests a run). `parsePage` and `findIssues` are pure: https, http redirect, broken pages, missing, long or duplicate titles and descriptions, H1
  missing or many, thin pages (skips contact and legal pages and noindex pages), images without alt, linked noindex pages, mixed content, home page
  viewport, tel link, phone matching the profile, local schema, city in the home title, sitemap, robots block-all. Score 100 minus 12/5/2 by severity.
  Table `site_fixes` (what, page, before, after): logging a fix checks off the month's `onpage` (or `technical`) task; the next crawl marks it
  "verified" when that issue key (per page) is gone. `buildSchema` makes LocalBusiness JSON-LD (type from category) from the profile to copy.
  Monthly crawl rides the scan schedule (`autoscan.crawl`, on by default when scans are on). Open tab calls `POST /api/site/tick` every 5s while crawling.
- Call tracking (built, Phase 7, `src/calltrack.js`, `public/hub/calltrack.js`, client tab "Calls", client app `#/calls`): tables `tracking_numbers`
  (number, sid, source like "Google profile" or "Website", forward_to, record, alert_to) and `tracked_calls`. Owners search and buy a Twilio number
  (or assign one already on the account); its Voice URL is `/api/twilio/track-voice`, which logs the call (caller, city, source, new caller or not)
  and `<Dial>`s the client's line keeping the caller's ID. `track-done`: answered with duration, or missed: email alert (Resend) and a short
  voicemail (`<Record>`, `track-recording?k=vm`). Recording per number, off by default; on adds a spoken "This call may be recorded" first.
  Audio proxied by `/api/tracked-calls/:id/audio` (staff and that client). Release gives the number back to Twilio. Tracking numbers are kept out
  of the agency dialer's caller IDs, Phone setup and "Connect all", and `/api/twilio/voice` forwards them to the client if one points there.
  `callStats` feeds the monthly report (calls card, email line); sending a report with calls also checks off the month's `calls` task.
- Citations and links (built, Phase 8, `src/citations.js`, `public/hub/citations.js`, client tab "Citations"): directory check runs one Google
  `site:` search per directory (`webSearch` in `src/dataforseo.js`, organic live advanced, about $0.002 each, max 25; `mockWeb` in demo) over the
  `fulfill.js` list (domains in `SITES`; Apple, Bing, aggregators and certifications are "check by hand"). `judgeListing` (pure) reads Google's
  preview: name tokens must match; same phone or ZIP or street number = match, a different phone or ZIP = mismatch (with the number shown),
  otherwise "listed, check details" or "not listed". Results in `citation_audits`; team status stays the onboarding marks (`onb:<clientId>` cit:*).
  Table `link_log` (type citation or link, status prospect, planned, submitted, live, lost, cost, kind, note): going live checks off one open `link`
  task this month and logs it. "Find prospects" runs 6 searches (chamber, business association, trade group, "best X in city" lists, sponsorships)
  and adds up to 3 new sites each, skipping big platforms and sites already logged. "Check links" fetches up to 15 live entries: links must still
  href the client domain, listings must still show the phone or name. The monthly report lists listings and links that went live that month.
  Clients only see live entries. No paid or automated link building.
- Market Leader extras (built, Phase 9, `src/leader.js`, `src/reputation.js`, `src/quarterly.js`, `public/hub/leader.js`, `/plan.html`):
  Locations: a location is a client row with `parent_id` (added from the main business's Locations tab, copies plan, services, keywords, contact).
  It gets its own scans, reports, calls, listings and content; it gets no plan tasks (`/tasks/generate` returns 0) and is left out of revenue and
  client counts; clients list shows it under its main business with a Location badge; its page header links back. `rollup()` shows each location's
  top 3 coverage, reviews, calls, site score, listings and last report, plus totals. Reputation (tab on Authority and Market Leader): DataForSEO
  Google reviews task (`business_data/google/reviews/task_post`, newest 100, cid or place_id or name, then `task_get`; queued pulls collected by the
  cron `reviewTick` or when the tab is opened; demo reviews without DataForSEO), `analyzeReviews` (pure: 6 month counts and average stars, pace,
  reply rate, unanswered 3 stars or less, star spread, themes from word lists in `THEMES`) and `reviewPace` from scan snapshots (client and top
  competitors' review counts over time). Monthly report gets a reputation card and email line. Live dashboard: `GET /api/clients/:id/live`
  (rankings trend, reviews, calls, work and recent activity, site score, live listings, locations, shared plans, last report), shown in the client app
  home for Market Leader. Quarterly plan (tab on Market Leader main businesses): `draftFrom` (pure) makes goals (top 3 coverage, reviews, reply rate,
  calls, site score), focus lines and three months of actions from the data; editor saves goals, focus, months, notes; Share makes the private
  `/plan.html#<token>` link (shown in the client app) and checks off the planning task.
- Google apps (built, `src/googleapps.js`, `public/hub/googleapps.js`, page `#/google`): per app scopes added on top of Calendar
  (`APP_SCOPES` in `src/google.js`, granted list stored in `users.google_scopes`): Sheets export (drive.file) of leads, clients, calls,
  payments; Search Console and GA4 (Data + Admin APIs) and Google Ads (GOOGLE_ADS_DEVELOPER_TOKEN, optional GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  GOOGLE_ADS_API_VERSION default v25) on a client Website tab (`clients.gsc_site`, `ga4_property`, `ads_customer`). Data is read with the
  user's own Google account if it has the app, else an owner's. Not tested against live Google yet. The Google page now has tabs
  (`googleTabs` in `public/hub/googleapps.js`): the apps themselves first, Setup last. `hasScope` matches whole scopes (".../auth/drive"
  is a prefix of ".../auth/drive.file"); full Drive counts as the narrow Sheets scope. `ownFor` in `src/googleapps.js` is the personal
  version of `userFor`: mail and Drive only ever use the asking person's own account, never a teammate's.
- Gmail in the Hub (built, `src/gmail.js`, `public/hub/mail.js`, parser `public/js/gmailparse.js` pure and shared, `#/google/mail`, scope
  gmail.modify): labels (system ids get plain names), threads with a page of 20 (the Worker subrequest cap), Gmail search, read, star,
  archive, mark unread, trash, attachments (downloaded through `/api/google/mail/att/...`), reply, reply to all, forward and compose with
  a small formatting bar and files up to 6 MB. `gmailparse.js` does the MIME work: base64url and charset decoding, RFC 2047 words, body
  and attachment picking, `threadRow`, `fullMessage`, `buildRaw` (multipart/alternative plus mixed), `replyTo` and `quoted`.
  `safeMailHtml` strips scripts, styles, frames, forms, event handlers and javascript: links, drops risky CSS (position, z-index) off style
  attributes, and blocks remote pictures until "Show pictures". Hub ties: a thread shows the lead or client it belongs to with a link,
  compose suggests addresses from leads, clients and teammates (`/api/google/mail/people`), mail sent to a lead or client is logged as an
  `email` activity on their timeline, and `mailWith(box, email)` lists recent mail with one person for their page.
- Google Calendar in the Hub (built, `src/gcal.js`, `public/hub/gcal.js`, maths `public/js/calgrid.js` pure and shared, `#/google/calendar`,
  `/month|week|day`): every calendar the person can see (`calendarList`, up to 6 shown at once, each with its own colour, read-only ones
  marked), month, week and day views, the red now line, click an empty slot or a free gap to make something, keys m, w, d and t. Events are
  added, changed and deleted with guests emailed (`sendUpdates=all`), optional Google Meet link, all-day as plain dates, and an event can be
  pinned to a lead or client (`extendedProperties.private.rwLead`, `rwClient`) which the page then shows as a link. Invite list suggests
  leads, clients and teammates (`/api/google/cal/people`). `calgrid.js` holds `monthGrid`, `weekGrid`, `eventTimes` (all-day end dates),
  `slimEvent`, `eventsOn`, `layoutDay` (side-by-side columns for overlaps), `clockLabel`, `inputValue` and `freeGaps` (what is free in
  working hours). The booking page and Hub meetings keep using `src/google.js`; this is the person's own calendar.
- Google Drive, Docs and Sheets in the Hub (built, `src/gdrive.js`, `public/hub/gdrive.js`, `#/google/drive[/<folderId>]`, scope drive):
  browse folders with a trail back to My Drive, search all of Drive, make a folder, Google Doc, Sheet or Slides, upload (base64 in one
  JSON request, multipart/related to Google, 20 MB cap), rename, move to the bin (trashed, never wiped), download (Google files are
  exported: docs and slides as PDF, sheets as xlsx), and share by email with view, comment or edit, or anyone with the link; the sharing
  box lists who already has it. Each client gets a Drive folder on first use (`clients.drive_folder`, `clientFolder`), shown on the client
  tab "Files" with upload; `POST /api/clients/:id/to-doc` turns a page draft (or any HTML) into a real Google Doc in that folder
  (`htmlToDoc` uploads HTML and lets Google convert it). The older Sheets export in `src/googleapps.js` stays as it is.
- Google and the rest of the Hub (built): the apps talk to each other and to the pipeline.
  Mail: an attachment can be kept straight into Drive (`POST /api/google/mail/att/:msgId/:attId/drive`, `saveToDrive`), a thread can be
  turned into a calendar event with the same people (`quickEvent` in `public/hub/gcal.js`), and compose can drop in a Drive file as a link
  (`GET /api/google/drive/recent`). Lead page: Email opens the Hub composer, "Put on my calendar" makes an event pinned to that lead, and
  recent mail with them is listed under the history. Client page: Email and Meeting buttons in the header, a Files tab with the client's
  Drive folder, uploads and recent mail with the contact. Content editor: "Send to Google Docs" saves the draft and converts it into a
  Google Doc in the client's Drive folder. Sent mail is logged on the lead's or client's timeline either way.
- Scan tool v3: up to 5 keywords per run (tabs plus a summary table, save all to a client), grids to 13 x 13, radius to 30 miles, bigger map
  with zoom buttons, drag, pinch, ctrl or trackpad zoom, and double click (`createMap` in `public/js/map.js`). A live feed shows each search as a
  phone result card while scanning, and "Replay the scan" re-runs it spot by spot for clients. Lead research now keeps the top 3 per grid spot,
  and the presentation's scan slide replays it the same way.
- Pitch (built): `public/js/leadintel.js` SCRIPT_KEYS, DEFAULT_SCRIPT, DEFAULT_OBJECTIONS, PLAYBOOK. One pitch everywhere, framed as the
  "Google clarity call" (V's Apex style, rewritten for Rightway): opener as the analyst who ran the clarity check, screen share frame, 10 discovery
  questions written down for rebuttals, verify business and keywords, clarity scan with the block by block inconsistency (`spreadLine`), search
  together, slow down for why competitors rank, listing inconsistencies, V's story (worked inside agencies, built the opposite: visible work, monthly
  map, month to month after 3 months), how it works, what we need from the client, trial close, drop close (anchor high, then only what
  discovery justifies), work order and payment, onboarding booking and homework. No packages: the close reads the quote's services (`services_list`),
  anchors at everything we offer (`price_anchor`), then the quoted buildout and monthly; `drop_offer` trims to the core services at the next lower price. Objections before price, after price and
  closes (fit/function/finance, think about it x4, can't afford x3, not today). Never claims a scan when no research ran (`opener_reason`, `scan_intro`,
  `frame_scan`, `gk_reason`), never promises rankings. `SCRIPT_VERSION` (5): a script or objections saved in Settings for an older pitch are ignored
  (settings `script_version`). Presentation notes pull the same script steps (`say()` in `public/js/present.js`). The presentation shows no plans: "What gets you results"
  lists the quote's services with why (top 10 tie in; hover × to drop one, Add a service), and "Your investment" shows the buildout, monthly and due
  today. The amounts start blank every meeting; the rep types them, and moving to the next slide saves them to the lead's quote, which the
  work order fills in (sending without typed amounts asks to confirm the saved quote).
  Printable reading copy of the script is a Claude Doc (V prints it for calls).
- Pricing is per client (Nov 2026): plans are internal only (they set the monthly task load) and the client never sees a plan name. The rep picks
  the services the client needs and sets the buildout and monthly from discovery. `SERVICE_LIST` in `public/js/plancopy.js` (client words, `min`
  internal plan, `core`, `fixes` = problem keys); `servicesFor` and `quoteFor` in `public/js/leadintel.js`. Quote saved on `leads.quote` (JSON:
  plan, setup, monthly in dollars, services) by `PUT /api/leads/:id/quote` (lead panel "Close the deal", and live from the presentation).
  Usual internal prices: Starter $399 + $399, Growth $449 + $449, Authority $499 + $499, Market Leader $599 + $599 (`MONTHLY_CENTS`, `SETUP_CENTS`,
  `PLAN_INFO`, `PLAN_PRICE`, leadintel `PRICES`); used as defaults and as the drop close anchor. `quoteLink` in `src/billing.js`: plan link when the
  amounts match a plan's saved link, else makes a Stripe payment link for those amounts (cached in settings `stripe_quote_links`, metadata
  `rw_plan`/`rw_kind`). Webhook takes the plan from metadata or the work order and MRR from the work order's monthly. Plan names were removed from
  the client app, report and quarterly plan pages. Stripe setup still makes four plan links (price keys include the amount).
- Work orders v2 (built, `public/js/agreement.js`, pure, `AGREEMENT_VERSION` 2): two kinds. `seo`: the one local marketing agreement for every client
  (one column, one Letter page, services list says "Website recommendations", 3 month minimum then month to month, early termination owes the rest
  of the first 3 months, buildout + first month due at signing). `website`: websites are a separate service with their own agreement (build fee due at
  signing, optional monthly hosting and care, the project's scope lines, 2 revision rounds, ownership on full payment). Signature block: name and
  business filled from the lead, signature and initials in one of three script fonts the client picks (`SIG_FONTS` from Google Fonts, with
  `SIG_STACK` system cursive fallbacks), date filled with today. After signing, `emailSignedCopy` emails the full signed agreement (inline styled,
  `agreementEmailHtml`, with a View/print link and the signing record) to the client and every owner plus the rep, through Resend, or from the rep's
  or an owner's own Gmail when Resend is not set (`sendGmail` in `src/gmail.js`); `work_orders.emailed` keeps who got it
  (`work_orders.signed_font`, `initials`, `initials_font`, `kind`). `agreementSnapshot` is saved in `work_orders.terms`; `/sign.html` renders it;
  `/workorder.html` is the printable blank (kind picker, amounts, scope). Website orders paid through Stripe mark the order paid and notify owners
  but do not create an SEO client or tasks.
- Appointments by role (built): `leads.meet_by` = who booked it (lead meeting route, or a Booked outcome with a time, which now also sets `meet_at`).
  Owners (admin) see every appointment; teammates only theirs (`canSeeAppt`, `apptScope` in `src/crm.js`: meet_by, or their own lead when meet_by is
  empty). Applied to the dashboard, dialer "Coming up", `/api/calendar/upcoming`, lead lists and lead details (others' meet time hidden). Calendar page:
  teammates see only calendars they own (no shared company calendars); Hub appointments show on it as read only events (`appt: true`). Public
  bookings have no meet_by, so only owners (and the lead's own rep) see them. `#/pipeline/<leadId>` opens that lead.
- Ask Claude (built, `src/assistant.js`, `public/hub/assistant.js`): side panel on the client header and the task panel. `clientBrief` gives Claude
  the client's plan, services, cities, keywords, voice, intake, this month's tasks, latest scans, site audit issues, latest reviews, and the task guide.
  System rules: no invented facts, Google guidelines, no ranking promises, no dashes. `POST /api/assistant` {clientId?, taskId?, messages}. Needs
  ANTHROPIC_API_KEY; model ANTHROPIC_ASSIST_MODEL, else ANTHROPIC_CONTENT_MODEL, else ANTHROPIC_MODEL. Chats live in the browser while the Hub is open.
- Booking page is "Book a consultation" (`/book.html`, default title "Book a free consultation", invite "Rightway Growth consultation"). The marketing
  site (rightwaygrowth.com) is not in this repo: V built it himself (was on Netlify). Its pricing comes off, website services go on, every call to
  action links to `/book.html` on the Hub.
- Google connection check (built, `src/googlecheck.js`, Setup tab "Check connection"): one small read per app the person turned on, with `explain()`
  turning Google's error into a reason and fix (API off in Google Cloud with the enable link, box not ticked, quota, Business Profile not approved,
  connection expired after 7 days in Testing mode). The OAuth callback compares granted scopes with the apps asked for (`oauth_states.apps`,
  `missingText`) and says which boxes were left unticked.
- BrightLocal: not integrated. It has no free API (paid plans only), and the scan tool already does the Local Search Grid.
- Citations in `public/js/fulfill.js` carry the sign up link, cost, why, lookup link, and hidden address support, with trade lists that apply only
  when certified.
- Onboarding (built): first month tasks created on convert, lead research becomes the client baseline, Onboarding tab (before vs now, fix list,
  Google profile checklist, citations list with status, review target, 90 day plan, uploads), client app Get started page (intake form, access steps).
- Fulfillment workflow (built, `src/work.js`, `public/js/guides.js` pure and shared, `public/hub/work.js`): the task engine fills every active main client's
  month on its own (`ensureMonthTasks` from the cron and `GET /api/work`), owner = `clients.owner_id` (Account manager on the client header), due dates from
  `dueDate` (repeat tasks spread through the month, setup 10 days after start). My work `#/work` (Mine, Nobody assigned, Everyone, per person, per client;
  overdue, today, next 7 days; bulk assign and due), task panel (`GET /api/tasks/:id`: guide steps as a checklist, timer, add time, access warnings, proof,
  and tools per kind: posts to copy or publish, business details to copy and missing directories, audit issues and Log a fix, pages in progress, reviews
  without a reply with Draft a reply, report and meeting status). Proof before close: `proofMissing` per guide (`link`, `screenshot`, `either`, `note`, `none`)
  enforced in `PATCH /api/tasks/:id`; screenshots in R2 `proof/...`; skipping needs a note. Auto closes (report sent, page live, fix logged, link live,
  meeting held, plan shared, post posted with a link) skip the proof check. Time: `time_entries`, one running timer per person, capped at 6 h, Hours page
  `#/work/hours` (per client vs planned minutes from the guides, revenue per hour for owners, per person, per kind vs the guide). Guides `#/work/guides`,
  owners edit (table `guides`, field by field over `DEFAULT_GUIDES`). Access checklist client tab `accesslist` (`ACCESS_ITEMS`, table `client_access`,
  auto granted for WordPress saved, Search Console, GA4, Google profile linked, tracking number), gaps shown on My work. Monthly report gets "Proof of the work"
  (links and screenshots, `/api/public/proof/:token/:taskId`).
- Top 10 focus (built): headline numbers are first page (top 10) coverage everywhere (Hub, client app, reports, email, quarterly goals, roll-up, content
  ideas, scan tool, pitch and presentation). `ladder()`, `bands()`, `gapTo`/`gapText`, `climbSteps` in `public/js/analysis.js`: who holds spots #1 to #10 by
  average rank, where the client sits, what separates them from each business above (reviews, rating, main category, coverage), and the band by band climb.
  Copy always says rank also depends on distance and relevance, never a promised spot. Pitch problem `not_top10` (high) and `not_top3` (medium, #4 to #10).
- Meetings (built, `src/meetings.js`, `public/hub/meetings.js`, client tab `meetings`): Google Calendar event with Meet link and invite (`createMeeting`, move with
  `moveMeeting`, cancel with `cancelEvent`), or a pasted link without Google. Agenda from the latest report (`agendaText`). Mark held needs notes, closes the
  month's meeting task; summary shows in the client app home with a Join button.
- Calls back and voicemail (built, `src/voicemail.js`, Inbox tab `#/inbox/calls`): unanswered or nobody available goes to `<Record>` (greeting editable,
  settings `vm_greeting`), recording on the activity (`vm_sid`, `vm_secs`, `seen_at`), email to owners (or `vm_alert_to`), audio proxy `/api/voicemail/:id/audio`,
  Call back from the browser, Add as lead. Incoming calls ring every saved mobile (up to 5) with the open Hubs; callbacks show "Calling back (you called ...)".
- Notifications (built, `src/notify.js`, `public/hub/alerts.js`, `#/alerts`, service worker push handlers): Web Push with VAPID keys made once (settings `vapid`,
  private key sealed) and aes128gcm payloads, no outside service. `notify()` writes the alert list (table `notifications`), pushes to `push_subs` by
  `users.notify_prefs`, and hands Slack to `postToSlack`. Kinds: call, voicemail, text, task, client, lead, money, meeting (clients: update). Hooks: inbound
  call (urgent), missed call and voicemail, inbound text, task assigned, 8am New York digest (`digestTick`), client approvals, uploads, intake and first report view,
  website lead and booking, Stripe new client and failed payment, meeting 15 min reminder (`meetingReminders`), report sent, page ready and meeting booked
  (to the client). Webhooks notify after the response via `defer` (execution context waitUntil). iPhone needs the Hub on the Home Screen.
- Slack (built, `src/slack.js`, `public/hub/slack.js` on the Alerts page): the Rightway Hub Slack app, made from a manifest with the Hub's URLs filled in
  (`manifestFor`, "Create the Slack app" link `api.slack.com/apps?new_app=1&manifest_json=...`, scopes in `SCOPES`). Owners paste the bot token (xoxb) and
  signing secret (sealed in settings `slack_bot`, `slack_signing`; `src/seal.js` keyed on ACCESS_KEY); connect runs auth.test and links teammates by email
  (`users.slack_id`, also matched later by Slack profile email via users.info). `postToSlack` (called by `notify()`): channel per kind (settings `slack_routes`;
  calls, tasks and meetings are personal so not routable), the client's own channel (`clients.slack_channel`), and direct messages per person
  (`users.slack_prefs`, tasks and meetings on by default); `slack: false` on notify means no channel posts, DMs still go. Block Kit buttons: Claim (lead),
  Mark heard (missed call, voicemail), Reply (text, opens a modal that sends through `sendText` in `src/sms.js` with the same consent, STOP and hours rules),
  Start timer (task), Open in the Hub. `/api/slack/interact` and `/api/slack/command` are public but verify the signing secret (5 minute window).
  `/hub` (`commandReply`): work, client <name>, lead <name or phone>, stats (owners), help. Morning summary to the `digest` route from `digestTick`
  (`teamSummary`). The plain incoming webhook still works when the app is not connected (`slack_hook`, `slack_kinds`, `PUT /api/slack/webhook`).
- Slack page (built, `src/slackuser.js`, `public/hub/slackapp.js`, text and emoji in `public/hub/slacktext.js` (pure, tested in Node), menu item "Slack",
  `#/slack/<channel>`, `#/slack/<channel>/t/<thread_ts>`, `#/slack/activity|search|browse|scheduled`): each person's own Slack inside the Hub.
  Sign in with Slack (OAuth v2 user scopes `USER_SCOPES` in `src/slack.js`; owners save the app's Client ID and Secret, `PUT /api/slack/app`, secret sealed;
  redirect `/api/slack/oauth/callback`); the user token is sealed in `users.slack_token` with `users.slack_uid`, granted scopes in `users.slack_scopes`
  (people who connected with the first 19 scopes, `FIRST_USER_SCOPES`, get a "Reconnect" banner; `GET /api/slack/me` returns `missing`). Every `/api/slack/me/*`
  call uses the asking person's own token, so nobody (owners included) can read someone else's Slack. List: Channels, Clients (client chat channels under the
  client's name, `slackName` keeps the real name) and Direct messages, collapsible, draft marks, unread dots. Messages: day lines, "New" line, load earlier
  (cursor), jump to a message (`history?latest=`, no mark read), blocks text (`blocksText`), link previews (attachments), pins, files, reactions with the full
  emoji set plus workspace emoji (`emoji.list` cached 6 h in settings `slack_emoji`, `std:` for aliases of standard ones), threads with "Also send to the
  conversation" (reply_broadcast). Message menu (and right click or long press): reply, copy link (chat.getPermalink), copy text, pin/unpin, remind me
  (reminders.add), mark unread from here (`beforeTs`, conversations.mark plus `slack_unread`), forward (permalink posted), edit in place (Up arrow edits your
  last), delete. Composer: formatting bar (bold, italic, strike, link as [text](url), lists, quote, code), @people, #channel and :emoji: suggestions turned
  into Slack tokens by `toSlack`, paste or drop a file, drafts per conversation in localStorage, schedule send (chat.scheduleMessage, list, delete or edit).
  Details panel: about (topic, description, rename, made by), members (add people), pins, files; leave. Browse and join public channels, create a channel
  (public or private, description, people). New message to one person or a group (up to 8). Search (search.messages with the person's token, Slack's
  in:/from:/before: words). Activity: mentions and replies to your threads saved from events (`slack_activity`, `GET /api/slack/me/activity`, seen,
  count in `/unreads`). You: status with presets and clear after (users.profile.set), away/active (users.setPresence), pause notifications (dnd.setSnooze;
  also quiets the Hub's Slack pushes until `users.slack_snooze`), profile cards (users.info, getPresence, local time). Huddles and calls are not open to
  other apps. Events API `/api/slack/events` (signed, url_verification, retries deduped in `slack_events`): `onSlackMessage` adds unread counts for Hub
  members of that conversation (`slack_members` saved when the list loads, `slack_unread`), records activity, and DMs, @mentions and replies to your
  threads push (notify kind `slack`, `list: false`). "Share from the Hub" (`itemMessage`: client, lead, task, report) also on the task panel and client
  header ("Send in Slack", `sendToSlack`). Owners paste the new manifest (`manifestFor`) in the app's App Manifest page whenever scopes change, then everyone reconnects.
- Client Messages (built, `src/chat.js`, `public/hub/chat.js`, client app tab "Messages" `#/messages` plus a "Message your team" card on its home, staff
  client tab `chat` "Messages"): the client's one place to talk to the team, without a Slack account. Every active main client gets a private Slack channel
  automatically (`openClientChat`: `chat-<client>`, invites the account manager and linked owners, sets a team-only description, posts a welcome for the
  client): on convert (`convertLead`) and `POST /api/clients` (`autoChatFor`), when the client opens Messages, and for older clients from the cron
  (`ensureClientChats`, one per run, retried every 6 h via `clients.chat_tried`). Owners can switch automatic chats off (settings `chat_auto`, `PUT /api/chat/auto`,
  Alerts page Slack card); the client tab still offers Turn on Messages or pick an existing channel (`POST /api/clients/:id/chat/setup`). Changing the account
  manager invites them (`inviteToChat`). Hub updates for a client (`notify` with `to.clientUsers` and kind `update`: report ready, page to check, meeting booked)
  are also posted into the chat by `chatNote` as "Rightway Growth" (metadata `rw_hub_note`, shown as an update card, link from settings `hub_origin`). Client
  posts go through the bot with their name (`chat:write.customize`, metadata `rw_client_msg`); team posts from the Hub use the person's own Slack token or the bot
  with "Name (Rightway Growth)". History via the bot (thread replies shown inline), files through `files.info` checked against the channel. Team replies written
  in Slack arrive by bot events (`onClientChat`): unread count for the client's users (`slack_unread`) and a push (kind `update`); Hub posts are remembered in
  `chat_posts` so they are not counted twice. Client dot: `GET /api/client-badges`. Everything in the chat channel is visible to the client; the Slack page shows
  a warning strip on client chats.
- Menu and dots (built, `public/hub/nav.js`, `src/nav.js`): menu items in `NAV` (Dashboard, My work, Slack, Phone, Pipeline, Clients, Payments,
  Scan tool, Google, Alerts, Settings). Client view is a tab inside Clients (`clientsTabs` in `public/hub/staff.js`, `#/clients/view/<id>`; old `#/clientview` links still route). Each person reorders and hides items ("Customize menu", `users.nav_prefs`, `PUT /api/me/nav`). Under 900 px a bottom bar
  shows as many items as fit (width / 78, 3 to 7) with More opening the full menu; the open page always stays in the bar. Dots: `GET /api/badges` (texts,
  calls, phone, slack, slackMentions, alerts, work due or overdue, pipeline audit requests not called, total) painted into any `[data-badge]` element and the
  app icon (setAppBadge), refreshed every 45 s and on focus. Phone tab `#/phone` holds Dialer, Dial out, Texts (`#/phone/texts`), Calls and voicemail
  (`#/phone/calls`), Recordings, and for owners Live calls and Phone setup (`dialTabs` in `public/hub/dialout.js`); old `#/dialer/*` and `#/inbox*` links
  still route. Team lives in Settings (`#/settings/team`, `settingsTabs`).
- Phase 5 Google Business Profile (built, `src/gbp.js`, `public/hub/gbp.js`, client tab `gbp`, Google page app `gbp` scope business.manage): link a location
  (`clients.gbp_account`, `gbp_location`), profile read and edit (description, phone, website), checks, Performance API calls, directions, website clicks,
  views (last 30 vs previous 30, and in the monthly report), reviews list and reply, publish posts (`/api/posts/:id/gbp`, closes a post task with the live link)
  and photos from uploads, via signed public media links `/api/public/m/...`. Reply drafts (`/api/clients/:id/review-reply`, Claude or templates). Not tested
  against live Google: needs Google's Business Profile API access approval for the Cloud project. Q&A is not in the API.
- Cold calling and booking ready (Nov 2026):
  Balances (`src/balances.js`, `public/hub/balances.js`): DataForSEO (`appendix/user_data`) and Twilio (`Balance.json`) wallet balances,
  5 min cache, low at $5 and $10 (`LOW`); `GET /api/balances` (owners, card on Dashboard and Settings with links for Anthropic, Stripe, Resend),
  `GET /api/balances/status` (staff, low flags only, red banner on the dialer). `dfsMessage` in `src/dataforseo.js` turns an empty DataForSEO
  wallet (40200/40210, payment words) into a plain "add funds" error.
  Profile bubble (`profileButtons` in `public/hub/staff.js`): settings cog plus initials bubble top right (`.ptop` desktop, `.ptop-m` phone header)
  with name, role, Settings, Alerts, Team, Customize menu, Log out. `modal()` closes on hashchange (a modal used to stay open across pages).
  Prospect listing check: `POST /api/leads/:id/listings` (`leadAsClient` in `src/citations.js`) checks 15 directories with `judgeListing`, saved
  on `leads.listings`; `public/js/listings.js` (pure: `listingsLine`, `listingsTable`). Shown in call prep ("Listings Google double checks") and
  the presentation's `listings` slide (real wrong and missing directories with links, or a "Run the listing check now" button).
  Presentation app slide is the live sample client app in a phone frame (`/?as=<sampleId>`, clickable) with an "Always getting better" line.
  Scan tool `?lead=<id>` prefills the lead's keyword and business. Script v5 (`listings_hook`, `listings_say` read the real listing check; blank lines dropped): `SCRIPT_GROUPS` cold (k_* steps: open, small group frame, hook,
  qualify, book, lock) and clarity (c_*), "(SCREEN: ...)" cues rendered as Screen lines in prep and presenter notes; prep opens the Clarity tab
  when the lead is booked or a meeting is within 3 hours. Frame: small group of clients, quality over cookie cutter, why most fail at marketing.
  Booking without Google: `/api/leads/:id/meeting` saves the appointment in the Hub (optional pasted Zoom or Meet link, email optional) and the
  modal gives invite text to text, email or copy; `/book.html` offers slots from the booking settings minus Hub appointments (`hubBusy`, leads
  `meet_at` and `meetings`), holds the time, and alerts the team to confirm and send the link (`confirm: true`). With Google it also checks
  Google busy times and sends the Meet invite as before.
- Hub v3 layout and team floor (Nov 2026): shell in `public/hub/shell.js` (`staffShell`, re-exported by staff.js): grouped rail (`GROUPS`/`groupOf` in nav.js:
  Sell, Deliver, Team, Run), command bar (page, Ctrl K or / command palette over pages, leads incl. phone digits, clients; status pill; yellow wallet button from
  `/api/balances/status`; alerts; cog; profile bubble), dotted paper canvas, segmented tabs, mono stat numbers ("Skin v3" at the end of hub.css). Scan tool uses the
  same rail and bar (`.sx-*` in styles.css). Agents (`src/agents.js`, `public/hub/agents.js`, `#/agents`, replaces Live calls; `#/phone/live` redirects): statuses
  available, break, lunch, training, meeting, admin, offline (`STATUSES` in `public/js/callstats.js`), On a call derived from live activities; `POST /api/me/presence`
  every 45 s (first beat logs you in, gaps over 2.5 min end the stretch), `POST /api/me/status`, table `agent_log`, logout sets offline. Owners Listen, Whisper, Barge from
  agent cards. Analytics `#/agents/analytics` (`GET /api/analytics/calls?days&rep`, pure `callStats`): dials, contacts (disposition beats Twilio answered), decision maker
  conversations, booked, talk, handle time (dial to `dispo_at`, capped talk + 15 min), call length buckets, dispositions, best hours, lead quality by grade, source,
  industry, time zone, lead inventory. `activities.ended_at`, `dispo_at`. More default dispositions (hung_up act counts as a contact). No recording announcement on
  agency calls (tracking numbers keep theirs when recording is on). Dashboard Team floor card. Training (`public/hub/training.js`, `#/training/...`): scripts read from
  `public/js/scriptprint.js` (pure, also feeds the PDFs in `public/training/`), objection drills, playbooks, fulfillment guides, owner setup, resources; progress in
  `users.training` (`/api/me/training`). Script v9 (c_live keeps the "let's say 4 or 5 people a week, 2 or 3 jobs" probing line, V's call: it is a hypothetical to build tension, framed "let's say"; c_program "What to expect": real ranking factors and timing, no rings or month by month geography, no "science" line, no made up search numbers in c_program): consultant, free Google clarity audits, ten clients only, no permission ask; clarity call is the Google clarity audit; sections 9 to 12 follow the imported pitch cadence (why we are having this conversation, how we do it month by month on the Scan tool rings, your app and your part, trial close); slide order plan, days, app. Maintenance mode (`PUT /api/maintenance`, settings `maintenance`, owners bypass, profile menu). Settings Team tab is now Agents. Refreshing pages do not replay the entrance animation (`body.settled`).
  Deep scan: presentation Scan slide "Run the full scan" opens `/scan.html?lead=<id>` in its own tab; Save to lead (`POST /api/leads/:id/deep-scan`, `compactScan`,
  `leads.deep_scan`, up to 5 keywords, 15 x 15) then BroadcastChannel and window focus refresh the slide (keyword tabs, any grid size). Client view and the app slide
  render the client app at 390 x 844 scaled into the phone frame (`--k`).
- Automations, research queue, calendar, lines, vault (Nov 2026): `src/automations.js` (`#/automations`, settings `automations`, `DEFAULT_AUTOMATIONS`: confirm email and
  text on booking, day before email, 1 hour text, optional no show text; `dueFor` pure, `automationTick` from the cron, table `automation_log` unique per automation,
  lead and meet_at; Claude draft `POST /api/automations/draft`; test to yourself). `src/autoresearch.js`: background research of every new lead (1 per cron run plus
  `POST /api/research/tick` from the open dialer, daily cap `auto_research_cap`), `scrubReason` (bad, toll free, closed) at import and after research (`leads.scrub`).
  Dialer quality tabs (`tierOf`: hot = A or callback/audit requested/no show, good B, maybe C, low D, fresh = not researched) and Power dial popup (next 3, countdown,
  rings via the browser phone, result popup, moves on; one call at a time). Booked with a time lands on the booker's Google Calendar with Meet (`bookOnCalendar` in
  `src/appointments.js`); team appointment calendar `#/calendar` (`GET /api/appointments`, all staff, view only); Google Meet now (`POST /api/leads/:id/meet-now`, opens
  in its own window: Meet cannot be embedded). Analytics: daily trend chart, funnel (dials to paid, work orders), call length bars (`public/js/charts.js`), Master sheet
  `#/agents/sheet` (`GET /api/analytics/master`, CSV). Owner Ask Claude bubble (shell, admin only, business snapshot in `src/assistant.js`). Personal lines (`src/lines.js`,
  `#/phone/line`): settings `num_owner` number to user; calls ring only that user (browser plus mobile if `users.fwd_calls`), texts alert only them (forward if
  `fwd_texts`); others (owners included) never see that line's texts, calls, voicemails or recordings; owners cannot see or monitor other owners' calls or recordings
  (`canSeeCallBy`). Vault (`src/vault.js`, `public/hub/vault.js`, `#/vault`): zero knowledge, PBKDF2 310k master key in the browser, AES-GCM items, P-256 ECDH wrapped item
  keys for sharing (tables `vault_keys`, `vault_items`, `vault_access`), 10 minute idle lock. Google Setup tab has the Cloud checklist (enable APIs, test users, tick boxes).
- Phone, Meetings tab (`public/hub/meet.js`, `#/phone/meet`): start a Google Meet now (`POST /api/meet/now`, falls back to meet.google.com/new without Google), join by link or code (`meetUrl`), schedule with a Meet link, and today's appointments with Join. Meet opens in its own window (`rw-meet`). Status `maintenance` (purple, `tone maint`) only for the primary owner (`isPrimary`: first owner account, `user.primary` in auth state).
- Notifications, profile photos, budget, bento dashboard (Nov 2026): the rail has no Logout or Customize menu (profile bubble menu only). The command bar bell is the
  Notifications panel (`public/hub/notifpanel.js`: filters All, Unread, Calls, Messages, Work, Sales; one color and icon per kind via `.k-*` classes; `rw-badges` event
  refreshes dots); the page is `#/notifications` (`#/alerts` still routes, nav key `alerts`) with the same rows plus device and preference cards. Profile photos
  (`src/avatar.js`, `public/hub/avatar.js`): the browser crops to a 256 px square JPEG, `PUT /api/me/avatar` (raw body) stores it in R2 `avatars/<userId>`, `users.avatar_at`
  busts the cache, `GET /api/avatar/:id` (staff only), shown on the bubble, profile menu, hello header, Team floor and Agents cards; `DELETE /api/me/avatar`.
  Costs (`src/costs.js`, `public/hub/budget.js`, Settings tab `#/settings/budget`, owners only): table `cost_daily` (day, vendor, kind, micro dollars, n) written by
  `logCost` at the call site: `liveSerp` in `src/dataforseo.js` (DataForSEO reports each task's cost) and `logClaude` after each Anthropic call (tokens at list price by
  model tier, `PRICE` table). Twilio spend is read live from Twilio usage records (cached 10 min), not logged. Settings `costs_budget` (monthly total plus per vendor caps)
  and `costs_fixed` (subscriptions list). `GET /api/costs?days`, `PUT /api/costs/budget`. `costTick` in the cron notifies owners once at 80% and 100% (`costs_alerted`).
  Dashboard card and Budget tab show month to date, projection, budget bar, daily stacked chart, per client and per search cost, margin vs MRR, cost per booked audit.
  Scan tool: costs are blurred (`.money`, `body.costs-hidden`) with a Show costs button in its header; the choice lasts for the tab (sessionStorage). Dashboard
  (`public/hub/home.js`) is a 12 column bento grid (`.bento`, `.w-3/4/6/8/12`): stat tiles with sparklines, 14 day calls line chart, goal ring, pipeline donut, conversion
  funnel, lead quality bars, best hours bar chart, meetings, callbacks, payments with a revenue bar chart, budget, balances, team floor, clients with a work ring, activity.
  Charts are pure in `public/js/charts.js` (`lineChart` area option, `stackBars`, `donut`, `ring`, `spark`). Accent palette `--c-blue/violet/amber/coral/teal/green/pink/slate`
  (Skin v4 at the end of hub.css): colored menu icons, group colored page labels, pipeline column tops, widget top borders, tinted stat tiles.
- Speed (Nov 2026): `ensureSchema` stamps `settings.schema_v` with a fingerprint of the table list in `src/db.js`; a cold Worker on a current database does one
  read instead of ~270 statements (migrations add only missing columns, via `pragma_table_info`). `public/index.html` preloads the static module graph
  (`rel="modulepreload"`, checked by `test/schema.test.js`; add new statically imported modules there) and loads Google Fonts without blocking paint. Dashboard money
  widgets load after the first paint.
- Hub calendar, files and mail (Nov 2026): work with or without Google. Calendar `#/calendar` (`public/hub/apptcal.js`, `src/hubcal.js`, `src/appointments.js`
  `appointmentItems`): month and list, "New appointment" form (click an empty day), edit and delete (table `events`, owners see all, teammates their own), booked
  audits and client meetings show too. Private calendar feed per person (`users.cal_token`, `GET /api/public/cal/<token>.ics`, `POST /api/me/calendar-feed` new link)
  for Google, Apple and Outlook; guest invites with the .ics attached (`sendEmail` takes `attachments`, `from`). `public/js/ics.js` is pure. Files `#/files` and the
  client Files tab (`src/files.js`, `public/hub/files.js`): R2 `files/<id>`, tables `hub_files`, `file_folders`, share links `/api/public/f/<token>`, 25 MB; the client
  tab also shows the Drive folder when Drive is on. Mail (`src/hubmail.js`, `public/hub/hubmail.js`): Resend as "Name (Rightway Growth)", Reply-To the person, logged
  in `mail_log` and on timelines. Google comes first when connected (`public/hub/gstate.js` `hasGoogle(app)`, 60 s cache of `/api/google/status`): `#/mail`
  opens Gmail, lead and client Email buttons use the Gmail composer, "Add appointment" and the client calendar button make a Google event with Meet; otherwise
  the Hub versions. Google menu item is back.
- Google Calendar scope fix (Nov 2026): the base scope is now full `https://www.googleapis.com/auth/calendar` (`CAL_SCOPE`). With only `calendar.events` Google
  refuses `calendarList` (403 insufficient scopes), which broke the Calendar page and "Check connection" no matter how often boxes were ticked. `calendarFull`,
  `calendarAny` in `src/google.js`; `grantedApps` counts Calendar only with the full scope (so the Google page shows Turn on again), `ownFor('calendar')` and
  booking accept either; `/api/google/cal/calendars` falls back to the primary calendar (`limited`). The check names the one time fix. Refresh failures say why
  (`invalid_grant` = the 7 day limit while the Google app is External and in Testing).
- Booking v2 (Nov 2026, `src/google.js` public routes, `public/js/book.js`): times in the visitor's time zone (sent as `tz`, saved on the lead), required fields
  `BOOK_FIELDS` checked by `bookingProblem` (pure, returns `{field, error}` with status 400; the page highlights and focuses the field, `novalidate`), optional
  text consent box (sets `sms_consent`). Personal link per lead (`leads.book_token`, `bookToken` in `src/automations.js`, `GET /api/leads/:id/book-link`, lead panel
  "Booking link", automations `{book}`): `GET /api/public/book?l=` returns what we know, the page fills it in and asks only for the gaps, the POST books that same lead
  and fills empty fields. Google first: `createMeeting` (or `moveMeeting` on a rebook) with Meet and Google's invite; if Google fails the booking still stands with the
  backup link (settings `book_link`) and owners are told. Who gets it: settings `book_rep` (a user, `rr` round robin by fewest upcoming, or owners), sets `meet_by`.
  `hubBusy` also blocks Hub `events` of that person (or owners). Double booking guard re-checks right before saving (409). Confirmations go out at once
  (`automationTick` through `defer`), and automation emails for booked/before carry the .ics plus a Google Calendar link unless Google already sent an invite
  (`gcal_event_id`). Settings "Online booking" card is always shown (meeting name, hours, days, buffer, notice, window, time zone, who takes bookings, backup link).
- Drive fix (Nov 2026): the Drive page sent `orderBy=mimeType = '...folder' desc, ...`, which Drive refuses ("Invalid Value"); `listParams` in `src/gdrive.js`
  now sorts `folder,<sort>` using only `SORT_KEYS`. "Check connection" runs that same list call for Drive (and an INBOX threads call for Gmail), so a passing
  check means the page works. The Drive test mock rejects unknown sort keys like Google does.
- Team calendar and closers (Nov 2026, `src/teamcal.js`, `public/hub/teamcal.js` Settings card): `leads.closer_id` = who runs the call (`meet_by` stays the booker;
  `closerOf` falls back to meet_by). `closerConflict` checks the closer's other audits, Hub `events` and their Google busy times; the lead booking modal has
  "Who runs the call" with busy people marked (`GET /api/closers/free`) and a 409 `{conflict}` that asks "Book it anyway?" (`force`); the lead panel has "Runs the
  call" (`PUT /api/leads/:id/closer`, same check, adds the closer to the invite, notifies them). `inviteLead` sends the lead's Google invite with Meet from the closer's
  calendar, else the booker's, else the booking owner's, with the closer as a guest; moves and handovers PATCH the same event (`gcal_owner`, `gcal_cal`). Master
  calendar (settings `master_cal` {id, name, owner}): "Make the team calendar" creates it in the owner's Google (or pick an existing one) and shares it (ACL: owners
  writer, teammates reader). Every lead appointment and Hub event gets a copy there, titled "Closer: Business", coloured per closer, no guests, `sendUpdates=none`
  (`leads.master_event_id`/`master_sig`, `events.master_event_id`/`master_sig`); copies are written right away and reconciled by `masterTick` in the cron (6 a run,
  "Sync now" 15); lost or cleared appointments are removed. `inviteTick` sends invites for booked leads that never got one (dial out Booked, teammates without
  Google). Booking page: `book_rep` one person or `rr` gives per closer free times (`openTimes`, `closerBusy`) and books someone free (`pickCloser`, fewest upcoming);
  owners mode stays one booking per time. Visibility (`canSeeAppt`, `apptScope`, Hub calendar) includes the closer; Hub calendar labels audits "Closer: Business".
  Menu: Mail removed (Gmail lives under Google; `#/mail` still routes), Files moved to Settings (`#/settings/files`, `#/files` redirects).
- Cold call v10 and I/we (Nov 2026, `SCRIPT_VERSION` 10, `public/js/leadintel.js`): V's frame. Steps `k_open` (owner picks up, "you broke up there" only when true),
  `k_site` (no website opener, only shows when the lead has no site, only use when the demo site is built), `k_hook` (pattern interrupt "you guys are still open, right?",
  truthful hours version when Google shows no hours, then the intro slipped in, never "consultant"), `k_why` (free tailored plan; the "looked you up" line only after
  research, `strategy_note` otherwise), `k_value`, `k_teach` (competitor breakdown before booking), `k_book` (book on this call, `nextSlots` offers today), `k_after`
  (7 discovery questions after booking), `k_lock`, gatekeeper, voicemail; vars in `coldVars`. Lines that are only an empty variable are dropped, and empty steps too.
  Agent or owner: work someone else may have done reads "I/we", team facts "we", the founder story "I/our founder" (owner says I, others "our founder, Vidal").
  Print copy: `PRINT_VARS` in `public/js/scriptprint.js`; PDFs in `public/training/` made from the scratchpad generator (`final/gen.mjs` + Playwright `page.pdf`).
  Docs updated: "Rightway Growth Cold Call Script" and "Google Clarity Call Script".
- Automation sets (Nov 2026, `AUTOMATION_SETS` in `src/automations.js`, picker on the Automations page, settings `automation_set`): Email only (now, until A2P),
  Text only, Email and text. Each: confirmation at booking with the Meet link, the morning of (`morning` trigger: clock time in the lead's time zone, only when the
  meeting is 4+ hours later), 3 hours before, 10 minutes before, in V's words. Texts with `fallback` go as email when the text cannot go. A line that is only a
  meeting link becomes a Join button (`emailHtml`). `{meet_line}`, `{meet_or_call}`, `{rep_first}`. Switching sets marks booked confirmations for already booked
  leads as skipped. Booked sends wait up to 3 minutes for the Google Meet link.
- Google is personal, owners are the agency (Nov 2026): every user connects their own Google (dashboard prompt, agent Settings card); a teammate's account is only
  used for that teammate (`userFor` falls back to owners only; `inviteLead` uses the closer's own calendar or the owner booking calendar, never a booker's).
  `googleHealthTick` (cron, every 6 h) alerts once when a sign in ends (`users.google_alerted`), owners too when it is the booking or team calendar account.
- Agent lockdown (Nov 2026): role `team` never reaches the Vault (`requireAdmin`), Payments, Budget, Automations, company Files (client folders stay open), the
  master lead export, Sheets exports, client billing, Stripe ids or MRR (stripped from `/api/clients`, `/api/clients/:id`, `/api/dashboard`), or the settings back end
  (`GET /api/settings` returns only the script and voicemail number for agents). Menus hide Vault and Automations; the router sends agents away from owner pages;
  agent Settings shows only their Google, their dialer phone and the team calendar.
- Agent jobs (Nov 2026, `public/js/jobs.js` pure and shared, `users.job`): every agent (role team) is a closer, scheduler or appointment setter
  (`JOBS`, `JOB_CAPS`; no job = setter). Abilities: dial, book (all), schedule (scheduler, closer: see every appointment, move and hand over anyone's),
  close (closer: quote, work order, payment link, convert, deep scan, presentation, scan tool), deliver (closer: Clients, My work and every client route).
  Owners pass everything. Enforced once in the `src/hub.js` dispatch (`capFor` path rules, `CAP_DENY` messages; client view `x-view-as` needs close),
  the scan tool staff session in `src/worker.js` needs close, `present.js` refuses non-closers. Only closers and owners run calls (`CLOSER_SQL`,
  `runsCalls`, `autoCloser` in `src/teamcal.js`): booking from a lead with `closer_id: 'auto'` (or a setter without a pick) goes to the free closer with
  the fewest upcoming calls (409 when all are busy); a dialer Booked by a setter does the same, or leaves it unassigned and notifies owners, schedulers
  and closers. Setters move or hand over only their own bookings (403 otherwise); a scheduler's move keeps the original `meet_by`. Round robin booking,
  `book_rep` and `/api/closers/free` list closers and owners only. `canSeeAppt`/`apptScope`/`appointmentItems`/Hub events: `can(user, 'schedule')` sees all.
  UI: NAV fifth field is 'admin' or an ability, router sends agents away from work/clients pages, palette skips them, lead panel hides Close the deal and
  Present, pickers offer "First free closer". Agents page: Job on invite and per agent (`PUT /api/users/:id/job`); `currentUser` and `/api/me` return `job`.
- Data scrubber (Nov 2026, our own Outscraper style cleanup; pure part `public/js/scrub.js`, server `src/scrub.js`): `cleanName` (SEO tails after
  | - : separators with filler words, city or state, parenthetical filler, LLC/Inc/Corp endings, all caps or all lowercase to title case; mixed case and
  brand names with the city inside are left alone), `phoneInfo` (NANP shape, toll free, premium; same problem words as `scrubReason`), `emailInfo` and
  `pickEmail` (role, free, disposable, placeholder from site code; own domain person first), `extractContacts` (mailto and text emails, Facebook,
  Instagram, LinkedIn, YouTube, TikTok, X, Yelp, Nextdoor, Google links, tel links, owner name from schema founder and Owner/Founder/"founded by" text),
  `contactLinks` (same site contact and about pages), `dataScore` (0 to 100 plus what is missing). `scrubLead` reads the home page plus up to two
  contact or about pages, checks email domains for MX over Cloudflare DNS over HTTPS (free), optional Twilio Lookup line type (settings `scrub_lookup`,
  about $0.008 a number) and saves `business` (original kept in `business_raw`), `phone_type`, `phone_carrier`, `email` (only if empty),
  `email_status`, `owner_name` (and `contact_name` if empty), `socials`, `data_score`, `scrub_data`, `scrubbed_at`; bad and toll free numbers on
  untouched leads are scrubbed out. New leads get the name cleaned at insert (`cleanNewLead` in `insertLead` and import) and are queued
  (`scrub_queued`, settings `scrub_auto` on by default); `scrubTick` runs 3 per cron run and 2 per `POST /api/scrub/tick` (the open dialer nudges it).
  Routes: `POST /api/leads/:id/scrub`, `POST /api/scrub/queue {ids | all (owners)}`, `GET /api/scrub/status`, `PUT /api/scrub/settings`.
  UI: pipeline "Call lists" chips (best data, mobile, owner known, email a person, no website, under 20 reviews, not on page one; switch to list view,
  sorted), data filters (phone type, email, owner, scrubbed, data score), Data column, bulk Scrub and "Scrub the N not scrubbed yet" (browser runs 3 at
  a time, over 400 goes to the background queue), Lead data card on the lead panel, dialer Data filter (mobile, owner known, has email; the queue sorts
  better data first among equals; "Dial this list" carries it), scrubber settings under Lead research in Settings.
- Script DO notes (Nov 2026): coaching notes are no longer grey italic. Hub call prep and the Training reader show them upright on a yellow strip with a
  black DO tag (`.say-note`, `.script-read .cue`, `.do-tag`); notes inside a spoken line get an inline DO mark via `markCues` in `public/js/scriptprint.js`
  (spoken asides like "No stress if not" stay). PDFs use the same style (scratchpad `final/gen.mjs`). The Docs mark them with a bold "DO:" on their own line.
- Script voices and location (Nov 2026): the owner copy of every script says "I", the team copy says "we". Source text marks the spots as `I/we` and
  `I/our founder`; `voiceText(text, voice)` in `public/js/leadintel.js` (pure) turns them into I or we (the founder story becomes "our founder Vidal").
  `buildScript(..., { voice })`, `scriptSteps(group, script, voice)`, `objectionGroups(list, voice)` take it; owners (role admin) get `I`, everyone else
  `we` (call prep, presenter notes, Training). Training lets an owner flip to the team copy. Four PDFs in `public/training/` (cold and clarity, owner and
  `-Team`), made with `VOICE=we node gen.mjs`. The company is Miami and Fort Lauderdale based: say that in copy, not Hollywood (only the legal address in
  `public/js/agreement.js` stays). Do not bring up GoHighLevel, V is cancelling it.
- Hub opening animation and tour (Nov 2026): `public/hub/intro.js` plays once per browser session, `public/hub/tour.js` offers a spotlight tour once per
  person (job aware steps, `tour:hub` in `/api/me/training`), replayable from Training, Hub tour.
- Not built yet: publishing to Meta (needs Meta app review; posts are copied). Google Maps key not added yet (V will come back to it). Follow the Package build-out tab.
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
- Map (`public/js/map.js`, one API for the scan tool and the Hub): Google Maps JavaScript API when `GOOGLE_MAPS_KEY` (browser key, restricted
  to the Hub address and Maps JavaScript API) is set, served by public `GET /api/maps/config`; rank pins and the heat map draw in an `OverlayView`,
  POI clutter hidden, cooperative gestures. Without a key, or if Google refuses it (`gm_authFailure`) or fails to load, it falls back to our own
  OpenStreetMap tile renderer (attribution required). Markers show at once on a blank map while Google loads, then swap. QR codes: `public/js/qr.js`
  (own encoder, verified with OpenCV).
- Secrets live in Cloudflare's Build "Variables and secrets" (V's setup). `scripts/bake-secrets.mjs` copies them into the deployed
  Worker; runtime dashboard secrets override. Keys: DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD, ACCESS_KEY, PAGESPEED_KEY,
  ANTHROPIC_API_KEY, ANTHROPIC_MODEL (default claude-haiku-4-5-20251001), RESEND_API_KEY, EMAIL_FROM, STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_MAPS_KEY. Keep `src/runtime-secrets.js`
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
