// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Emit `manifest.webmanifest` with `start_url` + `scope` resolved to the
 * configured base path. Single-app builds get `/`; multi-app builds (the
 * grouped overlay sets VITE_BASE_PATH=/payroll/) get `/payroll/`.
 *
 * Kept as a build-time emit instead of a static `public/` file because the
 * base path is only known at build time.
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  // Proxy target is always the local backend when the dev server runs —
  // the SPA in a browser sends `/api/...` as same-origin, vite catches
  // that and forwards to the backend listening on localhost:4000 (or
  // whatever VITE_DEV_BACKEND_ORIGIN overrides to).
  //
  // This is decoupled from VITE_API_BASE_URL, which is what the bundled
  // JS uses AT RUNTIME in the browser. For LAN-access to work (opening
  // the SPA from a phone or tablet on the same wifi), VITE_API_BASE_URL
  // must be relative (default: `/api/v1`) so the browser hits the same
  // host it loaded the SPA from. Baking a `http://localhost:4000`
  // absolute URL into the bundle would make the other device's browser
  // try its OWN localhost, which has nothing listening.
  const devBackendOrigin = env.VITE_DEV_BACKEND_ORIGIN ?? 'http://localhost:4000';

  // Single-app default `/`; multi-app deployment overlay sets `/payroll/`
  // so all assets, the manifest scope, and the SPA router resolve under
  // the shared Caddy ingress prefix. Normalize so a missing or extra
  // trailing slash doesn't break manifest URLs (`${base}icons/icon.svg`)
  // or the nginx SPA-fallback path.
  //
  // Prefer `process.env` over `loadEnv()` here: loadEnv only walks the
  // `.env*` files in the project, NOT the parent shell. The frontend
  // Dockerfile (and the grouped-overlay compose file) wires the value
  // through `ARG → ENV` so it reaches `npm run build` as a process env
  // var; without this fallback the multi-app build was silently emitting
  // a single-app bundle with `base: /` and the Dockerfile's `mv dist/*
  // dist-prefixed/payroll/*` step then created `/payroll/index.html`
  // referencing `/assets/...` paths that 404'd at the SPA's actual URL.
  const rawBase = process.env.VITE_BASE_PATH ?? env.VITE_BASE_PATH ?? '/';
  const basePath = rawBase === '/' ? '/' : `${rawBase.replace(/\/+$/, '')}/`;

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
