// Live sync: whoever has a board open is attached to its "room" via
// WebSocket. Changes arrive as small operations, are applied to the state
// in memory, distributed to all other devices in the room and written to
// the database shortly afterwards.
//
// Operations (from the browser, see web/src/daten/live.js):
//   { art: 'setzen', el }        create or replace an element (by id)
//   { art: 'loeschen', id }      remove an element
//   { art: 'hintergrund', wert } { farbe, muster }
//
// Every element has its own id and is always replaced as a whole. Two
// devices can therefore only get in each other's way if they change
// exactly the same element; then whatever arrives last wins.
//
// Messages:
//   Browser -> Server  { t: 'ops', nr, ops }       nr counts per connection
//                      { t: 'entwurf', el }       stroke being drawn right now
//                                                 (null = finished/cancelled)
//                      { t: 'ping' }
//   Server -> Browser  { t: 'stand', elemente, hintergrund, titel }
//                      { t: 'ich', verbindung, farbe, recht }
//                      { t: 'anwesend', personen: [{ verbindung, name, email, farbe, recht }] }
//                      { t: 'ack', nr }
//                      { t: 'ops', ops }          from another device
//                      { t: 'entwurf', von, el }  from another device
//                      { t: 'meta', titel?, hintergrund? }
//
// Whoever may only view receives everything, but cannot send anything.

import { datenbank, jetzt } from './db.js';
import { MELDUNGEN, Ungueltig } from './fehler.js';
import { kennfarbe, pruefen, zugriff } from './freigaben.js';

const SPEICHERN_NACH_MS = 1000;
const FARBEN = ['white', 'paper', 'grey', 'mint', 'sky', 'slate'];
const MUSTER = ['none', 'dots', 'grid', 'lines'];

const raeume = new Map(); // boardId -> room

let verbindungsZaehler = 0;

class Raum {
  constructor(zeile) {
    this.id = zeile.id;
    this.titel = zeile.titel;
    this.hintergrund = JSON.parse(zeile.hintergrund);
    this.elemente = new Map();
    for (const el of JSON.parse(zeile.daten).elemente ?? []) this.elemente.set(el.id, el);
    this.verbindungen = new Set();
    this.uhr = null;
    this.geaendert = false;
  }

  anwenden(ops) {
    for (const op of ops) {
      if (op.art === 'setzen') this.elemente.set(op.el.id, op.el);
      else if (op.art === 'loeschen') this.elemente.delete(op.id);
      else if (op.art === 'hintergrund') this.hintergrund = op.wert;
    }
    this.geaendert = true;
    clearTimeout(this.uhr);
    this.uhr = setTimeout(() => this.speichern(), SPEICHERN_NACH_MS);
  }

  /** Replace everything, e.g. when a whole state arrives via REST. */
  ersetzen(elemente) {
    this.elemente = new Map(elemente.map((el) => [el.id, el]));
    this.geaendert = true;
    this.speichern();
    this.senden(null, this.stand());
  }

  stand() {
    return { t: 'stand', elemente: [...this.elemente.values()], hintergrund: this.hintergrund, titel: this.titel };
  }

  personen() {
    return [...this.verbindungen].map((v) => ({
      verbindung: v.wb.id, name: v.wb.name, email: v.wb.email, farbe: v.wb.farbe, recht: v.wb.recht,
    }));
  }

  /** To all connections except "ausser". */
  senden(ausser, nachricht) {
    const text = JSON.stringify(nachricht);
    for (const v of this.verbindungen) if (v !== ausser && v.readyState === 1) v.send(text);
  }

  speichern() {
    clearTimeout(this.uhr);
    if (!this.geaendert) return;
    this.geaendert = false;
    const elemente = [...this.elemente.values()];
    datenbank()
      .prepare(`UPDATE board SET daten = ?, anzahl = ?, hintergrund = ?, version = version + 1, geaendert_am = ?
                WHERE id = ?`)
      .run(JSON.stringify({ version: 1, elemente }), elemente.length, JSON.stringify(this.hintergrund), jetzt(), this.id);
  }
}

function raumHolen(nutzerId, boardId) {
  // Even an open room is only shown to those with access
  const { board } = pruefen(nutzerId, boardId);
  const vorhanden = raeume.get(boardId);
  if (vorhanden) return vorhanden;
  const raum = new Raum(board);
  raeume.set(boardId, raum);
  return raum;
}

/** Current state if the board is open live right now, otherwise null. */
export function liveStand(boardId) {
  const r = raeume.get(boardId);
  return r ? { elemente: [...r.elemente.values()], hintergrund: r.hintergrund } : null;
}

/** After saving via REST: bring the open room up to date. */
export function nachRestSpeichern(boardId, { titel, hintergrund, daten }) {
  const r = raeume.get(boardId);
  if (!r) return;
  if (titel !== undefined) r.titel = titel;
  if (hintergrund !== undefined) r.hintergrund = hintergrund;
  if (daten !== undefined) {
    r.ersetzen(daten.elemente);
    return;
  }
  if (titel !== undefined || hintergrund !== undefined) {
    r.senden(null, { t: 'meta', ...(titel !== undefined ? { titel } : {}), ...(hintergrund !== undefined ? { hintergrund } : {}) });
  }
}

/** Validate ops. Throws Ungueltig with a readable sentence. */
export function opsPruefen(ops) {
  if (!Array.isArray(ops)) throw new Ungueltig('ops_not_list');
  for (const op of ops) {
    if (op?.art === 'setzen') {
      const el = op.el;
      if (!el || typeof el !== 'object' || typeof el.id !== 'string' || typeof el.typ !== 'string' || el.id.length > 64) {
        throw new Ungueltig('op_element_invalid');
      }
    } else if (op?.art === 'loeschen') {
      if (typeof op.id !== 'string') throw new Ungueltig('op_delete_without_id');
    } else if (op?.art === 'hintergrund') {
      if (!FARBEN.includes(op.wert?.farbe) || !MUSTER.includes(op.wert?.muster)) {
        throw new Ungueltig('op_background_invalid');
      }
    } else {
      throw new Ungueltig('op_unknown');
    }
  }
  return ops;
}

/** Apply ops without an open connection (stragglers from the offline buffer). */
export function opsAnwenden(nutzerId, boardId, ops) {
  opsPruefen(ops);
  pruefen(nutzerId, boardId, 'bearbeiten');
  const offen = raeume.has(boardId);
  const raum = raumHolen(nutzerId, boardId);
  raum.anwenden(ops);
  raum.senden(null, { t: 'ops', ops });
  if (!offen && !raum.verbindungen.size) {
    raum.speichern();
    raeume.delete(boardId);
  }
}

/** Attach a WebSocket connection to the board's room. */
export function verbinden(socket, nutzerId, boardId) {
  let raum;
  let recht;
  try {
    raum = raumHolen(nutzerId, boardId);
    recht = zugriff(nutzerId, boardId).recht;
  } catch (e) {
    socket.send(JSON.stringify({ t: 'fehler', code: e.code, text: e.message }));
    socket.close(4404, 'nicht gefunden');
    return;
  }
  const person = datenbank().prepare('SELECT name, email FROM nutzer WHERE id = ?').get(nutzerId);
  socket.wb = { id: ++verbindungsZaehler, nutzerId, name: person.name, email: person.email, farbe: kennfarbe(nutzerId), recht };
  raum.verbindungen.add(socket);
  // Permission first, then the state: whoever may only view knows it before
  // they could send anything at all.
  socket.send(JSON.stringify({ t: 'ich', verbindung: socket.wb.id, farbe: socket.wb.farbe, recht }));
  socket.send(JSON.stringify(raum.stand()));
  raum.senden(null, { t: 'anwesend', personen: raum.personen() });

  socket.on('message', (roh) => {
    let n;
    try {
      n = JSON.parse(roh);
    } catch {
      return;
    }
    if (n.t === 'ping') {
      socket.send('{"t":"pong"}');
      return;
    }
    if (n.t !== 'ops' && n.t !== 'entwurf') return;
    if (socket.wb.recht === 'ansehen') {
      socket.send(JSON.stringify({ t: 'fehler', code: 'view_only_board', text: MELDUNGEN.view_only_board, nr: n.nr }));
      return;
    }
    if (n.t === 'entwurf') {
      const el = n.el && typeof n.el === 'object' ? n.el : null;
      raum.senden(socket, { t: 'entwurf', von: socket.wb.id, el });
      return;
    }
    try {
      opsPruefen(n.ops);
    } catch (e) {
      socket.send(JSON.stringify({ t: 'fehler', code: e.code, text: e.message, nr: n.nr }));
      return;
    }
    raum.anwenden(n.ops);
    raum.senden(socket, { t: 'ops', ops: n.ops });
    socket.send(JSON.stringify({ t: 'ack', nr: n.nr }));
  });

  socket.on('close', () => {
    raum.verbindungen.delete(socket);
    if (!raum.verbindungen.size) {
      raum.speichern();
      raeume.delete(boardId);
      return;
    }
    // A half-drawn stroke of this connection disappears
    raum.senden(null, { t: 'entwurf', von: socket.wb.id, el: null });
    raum.senden(null, { t: 'anwesend', personen: raum.personen() });
  });
}

/**
 * Shares have changed: whoever no longer has access is kicked out,
 * whoever has a different permission learns about it right away.
 */
export function zugriffGeaendert(boardId) {
  const raum = raeume.get(boardId);
  if (!raum) return;
  for (const v of [...raum.verbindungen]) {
    const z = zugriff(v.wb.nutzerId, boardId);
    if (!z) {
      v.close(4403, 'kein Zugriff mehr');
    } else if (z.recht !== v.wb.recht) {
      v.wb.recht = z.recht;
      v.send(JSON.stringify({ t: 'ich', verbindung: v.wb.id, farbe: v.wb.farbe, recht: z.recht }));
    }
  }
  raum.senden(null, { t: 'anwesend', personen: raum.personen() });
}

/** On shutdown: write everything pending right away. */
export function allesSpeichern() {
  for (const r of raeume.values()) r.speichern();
}
