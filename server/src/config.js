// Alle Einstellungen an einer Stelle. Werte kommen aus der .env.

// Wie der Server erfaehrt, wer anfragt:
//   cloudflare  signiertes Token von Cloudflare Access (Standard)
//   header      eine Kopfzeile, die ein vorgeschalteter Anmelde-Proxy setzt
//               (Authelia, Authentik, oauth2-proxy, ...)
//   single      keine Anmeldung, alle sind dieselbe Person. Nur fuer ein
//               Netz, in das niemand Fremdes kommt (Heimnetz, Tailscale).
const MODI = ['cloudflare', 'header', 'single'];

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',

  // Verzeichnis fuer SQLite und Uploads. Im Container /data, lokal ./data.
  datenVerzeichnis: process.env.DATEN_VERZEICHNIS ?? './data',

  auth: {
    modus: (process.env.AUTH_MODE ?? 'cloudflare').trim().toLowerCase(),
    // Modus header: Name der Kopfzeile mit der E-Mail-Adresse
    kopfzeile: (process.env.AUTH_HEADER ?? 'Remote-Email').trim().toLowerCase(),
    // Modus header: wohin "Abmelden" fuehrt (leer: kein Abmelden-Knopf)
    abmeldenUrl: (process.env.LOGOUT_URL ?? '').trim(),
    // Modus single: unter dieser Adresse liegen alle Boards
    einzelEmail: (process.env.SINGLE_USER_EMAIL ?? 'me@localhost').trim().toLowerCase(),
  },

  // Cloudflare Access
  // teamDomain: der Teil vor .cloudflareaccess.com aus dem Zero-Trust-Dashboard
  // aud: der Application Audience (AUD) Tag der Access-Anwendung
  access: {
    // Nur der Teamname ("meinteam"). Wer die ganze Adresse eintraegt
    // ("meinteam.cloudflareaccess.com", auch mit https://), bekommt dasselbe.
    teamDomain: (process.env.CF_ACCESS_TEAM_DOMAIN ?? '')
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/\.cloudflareaccess\.com$/, ''),
    aud: process.env.CF_ACCESS_AUD ?? '',
  },

  // Entwicklung: Ohne Access gibt es kein Token. Dann tun wir so, als waere
  // diese Adresse angemeldet. In Produktion MUSS das leer sein.
  entwicklerEmail: process.env.DEV_EMAIL ?? '',

  // Welcher Stand hier laeuft. Setzt das Dockerfile beim Bauen; lokal steht
  // dort nichts, und das ist die ehrliche Antwort.
  baustand: process.env.BAUSTAND ?? '',

  get istProduktion() {
    return process.env.NODE_ENV === 'production';
  },
};

// Sicherheitsnetz: In Produktion darf die Entwickler-Abkuerzung nicht greifen.
if (config.istProduktion && config.entwicklerEmail) {
  throw new Error(
    'DEV_EMAIL is set in production and would bypass sign-in. Remove it from .env (for a setup without sign-in use AUTH_MODE=single).',
  );
}

if (!MODI.includes(config.auth.modus)) {
  throw new Error(`AUTH_MODE "${config.auth.modus}" is unknown. Allowed: ${MODI.join(', ')}.`);
}
