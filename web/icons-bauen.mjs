// Generates all app icons from public/logo.svg. Run once after changing
// the logo; the files land in public/ and are committed to Git:
//
//   node icons-bauen.mjs
//
// Three kinds:
//
//   logo-*.png            the logo as drawn: rounded tile, transparent
//                         corners. Browser tab, manifest "any".
//   apple-touch-icon.png  full-bleed, iOS rounds the corners itself. With
//                         transparent corners you would see black wedges
//                         on the home screen.
//   logo-maskable-512     full-bleed and shrunk: Android crops the icon
//                         into a circle, drop or square. Everything
//                         important must be within the inner 80 %.

import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const logo = readFileSync('public/logo.svg', 'utf8');
const GRUND = '#fbfbfa';

// The content without the bordered tile (the first <rect>)
const innen = logo
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<rect[^>]*>(<\/rect>)?/, '');

/** Full-bleed version: whole area in the base color, content scaled around the center. */
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
