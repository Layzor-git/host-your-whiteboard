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
  else { console.log(`  FAIL ${name} ${zusatz}`); gescheitert++; }
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
  if (versuch > 60) { console.error('Server does not start:\n' + ausgabe); beenden(1); }
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

console.log('\n--- Basics ---');

const gesund = await api('/health');
pruefe('The server is alive', gesund.daten?.ok === true, JSON.stringify(gesund.daten));

const ich = await api('/me');
pruefe('Whoever knocks gets a record', ich.daten?.email === 'test@whiteboard.local',
  JSON.stringify(ich.daten));

// The same address twice must not create a second user.
const nochmal = await api('/me');
pruefe('And the same one the second time', nochmal.daten.id === ich.daten.id);

const andere = await api('/me', { headers: { 'x-test-person': 'zweite@whiteboard.local' } });
pruefe('A second person really is a second one', andere.daten.id !== ich.daten.id);

pruefe('An unknown path is a 404', (await api('/gibtsnicht')).status === 404);

console.log('\n--- Boards ---');

const leer = await api('/boards');
pruefe('At the start there are no boards', leer.daten?.boards?.length === 0, JSON.stringify(leer.daten));

const leererTitel = await api('/boards', { method: 'POST', body: { titel: '  ' } });
pruefe('An empty title is rejected', leererTitel.status === 400);
pruefe('Errors carry a code for translation and an English text',
  leererTitel.daten?.code === 'board_name_missing' && leererTitel.daten.text === 'A board needs a name.',
  JSON.stringify(leererTitel.daten));
const fremdesBoard = await api('/boards/b_gibtesnicht1');
pruefe('404 carries a code too', fremdesBoard.status === 404 && fremdesBoard.daten?.code === 'board_not_found',
  JSON.stringify(fremdesBoard.daten));
pruefe('An unknown canvas color is rejected',
  (await api('/boards', { method: 'POST', body: { titel: 'x', hintergrund: { farbe: 'lila' } } })).status === 400);

const angelegt = await api('/boards', {
  method: 'POST',
  body: { id: 'b_vomgeraet1', titel: 'Umzug', hintergrund: { farbe: 'paper', muster: 'grid' } },
});
pruefe('A board is created under the id from the device',
  angelegt.status === 201 && angelegt.daten.id === 'b_vomgeraet1', JSON.stringify(angelegt.daten));
const doppelt = await api('/boards', { method: 'POST', body: { id: 'b_vomgeraet1', titel: 'Umzug' } });
pruefe('Creating twice does not create it twice',
  doppelt.daten.id === 'b_vomgeraet1' && (await api('/boards')).daten.boards.length === 1);

const strich = { id: 's1', typ: 'strich', z: 0, farbe: 'graphite', breite: 3, punkte: [0, 0, 10, 10], druck: null };
const gespeichert = await api('/boards/b_vomgeraet1', {
  method: 'PATCH', body: { daten: { version: 1, elemente: [strich] } },
});
pruefe('Saving increments the version', gespeichert.daten?.version === 2 && gespeichert.daten.anzahl === 1,
  JSON.stringify(gespeichert.daten));
const geladen = await api('/boards/b_vomgeraet1');
pruefe('Loading returns what was saved',
  geladen.daten?.daten?.elemente?.[0]?.farbe === 'graphite' && geladen.daten.hintergrund.muster === 'grid');

const fremd = await api('/boards/b_vomgeraet1', { headers: { 'x-test-person': 'zweite@whiteboard.local' } });
pruefe("Other people's boards stay hidden", fremd.status === 404);

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const vs = await api('/boards/b_vomgeraet1/vorschau', { method: 'PUT', body: { bild: png } });
const bild = await fetch(`${BASIS}/boards/b_vomgeraet1/vorschau`);
pruefe('The thumbnail comes back as an image',
  vs.status === 204 && bild.headers.get('content-type') === 'image/png');

const kopie = await api('/boards/b_vomgeraet1/duplizieren', { method: 'POST' });
pruefe('Duplicating copies content and thumbnail',
  kopie.daten?.titel === 'Umzug (Kopie)' && kopie.daten.anzahl === 1 && kopie.daten.hatVorschau);

pruefe('Active boards cannot be deleted permanently',
  (await api(`/boards/${kopie.daten.id}`, { method: 'DELETE' })).status === 400);
await api(`/boards/${kopie.daten.id}/papierkorb`, { method: 'POST' });
let l = (await api('/boards')).daten;
pruefe('The trash takes the board', l.boards.length === 1 && l.papierkorb.length === 1);
await api(`/boards/${kopie.daten.id}/wiederherstellen`, { method: 'POST' });
l = (await api('/boards')).daten;
pruefe('Restoring brings it back', l.boards.length === 2 && l.papierkorb.length === 0);
await api(`/boards/${kopie.daten.id}/papierkorb`, { method: 'POST' });
const leeren = await api('/papierkorb', { method: 'DELETE' });
l = (await api('/boards')).daten;
pruefe('Emptying the trash deletes permanently', leeren.daten?.geloescht === 1 && l.papierkorb.length === 0 && l.boards.length === 1);

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
pruefe('Connecting delivers the whole state', standT.elemente.length === 1 && standT.titel === 'Umzug');

const neuerStrich = { id: 's2', typ: 'strich', z: 1, farbe: 'blue', breite: 3, punkte: [5, 5, 50, 50], druck: null };
tablet.senden({ t: 'ops', nr: 1, ops: [{ art: 'setzen', el: neuerStrich }, { art: 'loeschen', id: 's1' }] });
const bestaetigt = await tablet.warte((n) => n.t === 'ack' && n.nr === 1).catch(() => null);
const beimPc = await pc.warte((n) => n.t === 'ops').catch(() => null);
pruefe('The tablet gets an acknowledgement', !!bestaetigt);
pruefe('The PC sees the change right away', beimPc?.ops?.length === 2 && beimPc.ops[0].el.id === 's2');
pruefe('The tablet does not get its own change back',
  !(await tablet.warte((n) => n.t === 'ops', 300).catch(() => null)));

const zwischen = await api('/boards/b_vomgeraet1');
pruefe('Loading via REST already shows the live state',
  zwischen.daten.daten.elemente.map((e) => e.id).join() === 's2', JSON.stringify(zwischen.daten.daten.elemente.map((e) => e.id)));

pc.senden({ t: 'ops', nr: 1, ops: [{ art: 'setzen', el: { kaputt: true } }] });
const abgelehnt = await pc.warte((n) => n.t === 'fehler').catch(() => null);
pruefe('Broken operations are rejected', !!abgelehnt);

await api('/boards/b_vomgeraet1', { method: 'PATCH', body: { titel: 'Umzug 2' } });
const meta = await tablet.warte((n) => n.t === 'meta').catch(() => null);
pruefe('Renaming reaches open devices', meta?.titel === 'Umzug 2');

const fremdesGeraet = geraet('b_vomgeraet1', { 'x-test-person': 'zweite@whiteboard.local' });
pruefe('Strangers do not get into the room', (await fremdesGeraet.zu) === 4404);

tablet.ws.close();
pc.ws.close();
await Promise.all([tablet.zu, pc.zu]);
await new Promise((r) => setTimeout(r, 200));
const danach = await api('/boards/b_vomgeraet1');
pruefe('After closing, everything is in the database',
  danach.daten.daten.elemente.length === 1 && danach.daten.daten.elemente[0].id === 's2');

const nachzuegler = await api('/boards/b_vomgeraet1/ops', {
  method: 'POST', body: { ops: [{ art: 'hintergrund', wert: { farbe: 'slate', muster: 'grid' } }] },
});
pruefe('Offline stragglers arrive even without an open connection',
  nachzuegler.status === 204 && (await api('/boards/b_vomgeraet1')).daten.hintergrund.farbe === 'slate');

console.log('\n--- Sharing ---');

const B = { 'x-test-person': 'zweite@whiteboard.local' };
const C = { 'x-test-person': 'dritte@whiteboard.local' };
const alsB = (pfad, o = {}) => api(pfad, { ...o, headers: { ...B, ...o.headers } });

pruefe('Without a share the board is invisible to others', (await alsB('/boards/b_vomgeraet1')).status === 404);
pruefe('A broken address is rejected',
  (await api('/boards/b_vomgeraet1/freigaben', { method: 'POST', body: { email: 'keine-adresse' } })).status === 400);
pruefe('Sharing with yourself does not work',
  (await api('/boards/b_vomgeraet1/freigaben', { method: 'POST', body: { email: 'test@whiteboard.local' } })).status === 400);

const geteilt = await api('/boards/b_vomgeraet1/freigaben', {
  method: 'POST', body: { email: 'Zweite@Whiteboard.local', recht: 'ansehen' },
});
pruefe('Sharing creates a share (address in lower case)',
  geteilt.daten?.freigaben?.[0]?.email === 'zweite@whiteboard.local' && geteilt.daten.freigaben[0].recht === 'ansehen',
  JSON.stringify(geteilt.daten));

const listeB = (await alsB('/boards')).daten;
const beiB = listeB.boards.find((b) => b.id === 'b_vomgeraet1');
pruefe("The board is in the other person's library, with owner and permission",
  beiB?.recht === 'ansehen' && beiB.besitzer?.email === 'test@whiteboard.local', JSON.stringify(beiB));
const beiA = (await api('/boards')).daten.boards.find((b) => b.id === 'b_vomgeraet1');
pruefe('The owner sees who it is shared with',
  beiA?.geteiltMit?.length === 1 && beiA.geteiltMit[0].email === 'zweite@whiteboard.local' && beiA.recht === 'besitzer',
  JSON.stringify(beiA?.geteiltMit));
pruefe('People have a fixed peer color from the palette',
  ['teal', 'coral', 'amber', 'green', 'pink', 'violet'].includes(beiA.geteiltMit[0].farbe)
  && beiB.besitzer.farbe === (await api('/me')).daten.farbe);

pruefe('View only: loading works', (await alsB('/boards/b_vomgeraet1')).status === 200);
pruefe('View only: renaming does not',
  (await alsB('/boards/b_vomgeraet1', { method: 'PATCH', body: { titel: 'Meins' } })).status === 403);
pruefe('View only: straggler ops do not',
  (await alsB('/boards/b_vomgeraet1/ops', { method: 'POST', body: { ops: [{ art: 'loeschen', id: 's2' }] } })).status === 403);
pruefe('Only the owner may share further',
  (await alsB('/boards/b_vomgeraet1/freigaben', { method: 'POST', body: { email: 'dritte@whiteboard.local' } })).status === 403);
pruefe('Only the owner may delete', (await alsB('/boards/b_vomgeraet1/papierkorb', { method: 'POST' })).status === 403);

const a1 = geraet('b_vomgeraet1');
await a1.warte((n) => n.t === 'stand');
const b1 = geraet('b_vomgeraet1', B);
const ichB = await b1.warte((n) => n.t === 'ich').catch(() => null);
pruefe('The other person enters the room with their permission', ichB?.recht === 'ansehen');
const anwesend = await a1.warte((n) => n.t === 'anwesend' && n.personen.length === 2).catch(() => null);
pruefe('Those present are visible, with name and peer color',
  anwesend?.personen.some((p) => p.email === 'zweite@whiteboard.local' && p.farbe), JSON.stringify(anwesend));

b1.senden({ t: 'ops', nr: 1, ops: [{ art: 'loeschen', id: 's2' }] });
pruefe('View only: sending live is rejected', !!(await b1.warte((n) => n.t === 'fehler').catch(() => null)));

a1.senden({ t: 'ops', nr: 1, ops: [{ art: 'setzen', el: { ...neuerStrich, id: 's3' } }] });
pruefe('Viewers still watch along live', !!(await b1.warte((n) => n.t === 'ops').catch(() => null)));

await api('/boards/b_vomgeraet1/freigaben', { method: 'POST', body: { email: 'zweite@whiteboard.local', recht: 'bearbeiten' } });
const hochgestuft = await b1.warte((n) => n.t === 'ich' && n.recht === 'bearbeiten').catch(() => null);
pruefe('A changed permission applies immediately, without reconnecting', !!hochgestuft);

b1.senden({ t: 'entwurf', el: { id: 'e1', typ: 'strich', punkte: [0, 0, 5, 5] } });
const entwurf = await a1.warte((n) => n.t === 'entwurf' && n.el).catch(() => null);
pruefe('A stroke in progress arrives live, with sender', entwurf?.von === ichB?.verbindung);
b1.senden({ t: 'ops', nr: 2, ops: [{ art: 'setzen', el: { ...neuerStrich, id: 's4' } }] });
pruefe('With edit permission, changes arrive',
  !!(await b1.warte((n) => n.t === 'ack' && n.nr === 2).catch(() => null)));

await alsB('/boards/b_vomgeraet1/freigaben/zweite@whiteboard.local', { method: 'DELETE' });
pruefe('Removing yourself kicks you out of the room right away', (await b1.zu) === 4403);
pruefe('Afterwards the board is invisible to that person again',
  !(await alsB('/boards')).daten.boards.some((b) => b.id === 'b_vomgeraet1'));
pruefe('The person is then gone for the owner too',
  !(await api('/boards/b_vomgeraet1/freigaben')).daten.freigaben.some((f) => f.email === 'zweite@whiteboard.local'));
pruefe('Undo brings the board back',
  (await alsB('/boards/b_vomgeraet1/freigaben/zurueck', { method: 'POST' })).status === 204
  && (await alsB('/boards')).daten.boards.some((b) => b.id === 'b_vomgeraet1' && b.recht === 'bearbeiten'));
pruefe('Someone never invited cannot bring themselves back',
  (await api('/boards/b_vomgeraet1/freigaben/zurueck', {
    method: 'POST', headers: { 'x-test-person': 'unbeteiligt@whiteboard.local' },
  })).status === 404);
await alsB('/boards/b_vomgeraet1/freigaben/zweite@whiteboard.local', { method: 'DELETE' });

await api('/boards/b_vomgeraet1/freigaben', { method: 'POST', body: { email: 'dritte@whiteboard.local' } });
pruefe('Sharing with someone who has never signed in works',
  (await api('/boards/b_vomgeraet1/freigaben')).daten.freigaben.some((f) => f.email === 'dritte@whiteboard.local' && !f.angemeldet));
const beiC = (await api('/boards', { headers: C })).daten.boards;
pruefe('On first sign-in the shared board is already there', beiC.some((b) => b.id === 'b_vomgeraet1' && b.recht === 'bearbeiten'));
await api('/boards/b_vomgeraet1/papierkorb', { method: 'POST' });
pruefe("In the owner's trash it is gone for others",
  !(await api('/boards', { headers: C })).daten.boards.some((b) => b.id === 'b_vomgeraet1'));
await api('/boards/b_vomgeraet1/wiederherstellen', { method: 'POST' });
a1.ws.close();
await a1.zu;

console.log('\n--- Images ---');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
async function hoch(boardId, daten, kopf = {}, query = '') {
  const a = await fetch(`${BASIS}/boards/${boardId}/bilder${query}`, {
    method: 'POST', headers: { 'content-type': 'image/png', ...kopf }, body: daten,
  });
  return { status: a.status, daten: await a.json().catch(() => null) };
}

const hochgeladen = await hoch('b_vomgeraet1', PNG, {}, '?id=i_testbild1&breite=1&hoehe=1');
pruefe('An image can be uploaded, with a requested id', hochgeladen.status === 201 && hochgeladen.daten.id === 'i_testbild1',
  JSON.stringify(hochgeladen));
const zurueck = await fetch(`${BASIS}/boards/b_vomgeraet1/bilder/i_testbild1`);
pruefe('And comes back unchanged',
  zurueck.headers.get('content-type') === 'image/png' && Buffer.from(await zurueck.arrayBuffer()).equals(PNG));
pruefe('Something that is not an image is rejected, whatever the browser claims',
  (await hoch('b_vomgeraet1', Buffer.from('<script>alert(1)</script>'))).status === 400);
pruefe('Strangers cannot get the image',
  (await fetch(`${BASIS}/boards/b_vomgeraet1/bilder/i_testbild1`, { headers: { 'x-test-person': 'unbeteiligt@whiteboard.local' } })).status === 404);
pruefe('Strangers cannot upload images',
  (await hoch('b_vomgeraet1', PNG, { 'x-test-person': 'unbeteiligt@whiteboard.local' })).status === 404);
const bildKopie = await api('/boards/b_vomgeraet1/duplizieren', { method: 'POST' });
pruefe('A duplicated board keeps its images',
  (await fetch(`${BASIS}/boards/${bildKopie.daten.id}/bilder/i_testbild1`)).status === 200);
await api(`/boards/${bildKopie.daten.id}/papierkorb`, { method: 'POST' });
await api(`/boards/${bildKopie.daten.id}`, { method: 'DELETE' });
pruefe('Permanently deleted: the original keeps its image',
  (await fetch(`${BASIS}/boards/b_vomgeraet1/bilder/i_testbild1`)).status === 200);

console.log('\n--- Folders ---');

const arbeit = (await api('/ordner', { method: 'POST', body: { name: 'Arbeit' } })).daten;
const projekt = (await api('/ordner', { method: 'POST', body: { name: 'Projekt X', elternId: arbeit.id } })).daten;
pruefe('Folders can be nested', projekt?.elternId === arbeit.id, JSON.stringify(projekt));
pruefe('A folder cannot go into its own subfolder',
  (await api(`/ordner/${arbeit.id}`, { method: 'PATCH', body: { elternId: projekt.id } })).status === 400);
pruefe("Other people's folders do not exist", (await api('/ordner', { headers: B })).daten.ordner.length === 0);

const imOrdner = (await api('/boards', { method: 'POST', body: { titel: 'Im Projekt', ordnerId: projekt.id } })).daten;
let alle = (await api('/boards')).daten;
pruefe('A board is created in the chosen folder',
  alle.boards.find((b) => b.id === imOrdner.id)?.ordnerId === projekt.id && alle.ordner.length === 2);

// Every person files a shared board themselves
await api('/boards/b_vomgeraet1/freigaben', { method: 'POST', body: { email: 'zweite@whiteboard.local', recht: 'bearbeiten' } });
const bOrdner = (await api('/ordner', { method: 'POST', headers: B, body: { name: 'Von anderen' } })).daten;
await api('/boards/b_vomgeraet1/ort', { method: 'PUT', headers: B, body: { ordnerId: bOrdner.id } });
pruefe('A shared board sits in a different place for each person',
  (await api('/boards', { headers: B })).daten.boards.find((b) => b.id === 'b_vomgeraet1')?.ordnerId === bOrdner.id
  && (await api('/boards')).daten.boards.find((b) => b.id === 'b_vomgeraet1')?.ordnerId === null);

// B shares one of their own boards with me; I put it into my project folder
const vonB = (await api('/boards', { method: 'POST', headers: B, body: { titel: 'Von B' } })).daten;
await api(`/boards/${vonB.id}/freigaben`, { method: 'POST', headers: B, body: { email: 'test@whiteboard.local' } });
await api(`/boards/${vonB.id}/ort`, { method: 'PUT', body: { ordnerId: projekt.id } });
const geloescht = (await api(`/ordner/${arbeit.id}`, { method: 'DELETE' })).daten;
alle = (await api('/boards')).daten;
pruefe('Deleting a folder takes subfolders along and puts own boards in the trash',
  geloescht?.ordner === 2 && geloescht.eigene === 1 && geloescht.geteilt === 1 && alle.ordner.length === 0
  && alle.papierkorb.some((b) => b.id === imOrdner.id), JSON.stringify(geloescht));
pruefe('Shared boards only disappear from your own library',
  !alle.boards.some((b) => b.id === vonB.id)
  && (await api('/boards', { headers: B })).daten.boards.some((b) => b.id === vonB.id));
const rueck = await api('/ordner/wiederherstellen', { method: 'POST', body: { vorgang: geloescht.vorgang } });
alle = (await api('/boards')).daten;
pruefe('Undo puts folders and boards back in their place',
  rueck.status === 204 && alle.ordner.length === 2
  && alle.boards.find((b) => b.id === imOrdner.id)?.ordnerId === projekt.id
  && alle.boards.find((b) => b.id === vonB.id)?.ordnerId === projekt.id);
await api('/boards/b_vomgeraet1/freigaben/zweite@whiteboard.local', { method: 'DELETE' });

console.log('\n--- Sharing folders ---');

pruefe("Other people's folders cannot be shared",
  (await api(`/ordner/${arbeit.id}/freigaben`, { method: 'POST', headers: B, body: { email: 'dritte@whiteboard.local' } })).status === 404);
const ordnerGeteilt = await api(`/ordner/${arbeit.id}/freigaben`, { method: 'POST', body: { email: 'Zweite@whiteboard.local', recht: 'ansehen' } });
pruefe('A folder can be shared', ordnerGeteilt.status === 200
  && ordnerGeteilt.daten.freigaben.some((f) => f.email === 'zweite@whiteboard.local' && f.recht === 'ansehen'));
let ordnerBeiB = (await api('/boards', { headers: B })).daten;
const bArbeit = ordnerBeiB.ordner.find((o) => o.id === arbeit.id);
const bProjekt = ordnerBeiB.ordner.find((o) => o.id === projekt.id);
pruefe('The shared folder is at the top for the other person, with owner and permission',
  bArbeit?.elternId === null && bArbeit.recht === 'ansehen' && bArbeit.geteilteWurzel === true
  && bArbeit.besitzer?.email === 'test@whiteboard.local', JSON.stringify(bArbeit));
pruefe('Subfolders come along, nested as for the owner',
  bProjekt?.elternId === arbeit.id && !bProjekt.geteilteWurzel);
const imOrdnerBeiB = ordnerBeiB.boards.find((b) => b.id === imOrdner.id);
pruefe("Boards inside come along, in their place and with the folder's permission",
  imOrdnerBeiB?.ordnerId === projekt.id && imOrdnerBeiB.recht === 'ansehen' && imOrdnerBeiB.ueberOrdner === true,
  JSON.stringify(imOrdnerBeiB));
pruefe('Via the folder: loading works', (await alsB(`/boards/${imOrdner.id}`)).status === 200);
pruefe('Via the folder, view only: renaming does not',
  (await alsB(`/boards/${imOrdner.id}`, { method: 'PATCH', body: { titel: 'x' } })).status === 403);
pruefe("Renaming or deleting other people's folders does not work",
  (await alsB(`/ordner/${arbeit.id}`, { method: 'PATCH', body: { name: 'x' } })).status === 404
  && (await alsB(`/ordner/${arbeit.id}`, { method: 'DELETE' })).status === 404);
pruefe("Nothing can be placed in other people's folders",
  (await alsB(`/boards/${vonB.id}/ort`, { method: 'PUT', body: { ordnerId: projekt.id } })).status === 404);
alle = (await api('/boards')).daten;
pruefe('The owner sees who the folder is shared with',
  alle.ordner.find((o) => o.id === arbeit.id)?.geteiltMit?.some((p) => p.email === 'zweite@whiteboard.local'));
const boardFreigaben = (await api(`/boards/${imOrdner.id}/freigaben`)).daten;
pruefe('The board shows which folder it is shared through',
  boardFreigaben.ueberOrdner?.[0]?.ordner.id === arbeit.id
  && boardFreigaben.ueberOrdner[0].personen.some((p) => p.email === 'zweite@whiteboard.local'), JSON.stringify(boardFreigaben.ueberOrdner));

await api(`/ordner/${arbeit.id}/freigaben`, { method: 'POST', body: { email: 'zweite@whiteboard.local', recht: 'bearbeiten' } });
pruefe('With edit permission on the folder, the boards inside can be edited',
  (await alsB(`/boards/${imOrdner.id}`, { method: 'PATCH', body: { titel: 'Im Projekt' } })).status === 200);
const spaeter = (await api('/boards', { method: 'POST', body: { titel: 'Später dazu', ordnerId: projekt.id } })).daten;
pruefe('Whatever is added to the folder later is shared too', (await alsB(`/boards/${spaeter.id}`)).status === 200);
await api(`/boards/${spaeter.id}/ort`, { method: 'PUT', body: { ordnerId: null } });
pruefe('Moved out of the folder, it is no longer shared', (await alsB(`/boards/${spaeter.id}`)).status === 404);
await api(`/boards/${spaeter.id}/papierkorb`, { method: 'POST' });
await api(`/boards/${spaeter.id}`, { method: 'DELETE' });

pruefe('Subfolders cannot be removed from the library on their own',
  (await alsB(`/ordner/${projekt.id}/freigaben/zweite@whiteboard.local`, { method: 'DELETE' })).status === 400);
await alsB(`/ordner/${arbeit.id}/freigaben/zweite@whiteboard.local`, { method: 'DELETE' });
ordnerBeiB = (await api('/boards', { headers: B })).daten;
pruefe('Removed from your own library: folder and boards are gone',
  !ordnerBeiB.ordner.some((o) => o.id === arbeit.id) && !ordnerBeiB.boards.some((b) => b.id === imOrdner.id)
  && (await alsB(`/boards/${imOrdner.id}`)).status === 404);
await api(`/ordner/${arbeit.id}/freigaben/zurueck`, { method: 'POST', headers: B });
pruefe('Undo brings the shared folder back', (await alsB(`/boards/${imOrdner.id}`)).status === 200);
await api(`/ordner/${arbeit.id}/freigaben/zweite@whiteboard.local`, { method: 'DELETE' });
pruefe('If the owner removes the person, everything inside is invisible again',
  (await alsB(`/boards/${imOrdner.id}`)).status === 404
  && !(await api('/boards', { headers: B })).daten.ordner.some((o) => o.id === arbeit.id));

console.log('\n--- Trash with folders ---');

const oA = (await api('/ordner', { method: 'POST', body: { name: 'Altes Projekt' } })).daten;
const oB = (await api('/ordner', { method: 'POST', body: { name: 'Skizzen', elternId: oA.id } })).daten;
const bX = (await api('/boards', { method: 'POST', body: { titel: 'Skizze 1', ordnerId: oB.id } })).daten;
const bY = (await api('/boards', { method: 'POST', body: { titel: 'Übersicht', ordnerId: oA.id } })).daten;
const wegA = (await api(`/ordner/${oA.id}`, { method: 'DELETE' })).daten;
let korb = (await api('/boards')).daten;
const imKorb = korb.papierkorbOrdner?.find((o) => o.id === oA.id);
pruefe('A deleted folder is in the trash, with what was inside',
  imKorb?.unterordner === 1 && imKorb.boards === 2 && imKorb.vorgang === wegA.vorgang
  && !korb.papierkorbOrdner.some((o) => o.id === oB.id), JSON.stringify(korb.papierkorbOrdner));
pruefe("Its boards carry the folder's operation in the trash",
  korb.papierkorb.filter((b) => b.vorgang === wegA.vorgang).length === 2);

await api(`/boards/${bX.id}/wiederherstellen`, { method: 'POST' });
korb = (await api('/boards')).daten;
pruefe('A board restored on its own returns to its old place, including the folder path',
  korb.boards.find((b) => b.id === bX.id)?.ordnerId === oB.id
  && korb.ordner.some((o) => o.id === oA.id) && korb.ordner.some((o) => o.id === oB.id));
pruefe('Its siblings stay in the trash', korb.papierkorb.some((b) => b.id === bY.id));
await api(`/boards/${bY.id}/wiederherstellen`, { method: 'POST' });
pruefe('The second board also ends up in the old folder again',
  (await api('/boards')).daten.boards.find((b) => b.id === bY.id)?.ordnerId === oA.id);

// Delete the subfolder first, then the folder above it: two entries
const wegB = (await api(`/ordner/${oB.id}`, { method: 'DELETE' })).daten;
const wegA2 = (await api(`/ordner/${oA.id}`, { method: 'DELETE' })).daten;
korb = (await api('/boards')).daten;
pruefe('Folders deleted one after another appear separately in the trash',
  korb.papierkorbOrdner.some((o) => o.id === oA.id) && korb.papierkorbOrdner.some((o) => o.id === oB.id));
await api('/ordner/wiederherstellen', { method: 'POST', body: { vorgang: wegB.vorgang } });
korb = (await api('/boards')).daten;
pruefe('Restoring the subfolder brings the folder above it, but not its other content',
  korb.ordner.find((o) => o.id === oB.id)?.elternId === oA.id && korb.ordner.some((o) => o.id === oA.id)
  && korb.boards.find((b) => b.id === bX.id)?.ordnerId === oB.id
  && korb.papierkorb.some((b) => b.id === bY.id));
await api('/ordner/wiederherstellen', { method: 'POST', body: { vorgang: wegA2.vorgang } });
pruefe('Afterwards the rest comes back too',
  (await api('/boards')).daten.boards.find((b) => b.id === bY.id)?.ordnerId === oA.id);

const wegA3 = (await api(`/ordner/${oA.id}`, { method: 'DELETE' })).daten;
const endgueltig = await api(`/papierkorb/ordner/${wegA3.vorgang}`, { method: 'DELETE' });
korb = (await api('/boards')).daten;
pruefe('A folder can be deleted permanently with its content',
  endgueltig.daten?.boards === 2 && !korb.papierkorbOrdner.some((o) => o.id === oA.id)
  && !korb.papierkorb.some((b) => b.id === bX.id || b.id === bY.id) && !korb.ordner.some((o) => o.id === oB.id));
pruefe('Once permanently deleted it cannot be restored',
  (await api('/ordner/wiederherstellen', { method: 'POST', body: { vorgang: wegA3.vorgang } })).status === 404);

console.log(`\n${bestanden} passed, ${gescheitert} failed\n`);
beenden(gescheitert ? 1 : 0);
