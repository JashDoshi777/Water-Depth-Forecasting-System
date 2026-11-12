/* AquaDepth service worker: app shell + static assets. /api is never cached,
   except an offline fallback for GET-like ML forecast responses (last good copy). */
const VER = 'v1';
const SHELL = `aquadepth-shell-${VER}`;
const ASSETS = `aquadepth-assets-${VER}`;
const FORECAST = `aquadepth-forecast-${VER}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => ![SHELL, ASSETS, FORECAST].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// POST bodies can't be cache keys; key forecast responses by request body.
async function forecastKey(req) {
  const body = await req.clone().text();
  return new Request(`${new URL(req.url).origin}/__forecast__?b=${encodeURIComponent(body)}`);
}

self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/api/v1/ml/forecast') {
    e.respondWith((async () => {
      const key = await forecastKey(req);
      const cache = await caches.open(FORECAST);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(key, res.clone());
        return res;
      } catch {
        const hit = await cache.match(key);
        if (hit) { const h = new Headers(hit.headers); h.set('X-AquaDepth-Offline', '1'); return new Response(hit.body, { status: 200, headers: h }); }
        return new Response(JSON.stringify({ detail: 'Offline and no cached forecast' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }
  if (url.pathname.startsWith('/api')) return; // never cache the rest of the API
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { caches.open(SHELL).then((c) => c.put('/', res.clone())); return res; }).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/') || /\.(png|svg|webmanifest|woff2?)$/.test(url.pathname)) {
    e.respondWith(caches.open(ASSETS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
  }
});
