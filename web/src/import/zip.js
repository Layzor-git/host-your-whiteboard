// Liest Dateien aus einem ZIP, ohne Bibliothek: Das Entpacken macht der
// Browser selbst (DecompressionStream, Safari ab 16.4). Reicht fuer die
// Exporte von Microsoft Whiteboard, kein ZIP64, keine Verschluesselung.

import { t } from '../i18n/index.js';

async function entpacken(daten, methode) {
  if (methode === 0) return daten;
  if (methode !== 8) throw new Error(t('import.zipMethod', { methode }));
  const strom = new Blob([daten]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(strom).arrayBuffer());
}

/** { name: Uint8Array } fuer alle Dateien im Archiv. */
export async function zipLesen(puffer) {
  const b = new Uint8Array(puffer);
  const v = new DataView(puffer);
  // Ende des Inhaltsverzeichnisses suchen (steht ganz hinten)
  let ende = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { ende = i; break; }
  }
  if (ende < 0) throw new Error(t('import.zipInvalid'));
  const anzahl = v.getUint16(ende + 10, true);
  let pos = v.getUint32(ende + 16, true);
  const dateien = {};
  const text = new TextDecoder();
  for (let n = 0; n < anzahl; n++) {
    if (v.getUint32(pos, true) !== 0x02014b50) throw new Error(t('import.zipBroken'));
    const methode = v.getUint16(pos + 10, true);
    const groesse = v.getUint32(pos + 20, true);
    const nameLaenge = v.getUint16(pos + 28, true);
    const extraLaenge = v.getUint16(pos + 30, true);
    const kommentarLaenge = v.getUint16(pos + 32, true);
    const lokal = v.getUint32(pos + 42, true);
    const name = text.decode(b.subarray(pos + 46, pos + 46 + nameLaenge));
    const start = lokal + 30 + v.getUint16(lokal + 26, true) + v.getUint16(lokal + 28, true);
    dateien[name] = await entpacken(b.slice(start, start + groesse), methode);
    pos += 46 + nameLaenge + extraLaenge + kommentarLaenge;
  }
  return dateien;
}
