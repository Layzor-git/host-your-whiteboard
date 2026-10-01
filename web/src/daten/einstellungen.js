// Settings that apply to all boards: pen slots, eraser, shapes, pen feel,
// appearance. Stored in the browser (localStorage), as intended by the
// design. Every device may have its own: on the iPad you may want
// different pens than on the Wacom.

import { useSyncExternalStore } from 'react';

const SCHLUESSEL = 'wb.einstellungen.1';

export const STANDARD = {
  slots: [
    { art: 'stift', farbe: 'graphite', breite: 3 },
    { art: 'stift', farbe: 'blue', breite: 5 },
    { art: 'stift', farbe: 'red', breite: 9 },
    { art: 'marker', farbe: 'hl-yellow', breite: 20 },
  ],
  letzterSlot: 0,
  radierer: { modus: 'strich', groesse: 28 },
  form: { art: 'rechteck', farbe: 'blue', fuellung: null, breite: 3 },
  // A new name instead of "auswahl": whoever already saved 'rechteck'
  // still gets the pointer as the new default.
  auswahlArt: 'pfeil', // 'pfeil' | 'rechteck' | 'lasso'
  eigeneFarben: [],
  glaettung: 50,
  druck: true,
  fingerZeichnet: false,
  darstellung: 'system', // 'hell' | 'dunkel' | 'system'
  sprache: 'en', // 'en' | 'de' (siehe i18n/)
  sortierung: 'zuletzt', // 'zuletzt' | 'name'
  bibFilter: 'alle', // 'alle' | 'meine' | 'geteilt'
};

export const BREITEN = { stift: [1, 24], marker: [8, 40], radierer: [8, 80], form: [1, 24] };

function laden() {
  try {
    const roh = JSON.parse(localStorage.getItem(SCHLUESSEL));
    if (roh && typeof roh === 'object') return { ...STANDARD, ...roh };
  } catch {
    // broken or not allowed: default
  }
  return STANDARD;
}

let stand = laden();
const hoerer = new Set();

export function einstellungen() {
  return stand;
}

export function einstellungenSetzen(teil) {
  stand = { ...stand, ...(typeof teil === 'function' ? teil(stand) : teil) };
  try {
    localStorage.setItem(SCHLUESSEL, JSON.stringify(stand));
  } catch {
    // private mode: then it only applies to this session
  }
  for (const h of hoerer) h();
}

export function slotSetzen(i, teil) {
  einstellungenSetzen((s) => ({ slots: s.slots.map((x, j) => (j === i ? { ...x, ...teil } : x)) }));
}

export function abonnieren(fn) {
  hoerer.add(fn);
  return () => hoerer.delete(fn);
}

export function useEinstellungen() {
  return useSyncExternalStore(abonnieren, einstellungen);
}

// ---------------------------------------------------------------- Theme

const dunkelAbfrage = globalThis.matchMedia?.('(prefers-color-scheme: dark)');

export function aktivesTheme(darstellung = stand.darstellung) {
  if (darstellung === 'hell') return 'light';
  if (darstellung === 'dunkel') return 'dark';
  return dunkelAbfrage?.matches ? 'dark' : 'light';
}

/** Sets wb-light / wb-dark on <html>, even when the system switches. */
export function themeAnwenden() {
  const setzen = () => {
    const t = aktivesTheme();
    document.documentElement.classList.toggle('wb-light', t === 'light');
    document.documentElement.classList.toggle('wb-dark', t === 'dark');
    document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute('content', t === 'dark' ? '#151619' : '#f5f5f3');
  };
  setzen();
  hoerer.add(setzen);
  dunkelAbfrage?.addEventListener?.('change', setzen);
}

/** Touch device? (iPad) Then there are finger toggles and quick switches. */
export const istTouch = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;
