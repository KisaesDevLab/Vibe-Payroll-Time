import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closeDb } from './db/knex.js';
import { runMigrations } from './db/migrate.js';
import { waitForDb } from './db/wait.js';
import { createApp } from './http/app.js';
import { scheduleAutoClockout } from './services/auto-clockout.js';
import { scheduleMissedPunchReminder } from './services/notifications/missed-punch-cron.js';

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

  const app = createApp();
  const stopAutoClockout = scheduleAutoClockout();
  const stopMissedPunch = scheduleMissedPunchReminder();
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
