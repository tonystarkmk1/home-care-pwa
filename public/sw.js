'use strict';

const SW_VERSION = 'home-care-v40';
const STATIC_CACHE = `${SW_VERSION}-static`;
const STATIC_ASSETS = [
  '/offline.html',
  '/app.css',
  '/app.js',
  '/install-app.js',
  '/manifest.json?v=40',
  '/icon.svg?v=40',
  '/icon-192.png?v=40',
  '/icon-512.png?v=40',
  '/apple-touch-icon.png?v=40',
  '/favicon.ico?v=40',
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
