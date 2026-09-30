// Wer darf was mit einem Board? Die eine Stelle, die das entscheidet.
//
//   besitzer    alles, auch teilen und loeschen
//   bearbeiten  zeichnen, umbenennen, Hintergrund; nicht teilen, nicht loeschen
//   ansehen     nur anschauen
//
// Freigaben haengen an der E-Mail-Adresse. Wer eingeladen wird, muss auch
// in der Cloudflare-Access-Richtlinie stehen, sonst kommt er gar nicht bis
// hierher. Ein Board im Papierkorb ist fuer alle ausser dem Besitzer weg.

import { datenbank, jetzt } from './db.js';
import { KeinRecht, NichtGefunden, Ungueltig } from './fehler.js';

const RECHTE = ['bearbeiten', 'ansehen'];

// Kennfarben aus dem Design (tokens.ts, PEER_COLORS). Fest je Person, per
// Hash der Nutzer-Id: Dieselbe Person hat ueberall dieselbe Farbe.
const KENNFARBEN = ['teal', 'coral', 'amber', 'green', 'pink', 'violet'];

export function kennfarbe(nutzerId) {
  let h = 0;
  for (const c of String(nutzerId)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return KENNFARBEN[h % KENNFARBEN.length];
}

/** Name, E-Mail, Kennfarbe einer Person; ohne Konto nur die E-Mail. */
function person(email) {
  const n = datenbank().prepare('SELECT id, name, email FROM nutzer WHERE email = ?').get(email);
  return n
    ? { email: n.email, name: n.name, farbe: kennfarbe(n.id), angemeldet: true }
    : { email, name: null, farbe: null, angemeldet: false };
}
const RANG = { ansehen: 1, bearbeiten: 2, besitzer: 3 };

function emailVon(nutzerId) {
  return datenbank().prepare('SELECT email FROM nutzer WHERE id = ?').get(nutzerId)?.email;
}

function besser(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return RANG[a] >= RANG[b] ? a : b;
}

// ---------------------------------------------------------------- Ordner
//
// Ein geteilter Ordner gibt Zugriff auf alles darunter: Unterordner und die
// Boards, die der BESITZER dort abgelegt hat (board_ort des Besitzers). Das
// Recht ist das beste aus allen Freigaben auf dem Weg nach oben.

/** Der Ordner und alle ueber ihm, nur aktive. Leer, wenn es ihn nicht gibt. */
function ordnerKette(ordnerId) {
  const q = datenbank().prepare('SELECT * FROM ordner WHERE id = ? AND geloescht_am IS NULL');
  const kette = [];
  let id = ordnerId;
  while (id && kette.length < 100) {
    const o = q.get(id);
    if (!o) break;
    kette.push(o);
    id = o.eltern_id;
  }
  return kette;
}

/** Bestes Recht einer E-Mail ueber Ordnerfreigaben auf dem Weg nach oben. */
function rechtUeberOrdner(email, ordnerId) {
  if (!email || !ordnerId) return null;
  const q = datenbank()
    .prepare('SELECT recht FROM ordner_freigabe WHERE ordner_id = ? AND email = ? AND entfernt_am IS NULL');
  let recht = null;
  for (const o of ordnerKette(ordnerId)) recht = besser(recht, q.get(o.id, email)?.recht);
  return recht;
}

/** Wo der Besitzer das Board abgelegt hat (dort gelten Ordnerfreigaben). */
function ortBeimBesitzer(board) {
  return datenbank()
    .prepare('SELECT ordner_id FROM board_ort WHERE nutzer_id = ? AND board_id = ?')
    .get(board.nutzer_id, board.id)?.ordner_id ?? null;
}

/** { board, recht } oder null, wenn der Nutzer das Board nicht sehen darf. */
export function zugriff(nutzerId, boardId) {
  const board = datenbank().prepare('SELECT * FROM board WHERE id = ?').get(boardId);
  if (!board) return null;
  if (board.nutzer_id === nutzerId) return { board, recht: 'besitzer' };
  if (board.geloescht_am) return null;
  const email = emailVon(nutzerId);
  const f = datenbank()
    .prepare('SELECT recht FROM board_freigabe WHERE board_id = ? AND email = ? AND entfernt_am IS NULL')
    .get(boardId, email);
  const recht = besser(f?.recht, rechtUeberOrdner(email, ortBeimBesitzer(board)));
  return recht ? { board, recht } : null;
}

/** { ordner, recht } oder null. */
export function ordnerZugriff(nutzerId, ordnerId) {
  const [ordner] = ordnerKette(ordnerId);
  if (!ordner) return null;
  if (ordner.nutzer_id === nutzerId) return { ordner, recht: 'besitzer' };
  const recht = rechtUeberOrdner(emailVon(nutzerId), ordnerId);
  return recht ? { ordner, recht } : null;
}

export function ordnerPruefen(nutzerId, ordnerId, benoetigt = 'ansehen') {
  const z = ordnerZugriff(nutzerId, ordnerId);
  if (!z) throw new NichtGefunden('folder_not_found');
  if (RANG[z.recht] < RANG[benoetigt]) {
    throw new KeinRecht(benoetigt === 'besitzer' ? 'only_owner_folder' : 'view_only_folder');
  }
  return z;
}

/** Alle aktiven Ordner unter einem Ordner (mit ihm selbst), beim Besitzer. */
export function ordnerTeilbaum(ordnerId) {
  const wurzel = datenbank().prepare('SELECT nutzer_id FROM ordner WHERE id = ?').get(ordnerId);
  if (!wurzel) return [];
  const alle = datenbank()
    .prepare('SELECT * FROM ordner WHERE nutzer_id = ? AND geloescht_am IS NULL')
    .all(wurzel.nutzer_id);
  const ids = new Set([ordnerId]);
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
  return alle.filter((o) => ids.has(o.id));
}

/** Boards, die der Besitzer irgendwo unter diesem Ordner abgelegt hat. */
export function boardsUnter(ordnerId) {
  const ordner = ordnerTeilbaum(ordnerId);
  if (!ordner.length) return [];
  const platz = ordner.map(() => '?').join(',');
  return datenbank()
    .prepare(`SELECT b.* FROM board b JOIN board_ort o ON o.board_id = b.id AND o.nutzer_id = b.nutzer_id
              WHERE o.ordner_id IN (${platz})`)
    .all(...ordner.map((o) => o.id));
}

function ordnerPersonen(ordnerId) {
  return datenbank()
    .prepare(`SELECT email, recht, erstellt_am FROM ordner_freigabe
              WHERE ordner_id = ? AND entfernt_am IS NULL ORDER BY erstellt_am`)
    .all(ordnerId)
    .map((f) => ({ ...person(f.email), recht: f.recht, seit: f.erstellt_am }));
}

export function ordnerFreigabenListe(nutzerId, ordnerId) {
  const { ordner } = ordnerPruefen(nutzerId, ordnerId);
  return { besitzer: besitzerVon(ordner), freigaben: ordnerPersonen(ordnerId) };
}

export function ordnerFreigabeSetzen(nutzerId, ordnerId, eingabe) {
  const { ordner } = ordnerPruefen(nutzerId, ordnerId, 'besitzer');
  const email = String(eingabe.email ?? '').toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Ungueltig('email_invalid');
  if (email === emailVon(ordner.nutzer_id)) throw new Ungueltig('folder_already_yours');
  const recht = eingabe.recht ?? 'bearbeiten';
  if (!RECHTE.includes(recht)) throw new Ungueltig('permission_unknown');
  datenbank()
    .prepare(`INSERT INTO ordner_freigabe (ordner_id, email, recht, erstellt_am) VALUES (?, ?, ?, ?)
              ON CONFLICT (ordner_id, email) DO UPDATE SET recht = excluded.recht, entfernt_am = NULL`)
    .run(ordnerId, email, recht, jetzt());
  return ordnerFreigabenListe(nutzerId, ordnerId);
}

/** Der Besitzer entfernt jemanden, oder jemand entfernt den Ordner aus seiner Bibliothek. */
export function ordnerFreigabeEntfernen(nutzerId, ordnerId, email) {
  const z = ordnerPruefen(nutzerId, ordnerId);
  const ziel = String(email).toLowerCase().trim();
  if (z.recht !== 'besitzer' && ziel !== emailVon(nutzerId)) {
    throw new KeinRecht('only_owner_removes_folder');
  }
  if (z.recht === 'besitzer') {
    datenbank().prepare('DELETE FROM ordner_freigabe WHERE ordner_id = ? AND email = ?').run(ordnerId, ziel);
  } else {
    const r = datenbank()
      .prepare('UPDATE ordner_freigabe SET entfernt_am = ? WHERE ordner_id = ? AND email = ? AND entfernt_am IS NULL')
      .run(jetzt(), ordnerId, ziel);
    if (!r.changes) throw new Ungueltig('only_shared_root_removable');
  }
}

export function ordnerFreigabeZurueck(nutzerId, ordnerId) {
  const r = datenbank()
    .prepare(`UPDATE ordner_freigabe SET entfernt_am = NULL
              WHERE ordner_id = ? AND email = ? AND entfernt_am IS NOT NULL`)
    .run(ordnerId, emailVon(nutzerId));
  if (!r.changes) throw new NichtGefunden('folder_not_found');
}

/**
 * Mit mir geteilte Ordner samt allem darunter, wie beim Besitzer
 * verschachtelt. Die obersten stehen bei mir ganz oben (elternId null).
 * Liefert { ordner: [...], boards: [...zeilen mit recht] }.
 */
export function ordnerMitMirGeteilt(nutzerId) {
  const email = emailVon(nutzerId);
  const wurzeln = datenbank()
    .prepare(`SELECT o.id FROM ordner_freigabe f JOIN ordner o ON o.id = f.ordner_id
              WHERE f.email = ? AND f.entfernt_am IS NULL AND o.geloescht_am IS NULL AND o.nutzer_id != ?`)
    .all(email, nutzerId);
  const ordner = new Map();
  const oben = new Set();
  for (const { id } of wurzeln) {
    oben.add(id);
    for (const o of ordnerTeilbaum(id)) ordner.set(o.id, o);
  }
  const ergebnis = [];
  for (const o of ordner.values()) {
    // Oberste Ebene: geteilte Wurzel, deren Eltern ich nicht sehe
    const elternSichtbar = o.eltern_id && ordner.has(o.eltern_id);
    ergebnis.push({
      id: o.id,
      name: o.name,
      elternId: elternSichtbar ? o.eltern_id : null,
      erstelltAm: o.erstellt_am,
      recht: rechtUeberOrdner(email, o.id),
      besitzer: besitzerVon(o),
      // Nur die geteilte Wurzel selbst laesst sich aus der Bibliothek entfernen
      geteilteWurzel: oben.has(o.id) && !elternSichtbar,
    });
  }
  const boards = [];
  if (ordner.size) {
    const platz = [...ordner.keys()].map(() => '?').join(',');
    for (const b of datenbank()
      .prepare(`SELECT b.*, o.ordner_id AS ort FROM board b
                JOIN board_ort o ON o.board_id = b.id AND o.nutzer_id = b.nutzer_id
                WHERE o.ordner_id IN (${platz}) AND b.geloescht_am IS NULL AND b.nutzer_id != ?`)
      .all(...ordner.keys(), nutzerId)) {
      boards.push({ ...b, recht: zugriff(nutzerId, b.id)?.recht ?? 'ansehen' });
    }
  }
  return { ordner: ergebnis, boards };
}

/** Personen je eigenem geteilten Ordner, fuer die Ordnerkachel. */
export function personenJeOrdner(nutzerId) {
  const m = new Map();
  for (const z of datenbank()
    .prepare(`SELECT f.ordner_id, f.email FROM ordner_freigabe f JOIN ordner o ON o.id = f.ordner_id
              WHERE o.nutzer_id = ? AND f.entfernt_am IS NULL ORDER BY f.erstellt_am`)
    .all(nutzerId)) {
    if (!m.has(z.ordner_id)) m.set(z.ordner_id, []);
    m.get(z.ordner_id).push(person(z.email));
  }
  return m;
}

/** Fuer den Teilen-Dialog eines Boards: wer es ueber welchen Ordner sieht. */
export function ueberOrdnerVon(board) {
  const ort = ortBeimBesitzer(board);
  if (!ort) return [];
  return ordnerKette(ort)
    .map((o) => ({ ordner: { id: o.id, name: o.name }, personen: ordnerPersonen(o.id) }))
    .filter((x) => x.personen.length);
}

/**
 * Wie zugriff(), wirft aber: NichtGefunden, wenn das Board fuer den Nutzer
 * nicht existiert, KeinRecht, wenn es sichtbar ist, das Recht aber nicht
 * reicht. benoetigt: 'ansehen' | 'bearbeiten' | 'besitzer'
 */
export function pruefen(nutzerId, boardId, benoetigt = 'ansehen') {
  const z = zugriff(nutzerId, boardId);
  if (!z) throw new NichtGefunden('board_not_found');
  if (RANG[z.recht] < RANG[benoetigt]) {
    throw new KeinRecht(benoetigt === 'besitzer' ? 'only_owner_board' : 'view_only_board');
  }
  return z;
}

/** Personen, mit denen ein Board geteilt ist (ohne Besitzer). */
export function personenVon(boardId) {
  return datenbank()
    .prepare(`SELECT email, recht, erstellt_am FROM board_freigabe
              WHERE board_id = ? AND entfernt_am IS NULL ORDER BY erstellt_am`)
    .all(boardId)
    .map((f) => ({ ...person(f.email), recht: f.recht, seit: f.erstellt_am }));
}

export function besitzerVon(board) {
  const b = datenbank().prepare('SELECT id, email, name FROM nutzer WHERE id = ?').get(board.nutzer_id);
  return { email: b.email, name: b.name, farbe: kennfarbe(b.id) };
}

export function liste(nutzerId, boardId) {
  const { board } = pruefen(nutzerId, boardId);
  return { besitzer: besitzerVon(board), freigaben: personenVon(boardId), ueberOrdner: ueberOrdnerVon(board) };
}

export function setzen(nutzerId, boardId, eingabe) {
  const { board } = pruefen(nutzerId, boardId, 'besitzer');
  const email = String(eingabe.email ?? '').toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Ungueltig('email_invalid');
  if (email === emailVon(board.nutzer_id)) throw new Ungueltig('board_already_yours');
  const recht = eingabe.recht ?? 'bearbeiten';
  if (!RECHTE.includes(recht)) throw new Ungueltig('permission_unknown');
  datenbank()
    .prepare(`INSERT INTO board_freigabe (board_id, email, recht, erstellt_am) VALUES (?, ?, ?, ?)
              ON CONFLICT (board_id, email) DO UPDATE SET recht = excluded.recht, entfernt_am = NULL`)
    .run(boardId, email, recht, jetzt());
  return liste(nutzerId, boardId);
}

/** Der Besitzer entfernt jemanden, oder jemand entfernt sich selbst. */
export function entfernen(nutzerId, boardId, email) {
  const z = pruefen(nutzerId, boardId);
  const ziel = String(email).toLowerCase().trim();
  if (z.recht !== 'besitzer' && ziel !== emailVon(nutzerId)) {
    throw new KeinRecht('only_owner_removes_board');
  }
  if (z.recht === 'besitzer') {
    datenbank().prepare('DELETE FROM board_freigabe WHERE board_id = ? AND email = ?').run(boardId, ziel);
  } else {
    // Sich selbst entfernen: nur markieren, damit "Rueckgaengig" geht
    datenbank()
      .prepare('UPDATE board_freigabe SET entfernt_am = ? WHERE board_id = ? AND email = ?')
      .run(jetzt(), boardId, ziel);
  }
}

/** "Rueckgaengig" nach dem Selbst-Entfernen. */
export function zurueckholen(nutzerId, boardId) {
  const r = datenbank()
    .prepare(`UPDATE board_freigabe SET entfernt_am = NULL
              WHERE board_id = ? AND email = ? AND entfernt_am IS NOT NULL`)
    .run(boardId, emailVon(nutzerId));
  if (!r.changes || !zugriff(nutzerId, boardId)) throw new NichtGefunden('board_not_found');
}

/** Mit mir geteilte Boards (Papierkorb des Besitzers ausgenommen). */
export function mitMirGeteilt(nutzerId) {
  return datenbank()
    .prepare(`SELECT b.*, f.recht, n.email AS besitzer_email, n.name AS besitzer_name
              FROM board_freigabe f
              JOIN board b ON b.id = f.board_id
              JOIN nutzer n ON n.id = b.nutzer_id
              WHERE f.email = ? AND f.entfernt_am IS NULL AND b.geloescht_am IS NULL`)
    .all(emailVon(nutzerId));
}

/** Personen je eigenem geteilten Board, fuer die Kachel in der Bibliothek. */
export function personenJeBoard(nutzerId) {
  const m = new Map();
  for (const z of datenbank()
    .prepare(`SELECT f.board_id, f.email FROM board_freigabe f JOIN board b ON b.id = f.board_id
              WHERE b.nutzer_id = ? AND f.entfernt_am IS NULL ORDER BY f.erstellt_am`)
    .all(nutzerId)) {
    if (!m.has(z.board_id)) m.set(z.board_id, []);
    m.get(z.board_id).push(person(z.email));
  }
  return m;
}
