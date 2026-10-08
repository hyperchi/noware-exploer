import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two pages: the signed-in workspace (index.html) and the public homepage (home.html).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        home: resolve(import.meta.dirname, 'home.html'),
      },
    },
  },
});
