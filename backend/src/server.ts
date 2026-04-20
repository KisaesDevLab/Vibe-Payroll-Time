import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closeDb } from './db/knex.js';
import { runMigrations } from './db/migrate.js';
import { createApp } from './http/app.js';

async function main() {
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
  const server = app.listen(env.BACKEND_PORT, env.BACKEND_HOST, () => {
    logger.info(
      { host: env.BACKEND_HOST, port: env.BACKEND_PORT, env: env.NODE_ENV },
      'vibept backend listening',
    );
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
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
