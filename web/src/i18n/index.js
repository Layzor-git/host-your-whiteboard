// Uebersetzungen. Englisch ist Standard, Deutsch waehlbar in den
// Einstellungen. Die Texte stehen in en.js und de.js unter denselben
// Schluesseln; i18n-pruefen.mjs stellt vor jedem Bau sicher, dass beide
// vollstaendig sind und dieselben Platzhalter benutzen.
//
//   t('common.library')                        einfacher Text
//   t('count.boards', { anzahl: 3 })           Mehrzahl: { one, other }
//   t('share.added', { email: 'a@b.de' })      Platzhalter {email}
//
// In Komponenten useT() statt t(): Dann zeichnen sie sich beim Umschalten
// der Sprache neu.

import { useMemo } from 'react';
import { abonnieren, einstellungen, useEinstellungen } from '../daten/einstellungen.js';
import en from './en.js';
import de from './de.js';

export const SPRACHEN = [
  { wert: 'en', text: 'English' },
  { wert: 'de', text: 'Deutsch' },
];

const BUECHER = { en, de };

export function sprache() {
  const s = einstellungen().sprache;
  return BUECHER[s] ? s : 'en';
}

/** Gibt es diesen Schluessel? (Fuer Codes vom Server, die nicht jeder kennt.) */
export function gibtEs(schluessel) {
  return schluessel in BUECHER.en;
}

export function t(schluessel, werte = {}, s = sprache()) {
  let eintrag = BUECHER[s][schluessel] ?? BUECHER.en[schluessel];
  if (eintrag === undefined) {
    // Faellt im Bau schon auf (i18n-pruefen.mjs); zur Laufzeit lieber den
    // Schluessel zeigen als abzustuerzen.
    return schluessel;
  }
  if (typeof eintrag === 'object') {
    const form = new Intl.PluralRules(s).select(Number(werte.anzahl ?? 0));
    eintrag = eintrag[form] ?? eintrag.other;
  }
  return eintrag.replace(/\{(\w+)\}/g, (ganz, k) => (werte[k] !== undefined ? String(werte[k]) : ganz));
}

/** t() fuer Komponenten: zeichnet neu, wenn die Sprache wechselt. */
export function useT() {
  const s = useEinstellungen().sprache;
  return useMemo(() => {
    const aktiv = BUECHER[s] ? s : 'en';
    return (schluessel, werte) => t(schluessel, werte, aktiv);
  }, [s]);
}

/** lang-Attribut von <html> nachziehen (Silbentrennung, Screenreader). */
export function spracheAnwenden() {
  const setzen = () => { document.documentElement.lang = sprache(); };
  setzen();
  abonnieren(setzen);
}
