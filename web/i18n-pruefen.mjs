// Prueft die Uebersetzungen vor jedem Bau:
//
//   1. Jeder Schluessel, den der Quelltext mit t('…') benutzt, steht in en.js
//      und in de.js.
//   2. Beide Woerterbuecher haben genau dieselben Schluessel.
//   3. Jeder Schluessel hat in beiden Sprachen dieselben Platzhalter ({name}).
//   4. Mehrzahl-Eintraege ({ one, other }) sind in beiden Sprachen Mehrzahl.
//   5. Dynamische Schluessel (Farben, Muster) sind fuer jede Id vorhanden.
//   6. Kein fester Text zwischen JSX-Tags.
//
// Ohne das faellt ein fehlender Text erst auf, wenn jemand die Stelle in
// der anderen Sprache oeffnet und dort "library.foo" liest.
//
//   node i18n-pruefen.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from './src/i18n/en.js';
import de from './src/i18n/de.js';
import { CANVAS_BG, HIGHLIGHTER, INK, PATTERN } from './src/zeichnen/farben.js';

const fehler = [];

function dateien(dir) {
  const aus = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) aus.push(...dateien(p));
    else if (/\.(jsx?|mjs)$/.test(n)) aus.push(p);
  }
  return aus;
}

// 1. benutzte Schluessel: jedes Zeichenketten-Literal der Form 'bereich.name',
// dessen Bereich es in en.js gibt, auch indirekt (Tabellen wie die
// Tastenkuerzel). Die Woerterbuecher selbst zaehlen nicht.
const bereiche = new Set(Object.keys(en).map((k) => k.split('.')[0]));
const benutzt = new Map();
for (const f of dateien('src')) {
  if (f.includes('i18n')) continue;
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/'([a-zA-Z]+)\.([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)'/g)) {
    const k = `${m[1]}.${m[2]}`;
    if (bereiche.has(m[1]) && !benutzt.has(k)) benutzt.set(k, f);
  }
}
// 6. fester Text zwischen JSX-Tags (<b>Bearbeiten</b>) ginge an t() vorbei
// und bliebe in jeder Sprache gleich. Labor.jsx ist eine Entwicklerseite.
for (const f of dateien('src')) {
  if (!f.endsWith('.jsx') || f.includes('Labor')) continue;
  readFileSync(f, 'utf8').split('\n').forEach((zeile, i) => {
    if (/^\s*(\/\/|\*)/.test(zeile)) return;
    for (const m of zeile.matchAll(/(?<![=\w-])>\s*([A-Za-zÄÖÜäöüß][^<>{}=;()]{2,}?)\s*(<|$)/g)) {
      fehler.push(`fester Text statt t(): "${m[1]}" (${f}:${i + 1})`);
    }
  });
}

for (const [k, f] of benutzt) {
  if (!(k in en)) fehler.push(`fehlt in en.js: ${k} (benutzt in ${f})`);
  if (!(k in de)) fehler.push(`fehlt in de.js: ${k} (benutzt in ${f})`);
}

// 5. dynamische Schluessel
const dynamisch = [
  ...[...INK, ...HIGHLIGHTER].map((f) => `color.${f.id}`),
  ...CANVAS_BG.map((c) => `canvas.${c.id}`),
  ...Object.keys(PATTERN).map((p) => `pattern.${p}`),
  // Formen der Werkzeugleiste (FORMEN in editor/Werkzeugleiste.jsx)
  ...['linie', 'pfeil', 'rechteck', 'ellipse', 'dreieck'].map((f) => `shape.${f}`),
];
// Fehlercodes des Servers: jeder braucht error.<code>. Nur wenn der Server
// daneben liegt (im Repository ja, in einem reinen Web-Bau vielleicht nicht).
try {
  const { MELDUNGEN } = await import('../server/src/fehler.js');
  dynamisch.push(...Object.keys(MELDUNGEN).map((c) => `error.${c}`));
} catch {
  console.warn('server/src/fehler.js nicht gefunden: Fehlercodes des Servers nicht geprueft');
}
for (const k of dynamisch) {
  if (!(k in en)) fehler.push(`fehlt in en.js (dynamisch): ${k}`);
  if (!(k in de)) fehler.push(`fehlt in de.js (dynamisch): ${k}`);
}

// 2.-4.
const platzhalter = (v) => {
  const texte = typeof v === 'object' ? Object.values(v) : [v];
  return [...new Set(texte.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort().join(',');
};
for (const k of new Set([...Object.keys(en), ...Object.keys(de)])) {
  if (!(k in en)) { fehler.push(`nur in de.js: ${k}`); continue; }
  if (!(k in de)) { fehler.push(`nur in en.js: ${k}`); continue; }
  if ((typeof en[k] === 'object') !== (typeof de[k] === 'object')) fehler.push(`Mehrzahl nur in einer Sprache: ${k}`);
  if (typeof en[k] === 'object' && !('other' in en[k] && 'other' in de[k])) fehler.push(`Mehrzahl ohne "other": ${k}`);
  if (platzhalter(en[k]) !== platzhalter(de[k])) {
    fehler.push(`Platzhalter verschieden in ${k}: en {${platzhalter(en[k])}} / de {${platzhalter(de[k])}}`);
  }
}

// Unbenutzte Schluessel sind kein Fehler, aber ein Hinweis
const dynPraefix = /^(color|canvas|pattern|error|shape)\./;
const unbenutzt = Object.keys(en).filter((k) => !benutzt.has(k) && !dynPraefix.test(k));

if (fehler.length) {
  console.error(`Uebersetzungen unvollstaendig (${fehler.length}):`);
  for (const f of fehler) console.error('  ' + f);
  process.exit(1);
}
console.log(`Uebersetzungen vollstaendig: ${Object.keys(en).length} Schluessel in en und de`
  + (unbenutzt.length ? ` (unbenutzt: ${unbenutzt.join(', ')})` : ''));
