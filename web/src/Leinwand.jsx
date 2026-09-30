import { useEffect, useRef } from 'react';
import { Editor } from './zeichnen/editor.js';

// Duenne Huelle: React legt nur den Behaelter an, gezeichnet wird ohne React.
export default function Leinwand({ onBereit, optionen }) {
  const behaelter = useRef(null);

  useEffect(() => {
    const editor = new Editor(behaelter.current, optionen);
    onBereit?.(editor);
    return () => {
      onBereit?.(null);
      editor.zerstoeren();
    };
    // Absichtlich leer: Der Editor soll genau einmal entstehen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={behaelter} className="leinwand" />;
}
