// What can lie on the canvas. Every kind describes itself through the same
// interface; document, renderer and eraser only know this one:
//
//   grenzen(el)        rectangle in world coordinates, including stroke width
//   zeichnen(ctx, el, dunkel)
//                      in world coordinates, the transform is already set.
//                      dunkel = the canvas is dark, determines the ink color
//   treffer(el)        densely sampled center lines for hit tests: [xy]
//   stuetzen(el)       the stored control points for the point eraser:
//                      [{ xy, druck, eckig }], empty = not erasable
//   halbeBreite(el)
//
// Text and image come later as further entries in ARTEN.
//
// Elements are immutable. Whoever changes one creates a new object with
// the same id. That is why paths and bounds may be cached on the object
// itself (WeakMap), and the undo history only has to remember old and new
// objects.

import {
  abstandQuadPunktStrecke, abstandQuadStrecken, erweitert, grenzenVon, runden,
} from './geometrie.js';

import { farbeAufloesen, TEXTMARKER_EIGEN_DECKKRAFT } from './farben.js';
import { GifAnimation } from './gif.js';

/** Opacity of a highlighter: palette colors already bring it along. */
export function markerDeckkraft(farbe) {
  // Highlighter colors (hl-...) bring their own transparency; custom colors
  // and ink colors (after recoloring a selection) become translucent.
  return farbe?.startsWith('hl-') ? 1 : TEXTMARKER_EIGEN_DECKKRAFT;
}

let zaehler = 0;
/** Short and without crypto.randomUUID, which only exists under HTTPS. */
export function neueId() {
  zaehler = (zaehler + 1) % 1296;
  return Date.now().toString(36) + zaehler.toString(36).padStart(2, '0')
    + Math.random().toString(36).slice(2, 6);
}

const zwischen = new WeakMap();
function cache(el, bauen) {
  let c = zwischen.get(el);
  if (!c) {
    c = bauen(el);
    zwischen.set(el, c);
  }
  return c;
}

/** Stroke width depending on pressure: exactly the set width at medium pressure. */
export function breiteBeiDruck(breite, p) {
  return breite * (0.4 + 1.2 * p);
}

// ---------------------------------------------------------------- Stroke

// A stroke stores only the simplified points. What gets drawn is a
// Catmull-Rom spline through them, as cubic Bezier curves.

function catmullRom(P, i, n) {
  const i0 = Math.max(i - 1, 0);
  const i3 = Math.min(i + 2, n - 1);
  const x0 = P[i0 * 2], y0 = P[i0 * 2 + 1];
  const x1 = P[i * 2], y1 = P[i * 2 + 1];
  const x2 = P[i * 2 + 2], y2 = P[i * 2 + 3];
  const x3 = P[i3 * 2], y3 = P[i3 * 2 + 1];
  return [
    x1, y1,
    x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6,
    x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6,
    x2, y2,
  ];
}

/** Densely sampled course of the spline: [x, y, druck, ...]. */
function strichProben(el) {
  const P = el.punkte;
  const D = el.druck;
  const n = P.length / 2;
  const p = (i) => (D ? D[i] : 0.5);
  const out = [];
  if (n === 1 || el.eckig) {
    for (let i = 0; i < n; i++) out.push(P[i * 2], P[i * 2 + 1], p(i));
    return out;
  }
  for (let i = 0; i < n - 1; i++) {
    const [ax, ay, bx, by, cx, cy, dx, dy] = catmullRom(P, i, n);
    const m = Math.min(64, Math.max(1, Math.ceil(Math.hypot(dx - ax, dy - ay))));
    for (let k = i === 0 ? 0 : 1; k <= m; k++) {
      const t = k / m;
      const u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      out.push(
        a * ax + b * bx + c * cx + d * dx,
        a * ay + b * by + c * cy + d * dy,
        p(i) + (p(i + 1) - p(i)) * t,
      );
    }
  }
  return out;
}

const KAPPE = 10; // points per round stroke cap

/**
 * Outline of a stroke with varying width as a closed polygon [x, y, ...].
 * P is [x, y, druck, ...], sampled densely enough that straight segments
 * suffice. Used by the canvas, the live preview and the SVG export.
 */
export function umrissPolygon(P, breite) {
  const n = P.length / 3;
  const out = [];
  if (n === 0) return out;
  const r = (i) => breiteBeiDruck(breite, P[i * 3 + 2]) / 2;
  const kappe = (x, y, rad, von) => {
    for (let k = 1; k < KAPPE; k++) {
      const a = von - (Math.PI * k) / KAPPE;
      out.push(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
  };
  if (n === 1) {
    for (let k = 0; k < KAPPE * 2; k++) {
      const a = (Math.PI * k) / KAPPE;
      out.push(P[0] + Math.cos(a) * r(0), P[1] + Math.sin(a) * r(0));
    }
    return out;
  }
  const nx = new Float64Array(n);
  const ny = new Float64Array(n);
  let lx = 0, ly = 1;
  for (let i = 0; i < n; i++) {
    const a = Math.max(i - 1, 0) * 3;
    const b = Math.min(i + 1, n - 1) * 3;
    const tx = P[b] - P[a];
    const ty = P[b + 1] - P[a + 1];
    const l = Math.hypot(tx, ty);
    if (l > 0) { lx = -ty / l; ly = tx / l; }
    nx[i] = lx;
    ny[i] = ly;
  }
  for (let i = 0; i < n; i++) out.push(P[i * 3] + nx[i] * r(i), P[i * 3 + 1] + ny[i] * r(i));
  const e = n - 1;
  kappe(P[e * 3], P[e * 3 + 1], r(e), Math.atan2(ny[e], nx[e]));
  for (let i = e; i >= 0; i--) out.push(P[i * 3] - nx[i] * r(i), P[i * 3 + 1] - ny[i] * r(i));
  kappe(P[0], P[1], r(0), Math.atan2(ny[0], nx[0]) + Math.PI);
  return out;
}

export function polygonPfad(pts) {
  const pfad = new Path2D();
  if (!pts.length) return pfad;
  pfad.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) pfad.lineTo(pts[i], pts[i + 1]);
  pfad.closePath();
  return pfad;
}

export function umrissPfad(P, breite) {
  return polygonPfad(umrissPolygon(P, breite));
}

/**
 * Angular stroke with varying width, the way Microsoft Whiteboard draws
 * ink: a trapezoid per segment, a circle at every point. The pieces
 * overlap; filled with nonzero this gives one area without double
 * coverage. Returns the partial polygons.
 */
export function kapselPolygone(P, breite) {
  const n = P.length / 3;
  const teile = [];
  const r = (i) => breiteBeiDruck(breite, P[i * 3 + 2]) / 2;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], ri = r(i);
    const kreis = [];
    for (let k = 0; k < 16; k++) {
      const a = (Math.PI * 2 * k) / 16;
      kreis.push(x + Math.cos(a) * ri, y + Math.sin(a) * ri);
    }
    teile.push(kreis);
    if (i === n - 1) break;
    const x2 = P[i * 3 + 3], y2 = P[i * 3 + 4], r2 = r(i + 1);
    const l = Math.hypot(x2 - x, y2 - y);
    if (!l) continue;
    const nx = -(y2 - y) / l, ny = (x2 - x) / l;
    // Same winding direction as the circles, otherwise overlaps cancel
    // each other out when filling.
    teile.push([x - nx * ri, y - ny * ri, x2 - nx * r2, y2 - ny * r2, x2 + nx * r2, y2 + ny * r2, x + nx * ri, y + ny * ri]);
  }
  return teile;
}

function strichBauen(el) {
  const P = el.punkte;
  const n = P.length / 2;
  const proben = strichProben(el);
  let pfad;
  let flaeche = false;
  if (el.druck && el.eckig) {
    pfad = new Path2D();
    for (const t of kapselPolygone(proben, el.breite)) pfad.addPath(polygonPfad(t));
    flaeche = true;
  } else if (el.druck) {
    pfad = umrissPfad(proben, el.breite);
    flaeche = true;
  } else if (n === 1) {
    pfad = new Path2D();
    pfad.arc(P[0], P[1], el.breite / 2, 0, Math.PI * 2);
    flaeche = true;
  } else {
    pfad = new Path2D();
    pfad.moveTo(P[0], P[1]);
    for (let i = 0; i < n - 1; i++) {
      if (el.eckig) {
        pfad.lineTo(P[i * 2 + 2], P[i * 2 + 3]);
      } else {
        const [, , bx, by, cx, cy, dx, dy] = catmullRom(P, i, n);
        pfad.bezierCurveTo(bx, by, cx, cy, dx, dy);
      }
    }
  }
  const xy = [];
  for (let i = 0; i < proben.length; i += 3) xy.push(proben[i], proben[i + 1]);
  const rand = el.druck ? breiteBeiDruck(el.breite, 1) / 2 : el.breite / 2;
  return {
    pfad,
    flaeche,
    grenzen: erweitert(grenzenVon(proben, 3), rand + 1),
    treffer: [xy],
    stuetzen: [{ xy: P, druck: el.druck, eckig: !!el.eckig }],
  };
}

const STRICH = {
  grenzen: (el) => cache(el, strichBauen).grenzen,
  treffer: (el) => cache(el, strichBauen).treffer,
  stuetzen: (el) => cache(el, strichBauen).stuetzen,
  halbeBreite: (el) => el.breite / 2,
  zeichnen(ctx, el, dunkel) {
    const c = cache(el, strichBauen);
    const farbe = farbeAufloesen(el.farbe, dunkel);
    ctx.globalAlpha = el.textmarker ? markerDeckkraft(el.farbe) : 1;
    if (c.flaeche) {
      ctx.fillStyle = farbe;
      ctx.fill(c.pfad);
    } else {
      ctx.strokeStyle = farbe;
      ctx.lineWidth = el.breite;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(c.pfad);
    }
    ctx.globalAlpha = 1;
  },
};

// ----------------------------------------------------------------- Shape

export const FORMEN = ['linie', 'pfeil', 'rechteck', 'ellipse', 'dreieck'];

/**
 * Rectangle, ellipse and triangle may be rotated (winkel, in radians,
 * around the center). Line and arrow do not need that: their two end
 * points are rotated directly.
 */
function gedreht(el, xy) {
  if (!el.winkel) return xy;
  const cx = (el.x1 + el.x2) / 2;
  const cy = (el.y1 + el.y2) / 2;
  const c = Math.cos(el.winkel);
  const s = Math.sin(el.winkel);
  const out = new Array(xy.length);
  for (let i = 0; i < xy.length; i += 2) {
    const dx = xy[i] - cx;
    const dy = xy[i + 1] - cy;
    out[i] = cx + dx * c - dy * s;
    out[i + 1] = cy + dx * s + dy * c;
  }
  return out;
}

function formLinien(el) {
  return formLinienRoh(el).map((l) => ({ ...l, xy: gedreht(el, l.xy) }));
}

function formLinienRoh(el) {
  const { x1, y1, x2, y2 } = el;
  switch (el.form) {
    case 'linie':
      return [{ xy: [x1, y1, x2, y2], druck: null, eckig: true }];
    case 'pfeil': {
      const a = Math.atan2(y2 - y1, x2 - x1);
      const l = Math.min(Math.max(12, el.breite * 3.5), Math.hypot(x2 - x1, y2 - y1) * 0.6);
      const w = 0.5;
      return [
        { xy: [x1, y1, x2, y2], druck: null, eckig: true },
        {
          xy: [
            x2 - l * Math.cos(a - w), y2 - l * Math.sin(a - w),
            x2, y2,
            x2 - l * Math.cos(a + w), y2 - l * Math.sin(a + w),
          ],
          druck: null,
          eckig: true,
        },
      ];
    }
    case 'rechteck':
      return [{ xy: [x1, y1, x2, y1, x2, y2, x1, y2, x1, y1], druck: null, eckig: true }];
    case 'dreieck': {
      const oben = Math.min(y1, y2), unten = Math.max(y1, y2);
      const links = Math.min(x1, x2), rechts = Math.max(x1, x2);
      const mitte = (x1 + x2) / 2;
      return [{
        xy: [mitte, oben, rechts, unten, links, unten, mitte, oben], druck: null, eckig: true,
      }];
    }
    case 'ellipse': {
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
      const xy = [];
      for (let i = 0; i <= 72; i++) {
        const t = (i / 72) * Math.PI * 2;
        xy.push(cx + rx * Math.cos(t), cy + ry * Math.sin(t));
      }
      return [{ xy, druck: null, eckig: false }];
    }
    default:
      return [];
  }
}

function formBauen(el) {
  const linien = formLinien(el);
  const pfad = new Path2D();
  if (el.form === 'ellipse') {
    pfad.ellipse(
      (el.x1 + el.x2) / 2, (el.y1 + el.y2) / 2,
      Math.abs(el.x2 - el.x1) / 2, Math.abs(el.y2 - el.y1) / 2,
      el.winkel || 0, 0, Math.PI * 2,
    );
  } else {
    for (const { xy } of linien) {
      pfad.moveTo(xy[0], xy[1]);
      for (let i = 2; i < xy.length; i += 2) pfad.lineTo(xy[i], xy[i + 1]);
    }
    if (el.form === 'rechteck' || el.form === 'dreieck') pfad.closePath();
  }
  const alle = linien.flatMap((l) => l.xy);
  return {
    pfad,
    treffer: linien.map((l) => l.xy),
    stuetzen: linien,
    grenzen: erweitert(grenzenVon(alle), el.breite / 2 + 1),
  };
}

const FORM = {
  enthaelt(el, x, y) {
    if (!el.fuellung) return false;
    const xy = cache(el, formBauen).stuetzen[0]?.xy;
    return !!xy && imPolygon(x, y, xy);
  },
  grenzen: (el) => cache(el, formBauen).grenzen,
  treffer: (el) => cache(el, formBauen).treffer,
  stuetzen: (el) => cache(el, formBauen).stuetzen,
  halbeBreite: (el) => el.breite / 2,
  zeichnen(ctx, el, dunkel) {
    const c = cache(el, formBauen);
    if (el.fuellung) {
      ctx.fillStyle = farbeAufloesen(el.fuellung, dunkel);
      ctx.fill(c.pfad);
    }
    ctx.strokeStyle = farbeAufloesen(el.farbe, dunkel);
    ctx.lineWidth = el.breite;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(c.pfad);
  },
};

// --------------------------------------------------------- Shared paths

// ------------------------------------------------------------------ Image

// An image is a rectangle x1..x2, y1..y2 (like the shapes, may be rotated)
// with a reference to the image file (el.bild). How the id becomes a URL
// only the editor knows (it depends on the board); it sets that via
// bildQuelleSetzen().
let bildQuelle = () => null;
const bildSpeicher = new Map(); // URL -> { img, fertig, fehler }
const bildHoerer = new Set();

export function bildQuelleSetzen(fn) {
  bildQuelle = fn;
}

/** fn() as soon as an image has finished loading, so it gets redrawn. */
export function beiBildGeladen(fn) {
  bildHoerer.add(fn);
  return () => bildHoerer.delete(fn);
}

function bildEintrag(el) {
  const url = bildQuelle(el.bild);
  if (!url) return null;
  let e = bildSpeicher.get(url);
  if (!e) {
    const img = new Image();
    e = { img, fertig: false, fehler: false };
    img.onload = () => {
      e.fertig = true;
      for (const f of bildHoerer) f();
      gifPruefen(url, e);
    };
    img.onerror = () => { e.fehler = true; for (const f of bildHoerer) f(); };
    img.src = url;
    bildSpeicher.set(url, e);
  }
  return e;
}

// ---- Animated GIFs
//
// After loading, fetch it once more (comes from the browser cache) and, for
// a GIF with several frames, put a GifAnimation next to it. A clock
// advances the frames and triggers a redraw, but only while the GIF is
// actually being drawn: if it is out of view (or the board is closed), it
// sleeps.

const animiert = new Set();
let uhr = 0;

async function gifPruefen(url, e) {
  try {
    const antwort = await fetch(url);
    if (!/image\/gif/i.test(antwort.headers.get('content-type') ?? '')) return;
    e.gif = GifAnimation.aus(await antwort.arrayBuffer());
    if (e.gif) for (const f of bildHoerer) f();
  } catch {
    // Then it stays still
  }
}

function uhrStellen() {
  if (uhr || !animiert.size) return;
  let warten = Infinity;
  for (const e of animiert) warten = Math.min(warten, e.gif.bisNaechstes);
  uhr = setTimeout(ticken, warten);
}

function ticken() {
  uhr = 0;
  const jetzt = performance.now();
  let neu = false;
  for (const e of animiert) {
    if (jetzt - e.gezeichnet > 1000) animiert.delete(e);
    else if (e.gif.schritt(jetzt)) neu = true;
  }
  if (neu) for (const f of bildHoerer) f();
  uhrStellen();
}

/** What to draw for an image element right now: GIF frame or <img>. */
function bildQuelleFuer(el) {
  const e = bildEintrag(el);
  if (!e?.fertig) return null;
  if (e.gif) {
    e.gezeichnet = performance.now();
    animiert.add(e);
    uhrStellen();
    return e.gif.canvas;
  }
  return e.img;
}

/** The loaded image of an element, or null while it is still loading. */
export function bildFuer(el) {
  const e = bildEintrag(el);
  return e?.fertig ? e.img : null;
}

/** Waits until all images of the elements are loaded (for the export). */
export function bilderLaden(elemente, maxMs = 15000) {
  const offen = elemente
    .filter((el) => el.typ === 'bild')
    .map(bildEintrag)
    .filter((e) => e && !e.fertig && !e.fehler);
  if (!offen.length) return Promise.resolve();
  return Promise.race([
    Promise.all(offen.map((e) => new Promise((ok) => {
      e.img.addEventListener('load', ok, { once: true });
      e.img.addEventListener('error', ok, { once: true });
    }))),
    new Promise((ok) => setTimeout(ok, maxMs)),
  ]);
}

function bildEcken(el) {
  const { x1, y1, x2, y2 } = el;
  return gedreht(el, [x1, y1, x2, y1, x2, y2, x1, y2, x1, y1]);
}

function bildBauen(el) {
  const ecken = bildEcken(el);
  return { ecken, grenzen: erweitert(grenzenVon(ecken), 1) };
}

const BILD = {
  grenzen: (el) => cache(el, bildBauen).grenzen,
  treffer: (el) => [cache(el, bildBauen).ecken],
  stuetzen: () => [],
  halbeBreite: () => 0,
  enthaelt: (el, x, y) => imPolygon(x, y, cache(el, bildBauen).ecken),
  zeichnen(ctx, el) {
    const w = el.x2 - el.x1;
    const h = el.y2 - el.y1;
    ctx.save();
    ctx.translate((el.x1 + el.x2) / 2, (el.y1 + el.y2) / 2);
    if (el.winkel) ctx.rotate(el.winkel);
    // Negative width/height = mirrored (when scaling across the edge)
    ctx.scale(Math.sign(w) || 1, Math.sign(h) || 1);
    const img = bildQuelleFuer(el);
    const aw = Math.abs(w);
    const ah = Math.abs(h);
    if (img) {
      ctx.drawImage(img, -aw / 2, -ah / 2, aw, ah);
    } else {
      // Still loading (or missing): plain area in the size of the image
      ctx.fillStyle = 'rgba(127, 127, 127, 0.14)';
      ctx.fillRect(-aw / 2, -ah / 2, aw, ah);
    }
    ctx.restore();
  },
};

const ARTEN = { strich: STRICH, form: FORM, bild: BILD };

export function art(el) {
  return ARTEN[el.typ];
}

export function grenzen(el) {
  return ARTEN[el.typ].grenzen(el);
}

export function zeichnen(ctx, el, dunkel = false) {
  ARTEN[el.typ].zeichnen(ctx, el, dunkel);
}

/**
 * Is the point inside an area of the element (filled shape, later
 * image)? Always no for strokes, those are only hit on the line.
 */
export function enthaelt(el, x, y) {
  return ARTEN[el.typ].enthaelt?.(el, x, y) ?? false;
}

/** Does a circle with radius r, dragged from A to B, touch the element? */
export function trifft(el, ax, ay, bx, by, r) {
  const a = ARTEN[el.typ];
  const g = r + a.halbeBreite(el);
  const g2 = g * g;
  for (const xy of a.treffer(el)) {
    if (xy.length === 2) {
      if (abstandQuadPunktStrecke(xy[0], xy[1], ax, ay, bx, by) <= g2) return true;
      continue;
    }
    for (let i = 0; i + 3 < xy.length; i += 2) {
      if (abstandQuadStrecken(ax, ay, bx, by, xy[i], xy[i + 1], xy[i + 2], xy[i + 3]) <= g2) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Samples a control line the way it is drawn (spline or straight line)
 * and records for every sample its position as a curve parameter:
 * 2.5 means "halfway between control point 2 and 3".
 */
function abtasten(linie, abstand) {
  const V = linie.xy;
  const D = linie.druck;
  const n = V.length / 2;
  const p = (i) => (D ? D[i] : 0.5);
  const proben = [];
  if (n === 1) return [{ x: V[0], y: V[1], p: p(0), u: 0 }];
  for (let i = 0; i < n - 1; i++) {
    let seg;
    if (linie.eckig) {
      seg = [V[i * 2], V[i * 2 + 1], 0, 0, 0, 0, V[i * 2 + 2], V[i * 2 + 3]];
    } else {
      seg = catmullRom(V, i, n);
    }
    const [ax, ay, bx, by, cx, cy, dx, dy] = seg;
    const laenge = linie.eckig
      ? Math.hypot(dx - ax, dy - ay)
      : Math.hypot(bx - ax, by - ay) + Math.hypot(cx - bx, cy - by) + Math.hypot(dx - cx, dy - cy);
    const m = Math.max(1, Math.ceil(laenge / abstand));
    for (let k = i === 0 ? 0 : 1; k <= m; k++) {
      const t = k / m;
      let x;
      let y;
      if (linie.eckig) {
        x = ax + (dx - ax) * t;
        y = ay + (dy - ay) * t;
      } else {
        const u = 1 - t;
        const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
        x = a * ax + b * bx + c * cx + d * dx;
        y = a * ay + b * by + c * cy + d * dy;
      }
      proben.push({ x, y, p: p(i) + (p(i + 1) - p(i)) * t, u: i + t });
    }
  }
  return proben;
}

/**
 * A remaining piece from sample a to sample b: new end points at the cut
 * edges, the ORIGINAL control points in between. That keeps the shape
 * intact even if the eraser brushes the same piece many times in one
 * gesture. Only the ends are recomputed, never the whole stroke.
 */
function stueckBauen(linie, a, b, naehe) {
  const V = linie.xy;
  const D = linie.druck;
  const xy = [runden(a.x), runden(a.y)];
  const dr = [a.p];
  for (let k = Math.floor(a.u) + 1; k < b.u; k++) {
    const x = V[k * 2];
    const y = V[k * 2 + 1];
    // A control point right next to a new end would give a tiny curve
    // segment with a wild tangent. Better to take the end then.
    if (Math.hypot(x - a.x, y - a.y) < naehe || Math.hypot(x - b.x, y - b.y) < naehe) continue;
    xy.push(x, y);
    dr.push(D ? D[k] : 0.5);
  }
  xy.push(runden(b.x), runden(b.y));
  dr.push(b.p);
  return { xy, druck: dr.map((v) => Math.round(v * 100) / 100) };
}

/**
 * Point eraser: cuts out whatever the circle touches. Returns null if
 * nothing was hit, otherwise the remaining pieces as new strokes (without
 * z, the caller assigns that). Shapes turn into strokes as soon as you
 * erase into them.
 */
export function punktRadieren(el, ax, ay, bx, by, r) {
  const a = ARTEN[el.typ];
  const g = r + a.halbeBreite(el);
  const g2 = g * g;
  const abstand = Math.max(r / 4, 0.25);
  const stuecke = [];
  let getroffen = false;

  for (const linie of a.stuetzen(el)) {
    const proben = abtasten(linie, abstand);
    let start = -1;
    const abschliessen = (ende) => {
      if (start >= 0 && ende > start) {
        stuecke.push({ ...stueckBauen(linie, proben[start], proben[ende], abstand / 2), eckig: linie.eckig });
      }
      start = -1;
    };
    for (let i = 0; i < proben.length; i++) {
      const q = proben[i];
      if (abstandQuadPunktStrecke(q.x, q.y, ax, ay, bx, by) <= g2) {
        getroffen = true;
        abschliessen(i - 1);
      } else if (start < 0) {
        start = i;
      }
    }
    abschliessen(proben.length - 1);
  }
  if (!getroffen) return null;

  const mitDruck = el.typ === 'strich' && !!el.druck;
  return stuecke.map((s) => {
    const neu = {
      id: neueId(),
      typ: 'strich',
      farbe: el.farbe,
      breite: el.breite,
      punkte: s.xy,
      druck: mitDruck ? s.druck : null,
    };
    if (el.textmarker) neu.textmarker = true;
    if (s.eckig) neu.eckig = true;
    return neu;
  });
}

// ------------------------------------------------------------- Transform

/**
 * Apply the affine map M = [a, b, c, d, e, f] (as in Canvas: x' = a x + c y + e,
 * y' = b x + d y + f) to an element. Returns a new object with the same
 * id. Widths grow along with the area scale.
 */
export function transformieren(el, M) {
  const [a, b, c, d, e, f] = M;
  const abb = (x, y) => [a * x + c * y + e, b * x + d * y + f];
  const skala = Math.sqrt(Math.abs(a * d - b * c));
  const breite = Math.round(el.breite * skala * 100) / 100;

  if (el.typ === 'strich') {
    const P = el.punkte;
    const punkte = new Array(P.length);
    for (let i = 0; i < P.length; i += 2) {
      const [x, y] = abb(P[i], P[i + 1]);
      punkte[i] = runden(x);
      punkte[i + 1] = runden(y);
    }
    const neu = { ...el, punkte, breite };
    delete neu._roh;
    return neu;
  }

  if (el.typ === 'form' || el.typ === 'bild') {
    const mitBreite = el.typ === 'form' ? { breite } : {};
    if (el.form === 'linie' || el.form === 'pfeil') {
      const [x1, y1] = abb(el.x1, el.y1);
      const [x2, y2] = abb(el.x2, el.y2);
      return { ...el, x1: runden(x1), y1: runden(y1), x2: runden(x2), y2: runden(y2), breite };
    }
    const sx = Math.hypot(a, b);
    const sy = Math.hypot(c, d);
    const phi = Math.atan2(b, a);
    const schief = Math.abs(a * c + b * d) > 1e-6 * sx * sy;
    const gleichmaessig = Math.abs(sx - sy) < 1e-6 * Math.max(sx, sy);
    const winkel = el.winkel || 0;
    const achsenparallel = Math.abs(Math.sin(2 * winkel)) < 1e-9;

    // No rotation involved: map the corners, done.
    if (!schief && Math.abs(Math.sin(phi)) < 1e-9 && achsenparallel && !winkel) {
      const [x1, y1] = abb(el.x1, el.y1);
      const [x2, y2] = abb(el.x2, el.y2);
      return { ...el, x1: runden(x1), y1: runden(y1), x2: runden(x2), y2: runden(y2), ...mitBreite };
    }
    // Rotate and scale uniformly: map the center, add the angles.
    if (!schief && gleichmaessig && Math.abs(a * d - b * c) > 0) {
      const [mx, my] = abb((el.x1 + el.x2) / 2, (el.y1 + el.y2) / 2);
      const hw = (Math.abs(el.x2 - el.x1) / 2) * sx;
      const hh = (Math.abs(el.y2 - el.y1) / 2) * sx;
      return {
        ...el,
        x1: runden(mx - hw), y1: runden(my - hh), x2: runden(mx + hw), y2: runden(my + hh),
        winkel: winkel + phi,
        ...mitBreite,
      };
    }
    // Stretching a rotated image non-uniformly: shear cannot be
    // represented, so stretch the sides along their own direction.
    if (el.typ === 'bild') {
      const [mx, my] = abb((el.x1 + el.x2) / 2, (el.y1 + el.y2) / 2);
      // Stretch along the image's own width and height directions
      const cw = Math.cos(winkel);
      const sw = Math.sin(winkel);
      const hw = (Math.abs(el.x2 - el.x1) / 2) * Math.hypot(a * cw + c * sw, b * cw + d * sw);
      const hh = (Math.abs(el.y2 - el.y1) / 2) * Math.hypot(-a * sw + c * cw, -b * sw + d * cw);
      return { ...el, x1: runden(mx - hw), y1: runden(my - hh), x2: runden(mx + hw), y2: runden(my + hh) };
    }
    // Everything else (rotated shape stretched non-uniformly) can no longer
    // be described as a shape. Then it turns into strokes.
    return formAlsStriche(el).map((s) => transformieren(s, M));
  }
  return el;
}

/** A shape as ordinary strokes, same id for the first piece. */
export function formAlsStriche(el) {
  return art(el).stuetzen(el).map((l, i) => {
    const s = {
      id: i === 0 ? el.id : neueId(),
      typ: 'strich',
      z: el.z,
      farbe: el.farbe,
      breite: el.breite,
      punkte: l.xy.map(runden),
      druck: null,
    };
    if (l.eckig) s.eckig = true;
    return s;
  });
}

// --------------------------------------------------------- Lasso selection

function imPolygon(x, y, poly) {
  let drin = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) drin = !drin;
  }
  return drin;
}

/** Does the element lie mostly inside the lasso? */
export function imLasso(el, poly) {
  let drin = 0;
  let alle = 0;
  for (const xy of ARTEN[el.typ].treffer(el)) {
    for (let i = 0; i < xy.length; i += 2) {
      alle++;
      if (imPolygon(xy[i], xy[i + 1], poly)) drin++;
    }
  }
  return alle > 0 && drin / alle >= 0.6;
}

// -------------------------------------------------------------- SVG export

const f2 = (v) => Math.round(v * 100) / 100;

/** An element as an SVG snippet, colors fully resolved. */
export function alsSvg(el, dunkel) {
  const farbe = farbeAufloesen(el.farbe, dunkel);
  const marker = el.textmarker
    ? ` style="mix-blend-mode:${dunkel ? 'screen' : 'multiply'}"${markerDeckkraft(el.farbe) < 1 ? ` opacity="${markerDeckkraft(el.farbe)}"` : ''}`
    : '';
  if (el.typ === 'strich') {
    const P = el.punkte;
    const n = P.length / 2;
    if (el.druck || n === 1) {
      const polys = el.druck && el.eckig
        ? kapselPolygone(strichProben(el), el.breite)
        : [el.druck
          ? umrissPolygon(strichProben(el), el.breite)
          : umrissPolygon([P[0], P[1], 0.5], el.breite)];
      let dd = '';
      for (const poly of polys) {
        dd += `M${f2(poly[0])} ${f2(poly[1])}`;
        for (let i = 2; i < poly.length; i += 2) dd += `L${f2(poly[i])} ${f2(poly[i + 1])}`;
        dd += 'Z';
      }
      return `<path d="${dd}" fill="${farbe}"${marker}/>`;
    }
    let dd = `M${f2(P[0])} ${f2(P[1])}`;
    for (let i = 0; i < n - 1; i++) {
      if (el.eckig) {
        dd += `L${f2(P[i * 2 + 2])} ${f2(P[i * 2 + 3])}`;
      } else {
        const [, , bx, by, cx, cy, dx, dy] = catmullRom(P, i, n);
        dd += `C${f2(bx)} ${f2(by)} ${f2(cx)} ${f2(cy)} ${f2(dx)} ${f2(dy)}`;
      }
    }
    return `<path d="${dd}" fill="none" stroke="${farbe}" stroke-width="${el.breite}" stroke-linecap="round" stroke-linejoin="round"${marker}/>`;
  }
  if (el.typ === 'form') {
    const fuellung = el.fuellung ? farbeAufloesen(el.fuellung, dunkel) : 'none';
    const stil = `fill="${fuellung}" stroke="${farbe}" stroke-width="${el.breite}" stroke-linecap="round" stroke-linejoin="round"`;
    if (el.form === 'ellipse') {
      const cx = (el.x1 + el.x2) / 2, cy = (el.y1 + el.y2) / 2;
      const dreh = el.winkel ? ` transform="rotate(${f2((el.winkel * 180) / Math.PI)} ${f2(cx)} ${f2(cy)})"` : '';
      return `<ellipse cx="${f2(cx)}" cy="${f2(cy)}" rx="${f2(Math.abs(el.x2 - el.x1) / 2)}" ry="${f2(Math.abs(el.y2 - el.y1) / 2)}" ${stil}${dreh}/>`;
    }
    const zu = el.form === 'rechteck' || el.form === 'dreieck';
    const dd = art(el).stuetzen(el).map(({ xy }) => {
      let s = `M${f2(xy[0])} ${f2(xy[1])}`;
      for (let i = 2; i < xy.length; i += 2) s += `L${f2(xy[i])} ${f2(xy[i + 1])}`;
      return s + (zu ? 'Z' : '');
    }).join('');
    return `<path d="${dd}" ${stil}/>`;
  }
  if (el.typ === 'bild') {
    const img = bildFuer(el);
    if (!img) return '';
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const x = Math.min(el.x1, el.x2), y = Math.min(el.y1, el.y2);
    const w = Math.abs(el.x2 - el.x1), h = Math.abs(el.y2 - el.y1);
    const cx = (el.x1 + el.x2) / 2, cy = (el.y1 + el.y2) / 2;
    const dreh = el.winkel ? ` transform="rotate(${f2((el.winkel * 180) / Math.PI)} ${f2(cx)} ${f2(cy)})"` : '';
    return `<image href="${c.toDataURL('image/png')}" x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" preserveAspectRatio="none"${dreh}/>`;
  }
  return '';
}
