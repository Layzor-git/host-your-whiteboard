// Sign-out: first send pending changes to the server, then delete
// everything local and end the session with the sign-in service. Where
// that leads is told by the server in /me (Cloudflare:
// /cdn-cgi/access/logout, development: /).

import { ausstehendeSenden, lokalLoeschen, nochOffen } from './speicher.js';

/** Before signing out: send what we can. Returns how much is still pending. */
export async function abmeldenVorbereiten() {
  try {
    await ausstehendeSenden();
  } catch {
    // Offline: then it stays pending, the number says so
  }
  return nochOffen();
}

export async function abmelden(ziel) {
  await lokalLoeschen();
  try { sessionStorage.clear(); } catch { /* ignore */ }
  // A server from before this field only knows Cloudflare
  location.href = ziel ?? '/cdn-cgi/access/logout';
}
