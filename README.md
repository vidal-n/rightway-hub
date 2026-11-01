# Rightway Hub

Rightway Growth's internal tools. Phase 1 is the **scan tool**: pick a business, run a Google Maps grid scan for a keyword, and get an audit report for Call 2 (map, top competitors, Google profile gaps, category gaps, phone speed test, and the plan math). Print it or save it as a PDF.

## Put it online (one time, about 15 minutes)

1. **Connect the repo to Cloudflare.** In the Cloudflare dashboard go to **Workers & Pages**, click **Create**, choose **Import a repository**, connect GitHub if asked, and pick `rightway-hub`.
   - Project name: `rightway-hub`
   - Build command: leave empty
   - Deploy command: `npx wrangler deploy`
   - Click **Deploy**. It goes live on a `workers.dev` address in demo mode (sample data, no charges).
2. **Add the secrets.** Open the `rightway-hub` Worker, go to **Settings**, then **Variables and Secrets**, and add each as type **Secret**:
   - `DATAFORSEO_LOGIN`: the API login from DataForSEO (dashboard, API Access)
   - `DATAFORSEO_PASSWORD`: the API password from the same page
   - `ACCESS_KEY`: a long password you make up. You and Kiron type it once per browser.
   - `PAGESPEED_KEY` (optional): a Google API key for PageSpeed Insights. It works without one, with lower limits.
3. **Give it a clean address.** In the Worker, go to **Settings**, then **Domains & Routes**, click **Add**, choose **Custom domain**, and enter `hub.rightwaygrowth.com`.
4. **Lock it down (recommended).** In Cloudflare **Zero Trust**, go to **Access**, then **Applications**, add a **Self-hosted** app for `hub.rightwaygrowth.com`, and allow only your email and Kiron's. Free for up to 50 users.

Every push to the `main` branch redeploys automatically.

## Costs

Each grid point is one DataForSEO request at about $0.002. A 7 x 7 scan is 49 points, about $0.10. A business search is about $0.002.

## For developers

- `npm test` runs the unit tests (Node 20+, nothing to install).
- `npm run local` serves the app at http://localhost:8787 in demo mode.
- See `CLAUDE.md` for architecture and conventions.
