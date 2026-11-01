# Rightway Hub

Rightway Growth's agency hub and client app. The Hub (`/`) has logins for the team and every client, the client list, monthly tasks, review requests, photo posts, and rankings. Clients install it on their phone from the browser. The **scan tool** (`/scan.html`) lets you pick a business, run a Google grid scan for a keyword, and get an audit report for Call 2 (map, top competitors, Google profile gaps, category gaps, phone speed test, and the plan math). Print it or save it as a PDF.

## Put it online (one time, about 15 minutes)

1. **Connect the repo to Cloudflare.** In the Cloudflare dashboard go to **Workers & Pages**, click **Create**, choose **Import a repository**, connect GitHub if asked, and pick `rightway-hub`.
   - Project name: `rightway-hub`
   - Build command: leave empty
   - Deploy command: `npx wrangler deploy`
   - Click **Deploy**. It goes live on a `workers.dev` address in demo mode (sample data, no charges).
2. **Add the secrets.** Open the `rightway-hub` Worker, go to **Settings**, then **Variables and Secrets**, and add each as type **Secret**:
   - `DATAFORSEO_LOGIN`: the API login from DataForSEO (dashboard, API Access)
   - `DATAFORSEO_PASSWORD`: the API password from the same page
   - `ACCESS_KEY`: a long password you make up. It creates the owner login and unlocks the scan tool when you aren't logged in.
   - `PAGESPEED_KEY` (optional): a Google API key for PageSpeed Insights. It works without one, with lower limits.
3. **Give it a clean address.** In the Worker, go to **Settings**, then **Domains & Routes**, click **Add**, choose **Custom domain**, and enter `hub.rightwaygrowth.com`.
4. **Don't put Cloudflare Access in front of it.** Clients log in to the Hub, so it has its own logins. Scans and every client page need a login; review links (`/r/...`) are public on purpose.

Every push to the `main` branch redeploys automatically.

## First login

Open the site, enter the ACCESS_KEY, and create the owner login. Then add Kiron from Team and add clients from Clients. Each client gets an invite link you can text them.

## Optional keys (Build secrets)

- `ANTHROPIC_API_KEY`: AI captions that look at the photo. Without it, captions come from templates.
- `RESEND_API_KEY` and `EMAIL_FROM`: send review request emails from the Hub. Without it, the client's own email app opens.

## Costs

Each grid point is one DataForSEO request at about $0.002. A 7 x 7 scan is 49 points, about $0.10. A business search is about $0.002.

## For developers

- `npm test` runs the unit tests (Node 20+, nothing to install).
- `npm run local` serves the app at http://localhost:8787 in demo mode.
- See `CLAUDE.md` for architecture and conventions.
