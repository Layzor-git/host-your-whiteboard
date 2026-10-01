// Check the Microsoft Whiteboard import against a real export.
// Path as an argument, otherwise the test is skipped:
//   node tests/import.test.mjs path/to/Whiteboard.html

import { readFileSync } from 'node:fs';

globalThis.Path2D = class {
  moveTo() {} lineTo() {} addPath() {} bezierCurveTo() {} arc() {} ellipse() {} closePath() {}
};
const { msWhiteboardUmwandeln } = await import('../src/import/msWhiteboard.js');

const pfad = process.argv[2];
if (!pfad) {
  console.log('No export given, import test skipped.');
  process.exit(0);
}
const { daten, bericht } = msWhiteboardUmwandeln(readFileSync(pfad, 'utf8'));
console.log(bericht);
const b = daten.elemente.map((e) => e.breite);
console.log('Widths', Math.min(...b), '..', Math.max(...b));
console.log('Colors', [...new Set(daten.elemente.map((e) => e.farbe))]);
console.log('with pressure', daten.elemente.filter((e) => e.druck).length, 'of', daten.elemente.length);
const xs = daten.elemente.flatMap((e) => e.punkte.filter((_, i) => i % 2 === 0));
const ys = daten.elemente.flatMap((e) => e.punkte.filter((_, i) => i % 2 === 1));
console.log('Extent x', Math.min(...xs).toFixed(0), '..', Math.max(...xs).toFixed(0),
  ' y', Math.min(...ys).toFixed(0), '..', Math.max(...ys).toFixed(0));
console.log('Background', daten.hintergrund);
const kaputt = daten.elemente.filter((e) => e.punkte.some((v) => !Number.isFinite(v)));
if (kaputt.length || !daten.elemente.length) { console.log('FAILED'); process.exit(1); }
console.log('OK');
