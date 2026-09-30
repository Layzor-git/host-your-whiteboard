// Erzeugt alle App-Symbole aus public/logo.svg. Nach einer Aenderung am
// Logo einmal ausfuehren; die Dateien landen in public/ und gehen ins Git:
//
//   node icons-bauen.mjs
//
// Drei Arten:
//
//   logo-*.png            das Logo wie gezeichnet: abgerundete Kachel,
//                         Ecken durchsichtig. Browser-Tab, Manifest "any".
//   apple-touch-icon.png  randlos, iOS rundet die Ecken selbst ab. Mit
//                         durchsichtigen Ecken saehe man auf dem
//                         Home-Bildschirm schwarze Zwickel.
//   logo-maskable-512     randlos und verkleinert: Android schneidet das
//                         Symbol in Kreis, Tropfen oder Quadrat. Alles
//                         Wichtige muss in den inneren 80 % liegen.

import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const logo = readFileSync('public/logo.svg', 'utf8');
const GRUND = '#fbfbfa';

// Der Inhalt ohne die umrandete Kachel (das erste <rect>)
const innen = logo
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<rect[^>]*>(<\/rect>)?/, '');

/** Randlose Fassung: volle Flaeche in Grundfarbe, Inhalt um die Mitte skaliert. */
function randlos(massstab) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
    + `<rect width="64" height="64" fill="${GRUND}"/>`
    + `<g transform="translate(32 32) scale(${massstab}) translate(-32 -32)">${innen}</g></svg>`;
}

function png(svg, groesse, datei) {
  const bild = new Resvg(svg, { fitTo: { mode: 'width', value: groesse } }).render().asPng();
  writeFileSync(`public/${datei}`, bild);
  console.log(`public/${datei} (${groesse} px, ${bild.length} Bytes)`);
}

png(logo, 32, 'favicon-32.png');
png(logo, 192, 'logo-192.png');
png(logo, 512, 'logo-512.png');
png(randlos(0.92), 180, 'apple-touch-icon.png');
png(randlos(0.8), 512, 'logo-maskable-512.png');
