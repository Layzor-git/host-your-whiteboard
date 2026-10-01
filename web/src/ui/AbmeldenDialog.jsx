import { useEffect, useState } from 'react';
import { Dialog } from './bausteine.jsx';
import { useT } from '../i18n/index.js';
import { abmelden, abmeldenVorbereiten } from '../daten/abmelden.js';

// "Sign out?" Says who you are signed in as, and warns if some changes
// have not reached the server yet (they would be lost on sign-out).

export default function AbmeldenDialog({ offen, schliessen, ich }) {
  const t = useT();
  const [offene, setOffene] = useState(null);
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => {
    if (!offen) return;
    setOffene(null);
    setLaeuft(false);
    abmeldenVorbereiten().then(setOffene, () => setOffene(0));
  }, [offen]);

  return (
    <Dialog
      titel={t('signOut.title')}
      untertitel={ich ? t('account.signedInAs', { email: ich.email }) : undefined}
      offen={offen}
      schliessen={schliessen}
      breite={440}
      className="loeschen-dialog"
      fuss={(
        <>
          <div className="fuellen" />
          <button type="button" className="knopf-geist" onClick={schliessen}>{t('common.cancel')}</button>
          <button
            type="button"
            className="knopf-gefahr"
            disabled={offene === null || laeuft}
            onClick={() => { setLaeuft(true); abmelden(ich?.abmelden); }}
          >
            {offene === null ? t('signOut.wait') : t('signOut.button')}
          </button>
        </>
      )}
    >
      <p className="loeschen-text">
        {t('signOut.text')}
      </p>
      {offene > 0 && (
        <p className="loeschen-text abmelden-warnung">
          {t('signOut.pending', { anzahl: offene })}
        </p>
      )}
    </Dialog>
  );
}
