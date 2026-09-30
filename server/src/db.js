// SQLite ueber das in Node eingebaute node:sqlite.
//
// Kein nativ kompiliertes Modul, also keine Architektur-Falle beim
// Image-Bau fuer den Pi: better-sqlite3 baut auf dem PC gegen x86 und
// faellt im arm64-Container um.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { migrationen } from './migrationen.js';

let db = null;

export function datenbank() {
  if (db) return db;

  mkdirSync(config.datenVerzeichnis, { recursive: true });
  db = new DatabaseSync(join(config.datenVerzeichnis, 'app.db'));

  // WAL: deutlich weniger Schreibvorgaenge auf der Karte und gleichzeitiges
  // Lesen waehrend geschrieben wird. Auf einem Pi mit SD-Karte wichtig.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  // Ohne das scheitert ein zweiter Zugriff sofort statt kurz zu warten.
  db.exec('PRAGMA busy_timeout = 5000');

  migrationenAusfuehren(db);
  // Aeltere Konten bekamen den Namen klein geschrieben ("anna keller")
  for (const n of db.prepare('SELECT id, email, name FROM nutzer').all()) {
    if (n.name === n.email.split('@')[0].replace(/[._-]+/g, ' ')) {
      db.prepare('UPDATE nutzer SET name = ? WHERE id = ?').run(nameAusEmail(n.email), n.id);
    }
  }
  return db;
}

/**
 * Durchnummerierte Migrationen, jede genau einmal, in einer Transaktion.
 *
 * Nie eine bestehende aendern, immer eine neue anhaengen. Sobald echte
 * Daten drinstehen, ist das der einzige gefahrlose Weg, das Schema
 * weiterzuentwickeln.
 */
function migrationenAusfuehren(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migration (
      id           INTEGER PRIMARY KEY,
      name         TEXT NOT NULL,
      ausgefuehrt  TEXT NOT NULL
    )
  `);

  const erledigt = new Set(
    db.prepare('SELECT id FROM _migration').all().map((z) => z.id),
  );

  for (const m of migrationen) {
    if (erledigt.has(m.id)) continue;

    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare(
        "INSERT INTO _migration (id, name, ausgefuehrt) VALUES (?, ?, datetime('now'))",
      ).run(m.id, m.name);
      db.exec('COMMIT');
      console.log(`[db] Migration ${m.id} (${m.name}) ausgefuehrt`);
    } catch (fehler) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${m.id} (${m.name}) fehlgeschlagen: ${fehler.message}`);
    }
  }
}

/**
 * Anzeigename aus der Adresse, solange es keinen echten gibt:
 * "anna.keller@..." wird "Anna Keller". Access liefert beim E-Mail-Code
 * keinen Namen mit.
 */
export function nameAusEmail(email) {
  return email.split('@')[0]
    .replace(/[._-]+/g, ' ')
    .trim()
    .replace(/(^|\s)(\p{L})/gu, (_, vor, b) => vor + b.toUpperCase());
}

export function jetzt() {
  return new Date().toISOString();
}

export function neueId(praefix) {
  return `${praefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

/**
 * Holt den Nutzer zur E-Mail-Adresse und legt ihn an, falls unbekannt.
 *
 * Das ersetzt die Registrierung: Wer in der Access-Policy steht, kommt
 * durch, und beim ersten Aufruf entsteht sein Datensatz.
 */
export function nutzerHolenOderAnlegen(email) {
  const db = datenbank();

  const vorhanden = db.prepare('SELECT * FROM nutzer WHERE email = ?').get(email);
  if (vorhanden) return vorhanden;

  const zeit = jetzt();
  const id = neueId('u');
  const name = nameAusEmail(email);

  db.prepare(
    `INSERT INTO nutzer (id, email, name, erstellt_am, geaendert_am)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, email, name, zeit, zeit);

  console.log(`[db] Neuer Nutzer angelegt: ${email}`);
  return db.prepare('SELECT * FROM nutzer WHERE id = ?').get(id);
}
