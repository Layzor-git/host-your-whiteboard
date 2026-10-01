// All settings in one place. Values come from .env.

// How the server learns who is asking:
//   cloudflare  signed token from Cloudflare Access (default)
//   header      a header set by a sign-in proxy in front
//               (Authelia, Authentik, oauth2-proxy, ...)
//   single      no sign-in, everyone is the same person. Only for a
//               network no stranger can get into (home network, Tailscale).
const MODI = ['cloudflare', 'header', 'single'];

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',

  // Directory for SQLite and uploads. /data in the container, ./data locally.
  datenVerzeichnis: process.env.DATEN_VERZEICHNIS ?? './data',

  auth: {
    modus: (process.env.AUTH_MODE ?? 'cloudflare').trim().toLowerCase(),
    // Mode header: name of the header carrying the email address
    kopfzeile: (process.env.AUTH_HEADER ?? 'Remote-Email').trim().toLowerCase(),
    // Mode header: where "Sign out" leads (empty: no sign-out button)
    abmeldenUrl: (process.env.LOGOUT_URL ?? '').trim(),
    // Mode single: all boards live under this address
    einzelEmail: (process.env.SINGLE_USER_EMAIL ?? 'me@localhost').trim().toLowerCase(),
  },

  // Cloudflare Access
  // teamDomain: the part before .cloudflareaccess.com from the Zero Trust dashboard
  // aud: the Application Audience (AUD) tag of the Access application
  access: {
    // Just the team name ("myteam"). Entering the full address
    // ("myteam.cloudflareaccess.com", even with https://) gives the same.
    teamDomain: (process.env.CF_ACCESS_TEAM_DOMAIN ?? '')
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/\.cloudflareaccess\.com$/, ''),
    aud: process.env.CF_ACCESS_AUD ?? '',
  },

  // Development: without Access there is no token. We then pretend this
  // address is signed in. MUST be empty in production.
  entwicklerEmail: process.env.DEV_EMAIL ?? '',

  // Which build is running here. Set by the Dockerfile at build time;
  // locally it is empty, and that is the honest answer.
  baustand: process.env.BAUSTAND ?? '',

  get istProduktion() {
    return process.env.NODE_ENV === 'production';
  },
};

// Safety net: the developer shortcut must not take effect in production.
if (config.istProduktion && config.entwicklerEmail) {
  throw new Error(
    'DEV_EMAIL is set in production and would bypass sign-in. Remove it from .env (for a setup without sign-in use AUTH_MODE=single).',
  );
}

if (!MODI.includes(config.auth.modus)) {
  throw new Error(`AUTH_MODE "${config.auth.modus}" is unknown. Allowed: ${MODI.join(', ')}.`);
}
