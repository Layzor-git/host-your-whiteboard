// Alle Endpunkte an einer Stelle. Sie verteilen nur, die Arbeit steckt in
// den Modulen daneben.
//
// Jede Anfrage unter /api/v1 traegt bereits den angemeldeten Nutzer als
// req.nutzer, dafuer sorgt der Haken in index.js. /health ist ausgenommen,
// damit man auf dem Pi ohne Anmeldung nachsehen kann.

import * as boards from './boards.js';
import * as live from './live.js';
import * as freigaben from './freigaben.js';
import * as bilder from './bilder.js';
import * as ordner from './ordner.js';
import { createReadStream } from 'node:fs';

export function routenRegistrieren(app) {
  const n = (req) => req.nutzer.id;

  app.get('/api/v1/boards', async (req) => boards.liste(n(req)));

  app.post('/api/v1/boards', async (req, antwort) =>
    antwort.code(201).send(boards.anlegen(n(req), req.body ?? {})));

  app.get('/api/v1/boards/:id', async (req) => boards.laden(n(req), req.params.id));

  app.patch('/api/v1/boards/:id', async (req) =>
    boards.speichern(n(req), req.params.id, req.body ?? {}));

  app.post('/api/v1/boards/:id/geoeffnet', async (req, antwort) => {
    boards.geoeffnet(n(req), req.params.id);
    return antwort.code(204).send();
  });

  app.put('/api/v1/boards/:id/vorschau', async (req, antwort) => {
    boards.vorschauSetzen(n(req), req.params.id, req.body?.bild);
    return antwort.code(204).send();
  });

  // Die Adresse traegt die Version (?v=...), darum darf der Browser das
  // Bild behalten. Neue Version, neue Adresse.
  app.get('/api/v1/boards/:id/vorschau', async (req, antwort) => {
    const { bild, typ } = boards.vorschau(n(req), req.params.id);
    return antwort
      .header('content-type', typ)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(bild);
  });

  app.post('/api/v1/boards/:id/duplizieren', async (req, antwort) =>
    antwort.code(201).send(boards.duplizieren(n(req), req.params.id)));

  app.post('/api/v1/boards/:id/papierkorb', async (req) => {
    const m = boards.inPapierkorb(n(req), req.params.id);
    // Wer das Board geteilt bekommen hat, sieht es jetzt nicht mehr
    live.zugriffGeaendert(req.params.id);
    return m;
  });

  app.post('/api/v1/boards/:id/wiederherstellen', async (req) =>
    boards.wiederherstellen(n(req), req.params.id));

  app.delete('/api/v1/boards/:id', async (req, antwort) => {
    boards.endgueltigLoeschen(n(req), req.params.id);
    return antwort.code(204).send();
  });

  app.delete('/api/v1/papierkorb', async (req) => boards.papierkorbLeeren(n(req)));

  // Einen geloeschten Ordner samt allem, was mit ihm ging, endgueltig loeschen
  app.delete('/api/v1/papierkorb/ordner/:vorgang', async (req) => {
    const ergebnis = ordner.endgueltigLoeschen(n(req), req.params.vorgang);
    bilder.aufraeumen();
    return ergebnis;
  });

  // Live-Abgleich eines offenen Boards. Die Anmeldung prueft der
  // preHandler-Haken in index.js, bevor die Verbindung umgestellt wird.
  app.get('/api/v1/boards/:id/live', { websocket: true }, (socket, req) => {
    live.verbinden(socket, n(req), req.params.id);
  });

  // ---- Ordner

  app.get('/api/v1/ordner', async (req) => ({ ordner: ordner.liste(n(req)) }));

  app.post('/api/v1/ordner', async (req, antwort) =>
    antwort.code(201).send(ordner.anlegen(n(req), req.body ?? {})));

  // PATCH /ordner/:id { name?, elternId? } (elternId null = oberste Ebene)
  // steht weiter unten, weil es Live-Verbindungen neu prueft

  // Wer ueber einen Ordner auf Boards zugreift, verliert oder bekommt dabei
  // vielleicht Zugriff: offene Live-Verbindungen neu pruefen
  const unterOrdnerGeaendert = (ordnerId, vorher = []) => {
    const ids = new Set([...vorher, ...freigaben.boardsUnter(ordnerId).map((b) => b.id)]);
    for (const id of ids) live.zugriffGeaendert(id);
  };

  app.patch('/api/v1/ordner/:id', async (req) => {
    const vorher = freigaben.boardsUnter(req.params.id).map((b) => b.id);
    const ergebnis = ordner.aendern(n(req), req.params.id, req.body ?? {});
    unterOrdnerGeaendert(req.params.id, vorher);
    return ergebnis;
  });

  // Liefert { vorgang, ... } fuer "Rueckgaengig"
  app.delete('/api/v1/ordner/:id', async (req) => {
    const vorher = freigaben.boardsUnter(req.params.id).map((b) => b.id);
    const ergebnis = ordner.loeschen(n(req), req.params.id);
    for (const id of vorher) live.zugriffGeaendert(id);
    return ergebnis;
  });

  app.post('/api/v1/ordner/wiederherstellen', async (req, antwort) => {
    ordner.wiederherstellen(n(req), req.body?.vorgang);
    return antwort.code(204).send();
  });

  // Board ablegen: { ordnerId } (null = oberste Ebene)
  app.put('/api/v1/boards/:id/ort', async (req, antwort) => {
    ordner.boardAblegen(n(req), req.params.id, req.body?.ordnerId ?? null);
    live.zugriffGeaendert(req.params.id);
    return antwort.code(204).send();
  });

  // ---- Ordner teilen (gilt fuer alles darin)

  app.get('/api/v1/ordner/:id/freigaben', async (req) => freigaben.ordnerFreigabenListe(n(req), req.params.id));

  app.post('/api/v1/ordner/:id/freigaben', async (req) => {
    const ergebnis = freigaben.ordnerFreigabeSetzen(n(req), req.params.id, req.body ?? {});
    unterOrdnerGeaendert(req.params.id);
    return ergebnis;
  });

  app.delete('/api/v1/ordner/:id/freigaben/:email', async (req, antwort) => {
    freigaben.ordnerFreigabeEntfernen(n(req), req.params.id, req.params.email);
    unterOrdnerGeaendert(req.params.id);
    return antwort.code(204).send();
  });

  app.post('/api/v1/ordner/:id/freigaben/zurueck', async (req, antwort) => {
    freigaben.ordnerFreigabeZurueck(n(req), req.params.id);
    return antwort.code(204).send();
  });

  // ---- Bilder

  // Rohdaten im Body (Content-Type image/...), Id und Masse als Query
  app.post('/api/v1/boards/:id/bilder', { bodyLimit: bilder.MAX_BYTES + 1024 }, async (req, antwort) =>
    antwort.code(201).send(bilder.hochladen(n(req), req.params.id, req.body, {
      wunschId: req.query.id, breite: req.query.breite, hoehe: req.query.hoehe,
    })));

  // Ein Bild aendert sich nie (neues Bild = neue Id), darum darf der
  // Browser es behalten
  app.get('/api/v1/boards/:id/bilder/:bild', async (req, antwort) => {
    const { pfad, typ } = bilder.holen(n(req), req.params.id, req.params.bild);
    return antwort
      .header('content-type', typ)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .send(createReadStream(pfad));
  });

  // ---- Teilen

  app.get('/api/v1/boards/:id/freigaben', async (req) => freigaben.liste(n(req), req.params.id));

  // { email, recht: 'bearbeiten' | 'ansehen' }; dieselbe Adresse nochmal
  // aendert nur das Recht
  app.post('/api/v1/boards/:id/freigaben', async (req) => {
    const ergebnis = freigaben.setzen(n(req), req.params.id, req.body ?? {});
    live.zugriffGeaendert(req.params.id);
    return ergebnis;
  });

  // Besitzer entfernt jemanden, oder man entfernt sich selbst ("Aus meiner
  // Bibliothek entfernen")
  app.delete('/api/v1/boards/:id/freigaben/:email', async (req, antwort) => {
    freigaben.entfernen(n(req), req.params.id, req.params.email);
    live.zugriffGeaendert(req.params.id);
    return antwort.code(204).send();
  });

  // "Rueckgaengig" nach "Aus meiner Bibliothek entfernen"
  app.post('/api/v1/boards/:id/freigaben/zurueck', async (req, antwort) => {
    freigaben.zurueckholen(n(req), req.params.id);
    return antwort.code(204).send();
  });

  // Nachzuegler aus dem Offline-Puffer, wenn das Board nicht offen ist
  app.post('/api/v1/boards/:id/ops', async (req, antwort) => {
    live.opsAnwenden(n(req), req.params.id, req.body?.ops);
    return antwort.code(204).send();
  });
}
