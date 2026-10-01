// The three sign-in modes (AUTH_MODE). Starts one server each against a
// fresh database and checks who it thinks is asking.
//   npm test

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let bestanden = 0, gescheitert = 0;
function pruefe(name, bedingung, zusatz = '') {
  if (bedingung) { console.log(`  ok   ${name}`); bestanden++; }
  else { console.log(`  FAIL ${name} ${zusatz}`); gescheitert++; }
}

async function mitServer(port, env, pruefen) {
  const dir = mkdtempSync(join(tmpdir(), 'whiteboard-auth-'));
  const umgebung = { ...process.env, PORT: String(port), DATEN_VERZEICHNIS: dir, NODE_ENV: 'production', ...env };
  if (!env.DEV_EMAIL) delete umgebung.DEV_EMAIL;
  const server = spawn(process.execPath, ['src/index.js'], { env: umgebung, stdio: ['ignore', 'pipe', 'pipe'] });
  let ausgabe = '';
  server.stdout.on('data', (d) => (ausgabe += d));
  server.stderr.on('data', (d) => (ausgabe += d));
  const beendet = new Promise((r) => server.on('exit', r));
  const basis = `http://127.0.0.1:${port}/api/v1`;
  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(`${basis}/health`)).ok) break; } catch { /* not up yet */ }
      if (server.exitCode !== null || i > 60) return { gestartet: false, ausgabe };
      await new Promise((r) => setTimeout(r, 100));
    }
    const me = async (kopf = {}) => {
      const a = await fetch(`${basis}/me`, { headers: kopf });
      return { status: a.status, daten: await a.json().catch(() => null) };
    };
    await pruefen(me);
    return { gestartet: true, ausgabe };
  } finally {
    server.kill();
    await beendet;
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\n--- Sign-in ---');

await mitServer(3101, { AUTH_MODE: 'single', SINGLE_USER_EMAIL: 'Ich@Zuhause.local' }, async (me) => {
  const a = await me();
  pruefe('single: without any sign-in you are the configured person', a.status === 200 && a.daten.email === 'ich@zuhause.local');
  pruefe('single: there is no sign-out', a.daten?.abmelden === null);
});

await mitServer(3102, { AUTH_MODE: 'header', AUTH_HEADER: 'X-Forwarded-Email', LOGOUT_URL: 'https://auth.example.com/logout' }, async (me) => {
  pruefe('header: without the header nobody gets in', (await me()).status === 401);
  const a = await me({ 'X-Forwarded-Email': 'Anna@Example.com' });
  pruefe('header: the proxy header determines the person', a.status === 200 && a.daten.email === 'anna@example.com');
  pruefe('header: sign-out leads to the configured URL', a.daten?.abmelden === 'https://auth.example.com/logout');
});

await mitServer(3103, { AUTH_MODE: 'cloudflare', CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'y' }, async (me) => {
  pruefe('cloudflare: without a token nobody gets in', (await me()).status === 401);
  pruefe('cloudflare: a forged header does not help', (await me({ 'Remote-Email': 'a@b.c', 'Cf-Access-Authenticated-User-Email': 'a@b.c' })).status === 401);
});

const falsch = await mitServer(3104, { AUTH_MODE: 'offen' }, async () => {});
pruefe('An unknown AUTH_MODE prevents startup', !falsch.gestartet && falsch.ausgabe.includes('AUTH_MODE'));

const dev = await mitServer(3105, { DEV_EMAIL: 'a@b.c' }, async () => {});
pruefe('DEV_EMAIL in production prevents startup', !dev.gestartet);

console.log(`\n${bestanden} passed, ${gescheitert} failed\n`);
process.exit(gescheitert ? 1 : 0);
