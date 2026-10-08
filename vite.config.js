import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two pages: the public homepage (index.html) and the signed-in explorer.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        explorer: resolve(import.meta.dirname, 'explorer.html'),
      },
    },
  },
});
