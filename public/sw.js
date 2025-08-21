const CACHE = 'gpt-deadline-v1';
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(['/', '/index.html', '/manifest.webmanifest']);
  })());
});
self.addEventListener('fetch', (e) => {
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) return cached;
    try { return await fetch(e.request); } catch (err) {
      return new Response('Offline', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
