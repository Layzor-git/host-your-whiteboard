// Numbered migrations. Run in order at startup, each exactly once.
//
// NEVER change an existing migration, always append a new one. Fixing
// migration 1 after the fact only changes databases that do not exist
// yet: on the Pi it has long been recorded as done.

export const migrationen = [
  {
    id: 1,
    name: 'nutzer',
    sql: `
      -- Wer die App benutzt. Angelegt wird beim ersten Aufruf, die
      -- Identitaet kommt aus dem Access-Token und ist nicht aenderbar.
      CREATE TABLE nutzer (
        id           TEXT PRIMARY KEY,
        email        TEXT NOT NULL UNIQUE,
        name         TEXT,
        rolle        TEXT NOT NULL DEFAULT 'voll',
        erstellt_am  TEXT NOT NULL,
        geaendert_am TEXT NOT NULL
      );
    `,
  },

  {
    id: 2,
    name: 'boards',
    sql: `
      -- Ein Whiteboard. Der Inhalt liegt als JSON in "daten", so wie ihn
      -- die Zeichen-Engine speichert und laedt. Einzelne Striche fragt der
      -- Server nie ab, also brauchen sie keine eigene Tabelle.
      CREATE TABLE board (
        id            TEXT PRIMARY KEY,
        nutzer_id     TEXT NOT NULL REFERENCES nutzer(id),
        titel         TEXT NOT NULL,
        hintergrund   TEXT NOT NULL,          -- JSON { farbe, muster }
        daten         TEXT NOT NULL,          -- JSON { version, elemente }
        version       INTEGER NOT NULL DEFAULT 1,
        anzahl        INTEGER NOT NULL DEFAULT 0,
        vorschau      BLOB,
        vorschau_typ  TEXT,
        geoeffnet_am  TEXT,
        erstellt_am   TEXT NOT NULL,
        geaendert_am  TEXT NOT NULL,
        geloescht_am  TEXT                    -- gesetzt = im Papierkorb
      );
      CREATE INDEX board_nutzer ON board (nutzer_id, geloescht_am);
    `,
  },

  {
    id: 3,
    name: 'freigaben',
    sql: `
      -- Wer ausser dem Besitzer ein Board sehen oder bearbeiten darf.
      -- Ueber die E-Mail-Adresse, nicht die Nutzer-Id: So laesst sich auch
      -- jemand einladen, der sich noch nie angemeldet hat.
      CREATE TABLE board_freigabe (
        board_id     TEXT NOT NULL REFERENCES board(id) ON DELETE CASCADE,
        email        TEXT NOT NULL,
        recht        TEXT NOT NULL CHECK (recht IN ('bearbeiten', 'ansehen')),
        erstellt_am  TEXT NOT NULL,
        PRIMARY KEY (board_id, email)
      );
      CREATE INDEX board_freigabe_email ON board_freigabe (email);
    `,
  },

  {
    id: 4,
    name: 'freigabe_entfernt',
    sql: `
      -- Wer ein geteiltes Board aus der eigenen Bibliothek entfernt, verliert
      -- den Zugriff, kann das aber per "Rueckgaengig" zuruecknehmen. Darum
      -- nur markieren statt loeschen. Eine neue Einladung setzt es zurueck.
      ALTER TABLE board_freigabe ADD COLUMN entfernt_am TEXT;
    `,
  },

  {
    id: 5,
    name: 'bilder',
    sql: `
      -- Bilder auf Boards. Die Datei liegt unter data/bilder; mehrere Boards
      -- koennen dieselbe Datei nutzen (Duplizieren). Faellt das Board weg,
      -- faellt die Zuordnung mit, die Datei raeumt bilder.aufraeumen() weg.
      CREATE TABLE bild (
        board_id     TEXT NOT NULL REFERENCES board(id) ON DELETE CASCADE,
        id           TEXT NOT NULL,
        datei        TEXT NOT NULL,
        typ          TEXT NOT NULL,
        groesse      INTEGER NOT NULL,
        breite       INTEGER,
        hoehe        INTEGER,
        erstellt_am  TEXT NOT NULL,
        PRIMARY KEY (board_id, id)
      );
    `,
  },

  {
    id: 6,
    name: 'ordner',
    sql: `
      -- Ordner gehoeren einer Person und lassen sich verschachteln.
      CREATE TABLE ordner (
        id            TEXT PRIMARY KEY,
        nutzer_id     TEXT NOT NULL REFERENCES nutzer(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        eltern_id     TEXT,
        erstellt_am   TEXT NOT NULL,
        geloescht_am  TEXT,
        vorgang       TEXT
      );
      CREATE INDEX ordner_nutzer ON ordner (nutzer_id, geloescht_am);

      -- Wo ein Board liegt, je Person. Kein Eintrag = oberste Ebene.
      CREATE TABLE board_ort (
        nutzer_id  TEXT NOT NULL REFERENCES nutzer(id) ON DELETE CASCADE,
        board_id   TEXT NOT NULL REFERENCES board(id) ON DELETE CASCADE,
        ordner_id  TEXT,
        PRIMARY KEY (nutzer_id, board_id)
      );

      -- Ordner loeschen ist ein Vorgang; was dabei mitging, traegt seine Id
      ALTER TABLE board ADD COLUMN vorgang TEXT;
      ALTER TABLE board_freigabe ADD COLUMN vorgang TEXT;
    `,
  },

  {
    id: 7,
    name: 'ordner_freigabe',
    sql: `
      -- Ein Ordner geteilt: gilt fuer alles darin, auch Unterordner und
      -- Boards, die spaeter dazukommen. Wie board_freigabe an der E-Mail.
      CREATE TABLE ordner_freigabe (
        ordner_id    TEXT NOT NULL REFERENCES ordner(id) ON DELETE CASCADE,
        email        TEXT NOT NULL,
        recht        TEXT NOT NULL,
        erstellt_am  TEXT NOT NULL,
        entfernt_am  TEXT,
        vorgang      TEXT,
        PRIMARY KEY (ordner_id, email)
      );
      CREATE INDEX ordner_freigabe_email ON ordner_freigabe (email, entfernt_am);
    `,
  },

  // The next table goes here as a new entry, id: 8.
  //
  // Three columns are almost always worth having at the end of a table,
  // even if you do not need them yet:
  //
  //   erstellt_am   TEXT NOT NULL
  //   geaendert_am  TEXT NOT NULL   makes a delta possible later
  //   geloescht_am  TEXT            tombstone instead of a real delete
  //
  // Without a tombstone a deleted entry reappears on the next sync from the
  // other device, because nobody there knows it should be gone. Adding it
  // after the fact is tedious.
];
