import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Icon from '../ui/Icon.jsx';
import { Avatar, rufname } from '../ui/Avatar.jsx';
import { Dialog } from '../ui/bausteine.jsx';
import { t, useT } from '../i18n/index.js';

// "Share board" (design 7b, 7c, 7f). Invite by email with a permission,
// list of people with access, change permission, remove. Everything takes
// effect immediately; whoever is in the board right now notices without
// reloading.

const RECHTE = [
  ['bearbeiten', 'rights.edit', 'rights.editHint'],
  ['ansehen', 'rights.view', 'rights.viewHint'],
];
const rechtText = (r) => (r === 'ansehen' ? t('rights.view') : t('rights.edit'));
const GUELTIG = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function RechteMenue({ wert, setzen, className }) {
  const t = useT();
  return (
    <div className={`menue rechte-menue ${className ?? ''}`}>
      {RECHTE.map(([id, text, unter]) => (
        <button type="button" key={id} className="menue-punkt zweizeilig" onClick={() => setzen(id)}>
          <span className="menue-text">
            <span>{t(text)}</span>
            <span className="menue-unter">{t(unter)}</span>
          </span>
          {wert === id && <Icon name="haken" groesse={18} staerke={2.2} style={{ color: 'var(--ui-accent)' }} />}
        </button>
      ))}
    </div>
  );
}

// art 'ordner': the same dialog for a folder (applies to everything inside)
const WEGE = {
  board: { laden: api.freigaben, setzen: api.freigabeSetzen, entfernen: api.freigabeEntfernen },
  ordner: { laden: api.ordnerFreigaben, setzen: api.ordnerFreigabeSetzen, entfernen: api.ordnerFreigabeEntfernen },
};

export default function TeilenDialog({ offen, schliessen, boardId, ordnerId, art = 'board', titel, ich, beiAenderung, zeigen, meldung }) {
  const t = useT();
  const id = art === 'ordner' ? ordnerId : boardId;
  const weg = WEGE[art];
  const [daten, setDaten] = useState(null);
  const [mail, setMail] = useState('');
  const [recht, setRecht] = useState('bearbeiten');
  const [fehler, setFehler] = useState('');
  const [rechtOffen, setRechtOffen] = useState(false);
  const [menueFuer, setMenueFuer] = useState(null);

  useEffect(() => {
    if (!offen) return;
    setMail('');
    setFehler('');
    setRechtOffen(false);
    setMenueFuer(null);
    weg.laden(id).then(setDaten, (e) => zeigen(meldung(e)));
  }, [offen, id, weg, zeigen, meldung]);

  function neu(d) {
    setDaten(d);
    beiAenderung?.(d.freigaben);
  }

  const adresse = mail.trim().toLowerCase();
  const gueltig = GUELTIG.test(adresse);
  const vorhanden = !!daten && (daten.besitzer.email === adresse || daten.freigaben.some((f) => f.email === adresse));

  async function einladen() {
    if (!adresse) return;
    if (!gueltig) { setFehler(t('share.invalidEmail')); return; }
    if (vorhanden) { setFehler(t('share.alreadyHasAccess')); return; }
    try {
      neu(await weg.setzen(id, adresse, recht));
      setMail('');
      setRechtOffen(false);
      zeigen(t('share.added', { email: adresse }));
    } catch (e) {
      setFehler(meldung(e));
    }
  }

  async function rechtAendern(email, r) {
    setMenueFuer(null);
    try {
      neu(await weg.setzen(id, email, r));
    } catch (e) {
      zeigen(meldung(e));
    }
  }

  async function entfernen(p) {
    setMenueFuer(null);
    try {
      await weg.entfernen(id, p.email);
      neu({ ...daten, freigaben: daten.freigaben.filter((f) => f.email !== p.email) });
      zeigen(t('share.removed', { name: rufname(p) }));
    } catch (e) {
      zeigen(meldung(e));
    }
  }

  const hinweis = fehler
    || (gueltig && !vorhanden
      ? t('share.neverSignedIn')
      : t('share.worksWithoutAccount'));
  const anzahl = daten ? daten.freigaben.length + 1 : 0;

  return (
    <Dialog
      titel={art === 'ordner' ? t('share.titleFolder') : t('share.titleBoard')}
      untertitel={t('share.subtitle', { name: titel })}
      offen={offen}
      schliessen={schliessen}
      breite={560}
      className="teilen-dialog"
      fuss={(
        <>
          <span className="teilen-fuss">{t('share.immediate')}</span>
          <button type="button" className="knopf-primaer" onClick={schliessen}>{t('common.done')}</button>
        </>
      )}
    >
      <div className="feld">
        <span>{t('share.invite')}</span>
        <div className="einladen-zeile">
          <div className={`einladen-feld${fehler ? ' fehler' : ''}`}>
            <Icon name="mail" groesse={18} staerke={1.8} />
            <input
              type="email"
              value={mail}
              placeholder={t('share.email')}
              aria-label={t('share.email')}
              onChange={(e) => { setMail(e.target.value); setFehler(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') einladen(); }}
            />
            <button
              type="button"
              className="recht-knopf"
              aria-expanded={rechtOffen}
              onClick={() => { setRechtOffen(!rechtOffen); setMenueFuer(null); }}
            >
              {rechtText(recht)}
              <Icon name="aufklappen" groesse={16} staerke={2} />
            </button>
          </div>
          {/* On a phone the permission select sits next to "Invite" instead of in the field */}
          <button
            type="button"
            className="recht-knopf gross einladen-recht-handy"
            aria-expanded={rechtOffen}
            onClick={() => { setRechtOffen(!rechtOffen); setMenueFuer(null); }}
          >
            {rechtText(recht)}
            <Icon name="aufklappen" groesse={16} staerke={2} />
          </button>
          <button type="button" className="knopf-primaer" disabled={!mail.trim()} onClick={einladen}>{t('share.inviteButton')}</button>
          {rechtOffen && (
            <RechteMenue className="einladen-rechte" wert={recht} setzen={(r) => { setRecht(r); setRechtOffen(false); }} />
          )}
        </div>
        <span className={`einladen-hinweis${fehler ? ' fehler' : ''}`}>{hinweis}</span>
      </div>

      {art === 'ordner' && (
        <div className="hinweis-box">
          <Icon name="ordner" groesse={18} staerke={1.8} />
          <span>
            {t('share.folderHint1')}<strong>{t('share.folderHint2')}</strong>{t('share.folderHint3')}
          </span>
        </div>
      )}

      {/* Whoever is invited also has to get past the sign-in. Without
          sign-in (single) or in development there is nothing to say. */}
      {(!ich?.anmeldung || ich.anmeldung === 'cloudflare') && (
        <div className="hinweis-box">
          <Icon name="zugang" groesse={18} staerke={1.8} />
          <span>
            {t('share.accessHint1')}<strong>{t('share.accessHint2')}</strong>{t('share.accessHint3')}
          </span>
        </div>
      )}
      {ich?.anmeldung === 'header' && (
        <div className="hinweis-box">
          <Icon name="zugang" groesse={18} staerke={1.8} />
          <span>{t('share.accessHintProxy')}</span>
        </div>
      )}

      <div className="personen-liste">
        <div className="personen-kopf">
          <span>{t('share.peopleWithAccess')}</span>
          <span>{t('share.peopleCount', { anzahl })}</span>
        </div>
        {daten && (
          <>
            <div className="person-zeile">
              <Avatar person={daten.besitzer} groesse={36} />
              <span className="person-text">
                <span>{daten.besitzer.name ?? daten.besitzer.email}{ich?.email === daten.besitzer.email ? t('share.youSuffix') : ''}</span>
                <span>{daten.besitzer.email}</span>
              </span>
              <span className="besitzer-marke">{t('rights.owner')}</span>
            </div>
            {daten.freigaben.map((p) => (
              <div className="person-zeile" key={p.email}>
                <Avatar person={p} groesse={36} />
                <span className="person-text">
                  <span>{p.name ?? p.email}</span>
                  <span>{p.angemeldet ? p.email : t('share.pending')}</span>
                </span>
                <button
                  type="button"
                  className={`recht-knopf gross${menueFuer === p.email ? ' aktiv' : ''}`}
                  aria-expanded={menueFuer === p.email}
                  onClick={() => { setMenueFuer(menueFuer === p.email ? null : p.email); setRechtOffen(false); }}
                >
                  {rechtText(p.recht)}
                  <Icon name="aufklappen" groesse={16} staerke={2} />
                </button>
                <button type="button" className="entfernen-knopf" title={t('share.removeAccess')} aria-label={t('share.removeAccess')} onClick={() => entfernen(p)}>
                  <Icon name="schliessen" groesse={18} staerke={1.9} />
                </button>
                {menueFuer === p.email && (
                  <RechteMenue className="person-rechte" wert={p.recht} setzen={(r) => rechtAendern(p.email, r)} />
                )}
              </div>
            ))}
            {/* Access through a shared folder: display only, change it in the folder */}
            {daten.ueberOrdner?.map(({ ordner, personen }) => personen.map((p) => (
              <div className="person-zeile ueber-ordner" key={`${ordner.id}-${p.email}`}>
                <Avatar person={p} groesse={36} />
                <span className="person-text">
                  <span>{p.name ?? p.email}</span>
                  <span>{t('share.viaFolder', { name: ordner.name })} · {rechtText(p.recht)}</span>
                </span>
                <Icon name="ordner" groesse={18} staerke={1.8} style={{ color: 'var(--ui-text-3)', marginRight: 13 }} />
              </div>
            )))}
          </>
        )}
      </div>
    </Dialog>
  );
}
