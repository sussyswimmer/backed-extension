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
      // The offscreen page isn't referenced from the manifest, so add it as an entry.
      input: { offscreen: 'src/offscreen/offscreen.html' },
    },
  },
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
});
