// Laeuft nach jedem Bau: Traegt die Version in den Service Worker ein.
//
// Ohne das behaelt ein Handy nach einem Deployment die alte index.html im
// Speicher, und die zeigt auf Asset-Namen, die auf dem Pi nach
// "rm -rf www/*" nicht mehr existieren. Die App startet dann nicht mehr,
// bis jemand den Speicher von Hand leert.

import { readFileSync, writeFileSync } from 'node:fs';

const datei = 'dist/sw.js';

// Denselben Stempel wie die App, nicht einen neuen. Geschrieben hat ihn
// baustand.mjs, vor dem Bau.
const version = readFileSync('.env.production.local', 'utf8')
  .match(/VITE_BAUSTAND=(\d+)/)?.[1];

if (!version) {
  console.error('Kein Baustand gefunden. Lief baustand.mjs vor dem Bau?');
  process.exit(1);
}

const inhalt = readFileSync(datei, 'utf8');
if (!inhalt.includes('__BAU__')) {
  console.error(`${datei}: Platzhalter __BAU__ fehlt, Service Worker nicht versioniert!`);
  process.exit(1);
}

writeFileSync(datei, inhalt.replaceAll('__BAU__', version));
console.log(`${datei}: Version ${version} eingetragen`);
