import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { serviceWorkerAnmelden, speicherSichern } from './installieren.js';
import { ausstehendeSenden } from './daten/speicher.js';
import { themeAnwenden } from './daten/einstellungen.js';
import { spracheAnwenden } from './i18n/index.js';

// Fonts are part of the build instead of coming from Google: that way they
// also work offline, and the service worker can cache them.
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
// Send whatever was left behind offline now
ausstehendeSenden().catch(() => {});
window.addEventListener('online', () => ausstehendeSenden().catch(() => {}));

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
