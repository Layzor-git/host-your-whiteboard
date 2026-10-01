// Determines before the build which version is being built.
//
// One single place where the timestamp is created. If every step rolled
// its own, the service worker would carry a different number than the app,
// and when comparing you would not know which one applies.
//
// It writes a .env.production.local, because Vite takes values with the
// prefix VITE_ from there into the build. The file is in .gitignore: it
// describes a build, not the source.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const zeitstempel = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

// The matching commit. Without Git the field stays empty; the timestamp
// alone is enough for comparing.
let commit = '';
try {
  commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  const schmutzig = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
  // A build from uncommitted changes is not a commit, and that should be
  // visible: otherwise you later look for the difference in the wrong state.
  if (schmutzig) commit += '+';
} catch { /* no Git, no commit */ }

writeFileSync(
  '.env.production.local',
  `VITE_BAUSTAND=${zeitstempel}\nVITE_COMMIT=${commit}\n`,
  'utf8',
);

console.log(`Build stamp ${zeitstempel}${commit ? ` (${commit})` : ''}`);
