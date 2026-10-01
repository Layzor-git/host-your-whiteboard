import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { datenbank, nutzerHolenOderAnlegen, jetzt } from './db.js';
import { abmeldenUrl, emailAusRequest, NichtAngemeldet } from './auth.js';
import { KeinRecht, NichtGefunden, Ungueltig } from './fehler.js';
import { routenRegistrieren } from './routen.js';
import { allesSpeichern } from './live.js';
import { kennfarbe } from './freigaben.js';

const app = Fastify({
  // A board is saved in one piece. Large boards with thousands of
  // strokes reach several megabytes.
  bodyLimit: 32 * 1024 * 1024,
  logger: {
    level: config.istProduktion ? 'info' : 'debug',
    // No plain-text stuff in the log: headers contain the Access token.
    redact: ['req.headers.cf-access-jwt-assertion', 'req.headers.cookie'],
  },
});

// Open and migrate the database at startup, not on the first request.
// That way a migration error shows up during rollout, not for the user.
datenbank();

// Some endpoints need no body. Fastify rejects an empty body as soon as
// the client still sends "content-type: application/json", and clients
// like to do that. An empty body counts as {} here.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, koerper, fertig) => {
  if (!koerper || !koerper.trim()) return fertig(null, {});
  try {
    fertig(null, JSON.parse(koerper));
  } catch {
    const fehler = new Error('Der Anfrage-Body ist kein gueltiges JSON.');
    fehler.statusCode = 400;
    fertig(fehler);
  }
});

// Images arrive as raw data. bilder.js checks the format at the start of the file.
app.addContentTypeParser(/^image\//, { parseAs: 'buffer' }, (req, koerper, fertig) => fertig(null, koerper));

// Every request under /api/v1 gets the signed-in user attached.
app.addHook('preHandler', async (req) => {
  if (!req.url.startsWith('/api/v1/')) return;
  if (req.url === '/api/v1/health') return; // For curl on the Pi, without sign-in

  const email = await emailAusRequest(req);
  req.nutzer = nutzerHolenOderAnlegen(email);
});

app.setErrorHandler((fehler, req, antwort) => {
  if (fehler instanceof NichtAngemeldet) {
    // The reason belongs in the log, otherwise you search in the dark on the Pi
    req.log.warn(`Sign-in rejected: ${fehler.message}`);
    return antwort.code(401).send({ fehler: 'nicht_angemeldet', text: fehler.message });
  }
  if (fehler instanceof Ungueltig) {
    return antwort.code(400).send({ fehler: 'ungueltig', code: fehler.code, text: fehler.message });
  }
  if (fehler instanceof KeinRecht) {
    return antwort.code(403).send({ fehler: 'kein_recht', code: fehler.code, text: fehler.message });
  }
  if (fehler instanceof NichtGefunden) {
    return antwort.code(404).send({ fehler: 'nicht_gefunden', code: fehler.code, text: fehler.message });
  }
  // Fastify's own errors (broken JSON, body too large) already carry the
  // right code. Reporting them as 500 would hide the cause.
  if (fehler.statusCode >= 400 && fehler.statusCode < 500) {
    return antwort.code(fehler.statusCode).send({ fehler: 'ungueltig', text: fehler.message });
  }
  req.log.error(fehler);
  return antwort.code(500).send({ fehler: 'serverfehler' });
});

// Health check. Deliberately without sign-in, so that
//   curl -s http://127.0.0.1:8083/api/v1/health
// works directly on the Pi.
app.get('/api/v1/health', async () => ({
  ok: true,
  stand: jetzt(),
  // So the profile shows whether server and web app come from the same
  // rollout.
  baustand: config.baustand,
}));

// Who am I? Proof that the whole chain phone, Access, tunnel, Caddy,
// API, database is in place.
app.get('/api/v1/me', async (req) => ({
  id: req.nutzer.id,
  email: req.nutzer.email,
  name: req.nutzer.name,
  rolle: req.nutzer.rolle,
  farbe: kennfarbe(req.nutzer.id),
  abmelden: abmeldenUrl(),
  // Which sign-in sits in front, for matching hints in the app
  anmeldung: config.entwicklerEmail ? 'dev' : config.auth.modus,
}));

// Large boards arrive in one piece when connecting, hence the same limit
// as for normal requests.
await app.register(websocket, { options: { maxPayload: 32 * 1024 * 1024 } });
routenRegistrieren(app);

// On shutdown (new image, Pi restart) do not lose anything that is still
// in the memory of an open board.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    allesSpeichern();
    await app.close();
    process.exit(0);
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
  if (config.entwicklerEmail) {
    app.log.warn(`Development mode: every request counts as ${config.entwicklerEmail}`);
  } else {
    app.log.info(`Sign-in: AUTH_MODE=${config.auth.modus}`);
    if (config.auth.modus === 'single') {
      app.log.warn(`No sign-in: everyone who reaches the app is ${config.auth.einzelEmail}`);
    }
  }
} catch (fehler) {
  app.log.error(fehler);
  process.exit(1);
}
