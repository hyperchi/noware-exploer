import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const engineDir = path.join(root, 'lib', 'air-intelligence');
// The dashboard under public/dashboard is served without a bundler, so the
// shared engine is exposed to it at this path: served from lib/ in dev and
// copied into dist/ at build time. One source of truth for server and browser.
const publicPath = '/dashboard/js/intelligence/';

function airIntelligencePlugin() {
  return {
    name: 'noware-air-intelligence',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(publicPath)) return next();
        const name = path.basename(req.url.split('?')[0]);
        const file = path.join(engineDir, name);
        if (!/^[\w-]+\.js$/.test(name) || !fs.existsSync(file)) return next();
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Cache-Control', 'no-store');
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const out = path.join(root, 'dist', 'dashboard', 'js', 'intelligence');
      fs.mkdirSync(out, { recursive: true });
      for (const name of fs.readdirSync(engineDir)) if (name.endsWith('.js')) fs.copyFileSync(path.join(engineDir, name), path.join(out, name));
    },
  };
}

export default defineConfig({
  plugins: [airIntelligencePlugin()],
  server: { port: 5173 },
  build: { rollupOptions: { input: { index: path.join(root, "index.html"), home: path.join(root, "home.html") } } },
});
