const SW_VERSION = 'v16';
const SHELL_CACHE = `home-care-shell-${SW_VERSION}`;
const RUNTIME_CACHE = `home-care-runtime-${SW_VERSION}`;

const CORE_ASSETS = [
  '/offline.html',
  '/manifest.json',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png'
];

const STATIC_EXTENSIONS = /\.(?:css|js|png|jpg|jpeg|webp|svg|ico|json|woff2?)$/i;
const SENSITIVE_QUERY_KEYS = new Set(['token', 'session_id', 'payment', 'billing', 'portal']);

function isSensitiveUrl(url) {
  if (url.pathname.startsWith('/api/')) return true;
  if (url.pathname.startsWith('/uploads/')) return true;
  for (const key of SENSITIVE_QUERY_KEYS) {
    if (url.searchParams.has(key)) return true;
  }
  return false;
}

function isCacheableStatic(url) {
  return STATIC_EXTENSIONS.test(url.pathname)
    || url.pathname === '/offline.html'
    || url.pathname === '/manifest.json';
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch(() => null)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('home-care-') && ![SHELL_CACHE, RUNTIME_CACHE].includes(key))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;

  if (isSensitiveUrl(url)) {
    if (request.mode === 'navigate') {
      event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => caches.match('/offline.html')));
    }
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .catch(() => caches.match('/offline.html'))
    );
    return;
  }

  if (!isCacheableStatic(url)) return;

  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => null);
        }
        return response;
      })
      .catch(() => caches.match(request).then((res) => res || caches.match('/offline.html')))
  );
});
