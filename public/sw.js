'use strict';

const SW_VERSION = 'home-care-v43';
const STATIC_CACHE = `${SW_VERSION}-static`;
const STATIC_ASSETS = [
  '/offline.html',
  '/app.css?v=43',
  '/app.js?v=43',
  '/operations-v2.css?v=43',
  '/guided-checks-v2.css?v=43',
  '/operations-v2.js?v=43',
  '/guided-checks-v2.js?v=43',
  '/runtime-stability-v43.js?v=43',
  '/pwa-v43.js?v=43',
  '/manifest.json?v=43',
  '/icon.svg?v=43',
  '/icon-192.png?v=43',
  '/icon-512.png?v=43',
  '/apple-touch-icon.png?v=43',
  '/favicon.ico?v=43',
];

function isSensitive(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/');
}

function isStatic(url) {
  return /\.(?:css|js|png|jpg|jpeg|webp|svg|ico|json|woff2?)$/i.test(url.pathname)
    || url.pathname === '/offline.html'
    || url.pathname === '/manifest.json';
}

async function cacheStaticAssets() {
  const cache = await caches.open(STATIC_CACHE);
  for (const asset of STATIC_ASSETS) {
    const response = await fetch(asset, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Asset PWA non disponibile: ${asset}`);
    const url = new URL(asset, self.location.origin);
    if (/\.(?:png|ico)$/i.test(url.pathname) && !String(response.headers.get('content-type') || '').startsWith('image/')) {
      throw new Error(`Asset PWA non valido: ${asset}`);
    }
    await cache.put(asset, response);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheStaticAssets().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('home-care-') && key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirst(request, fallback) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(STATIC_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    return (await caches.match(request))
      || (await caches.match(request, { ignoreSearch: true }))
      || (fallback ? caches.match(fallback) : undefined)
      || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname === '/sw.js') return;
  if (isSensitive(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/offline.html'));
    return;
  }
  if (!isStatic(url)) return;
  event.respondWith(networkFirst(request));
});
