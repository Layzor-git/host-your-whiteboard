import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    // Auf dem Handy testen:
    //   adb reverse tcp:5173 tcp:5173
    // Dann ist der Dev-Server dort unter http://localhost:5173 erreichbar,
    // und localhost gilt als sicherer Kontext: Kamera, Mikrofon und
    // Zwischenablage funktionieren auch ohne HTTPS.
    // ws: der Live-Abgleich laeuft ueber WebSocket unter /api
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },

  // Zum Pruefen des Produktionsbaus mit laufender API:
  //   npm run build && npm run preview
  // Nur hier laeuft der Service Worker, im Dev-Modus ist er absichtlich aus.
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },
});
