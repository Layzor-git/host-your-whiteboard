// Die Icons aus dem Design: 24er-viewBox, Strichstaerke 1.75, runde Enden,
// keine Fuellung. Eigene Pfade, kein Microsoft-Branding.

const PFADE = {
  zurueck: 'M14.5 6l-6 6 6 6',
  rueckgaengig: 'M9 5L4 10l5 5 M4 10h10.5a5 5 0 010 10H11',
  wiederholen: 'M15 5l5 5-5 5 M20 10H9.5a5 5 0 000 10H13',
  stift: 'M4.5 19.5l1.1-4.6L15.7 4.8a2 2 0 012.8 0l.7.7a2 2 0 010 2.8L9.1 18.4z M13.6 6.9l3.5 3.5',
  radierer: 'M8.5 19.5L4 15a2 2 0 010-2.8L12.2 4a2 2 0 012.8 0l5 5a2 2 0 010 2.8l-7.7 7.7z M8.5 8.5l7 7 M8.5 19.5H20',
  linie: 'M5 19L19 5',
  abmelden: 'M9.5 4.5H6.5a2 2 0 00-2 2v11a2 2 0 002 2h3 M15 16l4-4-4-4 M19 12H9.5',
  dicke:'M4 5.5h16 M4 10.5h16 M4 15.5h16v3H4z',
  pfeil: 'M5 19L19 5 M10 5h9v9',
  dreieck: 'M12 5l8.5 14h-17z',
  finger: 'M9.5 12V5a1.5 1.5 0 013 0v6 M12.5 10.5a1.5 1.5 0 013 0v1.5 M15.5 11.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1a5 5 0 01-4-2l-3-4a1.5 1.5 0 012.3-1.9l2.2 2.4',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  alles: 'M4 9V5a1 1 0 011-1h4 M15 4h4a1 1 0 011 1v4 M20 15v4a1 1 0 01-1 1h-4 M9 20H5a1 1 0 01-1-1v-4',
  suche: 'M4.5 11a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0 M20 20l-4.3-4.3',
  loeschen: 'M4.5 7h15 M9.5 7V4.5h5V7 M6.5 7l.9 12.1a1 1 0 001 .9h7.2a1 1 0 001-.9L17.5 7',
  export: 'M12 15V4 M7.5 8.5L12 4l4.5 4.5 M5 14v5a1 1 0 001 1h12a1 1 0 001-1v-5',
  import: 'M12 4v11 M7.5 10.5L12 15l4.5-4.5 M5 14v5a1 1 0 001 1h12a1 1 0 001-1v-5',
  wiederherstellen: 'M4.5 12a7.5 7.5 0 102.2-5.3L4.5 9 M4.5 4.5V9H9',
  offline: 'M7 18h10a4 4 0 00.9-7.9A6 6 0 006.4 9 4.5 4.5 0 007 18z M4 4l16 16',
  schliessen: 'M6 6l12 12M18 6L6 18',
  haken: 'M5 12.5l4.5 4.5L19 7.5',
  drehen: 'M20 12a8 8 0 11-2.3-5.7 M20 4v5h-5',
  vorne: 'M4 12.5l8 4 8-4 M4 16.5l8 4 8-4',
  hinten: 'M4 7.5l8 4 8-4-8-4z M4 11.5l8 4 8-4',
  text: 'M5 7V5h14v2 M12 5v14 M9 19h6',
  teilen: 'M15 19.5v-1.3a3.7 3.7 0 00-3.7-3.7H6.7A3.7 3.7 0 003 18.2v1.3 M9 11a3.25 3.25 0 100-6.5A3.25 3.25 0 009 11z M19 8.5v6 M22 11.5h-6',
  personen: 'M15.5 19.5v-1.2a3.6 3.6 0 00-3.6-3.6H6.1a3.6 3.6 0 00-3.6 3.6v1.2 M9 11a3.2 3.2 0 100-6.4A3.2 3.2 0 009 11z M21.5 19.5v-1.2a3.6 3.6 0 00-2.7-3.5 M15.8 4.7a3.2 3.2 0 010 6.2',
  personEntfernen: 'M15 19.5v-1.3a3.7 3.7 0 00-3.7-3.7H6.7A3.7 3.7 0 003 18.2v1.3 M9 11a3.25 3.25 0 100-6.5A3.25 3.25 0 009 11z M16 11.5h6',
  ansehen: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z M12 14.8a2.8 2.8 0 100-5.6 2.8 2.8 0 000 5.6z',
  mail: 'M4.5 6h15a1 1 0 011 1v10a1 1 0 01-1 1h-15a1 1 0 01-1-1V7a1 1 0 011-1z M4 7l8 6 8-6',
  zugang: 'M12 3.5l7 2.8v5.2c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6.3z M9 12l2 2 4-4',
  aufklappen: 'M7 10l5 5 5-5',
  bibliothek: 'M4 5.5h6.5V12H4z M13.5 5.5H20V12h-6.5z M4 15h6.5v4H4z M13.5 15H20v4h-6.5z',
  ordner: 'M3.5 7.5A2 2 0 015.5 5.5h3.6l2 2h7.4a2 2 0 012 2v7a2 2 0 01-2 2h-13a2 2 0 01-2-2z',
  ordnerNeu: 'M3.5 7.5A2 2 0 015.5 5.5h3.6l2 2h7.4a2 2 0 012 2v7a2 2 0 01-2 2h-13a2 2 0 01-2-2z M12 10.5v5 M9.5 13h5',
  verschieben: 'M3.5 7.5A2 2 0 015.5 5.5h3.6l2 2h7.4a2 2 0 012 2v7a2 2 0 01-2 2h-13a2 2 0 01-2-2z M9 13h6 M12.5 10.5L15 13l-2.5 2.5',
  pfad: 'M9.5 6l6 6-6 6',
  kamera: 'M4 8.5a2 2 0 012-2h1.8l1.5-2h5.4l1.5 2H18a2 2 0 012 2v8.5a2 2 0 01-2 2H6a2 2 0 01-2-2z M12 16a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4z',
  ablage: 'M9 4.5h6v3H9z M15 5.5h2.5a1 1 0 011 1V19a1 1 0 01-1 1h-11a1 1 0 01-1-1V6.5a1 1 0 011-1H9',
  hochladen: 'M12 15V4 M7.5 8.5L12 4l4.5 4.5 M5 14v5a1 1 0 001 1h12a1 1 0 001-1v-5',
  fehler: 'M12 4l9 15.5H3z M12 10v4.5 M12 17.2v.1',
};

// Icons, die mehr als einen Pfad brauchen (Kreise, Rechtecke, Fuellungen)
const FORMEN = {
  formen: (
    <>
      <rect x="3.5" y="10" width="10" height="10" rx="1.5" />
      <circle cx="15.5" cy="8.5" r="5" />
    </>
  ),
  rechteck: <rect x="4" y="6" width="16" height="12" rx="1.5" />,
  auswahlRechteck: <rect x="4" y="5" width="16" height="14" rx="1.5" strokeDasharray="2.6 2.6" />,
  pfeilZeiger: <path d="M6 3.8l12.2 7.4-5.6 1.4-2.8 5.6z M12.6 12.6l4.4 5.4" />,
  ellipse: <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />,
  lasso: (
    <>
      <path d="M12 4.5c4.4 0 8 2.2 8 5s-3.6 5-8 5-8-2.2-8-5 3.6-5 8-5z" strokeDasharray="2.6 2.6" />
      <path d="M7.6 13.6c-.9 1.6-.4 3.5 1.4 4.3 1.3.6 2.1 1.4 1.6 2.6" />
    </>
  ),
  duplizieren: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2.5" />
      <path d="M16 8V6.5A2.5 2.5 0 0013.5 4h-7A2.5 2.5 0 004 6.5v7A2.5 2.5 0 006.5 16H8" />
    </>
  ),
  vorneFlaeche: (
    <>
      <path d="M12 3.5l8 4-8 4-8-4z" fill="currentColor" fillOpacity=".22" />
      <path d="M4 12.5l8 4 8-4 M4 16.5l8 4 8-4" />
    </>
  ),
  hintenFlaeche: (
    <>
      <path d="M4 7.5l8 4 8-4-8-4z M4 11.5l8 4 8-4" />
      <path d="M4 15.5l8 4 8-4-8-4z" fill="currentColor" fillOpacity=".22" />
    </>
  ),
  hintergrund: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <circle cx="9" cy="9" r=".6" fill="currentColor" />
      <circle cx="15" cy="9" r=".6" fill="currentColor" />
      <circle cx="9" cy="15" r=".6" fill="currentColor" />
      <circle cx="15" cy="15" r=".6" fill="currentColor" />
    </>
  ),
  einstellungen: (
    <>
      <path d="M4 7h9 M17 7h3 M4 17h3 M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  sonne: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1.1 1.1M17.3 17.3l1.1 1.1M5.6 18.4l1.1-1.1M17.3 6.7l1.1-1.1" />
    </>
  ),
  mond: <path d="M19.5 14.5A7.5 7.5 0 019.5 4.5a7.5 7.5 0 1010 10z" />,
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M8.5 20h7 M12 16.5V20" />
    </>
  ),
  bild: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M20 15.5l-4.5-4.5L7 19.5" />
    </>
  ),
};

export default function Icon({ name, groesse = 22, staerke = 1.75, className, style }) {
  if (name === 'mehr') {
    return (
      <svg width={groesse} height={groesse} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
        <circle cx="5.5" cy="12" r="1.6" />
        <circle cx="12" cy="12" r="1.6" />
        <circle cx="18.5" cy="12" r="1.6" />
      </svg>
    );
  }
  return (
    <svg
      width={groesse}
      height={groesse}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={staerke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {FORMEN[name] ?? <path d={PFADE[name]} />}
    </svg>
  );
}

/** Logo aus der Bibliothek: Schwung auf dunklem Quadrat. */
export function Logo() {
  return (
    // Dieselbe Datei wie Favicon und App-Symbole (public/logo.svg)
    <img className="logo" src="/logo.svg" width="32" height="32" alt="" />
  );
}
