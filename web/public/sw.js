// Service worker.
//
// Deliberately written by hand instead of generated. It is short enough,
// and the one rule that matters has to be visible:
//
//   /api is NEVER cached.
//
// Reason: when the Cloudflare Access session expires, Cloudflare answers
// with a redirect to the sign-in page. If the service worker held on to
// that, you would get a sign-in form instead of the app while on the go,
// permanently.

// Replaced by the timestamp at build time (see nach-bau.mjs).
// Important: new cache names on every deployment. Otherwise a cached
// index.html points to asset names that no longer exist after
// "rm -rf www/*", and the app no longer starts.
const VERSION = '__BAU__';
const HUELLE = `huelle-${VERSION}`;   // index.html and icons
const DATEIEN = `dateien-${VERSION}`; // built JS and CSS files

const VORRAT = ['/', '/manifest.webmanifest', '/logo.svg', '/logo-192.png', '/logo-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(HUELLE).then((c) => c.addAll(VORRAT)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(
        namen.filter((n) => n !== HUELLE && n !== DATEIEN).map((n) => caches.delete(n)),
      ))
      .then(() => self.clients.claim()),
  );
});

// Only cache what really is a response. Redirects and errors never belong
// in the cache.
function darfGespeichertWerden(antwort) {
  return antwort && antwort.ok && antwort.type === 'basic' && !antwort.redirected;
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // ---- The most important rule ---
  if (url.pathname.startsWith('/api/')) return; // pass through, remember nothing

  // Page loads: network first, otherwise the cached shell. That way you get
  // the new version right after a deployment, and the app even without a
  // network.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((antwort) => {
          if (darfGespeichertWerden(antwort)) {
            const kopie = antwort.clone();
            caches.open(HUELLE).then((c) => c.put('/', kopie));
          }
          return antwort;
        })
        .catch(() => caches.match('/').then((t) => t ?? Response.error())),
    );
    return;
  }

  // Built files carry a hash in their name: if the content changes, the
  // name changes. That is why the cache comes first.
  e.respondWith(
    caches.match(request).then((treffer) => {
      if (treffer) return treffer;
      return fetch(request)
        .then((antwort) => {
          if (darfGespeichertWerden(antwort)) {
            const kopie = antwort.clone();
            caches.open(DATEIEN).then((c) => c.put(request, kopie));
          }
          return antwort;
        })
        // No network and no copy: return a clear error instead of letting
        // the promise from respondWith blow up.
        .catch(() => new Response('', { status: 504, statusText: 'Offline' }));
    }),
  );
});
