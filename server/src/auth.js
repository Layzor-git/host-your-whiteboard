// Wer fragt an? Je nach AUTH_MODE (siehe config.js) aus dem
// Cloudflare-Access-Token, aus der Kopfzeile eines Anmelde-Proxys oder fest.
//
// Cloudflare:
// Access haengt an jede Anfrage, die durch den Tunnel kommt, die Kopfzeile
// "Cf-Access-Jwt-Assertion": ein signiertes Token mit der geprueften
// E-Mail-Adresse. Wir pruefen die Signatur gegen die oeffentlichen
// Schluessel von Cloudflare und lesen daraus die Adresse.
//
// Bewusst NICHT verwendet: die Klartext-Kopfzeile
// "Cf-Access-Authenticated-User-Email". Kopfzeilen sind faelschbar, eine
// Signatur ist es nicht.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from './config.js';

let jwks = null;

function schluesselQuelle() {
  if (!jwks) {
    const url = `https://${config.access.teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;
    // jose holt die Schluessel selbst nach und speichert sie zwischen.
    jwks = createRemoteJWKSet(new URL(url));
  }
  return jwks;
}

export class NichtAngemeldet extends Error {
  constructor(grund) {
    super(grund);
    this.statusCode = 401;
  }
}

/** Wohin "Abmelden" fuehrt, oder null, wenn es kein Abmelden gibt. */
export function abmeldenUrl() {
  if (config.entwicklerEmail) return '/';
  if (config.auth.modus === 'cloudflare') return '/cdn-cgi/access/logout';
  if (config.auth.modus === 'header') return config.auth.abmeldenUrl || null;
  return null;
}

/**
 * Liefert die gepruefte E-Mail-Adresse des Aufrufers.
 * Wirft NichtAngemeldet, wenn kein gueltiges Token vorliegt.
 */
export async function emailAusRequest(req) {
  // Entwicklung auf dem PC: Es gibt kein Access, also kein Token.
  // config.js stellt sicher, dass das in Produktion nicht greifen kann.
  if (config.entwicklerEmail) {
    // Mehrere Personen ohne Access, fuer Tests. Das oeffnet nichts, was
    // DEV_EMAIL nicht ohnehin offen laesst: Wo diese Abkuerzung greift,
    // findet gar keine Anmeldung statt.
    const andere = req.headers['x-test-person'];
    if (andere) return String(andere).toLowerCase().trim();
    return config.entwicklerEmail;
  }

  if (config.auth.modus === 'single') return config.auth.einzelEmail;

  if (config.auth.modus === 'header') {
    // Sicher nur, wenn der Server ausschliesslich ueber den Proxy erreichbar
    // ist: Wer an ihm vorbei anfragt, kann die Kopfzeile selbst setzen.
    const wert = String(req.headers[config.auth.kopfzeile] ?? '').split(',')[0].toLowerCase().trim();
    if (!wert) throw new NichtAngemeldet(`Header "${config.auth.kopfzeile}" missing. Is the auth proxy in front of the app?`);
    return wert;
  }

  const token = req.headers['cf-access-jwt-assertion'];
  if (!token) {
    throw new NichtAngemeldet('No Access token. Did the request come through the tunnel?');
  }
  if (!config.access.teamDomain || !config.access.aud) {
    throw new NichtAngemeldet('Access is not configured on the server (team domain or AUD missing).');
  }

  try {
    const { payload } = await jwtVerify(token, schluesselQuelle(), {
      issuer: `https://${config.access.teamDomain}.cloudflareaccess.com`,
      audience: config.access.aud,
    });

    const email = payload.email;
    if (!email) throw new Error('Token enthaelt keine E-Mail-Adresse');
    return String(email).toLowerCase().trim();
  } catch (fehler) {
    throw new NichtAngemeldet(`Invalid Access token: ${fehler.message}`);
  }
}
