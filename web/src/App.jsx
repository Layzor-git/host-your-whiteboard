import { useCallback, useEffect, useState } from 'react';
import { KeinNetz, NichtAngemeldet } from './api.js';
import Bibliothek from './Bibliothek.jsx';
import BoardEditor from './BoardEditor.jsx';
import Labor from './Labor.jsx';
import { t } from './i18n/index.js';

// Seiten ueber die Adresse, damit Zurueck im Browser und ein Lesezeichen
// auf ein Board funktionieren:
//   #/               Bibliothek
//   #/papierkorb     Papierkorb
//   #/ordner/<id>    ein Ordner in der Bibliothek
//   #/board/<id>     ein Board
//   #/labor          Testflaeche fuer die Zeichen-Engine (Entwicklung)

function seiteLesen() {
  const h = location.hash.replace(/^#/, '') || '/';
  const board = h.match(/^\/board\/([^/]+)$/);
  if (board) return { art: 'board', id: decodeURIComponent(board[1]) };
  if (h === '/papierkorb') return { art: 'papierkorb' };
  const ordner = h.match(/^\/ordner\/([^/]+)$/);
  if (ordner) return { art: 'bibliothek', ordnerId: decodeURIComponent(ordner[1]) };
  if (h === '/labor') return { art: 'labor' };
  return { art: 'bibliothek' };
}

/** Ein Satz, den man jemandem zeigen kann, statt eines Stapelabzugs. */
function meldung(fehler) {
  if (fehler instanceof NichtAngemeldet) {
    return t('error.sessionExpired');
  }
  if (fehler instanceof KeinNetz) return t('error.offline');
  return fehler?.message ?? String(fehler);
}

export default function App() {
  const [seite, setSeite] = useState(seiteLesen);

  useEffect(() => {
    const neu = () => setSeite(seiteLesen());
    window.addEventListener('hashchange', neu);
    return () => window.removeEventListener('hashchange', neu);
  }, []);

  const oeffnen = useCallback((id) => {
    // Merken, aus welchem Ordner man kommt: "Zurueck" im Board fuehrt dorthin
    try { sessionStorage.setItem('wb.zurueck', location.hash || '#/'); } catch { /* egal */ }
    location.hash = `#/board/${encodeURIComponent(id)}`;
  }, []);

  if (seite.art === 'labor') return <Labor />;
  if (seite.art === 'board') return <BoardEditor key={seite.id} id={seite.id} meldung={meldung} />;
  return (
    <Bibliothek
      ansicht={seite.art === 'papierkorb' ? 'papierkorb' : 'raster'}
      ordnerId={seite.ordnerId ?? null}
      oeffnen={oeffnen}
      meldung={meldung}
    />
  );
}
