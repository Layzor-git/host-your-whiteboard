// Raw pen points become a calm stroke. Three stages, each with its own
// slider in the lab:
//
// 1. Stabilization ("rope"): the stroke hangs on a short rope behind the
//    pen tip. Jitter within the rope length never arrives, corners get
//    softer. Independent of how often the device reports points, which is
//    why Wacom at 200 Hz behaves like the iPad at 240 Hz.
// 2. Smoothing: the points are resampled at even distances and averaged
//    with a Gaussian window. At the ends the window shrinks, so start and
//    end stay exactly where the pen was. A point is "fixed" as soon as
//    enough successors exist, which is why only the end is recomputed
//    while drawing.
// 3. Simplification: on release, all points not needed for the shape are
//    dropped. Later a spline is drawn through the remaining points, so the
//    stroke looks the same but needs a fraction of the storage.
//
// All lengths are meant in screen pixels and are divided by the zoom.
// That way the pen feels the same at every zoom level.

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

    this.roh = [];     // x, y, druck as reported by the device
    this.proben = [];  // evenly resampled
    this.glatt = [];   // smoothed, this is what gets drawn
    this.fest = 0;     // this many points of glatt no longer change
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

  /** On release the stroke catches up with the pen tip. */
  beenden() {
    const n = this.roh.length;
    if (n >= 3) this.#ziehen(this.roh[n - 3], this.roh[n - 2], this.roh[n - 1]);
    const s = this.spitze;
    if (s && this.proben.length > 3 && this.rest > this.abstand * 0.25) {
      this.proben.push(s.x, s.y, s.p);
    }
    this.#nachglaetten();
  }

  /** Simplified points for saving. */
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
      // This point's window no longer grows if it is not limited by the
      // end. Then it is done.
      if (i === this.fest && n - 1 - i >= Math.min(K, i)) this.fest++;
    }
  }
}
