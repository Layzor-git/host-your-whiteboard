import { useEffect, useState } from 'react';
import Leinwand from './Leinwand.jsx';
import { dateiImportieren } from './import/index.js';
import { FORMEN } from './zeichnen/elemente.js';
import { farbeAufloesen } from './zeichnen/farben.js';
import { GLAETTUNG_STANDARD } from './zeichnen/glaettung.js';

// Testflaeche fuer das Stiftgefuehl (#/labor). Ein Entwicklerwerkzeug,
// darum nur auf Englisch und ohne Sprachwahl. Die Bedienung hier ist Werkstatt,
// nicht das spaetere Design: Sie soll nur alle Regler erreichbar machen.
// Die Einstellungen merkt sich der Browser, damit man nach dem Neuladen
// weitervergleichen kann.

const SPEICHER = 'wb.labor.3';
const FARBEN = ['graphite', 'red', 'blue', 'green', 'orange', 'purple'];
const MARKER = ['hl-yellow', 'hl-green', 'hl-blue', 'hl-pink'];
const NAMEN = {
  stift: 'Pen', marker: 'Marker', radierer: 'Eraser', form: 'Shape', lasso: 'Lasso', hand: 'Hand',
};
const FORM_NAMEN = {
  linie: 'Line', pfeil: 'Arrow', rechteck: 'Rectangle', ellipse: 'Ellipse', dreieck: 'Triangle',
};

function laden() {
  try {
    return JSON.parse(localStorage.getItem(SPEICHER)) ?? {};
  } catch {
    return {};
  }
}

function sichern(z) {
  try {
    localStorage.setItem(SPEICHER, JSON.stringify({ stile: z.stile, einst: z.einst, hintergrund: z.hintergrund }));
  } catch {
    // privater Modus o. ae., dann eben ohne Gedaechtnis
  }
}

export default function Labor() {
  const [ed, setEd] = useState(null);
  const [z, setZ] = useState(null);
  const [offen, setOffen] = useState(true);
  const [meldung, setMeldung] = useState('');

  async function importieren(datei) {
    if (!datei || !ed) return;
    try {
      const { daten, bericht } = await dateiImportieren(datei);
      ed.dok.laden(daten);
      ed.allesAnzeigen();
      const weg = Object.entries(bericht.uebersprungen).map(([k, v]) => `${v}× ${k}`).join(', ');
      setMeldung(`Imported ${bericht.striche} strokes, ${bericht.textmarker} highlighter strokes${weg ? ` · skipped: ${weg}` : ''}`);
    } catch (e) {
      setMeldung(e.message);
    }
  }

  useEffect(() => {
    if (!ed) return undefined;
    // Zum Nachsehen in der Konsole, nur beim Entwickeln.
    if (import.meta.env.DEV) window.editor = ed;
    const alt = laden();
    if (alt.stile) for (const [k, v] of Object.entries(alt.stile)) ed.stilSetzen(k, v);
    if (alt.einst) ed.einstellungenSetzen(alt.einst);
    if (alt.hintergrund) ed.hintergrundSetzen(alt.hintergrund);
    return ed.beiZustand((neu) => {
      setZ(neu);
      sichern(neu);
    });
  }, [ed]);

  const statistik = z && ed ? zaehlen(ed) : null;

  return (
    <div
      className="labor"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); importieren(e.dataTransfer.files[0]); }}
    >
      <Leinwand onBereit={setEd} />

      {z && (
        <aside className={`labor-leiste${offen ? '' : ' zu'}`}>
          <div className="labor-kopf">
            <a href="#/" className="klein">← back</a>
            <strong>Smoothing lab</strong>
            <button type="button" className="labor-mini" onClick={() => setOffen(!offen)}>
              {offen ? '–' : '+'}
            </button>
          </div>

          {offen && (
            <>
              <div className="labor-reihe">
                {Object.keys(NAMEN).map((w) => (
                  <button
                    type="button"
                    key={w}
                    className={`labor-knopf${labWerkzeug(z) === w ? ' an' : ''}`}
                    onClick={() => {
                      // Stift und Marker sind fuer die Engine dasselbe Werkzeug
                      if (w === 'stift' || w === 'marker') {
                        const marker = w === 'marker';
                        if (marker !== !!z.stile.stift.textmarker) {
                          ed.stilSetzen('stift', marker
                            ? { textmarker: true, farbe: 'hl-yellow', breite: 20 }
                            : { textmarker: false, farbe: 'graphite', breite: 3 });
                        }
                        ed.werkzeugSetzen('stift');
                      } else {
                        ed.werkzeugSetzen(w);
                      }
                    }}
                  >
                    {NAMEN[w]}
                  </button>
                ))}
              </div>

              {(labWerkzeug(z) === 'stift' || z.werkzeug === 'form') && (
                <StiftStil ed={ed} name={z.werkzeug} stil={z.stile[z.werkzeug]} farben={FARBEN} max={30} />
              )}
              {labWerkzeug(z) === 'marker' && (
                <StiftStil ed={ed} name="stift" stil={z.stile.stift} farben={MARKER} max={60} />
              )}
              {z.werkzeug === 'form' && (
                <div className="labor-reihe">
                  {FORMEN.map((f) => (
                    <button
                      type="button"
                      key={f}
                      className={`labor-knopf${z.stile.form.art === f ? ' an' : ''}`}
                      onClick={() => ed.stilSetzen('form', { art: f })}
                    >
                      {FORM_NAMEN[f]}
                    </button>
                  ))}
                </div>
              )}
              {z.werkzeug === 'radierer' && (
                <>
                  <div className="labor-reihe">
                    {[['strich', 'Whole strokes'], ['punkt', 'Precise']].map(([m, t]) => (
                      <button
                        type="button"
                        key={m}
                        className={`labor-knopf${z.stile.radierer.modus === m ? ' an' : ''}`}
                        onClick={() => ed.stilSetzen('radierer', { modus: m })}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <Regler
                    name="Size" wert={z.stile.radierer.groesse} min={6} max={120} schritt={1}
                    setzen={(v) => ed.stilSetzen('radierer', { groesse: v })}
                  />
                </>
              )}

              <h3>Pen feel</h3>
              <Regler
                name="Stabilisation" wert={z.einst.stabilisierung} min={0} max={1} schritt={0.05}
                setzen={(v) => ed.einstellungenSetzen({ stabilisierung: v })}
              />
              <Regler
                name="Smoothing" wert={z.einst.glaettung} min={0} max={1} schritt={0.05}
                setzen={(v) => ed.einstellungenSetzen({ glaettung: v })}
              />
              <Regler
                name="Simplification" wert={z.einst.vereinfachung} min={0} max={1} schritt={0.05}
                setzen={(v) => ed.einstellungenSetzen({ vereinfachung: v })}
              />
              <button
                type="button"
                className="labor-link"
                onClick={() => ed.einstellungenSetzen(GLAETTUNG_STANDARD)}
              >
                Defaults
              </button>

              <Schalter name="Pressure sensitive (pen)" an={z.einst.druck}
                setzen={(v) => ed.einstellungenSetzen({ druck: v })} />
              <Schalter name="Finger draws" an={z.einst.fingerZeichnet}
                setzen={(v) => ed.einstellungenSetzen({ fingerZeichnet: v })} />
              <Schalter name="Show raw input (new strokes)" an={z.einst.rohMerken}
                setzen={(v) => ed.einstellungenSetzen({ rohMerken: v })} />

              <h3>Background</h3>
              <div className="labor-reihe">
                {[['none', 'Blank'], ['dots', 'Dots'], ['grid', 'Grid'], ['lines', 'Lined'], ['slate', 'Chalkboard']].map(([m, t]) => (
                  <button
                    type="button"
                    key={m}
                    className={`labor-knopf${(m === 'slate' ? z.hintergrund.farbe === 'slate' : z.hintergrund.muster === m) ? ' an' : ''}`}
                    onClick={() => ed.hintergrundSetzen(m === 'slate'
                      ? { farbe: z.hintergrund.farbe === 'slate' ? 'white' : 'slate' }
                      : { muster: m })}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div className="labor-reihe">
                <button type="button" className="labor-knopf" disabled={!z.kannRueck} onClick={() => ed.rueckgaengig()}>↶</button>
                <button type="button" className="labor-knopf" disabled={!z.kannVor} onClick={() => ed.wiederholen()}>↷</button>
                <button type="button" className="labor-knopf" onClick={() => ed.allesAnzeigen()}>Fit</button>
                <button type="button" className="labor-knopf" onClick={() => ed.zoomZuruecksetzen()}>
                  {Math.round(z.zoom * 100)} %
                </button>
                <button type="button" className="labor-knopf" onClick={() => ed.leeren()}>Clear</button>
                <label className="labor-knopf">
                  MS import …
                  <input
                    type="file" accept=".zip,.html,.htm" hidden
                    onChange={(e) => { importieren(e.target.files[0]); e.target.value = ''; }}
                  />
                </label>
              </div>
              {meldung && <p className="klein">{meldung}</p>}

              <dl className="labor-zahlen">
                <dt>Elements</dt><dd>{z.anzahl}</dd>
                <dt>Points stored</dt><dd>{statistik.punkte}</dd>
                <dt>Last stroke</dt>
                <dd>
                  {z.letzterStrich
                    ? `${z.letzterStrich.roh} raw → ${z.letzterStrich.gespeichert}`
                    : '–'}
                </dd>
                <dt>Redraw</dt><dd>{z.dauer.toFixed(1)} ms</dd>
              </dl>
              <p className="klein">
                Shift = straight line, Shift+Ctrl = 15° steps · Ctrl+A/C/V/D, Del ·
                Space = hand · Ctrl+wheel = zoom · Shift+1 = fit
              </p>
            </>
          )}
        </aside>
      )}
    </div>
  );
}

function labWerkzeug(z) {
  return z.werkzeug === 'stift' && z.stile.stift.textmarker ? 'marker' : z.werkzeug;
}

function zaehlen(ed) {
  let punkte = 0;
  for (const el of ed.dok.elemente) punkte += el.punkte ? el.punkte.length / 2 : 2;
  return { punkte };
}

function StiftStil({ ed, name, stil, farben, max }) {
  return (
    <>
      <div className="labor-reihe">
        {farben.map((f) => (
          <button
            type="button"
            key={f}
            aria-label={f}
            className={`labor-farbe${stil.farbe === f ? ' an' : ''}`}
            style={{ background: farbeAufloesen(f, false) }}
            onClick={() => ed.stilSetzen(name, { farbe: f })}
          />
        ))}
      </div>
      <Regler
        name="Width" wert={stil.breite} min={1} max={max} schritt={0.5}
        setzen={(v) => ed.stilSetzen(name, { breite: v })}
      />
    </>
  );
}

function Regler({ name, wert, min, max, schritt, setzen }) {
  return (
    <label className="labor-regler">
      <span>{name}</span>
      <input
        type="range" min={min} max={max} step={schritt} value={wert}
        onChange={(e) => setzen(Number(e.target.value))}
      />
      <output>{schritt < 1 ? wert.toFixed(2) : wert}</output>
    </label>
  );
}

function Schalter({ name, an, setzen }) {
  return (
    <label className="labor-schalter">
      <input type="checkbox" checked={an} onChange={(e) => setzen(e.target.checked)} />
      <span>{name}</span>
    </label>
  );
}
