// Live-Abgleich eines offenen Boards mit dem Pi, per WebSocket.
//
// Eigene Aenderungen kommen als Operationen aus dem Dokument (Ereignis
// "ops") und landen zuerst in einem Puffer: je Element nur die letzte
// Operation, mit fortlaufender Nummer. Der Puffer liegt auch in IndexedDB,
// ueberlebt also Netzausfall und Neuladen. Der Server bestaetigt jede
// Sendung (ack); bestaetigte Eintraege fliegen raus.
//
// Nach jedem (Wieder-)Verbinden schickt der Server den ganzen Stand. Darauf
// kommt der Puffer obendrauf, dann geht der Puffer komplett noch einmal
// raus. Doppelt Ankommendes schadet nicht: "setzen" und "loeschen" haben
// dasselbe Ergebnis, egal wie oft.
//
// Aenderungen anderer Geraete an einem Element, fuer das hier noch etwas
// im Puffer liegt, werden ignoriert: Die eigene Aenderung erreicht den
// Server danach und gewinnt dort ohnehin.
//
// Bei geteilten Boards kommen dazu: wer gerade anwesend ist, das eigene
// Recht (bei "ansehen" wird nichts gesendet) und Striche, die jemand
// gerade zeichnet ("Entwurf"), damit man ihnen live zusehen kann.

import { api } from '../api.js';
import { ohneLaufzeit } from '../zeichnen/dokument.js';
import { ausstehendeSenden, idb, opsAufListe } from './speicher.js';

const PING_MS = 25000; // Cloudflare trennt stille Verbindungen nach ~100 s
const SENDEN_NACH_MS = 40;
const WARTEN_MS = [500, 1000, 2000, 5000, 10000];
const VORSCHAU_ALLE_MS = 8000;
const ENTWURF_ALLE_MS = 50;

function schluessel(op) {
  return op.art === 'hintergrund' ? '#hintergrund' : (op.el?.id ?? op.id);
}

export class LiveBoard {
  zustand = 'saved'; // 'saved' | 'saving' | 'offline'
  #ws = null;
  #eintraege = {};
  #nr = 0;
  #gesendetBis = 0;
  #verbunden = false;
  // Erst nach einem gescheiterten Versuch "offline" zeigen, nicht schon
  // in der halben Sekunde, bis die erste Verbindung steht
  #gescheitert = false;
  #versuch = 0;
  #uhren = {};
  #aus = false;
  #vorschauQuelle = null;
  #letzteVorschau = 0;
  #abmelden = [];
  #entwurf = undefined;
  #entwurfZeit = 0;
  /** Eigene Verbindung: { verbindung, farbe, recht } */
  ich = null;
  /** Alle Anwesenden, inklusive der eigenen Verbindung */
  personen = [];

  /**
   * dok: das Dokument der Engine
   * Rueckmeldungen fuer die Oberflaeche:
   *   beiZustand('saved' | 'saving' | 'offline')
   *   beiMeta({ titel })
   *   beiIch({ verbindung, farbe, recht })       auch wenn sich das Recht aendert
   *   beiAnwesenheit(personen)
   *   beiEntwurf(von, el | null, person)         fremder Strich im Entstehen
   *   beiAusgesperrt()                           Zugriff wurde entzogen
   */
  constructor(id, dok, rueck = {}) {
    this.id = id;
    this.dok = dok;
    this.rueck = rueck;
    this.beiZustand = rueck.beiZustand;
    this.beiMeta = rueck.beiMeta;
    this.#abmelden.push(dok.beiAenderung((e) => { if (e.art === 'ops') this.#lokal(e.ops); }));
    const wieder = () => { if (!this.#verbunden) this.#verbinden(true); };
    const sichtbar = () => { if (document.visibilityState === 'visible') wieder(); };
    window.addEventListener('online', wieder);
    document.addEventListener('visibilitychange', sichtbar);
    this.#abmelden.push(() => window.removeEventListener('online', wieder));
    this.#abmelden.push(() => document.removeEventListener('visibilitychange', sichtbar));
    this.#start();
  }

  async #start() {
    const puffer = await idb('ops', 'get', this.id);
    if (puffer) {
      this.#eintraege = { ...puffer.eintraege, ...this.#eintraege };
      this.#nr = Math.max(this.#nr, puffer.nr ?? 0);
    }
    this.#verbinden();
  }

  zerstoeren() {
    this.#aus = true;
    for (const f of this.#abmelden) f();
    for (const u of Object.values(this.#uhren)) clearTimeout(u);
    clearInterval(this.#uhren.ping);
    this.#pufferSichern();
    this.#ws?.close(1000);
  }

  /** Vorschaubild anfordern; quelle() liefert eine data:-URL oder null. */
  vorschau(quelle) {
    this.#vorschauQuelle = quelle;
    clearTimeout(this.#uhren.vorschau);
    const warten = Math.max(1500, VORSCHAU_ALLE_MS - (Date.now() - this.#letzteVorschau));
    this.#uhren.vorschau = setTimeout(() => this.#vorschauSenden(), warten);
  }

  async #vorschauSenden() {
    if (!this.#vorschauQuelle || !this.#verbunden) return;
    const quelle = this.#vorschauQuelle;
    this.#vorschauQuelle = null;
    this.#letzteVorschau = Date.now();
    const bild = quelle();
    if (bild) await api.vorschauSetzen(this.id, bild).catch(() => {});
  }

  /**
   * Eigenen Strich im Entstehen mitteilen (null = fertig oder abgebrochen).
   * Hoechstens alle 50 ms; der letzte Stand geht immer raus.
   */
  entwurf(el) {
    this.#entwurf = el;
    if (el === null) {
      clearTimeout(this.#uhren.entwurf);
      this.#entwurfSenden();
      return;
    }
    const warten = ENTWURF_ALLE_MS - (Date.now() - this.#entwurfZeit);
    if (warten <= 0) this.#entwurfSenden();
    else if (!this.#uhren.entwurfLaeuft) {
      this.#uhren.entwurfLaeuft = true;
      this.#uhren.entwurf = setTimeout(() => this.#entwurfSenden(), warten);
    }
  }

  #entwurfSenden() {
    this.#uhren.entwurfLaeuft = false;
    if (this.#entwurf === undefined || !this.#verbunden || this.ich?.recht === 'ansehen') return;
    this.#entwurfZeit = Date.now();
    this.#ws.send(JSON.stringify({ t: 'entwurf', el: this.#entwurf }));
    if (this.#entwurf === null) this.#entwurf = undefined;
  }

  get #offen() {
    return Object.keys(this.#eintraege).length > 0;
  }

  #zustandNeu() {
    const z = !this.#verbunden && this.#gescheitert ? 'offline' : this.#offen ? 'saving' : 'saved';
    if (z !== this.zustand) {
      this.zustand = z;
      this.beiZustand?.(z);
    }
  }

  // ---- eigene Aenderungen

  #lokal(ops) {
    for (const op of ops) {
      const sauber = op.art === 'setzen' ? { art: 'setzen', el: ohneLaufzeit(op.el) } : op;
      this.#eintraege[schluessel(op)] = { op: sauber, nr: ++this.#nr };
    }
    this.#zustandNeu();
    clearTimeout(this.#uhren.sichern);
    this.#uhren.sichern = setTimeout(() => this.#pufferSichern(), 300);
    clearTimeout(this.#uhren.senden);
    this.#uhren.senden = setTimeout(() => this.#senden(), SENDEN_NACH_MS);
  }

  #pufferSichern() {
    clearTimeout(this.#uhren.sichern);
    if (this.#offen) idb('ops', 'put', { nr: this.#nr, eintraege: this.#eintraege }, this.id);
    else idb('ops', 'delete', this.id);
  }

  #senden() {
    if (!this.#verbunden || this.ich?.recht === 'ansehen') return;
    const neu = Object.values(this.#eintraege).filter((e) => e.nr > this.#gesendetBis);
    if (!neu.length) return;
    this.#gesendetBis = this.#nr;
    this.#ws.send(JSON.stringify({ t: 'ops', nr: this.#nr, ops: neu.map((e) => e.op) }));
  }

  #bestaetigt(nr) {
    for (const [k, e] of Object.entries(this.#eintraege)) if (e.nr <= nr) delete this.#eintraege[k];
    this.#pufferSichern();
    this.#zustandNeu();
    if (!this.#offen && this.#vorschauQuelle) this.vorschau(this.#vorschauQuelle);
  }

  // ---- Verbindung

  #verbinden(sofort) {
    if (this.#aus || this.#ws) return;
    clearTimeout(this.#uhren.neu);
    let ws;
    try {
      ws = new WebSocket(api.liveUrl(this.id));
    } catch {
      this.#spaeter(sofort);
      return;
    }
    this.#ws = ws;
    ws.addEventListener('message', (e) => this.#nachricht(e.data));
    ws.addEventListener('close', (e) => {
      this.#ws = null;
      this.#verbunden = false;
      this.#gescheitert = true;
      clearInterval(this.#uhren.ping);
      this.#zustandNeu();
      if (this.#aus) return;
      // Zugriff entzogen (Freigabe entfernt, Board geloescht): nicht mehr
      // versuchen, und was noch im Puffer liegt, darf nicht mehr hin
      if (e.code === 4403) {
        this.#eintraege = {};
        this.#pufferSichern();
        this.rueck.beiAusgesperrt?.();
        return;
      }
      // Board noch nicht auf dem Server (offline angelegt): erst anlegen
      if (e.code === 4404) ausstehendeSenden().finally(() => this.#spaeter());
      else this.#spaeter();
    });
  }

  #spaeter(sofort) {
    if (this.#aus) return;
    const ms = sofort ? 0 : WARTEN_MS[Math.min(this.#versuch++, WARTEN_MS.length - 1)];
    clearTimeout(this.#uhren.neu);
    this.#uhren.neu = setTimeout(() => this.#verbinden(), ms);
  }

  #nachricht(text) {
    let n;
    try {
      n = JSON.parse(text);
    } catch {
      return;
    }
    if (n.t === 'stand') {
      this.#verbunden = true;
      this.#gescheitert = false;
      this.#versuch = 0;
      // Stand vom Server plus eigener Puffer obendrauf
      const zusammen = opsAufListe(n.elemente, this.#eintraege);
      this.dok.abgleichen(zusammen.elemente, zusammen.hintergrund ?? n.hintergrund);
      if (n.titel) this.beiMeta?.({ titel: n.titel });
      this.#gesendetBis = 0;
      this.#senden();
      clearInterval(this.#uhren.ping);
      this.#uhren.ping = setInterval(() => this.#ws?.send('{"t":"ping"}'), PING_MS);
      this.#zustandNeu();
    } else if (n.t === 'ich') {
      this.ich = { verbindung: n.verbindung, farbe: n.farbe, recht: n.recht };
      this.rueck.beiIch?.(this.ich);
      // Nur ansehen: was hier trotzdem entstanden ist, kommt nie an
      if (n.recht === 'ansehen' && this.#offen) {
        this.#eintraege = {};
        this.#pufferSichern();
        this.#zustandNeu();
      } else {
        this.#senden();
      }
    } else if (n.t === 'anwesend') {
      this.personen = n.personen;
      this.rueck.beiAnwesenheit?.(n.personen);
    } else if (n.t === 'entwurf') {
      this.rueck.beiEntwurf?.(n.von, n.el, this.personen.find((p) => p.verbindung === n.von));
    } else if (n.t === 'ack') {
      this.#bestaetigt(n.nr);
    } else if (n.t === 'ops') {
      const ops = n.ops.filter((op) => !this.#eintraege[schluessel(op)]);
      if (ops.length) this.dok.fremdAnwenden(ops);
    } else if (n.t === 'meta') {
      if (n.titel) this.beiMeta?.({ titel: n.titel });
      if (n.hintergrund && !this.#eintraege['#hintergrund']) {
        this.dok.fremdAnwenden([{ art: 'hintergrund', wert: n.hintergrund }]);
      }
    } else if (n.t === 'fehler') {
      // Der Server lehnt eine Sendung ab: nicht endlos wiederholen
      console.warn('Live-Abgleich:', n.text);
      if (n.nr) this.#bestaetigt(n.nr);
    }
  }
}
