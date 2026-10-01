// Checks whether every component imports the React hooks it uses.
//
// The build does not notice: a missing import only shows up at runtime,
// exactly when the affected component is shown for the first time. A
// component that only lives in a rarely opened sheet therefore only
// breaks for the user.

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
        console.log(`MISSING  ${pfad}: uses ${hook} but does not import it`);
        fehler++;
      }
    }
  }
}

pruefe(verzeichnis);

console.log(fehler ? `\n${fehler} missing imports` : 'All used hooks are imported');
process.exit(fehler ? 1 : 0);
