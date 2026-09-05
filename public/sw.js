// DC Agent PWA service worker
const CACHE = 'dc-agent-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return; // API hamesha fresh network se
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request)).then(r => r || caches.match('/'))
  );
});
