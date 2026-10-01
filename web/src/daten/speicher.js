// Load and create boards, even without a network.
//
// The server on the Pi is the source of truth. Every loaded board is also
// kept in IndexedDB, so it opens again offline. Whatever does not reach the
// server waits there and is sent later as soon as it answers again, even
// after a page reload:
//
//   ausstehend  titles, backgrounds, boards created offline
//   ops         changes to elements, per board and element only the latest
//               (see live.js). As operations rather than the whole board:
//               that way, when syncing, they are added to what other devices
//               have done in the meantime instead of overwriting it.

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
  }).catch(() => null); // private mode or similar: then do without
  return dbZusage;
}

const LESEN = ['get', 'getAll', 'getAllKeys'];

/** How many changes have not reached the server yet (boards with pending changes). */
export async function nochOffen() {
  const neu = ((await idb('ausstehend', 'getAllKeys')) ?? []).length;
  let ops = 0;
  for (const id of (await idb('ops', 'getAllKeys')) ?? []) {
    if (Object.keys((await idb('ops', 'get', id))?.eintraege ?? {}).length) ops++;
  }
  return neu + ops;
}

/**
 * On sign-out: remove everything local, so the next person on this device
 * sees none of it (list, board copies, unsent changes).
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

/** idb('boards', 'get', id) etc. Returns undefined if it does not work. */
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

// ----------------------------------------------------------------- List

/** Boards and trash. Offline the last list seen. */
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

/** Show boards created or renamed offline in the list right away. */
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

/** Creates a board, locally first if need be. Returns the metadata. */
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

// ---------------------------------------------------------------- One board

/** Apply ops from the offline buffer to an element list. */
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
 * Loads a board for the editor. Unsent changes from the offline buffer go
 * on top: they are newer than anything on the server.
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

/** Change title or background, locally first if need be. */
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
 * Send everything that was left behind offline: first boards and titles
 * created offline, then changes to elements. Multiple calls share one
 * run.
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
          // The board no longer exists (permanently deleted elsewhere)
          await idb('ausstehend', 'delete', id);
        }
      }
      for (const id of (await idb('ops', 'getAllKeys')) ?? []) {
        const puffer = await idb('ops', 'get', id);
        const eintraege = Object.values(puffer?.eintraege ?? {});
        if (!eintraege.length) continue;
        try {
          await api.opsSenden(id, eintraege.map((e) => e.op));
          // Only remove what has not been changed again in the meantime
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
