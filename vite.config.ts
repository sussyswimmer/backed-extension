import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config.ts';

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  build: {
    target: 'chrome116',
    sourcemap: false,
    rollupOptions: {
      // Pages the manifest doesn't reference directly must be listed, or they're copied unbuilt:
      // the offscreen document, and the popup page the content script shows inside web pages.
      input: { offscreen: 'src/offscreen/offscreen.html', popup: 'src/popup/index.html' },
    },
  },
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
});
