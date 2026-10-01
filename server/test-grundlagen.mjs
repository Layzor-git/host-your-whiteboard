// End-to-end test of the basics.
//   npm test
//
// No framework, no dependency: a script that starts the server in its own
// process, talks to a fresh database in a temporary directory and cleans
// up at the end. The development data stays untouched.
//
// The value is in the names: a test is named after the promise it keeps,
// not after the function it calls.

import { spawn } from 'node:child_process';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 3099;
const BASIS = `http://127.0.0.1:${PORT}/api/v1`;
const datenVerzeichnis = mkdtempSync(join(tmpdir(), 'whiteboard-test-'));

const server = spawn(process.execPath, ['src/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATEN_VERZEICHNIS: datenVerzeichnis,
    DEV_EMAIL: 'test@whiteboard.local',
    NODE_ENV: 'test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let ausgabe = '';
server.stdout.on('data', (d) => (ausgabe += d));
server.stderr.on('data', (d) => (ausgabe += d));

let bestanden = 0, gescheitert = 0;
function pruefe(name, bedingung, zusatz = '') {
  if (bedingung) { console.log(`  ok   ${name}`); bestanden++; }
  else { console.log(`  FEHL ${name} ${zusatz}`); gescheitert++; }
}
function beenden(code) {
  server.kill();
  setTimeout(() => {
    try { rmSync(datenVerzeichnis, { recursive: true, force: true }); } catch { /* ignore */ }
    process.exit(code);
  }, 300);
}

for (let versuch = 0; ; versuch++) {
  try { if ((await fetch(`${BASIS}/health`)).ok) break; } catch { /* not up yet */ }
  if (versuch > 60) { console.error('Server startet nicht:\n' + ausgabe); beenden(1); }
  await new Promise((r) => setTimeout(r, 100));
}

async function api(pfad, optionen = {}) {
  const kopf = optionen.body ? { 'content-type': 'application/json' } : {};
  const a = await fetch(BASIS + pfad, {
    ...optionen,
    headers: { ...kopf, ...optionen.headers },
    body: optionen.body ? JSON.stringify(optionen.body) : undefined,
  });
  return { status: a.status, daten: await a.json().catch(() => null) };
}

console.log('\n--- Grundlagen ---');

const gesund = await api('/health');
pruefe('Der Server lebt', gesund.daten?.ok === true, JSON.stringify(gesund.daten));

const ich = await api('/me');
pruefe('Wer anklopft, bekommt einen Datensatz', ich.daten?.email === 'test@whiteboard.local',
  JSON.stringify(ich.daten));

// The same address twice must not create a second user.
const nochmal = await api('/me');
pruefe('Und beim zweiten Mal denselben', nochmal.daten.id === ich.daten.id);

const andere = await api('/me', { headers: { 'x-test-person': 'zweite@whiteboard.local' } });
pruefe('Eine zweite Person ist wirklich eine zweite', andere.daten.id !== ich.daten.id);

pruefe('Ein unbekannter Pfad ist ein 404', (await api('/gibtsnicht')).status === 404);

console.log('\n--- Boards ---');

const leer = await api('/boards');
pruefe('Am Anfang gibt es keine Boards', leer.daten?.boards?.length === 0, JSON.stringify(leer.daten));

const leererTitel = await api('/boards', { method: 'POST', body: { titel: '  ' } });
pruefe('Ein leerer Titel wird abgewiesen', leererTitel.status === 400);
pruefe('Fehler tragen einen Code für die Übersetzung und einen englischen Text',
  leererTitel.daten?.code === 'board_name_missing' && leererTitel.daten.text === 'A board needs a name.',
  JSON.stringify(leererTitel.daten));
const fremdesBoard = await api('/boards/b_gibtesnicht1');
pruefe('Auch 404 trägt einen Code', fremdesBoard.status === 404 && fremdesBoard.daten?.code === 'board_not_found',
  JSON.stringify(fremdesBoard.daten));
pruefe('Eine unbekannte Leinwandfarbe wird abgewiesen',
  (await api('/boards', { method: 'POST', body: { titel: 'x', hintergrund: { farbe: 'lila' } } })).status === 400);

const angelegt = await api('/boards', {
  method: 'POST',
  body: { id: 'b_vomgeraet1', titel: 'Umzug', hintergrund: { farbe: 'paper', muster: 'grid' } },
});
pruefe('Ein Board entsteht unter der Id vom Gerät',
  angelegt.status === 201 && angelegt.daten.id === 'b_vomgeraet1', JSON.stringify(angelegt.daten));
const doppelt = await api('/boards', { method: 'POST', body: { id: 'b_vomgeraet1', titel: 'Umzug' } });
pruefe('Zweimal anlegen legt es nicht zweimal an',
  doppelt.daten.id === 'b_vomgeraet1' && (await api('/boards')).daten.boards.length === 1);

const strich = { id: 's1', typ: 'strich', z: 0, farbe: 'graphite', breite: 3, punkte: [0, 0, 10, 10], druck: null };
const gespeichert = await api('/boards/b_vomgeraet1', {
  method: 'PATCH', body: { daten: { version: 1, elemente: [strich] } },
});
pruefe('Speichern erhöht die Version', gespeichert.daten?.version === 2 && gespeichert.daten.anzahl === 1,
  JSON.stringify(gespeichert.daten));
const geladen = await api('/boards/b_vomgeraet1');
pruefe('Geladen kommt zurück, was gespeichert wurde',
  geladen.daten?.daten?.elemente?.[0]?.farbe === 'graphite' && geladen.daten.hintergrund.muster === 'grid');

const fremd = await api('/boards/b_vomgeraet1', { headers: { 'x-test-person': 'zweite@whiteboard.local' } });
pruefe('Fremde Boards bleiben fremd', fremd.status === 404);

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const vs = await api('/boards/b_vomgeraet1/vorschau', { method: 'PUT', body: { bild: png } });
const bild = await fetch(`${BASIS}/boards/b_vomgeraet1/vorschau`);
pruefe('Die Vorschau kommt als Bild zurück',
  vs.status === 204 && bild.headers.get('content-type') === 'image/png');

const kopie = await api('/boards/b_vomgeraet1/duplizieren', { method: 'POST' });
pruefe('Duplizieren übernimmt Inhalt und Vorschau',
  kopie.daten?.titel === 'Umzug (Kopie)' && kopie.daten.anzahl === 1 && kopie.daten.hatVorschau);

pruefe('Aktive Boards lassen sich nicht endgültig löschen',
  (await api(`/boards/${kopie.daten.id}`, { method: 'DELETE' })).status === 400);
await api(`/boards/${kopie.daten.id}/papierkorb`, { method: 'POST' });
let l = (await api('/boards')).daten;
pruefe('Der Papierkorb nimmt das Board auf', l.boards.length === 1 && l.papierkorb.length === 1);
await api(`/boards/${kopie.daten.id}/wiederherstellen`, { method: 'POST' });
l = (await api('/boards')).daten;
pruefe('Wiederherstellen holt es zurück', l.boards.length === 2 && l.papierkorb.length === 0);
await api(`/boards/${kopie.daten.id}/papierkorb`, { method: 'POST' });
const leeren = await api('/papierkorb', { method: 'DELETE' });
l = (await api('/boards')).daten;
pruefe('Papierkorb leeren löscht endgültig', leeren.daten?.geloescht === 1 && l.papierkorb.length === 0 && l.boards.length === 1);

console.log('\n--- Live ---');

// A device: collects messages and can wait for a specific one.
function geraet(boardId, kopf = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/v1/boards/${boardId}/live`, { headers: kopf });
  const post = [];
  const warter = [];
  ws.addEventListener('message', (e) => {
    const n = JSON.parse(e.data);
    post.push(n);
    for (const w of [...warter]) if (w.pruef(n)) { warter.splice(warter.indexOf(w), 1); w.ok(n); }
  });
  const zu = new Promise((ok) => ws.addEventListener('close', (e) => ok(e.code)));
  return {
    ws,
    zu,
    warte: (pruef, ms = 2000) => new Promise((ok, fehler) => {
      const schon = post.find(pruef);
      if (schon) { ok(schon); return; }
      warter.push({ pruef, ok });
      setTimeout(() => fehler(new Error('Zeitueberschreitung')), ms);
    }),
    senden: (n) => ws.send(JSON.stringify(n)),
  };
}

const tablet = geraet('b_vomgeraet1');
const pc = geraet('b_vomgeraet1');
const standT = await tablet.warte((n) => n.t === 'stand');
await pc.warte((n) => n.t === 'stand');
pruefe('Beim Verbinden kommt der ganze Stand', standT.elemente.length === 1 && standT.titel === 'Umzug');

const neuerStrich = { id: 's2', typ: 'strich', z: 1, farbe: 'blue', breite: 3, punkte: [5, 5, 50, 50], druck: null };
tablet.senden({ t: 'ops', nr: 1, ops: [{ art: 'setzen', el: neuerStrich }, { art: 'loeschen', id: 's1' }] });
const bestaetigt = await tablet.warte((n) => n.t === 'ack' && n.nr === 1).catch(() => null);
const beimPc = await pc.warte((n) => n.t === 'ops').catch(() => null);
pruefe('Das Tablet bekommt eine Bestätigung', !!bestaetigt);
pruefe('Der PC sieht die Änderung sofort', beimPc?.ops?.length === 2 && beimPc.ops[0].el.id === 's2');
pruefe('Das Tablet bekommt seine eigene Änderung nicht zurück',
  !(await tablet.warte((n) => n.t === 'ops', 300).catch(() => null)));

const zwischen = await api('/boards/b_vomgeraet1');
pruefe('Laden per REST zeigt schon den Live-Stand',
  zwischen.daten.daten.elemente.map((e) => e.id).join() === 's2', JSON.stringify(zwischen.daten.daten.elemente.map((e) => e.id)));

pc.senden({ t: 'ops', nr: 1, ops: [{ art: 'setzen', el: { kaputt: true } }] });
const abgelehnt = await pc.warte((n) => n.t === 'fehler').catch(() => null);
pruefe('Kaputte Operationen werden abgelehnt', !!abgelehnt);

await api('/boards/b_vomgeraet1', { method: 'PATCH', body: { titel: 'Umzug 2' } });
const meta = await tablet.warte((n) => n.t === 'meta').catch(() => null);
pruefe('Umbenennen erreicht offene Geräte', meta?.titel === 'Umzug 2');

const fremdesGeraet = geraet('b_vomgeraet1', { 'x-test-person': 'zweite@whiteboard.local' });
pruefe('Fremde kommen nicht in den Raum', (await fremdesGeraet.zu) === 4404);

tablet.ws.close();
pc.ws.close();
await Promise.all([tablet.zu, pc.zu]);
await new Promise((r) => setTimeout(r, 200));
const danach = await api('/boards/b_vomgeraet1');
pruefe('Nach dem Schließen steht alles in der Datenbank',
  danach.daten.daten.elemente.length === 1 && danach.daten.daten.elemente[0].id === 's2');

const nachzuegler = await api('/boards/b_vomgeraet1/ops', {
  method: 'POST', body: { ops: [{ art: 'hintergrund', wert: { farbe: 'slate', muster: 'grid' } }] },
});
pruefe('Offline-Nachzügler kommen auch ohne offene Verbindung an',
  nachzuegler.status === 204 && (await api('/boards/b_vomgeraet1')).daten.hintergrund.farbe === 'slate');

console.log('\n--- Teilen ---');

const B = { 'x-test-person': 'zweite@whiteboard.local' };
const C = { 'x-test-person': 'dritte@whiteboard.local' };
const alsB = (pfad, o = {}) => api(pfad, { ...o, headers: { ...B, ...o.headers } });

pruefe('Ohne Freigabe ist das Board für andere unsichtbar', (await alsB('/boards/b_vomgeraet1')).status === 404);
pruefe('Kaputte Adresse wird abgewiesen',
  (await api('/boards/b_vomgeraet1/freigaben', { method: 'POST', body: { email: 'keine-adresse' } })).status === 400);
pruefe('Mit sich selbst teilen geht nicht',
  (await api('/boards/b_vomgeraet1/freigaben', { method: 'POST', body: { email: 'test@whiteboard.local' } })).status === 400);

const geteilt = await api('/boards/b_vomgeraet1/freigaben', {
  method: 'POST', body: { email: 'Zweite@Whiteboard.local', recht: 'ansehen' },
});
pruefe('Teilen legt eine Freigabe an (Adresse klein geschrieben)',
  geteilt.daten?.freigaben?.[0]?.email === 'zweite@whiteboard.local' && geteilt.daten.freigaben[0].recht === 'ansehen',
  JSON.stringify(geteilt.daten));

const listeB = (await alsB('/boards')).daten;
const beiB = listeB.boards.find((b) => b.id === 'b_vomgeraet1');
pruefe('Das Board steht in der Bibliothek der anderen Person, mit Besitzer und Recht',
  beiB?.recht === 'ansehen' && beiB.besitzer?.email === 'test@whiteboard.local', JSON.stringify(beiB));
const beiA = (await api('/boards')).daten.boards.find((b) => b.id === 'b_vomgeraet1');
pruefe('Beim Besitzer steht, mit wem es geteilt ist',
  beiA?.geteiltMit?.length === 1 && beiA.geteiltMit[0].email === 'zweite@whiteboard.local' && beiA.recht === 'besitzer',
  JSON.stringify(beiA?.geteiltMit));
pruefe('Personen haben eine feste Kennfarbe aus der Palette',
  ['teal', 'coral', 'amber', 'green', 'pink', 'violet'].includes(beiA.geteiltMit[0].farbe)
  && beiB.besitzer.farbe === (await api('/me')).daten.farbe);

pruefe('Nur ansehen: laden geht', (await alsB('/boards/b_vomgeraet1')).status === 200);
pruefe('Nur ansehen: umbenennen nicht',
  (await alsB('/boards/b_vomgeraet1', { method: 'PATCH', body: { titel: 'Meins' } })).status === 403);
pruefe('Nur ansehen: Nachzügler-Ops nicht',
  (await alsB('/boards/b_vomgeraet1/ops', { method: 'POST', body: { ops: [{ art: 'loeschen', id: 's2' }] } })).status === 403);
pruefe('Nur der Besitzer darf weiter teilen',
  (await alsB('/boards/b_vomgeraet1/freigaben', { method: 'POST', body: { email: 'dritte@whiteboard.local' } })).status === 403);
pruefe('Nur der Besitzer darf löschen', (await alsB('/boards/b_vomgeraet1/papierkorb', { method: 'POST' })).status === 403);

const a1 = geraet('b_vomgeraet1');
await a1.warte((n) => n.t === 'stand');
const b1 = geraet('b_vomgeraet1', B);
const ichB = await b1.warte((n) => n.t === 'ich').catch(() => null);
pruefe('Die andere Person kommt mit ihrem Recht in den Raum', ichB?.recht === 'ansehen');
const anwesend = await a1.warte((n) => n.t === 'anwesend' && n.personen.length === 2).catch(() => null);
pruefe('Anwesende sind sichtbar, mit Namen und Kennfarbe',
  anwesend?.personen.some((p) => p.email === 'zweite@whiteboard.local' && p.farbe), JSON.stringify(anwesend));

b1.senden({ t: 'ops', nr: 1, ops: [{ art: 'loeschen', id: 's2' }] });
pruefe('Nur ansehen: live senden wird abgelehnt', !!(await b1.warte((n) => n.t === 'fehler').catch(() => null)));

a1.senden({ t: 'ops', nr: 1, ops: [{ art: 'setzen', el: { ...neuerStrich, id: 's3' } }] });
pruefe('Wer nur ansieht, sieht trotzdem live mit', !!(await b1.warte((n) => n.t === 'ops').catch(() => null)));

await api('/boards/b_vomgeraet1/freigaben', { method: 'POST', body: { email: 'zweite@whiteboard.local', recht: 'bearbeiten' } });
const hochgestuft = await b1.warte((n) => n.t === 'ich' && n.recht === 'bearbeiten').catch(() => null);
pruefe('Ein geändertes Recht gilt sofort, ohne neu zu verbinden', !!hochgestuft);

b1.senden({ t: 'entwurf', el: { id: 'e1', typ: 'strich', punkte: [0, 0, 5, 5] } });
const entwurf = await a1.warte((n) => n.t === 'entwurf' && n.el).catch(() => null);
pruefe('Ein Strich im Entstehen kommt live an, mit Absender', entwurf?.von === ichB?.verbindung);
b1.senden({ t: 'ops', nr: 2, ops: [{ art: 'setzen', el: { ...neuerStrich, id: 's4' } }] });
pruefe('Mit Bearbeiten-Recht kommen Änderungen an',
  !!(await b1.warte((n) => n.t === 'ack' && n.nr === 2).catch(() => null)));

await alsB('/boards/b_vomgeraet1/freigaben/zweite@whiteboard.local', { method: 'DELETE' });
pruefe('Sich selbst entfernen wirft einen sofort aus dem Raum', (await b1.zu) === 4403);
pruefe('Danach ist das Board für die Person wieder unsichtbar',
  !(await alsB('/boards')).daten.boards.some((b) => b.id === 'b_vomgeraet1'));
pruefe('Auch beim Besitzer ist die Person dann weg',
  !(await api('/boards/b_vomgeraet1/freigaben')).daten.freigaben.some((f) => f.email === 'zweite@whiteboard.local'));
pruefe('Rückgängig holt das Board zurück',
  (await alsB('/boards/b_vomgeraet1/freigaben/zurueck', { method: 'POST' })).status === 204
  && (await alsB('/boards')).daten.boards.some((b) => b.id === 'b_vomgeraet1' && b.recht === 'bearbeiten'));
pruefe('Wer nie eingeladen war, kann sich nicht selbst zurückholen',
  (await api('/boards/b_vomgeraet1/freigaben/zurueck', {
    method: 'POST', headers: { 'x-test-person': 'unbeteiligt@whiteboard.local' },
  })).status === 404);
await alsB('/boards/b_vomgeraet1/freigaben/zweite@whiteboard.local', { method: 'DELETE' });

await api('/boards/b_vomgeraet1/freigaben', { method: 'POST', body: { email: 'dritte@whiteboard.local' } });
pruefe('Eine Freigabe für jemanden, der sich noch nie angemeldet hat, geht',
  (await api('/boards/b_vomgeraet1/freigaben')).daten.freigaben.some((f) => f.email === 'dritte@whiteboard.local' && !f.angemeldet));
const beiC = (await api('/boards', { headers: C })).daten.boards;
pruefe('Beim ersten Anmelden ist das geteilte Board schon da', beiC.some((b) => b.id === 'b_vomgeraet1' && b.recht === 'bearbeiten'));
await api('/boards/b_vomgeraet1/papierkorb', { method: 'POST' });
pruefe('Im Papierkorb des Besitzers ist es für andere weg',
  !(await api('/boards', { headers: C })).daten.boards.some((b) => b.id === 'b_vomgeraet1'));
await api('/boards/b_vomgeraet1/wiederherstellen', { method: 'POST' });
a1.ws.close();
await a1.zu;

console.log('\n--- Bilder ---');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
async function hoch(boardId, daten, kopf = {}, query = '') {
  const a = await fetch(`${BASIS}/boards/${boardId}/bilder${query}`, {
    method: 'POST', headers: { 'content-type': 'image/png', ...kopf }, body: daten,
  });
  return { status: a.status, daten: await a.json().catch(() => null) };
}

const hochgeladen = await hoch('b_vomgeraet1', PNG, {}, '?id=i_testbild1&breite=1&hoehe=1');
pruefe('Ein Bild lässt sich hochladen, mit gewünschter Id', hochgeladen.status === 201 && hochgeladen.daten.id === 'i_testbild1',
  JSON.stringify(hochgeladen));
const zurueck = await fetch(`${BASIS}/boards/b_vomgeraet1/bilder/i_testbild1`);
pruefe('Und kommt unverändert zurück',
  zurueck.headers.get('content-type') === 'image/png' && Buffer.from(await zurueck.arrayBuffer()).equals(PNG));
pruefe('Etwas, das kein Bild ist, wird abgewiesen, egal was der Browser behauptet',
  (await hoch('b_vomgeraet1', Buffer.from('<script>alert(1)</script>'))).status === 400);
pruefe('Fremde kommen nicht an das Bild',
  (await fetch(`${BASIS}/boards/b_vomgeraet1/bilder/i_testbild1`, { headers: { 'x-test-person': 'unbeteiligt@whiteboard.local' } })).status === 404);
pruefe('Fremde können keine Bilder hochladen',
  (await hoch('b_vomgeraet1', PNG, { 'x-test-person': 'unbeteiligt@whiteboard.local' })).status === 404);
const bildKopie = await api('/boards/b_vomgeraet1/duplizieren', { method: 'POST' });
pruefe('Ein dupliziertes Board hat seine Bilder mit',
  (await fetch(`${BASIS}/boards/${bildKopie.daten.id}/bilder/i_testbild1`)).status === 200);
await api(`/boards/${bildKopie.daten.id}/papierkorb`, { method: 'POST' });
await api(`/boards/${bildKopie.daten.id}`, { method: 'DELETE' });
pruefe('Endgültig gelöscht: das Original behält sein Bild',
  (await fetch(`${BASIS}/boards/b_vomgeraet1/bilder/i_testbild1`)).status === 200);

console.log('\n--- Ordner ---');

const arbeit = (await api('/ordner', { method: 'POST', body: { name: 'Arbeit' } })).daten;
const projekt = (await api('/ordner', { method: 'POST', body: { name: 'Projekt X', elternId: arbeit.id } })).daten;
pruefe('Ordner lassen sich verschachteln', projekt?.elternId === arbeit.id, JSON.stringify(projekt));
pruefe('Ein Ordner kann nicht in seinen eigenen Unterordner',
  (await api(`/ordner/${arbeit.id}`, { method: 'PATCH', body: { elternId: projekt.id } })).status === 400);
pruefe('Fremde Ordner gibt es nicht', (await api('/ordner', { headers: B })).daten.ordner.length === 0);

const imOrdner = (await api('/boards', { method: 'POST', body: { titel: 'Im Projekt', ordnerId: projekt.id } })).daten;
let alle = (await api('/boards')).daten;
pruefe('Ein Board entsteht im gewählten Ordner',
  alle.boards.find((b) => b.id === imOrdner.id)?.ordnerId === projekt.id && alle.ordner.length === 2);

// Every person files a shared board themselves
await api('/boards/b_vomgeraet1/freigaben', { method: 'POST', body: { email: 'zweite@whiteboard.local', recht: 'bearbeiten' } });
const bOrdner = (await api('/ordner', { method: 'POST', headers: B, body: { name: 'Von anderen' } })).daten;
await api('/boards/b_vomgeraet1/ort', { method: 'PUT', headers: B, body: { ordnerId: bOrdner.id } });
pruefe('Ein geteiltes Board liegt bei jeder Person woanders',
  (await api('/boards', { headers: B })).daten.boards.find((b) => b.id === 'b_vomgeraet1')?.ordnerId === bOrdner.id
  && (await api('/boards')).daten.boards.find((b) => b.id === 'b_vomgeraet1')?.ordnerId === null);

// B shares one of their own boards with me; I put it into my project folder
const vonB = (await api('/boards', { method: 'POST', headers: B, body: { titel: 'Von B' } })).daten;
await api(`/boards/${vonB.id}/freigaben`, { method: 'POST', headers: B, body: { email: 'test@whiteboard.local' } });
await api(`/boards/${vonB.id}/ort`, { method: 'PUT', body: { ordnerId: projekt.id } });
const geloescht = (await api(`/ordner/${arbeit.id}`, { method: 'DELETE' })).daten;
alle = (await api('/boards')).daten;
pruefe('Ordner löschen nimmt Unterordner mit und legt eigene Boards in den Papierkorb',
  geloescht?.ordner === 2 && geloescht.eigene === 1 && geloescht.geteilt === 1 && alle.ordner.length === 0
  && alle.papierkorb.some((b) => b.id === imOrdner.id), JSON.stringify(geloescht));
pruefe('Geteilte Boards verschwinden nur aus der eigenen Bibliothek',
  !alle.boards.some((b) => b.id === vonB.id)
  && (await api('/boards', { headers: B })).daten.boards.some((b) => b.id === vonB.id));
const rueck = await api('/ordner/wiederherstellen', { method: 'POST', body: { vorgang: geloescht.vorgang } });
alle = (await api('/boards')).daten;
pruefe('Rückgängig holt Ordner und Boards an ihren Ort zurück',
  rueck.status === 204 && alle.ordner.length === 2
  && alle.boards.find((b) => b.id === imOrdner.id)?.ordnerId === projekt.id
  && alle.boards.find((b) => b.id === vonB.id)?.ordnerId === projekt.id);
await api('/boards/b_vomgeraet1/freigaben/zweite@whiteboard.local', { method: 'DELETE' });

console.log('\n--- Ordner teilen ---');

pruefe('Fremde Ordner lassen sich nicht teilen',
  (await api(`/ordner/${arbeit.id}/freigaben`, { method: 'POST', headers: B, body: { email: 'dritte@whiteboard.local' } })).status === 404);
const ordnerGeteilt = await api(`/ordner/${arbeit.id}/freigaben`, { method: 'POST', body: { email: 'Zweite@whiteboard.local', recht: 'ansehen' } });
pruefe('Ein Ordner lässt sich teilen', ordnerGeteilt.status === 200
  && ordnerGeteilt.daten.freigaben.some((f) => f.email === 'zweite@whiteboard.local' && f.recht === 'ansehen'));
let ordnerBeiB = (await api('/boards', { headers: B })).daten;
const bArbeit = ordnerBeiB.ordner.find((o) => o.id === arbeit.id);
const bProjekt = ordnerBeiB.ordner.find((o) => o.id === projekt.id);
pruefe('Der geteilte Ordner steht bei der anderen Person ganz oben, mit Besitzer und Recht',
  bArbeit?.elternId === null && bArbeit.recht === 'ansehen' && bArbeit.geteilteWurzel === true
  && bArbeit.besitzer?.email === 'test@whiteboard.local', JSON.stringify(bArbeit));
pruefe('Unterordner kommen mit, so verschachtelt wie beim Besitzer',
  bProjekt?.elternId === arbeit.id && !bProjekt.geteilteWurzel);
const imOrdnerBeiB = ordnerBeiB.boards.find((b) => b.id === imOrdner.id);
pruefe('Boards darin kommen mit, an ihrem Ort und mit dem Recht des Ordners',
  imOrdnerBeiB?.ordnerId === projekt.id && imOrdnerBeiB.recht === 'ansehen' && imOrdnerBeiB.ueberOrdner === true,
  JSON.stringify(imOrdnerBeiB));
pruefe('Über den Ordner: laden geht', (await alsB(`/boards/${imOrdner.id}`)).status === 200);
pruefe('Über den Ordner, nur ansehen: umbenennen nicht',
  (await alsB(`/boards/${imOrdner.id}`, { method: 'PATCH', body: { titel: 'x' } })).status === 403);
pruefe('Fremde Ordner umbenennen oder löschen geht nicht',
  (await alsB(`/ordner/${arbeit.id}`, { method: 'PATCH', body: { name: 'x' } })).status === 404
  && (await alsB(`/ordner/${arbeit.id}`, { method: 'DELETE' })).status === 404);
pruefe('In fremde Ordner lässt sich nichts ablegen',
  (await alsB(`/boards/${vonB.id}/ort`, { method: 'PUT', body: { ordnerId: projekt.id } })).status === 404);
alle = (await api('/boards')).daten;
pruefe('Beim Besitzer steht, mit wem der Ordner geteilt ist',
  alle.ordner.find((o) => o.id === arbeit.id)?.geteiltMit?.some((p) => p.email === 'zweite@whiteboard.local'));
const boardFreigaben = (await api(`/boards/${imOrdner.id}/freigaben`)).daten;
pruefe('Das Board zeigt, über welchen Ordner es geteilt ist',
  boardFreigaben.ueberOrdner?.[0]?.ordner.id === arbeit.id
  && boardFreigaben.ueberOrdner[0].personen.some((p) => p.email === 'zweite@whiteboard.local'), JSON.stringify(boardFreigaben.ueberOrdner));

await api(`/ordner/${arbeit.id}/freigaben`, { method: 'POST', body: { email: 'zweite@whiteboard.local', recht: 'bearbeiten' } });
pruefe('Mit Bearbeiten-Recht am Ordner lassen sich die Boards darin bearbeiten',
  (await alsB(`/boards/${imOrdner.id}`, { method: 'PATCH', body: { titel: 'Im Projekt' } })).status === 200);
const spaeter = (await api('/boards', { method: 'POST', body: { titel: 'Später dazu', ordnerId: projekt.id } })).daten;
pruefe('Was später in den Ordner kommt, ist auch geteilt', (await alsB(`/boards/${spaeter.id}`)).status === 200);
await api(`/boards/${spaeter.id}/ort`, { method: 'PUT', body: { ordnerId: null } });
pruefe('Aus dem Ordner herausgelegt, ist es nicht mehr geteilt', (await alsB(`/boards/${spaeter.id}`)).status === 404);
await api(`/boards/${spaeter.id}/papierkorb`, { method: 'POST' });
await api(`/boards/${spaeter.id}`, { method: 'DELETE' });

pruefe('Unterordner lassen sich nicht einzeln aus der Bibliothek entfernen',
  (await alsB(`/ordner/${projekt.id}/freigaben/zweite@whiteboard.local`, { method: 'DELETE' })).status === 400);
await alsB(`/ordner/${arbeit.id}/freigaben/zweite@whiteboard.local`, { method: 'DELETE' });
ordnerBeiB = (await api('/boards', { headers: B })).daten;
pruefe('Aus der eigenen Bibliothek entfernt: Ordner und Boards sind weg',
  !ordnerBeiB.ordner.some((o) => o.id === arbeit.id) && !ordnerBeiB.boards.some((b) => b.id === imOrdner.id)
  && (await alsB(`/boards/${imOrdner.id}`)).status === 404);
await api(`/ordner/${arbeit.id}/freigaben/zurueck`, { method: 'POST', headers: B });
pruefe('Rückgängig holt den geteilten Ordner zurück', (await alsB(`/boards/${imOrdner.id}`)).status === 200);
await api(`/ordner/${arbeit.id}/freigaben/zweite@whiteboard.local`, { method: 'DELETE' });
pruefe('Entfernt der Besitzer die Person, ist alles darin wieder unsichtbar',
  (await alsB(`/boards/${imOrdner.id}`)).status === 404
  && !(await api('/boards', { headers: B })).daten.ordner.some((o) => o.id === arbeit.id));

console.log('\n--- Papierkorb mit Ordnern ---');

const oA = (await api('/ordner', { method: 'POST', body: { name: 'Altes Projekt' } })).daten;
const oB = (await api('/ordner', { method: 'POST', body: { name: 'Skizzen', elternId: oA.id } })).daten;
const bX = (await api('/boards', { method: 'POST', body: { titel: 'Skizze 1', ordnerId: oB.id } })).daten;
const bY = (await api('/boards', { method: 'POST', body: { titel: 'Übersicht', ordnerId: oA.id } })).daten;
const wegA = (await api(`/ordner/${oA.id}`, { method: 'DELETE' })).daten;
let korb = (await api('/boards')).daten;
const imKorb = korb.papierkorbOrdner?.find((o) => o.id === oA.id);
pruefe('Ein gelöschter Ordner steht im Papierkorb, mit dem, was darin war',
  imKorb?.unterordner === 1 && imKorb.boards === 2 && imKorb.vorgang === wegA.vorgang
  && !korb.papierkorbOrdner.some((o) => o.id === oB.id), JSON.stringify(korb.papierkorbOrdner));
pruefe('Seine Boards tragen im Papierkorb den Vorgang des Ordners',
  korb.papierkorb.filter((b) => b.vorgang === wegA.vorgang).length === 2);

await api(`/boards/${bX.id}/wiederherstellen`, { method: 'POST' });
korb = (await api('/boards')).daten;
pruefe('Ein einzeln wiederhergestelltes Board kommt an seinen alten Ort, samt Ordnerpfad',
  korb.boards.find((b) => b.id === bX.id)?.ordnerId === oB.id
  && korb.ordner.some((o) => o.id === oA.id) && korb.ordner.some((o) => o.id === oB.id));
pruefe('Die Geschwister bleiben dabei im Papierkorb', korb.papierkorb.some((b) => b.id === bY.id));
await api(`/boards/${bY.id}/wiederherstellen`, { method: 'POST' });
pruefe('Auch das zweite Board landet wieder im alten Ordner',
  (await api('/boards')).daten.boards.find((b) => b.id === bY.id)?.ordnerId === oA.id);

// Delete the subfolder first, then the folder above it: two entries
const wegB = (await api(`/ordner/${oB.id}`, { method: 'DELETE' })).daten;
const wegA2 = (await api(`/ordner/${oA.id}`, { method: 'DELETE' })).daten;
korb = (await api('/boards')).daten;
pruefe('Nacheinander gelöschte Ordner stehen einzeln im Papierkorb',
  korb.papierkorbOrdner.some((o) => o.id === oA.id) && korb.papierkorbOrdner.some((o) => o.id === oB.id));
await api('/ordner/wiederherstellen', { method: 'POST', body: { vorgang: wegB.vorgang } });
korb = (await api('/boards')).daten;
pruefe('Den Unterordner zurückholen holt den Ordner darüber mit, nicht aber dessen übrigen Inhalt',
  korb.ordner.find((o) => o.id === oB.id)?.elternId === oA.id && korb.ordner.some((o) => o.id === oA.id)
  && korb.boards.find((b) => b.id === bX.id)?.ordnerId === oB.id
  && korb.papierkorb.some((b) => b.id === bY.id));
await api('/ordner/wiederherstellen', { method: 'POST', body: { vorgang: wegA2.vorgang } });
pruefe('Danach kommt auch der Rest zurück',
  (await api('/boards')).daten.boards.find((b) => b.id === bY.id)?.ordnerId === oA.id);

const wegA3 = (await api(`/ordner/${oA.id}`, { method: 'DELETE' })).daten;
const endgueltig = await api(`/papierkorb/ordner/${wegA3.vorgang}`, { method: 'DELETE' });
korb = (await api('/boards')).daten;
pruefe('Ein Ordner lässt sich samt Inhalt endgültig löschen',
  endgueltig.daten?.boards === 2 && !korb.papierkorbOrdner.some((o) => o.id === oA.id)
  && !korb.papierkorb.some((b) => b.id === bX.id || b.id === bY.id) && !korb.ordner.some((o) => o.id === oB.id));
pruefe('Endgültig gelöscht lässt sich nicht mehr zurückholen',
  (await api('/ordner/wiederherstellen', { method: 'POST', body: { vorgang: wegA3.vorgang } })).status === 404);

console.log(`\n${bestanden} bestanden, ${gescheitert} gescheitert\n`);
beenden(gescheitert ? 1 : 0);
