/* Leaf Viewer service worker: caches the app so it opens offline. */
const CACHE = 'leaf-viewer-v1';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    try { const r = await fetch(e.request); if (r.ok) c.put(e.request, r.clone()); return r; }
    catch { const hit = await c.match(e.request); if (hit) return hit; throw new Error('offline'); }
  }));
});
