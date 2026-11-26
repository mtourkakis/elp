// Offline support: recordings are kept once downloaded; pages and questions are refreshed when online.
const C = 'elp-offline-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET') return;
  const cacheFirst = () => caches.open(C).then(c => c.match(req, { ignoreSearch: true }).then(r => r ||
    fetch(req).then(n => { if (n.ok) c.put(req, n.clone()); return n; })));
  if (u.origin === location.origin && /\/(audio|enc)\//.test(u.pathname)) { e.respondWith(cacheFirst()); return; }
  if (u.origin === location.origin) {
    e.respondWith(fetch(req).then(n => { if (n.ok) { const cl = n.clone(); caches.open(C).then(c => c.put(req, cl)); } return n; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./', { ignoreSearch: true }))));
    return;
  }
  if (/fonts\.(googleapis|gstatic)\.com/.test(u.host)) e.respondWith(cacheFirst());
});
