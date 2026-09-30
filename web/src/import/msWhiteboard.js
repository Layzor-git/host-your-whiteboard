// Import aus dem HTML-Export von Microsoft Whiteboard.
//
// Aufbau des Exports (Stand 2026): Jedes Element ist ein
// <div class="anchor ..." data-whiteboard-type="InkGroup"
//      style="left: Xpx; top: Ypx; transform: matrix(a, b, c, d, e, f)">
// darin ein <svg viewBox="0 0 w h" width="w" height="h"> mit einem
// <g class="inkStroke" transform="matrix(1/128, ...)"> pro Strich. Der Strich
// steht dort doppelt:
//   <path d="..." fill="rgba(...)">                 Umriss als Flaeche
//   <polyline class="inkHitTestOverlay" points="..."> Mittellinie
// Die Mittellinie wird unser Strich. Aus dem Abstand zum Umriss lesen wir
// die Breite an jedem Punkt ab, das ergibt den Druckverlauf.
//
// Absichtlich mit regulaeren Ausdruecken statt DOMParser: Der Export ist
// maschinell erzeugt und gleichfoermig, und so laeuft der Import auch im
// Test unter Node.

import { neueId } from '../zeichnen/elemente.js';
import { alsHex, naechsteTinte } from '../zeichnen/farben.js';
import { runden } from '../zeichnen/geometrie.js';

function matrix(text) {
  const m = text?.match(/matrix\(([^)]*)\)/);
  if (!m) return [1, 0, 0, 1, 0, 0];
  return m[1].split(',').map(Number);
}

function anwenden([a, b, c, d, e, f], x, y) {
  return [a * x + c * y + e, b * x + d * y + f];
}

function farbeLesen(text) {
  const m = text?.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  const h = text?.match(/#([0-9a-f]{6})/i);
  if (h) {
    const n = parseInt(h[1], 16);
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  return { r: 31, g: 32, b: 35, a: 1 };
}

/**
 * Die Kanten des Umrisses als Teilpfade [[x, y, ...], ...]. Boegen (A)
 * werden durch einige Zwischenpunkte ersetzt, das reicht fuer Abstaende.
 */
function umrissKanten(d, boegen = []) {
  const pfade = [];
  let akt = null;
  const re = /([MLAZz])([^MLAZz]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const z = m[2].match(/-?[\d.]+(?:e-?\d+)?/g)?.map(Number) ?? [];
    if (m[1] === 'M') {
      akt = [z[0], z[1]];
      pfade.push(akt);
      for (let i = 2; i + 1 < z.length; i += 2) akt.push(z[i], z[i + 1]);
    } else if (m[1] === 'L' && akt) {
      for (let i = 0; i + 1 < z.length; i += 2) akt.push(z[i], z[i + 1]);
    } else if (m[1] === 'A' && akt) {
      for (let i = 0; i + 6 < z.length; i += 7) {
        const x0 = akt[akt.length - 2], y0 = akt[akt.length - 1];
        const x1 = z[i + 5], y1 = z[i + 6], r = z[i];
        // Kreisbogen durch Start und Ende mit Radius r, Richtung aus den Flags
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const h = Math.hypot(x1 - x0, y1 - y0) / 2;
        const tiefe = Math.sqrt(Math.max(0, r * r - h * h));
        const ux = -(y1 - y0) / (2 * h || 1), uy = (x1 - x0) / (2 * h || 1);
        const vorzeichen = z[i + 3] === z[i + 4] ? -1 : 1;
        const cx = mx + ux * tiefe * vorzeichen, cy = my + uy * tiefe * vorzeichen;
        boegen.push({ x: cx, y: cy, r });
        let a0 = Math.atan2(y0 - cy, x0 - cx);
        let a1 = Math.atan2(y1 - cy, x1 - cx);
        if (z[i + 4]) { while (a1 < a0) a1 += 2 * Math.PI; } else { while (a1 > a0) a1 -= 2 * Math.PI; }
        for (let k = 1; k <= 6; k++) {
          const a = a0 + ((a1 - a0) * k) / 6;
          akt.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
      }
    } else if ((m[1] === 'Z' || m[1] === 'z') && akt) {
      akt.push(akt[0], akt[1]);
    }
  }
  return pfade;
}

function abstandZuKanten(px, py, pfade) {
  let min = Infinity;
  for (const p of pfade) {
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
      const dx = bx - ax, dy = by - ay;
      const l = dx * dx + dy * dy;
      let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(ax + t * dx - px, ay + t * dy - py);
      if (d < min) min = d;
    }
  }
  return min;
}

function median(werte) {
  const s = [...werte].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
}

/**
 * Wandelt den HTML-Text eines Exports in Board-Daten um.
 * Liefert { daten: { version, hintergrund, elemente }, bericht }.
 */
export function msWhiteboardUmwandeln(html) {
  const elemente = [];
  const bericht = { striche: 0, textmarker: 0, uebersprungen: {} };

  // Hintergrund: Farbe und ob ein Punktraster aktiv war.
  const bg = html.match(/class="canvasBackgroundColor"[^>]*fill="([^"]+)"/)?.[1];
  const bgFarbe = farbeLesen(bg);
  const hell = bgFarbe.r + bgFarbe.g + bgFarbe.b > 380;
  const hintergrund = {
    farbe: hell ? 'white' : 'slate',
    muster: /fill="url\(#Dot/.test(html) ? 'dots' : /fill="url\(#(Grid|Square)/i.test(html) ? 'grid' : 'none',
  };

  const anker = html.split(/<div class="anchor\b/).slice(1);
  let z = 0;
  for (const teil of anker) {
    const typ = teil.match(/data-whiteboard-type="([^"]+)"/)?.[1] ?? 'Unbekannt';
    if (typ !== 'InkGroup') {
      if (typ !== 'CommentThread') bericht.uebersprungen[typ] = (bericht.uebersprungen[typ] ?? 0) + 1;
      continue;
    }
    const kopf = teil.slice(0, teil.indexOf('>'));
    const links = +(kopf.match(/left:\s*(-?[\d.]+)px/)?.[1] ?? 0);
    const oben = +(kopf.match(/top:\s*(-?[\d.]+)px/)?.[1] ?? 0);
    const ankerM = matrix(kopf.match(/transform:\s*(matrix\([^)]*\))/)?.[1]);

    // viewBox -> Pixel des svg (bisher immer 1:1, aber sicher ist sicher)
    const svg = teil.match(/<svg class="inkGroup[^"]*"[^>]*>/)?.[0] ?? '';
    const vb = svg.match(/viewBox="([^"]+)"/)?.[1].split(/\s+/).map(Number) ?? [0, 0, 1, 1];
    const sw = +(svg.match(/width="([\d.]+)"/)?.[1] ?? vb[2]);
    const sh = +(svg.match(/height="([\d.]+)"/)?.[1] ?? vb[3]);
    const sx = vb[2] ? sw / vb[2] : 1;
    const sy = vb[3] ? sh / vb[3] : 1;

    const striche = teil.matchAll(/<g class="inkStroke[^"]*"[^>]*?transform="([^"]*)"[^>]*>([\s\S]*?)<\/g>/g);
    for (const [, gTransform, inhalt] of striche) {
      const pfad = inhalt.match(/<path[^>]*\sd="([^"]+)"[^>]*>/);
      const linie = inhalt.match(/<polyline[^>]*points="([^"]+)"/);
      if (!linie) continue;
      const gM = matrix(gTransform);
      const fill = farbeLesen(pfad?.[0].match(/fill="([^"]+)"/)?.[1]);

      // lokale Koordinaten -> Welt
      const welt = (x, y) => {
        const [gx, gy] = anwenden(gM, x, y);
        const [ax, ay] = anwenden(ankerM, (gx - vb[0]) * sx, (gy - vb[1]) * sy);
        return [ax + links, ay + oben];
      };
      const skala = Math.hypot(gM[0], gM[1]) * sx;

      const roh = linie[1].trim().split(/[\s,]+/).map(Number);
      const mitte = [];
      for (let i = 0; i + 1 < roh.length; i += 2) mitte.push(roh[i], roh[i + 1]);
      if (!mitte.length) continue;

      // Halbe Breite je Punkt. Whiteboard rundet jede Ecke mit einem Bogen
      // um den Punkt der Mittellinie, Radius = halbe Breite dort. Das ist
      // die verlaessliche Quelle. Der Abstand zur naechsten Umrisskante
      // taugt nur als Notbehelf: Laeuft ein Strich ueber sich selbst (das
      // "p" hoch und wieder runter), liegt dort die Kante des anderen
      // Strichteils, und die Breite kaeme viel zu klein heraus.
      const boegen = [];
      const kanten = pfad ? umrissKanten(pfad[1], boegen) : [];
      const halb = [];
      for (let i = 0; i < mitte.length; i += 2) {
        let best = null;
        let bestD = Infinity;
        for (const b of boegen) {
          const d = Math.hypot(b.x - mitte[i], b.y - mitte[i + 1]);
          if (d < bestD && d < Math.max(0.35 * b.r, 4)) { bestD = d; best = b.r; }
        }
        halb.push(best !== null ? best * skala : null);
      }
      // Punkte ohne Bogen (fast gerade Stellen): zwischen den Nachbarn
      // mit Bogen interpolieren.
      for (let i = 0; i < halb.length; i++) {
        if (halb[i] !== null) continue;
        let a = i - 1;
        while (a >= 0 && halb[a] === null) a--;
        let b = i + 1;
        while (b < halb.length && halb[b] === null) b++;
        if (a >= 0 && b < halb.length) halb[i] = halb[a] + ((halb[b] - halb[a]) * (i - a)) / (b - a);
        else if (a >= 0) halb[i] = halb[a];
        else if (b < halb.length) halb[i] = halb[b];
      }
      // Ganz ohne Boegen: Abstand zur Kante als Notbehelf.
      for (let i = 0; i < halb.length; i++) {
        if (halb[i] !== null) continue;
        const d = abstandZuKanten(mitte[i * 2], mitte[i * 2 + 1], kanten);
        halb[i] = Number.isFinite(d) && d > 0 ? d * skala : null;
      }
      const gueltig = halb.filter((h) => h !== null);
      const ersatz = gueltig.length ? median(gueltig) : 1;
      for (let i = 0; i < halb.length; i++) if (halb[i] === null) halb[i] = ersatz;
      // Die Grundbreite so waehlen, dass die breiteste Stelle genau bei
      // vollem Druck liegt (breiteBeiDruck: 0.4 bis 1.6 mal Grundbreite).
      // So passen Schwankungen bis Faktor 4 ohne Abschneiden hinein.
      const maxHalb = Math.max(...halb);
      const variiert = maxHalb / Math.max(Math.min(...halb), 0.01) > 1.2 && halb.length > 2;
      const breite = variiert
        ? Math.max(0.3, Math.round(((maxHalb * 2) / 1.6) * 100) / 100)
        : Math.max(0.5, Math.round(median(halb) * 2 * 100) / 100);

      const punkte = [];
      const druck = [];
      for (let i = 0; i < mitte.length; i += 2) {
        const [x, y] = welt(mitte[i], mitte[i + 1]);
        const n = punkte.length;
        // Doppelte Punkte bringen dem Spline nichts
        if (n && Math.abs(punkte[n - 2] - x) < 0.01 && Math.abs(punkte[n - 1] - y) < 0.01) continue;
        punkte.push(runden(x), runden(y));
        // Umkehrung von breiteBeiDruck(): breite * (0.4 + 1.2 p)
        const p = ((2 * halb[i / 2]) / breite - 0.4) / 1.2;
        druck.push(Math.round(Math.min(1, Math.max(0, p)) * 100) / 100);
      }

      const textmarker = fill.a < 0.9;
      const tinte = textmarker ? null : naechsteTinte(fill.r, fill.g, fill.b);
      const el = {
        id: neueId(),
        typ: 'strich',
        z: z++,
        farbe: tinte ?? alsHex(fill.r, fill.g, fill.b),
        breite,
        punkte,
        druck: variiert && !textmarker ? druck : null,
      };
      // Whiteboard verbindet die Punkte gerade, mit runden Ecken. Eine
      // Kurve durch dieselben Punkte wuerde bei engen Buchstaben ausbeulen.
      el.eckig = true;
      if (textmarker) el.textmarker = true;
      elemente.push(el);
      bericht[textmarker ? 'textmarker' : 'striche']++;
    }
  }

  return { daten: { version: 1, hintergrund, elemente }, bericht };
}
