// Register the service worker and request persistent storage.

export function serviceWorkerAnmelden() {
  if (!('serviceWorker' in navigator)) return;
  // In development mode it only gets in the way; Vite serves directly then.
  if (import.meta.env.DEV) return;

  // Was one already running here? Then a change means a new version. On
  // the very first visit the first service worker takes over the page, and
  // that is no reason to reload.
  const hatteSchonEinen = !!navigator.serviceWorker.controller;
  let neueFassungDa = false;
  let laedtNeu = false;

  /**
   * Reload, but only when nobody is looking.
   *
   * This is where a deployment reaches the phone in the first place: the
   * service worker fetches the new version on its own and takes over right
   * away thanks to skipWaiting. The JavaScript already served keeps running
   * until the page is reloaded, though, and with an installed app that
   * hardly ever happens: you bring it back from the background instead of
   * opening it. You roll out, check on the phone and see the old version,
   * without anything being broken.
   *
   * Reloading immediately would still be wrong: it would throw away
   * whatever is currently in a form.
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
          // When coming back, check whether there is something new. Without
          // this Chrome only checks on the next real page load, and that
          // rarely happens with an app.
          return anmeldung.update().catch(() => {});
        });
      },
      (fehler) => console.warn('Service worker not registered:', fehler),
    );
  });
}

/**
 * Browsers may delete local data when storage runs low. For an
 * installed app Chrome usually grants persistent storage, here we ask
 * for it explicitly.
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
