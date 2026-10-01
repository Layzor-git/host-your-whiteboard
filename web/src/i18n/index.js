// Translations. English is the default, German can be selected in the
// settings. The texts live in en.js and de.js under the same keys;
// i18n-pruefen.mjs makes sure before every build that both are complete
// and use the same placeholders.
//
//   t('common.library')                        plain text
//   t('count.boards', { anzahl: 3 })           plural: { one, other }
//   t('share.added', { email: 'a@b.de' })      placeholder {email}
//
// In components use useT() instead of t(): then they re-render when the
// language is switched.

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

/** Does this key exist? (For codes from the server that not everyone knows.) */
export function gibtEs(schluessel) {
  return schluessel in BUECHER.en;
}

export function t(schluessel, werte = {}, s = sprache()) {
  let eintrag = BUECHER[s][schluessel] ?? BUECHER.en[schluessel];
  if (eintrag === undefined) {
    // Already caught at build time (i18n-pruefen.mjs); at runtime better
    // show the key than crash.
    return schluessel;
  }
  if (typeof eintrag === 'object') {
    const form = new Intl.PluralRules(s).select(Number(werte.anzahl ?? 0));
    eintrag = eintrag[form] ?? eintrag.other;
  }
  return eintrag.replace(/\{(\w+)\}/g, (ganz, k) => (werte[k] !== undefined ? String(werte[k]) : ganz));
}

/** t() for components: re-renders when the language changes. */
export function useT() {
  const s = useEinstellungen().sprache;
  return useMemo(() => {
    const aktiv = BUECHER[s] ? s : 'en';
    return (schluessel, werte) => t(schluessel, werte, aktiv);
  }, [s]);
}

/** Keep the lang attribute of <html> in sync (hyphenation, screen readers). */
export function spracheAnwenden() {
  const setzen = () => { document.documentElement.lang = sprache(); };
  setzen();
  abonnieren(setzen);
}
