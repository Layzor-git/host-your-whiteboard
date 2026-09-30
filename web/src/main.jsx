import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { serviceWorkerAnmelden, speicherSichern } from './installieren.js';
import { ausstehendeSenden } from './daten/speicher.js';
import { themeAnwenden } from './daten/einstellungen.js';
import { spracheAnwenden } from './i18n/index.js';

// Schriften liegen mit im Bau statt bei Google: So funktionieren sie auch
// offline, und der Service Worker kann sie zwischenspeichern.
import '@fontsource/onest/400.css';
import '@fontsource/onest/500.css';
import '@fontsource/onest/600.css';
import '@fontsource/onest/700.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/caveat/600.css';
import '@fontsource/caveat/700.css';
import './design/tokens.css';
import './styles.css';

serviceWorkerAnmelden();
speicherSichern();
themeAnwenden();
spracheAnwenden();
// Was offline liegen geblieben ist, jetzt nachschieben
ausstehendeSenden().catch(() => {});
window.addEventListener('online', () => ausstehendeSenden().catch(() => {}));

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
