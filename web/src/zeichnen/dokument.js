// Der Inhalt eines Boards: alle Elemente nach z sortiert, ein Raster zum
// schnellen Finden und der Verlauf fuer Rueckgaengig/Wiederholen.
//
// Geaendert wird nur ueber eine Transaktion. Sie fasst alles zusammen, was
// eine Geste bewirkt, damit ein Strg+Z genau eine Geste zuruecknimmt, auch
// wenn der Radierer dabei zwanzig Striche zerlegt hat.

import { grenzen } from './elemente.js';

const ZELLE = 256;
const MAX_ZELLEN = 256;
const MAX_VERLAUF = 500;

/** Gleichmaessiges Raster: welche Elemente liegen ungefaehr wo. */
class Raster {
  zellen = new Map();
  gross = new Set();

  #bereich(g) {
    const x1 = Math.floor(g.x1 / ZELLE), y1 = Math.floor(g.y1 / ZELLE);
    const x2 = Math.floor(g.x2 / ZELLE), y2 = Math.floor(g.y2 / ZELLE);
    return { x1, y1, x2, y2, anzahl: (x2 - x1 + 1) * (y2 - y1 + 1) };
  }

  einfuegen(id, g) {
    const b = this.#bereich(g);
    if (b.anzahl > MAX_ZELLEN) { this.gross.add(id); return; }
    for (let x = b.x1; x <= b.x2; x++) {
      for (let y = b.y1; y <= b.y2; y++) {
        const k = `${x},${y}`;
        let z = this.zellen.get(k);
        if (!z) this.zellen.set(k, (z = new Set()));
        z.add(id);
      }
    }
  }

  entfernen(id, g) {
    const b = this.#bereich(g);
    if (b.anzahl > MAX_ZELLEN) { this.gross.delete(id); return; }
    for (let x = b.x1; x <= b.x2; x++) {
      for (let y = b.y1; y <= b.y2; y++) {
        const k = `${x},${y}`;
        const z = this.zellen.get(k);
        if (!z) continue;
        z.delete(id);
        if (!z.size) this.zellen.delete(k);
      }
    }
  }

  abfrage(g) {
    const treffer = new Set(this.gross);
    const b = this.#bereich(g);
    if (b.anzahl > MAX_ZELLEN * 4) {
      for (const z of this.zellen.values()) for (const id of z) treffer.add(id);
      return treffer;
    }
    for (let x = b.x1; x <= b.x2; x++) {
      for (let y = b.y1; y <= b.y2; y++) {
        const z = this.zellen.get(`${x},${y}`);
        if (z) for (const id of z) treffer.add(id);
      }
    }
    return treffer;
  }
}

class Transaktion {
  hinzu = new Map();
  weg = new Map();

  constructor(dok) {
    this.dok = dok;
  }

  hinzufuegen(el) {
    this.hinzu.set(el.id, el);
    this.dok._einfuegen(el);
  }

  entfernen(id) {
    const el = this.dok.get(id);
    if (!el) return;
    // Was in derselben Geste erst entstanden ist, war vorher nie da.
    if (this.hinzu.has(id)) this.hinzu.delete(id);
    else if (!this.weg.has(id)) this.weg.set(id, el);
    this.dok._loeschen(id);
  }

  ersetzen(el) {
    this.entfernen(el.id);
    this.hinzufuegen(el);
  }

  get leer() {
    return !this.hinzu.size && !this.weg.size;
  }

  abschliessen() {
    this.dok._abschliessen(this);
  }
}

/** Felder mit Unterstrich sind Laufzeitkram und werden nie gespeichert. */
export function ohneLaufzeit(el) {
  const o = {};
  for (const k in el) if (k[0] !== '_') o[k] = el[k];
  return o;
}

export class Dokument {
  elemente = [];
  hintergrund = { farbe: 'white', muster: 'dots' };
  #nachId = new Map();
  #raster = new Raster();
  #rueck = [];
  #vor = [];
  #hoerer = new Set();

  /**
   * fn(ereignis), art:
   *   hinzu, weg     ein Element (waehrend einer Transaktion)
   *   verlauf        Transaktion abgeschlossen
   *   umbau          Rueckgaengig, Wiederholen, Hintergrund
   *   geladen        frisch geladen, nichts zu speichern
   *   fremd          Aenderung von einem anderen Geraet, nichts zu senden
   *   ops            { ops }: was sich geaendert hat, fuer den Live-Abgleich.
   *                  Kommt nur bei eigenen Aenderungen, nie bei fremden.
   */
  beiAenderung(fn) {
    this.#hoerer.add(fn);
    return () => this.#hoerer.delete(fn);
  }

  #melden(ereignis) {
    for (const h of this.#hoerer) h(ereignis);
  }

  get(id) {
    return this.#nachId.get(id);
  }

  get kannRueck() { return this.#rueck.length > 0; }
  get kannVor() { return this.#vor.length > 0; }

  naechstesZ() {
    const n = this.elemente.length;
    return n ? Math.floor(this.elemente[n - 1].z) + 1 : 0;
  }

  /** Ids aller Elemente, deren Rasterzellen g beruehren. Grob, danach genau pruefen. */
  finden(g) {
    return this.#raster.abfrage(g);
  }

  transaktion() {
    return new Transaktion(this);
  }

  rueckgaengig() {
    const tx = this.#rueck.pop();
    if (!tx) return;
    for (const id of tx.hinzu.keys()) this.#loeschen(id);
    for (const el of tx.weg.values()) this.#einfuegen(el);
    this.#vor.push(tx);
    this.#melden({ art: 'umbau' });
    this.#opsMelden(tx.weg, tx.hinzu);
  }

  wiederholen() {
    const tx = this.#vor.pop();
    if (!tx) return;
    for (const id of tx.weg.keys()) this.#loeschen(id);
    for (const el of tx.hinzu.values()) this.#einfuegen(el);
    this.#rueck.push(tx);
    this.#melden({ art: 'umbau' });
    this.#opsMelden(tx.hinzu, tx.weg);
  }

  /** Jetzt da: alles aus "da". Weg: was nur in "weg" steht. */
  #opsMelden(da, weg) {
    const ops = [];
    for (const id of weg.keys()) if (!da.has(id)) ops.push({ art: 'loeschen', id });
    for (const el of da.values()) ops.push({ art: 'setzen', el });
    if (ops.length) this.#melden({ art: 'ops', ops });
  }

  /**
   * Aenderungen von einem anderen Geraet uebernehmen. Sie landen nicht im
   * eigenen Verlauf: Strg+Z nimmt nur zurueck, was man selbst getan hat.
   */
  fremdAnwenden(ops) {
    for (const op of ops) {
      if (op.art === 'setzen') {
        this.#loeschen(op.el.id);
        this.#einfuegen(op.el);
      } else if (op.art === 'loeschen') {
        this.#loeschen(op.id);
      } else if (op.art === 'hintergrund') {
        this.hintergrund = { ...this.hintergrund, ...op.wert };
      }
    }
    this.#melden({ art: 'fremd' });
  }

  /**
   * Den eigenen Stand an einen vollstaendigen Stand vom Server angleichen,
   * ohne Verlauf und Ansicht wegzuwerfen. Nur was sich unterscheidet, wird
   * getauscht.
   */
  abgleichen(elemente, hintergrund) {
    const ops = [];
    const da = new Set();
    for (const el of elemente) {
      da.add(el.id);
      const alt = this.#nachId.get(el.id);
      if (!alt || JSON.stringify(ohneLaufzeit(alt)) !== JSON.stringify(el)) ops.push({ art: 'setzen', el });
    }
    for (const id of this.#nachId.keys()) if (!da.has(id)) ops.push({ art: 'loeschen', id });
    if (hintergrund && (hintergrund.farbe !== this.hintergrund.farbe || hintergrund.muster !== this.hintergrund.muster)) {
      ops.push({ art: 'hintergrund', wert: hintergrund });
    }
    if (ops.length) this.fremdAnwenden(ops);
  }

  /** Zum Speichern: nur Felder ohne Unterstrich, die sind Laufzeitkram. */
  alsDaten() {
    return {
      version: 1,
      hintergrund: this.hintergrund,
      elemente: this.elemente.map(ohneLaufzeit),
    };
  }

  laden(daten) {
    this.elemente = [];
    this.#nachId.clear();
    this.#raster = new Raster();
    this.#rueck = [];
    this.#vor = [];
    if (daten?.hintergrund) this.hintergrund = { ...this.hintergrund, ...daten.hintergrund };
    for (const el of daten?.elemente ?? []) this.#einfuegen(el);
    // Eigene Art: Frisch Geladenes ist keine Aenderung, die gespeichert
    // werden muesste.
    this.#melden({ art: 'geladen' });
  }

  hintergrundSetzen(teil) {
    this.hintergrund = { ...this.hintergrund, ...teil };
    this.#melden({ art: 'umbau' });
    this.#melden({ art: 'ops', ops: [{ art: 'hintergrund', wert: this.hintergrund }] });
  }

  // ---- nur fuer Transaktion

  _einfuegen(el) {
    this.#einfuegen(el);
    this.#melden({ art: 'hinzu', el });
  }

  _loeschen(id) {
    const el = this.#loeschen(id);
    if (el) this.#melden({ art: 'weg', el });
  }

  _abschliessen(tx) {
    if (tx.leer) return;
    this.#rueck.push(tx);
    if (this.#rueck.length > MAX_VERLAUF) this.#rueck.shift();
    this.#vor.length = 0;
    this.#melden({ art: 'verlauf' });
    this.#opsMelden(tx.hinzu, tx.weg);
  }

  // ---- intern

  #erstesUeber(z) {
    let lo = 0;
    let hi = this.elemente.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.elemente[m].z <= z) lo = m + 1;
      else hi = m;
    }
    return lo;
  }

  #einfuegen(el) {
    // Nie zweimal dieselbe id, auch wenn ein anderes Geraet dazwischenfunkt
    if (this.#nachId.has(el.id)) this.#loeschen(el.id);
    this.elemente.splice(this.#erstesUeber(el.z), 0, el);
    this.#nachId.set(el.id, el);
    this.#raster.einfuegen(el.id, grenzen(el));
  }

  #loeschen(id) {
    const el = this.#nachId.get(id);
    if (!el) return null;
    let i = this.#erstesUeber(el.z) - 1;
    while (i >= 0 && this.elemente[i] !== el) i--;
    // Ohne gueltiges z (fremde oder alte Daten) greift die Suche nicht
    if (i < 0) i = this.elemente.indexOf(el);
    if (i >= 0) this.elemente.splice(i, 1);
    this.#nachId.delete(id);
    this.#raster.entfernen(id, grenzen(el));
    return el;
  }
}
