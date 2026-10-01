import { useCallback, useEffect, useState } from 'react';
import { KeinNetz, NichtAngemeldet } from './api.js';
import Bibliothek from './Bibliothek.jsx';
import BoardEditor from './BoardEditor.jsx';
import Labor from './Labor.jsx';
import { t } from './i18n/index.js';

// Pages via the URL, so that Back in the browser and a bookmark to a
// board work:
//   #/               library
//   #/papierkorb     trash
//   #/ordner/<id>    a folder in the library
//   #/board/<id>     a board
//   #/labor          test area for the drawing engine (development)

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

/** A sentence you can show someone instead of a stack trace. */
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
    // Remember which folder you came from: "Back" in the board leads there
    try { sessionStorage.setItem('wb.zurueck', location.hash || '#/'); } catch { /* ignore */ }
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
