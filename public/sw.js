// Service worker: makes the Hub installable and keeps the app shell available on a weak connection.
// API calls always go to the network, so data is never stale.
const CACHE = 'rw-hub-v30';
const SHELL = ['/', '/index.html', '/hub.css', '/hub/app.js', '/hub/core.js', '/hub/shared.js', '/hub/staff.js', '/hub/portal.js', '/hub/crm.js', '/hub/prep.js', '/hub/texts.js', '/hub/home.js', '/hub/dialout.js', '/hub/phone.js', '/hub/calltools.js', '/hub/dispo.js', '/hub/payments.js', '/hub/stripesetup.js', '/hub/scans.js', '/hub/reports.js', '/hub/content.js', '/hub/siteaudit.js', '/hub/calltrack.js', '/hub/citations.js', '/hub/leader.js', '/js/sanitize.js', '/hub/googleapps.js', '/hub/onboarding.js', '/hub/work.js', '/hub/meetings.js', '/hub/gbp.js', '/hub/alerts.js', '/hub/slack.js', '/hub/slackapp.js', '/hub/slacktext.js', '/hub/chat.js', '/hub/assistant.js', '/hub/nav.js', '/js/guides.js',
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
