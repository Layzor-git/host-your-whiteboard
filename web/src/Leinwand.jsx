import { useEffect, useRef } from 'react';
import { Editor } from './zeichnen/editor.js';

// Thin shell: React only creates the container, drawing happens without React.
export default function Leinwand({ onBereit, optionen }) {
  const behaelter = useRef(null);

  useEffect(() => {
    const editor = new Editor(behaelter.current, optionen);
    onBereit?.(editor);
    return () => {
      onBereit?.(null);
      editor.zerstoeren();
    };
    // Empty on purpose: the editor should be created exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={behaelter} className="leinwand" />;
}
