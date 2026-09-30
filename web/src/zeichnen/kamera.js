// Welt- und Bildschirmkoordinaten. (x, y) ist die Weltposition der linken
// oberen Ecke, z der Zoom: Bildschirm = (Welt - (x, y)) * z, in CSS-Pixeln.

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 20;

export class Kamera {
  x = 0;
  y = 0;
  z = 1;

  zuWelt(sx, sy) {
    return { x: sx / this.z + this.x, y: sy / this.z + this.y };
  }

  zoomUm(sx, sy, faktor) {
    const w = this.zuWelt(sx, sy);
    this.z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.z * faktor));
    this.x = w.x - sx / this.z;
    this.y = w.y - sy / this.z;
  }

  verschieben(dsx, dsy) {
    this.x -= dsx / this.z;
    this.y -= dsy / this.z;
  }

  sicht(breite, hoehe) {
    return { x1: this.x, y1: this.y, x2: this.x + breite / this.z, y2: this.y + hoehe / this.z };
  }

  /** Rechteck g mit rand Pixeln Abstand einpassen, hoechstens bis maxZoom. */
  einpassen(g, breite, hoehe, rand = 48, maxZoom = 1) {
    const w = Math.max(g.x2 - g.x1, 1);
    const h = Math.max(g.y2 - g.y1, 1);
    const z = Math.min(maxZoom, (breite - 2 * rand) / w, (hoehe - 2 * rand) / h);
    this.z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    this.x = (g.x1 + g.x2) / 2 - breite / 2 / this.z;
    this.y = (g.y1 + g.y2) / 2 - hoehe / 2 / this.z;
  }
}
