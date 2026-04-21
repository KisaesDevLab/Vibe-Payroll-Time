import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiBase = env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';
  const apiOrigin = new URL(apiBase).origin;

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
          target: apiOrigin,
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
