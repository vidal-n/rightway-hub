// Service worker: makes the Hub installable and keeps the app shell available on a weak connection.
// API calls always go to the network, so data is never stale.
const CACHE = 'rw-hub-v14';
const SHELL = ['/', '/index.html', '/hub.css', '/hub/app.js', '/hub/core.js', '/hub/shared.js', '/hub/staff.js', '/hub/portal.js', '/hub/crm.js', '/hub/prep.js', '/hub/texts.js', '/hub/home.js', '/hub/dialout.js', '/hub/phone.js', '/hub/calltools.js', '/hub/dispo.js', '/hub/payments.js', '/hub/stripesetup.js', '/hub/scans.js', '/hub/reports.js', '/hub/content.js', '/js/sanitize.js', '/hub/googleapps.js', '/hub/onboarding.js',
  '/js/qr.js', '/js/map.js', '/js/grid.js', '/js/analysis.js', '/js/leadintel.js', '/js/leadfilter.js', '/js/fulfill.js', '/js/slots.js', '/js/plancopy.js', '/brand/rightway-logo-dark.svg', '/brand/rightway-logo-light.svg', '/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/r/')) return;
  // Network first, cache as a fallback, so updates show up right away.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && SHELL.includes(url.pathname)) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))),
  );
});
