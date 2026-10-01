// Who is asking? Depending on AUTH_MODE (see config.js) from the
// Cloudflare Access token, from the header of a sign-in proxy, or fixed.
//
// Cloudflare:
// Access attaches the header "Cf-Access-Jwt-Assertion" to every request
// that comes through the tunnel: a signed token carrying the verified
// email address. We check the signature against Cloudflare's public keys
// and read the address from it.
//
// Deliberately NOT used: the plain-text header
// "Cf-Access-Authenticated-User-Email". Headers can be forged, a
// signature cannot.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from './config.js';

let jwks = null;

function schluesselQuelle() {
  if (!jwks) {
    const url = `https://${config.access.teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;
    // jose fetches the keys itself and caches them.
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

/** Where "Sign out" leads, or null if there is no sign-out. */
export function abmeldenUrl() {
  if (config.entwicklerEmail) return '/';
  if (config.auth.modus === 'cloudflare') return '/cdn-cgi/access/logout';
  if (config.auth.modus === 'header') return config.auth.abmeldenUrl || null;
  return null;
}

/**
 * Returns the verified email address of the caller.
 * Throws NichtAngemeldet if there is no valid token.
 */
export async function emailAusRequest(req) {
  // Development on the PC: there is no Access, so no token.
  // config.js makes sure this cannot take effect in production.
  if (config.entwicklerEmail) {
    // Several people without Access, for tests. This opens nothing that
    // DEV_EMAIL does not leave open anyway: wherever this shortcut applies,
    // no sign-in takes place at all.
    const andere = req.headers['x-test-person'];
    if (andere) return String(andere).toLowerCase().trim();
    return config.entwicklerEmail;
  }

  if (config.auth.modus === 'single') return config.auth.einzelEmail;

  if (config.auth.modus === 'header') {
    // Only safe if the server is reachable exclusively through the proxy:
    // anyone who bypasses it can set the header themselves.
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
    if (!email) throw new Error('Token contains no email address');
    return String(email).toLowerCase().trim();
  } catch (fehler) {
    throw new NichtAngemeldet(`Invalid Access token: ${fehler.message}`);
  }
}
