import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    // Testing on the phone:
    //   adb reverse tcp:5173 tcp:5173
    // The dev server is then reachable there at http://localhost:5173,
    // and localhost counts as a secure context: camera, microphone and
    // clipboard work even without HTTPS.
    // ws: live sync runs over WebSocket under /api
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },

  // For checking the production build with a running API:
  //   npm run build && npm run preview
  // The service worker only runs here; in dev mode it is off on purpose.
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },
});
