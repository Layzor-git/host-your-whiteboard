// Service Worker.
//
// Bewusst von Hand geschrieben statt generiert. Er ist kurz genug, und die
// eine Regel, auf die es ankommt, muss man sehen koennen:
//
//   /api wird NIEMALS zwischengespeichert.
//
// Grund: Laeuft die Cloudflare-Access-Sitzung ab, antwortet Cloudflare mit
// einer Weiterleitung zur Anmeldeseite. Wuerde der Service Worker die
// festhalten, bekaeme man unterwegs ein Anmeldeformular statt der App, und
// zwar dauerhaft.

// Wird beim Bauen durch den Zeitstempel ersetzt (siehe nach-bau.mjs).
// Wichtig: bei jedem Deployment neue Speichernamen. Sonst zeigt eine
// gespeicherte index.html auf Asset-Namen, die es nach "rm -rf www/*"
// nicht mehr gibt, und die App startet nicht mehr.
const VERSION = '__BAU__';
const HUELLE = `huelle-${VERSION}`;   // index.html und Icons
const DATEIEN = `dateien-${VERSION}`; // gebaute JS- und CSS-Dateien

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

// Nur speichern, was wirklich eine Antwort ist. Weiterleitungen und Fehler
// gehoeren nie in den Speicher.
function darfGespeichertWerden(antwort) {
  return antwort && antwort.ok && antwort.type === 'basic' && !antwort.redirected;
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // --- Die wichtigste Regel ---
  if (url.pathname.startsWith('/api/')) return; // durchlassen, nichts merken

  // Seitenaufrufe: erst Netz, sonst die gespeicherte Huelle. So bekommt man
  // nach einem Deployment sofort die neue Fassung und ohne Netz trotzdem
  // die App.
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

  // Gebaute Dateien tragen einen Hash im Namen: Aendert sich der Inhalt,
  // aendert sich der Name. Deshalb zuerst aus dem Speicher.
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
        // Ohne Netz und ohne Kopie: einen klaren Fehler zurueckgeben, statt
        // die Zusage aus respondWith platzen zu lassen.
        .catch(() => new Response('', { status: 504, statusText: 'Offline' }));
    }),
  );
});
