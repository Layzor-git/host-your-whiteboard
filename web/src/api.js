// Ein einziger Ort fuer alle Server-Aufrufe.
//
// Wichtig hinter Cloudflare Access: Laeuft die Sitzung ab, antwortet
// Cloudflare mit einer Weiterleitung zur Anmeldeseite, also mit HTML statt
// JSON. Das erkennen wir hier zentral und melden es als "nicht angemeldet",
// statt am kaputten JSON zu scheitern.

import { gibtEs, t } from './i18n/index.js';

export class NichtAngemeldet extends Error {}
export class KeinNetz extends Error {}

export async function hole(pfad, optionen = {}) {
  let antwort;
  const koerper = optionen.daten !== undefined ? JSON.stringify(optionen.daten) : optionen.body;
  const kopf = koerper ? { 'Content-Type': 'application/json' } : {};

  try {
    antwort = await fetch(`/api/v1${pfad}`, {
      ...optionen,
      body: koerper,
      headers: { Accept: 'application/json', ...kopf, ...optionen.headers },
      // Cloudflare soll uns die Anmeldeseite nicht unterschieben.
      redirect: 'manual',
    });
  } catch {
    throw new KeinNetz(t('error.offline'));
  }

  // Bei redirect:'manual' kommt eine Weiterleitung als undurchsichtige
  // Antwort an.
  if (antwort.type === 'opaqueredirect' || antwort.status === 302) {
    throw new NichtAngemeldet('Session expired');
  }
  if (antwort.status === 401) throw new NichtAngemeldet('Not signed in');

  // Server nicht erreichbar heisst nicht immer "kein Netz": Laeuft der
  // API-Container nicht, antwortet Caddy mit 502. Fuer die App ist das
  // dasselbe wie offline.
  if (antwort.status >= 500) {
    throw new KeinNetz(t('error.serverDown', { status: antwort.status }));
  }

  // Erfolg ohne Inhalt (loeschen, Vorschau speichern)
  if (antwort.status === 204) return null;

  const typ = antwort.headers.get('content-type') ?? '';

  // Erst jetzt auf HTML pruefen: Eine 200er-Antwort ohne JSON ist die
  // Anmeldeseite. Ein Fehlercode mit HTML ist dagegen ein Server- oder
  // Proxy-Problem und darf nicht als Abmeldung durchgehen.
  if (!typ.includes('application/json')) {
    if (antwort.ok) throw new NichtAngemeldet('Received the login page instead of data');
    throw new Error(t('error.unexpected', { status: antwort.status }));
  }

  const daten = await antwort.json();
  if (!antwort.ok) {
    // Der Server schickt einen festen Code und einen englischen Satz. Kennt
    // die App den Code, zeigt sie ihn in der eingestellten Sprache.
    const f = new Error(serverMeldung(daten));
    f.code = daten.code;
    throw f;
  }
  return daten;
}

/** Text zu einer Fehlerantwort { code, text } des Servers (auch aus dem Live-Kanal). */
export function serverMeldung(daten) {
  if (daten?.code && gibtEs(`error.${daten.code}`)) return t(`error.${daten.code}`);
  return daten?.text ?? t('error.server');
}

/** Kurzform fuer schreibende Aufrufe: p('/dinge', 'POST', { ... }) */
const p = (pfad, methode, daten) => hole(pfad, { method: methode, daten });

export const api = {
  health: () => hole('/health'),
  me: () => hole('/me'),

  boards: () => hole('/boards'),
  boardAnlegen: (daten) => p('/boards', 'POST', daten),
  board: (id) => hole(`/boards/${encodeURIComponent(id)}`),
  boardSpeichern: (id, teil) => p(`/boards/${encodeURIComponent(id)}`, 'PATCH', teil),
  boardGeoeffnet: (id) => p(`/boards/${encodeURIComponent(id)}/geoeffnet`, 'POST'),
  vorschauSetzen: (id, bild) => p(`/boards/${encodeURIComponent(id)}/vorschau`, 'PUT', { bild }),
  vorschauUrl: (b) => `/api/v1/boards/${encodeURIComponent(b.id)}/vorschau?v=${b.version}`,
  duplizieren: (id) => p(`/boards/${encodeURIComponent(id)}/duplizieren`, 'POST'),
  inPapierkorb: (id) => p(`/boards/${encodeURIComponent(id)}/papierkorb`, 'POST'),
  wiederherstellen: (id) => p(`/boards/${encodeURIComponent(id)}/wiederherstellen`, 'POST'),
  endgueltigLoeschen: (id) => p(`/boards/${encodeURIComponent(id)}`, 'DELETE'),
  papierkorbLeeren: () => p('/papierkorb', 'DELETE'),
  korbOrdnerLoeschen: (vorgang) => p(`/papierkorb/ordner/${encodeURIComponent(vorgang)}`, 'DELETE'),
  freigaben: (id) => hole(`/boards/${encodeURIComponent(id)}/freigaben`),
  freigabeSetzen: (id, email, recht) => p(`/boards/${encodeURIComponent(id)}/freigaben`, 'POST', { email, recht }),
  freigabeEntfernen: (id, email) =>
    p(`/boards/${encodeURIComponent(id)}/freigaben/${encodeURIComponent(email)}`, 'DELETE'),
  freigabeZurueck: (id) => p(`/boards/${encodeURIComponent(id)}/freigaben/zurueck`, 'POST'),
  ordnerAnlegen: (name, elternId) => p('/ordner', 'POST', { name, elternId }),
  ordnerAendern: (id, teil) => p(`/ordner/${encodeURIComponent(id)}`, 'PATCH', teil),
  ordnerLoeschen: (id) => p(`/ordner/${encodeURIComponent(id)}`, 'DELETE'),
  ordnerWiederherstellen: (vorgang) => p('/ordner/wiederherstellen', 'POST', { vorgang }),
  ordnerFreigaben: (id) => hole(`/ordner/${encodeURIComponent(id)}/freigaben`),
  ordnerFreigabeSetzen: (id, email, recht) => p(`/ordner/${encodeURIComponent(id)}/freigaben`, 'POST', { email, recht }),
  ordnerFreigabeEntfernen: (id, email) =>
    p(`/ordner/${encodeURIComponent(id)}/freigaben/${encodeURIComponent(email)}`, 'DELETE'),
  ordnerFreigabeZurueck: (id) => p(`/ordner/${encodeURIComponent(id)}/freigaben/zurueck`, 'POST'),
  boardAblegen: (id, ordnerId) => p(`/boards/${encodeURIComponent(id)}/ort`, 'PUT', { ordnerId }),
  bildUrl: (boardId, bildId) => `/api/v1/boards/${encodeURIComponent(boardId)}/bilder/${encodeURIComponent(bildId)}`,
  opsSenden: (id, ops) => p(`/boards/${encodeURIComponent(id)}/ops`, 'POST', { ops }),
  /** WebSocket-Adresse fuer den Live-Abgleich, passend zu http/https */
  liveUrl: (id) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/boards/${encodeURIComponent(id)}/live`,
};
