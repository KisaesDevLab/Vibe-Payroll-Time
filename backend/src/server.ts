// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closeDb } from './db/knex.js';
import { runMigrations } from './db/migrate.js';
import { runDemoSeed } from './db/seed-demo.js';
import { waitForDb } from './db/wait.js';
import { createApp } from './http/app.js';
import { scheduleAutoClockout } from './services/auto-clockout.js';
import { scheduleLicenseHeartbeat } from './services/licensing/heartbeat.js';
import { scheduleMissedPunchReminder } from './services/notifications/missed-punch-cron.js';
import { scheduleRetentionSweep } from './services/retention.js';

async function main() {
  logger.info('waiting for database');
  await waitForDb();

  if (env.MIGRATE_ON_BOOT) {
    logger.info('running pending migrations');
    try {
      await runMigrations();
    } catch (err) {
      logger.error({ err }, 'migration failure');
      throw err;
    }
  }

  if (env.SEED_DEMO_ON_BOOT) {
    // The seed needs SECRETS_ENCRYPTION_KEY to produce PINs that the
    // backend can decrypt/fingerprint at runtime. If the operator set
    // SEED_DEMO_ON_BOOT but forgot to set the key, we surface that
    // loudly rather than silently skipping.
    if (!env.SECRETS_ENCRYPTION_KEY) {
      logger.error('SEED_DEMO_ON_BOOT=true but SECRETS_ENCRYPTION_KEY is unset — refusing to seed');
    } else {
      logger.info('running demo seed');
      try {
        await runDemoSeed();
      } catch (err) {
        logger.error({ err }, 'demo seed failure');
        // Don't crash the appliance over a seed error — log and continue.
      }
    }
  }

  const app = createApp();
  const stopAutoClockout = scheduleAutoClockout();
  const stopMissedPunch = scheduleMissedPunchReminder();
  const stopLicenseHeartbeat = scheduleLicenseHeartbeat();
  const stopRetention = scheduleRetentionSweep();
  const server = app.listen(env.BACKEND_PORT, env.BACKEND_HOST, () => {
    logger.info(
      { host: env.BACKEND_HOST, port: env.BACKEND_PORT, env: env.NODE_ENV },
      'vibept backend listening',
    );
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopAutoClockout();
    stopMissedPunch();
    stopLicenseHeartbeat();
    stopRetention();
    server.close(() => logger.info('http server closed'));
    await closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'boot failure');
  process.exit(1);
});
