// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { defineConfig } from 'vitest/config';
// Pull .env from the monorepo root BEFORE vitest evaluates test.env so
// POSTGRES_HOST/PORT/etc reflect local-dev overrides. Without this,
// running `npm test` from the repo root (which does not load .env) used
// the wrong default port and integration tests silently skipped with
// `dbReachable = false` instead of running against the test DB.
import 'dotenv-flow/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Multiple test files (punch.integration, badges.integration,
    // badges.api.integration) truncate and re-seed the same Postgres
    // instance. Running files in parallel causes FK violations when one
    // file's TRUNCATE runs against another file's fresh rows. Pinning
    // file execution to a single fork keeps DB state deterministic.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // Env set here is applied before test modules load, which is required
    // because src/config/env.ts validates at import time.
    //
    // Integration tests TRUNCATE + re-seed core tables (users, companies,
    // time_entries, ...). Pointing them at the dev DB wipes whatever the
    // operator set up via the setup wizard on every `npm test` run —
    // absolutely catastrophic UX. Default to a dedicated `vibept_test`
    // database so dev and test are physically separate. Anyone can still
    // override via POSTGRES_DB_TEST if they want to target a different
    // database (CI, etc).
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      APPLIANCE_ID: 'vitest',
      JWT_SECRET: 'test-jwt-secret-0123456789abcdef0123456789abcdef0123456789',
      SECRETS_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      MIGRATE_ON_BOOT: 'false',
      POSTGRES_HOST: process.env.POSTGRES_HOST ?? 'localhost',
      POSTGRES_PORT: process.env.POSTGRES_PORT ?? '5437',
      POSTGRES_USER: process.env.POSTGRES_USER ?? 'vibept',
      POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? 'vibept_dev',
      POSTGRES_DB: process.env.POSTGRES_DB_TEST ?? 'vibept_test',
      // CRITICAL: knex.ts prefers DATABASE_URL when set. `.env` carries
      // a connection string pointing at `vibept` (dev) that would
      // otherwise override our `_test` default above and let
      // integration tests TRUNCATE dev data. Build a test-scoped URL
      // explicitly. assert-test-db.ts is the runtime guard if anyone
      // still manages to bypass this.
      DATABASE_URL:
        process.env.DATABASE_URL_TEST ??
        `postgres://${process.env.POSTGRES_USER ?? 'vibept'}:${
          process.env.POSTGRES_PASSWORD ?? 'vibept_dev'
        }@${process.env.POSTGRES_HOST ?? 'localhost'}:${
          process.env.POSTGRES_PORT ?? '5437'
        }/${process.env.POSTGRES_DB_TEST ?? 'vibept_test'}`,
    },
  },
});
