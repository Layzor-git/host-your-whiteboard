// One gesture from "pen down" to "pen up". Every action knows:
//
//   bewegen(ereignisse, letztes)  ereignisse = all intermediate points
//   vorschau(ctx)                 paints on the top layer, world coordinates
//   ende()                        result into the document
//   abbrechen()                   discard (e.g. a second finger joins)

import { StrichBauer } from './glaettung.js';
import {
  grenzen, imLasso, markerDeckkraft, neueId, punktRadieren, transformieren, trifft,
  umrissPfad, zeichnen,
} from './elemente.js';
import { farbeAufloesen } from './farben.js';
import { runden, ueberlappen } from './geometrie.js';

export const WINKEL_RASTER = Math.PI / 12; // 15 degrees
/** Hit radius of the stroke eraser in screen pixels. */
export const STRICH_RADIERER_PX = 7;

/** Ctrl (Mac: Cmd) snaps angles: straight lines, line tool, rotation. */
function rastet(e) {
  return e.ctrlKey || e.metaKey;
}

function frei(sx, sy, x, y) {
  return { x, y, winkel: Math.atan2(y - sy, x - sx) };
}

function einrasten(sx, sy, x, y) {
  const a = Math.round(Math.atan2(y - sy, x - sx) / WINKEL_RASTER) * WINKEL_RASTER;
  const l = Math.hypot(x - sx, y - sy);
  return { x: sx + Math.cos(a) * l, y: sy + Math.sin(a) * l, winkel: a };
}

// -------------------------------------------------------------------- Pen

export class StiftAktion {
  constructor(ed, e) {
    this.ed = ed;
    const stil = ed.stile.stift;
    this.textmarker = !!stil.textmarker;
    this.farbe = stil.farbe;
    this.breite = stil.breite;
    this.mitDruck = !this.textmarker && ed.einst.druck && e.pointerType === 'pen';
    this.bauer = new StrichBauer(ed.einst, ed.kamera.z);
    this.start = ed.welt(e);
    this.gerade = null;
    // The preview lives on its own layer. So that the highlighter blends
    // with the ink below it while drawing just as it will later, the
    // browser does the blending of the two layers.
    if (this.textmarker) {
      ed.renderer.oben.style.mixBlendMode = ed.renderer.dunkel ? 'screen' : 'multiply';
    }
    this.#punkt(e);
  }

  #punkt(e) {
    const w = this.ed.welt(e);
    // Some tablets still report pressure 0 on touchdown.
    const p = this.mitDruck ? Math.max(0.05, e.pressure || 0.5) : 0.5;
    this.bauer.hinzu(w.x, w.y, p);
  }

  bewegen(liste, letztes) {
    for (const e of liste) this.#punkt(e);
    // Shift (even in the middle of a stroke) turns it into a straight line
    // from the start to the pen, at any angle. Adding Ctrl snaps it in
    // 15-degree steps.
    if (letztes.shiftKey) {
      const w = this.ed.welt(letztes);
      this.eingerastet = rastet(letztes);
      this.gerade = (this.eingerastet ? einrasten : frei)(this.start.x, this.start.y, w.x, w.y);
    }
  }

  /** The stroke as it looks right now, for other devices (live). */
  get entwurf() {
    const el = { id: 'entwurf', typ: 'strich', z: 0, farbe: this.farbe, breite: this.breite, druck: null };
    if (this.textmarker) el.textmarker = true;
    if (this.gerade) {
      el.punkte = [runden(this.start.x), runden(this.start.y), runden(this.gerade.x), runden(this.gerade.y)];
      return el;
    }
    // Every second smoothed point, rounded to 0.1: looks the same and
    // keeps the messages small
    const G = this.bauer.glatt;
    const n = G.length / 3;
    const punkte = [];
    const druck = [];
    for (let i = 0; i < n; i++) {
      if (i % 2 && i !== n - 1) continue;
      punkte.push(Math.round(G[i * 3] * 10) / 10, Math.round(G[i * 3 + 1] * 10) / 10);
      druck.push(Math.round(G[i * 3 + 2] * 100) / 100);
    }
    el.punkte = punkte;
    if (this.mitDruck) el.druck = druck;
    return el;
  }

  /** For the "snapped to 45°" hint in the UI. */
  get hilfslinie() {
    if (!this.gerade) return null;
    let grad = Math.round((-this.gerade.winkel * 180) / Math.PI);
    if (grad < 0) grad += 360;
    return { start: this.start, ende: this.gerade, grad, eingerastet: !!this.eingerastet };
  }

  vorschau(ctx) {
    const dunkel = this.ed.renderer.dunkel;
    const farbe = farbeAufloesen(this.farbe, dunkel);
    ctx.globalAlpha = this.textmarker ? markerDeckkraft(this.farbe) : 1;
    ctx.strokeStyle = farbe;
    ctx.fillStyle = farbe;
    ctx.lineWidth = this.breite;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (this.gerade) {
      ctx.beginPath();
      ctx.moveTo(this.start.x, this.start.y);
      ctx.lineTo(this.gerade.x, this.gerade.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      this.#hilfslinien(ctx);
      return;
    }
    const G = this.bauer.glatt;
    if (this.mitDruck) {
      ctx.fill(umrissPfad(G, this.breite));
    } else if (G.length === 3) {
      ctx.beginPath();
      ctx.arc(G[0], G[1], this.breite / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(G[0], G[1]);
      for (let i = 3; i < G.length; i += 3) ctx.lineTo(G[i], G[i + 1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Horizontal reference line, angle arc and end point as in the design (2f).
  #hilfslinien(ctx) {
    const z = this.ed.kamera.z;
    const { x: sx, y: sy } = this.start;
    const { x: ex, y: ey, winkel } = this.gerade;
    const l = Math.hypot(ex - sx, ey - sy);
    ctx.save();
    ctx.strokeStyle = this.ed.akzent();
    ctx.lineWidth = 1.5 / z;
    ctx.setLineDash([4 / z, 5 / z]);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.max(l, 150 / z), sy);
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex + Math.cos(winkel) * (60 / z), ey + Math.sin(winkel) * (60 / z));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(sx, sy, 50 / z, 0, winkel, winkel < 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex, ey, 5 / z, 0, Math.PI * 2);
    ctx.fillStyle = this.ed.flaeche();
    ctx.fill();
    ctx.lineWidth = 2 / z;
    ctx.stroke();
    ctx.restore();
  }

  ende() {
    const dok = this.ed.dok;
    let punkte;
    let druck = null;
    if (this.gerade) {
      punkte = [runden(this.start.x), runden(this.start.y), runden(this.gerade.x), runden(this.gerade.y)];
    } else {
      this.bauer.beenden();
      ({ punkte, druck } = this.bauer.ergebnis());
    }
    const el = {
      id: neueId(),
      typ: 'strich',
      z: dok.naechstesZ(),
      farbe: this.farbe,
      breite: this.breite,
      punkte,
      druck: this.mitDruck && !this.gerade ? druck : null,
    };
    if (this.textmarker) el.textmarker = true;
    if (this.ed.einst.rohMerken) el._roh = this.bauer.roh;
    const tx = dok.transaktion();
    tx.hinzufuegen(el);
    tx.abschliessen();
    this.ed.letzterStrich = { roh: this.bauer.roh.length / 3, gespeichert: punkte.length / 2 };
  }

  abbrechen() {}
}

// ------------------------------------------------------------------ Shapes

export class FormAktion {
  constructor(ed, e) {
    this.ed = ed;
    this.stil = { ...ed.stile.form };
    this.start = ed.welt(e);
    this.ziel = this.start;
  }

  bewegen(liste, letztes) {
    const w = this.ed.welt(letztes);
    const { x: sx, y: sy } = this.start;
    if (this.stil.art === 'linie' || this.stil.art === 'pfeil') {
      // Line and arrow are already straight; Ctrl snaps the angle
      this.ziel = rastet(letztes) ? einrasten(sx, sy, w.x, w.y) : w;
    } else if (!letztes.shiftKey) {
      this.ziel = w;
    } else {
      // Square, circle, triangle as wide as it is high
      const d = Math.max(Math.abs(w.x - sx), Math.abs(w.y - sy));
      this.ziel = { x: sx + Math.sign(w.x - sx || 1) * d, y: sy + Math.sign(w.y - sy || 1) * d };
    }
  }

  #element() {
    const el = {
      id: neueId(),
      typ: 'form',
      form: this.stil.art,
      x1: runden(this.start.x), y1: runden(this.start.y),
      x2: runden(this.ziel.x), y2: runden(this.ziel.y),
      farbe: this.stil.farbe,
      breite: this.stil.breite,
    };
    if (this.stil.fuellung && this.stil.art !== 'linie' && this.stil.art !== 'pfeil') {
      el.fuellung = this.stil.fuellung;
    }
    return el;
  }

  vorschau(ctx) {
    zeichnen(ctx, this.#element(), this.ed.renderer.dunkel);
  }

  get entwurf() {
    return { ...this.#element(), id: 'entwurf', z: 0 };
  }

  ende() {
    const px = Math.hypot(this.ziel.x - this.start.x, this.ziel.y - this.start.y) * this.ed.kamera.z;
    if (px < 3) return;
    const el = this.#element();
    el.z = this.ed.dok.naechstesZ();
    const tx = this.ed.dok.transaktion();
    tx.hinzufuegen(el);
    tx.abschliessen();
    this.ed.auswahlSetzen([el.id]);
  }

  abbrechen() {}
}

// ------------------------------------------------------------------ Eraser

export class RadiererAktion {
  constructor(ed, e) {
    this.ed = ed;
    this.modus = ed.stile.radierer.modus;
    this.tx = ed.dok.transaktion();
    this.letzt = ed.welt(e);
    this.#radieren(this.letzt, this.letzt);
  }

  bewegen(liste) {
    for (const e of liste) {
      const w = this.ed.welt(e);
      this.#radieren(this.letzt, w);
      this.letzt = w;
    }
  }

  #radieren(a, b) {
    const dok = this.ed.dok;
    const r = this.ed.radiererRadius();
    const g = {
      x1: Math.min(a.x, b.x) - r, y1: Math.min(a.y, b.y) - r,
      x2: Math.max(a.x, b.x) + r, y2: Math.max(a.y, b.y) + r,
    };
    for (const id of dok.finden(g)) {
      const el = dok.get(id);
      if (!el || !ueberlappen(grenzen(el), g)) continue;
      if (this.modus === 'punkt') {
        const stuecke = punktRadieren(el, a.x, a.y, b.x, b.y, r);
        if (!stuecke) continue;
        this.tx.entfernen(id);
        // The pieces inherit the layer of the original. Equal z is
        // allowed, they do not overlap after all.
        for (const s of stuecke) {
          s.z = el.z;
          this.tx.hinzufuegen(s);
        }
      } else if (el.typ !== 'bild' && trifft(el, a.x, a.y, b.x, b.y, r)) {
        this.tx.entfernen(id);
      }
    }
  }

  vorschau() {}

  ende() {
    this.tx.abschliessen();
  }

  abbrechen() {
    this.tx.abschliessen();
  }
}

// -------------------------------------------------------------------- Hand

export class HandAktion {
  constructor(ed, e) {
    this.ed = ed;
    this.x = e.clientX;
    this.y = e.clientY;
  }

  bewegen(liste, letztes) {
    this.ed.kamera.verschieben(letztes.clientX - this.x, letztes.clientY - this.y);
    this.x = letztes.clientX;
    this.y = letztes.clientY;
    this.ed.kameraGeaendert();
  }

  vorschau() {}
  ende() {}
  abbrechen() {}
}

// ------------------------------------------------------------------- Lasso

/**
 * Drag a selection: as a rectangle or as a freehand lasso (art). With
 * Shift the new items are added to the existing selection; a tap with
 * Shift adds or removes a single element. The pointer uses the rectangle
 * when dragging on an empty area.
 */
export class LassoAktion {
  constructor(ed, e, art = ed.stile.auswahl?.art) {
    this.ed = ed;
    this.rechteck = art !== 'lasso';
    this.dazu = e.shiftKey;
    const w = ed.welt(e);
    this.start = w;
    this.ziel = w;
    this.poly = [w.x, w.y];
    this.startSchirm = { x: e.clientX, y: e.clientY };
    this.weit = false;
  }

  bewegen(liste, letztes) {
    for (const e of liste) {
      const w = this.ed.welt(e);
      if (this.rechteck) this.ziel = w;
      else this.poly.push(w.x, w.y);
      if (Math.hypot(e.clientX - this.startSchirm.x, e.clientY - this.startSchirm.y) > 6) this.weit = true;
    }
    if (letztes.shiftKey) this.dazu = true;
  }

  /** Outline of the selection in world coordinates */
  get #umriss() {
    if (!this.rechteck) return this.poly;
    const { x: x1, y: y1 } = this.start;
    const { x: x2, y: y2 } = this.ziel;
    return [x1, y1, x2, y1, x2, y2, x1, y2];
  }

  vorschau(ctx) {
    const z = this.ed.kamera.z;
    const P = this.#umriss;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(P[0], P[1]);
    for (let i = 2; i < P.length; i += 2) ctx.lineTo(P[i], P[i + 1]);
    ctx.closePath();
    ctx.fillStyle = this.ed.akzent(0.06);
    ctx.fill();
    ctx.strokeStyle = this.ed.akzent();
    ctx.lineWidth = 1.5 / z;
    ctx.setLineDash([5 / z, 5 / z]);
    ctx.stroke();
    ctx.restore();
  }

  ende() {
    const dok = this.ed.dok;
    const bisher = this.dazu ? [...this.ed.auswahl] : [];
    // Just tapped instead of dragged: the topmost element under the pen
    if (!this.weit) {
      const { x, y } = this.start;
      const oben = this.ed.elementBei(x, y);
      if (!oben) {
        if (!this.dazu) this.ed.auswahlSetzen([]);
        return;
      }
      if (this.dazu && this.ed.auswahl.has(oben.id)) {
        this.ed.auswahlSetzen(bisher.filter((id) => id !== oben.id));
      } else {
        this.ed.auswahlSetzen([...bisher, oben.id]);
      }
      return;
    }
    const P = this.#umriss;
    let g = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    for (let i = 0; i < P.length; i += 2) {
      g = {
        x1: Math.min(g.x1, P[i]), y1: Math.min(g.y1, P[i + 1]),
        x2: Math.max(g.x2, P[i]), y2: Math.max(g.y2, P[i + 1]),
      };
    }
    const ids = [];
    for (const id of dok.finden(g)) {
      const el = dok.get(id);
      if (el && ueberlappen(grenzen(el), g) && imLasso(el, P)) ids.push(id);
    }
    this.ed.auswahlSetzen([...new Set([...bisher, ...ids])]);
  }

  abbrechen() {}
}

// --------------------------------------------------- Transform selection

/**
 * Move, scale or rotate the selection. During the gesture the elements
 * stay unchanged in the document but are hidden; the top layer shows them
 * with the current transform. Only on release are the new elements
 * created, in one transaction.
 *
 * griff: 'mitte' (move), 'drehen' or a compass direction
 * n, ne, e, se, s, sw, w, nw for the handles.
 */
export class TransformAktion {
  constructor(ed, e, griff) {
    this.ed = ed;
    this.griff = griff;
    this.ids = [...ed.auswahl];
    this.elemente = this.ids.map((id) => ed.dok.get(id)).filter(Boolean);
    this.g = ed.auswahlGrenzen();
    this.start = ed.welt(e);
    this.M = [1, 0, 0, 1, 0, 0];
    this.winkel = 0;
    ed.renderer.ausgeblendet = new Set(this.ids);
    ed.renderer.ganz();
  }

  bewegen(liste, letztes) {
    const w = this.ed.welt(letztes);
    const { g } = this;
    const dx = w.x - this.start.x;
    const dy = w.y - this.start.y;
    if (this.griff === 'mitte') {
      this.M = [1, 0, 0, 1, dx, dy];
      return;
    }
    const cx = (g.x1 + g.x2) / 2;
    const cy = (g.y1 + g.y2) / 2;
    if (this.griff === 'drehen') {
      let a = Math.atan2(w.y - cy, w.x - cx) - Math.atan2(this.start.y - cy, this.start.x - cx);
      if (rastet(letztes)) a = Math.round(a / WINKEL_RASTER) * WINKEL_RASTER;
      this.winkel = a;
      const c = Math.cos(a);
      const s = Math.sin(a);
      this.M = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
      return;
    }
    // Scale around the opposite side/corner
    const h = this.griff;
    const breite = Math.max(g.x2 - g.x1, 1e-6);
    const hoehe = Math.max(g.y2 - g.y1, 1e-6);
    const ax = h.includes('w') ? g.x2 : h.includes('e') ? g.x1 : cx;
    const ay = h.includes('n') ? g.y2 : h.includes('s') ? g.y1 : cy;
    let sx = h.includes('e') ? (g.x2 + dx - g.x1) / breite : h.includes('w') ? (g.x2 - (g.x1 + dx)) / breite : 1;
    let sy = h.includes('s') ? (g.y2 + dy - g.y1) / hoehe : h.includes('n') ? (g.y2 - (g.y1 + dy)) / hoehe : 1;
    // Corners scale uniformly, so handwriting is not distorted.
    // Shift on a corner allows free distortion.
    if (h.length === 2 && !letztes.shiftKey) {
      const f = Math.abs(sx) > Math.abs(sy) ? sx : sy;
      sx = f;
      sy = f;
    }
    const min = 4 / Math.max(breite, hoehe);
    if (Math.abs(sx) < min) sx = Math.sign(sx || 1) * min;
    if (Math.abs(sy) < min) sy = Math.sign(sy || 1) * min;
    this.M = [sx, 0, 0, sy, ax - sx * ax, ay - sy * ay];
  }

  /** Frame for the UI: original bounds plus transform. */
  get rahmen() {
    return { g: this.g, M: this.M, winkel: this.winkel, griff: this.griff };
  }

  vorschau(ctx) {
    const [a, b, c, d, e, f] = this.M;
    const dunkel = this.ed.renderer.dunkel;
    ctx.save();
    ctx.transform(a, b, c, d, e, f);
    for (const el of this.elemente) {
      if (el.textmarker) ctx.globalCompositeOperation = dunkel ? 'screen' : 'multiply';
      zeichnen(ctx, el, dunkel);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  ende() {
    this.ed.renderer.ausgeblendet = null;
    const [a, b, c, d, e, f] = this.M;
    if (a === 1 && b === 0 && c === 0 && d === 1 && Math.abs(e) < 1e-9 && Math.abs(f) < 1e-9) {
      this.ed.renderer.ganz();
      return;
    }
    const tx = this.ed.dok.transaktion();
    const neueIds = [];
    for (const el of this.elemente) {
      const neu = transformieren(el, this.M);
      if (Array.isArray(neu)) {
        tx.entfernen(el.id);
        for (const s of neu) {
          tx.hinzufuegen(s);
          neueIds.push(s.id);
        }
      } else {
        tx.ersetzen(neu);
        neueIds.push(neu.id);
      }
    }
    tx.abschliessen();
    this.ed.auswahlSetzen(neueIds);
  }

  abbrechen() {
    this.ed.renderer.ausgeblendet = null;
    this.ed.renderer.ganz();
  }
}

// ---------------------------------------------------------- Move line end

/**
 * Drag one end of a line or arrow (ende 1 = x1/y1, 2 = x2/y2), the other
 * stays put. Ctrl snaps the angle in 15° steps, Shift keeps the direction
 * and only changes the length.
 */
export class EndpunktAktion {
  constructor(ed, e, seite) {
    this.ed = ed;
    this.seite = seite;
    this.original = ed.dok.get([...ed.auswahl][0]);
    this.element = this.original;
    this.eingerastet = false;
    ed.renderer.ausgeblendet = new Set([this.original.id]);
    ed.renderer.ganz();
  }

  /** The fixed end */
  get #fest() {
    const o = this.original;
    return this.seite === 1 ? { x: o.x2, y: o.y2 } : { x: o.x1, y: o.y1 };
  }

  bewegen(liste, letztes) {
    const w = this.ed.welt(letztes);
    const f = this.#fest;
    let p = frei(f.x, f.y, w.x, w.y);
    this.eingerastet = false;
    if (letztes.shiftKey) {
      // Only lengthen or shorten: project onto the previous direction
      const o = this.original;
      const bewegt = this.seite === 1 ? { x: o.x1, y: o.y1 } : { x: o.x2, y: o.y2 };
      const a = Math.atan2(bewegt.y - f.y, bewegt.x - f.x);
      const l = Math.max(1, (w.x - f.x) * Math.cos(a) + (w.y - f.y) * Math.sin(a));
      p = { x: f.x + Math.cos(a) * l, y: f.y + Math.sin(a) * l, winkel: a };
    } else if (rastet(letztes)) {
      p = einrasten(f.x, f.y, w.x, w.y);
      this.eingerastet = true;
    }
    this.punkt = p;
    const x = runden(p.x);
    const y = runden(p.y);
    this.element = this.seite === 1 ? { ...this.original, x1: x, y1: y } : { ...this.original, x2: x, y2: y };
  }

  get hilfslinie() {
    if (!this.punkt) return null;
    let grad = Math.round((-this.punkt.winkel * 180) / Math.PI);
    if (grad < 0) grad += 360;
    return { start: this.punkt, grad, eingerastet: this.eingerastet };
  }

  vorschau(ctx) {
    zeichnen(ctx, this.element, this.ed.renderer.dunkel);
  }

  ende() {
    this.ed.renderer.ausgeblendet = null;
    if (this.element === this.original) {
      this.ed.renderer.ganz();
      return;
    }
    const tx = this.ed.dok.transaktion();
    tx.ersetzen(this.element);
    tx.abschliessen();
    this.ed.auswahlSetzen([this.element.id]);
  }

  abbrechen() {
    this.ed.renderer.ausgeblendet = null;
    this.ed.renderer.ganz();
  }
}
