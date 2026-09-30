// Abmelden: erst Offenes zum Server schicken, dann alles Lokale loeschen und
// die Sitzung beim Anmeldedienst beenden. Wohin das fuehrt, sagt der Server
// in /me (Cloudflare: /cdn-cgi/access/logout, Entwicklung: /).

import { ausstehendeSenden, lokalLoeschen, nochOffen } from './speicher.js';

/** Vor dem Abmelden: senden, was geht. Liefert, wie viel trotzdem offen bleibt. */
export async function abmeldenVorbereiten() {
  try {
    await ausstehendeSenden();
  } catch {
    // Offline: dann bleibt es eben offen, das sagt die Zahl
  }
  return nochOffen();
}

export async function abmelden(ziel) {
  await lokalLoeschen();
  try { sessionStorage.clear(); } catch { /* egal */ }
  // Ein Server von vor dieser Angabe kennt nur Cloudflare
  location.href = ziel ?? '/cdn-cgi/access/logout';
}
