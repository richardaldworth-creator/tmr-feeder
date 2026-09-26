// Offline cache for Inspection Notes. Bump the version whenever app files change.
const CACHE = 'inspection-notes-v3';
const FILES = ['./', 'index.html', 'app.js', 'voice.js', 'gallery.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'lib/jszip.min.js', 'lib/docx.umd.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // Network first so updates arrive when there is signal, falling back to the cache on site.
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
