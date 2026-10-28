// Roundhouse service worker — caches ONLY same-origin static build assets
// (hashed JS/CSS/fonts/icons) so repeat visits load fast on mobile data.
// It never caches API calls, auth, Realtime, Storage or HTML containing data,
// so private event information and proof media are not kept offline.
const CACHE = 'roundhouse-static-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase and anything else: network only
  const isAsset = /\/assets\/.+\.(js|css|woff2?|svg|png|webp)$/.test(url.pathname) || /\/(icon[^/]*\.(svg|png)|apple-touch-icon\.png)$/.test(url.pathname);
  if (!isAsset) return; // HTML, manifest, etc.: network only (GitHub Pages handles 404 fallback)
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }),
  );
});
