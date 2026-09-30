// Service Worker anmelden und den Speicher als dauerhaft anfordern.

export function serviceWorkerAnmelden() {
  if (!('serviceWorker' in navigator)) return;
  // Im Entwicklungsmodus stoert er nur, dann liefert Vite direkt aus.
  if (import.meta.env.DEV) return;

  // Lief hier schon einer? Dann ist ein Wechsel eine neue Fassung. Beim
  // allerersten Aufruf uebernimmt der erste Service Worker die Seite, und
  // das ist kein Grund, neu zu laden.
  const hatteSchonEinen = !!navigator.serviceWorker.controller;
  let neueFassungDa = false;
  let laedtNeu = false;

  /**
   * Neu laden, aber nur wenn niemand hinsieht.
   *
   * Hier kommt ein Deployment auf dem Handy ueberhaupt erst an: Der Service
   * Worker holt die neue Fassung von allein und uebernimmt dank skipWaiting
   * sofort. Das ausgelieferte JavaScript laeuft aber weiter, bis die Seite
   * neu geladen wird, und bei einer installierten App passiert das kaum:
   * Man holt sie aus dem Hintergrund zurueck, statt sie zu oeffnen. Man
   * rollt aus, prueft am Handy und sieht die alte Fassung, ohne dass
   * irgendetwas kaputt waere.
   *
   * Sofort neu zu laden waere trotzdem falsch: Es wuerfe weg, was gerade in
   * einem Formular steht.
   */
  function neuLadenWennNiemandHinsieht() {
    if (!neueFassungDa || laedtNeu) return;
    if (document.visibilityState === 'visible') return;
    laedtNeu = true;
    location.reload();
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hatteSchonEinen) return;
    neueFassungDa = true;
    neuLadenWennNiemandHinsieht();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(
      (anmeldung) => {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') return neuLadenWennNiemandHinsieht();
          // Beim Zurueckholen nachsehen, ob es etwas Neues gibt. Ohne das
          // prueft Chrome erst beim naechsten echten Seitenaufruf, und der
          // kommt bei einer App selten.
          return anmeldung.update().catch(() => {});
        });
      },
      (fehler) => console.warn('Service Worker nicht angemeldet:', fehler),
    );
  });
}

/**
 * Browser duerfen lokale Daten loeschen, wenn der Speicher knapp wird.
 * Bei einer installierten App gibt Chrome den Speicher normalerweise als
 * dauerhaft frei, hier fragen wir ausdruecklich an.
 */
export async function speicherSichern() {
  if (!navigator.storage?.persist) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
