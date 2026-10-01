import { useState } from 'react';
import Icon from '../ui/Icon.jsx';
import { Farbfeld, LeinwandPlatte } from '../ui/bausteine.jsx';
import { useT } from '../i18n/index.js';
import { farbeAufloesen, INK } from '../zeichnen/farben.js';

// Selection frame (design 2e): frame in the accent color, eight handles, a
// rotate handle above, the context bar below. The handles are only 12 px
// in size, but their hit area is 44 px.

const ANFASSER = [
  ['nw', 0, 0], ['n', 50, 0], ['ne', 100, 0],
  ['w', 0, 50], ['e', 100, 50],
  ['sw', 0, 100], ['s', 50, 100], ['se', 100, 100],
];
const CURSOR = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
};

// Stroke widths for shapes in the selection: one tap, one undo step
const FORM_BREITEN = [1, 2, 3, 5, 8, 12];

export default function Auswahl({ a, ed, dunkel, leinwandFarbe, hoehe, bildErsetzen, formBreiteGewaehlt }) {
  const t = useT();
  const [offen, setOffen] = useState(null); // 'farben' | 'dicke'
  const farbenOffen = offen === 'farben';
  const setFarbenOffen = (an) => setOffen(an ? 'farben' : null);
  if (!a) return null;
  const pad = 6;
  const rahmen = {
    left: a.x - pad,
    top: a.y - pad,
    width: a.breite + pad * 2,
    height: a.hoehe + pad * 2,
    transform: a.winkel ? `rotate(${a.winkel}rad)` : undefined,
  };
  // Context bar 14 px below the frame, or above it if there is no room
  // left below.
  const unten = a.y + a.hoehe + pad + 14;
  const leisteOben = unten + 56 > hoehe - 96;
  const leiste = {
    left: a.x + a.breite / 2,
    top: leisteOben ? Math.max(8, a.y - pad - 52 - 14 - 60) : unten,
  };
  const greifen = (griff) => (e) => ed.anfasserGreifen(griff, e);

  return (
    <>
      <div className={`auswahl-rahmen${a.endpunkte ? ' nur-linie' : ''}`} style={rahmen}>
        <span className="auswahl-verschieben" onPointerDown={greifen('mitte')} />
        {!a.endpunkte && ANFASSER.map(([griff, x, y]) => (
          <span
            key={griff}
            className="anfasser"
            style={{ left: `${x}%`, top: `${y}%`, cursor: CURSOR[griff] }}
            onPointerDown={greifen(griff)}
          >
            <span />
          </span>
        ))}
        {a.bild && <span className="groessen-chip">{a.bild.breite} × {a.bild.hoehe}</span>}
        {!a.endpunkte && (
          <>
            <span className="dreh-stiel" />
            <span className="dreh-anfasser" title={t('select.rotate')} onPointerDown={greifen('drehen')}>
              <span><Icon name="drehen" groesse={13} staerke={2.4} /></span>
            </span>
          </>
        )}
      </div>
      {/* Line and arrow: drag each end separately */}
      {a.endpunkte?.map((p, i) => (
        <span
          key={i}
          className="anfasser endpunkt"
          title={t('select.dragEnd')}
          style={{ left: p.x, top: p.y }}
          onPointerDown={greifen(i === 0 ? 'ende1' : 'ende2')}
        >
          <span />
        </span>
      ))}

      {!a.bewegt && (
        <div className="kontextleiste" style={leiste} onPointerDown={(e) => e.stopPropagation()}>
          {a.nurBilder ? (
            a.bild && (
              <button type="button" className="werkzeug" title={t('select.replaceImage')} aria-label={t('select.replaceImage')} onClick={() => bildErsetzen(a.bild.id)}>
                <Icon name="wiederherstellen" groesse={21} />
              </button>
            )
          ) : (
            <button type="button" className="werkzeug" title={t('select.changeColor')} aria-label={t('select.changeColor')} aria-expanded={farbenOffen} onClick={() => setFarbenOffen(!farbenOffen)}>
              <span className="farbe-rund" style={{ background: a.farbe ? farbeAufloesen(a.farbe, dunkel) : 'conic-gradient(#d8352c,#e36c0a,#2c8a3d,#1f6ed8,#8a3fc6,#d8352c)' }} />
            </button>
          )}
          {a.formBreite !== null && (
            <button
              type="button"
              className="werkzeug"
              title={t('shape.outlineWidth')}
              aria-label={t('shape.outlineWidth')}
              aria-expanded={offen === 'dicke'}
              onClick={() => setOffen(offen === 'dicke' ? null : 'dicke')}
            >
              <Icon name="dicke" groesse={21} />
            </button>
          )}
          <button type="button" className="werkzeug" title={t('select.duplicateKey')} aria-label={t('common.duplicate')} onClick={() => ed.duplizieren()}>
            <Icon name="duplizieren" groesse={21} />
          </button>
          <button type="button" className="werkzeug" title={t('select.toFront')} aria-label={t('select.toFront')} onClick={() => ed.nachVorne()}>
            <Icon name="vorneFlaeche" groesse={21} />
          </button>
          <button type="button" className="werkzeug" title={t('select.toBack')} aria-label={t('select.toBack')} onClick={() => ed.nachHinten()}>
            <Icon name="hintenFlaeche" groesse={21} />
          </button>
          <span className="trenner" />
          <button type="button" className="werkzeug gefahr" title={t('select.deleteKey')} aria-label={t('common.delete')} onClick={() => ed.auswahlLoeschen()}>
            <Icon name="loeschen" groesse={21} />
          </button>
          {farbenOffen && (
            <div className={`popover auswahl-farben${leisteOben ? ' unten' : ''}`}>
              <LeinwandPlatte leinwandFarbe={leinwandFarbe} className="farbraster">
                {INK.map((f) => (
                  <Farbfeld
                    key={f.id}
                    farbe={f.id}
                    name={t(`color.${f.id}`)}
                    dunkel={dunkel}
                    gewaehlt={a.farbe === f.id}
                    onClick={() => { ed.auswahlFaerben(f.id); setFarbenOffen(false); }}
                  />
                ))}
              </LeinwandPlatte>
            </div>
          )}
          {offen === 'dicke' && a.formBreite !== null && (
            <div className={`popover auswahl-dicke${leisteOben ? ' unten' : ''}`}>
              <div className="pop-zeile">
                <span>{t('shape.outlineWidth')}</span>
                <strong>{a.formBreite ? `${a.formBreite} px` : t('select.mixed')}</strong>
              </div>
              <div className="dicke-reihe">
                {FORM_BREITEN.map((b) => (
                  <button
                    type="button"
                    key={b}
                    title={`${b} px`}
                    aria-label={`${b} px`}
                    aria-pressed={a.formBreite === b}
                    className={a.formBreite === b ? 'gewaehlt' : ''}
                    onClick={() => { ed.auswahlFormBreite(b); formBreiteGewaehlt?.(b); }}
                  >
                    <span style={{ height: Math.max(1, b * 0.9) }} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
