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
  // Ein Board wird am Stueck gespeichert. Grosse Boards mit tausenden
  // Strichen kommen auf einige Megabyte.
  bodyLimit: 32 * 1024 * 1024,
  logger: {
    level: config.istProduktion ? 'info' : 'debug',
    // Kein Klartext-Zeug ins Log: Kopfzeilen enthalten das Access-Token.
    redact: ['req.headers.cf-access-jwt-assertion', 'req.headers.cookie'],
  },
});

// Datenbank beim Start oeffnen und migrieren, nicht erst beim ersten Aufruf.
// So faellt ein Migrationsfehler beim Ausrollen auf und nicht beim Nutzer.
datenbank();

// Manche Endpunkte brauchen keinen Body. Fastify weist einen leeren Body ab,
// sobald der Client trotzdem "content-type: application/json" mitschickt,
// und das tun Clients gern. Ein leerer Body gilt hier als {}.
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

// Bilder kommen als Rohdaten. Das Format prueft bilder.js am Dateianfang.
app.addContentTypeParser(/^image\//, { parseAs: 'buffer' }, (req, koerper, fertig) => fertig(null, koerper));

// Jede Anfrage unter /api/v1 bekommt den angemeldeten Nutzer angehaengt.
app.addHook('preHandler', async (req) => {
  if (!req.url.startsWith('/api/v1/')) return;
  if (req.url === '/api/v1/health') return; // Fuer curl vom Pi aus, ohne Anmeldung

  const email = await emailAusRequest(req);
  req.nutzer = nutzerHolenOderAnlegen(email);
});

app.setErrorHandler((fehler, req, antwort) => {
  if (fehler instanceof NichtAngemeldet) {
    // Der Grund gehoert ins Protokoll, sonst sucht man auf dem Pi im Dunkeln
    req.log.warn(`Anmeldung abgelehnt: ${fehler.message}`);
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
  // Fastify-eigene Fehler (kaputtes JSON, zu grosser Body) tragen bereits
  // den richtigen Code. Die als 500 auszugeben verschleierte die Ursache.
  if (fehler.statusCode >= 400 && fehler.statusCode < 500) {
    return antwort.code(fehler.statusCode).send({ fehler: 'ungueltig', text: fehler.message });
  }
  req.log.error(fehler);
  return antwort.code(500).send({ fehler: 'serverfehler' });
});

// Lebenszeichen. Absichtlich ohne Anmeldung, damit
//   curl -s http://127.0.0.1:8083/api/v1/health
// direkt auf dem Pi funktioniert.
app.get('/api/v1/health', async () => ({
  ok: true,
  stand: jetzt(),
  // Damit im Profil sichtbar ist, ob Server und Web-App vom selben
  // Ausrollen stammen.
  baustand: config.baustand,
}));

// Wer bin ich? Der Beweis, dass die Kette Handy, Access, Tunnel, Caddy,
// API, Datenbank vollstaendig steht.
app.get('/api/v1/me', async (req) => ({
  id: req.nutzer.id,
  email: req.nutzer.email,
  name: req.nutzer.name,
  rolle: req.nutzer.rolle,
  farbe: kennfarbe(req.nutzer.id),
  abmelden: abmeldenUrl(),
  // Welche Anmeldung davor sitzt, fuer passende Hinweise in der App
  anmeldung: config.entwicklerEmail ? 'dev' : config.auth.modus,
}));

// Grosse Boards kommen beim Verbinden am Stueck, darum dasselbe Limit wie
// fuer normale Anfragen.
await app.register(websocket, { options: { maxPayload: 32 * 1024 * 1024 } });
routenRegistrieren(app);

// Beim Herunterfahren (neues Image, Neustart des Pi) nichts verlieren, was
// noch im Speicher eines offenen Boards liegt.
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
