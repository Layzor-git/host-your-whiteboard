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
  console.log('Kein Export angegeben, Import-Test uebersprungen.');
  process.exit(0);
}
const { daten, bericht } = msWhiteboardUmwandeln(readFileSync(pfad, 'utf8'));
console.log(bericht);
const b = daten.elemente.map((e) => e.breite);
console.log('Breiten', Math.min(...b), '..', Math.max(...b));
console.log('Farben', [...new Set(daten.elemente.map((e) => e.farbe))]);
console.log('mit Druck', daten.elemente.filter((e) => e.druck).length, 'von', daten.elemente.length);
const xs = daten.elemente.flatMap((e) => e.punkte.filter((_, i) => i % 2 === 0));
const ys = daten.elemente.flatMap((e) => e.punkte.filter((_, i) => i % 2 === 1));
console.log('Ausdehnung x', Math.min(...xs).toFixed(0), '..', Math.max(...xs).toFixed(0),
  ' y', Math.min(...ys).toFixed(0), '..', Math.max(...ys).toFixed(0));
console.log('Hintergrund', daten.hintergrund);
const kaputt = daten.elemente.filter((e) => e.punkte.some((v) => !Number.isFinite(v)));
if (kaputt.length || !daten.elemente.length) { console.log('FEHLER'); process.exit(1); }
console.log('OK');
