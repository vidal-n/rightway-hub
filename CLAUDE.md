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
  user's own Google account if it has the app, else an owner's. Not tested against live Google yet.
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
- Slack page (built, `src/slackuser.js`, `public/hub/slackapp.js`, menu item "Slack", `#/slack/<channel>`): each person's own Slack inside the Hub.
  Sign in with Slack (OAuth v2 user scopes `USER_SCOPES` in `src/slack.js`; owners save the app's Client ID and Secret, `PUT /api/slack/app`, secret sealed;
  redirect `/api/slack/oauth/callback`); the user token is sealed in `users.slack_token` with `users.slack_uid`. Every `/api/slack/me/*` call uses the asking
  person's own token, so nobody (owners included) can read someone else's Slack. Conversations (users.conversations, names from the `slack_people` cache),
  history and threads (5 s polling while open, opening marks read and calls conversations.mark), send, edit, delete, reactions, files (files.getUploadURLExternal
  then completeUploadExternal; images and files shown through `/api/slack/me/file`, files.slack.com only), new DM (users.list, conversations.open), and
  "Share from the Hub" (`itemMessage`: client, lead, task, report) also on the task panel and client header ("Send in Slack", `sendToSlack`).
  Events API `/api/slack/events` (signed, url_verification, retries deduped in `slack_events`): `onSlackMessage` adds unread counts for Hub members of that
  conversation (`slack_members` saved when the list loads, `slack_unread`), and DMs or @mentions push (notify kind `slack`, `list: false`). The manifest adds
  user scopes, the redirect URL and user events; owners paste the new manifest in the app's App Manifest page.
- Client Messages (built, `src/chat.js`, `public/hub/chat.js`, client app tab "Messages" `#/messages`, staff client tab `chat` "Messages"): clients chat with the
  team without a Slack account. Each client gets a private Slack channel (`POST /api/clients/:id/chat/setup` makes `chat-<client>` and invites the account
  manager and linked owners, or picks an existing one; `clients.chat_channel`), separate from the internal update channel (`slack_channel`). Client posts go
  through the bot with their name (`chat:write.customize`, metadata `rw_client_msg`); team posts from the Hub use the person's own Slack token or the bot with
  "Name (Rightway Growth)". History via the bot (thread replies shown inline), files through `files.info` checked against the channel. Team replies written
  in Slack arrive by bot events (`onClientChat`): unread count for the client's users (`slack_unread`) and a push (kind `update`); Hub posts are remembered in
  `chat_posts` so they are not counted twice. Client dot: `GET /api/client-badges`. Everything in the chat channel is visible to the client.
- Menu and dots (built, `public/hub/nav.js`, `src/nav.js`): menu items in `NAV` (Dashboard, My work, Slack, Phone, Pipeline, Clients, Payments, Client view,
  Scan tool, Google, Alerts, Settings). Each person reorders and hides items ("Customize menu", `users.nav_prefs`, `PUT /api/me/nav`). Under 900 px a bottom bar
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
