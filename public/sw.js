// Service worker: makes the Hub installable and keeps the app shell available on a weak connection.
// API calls always go to the network, so data is never stale.
const CACHE = 'rw-hub-b6b0e2f4a4fd';
const SHELL = ['/', '/index.html', '/hub.css', '/styles.css', '/app.js', '/manifest.webmanifest', '/hub/agents.js', '/hub/alerts.js', '/hub/app.js', '/hub/appfeel.js', '/hub/apptcal.js', '/hub/assistant.js', '/hub/audioset.js', '/hub/automations.js', '/hub/avail.js', '/hub/avatar.js', '/hub/balances.js', '/hub/budget.js', '/hub/bugs.js', '/hub/calltools.js', '/hub/calltrack.js', '/hub/chat.js', '/hub/citations.js', '/hub/clientmore.js', '/hub/content.js', '/hub/core.js', '/hub/costhint.js', '/hub/crash.js', '/hub/crm.js', '/hub/dialout.js', '/hub/dialwin.js', '/hub/dispo.js', '/hub/files.js', '/hub/fillin.js', '/hub/finder.js', '/hub/gbp.js', '/hub/gcal.js', '/hub/gdrive.js', '/hub/googleapps.js', '/hub/gstate.js', '/hub/home.js', '/hub/hovercard.js', '/hub/hub.css', '/hub/hubmail.js', '/hub/infomail.js', '/hub/intro.js', '/hub/leaddb.js', '/hub/leader.js', '/hub/leadinsights.js', '/hub/lines.js', '/hub/mail.js', '/hub/meet.js', '/hub/meetings.js', '/hub/meta.js', '/hub/micquick.js', '/hub/multiselect.js', '/hub/nav.js', '/hub/notifpanel.js', '/hub/onboarding.js', '/hub/payments.js', '/hub/phone.js', '/hub/phonehub.js', '/hub/photos.js', '/hub/plays.js', '/hub/portal.js', '/hub/practice.js', '/hub/prep.js', '/hub/presentmode.js', '/hub/pull.js', '/hub/qualform.js', '/hub/quickbar.js', '/hub/reports.js', '/hub/resume.js', '/hub/scans.js', '/hub/schedule.js', '/hub/scope.js', '/hub/scriptpane.js', '/hub/shared.js', '/hub/shell.js', '/hub/siteaudit.js', '/hub/slack.js', '/hub/slackapp.js', '/hub/slacktext.js', '/hub/social.js', '/hub/socialauto.js', '/hub/socialclient.js', '/hub/spend.js', '/hub/splash.js', '/hub/staff.js', '/hub/stripesetup.js', '/hub/swipe.js', '/hub/teamcal.js', '/hub/testdial.js', '/hub/texts.js', '/hub/tour.js', '/hub/training.js', '/hub/uiprefs.js', '/hub/vault.js', '/hub/widgets.js', '/hub/work.js', '/js/agreement.js', '/js/analysis.js', '/js/apptime.js', '/js/audiocfg.js', '/js/avail.js', '/js/book.js', '/js/calgrid.js', '/js/callstats.js', '/js/charts.js', '/js/cities.js', '/js/denoise-worklet.js', '/js/fillin.js', '/js/finder.js', '/js/fmtcache.js', '/js/freedata.js', '/js/fulfill.js', '/js/gmailparse.js', '/js/grid.js', '/js/guides.js', '/js/ics.js', '/js/infomail.js', '/js/jobs.js', '/js/layout.js', '/js/leaddb.js', '/js/leadfilter.js', '/js/leadintel.js', '/js/lifeforce.js', '/js/listings.js', '/js/map.js', '/js/mapsimport.js', '/js/meta.js', '/js/names.js', '/js/pack.js', '/js/packview.js', '/js/phonefind.js', '/js/plancopy.js', '/js/planref.js', '/js/plays.js', '/js/practice.js', '/js/present.js', '/js/pricing.js', '/js/qr.js', '/js/registries.js', '/js/resumestate.js', '/js/sanitize.js', '/js/schedule.js', '/js/scope.js', '/js/scriptprint.js', '/js/scrub.js', '/js/slots.js', '/js/social.js', '/js/socialplan.js', '/js/swipe.js', '/js/testleads.js', '/js/timezone.js', '/js/webprice.js', '/brand/rightway-logo-dark.svg', '/brand/rightway-logo-email.png', '/brand/rightway-logo-light.svg', '/brand/rightway-mark-light.svg'];

self.addEventListener('install', (e) => {
  // Every script and style is fetched fresh into this version's cache. One failed file never blocks the update.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' }))))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Static files (scripts, styles, pictures) come from this version's cache, so opening the Hub costs no round trip per file (it used to
// re-check all ~85 of them on every open). The cache name carries a hash of everything in public/ (scripts/stamp-sw.mjs, run on deploy and
// checked by test/swstamp.test.js), so a new deploy gets a new cache and every file is fetched fresh together. Pages (navigations) stay
// network first, the API is never cached.
const STATIC = /\.(?:js|css|svg|png|jpg|jpeg|webp|ico|woff2?|webmanifest)$/;
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/r/') || url.pathname.startsWith('/training/')) return;
  const nav = e.request.mode === 'navigate';
  if (!nav && url.pathname !== '/sw.js' && STATIC.test(url.pathname)) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(url.pathname);
      if (hit) return hit;
      const res = await fetch(new Request(e.request, { cache: 'no-cache' }));
      if (res.ok) c.put(url.pathname, res.clone());
      return res;
    }).catch(() => fetch(e.request)));
    return;
  }
  // Pages: network first and always revalidated, cache only as an offline fallback. A missing script never gets the home page back in its place.
  const req = nav ? e.request : new Request(e.request, { cache: 'no-cache' });
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && SHELL.includes(url.pathname)) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || (nav ? caches.match('/') : Response.error()))),
  );
});

// Push notifications: calls, texts, voicemails, tasks and client updates. Calls stay on screen and buzz longer.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Rightway Hub', body: e.data ? e.data.text() : '' }; }
  const urgent = Boolean(d.urgent);
  e.waitUntil(self.registration.showNotification(d.title || 'Rightway Hub', {
    body: d.body || '', tag: d.tag || undefined, renotify: Boolean(d.tag), requireInteraction: urgent,
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: d.url || '/' },
    vibrate: urgent ? [400, 200, 400, 200, 400, 200, 400, 200, 400] : [150, 80, 150],
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) { c.navigate?.(target).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(target);
  }));
});
