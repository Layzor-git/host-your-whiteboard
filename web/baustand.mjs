// Legt vor dem Bau fest, welcher Stand gebaut wird.
//
// Eine einzige Stelle, an der der Zeitstempel entsteht. Wuerfelte jeder
// Schritt seinen eigenen, truege der Service Worker eine andere Nummer als
// die App, und beim Vergleichen wuesste man nicht, welche gilt.
//
// Geschrieben wird eine .env.production.local, weil Vite Werte mit dem
// Praefix VITE_ von dort in den Bau uebernimmt. Die Datei steht in
// .gitignore: Sie beschreibt einen Bau, nicht den Quelltext.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const zeitstempel = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

// Der Commit dazu. Ohne Git bleibt das Feld leer, der Zeitstempel allein
// reicht zum Vergleichen.
let commit = '';
try {
  commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  const schmutzig = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
  // Ein Bau aus ungespeicherten Aenderungen ist kein Commit, und das soll
  // man sehen: Sonst sucht man den Unterschied spaeter im falschen Stand.
  if (schmutzig) commit += '+';
} catch { /* kein Git, kein Commit */ }

writeFileSync(
  '.env.production.local',
  `VITE_BAUSTAND=${zeitstempel}\nVITE_COMMIT=${commit}\n`,
  'utf8',
);

console.log(`Baustand ${zeitstempel}${commit ? ` (${commit})` : ''}`);
