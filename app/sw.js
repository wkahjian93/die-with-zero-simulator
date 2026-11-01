// Offline support: keep the game files on the phone so it opens without internet.
const CACHE = 'dwz-__VERSION__';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first for the game page (gets updates), cache first for everything else (fonts, icons).
self.addEventListener('fetch', e => {
  const req = e.request;
  // Room server calls must always be live, never a saved copy.
  if (req.method !== 'GET' || new URL(req.url).pathname.startsWith('/api/')) return;
  const isPage = req.mode === 'navigate';
  e.respondWith(isPage
    ? fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)); return res; })
        .catch(() => caches.match('index.html'))
    : caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })));
});
