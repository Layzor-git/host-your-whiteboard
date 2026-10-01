// Palettes from the design (tokens.ts). Strokes store the color id, never
// the hex value. It is only resolved when drawing, depending on the CANVAS
// COLOR: on the dark "chalkboard" graphite becomes light. That way the
// same drawing stays readable on every background.
//
// Custom colors are stored as "#rrggbb" and are not switched.

export const INK = [
  { id: 'graphite', name: 'Graphit', light: '#1f2023', dark: '#ecebe6' },
  { id: 'grey', name: 'Grau', light: '#767982', dark: '#a5a8af' },
  { id: 'red', name: 'Rot', light: '#d8352c', dark: '#ff7a6c' },
  { id: 'orange', name: 'Orange', light: '#e36c0a', dark: '#ffa155' },
  { id: 'yellow', name: 'Ocker', light: '#b08400', dark: '#ffd64a' },
  { id: 'green', name: 'Grün', light: '#2c8a3d', dark: '#6fd27e' },
  { id: 'teal', name: 'Petrol', light: '#0e8585', dark: '#4fcfc6' },
  { id: 'blue', name: 'Blau', light: '#1f6ed8', dark: '#6ca8ff' },
  { id: 'indigo', name: 'Indigo', light: '#4c4fd0', dark: '#9c9eff' },
  { id: 'purple', name: 'Violett', light: '#8a3fc6', dark: '#c68cff' },
  { id: 'pink', name: 'Pink', light: '#d1307f', dark: '#ff86bd' },
  { id: 'brown', name: 'Braun', light: '#8a5a2c', dark: '#d3a272' },
];

export const HIGHLIGHTER = [
  { id: 'hl-yellow', name: 'Gelb', light: 'rgba(255,220,50,.55)', dark: 'rgba(255,220,50,.34)' },
  { id: 'hl-green', name: 'Grün', light: 'rgba(110,225,110,.45)', dark: 'rgba(110,225,110,.3)' },
  { id: 'hl-pink', name: 'Rosa', light: 'rgba(255,125,185,.42)', dark: 'rgba(255,125,185,.3)' },
  { id: 'hl-blue', name: 'Blau', light: 'rgba(100,185,255,.42)', dark: 'rgba(100,185,255,.3)' },
  { id: 'hl-orange', name: 'Orange', light: 'rgba(255,165,70,.45)', dark: 'rgba(255,165,70,.3)' },
  { id: 'hl-purple', name: 'Flieder', light: 'rgba(185,145,255,.42)', dark: 'rgba(185,145,255,.3)' },
];

export const CANVAS_BG = [
  { id: 'white', name: 'Weiß', color: '#fbfbfa' },
  { id: 'paper', name: 'Papier', color: '#f6f2e8' },
  { id: 'grey', name: 'Nebel', color: '#eef0f2' },
  { id: 'mint', name: 'Mint', color: '#e8f3ed' },
  { id: 'sky', name: 'Himmel', color: '#e7eef8' },
  { id: 'slate', name: 'Tafel', color: '#1f2124', dark: true },
];

export const PATTERN = {
  none: { name: 'Keins' },
  dots: { name: 'Punkte', step: 24, dotRadius: 1.3 },
  grid: { name: 'Karo', step: 32 },
  lines: { name: 'Liniert', step: 34 },
};

export const MUSTER_FARBE = { light: 'rgba(30,32,48,.17)', dark: 'rgba(255,255,255,.13)' };

/** Opacity for a highlighter with a custom hex color. */
export const TEXTMARKER_EIGEN_DECKKRAFT = 0.45;

// Ink color -> matching highlighter color (and back), for recoloring a
// selection with strokes and highlighters. Without a counterpart the ink
// color stays, and the highlighter draws it translucent.
const MARKER_ZU_TINTE = {
  'hl-yellow': 'yellow', 'hl-green': 'green', 'hl-pink': 'pink',
  'hl-blue': 'blue', 'hl-orange': 'orange', 'hl-purple': 'purple',
};
const TINTE_ZU_MARKER = Object.fromEntries(Object.entries(MARKER_ZU_TINTE).map(([m, t]) => [t, m]));

export function markerFarbeZu(tinte) {
  return TINTE_ZU_MARKER[tinte] ?? tinte;
}

export function markerAlsTinte(farbe) {
  return MARKER_ZU_TINTE[farbe] ?? farbe;
}

const NACH_ID = new Map([...INK, ...HIGHLIGHTER].map((f) => [f.id, f]));

export function leinwand(id) {
  return CANVAS_BG.find((c) => c.id === id) ?? CANVAS_BG[0];
}

/** Color id or hex into a CSS color for the given canvas. */
export function farbeAufloesen(farbe, dunkel) {
  const f = NACH_ID.get(farbe);
  if (f) return dunkel ? f.dark : f.light;
  return farbe || '#1f2023';
}

function rgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** Nearest palette color if it is close enough, otherwise null. */
export function naechsteTinte(r, g, b, grenze = 40) {
  let beste = null;
  let min = Infinity;
  for (const f of INK) {
    const [fr, fg, fb] = rgb(f.light);
    const d = Math.hypot(fr - r, fg - g, fb - b);
    if (d < min) { min = d; beste = f.id; }
  }
  return min <= grenze ? beste : null;
}

export function alsHex(r, g, b) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}
