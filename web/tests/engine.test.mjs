// Tests the drawing engine without a browser: smoothing, eraser, history.
// Path2D does not exist in Node; an empty dummy is enough, nothing is
// drawn here after all.

globalThis.Path2D = class {
  moveTo() {} lineTo() {} addPath() {} bezierCurveTo() {} arc() {} ellipse() {} closePath() {}
};

const { StrichBauer, GLAETTUNG_STANDARD } = await import('../src/zeichnen/glaettung.js');
const { Dokument } = await import('../src/zeichnen/dokument.js');
const { punktRadieren, trifft, neueId } = await import('../src/zeichnen/elemente.js');

let fehler = 0;
function pruefe(name, ok, info = '') {
  console.log(`${ok ? 'OK    ' : 'FAILED'} ${name}${info ? `  (${info})` : ''}`);
  if (!ok) fehler++;
}

// ---- Smoothing: a shaky straight line becomes calm, end points stay, fewer points
{
  const b = new StrichBauer(GLAETTUNG_STANDARD, 1);
  let seed = 1;
  const zufall = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let x = 0; x <= 400; x += 2) b.hinzu(x, 100 + zufall() * 3, 0.5);
  b.beenden();
  const { punkte } = b.ergebnis();
  const n = punkte.length / 2;
  let maxAbw = 0;
  for (let i = 1; i < n - 1; i++) maxAbw = Math.max(maxAbw, Math.abs(punkte[i * 2 + 1] - 100));
  pruefe('Straight line: heavily simplified', n < 20, `${b.roh.length / 3} raw -> ${n}`);
  pruefe('Straight line: jitter smoothed', maxAbw < 1, `max ${maxAbw.toFixed(2)} px`);
  pruefe('Straight line: end point reached', Math.abs(punkte[(n - 1) * 2] - 400) < 0.5, `x=${punkte[(n - 1) * 2]}`);
  pruefe('Straight line: start stays', punkte[0] === 0 && Math.abs(punkte[1] - 100) < 2);
}

// ------ Incremental smoothing = all in one go
{
  const a = new StrichBauer(GLAETTUNG_STANDARD, 1);
  const pts = [];
  for (let t = 0; t < 6.28; t += 0.02) pts.push([200 + 100 * Math.cos(t), 200 + 100 * Math.sin(t)]);
  for (const [x, y] of pts) a.hinzu(x, y, 0.5);
  a.beenden();
  const kreis = a.ergebnis().punkte;
  let maxR = 0;
  for (let i = 0; i < kreis.length; i += 2) maxR = Math.max(maxR, Math.abs(Math.hypot(kreis[i] - 200, kreis[i + 1] - 200) - 100));
  pruefe('Circle stays a circle', maxR < 3, `radius error ${maxR.toFixed(2)}`);
}

// ------- A tap becomes a dot
{
  const b = new StrichBauer(GLAETTUNG_STANDARD, 1);
  b.hinzu(10, 10, 0.5);
  b.beenden();
  pruefe('Tap = one dot', b.ergebnis().punkte.length === 2);
}

function strich(punkte, z) {
  return { id: neueId(), typ: 'strich', z, farbe: '#000', breite: 4, punkte, druck: null };
}

// ----- Document, eraser and history
{
  const dok = new Dokument();
  let tx = dok.transaktion();
  const s1 = strich([0, 0, 100, 0, 200, 0], 0);
  const s2 = strich([0, 50, 200, 50], 1);
  tx.hinzufuegen(s1); tx.hinzufuegen(s2); tx.abschliessen();
  pruefe('Two strokes in it', dok.elemente.length === 2);

  pruefe('Hit', trifft(s1, 100, -5, 100, 5, 3));
  pruefe('No hit', !trifft(s1, 100, 20, 100, 30, 3));
  pruefe('Grid finds it', dok.finden({ x1: 95, y1: -5, x2: 105, y2: 5 }).has(s1.id));

  // Point eraser straight through the middle of s1
  const stuecke = punktRadieren(s1, 100, -10, 100, 10, 5);
  pruefe('Point eraser splits in two', stuecke?.length === 2, `${stuecke?.length}`);
  const ende1 = stuecke[0].punkte.at(-2);
  const anfang2 = stuecke[1].punkte[0];
  pruefe('Gap around x=100', ende1 < 95 && anfang2 > 105, `${ende1} .. ${anfang2}`);

  tx = dok.transaktion();
  tx.entfernen(s1.id);
  stuecke.forEach((s) => { s.z = s1.z; tx.hinzufuegen(s); });
  // Erase a piece again right away in the same gesture
  tx.entfernen(stuecke[0].id);
  tx.abschliessen();
  pruefe('After erasing', dok.elemente.length === 2 && dok.elemente[0] === stuecke[1], dok.elemente.map((e) => e.z).join(','));

  dok.rueckgaengig();
  pruefe('Undo restores the original', dok.elemente.length === 2 && dok.elemente[0] === s1 && dok.elemente[1] === s2);
  dok.wiederholen();
  pruefe('Redo', dok.elemente.length === 2 && dok.elemente[0] === stuecke[1]);
  dok.rueckgaengig();
  dok.rueckgaengig();
  pruefe('Everything undone', dok.elemente.length === 0 && !dok.kannRueck && dok.kannVor);
  pruefe('Grid empty', dok.finden({ x1: -1000, y1: -1000, x2: 1000, y2: 1000 }).size === 0);

  const daten = JSON.parse(JSON.stringify(dok.alsDaten()));
  pruefe('Storage format', daten.version === 1 && Array.isArray(daten.elemente));
}

// ---- A shape turns into strokes on point erasing
{
  const r = { id: 'r', typ: 'form', form: 'rechteck', x1: 0, y1: 0, x2: 100, y2: 100, farbe: '#000', breite: 2, z: 0 };
  const st = punktRadieren(r, 50, -10, 50, 10, 4);
  pruefe('Rectangle cut open at the top', st?.length === 2 && st.every((s) => s.eckig), `${st?.length}`);
}

// --- The bug: the eraser stays on the cut edge and brushes the pieces
// many times. The shape must not get distorted in the process.
{
  const b = new StrichBauer(GLAETTUNG_STANDARD, 1);
  for (let x = 0; x <= 600; x += 2) b.hinzu(x, 200 + 80 * Math.sin(x / 45), 0.5);
  b.beenden();
  const original = { id: 'w', typ: 'strich', z: 0, farbe: '#000', breite: 3, druck: null, punkte: b.ergebnis().punkte };
  const kurve = (x) => 200 + 80 * Math.sin(x / 45);

  let teile = punktRadieren(original, 300, 100, 300, 300, 8);
  // 60 small movements around the cut, each one hits both pieces
  for (let k = 0; k < 60; k++) {
    const y = 120 + (k % 10) * 16;
    const neu = [];
    for (const t of teile) neu.push(...(punktRadieren(t, 300, y, 300.5, y + 16, 8) ?? [t]));
    teile = neu;
  }
  let maxAbw = 0;
  for (const t of teile) {
    for (let i = 0; i < t.punkte.length; i += 2) {
      maxAbw = Math.max(maxAbw, Math.abs(t.punkte[i + 1] - kurve(t.punkte[i])));
    }
  }
  const innen = teile.flatMap((t) => t.punkte.slice(2, -2));
  const alle = new Set();
  for (let i = 0; i < original.punkte.length; i += 2) alle.add(`${original.punkte[i]},${original.punkte[i + 1]}`);
  let fremd = 0;
  for (let i = 0; i < innen.length; i += 2) if (!alle.has(`${innen[i]},${innen[i + 1]}`)) fremd++;
  pruefe('Heavy erasing: two pieces', teile.length === 2, `${teile.length}`);
  pruefe('Heavy erasing: shape stays', maxAbw < 1.5, `max ${maxAbw.toFixed(2)} px`);
  pruefe('Heavy erasing: inner points unchanged', fremd === 0, `${fremd} changed`);
}

// --------------- Own file format: export and read back in
{
  const { alsDatei } = await import('../src/zeichnen/export.js');
  const { dateiImportieren } = await import('../src/import/index.js');
  const daten = {
    hintergrund: { farbe: 'slate', muster: 'grid' },
    elemente: [
      { id: 'a', typ: 'strich', z: 0, farbe: 'graphite', breite: 3, punkte: [0, 0, 10, 10], druck: null },
      { id: 'b', typ: 'strich', z: 1, farbe: 'hl-yellow', breite: 20, punkte: [0, 5, 30, 5], druck: null, textmarker: true },
      { id: 'c', typ: 'form', z: 2, form: 'ellipse', x1: 0, y1: 0, x2: 40, y2: 20, farbe: 'blue', breite: 3 },
    ],
  };
  const blob = alsDatei('Mein Board', daten);
  const datei = new File([await blob.text()], 'Mein Board.whiteboard');
  const { titel, daten: zurueck, bericht } = await dateiImportieren(datei);
  pruefe('File: title stays', titel === 'Mein Board');
  pruefe('File: background stays', zurueck.hintergrund.farbe === 'slate' && zurueck.hintergrund.muster === 'grid');
  pruefe('File: all elements unchanged', JSON.stringify(zurueck.elemente) === JSON.stringify(daten.elemente));
  pruefe('File: report counts correctly', bericht.striche === 1 && bericht.textmarker === 1 && bericht.formen === 1);
  let abgelehnt = false;
  try { await dateiImportieren(new File(['{"format":"anders"}'], 'x.json')); } catch { abgelehnt = true; }
  pruefe('File: foreign JSON is rejected', abgelehnt);
}

// ------------------- Images: move, scale, rotate, tap
{
  const { transformieren, enthaelt, grenzen } = await import('../src/zeichnen/elemente.js');
  const b = { id: 'b', typ: 'bild', z: 0, bild: 'i_x', x1: 0, y1: 0, x2: 200, y2: 100 };
  const doppelt = transformieren(b, [2, 0, 0, 2, 10, 10]);
  pruefe('Image: scale and move', doppelt.x1 === 10 && doppelt.x2 === 410 && doppelt.y2 === 210 && !('breite' in doppelt),
    JSON.stringify(doppelt));
  const c = Math.cos(Math.PI / 2), sn = Math.sin(Math.PI / 2);
  const gedreht = transformieren(b, [c, sn, -sn, c, 150, -50]);
  pruefe('Image: rotating keeps the size', Math.abs(gedreht.winkel - Math.PI / 2) < 1e-9
    && Math.abs((gedreht.x2 - gedreht.x1) - 200) < 0.01, JSON.stringify(gedreht));
  pruefe('Image: tapping inside hits, outside does not', enthaelt(b, 100, 50) && !enthaelt(b, 250, 50));
  const g = grenzen(gedreht);
  pruefe('Image: bounds follow the rotation', g.y2 - g.y1 > 190, JSON.stringify(g));
}

console.log(fehler ? `\n${fehler} failed` : '\nAll green');
process.exit(fehler ? 1 : 0);
