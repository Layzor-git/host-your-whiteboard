// Entry point for the import. Takes a file and returns board data plus a
// report. Two sources:
//
//   .whiteboard (or .json)     our own format, see zeichnen/export.js
//   .zip / .html               export from Microsoft Whiteboard

import { msWhiteboardUmwandeln } from './msWhiteboard.js';
import { zipLesen } from './zip.js';
import { t } from '../i18n/index.js';
import { DATEI_FORMAT } from '../zeichnen/export.js';

export const DATEI_TYPEN = '.whiteboard,.json,.zip,.html,.htm';

function eigenesFormat(text, dateiname) {
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    throw new Error(t('import.brokenJson'));
  }
  if (d?.format !== DATEI_FORMAT || !Array.isArray(d.elemente)) {
    throw new Error(t('import.notWhiteboard'));
  }
  if (d.version > 1) throw new Error(t('import.newerVersion'));
  const elemente = d.elemente.filter((el) => el && typeof el.id === 'string' && typeof el.typ === 'string');
  const unbekannt = d.elemente.length - elemente.length;
  return {
    titel: d.titel || dateiname.replace(/\.(whiteboard|json)$/i, ''),
    daten: { version: 1, hintergrund: d.hintergrund, elemente },
    bilder: d.bilder ?? {},
    bericht: {
      striche: elemente.filter((el) => el.typ === 'strich' && !el.textmarker).length,
      textmarker: elemente.filter((el) => el.textmarker).length,
      formen: elemente.filter((el) => el.typ === 'form').length,
      uebersprungen: unbekannt ? { 'unlesbare Elemente': unbekannt } : {},
    },
  };
}

export async function dateiImportieren(datei) {
  if (/\.(whiteboard|json)$/i.test(datei.name)) return eigenesFormat(await datei.text(), datei.name);

  let html;
  if (/\.zip$/i.test(datei.name) || datei.type.includes('zip')) {
    const dateien = await zipLesen(await datei.arrayBuffer());
    const name = Object.keys(dateien).find((n) => /\.html?$/i.test(n));
    if (!name) throw new Error(t('import.noHtmlInZip'));
    html = new TextDecoder().decode(dateien[name]);
  } else {
    html = await datei.text();
  }
  if (!/data-whiteboard-type=/.test(html)) {
    throw new Error(t('import.unsupported'));
  }
  const titel = datei.name.replace(/\.(zip|html?)$/i, '');
  return { titel, ...msWhiteboardUmwandeln(html) };
}
