// Boards laden und anlegen, auch ohne Netz.
//
// Der Server auf dem Pi ist die Wahrheit. Jedes geladene Board liegt
// zusaetzlich in IndexedDB, damit es offline wieder aufgeht. Was den Server
// nicht erreicht, wartet dort und wird nachgeschoben, sobald er wieder
// antwortet, auch nach einem Neuladen der Seite:
//
//   ausstehend  Titel, Hintergrund, offline angelegte Boards
//   ops         Aenderungen an Elementen, je Board und Element nur die
//               letzte (siehe live.js). Als Operationen statt als ganzes
//               Board: So kommen sie beim Abgleich zu dem dazu, was andere
//               Geraete inzwischen gemacht haben, statt es zu ueberschreiben.

import { api, KeinNetz } from '../api.js';
import { t } from '../i18n/index.js';

const DB_NAME = 'whiteboard';

// ---------------------------------------------------------------- IndexedDB

let dbZusage = null;

function db() {
  dbZusage ??= new Promise((ok, fehler) => {
    const anfrage = indexedDB.open(DB_NAME, 2);
    anfrage.onupgradeneeded = () => {
      const d = anfrage.result;
      for (const store of ['boards', 'ausstehend', 'liste', 'ops']) {
        if (!d.objectStoreNames.contains(store)) d.createObjectStore(store);
      }
    };
    anfrage.onsuccess = () => ok(anfrage.result);
    anfrage.onerror = () => fehler(anfrage.error);
  }).catch(() => null); // privater Modus o. ae.: dann eben ohne
  return dbZusage;
}

const LESEN = ['get', 'getAll', 'getAllKeys'];

/** Wie viele Aenderungen noch nicht beim Server sind (Boards mit Offenem). */
export async function nochOffen() {
  const neu = ((await idb('ausstehend', 'getAllKeys')) ?? []).length;
  let ops = 0;
  for (const id of (await idb('ops', 'getAllKeys')) ?? []) {
    if (Object.keys((await idb('ops', 'get', id))?.eintraege ?? {}).length) ops++;
  }
  return neu + ops;
}

/**
 * Beim Abmelden: alles Lokale weg, damit die naechste Person auf diesem
 * Geraet nichts davon sieht (Liste, Board-Kopien, ungesendete Aenderungen).
 */
export async function lokalLoeschen() {
  const d = await db();
  d?.close();
  dbZusage = null;
  await new Promise((ok) => {
    const anfrage = indexedDB.deleteDatabase(DB_NAME);
    anfrage.onsuccess = ok;
    anfrage.onerror = ok;
    anfrage.onblocked = ok;
  });
}

/** idb('boards', 'get', id) usw. Liefert undefined, wenn es nicht geht. */
export async function idb(store, art, ...argumente) {
  const d = await db();
  if (!d) return undefined;
  return new Promise((ok) => {
    try {
      const tx = d.transaction(store, LESEN.includes(art) ? 'readonly' : 'readwrite');
      const anfrage = tx.objectStore(store)[art](...argumente);
      anfrage.onsuccess = () => ok(anfrage.result);
      anfrage.onerror = () => ok(undefined);
    } catch {
      ok(undefined);
    }
  });
}

// ---------------------------------------------------------------- Liste

/** Boards und Papierkorb. Offline die zuletzt gesehene Liste. */
export async function listeLaden() {
  try {
    const liste = await api.boards();
    await idb('liste', 'put', liste, 'liste');
    return { ...(await mitAusstehenden(liste)), offline: false };
  } catch (e) {
    if (!(e instanceof KeinNetz)) throw e;
    const liste = (await idb('liste', 'get', 'liste')) ?? { boards: [], papierkorb: [], papierkorbTage: 30 };
    return { ...(await mitAusstehenden(liste)), offline: true };
  }
}

/** Offline angelegte oder umbenannte Boards schon in der Liste zeigen. */
async function mitAusstehenden(liste) {
  const ids = (await idb('ausstehend', 'getAllKeys')) ?? [];
  if (!ids.length) return liste;
  const boards = [...liste.boards];
  for (const id of ids) {
    const a = await idb('ausstehend', 'get', id);
    const i = boards.findIndex((b) => b.id === id);
    if (i >= 0) {
      boards[i] = { ...boards[i], ...(a?.titel ? { titel: a.titel } : {}), ausstehend: true };
    } else if (a?.neu) {
      const jetzt = new Date().toISOString();
      boards.unshift({
        id, titel: a.titel, hintergrund: a.hintergrund, version: 0, anzahl: a.daten?.elemente?.length ?? 0,
        erstelltAm: jetzt, geaendertAm: jetzt, geoeffnetAm: jetzt, hatVorschau: false, ausstehend: true,
      });
    }
  }
  return { ...liste, boards };
}

export function neueBoardId() {
  const zufall = crypto.getRandomValues(new Uint8Array(8));
  return `b_${[...zufall].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Legt ein Board an, notfalls erst lokal. Liefert die Metadaten. */
export async function boardAnlegen({ titel, hintergrund, daten, ordnerId }) {
  const id = neueBoardId();
  const eingabe = { id, titel, hintergrund, daten: daten ?? { version: 1, elemente: [] }, ordnerId: ordnerId ?? null };
  try {
    const meta = await api.boardAnlegen(eingabe);
    await idb('boards', 'put', { meta, daten: eingabe.daten }, meta.id);
    return meta;
  } catch (e) {
    if (!(e instanceof KeinNetz)) throw e;
    await idb('ausstehend', 'put', { neu: true, titel, hintergrund, daten: eingabe.daten }, id);
    await idb('boards', 'put', { meta: { id, titel, hintergrund, version: 0 }, daten: eingabe.daten }, id);
    return { id, titel, hintergrund, version: 0, ausstehend: true };
  }
}

// ---------------------------------------------------------------- Ein Board

/** Ops aus dem Offline-Puffer auf eine Elementliste anwenden. */
export function opsAufListe(elemente, eintraege) {
  const m = new Map(elemente.map((el) => [el.id, el]));
  let hintergrund = null;
  for (const { op } of Object.values(eintraege ?? {})) {
    if (op.art === 'setzen') m.set(op.el.id, op.el);
    else if (op.art === 'loeschen') m.delete(op.id);
    else if (op.art === 'hintergrund') hintergrund = op.wert;
  }
  return { elemente: [...m.values()], hintergrund };
}

/**
 * Laedt ein Board fuer den Editor. Ungesendete Aenderungen aus dem
 * Offline-Puffer kommen obendrauf: Sie sind neuer als alles auf dem Server.
 */
export async function boardLaden(id) {
  const offen = await idb('ausstehend', 'get', id);
  const puffer = await idb('ops', 'get', id);
  let meta;
  let daten;
  let offline = false;
  try {
    const b = await api.board(id);
    await idb('boards', 'put', { meta: b, daten: b.daten }, id);
    api.boardGeoeffnet(id).catch(() => {});
    meta = b;
    daten = offen?.daten ?? b.daten;
  } catch (e) {
    if (!(e instanceof KeinNetz)) throw e;
    const lokal = await idb('boards', 'get', id);
    if (!lokal && !offen) throw new Error(t('error.boardOffline'));
    meta = lokal?.meta ?? { id };
    daten = offen?.daten ?? lokal.daten;
    offline = true;
  }
  const mitPuffer = opsAufListe(daten?.elemente ?? [], puffer?.eintraege);
  return {
    meta: {
      ...meta,
      ...(offen?.titel ? { titel: offen.titel } : {}),
      hintergrund: mitPuffer.hintergrund ?? offen?.hintergrund ?? meta.hintergrund,
    },
    daten: { version: 1, elemente: mitPuffer.elemente },
    offline,
    neu: !!offen?.neu,
  };
}

/** Titel oder Hintergrund aendern, notfalls erst lokal. */
export async function metaAendern(id, teil) {
  try {
    await api.boardSpeichern(id, teil);
    return true;
  } catch (e) {
    if (!(e instanceof KeinNetz)) throw e;
    const alt = (await idb('ausstehend', 'get', id)) ?? {};
    await idb('ausstehend', 'put', { ...alt, ...teil }, id);
    return false;
  }
}

let laeuft = null;

/**
 * Alles nachschieben, was offline liegen geblieben ist: erst offline
 * angelegte Boards und Titel, dann Aenderungen an Elementen. Mehrfache
 * Aufrufe teilen sich einen Durchlauf.
 */
export function ausstehendeSenden() {
  laeuft ??= (async () => {
    try {
      for (const id of (await idb('ausstehend', 'getAllKeys')) ?? []) {
        const offen = await idb('ausstehend', 'get', id);
        if (!offen) continue;
        const { neu, ...teil } = offen;
        try {
          if (neu) await api.boardAnlegen({ id, ...teil });
          else if (Object.keys(teil).length) await api.boardSpeichern(id, teil);
          await idb('ausstehend', 'delete', id);
        } catch (e) {
          if (e instanceof KeinNetz) return;
          // Board gibt es nicht mehr (anderswo endgueltig geloescht)
          await idb('ausstehend', 'delete', id);
        }
      }
      for (const id of (await idb('ops', 'getAllKeys')) ?? []) {
        const puffer = await idb('ops', 'get', id);
        const eintraege = Object.values(puffer?.eintraege ?? {});
        if (!eintraege.length) continue;
        try {
          await api.opsSenden(id, eintraege.map((e) => e.op));
          // Nur entfernen, was in der Zwischenzeit nicht neu geaendert wurde
          const jetzt = await idb('ops', 'get', id);
          for (const [k, v] of Object.entries(jetzt?.eintraege ?? {})) {
            if (v.nr <= (puffer.nr ?? 0)) delete jetzt.eintraege[k];
          }
          await idb('ops', 'put', jetzt, id);
        } catch (e) {
          if (e instanceof KeinNetz) return;
          await idb('ops', 'delete', id);
        }
      }
    } finally {
      laeuft = null;
    }
  })();
  return laeuft;
}
