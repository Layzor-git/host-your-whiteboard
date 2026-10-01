// Images on boards. The file lives on the Pi under data/bilder, the board
// element only refers to its id. An image is only served to people who
// are allowed to see the board.
//
// A file can belong to several boards (duplicating copies only the
// reference). It is deleted only once no board points to it any more.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { datenbank, jetzt, neueId } from './db.js';
import { NichtGefunden, Ungueltig } from './fehler.js';
import { pruefen } from './freigaben.js';

export const MAX_BYTES = 20 * 1024 * 1024;

const ORDNER = () => join(config.datenVerzeichnis, 'bilder');

// Detect from the start of the file what it really is. The browser's
// Content-Type alone is not trusted.
function typErkennen(b) {
  if (b.length > 8 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length > 6 && b.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  return null;
}

const ENDUNG = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/** Stores an uploaded image; wunschId allows importing with fixed ids. */
export function hochladen(nutzerId, boardId, puffer, { wunschId, breite, hoehe } = {}) {
  pruefen(nutzerId, boardId, 'bearbeiten');
  if (!Buffer.isBuffer(puffer) || !puffer.length) throw new Ungueltig('image_empty');
  if (puffer.length > MAX_BYTES) throw new Ungueltig('image_too_large');
  const typ = typErkennen(puffer);
  if (!typ) throw new Ungueltig('image_format');

  let id = wunschId ? String(wunschId) : neueId('i');
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new Ungueltig('image_id_invalid');
  const vorhanden = datenbank().prepare('SELECT id FROM bild WHERE board_id = ? AND id = ?').get(boardId, id);
  if (vorhanden) return { id };

  mkdirSync(ORDNER(), { recursive: true });
  const datei = `${randomBytes(16).toString('hex')}.${ENDUNG[typ]}`;
  writeFileSync(join(ORDNER(), datei), puffer);
  datenbank()
    .prepare(`INSERT INTO bild (board_id, id, datei, typ, groesse, breite, hoehe, erstellt_am)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(boardId, id, datei, typ, puffer.length, Number(breite) || null, Number(hoehe) || null, jetzt());
  return { id, typ, groesse: puffer.length };
}

/** Path and type for serving. */
export function holen(nutzerId, boardId, id) {
  pruefen(nutzerId, boardId);
  const b = datenbank().prepare('SELECT datei, typ FROM bild WHERE board_id = ? AND id = ?').get(boardId, id);
  if (!b) throw new NichtGefunden('image_not_found');
  return { pfad: join(ORDNER(), b.datei), typ: b.typ };
}

/** When duplicating: assign the same files to the new board as well. */
export function kopieren(vonBoard, nachBoard) {
  datenbank()
    .prepare(`INSERT OR IGNORE INTO bild (board_id, id, datei, typ, groesse, breite, hoehe, erstellt_am)
              SELECT ?, id, datei, typ, groesse, breite, hoehe, erstellt_am FROM bild WHERE board_id = ?`)
    .run(nachBoard, vonBoard);
}

/** Delete files that no board points to any more. */
export function aufraeumen() {
  let dateien;
  try {
    dateien = readdirSync(ORDNER());
  } catch {
    return 0;
  }
  const benutzt = new Set(datenbank().prepare('SELECT DISTINCT datei FROM bild').all().map((z) => z.datei));
  let n = 0;
  for (const d of dateien) {
    if (!benutzt.has(d)) {
      rmSync(join(ORDNER(), d), { force: true });
      n++;
    }
  }
  return n;
}
