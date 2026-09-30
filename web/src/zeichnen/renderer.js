// Zwei Ebenen uebereinander:
//
//   unten  alle fertigen Elemente und der Hintergrund. Wird nur neu
//          gezeichnet, wenn sich Inhalt oder Kamera aendert. Ein neuer
//          Strich oben drauf wird einfach dazugemalt, ohne alles neu.
//   oben   der Strich, der gerade entsteht, und der Radierer-Kreis. Nur
//          diese Ebene wird waehrend des Zeichnens pro Bild neu gemalt.
//          "desynchronized" erlaubt dem Browser, sie am Compositor vorbei
//          direkt anzuzeigen. Das spart vor allem unter Windows spuerbar
//          Latenz.

import { beiBildGeladen, grenzen, zeichnen } from './elemente.js';
import { farbeAufloesen, leinwand, MUSTER_FARBE, PATTERN } from './farben.js';
import { ueberlappen } from './geometrie.js';

// Kennfarben kommen als CSS-Variablen aus den Tokens (--peer-teal usw.,
// je nach Hell/Dunkel anders); die Leinwand braucht sie als Farbwert.
function kennfarbe(id) {
  const stil = getComputedStyle(document.documentElement);
  if (id === 'on') return stil.getPropertyValue('--on-peer').trim() || '#ffffff';
  return stil.getPropertyValue(`--peer-${id ?? 'teal'}`).trim() || '#4c4fd0';
}

export class Renderer {
  breite = 0;
  hoehe = 0;
  dpr = 1;
  /** fn(ctx) in Weltkoordinaten, fuer das entstehende Element */
  vorschau = null;
  /** { x, y, r } in CSS-Pixeln */
  cursor = null;
  rohZeigen = false;
  dauer = 0;
  /** ids, die gerade nicht auf der unteren Ebene erscheinen (Auswahl wird bewegt) */
  ausgeblendet = null;
  /** Striche anderer Personen im Entstehen: von -> { el, name, farbe, spitze, ende } */
  entwuerfe = new Map();

  /** Ist die Leinwand dunkel? Bestimmt die Tintenfarben. */
  get dunkel() {
    return !!leinwand(this.dok.hintergrund.farbe).dark;
  }

  #ganzNoetig = true;
  #obenNoetig = false;
  #neu = [];
  #rahmen = 0;

  constructor(container, dok, kamera) {
    this.container = container;
    this.dok = dok;
    this.kamera = kamera;

    this.unten = document.createElement('canvas');
    this.oben = document.createElement('canvas');
    for (const c of [this.unten, this.oben]) {
      c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
      container.appendChild(c);
    }
    this.ctxU = this.unten.getContext('2d', { alpha: false });
    // Nur am Desktop: Auf Android legt der Browser eine solche Ebene als
    // Overlay ueber alles und verdeckt damit die untere Ebene samt Hintergrund.
    const direkt = !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    this.ctxO = (direkt && this.oben.getContext('2d', { desynchronized: true })) || this.oben.getContext('2d');

    this.beobachter = new ResizeObserver(() => this.#groesse());
    this.beobachter.observe(container);
    this.#groesse();

    // Ein Bild ist fertig geladen: alles neu, sonst bleibt der Platzhalter
    this.bildAbmelden = beiBildGeladen(() => this.ganz());

    this.abmelden = dok.beiAenderung((e) => {
      if (e.art === 'verlauf' || e.art === 'ops') return;
      const els = dok.elemente;
      if (e.art === 'hinzu' && !e.el.textmarker && els[els.length - 1] === e.el) {
        this.#neu.push(e.el);
        this.#planen();
      } else {
        this.ganz();
      }
    });
  }

  zerstoeren() {
    cancelAnimationFrame(this.#rahmen);
    this.beobachter.disconnect();
    this.abmelden();
    this.bildAbmelden();
    this.unten.remove();
    this.oben.remove();
  }

  ganz() {
    this.#ganzNoetig = true;
    this.#planen();
  }

  obenNeu() {
    this.#obenNoetig = true;
    this.#planen();
  }

  #planen() {
    if (!this.#rahmen) this.#rahmen = requestAnimationFrame(() => this.#zeichnen());
  }

  #groesse() {
    const r = this.container.getBoundingClientRect();
    this.breite = r.width;
    this.hoehe = r.height;
    this.dpr = window.devicePixelRatio || 1;
    for (const c of [this.unten, this.oben]) {
      c.width = Math.max(1, Math.round(r.width * this.dpr));
      c.height = Math.max(1, Math.round(r.height * this.dpr));
    }
    this.#ganzNoetig = true;
    this.#obenNoetig = true;
    // Sofort zeichnen: eine geleerte Leinwand bis zum naechsten Bild flackert.
    this.#zeichnen();
  }

  #weltTransform(ctx) {
    const { x, y, z } = this.kamera;
    const f = z * this.dpr;
    ctx.setTransform(f, 0, 0, f, -x * f, -y * f);
  }

  #zeichnen() {
    cancelAnimationFrame(this.#rahmen);
    this.#rahmen = 0;
    const t0 = performance.now();
    if (this.#ganzNoetig) {
      this.#ganzNoetig = false;
      this.#neu.length = 0;
      this.#alles();
      this.dauer = performance.now() - t0;
    } else if (this.#neu.length) {
      const ctx = this.ctxU;
      this.#weltTransform(ctx);
      const dunkel = this.dunkel;
      for (const el of this.#neu) zeichnen(ctx, el, dunkel);
      this.#neu.length = 0;
    }
    if (this.#obenNoetig) {
      this.#obenNoetig = false;
      this.#obere();
    }
  }

  #alles() {
    const ctx = this.ctxU;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dunkel = this.dunkel;
    ctx.fillStyle = leinwand(this.dok.hintergrund.farbe).color;
    ctx.fillRect(0, 0, this.unten.width, this.unten.height);
    this.#muster(ctx);

    this.#weltTransform(ctx);
    const sicht = this.kamera.sicht(this.breite, this.hoehe);
    const els = this.dok.elemente;
    // Textmarker zuerst, damit er unter der Tinte liegt. Auf heller
    // Leinwand multipliziert, auf dunkler aufgehellt, wie ein echter Marker.
    ctx.globalCompositeOperation = dunkel ? 'screen' : 'multiply';
    const weg = this.ausgeblendet;
    const sichtbar = (el) => ueberlappen(grenzen(el), sicht) && !weg?.has(el.id);
    for (const el of els) if (el.textmarker && sichtbar(el)) zeichnen(ctx, el, dunkel);
    ctx.globalCompositeOperation = 'source-over';
    for (const el of els) if (!el.textmarker && sichtbar(el)) zeichnen(ctx, el, dunkel);

    if (this.rohZeigen) {
      ctx.strokeStyle = 'rgba(230, 40, 40, 0.8)';
      ctx.lineWidth = 1 / this.kamera.z;
      ctx.lineCap = 'butt';
      for (const el of els) {
        const R = el._roh;
        if (!R || !ueberlappen(grenzen(el), sicht)) continue;
        ctx.beginPath();
        ctx.moveTo(R[0], R[1]);
        for (let i = 3; i < R.length; i += 3) ctx.lineTo(R[i], R[i + 1]);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(20, 120, 230, 0.9)';
      const r = 1.5 / this.kamera.z;
      for (const el of els) {
        if (el.typ !== 'strich' || !el._roh || !ueberlappen(grenzen(el), sicht)) continue;
        const P = el.punkte;
        for (let i = 0; i < P.length; i += 2) ctx.fillRect(P[i] - r, P[i + 1] - r, 2 * r, 2 * r);
      }
    }
  }

  #muster(ctx) {
    const muster = PATTERN[this.dok.hintergrund.muster];
    if (!muster?.step) return;
    const { x, y, z } = this.kamera;
    let abstand = muster.step;
    while (abstand * z < 12) abstand *= 2;
    const s = abstand * z * this.dpr;
    const ox = ((-x * z * this.dpr) % s + s) % s;
    const oy = ((-y * z * this.dpr) % s + s) % s;
    const W = this.unten.width;
    const H = this.unten.height;
    ctx.fillStyle = this.dunkel ? MUSTER_FARBE.dark : MUSTER_FARBE.light;
    if (muster.dotRadius) {
      // Punkte wachsen mit dem Zoom mit, aber nicht ins Unleserliche.
      const d = Math.min(Math.max(muster.dotRadius * 2 * Math.min(z, 1.5), 1.2), 4) * this.dpr;
      ctx.beginPath();
      for (let px = ox; px < W; px += s) {
        for (let py = oy; py < H; py += s) ctx.rect(px - d / 2, py - d / 2, d, d);
      }
      ctx.fill();
    } else {
      const d = Math.max(1, this.dpr);
      if (this.dok.hintergrund.muster === 'grid') for (let px = ox; px < W; px += s) ctx.fillRect(px, 0, d, H);
      for (let py = oy; py < H; py += s) ctx.fillRect(0, py, W, d);
    }
  }

  // Fremde Striche im Entstehen, dazu an der Stiftspitze ein Etikett mit
  // dem Namen in der Kennfarbe der Person (Design 7g/7h). Das Etikett
  // bleibt nach dem Absetzen 1500 ms stehen und blendet dann in 500 ms aus;
  // es wird in Bildschirmgroesse gezeichnet, skaliert also nicht mit dem Zoom.
  #entwuerfeZeichnen(ctx) {
    const dunkel = this.dunkel;
    const { x: kx, y: ky, z } = this.kamera;
    const jetzt = performance.now();
    let blendetAus = false;
    for (const [von, e] of this.entwuerfe) {
      let deckkraft = 1;
      if (e.ende) {
        const seit = jetzt - e.ende;
        if (seit > 2000) { this.entwuerfe.delete(von); continue; }
        if (seit > 1500) deckkraft = 1 - (seit - 1500) / 500;
        blendetAus = true;
      } else {
        this.#weltTransform(ctx);
        if (e.el.textmarker) ctx.globalCompositeOperation = dunkel ? 'screen' : 'multiply';
        zeichnen(ctx, e.el, dunkel);
        ctx.globalCompositeOperation = 'source-over';
      }
      if (!e.name || !e.spitze) continue;
      const sx = (e.spitze.x - kx) * z + 7;
      const sy = (e.spitze.y - ky) * z + 7;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.globalAlpha = deckkraft;
      ctx.font = "600 12px 'Onest', system-ui, sans-serif";
      const w = ctx.measureText(e.name).width + 16;
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
      ctx.shadowBlur = 3;
      ctx.shadowOffsetY = 1;
      ctx.fillStyle = kennfarbe(e.farbe);
      ctx.beginPath();
      ctx.roundRect(sx, sy, w, 22, [3, 11, 11, 11]);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = kennfarbe('on');
      ctx.textBaseline = 'middle';
      ctx.fillText(e.name, sx + 8, sy + 11.5);
      ctx.globalAlpha = 1;
    }
    if (blendetAus) requestAnimationFrame(() => this.obenNeu());
  }

  #obere() {
    const ctx = this.ctxO;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.oben.width, this.oben.height);
    if (this.entwuerfe.size) this.#entwuerfeZeichnen(ctx);
    if (this.vorschau) {
      this.#weltTransform(ctx);
      this.vorschau(ctx);
    }
    if (this.cursor) {
      // Radierer-Kreis wie im Design: Rand in Graphit, aussen ein Ring in
      // Leinwandfarbe, innen ganz leicht grau.
      const { x, y, r } = this.cursor;
      const dunkel = this.dunkel;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(r - 0.75, 1), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(127, 127, 127, 0.08)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = leinwand(this.dok.hintergrund.farbe).color;
      ctx.beginPath();
      ctx.arc(x, y, r + 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = farbeAufloesen('graphite', dunkel);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(r - 0.75, 1), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
