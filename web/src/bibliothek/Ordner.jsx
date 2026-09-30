import { useEffect, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import { Dialog, MenuePunkt } from '../ui/bausteine.jsx';
import { AvatarStapel, rufname } from '../ui/Avatar.jsx';
import { t, useT } from '../i18n/index.js';

// Ordner in der Bibliothek (Design 9a-9i): Kachel, Pfadleiste,
// "Verschieben nach ..." mit Ordnerbaum, "Ordner loeschen".

/** Kette der Ordner von oben bis zu id (ohne "Bibliothek"). */
export function ordnerPfad(id, ordner) {
  const pfad = [];
  const nachId = new Map(ordner.map((o) => [o.id, o]));
  let o = nachId.get(id);
  while (o && pfad.length < 50) {
    pfad.unshift(o);
    o = nachId.get(o.elternId);
  }
  return pfad;
}

export function pfadText(id, ordner) {
  return [t('common.library'), ...ordnerPfad(id, ordner).map((o) => o.name)].join(' › ');
}

/** id und alle Ordner darunter */
export function teilbaum(id, ordner) {
  const ids = new Set([id]);
  let neu = true;
  while (neu) {
    neu = false;
    for (const o of ordner) {
      if (o.elternId && ids.has(o.elternId) && !ids.has(o.id)) { ids.add(o.id); neu = true; }
    }
  }
  return ids;
}

const nachName = (a, b) => a.name.localeCompare(b.name, 'de');

/** Ablageziel fuer gezogene Boards und Ordner (HTML5-Drag&Drop). */
export function ablageZiel(zielId, { ziehen, ablage, setAblage, ablegen }) {
  const schluessel = zielId ?? '__oben';
  return {
    aktiv: !!ziehen && ablage === schluessel,
    onDragOver: (e) => {
      if (!ziehen) return;
      e.preventDefault();
      if (ablage !== schluessel) setAblage(schluessel);
    },
    onDragLeave: () => { if (ablage === schluessel) setAblage(null); },
    onDrop: (e) => {
      if (!ziehen) return;
      e.preventDefault();
      e.stopPropagation();
      setAblage(null);
      ablegen(zielId);
    },
  };
}

export function Brotkrumen({ pfad, oeffnen, ziel }) {
  const t = useT();
  const glieder = [{ id: null, name: t('common.library') }, ...pfad];
  return (
    <nav className="brotkrumen" aria-label={t('folder.path')}>
      {glieder.map((g, i) => {
        const letztes = i === glieder.length - 1;
        const z = letztes ? null : ziel(g.id);
        return (
          <span key={g.id ?? '__oben'} className="brotkrumen-glied">
            {i > 0 && <Icon name="pfad" groesse={16} staerke={1.9} className="brotkrumen-pfeil" />}
            {letztes ? (
              <span className="brotkrumen-titel">{g.name}</span>
            ) : (
              <button
                type="button"
                className={`brotkrumen-knopf${z.aktiv ? ' ablage' : ''}`}
                onClick={() => oeffnen(g.id)}
                onDragOver={z.onDragOver}
                onDragLeave={z.onDragLeave}
                onDrop={z.onDrop}
              >
                {g.name}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/** Gehoert der Ordner jemand anderem (ueber eine Ordnerfreigabe sichtbar)? */
export const istFremd = (o) => !!o?.besitzer;

export function OrdnerKachel({
  ordner, meta, oeffnen, menueOffen, menue, umbenennen, umbenennenStarten, umbenennenFertig, verschieben, loeschen,
  teilen, ausBibliothekEntfernen, ziel, ziehenStart, ziehenEnde, wirdGezogen,
}) {
  const t = useT();
  const [name, setName] = useState(ordner.name);
  useEffect(() => { setName(ordner.name); }, [ordner.name]);
  const fremd = istFremd(ordner);
  // Bei fremden Ordnern laesst sich nur die geteilte Wurzel entfernen
  const mitMenue = !fremd || ordner.geteilteWurzel;
  const personen = fremd ? [ordner.besitzer] : ordner.geteiltMit ?? [];
  return (
    <div className="ordner-halter">
      <div
        className={`ordner-kachel${ziel.aktiv ? ' ablage' : ''}${wirdGezogen ? ' gezogen' : ''}`}
        role="button"
        tabIndex={0}
        draggable={!umbenennen && !fremd}
        onDragStart={ziehenStart}
        onDragEnd={ziehenEnde}
        onDragOver={ziel.onDragOver}
        onDragLeave={ziel.onDragLeave}
        onDrop={ziel.onDrop}
        onClick={() => { if (!umbenennen) oeffnen(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !umbenennen) oeffnen(); }}
      >
        <span className="ordner-symbol"><Icon name="ordner" groesse={22} /></span>
        <span className="ordner-text">
          {umbenennen ? (
            <input
              className="umbenennen"
              value={name}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => umbenennenFertig(name.trim())}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') e.target.blur();
                if (e.key === 'Escape') { setName(ordner.name); umbenennenFertig(null); }
              }}
            />
          ) : (
            <span className="ordner-name">{ordner.name}</span>
          )}
          <span className="ordner-meta">
            {ziel.aktiv ? t('folder.dropHere') : fremd ? `${t('folder.from', { name: rufname(ordner.besitzer) })} · ${meta}` : meta}
          </span>
        </span>
        {personen.length > 0 && (
          <span className="ordner-personen" title={fremd ? t('library.sharedBy', { name: rufname(ordner.besitzer) }) : t('folder.sharedWith', { namen: personen.map(rufname).join(', ') })}>
            <AvatarStapel personen={personen} groesse={24} max={2} />
          </span>
        )}
        {mitMenue && (
          <button
            type="button"
            title={t('common.more')}
            aria-label={t('common.more')}
            aria-expanded={menueOffen}
            className={`kachel-mehr ordner-mehr${menueOffen ? ' aktiv' : ''}`}
            onClick={(e) => { e.stopPropagation(); menue(!menueOffen); }}
          >
            <Icon name="mehr" groesse={20} />
          </button>
        )}
      </div>
      {menueOffen && (
        <div className="menue kachel-menue ordner-menue">
          {fremd ? (
            <MenuePunkt icon="loeschen" text={t('board.removeFromLibrary')} gefahr onClick={ausBibliothekEntfernen} />
          ) : (
            <>
              <MenuePunkt icon="teilen" text={t('share.menu')} onClick={teilen} />
              <MenuePunkt icon="stift" text={t('common.rename')} onClick={() => { menue(false); umbenennenStarten(); }} />
              <MenuePunkt icon="verschieben" text={t('common.moveTo')} onClick={verschieben} />
              <span className="menue-trenner" />
              <MenuePunkt icon="loeschen" text={t('folder.delete')} gefahr onClick={loeschen} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * "Verschieben nach ..." (Design 9d/9e). was: { art: 'board'|'ordner',
 * id, name, ort, geteiltVon }. Beim Ordner sind er selbst und alles
 * darunter gesperrt.
 */
export function VerschiebenDialog({ was, ordner, schliessen, verschieben, neuerOrdner }) {
  const t = useT();
  const [wahl, setWahl] = useState(null);
  const [offen, setOffen] = useState([]);
  useEffect(() => {
    if (!was) return;
    setWahl(was.ort ?? null);
    setOffen(ordnerPfad(was.ort, ordner).map((o) => o.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [was]);
  if (!was) return null;

  const gesperrt = was.art === 'ordner' ? teilbaum(was.id, ordner) : new Set();
  const zeilen = [];
  const hinzu = (o, tiefe) => {
    const id = o ? o.id : null;
    const kinder = ordner.filter((x) => (x.elternId ?? null) === id).sort(nachName);
    const auf = id === null || offen.includes(id);
    const aus = id !== null && gesperrt.has(id);
    zeilen.push({ o, id, tiefe, hatKinder: kinder.length > 0 && !!o, auf, aus });
    if (auf && !aus) kinder.forEach((k) => hinzu(k, tiefe + 1));
  };
  hinzu(null, 0);

  return (
    <Dialog
      titel={t('common.moveTo')}
      untertitel={t('move.subtitle', { name: was.name, pfad: pfadText(was.ort, ordner) })}
      offen
      schliessen={schliessen}
      breite={520}
      className="verschieben-dialog"
      fuss={(
        <>
          <button type="button" className="knopf-geist" onClick={async () => {
            const neu = await neuerOrdner(wahl);
            if (neu) {
              setOffen((o) => [...o, wahl].filter(Boolean));
              setWahl(neu.id);
            }
          }}
          >
            <Icon name="ordnerNeu" groesse={19} />{t('library.newFolder')}
          </button>
          <div className="fuellen" />
          <button type="button" className="knopf-geist" onClick={schliessen}>{t('common.cancel')}</button>
          <button type="button" className="knopf-primaer" disabled={wahl === (was.ort ?? null)} onClick={() => verschieben(wahl)}>
            {t('move.here')}
          </button>
        </>
      )}
    >
      <div className="ordner-baum" role="tree">
        {zeilen.map((z) => (
          <div
            key={z.id ?? '__oben'}
            role="treeitem"
            aria-selected={wahl === z.id}
            className={`baum-zeile${wahl === z.id ? ' gewaehlt' : ''}${z.aus ? ' aus' : ''}`}
            style={{ paddingLeft: z.tiefe * 22 }}
            onClick={() => { if (!z.aus) setWahl(z.id); }}
          >
            {z.hatKinder ? (
              <button
                type="button"
                className="baum-klapp"
                title={z.auf ? t('move.collapse') : t('move.expand')}
                onClick={(e) => {
                  e.stopPropagation();
                  setOffen((o) => (z.auf ? o.filter((x) => x !== z.id) : [...o, z.id]));
                }}
              >
                <Icon name="pfad" groesse={16} staerke={2} style={{ transform: z.auf ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
              </button>
            ) : <span className="baum-luecke" />}
            <Icon name={z.o ? 'ordner' : 'bibliothek'} groesse={20} />
            <span className="baum-name">{z.o ? z.o.name : t('common.library')}</span>
            {z.id === (was.ort ?? null) && <span className="baum-hier">{t('move.current')}</span>}
            {wahl === z.id && <Icon name="haken" groesse={18} staerke={2.2} />}
          </div>
        ))}
      </div>
      {was.geteiltVon && (
        <div className="hinweis-box">
          <Icon name="personen" groesse={18} staerke={1.9} />
          <span>{t('move.onlyForYou', { name: was.geteiltVon })}</span>
        </div>
      )}
    </Dialog>
  );
}

/** "Ordner loeschen?" mit Zaehlern (Design 9i). */
export function OrdnerLoeschenDialog({ ordner, zaehler, schliessen, loeschen }) {
  const t = useT();
  if (!ordner) return null;
  const teile = [];
  if (zaehler.unter) teile.push(t('deleteFolder.subfolders', { anzahl: zaehler.unter }));
  teile.push(zaehler.eigene
    ? t('deleteFolder.boards', { anzahl: zaehler.eigene })
    : t('deleteFolder.noBoards'));
  return (
    <Dialog
      titel={t('deleteFolder.title', { name: ordner.name })}
      offen
      schliessen={schliessen}
      breite={460}
      className="loeschen-dialog"
      fuss={(
        <>
          <div className="fuellen" />
          <button type="button" className="knopf-geist" onClick={schliessen}>{t('common.cancel')}</button>
          <button type="button" className="knopf-gefahr" onClick={loeschen}>{t('folder.delete')}</button>
        </>
      )}
    >
      <span className="loeschen-text">{teile.join(' ')}</span>
      {zaehler.geteilt > 0 && (
        <span className="loeschen-zusatz">
          {t('deleteFolder.shared', { anzahl: zaehler.geteilt })}
        </span>
      )}
    </Dialog>
  );
}
