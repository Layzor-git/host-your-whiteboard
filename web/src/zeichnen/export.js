// A board as an image: PNG and SVG for download, plus the small thumbnail
// for the library. Colors are fully resolved, matching the board's canvas
// color.

import { alsSvg, bilderLaden, grenzen, zeichnen } from './elemente.js';
import { leinwand } from './farben.js';
import { erweitert, vereinigt } from './geometrie.js';

function inhalt(dok) {
  const els = dok.elemente;
  if (!els.length) return null;
  let g = grenzen(els[0]);
  for (const el of els) g = vereinigt(g, grenzen(el));
  return g;
}

function allesZeichnen(ctx, dok, dunkel) {
  // Highlighter first and blended, as on the canvas
  ctx.globalCompositeOperation = dunkel ? 'screen' : 'multiply';
  for (const el of dok.elemente) if (el.textmarker) zeichnen(ctx, el, dunkel);
  ctx.globalCompositeOperation = 'source-over';
  for (const el of dok.elemente) if (!el.textmarker) zeichnen(ctx, el, dunkel);
}

/** PNG at double resolution, at most 8000 pixels per side. */
export async function alsPng(dok, rand = 32) {
  await bilderLaden(dok.elemente);
  const g = erweitert(inhalt(dok) ?? { x1: 0, y1: 0, x2: 400, y2: 300 }, rand);
  const w = g.x2 - g.x1;
  const h = g.y2 - g.y1;
  const skala = Math.min(2, 8000 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * skala);
  c.height = Math.ceil(h * skala);
  const ctx = c.getContext('2d');
  const bg = leinwand(dok.hintergrund.farbe);
  ctx.fillStyle = bg.color;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.setTransform(skala, 0, 0, skala, -g.x1 * skala, -g.y1 * skala);
  allesZeichnen(ctx, dok, !!bg.dark);
  return new Promise((ok) => c.toBlob(ok, 'image/png'));
}

export async function alsSvgText(dok, rand = 32) {
  await bilderLaden(dok.elemente);
  const g = erweitert(inhalt(dok) ?? { x1: 0, y1: 0, x2: 400, y2: 300 }, rand);
  const bg = leinwand(dok.hintergrund.farbe);
  const dunkel = !!bg.dark;
  const f = (v) => Math.round(v * 100) / 100;
  const marker = dok.elemente.filter((el) => el.textmarker).map((el) => alsSvg(el, dunkel));
  const tinte = dok.elemente.filter((el) => !el.textmarker).map((el) => alsSvg(el, dunkel));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(g.x1)} ${f(g.y1)} ${f(g.x2 - g.x1)} ${f(g.y2 - g.y1)}" width="${Math.ceil(g.x2 - g.x1)}" height="${Math.ceil(g.y2 - g.y1)}">
<rect x="${f(g.x1)}" y="${f(g.y1)}" width="${f(g.x2 - g.x1)}" height="${f(g.y2 - g.y1)}" fill="${bg.color}"/>
${marker.join('\n')}
${tinte.join('\n')}
</svg>
`;
}

/**
 * 4:3 thumbnail with a transparent background: the library puts it on the
 * canvas color and pattern, as in the design. Shows the whole board, but
 * never larger than half size, so little content does not look huge.
 */
export function vorschauBild(dok, breite = 480, hoehe = 360) {
  const g = inhalt(dok);
  if (!g) return null;
  const c = document.createElement('canvas');
  c.width = breite;
  c.height = hoehe;
  const ctx = c.getContext('2d');
  const rand = 24;
  const w = Math.max(g.x2 - g.x1, 1);
  const h = Math.max(g.y2 - g.y1, 1);
  const skala = Math.min(0.5, (breite - 2 * rand) / w, (hoehe - 2 * rand) / h);
  // Align top left, like a page you leaf through
  const ox = rand - g.x1 * skala + Math.max(0, (breite - 2 * rand - w * skala) / 2) * 0;
  const oy = rand - g.y1 * skala;
  ctx.setTransform(skala, 0, 0, skala, ox, oy);
  allesZeichnen(ctx, dok, !!leinwand(dok.hintergrund.farbe).dark);
  const webp = c.toDataURL('image/webp', 0.85);
  return webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/png');
}

// ---------------------------------------------------------- Own file format

/**
 * A board as a file for backup or sharing (.whiteboard, JSON). Contains
 * everything needed to restore it; import/index.js reads it back in.
 * Colors stay as color ids, so the board works the same on a light and a
 * dark canvas after the import.
 */
export const DATEI_FORMAT = 'whiteboard';

export function alsDatei(titel, daten, bilder) {
  const inhalt = {
    format: DATEI_FORMAT,
    version: 1,
    titel,
    exportiertAm: new Date().toISOString(),
    hintergrund: daten.hintergrund,
    elemente: daten.elemente,
    // Images embedded as data: URLs, so the file stands on its own
    ...(bilder && Object.keys(bilder).length ? { bilder } : {}),
  };
  return new Blob([JSON.stringify(inhalt)], { type: 'application/json' });
}
