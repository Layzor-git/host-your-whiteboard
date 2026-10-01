// Runs after every build: writes the version into the service worker.
//
// Without this a phone keeps the old index.html cached after a deployment,
// and it points to asset names that no longer exist on the Pi after
// "rm -rf www/*". The app then no longer starts until someone clears the
// cache by hand.

import { readFileSync, writeFileSync } from 'node:fs';

const datei = 'dist/sw.js';

// The same stamp as the app, not a new one. It was written by
// baustand.mjs, before the build.
const version = readFileSync('.env.production.local', 'utf8')
  .match(/VITE_BAUSTAND=(\d+)/)?.[1];

if (!version) {
  console.error('No build stamp found. Did baustand.mjs run before the build?');
  process.exit(1);
}

const inhalt = readFileSync(datei, 'utf8');
if (!inhalt.includes('__BAU__')) {
  console.error(`${datei}: placeholder __BAU__ missing, service worker not versioned!`);
  process.exit(1);
}

writeFileSync(datei, inhalt.replaceAll('__BAU__', version));
console.log(`${datei}: version ${version} written`);
