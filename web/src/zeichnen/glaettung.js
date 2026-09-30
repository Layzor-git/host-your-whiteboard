// Aus den rohen Stiftpunkten wird ein ruhiger Strich. Drei Stufen, jede mit
// eigenem Regler im Labor:
//
// 1. Stabilisierung ("Seil"): Der Strich haengt an einem kurzen Seil hinter
//    der Stiftspitze. Zittern innerhalb der Seillaenge kommt gar nicht erst
//    an, Ecken werden weicher. Unabhaengig davon, wie oft das Geraet Punkte
//    meldet, darum verhaelt sich Wacom mit 200 Hz wie das iPad mit 240 Hz.
// 2. Glaettung: Die Punkte werden in gleichmaessigen Abstaenden neu
//    abgetastet und mit einem Gauss-Fenster gemittelt. An den Enden
//    schrumpft das Fenster, damit Anfang und Ende genau dort bleiben, wo
//    der Stift war. Ein Punkt ist "fest", sobald genug Nachfolger da sind,
//    darum wird waehrend des Zeichnens nur das Ende neu gerechnet.
// 3. Vereinfachung: Beim Loslassen fliegen alle Punkte raus, die fuer die
//    Form nicht noetig sind. Gezeichnet wird spaeter ein Spline durch die
//    uebrigen Punkte, der Strich sieht also gleich aus, braucht aber einen
//    Bruchteil des Speichers.
//
// Alle Laengen sind in Bildschirmpixeln gedacht und werden durch den Zoom
// geteilt. So fuehlt sich der Stift bei jeder Zoomstufe gleich an.

import { rdp, runden } from './geometrie.js';

export const GLAETTUNG_STANDARD = { stabilisierung: 0.35, glaettung: 0.5, vereinfachung: 0.4 };

const PROBE_PX = 1.5;
const SEIL_MAX_PX = 10;
const SIGMA_MAX_PX = 8;
const EPS_MIN_PX = 0.1;
const EPS_MAX_PX = 1.2;

export class StrichBauer {
  constructor(einst, zoom) {
    this.abstand = PROBE_PX / zoom;
    this.seil = (einst.stabilisierung * SEIL_MAX_PX) / zoom;
    this.eps = (EPS_MIN_PX + einst.vereinfachung * (EPS_MAX_PX - EPS_MIN_PX)) / zoom;

    const sigma = (einst.glaettung * SIGMA_MAX_PX) / PROBE_PX;
    this.K = sigma < 0.05 ? 0 : Math.ceil(sigma * 3);
    this.gewichte = [];
    for (let k = 0; k <= this.K; k++) {
      this.gewichte.push(this.K ? Math.exp(-(k * k) / (2 * sigma * sigma)) : 1);
    }

    this.roh = [];     // x, y, druck wie vom Geraet
    this.proben = [];  // gleichmaessig abgetastet
    this.glatt = [];   // geglaettet, das wird gezeichnet
    this.fest = 0;     // so viele Punkte von glatt aendern sich nicht mehr
    this.spitze = null;
    this.rest = 0;
  }

  hinzu(x, y, p) {
    this.roh.push(x, y, p);
    if (!this.spitze) {
      this.spitze = { x, y, p };
      this.proben.push(x, y, p);
      this.#nachglaetten();
      return;
    }
    const s = this.spitze;
    const dx = x - s.x;
    const dy = y - s.y;
    const d = Math.hypot(dx, dy);
    if (d <= this.seil) return;
    const f = (d - this.seil) / d;
    this.#ziehen(s.x + dx * f, s.y + dy * f, p);
    this.#nachglaetten();
  }

  /** Beim Loslassen holt der Strich die Stiftspitze ein. */
  beenden() {
    const n = this.roh.length;
    if (n >= 3) this.#ziehen(this.roh[n - 3], this.roh[n - 2], this.roh[n - 1]);
    const s = this.spitze;
    if (s && this.proben.length > 3 && this.rest > this.abstand * 0.25) {
      this.proben.push(s.x, s.y, s.p);
    }
    this.#nachglaetten();
  }

  /** Vereinfachte Punkte fuer das Speichern. */
  ergebnis() {
    const G = this.glatt;
    const n = G.length / 3;
    const xy = new Array(n * 2);
    for (let i = 0; i < n; i++) {
      xy[i * 2] = G[i * 3];
      xy[i * 2 + 1] = G[i * 3 + 1];
    }
    const behalten = rdp(xy, this.eps);
    const punkte = [];
    const druck = [];
    for (let i = 0; i < n; i++) {
      if (!behalten[i]) continue;
      punkte.push(runden(xy[i * 2]), runden(xy[i * 2 + 1]));
      druck.push(Math.round(G[i * 3 + 2] * 100) / 100);
    }
    return { punkte, druck };
  }

  #ziehen(x, y, p) {
    const s = this.spitze;
    const L = Math.hypot(x - s.x, y - s.y);
    if (L === 0) return;
    let pos = this.abstand - this.rest;
    while (pos <= L) {
      const t = pos / L;
      this.proben.push(s.x + (x - s.x) * t, s.y + (y - s.y) * t, s.p + (p - s.p) * t);
      pos += this.abstand;
    }
    this.rest = L - (pos - this.abstand);
    this.spitze = { x, y, p };
  }

  #nachglaetten() {
    const P = this.proben;
    const n = P.length / 3;
    const K = this.K;
    const w = this.gewichte;
    this.glatt.length = this.fest * 3;
    for (let i = this.fest; i < n; i++) {
      const h = Math.min(K, i, n - 1 - i);
      let sx = 0, sy = 0, sp = 0, sw = 0;
      for (let j = -h; j <= h; j++) {
        const g = w[j < 0 ? -j : j];
        const b = (i + j) * 3;
        sx += P[b] * g;
        sy += P[b + 1] * g;
        sp += P[b + 2] * g;
        sw += g;
      }
      this.glatt.push(sx / sw, sy / sw, sp / sw);
      // Das Fenster dieses Punkts waechst nicht mehr, wenn es nicht vom
      // Ende begrenzt wird. Dann ist er fertig.
      if (i === this.fest && n - 1 - i >= Math.min(K, i)) this.fest++;
    }
  }
}
