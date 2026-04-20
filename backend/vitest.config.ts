import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Env set here is applied before test modules load, which is required
    // because src/config/env.ts validates at import time.
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      APPLIANCE_ID: 'vitest',
      JWT_SECRET: 'test-jwt-secret-0123456789abcdef0123456789abcdef0123456789',
      SECRETS_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      MIGRATE_ON_BOOT: 'false',
      POSTGRES_HOST: process.env.POSTGRES_HOST ?? 'localhost',
      POSTGRES_PORT: process.env.POSTGRES_PORT ?? '5432',
      POSTGRES_USER: process.env.POSTGRES_USER ?? 'vibept',
      POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? 'vibept_dev',
      POSTGRES_DB: process.env.POSTGRES_DB ?? 'vibept',
    },
  },
});
