// Holds everything together: document, camera, renderer and input. Knows
// nothing about React. The UI talks to it only through the public methods
// and beiZustand(), which keeps the drawing loop free of React render
// passes.
//
// Input:
//   Pen              draws with the active tool. Eraser end or side button
//                    erase while they are pressed.
//   Left mouse       active tool, middle = pan
//   Finger           pan, two fingers = zoom (or draw, when "Finger draws"
//                    is on). While the pen is down, fingers are ignored;
//                    that is the palm rejection.
//   Wheel            pan, zoom with Ctrl (also touchpad pinch)
//
// Tools: stift (color, width, textmarker from stile.stift), radierer,
// form, lasso, hand. Which pen slots exist only the UI knows.

import { Dokument } from './dokument.js';
import { enthaelt, grenzen, neueId, transformieren, trifft } from './elemente.js';
import { markerAlsTinte, markerFarbeZu } from './farben.js';
import { vereinigt } from './geometrie.js';
import { GLAETTUNG_STANDARD } from './glaettung.js';
import { Kamera, ZOOM_MAX, ZOOM_MIN } from './kamera.js';
import { Renderer } from './renderer.js';
import {
  EndpunktAktion, FormAktion, HandAktion, LassoAktion, RadiererAktion, STRICH_RADIERER_PX,
  StiftAktion, TransformAktion,
} from './werkzeuge.js';

export const WERKZEUGE = ['stift', 'radierer', 'form', 'lasso', 'hand'];
export const ZOOM_STUFEN = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** Smoothing 0..100 from the settings mapped to the engine's three levels. */
export function glaettungAusRegler(wert) {
  const s = Math.min(100, Math.max(0, wert)) / 100;
  return { stabilisierung: 0.7 * s, glaettung: s, vereinfachung: GLAETTUNG_STANDARD.vereinfachung };
}

// Clipboard for all boards of this session. Deep copies, so that a later
// paste shares nothing with the original.
let ablage = null;

function istEingabefeld(ziel) {
  return ziel instanceof HTMLElement
    && (ziel.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ziel.tagName));
}

export class Editor {
  werkzeug = 'stift';
  stile = {
    stift: { farbe: 'graphite', breite: 3, textmarker: false },
    radierer: { modus: 'strich', groesse: 28 },
    form: { art: 'rechteck', farbe: 'blue', fuellung: null, breite: 3 },
    auswahl: { art: 'pfeil' }, // 'pfeil' | 'rechteck' | 'lasso'
  };
  einst = { ...GLAETTUNG_STANDARD, druck: true, fingerZeichnet: false, rohMerken: false };
  letzterStrich = null;
  /** ids of the selected elements */
  auswahl = new Set();
  /** View only: the canvas can be panned and zoomed, nothing else */
  nurLesen = false;

  #aktion = null;
  #leertaste = false;
  #finger = new Map();
  #pinch = null;
  #stiftUnten = false;
  #rechteck = null;
  #hoerer = new Set();
  #beruehrt = new Set();
  #entwurfHoerer = new Set();
  #dateiHoerer = new Set();
  #meldenGeplant = false;
  #aufraeumen = [];
  #farben = null;
  #zeiger = null;

  /**
   * optionen.tasten: listen for keyboard shortcuts on the window (default
   * yes). The small test area in the settings does not need that.
   */
  constructor(container, optionen = {}) {
    this.container = container;
    this.dok = new Dokument();
    this.kamera = new Kamera();
    this.renderer = new Renderer(container, this.dok, this.kamera);

    container.style.touchAction = 'none';
    container.style.userSelect = 'none';
    container.style.webkitUserSelect = 'none';
    container.style.webkitTouchCallout = 'none';

    const an = (ziel, typ, fn, opt) => {
      ziel.addEventListener(typ, fn, opt);
      this.#aufraeumen.push(() => ziel.removeEventListener(typ, fn, opt));
    };
    an(container, 'pointerdown', this.#runter);
    an(container, 'pointermove', this.#bewegt);
    an(container, 'pointerup', this.#hoch);
    an(container, 'pointercancel', this.#hoch);
    an(container, 'pointerleave', this.#raus);
    an(container, 'wheel', this.#rad, { passive: false });
    // Selection frame, toolbars etc. are siblings above the canvas: the
    // wheel must not zoom the browser there.
    an(window, 'wheel', this.#radDarueber, { passive: false });
    an(container, 'contextmenu', (e) => e.preventDefault());
    // iPad: otherwise a long press brings up the magnifier and text selection.
    an(container, 'touchstart', (e) => e.preventDefault(), { passive: false });
    an(container, 'gesturestart', (e) => e.preventDefault());
    if (optionen.tasten !== false) {
      an(window, 'paste', this.#einfuegenAusAblage);
      an(window, 'keydown', this.#taste);
      an(window, 'keyup', this.#tasteHoch);
      an(window, 'blur', () => { this.#leertaste = false; this.#cursorSetzen(); });
    }

    this.#aufraeumen.push(this.dok.beiAenderung((e) => {
      // What no longer exists cannot stay selected.
      if (e.art === 'umbau' || e.art === 'geladen' || e.art === 'fremd') {
        for (const id of this.auswahl) if (!this.dok.get(id)) this.auswahl.delete(id);
      }
      this.#melden();
    }));
    this.#cursorSetzen();
  }

  zerstoeren() {
    for (const f of this.#aufraeumen) f();
    this.renderer.zerstoeren();
    this.#hoerer.clear();
    this.#beruehrt.clear();
  }

  // ---------------------------------------------------------------- for the UI

  /** fn(zustand) on every change, at most once per frame. */
  beiZustand(fn) {
    this.#hoerer.add(fn);
    fn(this.zustand());
    return () => this.#hoerer.delete(fn);
  }

  /**
   * fn(dateien, weltPunkt | null): images should go onto the board
   * (Ctrl+V). The UI does the upload, the engine knows no server.
   */
  beiDateien(fn) {
    this.#dateiHoerer.add(fn);
    return () => this.#dateiHoerer.delete(fn);
  }

  /** Center of the visible area in world coordinates */
  sichtMitte() {
    return this.kamera.zuWelt(this.renderer.breite / 2, this.renderer.hoehe / 2);
  }

  /** Screen point (clientX/Y) in world coordinates */
  weltVonSchirm(clientX, clientY) {
    const r = this.container.getBoundingClientRect();
    return this.kamera.zuWelt(clientX - r.left, clientY - r.top);
  }

  /**
   * Insert an image that has finished uploading. Size: natural size, but
   * at most 60 % of the visible area. mitte in world coordinates.
   */
  bildEinsetzen({ bild, breite, hoehe, name, mitte }) {
    const k = this.kamera;
    const max = Math.min(this.renderer.breite, this.renderer.hoehe) * 0.6 / k.z;
    const f = Math.min(1, max / Math.max(breite, hoehe, 1));
    const w = breite * f;
    const h = hoehe * f;
    const m = mitte ?? this.sichtMitte();
    const el = {
      id: neueId(),
      typ: 'bild',
      z: this.dok.naechstesZ(),
      bild,
      x1: Math.round(m.x - w / 2), y1: Math.round(m.y - h / 2),
      x2: Math.round(m.x + w / 2), y2: Math.round(m.y + h / 2),
    };
    if (name) el.name = name;
    const tx = this.dok.transaktion();
    tx.hinzufuegen(el);
    tx.abschliessen();
    this.werkzeug = 'lasso';
    this.#cursorSetzen();
    this.auswahlSetzen([el.id]);
    return el;
  }

  /** Swap an image's file; the width stays, the height follows the new aspect ratio. */
  bildErsetzen(id, { bild, breite, hoehe, name }) {
    const el = this.dok.get(id);
    if (!el || el.typ !== 'bild') return;
    const w = el.x2 - el.x1;
    const h = Math.abs(w) * (hoehe / Math.max(breite, 1)) * (Math.sign(el.y2 - el.y1) || 1);
    const my = (el.y1 + el.y2) / 2;
    const neu = { ...el, bild, y1: Math.round(my - h / 2), y2: Math.round(my + h / 2) };
    if (name) neu.name = name;
    const tx = this.dok.transaktion();
    tx.ersetzen(neu);
    tx.abschliessen();
  }

  /** fn(el | null): own stroke in progress, for other devices. */
  beiEntwurf(fn) {
    this.#entwurfHoerer.add(fn);
    return () => this.#entwurfHoerer.delete(fn);
  }

  /** Show someone else's stroke in progress (el = null: remove it). */
  entwurfSetzen(von, el, person) {
    const e = this.renderer.entwuerfe;
    if (el) {
      const P = el.punkte ?? [el.x2, el.y2];
      e.set(von, {
        el,
        name: person?.name ? person.name.split(/\s+/)[0] : '',
        farbe: person?.farbe,
        spitze: { x: P[P.length - 2], y: P[P.length - 1] },
      });
    } else if (e.has(von)) {
      // Stroke finished: the final one arrives shortly as a normal element,
      // only the label stays a little longer
      e.set(von, { ...e.get(von), ende: performance.now() });
    }
    this.renderer.obenNeu();
  }

  nurLesenSetzen(an) {
    this.nurLesen = !!an;
    if (an) this.auswahlSetzen([]);
    this.#cursorSetzen();
    this.#melden();
  }

  /** fn(e) as soon as someone touches the canvas, for closing popovers. */
  beiBeruehrung(fn) {
    this.#beruehrt.add(fn);
    return () => this.#beruehrt.delete(fn);
  }

  zustand() {
    const a = this.#aktion;
    return {
      werkzeug: this.werkzeug,
      stile: this.stile,
      einst: this.einst,
      hintergrund: this.dok.hintergrund,
      kannRueck: this.dok.kannRueck,
      kannVor: this.dok.kannVor,
      zoom: this.kamera.z,
      anzahl: this.dok.elemente.length,
      letzterStrich: this.letzterStrich,
      dauer: this.renderer.dauer,
      auswahl: this.#auswahlZustand(),
      kamera: { x: this.kamera.x, y: this.kamera.y, z: this.kamera.z },
      hilfslinie: a instanceof StiftAktion || a instanceof EndpunktAktion ? this.#schirmHilfslinie(a.hilfslinie) : null,
      aktiv: !!a,
      nurLesen: this.nurLesen,
    };
  }

  werkzeugSetzen(wz) {
    if (!WERKZEUGE.includes(wz)) return;
    if (wz !== 'lasso') this.auswahlSetzen([]);
    this.werkzeug = wz;
    this.#cursorSetzen();
    this.#melden();
  }

  stilSetzen(werkzeug, teil) {
    this.stile = { ...this.stile, [werkzeug]: { ...this.stile[werkzeug], ...teil } };
    this.#melden();
  }

  einstellungenSetzen(teil) {
    this.einst = { ...this.einst, ...teil };
    this.renderer.rohZeigen = this.einst.rohMerken;
    this.renderer.ganz();
    this.#melden();
  }

  hintergrundSetzen(teil) {
    this.dok.hintergrundSetzen(teil);
  }

  rueckgaengig() {
    if (this.#aktion || this.nurLesen) return;
    this.dok.rueckgaengig();
  }

  wiederholen() {
    if (this.#aktion || this.nurLesen) return;
    this.dok.wiederholen();
  }

  leeren() {
    const tx = this.dok.transaktion();
    for (const el of [...this.dok.elemente]) tx.entfernen(el.id);
    tx.abschliessen();
  }

  zoomen(faktor) {
    this.kamera.zoomUm(this.renderer.breite / 2, this.renderer.hoehe / 2, faktor);
    this.kameraGeaendert();
  }

  /** Next level from ZOOM_STUFEN, richtung +1 or -1. */
  zoomStufe(richtung) {
    const z = this.kamera.z;
    const ziel = richtung > 0
      ? ZOOM_STUFEN.find((s) => s > z + 1e-6) ?? Math.min(ZOOM_MAX, z * 1.25)
      : [...ZOOM_STUFEN].reverse().find((s) => s < z - 1e-6) ?? Math.max(ZOOM_MIN, z / 1.25);
    this.zoomen(ziel / z);
  }

  zoomZuruecksetzen() {
    this.zoomen(1 / this.kamera.z);
  }

  allesAnzeigen() {
    const g = this.inhaltsGrenzen();
    if (!g) {
      this.kamera.x = -this.renderer.breite / 2;
      this.kamera.y = -this.renderer.hoehe / 2;
      this.kamera.z = 1;
    } else {
      this.kamera.einpassen(g, this.renderer.breite, this.renderer.hoehe, 72);
    }
    this.kameraGeaendert();
  }

  kameraGeaendert() {
    this.renderer.ganz();
    this.#melden();
  }

  /** Eraser radius in world coordinates. */
  radiererRadius() {
    const r = this.stile.radierer;
    return r.modus === 'punkt' ? r.groesse / 2 : STRICH_RADIERER_PX / this.kamera.z;
  }

  /** Bounds of all elements, or null for an empty board. */
  inhaltsGrenzen() {
    const els = this.dok.elemente;
    if (!els.length) return null;
    let g = grenzen(els[0]);
    for (const el of els) g = vereinigt(g, grenzen(el));
    return g;
  }

  // ----------------------------------------------------------- Selection

  auswahlSetzen(ids) {
    const neu = new Set(ids.filter((id) => this.dok.get(id)));
    if (neu.size === this.auswahl.size && [...neu].every((id) => this.auswahl.has(id))) return;
    this.auswahl = neu;
    this.#melden();
  }

  /** Topmost element at a world point (tap to select). */
  elementBei(x, y) {
    const r = 6 / this.kamera.z;
    const g = { x1: x - r, y1: y - r, x2: x + r, y2: y + r };
    let oben = null;
    for (const id of this.dok.finden(g)) {
      const el = this.dok.get(id);
      if (el && (enthaelt(el, x, y) || trifft(el, x, y, x, y, r)) && (!oben || el.z >= oben.z)) oben = el;
    }
    return oben;
  }

  auswahlGrenzen() {
    let g = null;
    for (const id of this.auswahl) {
      const el = this.dok.get(id);
      if (el) g = g ? vereinigt(g, grenzen(el)) : grenzen(el);
    }
    return g;
  }

  #ausgewaehlt() {
    return [...this.auswahl].map((id) => this.dok.get(id)).filter(Boolean).sort((a, b) => a.z - b.z);
  }

  allesAuswaehlen() {
    this.werkzeug = 'lasso';
    this.#cursorSetzen();
    this.auswahlSetzen(this.dok.elemente.map((el) => el.id));
    this.#melden();
  }

  auswahlLoeschen() {
    if (!this.auswahl.size) return;
    const tx = this.dok.transaktion();
    for (const id of this.auswahl) tx.entfernen(id);
    tx.abschliessen();
    this.auswahlSetzen([]);
  }

  kopieren() {
    const els = this.#ausgewaehlt();
    if (els.length) ablage = JSON.parse(JSON.stringify(els.map(({ _roh, ...el }) => el)));
  }

  ausschneiden() {
    this.kopieren();
    this.auswahlLoeschen();
  }

  /** From the clipboard, under the pointer or slightly offset. */
  einfuegen() {
    if (!ablage?.length) return;
    let g = grenzen(ablage[0]);
    for (const el of ablage) g = vereinigt(g, grenzen(el));
    let dx;
    let dy;
    if (this.#zeiger) {
      const w = this.kamera.zuWelt(this.#zeiger.x, this.#zeiger.y);
      dx = w.x - (g.x1 + g.x2) / 2;
      dy = w.y - (g.y1 + g.y2) / 2;
    } else {
      dx = 24 / this.kamera.z;
      dy = 24 / this.kamera.z;
    }
    this.#kopienEinsetzen(ablage, dx, dy);
  }

  get hatAblage() {
    return !!ablage?.length;
  }

  duplizieren() {
    const els = this.#ausgewaehlt();
    if (!els.length) return;
    this.#kopienEinsetzen(els, 24 / this.kamera.z, 24 / this.kamera.z);
  }

  #kopienEinsetzen(els, dx, dy) {
    const tx = this.dok.transaktion();
    let z = this.dok.naechstesZ();
    const ids = [];
    for (const el of [...els].sort((a, b) => a.z - b.z)) {
      const kopie = { ...transformieren(el, [1, 0, 0, 1, dx, dy]), id: neueId(), z: z++ };
      tx.hinzufuegen(kopie);
      ids.push(kopie.id);
    }
    tx.abschliessen();
    this.werkzeug = 'lasso';
    this.#cursorSetzen();
    this.auswahlSetzen(ids);
  }

  nachVorne() {
    const els = this.#ausgewaehlt();
    if (!els.length) return;
    const tx = this.dok.transaktion();
    let z = this.dok.naechstesZ();
    for (const el of els) tx.ersetzen({ ...el, z: z++ });
    tx.abschliessen();
  }

  nachHinten() {
    const els = this.#ausgewaehlt();
    if (!els.length) return;
    const tx = this.dok.transaktion();
    const unten = this.dok.elemente.length ? Math.floor(this.dok.elemente[0].z) : 0;
    let z = unten - els.length;
    for (const el of els) tx.ersetzen({ ...el, z: z++ });
    tx.abschliessen();
  }

  /**
   * Color for all selected strokes, shapes and highlighters. Pen and
   * shapes become opaque, highlighters get the color translucent.
   */
  auswahlFaerben(farbe) {
    const tx = this.dok.transaktion();
    for (const el of this.#ausgewaehlt()) {
      if (el.typ === 'bild') continue;
      const neu = el.textmarker ? markerFarbeZu(farbe) : farbe;
      if (el.farbe !== neu) tx.ersetzen({ ...el, farbe: neu });
    }
    tx.abschliessen();
  }

  /** Stroke width for all selected shapes. */
  auswahlFormBreite(breite) {
    const tx = this.dok.transaktion();
    for (const el of this.#ausgewaehlt()) {
      if (el.typ === 'form' && el.breite !== breite) tx.ersetzen({ ...el, breite });
    }
    tx.abschliessen();
  }

  /**
   * Started from a UI handle (pointerdown there). griff as in
   * TransformAktion. Further movements are attached to the handle.
   */
  anfasserGreifen(griff, e) {
    if (!this.auswahl.size || this.#aktion) return;
    e.preventDefault();
    e.stopPropagation();
    this.#rechteck = this.container.getBoundingClientRect();
    const ziel = e.currentTarget;
    try { ziel.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const aktion = griff === 'ende1' || griff === 'ende2'
      ? new EndpunktAktion(this, e, griff === 'ende1' ? 1 : 2)
      : new TransformAktion(this, e, griff);
    this.#starten(aktion, e);
    const bewegen = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const liste = ev.getCoalescedEvents?.() ?? [];
      aktion.bewegen(liste.length ? liste : [ev], ev);
      this.renderer.obenNeu();
      this.#melden();
    };
    const loslassen = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      ziel.removeEventListener('pointermove', bewegen);
      ziel.removeEventListener('pointerup', loslassen);
      ziel.removeEventListener('pointercancel', loslassen);
      this.#beenden(false);
    };
    ziel.addEventListener('pointermove', bewegen);
    ziel.addEventListener('pointerup', loslassen);
    ziel.addEventListener('pointercancel', loslassen);
  }

  #auswahlZustand() {
    if (!this.auswahl.size) return null;
    const a = this.#aktion;
    let g;
    let M = [1, 0, 0, 1, 0, 0];
    let winkel = 0;
    if (a instanceof TransformAktion) {
      ({ g, M, winkel } = a.rahmen);
    } else if (a instanceof EndpunktAktion) {
      g = grenzen(a.element);
    } else {
      g = this.auswahlGrenzen();
    }
    if (!g) return null;
    const k = this.kamera;
    // While rotating, the frame keeps its original size and rotates around
    // its center; otherwise it is recomputed with the transform.
    let x1 = g.x1, y1 = g.y1, x2 = g.x2, y2 = g.y2;
    if (!winkel) {
      const [a0, , , d0, e0, f0] = M;
      [x1, x2] = [a0 * g.x1 + e0, a0 * g.x2 + e0].sort((p, q) => p - q);
      [y1, y2] = [d0 * g.y1 + f0, d0 * g.y2 + f0].sort((p, q) => p - q);
    }
    const els = this.#ausgewaehlt();
    const farben = new Set(els.filter((el) => el.typ !== 'bild').map((el) => markerAlsTinte(el.farbe)));
    const formBreiten = new Set(els.filter((el) => el.typ === 'form').map((el) => el.breite ?? 3));
    const nurBilder = els.length > 0 && els.every((el) => el.typ === 'bild');
    // A single line or arrow: handles at both ends instead of frame
    // handles, so one end can be dragged on its own.
    let linie = els.length === 1 && els[0].typ === 'form' && (els[0].form === 'linie' || els[0].form === 'pfeil')
      ? els[0] : null;
    if (a instanceof EndpunktAktion) linie = a.element;
    let endpunkte = null;
    if (linie) {
      const [a0, b0, c0, d0, e0, f0] = M;
      const schirm = (x, y) => ({ x: (a0 * x + c0 * y + e0 - k.x) * k.z, y: (b0 * x + d0 * y + f0 - k.y) * k.z });
      endpunkte = [schirm(linie.x1, linie.y1), schirm(linie.x2, linie.y2)];
    }
    return {
      endpunkte,
      x: (x1 - k.x) * k.z,
      y: (y1 - k.y) * k.z,
      breite: (x2 - x1) * k.z,
      hoehe: (y2 - y1) * k.z,
      winkel,
      anzahl: this.auswahl.size,
      farbe: farben.size === 1 ? [...farben][0] : null,
      // Shapes in the selection: their stroke width (mixed: 0)
      formBreite: formBreiten.size ? (formBreiten.size === 1 ? [...formBreiten][0] : 0) : null,
      bewegt: a instanceof TransformAktion || a instanceof EndpunktAktion,
      nurBilder,
      // Single image: size for the chip at the top right (design 8f)
      bild: nurBilder && els.length === 1 ? {
        id: els[0].id,
        breite: Math.round(Math.abs(x2 - x1)),
        hoehe: Math.round(Math.abs(y2 - y1)),
      } : null,
    };
  }

  #schirmHilfslinie(h) {
    if (!h) return null;
    const k = this.kamera;
    return { x: (h.start.x - k.x) * k.z, y: (h.start.y - k.y) * k.z, grad: h.grad, eingerastet: h.eingerastet };
  }

  // -------------------------------------------------------------- internal

  welt(e) {
    const r = this.#rechteck ?? this.container.getBoundingClientRect();
    return this.kamera.zuWelt(e.clientX - r.left, e.clientY - r.top);
  }

  /** Accent color from the design tokens, for lasso and guides. */
  akzent(deckkraft = 1) {
    this.#farben ??= getComputedStyle(this.container);
    const f = this.#farben.getPropertyValue('--ui-accent').trim() || '#4c4fd0';
    if (deckkraft === 1) return f;
    return f.startsWith('oklch(') ? f.replace(')', ` / ${deckkraft})`) : f;
  }

  flaeche() {
    this.#farben ??= getComputedStyle(this.container);
    return this.#farben.getPropertyValue('--ui-surface').trim() || '#ffffff';
  }

  #melden() {
    if (this.#meldenGeplant) return;
    this.#meldenGeplant = true;
    requestAnimationFrame(() => {
      this.#meldenGeplant = false;
      const z = this.zustand();
      for (const h of this.#hoerer) h(z);
    });
  }

  #cursorSetzen() {
    const wz = this.#leertaste || this.nurLesen ? 'hand' : this.werkzeug;
    this.container.style.cursor = {
      hand: this.#aktion instanceof HandAktion ? 'grabbing' : 'grab',
      radierer: 'none',
    }[wz] ?? 'crosshair';
    if (wz !== 'radierer') {
      this.renderer.cursor = null;
      this.renderer.obenNeu();
    }
  }

  #radiererCursor(e) {
    const radiert = this.#aktion instanceof RadiererAktion
      || (!this.#aktion && !this.#leertaste && this.werkzeug === 'radierer' && e.pointerType !== 'touch');
    const r = this.#rechteck ?? this.container.getBoundingClientRect();
    const d = this.stile.radierer.modus === 'punkt'
      ? this.stile.radierer.groesse * this.kamera.z
      : STRICH_RADIERER_PX * 2;
    const neu = radiert ? { x: e.clientX - r.left, y: e.clientY - r.top, r: d / 2 } : null;
    if (neu || this.renderer.cursor) {
      this.renderer.cursor = neu;
      this.renderer.obenNeu();
    }
  }

  #starten(aktion, e) {
    this.#aktion = aktion;
    aktion.pointerId = e.pointerId;
    aktion.pointerType = e.pointerType;
    this.renderer.vorschau = (ctx) => aktion.vorschau(ctx);
    this.renderer.obenNeu();
    this.#cursorSetzen();
  }

  #beenden(abbrechen) {
    const a = this.#aktion;
    if (!a) return;
    this.#aktion = null;
    if (abbrechen) a.abbrechen();
    else a.ende();
    if ('entwurf' in a) for (const f of this.#entwurfHoerer) f(null);
    if (a.pointerType === 'pen') this.#stiftUnten = false;
    this.renderer.vorschau = null;
    this.renderer.oben.style.mixBlendMode = '';
    this.renderer.obenNeu();
    this.#cursorSetzen();
    this.#melden();
  }

  #imAuswahlRahmen(w) {
    const g = this.auswahlGrenzen();
    if (!g) return false;
    const r = 8 / this.kamera.z;
    return w.x >= g.x1 - r && w.x <= g.x2 + r && w.y >= g.y1 - r && w.y <= g.y2 + r;
  }

  #runter = (e) => {
    this.#rechteck = this.container.getBoundingClientRect();
    for (const f of this.#beruehrt) f(e);

    if (e.pointerType === 'touch') {
      this.#finger.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.#stiftUnten) return;
      if (this.#finger.size === 2) {
        // Second finger: whatever the first one started becomes zooming.
        if (this.#aktion?.pointerType === 'touch') this.#beenden(!(this.#aktion instanceof HandAktion));
        this.#pinchStarten();
        return;
      }
      if (this.#finger.size > 2 || this.#aktion) return;
      if (!this.einst.fingerZeichnet) {
        this.container.setPointerCapture(e.pointerId);
        this.#starten(new HandAktion(this, e), e);
        return;
      }
    } else if (this.#aktion) {
      return;
    }

    let wz = this.#leertaste || this.nurLesen ? 'hand' : this.werkzeug;
    if (e.pointerType === 'mouse') {
      if (e.button === 1) wz = 'hand';
      else if (e.button !== 0) return;
    }
    if (e.pointerType === 'pen') {
      this.#stiftUnten = true;
      // 32 = eraser end, 2 = side button
      if (!this.nurLesen && (e.button === 5 || e.buttons & 32 || e.buttons & 2)) wz = 'radierer';
    }

    this.container.setPointerCapture(e.pointerId);
    e.preventDefault();

    let aktion;
    if (wz === 'lasso') {
      const w = this.welt(e);
      const art = this.stile.auswahl?.art ?? 'pfeil';
      if (!e.shiftKey && this.#imAuswahlRahmen(w)) {
        // Grabbed inside the selection: move
        aktion = new TransformAktion(this, e, 'mitte');
      } else if (art === 'pfeil' && !e.shiftKey && this.elementBei(w.x, w.y)) {
        // Pointer on an element: select it and take it along right away.
        // Just tapped, nothing moves, then it is simply selected.
        this.auswahlSetzen([this.elementBei(w.x, w.y).id]);
        aktion = new TransformAktion(this, e, 'mitte');
      } else {
        // Empty area (pointer: drag a rectangle) or Shift: select
        aktion = new LassoAktion(this, e, art === 'pfeil' ? 'rechteck' : art);
      }
    } else {
      if (wz !== 'hand' && this.auswahl.size) this.auswahlSetzen([]);
      aktion = {
        stift: () => new StiftAktion(this, e),
        form: () => new FormAktion(this, e),
        radierer: () => new RadiererAktion(this, e),
        hand: () => new HandAktion(this, e),
      }[wz]();
    }
    this.#starten(aktion, e);
    this.#radiererCursor(e);
  };

  #bewegt = (e) => {
    const r = this.#rechteck ?? this.container.getBoundingClientRect();
    this.#zeiger = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (e.pointerType === 'touch' && this.#finger.has(e.pointerId)) {
      this.#finger.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.#pinch) {
        this.#pinchBewegen();
        return;
      }
    }
    this.#radiererCursor(e);
    const a = this.#aktion;
    if (!a || e.pointerId !== a.pointerId) return;
    const liste = e.getCoalescedEvents?.() ?? [];
    a.bewegen(liste.length ? liste : [e], e);
    this.renderer.obenNeu();
    if (a instanceof StiftAktion || a instanceof TransformAktion) this.#melden();
    if (this.#entwurfHoerer.size && 'entwurf' in a) {
      const el = a.entwurf;
      for (const f of this.#entwurfHoerer) f(el);
    }
  };

  #hoch = (e) => {
    if (e.pointerType === 'touch') {
      this.#finger.delete(e.pointerId);
      if (this.#pinch && this.#finger.size < 2) this.#pinch = null;
    }
    if (e.pointerType === 'pen') this.#stiftUnten = false;
    if (this.#aktion && e.pointerId === this.#aktion.pointerId) this.#beenden(false);
  };

  #raus = () => {
    this.#zeiger = null;
    if (this.renderer.cursor && !this.#aktion) {
      this.renderer.cursor = null;
      this.renderer.obenNeu();
    }
  };

  #pinchStarten() {
    const [a, b] = [...this.#finger.values()];
    const r = this.#rechteck;
    const mx = (a.x + b.x) / 2 - r.left;
    const my = (a.y + b.y) / 2 - r.top;
    this.#pinch = {
      abstand: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      zoom: this.kamera.z,
      welt: this.kamera.zuWelt(mx, my),
    };
  }

  #pinchBewegen() {
    const [a, b] = [...this.#finger.values()];
    const r = this.#rechteck;
    const mx = (a.x + b.x) / 2 - r.left;
    const my = (a.y + b.y) / 2 - r.top;
    const p = this.#pinch;
    const k = this.kamera;
    k.z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, p.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / p.abstand)));
    k.x = p.welt.x - mx / k.z;
    k.y = p.welt.y - my / k.z;
    this.kameraGeaendert();
  }

  #rad = (e) => {
    e.preventDefault();
    const r = this.container.getBoundingClientRect();
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === 1) { dx *= 16; dy *= 16; }
    if (e.deltaMode === 2) { dx *= r.width; dy *= r.height; }
    if (e.ctrlKey || e.metaKey) {
      this.kamera.zoomUm(e.clientX - r.left, e.clientY - r.top, Math.exp(-dy * 0.0025));
    } else {
      if (e.shiftKey && !dx) { dx = dy; dy = 0; }
      this.kamera.verschieben(-dx, -dy);
    }
    this.kameraGeaendert();
  };

  // Over the selection frame same as on the canvas; over toolbars and
  // popovers only Ctrl+wheel (zoom), so lists there keep scrolling.
  #radDarueber = (e) => {
    const ziel = e.target;
    if (!(ziel instanceof Element) || this.container.contains(ziel)) return;
    if (!this.container.parentElement?.contains(ziel)) return;
    if (ziel.closest('.auswahl-rahmen') || e.ctrlKey || e.metaKey) this.#rad(e);
  };

  // Only what concerns the canvas itself. Tool selection (P, H, E, L, 1-4)
  // and Esc belong to the UI, because only it knows slots and popovers.
  #taste = (e) => {
    if (istEingabefeld(e.target)) return;
    const strg = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (strg && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.wiederholen();
      else this.rueckgaengig();
      return;
    }
    if (strg && k === 'y') { e.preventDefault(); this.wiederholen(); return; }
    // View only: zooming and panning yes, changing no
    if (this.nurLesen && (strg ? 'axvd'.includes(k) : k === 'delete' || k === 'backspace')) return;
    if (strg && (k === '+' || k === '=')) { e.preventDefault(); this.zoomStufe(1); return; }
    if (strg && k === '-') { e.preventDefault(); this.zoomStufe(-1); return; }
    if (strg && k === '0') { e.preventDefault(); this.zoomZuruecksetzen(); return; }
    if (strg && k === 'a') { e.preventDefault(); this.allesAuswaehlen(); return; }
    if (strg && k === 'c') { if (this.auswahl.size) { e.preventDefault(); this.kopieren(); } return; }
    if (strg && k === 'x') { if (this.auswahl.size) { e.preventDefault(); this.ausschneiden(); } return; }
    // Ctrl+V goes through the paste event (#einfuegenAusAblage): only there
    // do images from the system clipboard arrive
    if (strg && k === 'v') return;
    if (strg && k === 'd') { e.preventDefault(); this.duplizieren(); return; }
    if (strg || e.altKey) return;

    if ((k === 'delete' || k === 'backspace') && this.auswahl.size) {
      e.preventDefault();
      this.auswahlLoeschen();
      return;
    }
    if (e.code === 'Digit1' && e.shiftKey) { e.preventDefault(); this.allesAnzeigen(); return; }
    if (e.code === 'Space') {
      e.preventDefault();
      if (!this.#leertaste) {
        this.#leertaste = true;
        this.#cursorSetzen();
      }
    }
  };

  #einfuegenAusAblage = (e) => {
    if (istEingabefeld(e.target) || this.nurLesen) return;
    const dateien = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (dateien.length && this.#dateiHoerer.size) {
      e.preventDefault();
      for (const f of this.#dateiHoerer) f(dateien, null);
      return;
    }
    if (ablage) {
      e.preventDefault();
      this.einfuegen();
    }
  };

  #tasteHoch = (e) => {
    if (e.code === 'Space') {
      this.#leertaste = false;
      this.#cursorSetzen();
    }
  };
}
