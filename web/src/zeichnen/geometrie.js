// Kleine Geometrie-Helfer. Punkte liegen durchgehend als flache Zahlenlisten
// vor ([x0, y0, x1, y1, ...]). Das spart Objekte und damit Arbeit fuer die
// Speicherbereinigung, und die faellt waehrend des Zeichnens als Ruckler auf.
//
// Grenzen sind Rechtecke { x1, y1, x2, y2 } in Weltkoordinaten.

export function abstandQuadPunktStrecke(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + t * dx - px;
  const y = ay + t * dy - py;
  return x * x + y * y;
}

function lage(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Kleinster Abstand zum Quadrat zwischen zwei Strecken AB und CD. */
export function abstandQuadStrecken(ax, ay, bx, by, cx, cy, dx, dy) {
  const o1 = lage(ax, ay, bx, by, cx, cy);
  const o2 = lage(ax, ay, bx, by, dx, dy);
  const o3 = lage(cx, cy, dx, dy, ax, ay);
  const o4 = lage(cx, cy, dx, dy, bx, by);
  if (o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0) return 0;
  return Math.min(
    abstandQuadPunktStrecke(ax, ay, cx, cy, dx, dy),
    abstandQuadPunktStrecke(bx, by, cx, cy, dx, dy),
    abstandQuadPunktStrecke(cx, cy, ax, ay, bx, by),
    abstandQuadPunktStrecke(dx, dy, ax, ay, bx, by),
  );
}

/**
 * Ramer-Douglas-Peucker: welche Punkte man behalten muss, damit die Linie
 * nirgends mehr als eps von der urspruenglichen abweicht. Iterativ, weil
 * ein langer Strich sonst den Aufrufstapel sprengen kann.
 */
export function rdp(pts, eps) {
  const n = pts.length / 2;
  const behalten = new Uint8Array(n);
  if (n === 0) return behalten;
  behalten[0] = 1;
  behalten[n - 1] = 1;
  const eps2 = eps * eps;
  const stapel = [0, n - 1];
  while (stapel.length) {
    const j = stapel.pop();
    const i = stapel.pop();
    if (j - i < 2) continue;
    const ax = pts[i * 2], ay = pts[i * 2 + 1];
    const bx = pts[j * 2], by = pts[j * 2 + 1];
    let max = -1;
    let wo = -1;
    for (let k = i + 1; k < j; k++) {
      const d = abstandQuadPunktStrecke(pts[k * 2], pts[k * 2 + 1], ax, ay, bx, by);
      if (d > max) { max = d; wo = k; }
    }
    if (max > eps2) {
      behalten[wo] = 1;
      stapel.push(i, wo, wo, j);
    }
  }
  return behalten;
}

export function grenzenVon(pts, schritt = 2) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (let i = 0; i < pts.length; i += schritt) {
    const x = pts[i], y = pts[i + 1];
    if (x < x1) x1 = x;
    if (x > x2) x2 = x;
    if (y < y1) y1 = y;
    if (y > y2) y2 = y;
  }
  return { x1, y1, x2, y2 };
}

export function erweitert(g, r) {
  return { x1: g.x1 - r, y1: g.y1 - r, x2: g.x2 + r, y2: g.y2 + r };
}

export function vereinigt(a, b) {
  return {
    x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1),
    x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2),
  };
}

export function ueberlappen(a, b) {
  return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1;
}

export function runden(v) {
  return Math.round(v * 100) / 100;
}
