import { useEffect, useState } from 'react';
import Leinwand from '../Leinwand.jsx';
import { Dialog, Kbd, Regler, Schalter, Segmente } from '../ui/bausteine.jsx';
import { einstellungenSetzen, istTouch, useEinstellungen } from '../daten/einstellungen.js';
import { glaettungAusRegler } from '../zeichnen/editor.js';
import { api } from '../api.js';
import { SPRACHEN, sprache, t, useT } from '../i18n/index.js';

// Einstellungen (Design 4a-4f): Stiftgefuehl mit Testflaeche,
// Darstellung, Tastenkuerzel.

// Beschriftung (i18n-Schluessel) und Tasten. Tastennamen in GROSS werden
// uebersetzt (Strg/Ctrl, Entf/Del, …), alles andere steht so auf der Taste.
const KUERZEL = [
  ['keys.undo', ['CTRL', 'Z']], ['keys.redo', ['CTRL', 'Y']],
  ['keys.copy', ['CTRL', 'C']], ['keys.cut', ['CTRL', 'X']], ['keys.paste', ['CTRL', 'V']],
  ['keys.duplicate', ['CTRL', 'D']], ['keys.deleteSelection', ['DEL']], ['keys.selectAll', ['CTRL', 'A']],
  ['keys.hand', ['SPACE']], ['keys.zoom', ['CTRL', 'WHEEL']], ['keys.straightLine', ['Shift']],
  ['keys.snap', ['Shift', 'CTRL']],
  ['keys.pen', ['P']], ['keys.highlighter', ['H']], ['keys.eraser', ['E']], ['keys.selection', ['L']],
  ['keys.addToSelection', ['Shift']],
  ['keys.penSlot', ['1 – 4']], ['keys.fitAll', ['Shift', '1']], ['keys.settings', ['CTRL', ',']],
  ['keys.cancel', ['Esc']],
];
const TASTEN = { CTRL: 'common.ctrl', DEL: 'keys.del', SPACE: 'keys.space', WHEEL: 'keys.wheel' };

function glaettungText(w) {
  if (w === 0) return t('settings.smoothingOff');
  return `${w < 34 ? t('settings.smoothingLow') : w < 67 ? t('settings.smoothingMedium') : t('settings.smoothingHigh')} · ${w}`;
}

/** Aus "20260818164917" wird "18.08.2026, 16:49" bzw. "2026-08-18 16:49". */
function standText(stempel) {
  if (!stempel) return t('settings.development');
  const m = String(stempel).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return String(stempel);
  const [, jahr, monat, tag, stunde, minute] = m;
  return sprache() === 'de' ? `${tag}.${monat}.${jahr}, ${stunde}:${minute}` : `${jahr}-${monat}-${tag} ${stunde}:${minute}`;
}

export default function EinstellungenDialog({ offen, schliessen }) {
  const e = useEinstellungen();
  const t = useT();
  const [server, setServer] = useState(null);
  useEffect(() => {
    if (offen) api.health().then(setServer, () => setServer(false));
  }, [offen]);
  return (
    <Dialog titel={t('settings.title')} offen={offen} schliessen={schliessen} breite={680} className="einstellungen">
      <section className="einst-abschnitt">
        <span className="einst-label">{t('settings.penFeel')}</span>
        <div className="stiftgefuehl">
          <div className="stiftgefuehl-links">
            <div className="einst-zeile">
              <span>{t('settings.smoothing')}</span>
              <span className="einst-wert">{glaettungText(e.glaettung)}</span>
            </div>
            <Regler hoch wert={e.glaettung} min={0} max={100} beschriftung={t('settings.smoothing')} setzen={(glaettung) => einstellungenSetzen({ glaettung })} />
            <div className="regler-skala"><span>{t('settings.direct')}</span><span>{t('settings.calm')}</span></div>
            <span className="einst-trenner" />
            <label className="einst-schalter">
              <span>
                <span>{t('settings.pressure')}</span>
                <span className="einst-unter">{t('settings.pressureHint')}</span>
              </span>
              <Schalter an={e.druck} beschriftung={t('settings.pressure')} setzen={(druck) => einstellungenSetzen({ druck })} />
            </label>
          </div>
          {offen && <Testflaeche glaettung={e.glaettung} druck={e.druck} />}
        </div>
      </section>

      <section className="einst-abschnitt">
        <span className="einst-label">{t('settings.appearance')}</span>
        <Segmente
          className="darstellung"
          optionen={[
            { wert: 'hell', text: t('settings.light'), icon: 'sonne' },
            { wert: 'dunkel', text: t('settings.dark'), icon: 'mond' },
            { wert: 'system', text: t('settings.system'), icon: 'monitor' },
          ]}
          wert={e.darstellung}
          setzen={(darstellung) => einstellungenSetzen({ darstellung })}
        />
        <span className="einst-unter">
          {t('settings.canvasHint', { menue: t('editor.background') })}
        </span>
      </section>

      <section className="einst-abschnitt">
        <span className="einst-label">{t('settings.language')}</span>
        <Segmente
          className="sprachwahl"
          optionen={SPRACHEN}
          wert={sprache()}
          setzen={(neu) => einstellungenSetzen({ sprache: neu })}
        />
      </section>

      <section className="einst-abschnitt letzte">
        <div className="einst-label-zeile">
          <span className="einst-label">{t('settings.shortcuts')}</span>
          {istTouch && <span className="einst-unter">{t('settings.hardwareKeyboard')}</span>}
        </div>
        <div className="kuerzel-raster">
          {KUERZEL.map(([text, tasten]) => (
            <div key={text} className="kuerzel-zeile">
              <span>{t(text)}</span>
              <span className="kuerzel-tasten">{tasten.map((taste) => <Kbd key={taste}>{TASTEN[taste] ? t(TASTEN[taste]) : taste}</Kbd>)}</span>
            </div>
          ))}
        </div>
        {/* Zwei Staende: "./deploy.sh" rollt nur die Web-App aus, "./deploy.sh api"
            auch den Server. Zwei verschiedene Nummern = nur eine Haelfte ausgerollt. */}
        <span className="baustand">
          App: {standText(import.meta.env.VITE_BAUSTAND)}
          {import.meta.env.VITE_COMMIT ? ` · ${import.meta.env.VITE_COMMIT}` : ''}
          {' · '}Server: {server === null ? '…' : server ? standText(server.baustand) : t('settings.unreachable')}
        </span>
      </section>
    </Dialog>
  );
}

function Testflaeche({ glaettung, druck }) {
  const t = useT();
  const [ed, setEd] = useState(null);
  const [leer, setLeer] = useState(true);

  useEffect(() => {
    if (!ed) return undefined;
    ed.einstellungenSetzen({ ...glaettungAusRegler(glaettung), druck });
  }, [ed, glaettung, druck]);

  useEffect(() => {
    if (!ed) return undefined;
    ed.dok.hintergrundSetzen({ farbe: 'white', muster: 'dots' });
    ed.kamera.x = 0;
    ed.kamera.y = 0;
    ed.kameraGeaendert();
    return ed.dok.beiAenderung(() => setLeer(ed.dok.elemente.length === 0));
  }, [ed]);

  return (
    <div className="testflaeche">
      <Leinwand onBereit={setEd} optionen={{ tasten: false }} />
      {leer && <span className="test-platzhalter">{t('settings.tryHere')}</span>}
      <button type="button" className="test-leeren" onClick={() => ed?.leeren()}>{t('settings.clear')}</button>
    </div>
  );
}
