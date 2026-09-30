// Bilder vorbereiten und hochladen.
//
// Vorbereiten: Der Browser dekodiert das Bild (auch HEIC auf dem iPad) und
// misst es aus. Sehr grosse Fotos (laengste Seite ueber 4096 px) und
// Formate, die nicht jeder Browser anzeigen kann (HEIC), werden dabei neu
// kodiert. So bleibt der Pi schlank und das Bild laeuft auch am PC.

import { api, KeinNetz, serverMeldung } from '../api.js';
import { t } from '../i18n/index.js';

export const MAX_BYTES = 20 * 1024 * 1024;
const MAX_SEITE = 4096;
const DIREKT = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const BILD_TYPEN = 'image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif';

export function groesseText(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function laden(url) {
  return new Promise((ok, fehler) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fehler(new Error(t('image.cannotOpen')));
    img.src = url;
  });
}

function alsBlob(canvas, typ, qualitaet) {
  return new Promise((ok) => canvas.toBlob(ok, typ, qualitaet));
}

/**
 * Prueft und bereitet eine Datei vor. Liefert { blob, breite, hoehe,
 * vorschau (Object-URL) } oder wirft einen Fehler mit lesbarem Satz.
 */
export async function bildVorbereiten(datei) {
  if (datei.size > MAX_BYTES) {
    throw new Error(t('image.tooLarge', { groesse: groesseText(datei.size) }));
  }
  const vorschau = URL.createObjectURL(datei);
  const img = await laden(vorschau).catch((e) => { URL.revokeObjectURL(vorschau); throw e; });
  const breite = img.naturalWidth;
  const hoehe = img.naturalHeight;
  const zuGross = Math.max(breite, hoehe) > MAX_SEITE;
  if (DIREKT.includes(datei.type) && !zuGross) return { blob: datei, breite, hoehe, vorschau };

  // Neu kodieren: verkleinert und als WebP (Safari kann kein WebP
  // schreiben, dann JPEG; PNG bleibt PNG, wegen der Transparenz)
  const f = Math.min(1, MAX_SEITE / Math.max(breite, hoehe));
  const c = document.createElement('canvas');
  c.width = Math.round(breite * f);
  c.height = Math.round(hoehe * f);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  let blob;
  if (datei.type === 'image/png') {
    blob = await alsBlob(c, 'image/png');
  } else {
    blob = await alsBlob(c, 'image/webp', 0.88);
    if (!blob || blob.type !== 'image/webp') blob = await alsBlob(c, 'image/jpeg', 0.88);
  }
  if (!blob) throw new Error(t('image.convertFailed'));
  if (blob.size > MAX_BYTES) throw new Error(t('image.tooLarge', { groesse: groesseText(blob.size) }));
  return { blob, breite: c.width, hoehe: c.height, vorschau };
}

export function neueBildId() {
  const z = crypto.getRandomValues(new Uint8Array(8));
  return `i_${[...z].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Hochladen mit Fortschritt (fetch kann das nicht, darum XHR).
 * beiFortschritt(0..1). Liefert die Bild-Id.
 */
export function bildHochladen(boardId, blob, { id = neueBildId(), breite, hoehe } = {}, beiFortschritt) {
  return new Promise((ok, fehler) => {
    const xhr = new XMLHttpRequest();
    const q = new URLSearchParams({ id, breite: String(breite ?? ''), hoehe: String(hoehe ?? '') });
    xhr.open('POST', `/api/v1/boards/${encodeURIComponent(boardId)}/bilder?${q}`);
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) beiFortschritt?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status === 201) {
        ok(JSON.parse(xhr.responseText).id);
        return;
      }
      let text = t('upload.failedStatus', { status: xhr.status });
      try { text = serverMeldung(JSON.parse(xhr.responseText)); } catch { /* kein JSON */ }
      fehler(xhr.status >= 500 || xhr.status === 0 ? new KeinNetz(text) : new Error(text));
    };
    xhr.onerror = () => fehler(new KeinNetz(t('error.offline')));
    xhr.send(blob);
  });
}

// ------------------------------------------------------ fuer .whiteboard

function alsDataUrl(blob) {
  return new Promise((ok, fehler) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => fehler(r.error);
    r.readAsDataURL(blob);
  });
}

/** Alle Bilder eines Boards als { id: dataUrl } fuer die Export-Datei. */
export async function bilderEinsammeln(boardId, elemente) {
  const ids = [...new Set(elemente.filter((el) => el.typ === 'bild').map((el) => el.bild))];
  const bilder = {};
  for (const id of ids) {
    try {
      const a = await fetch(api.bildUrl(boardId, id));
      if (a.ok) bilder[id] = await alsDataUrl(await a.blob());
    } catch {
      // fehlt eben in der Datei; das Board bleibt trotzdem vollstaendig
    }
  }
  return bilder;
}

/** Bilder aus einer Export-Datei unter ihren alten Ids hochladen. */
export async function bilderHochladen(boardId, bilder) {
  for (const [id, dataUrl] of Object.entries(bilder ?? {})) {
    const blob = await (await fetch(dataUrl)).blob();
    await bildHochladen(boardId, blob, { id });
  }
}
