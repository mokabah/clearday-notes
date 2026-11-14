// Cache-first offline support for the app shell. Task data lives in localStorage, never here.
const CACHE = 'clearday-notes-v0.1.0';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'src/ui/styles.css', 'src/ui/app.js', 'src/ui/dom.js',
  'src/core/dates.js', 'src/core/parser.js', 'src/core/store.js', 'src/core/sample.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
