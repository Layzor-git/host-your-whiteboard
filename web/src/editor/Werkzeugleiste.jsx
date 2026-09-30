import { useRef } from 'react';
import Icon from '../ui/Icon.jsx';
import { Farbfeld, Kbd, LeinwandPlatte, MenuePunkt, Regler, Segmente, Trenner } from '../ui/bausteine.jsx';
import { BREITEN, einstellungenSetzen, istTouch, slotSetzen } from '../daten/einstellungen.js';
import { farbeAufloesen, HIGHLIGHTER, INK } from '../zeichnen/farben.js';
import { t, useT } from '../i18n/index.js';

// Haupt-Werkzeugleiste unten mittig: Stift 1-3, Textmarker | Radierer,
// Lasso, Formen | (Touch) Finger zeichnet. Ein Klick auf das aktive
// Werkzeug oeffnet oder schliesst sein Popover.

// Namen stehen unter shape.<id> in i18n/
const FORMEN = ['linie', 'pfeil', 'rechteck', 'ellipse', 'dreieck'];
const KONTUR = ['graphite', 'red', 'orange', 'green', 'blue', 'indigo', 'purple'];

export function slotName(slot, i) {
  return slot.art === 'marker' ? t('tool.highlighter') : t('tool.penN', { nummer: i + 1 });
}

function StiftSymbol({ slot }) {
  const farbe = farbeAufloesen(slot.farbe, false);
  const balken = slot.art === 'marker'
    ? Math.max(2, Math.min(7, slot.breite * 0.3))
    : Math.max(2, Math.min(5, slot.breite * 0.55));
  return (
    <span className="stift-slot">
      {slot.art === 'marker' ? (
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8.2 13.2l7.6-7.6a1.6 1.6 0 012.3 0l.3.3a1.6 1.6 0 010 2.3l-7.6 7.6z" fill="var(--ui-surface)" stroke="var(--ui-text)" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M8.2 13.2l2.6 2.6-1.6 1.6-3.4.6.8-3.2z" fill={farbe} stroke="var(--ui-text)" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.5 19.5l1.1-4.6L15.7 4.8a2 2 0 012.8 0l.7.7a2 2 0 010 2.8L9.1 18.4z" fill={farbe} stroke="var(--ui-text)" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M13.6 6.9l3.5 3.5" stroke="var(--ui-surface)" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )}
      <span className="stift-balken" style={{ height: balken, background: farbe }} />
    </span>
  );
}

function WerkzeugKnopf({ aktiv, titel, onClick, children, className = '' }) {
  return (
    <button type="button" title={titel} aria-label={titel} aria-pressed={aktiv} className={`werkzeug${aktiv ? ' aktiv' : ''} ${className}`} onClick={onClick}>
      {children}
    </button>
  );
}

export default function Werkzeugleiste({ e, werkzeug, waehlen, popover, fingerUmschalten, bildOffen, ohneFinger }) {
  const t = useT();
  return (
    <div className="werkzeugleiste leiste">
      {e.slots.map((s, i) => (
        <WerkzeugKnopf
          key={i}
          aktiv={werkzeug === `slot${i}`}
          titel={slotName(s, i) + (istTouch ? '' : ` (${i + 1})`)}
          onClick={() => waehlen(`slot${i}`)}
        >
          <StiftSymbol slot={s} />
        </WerkzeugKnopf>
      ))}
      <Trenner />
      <WerkzeugKnopf aktiv={werkzeug === 'radierer'} titel={istTouch ? t('tool.eraser') : t('tool.eraserKey')} onClick={() => waehlen('radierer')}>
        <Icon name="radierer" />
      </WerkzeugKnopf>
      <WerkzeugKnopf aktiv={werkzeug === 'lasso'} titel={istTouch ? t('tool.select') : t('tool.selectKey')} onClick={() => waehlen('lasso')}>
        <Icon name={{ lasso: 'lasso', rechteck: 'auswahlRechteck' }[e.auswahlArt] ?? 'pfeilZeiger'} />
      </WerkzeugKnopf>
      <WerkzeugKnopf aktiv={werkzeug === 'formen'} titel={t('tool.shapes')} onClick={() => waehlen('formen')}>
        <Icon name="formen" />
      </WerkzeugKnopf>
      <Trenner />
      <WerkzeugKnopf aktiv={bildOffen} titel={t('tool.image')} onClick={() => waehlen('bild')}>
        <Icon name="bild" />
      </WerkzeugKnopf>
      {istTouch && !ohneFinger && (
        <>
          <Trenner />
          <WerkzeugKnopf aktiv={e.fingerZeichnet} titel={t('tool.finger')} onClick={fingerUmschalten}>
            <Icon name="finger" />
            <span className={`finger-punkt${e.fingerZeichnet ? ' an' : ''}`} />
          </WerkzeugKnopf>
        </>
      )}
      {popover}
    </div>
  );
}

/** Popover zum aktiven Werkzeug. */
export function WerkzeugPopover({ e, pop, dunkel, leinwandFarbe, bildAktionen }) {
  if (!pop) return null;
  if (pop === 'bild') {
    return (
      <div className="popover werkzeug-popover" onPointerDown={(ev) => ev.stopPropagation()}>
        <BildPopover {...bildAktionen} />
      </div>
    );
  }
  const slotIndex = pop.startsWith('slot') ? Number(pop.slice(4)) : -1;
  return (
    <div className="popover werkzeug-popover" onPointerDown={(ev) => ev.stopPropagation()}>
      {slotIndex >= 0 && (
        <SlotPopover i={slotIndex} slot={e.slots[slotIndex]} eigene={e.eigeneFarben} dunkel={dunkel} leinwandFarbe={leinwandFarbe} />
      )}
      {pop === 'radierer' && <RadiererPopover r={e.radierer} dunkel={dunkel} leinwandFarbe={leinwandFarbe} />}
      {pop === 'formen' && <FormenPopover f={e.form} dunkel={dunkel} leinwandFarbe={leinwandFarbe} />}
      {pop === 'lasso' && <AuswahlPopover art={e.auswahlArt ?? 'pfeil'} />}
    </div>
  );
}

function SlotPopover({ i, slot, eigene, dunkel, leinwandFarbe }) {
  const t = useT();
  const marker = slot.art === 'marker';
  const palette = marker ? HIGHLIGHTER : INK;
  const [min, max] = marker ? BREITEN.marker : BREITEN.stift;
  const farbwahl = useRef(null);
  const farbe = farbeAufloesen(slot.farbe, dunkel);
  const eigeneHier = eigene.filter((f) => !marker || f.startsWith('#'));
  return (
    <div className="pop-inhalt" style={{ width: 332 }}>
      <div className="pop-kopf">
        <span>{slotName(slot, i)}</span>
        {!istTouch && <Kbd>{marker ? 'H · 4' : String(i + 1)}</Kbd>}
      </div>
      <LeinwandPlatte leinwandFarbe={leinwandFarbe} className="farbraster">
        {palette.map((f) => (
          <Farbfeld key={f.id} farbe={f.id} name={t(`color.${f.id}`)} dunkel={dunkel} gewaehlt={slot.farbe === f.id} onClick={() => slotSetzen(i, { farbe: f.id })} />
        ))}
        {eigeneHier.map((f) => (
          <Farbfeld key={f} farbe={f} name={t('color.customValue', { farbe: f })} dunkel={dunkel} gewaehlt={slot.farbe === f} onClick={() => slotSetzen(i, { farbe: f })} />
        ))}
        <button type="button" className="farbfeld" title={t('color.custom')} aria-label={t('color.custom')} onClick={() => farbwahl.current?.click()}>
          <span className="eigene-farbe"><span>+</span></span>
        </button>
        <input
          ref={farbwahl}
          type="color"
          hidden
          onChange={(ev) => {
            const f = ev.target.value;
            slotSetzen(i, { farbe: f });
            einstellungenSetzen((s) => ({ eigeneFarben: [f, ...s.eigeneFarben.filter((x) => x !== f)].slice(0, 6) }));
          }}
        />
      </LeinwandPlatte>
      <div className="pop-zeile">
        <span>{t('pen.width')}</span>
        <strong>{slot.breite} px</strong>
      </div>
      <Regler wert={slot.breite} min={min} max={max} setzen={(v) => slotSetzen(i, { breite: v })} beschriftung={t('pen.width')} />
      <LeinwandPlatte leinwandFarbe={leinwandFarbe} className="stift-vorschau">
        {marker && <span className="marker-mustertext" style={{ color: farbeAufloesen('graphite', dunkel) }}>{t('pen.markerSample')}</span>}
        <svg width="100%" height="72" viewBox="0 0 308 72" preserveAspectRatio="none" fill="none">
          <path
            d={marker ? 'M24 38 L284 38' : 'M22 44 C 60 14, 96 14, 128 36 S 200 64, 238 34 S 276 18, 288 26'}
            stroke={farbe}
            strokeLinecap="round"
            strokeWidth={slot.breite}
            style={marker ? { mixBlendMode: dunkel ? 'screen' : 'multiply', opacity: slot.farbe.startsWith('hl-') ? 1 : 0.45 } : undefined}
          />
        </svg>
      </LeinwandPlatte>
    </div>
  );
}

function RadiererPopover({ r, dunkel, leinwandFarbe }) {
  const t = useT();
  const punkt = r.modus === 'punkt';
  const d = Math.min(r.groesse, 50);
  return (
    <div className="pop-inhalt" style={{ width: 300 }}>
      <div className="pop-kopf">
        <span>{t('tool.eraser')}</span>
        {!istTouch && <Kbd>E</Kbd>}
      </div>
      <Segmente
        className="zweispaltig"
        optionen={[{ wert: 'strich', text: t('eraser.whole') }, { wert: 'punkt', text: t('eraser.precise') }]}
        wert={r.modus}
        setzen={(modus) => einstellungenSetzen((s) => ({ radierer: { ...s.radierer, modus } }))}
      />
      <span className="pop-hinweis">
        {punkt
          ? t('eraser.preciseHint')
          : t('eraser.wholeHint')}
      </span>
      <div className={`groessen-zeile${punkt ? '' : ' aus'}`}>
        <div className="pop-zeile">
          <span>{t('eraser.size')}</span>
          <strong>{r.groesse} px</strong>
        </div>
        <div className="regler-mit-vorschau">
          <Regler
            wert={r.groesse}
            min={BREITEN.radierer[0]}
            max={BREITEN.radierer[1]}
            deaktiviert={!punkt}
            beschriftung={t('eraser.sizeLabel')}
            setzen={(groesse) => einstellungenSetzen((s) => ({ radierer: { ...s.radierer, groesse } }))}
          />
          <LeinwandPlatte leinwandFarbe={leinwandFarbe} className="radierer-vorschau">
            <span style={{ width: d, height: d, borderColor: farbeAufloesen('graphite', dunkel) }} />
          </LeinwandPlatte>
        </div>
      </div>
    </div>
  );
}

function BildPopover({ datei, kamera, zwischenablage }) {
  const t = useT();
  return (
    <div className="bild-menue">
      <MenuePunkt icon="ordner" text={istTouch ? t('image.fromFiles') : t('image.chooseFile')} onClick={datei} />
      {istTouch && <MenuePunkt icon="kamera" text={t('image.takePhoto')} onClick={kamera} />}
      <MenuePunkt icon="ablage" text={t('image.fromClipboard')} kuerzel={istTouch ? null : `${t('common.ctrl')} V`} onClick={zwischenablage} />
      <span className="menue-trenner" />
      <span className="bild-hinweis">
        {istTouch
          ? t('image.hintTouch')
          : t('image.hintDesktop')}
      </span>
    </div>
  );
}

function AuswahlPopover({ art }) {
  const t = useT();
  return (
    <div className="pop-inhalt" style={{ width: 300 }}>
      <div className="pop-kopf">
        <span>{t('tool.select')}</span>
        {!istTouch && <Kbd>L</Kbd>}
      </div>
      <Segmente
        className="dreispaltig"
        optionen={[
          { wert: 'pfeil', text: t('select.arrow'), icon: 'pfeilZeiger' },
          { wert: 'rechteck', text: t('select.rectangle'), icon: 'auswahlRechteck' },
          { wert: 'lasso', text: t('select.lasso'), icon: 'lasso' },
        ]}
        wert={art}
        setzen={(auswahlArt) => einstellungenSetzen({ auswahlArt })}
      />
      <span className="pop-hinweis">
        {{
          pfeil: t('select.hintArrow'),
          rechteck: t('select.hintRectangle'),
          lasso: t('select.hintLasso'),
        }[art]}
        {istTouch ? '' : t('select.hintShift')}
      </span>
    </div>
  );
}

function FormenPopover({ f, dunkel, leinwandFarbe }) {
  const t = useT();
  const setzen = (teil) => einstellungenSetzen((s) => ({ form: { ...s.form, ...teil } }));
  return (
    <div className="pop-inhalt" style={{ width: 328 }}>
      <div className="pop-kopf"><span>{t('tool.shapes')}</span></div>
      <div className="formen-reihe">
        {FORMEN.map((id) => (
          <button type="button" key={id} title={t(`shape.${id}`)} aria-label={t(`shape.${id}`)} aria-pressed={f.art === id} className={`werkzeug breit${f.art === id ? ' aktiv' : ''}`} onClick={() => setzen({ art: id })}>
            <Icon name={id} />
          </button>
        ))}
      </div>
      <div className="pop-zeile">
        <span>{t('pen.width')}</span>
        <strong>{f.breite ?? 3} px</strong>
      </div>
      <Regler
        wert={f.breite ?? 3}
        min={BREITEN.form[0]}
        max={BREITEN.form[1]}
        beschriftung={t('shape.outlineWidth')}
        setzen={(breite) => setzen({ breite })}
      />
      <span className="pop-label">{t('shape.outline')}</span>
      <LeinwandPlatte leinwandFarbe={leinwandFarbe} className="farbraster sieben">
        {KONTUR.map((id) => (
          <Farbfeld key={id} farbe={id} name={t(`color.${id}`)} dunkel={dunkel} groesse={24} gewaehlt={f.farbe === id} onClick={() => setzen({ farbe: id })} />
        ))}
      </LeinwandPlatte>
      <span className="pop-label">{t('shape.fill')}</span>
      <LeinwandPlatte leinwandFarbe={leinwandFarbe} className="farbraster sieben">
        <button type="button" className="farbfeld" title={t('shape.noFill')} aria-label={t('shape.noFill')} aria-pressed={!f.fuellung} onClick={() => setzen({ fuellung: null })}>
          <span className={`keine-fuellung${!f.fuellung ? ' gewaehlt' : ''}`} style={{ width: 24, height: 24 }} />
        </button>
        {HIGHLIGHTER.map((h) => (
          <Farbfeld key={h.id} farbe={h.id} name={t(`color.${h.id}`)} dunkel={dunkel} groesse={24} gewaehlt={f.fuellung === h.id} onClick={() => setzen({ fuellung: h.id })} />
        ))}
      </LeinwandPlatte>
    </div>
  );
}
