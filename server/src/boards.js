// Whiteboards: anlegen, laden, speichern, Papierkorb.
//
// Wer was darf, entscheidet freigaben.js. Ein Board, auf das jemand keinen
// Zugriff hat, sieht fuer ihn aus wie eines, das es nicht gibt.

import { datenbank, jetzt, neueId } from './db.js';
import { NichtGefunden, Ungueltig } from './fehler.js';
import * as freigaben from './freigaben.js';
import { liveStand, nachRestSpeichern } from './live.js';
import * as bilder from './bilder.js';
import * as ordner from './ordner.js';

export const PAPIERKORB_TAGE = ordner.PAPIERKORB_TAGE;

const FARBEN = ['white', 'paper', 'grey', 'mint', 'sky', 'slate'];
const MUSTER = ['none', 'dots', 'grid', 'lines'];
const BILDTYPEN = ['image/png', 'image/webp', 'image/jpeg'];

/**
 * Metadaten fuer die Oberflaeche. recht: 'besitzer' | 'bearbeiten' |
 * 'ansehen'. Bei fremden Boards steht dabei, wem es gehoert, bei eigenen,
 * mit wie vielen Personen es geteilt ist.
 */
function meta(z, recht = 'besitzer', extra = {}) {
  return {
    id: z.id,
    titel: z.titel,
    hintergrund: JSON.parse(z.hintergrund),
    version: z.version,
    anzahl: z.anzahl,
    erstelltAm: z.erstellt_am,
    geaendertAm: z.geaendert_am,
    geoeffnetAm: z.geoeffnet_am,
    geloeschtAm: z.geloescht_am,
    hatVorschau: z.vorschau !== null && z.vorschau !== undefined,
    recht,
    ...extra,
  };
}

function titelPruefen(titel) {
  const t = String(titel ?? '').trim();
  if (!t) throw new Ungueltig('board_name_missing');
  if (t.length > 200) throw new Ungueltig('board_name_too_long');
  return t;
}

function hintergrundPruefen(h) {
  const farbe = h?.farbe ?? 'white';
  const muster = h?.muster ?? 'dots';
  if (!FARBEN.includes(farbe)) throw new Ungueltig('canvas_color_unknown');
  if (!MUSTER.includes(muster)) throw new Ungueltig('pattern_unknown');
  return { farbe, muster };
}

function datenPruefen(d) {
  const daten = d ?? { version: 1, elemente: [] };
  if (typeof daten !== 'object' || !Array.isArray(daten.elemente)) {
    throw new Ungueltig('board_data_invalid');
  }
  // Der Hintergrund hat eine eigene Spalte und steht nicht doppelt hier.
  return { version: daten.version ?? 1, elemente: daten.elemente };
}

function zeile(id) {
  return datenbank().prepare('SELECT * FROM board WHERE id = ?').get(id);
}

/** Alte Boards im Papierkorb endgueltig entfernen. */
function papierkorbAufraeumen(nutzerId) {
  const grenze = new Date(Date.now() - PAPIERKORB_TAGE * 864e5).toISOString();
  const r = datenbank()
    .prepare('DELETE FROM board WHERE nutzer_id = ? AND geloescht_am IS NOT NULL AND geloescht_am < ?')
    .run(nutzerId, grenze);
  if (r.changes) bilder.aufraeumen();
}

export function liste(nutzerId) {
  papierkorbAufraeumen(nutzerId);
  const geteilt = freigaben.personenJeBoard(nutzerId);
  const eigene = datenbank()
    .prepare('SELECT * FROM board WHERE nutzer_id = ?')
    .all(nutzerId)
    .map((z) => meta(z, 'besitzer', {
      geteiltMit: geteilt.get(z.id) ?? [],
      // Im Papierkorb: mit einem Ordner geloescht? Dann liegt es in dessen Eintrag
      ...(z.geloescht_am && z.vorgang ? { vorgang: z.vorgang } : {}),
    }));
  // Mit mir geteilt: direkt, oder ueber einen geteilten Ordner. Ueber den
  // Ordner liegt ein Board da, wo der Besitzer es hat; das bestimmt ordnerId.
  const ueberOrdner = freigaben.ordnerMitMirGeteilt(nutzerId);
  const ortVomBesitzer = new Map(ueberOrdner.boards.map((z) => [z.id, z.ort]));
  const direkt = freigaben.mitMirGeteilt(nutzerId);
  const direktIds = new Set(direkt.map((z) => z.id));
  const fremdeZeilen = new Map();
  for (const z of [...direkt, ...ueberOrdner.boards]) {
    if (!fremdeZeilen.has(z.id)) fremdeZeilen.set(z.id, z);
  }
  const fremde = [...fremdeZeilen.values()].map((z) => meta(z, freigaben.zugriff(nutzerId, z.id)?.recht ?? z.recht, {
    besitzer: freigaben.besitzerVon(z),
    // Nur ueber einen Ordner geteilt: laesst sich nicht einzeln entfernen
    ...(direktIds.has(z.id) ? {} : { ueberOrdner: true }),
  }));
  const zuletzt = (b) => b.geoeffnetAm ?? b.geaendertAm;
  const orte = ordner.orte(nutzerId);
  const mitOrt = (b) => ({ ...b, ordnerId: ortVomBesitzer.get(b.id) ?? orte.get(b.id) ?? null });
  const ordnerGeteilt = freigaben.personenJeOrdner(nutzerId);
  return {
    ordner: [
      ...ordner.liste(nutzerId).map((o) => ({ ...o, geteiltMit: ordnerGeteilt.get(o.id) ?? [] })),
      ...ueberOrdner.ordner,
    ],
    boards: [...eigene.filter((b) => !b.geloeschtAm), ...fremde]
      .map(mitOrt)
      .sort((a, b) => zuletzt(b).localeCompare(zuletzt(a))),
    papierkorb: eigene
      .filter((b) => b.geloeschtAm)
      .sort((a, b) => b.geloeschtAm.localeCompare(a.geloeschtAm)),
    papierkorbOrdner: ordner.papierkorb(nutzerId)
      .sort((a, b) => b.geloeschtAm.localeCompare(a.geloeschtAm)),
    papierkorbTage: PAPIERKORB_TAGE,
  };
}

export function anlegen(nutzerId, eingabe) {
  const titel = titelPruefen(eingabe.titel);
  const hintergrund = hintergrundPruefen(eingabe.hintergrund);
  const daten = datenPruefen(eingabe.daten);
  // Die Id darf vom Geraet kommen: So kann ein Board auch offline entstehen
  // und spaeter unter derselben Id ankommen. Zweimal senden legt es nicht
  // zweimal an.
  let id = eingabe.id ? String(eingabe.id) : neueId('b');
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new Ungueltig('board_id_invalid');
  const vorhanden = zeile(id);
  if (vorhanden) {
    if (vorhanden.nutzer_id === nutzerId) return meta(vorhanden);
    id = neueId('b');
  }
  const zeit = jetzt();
  datenbank().prepare(
    `INSERT INTO board (id, nutzer_id, titel, hintergrund, daten, anzahl, geoeffnet_am, erstellt_am, geaendert_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, nutzerId, titel, JSON.stringify(hintergrund), JSON.stringify(daten),
    daten.elemente.length, zeit, zeit, zeit);
  // Im Ordner anlegen, in dem man gerade ist
  if (eingabe.ordnerId) ordner.boardAblegen(nutzerId, id, eingabe.ordnerId);
  return { ...meta(zeile(id)), ordnerId: eingabe.ordnerId ?? null };
}

function mitFremdInfo(z, recht) {
  if (recht === 'besitzer') return { geteiltMit: freigaben.personenVon(z.id) };
  return { besitzer: freigaben.besitzerVon(z) };
}

export function laden(nutzerId, id) {
  const { board: z, recht } = freigaben.pruefen(nutzerId, id);
  const m = meta(z, recht, mitFremdInfo(z, recht));
  // Ist das Board gerade live offen, ist der Stand im Speicher neuer als
  // der in der Datenbank (die wird erst kurz danach geschrieben).
  const live = liveStand(id);
  if (live) return { ...m, hintergrund: live.hintergrund, daten: { version: 1, elemente: live.elemente } };
  return { ...m, daten: JSON.parse(z.daten) };
}

export function geoeffnet(nutzerId, id) {
  freigaben.pruefen(nutzerId, id);
  datenbank().prepare('UPDATE board SET geoeffnet_am = ? WHERE id = ?').run(jetzt(), id);
}

export function speichern(nutzerId, id, eingabe) {
  const { board: alt, recht } = freigaben.pruefen(nutzerId, id, 'bearbeiten');
  const felder = [];
  const werte = [];
  const neu = {};
  if (eingabe.titel !== undefined) {
    neu.titel = titelPruefen(eingabe.titel);
    felder.push('titel = ?');
    werte.push(neu.titel);
  }
  if (eingabe.hintergrund !== undefined) {
    neu.hintergrund = hintergrundPruefen(eingabe.hintergrund);
    felder.push('hintergrund = ?');
    werte.push(JSON.stringify(neu.hintergrund));
  }
  if (eingabe.daten !== undefined) {
    neu.daten = datenPruefen(eingabe.daten);
    felder.push('daten = ?', 'anzahl = ?');
    werte.push(JSON.stringify(neu.daten), neu.daten.elemente.length);
  }
  if (!felder.length) return meta(alt, recht);
  datenbank()
    .prepare(`UPDATE board SET ${felder.join(', ')}, version = version + 1, geaendert_am = ? WHERE id = ?`)
    .run(...werte, jetzt(), id);
  // Andere offene Geraete sollen es sofort sehen
  nachRestSpeichern(id, neu);
  return meta(zeile(id), recht);
}

export function vorschauSetzen(nutzerId, id, bild) {
  freigaben.pruefen(nutzerId, id, 'bearbeiten');
  const m = String(bild ?? '').match(/^data:([a-z/]+);base64,(.+)$/);
  if (!m || !BILDTYPEN.includes(m[1])) {
    throw new Ungueltig('preview_format');
  }
  const puffer = Buffer.from(m[2], 'base64');
  if (puffer.length > 2 * 1024 * 1024) throw new Ungueltig('preview_too_large');
  datenbank().prepare('UPDATE board SET vorschau = ?, vorschau_typ = ? WHERE id = ?').run(puffer, m[1], id);
}

export function vorschau(nutzerId, id) {
  const { board: z } = freigaben.pruefen(nutzerId, id);
  if (!z.vorschau) throw new NichtGefunden('preview_missing');
  return { bild: Buffer.from(z.vorschau), typ: z.vorschau_typ };
}

/** Eine eigene Kopie, auch von einem geteilten Board. */
export function duplizieren(nutzerId, id) {
  const quelle = laden(nutzerId, id);
  const neu = anlegen(nutzerId, {
    titel: `${quelle.titel} (Kopie)`.slice(0, 200),
    hintergrund: quelle.hintergrund,
    daten: quelle.daten,
  });
  const q = zeile(id);
  datenbank()
    .prepare('UPDATE board SET vorschau = ?, vorschau_typ = ? WHERE id = ?')
    .run(q.vorschau ?? null, q.vorschau_typ ?? null, neu.id);
  bilder.kopieren(id, neu.id);
  // Die Kopie liegt dort, wo das Original liegt
  const ort = ordner.orte(nutzerId).get(id);
  if (ort) ordner.boardAblegen(nutzerId, neu.id, ort);
  return meta(zeile(neu.id));
}

export function inPapierkorb(nutzerId, id) {
  freigaben.pruefen(nutzerId, id, 'besitzer');
  datenbank().prepare('UPDATE board SET geloescht_am = ? WHERE id = ?').run(jetzt(), id);
  return meta(zeile(id));
}

export function wiederherstellen(nutzerId, id) {
  freigaben.pruefen(nutzerId, id, 'besitzer');
  datenbank().prepare('UPDATE board SET geloescht_am = NULL, vorgang = NULL WHERE id = ?').run(id);
  // Lag es in einem Ordner, der inzwischen geloescht ist: den Ordnerpfad
  // mit zurueckholen, damit es an seinem alten Ort landet
  const ort = datenbank()
    .prepare('SELECT ordner_id FROM board_ort WHERE nutzer_id = ? AND board_id = ?')
    .get(nutzerId, id);
  if (ort?.ordner_id) ordner.pfadWiederherstellen(nutzerId, ort.ordner_id);
  return meta(zeile(id));
}

/** Endgueltig loeschen geht nur aus dem Papierkorb heraus. */
export function endgueltigLoeschen(nutzerId, id) {
  const { board: z } = freigaben.pruefen(nutzerId, id, 'besitzer');
  if (!z.geloescht_am) {
    throw new Ungueltig('delete_only_from_trash');
  }
  datenbank().prepare('DELETE FROM board WHERE id = ?').run(id);
  bilder.aufraeumen();
}

export function papierkorbLeeren(nutzerId) {
  const r = datenbank()
    .prepare('DELETE FROM board WHERE nutzer_id = ? AND geloescht_am IS NOT NULL')
    .run(nutzerId);
  ordner.papierkorbLeeren(nutzerId);
  bilder.aufraeumen();
  return { geloescht: Number(r.changes) };
}
