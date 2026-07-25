'use strict';

const SW_VERSION = 'home-care-v42';
const STATIC_CACHE = `${SW_VERSION}-static`;
const STATIC_ASSETS = [
  '/offline.html',
  '/app.css',
  '/app.js',
  '/operations-v2.css',
  '/guided-checks-v2.css',
  '/operations-v2.js',
  '/guided-checks-v2.js',
  '/pwa-v2.js',
  '/manifest.json?v=42',
  '/icon.svg?v=42',
  '/icon-192.png?v=42',
  '/icon-512.png?v=42',
  '/apple-touch-icon.png?v=42',
  '/favicon.ico?v=42',
];

function isSensitive(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/');
}

function isStatic(url) {
  return /\.(?:css|js|png|jpg|jpeg|webp|svg|ico|json|woff2?)$/i.test(url.pathname)
    || url.pathname === '/offline.html'
    || url.pathname === '/manifest.json';
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
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

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname === '/sw.js') return;
  if (isSensitive(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => caches.match('/offline.html')));
    return;
  }
  if (!isStatic(url)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
