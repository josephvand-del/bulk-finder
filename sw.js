// Bulk Finder service worker — network-first for the app itself, so a
// new deploy is never stuck behind a stale cache; the cache is only a
// fallback for when the phone is offline.
// Scope: this file lives at /bulk-finder/sw.js, so it controls
// /bulk-finder/ and nothing else.
var CACHE = 'bulk-finder-v1';
var APP_FILES = [
  './',
  'index.html',
  'manifest.json',
  'styles.css',
  'app.js',
  'model3d.js',
  'instructions.js',
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // Per-file catch: one missing file (e.g. an icon not uploaded
      // yet) must not fail the whole install.
      return Promise.all(APP_FILES.map(function (u) {
        return cache.add(u).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
        return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  // Only GET, and never Range requests (pdf.js fetches with Range).
  if (req.method !== 'GET') return;
  if (req.headers.get('Range')) return;
  var url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // App file: network first, cache only when offline. The network
    // response is cached only if it is a real 200, so an error page
    // can never poison the cache.
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () { return caches.match(req); })
    );
  } else if (url.origin === 'https://cdn.jsdelivr.net') {
    // Versioned CDN scripts (three@0.160.0, pdf.js, supabase-js):
    // immutable URLs, so cache-first is safe.
    event.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
          return res;
        });
      }).catch(function () { return caches.match(req); })
    );
  }
  // Anything else — Supabase API, Edge Functions, LDraw/PDF fetches —
  // gets no respondWith, so the browser fetches it normally, untouched.
});
