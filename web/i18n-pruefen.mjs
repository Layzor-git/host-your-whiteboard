// Checks the translations before every build:
//
//   1. Every key the source uses with t('…') exists in en.js and in de.js.
//   2. Both dictionaries have exactly the same keys.
//   3. Every key has the same placeholders ({name}) in both languages.
//   4. Plural entries ({ one, other }) are plural in both languages.
//   5. Dynamic keys (colors, patterns) exist for every id.
//   6. No hard-coded text between JSX tags.
//
// Without this a missing text only shows up when someone opens that spot
// in the other language and reads "library.foo" there.
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

// 1. used keys: every string literal of the form 'bereich.name' whose
// area exists in en.js, also indirectly (tables like the keyboard
// shortcuts). The dictionaries themselves do not count.
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
// 6. hard-coded text between JSX tags (<b>Edit</b>) would bypass t()
// and stay the same in every language. Labor.jsx is a developer page.
for (const f of dateien('src')) {
  if (!f.endsWith('.jsx') || f.includes('Labor')) continue;
  readFileSync(f, 'utf8').split('\n').forEach((zeile, i) => {
    if (/^\s*(\/\/|\*)/.test(zeile)) return;
    for (const m of zeile.matchAll(/(?<![=\w-])>\s*([A-Za-zÄÖÜäöüß][^<>{}=;()]{2,}?)\s*(<|$)/g)) {
      fehler.push(`hard-coded text instead of t(): "${m[1]}" (${f}:${i + 1})`);
    }
  });
}

for (const [k, f] of benutzt) {
  if (!(k in en)) fehler.push(`missing in en.js: ${k} (used in ${f})`);
  if (!(k in de)) fehler.push(`missing in de.js: ${k} (used in ${f})`);
}

// 5. dynamic keys
const dynamisch = [
  ...[...INK, ...HIGHLIGHTER].map((f) => `color.${f.id}`),
  ...CANVAS_BG.map((c) => `canvas.${c.id}`),
  ...Object.keys(PATTERN).map((p) => `pattern.${p}`),
  // Shapes of the toolbar (FORMEN in editor/Werkzeugleiste.jsx)
  ...['linie', 'pfeil', 'rechteck', 'ellipse', 'dreieck'].map((f) => `shape.${f}`),
];
// Server error codes: each one needs error.<code>. Only if the server is
// next to it (yes in the repository, maybe not in a web-only build).
try {
  const { MELDUNGEN } = await import('../server/src/fehler.js');
  dynamisch.push(...Object.keys(MELDUNGEN).map((c) => `error.${c}`));
} catch {
  console.warn('server/src/fehler.js not found: server error codes not checked');
}
for (const k of dynamisch) {
  if (!(k in en)) fehler.push(`missing in en.js (dynamic): ${k}`);
  if (!(k in de)) fehler.push(`missing in de.js (dynamic): ${k}`);
}

// 2.-4.
const platzhalter = (v) => {
  const texte = typeof v === 'object' ? Object.values(v) : [v];
  return [...new Set(texte.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort().join(',');
};
for (const k of new Set([...Object.keys(en), ...Object.keys(de)])) {
  if (!(k in en)) { fehler.push(`only in de.js: ${k}`); continue; }
  if (!(k in de)) { fehler.push(`only in en.js: ${k}`); continue; }
  if ((typeof en[k] === 'object') !== (typeof de[k] === 'object')) fehler.push(`plural in only one language: ${k}`);
  if (typeof en[k] === 'object' && !('other' in en[k] && 'other' in de[k])) fehler.push(`plural without "other": ${k}`);
  if (platzhalter(en[k]) !== platzhalter(de[k])) {
    fehler.push(`placeholders differ in ${k}: en {${platzhalter(en[k])}} / de {${platzhalter(de[k])}}`);
  }
}

// Unused keys are not an error, but a hint
const dynPraefix = /^(color|canvas|pattern|error|shape)\./;
const unbenutzt = Object.keys(en).filter((k) => !benutzt.has(k) && !dynPraefix.test(k));

if (fehler.length) {
  console.error(`Translations incomplete (${fehler.length}):`);
  for (const f of fehler) console.error('  ' + f);
  process.exit(1);
}
console.log(`Translations complete: ${Object.keys(en).length} keys in en and de`
  + (unbenutzt.length ? ` (unused: ${unbenutzt.join(', ')})` : ''));
