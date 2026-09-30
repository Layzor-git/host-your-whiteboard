// Einstellungen, die fuer alle Boards gelten: Stift-Slots, Radierer,
// Formen, Stiftgefuehl, Darstellung. Liegen im Browser (localStorage), wie
// im Design vorgesehen. Jedes Geraet darf seine eigenen haben: Auf dem iPad
// will man vielleicht andere Stifte als am Wacom.

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
  // Eigener Name statt "auswahl": Wer schon 'rechteck' gespeichert hat,
  // bekommt so trotzdem den Pfeil als neuen Standard.
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
    // kaputt oder nicht erlaubt: Standard
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
    // privater Modus: gilt dann nur fuer diese Sitzung
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

/** Setzt wb-light / wb-dark auf <html>, auch wenn das System umschaltet. */
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

/** Touch-Geraet? (iPad) Dann gibt es Finger-Schalter und Schnellumschalter. */
export const istTouch = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;
