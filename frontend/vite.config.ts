// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Runtime base-path sentinel — a single image serves any prefix.
//
// Production builds bake `/__VIBE_BASE_PATH__/` into every asset URL,
// router basename, manifest start_url/scope, and PWA icon path. The
// frontend container's docker-entrypoint.d/40-base-path.sh hook reads
// VITE_BASE_PATH at startup and `sed -i` replaces the sentinel across
// the html/js/css/json/map/webmanifest files in /usr/share/nginx/html
// before nginx starts.
//
// Single-app  : VITE_BASE_PATH=/        → assets at /assets/...
// Multi-app   : VITE_BASE_PATH=/payroll/ → assets at /payroll/assets/...
//
// No rebuild required to switch modes — same image, two URLs. (Same
// pattern as Vibe MyBooks' packages/web/docker-entrypoint.d/40-base-
// path.sh and Vibe TB's deploy/web-entrypoint.sh; if any of the three
// gain a fix, port it to the others.)
const BASE_PATH_SENTINEL = '/__VIBE_BASE_PATH__/';

/**
 * Emit `manifest.webmanifest` with `start_url` + `scope` resolved to the
 * runtime sentinel. The container entrypoint substitutes the sentinel
 * for the real prefix before nginx starts so the manifest carries the
 * right scope for whatever mode the container booted in.
 */
function manifestPlugin(basePath: string): Plugin {
  const json = () =>
    JSON.stringify(
      {
        name: 'Vibe Payroll Time',
        short_name: 'Vibe PT',
        description: 'Self-hosted time tracking',
        start_url: basePath,
        scope: basePath,
        display: 'standalone',
        orientation: 'any',
        background_color: '#f8fafc',
        theme_color: '#0f172a',
        icons: [
          {
            src: `${basePath}icons/icon.svg`,
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      null,
      2,
    );

  return {
    name: 'vibe-pt-manifest',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (url === `${basePath}manifest.webmanifest` || url === '/manifest.webmanifest') {
          res.setHeader('Content-Type', 'application/manifest+json');
          res.end(json());
          return;
        }
        next();
      });
    },
    /**
     * Vite's HTML asset rewriter handles `<link rel="icon">`, stylesheet,
     * and script `src`/`href` attributes — but NOT `<link rel="manifest">`.
     * Without this hook, a multi-app build (`base: /payroll/`) leaves the
     * static `<link rel="manifest" href="/manifest.webmanifest">` from
     * index.html untouched, the browser fetches `/manifest.webmanifest`
     * (which doesn't exist under the prefix), and PWA install silently
     * stops working. Rewrite the href to include the base path so it
     * matches where `generateBundle` actually emits the file.
     */
    transformIndexHtml: {
      order: 'pre' as const,
      handler(html: string): string {
        const target = `${basePath}manifest.webmanifest`;
        // Match any `href` value ending in `manifest.webmanifest` —
        // covers both the absolute `/manifest.webmanifest` and the
        // relative `manifest.webmanifest` form so a future edit to
        // index.html doesn't silently re-break this.
        return html.replace(
          /(<link\s+rel=["']manifest["'][^>]*\shref=)["'][^"']*manifest\.webmanifest["']/gi,
          (_match, prefix: string) => `${prefix}"${target}"`,
        );
      },
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source: json(),
      });
    },
  };
}

export default defineConfig(({ command }) => {
  // Proxy target for `vite dev` — the SPA in a browser sends `/api/...`
  // as same-origin, vite catches that and forwards to the backend on
  // localhost:4000 (or VITE_DEV_BACKEND_ORIGIN). Decoupled from runtime
  // API base — see frontend/src/lib/api.ts, which derives the runtime
  // base from `import.meta.env.BASE_URL` (the substituted sentinel),
  // never from a build-time env var.
  const devBackendOrigin = process.env.VITE_DEV_BACKEND_ORIGIN ?? 'http://localhost:4000';

  // Production builds use the runtime sentinel so the same image serves
  // any prefix (substituted by the container entrypoint at startup).
  // `vite dev` keeps `base: '/'` so HMR + the dev proxy work without
  // the substitution step.
  const basePath = command === 'build' ? BASE_PATH_SENTINEL : '/';

  return {
    base: basePath,
    plugins: [react(), manifestPlugin(basePath)],
    server: {
      host: '0.0.0.0',
      // Vibe MyBooks owns 5173 on this workstation. 5180 is what the
      // `dev` npm script enforces with --strictPort; keep the config
      // default in sync so `vite preview` and other vite entry points
      // don't silently drift back to 5173 and collide.
      port: 5180,
      strictPort: true,
      proxy: {
        '/api': {
          target: devBackendOrigin,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      target: 'es2022',
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
    },
  };
});
