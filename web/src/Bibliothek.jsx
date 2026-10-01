import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { boardAnlegen, boardLaden, listeLaden } from './daten/speicher.js';
import { aktivesTheme, einstellungenSetzen, useEinstellungen } from './daten/einstellungen.js';
import { DATEI_TYPEN, dateiImportieren } from './import/index.js';
import Icon, { Logo } from './ui/Icon.jsx';
import { Avatar, AvatarStapel, rufname } from './ui/Avatar.jsx';
import {
  Dialog, MenuePunkt, Segmente, Toast, musterStil, useToast, zeitText,
} from './ui/bausteine.jsx';
import { leinwand } from './zeichnen/farben.js';
import { Dokument } from './zeichnen/dokument.js';
import { alsDatei, vorschauBild } from './zeichnen/export.js';
import { dateiname, herunterladen } from './ui/datei.js';
import { bilderEinsammeln, bilderHochladen } from './daten/bilder.js';
import {
  ablageZiel, Brotkrumen, istFremd, OrdnerKachel, OrdnerLoeschenDialog, ordnerPfad, pfadText, teilbaum,
  VerschiebenDialog,
} from './bibliothek/Ordner.jsx';
import TeilenDialog from './editor/TeilenDialog.jsx';
import AbmeldenDialog from './ui/AbmeldenDialog.jsx';
import { SPRACHEN, sprache, t, useT } from './i18n/index.js';

// Home page: folders and boards as tiles, plus trash, create and import.
// ansicht: 'raster' or 'papierkorb'; ordnerId: where you are right now
// (both come from the URL).

const VORLAGEN = ['none', 'dots', 'grid', 'lines'];
const eigen = (b) => !b.recht || b.recht === 'besitzer';

export default function Bibliothek({ ansicht, ordnerId = null, oeffnen, meldung }) {
  const e = useEinstellungen();
  const t = useT();
  const [liste, setListe] = useState(null);
  const [fehler, setFehler] = useState('');
  const [suche, setSuche] = useState('');
  const [menueFuer, setMenueFuer] = useState(null);
  const [umbenennen, setUmbenennen] = useState(null);
  const [neuOffen, setNeuOffen] = useState(false);
  const [verschiebenWas, setVerschiebenWas] = useState(null);
  const [loeschenOrdner, setLoeschenOrdner] = useState(null);
  const [ziehen, setZiehen] = useState(null);   // { art: 'board'|'ordner', id }
  const [ablage, setAblage] = useState(null);   // folder id under the pointer
  const [teilenOrdner, setTeilenOrdner] = useState(null);
  const [korbOffen, setKorbOffen] = useState(null); // expanded folder in the trash (vorgang)
  const [abmeldenOffen, setAbmeldenOffen] = useState(false);
  const [toast, zeigen] = useToast();
  const dateiFeld = useRef(null);
  const [ich, setIch] = useState(null);

  useEffect(() => { api.me().then(setIch, () => {}); }, []);

  const neuLaden = useCallback(async () => {
    try {
      setListe(await listeLaden());
      setFehler('');
    } catch (err) {
      setFehler(meldung(err));
    }
  }, [meldung]);

  useEffect(() => { neuLaden(); }, [neuLaden]);

  const ordner = liste?.ordner ?? [];
  // A folder that does not exist (any more): continue at the top
  const cur = ordnerId && ordner.some((o) => o.id === ordnerId) ? ordnerId : null;
  const ordnerOeffnen = (id) => { location.hash = id ? `#/ordner/${encodeURIComponent(id)}` : '#/'; };
  useEffect(() => { setMenueFuer(null); setSuche(''); }, [ordnerId]);

  async function aktion(fn, text, rueck) {
    setMenueFuer(null);
    try {
      const ergebnis = await fn();
      await neuLaden();
      if (text) zeigen(typeof text === 'function' ? text(ergebnis) : text, typeof rueck === 'function' ? rueck(ergebnis) : rueck);
      return ergebnis;
    } catch (err) {
      zeigen(meldung(err));
      return null;
    }
  }

  async function exportieren(b) {
    setMenueFuer(null);
    try {
      const { meta, daten } = await boardLaden(b.id);
      const bilder = await bilderEinsammeln(b.id, daten.elemente);
      const blob = alsDatei(meta.titel, { hintergrund: meta.hintergrund, elemente: daten.elemente }, bilder);
      herunterladen(blob, `${dateiname(meta.titel)}.whiteboard`);
    } catch (err) {
      zeigen(meldung(err));
    }
  }

  function aktuellerOrdner() {
    return ordner.find((o) => o.id === cur);
  }

  async function importieren(datei) {
    if (!datei) return;
    zeigen(t('library.importing'), null, 60000);
    try {
      const { titel, daten, bericht, bilder } = await dateiImportieren(datei);
      const meta = await boardAnlegen({
        titel, hintergrund: daten.hintergrund, daten: { version: 1, elemente: daten.elemente },
        ordnerId: istFremd(aktuellerOrdner()) ? null : cur,
      });
      // Embedded images under their old ids to the new board
      if (bilder && Object.keys(bilder).length) await bilderHochladen(meta.id, bilder);
      // Send the thumbnail right away, otherwise the tile stays empty until
      // the board has been opened once.
      const dok = new Dokument();
      dok.laden(daten);
      const bild = vorschauBild(dok);
      if (bild && !meta.ausstehend) await api.vorschauSetzen(meta.id, bild).catch(() => {});
      await neuLaden();
      const weg = Object.entries(bericht.uebersprungen).map(([k, v]) => `${v}× ${k}`).join(', ');
      const anzahlBilder = bilder ? Object.keys(bilder).length : 0;
      zeigen(t('import.done', { titel, anzahl: bericht.striche + bericht.textmarker })
        + (bericht.formen ? t('import.shapes', { anzahl: bericht.formen }) : '')
        + (anzahlBilder ? t('import.images', { anzahl: anzahlBilder }) : '')
        + (weg ? t('import.skipped', { liste: weg }) : ''));
    } catch (err) {
      zeigen(err.message);
    }
  }

  /** Move a board or folder elsewhere, with undo. */
  async function verschieben(was, ziel) {
    const zielName = ziel ? ordner.find((o) => o.id === ziel)?.name : t('common.library');
    const zurueck = was.ort ?? null;
    const setzen = (wohin) => (was.art === 'board'
      ? api.boardAblegen(was.id, wohin)
      : api.ordnerAendern(was.id, { elternId: wohin }));
    await aktion(
      () => setzen(ziel),
      t('library.moved', { name: was.name, ziel: zielName }),
      { text: t('common.undo'), klick: () => aktion(() => setzen(zurueck)) },
    );
  }

  async function neuerOrdner(elternId, sofortUmbenennen) {
    const neu = await aktion(() => api.ordnerAnlegen(t('library.newFolder'), elternId));
    if (neu && sofortUmbenennen) setUmbenennen({ art: 'ordner', id: neu.id });
    return neu;
  }

  if (fehler) {
    return (
      <div className="bibliothek">
        <div className="leer-zustand"><div className="fehlerkasten">{fehler}</div></div>
      </div>
    );
  }
  if (!liste) return <div className="bibliothek" />;

  // ---- What is there to see?
  const filter = e.bibFilter ?? 'alle';
  const q = suche.trim().toLowerCase();
  // Search or filter show results across folders, with the path on every tile
  const global = !!q || filter !== 'alle';
  let boards = liste.boards;
  if (filter === 'meine') boards = boards.filter(eigen);
  if (filter === 'geteilt') boards = boards.filter((b) => !eigen(b));
  boards = global ? boards.filter((b) => b.titel.toLowerCase().includes(q)) : boards.filter((b) => (b.ordnerId ?? null) === cur);
  if (e.sortierung === 'name') boards = [...boards].sort((a, b) => a.titel.localeCompare(b.titel, 'de'));
  let sichtbareOrdner = global
    ? (q && filter === 'alle' ? ordner.filter((o) => o.name.toLowerCase().includes(q))
      : !q && filter === 'geteilt' ? ordner.filter((o) => istFremd(o) && !o.elternId) : [])
    : ordner.filter((o) => (o.elternId ?? null) === cur);
  sichtbareOrdner = [...sichtbareOrdner].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const aktuell = ordner.find((o) => o.id === cur);
  // In someone else's (shared) folder: view and open, but do not create or
  // put anything in, it belongs to someone else
  const fremdHier = istFremd(aktuell);
  const eigeneOrdner = ordner.filter((o) => !istFremd(o));
  const allesLeer = !liste.boards.length && !ordner.length;
  const ordnerLeer = !global && !!cur && !boards.length && !sichtbareOrdner.length;
  const globalText = q
    ? t('library.results', { suche: suche.trim() })
    : filter === 'geteilt' ? t('library.sharedAll') : t('library.mineAll');
  const papierkorb = liste.papierkorb;
  // Deleted folders; boards that went with one of them are inside it
  const korbOrdner = liste.papierkorbOrdner ?? [];
  const korbVorgaenge = new Set(korbOrdner.map((o) => o.vorgang));
  const loseImKorb = papierkorb.filter((b) => !korbVorgaenge.has(b.vorgang));
  const korbAnzahl = loseImKorb.length + korbOrdner.length;
  const restTage = (geloeschtAm) => {
    const tage = Math.floor((Date.now() - new Date(geloeschtAm).getTime()) / 864e5);
    return Math.max(0, (liste.papierkorbTage ?? 30) - tage);
  };
  const korbKachel = (b) => {
    const rest = restTage(b.geloeschtAm);
    return (
      <div key={b.id} className="kachel">
        <Vorschau board={b} gedimmt />
        <div className="kachel-text">
          <span className="kachel-titel gedimmt">{b.titel}</span>
          <span className="kachel-meta">{t('trash.deletedAgo', { zeit: zeitText(b.geloeschtAm) })} · {t('trash.daysLeft', { anzahl: rest })}</span>
        </div>
        <div className="kachel-knoepfe">
          <button
            type="button"
            className="knopf-zweit breit"
            onClick={() => aktion(() => api.wiederherstellen(b.id), t('trash.restored', { name: b.titel }))}
          >
            <Icon name="wiederherstellen" groesse={18} staerke={1.8} />{t('common.restore')}
          </button>
          <button
            type="button"
            className="knopf-zweit quadrat gefahr-text"
            title={t('trash.deleteForever')}
            aria-label={t('trash.deleteForever')}
            onClick={() => aktion(() => api.endgueltigLoeschen(b.id), t('trash.deletedForever', { name: b.titel }))}
          >
            <Icon name="loeschen" groesse={18} staerke={1.8} />
          </button>
        </div>
      </div>
    );
  };

  const ordnerMeta = (o) => {
    const nb = liste.boards.filter((b) => b.ordnerId === o.id).length;
    const no = ordner.filter((x) => x.elternId === o.id).length;
    const teile = [];
    if (nb) teile.push(t('count.boards', { anzahl: nb }));
    if (no) teile.push(t('count.folders', { anzahl: no }));
    return teile.length ? teile.join(' · ') : t('common.empty');
  };

  // --------- Drag and drop (desktop)
  const zielFuer = (id) => (istFremd(ordner.find((o) => o.id === id)) ? {} : ablageZiel(id, {
    ziehen,
    ablage,
    setAblage,
    ablegen: (zielId) => {
      const quelle = ziehen;
      setZiehen(null);
      if (!quelle) return;
      if (quelle.art === 'ordner' && zielId && teilbaum(quelle.id, ordner).has(zielId)) return;
      const ding = quelle.art === 'board'
        ? liste.boards.find((b) => b.id === quelle.id)
        : ordner.find((o) => o.id === quelle.id);
      if (!ding) return;
      const ort = quelle.art === 'board' ? ding.ordnerId ?? null : ding.elternId ?? null;
      if (ort === zielId) return;
      verschieben({ art: quelle.art, id: quelle.id, name: ding.titel ?? ding.name, ort }, zielId);
    },
  }));
  const ziehenStart = (art, id) => (ev) => {
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', `${art}:${id}`);
    setZiehen({ art, id });
    setMenueFuer(null);
  };
  const ziehenEnde = () => { setZiehen(null); setAblage(null); };

  // Counts for "Delete folder?"
  const loeschenZaehler = (() => {
    if (!loeschenOrdner) return null;
    const ids = teilbaum(loeschenOrdner.id, ordner);
    const drin = liste.boards.filter((b) => b.ordnerId && ids.has(b.ordnerId));
    return { unter: ids.size - 1, eigene: drin.filter(eigen).length, geteilt: drin.filter((b) => !eigen(b)).length };
  })();

  return (
    <div
      className="bibliothek"
      onDragOver={(ev) => { if (!ziehen && ev.dataTransfer?.types?.includes('Files')) ev.preventDefault(); }}
      onDrop={(ev) => {
        if (ziehen || !ev.dataTransfer?.files?.length) return;
        ev.preventDefault();
        importieren(ev.dataTransfer.files[0]);
      }}
    >
      {ansicht === 'papierkorb' ? (
        <>
          <header className="bib-kopf">
            <button type="button" className="knopf-geist" onClick={() => { location.hash = '#/'; }}>
              <Icon name="zurueck" groesse={20} staerke={1.8} />{t('common.library')}
            </button>
            <span className="bib-titel">{t('trash.title')}</span>
            <div className="fuellen" />
            {korbAnzahl > 0 && (
              <button
                type="button"
                className="knopf-zweit gefahr-text"
                onClick={() => aktion(() => api.papierkorbLeeren(), t('trash.emptied'))}
              >
                {t('trash.empty')}
              </button>
            )}
          </header>
          <p className="bib-hinweis">
            {t('trash.hint', { tage: liste.papierkorbTage ?? 30 })}
          </p>
          {korbOrdner.length > 0 && (
            <>
              <div className="korb-abschnitt">{t('trash.folders')}</div>
              <div className="ordner-raster korb-ordner-raster">
                {korbOrdner.map((o) => {
                  const rest = restTage(o.geloeschtAm);
                  const inhalt = [
                    o.boards ? t('count.boards', { anzahl: o.boards }) : null,
                    o.unterordner ? t('count.subfolders', { anzahl: o.unterordner }) : null,
                  ].filter(Boolean).join(' · ') || t('common.empty');
                  const auf = korbOffen === o.vorgang;
                  return (
                    <div key={o.vorgang} className={`korb-ordner${auf ? ' offen' : ''}`}>
                      <button
                        type="button"
                        className="korb-ordner-kopf"
                        aria-expanded={auf}
                        disabled={!o.boards}
                        title={o.boards ? t('trash.showContents') : undefined}
                        onClick={() => setKorbOffen(auf ? null : o.vorgang)}
                      >
                        <span className="ordner-symbol"><Icon name="ordner" groesse={22} /></span>
                        <span className="ordner-text">
                          <span className="ordner-name gedimmt">{o.name}</span>
                          <span className="ordner-meta">{inhalt} · {t('trash.daysLeft', { anzahl: rest })}</span>
                        </span>
                        {o.boards > 0 && <Icon name="aufklappen" groesse={18} staerke={2} className="korb-pfeil" />}
                      </button>
                      <div className="kachel-knoepfe">
                        <button
                          type="button"
                          className="knopf-zweit breit"
                          title={o.elternName ? t('trash.restoreTo', { name: o.elternName }) : t('trash.restoreToLibrary')}
                          onClick={() => aktion(() => api.ordnerWiederherstellen(o.vorgang), t('trash.folderRestored', { name: o.name }))}
                        >
                          <Icon name="wiederherstellen" groesse={18} staerke={1.8} />{t('common.restore')}
                        </button>
                        <button
                          type="button"
                          className="knopf-zweit quadrat gefahr-text"
                          title={t('trash.deleteWithContents')}
                          aria-label={t('trash.deleteWithContents')}
                          onClick={() => aktion(() => api.korbOrdnerLoeschen(o.vorgang), t('trash.folderDeletedForever', { name: o.name }))}
                        >
                          <Icon name="loeschen" groesse={18} staerke={1.8} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {korbOffen && korbVorgaenge.has(korbOffen) && (
                <>
                  <div className="korb-abschnitt">
                    {t('trash.in', { name: korbOrdner.find((o) => o.vorgang === korbOffen)?.name })}
                    <span>{t('trash.inHint')}</span>
                  </div>
                  <div className="raster raster-papierkorb">
                    {papierkorb.filter((b) => b.vorgang === korbOffen).map(korbKachel)}
                  </div>
                </>
              )}
              {loseImKorb.length > 0 && <div className="korb-abschnitt">{t('trash.boards')}</div>}
            </>
          )}
          {loseImKorb.length ? (
            <div className="raster raster-papierkorb">
              {loseImKorb.map(korbKachel)}
            </div>
          ) : !korbOrdner.length && (
            <div className="papierkorb-leer">
              <span>{t('trash.isEmpty')}</span>
              <span>{t('trash.isEmptyHint')}</span>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Row 1: logo, search, import, trash (design V2, 3a) */}
          <header className="bib-kopf">
            <div className="marke"><Logo /><span>{t('app.name')}</span></div>
            <label className="suche">
              <Icon name="suche" groesse={18} staerke={1.8} />
              <input value={suche} onChange={(ev) => setSuche(ev.target.value)} placeholder={t('library.search')} />
              {suche && (
                <button type="button" className="suche-leeren" title={t('library.clearSearch')} aria-label={t('library.clearSearch')} onClick={() => setSuche('')}>
                  <Icon name="schliessen" groesse={16} staerke={2} />
                </button>
              )}
            </label>
            <div className="fuellen" />
            <button
              type="button"
              className="kopf-knopf"
              title={t('library.importTitle')}
              aria-label={t('library.import')}
              onClick={() => dateiFeld.current?.click()}
            >
              <Icon name="import" groesse={20} />
            </button>
            <button
              type="button"
              className="kopf-knopf"
              title={t('trash.title')}
              aria-label={t('trash.title')}
              onClick={() => { location.hash = '#/papierkorb'; }}
            >
              <Icon name="loeschen" groesse={20} />
              {korbAnzahl > 0 && <span className="zaehler">{korbAnzahl}</span>}
            </button>
            {ich && (
              <div className="ich-halter">
                <button
                  type="button"
                  className="ich-knopf"
                  title={t('account.signedInAs', { email: ich.email })}
                  aria-label={t('account.label')}
                  aria-expanded={menueFuer === 'ich'}
                  onClick={() => setMenueFuer(menueFuer === 'ich' ? null : 'ich')}
                >
                  <Avatar person={ich} groesse={36} />
                </button>
                {menueFuer === 'ich' && (
                  <div className="menue ich-menue">
                    <div className="ich-kopf">
                      <Avatar person={ich} groesse={40} />
                      <span className="person-text">
                        <span>{ich.name ?? ich.email}</span>
                        <span>{ich.email}</span>
                      </span>
                    </div>
                    <span className="menue-trenner" />
                    <div className="ich-sprache">
                      <span>{t('settings.language')}</span>
                      <Segmente optionen={SPRACHEN} wert={sprache()} setzen={(neu) => einstellungenSetzen({ sprache: neu })} />
                    </div>
                    {ich.abmelden !== null && (
                      <>
                        <span className="menue-trenner" />
                        <MenuePunkt icon="abmelden" text={t('account.signOut')} onClick={() => { setMenueFuer(null); setAbmeldenOffen(true); }} />
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            <input
              ref={dateiFeld}
              type="file"
              accept={DATEI_TYPEN}
              hidden
              onChange={(ev) => { importieren(ev.target.files[0]); ev.target.value = ''; }}
            />
          </header>

          {/* Row 2: path or results, new folder, filter, sorting */}
          {!allesLeer && (
            <div className="bib-zeile2">
              {global ? (
                <span className="bib-global">
                  <Icon name="bibliothek" groesse={18} />
                  <span><strong>{boards.length + sichtbareOrdner.length}</strong> {globalText}</span>
                </span>
              ) : (
                <>
                  <Brotkrumen pfad={ordnerPfad(cur, ordner)} oeffnen={ordnerOeffnen} ziel={zielFuer} />
                  {fremdHier ? (
                    <span className="fremd-hinweis" title={aktuell.recht === 'ansehen' ? t('rights.view') : t('rights.edit')}>
                      <Icon name="teilen" groesse={17} />{t('library.sharedBy', { name: rufname(aktuell.besitzer) })}
                    </span>
                  ) : (
                    <button type="button" className="knopf-zweit neuer-ordner" onClick={() => neuerOrdner(cur, true)}>
                      <Icon name="ordnerNeu" groesse={19} />{t('library.newFolder')}
                    </button>
                  )}
                </>
              )}
              <Segmente
                optionen={[{ wert: 'alle', text: t('filter.all') }, { wert: 'meine', text: t('filter.mine') }, { wert: 'geteilt', text: t('filter.shared') }]}
                wert={filter}
                setzen={(v) => einstellungenSetzen({ bibFilter: v })}
              />
              <Segmente
                optionen={[{ wert: 'zuletzt', text: t('sort.recent') }, { wert: 'name', text: t('sort.name') }]}
                wert={e.sortierung}
                setzen={(v) => einstellungenSetzen({ sortierung: v })}
              />
            </div>
          )}

          {liste.offline && <p className="bib-hinweis">{t('library.offline')}</p>}

          {allesLeer ? (
            <div className="leer-zustand">
              <div className="leer-inhalt">
                <div className="leer-karte" style={musterStil('dots', 20)}>
                  <svg width="280" height="190" viewBox="0 0 280 190" fill="none" strokeLinecap="round">
                    <path d="M92 128 C 130 122, 170 126, 196 121" stroke="rgba(255,220,50,.7)" strokeWidth="16" />
                  </svg>
                  <span>{t('empty.hello')}</span>
                </div>
                <div className="leer-text">
                  <span className="leer-titel">{t('empty.title')}</span>
                  <span>{t('empty.text')}</span>
                </div>
                <button type="button" className="knopf-primaer gross" onClick={() => setNeuOffen(true)}>
                  <Icon name="plus" groesse={20} staerke={2} />{t('newBoard.title')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {sichtbareOrdner.length > 0 && (
                <div className="ordner-raster">
                  {sichtbareOrdner.map((o) => (
                    <OrdnerKachel
                      key={o.id}
                      ordner={o}
                      meta={global ? pfadText(o.elternId, ordner) : ordnerMeta(o)}
                      oeffnen={() => { setSuche(''); if (filter !== 'alle') einstellungenSetzen({ bibFilter: 'alle' }); ordnerOeffnen(o.id); }}
                      menueOffen={menueFuer === `o:${o.id}`}
                      menue={(auf) => setMenueFuer(auf ? `o:${o.id}` : null)}
                      umbenennen={umbenennen?.art === 'ordner' && umbenennen.id === o.id}
                      umbenennenStarten={() => setUmbenennen({ art: 'ordner', id: o.id })}
                      umbenennenFertig={async (name) => {
                        setUmbenennen(null);
                        if (name && name !== o.name) await aktion(() => api.ordnerAendern(o.id, { name }));
                      }}
                      verschieben={() => {
                        setMenueFuer(null);
                        setVerschiebenWas({ art: 'ordner', id: o.id, name: o.name, ort: o.elternId ?? null });
                      }}
                      loeschen={() => { setMenueFuer(null); setLoeschenOrdner(o); }}
                      teilen={() => { setMenueFuer(null); setTeilenOrdner(o); }}
                      ausBibliothekEntfernen={ich && (() => {
                        if (cur && teilbaum(o.id, ordner).has(cur)) ordnerOeffnen(null);
                        aktion(
                          () => api.ordnerFreigabeEntfernen(o.id, ich.email),
                          t('common.removedName', { name: o.name }),
                          { text: t('common.undo'), klick: () => aktion(() => api.ordnerFreigabeZurueck(o.id)) },
                        );
                      })}
                      ziel={zielFuer(o.id)}
                      ziehenStart={ziehenStart('ordner', o.id)}
                      ziehenEnde={ziehenEnde}
                      wirdGezogen={ziehen?.art === 'ordner' && ziehen.id === o.id}
                    />
                  ))}
                </div>
              )}

              {ordnerLeer ? (
                <div className={`ordner-leer${zielFuer(cur).aktiv ? ' ablage' : ''}`} {...zielFuer(cur)}>
                  <span className="ordner-leer-symbol"><Icon name="ordner" groesse={28} staerke={1.6} /></span>
                  <span className="ordner-leer-text">
                    <span>{t('folder.isEmpty', { name: aktuell?.name })}</span>
                    <span>
                      {fremdHier
                        ? t('folder.emptyShared', { name: rufname(aktuell.besitzer) })
                        : t('folder.emptyOwn')}
                    </span>
                  </span>
                  {!fremdHier && <div className="ordner-leer-knoepfe">
                    <button type="button" className="knopf-primaer" onClick={() => setNeuOffen(true)}>
                      <Icon name="plus" groesse={19} staerke={2} />{t('newBoard.title')}
                    </button>
                    <button type="button" className="knopf-zweit" onClick={() => neuerOrdner(cur, true)}>
                      <Icon name="ordnerNeu" groesse={19} />{t('library.newFolder')}
                    </button>
                  </div>}
                </div>
              ) : global && !boards.length && !sichtbareOrdner.length ? (
                <div className="keine-treffer">
                  {q ? t('library.nothingFound', { suche: suche.trim() }) : filter === 'geteilt' ? t('library.noneShared') : t('library.noneOwn')}
                </div>
              ) : (
                <div className="raster">
                  {!global && !fremdHier && (
                    <button type="button" className="neu-kachel" onClick={() => setNeuOffen(true)}>
                      <span className="neu-plus"><Icon name="plus" groesse={28} staerke={2} /></span>
                      <span className="neu-text">
                        <span>{t('newBoard.title')}</span>
                        <span>{cur ? t('newBoard.in', { name: aktuell?.name }) : t('newBoard.templates')}</span>
                      </span>
                    </button>
                  )}
                  {boards.map((b) => (
                    <BoardKachel
                      key={b.id}
                      board={b}
                      pfad={global ? pfadText(b.ordnerId ?? null, ordner) : null}
                      menueOffen={menueFuer === b.id}
                      menue={(auf) => setMenueFuer(auf ? b.id : null)}
                      umbenennen={umbenennen?.art === 'board' && umbenennen.id === b.id}
                      umbenennenStarten={() => { setMenueFuer(null); setUmbenennen({ art: 'board', id: b.id }); }}
                      umbenennenFertig={async (titel) => {
                        setUmbenennen(null);
                        if (titel && titel !== b.titel) await aktion(() => api.boardSpeichern(b.id, { titel }));
                      }}
                      oeffnen={() => oeffnen(b.id)}
                      duplizieren={() => aktion(
                        () => api.duplizieren(b.id),
                        eigen(b) ? t('board.duplicated') : t('board.copied'),
                      )}
                      verschieben={!b.ueberOrdner && (() => {
                        setMenueFuer(null);
                        setVerschiebenWas({
                          art: 'board', id: b.id, name: b.titel, ort: b.ordnerId ?? null,
                          geteiltVon: eigen(b) ? null : rufname(b.besitzer),
                        });
                      })}
                      exportieren={() => exportieren(b)}
                      entfernen={ich && !b.ueberOrdner && (() => aktion(
                        () => api.freigabeEntfernen(b.id, ich.email),
                        t('common.removedName', { name: b.titel }),
                        { text: t('common.undo'), klick: () => aktion(() => api.freigabeZurueck(b.id)) },
                      ))}
                      loeschen={() => aktion(
                        () => api.inPapierkorb(b.id),
                        t('board.inTrash', { name: b.titel }),
                        { text: t('common.undo'), klick: () => aktion(() => api.wiederherstellen(b.id)) },
                      )}
                      ziehenStart={b.ueberOrdner ? undefined : ziehenStart('board', b.id)}
                      ziehenEnde={ziehenEnde}
                      wirdGezogen={ziehen?.art === 'board' && ziehen.id === b.id}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {menueFuer && <div className="menue-scrim" onClick={() => setMenueFuer(null)} />}

      <NeuDialog
        offen={neuOffen}
        pfad={pfadText(cur, ordner)}
        schliessen={() => setNeuOffen(false)}
        anlegen={async (titel, muster) => {
          setNeuOffen(false);
          try {
            // In dark mode a new board starts on the dark chalkboard
            const farbe = aktivesTheme(e.darstellung) === 'dark' ? 'slate' : 'white';
            const meta = await boardAnlegen({ titel, hintergrund: { farbe, muster }, ordnerId: cur });
            oeffnen(meta.id);
          } catch (err) {
            zeigen(meldung(err));
          }
        }}
      />

      <VerschiebenDialog
        was={verschiebenWas}
        ordner={eigeneOrdner}
        schliessen={() => setVerschiebenWas(null)}
        neuerOrdner={(elternId) => neuerOrdner(elternId, false)}
        verschieben={(ziel) => { const w = verschiebenWas; setVerschiebenWas(null); verschieben(w, ziel); }}
      />

      <OrdnerLoeschenDialog
        ordner={loeschenOrdner}
        zaehler={loeschenZaehler}
        schliessen={() => setLoeschenOrdner(null)}
        loeschen={() => {
          const o = loeschenOrdner;
          setLoeschenOrdner(null);
          // Whoever was in that folder (or below it) ends up one level higher
          if (cur && teilbaum(o.id, ordner).has(cur)) ordnerOeffnen(o.elternId ?? null);
          aktion(
            () => api.ordnerLoeschen(o.id),
            t('folder.deleted', { name: o.name }),
            (erg) => ({ text: t('common.undo'), klick: () => aktion(() => api.ordnerWiederherstellen(erg.vorgang)) }),
          );
        }}
      />

      {ich && (
        <TeilenDialog
          art="ordner"
          ordnerId={teilenOrdner?.id}
          titel={teilenOrdner?.name ?? ''}
          offen={!!teilenOrdner}
          schliessen={() => { setTeilenOrdner(null); neuLaden(); }}
          ich={ich}
          zeigen={zeigen}
          meldung={meldung}
        />
      )}

      <AbmeldenDialog offen={abmeldenOffen} schliessen={() => setAbmeldenOffen(false)} ich={ich} />

      <Toast meldung={toast?.meldung} aktion={toast?.aktion && { ...toast.aktion, klick: () => { zeigen(null); toast.aktion.klick(); } }} />
    </div>
  );
}

/** Who besides me: for own boards the invited people, for others' the owner. */
function teilenInfo(board) {
  if (board.recht && board.recht !== 'besitzer' && board.besitzer) {
    return {
      zeile: t('board.sharedWithMeBy', { name: rufname(board.besitzer) }) + (board.recht === 'ansehen' ? t('board.viewOnlySuffix') : ''),
      personen: [board.besitzer],
    };
  }
  const n = board.geteiltMit?.length ?? 0;
  if (!n) return { zeile: null, personen: [] };
  return { zeile: t('board.sharedWithCount', { anzahl: n }), personen: board.geteiltMit };
}

function Vorschau({ board, gedimmt, personen }) {
  const bg = leinwand(board.hintergrund?.farbe);
  const [kaputt, setKaputt] = useState(false);
  return (
    <div
      className={`vorschau${gedimmt ? ' gedimmt' : ''}`}
      style={{ backgroundColor: bg.color, ...musterStil(board.hintergrund?.muster, 14, bg.dark) }}
    >
      {board.hatVorschau && !kaputt && (
        <img src={api.vorschauUrl(board)} alt="" loading="lazy" draggable="false" onError={() => setKaputt(true)} />
      )}
      {personen?.length > 0 && (
        <span className="vorschau-avatare"><AvatarStapel personen={personen} groesse={26} ring={bg.color} /></span>
      )}
    </div>
  );
}

function BoardKachel({
  board, pfad, menueOffen, menue, umbenennen, umbenennenStarten, umbenennenFertig, oeffnen, duplizieren, loeschen,
  exportieren, entfernen, verschieben, ziehenStart, ziehenEnde, wirdGezogen,
}) {
  const t = useT();
  const eigenes = !board.recht || board.recht === 'besitzer';
  const info = teilenInfo(board);
  const [titel, setTitel] = useState(board.titel);
  const druck = useRef(null);

  useEffect(() => { setTitel(board.titel); }, [board.titel]);

  // A long press (>= 500 ms) opens the menu, as usual on the iPad.
  const langDruecken = {
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse') return;
      druck.current = setTimeout(() => { druck.current = 'lang'; menue(true); }, 500);
    },
    onPointerUp: () => { if (druck.current !== 'lang') clearTimeout(druck.current); },
    onPointerLeave: () => { if (druck.current !== 'lang') clearTimeout(druck.current); },
    onContextMenu: (e) => { e.preventDefault(); menue(true); },
  };

  return (
    <div className={`kachel${wirdGezogen ? ' gezogen' : ''}`}>
      <button
        type="button"
        className="kachel-flaeche"
        draggable={!!ziehenStart}
        onDragStart={ziehenStart}
        onDragEnd={ziehenEnde}
        aria-label={t('board.open', { name: board.titel })}
        onClick={() => {
          if (druck.current === 'lang') { druck.current = null; return; }
          oeffnen();
        }}
        {...langDruecken}
      >
        <Vorschau board={board} personen={info.personen} />
      </button>
      <div className="kachel-zeile">
        <div className="kachel-text">
          {umbenennen ? (
            <input
              className="umbenennen"
              value={titel}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              onFocus={(e) => e.target.select()}
              onChange={(e) => setTitel(e.target.value)}
              onBlur={() => umbenennenFertig(titel.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.target.blur();
                if (e.key === 'Escape') { setTitel(board.titel); umbenennenFertig(null); }
              }}
            />
          ) : (
            <span className="kachel-titel" onDoubleClick={eigenes ? umbenennenStarten : undefined}>{board.titel}</span>
          )}
          <span className="kachel-meta">
            {board.ausstehend ? t('board.notSynced') : t('board.changed', { zeit: zeitText(board.geaendertAm) })}
          </span>
          {info.zeile && (
            <span className="kachel-teilen">
              <Icon name="personen" groesse={15} staerke={1.9} />
              <span>{info.zeile}</span>
            </span>
          )}
          {pfad && (
            <span className="kachel-pfad">
              <Icon name="ordner" groesse={14} staerke={1.9} />
              <span>{pfad}</span>
            </span>
          )}
        </div>
        <button
          type="button"
          title={t('common.more')}
          aria-label={t('common.more')}
          aria-expanded={menueOffen}
          className={`kachel-mehr${menueOffen ? ' aktiv' : ''}`}
          onClick={() => menue(!menueOffen)}
        >
          <Icon name="mehr" groesse={20} />
        </button>
      </div>
      {menueOffen && (
        <div className="menue kachel-menue">
          {eigenes ? (
            <>
              <MenuePunkt icon="stift" text={t('common.rename')} onClick={umbenennenStarten} />
              <MenuePunkt icon="duplizieren" text={t('common.duplicate')} onClick={duplizieren} />
              <MenuePunkt icon="verschieben" text={t('common.moveTo')} onClick={verschieben} />
              <MenuePunkt icon="export" text={t('board.export')} onClick={exportieren} />
              <span className="menue-trenner" />
              <MenuePunkt icon="loeschen" text={t('board.toTrash')} gefahr onClick={loeschen} />
            </>
          ) : (
            <>
              {verschieben && <MenuePunkt icon="verschieben" text={t('common.moveTo')} onClick={verschieben} />}
              <MenuePunkt icon="duplizieren" text={t('board.copyToMine')} onClick={duplizieren} />
              <MenuePunkt icon="export" text={t('board.export')} onClick={exportieren} />
              {entfernen && (
                <>
                  <span className="menue-trenner" />
                  <MenuePunkt icon="personEntfernen" text={t('board.removeFromLibrary')} gefahr onClick={entfernen} />
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function NeuDialog({ offen, schliessen, anlegen, pfad }) {
  const e = useEinstellungen();
  const t = useT();
  const dunkel = aktivesTheme(e.darstellung) === 'dark';
  const bg = leinwand(dunkel ? 'slate' : 'white');
  const [name, setName] = useState('');
  const [muster, setMuster] = useState('dots');
  useEffect(() => { if (offen) { setName(''); setMuster('dots'); } }, [offen]);
  const erstellen = () => anlegen(name.trim() || t('newBoard.untitled'), muster);
  return (
    <Dialog
      titel={t('newBoard.title')}
      offen={offen}
      schliessen={schliessen}
      className="neu-dialog"
      fuss={(
        <>
          <span className="neu-ziel"><Icon name="ordner" groesse={16} />{pfad}</span>
          <div className="fuellen" />
          <button type="button" className="knopf-geist" onClick={schliessen}>{t('common.cancel')}</button>
          <button type="button" className="knopf-primaer" onClick={erstellen}>{t('newBoard.create')}</button>
        </>
      )}
    >
      <label className="feld">
        <span>{t('newBoard.name')}</span>
        <input
          value={name}
          placeholder={t('newBoard.untitled')}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') erstellen(); }}
        />
      </label>
      <div className="feld">
        <span>{t('newBoard.template')}</span>
        <div className="vorlagen">
          {VORLAGEN.map((id) => (
            <button type="button" key={id} className="vorlage" onClick={() => setMuster(id)} aria-pressed={muster === id}>
              <span className={muster === id ? 'gewaehlt' : ''} style={{ backgroundColor: bg.color, ...musterStil(id, 12, dunkel) }} />
              {t(`pattern.${id}`)}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
