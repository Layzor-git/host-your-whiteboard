// One single place for all server calls.
//
// Important behind Cloudflare Access: when the session expires, Cloudflare
// answers with a redirect to the sign-in page, i.e. with HTML instead of
// JSON. We detect that here centrally and report it as "not signed in"
// instead of failing on broken JSON.

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
      // Cloudflare must not slip us the sign-in page.
      redirect: 'manual',
    });
  } catch {
    throw new KeinNetz(t('error.offline'));
  }

  // With redirect:'manual' a redirect arrives as an opaque
  // response.
  if (antwort.type === 'opaqueredirect' || antwort.status === 302) {
    throw new NichtAngemeldet('Session expired');
  }
  if (antwort.status === 401) throw new NichtAngemeldet('Not signed in');

  // Server unreachable does not always mean "no network": if the API
  // container is not running, Caddy answers with 502. For the app that is
  // the same as offline.
  if (antwort.status >= 500) {
    throw new KeinNetz(t('error.serverDown', { status: antwort.status }));
  }

  // Success without content (delete, save thumbnail)
  if (antwort.status === 204) return null;

  const typ = antwort.headers.get('content-type') ?? '';

  // Only check for HTML now: a 200 response without JSON is the sign-in
  // page. An error code with HTML, on the other hand, is a server or proxy
  // problem and must not pass as a sign-out.
  if (!typ.includes('application/json')) {
    if (antwort.ok) throw new NichtAngemeldet('Received the login page instead of data');
    throw new Error(t('error.unexpected', { status: antwort.status }));
  }

  const daten = await antwort.json();
  if (!antwort.ok) {
    // The server sends a fixed code and an English sentence. If the app
    // knows the code, it shows it in the selected language.
    const f = new Error(serverMeldung(daten));
    f.code = daten.code;
    throw f;
  }
  return daten;
}

/** Text for an error response { code, text } from the server (also from the live channel). */
export function serverMeldung(daten) {
  if (daten?.code && gibtEs(`error.${daten.code}`)) return t(`error.${daten.code}`);
  return daten?.text ?? t('error.server');
}

/** Shorthand for writing calls: p('/dinge', 'POST', { ... }) */
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
  /** WebSocket URL for live sync, matching http/https */
  liveUrl: (id) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/boards/${encodeURIComponent(id)}/live`,
};
