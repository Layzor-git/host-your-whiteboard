// Prueft die Zeichen-Engine ohne Browser: Glaettung, Radierer, Verlauf.
// Path2D gibt es in Node nicht, eine leere Attrappe reicht, gezeichnet
// wird hier ja nichts.

globalThis.Path2D = class {
  moveTo() {} lineTo() {} addPath() {} bezierCurveTo() {} arc() {} ellipse() {} closePath() {}
};

const { StrichBauer, GLAETTUNG_STANDARD } = await import('../src/zeichnen/glaettung.js');
const { Dokument } = await import('../src/zeichnen/dokument.js');
const { punktRadieren, trifft, neueId } = await import('../src/zeichnen/elemente.js');

let fehler = 0;
function pruefe(name, ok, info = '') {
  console.log(`${ok ? 'OK    ' : 'FEHLER'} ${name}${info ? `  (${info})` : ''}`);
  if (!ok) fehler++;
}

// --- Glaettung: zittrige Gerade wird ruhig, Endpunkte bleiben, weniger Punkte
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
  pruefe('Gerade: stark vereinfacht', n < 20, `${b.roh.length / 3} roh -> ${n}`);
  pruefe('Gerade: Zittern geglaettet', maxAbw < 1, `max ${maxAbw.toFixed(2)} px`);
  pruefe('Gerade: Endpunkt erreicht', Math.abs(punkte[(n - 1) * 2] - 400) < 0.5, `x=${punkte[(n - 1) * 2]}`);
  pruefe('Gerade: Anfang bleibt', punkte[0] === 0 && Math.abs(punkte[1] - 100) < 2);
}

// --- Glaettung inkrementell = in einem Rutsch
{
  const a = new StrichBauer(GLAETTUNG_STANDARD, 1);
  const pts = [];
  for (let t = 0; t < 6.28; t += 0.02) pts.push([200 + 100 * Math.cos(t), 200 + 100 * Math.sin(t)]);
  for (const [x, y] of pts) a.hinzu(x, y, 0.5);
  a.beenden();
  const kreis = a.ergebnis().punkte;
  let maxR = 0;
  for (let i = 0; i < kreis.length; i += 2) maxR = Math.max(maxR, Math.abs(Math.hypot(kreis[i] - 200, kreis[i + 1] - 200) - 100));
  pruefe('Kreis bleibt Kreis', maxR < 3, `Radiusfehler ${maxR.toFixed(2)}`);
}

// --- Ein Tipp wird ein Punkt
{
  const b = new StrichBauer(GLAETTUNG_STANDARD, 1);
  b.hinzu(10, 10, 0.5);
  b.beenden();
  pruefe('Tipp = ein Punkt', b.ergebnis().punkte.length === 2);
}

function strich(punkte, z) {
  return { id: neueId(), typ: 'strich', z, farbe: '#000', breite: 4, punkte, druck: null };
}

// --- Dokument, Radierer und Verlauf
{
  const dok = new Dokument();
  let tx = dok.transaktion();
  const s1 = strich([0, 0, 100, 0, 200, 0], 0);
  const s2 = strich([0, 50, 200, 50], 1);
  tx.hinzufuegen(s1); tx.hinzufuegen(s2); tx.abschliessen();
  pruefe('Zwei Striche drin', dok.elemente.length === 2);

  pruefe('Treffer', trifft(s1, 100, -5, 100, 5, 3));
  pruefe('Kein Treffer', !trifft(s1, 100, 20, 100, 30, 3));
  pruefe('Raster findet', dok.finden({ x1: 95, y1: -5, x2: 105, y2: 5 }).has(s1.id));

  // Punkt-Radierer quer durch die Mitte von s1
  const stuecke = punktRadieren(s1, 100, -10, 100, 10, 5);
  pruefe('Punktradierer teilt in zwei', stuecke?.length === 2, `${stuecke?.length}`);
  const ende1 = stuecke[0].punkte.at(-2);
  const anfang2 = stuecke[1].punkte[0];
  pruefe('Luecke um x=100', ende1 < 95 && anfang2 > 105, `${ende1} .. ${anfang2}`);

  tx = dok.transaktion();
  tx.entfernen(s1.id);
  stuecke.forEach((s) => { s.z = s1.z; tx.hinzufuegen(s); });
  // Ein Stueck in derselben Geste gleich wieder wegradieren
  tx.entfernen(stuecke[0].id);
  tx.abschliessen();
  pruefe('Nach Radieren', dok.elemente.length === 2 && dok.elemente[0] === stuecke[1], dok.elemente.map((e) => e.z).join(','));

  dok.rueckgaengig();
  pruefe('Rueckgaengig stellt Original her', dok.elemente.length === 2 && dok.elemente[0] === s1 && dok.elemente[1] === s2);
  dok.wiederholen();
  pruefe('Wiederholen', dok.elemente.length === 2 && dok.elemente[0] === stuecke[1]);
  dok.rueckgaengig();
  dok.rueckgaengig();
  pruefe('Alles zurueck', dok.elemente.length === 0 && !dok.kannRueck && dok.kannVor);
  pruefe('Raster leer', dok.finden({ x1: -1000, y1: -1000, x2: 1000, y2: 1000 }).size === 0);

  const daten = JSON.parse(JSON.stringify(dok.alsDaten()));
  pruefe('Speicherformat', daten.version === 1 && Array.isArray(daten.elemente));
}

// --- Form wird beim Punkt-Radieren zu Strichen
{
  const r = { id: 'r', typ: 'form', form: 'rechteck', x1: 0, y1: 0, x2: 100, y2: 100, farbe: '#000', breite: 2, z: 0 };
  const st = punktRadieren(r, 50, -10, 50, 10, 4);
  pruefe('Rechteck oben aufgeschnitten', st?.length === 2 && st.every((s) => s.eckig), `${st?.length}`);
}

// --- Der Bug: Radierer bleibt auf der Schnittkante stehen und streift die
// Stuecke viele Male. Die Form darf sich dabei nicht verziehen.
{
  const b = new StrichBauer(GLAETTUNG_STANDARD, 1);
  for (let x = 0; x <= 600; x += 2) b.hinzu(x, 200 + 80 * Math.sin(x / 45), 0.5);
  b.beenden();
  const original = { id: 'w', typ: 'strich', z: 0, farbe: '#000', breite: 3, druck: null, punkte: b.ergebnis().punkte };
  const kurve = (x) => 200 + 80 * Math.sin(x / 45);

  let teile = punktRadieren(original, 300, 100, 300, 300, 8);
  // 60 kleine Bewegungen rund um die Schnittstelle, jede trifft beide Stuecke
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
  pruefe('Viel radieren: zwei Stuecke', teile.length === 2, `${teile.length}`);
  pruefe('Viel radieren: Form bleibt', maxAbw < 1.5, `max ${maxAbw.toFixed(2)} px`);
  pruefe('Viel radieren: innere Punkte unveraendert', fremd === 0, `${fremd} veraendert`);
}

// --- Eigenes Dateiformat: exportieren und wieder einlesen
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
  pruefe('Datei: Titel bleibt', titel === 'Mein Board');
  pruefe('Datei: Hintergrund bleibt', zurueck.hintergrund.farbe === 'slate' && zurueck.hintergrund.muster === 'grid');
  pruefe('Datei: alle Elemente unverändert', JSON.stringify(zurueck.elemente) === JSON.stringify(daten.elemente));
  pruefe('Datei: Bericht zählt richtig', bericht.striche === 1 && bericht.textmarker === 1 && bericht.formen === 1);
  let abgelehnt = false;
  try { await dateiImportieren(new File(['{"format":"anders"}'], 'x.json')); } catch { abgelehnt = true; }
  pruefe('Datei: fremdes JSON wird abgelehnt', abgelehnt);
}

// --- Bilder: verschieben, skalieren, drehen, antippen
{
  const { transformieren, enthaelt, grenzen } = await import('../src/zeichnen/elemente.js');
  const b = { id: 'b', typ: 'bild', z: 0, bild: 'i_x', x1: 0, y1: 0, x2: 200, y2: 100 };
  const doppelt = transformieren(b, [2, 0, 0, 2, 10, 10]);
  pruefe('Bild: skalieren und verschieben', doppelt.x1 === 10 && doppelt.x2 === 410 && doppelt.y2 === 210 && !('breite' in doppelt),
    JSON.stringify(doppelt));
  const c = Math.cos(Math.PI / 2), sn = Math.sin(Math.PI / 2);
  const gedreht = transformieren(b, [c, sn, -sn, c, 150, -50]);
  pruefe('Bild: drehen behaelt die Groesse', Math.abs(gedreht.winkel - Math.PI / 2) < 1e-9
    && Math.abs((gedreht.x2 - gedreht.x1) - 200) < 0.01, JSON.stringify(gedreht));
  pruefe('Bild: Antippen innen trifft, aussen nicht', enthaelt(b, 100, 50) && !enthaelt(b, 250, 50));
  const g = grenzen(gedreht);
  pruefe('Bild: Grenzen folgen der Drehung', g.y2 - g.y1 > 190, JSON.stringify(g));
}

console.log(fehler ? `\n${fehler} Fehler` : '\nAlles gruen');
process.exit(fehler ? 1 : 0);
