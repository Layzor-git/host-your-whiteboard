// Small building blocks from the design. The look is in styles.css, only
// structure and behavior here.

import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { farbeAufloesen, leinwand } from '../zeichnen/farben.js';
import { sprache, t, useT } from '../i18n/index.js';

export function IconKnopf({ icon, titel, aktiv, ton, groesse = 22, className = '', ...rest }) {
  return (
    <button
      type="button"
      title={titel}
      aria-label={titel}
      aria-pressed={aktiv === undefined ? undefined : !!aktiv}
      className={`ikon-knopf${aktiv ? ' aktiv' : ''}${ton === 'gefahr' ? ' gefahr' : ''} ${className}`}
      {...rest}
    >
      <Icon name={icon} groesse={groesse} />
    </button>
  );
}

export function Trenner({ senkrecht }) {
  return <span className={senkrecht ? 'trenner-quer' : 'trenner'} />;
}

export function Kbd({ children }) {
  return <span className="kbd">{children}</span>;
}

export function Segmente({ optionen, wert, setzen, className = '' }) {
  return (
    <div className={`segmente ${className}`} role="radiogroup">
      {optionen.map((o) => (
        <button
          type="button"
          key={o.wert}
          role="radio"
          aria-checked={wert === o.wert}
          className={wert === o.wert ? 'an' : ''}
          onClick={() => setzen(o.wert)}
        >
          {o.icon && <Icon name={o.icon} groesse={18} />}
          {o.text}
        </button>
      ))}
    </div>
  );
}

/** Slider with its own track; the real range input lies invisibly on top. */
export function Regler({ wert, min, max, schritt = 1, setzen, beschriftung, deaktiviert, hoch }) {
  const p = ((wert - min) / (max - min)) * 100;
  return (
    <div className={`regler${hoch ? ' hoch' : ''}${deaktiviert ? ' aus' : ''}`}>
      <span className="regler-spur" />
      <span className="regler-fuellung" style={{ width: `${p}%` }} />
      <span className="regler-knopf" style={{ left: `calc(${p}% - 10px)` }} />
      <input
        type="range"
        min={min}
        max={max}
        step={schritt}
        value={wert}
        disabled={deaktiviert}
        aria-label={beschriftung}
        onChange={(e) => setzen(Number(e.target.value))}
      />
    </div>
  );
}

export function Schalter({ an, setzen, beschriftung }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={an}
      aria-label={beschriftung}
      className={`schalter${an ? ' an' : ''}`}
      onClick={() => setzen(!an)}
    >
      <span />
    </button>
  );
}

export function MenuePunkt({ icon, text, kuerzel, gefahr, ...rest }) {
  return (
    <button type="button" className={`menue-punkt${gefahr ? ' gefahr' : ''}`} {...rest}>
      {icon && <Icon name={icon} groesse={20} />}
      <span className="menue-text">{text}</span>
      {kuerzel && <span className="menue-kuerzel">{kuerzel}</span>}
    </button>
  );
}

/** Color dot; on a surface in the canvas color (LeinwandPlatte). */
export function Farbfeld({ farbe, gewaehlt, name, dunkel, groesse = 26, ...rest }) {
  return (
    <button type="button" title={name} aria-label={name} aria-pressed={gewaehlt} className="farbfeld" {...rest}>
      <span
        className={gewaehlt ? 'gewaehlt' : ''}
        style={{ width: groesse, height: groesse, background: farbe ? farbeAufloesen(farbe, dunkel) : undefined }}
      />
    </button>
  );
}

export function LeinwandPlatte({ leinwandFarbe = 'white', className = '', children, style }) {
  const bg = leinwand(leinwandFarbe);
  return (
    <div className={`leinwand-platte ${className}`} style={{ background: bg.color, ...style }}>
      {children}
    </div>
  );
}

/** Pattern as a CSS background (tiles, templates, background popover). */
export function musterStil(muster, schritt, dunkel) {
  const f = dunkel ? 'rgba(255,255,255,.13)' : 'rgba(30,32,48,.17)';
  if (muster === 'dots') {
    return { backgroundImage: `radial-gradient(circle, ${f} 1px, transparent 1.3px)`, backgroundSize: `${schritt}px ${schritt}px` };
  }
  if (muster === 'grid') {
    return {
      backgroundImage: `linear-gradient(${f} 1px, transparent 1px),linear-gradient(90deg,${f} 1px, transparent 1px)`,
      backgroundSize: `${schritt}px ${schritt}px`,
    };
  }
  if (muster === 'lines') {
    return { backgroundImage: `linear-gradient(transparent calc(100% - 1px), ${f} 0)`, backgroundSize: `100% ${schritt}px` };
  }
  return {};
}

export function Dialog({ titel, untertitel, offen, schliessen, breite = 600, children, fuss, className = '' }) {
  const tr = useT();
  useEffect(() => {
    if (!offen) return undefined;
    const taste = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        schliessen();
      }
    };
    window.addEventListener('keydown', taste, true);
    return () => window.removeEventListener('keydown', taste, true);
  }, [offen, schliessen]);
  if (!offen) return null;
  return (
    <>
      <div className="scrim" onClick={schliessen} />
      <div className={`dialog ${className}`} role="dialog" aria-modal="true" aria-label={titel} style={{ width: `min(${breite}px, calc(100% - 48px))` }}>
        <div className="dialog-kopf">
          {untertitel ? (
            <span className="dialog-titel-block">
              <span className="dialog-titel">{titel}</span>
              <span className="dialog-untertitel">{untertitel}</span>
            </span>
          ) : <span className="dialog-titel">{titel}</span>}
          <IconKnopf icon="schliessen" titel={tr('common.closeEsc')} groesse={20} onClick={schliessen} className="dialog-zu" />
        </div>
        {children}
        {fuss && <div className="dialog-fuss">{fuss}</div>}
      </div>
    </>
  );
}

export function Toast({ meldung, aktion, oben }) {
  if (!meldung) return null;
  return (
    <div className={`toast${oben ? ' oben' : ''}`} role="status">
      {meldung}
      {aktion && (
        <button type="button" className="toast-aktion" onClick={aktion.klick}>{aktion.text}</button>
      )}
    </div>
  );
}

/** [toast, zeigen]: zeigen(meldung, aktion?, dauer = 4000) */
export function useToast() {
  const [toast, setToast] = useState(null);
  const uhr = useRef(null);
  const zeigen = useCallback((meldung, aktion, dauer = 4000) => {
    clearTimeout(uhr.current);
    setToast(meldung ? { meldung, aktion } : null);
    if (meldung) uhr.current = setTimeout(() => setToast(null), dauer);
  }, []);
  useEffect(() => () => clearTimeout(uhr.current), []);
  return [toast, zeigen];
}

/** "5 min. ago", "yesterday", "3 weeks ago" or "vor 5 Min.", "gestern" */
export function zeitText(iso) {
  if (!iso) return '';
  const s = sprache();
  const rtf = new Intl.RelativeTimeFormat(s, { numeric: 'auto', style: 'short' });
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return t('time.justNow');
  if (min < 60) return rtf.format(-min, 'minute');
  const std = Math.round(min / 60);
  if (std < 24) return rtf.format(-std, 'hour');
  const tage = Math.max(1, Math.floor(ms / 864e5));
  if (tage < 7) return rtf.format(-tage, 'day');
  if (tage < 31) return rtf.format(-Math.round(tage / 7), 'week');
  const datum = new Date(iso).toLocaleDateString(s === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return t('time.onDate', { datum });
}
