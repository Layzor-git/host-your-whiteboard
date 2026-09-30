// Ordner in der Bibliothek, beliebig verschachtelt. Ordner gehoeren immer
// einer Person. Wo ein Board liegt, steht je Person in board_ort: So kann
// jede Person ein geteiltes Board in ihre eigenen Ordner legen, ohne dass
// sich fuer die anderen etwas aendert.
//
// Loeschen ist ein "Vorgang": Unterordner verschwinden mit, eigene Boards
// kommen in den Papierkorb, geteilte werden nur aus der eigenen Bibliothek
// entfernt. Alles traegt dieselbe Vorgangs-Id, damit "Rueckgaengig" genau
// das zurueckholt.

import { datenbank, jetzt, neueId } from './db.js';
import { NichtGefunden, Ungueltig } from './fehler.js';
import { pruefen } from './freigaben.js';

function nameVon(name) {
  const n = String(name ?? '').trim();
  if (!n) throw new Ungueltig('folder_name_missing');
  if (n.length > 120) throw new Ungueltig('folder_name_too_long');
  return n;
}

function aktive(nutzerId) {
  return datenbank()
    .prepare('SELECT id, name, eltern_id, erstellt_am FROM ordner WHERE nutzer_id = ? AND geloescht_am IS NULL')
    .all(nutzerId);
}

function holen(nutzerId, id) {
  const o = datenbank()
    .prepare('SELECT * FROM ordner WHERE id = ? AND nutzer_id = ? AND geloescht_am IS NULL')
    .get(id, nutzerId);
  if (!o) throw new NichtGefunden('folder_not_found');
  return o;
}

/** Ordner und alle darunter */
function teilbaum(nutzerId, id) {
  const alle = aktive(nutzerId);
  const ids = new Set([id]);
  let neu = true;
  while (neu) {
    neu = false;
    for (const o of alle) {
      if (o.eltern_id && ids.has(o.eltern_id) && !ids.has(o.id)) {
        ids.add(o.id);
        neu = true;
      }
    }
  }
  return ids;
}

/** Wo der Nutzer seine Boards abgelegt hat: board_id -> ordner_id (nur gueltige). */
export function orte(nutzerId) {
  const gueltig = new Set(aktive(nutzerId).map((o) => o.id));
  const m = new Map();
  for (const z of datenbank().prepare('SELECT board_id, ordner_id FROM board_ort WHERE nutzer_id = ?').all(nutzerId)) {
    if (z.ordner_id && gueltig.has(z.ordner_id)) m.set(z.board_id, z.ordner_id);
  }
  return m;
}

/** So lange bleibt Geloeschtes im Papierkorb, Boards wie Ordner. */
export const PAPIERKORB_TAGE = 30;

function ordnerEndgueltigLoeschen(ids) {
  if (!ids.length) return;
  const platz = ids.map(() => '?').join(',');
  const db = datenbank();
  db.prepare(`DELETE FROM ordner_freigabe WHERE ordner_id IN (${platz})`).run(...ids);
  db.prepare(`DELETE FROM board_ort WHERE ordner_id IN (${platz})`).run(...ids);
  db.prepare(`DELETE FROM ordner WHERE id IN (${platz})`).run(...ids);
}

export function liste(nutzerId) {
  // Was laenger als die Papierkorb-Frist geloescht ist, endgueltig entfernen
  const grenze = new Date(Date.now() - PAPIERKORB_TAGE * 864e5).toISOString();
  ordnerEndgueltigLoeschen(datenbank()
    .prepare('SELECT id FROM ordner WHERE nutzer_id = ? AND geloescht_am IS NOT NULL AND geloescht_am < ?')
    .all(nutzerId, grenze)
    .map((o) => o.id));
  return aktive(nutzerId).map((o) => ({ id: o.id, name: o.name, elternId: o.eltern_id, erstelltAm: o.erstellt_am }));
}

/**
 * Geloeschte Ordner fuer den Papierkorb: nur die, die man selbst geloescht
 * hat (Unterordner kommen mit ihnen). Mit Zaehlern, was darin mitging.
 */
export function papierkorb(nutzerId) {
  const db = datenbank();
  const weg = db
    .prepare('SELECT * FROM ordner WHERE nutzer_id = ? AND geloescht_am IS NOT NULL')
    .all(nutzerId);
  const nachId = new Map(weg.map((o) => [o.id, o]));
  const oben = weg.filter((o) => {
    const e = o.eltern_id && nachId.get(o.eltern_id);
    return !e || e.vorgang !== o.vorgang;
  });
  const aktiveIds = new Map(aktive(nutzerId).map((o) => [o.id, o]));
  return oben.map((o) => {
    const unter = weg.filter((x) => x.vorgang === o.vorgang && x.id !== o.id).length;
    const boards = db
      .prepare('SELECT COUNT(*) AS n FROM board WHERE nutzer_id = ? AND vorgang = ? AND geloescht_am IS NOT NULL')
      .get(nutzerId, o.vorgang).n;
    return {
      id: o.id,
      name: o.name,
      vorgang: o.vorgang,
      geloeschtAm: o.geloescht_am,
      unterordner: unter,
      boards: Number(boards),
      // Wohin er zurueckkommt (der Elternordner, falls es ihn noch gibt)
      elternName: aktiveIds.get(o.eltern_id)?.name ?? null,
    };
  });
}

/**
 * Einen Ordner und alle ueber ihm wieder herstellen, falls geloescht. So
 * kommt ein einzeln wiederhergestelltes Board an seinen alten Ort, statt
 * ganz oben zu landen. Geschwister bleiben im Papierkorb.
 */
export function pfadWiederherstellen(nutzerId, ordnerId) {
  const q = datenbank().prepare('SELECT * FROM ordner WHERE id = ? AND nutzer_id = ?');
  const auf = datenbank().prepare('UPDATE ordner SET geloescht_am = NULL, vorgang = NULL WHERE id = ?');
  let id = ordnerId;
  for (let i = 0; id && i < 100; i++) {
    const o = q.get(id, nutzerId);
    if (!o) return;
    if (o.geloescht_am) auf.run(o.id);
    id = o.eltern_id;
  }
}

/** Einen geloeschten Ordner samt allem, was mit ihm ging, endgueltig loeschen. */
export function endgueltigLoeschen(nutzerId, vorgang) {
  const db = datenbank();
  const ids = db
    .prepare('SELECT id FROM ordner WHERE nutzer_id = ? AND vorgang = ? AND geloescht_am IS NOT NULL')
    .all(nutzerId, String(vorgang))
    .map((o) => o.id);
  if (!ids.length) throw new NichtGefunden('folder_not_in_trash');
  const r = db
    .prepare('DELETE FROM board WHERE nutzer_id = ? AND vorgang = ? AND geloescht_am IS NOT NULL')
    .run(nutzerId, String(vorgang));
  ordnerEndgueltigLoeschen(ids);
  return { boards: Number(r.changes) };
}

/** Papierkorb leeren: alle geloeschten Ordner. */
export function papierkorbLeeren(nutzerId) {
  ordnerEndgueltigLoeschen(datenbank()
    .prepare('SELECT id FROM ordner WHERE nutzer_id = ? AND geloescht_am IS NOT NULL')
    .all(nutzerId)
    .map((o) => o.id));
}

export function anlegen(nutzerId, eingabe) {
  const name = nameVon(eingabe.name);
  const eltern = eingabe.elternId ?? null;
  if (eltern) holen(nutzerId, eltern);
  const id = neueId('o');
  datenbank()
    .prepare('INSERT INTO ordner (id, nutzer_id, name, eltern_id, erstellt_am) VALUES (?, ?, ?, ?, ?)')
    .run(id, nutzerId, name, eltern, jetzt());
  return { id, name, elternId: eltern };
}

export function aendern(nutzerId, id, eingabe) {
  const o = holen(nutzerId, id);
  const name = eingabe.name !== undefined ? nameVon(eingabe.name) : o.name;
  let eltern = o.eltern_id;
  if (eingabe.elternId !== undefined) {
    eltern = eingabe.elternId ?? null;
    if (eltern) {
      holen(nutzerId, eltern);
      if (teilbaum(nutzerId, id).has(eltern)) {
        throw new Ungueltig('folder_cycle');
      }
    }
  }
  datenbank().prepare('UPDATE ordner SET name = ?, eltern_id = ? WHERE id = ?').run(name, eltern, id);
  return { id, name, elternId: eltern };
}

/** Board an einen Ort legen (null = oberste Ebene), fuer diesen Nutzer. */
export function boardAblegen(nutzerId, boardId, ordnerId) {
  pruefen(nutzerId, boardId);
  if (ordnerId) holen(nutzerId, ordnerId);
  datenbank()
    .prepare(`INSERT INTO board_ort (nutzer_id, board_id, ordner_id) VALUES (?, ?, ?)
              ON CONFLICT (nutzer_id, board_id) DO UPDATE SET ordner_id = excluded.ordner_id`)
    .run(nutzerId, boardId, ordnerId ?? null);
}

export function loeschen(nutzerId, id) {
  holen(nutzerId, id);
  const ids = [...teilbaum(nutzerId, id)];
  const vorgang = neueId('v');
  const zeit = jetzt();
  const db = datenbank();
  const email = db.prepare('SELECT email FROM nutzer WHERE id = ?').get(nutzerId).email;
  const platz = ids.map(() => '?').join(',');
  const drin = db
    .prepare(`SELECT b.id, b.nutzer_id FROM board_ort o JOIN board b ON b.id = o.board_id
              WHERE o.nutzer_id = ? AND o.ordner_id IN (${platz}) AND b.geloescht_am IS NULL`)
    .all(nutzerId, ...ids);
  let eigene = 0;
  let geteilt = 0;
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE ordner SET geloescht_am = ?, vorgang = ? WHERE id IN (${platz})`).run(zeit, vorgang, ...ids);
    for (const b of drin) {
      if (b.nutzer_id === nutzerId) {
        db.prepare('UPDATE board SET geloescht_am = ?, vorgang = ? WHERE id = ?').run(zeit, vorgang, b.id);
        eigene++;
      } else {
        db.prepare(`UPDATE board_freigabe SET entfernt_am = ?, vorgang = ?
                    WHERE board_id = ? AND email = ? AND entfernt_am IS NULL`).run(zeit, vorgang, b.id, email);
        geteilt++;
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { vorgang, ordner: ids.length, eigene, geteilt };
}

export function wiederherstellen(nutzerId, vorgang) {
  const db = datenbank();
  const v = String(vorgang);
  const ordnerIds = db.prepare('SELECT id, eltern_id FROM ordner WHERE nutzer_id = ? AND vorgang = ?').all(nutzerId, v);
  const boardIds = db.prepare('SELECT id FROM board WHERE nutzer_id = ? AND vorgang = ?').all(nutzerId, v);
  const email = db.prepare('SELECT email FROM nutzer WHERE id = ?').get(nutzerId).email;
  // Ordner, eigene Boards und aus der Bibliothek entfernte geteilte Boards.
  // Einiges kann schon vorher zurueckgekommen sein (ein einzelnes Board samt
  // Pfad): Nur wenn gar nichts mehr uebrig ist, ist es zu spaet.
  const n = Number(db.prepare('UPDATE ordner SET geloescht_am = NULL, vorgang = NULL WHERE nutzer_id = ? AND vorgang = ?')
    .run(nutzerId, v).changes)
    + Number(db.prepare('UPDATE board SET geloescht_am = NULL, vorgang = NULL WHERE nutzer_id = ? AND vorgang = ?')
      .run(nutzerId, v).changes)
    + Number(db.prepare('UPDATE board_freigabe SET entfernt_am = NULL, vorgang = NULL WHERE email = ? AND vorgang = ?')
      .run(email, v).changes);
  if (!n) throw new NichtGefunden('undo_expired');
  // Liegt ein Elternordner inzwischen selbst im Papierkorb, kommt er mit
  for (const o of ordnerIds) if (o.eltern_id) pfadWiederherstellen(nutzerId, o.eltern_id);
  const ort = db.prepare('SELECT ordner_id FROM board_ort WHERE nutzer_id = ? AND board_id = ?');
  for (const b of boardIds) {
    const o = ort.get(nutzerId, b.id)?.ordner_id;
    if (o) pfadWiederherstellen(nutzerId, o);
  }
}
