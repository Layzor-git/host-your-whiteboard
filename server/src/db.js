// SQLite via the node:sqlite module built into Node.
//
// No natively compiled module, so no architecture trap when building the
// image for the Pi: better-sqlite3 builds against x86 on the PC and
// falls over in the arm64 container.

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

  // WAL: far fewer writes to the card, and reads while writing.
  // Important on a Pi with an SD card.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  // Without this a second access fails immediately instead of waiting briefly.
  db.exec('PRAGMA busy_timeout = 5000');

  migrationenAusfuehren(db);
  // Older accounts got their name in lower case ("anna keller")
  for (const n of db.prepare('SELECT id, email, name FROM nutzer').all()) {
    if (n.name === n.email.split('@')[0].replace(/[._-]+/g, ' ')) {
      db.prepare('UPDATE nutzer SET name = ? WHERE id = ?').run(nameAusEmail(n.email), n.id);
    }
  }
  return db;
}

/**
 * Numbered migrations, each exactly once, in a transaction.
 *
 * Never change an existing one, always append a new one. Once real data
 * is in there, this is the only safe way to evolve the schema.
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
      console.log(`[db] Migration ${m.id} (${m.name}) applied`);
    } catch (fehler) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${m.id} (${m.name}) failed: ${fehler.message}`);
    }
  }
}

/**
 * Display name from the address until there is a real one:
 * "anna.keller@..." becomes "Anna Keller". Access sends no name with
 * the email code sign-in.
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
 * Gets the user for the email address and creates them if unknown.
 *
 * This replaces registration: whoever is in the Access policy gets
 * through, and their record is created on the first request.
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

  console.log(`[db] New user created: ${email}`);
  return db.prepare('SELECT * FROM nutzer WHERE id = ?').get(id);
}
