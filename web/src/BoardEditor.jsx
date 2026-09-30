import { useCallback, useEffect, useRef, useState } from 'react';
import Leinwand from './Leinwand.jsx';
import Werkzeugleiste, { WerkzeugPopover } from './editor/Werkzeugleiste.jsx';
import Auswahl from './editor/Auswahl.jsx';
import EinstellungenDialog from './editor/EinstellungenDialog.jsx';
import TeilenDialog from './editor/TeilenDialog.jsx';
import AbmeldenDialog from './ui/AbmeldenDialog.jsx';
import { useT } from './i18n/index.js';
import { AvatarStapel, rufname } from './ui/Avatar.jsx';
import { api } from './api.js';
import Icon from './ui/Icon.jsx';
import { IconKnopf, Kbd, MenuePunkt, Toast, Trenner, musterStil, useToast } from './ui/bausteine.jsx';
import { ausstehendeSenden, boardLaden, metaAendern } from './daten/speicher.js';
import { LiveBoard } from './daten/live.js';
import { einstellungenSetzen, istTouch, useEinstellungen } from './daten/einstellungen.js';
import { glaettungAusRegler } from './zeichnen/editor.js';
import { alsDatei, alsPng, alsSvgText, vorschauBild } from './zeichnen/export.js';
import { bildQuelleSetzen } from './zeichnen/elemente.js';
import { BILD_TYPEN, bildHochladen, bildVorbereiten, bilderEinsammeln, groesseText } from './daten/bilder.js';
import { dateiname, herunterladen } from './ui/datei.js';
import { CANVAS_BG, leinwand, PATTERN } from './zeichnen/farben.js';

// Der Editor (Design 1a-2j): Leinwand ueber den ganzen Schirm, alles
// andere schwebt darueber.
//
// Werkzeuge der Oberflaeche: slot0..slot3, radierer, lasso, formen. Die
// Engine kennt nur stift/radierer/form/lasso; welcher Slot gerade welche
// Farbe hat, wird hier uebersetzt.

function istEingabefeld(ziel) {
  return ziel instanceof HTMLElement
    && (ziel.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ziel.tagName));
}

function useMedien(anfrage) {
  const [trifft, setTrifft] = useState(() => window.matchMedia?.(anfrage).matches ?? false);
  useEffect(() => {
    const abfrage = window.matchMedia?.(anfrage);
    if (!abfrage) return undefined;
    const neu = () => setTrifft(abfrage.matches);
    neu();
    abfrage.addEventListener('change', neu);
    return () => abfrage.removeEventListener('change', neu);
  }, [anfrage]);
  return trifft;
}

const useHochformat = () => useMedien('(orientation: portrait)');

// Handy (schmal, oder quer mit wenig Hoehe): Das Board startet zum Ansehen,
// die Werkzeuge kommen erst ueber "Bearbeiten".
const useHandy = () => useMedien('(max-width: 599px), (max-height: 499px) and (pointer: coarse)');

export default function BoardEditor({ id, meldung }) {
  const e = useEinstellungen();
  const t = useT();
  const [ed, setEd] = useState(null);
  const [z, setZ] = useState(null);
  const [titel, setTitel] = useState('');
  const [geladen, setGeladen] = useState(false);
  const [fehler, setFehler] = useState('');
  const [speicherZustand, setSpeicherZustand] = useState('saved');
  const [recht, setRecht] = useState('besitzer');
  // Wer gerade im Board ist (je Verbindung, auch eigene andere Geraete)
  const [personen, setPersonen] = useState([]);
  // Mit wem das Board geteilt ist (nur fuer den Besitzer bekannt)
  const [geteiltMit, setGeteiltMit] = useState([]);
  const [teilenOffen, setTeilenOffen] = useState(false);
  // Bilder, die gerade hochladen oder daran gescheitert sind (Platzhalter)
  const [uploads, setUploads] = useState([]);
  const [ablegen, setAblegen] = useState(false);
  const ablegenZaehler = useRef(0);
  const dateiFeld = useRef(null);
  const kameraFeld = useRef(null);
  const ersetzenFeld = useRef(null);
  const ersetzenId = useRef(null);
  const [ich, setIch] = useState(null);
  const ichRef = useRef(null);

  useEffect(() => {
    api.me().then((m) => { ichRef.current = m; setIch(m); }, () => {});
  }, []);
  const [werkzeug, setWerkzeug] = useState(() => `slot${e.letzterSlot ?? 0}`);
  const [pop, setPop] = useState(null);
  const [menue, setMenue] = useState(false);
  const [hintergrundOffen, setHintergrundOffen] = useState(false);
  const [einstOffen, setEinstOffen] = useState(false);
  const [abmeldenOffen, setAbmeldenOffen] = useState(false);
  const [toast, zeigen] = useToast();
  const gespeicherterTitel = useRef('');
  const titelFeld = useRef(null);
  const hochformat = useHochformat();
  const handy = useHandy();
  const [handyBearbeiten, setHandyBearbeiten] = useState(false);
  const handyAnsicht = handy && !handyBearbeiten;

  const allesZu = useCallback(() => {
    setPop(null);
    setMenue(false);
    setHintergrundOffen(false);
  }, []);

  // ---- Board laden und live mit dem Pi abgleichen
  useEffect(() => {
    if (!ed) return undefined;
    let aus = false;
    let live = null;
    let abmelden = null;

    (async () => {
      try {
        const { meta, daten } = await boardLaden(id);
        if (aus) return;
        ed.dok.laden({ hintergrund: meta.hintergrund, elemente: daten?.elemente ?? [] });
        ed.allesAnzeigen();
        setTitel(meta.titel ?? '');
        gespeicherterTitel.current = meta.titel ?? '';
        setGeladen(true);
        setRecht(meta.recht ?? 'besitzer');
        setGeteiltMit(meta.geteiltMit ?? []);
        live = new LiveBoard(id, ed.dok, {
          beiZustand: setSpeicherZustand,
          // Nur-Lesen setzt der Effekt weiter unten
          beiIch: ({ recht: r }) => setRecht(r),
          beiAnwesenheit: setPersonen,
          // Eigene andere Geraete zeichnen live mit, aber ohne Namensetikett
          beiEntwurf: (von, el, person) => ed.entwurfSetzen(
            von, el, person?.email === ichRef.current?.email ? null : person,
          ),
          beiAusgesperrt: () => setFehler(t('editor.noAccess')),
          // Umbenannt auf einem anderen Geraet; nicht waehrend man tippt
          beiMeta: ({ titel: t }) => {
            if (!t || document.activeElement === titelFeld.current) return;
            gespeicherterTitel.current = t;
            setTitel(t);
          },
        });
        setSpeicherZustand(live.zustand);
        const ab1 = ed.dok.beiAenderung((ev) => {
          if (ev.art === 'ops') live.vorschau(() => vorschauBild(ed.dok));
        });
        const ab2 = ed.beiEntwurf((el) => live.entwurf(el));
        abmelden = () => { ab1(); ab2(); };
      } catch (err) {
        if (!aus) setFehler(meldung(err));
      }
    })();

    return () => {
      aus = true;
      abmelden?.();
      live?.zerstoeren();
      // Was die Verbindung nicht mehr geschafft hat, liegt im Puffer
      setTimeout(() => ausstehendeSenden().catch(() => {}), 500);
    };
  }, [ed, id, meldung]);

  // ---- Bilder dieses Boards: Adresse zur Id, Strg+V mit Bildern
  useEffect(() => {
    bildQuelleSetzen((bildId) => api.bildUrl(id, bildId));
  }, [id]);

  const bilderEinfuegen = useCallback((dateien, punkt) => {
    if (!ed || recht === 'ansehen') return;
    setPop(null);
    const mitte = punkt ?? ed.sichtMitte();
    dateien.forEach((datei, i) => {
      const versatz = 24 / ed.kamera.z * i;
      bildStarten({ datei, mitte: { x: mitte.x + versatz, y: mitte.y + versatz }, key: `${Date.now()}-${i}` });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed, recht]);

  useEffect(() => {
    if (!ed) return undefined;
    return ed.beiDateien((dateien, punkt) => bilderEinfuegen(dateien, punkt));
  }, [ed, bilderEinfuegen]);

  // ---- Engine-Zustand in React spiegeln, Beruehrung schliesst Popover
  useEffect(() => {
    if (!ed) return undefined;
    const a = ed.beiZustand(setZ);
    const b = ed.beiBeruehrung(allesZu);
    return () => { a(); b(); };
  }, [ed, allesZu]);

  // ---- Einstellungen und Werkzeugwahl an die Engine geben
  useEffect(() => {
    if (!ed) return;
    // Am Handy gibt es keinen Stift: Beim Bearbeiten zeichnet der Finger
    ed.einstellungenSetzen({
      ...glaettungAusRegler(e.glaettung),
      druck: e.druck,
      fingerZeichnet: handy ? handyBearbeiten : e.fingerZeichnet,
    });
    ed.stilSetzen('radierer', e.radierer);
    ed.stilSetzen('form', { ...e.form, breite: e.form.breite ?? 3 });
    ed.stilSetzen('auswahl', { art: e.auswahlArt ?? 'pfeil' });
    if (werkzeug.startsWith('slot')) {
      const s = e.slots[Number(werkzeug.slice(4))];
      ed.stilSetzen('stift', { farbe: s.farbe, breite: s.breite, textmarker: s.art === 'marker' });
      if (ed.werkzeug !== 'stift') ed.werkzeugSetzen('stift');
    } else {
      const ziel = { radierer: 'radierer', lasso: 'lasso', formen: 'form' }[werkzeug];
      if (ed.werkzeug !== ziel) ed.werkzeugSetzen(ziel);
    }
  }, [ed, e, werkzeug, handy, handyBearbeiten]);

  // Nur ansehen: wegen des Rechts, oder am Handy, solange man nicht bearbeitet
  useEffect(() => {
    if (ed && geladen) ed.nurLesenSetzen(recht === 'ansehen' || handyAnsicht);
  }, [ed, geladen, recht, handyAnsicht]);

  // Die Engine waehlt selbst Lasso (Strg+A, Einfuegen): nachziehen. Nur
  // beim Wechsel dorthin, sonst holte ein veralteter Zustand die
  // Oberflaeche zurueck, waehrend sie gerade auf einen Stift umschaltet.
  const engineWerkzeug = useRef(null);
  useEffect(() => {
    const vorher = engineWerkzeug.current;
    engineWerkzeug.current = z?.werkzeug;
    if (z?.werkzeug === 'lasso' && vorher && vorher !== 'lasso') {
      setPop(null);
      setWerkzeug('lasso');
    }
  }, [z?.werkzeug]);

  const waehlen = useCallback((t) => {
    if (t === 'bild') {
      setMenue(false);
      setHintergrundOffen(false);
      setPop((p) => (p === 'bild' ? null : 'bild'));
      return;
    }
    const mitPopover = t.startsWith('slot') || t === 'radierer' || t === 'formen' || t === 'lasso';
    if (t === werkzeug) {
      if (mitPopover) setPop((p) => (p === t ? null : t));
      setMenue(false);
      setHintergrundOffen(false);
      return;
    }
    allesZu();
    setWerkzeug(t);
    if (t.startsWith('slot')) einstellungenSetzen({ letzterSlot: Number(t.slice(4)) });
  }, [werkzeug, allesZu]);

  // ---- Tastenkuerzel der Oberflaeche (die Leinwand hat ihre eigenen)
  useEffect(() => {
    const taste = (ev) => {
      if (istEingabefeld(ev.target) || einstOffen || teilenOffen) return;
      const strg = ev.ctrlKey || ev.metaKey;
      if (strg && ev.key === ',') { ev.preventDefault(); allesZu(); setEinstOffen(true); return; }
      if (strg || ev.altKey || ev.repeat) return;
      const k = ev.key.toLowerCase();
      if (k === 'escape') {
        if (pop || menue || hintergrundOffen) allesZu();
        else if (ed?.auswahl.size) ed.auswahlSetzen([]);
        return;
      }
      if (ev.shiftKey) return;
      if (k >= '1' && k <= '4') { waehlen(`slot${Number(k) - 1}`); return; }
      if (k === 'p') {
        const letzter = e.letzterSlot ?? 0;
        waehlen(`slot${e.slots[letzter]?.art === 'stift' ? letzter : 0}`);
        return;
      }
      if (k === 'h') { waehlen(`slot${Math.max(0, e.slots.findIndex((s) => s.art === 'marker'))}`); return; }
      if (k === 'l') { waehlen('lasso'); return; }
      if (k === 'e') {
        // Stift <-> Radierer, auch fuer die Seitentaste am Wacom-Stift
        if (werkzeug === 'radierer') waehlen(`slot${e.letzterSlot ?? 0}`);
        else waehlen('radierer');
      }
    };
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  }, [ed, e, werkzeug, pop, menue, hintergrundOffen, einstOffen, teilenOffen, waehlen, allesZu]);

  function uploadSetzen(key, teil) {
    setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...teil } : x)));
  }

  /** Ein Bild vorbereiten, als Platzhalter zeigen, hochladen, einsetzen. */
  async function bildStarten({ datei, mitte, key }) {
    const k = ed.kamera;
    const eintrag = { key, datei, mitte, name: datei.name || 'Bild', groesse: datei.size, fortschritt: 0 };
    let vorbereitet;
    try {
      vorbereitet = await bildVorbereiten(datei);
    } catch (err) {
      const w = 300 / k.z;
      setUploads((u) => [...u.filter((x) => x.key !== key), { ...eintrag, w, h: (200 / k.z), fehler: err.message }]);
      return;
    }
    const max = Math.min(ed.renderer.breite, ed.renderer.hoehe) * 0.6 / k.z;
    const f = Math.min(1, max / Math.max(vorbereitet.breite, vorbereitet.hoehe, 1));
    const neu = {
      ...eintrag,
      w: vorbereitet.breite * f,
      h: vorbereitet.hoehe * f,
      vorschau: vorbereitet.vorschau,
      groesse: vorbereitet.blob.size,
      vorbereitet,
      fehler: null,
    };
    setUploads((u) => [...u.filter((x) => x.key !== key), neu]);
    try {
      const bild = await bildHochladen(id, vorbereitet.blob, vorbereitet, (p) => uploadSetzen(key, { fortschritt: p }));
      ed.bildEinsetzen({ bild, breite: vorbereitet.breite, hoehe: vorbereitet.hoehe, name: neu.name, mitte });
      setWerkzeug('lasso');
      setUploads((u) => u.filter((x) => x.key !== key));
      URL.revokeObjectURL(vorbereitet.vorschau);
    } catch (err) {
      uploadSetzen(key, { fehler: err.message });
    }
  }

  function uploadEntfernen(key) {
    setUploads((u) => {
      const x = u.find((v) => v.key === key);
      if (x?.vorschau) URL.revokeObjectURL(x.vorschau);
      return u.filter((v) => v.key !== key);
    });
  }

  async function ausZwischenablage() {
    setPop(null);
    try {
      const eintraege = await navigator.clipboard.read();
      const dateien = [];
      for (const e of eintraege) {
        const typ = e.types.find((t) => t.startsWith('image/'));
        if (typ) dateien.push(new File([await e.getType(typ)], `Zwischenablage.${typ.split('/')[1]}`, { type: typ }));
      }
      if (dateien.length) bilderEinfuegen(dateien, null);
      else zeigen(t('editor.clipboardNoImage'));
    } catch {
      zeigen(t('editor.clipboardDenied'));
    }
  }

  async function ersetzenDatei(datei) {
    const elId = ersetzenId.current;
    if (!datei || !elId) return;
    zeigen(t('editor.imageUploading'), null, 60000);
    try {
      const v = await bildVorbereiten(datei);
      const bild = await bildHochladen(id, v.blob, v);
      ed.bildErsetzen(elId, { bild, breite: v.breite, hoehe: v.hoehe, name: datei.name });
      URL.revokeObjectURL(v.vorschau);
      zeigen(t('editor.imageReplaced'), null, 1600);
    } catch (err) {
      zeigen(err.message);
    }
  }

  function titelSpeichern() {
    const t = titel.trim();
    if (!t) { setTitel(gespeicherterTitel.current); return; }
    if (t === gespeicherterTitel.current) return;
    gespeicherterTitel.current = t;
    metaAendern(id, { titel: t }).catch((err) => zeigen(meldung(err)));
  }

  async function zurueck() {
    titelSpeichern();
    let ziel = '#/';
    try { ziel = sessionStorage.getItem('wb.zurueck') || '#/'; } catch { /* egal */ }
    location.hash = ziel.startsWith('#/board/') ? '#/' : ziel;
  }

  async function exportieren(art) {
    setMenue(false);
    if (!ed) return;
    const name = dateiname(titel);
    if (art === 'png') herunterladen(await alsPng(ed.dok), `${name}.png`);
    else if (art === 'svg') herunterladen(new Blob([await alsSvgText(ed.dok)], { type: 'image/svg+xml' }), `${name}.svg`);
    else {
      const daten = ed.dok.alsDaten();
      herunterladen(alsDatei(titel, daten, await bilderEinsammeln(id, daten.elemente)), `${name}.whiteboard`);
    }
  }

  const anwesend = [];
  for (const p of personen) {
    if (p.email === ich?.email || anwesend.some((a) => a.email === p.email)) continue;
    anwesend.push(p);
  }
  const hintergrund = z?.hintergrund ?? { farbe: 'white', muster: 'dots' };
  const bg = leinwand(hintergrund.farbe);
  const dunkel = !!bg.dark;
  const zoomProzent = z ? Math.round(z.zoom * 100) : 100;

  if (fehler) {
    return (
      <div className="bibliothek">
        <div className="leer-zustand">
          <div className="leer-inhalt">
            <div className="fehlerkasten">{fehler}</div>
            <button type="button" className="knopf-primaer" onClick={() => { location.hash = '#/'; }}>{t('editor.toLibrary')}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`editor ${dunkel ? 'wb-inkdark' : 'wb-inklight'}${geladen ? ' bereit' : ''}${handy ? ' handy' : ''}${handy && handyBearbeiten ? ' handy-bearbeiten' : ''}`}
      style={{ '--canvas': bg.color }}
      onDragEnter={(ev) => {
        if (recht === 'ansehen' || !ev.dataTransfer?.types?.includes('Files')) return;
        ev.preventDefault();
        ablegenZaehler.current++;
        setAblegen(true);
      }}
      onDragOver={(ev) => { if (ablegen) ev.preventDefault(); }}
      onDragLeave={() => {
        ablegenZaehler.current = Math.max(0, ablegenZaehler.current - 1);
        if (!ablegenZaehler.current) setAblegen(false);
      }}
      onDrop={(ev) => {
        if (!ablegen) return;
        ev.preventDefault();
        ablegenZaehler.current = 0;
        setAblegen(false);
        const dateien = [...ev.dataTransfer.files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
        if (dateien.length) bilderEinfuegen(dateien, ed.weltVonSchirm(ev.clientX, ev.clientY));
      }}
    >
      <Leinwand onBereit={setEd} />

      {z && geladen && (
        <>
          {/* Oben links: zurueck, Titel, Speicherstatus */}
          <div className="leiste oben-links">
            <IconKnopf icon="zurueck" titel={t('editor.toLibrary')} onClick={zurueck} />
            <input
              ref={titelFeld}
              className="titel-feld"
              value={titel}
              aria-label={t('editor.boardTitle')}
              readOnly={recht === 'ansehen'}
              size={Math.max(4, Math.min(28, titel.length + 1))}
              onChange={(ev) => setTitel(ev.target.value)}
              onBlur={titelSpeichern}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') ev.currentTarget.blur();
                if (ev.key === 'Escape') { setTitel(gespeicherterTitel.current); ev.currentTarget.blur(); }
              }}
            />
            {recht !== 'ansehen' && <SpeicherStatus zustand={speicherZustand} />}
          </div>

          {recht === 'ansehen' && (
            <div className="nur-ansehen-marke">
              <Icon name="ansehen" groesse={16} staerke={1.9} />{t('rights.view')}
            </div>
          )}

          {/* Oben rechts: Anwesenheit, Teilen | Rueckgaengig, Wiederholen | Menue */}
          <div className="leiste oben-rechts">
            {anwesend.length > 0 && (
              <button
                type="button"
                className="anwesenheit"
                title={t('editor.presentNow', { namen: anwesend.map(rufname).join(', ') })}
                onClick={() => { if (recht === 'besitzer') setTeilenOffen(true); }}
              >
                <AvatarStapel personen={anwesend} groesse={32} />
              </button>
            )}
            {recht === 'besitzer' && !(handy && handyBearbeiten) && ((istTouch && hochformat) || handy ? (
              <button type="button" className="teilen-knopf kompakt" title={t('share.button')} aria-label={t('share.button')} onClick={() => { allesZu(); setTeilenOffen(true); }}>
                <Icon name="teilen" groesse={21} staerke={1.9} />
                {geteiltMit.length > 0 && <span className="teilen-zaehler-rund">{geteiltMit.length}</span>}
              </button>
            ) : (
              <button type="button" className="teilen-knopf" title={t('share.button')} onClick={() => { allesZu(); setTeilenOffen(true); }}>
                <Icon name="teilen" groesse={19} staerke={1.9} />{t('share.button')}
                {geteiltMit.length > 0 && <span className="teilen-zaehler">{geteiltMit.length}</span>}
              </button>
            ))}
            {(recht === 'besitzer' || anwesend.length > 0) && !handy && <Trenner />}
            {recht !== 'ansehen' && !handyAnsicht && (
              <>
                <IconKnopf icon="rueckgaengig" titel={t('editor.undo')} disabled={!z.kannRueck} onClick={() => ed.rueckgaengig()} />
                <IconKnopf icon="wiederholen" titel={t('editor.redo')} disabled={!z.kannVor} onClick={() => ed.wiederholen()} />
                {!handy && <Trenner />}
              </>
            )}
            {handy && handyBearbeiten && (
              <button
                type="button"
                className="handy-fertig"
                title={t('common.done')}
                aria-label={t('common.done')}
                onClick={() => { allesZu(); setHandyBearbeiten(false); }}
              >
                <Icon name="haken" groesse={22} staerke={2.2} />
              </button>
            )}
            <IconKnopf
              icon="mehr"
              titel={t('editor.menu')}
              aktiv={menue}
              onClick={() => { setPop(null); setHintergrundOffen(false); setMenue(!menue); }}
            />
          </div>

          {menue && (
            <div className="menue editor-menue">
              {recht !== 'ansehen' && (
                <>
                  <MenuePunkt icon="hintergrund" text={t('editor.background')} onClick={() => { setMenue(false); setHintergrundOffen(true); }} />
                  <span className="menue-trenner" />
                </>
              )}
              <MenuePunkt icon="export" text={t('editor.exportPng')} onClick={() => exportieren('png')} />
              <MenuePunkt icon="export" text={t('editor.exportSvg')} onClick={() => exportieren('svg')} />
              <MenuePunkt icon="export" text={t('editor.exportFile')} onClick={() => exportieren('datei')} />
              <span className="menue-trenner" />
              <MenuePunkt
                icon="einstellungen"
                text={t('settings.title')}
                kuerzel={istTouch ? null : `${t('common.ctrl')} ,`}
                onClick={() => { setMenue(false); setEinstOffen(true); }}
              />
              {ich && ich.abmelden !== null && (
                <>
                  <span className="menue-trenner" />
                  <MenuePunkt icon="abmelden" text={t('account.signOut')} onClick={() => { setMenue(false); setAbmeldenOffen(true); }} />
                </>
              )}
            </div>
          )}

          {hintergrundOffen && (
            <div className="menue hintergrund-popover">
              <div className="pop-kopf gross">
                <span>{t('bg.title')}</span>
                <IconKnopf icon="schliessen" titel={t('common.close')} groesse={18} className="klein" onClick={() => setHintergrundOffen(false)} />
              </div>
              <span className="pop-label">{t('bg.color')}</span>
              <div className="bg-farben">
                {CANVAS_BG.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    title={t(`canvas.${c.id}`)}
                    aria-label={t(`canvas.${c.id}`)}
                    aria-pressed={hintergrund.farbe === c.id}
                    className={`bg-farbe${hintergrund.farbe === c.id ? ' gewaehlt' : ''}`}
                    style={{ background: c.color }}
                    onClick={() => ed.hintergrundSetzen({ farbe: c.id })}
                  />
                ))}
              </div>
              <span className="pop-label">{t('bg.pattern')}</span>
              <div className="bg-muster">
                {Object.entries(PATTERN).map(([pid, p]) => (
                  <button type="button" key={pid} aria-pressed={hintergrund.muster === pid} onClick={() => ed.hintergrundSetzen({ muster: pid })}>
                    <span
                      className={hintergrund.muster === pid ? 'gewaehlt' : ''}
                      style={{ backgroundColor: bg.color, ...musterStil(pid, Math.round((p.step ?? 24) * 0.55), dunkel) }}
                    />
                    {t(`pattern.${pid}`)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {recht !== 'ansehen' && !handyAnsicht && (
          <Werkzeugleiste
            e={e}
            ohneFinger={handy}
            werkzeug={werkzeug}
            waehlen={waehlen}
            fingerUmschalten={() => {
              einstellungenSetzen({ fingerZeichnet: !e.fingerZeichnet });
              zeigen(!e.fingerZeichnet ? t('editor.fingerDraws') : t('editor.fingerPans'), null, 1600);
            }}
            bildOffen={pop === 'bild'}
            popover={(
              <WerkzeugPopover
                e={e}
                pop={pop}
                dunkel={dunkel}
                leinwandFarbe={hintergrund.farbe}
                bildAktionen={{
                  datei: () => { setPop(null); dateiFeld.current?.click(); },
                  kamera: () => { setPop(null); kameraFeld.current?.click(); },
                  zwischenablage: ausZwischenablage,
                }}
              />
            )}
          />
          )}

          {handyAnsicht && (
            <>
              <button type="button" className="handy-knopf handy-alles" title={t('editor.fitAll')} aria-label={t('editor.fitAll')} onClick={() => ed.allesAnzeigen()}>
                <Icon name="alles" groesse={22} />
              </button>
              {recht !== 'ansehen' && (
                <button type="button" className="handy-knopf handy-bearbeiten" onClick={() => { allesZu(); setHandyBearbeiten(true); }}>
                  <Icon name="stift" groesse={21} staerke={1.9} />{t('editor.startEditing')}
                </button>
              )}
            </>
          )}

          {istTouch && recht !== 'ansehen' && !handy && (
            <div className="schnellwahl">
              <button
                type="button"
                title={t('tool.pen')}
                aria-label={t('tool.pen')}
                className={werkzeug.startsWith('slot') ? 'an' : ''}
                onClick={() => { allesZu(); setWerkzeug(`slot${e.letzterSlot ?? 0}`); }}
              >
                <Icon name="stift" groesse={24} staerke={1.8} />
              </button>
              <button
                type="button"
                title={t('tool.eraser')}
                aria-label={t('tool.eraser')}
                className={werkzeug === 'radierer' ? 'an' : ''}
                onClick={() => { allesZu(); setWerkzeug('radierer'); }}
              >
                <Icon name="radierer" groesse={24} staerke={1.8} />
              </button>
            </div>
          )}

          {!handy && (
          <div className="leiste zoom-leiste">
            {!(istTouch && hochformat) && (
              <IconKnopf icon="minus" titel={t('zoom.out')} groesse={20} onClick={() => ed.zoomStufe(-1)} />
            )}
            <button type="button" className="zoom-wert" title={t('zoom.reset')} onClick={() => ed.zoomZuruecksetzen()}>
              {zoomProzent} %
            </button>
            {!(istTouch && hochformat) && (
              <IconKnopf icon="plus" titel={t('zoom.in')} groesse={20} onClick={() => ed.zoomStufe(1)} />
            )}
            <Trenner />
            <IconKnopf icon="alles" titel={t('editor.fitAllShortcut')} groesse={20} onClick={() => ed.allesAnzeigen()} />
          </div>
          )}

          <Auswahl
            a={z.auswahl}
            ed={ed}
            dunkel={dunkel}
            leinwandFarbe={hintergrund.farbe}
            hoehe={ed.renderer.hoehe}
            bildErsetzen={(elId) => { ersetzenId.current = elId; ersetzenFeld.current?.click(); }}
            // Die naechste Form bekommt dieselbe Dicke
            formBreiteGewaehlt={(breite) => einstellungenSetzen({ form: { ...e.form, breite } })}
          />

          {uploads.map((u) => (
            <BildPlatzhalter
              key={u.key}
              u={u}
              kamera={z.kamera}
              nochmal={() => bildStarten({ datei: u.datei, mitte: u.mitte, key: u.key })}
              entfernen={() => uploadEntfernen(u.key)}
            />
          ))}

          {ablegen && (
            <div className="ablege-flaeche">
              <div className="ablege-karte">
                <span className="ablege-symbol"><Icon name="hochladen" groesse={24} /></span>
                <span className="ablege-text">
                  <span>{t('editor.dropImage')}</span>
                  <span>{t('editor.dropImageHint')}</span>
                </span>
              </div>
            </div>
          )}

          <input ref={dateiFeld} type="file" accept={BILD_TYPEN} multiple hidden
            onChange={(ev) => { bilderEinfuegen([...ev.target.files], null); ev.target.value = ''; }} />
          <input ref={kameraFeld} type="file" accept="image/*" capture="environment" hidden
            onChange={(ev) => { bilderEinfuegen([...ev.target.files], null); ev.target.value = ''; }} />
          <input ref={ersetzenFeld} type="file" accept={BILD_TYPEN} hidden
            onChange={(ev) => { ersetzenDatei(ev.target.files[0]); ev.target.value = ''; }} />

          {z.hilfslinie && (
            <div className="winkel-chip" style={{ left: z.hilfslinie.x + 16, top: z.hilfslinie.y + 12 }}>
              <strong>{z.hilfslinie.grad}°</strong>
              {z.hilfslinie.eingerastet ? (
                <>
                  <span>{t('angle.snapped')}</span>
                  <Kbd>{t('common.ctrl')}</Kbd>
                </>
              ) : (
                <>
                  <span>{t('angle.snapWith')}</span>
                  <Kbd>{t('common.ctrl')}</Kbd>
                </>
              )}
            </div>
          )}

          <Toast meldung={toast?.meldung} aktion={toast?.aktion} oben />
          <EinstellungenDialog offen={einstOffen} schliessen={() => setEinstOffen(false)} />
          <AbmeldenDialog offen={abmeldenOffen} schliessen={() => setAbmeldenOffen(false)} ich={ich} />
          {recht === 'besitzer' && (
            <TeilenDialog
              offen={teilenOffen}
              schliessen={() => setTeilenOffen(false)}
              boardId={id}
              titel={titel}
              ich={ich}
              beiAenderung={setGeteiltMit}
              zeigen={zeigen}
              meldung={meldung}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Platzhalter waehrend des Hochladens bzw. nach einem Fehler (Design 8e). */
function BildPlatzhalter({ u, kamera, nochmal, entfernen }) {
  const t = useT();
  const k = kamera;
  const stil = {
    left: (u.mitte.x - u.w / 2 - k.x) * k.z,
    top: (u.mitte.y - u.h / 2 - k.y) * k.z,
    width: u.w * k.z,
    height: u.h * k.z,
  };
  const info = `${u.name} · ${groesseText(u.groesse)}`;
  if (u.fehler) {
    return (
      <div className="bild-platzhalter fehler" style={stil}>
        <Icon name="fehler" groesse={26} />
        <span className="bp-titel">{t('upload.failed')}</span>
        <span className="bp-info">{u.name} · {u.fehler}</span>
        <div className="bp-knoepfe">
          <button type="button" className="knopf-zweit" onClick={nochmal}>
            <Icon name="wiederherstellen" groesse={17} staerke={1.8} />{t('upload.retry')}
          </button>
          <button type="button" className="knopf-zweit quadrat" title={t('common.remove')} aria-label={t('common.remove')} onClick={entfernen}>
            <Icon name="schliessen" groesse={17} staerke={1.9} />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="bild-platzhalter" style={stil}>
      {u.vorschau && <img src={u.vorschau} alt="" className="bp-vorschau" />}
      <Icon name="bild" groesse={28} />
      <span className="bp-titel">{t('upload.progress', { prozent: Math.round((u.fortschritt ?? 0) * 100) })}</span>
      <span className="bp-balken"><span style={{ width: `${Math.round((u.fortschritt ?? 0) * 100)}%` }} /></span>
      <span className="bp-info">{info}</span>
    </div>
  );
}

function SpeicherStatus({ zustand }) {
  const t = useT();
  if (zustand === 'offline') {
    return (
      <span className="speicher offline">
        <Icon name="offline" groesse={16} staerke={1.9} />{t('save.offline')}
      </span>
    );
  }
  if (zustand === 'saving') {
    return <span className="speicher"><span className="drehkreis" />{t('save.saving')}</span>;
  }
  return (
    <span className="speicher">
      {t('save.saved')}
      <Icon name="haken" groesse={15} staerke={2.4} style={{ color: 'var(--ui-success)' }} />
    </span>
  );
}
