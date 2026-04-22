// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

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

  return {
    plugins: [react()],
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
