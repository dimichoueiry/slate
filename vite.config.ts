import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import slatePersist from './vite-slate-persist';

export default defineConfig({
  // fixed port so the browser origin (and its IndexedDB) never changes
  server: { port: 5180, strictPort: true },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // split rarely-changing third-party libs into their own chunk so app
        // updates don't bust the vendor cache (and it quiets the size warning)
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react-vendor';
          if (/[\\/]node_modules[\\/](roughjs|perfect-freehand|marked|dexie)[\\/]/.test(id)) return 'canvas-vendor';
          return 'vendor';
        },
      },
    },
  },
  plugins: [
    react(),
    slatePersist(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Slate',
        short_name: 'Slate',
        description: 'An infinite-canvas sketchbook for thinking, drawing, diagramming, and planning.',
        theme_color: '#101012',
        background_color: '#101012',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
});
