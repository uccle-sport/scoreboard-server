// Service Worker for PWA functionality
const CACHE_NAME = 'scoreboard-v1';
const urlsToCache = [
  '/admin/',
  '/admin/index.html',
  '/admin/manifest.json',
  '/admin/favicon.svg',
  '/admin/favicon.ico',
  '/admin/icons/icon-192.png',
  '/admin/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  // Skip waiting to activate immediately
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache).catch((err) => {
        console.error('Cache addAll error:', err);
      });
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Cache strategy for different resource types
  event.respondWith(
    caches.match(event.request).then((response) => {
      // Cache hit - return response
      if (response) {
        return response;
      }

      return fetch(event.request).then((response) => {
        // Don't cache non-successful responses
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }

        // Check if this is a cacheable resource
        const shouldCache =
          url.pathname.startsWith('/admin/assets/') || // JS and CSS bundles with hashes
          url.pathname.startsWith('/admin/icons/') ||
          url.pathname === '/admin/' ||
          url.pathname === '/admin/index.html' ||
          url.pathname === '/admin/manifest.json' ||
          url.pathname.endsWith('.svg') ||
          url.pathname.endsWith('.ico');

        if (shouldCache) {
          // Clone the response
          const responseToCache = response.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }

        return response;
      }).catch((error) => {
        console.error('Fetch failed:', error);
        // If offline and no cache, return a basic offline page
        if (url.pathname === '/admin/' || url.pathname === '/admin/index.html') {
          return caches.match('/admin/index.html');
        }
        throw error;
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

