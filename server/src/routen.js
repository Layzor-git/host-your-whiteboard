// All endpoints in one place. They only dispatch, the work happens in the
// modules next to them.
//
// Every request under /api/v1 already carries the signed-in user as
// req.nutzer, the hook in index.js takes care of that. /health is exempt,
// so you can check on the Pi without signing in.

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

  // The URL carries the version (?v=...), so the browser may keep the
  // image. New version, new URL.
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
    // Whoever had the board shared with them no longer sees it now
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

  // Permanently delete a deleted folder along with everything that went with it
  app.delete('/api/v1/papierkorb/ordner/:vorgang', async (req) => {
    const ergebnis = ordner.endgueltigLoeschen(n(req), req.params.vorgang);
    bilder.aufraeumen();
    return ergebnis;
  });

  // Live sync of an open board. Sign-in is checked by the preHandler hook
  // in index.js before the connection is upgraded.
  app.get('/api/v1/boards/:id/live', { websocket: true }, (socket, req) => {
    live.verbinden(socket, n(req), req.params.id);
  });

  // ---- Folders

  app.get('/api/v1/ordner', async (req) => ({ ordner: ordner.liste(n(req)) }));

  app.post('/api/v1/ordner', async (req, antwort) =>
    antwort.code(201).send(ordner.anlegen(n(req), req.body ?? {})));

  // PATCH /ordner/:id { name?, elternId? } (elternId null = top level)
  // is further down, because it re-checks live connections

  // Whoever accesses boards through a folder may lose or gain access in
  // the process: re-check open live connections
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

  // Returns { vorgang, ... } for "Undo"
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

  // Place a board: { ordnerId } (null = top level)
  app.put('/api/v1/boards/:id/ort', async (req, antwort) => {
    ordner.boardAblegen(n(req), req.params.id, req.body?.ordnerId ?? null);
    live.zugriffGeaendert(req.params.id);
    return antwort.code(204).send();
  });

  // ---- Sharing folders (applies to everything inside)

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

  // ---- Images

  // Raw data in the body (Content-Type image/...), id and dimensions as query
  app.post('/api/v1/boards/:id/bilder', { bodyLimit: bilder.MAX_BYTES + 1024 }, async (req, antwort) =>
    antwort.code(201).send(bilder.hochladen(n(req), req.params.id, req.body, {
      wunschId: req.query.id, breite: req.query.breite, hoehe: req.query.hoehe,
    })));

  // An image never changes (new image = new id), so the browser may
  // keep it
  app.get('/api/v1/boards/:id/bilder/:bild', async (req, antwort) => {
    const { pfad, typ } = bilder.holen(n(req), req.params.id, req.params.bild);
    return antwort
      .header('content-type', typ)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .send(createReadStream(pfad));
  });

  // ---- Sharing

  app.get('/api/v1/boards/:id/freigaben', async (req) => freigaben.liste(n(req), req.params.id));

  // { email, recht: 'bearbeiten' | 'ansehen' }; the same address again
  // only changes the permission
  app.post('/api/v1/boards/:id/freigaben', async (req) => {
    const ergebnis = freigaben.setzen(n(req), req.params.id, req.body ?? {});
    live.zugriffGeaendert(req.params.id);
    return ergebnis;
  });

  // Owner removes someone, or you remove yourself ("Remove from my
  // library")
  app.delete('/api/v1/boards/:id/freigaben/:email', async (req, antwort) => {
    freigaben.entfernen(n(req), req.params.id, req.params.email);
    live.zugriffGeaendert(req.params.id);
    return antwort.code(204).send();
  });

  // "Undo" after "Remove from my library"
  app.post('/api/v1/boards/:id/freigaben/zurueck', async (req, antwort) => {
    freigaben.zurueckholen(n(req), req.params.id);
    return antwort.code(204).send();
  });

  // Stragglers from the offline buffer, when the board is not open
  app.post('/api/v1/boards/:id/ops', async (req, antwort) => {
    live.opsAnwenden(n(req), req.params.id, req.body?.ops);
    return antwort.code(204).send();
  });
}
