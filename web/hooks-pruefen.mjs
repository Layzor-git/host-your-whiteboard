// Prueft, ob jede Komponente die React-Hooks importiert, die sie benutzt.
//
// Der Bau merkt das nicht: Ein fehlender Import faellt erst zur Laufzeit
// auf, und zwar genau dann, wenn die betroffene Komponente zum ersten Mal
// gezeigt wird. Eine Komponente, die nur in einem selten geoeffneten Blatt
// steckt, faellt also erst beim Nutzer um.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const HOOKS = [
  'useState', 'useEffect', 'useMemo', 'useRef', 'useCallback',
  'useSyncExternalStore', 'useReducer', 'useContext', 'useLayoutEffect',
];
const verzeichnis = process.argv[2] ?? 'src';

let fehler = 0;

function pruefe(ordner) {
  for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
    const pfad = join(ordner, eintrag.name);
    if (eintrag.isDirectory()) { pruefe(pfad); continue; }
    if (!/\.jsx?$/.test(eintrag.name)) continue;

    const inhalt = readFileSync(pfad, 'utf8');
    const zeile = inhalt.match(/import\s*\{([^}]*)\}\s*from\s*['"]react['"]/);
    const importiert = zeile ? zeile[1].split(',').map((x) => x.trim()) : [];

    for (const hook of HOOKS) {
      const benutzt = new RegExp(`\\b${hook}\\s*\\(`).test(inhalt);
      if (benutzt && !importiert.includes(hook)) {
        console.log(`FEHLT  ${pfad}: benutzt ${hook}, importiert es aber nicht`);
        fehler++;
      }
    }
  }
}

pruefe(verzeichnis);

console.log(fehler ? `\n${fehler} fehlende Importe` : 'Alle benutzten Hooks sind importiert');
process.exit(fehler ? 1 : 0);
